-- CreateEnum
CREATE TYPE "AudioEncoding" AS ENUM ('OGG_OPUS', 'MP3', 'LINEAR16');

-- CreateTable
CREATE TABLE "OrganizationAudioConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "audioEncoding" "AudioEncoding" NOT NULL DEFAULT 'OGG_OPUS',
    "pitch" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "speakingRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "voiceId" TEXT NOT NULL DEFAULT 'es-US-Neural2-A',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationAudioConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationAudioConfig_organizationId_key" ON "OrganizationAudioConfig"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationAudioConfig_organizationId_idx" ON "OrganizationAudioConfig"("organizationId");

-- AddForeignKey
ALTER TABLE "OrganizationAudioConfig" ADD CONSTRAINT "OrganizationAudioConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce valid Google Cloud TTS ranges at the database level (defense in depth).
-- pitch: -20.0 .. 20.0 semitones | speakingRate: 0.25x .. 4.0x
ALTER TABLE "OrganizationAudioConfig"
    ADD CONSTRAINT "OrganizationAudioConfig_pitch_range_check"
    CHECK ("pitch" >= -20.0 AND "pitch" <= 20.0);

ALTER TABLE "OrganizationAudioConfig"
    ADD CONSTRAINT "OrganizationAudioConfig_speakingRate_range_check"
    CHECK ("speakingRate" >= 0.25 AND "speakingRate" <= 4.0);
