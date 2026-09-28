-- ═══════════════════════════════════════════════════════════════════════════
-- CANAL DE TELEGRAM — FASE 0 (docs/PLAN_TELEGRAM.md)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Solo AÑADE: dos tablas, tres enums, un valor de enum y dos columnas nulas.
-- No renombra, no borra y no rellena nada, así que no cambia el comportamiento
-- de WhatsApp ni de ningún otro flujo: hasta la Fase 2 nadie lee ni escribe
-- estas columnas.
--
--   TelegramBotConfig              bot, token cifrado y webhook de cada clínica (T1)
--   TelegramMessageLog             libro de mensajes salientes de Telegram (T6)
--   PatientProfile.telegramChatId  chat del paciente con el bot de la clínica
--   PatientProfile.telegramBlockedAt  el paciente bloqueó al bot → recordatorio por WhatsApp (T4)
--   AppointmentOrigin.TELEGRAM     cita agendada por Telegram; viaja al HIS
--                                  igual que WHATSAPP (el despacho solo excluye MIRROR)
--
-- `ADD VALUE` no se puede usar en la misma transacción que lo crea; esta
-- migración no lo usa.

-- CreateEnum
CREATE TYPE "TelegramMessageType" AS ENUM ('TEXT', 'VOICE');

-- CreateEnum
CREATE TYPE "TelegramMessageKind" AS ENUM ('BOT_REPLY', 'BOOKING_CONFIRMATION', 'APPOINTMENT_REMINDER', 'WAITLIST_OFFER', 'MANUAL', 'SYSTEM_NOTICE');

-- CreateEnum
CREATE TYPE "TelegramMessageStatus" AS ENUM ('ACCEPTED', 'FAILED');

-- AlterEnum
ALTER TYPE "AppointmentOrigin" ADD VALUE 'TELEGRAM';

-- AlterTable
ALTER TABLE "PatientProfile" ADD COLUMN     "telegramBlockedAt" TIMESTAMP(3),
ADD COLUMN     "telegramChatId" TEXT;

-- CreateTable
CREATE TABLE "TelegramBotConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "botId" TEXT,
    "botUsername" TEXT,
    "encryptedBotToken" TEXT,
    "webhookRouteKey" TEXT NOT NULL,
    "encryptedWebhookSecret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastWebhookSetAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramBotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramMessageLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" INTEGER,
    "messageType" "TelegramMessageType" NOT NULL,
    "kind" "TelegramMessageKind" NOT NULL,
    "appointmentId" TEXT,
    "status" "TelegramMessageStatus" NOT NULL,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBotConfig_organizationId_key" ON "TelegramBotConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBotConfig_botId_key" ON "TelegramBotConfig"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBotConfig_webhookRouteKey_key" ON "TelegramBotConfig"("webhookRouteKey");

-- CreateIndex
CREATE INDEX "TelegramMessageLog_organizationId_chatId_createdAt_idx" ON "TelegramMessageLog"("organizationId", "chatId", "createdAt");

-- CreateIndex
CREATE INDEX "TelegramMessageLog_appointmentId_idx" ON "TelegramMessageLog"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientProfile_organizationId_telegramChatId_key" ON "PatientProfile"("organizationId", "telegramChatId");

-- AddForeignKey
ALTER TABLE "TelegramBotConfig" ADD CONSTRAINT "TelegramBotConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramMessageLog" ADD CONSTRAINT "TelegramMessageLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

