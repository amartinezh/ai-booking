-- RASTREO DE PACIENTE — cierre de pendientes de producción (docs/PLAN_RASTREO_PACIENTE.md §12).
--
-- Todo es ADITIVO: no se toca ni se migra ninguna fila existente.
--
--   · SyncException.reminderCount (§12 #14): cuántos recordatorios se enviaron desde el
--     último aviso porque nadie tomó la excepción. Las filas existentes quedan en 0.
--   · HospitalMirrorConfig.agendadorRespaldoWhatsapp (§12 #14): el segundo destinatario
--     de los recordatorios. NULL = sin respaldo (el comportamiento de hoy).
--   · WhatsappTemplateKind.HIS_APPOINTMENT_CONFIRMATION (§12 #7): la plantilla con la que
--     se le confirma al paciente, fuera de la ventana de 24 h, una cita del hospital.
--
-- El estado VENCIDA (§12 #15) no necesita migración: `SyncException.status` es texto.
--
-- El valor nuevo del enum es un cambio de catálogo: no reescribe nada, y como en las
-- migraciones anteriores de este enum no se USA dentro de la misma transacción.

-- AlterEnum
ALTER TYPE "WhatsappTemplateKind" ADD VALUE 'HIS_APPOINTMENT_CONFIRMATION';

-- AlterTable
ALTER TABLE "SyncException" ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "HospitalMirrorConfig" ADD COLUMN "agendadorRespaldoWhatsapp" TEXT;
