-- AVISOS MASIVOS — cancelación pasiva por WhatsApp cuando un especialista
-- visitante no puede asistir. EXCLUSIVO del driver cnt-sanvicente-anserma —
-- ver docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md.
--
-- Tres cambios, todos aditivos, ninguno toca una fila existente:
--
-- 1) `HospitalMirrorConfig.avisosMasivos` (JSONB, nullable) — la bandera y la
--    configuración de la función. NULL en toda organización existente: la
--    función no existe hasta que se prende a propósito. No comparte fila con
--    `driverConfig` (credenciales del HIS) a propósito — ver el comentario en
--    el schema.
--
-- 2) `WhatsappTemplateKind` gana el valor `APPOINTMENT_CANCELLED_MASS` — la
--    plantilla aprobada por Meta para este aviso. Aditivo: no invalida
--    ninguna fila `WhatsappTemplate` existente.
--
-- 3) `MassNoticeBatch` / `MassNoticeRecipient` — dos tablas NUEVAS, sin FK
--    hacia `Appointment` ni `ScheduleSlot` (el vínculo, cuando existe, es por
--    `agenIAPatientId` + `appointmentAtUtc`, nunca por llave foránea) y SIN
--    trigger de outbox: un destinatario de un aviso no es un evento que el
--    HIS deba conocer.

-- AlterEnum
ALTER TYPE "WhatsappTemplateKind" ADD VALUE 'APPOINTMENT_CANCELLED_MASS';

-- AlterTable
ALTER TABLE "HospitalMirrorConfig" ADD COLUMN     "avisosMasivos" JSONB;

-- CreateTable
CREATE TABLE "MassNoticeBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BORRADOR',
    "doctorExternalKey" TEXT,
    "doctorLabel" TEXT,
    "serviceLabel" TEXT,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "messageTemplate" TEXT,
    "messagePreview" TEXT,
    "notaAdicional" TEXT,
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "selected" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "MassNoticeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MassNoticeRecipient" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientDocument" TEXT NOT NULL,
    "patientName" TEXT,
    "phoneE164" TEXT,
    "appointmentAtUtc" TIMESTAMP(3) NOT NULL,
    "doctorExternalKey" TEXT,
    "serviceExternalKey" TEXT,
    "agenIAPatientId" TEXT,
    "previousSentAt" TIMESTAMP(3),
    "previousSentBatchId" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "outcome" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "usedTemplate" TEXT,

    CONSTRAINT "MassNoticeRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MassNoticeBatch_organizationId_createdAt_idx" ON "MassNoticeBatch"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "MassNoticeRecipient_batchId_outcome_idx" ON "MassNoticeRecipient"("batchId", "outcome");

-- CreateIndex
CREATE INDEX "MassNoticeRecipient_organizationId_patientDocument_appointm_idx" ON "MassNoticeRecipient"("organizationId", "patientDocument", "appointmentAtUtc");

-- CreateIndex
CREATE UNIQUE INDEX "MassNoticeRecipient_batchId_patientDocument_appointmentAtUt_key" ON "MassNoticeRecipient"("batchId", "patientDocument", "appointmentAtUtc");

-- AddForeignKey
ALTER TABLE "MassNoticeBatch" ADD CONSTRAINT "MassNoticeBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MassNoticeBatch" ADD CONSTRAINT "MassNoticeBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MassNoticeRecipient" ADD CONSTRAINT "MassNoticeRecipient_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MassNoticeBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
