-- 🗓️ Plazo máximo para agendar por el asistente (Configuración › Asistente
-- Virtual): hasta cuántos días adelante, contando hoy, ofrece citas.
-- Solo agrega una columna que nace vacía (NULL = sin límite): ninguna clínica
-- cambia de conducta al desplegar, y ninguna otra tabla se toca.

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "bookingMaxDaysAhead" INTEGER;

-- Entre 1 y 365 días, o NULL.
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_bookingMaxDaysAhead_check" CHECK ("bookingMaxDaysAhead" IS NULL OR ("bookingMaxDaysAhead" >= 1 AND "bookingMaxDaysAhead" <= 365));
