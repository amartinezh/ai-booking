/**
 * 🔑 CAMBIAR MI CLAVE (2026-10-22) — la regla de una clave nueva, pura para
 * poder probarla sin base ni sesión.
 *
 * Nació con los primeros agendadores del hospital: su clave inicial les llega
 * por correo, que no es un canal seguro, y hasta ahora nadie podía cambiar la
 * suya sin pedírselo a un administrador.
 *
 * La clave se guarda con bcrypt, que solo mira los primeros 72 BYTES: una más
 * larga se cortaría en silencio y dos claves distintas valdrían igual. Por eso
 * el tope se mide en bytes (una tilde ocupa dos), no en caracteres.
 */

export const CLAVE = {
    MIN: 10,
    MAX_BYTES: 72,
} as const;

/**
 * Tope de intentos con la clave actual equivocada al cambiarla: quien encuentra
 * una sesión abierta ajena no puede ponerse a adivinar la clave. Se cuentan en la
 * bitácora del sistema (`PASSWORD_CHANGE_FAILED`), así valen aunque la web se
 * reinicie. Vive aquí y no en la acción: un archivo 'use server' solo puede
 * exportar funciones async.
 */
export const INTENTOS_CLAVE = { MAX: 5, VENTANA_MIN: 15 } as const;

export interface CambioDeClave {
    actual: string;
    nueva: string;
    confirmacion: string;
    /** El correo de quien cambia: la clave nueva no lo puede contener. */
    email: string;
}

/** Cuántos bytes ocupa el texto en UTF-8 (lo que mira bcrypt). */
function bytesUtf8(texto: string): number {
    let n = 0;
    for (const c of texto) {
        const cp = c.codePointAt(0) ?? 0;
        n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    }
    return n;
}

/** El primer problema de la clave nueva, en palabras del usuario; null si está bien. */
export function validarCambioDeClave(d: CambioDeClave): string | null {
    const actual = typeof d.actual === 'string' ? d.actual : '';
    const nueva = typeof d.nueva === 'string' ? d.nueva : '';
    const confirmacion = typeof d.confirmacion === 'string' ? d.confirmacion : '';

    if (!actual) return 'Escriba su clave actual.';
    if (!nueva) return 'Escriba la clave nueva.';
    if (nueva !== nueva.trim()) return 'La clave nueva no puede empezar ni terminar con un espacio.';
    if (nueva.length < CLAVE.MIN) return `La clave nueva debe tener al menos ${CLAVE.MIN} caracteres.`;
    if (bytesUtf8(nueva) > CLAVE.MAX_BYTES) {
        return 'La clave nueva es demasiado larga: use una más corta.';
    }
    if (!/\p{L}/u.test(nueva) || !/\d/.test(nueva)) {
        return 'La clave nueva debe tener letras y números.';
    }
    if (nueva === actual) return 'La clave nueva debe ser distinta de la actual.';
    const usuario = (d.email ?? '').split('@')[0].toLowerCase();
    if (usuario.length >= 4 && nueva.toLowerCase().includes(usuario)) {
        return 'La clave nueva no puede contener su usuario.';
    }
    if (nueva !== confirmacion) return 'La confirmación no coincide con la clave nueva.';
    return null;
}
