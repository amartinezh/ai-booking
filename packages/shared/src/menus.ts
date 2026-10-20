// ─────────────────────────────────────────────────────────────
// NAVEGACIÓN POR ROL — fuente única de verdad.
//
// La consumen el sidebar del dashboard (layout) y el grid de accesos rápidos
// de la Visión General (QuickAccessGrid). Agregar una opción aquí la publica
// automáticamente en ambos lugares, siempre filtrada por el rol del usuario.
//
// Vive en @agenia/shared porque también la lee el asistente de soporte de la
// API (docs/PLAN_BOT_SOPORTE.md §3.2), para saber qué opciones tiene quien
// pregunta. La web la reexporta en apps/web/lib/menus.ts. Una opción nueva exige
// su tema en la Parte 1 de docs/conocimiento/AGENIA.md con el mismo título
// (scripts/check-conocimiento.mjs).
// ─────────────────────────────────────────────────────────────

/** Los roles de `User.role` (packages/database). La web los recibe en la sesión. */
export type UserRole =
  | 'PATIENT'
  | 'DOCTOR'
  | 'ORG_ADMIN'
  | 'SUPER_ADMIN'
  | 'BOOKING_AGENT'
  | 'GENERAL_OBSERVER';

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
  /** Cuántas cosas esperan al usuario en esa opción (solo la bandeja); 0 o ausente = sin cifra. */
  badge?: number;
}

const OVERVIEW: MenuItem = {
  label: 'Visión General',
  href: '/dashboard',
  icon: '📋',
  description: 'Monitoreo central de citas',
  accent: 'blue',
};
const SUPPORT: MenuItem = {
  label: 'Soporte',
  href: '/dashboard/soporte',
  icon: '🛟',
  description: 'Tickets de ayuda técnica',
  accent: 'slate',
};

/**
 * Rastreo de paciente (docs/PLAN_RASTREO_PACIENTE.md). Lo ven ORG_ADMIN,
 * BOOKING_AGENT y DOCTOR — con vistas distintas: el permiso real lo aplica el
 * servidor (`apps/web/lib/rastreo/acceso.ts`), esto solo decide si aparece el enlace.
 * GENERAL_OBSERVER y PATIENT no lo tienen.
 */
const RASTREO: MenuItem = {
  label: 'Rastreo de paciente',
  href: '/dashboard/rastreo',
  icon: '🔎',
  description: 'Consulta y diagnóstico de las citas de un paciente',
  accent: 'indigo',
};

/**
 * Caja Negra: conversaciones del bot que fallaron, se abandonaron o se
 * derivaron por emergencia, para llamar al paciente y marcar el contacto. La
 * ven ORG_ADMIN y BOOKING_AGENT —quien agenda es quien hace esas llamadas—; el
 * permiso real lo aplican la página y sus rutas.
 */
const AUDITORIA: MenuItem = {
  label: 'Caja Negra (Auditoría)',
  href: '/dashboard/auditoria',
  icon: '🕵️',
  description: 'Trazabilidad del chatbot',
  accent: 'slate',
};

/**
 * Límite de citas por paciente (cuántas puede tener el mismo día y en el mismo
 * mes por el asistente): solo ORG_ADMIN, que es quien fija la regla
 * (2026-10-22: el agendador la veía y la podía cambiar). La bandeja de quienes
 * piden más (Solicitudes) es de ORG_ADMIN y BOOKING_AGENT: quien agenda es quien
 * atiende a esos pacientes. El permiso real lo aplican las páginas y sus
 * acciones (`apps/web/lib/limite-citas/acceso.ts`).
 */
const LIMITE_CITAS: MenuItem = {
  label: 'Límite de citas',
  href: '/dashboard/limites-citas',
  icon: '🚦',
  description: 'Máximo de citas por paciente al día y al mes',
  accent: 'amber',
};

const SOLICITUDES_CITAS: MenuItem = {
  label: 'Solicitudes de más citas',
  href: '/dashboard/solicitudes-citas',
  icon: '📝',
  description: 'Pacientes que piden citas por encima del límite',
  accent: 'rose',
};

const PATIENT_MENUS: MenuItem[] = [
  {
    label: 'Mis Citas Programadas',
    href: '/dashboard',
    icon: '📅',
    description: 'Consulta tus próximas citas',
    accent: 'blue',
  },
  SUPPORT,
];

const DOCTOR_MENUS: MenuItem[] = [
  {
    label: 'Mi Agenda',
    href: '/dashboard',
    icon: '🩺',
    description: 'Flujo de atención del día',
    accent: 'blue',
  },
  RASTREO,
  SUPPORT,
];

const ADMIN_MENUS: MenuItem[] = [
  OVERVIEW,
  {
    label: 'Analíticas de Negocio',
    href: '/dashboard/analytics',
    icon: '📊',
    description: 'Indicadores y tendencias',
    accent: 'violet',
  },
  {
    label: 'Canales en vivo',
    href: '/dashboard/canales',
    icon: '📈',
    description: 'WhatsApp y Telegram en cifras',
    accent: 'emerald',
  },
  {
    label: 'Agendas (Slots)',
    href: '/dashboard/agenda',
    icon: '📅',
    description: 'Generación y gestión de cupos',
    accent: 'emerald',
  },
  {
    label: 'Servicios de Salud',
    href: '/dashboard/servicios',
    icon: '💉',
    description: 'Catálogo de especialidades',
    accent: 'cyan',
  },
  {
    label: 'Aseguradoras (EPS)',
    href: '/dashboard/eps',
    icon: '🏦',
    description: 'Convenios y aseguradoras',
    accent: 'amber',
  },
  {
    label: 'Padrón EPS (Altas)',
    href: '/dashboard/padron',
    icon: '🪪',
    description: 'Pacientes habilitados por CSV',
    accent: 'teal',
  },
  {
    label: 'Usuarios',
    href: '/dashboard/usuarios',
    icon: '👥',
    description: 'Cuentas y perfiles de acceso',
    accent: 'indigo',
  },
  {
    label: 'Médicos',
    href: '/dashboard/medicos',
    icon: '⚕️',
    description: 'Cuerpo médico de la clínica',
    accent: 'sky',
  },
  AUDITORIA,
  RASTREO,
  {
    label: 'Encuestas (CSAT)',
    href: '/dashboard/configuracion/integraciones/surveys',
    icon: '⭐',
    description: 'Opiniones de pacientes',
    accent: 'orange',
  },
  {
    label: 'Solicitudes de Alta',
    href: '/dashboard/solicitudes-alta',
    icon: '📨',
    description: 'Revisiones pedidas por ciudadanos',
    accent: 'rose',
  },
  SOLICITUDES_CITAS,
  LIMITE_CITAS,
  {
    label: 'Configuración',
    href: '/dashboard/configuracion',
    icon: '⚙️',
    description: 'IA, WhatsApp, voz y marca',
    accent: 'fuchsia',
  },
  SUPPORT,
];

const AGENT_MENUS: MenuItem[] = [
  OVERVIEW,
  {
    label: 'Agendamiento',
    href: '/dashboard/agendamiento',
    icon: '📅',
    description: 'Reserva de citas asistida',
    accent: 'emerald',
  },
  AUDITORIA,
  RASTREO,
  SOLICITUDES_CITAS,
  SUPPORT,
];

const OBSERVER_MENUS: MenuItem[] = [
  {
    label: 'Analíticas de Negocio',
    href: '/dashboard/analytics',
    icon: '📊',
    description: 'Indicadores y tendencias',
    accent: 'violet',
  },
  {
    label: 'Canales en vivo',
    href: '/dashboard/canales',
    icon: '📈',
    description: 'WhatsApp y Telegram en cifras',
    accent: 'emerald',
  },
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

/**
 * EXCLUSIVO del driver cnt-sanvicente-anserma (ver
 * docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md §1). A
 * diferencia de `ESPEJO` —que solo se inserta para `ORG_ADMIN`—, esta
 * aparece para `ORG_ADMIN` y `BOOKING_AGENT` (§1.3: los dos operan la
 * pantalla; solo `ORG_ADMIN` ve el panel de configuración dentro de ella).
 *
 * Los dos la ven con solo el driver correcto (`conAvisosDriver`), aunque los
 * avisos sigan APAGADOS. ORG_ADMIN, porque es quien los enciende: la pantalla
 * le muestra el panel para hacerlo (antes solo aparecía ya encendidos, y para
 * encenderlos había que escribir la dirección a mano). BOOKING_AGENT, porque
 * la clínica lo pidió así: apagados, la pantalla le dice que un administrador
 * tiene que activarlos.
 */
const AVISOS: MenuItem = {
  label: 'Avisos masivos',
  href: '/dashboard/espejo/avisos',
  icon: '📣',
  description:
    'Aviso o recordatorio por WhatsApp para el día de agenda de un especialista',
  accent: 'rose',
};

/**
 * Bandeja de excepciones de sincronización (docs/PLAN_RASTREO_PACIENTE.md §10 #3).
 * Solo en las clínicas con espejo —sin HIS no hay nada que sincronizar— y para quien
 * la trabaja: ORG_ADMIN y BOOKING_AGENT. El permiso real y el alcance del agente los
 * aplica el servidor (`apps/web/lib/bandeja/acceso.ts`); esto solo decide si aparece el enlace.
 */
const BANDEJA: MenuItem = {
  label: 'Bandeja de sincronización',
  href: '/dashboard/bandeja',
  icon: '🚨',
  description:
    'Citas que no llegaron al hospital, cambios sin aplicar y avisos de pacientes',
  accent: 'orange',
};

function insertBeforeSoporte(menus: MenuItem[], item: MenuItem): MenuItem[] {
  const i = menus.findIndex((m) => m.href === '/dashboard/soporte');
  return i === -1
    ? [...menus, item]
    : [...menus.slice(0, i), item, ...menus.slice(i)];
}

export function getMenusForRole(
  role: UserRole,
  opts: {
    conEspejo?: boolean;
    conAvisos?: boolean;
    /** Espejo encendido con el driver de avisos, estén o no encendidos (ver `AVISOS`). */
    conAvisosDriver?: boolean;
    pendientesBandeja?: number;
    /** Solicitudes de más citas radicadas sin revisar (cifra del menú). */
    pendientesSolicitudesCitas?: number;
  } = {},
): MenuItem[] {
  let menus = MENUS_BY_ROLE[role] ?? [];

  if (opts.pendientesSolicitudesCitas && opts.pendientesSolicitudesCitas > 0) {
    // Copia: `SOLICITUDES_CITAS` es compartido y la cifra es de esta clínica.
    const badge = opts.pendientesSolicitudesCitas;
    menus = menus.map((m) =>
      m.href === SOLICITUDES_CITAS.href ? { ...m, badge } : m,
    );
  }

  if (opts.conEspejo && role === 'ORG_ADMIN') {
    menus = insertBeforeSoporte(menus, ESPEJO);
  }
  if (opts.conEspejo && (role === 'ORG_ADMIN' || role === 'BOOKING_AGENT')) {
    // Copia: `BANDEJA` es compartido y la cifra es de este usuario.
    menus = insertBeforeSoporte(
      menus,
      opts.pendientesBandeja && opts.pendientesBandeja > 0
        ? { ...BANDEJA, badge: opts.pendientesBandeja }
        : BANDEJA,
    );
  }
  const avisosVisibles =
    (role === 'ORG_ADMIN' || role === 'BOOKING_AGENT') &&
    (opts.conAvisos || opts.conAvisosDriver);
  if (avisosVisibles) {
    menus = insertBeforeSoporte(menus, AVISOS);
  }

  return menus;
}

/** Las banderas del menú que dependen del espejo de una clínica (ver `getMenusForRole`). */
export interface BanderasDelEspejo {
  /** Hay espejo configurado (aunque esté apagado: el administrador lo ve para reactivarlo). */
  conEspejo: boolean;
  /** Espejo encendido con el driver de avisos masivos, estén o no encendidos. */
  conAvisosDriver: boolean;
  /** Además, los avisos masivos encendidos. */
  conAvisos: boolean;
}

/**
 * Calcula las banderas a partir de la fila `HospitalMirrorConfig` de la clínica
 * (`null` si no tiene). La usan la web (el menú) y el asistente de soporte (para
 * saber qué opciones tiene quien pregunta): las dos tienen que dar lo mismo.
 */
export function banderasDelEspejo(
  config: {
    enabled: boolean;
    driverKey: string;
    avisosMasivos: unknown;
  } | null,
): BanderasDelEspejo {
  if (!config)
    return { conEspejo: false, conAvisosDriver: false, conAvisos: false };
  const avisos = config.avisosMasivos as { enabled?: boolean } | null;
  const conAvisosDriver =
    config.enabled && config.driverKey === 'cnt-sanvicente-anserma';
  return {
    conEspejo: true,
    conAvisosDriver,
    conAvisos: conAvisosDriver && !!avisos?.enabled,
  };
}
