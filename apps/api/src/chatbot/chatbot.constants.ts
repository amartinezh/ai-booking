export enum ChatState {
    IDLE = 'IDLE',                       // Recién saluda
    AWAITING_CEDULA = 'AWAITING_CEDULA', // Le pedimos la cédula
    AWAITING_SPECIALTY = 'AWAITING_SPECIALTY', // Le pedimos especialidad (Medicina General, Odontología)
    AWAITING_DATE = 'AWAITING_DATE',     // Le mostramos fechas y esperamos selección
    AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
}

// Tiempo de expiración de la sesión en Redis (1 hora en segundos)
export const SESSION_TTL = 3600;