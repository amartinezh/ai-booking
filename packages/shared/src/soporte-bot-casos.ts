/**
 * Los casos de Soporte en el asistente de Telegram (docs/PLAN_BOT_SOPORTE.md §3.4,
 * Fase 3). Lógica PURA: la API arma con esto lo que le muestra al empleado y lo
 * que le da a la IA.
 *
 *   · Sus casos: para «¿cómo va mi caso?» (la IA) y para /casos (texto fijo).
 *   · Los problemas técnicos que el equipo ya conoce (alertas técnicas abiertas),
 *     contados con frases FIJAS: nunca el detalle técnico de la alerta.
 *   · El borrador: cómo se le muestra antes del «Sí» y qué queda en el caso.
 */
import { formatAppointmentCompact } from './date-format';
import { haceCuanto } from './soporte-bot-prompt';
import {
  enmascararParaIA,
  type BorradorCaso,
  type CasoPropuesto,
} from './soporte-bot';
import { LIMITES_CASO, numeroDeCaso } from './soporte-caso';

// ─────────────────────────────────────────────────────────────
// Sus casos
// ─────────────────────────────────────────────────────────────

export type EstadoCaso = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export const ESTADO_DEL_CASO: Record<EstadoCaso, string> = {
  OPEN: 'Abierto, sin tomar todavía',
  IN_PROGRESS: 'En atención',
  RESOLVED: 'Solucionado',
};

export interface CasoDeLaPersona {
  numero: number;
  titulo: string;
  estado: EstadoCaso;
  creadoEn: Date;
  tomadoEn: Date | null;
  resueltoEn: Date | null;
  /** La respuesta del equipo (solo si está solucionado). */
  respuesta: string | null;
}

const recortar = (t: string, max: number) =>
  t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;

function lineaDeCaso(c: CasoDeLaPersona, timeZone?: string): string {
  const fecha = (d: Date) => formatAppointmentCompact(d, { timeZone });
  const cuando =
    c.estado === 'RESOLVED' && c.resueltoEn
      ? `solucionado el ${fecha(c.resueltoEn)}`
      : c.estado === 'IN_PROGRESS' && c.tomadoEn
        ? `en atención desde el ${fecha(c.tomadoEn)}`
        : `abierto el ${fecha(c.creadoEn)}, sin tomar todavía`;
  return `${numeroDeCaso(c.numero)} «${recortar(c.titulo, 90)}»: ${cuando}`;
}

/** Para la IA (con la respuesta del equipo enmascarada: puede nombrar datos). */
export function textoCasosParaLaIA(
  casos: CasoDeLaPersona[],
  timeZone?: string,
): string {
  const lineas = casos.map((c) => {
    const respuesta = c.respuesta
      ? `. Respuesta del equipo: ${enmascararParaIA(recortar(c.respuesta, 400), 400)}`
      : '';
    return `- ${lineaDeCaso(c, timeZone)}${respuesta}`;
  });
  return [
    '## Casos de soporte de esta persona (los más recientes)',
    '',
    ...(lineas.length ? lineas : ['- No tiene casos.']),
  ].join('\n');
}

/** Lo que responde /casos (sin IA). */
export function textoListaDeCasos(
  casos: CasoDeLaPersona[],
  timeZone?: string,
): string | null {
  if (casos.length === 0) return null;
  const lineas = casos.map((c) => {
    const respuesta =
      c.estado === 'RESOLVED' && c.respuesta
        ? `\n  Respuesta del equipo: ${recortar(c.respuesta, 160)}`
        : '';
    return `• ${lineaDeCaso(c, timeZone)}${respuesta}`;
  });
  return [
    'Tus casos más recientes:',
    '',
    ...lineas,
    '',
    'Para reportar algo nuevo, escribe /nuevo.',
  ].join('\n');
}

/** ¿Se le puede agregar una nota? Tiene que ser suyo y no estar solucionado. */
export function casoAmpliable(
  casos: CasoDeLaPersona[],
  numero: number | null,
): boolean {
  return (
    numero !== null &&
    casos.some((c) => c.numero === numero && c.estado !== 'RESOLVED')
  );
}

// ─────────────────────────────────────────────────────────────
// Lo que el equipo técnico ya sabe que falla
// ─────────────────────────────────────────────────────────────

export interface AlertaAbierta {
  kind: string;
  dedupeKey: string;
  organizationId: string | null;
  firstSeenAt: Date;
}

export interface IncidenteParaElPersonal {
  frase: string;
  desde: Date;
}

/** Los servicios del monitor, en palabras del personal (por clave del monitor). */
const SERVICIOS: Record<string, string> = {
  meta: 'WhatsApp (Meta) tiene fallas: el asistente de los pacientes puede no estar respondiendo por WhatsApp',
  telegram:
    'Telegram tiene fallas: el asistente de los pacientes puede no estar respondiendo por Telegram',
  tts: 'La voz del asistente de los pacientes tiene fallas',
  mirror:
    'La conexión con el hospital (espejo) tiene fallas: las citas pueden tardar en pasar entre AgenIA y el hospital',
  redis:
    'El servidor de sesiones del asistente tiene fallas: algunas conversaciones de los pacientes se pueden cortar',
};

/**
 * Las alertas técnicas abiertas que le sirven al personal de ESTA clínica, en frases
 * fijas. Solo las de la clínica y las globales; nada interno (errores 5xx,
 * arranques, tareas sueltas). La de Gemini, solo si la clínica usa Gemini.
 */
export function incidentesParaElPersonal(
  alertas: AlertaAbierta[],
  clinica: { organizationId: string; ia: string | null },
): IncidenteParaElPersonal[] {
  const vistos = new Set<string>();
  const salida: IncidenteParaElPersonal[] = [];
  for (const a of alertas) {
    if (a.organizationId && a.organizationId !== clinica.organizationId)
      continue;
    let frase: string | null = null;
    if (a.kind === 'SERVICIO_CAIDO' || a.kind === 'SERVICIO_DEGRADADO') {
      const clave = a.dedupeKey.replace(/^servicio:/, '').split(':')[0];
      if (clave === 'gemini') {
        frase =
          clinica.ia === 'Gemini'
            ? 'La inteligencia artificial de Gemini tiene fallas: el asistente de los pacientes puede responder sin IA'
            : null;
      } else {
        frase = SERVICIOS[clave] ?? null;
      }
    } else if (a.kind === 'REDIS_ERROR') {
      frase = SERVICIOS.redis;
    } else if (a.kind === 'RECORDATORIOS_FALLIDOS') {
      frase = 'Los recordatorios automáticos no están saliendo';
    } else if (a.kind === 'AVISO_AGENDADOR_NO_SALE') {
      frase =
        'El aviso por WhatsApp al agendador (Bandeja de sincronización) no está saliendo';
    }
    if (!frase || vistos.has(frase)) continue;
    vistos.add(frase);
    salida.push({ frase, desde: a.firstSeenAt });
  }
  return salida;
}

export function textoIncidentesParaLaIA(
  incidentes: IncidenteParaElPersonal[],
  ahora: Date,
  timeZone?: string,
): string {
  return [
    '## Problemas técnicos que el equipo ya conoce (y ya está atendiendo)',
    '',
    ...(incidentes.length
      ? incidentes.map(
          (i) =>
            `- ${i.frase}. Desde el ${formatAppointmentCompact(i.desde, { timeZone })} (${haceCuanto(i.desde, ahora)}).`,
        )
      : ['- Ninguno abierto ahora.']),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// El borrador
// ─────────────────────────────────────────────────────────────

/** El borrador para la IA, para que lo complete con lo nuevo. */
export function textoBorradorParaLaIA(
  b: BorradorCaso | null,
): string | undefined {
  if (!b) return undefined;
  return [
    '## Borrador de caso en curso (complétalo con lo nuevo)',
    '',
    `- Título: ${b.titulo ?? '(sin título todavía)'}`,
    `- Descripción: ${b.descripcion ? enmascararParaIA(b.descripcion, 1500) : '(sin descripción todavía)'}`,
    `- Pantalla: ${b.pantalla ?? '(no se sabe)'}`,
    `- Falta: ${b.falta.length ? b.falta.join('; ') : 'nada'}`,
  ].join('\n');
}

/** Lo que se le muestra al empleado antes del «Sí» (§3.4 paso 5). */
export function textoDelBorrador(b: BorradorCaso): string {
  return [
    'Este es el caso que abriría:',
    '',
    `«${b.titulo ?? ''}»`,
    `Prioridad: ${b.prioridad === 'HIGH' ? 'alta (frena la atención de pacientes)' : 'normal'}`,
    ...(b.pantalla ? [`Pantalla: ${b.pantalla}`] : []),
    `Detalle: ${recortar(b.descripcion ?? '', 700)}`,
    '',
    '¿Lo abro?',
  ].join('\n');
}

/**
 * La descripción que queda en el caso: el resumen y, debajo, lo que la persona
 * escribió tal cual. La IA nunca vio esos textos sin enmascarar; el equipo técnico
 * sí los necesita (una cédula, un teléfono) para investigar.
 */
export function descripcionDelCaso(p: {
  borrador: BorradorCaso;
  /** Lo que escribió la persona en la conversación, en orden. */
  textos: string[];
}): string {
  const partes = [p.borrador.descripcion ?? ''];
  if (p.borrador.pantalla) partes.push(`Pantalla: ${p.borrador.pantalla}`);
  const textos = p.textos
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith('/'));
  if (textos.length) {
    partes.push(
      ['Lo que escribió por Telegram:', ...textos.map((t) => `«${t}»`)].join(
        '\n',
      ),
    );
  }
  return partes.filter(Boolean).join('\n\n');
}

/** Fin de una frase, sin cortar en «Dr.», «Sra.» y similares. */
const FIN_DE_FRASE =
  /(?<=[.!?])(?<!\b(?:dr|dra|sr|sra|srta|ing|lic|enf|aux|dto)\.)\s/i;

/**
 * El borrador sin IA: con lo que escribió la persona. El título es la primera
 * frase (recortada y sin el punto final) y la descripción, todo lo que contó. Si no alcanza el largo
 * mínimo del caso, se le pide más.
 */
export function borradorSinIA(textos: string[]): CasoPropuesto {
  const limpios = textos
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith('/'));
  const todo = limpios.join(' ').replace(/\s+/g, ' ').trim();
  const primera = (limpios[0] ?? '')
    .split(FIN_DE_FRASE)[0]
    .replace(/\s+/g, ' ')
    .trim();
  // Un título no lleva punto final (sí «?» o «!»).
  const sinPunto = primera.replace(/\.+$/, '').trim();
  const titulo =
    sinPunto.length >= LIMITES_CASO.tituloMin ? recortar(sinPunto, 80) : null;
  const descripcion = todo.length >= LIMITES_CASO.detalleMin ? todo : null;
  return {
    titulo,
    descripcion,
    pantalla: null,
    falta:
      titulo && descripcion
        ? []
        : ['qué está pasando, con un poco más de detalle'],
  };
}
