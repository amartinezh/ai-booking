-- CreateEnum
CREATE TYPE "GlobalAuditAction" AS ENUM ('ORGANIZATION_PURGED', 'ORGANIZATION_CREATED', 'ORGANIZATION_SUSPENDED');

-- CreateTable
CREATE TABLE "GlobalAuditLog" (
    "id" TEXT NOT NULL,
    "action" "GlobalAuditAction" NOT NULL,
    "message" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "organizationId" TEXT,
    "organizationName" TEXT,
    "ipAddress" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlobalAuditLog_createdAt_idx" ON "GlobalAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "GlobalAuditLog_action_createdAt_idx" ON "GlobalAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "GlobalAuditLog_organizationId_idx" ON "GlobalAuditLog"("organizationId");
