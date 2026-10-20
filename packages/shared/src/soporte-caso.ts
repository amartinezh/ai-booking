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
import { sanitizarTextoAlerta, type GravedadAlerta } from './alertas-tecnicas';
import type { UserRole } from './menus';

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
