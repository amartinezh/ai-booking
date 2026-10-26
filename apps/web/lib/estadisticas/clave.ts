/**
 * 📊 Estadísticas para compartir: las reglas de la clave sencilla que protege la
 * página pública. Sin nada de servidor: el formulario de Configuración también
 * las usa.
 */

export const CLAVE_ESTADISTICAS = {
    MIN: 6,
    /** bcrypt solo lee 72 bytes. */
    MAX_BYTES: 72,
} as const;

/** Tope de claves equivocadas en una ventana, por dirección IP y para la clínica entera. */
export const INTENTOS_ESTADISTICAS = { POR_IP: 5, POR_CLINICA: 30, VENTANA_MIN: 15 } as const;

export const ACCESO_ESTADISTICAS = { COOKIE: 'estadisticas_acceso', DIAS: 30 } as const;

export const rutaDeEstadisticas = (organizationId: string) => `/estadisticas/${organizationId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esIdDeClinica = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** El problema de una clave nueva, o null si sirve. */
export function validarClaveEstadisticas(clave: unknown): string | null {
    if (typeof clave !== 'string' || clave.trim().length === 0) return 'Escriba la clave.';
    if (clave !== clave.trim()) return 'La clave no puede empezar ni terminar con espacios.';
    if (clave.length < CLAVE_ESTADISTICAS.MIN) return `La clave debe tener al menos ${CLAVE_ESTADISTICAS.MIN} caracteres.`;
    if (new TextEncoder().encode(clave).length > CLAVE_ESTADISTICAS.MAX_BYTES) return 'La clave es demasiado larga.';
    return null;
}
