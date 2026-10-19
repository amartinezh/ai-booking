-- ═══════════════════════════════════════════════════════════════════════════
-- ALERTAS TÉCNICAS POR TELEGRAM (docs/PLAN_ALERTAS_TECNICAS.md, Fase 0)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TechAlertConfig   la configuración del canal con el equipo técnico: UNA fila
--                   (id = 'global'), solo del SUPER_ADMIN. Nace APAGADA.
-- TechAlert         un problema técnico (o un evento suelto) y el estado de su
--                   aviso al grupo de Telegram.
-- GlobalAuditAction + TECH_ALERTS_CONFIG_CHANGED, para auditar los cambios de la
--                   configuración.
--
-- No cambia ninguna conducta al desplegar: nada lee ni escribe estas tablas
-- todavía, y la fila de configuración no existe hasta que el super admin conecte
-- el bot.
--
-- El índice único PARCIAL «un solo problema abierto por clave» no está aquí:
-- Prisma no sabe expresarlo y vive en prisma/sql/non-prisma-ddl.sql, que se
-- aplica después de `migrate deploy` (`db:deploy`).

-- AlterEnum
ALTER TYPE "GlobalAuditAction" ADD VALUE 'TECH_ALERTS_CONFIG_CHANGED';

-- CreateTable
CREATE TABLE "TechAlertConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "encryptedBotToken" TEXT,
    "botId" TEXT,
    "botUsername" TEXT,
    "chatId" TEXT,
    "chatTitle" TEXT,
    "linkCode" TEXT,
    "linkCodeExpiresAt" TIMESTAMP(3),
    "mutedUntil" TIMESTAMP(3),
    "categories" JSONB,
    "reminderMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxReminders" INTEGER NOT NULL DEFAULT 3,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietFromHour" INTEGER NOT NULL DEFAULT 22,
    "quietToHour" INTEGER NOT NULL DEFAULT 6,
    "dailySummaryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastDailySummaryAt" TIMESTAMP(3),
    "panelBaseUrl" TEXT,
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "updatedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechAlertConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechAlert" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABIERTA',
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "organizationId" TEXT,
    "organizationName" TEXT,
    "serviceIncidentId" TEXT,
    "meta" JSONB,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "notifiedSeverity" TEXT,
    "resolutionNotifiedAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "sendAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastSendAttemptAt" TIMESTAMP(3),
    "lastSendError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechAlert_firstSeenAt_idx" ON "TechAlert"("firstSeenAt");

-- CreateIndex
CREATE INDEX "TechAlert_status_notifiedAt_idx" ON "TechAlert"("status", "notifiedAt");

-- CreateIndex
CREATE INDEX "TechAlert_dedupeKey_firstSeenAt_idx" ON "TechAlert"("dedupeKey", "firstSeenAt");

