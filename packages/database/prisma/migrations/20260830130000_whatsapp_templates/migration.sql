-- =============================================================================
-- 📨 PLANTILLAS DE WHATSAPP: mensajes fuera de la ventana de 24 h
--
-- Meta sólo permite TEXTO LIBRE dentro de las 24 h siguientes al último mensaje
-- del paciente. Fuera de esa ventana hace falta una plantilla previamente
-- APROBADA. El cron de recordatorios envía texto libre el día ANTES de la cita,
-- es decir casi siempre fuera de la ventana: hoy esos envíos fallan en silencio
-- para todo paciente sin conversación reciente.
--
-- Las plantillas se aprueban contra la WABA de CADA clínica, así que nombre e
-- idioma son datos POR ORGANIZACIÓN — la misma plantilla lógica puede llamarse
-- distinto en cada tenant. De ahí `@@unique([organizationId, kind])`, en línea
-- con el resto del aislamiento por tenant de este esquema.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WhatsappTemplateKind') THEN
    CREATE TYPE "WhatsappTemplateKind" AS ENUM ('APPOINTMENT_REMINDER', 'WAITLIST_SLOT_OFFER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WhatsappTemplate" (
    "id" TEXT NOT NULL,
    "kind" "WhatsappTemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'es',
    "requestsContactInfo" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappTemplate_pkey" PRIMARY KEY ("id")
);

-- Una plantilla por tipo y por clínica.
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsappTemplate_organizationId_kind_key"
  ON "WhatsappTemplate"("organizationId", "kind");
CREATE INDEX IF NOT EXISTS "WhatsappTemplate_organizationId_idx"
  ON "WhatsappTemplate"("organizationId");

-- CASCADE: al purgar una organización se van sus plantillas; no tienen sentido
-- fuera de la WABA que las aprobó.
ALTER TABLE "WhatsappTemplate" DROP CONSTRAINT IF EXISTS "WhatsappTemplate_organizationId_fkey";
ALTER TABLE "WhatsappTemplate" ADD CONSTRAINT "WhatsappTemplate_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
