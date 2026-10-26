/**
 * 👁️ PANTALLAS ABIERTAS (2026-10-27) — cómo se llama cada pantalla del panel.
 *
 * La Actividad de usuarios anota qué pantallas abre cada persona (una vez cada 30
 * minutos por pantalla, para no llenar la bitácora). El nombre sale del mismo menú
 * que ve esa persona; las pantallas que no están en el menú tienen el suyo aquí.
 * Una ruta que no se reconoce no se anota. Pura, para probarla.
 */
import { getMenusForRole, type UserRole } from '../menus';
import { SUPER_ADMIN_MENUS } from '../super-admin-menus';

/** Cada cuánto se vuelve a anotar la misma pantalla para la misma persona. */
export const VENTANA_PANTALLA_MIN = 30;

const FUERA_DEL_MENU: Record<string, string> = {
    '/dashboard/pacientes': 'Pacientes',
    '/dashboard/cuenta': 'Cambiar mi clave',
    '/dashboard/soporte/ayuda': 'Centro de ayuda',
    '/dashboard/rastreo/consultas': 'Rastreo: consultas registradas',
    '/dashboard/espejo/homologacion': 'Homologar médicos',
    '/dashboard/espejo/auditoria': 'Auditoría del espejo',
    '/super-admin/cuenta': 'Cambiar mi clave',
    '/super-admin/rastreo/consultas': 'Rastreo: consultas registradas',
    '/super-admin/soporte-bot/conversaciones': 'Conversaciones del asistente de soporte',
};

const CON_PARAMETRO: { patron: RegExp; nombre: string }[] = [
    { patron: /^\/super-admin\/organizations\/[^/]+\/admins$/, nombre: 'Administradores de una clínica' },
];

/** La ruta sin la consulta, sin la barra final. */
export function rutaLimpia(ruta: string): string {
    const sinConsulta = (ruta ?? '').split(/[?#]/)[0];
    return sinConsulta.length > 1 ? sinConsulta.replace(/\/+$/, '') : sinConsulta;
}

/** El nombre de la pantalla para esa persona, o null si no es una pantalla que se anote. */
export function nombreDePantalla(ruta: string, rol: string): string | null {
    const r = rutaLimpia(ruta);
    if (!r.startsWith('/dashboard') && !r.startsWith('/super-admin')) return null;
    if (rol === 'SUPER_ADMIN') {
        const item = SUPER_ADMIN_MENUS.find((m) => m.href === r);
        if (item) return item.label;
    } else {
        const item = getMenusForRole(rol as UserRole, {
            conEspejo: true,
            conAvisos: true,
            conAvisosDriver: true,
        }).find((m) => m.href === r);
        if (item) return item.label;
    }
    if (FUERA_DEL_MENU[r]) return FUERA_DEL_MENU[r];
    return CON_PARAMETRO.find((p) => p.patron.test(r))?.nombre ?? null;
}

/** Descargas que se anotan, con su descripción. */
export const DESCARGAS = {
    AVISOS_SIN_CELULAR: 'Pacientes sin celular de un lote de avisos masivos',
    PADRON_ERRORES: 'Filas con error del archivo del padrón',
} as const;

export type TipoDescarga = keyof typeof DESCARGAS;

export function esTipoDescarga(v: unknown): v is TipoDescarga {
    return typeof v === 'string' && v in DESCARGAS;
}
