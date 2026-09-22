-- ALTA EN CALIENTE DE LAS CITAS DEL HOSPITAL (docs/PLAN_ALTA_EN_CALIENTE.md).
--
-- Aditivo: no se toca ni se migra ninguna fila existente.
--
--   · PatientProfile.remindersOptOut (D2): quien pidió no recibir recordatorios no los
--     recibe, venga la cita de WhatsApp o del hospital. Las filas existentes quedan en
--     false, que es el comportamiento de hoy.
--   · MirrorPatientOptOut (D10): documentos que NO se vuelven a dar de alta solos
--     cuando llega una cita del HIS. Guarda el documento (normalizado, sin ceros a la
--     izquierda) y no una FK, para sobrevivir al borrado del perfil.

-- AlterTable
ALTER TABLE "PatientProfile" ADD COLUMN "remindersOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MirrorPatientOptOut" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MirrorPatientOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MirrorPatientOptOut_organizationId_document_key" ON "MirrorPatientOptOut"("organizationId", "document");

-- AddForeignKey
ALTER TABLE "MirrorPatientOptOut" ADD CONSTRAINT "MirrorPatientOptOut_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- 🚨 ARREGLO DEL DISPARADOR DEL OUTBOX (hallado al verificar el alta en caliente
-- contra Postgres real). Dos defectos, los dos PREEXISTENTES:
--
--   1. `current_setting('agenia.sync_origin', true)` devuelve NULL solo si el
--      parámetro nunca se definió en la conexión. Tras la primera transacción del
--      espejo (que hace `SET LOCAL`), al terminar vuelve a la CADENA VACÍA — y las
--      conexiones se reutilizan. Todo lo que AgenIA escribiera después en esa misma
--      conexión quedaba con origin = '' en vez de 'LOCAL'.
--   2. Lo nacido en el HIS quedaba pendiente de entrega, así que el despachador se
--      lo devolvía al hospital que lo originó. Hasta ahora era inofensivo (cancelar
--      algo ya cancelado no hace nada); con el alta en caliente sería crear en el
--      HIS una cita que el HIS ya tiene.
--
-- La función es la misma de `prisma/sql/non-prisma-ddl.sql` (fuente de la verdad);
-- se repite aquí para que un despliegue por migraciones también la corrija.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_sync_outbox() RETURNS trigger AS $$
DECLARE
  v_origin TEXT := current_setting('agenia.sync_origin', true);
  v_org_id TEXT := COALESCE(NEW."organizationId", OLD."organizationId");
  v_payload JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "HospitalMirrorConfig" c
    WHERE c."organizationId" = v_org_id AND c."enabled" = true
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- En un UPDATE se adjunta la fila ANTERIOR bajo `__old`.
  --
  -- Sin esto un reagendamiento es irrecuperable: AgenIA lo modela moviendo
  -- `scheduleSlotId` en la MISMA fila, asi que el evento solo traia el cupo
  -- nuevo y el driver no tenia forma de saber que cita borrar en el HIS. Con
  -- `__old` se puede cancelar la vieja y crear la nueva, que es exactamente
  -- como el hospital dijo que quiere que funcione.
  --
  -- Solo en UPDATE: en INSERT no hay anterior, y en DELETE la fila completa ya
  -- viaja como payload.
  IF TG_OP = 'UPDATE' THEN
    v_payload := to_jsonb(NEW) || jsonb_build_object('__old', to_jsonb(OLD));
  ELSE
    v_payload := to_jsonb(COALESCE(NEW, OLD));
  END IF;

  -- 🚨 `current_setting(..., true)` devuelve NULL solo si el parametro NUNCA se
  -- definio en esta conexion. Tras la primera transaccion que hizo
  -- `SET LOCAL agenia.sync_origin`, al terminar esa transaccion el valor vuelve a
  -- la CADENA VACIA, no a NULL — y las conexiones se reutilizan (pool). Con un
  -- COALESCE a secas, todo lo que AgenIA escribiera despues en esa misma conexion
  -- quedaba con origin = '' en vez de 'LOCAL': ni local ni espejo.
  --
  -- ANTI-ECO: lo que nace en el HIS se registra para auditoria pero NACE ENTREGADO
  -- (`deliveredAt` = ahora), que es la forma de que el dispatcher no lo devuelva al
  -- hospital que lo origino sin dejarlo pendiente para siempre tapando la cola.
  INSERT INTO "SyncOutbox"("organizationId", "entityType", "entityId", "op", "payload", "origin", "deliveredAt")
  VALUES (
    v_org_id,
    TG_ARGV[0],
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    v_payload,
    COALESCE(NULLIF(v_origin, ''), 'LOCAL'),
    CASE WHEN COALESCE(NULLIF(v_origin, ''), 'LOCAL') = 'MIRROR' THEN now() ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Datos ya escritos con el defecto: eran eventos LOCALES mal marcados.
UPDATE "SyncOutbox" SET "origin" = 'LOCAL' WHERE "origin" = '';

-- Y lo nacido en el HIS que sigue pendiente NO se debe enviar al HIS: se da por
-- entregado (la fila se conserva como auditoría).
UPDATE "SyncOutbox" SET "deliveredAt" = now()
 WHERE "origin" = 'MIRROR' AND "deliveredAt" IS NULL;
