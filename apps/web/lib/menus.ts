import type { SessionPayload } from './session';

// ─────────────────────────────────────────────────────────────
// NAVEGACIÓN POR ROL — fuente única de verdad.
//
// La consumen el sidebar del dashboard (layout) y el grid de accesos rápidos
// de la Visión General (QuickAccessGrid). Agregar una opción aquí la publica
// automáticamente en ambos lugares, siempre filtrada por el rol del usuario.
// ─────────────────────────────────────────────────────────────

export type UserRole = SessionPayload['role'];

// Claves de color soportadas por las tarjetas de acceso rápido.
// QuickAccessGrid las mapea a clases Tailwind ESTÁTICAS (requisito del JIT).
export type MenuAccent =
    | 'blue'
    | 'violet'
    | 'emerald'
    | 'amber'
    | 'rose'
    | 'cyan'
    | 'indigo'
    | 'teal'
    | 'orange'
    | 'fuchsia'
    | 'sky'
    | 'slate';

export interface MenuItem {
    label: string;
    href: string;
    icon: string;
    /** Subtítulo corto para la tarjeta de acceso rápido. */
    description: string;
    accent: MenuAccent;
}

const OVERVIEW: MenuItem = { label: 'Visión General', href: '/dashboard', icon: '📋', description: 'Monitoreo central de citas', accent: 'blue' };
const SUPPORT: MenuItem = { label: 'Soporte', href: '/dashboard/soporte', icon: '🛟', description: 'Tickets de ayuda técnica', accent: 'slate' };

const PATIENT_MENUS: MenuItem[] = [
    { label: 'Mis Citas Programadas', href: '/dashboard', icon: '📅', description: 'Consulta tus próximas citas', accent: 'blue' },
    SUPPORT,
];

const DOCTOR_MENUS: MenuItem[] = [
    { label: 'Mi Agenda', href: '/dashboard', icon: '🩺', description: 'Flujo de atención del día', accent: 'blue' },
    SUPPORT,
];

const ADMIN_MENUS: MenuItem[] = [
    OVERVIEW,
    { label: 'Analíticas de Negocio', href: '/dashboard/analytics', icon: '📊', description: 'Indicadores y tendencias', accent: 'violet' },
    { label: 'Agendas (Slots)', href: '/dashboard/agenda', icon: '📅', description: 'Generación y gestión de cupos', accent: 'emerald' },
    { label: 'Servicios de Salud', href: '/dashboard/servicios', icon: '💉', description: 'Catálogo de especialidades', accent: 'cyan' },
    { label: 'Aseguradoras (EPS)', href: '/dashboard/eps', icon: '🏦', description: 'Convenios y aseguradoras', accent: 'amber' },
    { label: 'Padrón EPS (Altas)', href: '/dashboard/padron', icon: '🪪', description: 'Pacientes habilitados por CSV', accent: 'teal' },
    { label: 'Usuarios', href: '/dashboard/usuarios', icon: '👥', description: 'Cuentas y perfiles de acceso', accent: 'indigo' },
    { label: 'Médicos', href: '/dashboard/medicos', icon: '⚕️', description: 'Cuerpo médico de la clínica', accent: 'sky' },
    { label: 'Caja Negra (Auditoría)', href: '/dashboard/auditoria', icon: '🕵️', description: 'Trazabilidad del chatbot', accent: 'slate' },
    { label: 'Encuestas (CSAT)', href: '/dashboard/configuracion/integraciones/surveys', icon: '⭐', description: 'Opiniones de pacientes', accent: 'orange' },
    { label: 'Solicitudes de Alta', href: '/dashboard/solicitudes-alta', icon: '📨', description: 'Revisiones pedidas por ciudadanos', accent: 'rose' },
    { label: 'Configuración', href: '/dashboard/configuracion', icon: '⚙️', description: 'IA, WhatsApp, voz y marca', accent: 'fuchsia' },
    SUPPORT,
];

const AGENT_MENUS: MenuItem[] = [
    OVERVIEW,
    { label: 'Agendamiento', href: '/dashboard/agendamiento', icon: '📅', description: 'Reserva de citas asistida', accent: 'emerald' },
    SUPPORT,
];

const OBSERVER_MENUS: MenuItem[] = [
    { label: 'Analíticas de Negocio', href: '/dashboard/analytics', icon: '📊', description: 'Indicadores y tendencias', accent: 'violet' },
    SUPPORT,
];

const MENUS_BY_ROLE: Partial<Record<UserRole, MenuItem[]>> = {
    PATIENT: PATIENT_MENUS,
    DOCTOR: DOCTOR_MENUS,
    ORG_ADMIN: ADMIN_MENUS,
    BOOKING_AGENT: AGENT_MENUS,
    GENERAL_OBSERVER: OBSERVER_MENUS,
};

/** Opciones de menú visibles para un rol (vacío para roles sin dashboard clínico). */
/**
 * Solo aparece en las clínicas que tienen espejo con un HIS. Ponerlo siempre
 * dejaría una opción muerta en la mayoría de los tenants, y una opción que no
 * hace nada enseña a ignorar el menú.
 */
const ESPEJO: MenuItem = {
    label: 'Espejo con el HIS',
    href: '/dashboard/espejo',
    icon: '🪞',
    description: 'Sincronización con el sistema del hospital',
    accent: 'violet',
};

export function getMenusForRole(
    role: UserRole,
    opts: { conEspejo?: boolean } = {},
): MenuItem[] {
    const menus = MENUS_BY_ROLE[role] ?? [];
    if (!opts.conEspejo || role !== 'ORG_ADMIN') return menus;

    // Antes de Soporte, que siempre cierra la lista.
    const i = menus.findIndex((m) => m.href === '/dashboard/soporte');
    return i === -1
        ? [...menus, ESPEJO]
        : [...menus.slice(0, i), ESPEJO, ...menus.slice(i)];
}
