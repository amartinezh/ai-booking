-- FASE 2 DE AVISOS MASIVOS — teléfono del acompañante como fuente secundaria
-- explícita (§3.4/J.5, §5): "rescata 4 de cada 10" pacientes sin celular
-- propio, siempre etiquetado en pantalla, nunca en silencio.
ALTER TABLE "MassNoticeRecipient" ADD COLUMN "phoneIsCompanion" BOOLEAN NOT NULL DEFAULT false;
