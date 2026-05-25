-- Inyección dinámica de proveedores de voz por organización (Google / ElevenLabs).
-- Refactor de OrganizationAudioConfig: los campos de Google pasan a estar
-- namespaced (google*) y se agregan proveedor activo, género y credenciales
-- de ElevenLabs. La API key de ElevenLabs se guarda ENCRIPTADA (AES-256-GCM)
-- desde la capa de servicio; en BD es texto cifrado.

-- CreateEnum
CREATE TYPE "VoiceProvider" AS ENUM ('GOOGLE', 'ELEVENLABS');

-- CreateEnum
CREATE TYPE "VoiceGender" AS ENUM ('MASCULINO', 'FEMENINO');

-- Los CHECK de rango referencian las columnas antiguas: hay que soltarlos antes
-- de renombrar y volverlos a crear contra las nuevas columnas google*.
ALTER TABLE "OrganizationAudioConfig"
    DROP CONSTRAINT IF EXISTS "OrganizationAudioConfig_pitch_range_check";
ALTER TABLE "OrganizationAudioConfig"
    DROP CONSTRAINT IF EXISTS "OrganizationAudioConfig_speakingRate_range_check";

-- RenameColumn (preserva los datos existentes de cada clínica)
ALTER TABLE "OrganizationAudioConfig" RENAME COLUMN "pitch" TO "googlePitch";
ALTER TABLE "OrganizationAudioConfig" RENAME COLUMN "speakingRate" TO "googleSpeakingRate";
ALTER TABLE "OrganizationAudioConfig" RENAME COLUMN "voiceId" TO "googleVoiceId";

-- AddColumn
ALTER TABLE "OrganizationAudioConfig"
    ADD COLUMN "activeProvider" "VoiceProvider" NOT NULL DEFAULT 'GOOGLE',
    ADD COLUMN "gender" "VoiceGender" NOT NULL DEFAULT 'FEMENINO',
    ADD COLUMN "elevenLabsApiKey" TEXT,
    ADD COLUMN "elevenLabsVoiceId" TEXT;

-- Re-crea los CHECK de rango contra las columnas renombradas (defense in depth).
-- googlePitch: -20.0 .. 20.0 semitones | googleSpeakingRate: 0.25x .. 4.0x
ALTER TABLE "OrganizationAudioConfig"
    ADD CONSTRAINT "OrganizationAudioConfig_googlePitch_range_check"
    CHECK ("googlePitch" >= -20.0 AND "googlePitch" <= 20.0);

ALTER TABLE "OrganizationAudioConfig"
    ADD CONSTRAINT "OrganizationAudioConfig_googleSpeakingRate_range_check"
    CHECK ("googleSpeakingRate" >= 0.25 AND "googleSpeakingRate" <= 4.0);
