-- Asistente de soporte por Telegram, Fase 6 (docs/PLAN_BOT_SOPORTE.md §17): el
-- piloto. Encendido, solo las personas de "pilotUserIds" ven la tarjeta de Soporte,
-- piden el código y conversan con el asistente.
--
-- Nace ENCENDIDO y vacío, también en una instalación que ya tuviera la fila: abrir
-- el asistente a todo el personal es una decisión del super admin (en «Asistente
-- de soporte»), no un efecto de desplegar.

-- AlterTable
ALTER TABLE "SupportBotConfig" ADD COLUMN     "pilotOnly" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pilotUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
