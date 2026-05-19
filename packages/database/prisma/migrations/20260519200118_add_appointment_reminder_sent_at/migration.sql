-- AlterTable: agrega columna de idempotencia para el cron de recordatorios.
-- NULL = nunca enviado. DateTime = enviado con éxito en ese instante UTC.
ALTER TABLE "Appointment" ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- Índice parcial para acelerar el barrido del cron, que busca solo citas
-- SCHEDULED sin recordatorio enviado dentro de una ventana de tiempo.
CREATE INDEX "Appointment_reminder_lookup_idx"
    ON "Appointment" ("status", "reminderSentAt")
    WHERE "reminderSentAt" IS NULL;
