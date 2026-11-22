-- 🚑 Alertas de posible emergencia al personal (docs/GUARDRAIL_EMERGENCIAS.md).
-- Solo agrega: una tabla vacía y un tipo de plantilla. Mientras la clínica no
-- elija a nadie, la alerta sigue saliendo como antes (al teléfono de soporte, si es
-- un celular).

-- AlterEnum
ALTER TYPE "WhatsappTemplateKind" ADD VALUE 'EMERGENCY_ALERT';

-- CreateTable
CREATE TABLE "EmergencyAlertRecipient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "lastWamid" TEXT,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastTestAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyAlertRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmergencyAlertRecipient_organizationId_isActive_idx" ON "EmergencyAlertRecipient"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyAlertRecipient_organizationId_phone_key" ON "EmergencyAlertRecipient"("organizationId", "phone");

-- AddForeignKey
ALTER TABLE "EmergencyAlertRecipient" ADD CONSTRAINT "EmergencyAlertRecipient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
