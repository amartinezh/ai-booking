-- ═══════════════════════════════════════════════════════════════════════════
-- ACTIVIDAD POR CANAL — gráficas de «Canales en vivo»
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Solo AÑADE: una tabla, dos enums y un índice. No cambia ningún flujo.
--
--   ChannelActivityLog        un registro por mensaje entrante (INBOUND) y por
--                             desenlace (BOOKED / MANAGE / PROBLEM); sin texto, remitente
--                             seudonimizado con HMAC.
--   InteractionLog(createdAt) consultas por rango de fechas y la purga nocturna.

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('WHATSAPP', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "ChannelActivityEvent" AS ENUM ('INBOUND', 'BOOKED', 'MANAGE', 'PROBLEM');

-- CreateTable
CREATE TABLE "ChannelActivityLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" "ChannelKind" NOT NULL,
    "event" "ChannelActivityEvent" NOT NULL,
    "senderHash" TEXT NOT NULL,
    "messageType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelActivityLog_organizationId_createdAt_idx" ON "ChannelActivityLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelActivityLog_createdAt_idx" ON "ChannelActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "InteractionLog_createdAt_idx" ON "InteractionLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ChannelActivityLog" ADD CONSTRAINT "ChannelActivityLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
