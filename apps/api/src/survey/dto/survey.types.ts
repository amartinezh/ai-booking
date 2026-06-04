import { ResolutionStatus } from '@agenia/database';

// Datos que el ChatbotService entrega al generar el token de encuesta.
export interface GenerateSurveyInput {
  // null cuando el paciente nunca llegó a identificarse (insulto/error temprano).
  patientId: string | null;
  organizationId: string;
  resolutionStatus: ResolutionStatus;
  // Resumen corto de lo que se intentó en el chat (para contexto del staff).
  chatSummary?: string | null;
}

// Cuerpo del POST /surveys/:id que envía el frontend.
export interface SubmitSurveyInput {
  rating: number; // 1..5
  feedback?: string | null;
}

// Proyección segura del estado de una encuesta para el gate del frontend.
// NO expone datos sensibles del paciente; sólo lo necesario para renderizar.
export interface SurveyPublicView {
  id: string;
  resolutionStatus: ResolutionStatus;
  chatSummary: string | null;
  organizationName: string;
}
