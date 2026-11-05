-- 📢 Mensajes masivos (docs/PLAN_MENSAJES_MASIVOS.md): comunicados de la clínica por
-- WhatsApp a una lista de contactos o a sus pacientes. Solo agrega: dos tipos de
-- plantilla (comunicado sin imagen y con imagen), un tipo en el libro de mensajes y
-- cinco tablas nuevas (listas, contactos, envíos, destinatarios y bajas). Ninguna
-- tabla existente cambia; nada se envía hasta que un administrador lo confirme.

ALTER TYPE "WhatsappTemplateKind" ADD VALUE 'MASS_MESSAGE_TEXT';
ALTER TYPE "WhatsappTemplateKind" ADD VALUE 'MASS_MESSAGE_IMAGE';

-- AlterEnum
ALTER TYPE "WhatsappMessageKind" ADD VALUE 'MASS_MESSAGE';

-- CreateTable
CREATE TABLE "MassContactList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ARCHIVO',
    "consentNote" TEXT NOT NULL,
    "consentAttestedAt" TIMESTAMP(3) NOT NULL,
    "consentAttestedBy" TEXT NOT NULL,
    "contactsCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MassContactList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MassContact" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT,
    "firstName" TEXT,
    "phoneE164" TEXT NOT NULL,
    "email" TEXT,
    "document" TEXT,
    "extra" JSONB,
    "patientProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MassContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MassCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BORRADOR',
    "messageText" TEXT NOT NULL DEFAULT '',
    "imageData" BYTEA,
    "imageMime" TEXT,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "imageBytes" INTEGER,
    "imageMediaId" TEXT,
    "imageMediaUploadedAt" TIMESTAMP(3),
    "textReview" JSONB,
    "imageReview" JSONB,
    "templateKind" TEXT,
    "templateName" TEXT,
    "ratePerMinute" INTEGER NOT NULL DEFAULT 60,
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdByEmail" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedByEmail" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MassCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MassCampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT,
    "name" TEXT,
    "phoneE164" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "skipReason" TEXT,
    "error" TEXT,
    "errorCode" TEXT,
    "wamid" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "MassCampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MassMessageOptOut" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CHAT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MassMessageOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MassContactList_organizationId_createdAt_idx" ON "MassContactList"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MassContactList_organizationId_name_key" ON "MassContactList"("organizationId", "name");

-- CreateIndex
CREATE INDEX "MassContact_organizationId_phoneE164_idx" ON "MassContact"("organizationId", "phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "MassContact_listId_phoneE164_key" ON "MassContact"("listId", "phoneE164");

-- CreateIndex
CREATE INDEX "MassCampaign_organizationId_createdAt_idx" ON "MassCampaign"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "MassCampaign_status_lockedUntil_idx" ON "MassCampaign"("status", "lockedUntil");

-- CreateIndex
CREATE INDEX "MassCampaignRecipient_campaignId_outcome_idx" ON "MassCampaignRecipient"("campaignId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "MassCampaignRecipient_campaignId_phoneE164_key" ON "MassCampaignRecipient"("campaignId", "phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "MassMessageOptOut_organizationId_destination_key" ON "MassMessageOptOut"("organizationId", "destination");

-- AddForeignKey
ALTER TABLE "MassContactList" ADD CONSTRAINT "MassContactList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MassContact" ADD CONSTRAINT "MassContact_listId_fkey" FOREIGN KEY ("listId") REFERENCES "MassContactList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MassCampaign" ADD CONSTRAINT "MassCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MassCampaign" ADD CONSTRAINT "MassCampaign_listId_fkey" FOREIGN KEY ("listId") REFERENCES "MassContactList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MassCampaignRecipient" ADD CONSTRAINT "MassCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MassCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MassMessageOptOut" ADD CONSTRAINT "MassMessageOptOut_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
