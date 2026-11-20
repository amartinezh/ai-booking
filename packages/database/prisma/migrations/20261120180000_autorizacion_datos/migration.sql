-- 🔒 Autorización de tratamiento de datos por chat (Ley 1581 de 2012,
-- docs/PLAN_AUTORIZACION_DATOS.md). Todo nace apagado o vacío: el interruptor
-- `dataConsentEnabled` en false, la tabla `DataConsent` sin filas y las dos
-- columnas nuevas de los formularios en NULL. Ninguna clínica cambia de conducta
-- al desplegar; nada de lo que existe se modifica ni se borra.

-- CreateEnum
CREATE TYPE "DataConsentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED');

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "dataConsentEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dataConsentUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "dataConsentUpdatedBy" TEXT,
ADD COLUMN     "dataPolicyUrl" TEXT,
ADD COLUMN     "dataPolicyVersion" TEXT NOT NULL DEFAULT '1';

-- AlterTable
ALTER TABLE "EpsEnrollmentRequest" ADD COLUMN     "dataConsentAt" TIMESTAMP(3),
ADD COLUMN     "dataConsentPolicyVersion" TEXT;

-- AlterTable
ALTER TABLE "AppointmentLimitRequest" ADD COLUMN     "dataConsentAt" TIMESTAMP(3),
ADD COLUMN     "dataConsentPolicyVersion" TEXT;

-- CreateTable
CREATE TABLE "DataConsent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" "ChannelKind" NOT NULL,
    "senderKey" TEXT NOT NULL,
    "phone" TEXT,
    "bsuid" TEXT,
    "status" "DataConsentStatus" NOT NULL DEFAULT 'PENDING',
    "policyVersion" TEXT NOT NULL,
    "policyUrl" TEXT,
    "noticeText" TEXT NOT NULL,
    "timesAsked" INTEGER NOT NULL DEFAULT 1,
    "answerText" TEXT,
    "answerVia" TEXT,
    "patientIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataConsent_organizationId_senderKey_idx" ON "DataConsent"("organizationId", "senderKey");

-- CreateIndex
CREATE INDEX "DataConsent_organizationId_phone_idx" ON "DataConsent"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "DataConsent_organizationId_bsuid_idx" ON "DataConsent"("organizationId", "bsuid");

-- CreateIndex
CREATE INDEX "DataConsent_organizationId_askedAt_idx" ON "DataConsent"("organizationId", "askedAt");

-- AddForeignKey
ALTER TABLE "DataConsent" ADD CONSTRAINT "DataConsent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

