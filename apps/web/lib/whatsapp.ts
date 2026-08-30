/**
 * Wrapper de presentación de identificadores de WhatsApp para el frontend.
 *
 * Desde el cambio de usernames de Meta (2026), el identificador de un paciente
 * puede ser su teléfono (`wa_id`) o su BSUID (`CO.13491208655302741918`). El
 * dashboard NO puede tratarlos igual:
 *
 *   - Un BSUID renderizado como teléfono sale como `+CO.1349...`.
 *   - Peor: `wa.me/${id.replace(/[^0-9]/g, '')}` sobre un BSUID produce un
 *     número de teléfono INVENTADO. El funcionario abriría un chat hacia un
 *     desconocido, con datos clínicos del paciente ya precargados en el texto.
 *
 * El predicado vive en `@agenia/shared` para que backend y frontend respondan
 * exactamente lo mismo a "¿esto es un teléfono?".
 */
import { isWhatsappPhoneId } from '@agenia/shared';

export { isWhatsappPhoneId };

/** Identificador tal como se le muestra al funcionario. */
export function formatWhatsappIdentifier(identifier: string): string {
  return isWhatsappPhoneId(identifier) ? `+${identifier.trim()}` : identifier;
}

/** Etiqueta del campo, honesta sobre qué se está mostrando. */
export function whatsappIdentifierLabel(identifier: string): string {
  return isWhatsappPhoneId(identifier) ? '📞 Teléfono' : '🆔 ID de WhatsApp';
}

/**
 * Enlace `wa.me`, o `null` si el identificador no es un teléfono.
 *
 * `null` NO es un caso de error: es un paciente que ocultó su número. La única
 * vía para contactarlo es responderle por la API (el bot o el envío manual del
 * dashboard), que sí sabe dirigirse a un BSUID.
 */
export function whatsappDeepLink(
  identifier: string,
  text: string,
): string | null {
  if (!isWhatsappPhoneId(identifier)) return null;
  return `https://wa.me/${identifier.trim()}?text=${encodeURIComponent(text)}`;
}

/** Motivo mostrado al funcionario cuando no hay enlace posible. */
export const NO_DEEP_LINK_REASON =
  'Este paciente ocultó su número en WhatsApp: no existe un enlace wa.me para él. Escríbale desde el envío manual del dashboard.';
