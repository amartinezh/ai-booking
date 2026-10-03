-- ═══════════════════════════════════════════════════════════════════════════
-- INTERRUPTOR DE LAS OPERACIONES DEL BOT, POR CLÍNICA («solo consultas»)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Cada clínica puede apagar desde /dashboard/configuracion la posibilidad de
-- agendar, cancelar y cambiar citas por el bot (WhatsApp y Telegram). Apagado,
-- el paciente solo puede consultar sus citas y a cualquier otra operación el
-- bot le responde que se comunique con el hospital. Se lee en cada mensaje
-- (efecto inmediato, sin reiniciar).
--
-- DEFAULT true: las clínicas existentes siguen igual que antes.

ALTER TABLE "OrganizationSettings"
  ADD COLUMN "bookingEnabled" BOOLEAN NOT NULL DEFAULT true;
