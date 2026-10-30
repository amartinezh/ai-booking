-- Encuesta de satisfacción: dos preguntas sobre la IPS y la hora de respuesta.
--   wouldRecommend → «¿Recomendaría la IPS a familiares y amigos?» (Sí / No)
--   experience     → «¿Cómo le fue en su experiencia?» (Buena / Regular / Mala / No responde)
--   answeredAt     → cuándo respondió el paciente
-- Las encuestas anteriores quedan con las dos preguntas en NULL (no se hicieron).

CREATE TYPE "SurveyExperience" AS ENUM ('GOOD', 'FAIR', 'BAD', 'NO_ANSWER');

ALTER TABLE "ChatSurvey"
  ADD COLUMN "wouldRecommend" BOOLEAN,
  ADD COLUMN "experience" "SurveyExperience",
  ADD COLUMN "answeredAt" TIMESTAMP(3);

-- Las ya respondidas: la encuesta no se toca después de responderla, así que
-- su updatedAt es la hora de la respuesta.
UPDATE "ChatSurvey" SET "answeredAt" = "updatedAt" WHERE "isUsed" = true AND "answeredAt" IS NULL;
