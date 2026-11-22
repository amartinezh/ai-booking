/**
 * ══════════════════════════════════════════════════════════════════════════
 * 🚑 ALERTAS DE POSIBLE EMERGENCIA AL PERSONAL (2026-11-22)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Cuando el asistente deriva a un paciente al 123 / Urgencias (docs/GUARDRAIL_EMERGENCIAS.md),
 * le avisa por WhatsApp a las personas que la clínica eligió en Configuración › Datos de
 * la clínica › Alertas de posible emergencia (`EmergencyAlertRecipient`), para que alguien
 * lo llame. A cualquier hora: una emergencia no espera al horario laboral.
 *
 * POR QUÉ UNA LISTA Y UNA PLANTILLA. Hasta el 2026-11-22 la alerta era texto libre al
 * teléfono de soporte. En Anserma ese teléfono es un fijo (un fijo no tiene WhatsApp) y
 * estaba guardado sin el 57 (WhatsApp lo leía como un número de Malasia): las 11 alertas
 * del 22-oct al 21-nov fallaron y no le llegaron a nadie. Y aunque fuera un celular, el
 * texto libre solo se entrega si ese número le escribió al asistente en las últimas 24
 * horas. La plantilla aprobada (`EMERGENCY_ALERT`) sale siempre.
 *
 * Reglas puras: las usan la API (el envío) y el panel (la validación y la vista), y así
 * dicen lo mismo.
 */
import { formatAppointmentLong } from './date-format';
import { isTelegramSender } from './telegram-identity';

/** Personas ACTIVAS por clínica. Pocas a propósito: es una alerta, no un comunicado. */
export const MAX_DESTINATARIOS_EMERGENCIA = 5;

/** «Enviar prueba» manda como mucho un mensaje por persona en este tiempo. */
export const PRUEBA_EMERGENCIA_CADA_MIN = 5;

/** Lo que el paciente escribió, en la alerta: lo justo para juzgar la gravedad. */
export const MAX_MENSAJE_EN_ALERTA = 300;

/** Nombre sugerido en Meta. La clínica registra el que le aprueben. */
export const NOMBRE_PLANTILLA_EMERGENCIA = 'alerta_posible_emergencia';

/**
 * El cuerpo que se crea en Meta (categoría Utilidad, español de Colombia). Tres
 * variables, en este orden: cuándo, el teléfono del paciente y lo que escribió. No
 * empieza ni termina con una variable (Meta lo rechaza).
 */
export const CUERPO_PLANTILLA_EMERGENCIA = [
  '🚨 *Alerta de posible emergencia médica*',
  '',
  'Un paciente le escribió al asistente virtual algo que podría ser una emergencia, y el asistente le indicó llamar al 123 o ir a Urgencias.',
  '',
  'Cuándo: {{1}}',
  'Teléfono del paciente: {{2}}',
  'Lo que escribió: {{3}}',
  '',
  'Por favor llámelo cuanto antes para hacer el seguimiento y anote el resultado en la Caja Negra del panel de AgenIA.',
].join('\n');

/** El pie (opcional en Meta, sin variables). */
export const PIE_PLANTILLA_EMERGENCIA = 'Aviso automático del asistente virtual';

/** Los ejemplos que Meta pide para cada variable al revisar la plantilla. */
export const EJEMPLOS_PLANTILLA_EMERGENCIA: readonly [string, string, string] = [
  'sábado, 21 de noviembre a las 11:22 p. m.',
  '+57 312 345 6789',
  'Tengo un dolor muy fuerte en el pecho y me falta el aire',
];

/** Un celular de Colombia, como lo espera el envío: solo dígitos, con el 57. */
export type CelularValidado = { ok: true; phone: string } | { ok: false; error: string };

export function validarCelularEmergencia(entrada: unknown): CelularValidado {
  const texto = typeof entrada === 'string' ? entrada.trim() : '';
  if (!texto) return { ok: false, error: 'Escriba el celular.' };
  if (texto.length > 30 || !/^\+?[\d\s().-]+$/.test(texto)) {
    return { ok: false, error: 'Escriba solo el número: dígitos, espacios y el + del indicativo.' };
  }
  let digitos = texto.replace(/\D/g, '');
  if (digitos.length === 12 && digitos.startsWith('57')) digitos = digitos.slice(2);
  if (!/^3\d{9}$/.test(digitos)) {
    return {
      ok: false,
      error: 'Debe ser un celular de Colombia con WhatsApp (10 dígitos, empieza por 3). Un fijo no recibe WhatsApp.',
    };
  }
  return { ok: true, phone: `57${digitos}` };
}

export type NombreValidado = { ok: true; label: string } | { ok: false; error: string };

/** Quién es: «Jefe de enfermería de Urgencias», «Coordinación médica (Dra. Ruiz)». */
export function validarNombreEmergencia(entrada: unknown): NombreValidado {
  const label = typeof entrada === 'string' ? entrada.trim().replace(/\s+/g, ' ') : '';
  if (label.length < 2) return { ok: false, error: 'Escriba quién es (nombre o cargo).' };
  if (label.length > 60) return { ok: false, error: 'El nombre o cargo admite hasta 60 caracteres.' };
  return { ok: true, label };
}

/** «57 3146793010» → «+57 314 679 3010». */
export function celularLegible(phone: string): string {
  const d = phone.replace(/\D/g, '');
  const local = d.length === 12 && d.startsWith('57') ? d.slice(2) : d;
  if (/^3\d{9}$/.test(local)) return `+57 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  return phone;
}

/**
 * Una variable de plantilla: Meta rechaza saltos de línea, tabuladores y más de 4
 * espacios seguidos dentro de una variable, y una variable vacía.
 */
export function variableDePlantilla(texto: string, max: number): string {
  const limpio = texto.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!limpio) return '-';
  return limpio.length > max ? `${limpio.slice(0, max - 1).trimEnd()}…` : limpio;
}

/**
 * Cómo se llama al paciente desde la alerta. El remitente es su teléfono (dígitos), un
 * usuario de WhatsApp sin número visible (BSUID) o uno de Telegram (`tg:`).
 */
export function remitenteParaAlerta(senderId: string): string {
  const valor = (senderId ?? '').trim();
  if (isTelegramSender(valor)) return 'escribió por Telegram, sin número (búsquelo en la Caja Negra)';
  const d = valor.replace(/\D/g, '');
  if (/^\d{10,15}$/.test(valor) && d.length >= 10) {
    return /^573\d{9}$/.test(d) ? celularLegible(d) : `+${d}`;
  }
  return 'WhatsApp no muestra su número (búsquelo en la Caja Negra)';
}

/** Las tres variables de `EMERGENCY_ALERT`, en orden: cuándo, teléfono y lo que escribió. */
export function parametrosAlertaEmergencia(p: {
  senderId: string;
  mensaje: string | null | undefined;
  cuando: Date;
  timeZone?: string;
}): [string, string, string] {
  const mensaje = (p.mensaje ?? '').trim() || '(nota de voz que no se pudo transcribir)';
  return [
    variableDePlantilla(formatAppointmentLong(p.cuando, { timeZone: p.timeZone }), 80),
    variableDePlantilla(remitenteParaAlerta(p.senderId), 90),
    variableDePlantilla(`«${mensaje.replace(/[«»]/g, '"')}»`, MAX_MENSAJE_EN_ALERTA),
  ];
}

/** «Enviar prueba»: la MISMA plantilla, con un texto que no se confunde con un caso real. */
export function parametrosPruebaAlertaEmergencia(cuando: Date, timeZone?: string): [string, string, string] {
  return [
    variableDePlantilla(`PRUEBA, no es un caso real (${formatAppointmentLong(cuando, { timeZone })})`, 80),
    'ninguno, es una prueba',
    'Mensaje de prueba pedido desde el panel: si le llegó, las alertas de posible emergencia le llegan a este WhatsApp',
  ];
}

/**
 * El texto libre de respaldo: solo si la clínica aún no registró la plantilla. WhatsApp
 * lo entrega únicamente a quien le escribió al asistente en las últimas 24 horas.
 */
export function textoLibreAlertaEmergencia(params: readonly [string, string, string]): string {
  return CUERPO_PLANTILLA_EMERGENCIA.replace('{{1}}', params[0])
    .replace('{{2}}', params[1])
    .replace('{{3}}', params[2]);
}

/** Cómo salió la alerta de un caso, para la auditoría (`InteractionLog.metadata`). */
export interface ResultadoAlertaEmergencia {
  /** Meta aceptó el envío a AL MENOS una persona. La entrega se lee después por el wamid. */
  staffAlerted: boolean;
  /** `PLANTILLA`, `TEXTO` (sin plantilla registrada) o `NINGUNO`. */
  canal: 'PLANTILLA' | 'TEXTO' | 'NINGUNO';
  /** A cuántas personas se intentó. */
  destinatarios: number;
  /** A cuántas lo aceptó Meta. */
  aceptados: number;
  /** Los ids de Meta, para leer la entrega en el libro de mensajes. */
  wamids: string[];
  /** Por qué no salió, si no salió a nadie (sin datos del paciente). */
  motivo: string | null;
}
