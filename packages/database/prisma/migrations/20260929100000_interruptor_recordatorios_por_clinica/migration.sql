-- ═══════════════════════════════════════════════════════════════════════════
-- INTERRUPTOR DE LOS RECORDATORIOS AUTOMÁTICOS, POR CLÍNICA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El cron de recordatorios no tenía forma de apagarse: enviaba a toda cita
-- programada, incluidas las que llegan del HIS por el alta en caliente. Ahora
-- cada clínica lo prende o apaga desde /dashboard/configuracion y el cron lo
-- consulta en cada vuelta (efecto inmediato, sin reiniciar).
--
-- DEFAULT true: las clínicas existentes siguen igual que antes.

ALTER TABLE "OrganizationSettings"
  ADD COLUMN "remindersEnabled" BOOLEAN NOT NULL DEFAULT true;
