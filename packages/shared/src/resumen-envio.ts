/**
 * Envío del resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md §3.3, §3.6,
 * §3.7, §3.8 y §3.11; Fase 4): lo que se decide sin base de datos ni red.
 *
 *   · qué atenciones nunca se envían (D7, lista configurable);
 *   · a qué número de WhatsApp va (D5 y D6), en orden de preferencia;
 *   · si es hora de enviar (§3.8);
 *   · qué puede encender el panel mientras no se apruebe el piloto (modo prueba);
 *   · el código del botón «Recibir mis documentos».
 *
 * Sin dependencias de Node.
 */
import { normalizePhoneToE164Co } from './avisos-csv';
import { leerConfigResumenAtencion, type ResumenAtencionHis } from './resumen-atencion';

const esObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export const LIMITES_ENVIO_RESUMEN = {
  /** Solo se avisa de consultas de las últimas 24 horas: encender «Enviar» no despacha lo viejo. */
  horasParaAvisar: 24,
  /** D4: cinco fechas de nacimiento equivocadas bloquean una hora. */
  intentosFecha: 5,
  bloqueoMinutos: 60,
  /** Lo que espera el asistente la fecha de nacimiento después de pedirla. */
  esperaFechaMinutos: 30,
  maxDestinosPrueba: 10,
} as const;

// ─── El botón «Recibir mis documentos» ──────────────────────────────────────

const PREFIJO_PAYLOAD = 'resumen:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que devuelve el botón al tocarlo: el envío al que pertenece. */
export function payloadDeEntrega(deliveryId: string): string {
  return `${PREFIJO_PAYLOAD}${deliveryId}`;
}

/** El envío de un botón tocado, o `null` si el botón no es de un resumen. */
export function entregaDelPayload(payload: unknown): string | null {
  if (typeof payload !== 'string' || !payload.startsWith(PREFIJO_PAYLOAD)) return null;
  const id = payload.slice(PREFIJO_PAYLOAD.length);
  return UUID.test(id) ? id : null;
}

/** «mis documentos», «documentos», «quiero mis documentos»: el paciente los pide escribiendo (§3.3, paso 5). */
export function pideSusDocumentos(texto: string | null | undefined): boolean {
  const t = (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^((quiero|recibir|enviar|enviame|mandar|mandame|ver) )?(mis |los )?documentos( de mi consulta)?$/.test(t);
}

const normalizarFrase = (texto: string | null | undefined) =>
  (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * La baja (o el alta) de los resúmenes, escrita por el paciente (plan §3.6).
 * Frases fijas y sin IA, como la de los recordatorios: es una decisión sobre
 * sus datos. «quiero mis documentos» NO es un alta: es pedir los de ahora.
 */
export function intencionDeResumenes(texto: string | null | undefined): 'BAJA' | 'ALTA' | null {
  const t = normalizarFrase(texto);
  if (!/(resumen|resumenes|documentos)$/.test(t)) return null;
  if (/^(activar|activen|si quiero|quiero volver a recibir|quiero recibir)( los| mis)? resumenes$/.test(t)) return 'ALTA';
  const baja =
    /^(no|ya no) (quiero|deseo|me interesa)( mas| recibir)*( los| mis| sus| estos)? (resumenes|documentos)$/.test(t) ||
    /^(baja|baja de|quitar|quiten|cancelar|desactivar|desactiven|no envien|no me envien|dejen de enviar|dejen de enviarme)( los| mis| de)? (resumenes|documentos)$/.test(t);
  return baja ? 'BAJA' : null;
}

// ─── Lo que nunca se envía (D7) ─────────────────────────────────────────────

export interface ExclusionesResumen {
  /** Prefijos CIE-10 sin punto («F», «B20», «Z044»). */
  cie10: string[];
  /** CUPS de remisiones que no se mencionan (psiquiatría, psicología). */
  cups: string[];
  /** Palabras del servicio o la especialidad de la consulta. */
  especialidades: string[];
}

/**
 * Lista inicial propuesta en el plan (§3.7), que valida el comité de historias
 * clínicas: VIH, salud mental, violencia y abuso, interrupción del embarazo,
 * infecciones de transmisión sexual, y las remisiones y consultas de
 * psiquiatría y psicología (ronda 6).
 */
export const EXCLUSIONES_POR_DEFECTO: ExclusionesResumen = {
  cie10: [
    'B20', 'B21', 'B22', 'B23', 'B24', 'Z21',
    'F',
    'T74', 'T76', 'Y05', 'Y06', 'Y07', 'Z044', 'Z045',
    'O04',
    'A50', 'A51', 'A52', 'A53', 'A54', 'A55', 'A56', 'A57', 'A58', 'A59', 'A60', 'A61', 'A62', 'A63', 'A64',
  ],
  cups: ['890284', '890208', '890285'],
  especialidades: ['PSICOLOG', 'PSIQUIATR'],
};

const lista = (x: unknown, normalizar: (s: string) => string): string[] | null =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string').map(normalizar).filter(Boolean) : null;

const codigo = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const palabra = (s: string) =>
  s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Lee `resumenAtencion.exclusiones`; lo que falta toma la lista por defecto (nunca queda sin lista). */
export function leerExclusiones(json: unknown): ExclusionesResumen {
  const e = esObjeto(json) && esObjeto(json.exclusiones) ? json.exclusiones : {};
  return {
    cie10: lista(e.cie10, codigo) ?? EXCLUSIONES_POR_DEFECTO.cie10,
    cups: lista(e.cups, codigo) ?? EXCLUSIONES_POR_DEFECTO.cups,
    especialidades: lista(e.especialidades, palabra) ?? EXCLUSIONES_POR_DEFECTO.especialidades,
  };
}

/** Por qué esta atención no se envía, o `null`. Sin el diagnóstico en el motivo: solo su código. */
export function motivoDeExclusion(r: ResumenAtencionHis, ex: ExclusionesResumen): string | null {
  for (const d of r.diagnosticos) {
    const c = codigo(d.cie10 ?? '');
    const prefijo = ex.cie10.find((p) => p && c.startsWith(p));
    if (prefijo) return `Diagnóstico excluido (${prefijo})`;
  }
  for (const m of r.remisiones) {
    const c = codigo(m.cups ?? '');
    if (c && ex.cups.includes(c)) return `Remisión excluida (${c})`;
  }
  const servicio = palabra(`${r.historia.nombreServicio ?? ''} ${r.historia.especialidad ?? ''}`);
  const esp = ex.especialidades.find((p) => p && servicio.includes(p));
  if (esp) return `Especialidad excluida (${esp})`;
  return null;
}

// ─── A quién se le envía (D5, D6) ───────────────────────────────────────────

/** Un celular colombiano como lo espera WhatsApp: «573001234567»; si no es celular, `null`. */
export function celularParaWhatsapp(crudo: string | null | undefined): string | null {
  const e164 = normalizePhoneToE164Co((crudo ?? '').trim());
  return e164 ? e164.slice(1) : null;
}

export type OrigenDestino = 'PERFIL' | 'HIS' | 'ACOMPANANTE';

export interface CandidatoDestino {
  destino: string;
  origen: OrigenDestino;
}

/**
 * Los números de WhatsApp a los que podría ir, en orden (plan §3.6):
 *  1. el que AgenIA tiene del paciente (escribió al asistente o lo dio el HIS);
 *  2. menor de edad (D6): el celular del acompañante y luego el del HIS;
 *  3. adulto (D5): el celular del HIS.
 * Quien llama descarta los del HIS que AgenIA tiene a nombre de otro documento.
 */
export function candidatosDeDestino(
  perfil: { whatsappId: string | null; bsuid: string | null } | null,
  r: ResumenAtencionHis,
): CandidatoDestino[] {
  const c: CandidatoDestino[] = [];
  const agregar = (destino: string | null, origen: OrigenDestino) => {
    if (destino && !c.some((x) => x.destino === destino)) c.push({ destino, origen });
  };
  if (perfil) {
    agregar(perfil.whatsappId?.trim() || null, 'PERFIL');
    agregar(perfil.bsuid?.trim() || null, 'PERFIL');
  }
  const menor = r.historia.edad !== null && r.historia.edad < 18;
  if (menor) agregar(celularParaWhatsapp(r.paciente.celularAcompanante), 'ACOMPANANTE');
  agregar(celularParaWhatsapp(r.paciente.celular), 'HIS');
  return c;
}

/** «•••4567» (teléfono), «CO.•••1918» (BSUID) o «p•••@gmail.com» (correo). */
export function enmascararDestino(destino: string): string {
  const v = destino.trim();
  if (v.includes('@')) {
    const [usuario, dominio] = v.split('@');
    return `${usuario.charAt(0)}•••@${dominio}`;
  }
  if (/^\d+$/.test(v)) return `•••${v.slice(-4)}`;
  const pais = /^[A-Za-z]{2}\./.test(v) ? v.slice(0, 3) : '';
  return `${pais}•••${v.slice(-4)}`;
}

// ─── Correo (§3.4, D17) ─────────────────────────────────────────────────────

/**
 * Los correos que el hospital pone cuando el paciente no tiene (ronda 3: el 97 %
 * de los pacientes tiene uno de estos). Configurable en el panel.
 */
export const CORREOS_DE_RELLENO_POR_DEFECTO = [
  'pacienteshospital@gmail.com',
  'hsvpanserma@hotmail.com',
  'pacientesanserma@gmail.com',
];

const CORREO = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
/** Lo que se escribe cuando no hay correo: «no@», «notiene@», «sincorreo@»… */
const USUARIO_DE_RELLENO = /^(no|notiene|no\.tiene|sincorreo|sin\.correo|ninguno|nn|na|n\.a|x+|correo|email|prueba|paciente)$/;

/** Lee `resumenAtencion.correosDeRelleno`; sin configurar, la lista por defecto. */
export function leerCorreosDeRelleno(json: unknown): string[] {
  const lista = esObjeto(json) && Array.isArray(json.correosDeRelleno) ? json.correosDeRelleno : null;
  if (!lista) return CORREOS_DE_RELLENO_POR_DEFECTO;
  return lista.filter((c): c is string => typeof c === 'string').map((c) => c.trim().toLowerCase()).filter(Boolean);
}

/** El correo en minúsculas si sirve para enviar: bien escrito, no de relleno. */
export function correoUtilizable(crudo: string | null | undefined, relleno: string[]): string | null {
  const c = (crudo ?? '').trim().toLowerCase();
  if (!CORREO.test(c)) return null;
  if (relleno.includes(c)) return null;
  if (USUARIO_DE_RELLENO.test(c.split('@')[0])) return null;
  return c;
}

/**
 * El correo al que va (plan §3.6): el del paciente; si es menor de edad (D6),
 * primero el del acompañante. `null` si no hay uno utilizable.
 */
export function correoDeDestino(r: ResumenAtencionHis, relleno: string[]): { destino: string; origen: OrigenDestino } | null {
  const menor = r.historia.edad !== null && r.historia.edad < 18;
  const acompanante = correoUtilizable(r.paciente.correoAcompanante, relleno);
  if (menor && acompanante) return { destino: acompanante, origen: 'ACOMPANANTE' };
  const propio = correoUtilizable(r.paciente.correo, relleno);
  if (propio) return { destino: propio, origen: 'HIS' };
  return null;
}

// ─── Horario (§3.8) ─────────────────────────────────────────────────────────

/** Hora local (0-23) de un instante en la zona de la clínica. */
export function horaLocal(ahora: Date, timeZone: string): number {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(ahora);
  return Number(partes.find((p) => p.type === 'hour')?.value ?? '0') % 24;
}

/** ¿Se puede avisar ahora? Desde `desdeHora` (incluida) hasta `hastaHora` (excluida). */
export function dentroDelHorario(ahora: Date, horario: { desdeHora: number; hastaHora: number }, timeZone: string): boolean {
  const h = horaLocal(ahora, timeZone);
  return h >= horario.desdeHora && h < horario.hastaHora;
}

// ─── Lo que el panel puede cambiar del envío (Fase 4: solo modo prueba) ─────

export interface CambioEnvioResumen {
  enviar?: boolean;
  whatsapp?: boolean;
  telegram?: boolean;
  correo?: boolean;
  /** Correos de relleno del hospital (no se usan); reemplaza la lista. */
  correosDeRelleno?: string[];
  /** Servicios de la matriz que envían por WhatsApp; reemplaza la lista. */
  serviciosWhatsapp?: string[];
  /** Servicios de la matriz que envían por Telegram; reemplaza la lista. */
  serviciosTelegram?: string[];
  /** Servicios de la matriz que envían por correo; reemplaza la lista. */
  serviciosCorreo?: string[];
  /** Números del equipo del modo prueba; reemplaza la lista. */
  destinosPrueba?: string[];
}

/** Un destino del equipo: celular colombiano, de 10 a 15 dígitos, un chat de Telegram («tg:123456») o un correo. */
function destinoDePrueba(crudo: string): string | null {
  const tg = /^tg:\s*(-?\d{4,20})$/i.exec(crudo.trim());
  if (tg) return `tg:${tg[1]}`;
  const correo = crudo.trim().toLowerCase();
  if (correo.includes('@')) return CORREO.test(correo) ? correo : null;
  const cel = celularParaWhatsapp(crudo);
  if (cel) return cel;
  const digitos = crudo.replace(/\D/g, '');
  return /^\d{10,15}$/.test(digitos) ? digitos : null;
}

/**
 * Aplica lo que el panel cambia del envío. Mientras no se apruebe el piloto
 * (plan §8, Fase 5), «Enviar a pacientes» solo se enciende con el modo prueba:
 * con al menos un destino del equipo (número, chat de Telegram «tg:<chat>» o
 * correo), y solo a esos destinos.
 */
export function aplicarCambioDeEnvio(
  json: unknown,
  cambio: CambioEnvioResumen,
): { ok: true; config: Record<string, unknown>; cambios: string[] } | { ok: false; error: string } {
  // Sin configuración (null) la función no existe para la clínica: no hay qué encender.
  if (!esObjeto(json)) return { ok: false, error: 'La función no está habilitada para esta clínica.' };
  const base: Record<string, unknown> = { ...json };
  const antes = leerConfigResumenAtencion(base)!;
  const cambios: string[] = [];
  const enLetras = (b: boolean) => (b ? 'encendido' : 'apagado');

  let destinos = antes.modoPrueba.destinos;
  if (cambio.destinosPrueba !== undefined) {
    if (!Array.isArray(cambio.destinosPrueba)) return { ok: false, error: 'La lista de números no es válida.' };
    const limpios: string[] = [];
    for (const d of cambio.destinosPrueba) {
      if (typeof d !== 'string' || !d.trim()) continue;
      const n = destinoDePrueba(d);
      if (!n) return { ok: false, error: `«${d.trim()}» no es un número de celular válido.` };
      if (!limpios.includes(n)) limpios.push(n);
    }
    if (limpios.length > LIMITES_ENVIO_RESUMEN.maxDestinosPrueba) {
      return { ok: false, error: `Máximo ${LIMITES_ENVIO_RESUMEN.maxDestinosPrueba} números en el modo prueba.` };
    }
    if (limpios.join(',') !== destinos.join(',')) {
      cambios.push(`Números del modo prueba: ${destinos.map(enmascararDestino).join(', ') || 'ninguno'} → ${limpios.map(enmascararDestino).join(', ') || 'ninguno'}`);
    }
    destinos = limpios;
    base.modoPrueba = { ...(esObjeto(base.modoPrueba) ? base.modoPrueba : {}), destinos: limpios };
  }

  const canales = { ...antes.canales };
  for (const [clave, canal, nombre] of [
    ['whatsapp', 'WHATSAPP', 'WhatsApp'],
    ['telegram', 'TELEGRAM', 'Telegram'],
    ['correo', 'EMAIL', 'Correo'],
  ] as const) {
    const pedido = cambio[clave];
    if (pedido === undefined) continue;
    const nuevo = pedido === true;
    if (nuevo !== canales[canal]) cambios.push(`Canal ${nombre}: ${enLetras(canales[canal])} → ${enLetras(nuevo)}`);
    canales[canal] = nuevo;
    base.canales = { ...(esObjeto(base.canales) ? base.canales : {}), [canal]: nuevo };
  }

  for (const [clave, canal, nombre] of [
    ['serviciosWhatsapp', 'WHATSAPP', 'WhatsApp'],
    ['serviciosTelegram', 'TELEGRAM', 'Telegram'],
    ['serviciosCorreo', 'EMAIL', 'Correo'],
  ] as const) {
    const pedidos = cambio[clave];
    if (pedidos === undefined) continue;
    if (!Array.isArray(pedidos)) return { ok: false, error: 'La lista de servicios no es válida.' };
    const set = new Set(pedidos.map((x) => String(x).trim()));
    const fuera = [...set].filter((x) => x && !(x in antes.servicios));
    if (fuera.length) return { ok: false, error: `Primero marque «Se lee» en: ${fuera.join(', ')}.` };
    const guardados = esObjeto(base.servicios) ? base.servicios : {};
    const servicios: Record<string, unknown> = { ...guardados };
    for (const [cod, canalesDelServicio] of Object.entries(antes.servicios)) {
      const nuevo = set.has(cod);
      if (nuevo !== canalesDelServicio[canal]) cambios.push(`${nombre} en ${cod}: ${enLetras(canalesDelServicio[canal])} → ${enLetras(nuevo)}`);
      const clavePrevia = Object.keys(guardados).find((k) => k.trim() === cod) ?? cod;
      const previo = guardados[clavePrevia];
      if (clavePrevia !== cod) delete servicios[clavePrevia];
      servicios[cod] = { ...(esObjeto(previo) ? previo : {}), [canal]: nuevo };
    }
    base.servicios = servicios;
  }

  if (cambio.correosDeRelleno !== undefined) {
    if (!Array.isArray(cambio.correosDeRelleno)) return { ok: false, error: 'La lista de correos de relleno no es válida.' };
    const lista = [...new Set(cambio.correosDeRelleno.map((c) => String(c).trim().toLowerCase()).filter(Boolean))];
    const malo = lista.find((c) => !CORREO.test(c));
    if (malo) return { ok: false, error: `«${malo}» no es un correo válido.` };
    if (lista.length > 50) return { ok: false, error: 'Máximo 50 correos de relleno.' };
    const previa = leerCorreosDeRelleno(base);
    if (lista.join(',') !== previa.join(',')) cambios.push(`Correos de relleno: ${lista.length}`);
    base.correosDeRelleno = lista;
  }

  let enviar = antes.enviar;
  if (cambio.enviar !== undefined) {
    const nuevo = cambio.enviar === true;
    if (nuevo !== enviar) cambios.push(`Enviar a pacientes: ${enLetras(enviar)} → ${enLetras(nuevo)}`);
    enviar = nuevo;
    base.enviar = nuevo;
  }
  if (enviar && destinos.length === 0) {
    return {
      ok: false,
      error: 'Mientras no se apruebe el piloto, «Enviar» solo funciona en modo prueba: agregue al menos un número del equipo.',
    };
  }
  return { ok: true, config: base, cambios };
}
