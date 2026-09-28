/**
 * Formato de WhatsApp → formato de Telegram (docs/PLAN_TELEGRAM.md §6).
 *
 * El bot escribe para WhatsApp: `*negrita*`, `_cursiva_`, `~tachado~` y
 * ```monoespaciado```. Telegram en texto plano los muestra tal cual (el
 * paciente vería los asteriscos), y su Markdown rompe el envío con 400 ante
 * un asterisco sin pareja. Por eso se traduce a su modo HTML, que solo
 * necesita escapar `& < >`: primero se escapa TODO el texto (así un nombre o
 * un servicio con `<` no puede inyectar etiquetas) y después se ponen las
 * etiquetas de las marcas que sí forman pareja en la misma línea.
 */

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Una marca solo cuenta si abre tras inicio/espacio/puntuación de apertura y
 * cierra antes de fin/espacio/puntuación, como en WhatsApp. Así el `_` de una
 * URL (`…/encuesta/ab_cd`) o de un `snake_case` no se vuelve cursiva.
 */
const BEFORE = String.raw`(^|[\s(¡¿"'«])`;
const AFTER = String.raw`(?=$|[\s.,;:!?)"'»])`;
const span = (mark: string) =>
  new RegExp(
    `${BEFORE}${mark}(?!\\s)([^\\n${mark}]*?[^\\s${mark}])${mark}${AFTER}`,
    'gm',
  );

const BOLD = span(String.raw`\*`);
const ITALIC = span('_');
const STRIKE = span('~');
const MONO = /```([^`]+?)```/g;

/** Texto del bot → HTML de Telegram (`parse_mode: 'HTML'`). */
export function whatsappToTelegramHtml(text: string): string {
  return escapeHtml(text)
    .replace(MONO, '<code>$1</code>')
    .replace(BOLD, '$1<b>$2</b>')
    .replace(ITALIC, '$1<i>$2</i>')
    .replace(STRIKE, '$1<s>$2</s>');
}

/**
 * Texto del bot sin marcas, para el reenvío en texto plano cuando Telegram
 * rechaza el HTML: mejor «Su cita es el lunes» que no recibir nada, o que
 * recibir «Su cita es el *lunes*».
 */
export function stripWhatsappFormat(text: string): string {
  return text
    .replace(MONO, '$1')
    .replace(BOLD, '$1$2')
    .replace(ITALIC, '$1$2')
    .replace(STRIKE, '$1$2');
}
