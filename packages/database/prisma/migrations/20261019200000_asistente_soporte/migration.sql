-- ═══════════════════════════════════════════════════════════════════════════
-- ASISTENTE DE SOPORTE POR TELEGRAM (docs/PLAN_BOT_SOPORTE.md, Fase 0)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SupportBotConfig        la configuración del bot de soporte: UNA fila
--                         (id = 'global'), solo del SUPER_ADMIN. Nace APAGADA.
-- SupportBotCode          el código de un solo uso que abre UNA conversación.
-- SupportBotConversation  una conversación verificada con un empleado.
-- SupportBotMessage       sus mensajes (180 días).
-- SupportBotPreference    si el empleado quiere los avisos de sus casos.
-- SupportTicketNote       lo que se le agrega a un caso ya abierto.
-- SupportTicket           + número corto, canal, prioridad, el aviso al grupo y el
--                         seguimiento a quien lo reportó.
-- GlobalAuditAction       + SUPPORT_BOT_CONFIG_CHANGED.
--
-- No cambia ninguna conducta al desplegar: nada lee ni escribe estas tablas ni
-- columnas todavía. Los casos que ya existen se numeran por fecha de creación y
-- quedan marcados para que el asistente NO los anuncie al grupo ni le mande al
-- empleado avisos de estados viejos.
--
-- Los índices únicos PARCIALES «a lo sumo una conversación abierta por usuario y
-- por cuenta de Telegram» no están aquí: Prisma no sabe expresarlos y viven en
-- prisma/sql/non-prisma-ddl.sql, que se aplica después de `migrate deploy`
-- (`db:deploy`).

-- CreateEnum
CREATE TYPE "SupportTicketChannel" AS ENUM ('PANEL', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "SupportTicketPriority" AS ENUM ('NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "SupportTicketNoticeState" AS ENUM ('PENDING', 'SENT', 'SKIPPED');

-- AlterEnum
ALTER TYPE "GlobalAuditAction" ADD VALUE 'SUPPORT_BOT_CONFIG_CHANGED';

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "channel" "SupportTicketChannel" NOT NULL DEFAULT 'PANEL',
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "groupNotice" "SupportTicketNoticeState" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "groupNoticeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "groupNoticeError" TEXT,
ADD COLUMN     "groupNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "number" SERIAL NOT NULL,
ADD COLUMN     "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "reopenedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reporterNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "reporterNotifiedStatus" "SupportTicketStatus",
ADD COLUMN     "unattendedRemindedAt" TIMESTAMP(3);

-- Los casos que ya existían: SERIAL los numeró en el orden físico de la tabla; se
-- renumeran por fecha de creación (el índice único del número se crea más abajo) y
-- la secuencia sigue desde el último.
WITH "numerados" AS (
    SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS "n"
    FROM "SupportTicket"
)
UPDATE "SupportTicket" AS t
SET "number" = "numerados"."n"
FROM "numerados"
WHERE t."id" = "numerados"."id";

SELECT setval(
    pg_get_serial_sequence('"SupportTicket"', 'number'),
    COALESCE((SELECT MAX("number") FROM "SupportTicket"), 0) + 1,
    false
);

-- Ni aviso al grupo ni avisos de estado para los casos de antes del asistente.
UPDATE "SupportTicket"
SET "groupNotice" = 'SKIPPED',
    "reporterNotifiedStatus" = "status";

-- CreateTable
CREATE TABLE "SupportTicketNote" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "channel" "SupportTicketChannel" NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportBotConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "encryptedBotToken" TEXT,
    "botId" TEXT,
    "botUsername" TEXT,
    "routeKey" TEXT,
    "encryptedWebhookSecret" TEXT,
    "teamDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "teamFromHour" INTEGER NOT NULL DEFAULT 8,
    "teamToHour" INTEGER NOT NULL DEFAULT 17,
    "teamTimeZone" TEXT NOT NULL DEFAULT 'America/Bogota',
    "conversationIdleMinutes" INTEGER NOT NULL DEFAULT 30,
    "maxMessagesPerHour" INTEGER NOT NULL DEFAULT 40,
    "maxMessageChars" INTEGER NOT NULL DEFAULT 2000,
    "maxAiTurnsPerOrgPerDay" INTEGER NOT NULL DEFAULT 300,
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "updatedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportBotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportBotCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHmac" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "testOrganizationId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportBotCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportBotConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "telegramName" TEXT,
    "verifiedBy" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "flowState" JSONB,
    "feedback" TEXT,
    "hadUncoveredQuestion" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SupportBotConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportBotMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT,
    "aiProvider" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "telegramUpdateId" TEXT,
    "telegramMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportBotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportBotPreference" (
    "userId" TEXT NOT NULL,
    "ticketNotices" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportBotPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "SupportTicketNote_ticketId_createdAt_idx" ON "SupportTicketNote"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportBotConfig_routeKey_key" ON "SupportBotConfig"("routeKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupportBotCode_codeHmac_key" ON "SupportBotCode"("codeHmac");

-- CreateIndex
CREATE INDEX "SupportBotCode_userId_idx" ON "SupportBotCode"("userId");

-- CreateIndex
CREATE INDEX "SupportBotCode_expiresAt_idx" ON "SupportBotCode"("expiresAt");

-- CreateIndex
CREATE INDEX "SupportBotConversation_userId_startedAt_idx" ON "SupportBotConversation"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "SupportBotConversation_telegramUserId_startedAt_idx" ON "SupportBotConversation"("telegramUserId", "startedAt");

-- CreateIndex
CREATE INDEX "SupportBotConversation_organizationId_startedAt_idx" ON "SupportBotConversation"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportBotMessage_telegramUpdateId_key" ON "SupportBotMessage"("telegramUpdateId");

-- CreateIndex
CREATE INDEX "SupportBotMessage_conversationId_createdAt_idx" ON "SupportBotMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportBotMessage_createdAt_idx" ON "SupportBotMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_number_key" ON "SupportTicket"("number");

-- CreateIndex
CREATE INDEX "SupportTicket_groupNotice_createdAt_idx" ON "SupportTicket"("groupNotice", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportBotConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketNote" ADD CONSTRAINT "SupportTicketNote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketNote" ADD CONSTRAINT "SupportTicketNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportBotCode" ADD CONSTRAINT "SupportBotCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportBotConversation" ADD CONSTRAINT "SupportBotConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportBotConversation" ADD CONSTRAINT "SupportBotConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportBotMessage" ADD CONSTRAINT "SupportBotMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportBotConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportBotPreference" ADD CONSTRAINT "SupportBotPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

