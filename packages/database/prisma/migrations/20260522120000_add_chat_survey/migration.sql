-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('BOOKED', 'QUEUED', 'BLOCKED_INSULT', 'SYSTEM_ERROR');

-- CreateTable
CREATE TABLE "ChatSurvey" (
    "id" TEXT NOT NULL,
    "patientId" TEXT,
    "organizationId" TEXT NOT NULL,
    "chatSummary" TEXT,
    "resolutionStatus" "ResolutionStatus" NOT NULL,
    "rating" INTEGER,
    "feedback" TEXT,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatSurvey_organizationId_createdAt_idx" ON "ChatSurvey"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatSurvey_isUsed_expiresAt_idx" ON "ChatSurvey"("isUsed", "expiresAt");

-- AddForeignKey
ALTER TABLE "ChatSurvey" ADD CONSTRAINT "ChatSurvey_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSurvey" ADD CONSTRAINT "ChatSurvey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
