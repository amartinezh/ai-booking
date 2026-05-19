-- CreateTable
CREATE TABLE "WhatsappAccountConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneNumberId" TEXT,
    "businessAccountId" TEXT,
    "displayPhoneNumber" TEXT,
    "verifyToken" TEXT,
    "encryptedAccessToken" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappAccountConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappAccountConfig_organizationId_key" ON "WhatsappAccountConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappAccountConfig_phoneNumberId_key" ON "WhatsappAccountConfig"("phoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappAccountConfig_verifyToken_key" ON "WhatsappAccountConfig"("verifyToken");

-- AddForeignKey
ALTER TABLE "WhatsappAccountConfig" ADD CONSTRAINT "WhatsappAccountConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: migrar phoneNumberId existente desde Organization.whatsappPhoneId
-- antes de eliminar la columna, para no perder configuraciones previas.
INSERT INTO "WhatsappAccountConfig" (
    "id", "organizationId", "phoneNumberId", "isActive", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    "id",
    "whatsappPhoneId",
    TRUE,
    NOW(),
    NOW()
FROM "Organization"
WHERE "whatsappPhoneId" IS NOT NULL;

-- DropIndex
DROP INDEX IF EXISTS "Organization_whatsappPhoneId_key";

-- AlterTable: ya migrada la data, eliminamos la columna duplicada.
ALTER TABLE "Organization" DROP COLUMN "whatsappPhoneId";
