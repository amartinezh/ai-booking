/**
 * Casos de Soporte (`SupportTicket`): las reglas que comparten el formulario del
 * panel y el asistente de soporte por Telegram, y los avisos al grupo del equipo
 * técnico (docs/PLAN_BOT_SOPORTE.md §3.4 y §3.5).
 *
 * ═══ Lo que no se negocia ═══
 *  · 🔒 El aviso al grupo NUNCA lleva la descripción ni la conversación: pueden
 *    tener datos de pacientes y Telegram está fuera de nuestra infraestructura. Por
 *    eso estas funciones ni siquiera la reciben. El título pasa por el mismo
 *    sanitizador de las alertas técnicas (documentos, teléfonos, correos y
 *    secretos), que NO reconoce nombres.
 *  · Sin IA: los textos los arma el código (regla de «Canales en vivo»).
 *  · Texto plano, como las alertas técnicas: un carácter mal escapado no puede
 *    hacer que el aviso se pierda.
 */
import {
  motivoParaNoEnviar,
  sanitizarTextoAlerta,
  type CategoriaAlerta,
  type GravedadAlerta,
} from './alertas-tecnicas';
import type { UserRole } from './menus';
import {
  HORARIO_EQUIPO_POR_DEFECTO,
  minutosHabilesEntre,
  type HorarioEquipo,
} from './soporte-horario';

/** Longitudes del caso. Las mismas en el panel (createTicket) y en el asistente. */
export const LIMITES_CASO = {
  tituloMin: 5,
  tituloMax: 140,
  detalleMin: 15,
} as const;

/** Lo que el aviso al grupo muestra del título: lo justo para reconocer el caso. */
export const MAX_TITULO_EN_AVISO = 100;

export const PRIORIDADES_CASO = ['NORMAL', 'HIGH'] as const;
export type PrioridadCaso = (typeof PRIORIDADES_CASO)[number];

export const CANALES_CASO = ['PANEL', 'TELEGRAM'] as const;
export type CanalCaso = (typeof CANALES_CASO)[number];

/** Qué se le agrega a un caso abierto (`SupportTicketNote.kind`). */
export const TIPOS_NOTA_CASO = ['AMPLIACION', 'REAPERTURA'] as const;
export type TipoNotaCaso = (typeof TIPOS_NOTA_CASO)[number];

/** Cómo se lee el rol en un aviso o en el chat. */
export const ROL_LEGIBLE: Record<UserRole, string> = {
  ORG_ADMIN: 'Administrador del Hospital',
  BOOKING_AGENT: 'Agente de Reservas',
  DOCTOR: 'Médico',
  GENERAL_OBSERVER: 'Observador general',
  SUPER_ADMIN: 'Equipo de AgenIA',
  PATIENT: 'Paciente',
};

/** «#58»: como se nombra un caso en el chat, en el grupo y en el panel. */
export function numeroDeCaso(numero: number): string {
  return `#${numero}`;
}

/**
 * Con qué gravedad sale el aviso de un caso por el canal de alertas técnicas: la
 * prioridad alta suena siempre, también de noche (S11); la normal llega sin sonido
 * en el horario nocturno de las alertas (`sinSonido`).
 */
export function gravedadDelAvisoDeCaso(
  prioridad: PrioridadCaso,
): GravedadAlerta {
  return prioridad === 'HIGH' ? 'CRITICA' : 'ADVERTENCIA';
}

export interface DatosAvisoCaso {
  numero: number;
  prioridad: PrioridadCaso;
  clinica: string;
  rol: UserRole;
  /** Correo de quien reporta (personal de la clínica, no un paciente). */
  correo: string;
  canal: CanalCaso;
  titulo: string;
  /** Dirección de la Mesa de Ayuda (`<dominio>/super-admin/support`). */
  enlace: string;
}

function tituloSeguro(titulo: string): string {
  return sanitizarTextoAlerta(titulo.replace(/\s+/g, ' '), MAX_TITULO_EN_AVISO);
}

function encabezado(icono: string, que: string, d: DatosAvisoCaso): string {
  const prioridad = d.prioridad === 'HIGH' ? ' · Prioridad ALTA' : '';
  return `${icono} ${que} ${numeroDeCaso(d.numero)}${prioridad}`;
}

function cuerpo(d: DatosAvisoCaso): string[] {
  const canal = d.canal === 'TELEGRAM' ? 'por Telegram' : 'por el panel';
  return [
    `Clínica: ${d.clinica}`,
    `Reporta: ${ROL_LEGIBLE[d.rol]} · ${d.correo} · ${canal}`,
    `«${tituloSeguro(d.titulo)}»`,
    `Abrir: ${d.enlace}`,
  ];
}

/** El aviso al grupo de un caso nuevo, se abra desde el panel o desde el asistente. */
export function textoAvisoCasoNuevo(d: DatosAvisoCaso): string {
  return [encabezado('🛟', 'Caso nuevo', d), ...cuerpo(d)].join('\n');
}

/** El recordatorio, una sola vez, de un caso que nadie toma en 2 h del horario. */
export function textoCasoSinTomar(
  d: DatosAvisoCaso,
  horasHabiles: number,
): string {
  const horas = horasHabiles === 1 ? '1 h' : `${horasHabiles} h`;
  return [
    `⏰ El caso ${numeroDeCaso(d.numero)} lleva ${horas} sin que nadie lo tome`,
    ...cuerpo(d),
  ].join('\n');
}

/** Quien lo reportó dijo «sigue pasando» después de resuelto. */
export function textoCasoReabierto(d: DatosAvisoCaso): string {
  return [encabezado('🔁', 'Caso reabierto', d), ...cuerpo(d)].join('\n');
}

// ─────────────────────────────────────────────────────────────
// El aviso al grupo: cuándo sale, cuándo espera y cuándo se deja (§3.5)
// ─────────────────────────────────────────────────────────────

const MS_MIN = 60_000;

export const AVISO_CASO_AL_GRUPO = {
  /**
   * Un caso que no se pudo anunciar en este tiempo ya no se anuncia: si el grupo se
   * conecta (o la categoría se enciende) después, no le llega una avalancha de casos
   * viejos. La Mesa de Ayuda lo muestra igual.
   */
  vigenciaHoras: 24,
  /** Intentos fallidos antes de dejarlo; entre uno y otro, 1 min, 2 min… hasta 15. */
  maxIntentos: 20,
  maxEsperaMin: 15,
  /** Avisos por vuelta del despachador: un desborde no tapa el grupo. */
  maxPorVuelta: 10,
  /** «Lleva 2 h sin que nadie lo tome», contadas en el horario del equipo (S12). */
  sinTomarMinutos: 120,
} as const;

/** Por qué un aviso espera: se reintenta cuando cambie. */
export type MotivoEsperaAvisoCaso =
  | 'SIN_CANAL'
  | 'APAGADO'
  | 'CATEGORIA_APAGADA'
  | 'SILENCIADO';
/** Por qué un aviso no va a salir nunca. */
export type MotivoOmitirAvisoCaso = 'YA_TOMADO' | 'VENCIDO' | 'FALLIDO';

/** Lo que la Mesa de Ayuda muestra cuando el aviso no salió. */
export const TEXTO_SIN_AVISO_CASO: Record<
  MotivoEsperaAvisoCaso | MotivoOmitirAvisoCaso,
  string
> = {
  SIN_CANAL: 'El grupo de alertas técnicas no está conectado.',
  APAGADO: 'Las alertas técnicas están apagadas.',
  CATEGORIA_APAGADA:
    'La categoría «Casos de soporte» de las alertas técnicas está apagada.',
  SILENCIADO: 'Las alertas técnicas están silenciadas.',
  YA_TOMADO: 'Lo tomaron antes de que saliera el aviso.',
  VENCIDO: 'Pasaron 24 horas sin poder avisar.',
  FALLIDO: 'No se pudo avisar después de varios intentos.',
};

/** Lo que dicen las alertas técnicas sobre el canal, para los casos. */
export function motivoEsperaAvisoCaso(
  canal: {
    enabled: boolean;
    categories: Record<CategoriaAlerta, boolean>;
    mutedUntilIso: string | null;
  } | null,
  ahora: Date,
): MotivoEsperaAvisoCaso | null {
  if (!canal) return 'SIN_CANAL';
  return motivoParaNoEnviar('CASOS_SOPORTE', canal, ahora.toISOString());
}

export type PasoAvisoCaso =
  | { tipo: 'ENVIAR' }
  | { tipo: 'ESPERAR'; motivo: MotivoEsperaAvisoCaso | null }
  | { tipo: 'OMITIR'; motivo: MotivoOmitirAvisoCaso };

/**
 * Qué hacer con un caso cuyo aviso está pendiente. Solo se anuncia un caso abierto
 * (si ya lo tomaron, el grupo ya lo sabe). `updatedAt` es la última vez que se tocó
 * el caso: cada intento la mueve, así que también marca la espera entre intentos.
 */
export function pasoDelAvisoAlGrupo(
  caso: { status: string; groupNoticeAttempts: number; updatedAt: Date },
  espera: MotivoEsperaAvisoCaso | null,
  ahora: Date,
): PasoAvisoCaso {
  const { vigenciaHoras, maxIntentos, maxEsperaMin } = AVISO_CASO_AL_GRUPO;
  if (caso.status !== 'OPEN') return { tipo: 'OMITIR', motivo: 'YA_TOMADO' };
  if (caso.groupNoticeAttempts >= maxIntentos) {
    return { tipo: 'OMITIR', motivo: 'FALLIDO' };
  }
  const quieto = ahora.getTime() - caso.updatedAt.getTime();
  if (quieto > vigenciaHoras * 60 * MS_MIN) {
    return { tipo: 'OMITIR', motivo: 'VENCIDO' };
  }
  if (espera) return { tipo: 'ESPERAR', motivo: espera };
  const pausa = Math.min(caso.groupNoticeAttempts, maxEsperaMin) * MS_MIN;
  if (quieto < pausa) return { tipo: 'ESPERAR', motivo: null };
  return { tipo: 'ENVIAR' };
}

/**
 * ¿Toca el «lleva 2 h sin que nadie lo tome»? Una sola vez, solo si el aviso del
 * caso salió (sin él, el recordatorio no tiene a qué referirse) y contando las horas
 * del horario del equipo desde que el grupo se enteró.
 */
export function tocaRecordarSinTomar(
  caso: {
    status: string;
    groupNotice: string;
    groupNotifiedAt: Date | null;
    unattendedRemindedAt: Date | null;
  },
  ahora: Date,
  horario: HorarioEquipo = HORARIO_EQUIPO_POR_DEFECTO,
): boolean {
  if (caso.status !== 'OPEN' || caso.groupNotice !== 'SENT') return false;
  if (!caso.groupNotifiedAt || caso.unattendedRemindedAt) return false;
  return (
    minutosHabilesEntre(caso.groupNotifiedAt, ahora, horario) >=
    AVISO_CASO_AL_GRUPO.sinTomarMinutos
  );
}

export type EstadoAvisoAlGrupo =
  | { tipo: 'ENVIADO'; cuando: Date; recordado: Date | null }
  | { tipo: 'PENDIENTE'; motivo: string | null }
  | { tipo: 'SIN_AVISO'; motivo: string | null };

/** El estado del aviso para la Mesa de Ayuda. Los casos de antes del asistente no lo muestran. */
export function estadoDelAvisoAlGrupo(c: {
  groupNotice: string;
  groupNotifiedAt: Date | string | null;
  groupNoticeError: string | null;
  unattendedRemindedAt: Date | string | null;
}): EstadoAvisoAlGrupo | null {
  const fecha = (d: Date | string | null) =>
    d === null ? null : typeof d === 'string' ? new Date(d) : d;
  if (c.groupNotice === 'SENT' && c.groupNotifiedAt) {
    return {
      tipo: 'ENVIADO',
      cuando: fecha(c.groupNotifiedAt) as Date,
      recordado: fecha(c.unattendedRemindedAt),
    };
  }
  if (c.groupNotice === 'PENDING') {
    return { tipo: 'PENDIENTE', motivo: c.groupNoticeError };
  }
  // SKIPPED sin motivo: un caso de antes del asistente, que nunca se iba a anunciar.
  return c.groupNoticeError
    ? { tipo: 'SIN_AVISO', motivo: c.groupNoticeError }
    : null;
}
