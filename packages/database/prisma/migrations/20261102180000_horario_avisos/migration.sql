-- Horario de los avisos de la Bandeja a los agendadores (docs/PLAN_AVISOS_AGENDADORES.md §8).
--
--   · alertsOutsideHours: true = a cualquier hora (lo de siempre); false = solo de lunes
--     a sábado dentro del horario, nunca domingos ni festivos.
--   · alertsHoursFromMin / alertsHoursToMin: el horario laboral en minutos desde la
--     medianoche de la clínica (7:00 a 17:00 por defecto).
--
-- Solo agrega columnas con valor por defecto: toda clínica sigue avisando a cualquier
-- hora hasta que el administrador lo cambie en Bandeja › Configurar avisos.

-- AlterTable
ALTER TABLE "HospitalMirrorConfig" ADD COLUMN     "alertsHoursFromMin" INTEGER NOT NULL DEFAULT 420,
ADD COLUMN     "alertsHoursToMin" INTEGER NOT NULL DEFAULT 1020,
ADD COLUMN     "alertsOutsideHours" BOOLEAN NOT NULL DEFAULT true;
