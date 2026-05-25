-- AlterEnum
-- Nuevo valor para la encuesta CSAT cuando el flujo principal cerró por una
-- cancelación de cita exitosa (ver ChatbotService → AWAITING_POST_CANCEL_CHOICE).
ALTER TYPE "ResolutionStatus" ADD VALUE 'CANCELLED';
