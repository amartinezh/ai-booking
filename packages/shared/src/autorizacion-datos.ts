/**
 * ══════════════════════════════════════════════════════════════════════════
 * 🔒 AUTORIZACIÓN DE TRATAMIENTO DE DATOS (Ley 1581 de 2012) — 2026-11-20
 * ══════════════════════════════════════════════════════════════════════════
 *
 * docs/PLAN_AUTORIZACION_DATOS.md. Con el interruptor encendido
 * (Configuración › Asistente Virtual, «Autorización de datos»), el asistente
 * saluda, explica para qué usa los datos y pregunta SÍ o NO ANTES de agendar:
 *
 *  - SÍ: queda guardado (una vez por número, por canal y por versión de la
 *    política) y sigue con lo que la persona necesita.
 *  - NO: se despide con amabilidad y le da el teléfono y la ventanilla; la
 *    próxima vez que escriba para agendar se le vuelve a preguntar.
 *  - No se pregunta para cancelar, cambiar la fecha o consultar una cita, ni al
 *    responder un recordatorio, una oferta de la lista de espera o los
 *    documentos de la consulta. La emergencia siempre va primero.
 *  - «Retiro mi autorización» (frases fijas, sin IA) la retira.
 *
 * Aquí viven las reglas puras: los textos (los mismos para el chat y la vista
 * previa del panel), la lectura ESTRICTA del SÍ/NO, la frase para retirarla, las
 * validaciones del panel y las cifras de las estadísticas. Sin base de datos.
 */
import { diaLocal } from './consulta-citas';

export const AUTORIZACION_DATOS = {
  /** La versión con la que nace la política de cada clínica. */
  VERSION_POR_DEFECTO: '1',
  MAX_VERSION: 20,
  MAX_URL: 300,
  /**
   * Cuántas veces se le recuerda la pregunta en la misma conversación, después
   * del aviso completo, antes de cerrarla.
   */
  RECORDATORIOS: 3,
  /** Lo que se guarda de la respuesta (la prueba): un «sí» cabe de sobra. */
  MAX_RESPUESTA_GUARDADA: 500,
  /**
   * Una pregunta sin respuesta pasa a «no respondió» cuando ya cerró la
   * conversación (la sesión del chat dura una hora).
   */
  MINUTOS_SIN_RESPUESTA: 60,
} as const;

export type EstiloAviso = 'FORMAL' | 'INFORMAL';
export type RespuestaAutorizacion = 'SI' | 'NO';
export type EstadoAutorizacion = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REVOKED';
export type CanalAutorizacion = 'WHATSAPP' | 'TELEGRAM';

const normalizar = (texto: string | null | undefined): string =>
  (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ─── ¿Respondió SÍ o NO? ───────────────────────────────────────────────────

/** «No entiendo», «no sé»: una duda, no un NO. Se le vuelve a explicar. */
const NO_ES_DUDA =
  /^no (entiendo|entendi|comprendo|se|sabia|tengo claro|me queda claro|me quedo claro)\b/;
const NO_EXPLICITO =
  /\b(no (acepto|autorizo|lo autorizo|estoy de acuerdo|doy (mi |la )?autorizacion|deseo|quiero|gracias))\b/;
const NO_AL_INICIO = /^(no|nop|nel|negativo|nunca|para nada|tampoco)\b/;
const SI_AL_INICIO =
  /^(si|sii+|sip|sisas|claro|dale|ok|okay|oka|okey|listo|bueno|vale|de acuerdo|acepto|autorizo|correcto|por supuesto|afirmativo|de una|esta bien|perfecto|con gusto|hagale)\b/;
const SI_EXPLICITO =
  /\b(acepto|autorizo|lo autorizo|estoy de acuerdo|doy (mi |la )?autorizacion)\b/;
/** Un pulgar arriba solo, como en el resto del chat. */
const SI_EMOJI = /^\s*(👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿|✅|👌|✔️|☑️)+\s*$/u;

/**
 * ¿La respuesta a «¿Autoriza el tratamiento de sus datos?» es SÍ o NO? Más
 * estricta que el SÍ/NO del resto del chat: «quiero una cita» NO autoriza nada
 * (allá «quiero» cuenta como sí), y «no entiendo» no es un NO. Lo que no es
 * claro devuelve null: el chat lo atiende como un mensaje más y, si la persona
 * sigue queriendo agendar, le vuelve a preguntar.
 */
export function respuestaAutorizacion(
  texto: string | null | undefined,
): RespuestaAutorizacion | null {
  if (typeof texto === 'string' && SI_EMOJI.test(texto)) return 'SI';
  const t = normalizar(texto);
  if (!t) return null;
  if (NO_ES_DUDA.test(t)) return null;
  if (NO_EXPLICITO.test(t) || NO_AL_INICIO.test(t)) return 'NO';
  if (SI_AL_INICIO.test(t) || SI_EXPLICITO.test(t)) return 'SI';
  return null;
}

// ─── Retirar la autorización ───────────────────────────────────────────────

const PIDE = '(quiero |deseo |necesito |solicito |por favor )?';
const POR_FAVOR = '( por favor)?';
const OBJETO = '(autorizacion|consentimiento|permiso)';
const SOBRE_DATOS =
  '( (de|del|para el|para|sobre el|sobre) (tratamiento|uso|manejo) (de )?(mis |los )?datos( personales)?| (de|sobre|para) (mis |los )?datos( personales)?)?';
const RETIRAR = new RegExp(
  `^${PIDE}(retirar|revocar|retiro|revoco|quitar|quito|cancelar|anular) (mi |la |el )?${OBJETO}${SOBRE_DATOS}${POR_FAVOR}$`,
);
const SUPRIMIR = new RegExp(
  `^${PIDE}(que )?(borren|eliminen|supriman|borrar|eliminar|suprimir) (todos )?(mis|los) datos( personales)?${POR_FAVOR}$`,
);
const YA_NO_AUTORIZO = new RegExp(
  `^(ya )?no autorizo (el |que usen |que manejen )?(tratamiento|uso|manejo)?( de)? ?(mis )?datos( personales)?${POR_FAVOR}$`,
);

/**
 * ¿Pide retirar su autorización (o que borren sus datos)? Frases fijas, sin IA:
 * es una decisión sobre sus datos y no puede quedar a interpretación. «Cancelar
 * cita» o «no quiero recordatorios» NO son esto.
 */
export function pideRetirarAutorizacion(texto: string | null | undefined): boolean {
  const t = normalizar(texto);
  if (!t) return false;
  return RETIRAR.test(t) || SUPRIMIR.test(t) || YA_NO_AUTORIZO.test(t);
}

// ─── Textos ────────────────────────────────────────────────────────────────

export interface DatosDelAviso {
  estilo: EstiloAviso;
  /** El nombre del asistente («Vicente»). */
  asistente: string;
  /** El nombre de la clínica, que es la responsable de los datos. */
  clinica: string;
  /** La política completa; sin ella el aviso sigue, sin el enlace. */
  urlPolitica: string | null;
}

const lineaPolitica = (estilo: EstiloAviso, url: string | null) =>
  url
    ? `\n📄 ${estilo === 'FORMAL' ? 'Política de tratamiento de datos' : 'Política de datos'}: ${url}`
    : '';

/**
 * El primer mensaje: saludo, para qué se usan los datos, que los de salud son
 * sensibles y no está obligado a autorizarlos, sus derechos, la ley, el enlace a
 * la política y la pregunta. Es el texto exacto que se guarda como prueba.
 */
export function avisoAutorizacionDatos(d: DatosDelAviso): string {
  const politica = lineaPolitica(d.estilo, d.urlPolitica);
  if (d.estilo === 'INFORMAL') {
    return (
      `¡Hola! 😊 Soy *${d.asistente}*, el asistente virtual de *${d.clinica}*.\n\n` +
      `Antes de empezar necesito tu autorización. Para atenderte por este chat, ${d.clinica} usa tus datos personales y los de las personas por quienes agendes (por ejemplo, tus hijos menores), incluidos datos de salud, solo para agendar, recordar y gestionar tus citas y enviarte información de tu atención.\n\n` +
      `Los datos de salud son sensibles: no estás obligado(a) a autorizar su tratamiento. Puedes conocer, actualizar, corregir o suprimir tus datos, o retirar esta autorización cuando quieras (Ley 1581 de 2012).` +
      `${politica}\n\n` +
      `*¿Autorizas el tratamiento de tus datos?* Responde *SÍ* o *NO*.`
    );
  }
  return (
    `Le saluda *${d.asistente}*, asistente virtual de *${d.clinica}*. 😊\n\n` +
    `Antes de empezar necesito su autorización. Para atenderle por este chat, ${d.clinica} usa sus datos personales y los de las personas por quienes agende (por ejemplo, sus hijos menores), incluidos datos de salud, solo para agendar, recordar y gestionar sus citas y enviarle información de su atención.\n\n` +
    `Los datos de salud son sensibles: usted no está obligado(a) a autorizar su tratamiento. Puede conocer, actualizar, corregir o suprimir sus datos, o retirar esta autorización cuando quiera (Ley 1581 de 2012).` +
    `${politica}\n\n` +
    `*¿Autoriza el tratamiento de sus datos?* Responda *SÍ* o *NO*.`
  );
}

/** Lo que dice el audio cuando la persona viene hablando: el detalle va escrito. */
export function avisoAutorizacionDatosHablado(d: DatosDelAviso): string {
  return d.estilo === 'INFORMAL'
    ? `Hola, soy ${d.asistente}, de ${d.clinica}. Antes de empezar necesito tu autorización para usar tus datos personales, incluidos los de salud, solo para gestionar tus citas. Te dejé por escrito los detalles y la política. ¿Autorizas el tratamiento de tus datos? Respóndeme sí o no.`
    : `Le saluda ${d.asistente}, de ${d.clinica}. Antes de empezar necesito su autorización para usar sus datos personales, incluidos los de salud, solo para gestionar sus citas. Le dejé por escrito los detalles y la política. ¿Autoriza el tratamiento de sus datos? Respóndame sí o no.`;
}

/** Cuando escribe otra cosa y sigue queriendo agendar: la pregunta, corta. */
export function recordatorioAutorizacionDatos(
  estilo: EstiloAviso,
  urlPolitica: string | null,
): string {
  const politica = lineaPolitica(estilo, urlPolitica);
  return estilo === 'INFORMAL'
    ? `Para seguir necesito tu respuesta: *¿autorizas el tratamiento de tus datos personales, incluidos los de salud, para gestionar tus citas?* Responde *SÍ* o *NO*.${politica}\n\n` +
        `_Si lo que necesitas es cancelar, cambiar o consultar una cita que ya tienes, escríbelo y te ayudo._`
    : `Para continuar necesito su respuesta: *¿autoriza el tratamiento de sus datos personales, incluidos los de salud, para gestionar sus citas?* Responda *SÍ* o *NO*.${politica}\n\n` +
        `_Si lo que necesita es cancelar, cambiar o consultar una cita que ya tiene, escríbalo y le ayudo._`;
}

/** Va pegado al comienzo de lo que sigue (el menú de servicios), o solo. */
export function autorizacionAceptada(estilo: EstiloAviso): string {
  return estilo === 'INFORMAL'
    ? '¡Gracias! ✅ Quedó registrada tu autorización.'
    : '¡Gracias! ✅ Quedó registrada su autorización.';
}

/**
 * NO: el chat se cierra, pero nunca sin decirle cómo pedir la cita.
 * `contacto` es «el hospital al *606…*» (o «el hospital»).
 */
export function autorizacionRechazada(estilo: EstiloAviso, contacto: string): string {
  return estilo === 'INFORMAL'
    ? `Entendido, respetamos tu decisión. 🙏 Sin tu autorización no puedo atenderte por este chat, pero puedes pedir tu cita comunicándote con ${contacto} o en la ventanilla. Si cambias de opinión, escríbeme cuando quieras.`
    : `Entendido, respetamos su decisión. 🙏 Sin su autorización no puedo atenderle por este chat, pero puede pedir su cita comunicándose con ${contacto} o en la ventanilla. Si cambia de opinión, escríbame cuando quiera.`;
}

/** Tras varios recordatorios sin un SÍ o un NO: se cierra, con la misma salida. */
export function autorizacionSinRespuesta(estilo: EstiloAviso, contacto: string): string {
  return estilo === 'INFORMAL'
    ? `Como no recibí tu respuesta, cierro esta conversación por ahora. Sin tu autorización no puedo agendarte por aquí; puedes pedir tu cita comunicándote con ${contacto} o en la ventanilla. Cuando quieras, escríbeme de nuevo. 🙏`
    : `Como no recibí su respuesta, cierro esta conversación por ahora. Sin su autorización no puedo agendarle por aquí; puede pedir su cita comunicándose con ${contacto} o en la ventanilla. Cuando quiera, escríbame de nuevo. 🙏`;
}

/** «Retiro mi autorización». La supresión de los datos la atiende el hospital. */
export function autorizacionRetirada(estilo: EstiloAviso, contacto: string): string {
  return estilo === 'INFORMAL'
    ? `Listo: quedó registrado que retiras tu autorización para el tratamiento de tus datos por este chat. Si vuelves a escribirnos para agendar, te la pediremos de nuevo. Tus citas ya agendadas no cambian (para cancelar una, escribe «cancelar cita»). Si además quieres que el hospital corrija o borre tus datos, comunícate con ${contacto}.`
    : `Listo: quedó registrado que retira su autorización para el tratamiento de sus datos por este chat. Si vuelve a escribirnos para agendar, se la pediremos de nuevo. Sus citas ya agendadas no cambian (para cancelar una, escriba «cancelar cita»). Si además quiere que el hospital corrija o borre sus datos, comuníquese con ${contacto}.`;
}

// ─── Formularios web (solicitud de alta y de más citas) ────────────────────

/** El texto de la casilla obligatoria; el enlace a la política va aparte. */
export function textoCasillaAutorizacion(clinica: string): string {
  return `Autorizo a ${clinica} a tratar mis datos personales, incluidos los de salud que escriba aquí, para revisar esta solicitud y contactarme (Ley 1581 de 2012).`;
}

export const ERROR_CASILLA_AUTORIZACION =
  'Para enviar la solicitud, marque la casilla de autorización de datos (si no la ve, recargue la página).';

// ─── Configuración ─────────────────────────────────────────────────────────

/** La versión guardada, o la de siempre si está vacía o es rara. */
export function normalizarVersionPolitica(valor: unknown): string {
  if (typeof valor !== 'string') return AUTORIZACION_DATOS.VERSION_POR_DEFECTO;
  const v = valor.trim();
  return v && v.length <= AUTORIZACION_DATOS.MAX_VERSION
    ? v
    : AUTORIZACION_DATOS.VERSION_POR_DEFECTO;
}

export function validarVersionPolitica(
  valor: unknown,
): { ok: true; version: string } | { ok: false; error: string } {
  const v = typeof valor === 'string' ? valor.trim() : '';
  if (!v) return { ok: false, error: 'Escriba la versión de la política (por ejemplo, 1).' };
  if (v.length > AUTORIZACION_DATOS.MAX_VERSION) {
    return {
      ok: false,
      error: `La versión puede tener hasta ${AUTORIZACION_DATOS.MAX_VERSION} caracteres.`,
    };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(v)) {
    return { ok: false, error: 'La versión solo puede tener letras, números, espacios, puntos y guiones.' };
  }
  return { ok: true, version: v };
}

/** El enlace a la política: vacío = sin enlace; si viene, http(s) y corto. */
export function validarUrlPolitica(
  valor: unknown,
): { ok: true; url: string | null } | { ok: false; error: string } {
  const v = typeof valor === 'string' ? valor.trim() : '';
  if (!v) return { ok: true, url: null };
  if (v.length > AUTORIZACION_DATOS.MAX_URL) {
    return { ok: false, error: `El enlace puede tener hasta ${AUTORIZACION_DATOS.MAX_URL} caracteres.` };
  }
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return { ok: false, error: 'Escriba el enlace completo, por ejemplo https://www.hospital.gov.co/politica-de-datos.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'El enlace debe empezar por https://.' };
  }
  if (/\s/.test(v)) return { ok: false, error: 'El enlace no puede tener espacios.' };
  return { ok: true, url: v };
}

// ─── Cifras ────────────────────────────────────────────────────────────────

/** Una pregunta guardada, lo justo para contar (sin datos de la persona). */
export interface FilaAutorizacion {
  estado: EstadoAutorizacion;
  /** Clave del remitente (número, BSUID o chat de Telegram). Solo para contar personas. */
  remitente: string;
  canal: CanalAutorizacion;
  preguntadaEn: Date;
  respondidaEn: Date | null;
}

export interface CifrasDeUnCanal {
  /** Personas distintas a las que se les preguntó en el período. */
  preguntadas: number;
  aceptaron: number;
  noAceptaron: number;
  /** Cerraron la conversación sin responder. */
  sinRespuesta: number;
  /** Se les acaba de preguntar (la conversación sigue abierta). */
  esperando: number;
}

export interface CifrasDeAutorizaciones extends CifrasDeUnCanal {
  /** aceptaron / (aceptaron + noAceptaron), en %; null sin respuestas. */
  porcentajeAceptacion: number | null;
  /** Personas que retiraron la autorización en el período. */
  retiraron: number;
  /** Personas que dijeron NO y después, en el período, SÍ. */
  volvieronYAceptaron: number;
  porCanal: Record<CanalAutorizacion, CifrasDeUnCanal>;
  /** Por día (en la zona de la clínica): preguntas hechas y respuestas recibidas. */
  porDia: { dia: string; preguntas: number; aceptaron: number; noAceptaron: number }[];
}

const vacio = (): CifrasDeUnCanal => ({
  preguntadas: 0,
  aceptaron: 0,
  noAceptaron: 0,
  sinRespuesta: 0,
  esperando: 0,
});

/**
 * Las cifras de un período. Cada persona cuenta una vez, por lo ÚLTIMO que
 * respondió a la pregunta (quien dijo NO y después SÍ cuenta como «aceptó», y
 * además en «volvieron y aceptaron»). Una pregunta sin respuesta es «esperando»
 * mientras la conversación puede seguir abierta y «sin respuesta» después. El
 * retiro se cuenta aparte: no es una respuesta a la pregunta.
 */
export function cifrasDeAutorizaciones(
  filas: FilaAutorizacion[],
  ahora: Date,
  timeZone?: string,
): CifrasDeAutorizaciones {
  const limite = ahora.getTime() - AUTORIZACION_DATOS.MINUTOS_SIN_RESPUESTA * 60_000;
  const cuando = (f: FilaAutorizacion) => (f.respondidaEn ?? f.preguntadaEn).getTime();
  const ordenadas = [...filas].sort((a, b) => cuando(a) - cuando(b));

  const porPersona = new Map<string, FilaAutorizacion[]>();
  const retiraron = new Set<string>();
  for (const f of ordenadas) {
    const clave = `${f.canal}:${f.remitente}`;
    if (f.estado === 'REVOKED') {
      retiraron.add(clave);
      continue;
    }
    const lista = porPersona.get(clave) ?? [];
    lista.push(f);
    porPersona.set(clave, lista);
  }

  const total = vacio();
  const porCanal: Record<CanalAutorizacion, CifrasDeUnCanal> = {
    WHATSAPP: vacio(),
    TELEGRAM: vacio(),
  };
  let volvieronYAceptaron = 0;
  for (const lista of porPersona.values()) {
    const respondidas = lista.filter((f) => f.estado === 'ACCEPTED' || f.estado === 'REJECTED');
    const ultima = respondidas.at(-1);
    const canal = lista[0].canal;
    let campo: keyof CifrasDeUnCanal;
    if (ultima) {
      campo = ultima.estado === 'ACCEPTED' ? 'aceptaron' : 'noAceptaron';
      if (
        ultima.estado === 'ACCEPTED' &&
        respondidas.some((f) => f.estado === 'REJECTED' && cuando(f) <= cuando(ultima))
      ) {
        volvieronYAceptaron++;
      }
    } else {
      const reciente = lista.some((f) => f.preguntadaEn.getTime() > limite);
      campo = reciente ? 'esperando' : 'sinRespuesta';
    }
    for (const c of [total, porCanal[canal]]) {
      c.preguntadas++;
      c[campo]++;
    }
  }

  const dias = new Map<string, { preguntas: number; aceptaron: number; noAceptaron: number }>();
  const delDia = (d: Date) => {
    const k = diaLocal(d, timeZone);
    const v = dias.get(k) ?? { preguntas: 0, aceptaron: 0, noAceptaron: 0 };
    dias.set(k, v);
    return v;
  };
  for (const f of ordenadas) {
    if (f.estado === 'REVOKED') continue;
    delDia(f.preguntadaEn).preguntas++;
    if (f.respondidaEn && f.estado === 'ACCEPTED') delDia(f.respondidaEn).aceptaron++;
    if (f.respondidaEn && f.estado === 'REJECTED') delDia(f.respondidaEn).noAceptaron++;
  }

  const respondieron = total.aceptaron + total.noAceptaron;
  return {
    ...total,
    porcentajeAceptacion:
      respondieron > 0 ? Math.round((total.aceptaron / respondieron) * 1000) / 10 : null,
    retiraron: retiraron.size,
    volvieronYAceptaron,
    porCanal,
    porDia: [...dias.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dia, v]) => ({ dia, ...v })),
  };
}
