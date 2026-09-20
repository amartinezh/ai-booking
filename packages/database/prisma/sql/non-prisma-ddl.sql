-- =============================================================================
-- DDL que Prisma NO gestiona: triggers, funciones e indices parciales.
--
-- POR QUE EXISTE ESTE ARCHIVO
-- Este repo construye sus bases con `prisma db push` (ver scripts/up.sh y
-- deploy/install-vps.sh), que aplica el schema.prisma y NUNCA ejecuta el SQL
-- de prisma/migrations/. Peor: `db_bootstrap` en el instalador sella todas las
-- migraciones como `--applied` sin correrlas, asi que ningun `migrate deploy`
-- posterior las ejecutara jamas.
--
-- Resultado medido el 2026-08-31: en la base de desarrollo NO existia
-- `fn_sync_outbox()` ni ninguno de sus tres triggers. El espejo con el HIS
-- estaba silenciosamente muerto: SyncOutbox vacio, sin un solo error visible.
-- En una VPS recien instalada habria pasado exactamente lo mismo.
--
-- TODO lo de este archivo es IDEMPOTENTE: correrlo diez veces seguidas es
-- inofensivo. Se ejecuta SIEMPRE despues de `db push` y despues de
-- `migrate deploy`, en los cuatro caminos que construyen una base.
--
--   pnpm --filter @agenia/database db:apply-sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Indice parcial de eventos pendientes
-- -----------------------------------------------------------------------------
-- La consulta mas caliente del modulo mirror es "dame los eventos pendientes
-- de esta organizacion, en orden". El predicado debe coincidir EXACTAMENTE con
-- el del dispatcher (deliveredAt IS NULL AND deadLettered = false) o Postgres
-- no puede usar el indice y cae a un scan de la tabla completa.
DROP INDEX IF EXISTS "idx_outbox_pending";
CREATE INDEX "idx_outbox_pending"
  ON "SyncOutbox" ("organizationId", "seq")
  WHERE "deliveredAt" IS NULL AND "deadLettered" = false;

-- -----------------------------------------------------------------------------
-- 2. Captura hacia SyncOutbox
-- -----------------------------------------------------------------------------
-- Serializa la fila completa (NEW en INSERT/UPDATE, OLD en DELETE) a
-- "SyncOutbox", solo si la organizacion tiene el espejo encendido. TG_ARGV[0]
-- es el entity_type ('SLOT'|'DOCTOR'|'APPOINTMENT'), que pasa cada CREATE
-- TRIGGER — la funcion no conoce la tabla.
--
-- Anti-eco: cuando el modulo mirror aplica un cambio que vino del HIS, ejecuta
-- `SET LOCAL agenia.sync_origin = 'MIRROR'` dentro de esa transaccion. El
-- trigger igual registra el evento (para auditoria) pero con origin='MIRROR',
-- y el dispatcher sabe no reenviarlo de vuelta al HIS que lo origino.
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

  INSERT INTO "SyncOutbox"("organizationId", "entityType", "entityId", "op", "payload", "origin")
  VALUES (
    v_org_id,
    TG_ARGV[0],
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    v_payload,
    COALESCE(v_origin, 'LOCAL')
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Un trigger por tabla espejada. Todas disparan en AFTER para no interferir
-- con la transaccion original si algo fallara en la insercion del outbox
-- (preferimos fallar la transaccion completa a dejar un slot/cita huerfano de
-- su evento de sync — ver "Garantia de cero perdida" en el plan).
--
-- DROP + CREATE en vez de CREATE OR REPLACE: Postgres no soporta
-- `CREATE OR REPLACE TRIGGER` antes de la version 14, y el objetivo aqui es
-- que este archivo corra en cualquier version que el equipo tenga enfrente.
DROP TRIGGER IF EXISTS trg_sync_outbox_schedule_slot ON "ScheduleSlot";
CREATE TRIGGER trg_sync_outbox_schedule_slot
  AFTER INSERT OR UPDATE OR DELETE ON "ScheduleSlot"
  FOR EACH ROW EXECUTE FUNCTION fn_sync_outbox('SLOT');

DROP TRIGGER IF EXISTS trg_sync_outbox_doctor_profile ON "DoctorProfile";
CREATE TRIGGER trg_sync_outbox_doctor_profile
  AFTER INSERT OR UPDATE OR DELETE ON "DoctorProfile"
  FOR EACH ROW EXECUTE FUNCTION fn_sync_outbox('DOCTOR');

-- `UPDATE OF <columnas>`, no `UPDATE` a secas: sin esto, CUALQUIER UPDATE de
-- `Appointment` generaba un evento hacia el HIS, incluidos campos 100%
-- internos de AgenIA como `reminderSentAt` (lo toca el cron de recordatorios
-- en cada cita agendada). Esos eventos no tenían nada que ofrecerle al HIS,
-- caían siempre en el mismo cajón sin implementar del motor (ver
-- core/engine.ts, case 'UPDATE') y terminaban quemando sus diez intentos en
-- dead-letter — no por un fallo real, sino por un campo que al hospital no le
-- importa. La lista es un ALLOWLIST a propósito (falla seguro): un campo
-- interno nuevo que se agregue después no dispara el trigger por accidente,
-- hay que agregarlo aquí a mano si alguna vez sí le importa al HIS.
-- Postgres dispara `UPDATE OF` cuando la columna aparece en el SET del
-- UPDATE — que es exactamente lo que genera Prisma: solo los campos que de
-- verdad cambiaron.
DROP TRIGGER IF EXISTS trg_sync_outbox_appointment ON "Appointment";
CREATE TRIGGER trg_sync_outbox_appointment
  AFTER INSERT OR DELETE OR UPDATE OF
    status, "scheduleSlotId", "patientId", "epsId", reason, "attendanceStatus"
  ON "Appointment"
  FOR EACH ROW EXECUTE FUNCTION fn_sync_outbox('APPOINTMENT');

-- ═══════════════════════════════════════════════════════════════════════════
-- Un cupo, como mucho UNA cita vigente.
--
-- `Appointment.scheduleSlotId` llevaba un @unique global, y eso decía algo
-- distinto: "un cupo tuvo como mucho una cita EN TODA SU HISTORIA". Una cita
-- cancelada conserva su fila (es historia clínica) y seguía ocupando la llave,
-- así que un cupo liberado tras una cancelación se volvía a ofrecer por
-- WhatsApp y reventaba al confirmar con "ese espacio acaba de reservarse".
-- Mentira, y sin arreglo posible: ese cupo quedaba invendible para siempre.
--
-- Lo encontró la prueba de punta a punta contra la VM: cancelar y volver a
-- agendar la misma hora es de las cosas más normales que hace un paciente.
--
-- Prisma no sabe expresar un índice único parcial, por eso vive aquí.
-- ═══════════════════════════════════════════════════════════════════════════
DROP INDEX IF EXISTS "Appointment_scheduleSlotId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_appointment_cupo_vigente"
  ON "Appointment" ("scheduleSlotId")
  WHERE status <> 'CANCELLED';

-- ═══════════════════════════════════════════════════════════════════════════
-- Búsqueda de pacientes por NOMBRE (rastreo de paciente, Fase 0).
--
-- docs/PLAN_RASTREO_PACIENTE.md §4.2 y §8. Sin esto, buscar "maria lopez" es un
-- `ILIKE '%...%'` sin índice — un scan de todos los pacientes — y además falla
-- con las tildes: "María" no casa con "maria".
--
--   · pg_trgm  → índice GIN que acelera LIKE '%texto%' y la similitud.
--   · unaccent → quita tildes.
--   · fn_norm_texto() → minúsculas + sin tildes, la MISMA expresión que tiene
--     que usar la consulta para que Postgres pueda usar el índice.
--
-- `unaccent()` está declarada STABLE, no IMMUTABLE, y Postgres solo indexa
-- expresiones inmutables. Este envoltorio la declara inmutable: es el patrón
-- habitual y es seguro mientras el diccionario de unaccent no cambie, lo que en
-- la práctica no ocurre. Si algún día cambiara, basta reconstruir el índice.
--
-- Ambas extensiones vienen en la imagen oficial de Postgres y son "trusted"
-- desde PG 13 (las puede crear el dueño de la base, no hace falta superusuario).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION fn_norm_texto(text) RETURNS text AS $$
  SELECT lower(public.unaccent('public.unaccent', $1))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

CREATE INDEX IF NOT EXISTS "idx_patient_fullname_trgm"
  ON "PatientProfile" USING gin (fn_norm_texto("fullName") gin_trgm_ops);
