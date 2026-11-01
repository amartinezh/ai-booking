-- Resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md), Fase 4: envío por WhatsApp.
--
--   · WhatsappTemplateKind.ATTENTION_SUMMARY_READY: la plantilla «tiene listos los
--     documentos de su consulta», sin datos clínicos, con el botón «Recibir mis
--     documentos» (D23).
--   · WhatsappMessageType DOCUMENT, IMAGE, INTERACTIVE, y ATTENTION_SUMMARY en
--     WhatsappMessageKind y TelegramMessageKind: los libros de mensajes registran los
--     PDF, las imágenes y el aviso.
--   · AttentionSummaryDelivery: un envío por canal. Del destino solo quedan su
--     SHA-256 y su forma enmascarada. Se borra con el resumen (al año).
--
-- Solo agrega: ninguna fila existente cambia. Los valores nuevos de los enums no se
-- usan dentro de esta misma migración (como en las anteriores de estos enums).
-- Nada se envía hasta encender «Enviar», que en esta fase solo funciona en modo prueba.


-- AlterEnum
ALTER TYPE "WhatsappTemplateKind" ADD VALUE 'ATTENTION_SUMMARY_READY';

-- AlterEnum
ALTER TYPE "WhatsappMessageType" ADD VALUE 'DOCUMENT';
ALTER TYPE "WhatsappMessageType" ADD VALUE 'IMAGE';
ALTER TYPE "WhatsappMessageType" ADD VALUE 'INTERACTIVE';

-- AlterEnum
ALTER TYPE "WhatsappMessageKind" ADD VALUE 'ATTENTION_SUMMARY';

-- AlterEnum
ALTER TYPE "TelegramMessageKind" ADD VALUE 'ATTENTION_SUMMARY';

-- CreateTable
CREATE TABLE "AttentionSummaryDelivery" (
    "id" TEXT NOT NULL,
    "attentionSummaryId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "destinationHash" TEXT NOT NULL,
    "destinationMasked" TEXT NOT NULL,
    "destinationOrigin" TEXT,
    "status" TEXT NOT NULL,
    "statusReason" TEXT,
    "templateName" TEXT,
    "verifiedBy" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "noticeSentAt" TIMESTAMP(3),
    "documentsSentAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttentionSummaryDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttentionSummaryDelivery_attentionSummaryId_idx" ON "AttentionSummaryDelivery"("attentionSummaryId");

-- CreateIndex
CREATE INDEX "AttentionSummaryDelivery_destinationHash_createdAt_idx" ON "AttentionSummaryDelivery"("destinationHash", "createdAt");

-- AddForeignKey
ALTER TABLE "AttentionSummaryDelivery" ADD CONSTRAINT "AttentionSummaryDelivery_attentionSummaryId_fkey" FOREIGN KEY ("attentionSummaryId") REFERENCES "AttentionSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
