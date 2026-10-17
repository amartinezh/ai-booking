-- Anticipación mínima del recordatorio automático (2026-10-17). Default 60
-- minutos: las clínicas existentes dejan de recordar citas que empiezan en
-- menos de una hora (el caso que lo motivó). 0 = sin mínimo.
ALTER TABLE "OrganizationSettings" ADD COLUMN "reminderMinLeadMinutes" INTEGER NOT NULL DEFAULT 60;
