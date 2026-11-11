-- Resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md §8.10): trazabilidad de
-- cada envío, mensaje por mensaje.
--
--   · WhatsappMessageLog y TelegramMessageLog: «attentionSummaryDeliveryId» une cada
--     mensaje (el aviso, los documentos y los textos del flujo) con su envío.
--   · WhatsappMessageLog: «deliveredAt» y «readAt», la hora de cada estado de Meta
--     (antes solo quedaba el último, en «statusAt»).
--   · AttentionSummaryDelivery: «requestedAt» (el paciente pidió los documentos) y
--     «verifiedAt» (quedó verificado).
--
-- Solo agrega columnas que admiten nulo e índices: ninguna fila existente cambia.

-- AlterTable
ALTER TABLE "WhatsappMessageLog" ADD COLUMN "attentionSummaryDeliveryId" TEXT,
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "readAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TelegramMessageLog" ADD COLUMN "attentionSummaryDeliveryId" TEXT;

-- AlterTable
ALTER TABLE "AttentionSummaryDelivery" ADD COLUMN "requestedAt" TIMESTAMP(3),
ADD COLUMN "verifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "WhatsappMessageLog_attentionSummaryDeliveryId_idx" ON "WhatsappMessageLog"("attentionSummaryDeliveryId");

-- CreateIndex
CREATE INDEX "TelegramMessageLog_attentionSummaryDeliveryId_idx" ON "TelegramMessageLog"("attentionSummaryDeliveryId");
