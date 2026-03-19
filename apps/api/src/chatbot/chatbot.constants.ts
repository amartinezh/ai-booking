export enum ChatState {
  IDLE = 'IDLE', // Recién saluda
  AWAITING_SPECIALTY = 'AWAITING_SPECIALTY', // Qué servicio busca
  AWAITING_EPS = 'AWAITING_EPS', // Filtro de triage administrativo
  AWAITING_DATE = 'AWAITING_DATE', // Muestra fechas cruzadas
  AWAITING_NAME = 'AWAITING_NAME', // Nombre del paciente
  AWAITING_CEDULA = 'AWAITING_CEDULA', // Cédula del paciente
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  AWAITING_CANCEL_CEDULA = 'AWAITING_CANCEL_CEDULA',
  AWAITING_CANCEL_SELECTION = 'AWAITING_CANCEL_SELECTION',
  AWAITING_CANCEL_CONFIRM = 'AWAITING_CANCEL_CONFIRM',
}

// Tiempo de expiración de la sesión en Redis (1 hora en segundos)
export const SESSION_TTL = 3600;
