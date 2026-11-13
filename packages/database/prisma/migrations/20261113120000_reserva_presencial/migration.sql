-- 🏥 Reserva de agenda para la atención presencial (Configuración › Asistente
-- Virtual): qué parte de la agenda de cada médico, cada día, puede tomar el
-- asistente (WhatsApp y Telegram); el resto queda para agendar en el hospital.
-- Solo agrega una columna que nace vacía (NULL = sin reserva): ninguna clínica
-- cambia de conducta al desplegar, y ninguna otra tabla se toca.

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "botAgendaSharePercent" INTEGER;

-- Entre 10 y 100 %, o NULL.
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_botAgendaSharePercent_check" CHECK ("botAgendaSharePercent" IS NULL OR ("botAgendaSharePercent" >= 10 AND "botAgendaSharePercent" <= 100));
