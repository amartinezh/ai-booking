-- ═══════════════════════════════════════════════════════════════════════════
-- ASISTENTE DE SOPORTE: lo que respondió la IA (docs/PLAN_BOT_SOPORTE.md, Fase 2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SupportBotMessage.aiKind     qué tipo de respuesta dio la IA (respuesta,
--                              aclarar, falla…), para las cifras del panel.
-- SupportBotMessage.uncovered  la IA «respondió» sin apoyarse en el manual: es un
--                              hueco del manual (la lista «preguntas que el manual
--                              no cubrió» del panel del super admin).
--
-- Solo agrega columnas con valor por defecto: no cambia ninguna fila existente.

-- AlterTable
ALTER TABLE "SupportBotMessage" ADD COLUMN     "aiKind" TEXT,
ADD COLUMN     "uncovered" BOOLEAN NOT NULL DEFAULT false;
