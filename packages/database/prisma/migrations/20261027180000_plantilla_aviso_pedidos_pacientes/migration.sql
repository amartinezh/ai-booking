-- 🙋 Plantilla «Aviso al agendador (pedidos de pacientes)» (2026-10-27): avisa al
-- agendador por WhatsApp que un paciente pidió cancelar y no confirmó, o avisó que
-- no irá, y su cita es en 24 h o menos. Va aparte de SYNC_EXCEPTION_ALERT porque el
-- texto aprobado de esa dice que las citas no llegaron al hospital.
--
-- Solo agrega un valor al catálogo del enum: no reescribe ninguna fila. Como en las
-- migraciones anteriores de este enum, no se USA dentro de la misma transacción.

-- AlterEnum
ALTER TYPE "WhatsappTemplateKind" ADD VALUE 'PATIENT_REQUEST_ALERT';
