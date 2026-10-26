/**
 * 🔐 SESIÓN VIGENTE (2026-10-27) — la regla que comparten la web y la API.
 *
 * El token de sesión (JWT, 8 horas) se firmaba y nadie lo volvía a mirar contra la
 * base: borrar una cuenta, cambiarle el rol, suspender su clínica o ponerle una clave
 * nueva no sacaba a quien ya estaba adentro hasta que el token vencía. Ahora, en cada
 * petición, la web (`getSession`) y la API (`RolesGuard`) leen la cuenta y aplican
 * esta regla: el token vale solo si la cuenta sigue existiendo, con el mismo rol y la
 * misma clínica, la clínica activa y sin un «cerrar sesiones» posterior al ingreso.
 *
 * Pura: sin base ni reloj, para probarla.
 */

/** Lo que dura una sesión (el `maxAge` de la cookie y el `exp` del token). */
export const DURACION_SESION_SEG = 8 * 60 * 60;

export interface TokenDeSesion {
  role: string;
  organizationId?: string | null;
  /** Segundos desde 1970. Los tokens firmados antes del 2026-10-27 no lo traen. */
  iat?: number;
  exp?: number;
}

export interface CuentaDeLaSesion {
  role: string;
  organizationId: string | null;
  /** «Cerrar sesiones»: todo token emitido antes de este instante deja de valer. */
  sessionsRevokedAt: Date | null;
  /** `isActive` de su clínica; null si no tiene clínica (super administrador). */
  clinicaActiva: boolean | null;
}

export type MotivoSesionInvalida =
  | 'CUENTA_NO_EXISTE'
  | 'ROL_CAMBIO'
  | 'CLINICA_CAMBIO'
  | 'CLINICA_SUSPENDIDA'
  | 'SESIONES_CERRADAS';

/** Cuándo se emitió el token (segundos). Sin `iat`, se deduce del vencimiento. */
export function emisionDelToken(t: Pick<TokenDeSesion, 'iat' | 'exp'>): number | null {
  if (typeof t.iat === 'number') return t.iat;
  if (typeof t.exp === 'number') return t.exp - DURACION_SESION_SEG;
  return null;
}

/**
 * Por qué el token ya no vale, o null si sigue vigente. Se compara por segundos
 * (lo que guarda el token): un ingreso en el mismo segundo del «cerrar sesiones»
 * sigue valiendo, y así quien cambia su propia clave recibe un token nuevo que no
 * cae con las sesiones que acaba de cerrar.
 */
export function motivoSesionInvalida(
  token: TokenDeSesion,
  cuenta: CuentaDeLaSesion | null,
): MotivoSesionInvalida | null {
  if (!cuenta) return 'CUENTA_NO_EXISTE';
  if (cuenta.role !== token.role) return 'ROL_CAMBIO';
  if ((cuenta.organizationId ?? null) !== (token.organizationId ?? null)) return 'CLINICA_CAMBIO';
  if (cuenta.role !== 'SUPER_ADMIN' && cuenta.clinicaActiva === false) return 'CLINICA_SUSPENDIDA';
  if (cuenta.sessionsRevokedAt) {
    const emitido = emisionDelToken(token);
    const cerradas = Math.floor(cuenta.sessionsRevokedAt.getTime() / 1000);
    if (emitido === null || emitido < cerradas) return 'SESIONES_CERRADAS';
  }
  return null;
}
