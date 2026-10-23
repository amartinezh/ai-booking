-- 🏥 Plantilla «Cita cancelada por el hospital» (2026-10-22): el aviso al paciente
-- cuando el hospital cancela en su sistema una cita que agendó con el asistente y
-- ya pasaron más de 24 h desde su último mensaje (dentro de ese plazo sale como
-- texto libre y no necesita plantilla).
--
-- Solo agrega un valor al catálogo del enum: no reescribe ninguna fila. Como en las
-- migraciones anteriores de este enum, no se USA dentro de la misma transacción.

-- AlterEnum
ALTER TYPE "WhatsappTemplateKind" ADD VALUE 'HIS_APPOINTMENT_CANCELLED';
