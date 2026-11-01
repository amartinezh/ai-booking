'use server';

// ─────────────────────────────────────────────────────────────
// Página del resumen para el paciente (/resumen/<token>, plan §3.5, Fase 2).
// La API verifica la fecha de nacimiento (5 intentos, bloqueo de 1 hora) y da
// un acceso firmado de 30 minutos, que queda en una cookie solo para ESE enlace.
// ─────────────────────────────────────────────────────────────

import { cookies } from 'next/headers';
import { COOKIE_ACCESO_RESUMEN, TOKEN_RESUMEN, llamarApiPublica } from '@/lib/resumen/api';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export type ResultadoFechaResumen =
    | { success: true }
    | { success: false; estado: 'FECHA_INCORRECTA'; intentosRestantes: number }
    | { success: false; estado: 'BLOQUEADO'; hastaIso: string }
    | { success: false; estado: 'NO_DISPONIBLE' | 'SIN_FECHA' | 'ERROR' };

export async function verificarFechaResumenAction(token: string, fecha: string): Promise<ResultadoFechaResumen> {
    if (typeof token !== 'string' || !TOKEN_RESUMEN.test(token)) return { success: false, estado: 'NO_DISPONIBLE' };
    if (typeof fecha !== 'string' || !FECHA.test(fecha)) return { success: false, estado: 'FECHA_INCORRECTA', intentosRestantes: -1 };

    let res: Response;
    try {
        res = await llamarApiPublica('verify', { token, fechaNacimiento: fecha });
    } catch {
        return { success: false, estado: 'ERROR' };
    }
    if (!res.ok) return { success: false, estado: 'ERROR' };
    const r = (await res.json()) as
        | { ok: true; acceso: string; expiraIso: string }
        | { ok: false; estado: 'FECHA_INCORRECTA'; intentosRestantes: number }
        | { ok: false; estado: 'BLOQUEADO'; hastaIso: string }
        | { ok: false; estado: 'NO_DISPONIBLE' | 'SIN_FECHA' };
    if (!r.ok) {
        const { ok, ...motivo } = r;
        void ok;
        return { success: false, ...motivo };
    }

    (await cookies()).set(COOKIE_ACCESO_RESUMEN, r.acceso, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: `/resumen/${token}`,
        expires: new Date(r.expiraIso),
    });
    return { success: true };
}

/** «Salir»: borra el acceso (para un celular prestado o compartido). */
export async function salirDelResumenAction(token: string): Promise<void> {
    if (typeof token !== 'string' || !TOKEN_RESUMEN.test(token)) return;
    (await cookies()).set(COOKIE_ACCESO_RESUMEN, '', { path: `/resumen/${token}`, maxAge: 0 });
}
