-- ═══════════════════════════════════════════════════════════════════════════
-- CANAL DE TELEGRAM — el chat del paciente deja de ser único por clínica
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La Fase 0 (20260928100000_canal_telegram) creó una llave ÚNICA sobre
-- (organizationId, telegramChatId). Es un error: una madre que agenda desde su
-- Telegram para ella y para su hijo deja el MISMO chat en dos fichas, igual que
-- un celular compartido en `whatsappId`. Con la llave única la segunda ficha no
-- se podía crear y la cita no se reservaba.
--
-- Se cambia por un índice normal (las búsquedas por chat siguen siendo rápidas).
-- Nadie escribía la columna todavía, así que no hay datos que migrar.

-- DropIndex
DROP INDEX "PatientProfile_organizationId_telegramChatId_key";

-- CreateIndex
CREATE INDEX "PatientProfile_organizationId_telegramChatId_idx" ON "PatientProfile"("organizationId", "telegramChatId");

