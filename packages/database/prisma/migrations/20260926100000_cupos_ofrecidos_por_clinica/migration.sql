-- ═══════════════════════════════════════════════════════════════════════════
-- CUÁNTOS CUPOS OFRECE EL BOT, POR CLÍNICA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El bot ofrecía los 10 cupos más próximos. Con la agenda llena caían todos
-- en la misma mañana. Ahora ofrece `slotsOfferedCount` (default 6), mitad
-- mañana y mitad tarde; lo configura el administrador de la clínica.
--
-- El DEFAULT rellena las filas existentes: ninguna clínica queda sin valor.

ALTER TABLE "OrganizationSettings"
  ADD COLUMN "slotsOfferedCount" INTEGER NOT NULL DEFAULT 6;
