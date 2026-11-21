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
// (scripts/check-conocimiento.mjs), dentro de la categoría de su grupo.
//
// Cada opción va en un grupo (`grupo`, docs/PLAN_NAVEGACION.md §4): el menú
// lateral los muestra con su encabezado, la opción activa resaltada.
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

/**
 * Los grupos del menú (docs/PLAN_NAVEGACION.md §4, N1). Son también las
 * categorías del Centro de ayuda, con el mismo id y el mismo título (N11): un
 * solo mapa del sistema. Lo comprueba `apps/web/lib/ayuda/contenido.spec.ts`.
 */
export type MenuGrupo =
  | 'operacion'
  | 'comunicacion'
  | 'catalogos'
  | 'indicadores'
  | 'administracion';

/** En el orden en que se muestran: primero el trabajo del día, al final la administración. */
export const GRUPOS_DEL_MENU: ReadonlyArray<{ id: MenuGrupo; titulo: string }> = [
  { id: 'operacion', titulo: 'Operación diaria' },
  { id: 'comunicacion', titulo: 'Comunicación con pacientes' },
  { id: 'catalogos', titulo: 'Agenda y catálogos' },
  { id: 'indicadores', titulo: 'Indicadores' },
  { id: 'administracion', titulo: 'Administración' },
];

export interface MenuItem {
  label: string;
  href: string;
  icon: string;
  /** Subtítulo corto para la tarjeta de acceso rápido. */
  description: string;
  accent: MenuAccent;
  /** Cuántas cosas esperan al usuario en esa opción (solo la bandeja); 0 o ausente = sin cifra. */
  badge?: number;
  /**
   * Su grupo del menú. Sin grupo, la opción va suelta: arriba (Visión General,
   * Agendamiento) o al pie (Soporte y ayuda).
   */
  grupo?: MenuGrupo;
}

const OVERVIEW: MenuItem = {
  label: 'Visión General',
  href: '/dashboard',
  icon: '📋',
  description: 'Monitoreo central de citas',
  accent: 'blue',
};
const SUPPORT: MenuItem = {
  label: 'Soporte y ayuda',
  href: '/dashboard/soporte',
  icon: '🛟',
  description: 'Centro de ayuda y casos de soporte técnico',
  accent: 'slate',
};

// ── Operación diaria ─────────────────────────────────────────

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
  grupo: 'operacion',
};

/**
 * La bandeja de quienes piden más citas que el límite: de ORG_ADMIN y
 * BOOKING_AGENT, porque quien agenda es quien atiende a esos pacientes. El
 * permiso real lo aplican la página y sus acciones (`apps/web/lib/limite-citas/acceso.ts`).
 */
const SOLICITUDES_CITAS: MenuItem = {
  label: 'Solicitudes de más citas',
  href: '/dashboard/solicitudes-citas',
  icon: '📝',
  description: 'Pacientes que piden citas por encima del límite',
  accent: 'rose',
  grupo: 'operacion',
};

const SOLICITUDES_ALTA: MenuItem = {
  label: 'Solicitudes de alta',
  href: '/dashboard/solicitudes-alta',
  icon: '📨',
  description: 'Revisiones pedidas por ciudadanos',
  accent: 'rose',
  grupo: 'operacion',
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
  grupo: 'operacion',
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
  grupo: 'operacion',
};

// ── Comunicación con pacientes ───────────────────────────────

/**
 * 📢 Mensajes masivos (docs/PLAN_MENSAJES_MASIVOS.md): comunicados de la clínica
 * por WhatsApp a una lista de contactos o a sus pacientes. Solo ORG_ADMIN, en
 * todas las clínicas (no depende del espejo). Distinto de `AVISOS`, que es del
 * hospital de Anserma y avisa de las citas de un especialista. El permiso real lo
 * aplican la página y sus acciones (`apps/web/lib/mensajes-masivos/acceso.ts`).
 */
const MENSAJES_MASIVOS: MenuItem = {
  label: 'Mensajes masivos',
  href: '/dashboard/mensajes-masivos',
  icon: '📢',
  description: 'Comunicados por WhatsApp a tus pacientes o a una lista',
  accent: 'teal',
  grupo: 'comunicacion',
};

/**
 * EXCLUSIVO del driver cnt-sanvicente-anserma (ver
 * docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md §1). A
 * diferencia de `ESPEJO` —que solo está en el menú de `ORG_ADMIN`—, esta
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
  grupo: 'comunicacion',
};

/**
 * 📄 Envíos de documentos del resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md
 * §4.6, D14): el seguimiento sin contenido clínico y «Reenviar». EXCLUSIVO del
 * driver cnt-sanvicente-anserma, como `AVISOS`, y solo con la función habilitada
 * (`resumenAtencion` configurado). La ven ORG_ADMIN y BOOKING_AGENT: quien está
 * en la ventanilla es quien reenvía.
 */
const ENVIOS_RESUMEN: MenuItem = {
  label: 'Envíos de documentos',
  href: '/dashboard/espejo/resumen-atencion/envios',
  icon: '📄',
  description: 'Si al paciente le llegaron los documentos de su consulta, y reenviarlos',
  accent: 'teal',
  grupo: 'comunicacion',
};

// ── Agenda y catálogos ───────────────────────────────────────

const AGENDA: MenuItem = {
  label: 'Agendas y cupos',
  href: '/dashboard/agenda',
  icon: '📅',
  description: 'Generación y gestión de cupos',
  accent: 'emerald',
  grupo: 'catalogos',
};
const MEDICOS: MenuItem = {
  label: 'Médicos',
  href: '/dashboard/medicos',
  icon: '⚕️',
  description: 'Cuerpo médico de la clínica',
  accent: 'sky',
  grupo: 'catalogos',
};
const SERVICIOS: MenuItem = {
  label: 'Servicios de salud',
  href: '/dashboard/servicios',
  icon: '💉',
  description: 'Catálogo de especialidades',
  accent: 'cyan',
  grupo: 'catalogos',
};
const EPS: MenuItem = {
  label: 'Aseguradoras (EPS)',
  href: '/dashboard/eps',
  icon: '🏦',
  description: 'Convenios y aseguradoras',
  accent: 'amber',
  grupo: 'catalogos',
};
const PADRON: MenuItem = {
  label: 'Padrón EPS',
  href: '/dashboard/padron',
  icon: '🪪',
  description: 'Pacientes habilitados por CSV',
  accent: 'teal',
  grupo: 'catalogos',
};

// ── Indicadores ──────────────────────────────────────────────

const ANALITICAS: MenuItem = {
  label: 'Analíticas',
  href: '/dashboard/analytics',
  icon: '📊',
  description: 'Indicadores y tendencias',
  accent: 'violet',
  grupo: 'indicadores',
};
const CANALES: MenuItem = {
  label: 'Canales en vivo',
  href: '/dashboard/canales',
  icon: '📈',
  description: 'WhatsApp y Telegram en cifras',
  accent: 'emerald',
  grupo: 'indicadores',
};
const ENCUESTAS: MenuItem = {
  label: 'Encuestas',
  // Antes colgaba de Configuración (`…/configuracion/integraciones/surveys`, que
  // ahora redirige aquí): es una pantalla de resultados, no un ajuste.
  href: '/dashboard/encuestas',
  icon: '⭐',
  description: 'Opiniones de pacientes',
  accent: 'orange',
  grupo: 'indicadores',
};

// ── Administración ───────────────────────────────────────────

const CONFIGURACION: MenuItem = {
  label: 'Configuración',
  href: '/dashboard/configuracion',
  icon: '⚙️',
  description: 'IA, WhatsApp, voz y marca',
  accent: 'fuchsia',
  grupo: 'administracion',
};

// 🚦 El Límite de citas por paciente ya no es una opción del menú: vive en
// Configuración › Qué puede hacer el asistente (docs/PLAN_NAVEGACION.md, N5;
// `/dashboard/limites-citas` redirige allá). Lo fija solo ORG_ADMIN
// (`apps/web/lib/limite-citas/acceso.ts`), igual que toda Configuración.

const USUARIOS: MenuItem = {
  label: 'Usuarios',
  href: '/dashboard/usuarios',
  icon: '👥',
  description: 'Cuentas y perfiles de acceso',
  accent: 'indigo',
  grupo: 'administracion',
};

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
  grupo: 'administracion',
};

// ── Menús por rol ────────────────────────────────────────────
//
// Cada lista va en el orden en que se muestra, grupo por grupo (las opciones de
// un grupo, juntas). Las que dependen del espejo están en su lugar y
// `getMenusForRole` las quita cuando la clínica no las tiene (ver `CONDICIONES`).

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
  BANDEJA,
  SOLICITUDES_CITAS,
  SOLICITUDES_ALTA,
  AUDITORIA,
  RASTREO,
  MENSAJES_MASIVOS,
  AVISOS,
  ENVIOS_RESUMEN,
  AGENDA,
  MEDICOS,
  SERVICIOS,
  EPS,
  PADRON,
  ANALITICAS,
  CANALES,
  ENCUESTAS,
  CONFIGURACION,
  USUARIOS,
  ESPEJO,
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
  BANDEJA,
  SOLICITUDES_CITAS,
  AUDITORIA,
  RASTREO,
  AVISOS,
  ENVIOS_RESUMEN,
  SUPPORT,
];

/** El observador solo mira cifras: con un solo grupo, su menú va sin encabezados. */
const OBSERVER_MENUS: MenuItem[] = [ANALITICAS, CANALES, SUPPORT];

const MENUS_BY_ROLE: Partial<Record<UserRole, MenuItem[]>> = {
  PATIENT: PATIENT_MENUS,
  DOCTOR: DOCTOR_MENUS,
  ORG_ADMIN: ADMIN_MENUS,
  BOOKING_AGENT: AGENT_MENUS,
  GENERAL_OBSERVER: OBSERVER_MENUS,
};

/** Lo que la clínica tiene (del espejo) y las cifras de quien mira. */
export interface OpcionesDelMenu {
  conEspejo?: boolean;
  conAvisos?: boolean;
  /** Espejo encendido con el driver de avisos, estén o no encendidos (ver `AVISOS`). */
  conAvisosDriver?: boolean;
  /** Además, el resumen de la atención habilitado (ver `ENVIOS_RESUMEN`). */
  conResumen?: boolean;
  pendientesBandeja?: number;
  /** Solicitudes de más citas radicadas sin revisar (cifra del menú). */
  pendientesSolicitudesCitas?: number;
}

/**
 * Las opciones que no tienen todas las clínicas. Qué rol las ve lo deciden las
 * listas de arriba: el Espejo solo está en la del administrador; la Bandeja, los
 * Avisos y los Envíos, en la del administrador y la del agendador.
 */
const CONDICIONES: Record<string, (o: OpcionesDelMenu) => boolean> = {
  [ESPEJO.href]: (o) => !!o.conEspejo,
  [BANDEJA.href]: (o) => !!o.conEspejo,
  [AVISOS.href]: (o) => !!(o.conAvisos || o.conAvisosDriver),
  [ENVIOS_RESUMEN.href]: (o) => !!o.conResumen,
};

/** Opciones de menú visibles para un rol (vacío para roles sin dashboard clínico). */
export function getMenusForRole(
  role: UserRole,
  opts: OpcionesDelMenu = {},
): MenuItem[] {
  const cifras: Record<string, number | undefined> = {
    [BANDEJA.href]: opts.pendientesBandeja,
    [SOLICITUDES_CITAS.href]: opts.pendientesSolicitudesCitas,
  };
  return (MENUS_BY_ROLE[role] ?? [])
    .filter((m) => CONDICIONES[m.href]?.(opts) ?? true)
    .map((m) => {
      // Copia: los ítems son compartidos y la cifra es de este usuario o clínica.
      const badge = cifras[m.href];
      return badge && badge > 0 ? { ...m, badge } : m;
    });
}

// ── Cómo se muestra ──────────────────────────────────────────

export interface SeccionDelMenu {
  /** null: opciones sueltas, sin encabezado (arriba, Visión General; al pie, Soporte y ayuda). */
  grupo: { id: MenuGrupo; titulo: string } | null;
  items: MenuItem[];
}

function gruposDe(menus: readonly MenuItem[]): Set<MenuGrupo> {
  return new Set(menus.flatMap((m) => (m.grupo ? [m.grupo] : [])));
}

/**
 * El menú en secciones, como lo pintan el menú lateral y el del celular. Con
 * menos de dos grupos (el médico, el paciente, el observador, el agendador de
 * una clínica sin espejo) los encabezados no ayudan: va en una sola sección,
 * sin encabezado.
 */
export function seccionesDelMenu(menus: readonly MenuItem[]): SeccionDelMenu[] {
  if (menus.length === 0) return [];
  if (gruposDe(menus).size < 2) return [{ grupo: null, items: [...menus] }];
  const secciones: SeccionDelMenu[] = [];
  for (const m of menus) {
    const ultima = secciones[secciones.length - 1];
    if (ultima && (ultima.grupo?.id ?? null) === (m.grupo ?? null)) {
      ultima.items.push(m);
    } else {
      const grupo = m.grupo
        ? (GRUPOS_DEL_MENU.find((g) => g.id === m.grupo) ?? null)
        : null;
      secciones.push({ grupo, items: [m] });
    }
  }
  return secciones;
}

/**
 * El nombre de cada opción como se ve en el menú, con su grupo cuando el menú
 * lleva encabezados («Operación diaria › Bandeja de sincronización»). Lo usa el
 * asistente de soporte para decirle a la persona dónde está cada cosa.
 */
export function nombresEnElMenu(menus: readonly MenuItem[]): string[] {
  return seccionesDelMenu(menus).flatMap((s) =>
    s.items.map((m) => (s.grupo ? `${s.grupo.titulo} › ${m.label}` : m.label)),
  );
}

/**
 * Las tarjetas de la Visión General (N10): lo que espera al usuario hoy. Con el
 * menú en grupos, las opciones sueltas de arriba (Agendamiento) y las de
 * «Operación diaria»; con un menú corto, sin grupos, todas. Nunca la Visión
 * General misma: el usuario ya está en ella.
 */
export function accesosRapidos(menus: readonly MenuItem[]): MenuItem[] {
  const sinInicio = menus.filter((m) => m.href !== '/dashboard');
  if (gruposDe(menus).size < 2) return sinInicio;
  const primerGrupo = sinInicio.findIndex((m) => m.grupo);
  const deArriba = primerGrupo === -1 ? [] : sinInicio.slice(0, primerGrupo);
  return [...deArriba, ...sinInicio.filter((m) => m.grupo === 'operacion')];
}

// ── Las secciones de Configuración (docs/PLAN_NAVEGACION.md §5) ──────────

/** Los grupos de la columna de Configuración. */
export type GrupoDeConfiguracion = 'asistente' | 'clinica' | 'conexiones';

export const GRUPOS_DE_CONFIGURACION: ReadonlyArray<{
  id: GrupoDeConfiguracion;
  titulo: string;
}> = [
  { id: 'asistente', titulo: 'El asistente' },
  { id: 'clinica', titulo: 'La clínica' },
  { id: 'conexiones', titulo: 'Conexiones' },
];

export interface SeccionDeConfiguracion {
  /** El título de la sección; es también el de su tema en el Centro de ayuda. */
  titulo: string;
  href: string;
  icono: string;
  descripcion: string;
  grupo: GrupoDeConfiguracion;
}

const RUTA_CONFIGURACION = CONFIGURACION.href;

const SECCIONES_DE_CONFIGURACION: ReadonlyArray<
  SeccionDeConfiguracion & { soloConEspejo?: true }
> = [
  {
    titulo: 'Qué puede hacer el asistente',
    href: `${RUTA_CONFIGURACION}/asistente`,
    icono: '🤖',
    descripcion: 'Agendar, cancelar y cambiar la fecha por el chat',
    grupo: 'asistente',
  },
  {
    titulo: 'Agenda que ofrece el asistente',
    href: `${RUTA_CONFIGURACION}/agenda`,
    icono: '🗓️',
    descripcion: 'Plazo, días sin citas, sábados, parte de la agenda y horarios',
    grupo: 'asistente',
  },
  {
    titulo: 'Recordatorios',
    href: `${RUTA_CONFIGURACION}/recordatorios`,
    icono: '🔔',
    descripcion: 'El mensaje antes de la cita, a quién y con cuánta anticipación',
    grupo: 'asistente',
  },
  {
    titulo: 'Nombre, tono y voz',
    href: `${RUTA_CONFIGURACION}/identidad`,
    icono: '🗣️',
    descripcion: 'Cómo se llama el asistente, cómo habla y su voz',
    grupo: 'asistente',
  },
  {
    titulo: 'Base de conocimiento',
    href: `${RUTA_CONFIGURACION}/conocimiento`,
    icono: '📚',
    descripcion: 'Lo que el asistente responde sobre la clínica',
    grupo: 'asistente',
  },
  {
    titulo: 'Datos de la clínica',
    href: `${RUTA_CONFIGURACION}/clinica`,
    icono: '🏢',
    descripcion: 'Teléfono de soporte, nombre, logo y responsable de los datos',
    grupo: 'clinica',
  },
  {
    titulo: 'Privacidad (Ley 1581)',
    href: `${RUTA_CONFIGURACION}/privacidad`,
    icono: '🔒',
    descripcion: 'Autorización de datos y la página pública de la política',
    grupo: 'clinica',
  },
  {
    titulo: 'Canales e IA',
    href: `${RUTA_CONFIGURACION}/canales`,
    icono: '🔌',
    descripcion: 'Inteligencia artificial, WhatsApp, plantillas y Telegram',
    grupo: 'conexiones',
  },
  {
    titulo: 'Hospital (espejo)',
    href: `${RUTA_CONFIGURACION}/hospital`,
    icono: '🏥',
    descripcion: 'Médicos nuevos del hospital y lo que se cambia en el espejo',
    grupo: 'conexiones',
    soloConEspejo: true,
  },
];

/**
 * Las secciones de Configuración de quien tiene ese menú. Salen del menú mismo:
 * ninguna si no tiene Configuración (solo el administrador la tiene), y la del
 * hospital solo si tiene el Espejo (la clínica tiene espejo). Las usan la
 * columna de Configuración, el Centro de ayuda y el asistente de soporte.
 */
export function seccionesDeConfiguracion(
  menus: readonly Pick<MenuItem, 'href'>[],
): SeccionDeConfiguracion[] {
  if (!menus.some((m) => m.href === RUTA_CONFIGURACION)) return [];
  const conEspejo = menus.some((m) => m.href === ESPEJO.href);
  return SECCIONES_DE_CONFIGURACION.filter(
    (s) => !s.soloConEspejo || conEspejo,
  ).map(({ soloConEspejo: _, ...s }) => s);
}

/** Las banderas del menú que dependen del espejo de una clínica (ver `getMenusForRole`). */
export interface BanderasDelEspejo {
  /** Hay espejo configurado (aunque esté apagado: el administrador lo ve para reactivarlo). */
  conEspejo: boolean;
  /** Espejo encendido con el driver de avisos masivos, estén o no encendidos. */
  conAvisosDriver: boolean;
  /** Además, los avisos masivos encendidos. */
  conAvisos: boolean;
  /** Espejo encendido con el driver de Anserma y el resumen de la atención habilitado. */
  conResumen: boolean;
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
    resumenAtencion?: unknown;
  } | null,
): BanderasDelEspejo {
  if (!config)
    return { conEspejo: false, conAvisosDriver: false, conAvisos: false, conResumen: false };
  const avisos = config.avisosMasivos as { enabled?: boolean } | null;
  const conAvisosDriver =
    config.enabled && config.driverKey === 'cnt-sanvicente-anserma';
  const resumen = config.resumenAtencion;
  return {
    conEspejo: true,
    conAvisosDriver,
    conAvisos: conAvisosDriver && !!avisos?.enabled,
    conResumen:
      conAvisosDriver &&
      typeof resumen === 'object' &&
      resumen !== null &&
      !Array.isArray(resumen),
  };
}
