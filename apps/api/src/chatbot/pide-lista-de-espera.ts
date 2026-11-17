/**
 * 📝 ¿Pide que lo anoten en la lista de espera? En el menú de horarios, tras
 * «Por ahora no tengo otros horarios», «lista de espera» recibía «No logré
 * ubicar esa opción entre las que le envié» (2026-11-17). Frases fijas, sin
 * LLM. Puro: sin base de datos ni Redis.
 *
 * Sí: «Lista de espera», «quiero la lista de espera», «anóteme en la lista»,
 * «apúntenme en la lista». No: una negación («no quiero lista de espera», «no
 * me anote en la lista»).
 */

/** Minúsculas, sin tildes, sin signos, espacios colapsados. */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOMBRA_LA_LISTA = /\blista\s+(de\s+)?espera\b/;
const PIDE_ANOTARSE =
  /\b(anot\w*|apunt\w*|inscrib\w*|agreg\w*|pon\w*)\b(\s+\w+){0,4}\s+(en\s+)?(la\s+)?lista\b/;
const LO_NIEGA = /\bno\b(\s+\w+){0,4}\s+lista\b/;

export function pideListaDeEspera(texto: string | null | undefined): boolean {
  const t = normalizar(texto);
  if (!t || LO_NIEGA.test(t)) return false;
  return NOMBRA_LA_LISTA.test(t) || PIDE_ANOTARSE.test(t);
}
