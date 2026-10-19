/**
 * Alertas técnicas por Telegram (docs/PLAN_ALERTAS_TECNICAS.md, Fase 0).
 *
 * Lógica PURA, compartida por las dos puntas:
 *   · la API, que DETECTA y ENVÍA: el centinela del monitor, los crones y el filtro
 *     de errores abren problemas, y un despachador los avisa, los recuerda y avisa
 *     cuando se resuelven;
 *   · la web, que CONFIGURA y MUESTRA la bitácora en /super-admin/alertas.
 *
 * Aquí no se lee ni se escribe nada, y no hay IA: los textos los arma el código.
 *
 * ═══ Lo que no se negocia ═══
 *  · 🔒 Ningún dato de pacientes sale hacia Telegram. Telegram está fuera de nuestra
 *    infraestructura y los mensajes de un bot no van cifrados de extremo a extremo.
 *    El mensaje dice QUÉ pasa, en qué clínica, desde cuándo y el enlace; el detalle
 *    queda detrás del inicio de sesión. `sanitizarTextoAlerta` tapa documentos,
 *    teléfonos, correos y secretos de todo texto libre, pero NO puede reconocer un
 *    nombre: quien abre una alerta nunca le pasa nombres de pacientes.
 *  · Un mensaje por PROBLEMA, no por chequeo: si el grupo recibe ruido, se silencia y
 *    el canal deja de servir (§3.3).
 *  · Texto plano. Un carácter mal escapado en HTML o Markdown haría fallar el envío
 *    con 400, y una alerta no puede perderse por formato.
 */
import { diaLocal } from './consulta-citas';
import {
  DEFAULT_TIMEZONE,
  formatAppointmentCompact,
  formatDateShort,
  formatTimeOnly,
} from './date-format';
import { horaLocalAUtc } from './rango-estadisticas';

const MS_MIN = 60_000;

// ─────────────────────────────────────────────────────────────
// Vocabulario
// ─────────────────────────────────────────────────────────────

export const GRAVEDADES_ALERTA = ['INFO', 'ADVERTENCIA', 'CRITICA'] as const;
export type GravedadAlerta = (typeof GRAVEDADES_ALERTA)[number];

export const ORDEN_GRAVEDAD_ALERTA: Record<GravedadAlerta, number> = {
  INFO: 0,
  ADVERTENCIA: 1,
  CRITICA: 2,
};

export const ICONO_GRAVEDAD_ALERTA: Record<GravedadAlerta, string> = {
  INFO: 'ℹ️',
  ADVERTENCIA: '🟠',
  CRITICA: '🔴',
};

/** Como se lee en el encabezado del mensaje y en el panel. */
export const TEXTO_GRAVEDAD_ALERTA: Record<GravedadAlerta, string> = {
  INFO: 'INFORMACIÓN',
  ADVERTENCIA: 'ADVERTENCIA',
  CRITICA: 'CRÍTICA',
};

/**
 * Las categorías que el super admin enciende o apaga en el panel. `SERVIDOR` no tiene
 * tipos aquí: la usa el vigía del servidor (`deploy/vigia.sh`, Fase 3), que lee la
 * misma configuración.
 */
export const CATEGORIAS_ALERTA = [
  'SERVICIOS',
  'ESPEJO',
  'CRONES',
  'ERRORES',
  'ARRANQUES',
  'SERVIDOR',
] as const;
export type CategoriaAlerta = (typeof CATEGORIAS_ALERTA)[number];

export const TEXTO_CATEGORIA_ALERTA: Record<
  CategoriaAlerta,
  { titulo: string; descripcion: string }
> = {
  SERVICIOS: {
    titulo: 'Servicios externos',
    descripcion:
      'Gemini, Google TTS, Meta, el Telegram de las clínicas y Redis.',
  },
  ESPEJO: {
    titulo: 'Espejo con el hospital',
    descripcion:
      'El agente sin latido o sin alcanzar el HIS, la cola atascada y el aviso al agendador que no sale.',
  },
  CRONES: {
    titulo: 'Tareas programadas',
    descripcion: 'Recordatorios, retención, purgas y vigilantes que fallan.',
  },
  ERRORES: {
    titulo: 'Errores de la API',
    descripcion: 'Errores 5xx y excepciones sin atrapar.',
  },
  ARRANQUES: {
    titulo: 'Arranques de la API',
    descripcion:
      'Cada arranque (sirve de aviso de despliegue) y los reinicios en bucle.',
  },
  SERVIDOR: {
    titulo: 'Servidor',
    descripcion:
      'Contenedores caídos o reiniciándose, disco y respaldo diario.',
  },
};

/**
 * Qué es una alerta. La CLAVE (`claveAlerta`) dice cuál problema es; el tipo dice
 * de qué clase.
 *
 *  · `SERVICIO_CAIDO` / `SERVICIO_DEGRADADO` — lo que abre el centinela del monitor.
 *    Comparten clave por servicio: si uno degradado se cae, es el MISMO problema que
 *    empeoró, y se vuelve a avisar por la gravedad (`siguienteAccion`).
 *  · `CRON_FALLO` — el `catch` de una tarea programada. Crítica a la tercera seguida.
 *  · `RECORDATORIOS_FALLIDOS` — un lote de recordatorios en el que no salió ninguno.
 *  · `AVISO_AGENDADOR_NO_SALE` — el vigilante del espejo no pudo avisar al agendador
 *    (sin plantilla, sin destino, envío fallido). La excepción en sí es operación de
 *    la clínica y NO viene aquí (A12); que el aviso no salga sí es una falla técnica.
 *  · `REDIS_ERROR` — el cliente de Redis reporta error; sin Redis el bot pierde las
 *    sesiones.
 *  · Eventos sueltos (sin «resuelto»): `ERROR_5XX`, `PROCESO_EXCEPCION`, `API_ARRANCO`,
 *    `REINICIOS_EN_BUCLE`, `ESQUEMA_ESPEJO`.
 */
export const TIPOS_ALERTA = [
  'SERVICIO_CAIDO',
  'SERVICIO_DEGRADADO',
  'CRON_FALLO',
  'RECORDATORIOS_FALLIDOS',
  'AVISO_AGENDADOR_NO_SALE',
  'REDIS_ERROR',
  'ERROR_5XX',
  'PROCESO_EXCEPCION',
  'API_ARRANCO',
  'REINICIOS_EN_BUCLE',
  'ESQUEMA_ESPEJO',
] as const;
export type TipoAlerta = (typeof TIPOS_ALERTA)[number];

export interface DefinicionAlerta {
  categoria: CategoriaAlerta;
  gravedad: GravedadAlerta;
  /** `true` = suelto: se avisa una vez y no tiene «resuelto». */
  evento: boolean;
  /** Corto y sin datos: es el encabezado del mensaje. */
  titulo: string;
}

export const CATALOGO_ALERTAS: Record<TipoAlerta, DefinicionAlerta> = {
  SERVICIO_CAIDO: {
    categoria: 'SERVICIOS',
    gravedad: 'CRITICA',
    evento: false,
    titulo: 'Servicio caído',
  },
  SERVICIO_DEGRADADO: {
    categoria: 'SERVICIOS',
    gravedad: 'ADVERTENCIA',
    evento: false,
    titulo: 'Servicio degradado',
  },
  CRON_FALLO: {
    categoria: 'CRONES',
    gravedad: 'ADVERTENCIA',
    evento: false,
    titulo: 'Una tarea programada falló',
  },
  RECORDATORIOS_FALLIDOS: {
    categoria: 'CRONES',
    gravedad: 'CRITICA',
    evento: false,
    titulo: 'Los recordatorios no están saliendo',
  },
  AVISO_AGENDADOR_NO_SALE: {
    categoria: 'ESPEJO',
    gravedad: 'ADVERTENCIA',
    evento: false,
    titulo: 'El aviso al agendador no sale',
  },
  REDIS_ERROR: {
    categoria: 'SERVICIOS',
    gravedad: 'CRITICA',
    evento: false,
    titulo: 'Redis no responde',
  },
  ERROR_5XX: {
    categoria: 'ERRORES',
    gravedad: 'ADVERTENCIA',
    evento: true,
    titulo: 'Error del servidor',
  },
  PROCESO_EXCEPCION: {
    categoria: 'ERRORES',
    gravedad: 'ADVERTENCIA',
    evento: true,
    titulo: 'Excepción sin atrapar en la API',
  },
  API_ARRANCO: {
    categoria: 'ARRANQUES',
    gravedad: 'INFO',
    evento: true,
    titulo: 'La API arrancó',
  },
  REINICIOS_EN_BUCLE: {
    categoria: 'ARRANQUES',
    gravedad: 'CRITICA',
    evento: true,
    titulo: 'La API se está reiniciando en bucle',
  },
  ESQUEMA_ESPEJO: {
    categoria: 'ESPEJO',
    gravedad: 'CRITICA',
    evento: true,
    titulo: 'Falta el DDL del espejo en la base',
  },
};

/** ABIERTA | RESUELTA | EVENTO (suelto: nunca se abre ni se cierra). */
export const ESTADOS_ALERTA = ['ABIERTA', 'RESUELTA', 'EVENTO'] as const;
export type EstadoAlerta = (typeof ESTADOS_ALERTA)[number];

/**
 * Los umbrales, en un solo sitio (la API y el panel los leen de aquí). Los que el
 * super admin puede cambiar traen su mínimo y su máximo.
 */
export const UMBRALES_ALERTAS = {
  recordatorio: { porDefectoMin: 60, minimoMin: 15, maximoMin: 1440 },
  maxRecordatorios: { porDefecto: 3, maximo: 10 },
  horarioNocturno: { desde: 22, hasta: 6 },
  /** Más de `aperturas` en `ventanaMin` = intermitente: un aviso y silencio. */
  intermitencia: { aperturas: 3, ventanaMin: 30, silencioMin: 30 },
  /** Tope de mensajes al grupo. Telegram permite ~20 por minuto en un grupo. */
  tope: { mensajes: 20, ventanaMin: 10 },
  /** La misma firma de un evento suelto se avisa una vez cada `ventanaMin`. */
  evento: { ventanaMin: 60 },
  cronFallosParaCritica: 3,
  /**
   * …y lleva al menos este tiempo fallando. Un cron diario llega al tercer día; uno
   * de cada 10 segundos no se vuelve «crítico» a los 20 segundos de una caída de
   * Redis (medido en la prueba real de la Fase 2: 73 fallos en 13 minutos).
   */
  cronMinutosParaCritica: 10,
  /**
   * Un lote de recordatorios en el que no salió NINGUNO y fallaron al menos estos.
   * Con menos, puede ser el teléfono de un paciente, no el canal.
   */
  recordatoriosFallidosMin: 3,
  rafaga5xx: { errores: 20, ventanaMin: 5 },
  /** La latencia alta de UN chequeo es un parpadeo de red, no una caída (A5). */
  chequeosParaConfirmarLatencia: 2,
  /** Este arranque y otro en `ventanaMin` = reinicios en bucle. */
  arranquesEnBucle: { ventanaMin: 10 },
  codigoVinculacion: { largo: 6, vigenciaMin: 15 },
  resumenDiario: { hora: 7 },
  retencionDias: 180,
  maxTitulo: 120,
  maxDetalle: 600,
  /** Tope de la Bot API para `sendMessage`. */
  maxMensaje: 4096,
} as const;

// ─────────────────────────────────────────────────────────────
// Claves: qué problema es
// ─────────────────────────────────────────────────────────────

/**
 * Identifican el PROBLEMA, no la fila: el mismo fallo vuelve a dar la misma clave y
 * suma ocurrencias en vez de mandar otro mensaje. Ninguna lleva datos de pacientes.
 */
export const claveAlerta = {
  /** Una clave por servicio: caído y degradado son el mismo problema que cambia. */
  servicio: (serviceKey: string): string => `servicio:${serviceKey}`,
  cron: (nombre: string): string => `cron:${nombre}`,
  recordatorios: (): string => 'cron:recordatorios:lote',
  avisoAgendador: (organizationId: string): string =>
    `espejo:aviso-agendador:${organizationId}`,
  redis: (): string => 'servicio:redis',
  /** Por firma: código, método, ruta sin ids y clase de la excepción. Nunca el mensaje. */
  error5xx: (
    status: number,
    metodo: string,
    ruta: string,
    excepcion: string,
  ): string =>
    `5xx:${status}:${metodo.toUpperCase()}:${normalizarRuta(ruta)}:${excepcion}`,
  proceso: (
    origen: 'unhandledRejection' | 'uncaughtException',
    excepcion: string,
  ): string => `proceso:${origen}:${excepcion}`,
  arranque: (): string => 'api:arranque',
  reiniciosEnBucle: (): string => 'api:reinicios',
  esquemaEspejo: (): string => 'espejo:esquema',
};

const RE_UUID =
  /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi;
const RE_UUID_COMPLETO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const digitosDe = (s: string): number => s.replace(/\D/g, '').length;

/**
 * La ruta de una petición sin lo que la hace única: `/appointments/3f…/cancel?x=1` →
 * `/appointments/:id/cancel`. Sin esto cada cita daría una firma distinta (y un
 * mensaje por cita), y un documento o un teléfono en la ruta llegaría a Telegram.
 */
export function normalizarRuta(ruta: string): string {
  const sinQuery = (ruta || '/').split(/[?#]/)[0] || '/';
  const segmentos = sinQuery.split('/').map((s) => {
    if (!s) return s;
    if (RE_UUID_COMPLETO.test(s)) return ':id';
    if (/\d/.test(s) && /^[\d.+-]+$/.test(s)) return ':id';
    // Un BSUID (`CO.1349…`) o un documento pegado a letras.
    if (digitosDe(s) >= 6) return ':id';
    if (s.includes('@') || s.toLowerCase().includes('%40')) return ':id';
    if (/^[0-9a-f]{16,}$/i.test(s)) return ':id';
    if (s.length >= 20 && /\d/.test(s) && /^[A-Za-z0-9_-]+$/.test(s)) {
      return ':id';
    }
    return s;
  });
  const normalizada = segmentos.join('/') || '/';
  return normalizada.length > 120
    ? `${normalizada.slice(0, 119)}…`
    : normalizada;
}

// ─────────────────────────────────────────────────────────────
// Sanitizado: nada de pacientes hacia Telegram
// ─────────────────────────────────────────────────────────────

export const DATO_OCULTO = '[dato oculto]';

/** Solo una fecha COMPLETA: un pedazo de un número más largo no se respeta. */
const RE_FECHA_ISO =
  /(?<![\d.-])(?:19|20)\d{2}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\d-])/g;
/**
 * IPv4 privadas y de loopback, con su puerto: son de nuestros servidores (la base,
 * Redis, el HIS en la LAN del hospital) y el equipo las necesita. Las públicas
 * NO se respetan: podrían ser de una persona. Ningún documento escrito con puntos
 * empieza así (1.088.123.456 tiene un primer grupo de un dígito).
 */
const RE_IP_PRIVADA =
  /(?<![\d.])(?:10\.\d{1,3}|127\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?::\d{1,5})?(?![\d.])/g;
const RE_CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Tokens, claves, JWT, rutas secretas: largos y con letras Y dígitos. */
const RE_SECRETO = /[A-Za-z0-9_-]{20,}/g;
/** Documentos y teléfonos, también escritos con espacios, puntos o guiones. */
const RE_NUMERO = /\+?\d(?:[\d .-]*\d)?/g;

/**
 * Deja un texto libre listo para Telegram: tapa correos, secretos y toda cifra de 6
 * o más dígitos (documentos, teléfonos, BSUID, el id de un chat), normaliza los
 * espacios y lo recorta.
 *
 * Los UUID, las fechas ISO y las IP privadas se respetan: un UUID no identifica a
 * una persona y es lo que el equipo necesita para encontrar la clínica o el
 * incidente; una fecha no es un documento aunque tenga ocho dígitos; una IP privada
 * es de un servidor nuestro.
 *
 * Lo que NO puede hacer: reconocer un nombre propio. Por eso quien abre una alerta no
 * le pasa nombres de pacientes (ver el encabezado del archivo).
 */
export function sanitizarTextoAlerta(
  texto: string | null | undefined,
  max: number = UMBRALES_ALERTAS.maxDetalle,
): string {
  if (!texto) return '';

  // 1. Apartar lo que se respeta, para que las reglas de abajo no lo toquen.
  //    El marcador no tiene dígitos ni letras: ninguna regla lo puede alcanzar.
  const apartados: string[] = [];
  const apartar = (m: string): string => {
    apartados.push(m);
    return `\u0000${'\u0001'.repeat(apartados.length)}\u0000`;
  };
  let t = texto
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\v\f]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, '');
  t = t
    .replace(RE_UUID, apartar)
    .replace(RE_FECHA_ISO, apartar)
    .replace(RE_IP_PRIVADA, apartar);

  // 2. Tapar.
  t = t
    .replace(RE_CORREO, DATO_OCULTO)
    .replace(RE_SECRETO, (m) =>
      /\d/.test(m) && /[A-Za-z]/.test(m) ? DATO_OCULTO : m,
    )
    .replace(RE_NUMERO, (m) => (digitosDe(m) >= 6 ? DATO_OCULTO : m));

  // 3. Devolver lo apartado. Cada marcador va entre dos \u0000, así que ninguno
  //    contiene a otro.
  apartados.forEach((original, i) => {
    t = t.split(`\u0000${'\u0001'.repeat(i + 1)}\u0000`).join(original);
  });

  t = t
    .split('\n')
    .map((linea) => linea.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return recortar(t, max);
}

function recortar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto;
}

// ─────────────────────────────────────────────────────────────
// Del monitor a una alerta
// ─────────────────────────────────────────────────────────────

/** El espejo tiene categoría propia; todo lo demás del monitor es un servicio externo. */
export function categoriaDeServicio(serviceKey: string): CategoriaAlerta {
  return serviceKey === 'mirror' ? 'ESPEJO' : 'SERVICIOS';
}

/**
 * ¿El incidente que abrió el centinela merece aviso YA? Una caída, siempre al primer
 * chequeo. Una latencia alta, solo si se repite: el 2026-10-12 Gemini y Meta
 * «degradaron» en el mismo segundo por un parpadeo de red del VPS y se recuperaron
 * al chequeo siguiente (A5).
 */
export function incidenteDebeAvisar(
  incidente: { status: string; errorCode?: string | null },
  chequeosSeguidos: number,
): boolean {
  if (incidente.status === 'DOWN') return true;
  if (incidente.errorCode === 'HIGH_LATENCY') {
    return chequeosSeguidos >= UMBRALES_ALERTAS.chequeosParaConfirmarLatencia;
  }
  return true;
}

export interface AlertaNueva {
  kind: TipoAlerta;
  category: CategoriaAlerta;
  severity: GravedadAlerta;
  dedupeKey: string;
  title: string;
  detail: string;
}

/** Lo que el centinela abre (o actualiza) cuando un servicio no está `UP`. */
export function alertaDeIncidente(incidente: {
  serviceKey: string;
  displayName: string;
  status: 'DOWN' | 'DEGRADED';
  errorMessage?: string | null;
}): AlertaNueva {
  const kind: TipoAlerta =
    incidente.status === 'DOWN' ? 'SERVICIO_CAIDO' : 'SERVICIO_DEGRADADO';
  return {
    kind,
    category: categoriaDeServicio(incidente.serviceKey),
    severity: CATALOGO_ALERTAS[kind].gravedad,
    dedupeKey: claveAlerta.servicio(incidente.serviceKey),
    title: sanitizarTextoAlerta(
      incidente.displayName,
      UMBRALES_ALERTAS.maxTitulo,
    ),
    detail: sanitizarTextoAlerta(incidente.errorMessage),
  };
}

/**
 * La gravedad según cuánto lleva el problema abierto: una tarea que falla una vez
 * puede ser un tropiezo; tres seguidas durante al menos `cronMinutosParaCritica`,
 * no. Sin `abierta` (la primera vez) cuenta solo la repetición.
 */
export function gravedadDeAlerta(
  kind: TipoAlerta,
  ocurrencias: number,
  abierta?: { desdeIso: string; ahoraIso: string },
): GravedadAlerta {
  if (
    kind === 'CRON_FALLO' &&
    ocurrencias >= UMBRALES_ALERTAS.cronFallosParaCritica &&
    (!abierta ||
      Date.parse(abierta.ahoraIso) - Date.parse(abierta.desdeIso) >=
        UMBRALES_ALERTAS.cronMinutosParaCritica * MS_MIN)
  ) {
    return 'CRITICA';
  }
  return CATALOGO_ALERTAS[kind].gravedad;
}

/**
 * ¿El lote de recordatorios dice que el canal no funciona? Solo si no salió
 * ninguno y fallaron varios: un fallo suelto es un número que no tiene WhatsApp.
 */
export function loteDeRecordatoriosCaido(lote: {
  sent: number;
  failed: number;
}): boolean {
  return (
    lote.sent === 0 && lote.failed >= UMBRALES_ALERTAS.recordatoriosFallidosMin
  );
}

/** Un 5xx suelto es una advertencia; una ráfaga, una caída. */
export function gravedadDeRafaga5xx(erroresEnVentana: number): GravedadAlerta {
  return erroresEnVentana >= UMBRALES_ALERTAS.rafaga5xx.errores
    ? 'CRITICA'
    : 'ADVERTENCIA';
}

/** ¿Este arranque y otro reciente son un bucle de reinicios? */
export function arranqueEnBucle(
  arranquesPreviosIso: string[],
  ahoraIso: string,
): boolean {
  return (
    contarEnVentana(
      arranquesPreviosIso,
      ahoraIso,
      UMBRALES_ALERTAS.arranquesEnBucle.ventanaMin,
    ) > 0
  );
}

// ─────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────

export interface ConfigAntirruido {
  reminderMinutes: number;
  maxReminders: number;
  quietHoursEnabled: boolean;
  quietFromHour: number;
  quietToHour: number;
  categories: Record<CategoriaAlerta, boolean>;
}

/**
 * Las categorías tal como las guarda la base (`categories Json?`). Una que no
 * aparece, o que no es booleana, está ENCENDIDA (A6): agregar una categoría nueva
 * no puede apagarla en silencio.
 */
export function leerCategorias(raw: unknown): Record<CategoriaAlerta, boolean> {
  const fuente =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    CATEGORIAS_ALERTA.map((c) => [c, fuente[c] !== false]),
  ) as Record<CategoriaAlerta, boolean>;
}

function enteroEntre(
  valor: unknown,
  min: number,
  max: number,
  porDefecto: number,
): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Lo que viene del panel o de la base, dentro de sus límites. Un valor imposible
 * cae al de por defecto (o al límite más cercano), nunca rompe el envío.
 */
export function normalizarConfigAlertas(raw: {
  reminderMinutes?: unknown;
  maxReminders?: unknown;
  quietHoursEnabled?: unknown;
  quietFromHour?: unknown;
  quietToHour?: unknown;
  categories?: unknown;
}): ConfigAntirruido {
  const r = UMBRALES_ALERTAS.recordatorio;
  const n = UMBRALES_ALERTAS.horarioNocturno;
  return {
    reminderMinutes: enteroEntre(
      raw.reminderMinutes,
      r.minimoMin,
      r.maximoMin,
      r.porDefectoMin,
    ),
    maxReminders: enteroEntre(
      raw.maxReminders,
      0,
      UMBRALES_ALERTAS.maxRecordatorios.maximo,
      UMBRALES_ALERTAS.maxRecordatorios.porDefecto,
    ),
    quietHoursEnabled: raw.quietHoursEnabled !== false,
    quietFromHour: enteroEntre(raw.quietFromHour, 0, 23, n.desde),
    quietToHour: enteroEntre(raw.quietToHour, 0, 23, n.hasta),
    categories: leerCategorias(raw.categories),
  };
}

export type MotivoSinEnvio = 'APAGADO' | 'CATEGORIA_APAGADA' | 'SILENCIADO';

/**
 * ¿Por qué NO se envía ahora? `null` = se envía. Un problema que no se envía se
 * registra igual (queda en la bitácora); uno silenciado que siga abierto al terminar
 * el silencio se avisa entonces.
 */
export function motivoParaNoEnviar(
  categoria: CategoriaAlerta,
  config: {
    enabled: boolean;
    categories: Record<CategoriaAlerta, boolean>;
    mutedUntilIso: string | null;
  },
  ahoraIso: string,
): MotivoSinEnvio | null {
  if (!config.enabled) return 'APAGADO';
  if (!config.categories[categoria]) return 'CATEGORIA_APAGADA';
  if (estaSilenciado(config.mutedUntilIso, ahoraIso)) return 'SILENCIADO';
  return null;
}

export function estaSilenciado(
  mutedUntilIso: string | null,
  ahoraIso: string,
): boolean {
  if (!mutedUntilIso) return false;
  const hasta = Date.parse(mutedUntilIso);
  return !Number.isNaN(hasta) && hasta > Date.parse(ahoraIso);
}

// ─────────────────────────────────────────────────────────────
// Antirruido: qué toca enviar
// ─────────────────────────────────────────────────────────────

export type AccionAlerta = 'AVISO' | 'RECORDATORIO' | 'RESOLUCION';

export interface AlertaVista {
  kind: TipoAlerta;
  severity: GravedadAlerta;
  status: EstadoAlerta;
  notifiedAtIso: string | null;
  notifiedSeverity: string | null;
  resolvedAtIso: string | null;
  resolutionNotifiedAtIso: string | null;
  reminderCount: number;
  lastReminderAtIso: string | null;
}

/**
 * Lo que el despachador tiene que mandar de esta alerta, o `null`.
 *
 *  · EVENTO: el aviso, una vez.
 *  · ABIERTA: el aviso si nunca se dio o si la gravedad SUBIÓ (empeoró); si no, un
 *    recordatorio cada `reminderMinutes`, hasta `maxReminders` (nunca de una INFO).
 *    Al avisar de nuevo por la gravedad, la API pone `reminderCount` en 0.
 *  · RESUELTA: el «resuelto», solo si antes se avisó. Lo que se resolvió antes de
 *    avisar (un parpadeo, un silencio, Telegram caído) no se anuncia: queda en la
 *    bitácora y en el resumen diario.
 */
export function siguienteAccion(
  a: AlertaVista,
  config: { reminderMinutes: number; maxReminders: number },
  ahoraIso: string,
): AccionAlerta | null {
  if (a.status === 'EVENTO') return a.notifiedAtIso ? null : 'AVISO';

  if (a.status === 'RESUELTA') {
    return a.notifiedAtIso && !a.resolutionNotifiedAtIso ? 'RESOLUCION' : null;
  }

  if (!a.notifiedAtIso || !a.notifiedSeverity) return 'AVISO';
  const previa =
    ORDEN_GRAVEDAD_ALERTA[a.notifiedSeverity as GravedadAlerta] ?? -1;
  if (ORDEN_GRAVEDAD_ALERTA[a.severity] > previa) return 'AVISO';

  if (a.severity === 'INFO') return null;
  if (a.reminderCount >= config.maxReminders) return null;
  const desde = Date.parse(a.lastReminderAtIso ?? a.notifiedAtIso);
  if (Number.isNaN(desde)) return null;
  return Date.parse(ahoraIso) - desde >= config.reminderMinutes * MS_MIN
    ? 'RECORDATORIO'
    : null;
}

function contarEnVentana(
  instantesIso: string[],
  ahoraIso: string,
  ventanaMin: number,
): number {
  const ahora = Date.parse(ahoraIso);
  const desde = ahora - ventanaMin * MS_MIN;
  return instantesIso.filter((iso) => {
    const t = Date.parse(iso);
    return !Number.isNaN(t) && t > desde && t <= ahora;
  }).length;
}

/**
 * ¿La clave se abre y se cierra sin parar? Con más de `aperturas` en la ventana sale
 * un solo «intermitente» y se silencia esa clave `silencioMin`.
 */
export function esIntermitente(
  aperturasIso: string[],
  ahoraIso: string,
): boolean {
  const { aperturas, ventanaMin } = UMBRALES_ALERTAS.intermitencia;
  return contarEnVentana(aperturasIso, ahoraIso, ventanaMin) > aperturas;
}

/**
 * Qué hacer con una clave que se acaba de abrir otra vez:
 *  · `SUPRIMIR` — ya se avisó que es intermitente hace menos de `silencioMin`: se
 *    registra, pero no se manda nada (ni su «resuelto»);
 *  · `AVISAR`   — se volvió intermitente: un solo «⚠️ INTERMITENTE» en lugar del aviso;
 *  · `NORMAL`   — el aviso de siempre.
 */
export function decidirIntermitencia(
  aperturasIso: string[],
  ultimoAvisoIntermitenteIso: string | null,
  ahoraIso: string,
): 'NORMAL' | 'AVISAR' | 'SUPRIMIR' {
  const { silencioMin } = UMBRALES_ALERTAS.intermitencia;
  if (
    ultimoAvisoIntermitenteIso &&
    contarEnVentana([ultimoAvisoIntermitenteIso], ahoraIso, silencioMin) > 0
  ) {
    return 'SUPRIMIR';
  }
  return esIntermitente(aperturasIso, ahoraIso) ? 'AVISAR' : 'NORMAL';
}

/** Cuántos mensajes más caben ahora sin pasar el tope general. */
export function cupoDeEnvio(enviosIso: string[], ahoraIso: string): number {
  const { mensajes, ventanaMin } = UMBRALES_ALERTAS.tope;
  return Math.max(
    0,
    mensajes - contarEnVentana(enviosIso, ahoraIso, ventanaMin),
  );
}

/** ¿Ya se avisó esta firma de evento hace menos de la ventana? Entonces solo se cuenta. */
export function eventoRepetido(
  ultimoAvisoIso: string | null,
  ahoraIso: string,
): boolean {
  if (!ultimoAvisoIso) return false;
  return (
    contarEnVentana(
      [ultimoAvisoIso],
      ahoraIso,
      UMBRALES_ALERTAS.evento.ventanaMin,
    ) > 0
  );
}

/** Hora (0-23) en esa zona; `formatToParts` con `h23` para que la medianoche sea 0. */
function horaLocal(fecha: Date, timeZone: string): number {
  const hora = new Intl.DateTimeFormat('es-CO', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone,
  })
    .formatToParts(fecha)
    .find((p) => p.type === 'hour')?.value;
  return hora ? Number(hora) : fecha.getUTCHours();
}

/**
 * ¿El mensaje sale SIN sonido (`disable_notification`)? Una INFO siempre; una
 * CRÍTICA nunca; una ADVERTENCIA solo en el horario nocturno. El horario puede
 * cruzar la medianoche (22 → 6); con `desde = hasta` no hay horario.
 */
export function sinSonido(
  gravedad: GravedadAlerta,
  ahora: Date | string,
  config: Pick<
    ConfigAntirruido,
    'quietHoursEnabled' | 'quietFromHour' | 'quietToHour'
  >,
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  if (gravedad === 'INFO') return true;
  if (gravedad === 'CRITICA') return false;
  if (!config.quietHoursEnabled) return false;
  const { quietFromHour: desde, quietToHour: hasta } = config;
  if (desde === hasta) return false;
  const hora = horaLocal(
    typeof ahora === 'string' ? new Date(ahora) : ahora,
    timeZone,
  );
  return desde < hasta
    ? hora >= desde && hora < hasta
    : hora >= desde || hora < hasta;
}

// ─────────────────────────────────────────────────────────────
// Silencio y resumen diario: horas de reloj en Colombia
// ─────────────────────────────────────────────────────────────

/** La próxima vez que en esa zona sean las `hora`:00: hoy si aún no llega, si no mañana. */
export function proximaHoraLocal(
  hora: number,
  ahora: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const [y, m, d] = diaLocal(ahora, timeZone).split('-').map(Number);
  const hoy = horaLocalAUtc(y, m, d, hora, timeZone);
  if (hoy.getTime() > ahora.getTime()) return hoy;
  const manana = new Date(Date.UTC(y, m - 1, d + 1));
  return horaLocalAUtc(
    manana.getUTCFullYear(),
    manana.getUTCMonth() + 1,
    manana.getUTCDate(),
    hora,
    timeZone,
  );
}

/** Lo que ofrece el botón «Silenciar» del panel. */
export const OPCIONES_SILENCIO = [
  'UNA_HORA',
  'CUATRO_HORAS',
  'HASTA_MANANA',
] as const;
export type OpcionSilencio = (typeof OPCIONES_SILENCIO)[number];

export const TEXTO_OPCION_SILENCIO: Record<OpcionSilencio, string> = {
  UNA_HORA: '1 hora',
  CUATRO_HORAS: '4 horas',
  HASTA_MANANA: `Hasta mañana a las ${UMBRALES_ALERTAS.resumenDiario.hora}:00`,
};

/**
 * Hasta cuándo dura el silencio. «Hasta mañana» termina a la hora del resumen
 * diario: a las 02:00 de la madrugada eso es hoy a las 07:00, no pasado mañana.
 */
export function finDelSilencio(
  opcion: OpcionSilencio,
  ahora: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  if (opcion === 'UNA_HORA') return new Date(ahora.getTime() + 60 * MS_MIN);
  if (opcion === 'CUATRO_HORAS')
    return new Date(ahora.getTime() + 240 * MS_MIN);
  return proximaHoraLocal(UMBRALES_ALERTAS.resumenDiario.hora, ahora, timeZone);
}

/**
 * El resumen de hoy: a partir de cuándo toca (hoy a las 07:00 locales) y qué día
 * resume (ayer, de medianoche a medianoche en Colombia).
 */
export function ventanaResumenDiario(
  ahora: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): { toca: Date; desde: Date; hasta: Date } {
  const [y, m, d] = diaLocal(ahora, timeZone).split('-').map(Number);
  const ayer = new Date(Date.UTC(y, m - 1, d - 1));
  return {
    toca: horaLocalAUtc(y, m, d, UMBRALES_ALERTAS.resumenDiario.hora, timeZone),
    desde: horaLocalAUtc(
      ayer.getUTCFullYear(),
      ayer.getUTCMonth() + 1,
      ayer.getUTCDate(),
      0,
      timeZone,
    ),
    hasta: horaLocalAUtc(y, m, d, 0, timeZone),
  };
}

/** ¿Ya toca el resumen de hoy y no ha salido? */
export function tocaResumenDiario(
  ultimoIso: string | null,
  ahora: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  const { toca } = ventanaResumenDiario(ahora, timeZone);
  if (ahora.getTime() < toca.getTime()) return false;
  if (!ultimoIso) return true;
  const ultimo = Date.parse(ultimoIso);
  return Number.isNaN(ultimo) || ultimo < toca.getTime();
}

// ─────────────────────────────────────────────────────────────
// Vinculación del grupo
// ─────────────────────────────────────────────────────────────

/** Sin 0/O, 1/I/L: se dicta y se copia de una pantalla sin confundirse. */
export const ALFABETO_CODIGO_VINCULACION = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * El código de un solo uso a partir de bytes aleatorios (la API los saca de
 * `crypto.randomBytes`; aquí no hay azar para poder probarlo).
 */
export function codigoVinculacion(bytes: Uint8Array): string {
  const largo = UMBRALES_ALERTAS.codigoVinculacion.largo;
  if (bytes.length < largo) {
    throw new Error(`Hacen falta ${largo} bytes para el código.`);
  }
  const alfabeto = ALFABETO_CODIGO_VINCULACION;
  return Array.from(
    bytes.slice(0, largo),
    (b) => alfabeto[b % alfabeto.length],
  ).join('');
}

/**
 * El código que alguien escribió en el grupo: `/vincular 4F7K2Q` o, como lo arma
 * Telegram al tocar el comando, `/vincular@AgeniaTecnicoBot 4F7K2Q`. En mayúsculas,
 * o `null` si el mensaje no es eso.
 */
export function extraerCodigoVinculacion(
  texto: string | null | undefined,
): string | null {
  const m =
    /^\/vincular(?:@[A-Za-z0-9_]{3,64})?\s+([A-Za-z0-9]{4,12})\s*$/i.exec(
      (texto ?? '').trim(),
    );
  return m ? m[1].toUpperCase() : null;
}

export function codigoVinculacionVigente(
  expiraIso: string | null,
  ahoraIso: string,
): boolean {
  if (!expiraIso) return false;
  const expira = Date.parse(expiraIso);
  return !Number.isNaN(expira) && expira > Date.parse(ahoraIso);
}

// ─────────────────────────────────────────────────────────────
// Enlaces al panel
// ─────────────────────────────────────────────────────────────

/**
 * De dónde salen los enlaces del mensaje: la URL que el super admin escribió, o la
 * pública de la API sin `/api` (en el servidor de dominio único son el mismo
 * dominio). `null` si ninguna sirve: el mensaje sale sin enlace, no se cae.
 */
export function baseDelPanel(
  panelBaseUrl: string | null | undefined,
  publicApiUrl: string | null | undefined,
): string | null {
  const limpia = (url: string | null | undefined): string | null => {
    const u = (url ?? '').trim().replace(/\/+$/, '');
    return /^https?:\/\/[^\s/]+/.test(u) ? u : null;
  };
  return (
    limpia(panelBaseUrl) ??
    limpia((publicApiUrl ?? '').replace(/\/+$/, '').replace(/\/api$/, ''))
  );
}

export function enlacePanel(base: string | null, ruta: string): string | null {
  return base ? `${base}${ruta.startsWith('/') ? ruta : `/${ruta}`}` : null;
}

// ─────────────────────────────────────────────────────────────
// Textos
// ─────────────────────────────────────────────────────────────

/** `6 min`, `1 h 20 min`, `2 d 3 h`. */
export function duracionLegible(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / MS_MIN);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) {
    const resto = min % 60;
    return resto ? `${horas} h ${resto} min` : `${horas} h`;
  }
  const dias = Math.floor(horas / 24);
  const restoH = horas % 24;
  return restoH ? `${dias} d ${restoH} h` : `${dias} d`;
}

function etiquetaZona(timeZone: string): string {
  return timeZone === DEFAULT_TIMEZONE ? 'hora Colombia' : timeZone;
}

function encabezado(
  severity: GravedadAlerta,
  kind: TipoAlerta,
  prefijo = '',
): string {
  return `${prefijo}${ICONO_GRAVEDAD_ALERTA[severity]} ${TEXTO_GRAVEDAD_ALERTA[severity]} · ${CATALOGO_ALERTAS[kind].titulo}`;
}

export interface DatosMensajeAlerta {
  kind: TipoAlerta;
  severity: GravedadAlerta;
  title: string;
  detail?: string | null;
  organizationName?: string | null;
  firstSeenIso: string;
  occurrences?: number;
  /** Quién lo vio: «centinela del monitor», «cron de recordatorios»… */
  fuente?: string | null;
  enlace?: string | null;
}

function lineasComunes(d: DatosMensajeAlerta): string[] {
  const lineas: string[] = [];
  const titulo = sanitizarTextoAlerta(d.title, UMBRALES_ALERTAS.maxTitulo);
  if (titulo) lineas.push(titulo);
  if (d.organizationName?.trim()) {
    lineas.push(`Clínica: ${d.organizationName.trim()}`);
  }
  const detalle = sanitizarTextoAlerta(d.detail);
  if (detalle) lineas.push(`Qué pasa: ${detalle}`);
  return lineas;
}

function cola(d: DatosMensajeAlerta): string[] {
  const lineas: string[] = [];
  const fuente = sanitizarTextoAlerta(d.fuente, 80);
  if (fuente) lineas.push(`Detectado por: ${fuente}`);
  if (d.enlace) lineas.push(`Ver: ${d.enlace}`);
  return lineas;
}

function mensaje(lineas: string[]): string {
  return recortar(lineas.join('\n'), UMBRALES_ALERTAS.maxMensaje);
}

/**
 * El primer aviso de un problema (o de un evento). Con `empeoro`, es el mismo
 * problema que subió de gravedad.
 *
 *   🔴 CRÍTICA · Servicio caído
 *   Espejo con el HIS
 *   Clínica: E.S.E. Hospital San Vicente de Paúl
 *   Qué pasa: Sin heartbeat del agente hace 7 min.
 *   Desde: lun, 19 oct, 10:38 a m (hora Colombia)
 *   Detectado por: centinela del monitor
 *   Ver: https://…/super-admin/monitor
 */
export function textoAviso(
  d: DatosMensajeAlerta,
  opts: { timeZone?: string; empeoro?: boolean } = {},
): string {
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const lineas = [
    `${encabezado(d.severity, d.kind)}${opts.empeoro ? ' (empeoró)' : ''}`,
    ...lineasComunes(d),
    `Desde: ${formatAppointmentCompact(d.firstSeenIso, { timeZone: tz })} (${etiquetaZona(tz)})`,
  ];
  if (d.occurrences && d.occurrences > 1) {
    lineas.push(`Repeticiones: ${d.occurrences}`);
  }
  return mensaje([...lineas, ...cola(d)]);
}

/** Sigue abierto y nadie lo ha resuelto: «RECORDATORIO 1 de 3». */
export function textoRecordatorio(
  d: DatosMensajeAlerta,
  ctx: { numero: number; de: number; ahoraIso: string },
): string {
  const lleva = Date.parse(ctx.ahoraIso) - Date.parse(d.firstSeenIso);
  return mensaje([
    encabezado(
      d.severity,
      d.kind,
      `⏰ RECORDATORIO ${ctx.numero} de ${ctx.de} · `,
    ),
    ...lineasComunes(d),
    `Sigue sin resolverse desde hace ${duracionLegible(lleva)}.`,
    ...cola(d),
  ]);
}

/** «✅ RESUELTO», con cuánto duró. Si cruzó la medianoche, con las dos fechas. */
export function textoResolucion(
  d: Pick<
    DatosMensajeAlerta,
    'kind' | 'title' | 'organizationName' | 'firstSeenIso'
  >,
  resolvedIso: string,
  opts: { timeZone?: string } = {},
): string {
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const mismoDia =
    formatDateShort(d.firstSeenIso, { timeZone: tz }) ===
    formatDateShort(resolvedIso, { timeZone: tz });
  const desde = mismoDia
    ? formatTimeOnly(d.firstSeenIso, { timeZone: tz })
    : formatAppointmentCompact(d.firstSeenIso, { timeZone: tz });
  const hasta = mismoDia
    ? formatTimeOnly(resolvedIso, { timeZone: tz })
    : formatAppointmentCompact(resolvedIso, { timeZone: tz });
  const duro = duracionLegible(
    Date.parse(resolvedIso) - Date.parse(d.firstSeenIso),
  );
  const lineas = [`✅ RESUELTO · ${CATALOGO_ALERTAS[d.kind].titulo}`];
  const titulo = sanitizarTextoAlerta(d.title, UMBRALES_ALERTAS.maxTitulo);
  if (titulo) lineas.push(titulo);
  if (d.organizationName?.trim())
    lineas.push(`Clínica: ${d.organizationName.trim()}`);
  lineas.push(`Duró ${duro} (${desde} → ${hasta}, ${etiquetaZona(tz)}).`);
  return mensaje(lineas);
}

/**
 * Varios problemas abiertos en la misma vuelta van en UN mensaje (el 2026-10-12
 * habrían sido dos seguidos por el mismo parpadeo de red). Encabeza la peor gravedad.
 */
export function textoAvisoAgrupado(
  items: DatosMensajeAlerta[],
  enlace: string | null = null,
): string {
  if (items.length === 0) return '';
  const peor = items.reduce<GravedadAlerta>(
    (acc, i) =>
      ORDEN_GRAVEDAD_ALERTA[i.severity] > ORDEN_GRAVEDAD_ALERTA[acc]
        ? i.severity
        : acc,
    'INFO',
  );
  const lineas = [
    `${ICONO_GRAVEDAD_ALERTA[peor]} ${items.length} alertas nuevas`,
  ];
  for (const i of items) {
    const partes = [
      `${ICONO_GRAVEDAD_ALERTA[i.severity]} ${CATALOGO_ALERTAS[i.kind].titulo}`,
      sanitizarTextoAlerta(i.title, UMBRALES_ALERTAS.maxTitulo),
    ].filter(Boolean);
    const detalle = sanitizarTextoAlerta(i.detail, 160);
    const clinica = i.organizationName?.trim();
    lineas.push(
      `• ${partes.join(' · ')}${clinica ? ` — ${clinica}` : ''}${detalle ? `: ${detalle}` : ''}`,
    );
  }
  if (enlace) lineas.push(`Ver: ${enlace}`);
  return mensaje(lineas);
}

/** Se abre y se cierra sin parar: un aviso y silencio por un rato. */
export function textoIntermitente(
  d: Pick<DatosMensajeAlerta, 'kind' | 'title' | 'organizationName' | 'enlace'>,
  aperturas: number,
): string {
  const { ventanaMin, silencioMin } = UMBRALES_ALERTAS.intermitencia;
  const lineas = [`⚠️ INTERMITENTE · ${CATALOGO_ALERTAS[d.kind].titulo}`];
  const titulo = sanitizarTextoAlerta(d.title, UMBRALES_ALERTAS.maxTitulo);
  if (titulo) lineas.push(titulo);
  if (d.organizationName?.trim())
    lineas.push(`Clínica: ${d.organizationName.trim()}`);
  lineas.push(
    `Se abrió y se cerró ${aperturas} veces en ${ventanaMin} min. No se avisa de nuevo en ${silencioMin} min; el detalle sigue en el panel.`,
  );
  if (d.enlace) lineas.push(`Ver: ${d.enlace}`);
  return mensaje(lineas);
}

/** Lo que no cupo en el tope general, en un solo mensaje. */
export function textoExcedente(cuantas: number, enlace: string | null): string {
  const { ventanaMin } = UMBRALES_ALERTAS.tope;
  return mensaje([
    `🔕 Y ${cuantas} ${cuantas === 1 ? 'alerta más' : 'alertas más'} en los últimos ${ventanaMin} min, sin enviar para no inundar el grupo.`,
    enlace ? `Están todas en el panel: ${enlace}` : 'Están todas en el panel.',
  ]);
}

/** El botón «Enviar mensaje de prueba» del panel. */
export function textoPrueba(
  ahoraIso: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return mensaje([
    '✅ Mensaje de prueba de AgenIA',
    'Si lo leen, las alertas técnicas llegan a este grupo.',
    `Enviado: ${formatAppointmentCompact(ahoraIso, { timeZone })} (${etiquetaZona(timeZone)})`,
  ]);
}

/** Lo primero que recibe el grupo al quedar vinculado. */
export function textoVinculado(): string {
  return mensaje([
    '✅ Este grupo recibirá las alertas técnicas de AgenIA.',
    'Solo avisos de fallas, sin datos de pacientes. Se configuran en el panel del super admin.',
    `Cada día a las ${UMBRALES_ALERTAS.resumenDiario.hora}:00 llega un resumen: si un día no llega, revisen el canal.`,
  ]);
}

export interface ResumenDiario {
  /** El día que se resume (ayer). */
  diaIso: string;
  nuevos: number;
  criticos: number;
  resueltos: number;
  abiertos: Pick<
    DatosMensajeAlerta,
    'kind' | 'severity' | 'title' | 'organizationName' | 'firstSeenIso'
  >[];
  enlace?: string | null;
}

/**
 * El resumen de las 07:00 (A13). Es el «latido» del canal: si un día no llega, el
 * problema es el canal (token revocado, bot fuera del grupo), no que todo esté bien.
 */
export function textoResumenDiario(
  r: ResumenDiario,
  opts: { timeZone?: string } = {},
): string {
  const tz = opts.timeZone ?? DEFAULT_TIMEZONE;
  const lineas = [
    `☀️ Resumen técnico de AgenIA · ${formatDateShort(r.diaIso, { timeZone: tz })}`,
  ];
  if (r.nuevos === 0 && r.abiertos.length === 0) {
    lineas.push('Sin novedades. No hay problemas abiertos.');
  } else {
    const criticos =
      r.criticos > 0
        ? ` (${r.criticos} ${r.criticos === 1 ? 'crítico' : 'críticos'})`
        : '';
    lineas.push(
      `Ese día: ${r.nuevos} ${r.nuevos === 1 ? 'problema' : 'problemas'}${criticos}, ${r.resueltos} ${r.resueltos === 1 ? 'resuelto' : 'resueltos'}.`,
    );
    lineas.push(`Abiertos ahora: ${r.abiertos.length}`);
    for (const a of r.abiertos.slice(0, 10)) {
      const titulo = sanitizarTextoAlerta(a.title, UMBRALES_ALERTAS.maxTitulo);
      const clinica = a.organizationName?.trim();
      lineas.push(
        `• ${ICONO_GRAVEDAD_ALERTA[a.severity]} ${CATALOGO_ALERTAS[a.kind].titulo}${titulo ? ` · ${titulo}` : ''}${clinica ? ` — ${clinica}` : ''}, desde ${formatAppointmentCompact(a.firstSeenIso, { timeZone: tz })}`,
      );
    }
    if (r.abiertos.length > 10)
      lineas.push(`• … y ${r.abiertos.length - 10} más`);
  }
  if (r.enlace) lineas.push(`Ver: ${r.enlace}`);
  return mensaje(lineas);
}
