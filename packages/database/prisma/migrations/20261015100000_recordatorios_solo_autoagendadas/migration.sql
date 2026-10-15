-- ═══════════════════════════════════════════════════════════════════════════
-- RECORDATORIOS SOLO A LAS CITAS QUE EL PACIENTE AGENDÓ POR EL CHAT, POR CLÍNICA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Encendido, el cron de recordatorios automáticos solo considera las citas de
-- origen WHATSAPP o TELEGRAM (las que el paciente se agendó con el bot); las
-- del panel (MANUAL) y las del hospital (MIRROR) no reciben el recordatorio
-- automático. Se edita en /dashboard/configuracion.
--
-- Nace APAGADO en todas las clínicas: nada cambia al desplegar.

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "remindersOnlySelfBooked" BOOLEAN NOT NULL DEFAULT false;
