/**
 * Asistente de soporte por Telegram para el personal de las clínicas
 * (docs/PLAN_BOT_SOPORTE.md). Lógica PURA, compartida por la API (que conversa) y
 * la web (que genera el código y muestra la conversación).
 *
 * ═══ Lo que no se negocia ═══
 *  · Sin conversación verificada no hay IA ni información: el código del panel se
 *    pide en CADA conversación (S3).
 *  · La IA nunca decide sola lo que importa: este módulo valida lo que devuelve,
 *    descarta los temas que no existen en el manual y NO abre un caso sin el «Sí»
 *    del empleado (S9). La clínica y el autor de un caso salen de la conversación
 *    verificada, nunca de la IA.
 *  · 🔒 Los datos de pacientes se enmascaran antes de la IA (S8).
 *  · Sin IA, el asistente sigue atendiendo: los textos fijos están aquí.
 */
import { sanitizarTextoAlerta } from './alertas-tecnicas';
import { normalizar } from './conocimiento-buscador';
import type { UserRole } from './menus';
import { esCitaValida } from './soporte-bot-conocimiento';
import { LIMITES_CASO, type PrioridadCaso } from './soporte-caso';

const MS_MIN = 60_000;
const MS_HORA = 60 * MS_MIN;

// ─────────────────────────────────────────────────────────────
// Quién y cuánto
// ─────────────────────────────────────────────────────────────

/** El personal de las clínicas (S2). El paciente no; el super admin, solo en prueba. */
export const ROLES_DEL_ASISTENTE: readonly UserRole[] = [
  'ORG_ADMIN',
  'BOOKING_AGENT',
  'DOCTOR',
  'GENERAL_OBSERVER',
];

export type AccesoAlAsistente = 'PERSONAL' | 'PRUEBA' | 'NINGUNO';

export function accesoAlAsistente(rol: UserRole): AccesoAlAsistente {
  if (rol === 'SUPER_ADMIN') return 'PRUEBA';
  return ROLES_DEL_ASISTENTE.includes(rol) ? 'PERSONAL' : 'NINGUNO';
}

/**
 * El piloto (Fase 6, §17): mientras esté encendido, solo las personas de la lista
 * usan el asistente. Nace encendido y vacío. El super admin prueba siempre.
 */
export interface PilotoDelAsistente {
  activo: boolean;
  usuarios: readonly string[];
}

/** Hasta cuántas personas caben en el piloto (el plan pide de 3 a 5). */
export const MAX_PERSONAS_PILOTO = 20;

export function enElPiloto(
  piloto: PilotoDelAsistente,
  userId: string,
  rol: UserRole,
): boolean {
  if (rol === 'SUPER_ADMIN') return true;
  return !piloto.activo || piloto.usuarios.includes(userId);
}

/**
 * Los correos que escribió el super admin: en minúscula, sin repetir ni vacíos.
 * `null` si son más de los que caben o alguno no parece un correo.
 */
export function correosDelPiloto(entrada: unknown): string[] | null {
  if (!Array.isArray(entrada)) return null;
  const correos = [
    ...new Set(
      entrada
        .map((c) => (typeof c === 'string' ? c.trim().toLowerCase() : ''))
        .filter(Boolean),
    ),
  ];
  if (correos.length > MAX_PERSONAS_PILOTO) return null;
  if (correos.some((c) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c))) return null;
  return correos;
}

/** Reglas fijas (§3.1, §3.3, §3.4). */
export const LIMITES_SOPORTE = {
  digitosCodigo: 6,
  codigoMinutos: 10,
  maxIntentosCodigo: 5,
  bloqueoMinutos: 60,
  preguntaEnEsperaMinutos: 10,
  borradorHoras: 24,
  maxTurnosContexto: 20,
  esperaIaSegundos: 25,
  agruparMensajesMs: 2_000,
  /** Tope duro de una respuesta; el prompt pide unos 900 caracteres. */
  maxCaracteresRespuesta: 3_500,
  maxTemasCitados: 5,
  maxDatosQueFaltan: 3,
  casoMismoTemaDias: 7,
  /** «No, sigue pasando» reabre un caso solucionado hasta 7 días después. */
  reabrirDias: 7,
  /** Un cambio de estado más viejo que esto no se le avisa al empleado (§3.6). */
  avisoRecienteHoras: 24,
  /** Lo que tocó en un aviso sin conversación abierta espera el código 10 min. */
  accionEnEsperaMinutos: 10,
} as const;

/**
 * Lo que el super admin puede ajustar, con los mismos valores por defecto de
 * `SupportBotConfig` en el esquema.
 */
export const AJUSTES_SOPORTE_POR_DEFECTO = {
  conversationIdleMinutes: 30,
  maxMessagesPerHour: 40,
  maxMessageChars: 2_000,
  maxAiTurnsPerOrgPerDay: 300,
} as const;

// ─────────────────────────────────────────────────────────────
// El código y los comandos
// ─────────────────────────────────────────────────────────────

/**
 * El código de 6 dígitos que el empleado escribe: solo o con algo de cortesía
 * («mi código es 482 913»), juntos o en dos grupos de tres. Un mensaje largo o con
 * otras cifras no es un código: así una pregunta con números no gasta un intento.
 */
export function extraerCodigoCorto(texto: string): string | null {
  const t = texto.trim();
  if (t.length === 0 || t.length > 40) return null;
  const digitos = t.replace(/\D/g, '');
  if (digitos.length !== LIMITES_SOPORTE.digitosCodigo) return null;
  if (!/(?<!\d)\d{3}[\s.-]?\d{3}(?!\d)/.test(t)) return null;
  return digitos;
}

/** El código largo del QR (`t.me/<bot>?start=<código>`): base64url, 24 a 64. */
export const RE_CODIGO_ENLACE = /^[A-Za-z0-9_-]{24,64}$/;

export function esCodigoDeEnlace(texto: string | null | undefined): boolean {
  return !!texto && RE_CODIGO_ENLACE.test(texto);
}

export type ComandoSoporte = 'start' | 'casos' | 'nuevo' | 'ayuda' | 'salir';

/** Los que se publican en el menú del bot (`setMyCommands`). `/start` es implícito. */
export const COMANDOS_SOPORTE: ReadonlyArray<{
  comando: Exclude<ComandoSoporte, 'start'>;
  descripcion: string;
}> = [
  { comando: 'casos', descripcion: 'Ver mis casos de soporte' },
  { comando: 'nuevo', descripcion: 'Reportar una falla' },
  { comando: 'ayuda', descripcion: 'Qué puedo hacer por ti' },
  { comando: 'salir', descripcion: 'Cerrar la conversación' },
];

const RE_COMANDO = /^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i;

export function leerComando(
  texto: string,
): { comando: ComandoSoporte; argumento: string | null } | null {
  const m = RE_COMANDO.exec(texto.trim());
  if (!m) return null;
  const comando = m[1].toLowerCase();
  if (!['start', 'casos', 'nuevo', 'ayuda', 'salir'].includes(comando))
    return null;
  const argumento = m[2]?.trim() || null;
  return { comando: comando as ComandoSoporte, argumento };
}

const SALUDOS = new Set([
  'hola',
  'ola',
  'holi',
  'hey',
  'buenas',
  'buen dia',
  'buenos dias',
  'buenas tardes',
  'buenas noches',
  'hola buenas',
  'hola buenos dias',
  'hola buenas tardes',
  'hola buenas noches',
  'saludos',
]);

/**
 * ¿El mensaje es solo un saludo? Un «hola» antes del código no se guarda como
 * pregunta pendiente: no hay nada que responderle después.
 */
export function esSoloSaludo(texto: string): boolean {
  return SALUDOS.has(normalizar(texto));
}

/** Intentos de código que le quedan a una cuenta de Telegram antes del bloqueo. */
export function intentosRestantes(fallos: number): number {
  return Math.max(0, LIMITES_SOPORTE.maxIntentosCodigo - Math.max(0, fallos));
}

// ─────────────────────────────────────────────────────────────
// La conversación
// ─────────────────────────────────────────────────────────────

export const MOTIVOS_CIERRE = [
  'INACTIVIDAD',
  'SALIR',
  'PANEL',
  'OTRA_CONVERSACION',
  'ACCESO_REVOCADO',
] as const;
export type MotivoCierre = (typeof MOTIVOS_CIERRE)[number];

/** ¿La conversación sigue abierta? Se cierra sola a los N minutos sin mensajes. */
export function conversacionVigente(
  c: { closedAt: Date | null; lastMessageAt: Date },
  ahora: Date,
  minutosInactividad: number = AJUSTES_SOPORTE_POR_DEFECTO.conversationIdleMinutes,
): boolean {
  if (c.closedAt) return false;
  return (
    ahora.getTime() - c.lastMessageAt.getTime() < minutosInactividad * MS_MIN
  );
}

// ─────────────────────────────────────────────────────────────
// Datos sensibles
// ─────────────────────────────────────────────────────────────

/**
 * 🔒 Lo que escribe el empleado, listo para la IA: tapa documentos, teléfonos,
 * correos y secretos (el mismo sanitizador de las alertas técnicas). El caso
 * guarda el texto original; la IA nunca lo ve.
 */
export function enmascararParaIA(
  texto: string,
  max: number = AJUSTES_SOPORTE_POR_DEFECTO.maxMessageChars,
): string {
  return sanitizarTextoAlerta(texto, max);
}

/** «ana.perez@clinica.co» → «a***@clinica.co», para confirmar con qué cuenta quedó. */
export function enmascararCorreo(correo: string): string {
  const [usuario, dominio] = correo.trim().split('@');
  if (!usuario || !dominio) return '***';
  return `${usuario[0]}***@${dominio}`;
}

// ─────────────────────────────────────────────────────────────
// Lo que devuelve la IA
// ─────────────────────────────────────────────────────────────

export const TIPOS_RESPUESTA_IA = [
  'respuesta',
  'aclarar',
  'falla',
  'seguimiento_caso',
  'fuera_de_tema',
  'saludo',
] as const;
export type TipoRespuestaIA = (typeof TIPOS_RESPUESTA_IA)[number];

export interface CasoPropuesto {
  titulo: string | null;
  descripcion: string | null;
  /** Ruta del panel donde pasa, si la IA la reconoció (`/dashboard/…`). */
  pantalla: string | null;
  /** Lo que todavía hay que preguntar antes de abrirlo. */
  falta: string[];
}

export interface RespuestaIA {
  tipo: TipoRespuestaIA;
  respuesta: string;
  /** Solo los temas que existen en el manual. */
  temas: string[];
  urgencia: 'normal' | 'alta';
  caso: CasoPropuesto | null;
  /**
   * La persona quiere agregar información a uno de SUS casos abiertos: su número.
   * Quien llama comprueba que el caso sea suyo y pregunta antes de agregarla.
   */
  ampliarCaso: number | null;
}

const texto = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;

const recortar = (t: string, max: number) =>
  t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function leerCaso(o: Record<string, unknown>): CasoPropuesto {
  const titulo = texto(o.titulo);
  const pantalla = texto(o.pantalla);
  return {
    titulo:
      titulo && titulo.length >= LIMITES_CASO.tituloMin
        ? recortar(titulo.replace(/\s+/g, ' '), LIMITES_CASO.tituloMax)
        : null,
    descripcion: texto(o.descripcion),
    pantalla: pantalla && pantalla.startsWith('/') ? pantalla : null,
    falta: (Array.isArray(o.falta) ? o.falta : [])
      .map(texto)
      .filter((x): x is string => x !== null)
      .slice(0, LIMITES_SOPORTE.maxDatosQueFaltan)
      .map((x) => recortar(x, 120)),
  };
}

/**
 * Lee la respuesta de la IA. Tolera que venga envuelta en ```json o con texto
 * alrededor; si no se puede leer o no trae una respuesta, devuelve `null` y quien
 * llama pasa al modo sin IA.
 *
 * `noCubierta`: la IA «respondió» sin citar nada del manual. No se le cree: el
 * asistente dice que no lo tiene en el manual y ofrece abrir un caso (§3.3).
 */
export function leerRespuestaIA(
  crudo: string,
  temasValidos: ReadonlySet<string>,
): { respuesta: RespuestaIA; noCubierta: boolean } | null {
  const ini = crudo.indexOf('{');
  const fin = crudo.lastIndexOf('}');
  if (ini === -1 || fin <= ini) return null;
  // Lo que va de una llave a otra y se deja leer es siempre un objeto.
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(crudo.slice(ini, fin + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const respuesta = texto(r.respuesta);
  if (!respuesta) return null;
  const tipoCrudo =
    typeof r.tipo === 'string' ? r.tipo.trim().toLowerCase() : '';
  const tipo: TipoRespuestaIA = (
    TIPOS_RESPUESTA_IA as readonly string[]
  ).includes(tipoCrudo)
    ? (tipoCrudo as TipoRespuestaIA)
    : 'respuesta';
  const temas = [
    ...new Set(
      (Array.isArray(r.temas) ? r.temas : [])
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter((t) => esCitaValida(t, temasValidos)),
    ),
  ].slice(0, LIMITES_SOPORTE.maxTemasCitados);

  const leida: RespuestaIA = {
    tipo,
    respuesta: recortar(respuesta, LIMITES_SOPORTE.maxCaracteresRespuesta),
    temas,
    urgencia: r.urgencia === 'alta' ? 'alta' : 'normal',
    caso: esObjeto(r.caso) ? leerCaso(r.caso) : null,
    ampliarCaso:
      typeof r.ampliarCaso === 'number' &&
      Number.isInteger(r.ampliarCaso) &&
      r.ampliarCaso > 0
        ? r.ampliarCaso
        : null,
  };
  return {
    respuesta: leida,
    noCubierta: tipo === 'respuesta' && temas.length === 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Prioridad del caso (S11)
// ─────────────────────────────────────────────────────────────

/**
 * Lo que frena la atención de pacientes ahora mismo. Sobre texto normalizado (sin
 * tildes ni mayúsculas ni signos).
 */
const SENALES_URGENCIA: RegExp[] = [
  /\bnadie (puede|pudo|logra|esta pudiendo) (agendar|reservar|sacar citas?|entrar)\b/,
  /\bno (se puede|podemos|puedo|estamos pudiendo|deja) agendar\b/,
  /\b(bot|asistente|chat|whatsapp|telegram) no (responde|contesta|funciona|esta respondiendo|esta contestando)\b/,
  /\bno (salen|estan saliendo|llegan|estan llegando|se enviaron|se estan enviando) (los )?recordatorios\b/,
  /\b(las )?citas no (llegan|estan llegando|pasan|estan pasando|aparecen) (al|en el) (hospital|his)\b/,
  /\b(se cayo|esta caido|esta caida|no carga|no abre) (el |la )?(sistema|panel|agenia|pagina|plataforma)\b/,
  /\b(sistema|panel|agenia|pagina|plataforma) (se cayo|esta caido|esta caida|no carga|no abre)\b/,
];

export function haySenalDeUrgencia(textos: string[]): boolean {
  return textos.some((t) => {
    const n = normalizar(t);
    return SENALES_URGENCIA.some((re) => re.test(n));
  });
}

/**
 * La IA propone la urgencia y una señal fija la confirma (§3.4). Sin IA
 * (`urgenciaIA = null`), basta la señal fija. El empleado la ve en el borrador.
 *
 * `anterior`: la del borrador en curso. Una vez confirmada la alta, no baja sola
 * porque la corrección («también pasa con el Dr. Ruiz») no repita la señal; solo
 * baja si la IA dice que es normal.
 */
export function prioridadDelCaso(p: {
  urgenciaIA: 'normal' | 'alta' | null;
  textos: string[];
  anterior?: PrioridadCaso | null;
}): PrioridadCaso {
  if (p.urgenciaIA === 'normal') return 'NORMAL';
  if (p.anterior === 'HIGH') return 'HIGH';
  return haySenalDeUrgencia(p.textos) ? 'HIGH' : 'NORMAL';
}

// ─────────────────────────────────────────────────────────────
// «Sí», «no», «corregir»
// ─────────────────────────────────────────────────────────────

export type RespuestaCorta = 'SI' | 'NO' | 'CORREGIR';

const CORTESIA =
  /\b(gracias|muchas gracias|por favor|porfa|pls|please|senor|senora)\b/g;
const FRASES_SI = new Set([
  'si',
  'sii',
  'siii',
  'sip',
  'dale',
  'de una',
  'claro',
  'claro que si',
  'ok',
  'okay',
  'listo',
  'abrelo',
  'abralo',
  'si abrelo',
  'si abralo',
  'hazlo',
  'correcto',
  'afirmativo',
  'va',
  'si dale',
  'si claro',
]);
const FRASES_NO = new Set([
  'no',
  'nop',
  'nope',
  'mejor no',
  'cancela',
  'cancelar',
  'dejalo',
  'dejalo asi',
  'no hace falta',
  'ya no',
  'no abrir',
  'no lo abras',
]);
const FRASES_CORREGIR = new Set([
  'corregir',
  'corrige',
  'corregir algo',
  'cambiar',
  'cambiar algo',
  'quiero cambiar algo',
  'editar',
  'modificar',
  'falta algo',
]);

/**
 * Una respuesta corta a «¿Lo abro?». Solo frases completas: «no puedo agendar»
 * empieza por «no» y es una falla, no una negativa.
 */
export function interpretarRespuestaCorta(
  entrada: string,
): RespuestaCorta | null {
  const crudo = entrada.trim();
  if (['👍', '👌', '✅'].includes(crudo)) return 'SI';
  if (['👎', '❌'].includes(crudo)) return 'NO';
  const n = normalizar(crudo)
    .replace(CORTESIA, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (FRASES_SI.has(n)) return 'SI';
  if (FRASES_NO.has(n)) return 'NO';
  if (FRASES_CORREGIR.has(n)) return 'CORREGIR';
  return null;
}

// ─────────────────────────────────────────────────────────────
// El borrador del caso (§3.4): nunca se abre sin el «Sí»
// ─────────────────────────────────────────────────────────────

export interface BorradorCaso {
  /** RECOPILANDO: falta algo; CONFIRMANDO: se mostró y se espera el «Sí». */
  fase: 'RECOPILANDO' | 'CONFIRMANDO';
  titulo: string | null;
  descripcion: string | null;
  pantalla: string | null;
  falta: string[];
  prioridad: PrioridadCaso;
  creadoEn: string;
  /** Solo con la conversación cerrada: hasta cuándo se puede retomar (24 h). */
  venceEn: string | null;
}

export type EventoBorrador =
  | {
      tipo: 'PROPUESTA';
      caso: CasoPropuesto;
      prioridad: PrioridadCaso;
      ahora: Date;
    }
  | { tipo: 'SI'; ahora: Date }
  | { tipo: 'NO'; ahora: Date }
  | { tipo: 'CORREGIR'; ahora: Date }
  | { tipo: 'CONVERSACION_CERRADA'; ahora: Date }
  | { tipo: 'RETOMAR'; ahora: Date };

export type AccionBorrador =
  | 'PEDIR_DATOS'
  | 'PEDIR_CONFIRMACION'
  | 'ABRIR_CASO'
  | 'DESCARTAR'
  | 'PEDIR_CORRECCION'
  | 'OFRECER_RETOMAR'
  | 'NINGUNA';

function listoParaConfirmar(
  b: Pick<BorradorCaso, 'titulo' | 'descripcion' | 'falta'>,
): boolean {
  return (
    !!b.titulo &&
    b.titulo.length >= LIMITES_CASO.tituloMin &&
    !!b.descripcion &&
    b.descripcion.length >= LIMITES_CASO.detalleMin &&
    b.falta.length === 0
  );
}

function vencido(b: BorradorCaso, ahora: Date): boolean {
  return !!b.venceEn && ahora.getTime() >= new Date(b.venceEn).getTime();
}

/**
 * La máquina del borrador. Devuelve el borrador que queda (o `null`) y lo que el
 * asistente debe hacer. `ABRIR_CASO` sale SOLO de un «Sí» sobre un borrador
 * completo que ya se le mostró al empleado.
 */
export function siguienteBorrador(
  actual: BorradorCaso | null,
  evento: EventoBorrador,
): { borrador: BorradorCaso | null; accion: AccionBorrador } {
  const vigente = actual && !vencido(actual, evento.ahora) ? actual : null;

  switch (evento.tipo) {
    case 'PROPUESTA': {
      const datos = {
        titulo: evento.caso.titulo,
        descripcion: evento.caso.descripcion,
        pantalla: evento.caso.pantalla,
        falta: evento.caso.falta,
      };
      const listo = listoParaConfirmar(datos);
      return {
        borrador: {
          ...datos,
          fase: listo ? 'CONFIRMANDO' : 'RECOPILANDO',
          prioridad: evento.prioridad,
          creadoEn: vigente?.creadoEn ?? evento.ahora.toISOString(),
          venceEn: null,
        },
        accion: listo ? 'PEDIR_CONFIRMACION' : 'PEDIR_DATOS',
      };
    }
    case 'SI':
      if (!vigente) return { borrador: null, accion: 'NINGUNA' };
      if (vigente.fase === 'CONFIRMANDO' && listoParaConfirmar(vigente)) {
        return { borrador: null, accion: 'ABRIR_CASO' };
      }
      return {
        borrador: { ...vigente, fase: 'RECOPILANDO' },
        accion: 'PEDIR_DATOS',
      };
    case 'NO':
      return { borrador: null, accion: vigente ? 'DESCARTAR' : 'NINGUNA' };
    case 'CORREGIR':
      if (!vigente) return { borrador: null, accion: 'NINGUNA' };
      return {
        borrador: { ...vigente, fase: 'RECOPILANDO' },
        accion: 'PEDIR_CORRECCION',
      };
    case 'CONVERSACION_CERRADA':
      if (!vigente) return { borrador: null, accion: 'NINGUNA' };
      return {
        borrador: {
          ...vigente,
          venceEn: new Date(
            evento.ahora.getTime() + LIMITES_SOPORTE.borradorHoras * MS_HORA,
          ).toISOString(),
        },
        accion: 'NINGUNA',
      };
    case 'RETOMAR':
      if (!vigente) return { borrador: null, accion: 'NINGUNA' };
      return {
        borrador: { ...vigente, venceEn: null },
        accion: 'OFRECER_RETOMAR',
      };
  }
}

/**
 * El borrador guardado en `SupportBotConversation.flowState`. Un JSON que no tiene
 * la forma esperada se descarta: mejor volver a preguntar que abrir algo raro.
 */
export function leerBorrador(json: unknown): BorradorCaso | null {
  if (!esObjeto(json) || !esObjeto(json.borrador)) return null;
  const o = json.borrador;
  if (o.fase !== 'RECOPILANDO' && o.fase !== 'CONFIRMANDO') return null;
  if (o.prioridad !== 'NORMAL' && o.prioridad !== 'HIGH') return null;
  if (typeof o.creadoEn !== 'string' || Number.isNaN(Date.parse(o.creadoEn)))
    return null;
  const venceEn =
    typeof o.venceEn === 'string' && !Number.isNaN(Date.parse(o.venceEn))
      ? o.venceEn
      : null;
  return {
    ...leerCaso(o),
    fase: o.fase,
    prioridad: o.prioridad,
    creadoEn: o.creadoEn,
    venceEn,
  };
}

/** Lo que la conversación tiene en curso (`SupportBotConversation.flowState`). */
export interface FlujoConversacion {
  borrador: BorradorCaso | null;
  /** Una nota esperando el «sí» para agregarse a un caso de la persona. */
  notaPendiente: { caso: number; texto: string } | null;
  /** La persona pidió abrir un caso: lo próximo que escriba sirve para armarlo. */
  modoCaso: boolean;
  /**
   * Reabrió este caso («No, sigue pasando») y se le pidió contar qué sigue pasando:
   * lo próximo que escriba se ofrece como nota de ese caso, sin pasar por la IA.
   */
  notaPara?: number | null;
}

export const FLUJO_VACIO: FlujoConversacion = {
  borrador: null,
  notaPendiente: null,
  modoCaso: false,
};

/**
 * El flujo guardado. Un JSON que no tiene la forma esperada vuelve vacío: mejor
 * volver a preguntar que abrir algo raro.
 */
export function leerFlujo(json: unknown): FlujoConversacion {
  if (!esObjeto(json)) return { ...FLUJO_VACIO };
  const n = json.notaPendiente;
  const nota =
    esObjeto(n) &&
    typeof n.caso === 'number' &&
    Number.isInteger(n.caso) &&
    n.caso > 0 &&
    typeof n.texto === 'string' &&
    n.texto.trim()
      ? { caso: n.caso, texto: n.texto }
      : null;
  const notaPara =
    typeof json.notaPara === 'number' &&
    Number.isInteger(json.notaPara) &&
    json.notaPara > 0
      ? json.notaPara
      : null;
  return {
    borrador: leerBorrador(json),
    notaPendiente: nota,
    modoCaso: json.modoCaso === true,
    ...(notaPara ? { notaPara } : {}),
  };
}

/** Lo que se guarda en `flowState` (null si no hay nada en curso). */
export function guardarFlujo(f: FlujoConversacion): {
  borrador: BorradorCaso | null;
  notaPendiente: { caso: number; texto: string } | null;
  modoCaso: boolean;
  notaPara?: number;
} | null {
  return f.borrador || f.notaPendiente || f.modoCaso || f.notaPara
    ? {
        borrador: f.borrador,
        notaPendiente: f.notaPendiente,
        modoCaso: f.modoCaso,
        ...(f.notaPara ? { notaPara: f.notaPara } : {}),
      }
    : null;
}

/**
 * Al cerrarse la conversación (inactividad, /salir, el panel, otra): el borrador
 * sobrevive 24 h para retomarlo; la nota pendiente, el «modo caso» y la nota que
 * se esperaba de un caso reabierto, no.
 */
export function flujoAlCerrar(json: unknown, ahora: Date) {
  const { borrador } = siguienteBorrador(leerBorrador(json), {
    tipo: 'CONVERSACION_CERRADA',
    ahora,
  });
  return guardarFlujo({ ...FLUJO_VACIO, borrador });
}

/**
 * Al abrir una conversación nueva: el borrador que quedó de la anterior, si no ha
 * vencido, listo para ofrecerlo (y el flujo con que sigue la nueva).
 */
export function flujoAlRetomar(
  json: unknown,
  ahora: Date,
): { borrador: BorradorCaso; flujo: FlujoConversacion } | null {
  const { borrador, accion } = siguienteBorrador(leerBorrador(json), {
    tipo: 'RETOMAR',
    ahora,
  });
  if (accion !== 'OFRECER_RETOMAR' || !borrador) return null;
  return {
    borrador,
    flujo: {
      borrador,
      notaPendiente: null,
      // A medio armar: lo próximo que escriba sirve para completarlo.
      modoCaso: borrador.fase === 'RECOPILANDO',
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Botones (teclado en línea de Telegram)
// ─────────────────────────────────────────────────────────────

export type BotonSoporte =
  | { accion: 'CASO_SI' }
  | { accion: 'CASO_NO' }
  | { accion: 'CASO_CORREGIR' }
  | { accion: 'CASO_IGUAL' }
  /** Empezar un caso (tras una respuesta que no sirvió o que el manual no cubre). */
  | { accion: 'CASO_NUEVO' }
  /** Agregar (o no) la nota pendiente a un caso de la persona. */
  | { accion: 'NOTA_SI' }
  | { accion: 'NOTA_NO' }
  | { accion: 'UTIL_SI' }
  | { accion: 'UTIL_NO' }
  | { accion: 'AVISO_BIEN'; caso: number }
  | { accion: 'AVISO_SIGUE'; caso: number }
  | { accion: 'AVISO_VER'; caso: number }
  | { accion: 'INCIDENTE_AVISAR'; alerta: string };

const PREFIJO_BOTON = 's1';
const SIN_ARGUMENTO = [
  'CASO_SI',
  'CASO_NO',
  'CASO_CORREGIR',
  'CASO_IGUAL',
  'CASO_NUEVO',
  'NOTA_SI',
  'NOTA_NO',
  'UTIL_SI',
  'UTIL_NO',
];
const CON_CASO = ['AVISO_BIEN', 'AVISO_SIGUE', 'AVISO_VER'];

/** `callback_data` de un botón (Telegram admite hasta 64 bytes). */
export function datosDeBoton(b: BotonSoporte): string {
  if ('caso' in b) return `${PREFIJO_BOTON}:${b.accion}:${b.caso}`;
  if ('alerta' in b) return `${PREFIJO_BOTON}:${b.accion}:${b.alerta}`;
  return `${PREFIJO_BOTON}:${b.accion}`;
}

/** Lo contrario; `null` si no es un botón de este asistente o vino alterado. */
export function leerBoton(datos: string): BotonSoporte | null {
  const [prefijo, accion, arg, ...sobra] = datos.split(':');
  if (prefijo !== PREFIJO_BOTON || sobra.length > 0 || !accion) return null;
  if (SIN_ARGUMENTO.includes(accion)) {
    return arg === undefined ? ({ accion } as BotonSoporte) : null;
  }
  if (CON_CASO.includes(accion)) {
    const caso = Number(arg);
    return /^\d{1,9}$/.test(arg ?? '') && caso > 0
      ? ({ accion, caso } as BotonSoporte)
      : null;
  }
  if (accion === 'INCIDENTE_AVISAR' && /^[A-Za-z0-9-]{1,40}$/.test(arg ?? '')) {
    return { accion, alerta: arg };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Textos fijos (sin IA). Tuteo, como el Centro de ayuda.
// ─────────────────────────────────────────────────────────────

/** Lo que dicen los botones del teclado en línea. */
export const ETIQUETAS_BOTON = {
  UTIL_SI: '✅ Me sirvió',
  UTIL_NO: '🙋 No, abrir un caso',
  AVISO_BIEN: '✅ Sí, gracias',
  AVISO_SIGUE: '🔁 No, sigue pasando',
  AVISO_VER: '📄 Ver la respuesta',
  CASO_NUEVO: '🙋 Abrir un caso',
  CASO_SI: '✅ Sí, ábrelo',
  CASO_CORREGIR: '✏️ Corregir algo',
  CASO_NO: 'No, gracias',
  NOTA_SI: '✅ Sí, agrégalo',
  NOTA_NO: 'No',
} as const;

const plural = (n: number, uno: string, varios: string) =>
  n === 1 ? uno : varios;

export const TEXTOS_SOPORTE = {
  pedirCodigo:
    'Hola, soy el asistente de soporte de AgenIA para el personal de las clínicas. Para empezar, escribe el código de 6 dígitos que aparece en el panel › Soporte › Asistente de Telegram.',
  preguntaGuardada: 'Guardé tu pregunta; te respondo apenas me des el código.',
  codigoIncorrecto: (restantes: number) =>
    `Ese código no es válido o ya venció. ${plural(restantes, 'Te queda 1 intento', `Te quedan ${restantes} intentos`)}; si lo necesitas, genera uno nuevo en el panel › Soporte.`,
  bloqueado: (minutos: number) =>
    `Por seguridad pausé los intentos de código durante ${minutos} minutos. Después genera un código nuevo en el panel › Soporte.`,
  sinAcceso:
    'Este asistente es solo para el personal de las clínicas que usan AgenIA. Si crees que es un error, pídele acceso al administrador de tu clínica.',
  conversacionAbierta: (d: {
    nombre: string | null;
    rol: string;
    clinica: string;
    correo: string;
    prueba: boolean;
  }) =>
    `Listo${d.nombre ? `, ${d.nombre}` : ''}. Hablas como ${d.rol} de ${d.clinica} (${enmascararCorreo(d.correo)}). Si no fuiste tú, escribe /salir.${d.prueba ? ' Modo prueba: los casos se simulan.' : ''}`,
  conversacionCerrada:
    'Listo, cerré la conversación. Cuando me necesites, genera un código nuevo en el panel › Soporte.',
  cerradaDesdePanel:
    'Cerraste la conversación desde el panel. Cuando me necesites, genera un código nuevo en el panel › Soporte.',
  sinConversacion:
    'No tenías una conversación abierta. Cuando me necesites, escribe el código de 6 dígitos que aparece en el panel › Soporte › Asistente de Telegram.',
  yaConversando: 'Ya estamos conversando. Cuéntame qué necesitas.',
  ayuda:
    'Puedo ayudarte con dudas sobre AgenIA: cómo se hace algo en el panel o qué significa un aviso o un error. Si algo falla, abro un caso para el equipo técnico. Comandos: /casos para ver tus casos, /nuevo para reportar una falla y /salir para cerrar la conversación.',
  sinIASinResultados:
    'Ahora mismo no puedo pensar la respuesta con calma, y no encontré nada parecido en el manual.',
  meSirvio: '¡Qué bien! Aquí estoy si necesitas algo más.',
  // ── Casos (§3.4) ──
  contarFalla:
    'Cuéntame qué está pasando: en qué pantalla estabas, qué esperabas y qué pasó (con el mensaje de error, si salió). Con eso armo el caso.',
  casoAbierto: (d: {
    numero: number;
    titulo: string;
    cuando: string;
    /** Le llegan los avisos de sus casos: se le dice que se le escribirá. */
    seguimiento: boolean;
  }) =>
    `Listo, abrí el caso #${d.numero}: «${d.titulo}». ${d.cuando} ${
      d.seguimiento
        ? 'Te escribo por aquí cuando lo tomen y cuando quede resuelto.'
        : 'Puedes ver cómo va con /casos o en el panel › Soporte.'
    }`,
  casoDescartado: 'Listo, no abro nada. Si cambias de opinión, escribe /nuevo.',
  pedirCorreccion: 'Claro, dime qué cambio o qué le agrego.',
  confirmarNota: (caso: number) =>
    `¿Agrego lo que me contaste al caso #${caso}?`,
  notaAgregada: (caso: number) =>
    `Listo, lo agregué al caso #${caso}. El equipo técnico lo ve en el caso.`,
  notaDescartada: 'Listo, no agrego nada.',
  retomarBorrador: (titulo: string | null, confirmar: boolean) =>
    confirmar && titulo
      ? `Te quedó un caso sin abrir: «${titulo}». ¿Lo abro?`
      : `Te quedó un caso a medio armar${titulo ? `: «${titulo}»` : ''}. Cuéntame lo que falta y lo abro.`,
  sinCasos:
    'No tienes casos de soporte. Si algo falla, escribe /nuevo y lo reportamos.',
  nadaPendiente: 'Listo.',
  borradorVencido: 'Ese caso ya no está pendiente. Si quieres, escribe /nuevo.',
  escribeElCodigo:
    'Para continuar, escribe un código nuevo del panel › Soporte.',
  cerradaPorOtra:
    'Tu conversación se cerró porque se abrió otra con tu usuario. Si no fuiste tú, cambia tu contraseña y avísale al equipo desde el panel › Soporte.',
  accesoRevocado:
    'Tu usuario ya no tiene acceso a este asistente, así que cerré la conversación.',
  sinIA:
    'Ahora mismo no puedo pensar la respuesta con calma, pero esto del Centro de ayuda puede servirte:',
  noCubierta: 'Eso no lo tengo en el manual.',
  ofrecerCaso:
    '¿Quieres que abra un caso para que el equipo técnico lo revise?',
  mensajeLargo: (max: number) =>
    `Tu mensaje pasa de ${max} caracteres. ¿Me lo resumes o me lo mandas en partes?`,
  muchosMensajes:
    'Vamos muy rápido: dame unos minutos y seguimos. Si es urgente, abre el caso desde el panel › Soporte.',
  soloTexto:
    'Por ahora solo leo texto. Escríbeme lo que necesitas y, si hace falta, lo dejo en un caso.',
  casoSimulado: (titulo: string) =>
    `Modo prueba: aquí abriría el caso «${titulo}», pero no lo registro.`,
  // ── Seguimiento de sus casos (§3.6) ──
  avisoTomado: (d: { numero: number; titulo: string }) =>
    `👀 El equipo técnico ya está trabajando en tu caso #${d.numero}: «${recortar(d.titulo, 100)}».`,
  /** Sin conversación abierta va sin la respuesta: puede nombrar datos (§3.6). */
  avisoResuelto: (d: {
    numero: number;
    titulo: string;
    respuesta: string | null;
  }) =>
    d.respuesta === null
      ? `✅ Tu caso #${d.numero} «${recortar(d.titulo, 100)}» quedó resuelto. ¿Quedó bien?`
      : `✅ Tu caso #${d.numero} «${recortar(d.titulo, 100)}» quedó resuelto.\n\nRespuesta del equipo: ${d.respuesta}\n\n¿Quedó bien?`,
  respuestaDelCaso: (numero: number, respuesta: string) =>
    `Respuesta del equipo en el caso #${numero}: ${respuesta}\n\n¿Quedó bien?`,
  avisoBien: '¡Qué bien! Gracias por contarme.',
  casoReabierto: (numero: number) =>
    `Listo, reabrí el caso #${numero} y le aviso al equipo técnico. Cuéntame qué sigue pasando y lo agrego al caso.`,
  casoNoReabierto: (numero: number) =>
    `El caso #${numero} ya no se puede reabrir desde aquí. Si sigue pasando, escribe /nuevo y abro uno nuevo.`,
  casoDeOtraPersona:
    'Ese aviso es de un caso de otra persona: solo quien lo reportó lo puede responder.',
  accionEnEspera:
    'Para eso necesito confirmar que eres tú: escribe un código nuevo del panel › Soporte y lo hago enseguida.',
} as const;
