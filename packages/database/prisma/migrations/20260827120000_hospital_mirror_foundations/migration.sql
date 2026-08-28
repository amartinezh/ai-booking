-- Fase 1 del motor de espejo de citas con HIS externos (patrón de drivers).
-- Ver docs/PLAN_ESPEJO_HOSPITAL.md para la arquitectura completa.
--
-- Este archivo combina DDL generada por `prisma migrate diff` (modelos nuevos,
-- columna nueva, valor de enum) con SQL manual que Prisma no gestiona: el
-- índice parcial de eventos pendientes y el trigger de captura hacia
-- "SyncOutbox". El trigger es la pieza que garantiza que NINGÚN escritor de
-- slots/médicos/citas (API, web, seeds, SQL manual, presente o futuro) se
-- escape del espejo — ver docs/PLAN_ESPEJO_HOSPITAL.md §4.2.

-- AlterEnum
ALTER TYPE "AppointmentOrigin" ADD VALUE 'MIRROR';

-- AlterTable
ALTER TABLE "DoctorProfile" ADD COLUMN     "whatsappBookingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "HospitalMirrorConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "driverKey" TEXT NOT NULL,
    "agentTokenHash" TEXT,
    "driverConfig" JSONB,
    "mappingVersion" INTEGER NOT NULL DEFAULT 1,
    "mappingJson" JSONB,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pullEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastPushCursor" BIGINT NOT NULL DEFAULT 0,
    "conflictAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "agendadorWhatsapp" TEXT,
    "agendadorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HospitalMirrorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MirrorConflictAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "waitlistEntryId" TEXT NOT NULL,
    "whatsappSentAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "seenByStaffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MirrorConflictAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncOutbox" (
    "seq" BIGSERIAL NOT NULL,
    -- dbgenerated: esta fila la crea el trigger fn_sync_outbox() con INSERT
    -- SQL crudo (nunca pasa por Prisma Client), así que necesita un DEFAULT
    -- real a nivel de base de datos, no uno de capa de aplicación.
    "eventId" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'LOCAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deadLettered" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "SyncInbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "op" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "eventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HospitalMirrorConfig_organizationId_key" ON "HospitalMirrorConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MirrorConflictAlert_waitlistEntryId_key" ON "MirrorConflictAlert"("waitlistEntryId");

-- CreateIndex
CREATE INDEX "MirrorConflictAlert_organizationId_seenByStaffAt_idx" ON "MirrorConflictAlert"("organizationId", "seenByStaffAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncOutbox_eventId_key" ON "SyncOutbox"("eventId");

-- CreateIndex
CREATE INDEX "SyncOutbox_organizationId_seq_idx" ON "SyncOutbox"("organizationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "SyncInbox_eventId_key" ON "SyncInbox"("eventId");

-- CreateIndex
CREATE INDEX "SyncInbox_organizationId_appliedAt_idx" ON "SyncInbox"("organizationId", "appliedAt");

-- CreateIndex
CREATE INDEX "SyncAudit_organizationId_createdAt_idx" ON "SyncAudit"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncAudit_eventId_idx" ON "SyncAudit"("eventId");

-- AddForeignKey
ALTER TABLE "HospitalMirrorConfig" ADD CONSTRAINT "HospitalMirrorConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MirrorConflictAlert" ADD CONSTRAINT "MirrorConflictAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MirrorConflictAlert" ADD CONSTRAINT "MirrorConflictAlert_waitlistEntryId_fkey" FOREIGN KEY ("waitlistEntryId") REFERENCES "WaitlistEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncOutbox" ADD CONSTRAINT "SyncOutbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncInbox" ADD CONSTRAINT "SyncInbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAudit" ADD CONSTRAINT "SyncAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- SQL MANUAL (no gestionado por Prisma): índice parcial + trigger de captura.
-- Prisma no expresa índices parciales (WHERE) ni triggers en su DSL, por eso
-- viven aquí a mano, en la misma migración que crea las tablas que usan.
-- =============================================================================

-- Índice parcial: la consulta más caliente del módulo mirror es "dame los
-- eventos pendientes de esta organización, en orden" — este índice cubre
-- exactamente eso sin cargar filas ya entregadas.
CREATE INDEX "idx_outbox_pending" ON "SyncOutbox" ("organizationId", "seq") WHERE "deliveredAt" IS NULL;

-- Función de captura genérica: serializa la fila completa (NEW en INSERT/UPDATE,
-- OLD en DELETE) a "SyncOutbox", solo si la organización tiene el espejo
-- encendido. TG_ARGV[0] es el entity_type ('SLOT'|'DOCTOR'|'APPOINTMENT'),
-- pasado por cada CREATE TRIGGER individual — la función no conoce la tabla.
--
-- Anti-eco: cuando el módulo mirror aplica un cambio que vino del HIS, ejecuta
-- `SET LOCAL agenia.sync_origin = 'MIRROR'` dentro de esa transacción. El
-- trigger igual registra el evento (para auditoría) pero con origin='MIRROR',
-- y el dispatcher del mirror sabe no reenviarlo de vuelta al HIS que lo originó.
CREATE OR REPLACE FUNCTION fn_sync_outbox() RETURNS trigger AS $$
DECLARE
  v_origin TEXT := current_setting('agenia.sync_origin', true);
  v_org_id TEXT := COALESCE(NEW."organizationId", OLD."organizationId");
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "HospitalMirrorConfig" c
    WHERE c."organizationId" = v_org_id AND c."enabled" = true
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO "SyncOutbox"("organizationId", "entityType", "entityId", "op", "payload", "origin")
  VALUES (
    v_org_id,
    TG_ARGV[0],
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    to_jsonb(COALESCE(NEW, OLD)),
    COALESCE(v_origin, 'LOCAL')
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Un trigger por tabla espejada. Todas disparan en AFTER para no interferir
-- con la transacción original si algo fallara en la inserción del outbox
-- (preferimos fallar la transacción completa a dejar un slot/cita huérfano
-- de su evento de sync — ver "Garantía de cero pérdida" en el plan).
CREATE TRIGGER trg_sync_outbox_schedule_slot
  AFTER INSERT OR UPDATE OR DELETE ON "ScheduleSlot"
  FOR EACH ROW EXECUTE FUNCTION fn_sync_outbox('SLOT');

CREATE TRIGGER trg_sync_outbox_doctor_profile
  AFTER INSERT OR UPDATE OR DELETE ON "DoctorProfile"
  FOR EACH ROW EXECUTE FUNCTION fn_sync_outbox('DOCTOR');

CREATE TRIGGER trg_sync_outbox_appointment
  AFTER INSERT OR UPDATE OR DELETE ON "Appointment"
  FOR EACH ROW EXECUTE FUNCTION fn_sync_outbox('APPOINTMENT');
