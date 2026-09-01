-- Un cupo puede acumular citas canceladas; vigente, solo una.
--
-- El @unique global de `scheduleSlotId` dejaba invendible para siempre
-- cualquier cupo cuya cita se hubiera cancelado: la fila cancelada seguía
-- ocupando la llave. El índice único PARCIAL que lo sustituye vive en
-- prisma/sql/non-prisma-ddl.sql (Prisma no sabe expresarlo) y lo aplica
-- `pnpm run db:apply-sql`, que corre justo después de esta migración.
DROP INDEX IF EXISTS "Appointment_scheduleSlotId_key";

CREATE INDEX IF NOT EXISTS "Appointment_scheduleSlotId_idx"
  ON "Appointment" ("scheduleSlotId");
