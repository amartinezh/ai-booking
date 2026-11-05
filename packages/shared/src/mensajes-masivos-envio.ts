/**
 * ══════════════════════════════════════════════════════════════════════════
 * 📢 MENSAJES MASIVOS — reglas del envío (docs/PLAN_MENSAJES_MASIVOS.md §8 y §9)
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  - HORARIO: la Ley 2300 de 2023 («dejen de fregar») limita los mensajes de
 *    publicidad y cobranza a lunes a viernes de 7:00 a. m. a 7:00 p. m. y sábados
 *    de 8:00 a. m. a 3:00 p. m., nunca domingos ni festivos. Un comunicado de la
 *    clínica puede leerse como publicidad, así que se respeta siempre: fuera del
 *    horario el envío espera, no se pierde.
 *  - BAJA: quien escribe «no más comunicados» (o «stop») no vuelve a recibir
 *    mensajes masivos de la clínica. Frases fijas, sin IA, como la baja de los
 *    recordatorios: es una decisión sobre sus datos.
 *  - ERRORES DE META: el código que devuelve Meta, en palabras de la pantalla, y
 *    si vale la pena reintentar.
 *
 * Puro: lo usan la API (antes de enviar) y la web (la pantalla).
 */
import { DEFAULT_TIMEZONE } from './date-format';
import { esFestivoColombia } from './festivos-colombia';
import { horaLocalAUtc } from './rango-estadisticas';

// ─── Estados ────────────────────────────────────────────────────────────────

export type EstadoEnvioMasivo = 'BORRADOR' | 'EN_COLA' | 'ENVIANDO' | 'PAUSADO' | 'TERMINADO' | 'CANCELADO';

export const ETIQUETA_ESTADO_ENVIO: Record<EstadoEnvioMasivo, string> = {
  BORRADOR: 'Borrador',
  EN_COLA: 'En cola',
  ENVIANDO: 'Enviando',
  PAUSADO: 'En pausa',
  TERMINADO: 'Terminado',
  CANCELADO: 'Cancelado',
};

export type ResultadoDestinatario = 'PENDIENTE' | 'ENVIADO' | 'FALLIDO' | 'OMITIDO';

export type MotivoOmision = 'BAJA' | 'BAJA_EN_META' | 'CANCELADO' | 'CELULAR_INVALIDO';

export const ETIQUETA_OMISION: Record<MotivoOmision, string> = {
  BAJA: 'Pidió no recibir más comunicados',
  BAJA_EN_META: 'Bloqueó los mensajes de la clínica en WhatsApp',
  CANCELADO: 'El envío se canceló antes de llegarle',
  CELULAR_INVALIDO: 'El celular no es válido',
};

/** Los envíos que la API trabaja (los demás esperan a una persona). */
export const ESTADOS_ENVIO_ACTIVOS: readonly EstadoEnvioMasivo[] = ['EN_COLA', 'ENVIANDO'];

export const LIMITES_ENVIO = {
  /** Mensajes por minuto por defecto: suave con la calidad del número. */
  ritmoPorDefecto: 60,
  ritmoMinimo: 10,
  ritmoMaximo: 300,
  /** Destinatarios por envío. */
  maxDestinatarios: 10_000,
} as const;

// ─── Horario (Ley 2300 de 2023) ─────────────────────────────────────────────

/** Minutos desde la medianoche: [desde, hasta). */
export const HORARIO_COMUNICADOS = {
  semana: [7 * 60, 19 * 60] as const,
  sabado: [8 * 60, 15 * 60] as const,
};

export const TEXTO_HORARIO_COMUNICADOS =
  'de lunes a viernes de 7:00 a. m. a 7:00 p. m. y los sábados de 8:00 a. m. a 3:00 p. m., nunca domingos ni festivos (Ley 2300 de 2023)';

interface FechaLocal {
  y: number;
  m: number;
  d: number;
}

function fechaLocal(instante: Date, zona: string): FechaLocal {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return { y: v('year'), m: v('month'), d: v('day') };
}

function sumarDias(f: FechaLocal, n: number): FechaLocal {
  const t = new Date(Date.UTC(f.y, f.m - 1, f.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const iso = (f: FechaLocal) => `${f.y}-${String(f.m).padStart(2, '0')}-${String(f.d).padStart(2, '0')}`;

function minutoAUtc(f: FechaLocal, min: number, zona: string): Date {
  return new Date(horaLocalAUtc(f.y, f.m, f.d, Math.floor(min / 60), zona).getTime() + (min % 60) * 60_000);
}

/** La jornada de envío de una fecha, o `null` si ese día no se envía. */
function jornada(f: FechaLocal, zona: string): { abre: Date; cierra: Date } | null {
  const dia = new Date(Date.UTC(f.y, f.m - 1, f.d)).getUTCDay();
  if (dia === 0 || esFestivoColombia(iso(f))) return null;
  const [desde, hasta] = dia === 6 ? HORARIO_COMUNICADOS.sabado : HORARIO_COMUNICADOS.semana;
  return { abre: minutoAUtc(f, desde, zona), cierra: minutoAUtc(f, hasta, zona) };
}

/** ¿Puede salir un mensaje masivo en este instante? */
export function puedeEnviarComunicadoAhora(ahora: Date, timeZone: string = DEFAULT_TIMEZONE): boolean {
  const j = jornada(fechaLocal(ahora, timeZone), timeZone);
  return !!j && ahora >= j.abre && ahora < j.cierra;
}

/** Cuándo vuelve a poder salir: `ahora` si ya puede; si no, la próxima apertura. */
export function proximaVentanaDeComunicados(ahora: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  const hoy = fechaLocal(ahora, timeZone);
  for (let i = 0; i <= 15; i++) {
    const j = jornada(sumarDias(hoy, i), timeZone);
    if (!j || ahora >= j.cierra) continue;
    return ahora >= j.abre ? ahora : j.abre;
  }
  return ahora;
}

/** Cuándo cierra la jornada en curso (`null` fuera del horario). */
export function cierreDeLaJornada(ahora: Date, timeZone: string = DEFAULT_TIMEZONE): Date | null {
  const j = jornada(fechaLocal(ahora, timeZone), timeZone);
  return j && ahora >= j.abre && ahora < j.cierra ? j.cierra : null;
}

/**
 * Cuánto tarda un envío a un ritmo dado, contando solo el horario permitido:
 * minutos de envío y cuándo terminaría si empieza `desde`.
 */
export function estimarDuracion(
  destinatarios: number,
  ritmoPorMinuto: number,
  desde: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): { minutos: number; terminaria: Date } {
  const minutos = Math.ceil(destinatarios / Math.max(1, ritmoPorMinuto));
  let restante = minutos * 60_000;
  let cursor = proximaVentanaDeComunicados(desde, timeZone);
  for (let vuelta = 0; vuelta < 60 && restante > 0; vuelta++) {
    const cierre = cierreDeLaJornada(cursor, timeZone);
    if (!cierre) {
      cursor = proximaVentanaDeComunicados(new Date(cursor.getTime() + 60_000), timeZone);
      continue;
    }
    const disponible = cierre.getTime() - cursor.getTime();
    if (disponible >= restante) return { minutos, terminaria: new Date(cursor.getTime() + restante) };
    restante -= disponible;
    cursor = proximaVentanaDeComunicados(cierre, timeZone);
  }
  return { minutos, terminaria: cursor };
}

// ─── Baja ───────────────────────────────────────────────────────────────────

const normalizar = (texto: string | null | undefined) =>
  (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const OBJETO = '(comunicados?|mensajes? masivos?|mensajes?|avisos? masivos?|publicidad|promociones|campanas?)';

/**
 * ¿Pide dejar de recibir mensajes masivos, o volver a recibirlos? Frases fijas.
 * «no quiero más recordatorios» NO es esto (lo atiende la baja de recordatorios),
 * y «baja» o «salir» a secas tampoco: el asistente ya les da otro sentido.
 */
export function intencionDeComunicados(texto: string | null | undefined): 'BAJA' | 'ALTA' | null {
  const t = normalizar(texto);
  if (!t || t.includes('recordatorio')) return null;
  if (/^(stop|detener promociones|stop promotions|parar promociones|no mas comunicados|no mas mensajes masivos)$/.test(t)) return 'BAJA';
  if (new RegExp(`^(activar|activen|si quiero|quiero volver a recibir|quiero recibir|volver a recibir)( los| sus)? ${OBJETO}$`).test(t)) return 'ALTA';
  const baja =
    new RegExp(`^(no|ya no) (quiero|deseo|me interesa)( mas| recibir| seguir recibiendo)*( los| sus| estos| esos)? ${OBJETO}( de (la )?(clinica|ustedes))?$`).test(t) ||
    new RegExp(`^(no|ya no) (me )?(envien|manden|escriban)( mas)?( los| sus| estos)? ${OBJETO}$`).test(t) ||
    new RegExp(`^(baja|dar de baja|darme de baja|quitar|quitenme|cancelar|desactivar|desactiven|dejen de enviar(me)?|dejen de mandar(me)?)( de)?( los| mis| sus)? ${OBJETO}$`).test(t) ||
    new RegExp(`^no (mas|recibir( mas)?) ${OBJETO}$`).test(t);
  return baja ? 'BAJA' : null;
}

export const TEXTOS_BAJA_COMUNICADOS = {
  baja:
    'Listo: no le enviaremos más comunicados de la clínica por este medio. Sus recordatorios de citas siguen igual (si tampoco los quiere, escriba «no quiero recordatorios»). Si cambia de opinión, escriba «activar comunicados».',
  alta: 'Listo: volverá a recibir los comunicados de la clínica. Para dejar de recibirlos, escriba «no más comunicados».',
} as const;

/** La clave con la que se guarda una baja: «+57…» para un teléfono, el BSUID tal cual si no lo es. */
export function claveDeBaja(remitente: string): string {
  const t = (remitente ?? '').trim();
  if (/^\+?\d{8,15}$/.test(t)) return `+${t.replace(/^\+/, '')}`;
  return t;
}

// ─── Errores de Meta ────────────────────────────────────────────────────────

export interface ErrorDeEnvioExplicado {
  codigo: string | null;
  motivo: string;
  /** Tiene sentido volver a intentarlo más tarde. */
  reintentable: boolean;
  /** El problema es de la clínica (plantilla, número, token), no de la persona: hay que detener el envío. */
  detieneElEnvio: boolean;
}

const ERRORES_META: Record<string, Omit<ErrorDeEnvioExplicado, 'codigo'>> = {
  '131026': { motivo: 'Ese número no tiene WhatsApp o no puede recibir el mensaje.', reintentable: false, detieneElEnvio: false },
  '131049': {
    motivo: 'Meta no lo entregó para no saturar a la persona con mensajes de empresas (límite de mensajes de marketing por persona).',
    reintentable: true,
    detieneElEnvio: false,
  },
  '131050': { motivo: 'La persona bloqueó los mensajes de marketing de la clínica en WhatsApp.', reintentable: false, detieneElEnvio: false },
  '131047': { motivo: 'Pasaron más de 24 horas desde su último mensaje: solo se le puede escribir con una plantilla.', reintentable: false, detieneElEnvio: false },
  '131051': { motivo: 'WhatsApp no admite ese tipo de mensaje.', reintentable: false, detieneElEnvio: false },
  '131052': { motivo: 'WhatsApp no pudo descargar la imagen.', reintentable: true, detieneElEnvio: false },
  '131053': { motivo: 'WhatsApp no pudo procesar la imagen.', reintentable: false, detieneElEnvio: true },
  '131056': { motivo: 'Demasiados mensajes seguidos al mismo número.', reintentable: true, detieneElEnvio: false },
  '130429': { motivo: 'Se superó el ritmo de envío que permite Meta.', reintentable: true, detieneElEnvio: false },
  '131048': { motivo: 'Meta frenó los envíos por la calidad del número (muchos bloqueos o reportes).', reintentable: true, detieneElEnvio: true },
  '131000': { motivo: 'Falla temporal de WhatsApp.', reintentable: true, detieneElEnvio: false },
  '131016': { motivo: 'WhatsApp está con fallas en este momento.', reintentable: true, detieneElEnvio: false },
  '132000': { motivo: 'La plantilla aprobada en Meta no tiene las 2 variables (nombre y mensaje).', reintentable: false, detieneElEnvio: true },
  '132001': { motivo: 'La plantilla no existe en Meta con ese nombre e idioma.', reintentable: false, detieneElEnvio: true },
  '132005': { motivo: 'El mensaje, con el nombre y el texto de la plantilla, supera el largo que acepta WhatsApp.', reintentable: false, detieneElEnvio: true },
  '132007': { motivo: 'Meta rechazó el contenido del mensaje por sus políticas.', reintentable: false, detieneElEnvio: true },
  '132012': { motivo: 'La plantilla no casa con lo enviado (¿lleva imagen y se envió sin ella, o al revés?).', reintentable: false, detieneElEnvio: true },
  '132015': { motivo: 'Meta pausó la plantilla por su calidad.', reintentable: false, detieneElEnvio: true },
  '132016': { motivo: 'Meta desactivó la plantilla.', reintentable: false, detieneElEnvio: true },
  '131008': { motivo: 'Falta un dato obligatorio del mensaje.', reintentable: false, detieneElEnvio: true },
  '131009': { motivo: 'Un dato del mensaje no es válido (¿saltos de línea en el texto?).', reintentable: false, detieneElEnvio: true },
  '100': { motivo: 'Un dato del mensaje no es válido (¿saltos de línea o espacios de más en el texto?).', reintentable: false, detieneElEnvio: true },
  '131031': { motivo: 'Meta bloqueó la cuenta de WhatsApp de la clínica.', reintentable: false, detieneElEnvio: true },
  '131042': { motivo: 'Hay un problema con el medio de pago de la cuenta de WhatsApp en Meta.', reintentable: false, detieneElEnvio: true },
  '133010': { motivo: 'El número de la clínica no está registrado en WhatsApp.', reintentable: false, detieneElEnvio: true },
  '190': { motivo: 'El token de Meta venció: hay que renovarlo en Configuración → WhatsApp.', reintentable: false, detieneElEnvio: true },
  '10': { motivo: 'El token de Meta no tiene permiso para enviar.', reintentable: false, detieneElEnvio: true },
  '200': { motivo: 'El token de Meta no tiene permiso para enviar.', reintentable: false, detieneElEnvio: true },
  '368': { motivo: 'Meta bloqueó temporalmente los envíos de la cuenta.', reintentable: true, detieneElEnvio: true },
};

const ERRORES_PROPIOS: Record<string, Omit<ErrorDeEnvioExplicado, 'codigo'>> = {
  'template-not-configured': { motivo: 'La clínica no tiene registrada la plantilla del comunicado.', reintentable: false, detieneElEnvio: true },
  'whatsapp-inactive': { motivo: 'WhatsApp está apagado o sin configurar para la clínica.', reintentable: false, detieneElEnvio: true },
  'body-params-mismatch': { motivo: 'El mensaje no tiene las variables que espera la plantilla.', reintentable: false, detieneElEnvio: true },
  'imagen-no-subio': { motivo: 'No se pudo subir la imagen a WhatsApp.', reintentable: true, detieneElEnvio: true },
};

/** El código de error de Meta dentro del texto que guardó el envío (su JSON o un mensaje). */
export function codigoDeErrorMeta(error: string | null | undefined): string | null {
  const t = error ?? '';
  const anidado = t.match(/"code"\s*:\s*(\d+)/g);
  if (anidado?.length) {
    // El más específico es el último (error_data / errors[0].code van después de error.code).
    const codigos = anidado.map((m) => m.replace(/\D/g, ''));
    return codigos.find((c) => c.length >= 6) ?? codigos[0];
  }
  return t.match(/\b(1[3]\d{4})\b/)?.[1] ?? null;
}

export function explicarErrorDeEnvio(error: string | null | undefined): ErrorDeEnvioExplicado {
  const t = (error ?? '').trim();
  if (t in ERRORES_PROPIOS) return { codigo: null, ...ERRORES_PROPIOS[t] };
  const codigo = codigoDeErrorMeta(t);
  if (codigo && codigo in ERRORES_META) return { codigo, ...ERRORES_META[codigo] };
  if (/timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|5\d\d/i.test(t)) {
    return { codigo, motivo: 'No hubo respuesta de WhatsApp a tiempo.', reintentable: true, detieneElEnvio: false };
  }
  return { codigo, motivo: t ? `WhatsApp rechazó el mensaje (${codigo ?? 'sin código'}).` : 'Error desconocido.', reintentable: false, detieneElEnvio: false };
}

// ─── Plantillas ─────────────────────────────────────────────────────────────

/** El cuerpo que se sugiere aprobar en Meta (2 variables: nombre y mensaje). */
export const CUERPO_SUGERIDO_COMUNICADO =
  'Hola {{1}}, tenemos un comunicado para usted:\n\n{{2}}\n\nSi no desea recibir más comunicados, responda NO MÁS COMUNICADOS.';

/** Cuántas variables `{{n}}` distintas tiene el cuerpo de una plantilla. */
export function variablesDelCuerpo(cuerpo: string): number {
  return new Set((cuerpo.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((v) => v.replace(/\D/g, ''))).size;
}
