-- Resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md), Fase 4, segunda parte:
-- Telegram y la baja escrita.
--
--   · TelegramMessageType DOCUMENT y PHOTO: el libro de mensajes de Telegram registra
--     los PDF y las imágenes de cada hoja.
--   · AttentionSummaryOptOut: «no quiero resúmenes» de un número que AgenIA no tiene
--     en una ficha. Del número solo queda su SHA-256.
--
-- Solo agrega: ninguna fila existente cambia. Los valores nuevos del enum no se usan
-- dentro de esta misma migración.

-- AlterEnum
ALTER TYPE "TelegramMessageType" ADD VALUE 'DOCUMENT';
ALTER TYPE "TelegramMessageType" ADD VALUE 'PHOTO';

-- CreateTable
CREATE TABLE "AttentionSummaryOptOut" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "destinationHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttentionSummaryOptOut_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "AttentionSummaryOptOut_organizationId_destinationHash_key" ON "AttentionSummaryOptOut"("organizationId", "destinationHash");


-- AddForeignKey
ALTER TABLE "AttentionSummaryOptOut" ADD CONSTRAINT "AttentionSummaryOptOut_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

