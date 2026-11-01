-- Resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md), Fase 1: lectura en sombra.
--
--   · HospitalMirrorConfig.resumenAtencion: la configuración y los interruptores
--     (§3.11). NULL = la función no existe para la clínica; al habilitarla, todo
--     interruptor que falte se lee APAGADO (decisión del usuario, 2026-11-01).
--   · HospitalMirrorConfig.resumenAtencionCursor: hasta qué historia leyó el agente.
--   · AttentionSummary: un resumen por historia del HIS, con el contenido cifrado
--     y su fecha de borrado (D11: 30 días).
--   · PatientProfile.summariesOptOut: la baja de los resúmenes.
--
-- Solo agrega: ninguna fila existente cambia y nada se lee ni se envía hasta que
-- alguien encienda los interruptores.

-- CreateEnum
CREATE TYPE "AttentionSummaryStatus" AS ENUM ('RECIBIDO', 'EXCLUIDO', 'ENVIADO', 'SIN_CONTACTO', 'CADUCADO');

-- AlterTable
ALTER TABLE "PatientProfile" ADD COLUMN     "summariesOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "HospitalMirrorConfig" ADD COLUMN     "resumenAtencion" JSONB,
ADD COLUMN     "resumenAtencionCursor" TEXT;

-- CreateTable
CREATE TABLE "AttentionSummary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hisKey" TEXT NOT NULL,
    "patientProfileId" TEXT,
    "serviceCode" TEXT,
    "attendedAt" TIMESTAMP(3) NOT NULL,
    "content" TEXT,
    "contentHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "AttentionSummaryStatus" NOT NULL DEFAULT 'RECIBIDO',
    "statusReason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contentExpiresAt" TIMESTAMP(3) NOT NULL,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "AttentionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttentionSummary_organizationId_attendedAt_idx" ON "AttentionSummary"("organizationId", "attendedAt");

-- CreateIndex
CREATE INDEX "AttentionSummary_contentExpiresAt_idx" ON "AttentionSummary"("contentExpiresAt");

-- CreateIndex
CREATE INDEX "AttentionSummary_patientProfileId_idx" ON "AttentionSummary"("patientProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "AttentionSummary_organizationId_hisKey_key" ON "AttentionSummary"("organizationId", "hisKey");

-- AddForeignKey
ALTER TABLE "AttentionSummary" ADD CONSTRAINT "AttentionSummary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttentionSummary" ADD CONSTRAINT "AttentionSummary_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

