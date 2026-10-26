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

/**
 * Claves que estuvieron escritas en el código, la documentación o el historial
 * como clave por defecto: cualquiera que las lea entra. No se aceptan nunca
 * (también las revisa `agenia superadmin revisar-claves`, en apps/web/scripts).
 */
export const CLAVES_DE_FABRICA = ['admin123', 'temporal123', 'password123', 'agenia123', 'superadmin123'] as const;

function esDeFabrica(clave: string): boolean {
    return (CLAVES_DE_FABRICA as readonly string[]).includes(clave.toLowerCase());
}

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
    if (esDeFabrica(nueva)) return 'Esa clave es de las que vienen de fábrica y cualquiera la conoce: elija otra.';
    if (nueva === actual) return 'La clave nueva debe ser distinta de la actual.';
    const usuario = (d.email ?? '').split('@')[0].toLowerCase();
    if (usuario.length >= 4 && nueva.toLowerCase().includes(usuario)) {
        return 'La clave nueva no puede contener su usuario.';
    }
    if (nueva !== confirmacion) return 'La confirmación no coincide con la clave nueva.';
    return null;
}

/**
 * La regla de una clave que otra persona le pone a una cuenta (el administrador
 * al crear o editar un usuario, el super administrador al crear un administrador
 * de clínica): las mismas exigencias que «Cambiar mi clave», sin la clave actual
 * ni la confirmación. Antes se aceptaba cualquiera y, vacía, se ponía
 * `temporal123` o `admin123`, que estaban escritas en el código (2026-10-26).
 */
export function validarClaveAsignada(clave: unknown, email: string): string | null {
    const c = typeof clave === 'string' ? clave : '';
    if (!c) return 'Escriba una contraseña para la cuenta.';
    if (c !== c.trim()) return 'La contraseña no puede empezar ni terminar con un espacio.';
    if (c.length < CLAVE.MIN) return `La contraseña debe tener al menos ${CLAVE.MIN} caracteres.`;
    if (bytesUtf8(c) > CLAVE.MAX_BYTES) return 'La contraseña es demasiado larga: use una más corta.';
    if (!/\p{L}/u.test(c) || !/\d/.test(c)) return 'La contraseña debe tener letras y números.';
    if (esDeFabrica(c)) return 'Esa contraseña es de las que vienen de fábrica y cualquiera la conoce: elija otra.';
    const usuario = (email ?? '').split('@')[0].toLowerCase();
    if (usuario.length >= 4 && c.toLowerCase().includes(usuario)) {
        return 'La contraseña no puede contener el usuario del correo.';
    }
    return null;
}
