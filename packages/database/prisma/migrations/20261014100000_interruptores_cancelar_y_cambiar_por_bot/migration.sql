-- ═══════════════════════════════════════════════════════════════════════════
-- INTERRUPTORES DE CANCELAR Y DE CAMBIAR LA FECHA POR EL BOT, POR CLÍNICA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hasta ahora `bookingEnabled` apagaba a la vez agendar, cancelar y cambiar
-- citas por el bot (WhatsApp y Telegram). Desde aquí cada operación tiene su
-- interruptor en /dashboard/configuracion y `bookingEnabled` queda solo para
-- agendar citas nuevas (y la lista de espera).
--
-- Las columnas nuevas nacen con el valor que hoy tiene `bookingEnabled` en
-- cada clínica: quien tenía las operaciones apagadas («solo consultas») las
-- sigue teniendo apagadas, y quien las tenía prendidas, prendidas. Nada cambia
-- al desplegar. DEFAULT true para las clínicas nuevas, igual que agendar.

ALTER TABLE "OrganizationSettings"
  ADD COLUMN "cancelEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "rescheduleEnabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "OrganizationSettings"
   SET "cancelEnabled" = "bookingEnabled",
       "rescheduleEnabled" = "bookingEnabled";
