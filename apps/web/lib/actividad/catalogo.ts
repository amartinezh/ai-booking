/**
 * 👣 ACTIVIDAD DE USUARIOS (2026-10-26) — el catálogo de lo que se muestra.
 *
 * La pantalla del super administrador (`/super-admin/actividad`) junta en una
 * sola línea de tiempo todo lo que el personal de las clínicas deja registrado
 * en la base: ingresos al panel, cambios de clave, cuentas creadas, consultas del
 * rastreo, casos de la Bandeja, cargas del padrón, avisos masivos, etc. Cada
 * fuente guarda su rastro a su manera (`fuentes.ts` las lee); aquí vive, sin base
 * ni sesión para poder probarlo, cómo se nombra y se agrupa cada cosa.
 */
import { formatDateShort, formatTimeOnly } from '../date';

export const CATEGORIAS = [
    'INGRESOS',
    'SEGURIDAD',
    'CUENTAS',
    'CITAS',
    'PACIENTES',
    'CATALOGOS',
    'BANDEJA',
    'CONFIGURACION',
    'PADRON',
    'AVISOS',
    'SOPORTE',
    'PLATAFORMA',
    'OTROS',
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

export const ETIQUETA_CATEGORIA: Record<Categoria, { etiqueta: string; icono: string }> = {
    INGRESOS: { etiqueta: 'Ingresos y salidas', icono: '🔐' },
    SEGURIDAD: { etiqueta: 'Intentos fallidos y claves', icono: '🛡️' },
    CUENTAS: { etiqueta: 'Usuarios y cuentas', icono: '👥' },
    CITAS: { etiqueta: 'Citas y agenda', icono: '📅' },
    PACIENTES: { etiqueta: 'Pacientes', icono: '🔎' },
    CATALOGOS: { etiqueta: 'Médicos, servicios y EPS', icono: '🗂️' },
    BANDEJA: { etiqueta: 'Bandeja y Caja Negra', icono: '🚨' },
    CONFIGURACION: { etiqueta: 'Configuración', icono: '⚙️' },
    PADRON: { etiqueta: 'Padrón y solicitudes', icono: '🪪' },
    AVISOS: { etiqueta: 'Avisos y recordatorios', icono: '📣' },
    SOPORTE: { etiqueta: 'Soporte', icono: '🛟' },
    PLATAFORMA: { etiqueta: 'Plataforma (equipo AgenIA)', icono: '🌎' },
    OTROS: { etiqueta: 'Otras acciones', icono: '•' },
};

export function esCategoria(valor: unknown): valor is Categoria {
    return typeof valor === 'string' && (CATEGORIAS as readonly string[]).includes(valor);
}

// ─────────────────────────────────────────────────────────────
// Bitácora del sistema (`SystemLog`): qué acción es qué
// ─────────────────────────────────────────────────────────────

/** Cómo se lee cada acción de la bitácora del sistema que hace una persona. */
export interface AccionDeLaBitacora {
    categoria: Categoria;
    titulo: string;
    /** Merece atención (un ingreso fallido, una cuenta borrada). */
    aviso?: boolean;
    /** El `message` guardado describe el caso y se muestra como detalle. */
    mensaje?: boolean;
}

export const ACCIONES_DE_LA_BITACORA: Record<string, AccionDeLaBitacora> = {
    USER_LOGIN: { categoria: 'INGRESOS', titulo: 'Ingresó al panel' },
    USER_LOGOUT: { categoria: 'INGRESOS', titulo: 'Cerró sesión' },
    LOGIN_FAILED: { categoria: 'SEGURIDAD', titulo: 'Intento de ingreso fallido', aviso: true },
    LOGIN_BLOCKED: { categoria: 'SEGURIDAD', titulo: 'Ingreso frenado por intentos fallidos', aviso: true },
    PASSWORD_CHANGED: { categoria: 'SEGURIDAD', titulo: 'Cambió su clave' },
    PASSWORD_CHANGE_FAILED: {
        categoria: 'SEGURIDAD',
        titulo: 'Intentó cambiar su clave con la clave actual equivocada',
        aviso: true,
    },
    USER_CREATED: { categoria: 'CUENTAS', titulo: 'Creó un usuario' },
    USER_UPDATED: { categoria: 'CUENTAS', titulo: 'Modificó un usuario' },
    USER_DELETED: { categoria: 'CUENTAS', titulo: 'Eliminó un usuario', aviso: true },
    BOOKING_BLOCK_CREATED: { categoria: 'CONFIGURACION', titulo: 'Bloqueó días u horas para el asistente' },
    BOOKING_BLOCK_DELETED: { categoria: 'CONFIGURACION', titulo: 'Quitó un bloqueo de días u horas' },
    MASS_NOTICE_SENT: { categoria: 'AVISOS', titulo: 'Salió un lote de avisos masivos', mensaje: true },
    // La API lo anota sin saber quién lo pidió; desde el 2026-10-27 la web anota
    // REMINDER_MANUAL_REQUESTED con la persona. Este ya no sale en la línea de tiempo
    // (no está en ACCIONES_SIN_USUARIO), pero se lee si alguna vez trae usuario.
    REMINDER_MANUAL_SENT: { categoria: 'AVISOS', titulo: 'Se envió un recordatorio manual', mensaje: true },

    // ── Visión General y Agendamiento (2026-10-27) ──
    APPOINTMENT_ATTENDANCE_MARKED: { categoria: 'CITAS', titulo: 'Marcó la asistencia de una cita' },
    REMINDER_MANUAL_REQUESTED: { categoria: 'AVISOS', titulo: 'Pidió un recordatorio manual' },
    APPOINTMENT_BOOKED_PANEL: { categoria: 'CITAS', titulo: 'Agendó una cita desde el panel' },
    APPOINTMENT_MOVED_PANEL: { categoria: 'CITAS', titulo: 'Cambió la fecha o el médico de una cita', aviso: true },
    APPOINTMENT_EDITED_PANEL: { categoria: 'CITAS', titulo: 'Corrigió la EPS o el nombre del paciente de una cita' },
    PATIENT_MESSAGE_SENT: { categoria: 'AVISOS', titulo: 'Le escribió a un paciente desde el panel' },

    // ── Agendas (cupos) ──
    SLOTS_GENERATED: { categoria: 'CITAS', titulo: 'Abrió cupos en la agenda' },
    SLOTS_CLONED: { categoria: 'CITAS', titulo: 'Copió la agenda de un día a otro' },
    SLOT_DELETED: { categoria: 'CITAS', titulo: 'Borró un cupo de la agenda' },

    // ── Médicos, pacientes, servicios y EPS ──
    DOCTOR_CREATED: { categoria: 'CATALOGOS', titulo: 'Creó un médico' },
    DOCTOR_UPDATED: { categoria: 'CATALOGOS', titulo: 'Modificó un médico' },
    DOCTOR_DELETED: { categoria: 'CATALOGOS', titulo: 'Eliminó un médico', aviso: true },
    PATIENT_CREATED: { categoria: 'PACIENTES', titulo: 'Creó la ficha de un paciente' },
    PATIENT_UPDATED: { categoria: 'PACIENTES', titulo: 'Modificó la ficha de un paciente' },
    PATIENT_DELETED: { categoria: 'PACIENTES', titulo: 'Eliminó la ficha de un paciente', aviso: true },
    SERVICE_CREATED: { categoria: 'CATALOGOS', titulo: 'Creó un servicio' },
    SERVICE_ACTIVATED: { categoria: 'CATALOGOS', titulo: 'Activó un servicio' },
    SERVICE_DEACTIVATED: { categoria: 'CATALOGOS', titulo: 'Inactivó un servicio', aviso: true },
    SERVICE_DELETED: { categoria: 'CATALOGOS', titulo: 'Eliminó un servicio', aviso: true },
    EPS_CREATED: { categoria: 'CATALOGOS', titulo: 'Creó una EPS' },
    EPS_UPDATED: { categoria: 'CATALOGOS', titulo: 'Modificó una EPS' },
    EPS_ACTIVATED: { categoria: 'CATALOGOS', titulo: 'Activó una EPS' },
    EPS_DEACTIVATED: { categoria: 'CATALOGOS', titulo: 'Inactivó una EPS', aviso: true },
    EPS_DELETED: { categoria: 'CATALOGOS', titulo: 'Eliminó una EPS', aviso: true },
    ORGANIZATION_CREATED: { categoria: 'PLATAFORMA', titulo: 'Creó la clínica' },
    ORGANIZATION_UPDATED: { categoria: 'PLATAFORMA', titulo: 'Cambió el nombre o el logo de la clínica' },
    ORGANIZATION_SUSPENDED: { categoria: 'PLATAFORMA', titulo: 'Suspendió la clínica', aviso: true },
    ORGANIZATION_REACTIVATED: { categoria: 'PLATAFORMA', titulo: 'Reactivó la clínica' },
    SUPPORT_BOT_CONVERSATION_VIEWED: {
        categoria: 'PLATAFORMA',
        titulo: 'Leyó una conversación del asistente de soporte',
        mensaje: true,
    },
    SUPER_ADMIN_CREATED: { categoria: 'PLATAFORMA', titulo: 'Se creó un super administrador', aviso: true },
    SUPER_ADMIN_PASSWORD_RESET: {
        categoria: 'PLATAFORMA',
        titulo: 'Se le puso una clave nueva a un super administrador',
        aviso: true,
    },
    SUPER_ADMIN_REMOVED: { categoria: 'PLATAFORMA', titulo: 'Se retiró un super administrador', aviso: true },
};

/**
 * Las acciones que cuentan como actividad aunque no tengan usuario: el intento
 * de ingreso con un correo que no existe no tiene a quién atribuirse, el lote de
 * avisos masivos lo anota la API al enviarlo (quién lo armó sale del lote) y las
 * cuentas de super administrador se tocan desde la consola del servidor.
 */
export const ACCIONES_SIN_USUARIO = [
    'LOGIN_FAILED',
    'LOGIN_BLOCKED',
    'MASS_NOTICE_SENT',
    'SUPER_ADMIN_CREATED',
    'SUPER_ADMIN_PASSWORD_RESET',
    'SUPER_ADMIN_REMOVED',
] as const;

/** Acciones de la bitácora que pertenecen a una de las categorías pedidas. */
export function accionesDeCategorias(categorias: ReadonlySet<Categoria>): string[] {
    return Object.entries(ACCIONES_DE_LA_BITACORA)
        .filter(([, v]) => categorias.has(v.categoria))
        .map(([accion]) => accion);
}

/** Cómo se lee una acción de la bitácora; una desconocida va a «Otras acciones» con su texto. */
export function leerAccionDeLaBitacora(
    accion: string,
    mensaje: string,
): { categoria: Categoria; titulo: string; aviso: boolean; detalle: string | null } {
    const conocida = ACCIONES_DE_LA_BITACORA[accion];
    if (conocida) {
        return {
            categoria: conocida.categoria,
            titulo: conocida.titulo,
            aviso: !!conocida.aviso,
            detalle: conocida.mensaje && mensaje ? mensaje : null,
        };
    }
    return { categoria: 'OTROS', titulo: mensaje || accion, aviso: false, detalle: null };
}

// ─────────────────────────────────────────────────────────────
// Motivos de un ingreso fallido
// ─────────────────────────────────────────────────────────────

export const MOTIVO_INGRESO_FALLIDO = {
    USUARIO_NO_EXISTE: 'el correo no tiene cuenta',
    CLAVE_INCORRECTA: 'clave equivocada',
    CLINICA_INACTIVA: 'la clínica está suspendida',
} as const;

export type MotivoIngresoFallido = keyof typeof MOTIVO_INGRESO_FALLIDO;

// ─────────────────────────────────────────────────────────────
// Roles, en palabras
// ─────────────────────────────────────────────────────────────

export const ETIQUETA_ROL: Record<string, string> = {
    SUPER_ADMIN: 'Super administrador',
    ORG_ADMIN: 'Administrador',
    BOOKING_AGENT: 'Agente de reservas',
    DOCTOR: 'Médico',
    GENERAL_OBSERVER: 'Observador general',
    PATIENT: 'Paciente',
};

export function etiquetaRol(rol: string | null | undefined): string {
    if (!rol) return '';
    return ETIQUETA_ROL[rol] ?? rol;
}

// ─────────────────────────────────────────────────────────────
// Datos personales en la línea de tiempo
// ─────────────────────────────────────────────────────────────

/**
 * Un documento o teléfono con solo sus últimos 4 dígitos («••••4567»). La línea
 * de tiempo dice QUÉ hizo cada usuario, no los datos del paciente: para eso está
 * el Rastreo, que exige motivo y deja constancia.
 */
export function enmascarar(valor: string | null | undefined): string {
    const limpio = (valor ?? '').replace(/\s+/g, '');
    if (!limpio) return '';
    if (limpio.length <= 4) return '••••';
    return `••••${limpio.slice(-4)}`;
}

/** Recorta un texto libre para la línea de tiempo (el detalle completo queda en la base). */
export function recortar(texto: string | null | undefined, max = 240): string {
    const t = (texto ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ─────────────────────────────────────────────────────────────
// Navegador, en palabras
// ─────────────────────────────────────────────────────────────

/**
 * «Chrome en Windows», «Safari en iPhone»… a partir del user agent. Sirve para
 * reconocer de un vistazo un ingreso desde un equipo raro; el texto completo
 * queda en el detalle.
 */
export function describirNavegador(ua: string | null | undefined): string {
    const s = ua ?? '';
    if (!s) return '';
    const navegador = /Edg\//.test(s)
        ? 'Edge'
        : /OPR\/|Opera/.test(s)
          ? 'Opera'
          : /Firefox\//.test(s)
            ? 'Firefox'
            : /Chrome\/|CriOS\//.test(s)
              ? 'Chrome'
              : /Safari\//.test(s)
                ? 'Safari'
                : /curl|python|node|axios|wget|Go-http/i.test(s)
                  ? 'Programa (no es un navegador)'
                  : 'Otro navegador';
    const sistema = /iPhone/.test(s)
        ? 'iPhone'
        : /iPad/.test(s)
          ? 'iPad'
          : /Android/.test(s)
            ? 'Android'
            : /Windows/.test(s)
              ? 'Windows'
              : /Mac OS X|Macintosh/.test(s)
                ? 'Mac'
                : /Linux/.test(s)
                  ? 'Linux'
                  : '';
    return sistema ? `${navegador} en ${sistema}` : navegador;
}

// ─────────────────────────────────────────────────────────────
// Textos de las huellas nuevas (2026-10-27)
// ─────────────────────────────────────────────────────────────

/** «Medicina general · Dra. Pérez · 27/10/2026 08:20 a m»: qué cita fue, sin datos del paciente. */
export function describirCita(c: {
    inicio: Date | string | null | undefined;
    servicio?: string | null;
    medico?: string | null;
}): string {
    const cuando = c.inicio ? `${formatDateShort(c.inicio)} ${formatTimeOnly(c.inicio)}` : null;
    return [c.servicio, c.medico, cuando].filter(Boolean).join(' · ');
}

export const ETIQUETA_ASISTENCIA: Record<string, string> = {
    ATTENDED: 'Asistió',
    NO_SHOW: 'No asistió',
    PENDING: 'Pendiente',
};

/**
 * Lo que cambió entre dos versiones de una ficha, en palabras. Los campos de
 * `sinValor` dicen solo que cambiaron (un teléfono, una dirección, una clave):
 * la línea de tiempo dice qué hizo la persona, no copia datos personales.
 */
export function listarCambios(
    antes: Record<string, unknown>,
    despues: Record<string, unknown>,
    etiquetas: Record<string, string>,
    sinValor: readonly string[] = [],
): string[] {
    const texto = (v: unknown) =>
        v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'sí' : 'no') : String(v);
    const iguales = (a: unknown, b: unknown) =>
        a instanceof Date || b instanceof Date
            ? new Date(a as string).getTime() === new Date(b as string).getTime()
            : (a ?? '') === (b ?? '');
    return Object.keys(etiquetas)
        .filter((k) => k in despues && !iguales(antes[k], despues[k]))
        .map((k) =>
            sinValor.includes(k) ? `${etiquetas[k]} cambió` : `${etiquetas[k]}: ${texto(antes[k])} → ${texto(despues[k])}`,
        );
}
