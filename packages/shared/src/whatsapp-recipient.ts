/**
 * ══════════════════════════════════════════════════════════════════════════
 * DESTINATARIO DE WHATSAPP: teléfono (`to`) vs BSUID (`recipient`)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Desde 2026 el identificador de un paciente puede ser su teléfono (`wa_id`)
 * o su BSUID (`CO.13491208655302741918`), según haya ocultado o no su número.
 * La API de mensajes de Meta los espera en campos DISTINTOS: `to` para el
 * teléfono, `recipient` para el BSUID. Mandar un BSUID en `to` falla.
 *
 * Vive en `@agenia/shared` porque la misma pregunta —"¿esto es un teléfono?"—
 * la necesitan el envío (API) y el dashboard (no se puede armar un enlace
 * `wa.me` con un BSUID: los dígitos que quedan al filtrarlo son un número de
 * teléfono INVENTADO, que pertenece a un desconocido).
 */

/**
 * ¿Este identificador es un número de teléfono de WhatsApp (`wa_id`)?
 *
 * La regla se apoya en lo único estable del formato: un `wa_id` es E.164 SIN
 * el `+`, es decir, SÓLO dígitos. Deliberadamente NO se valida la forma del
 * BSUID: si Meta introduce mañana otro identificador opaco, no será una
 * cadena de puros dígitos y caerá del lado correcto (`recipient`) por sí solo.
 *
 * Nota: un PSID legacy de Messenger también es todo dígitos y se clasifica
 * como teléfono. Es intencional — es el comportamiento previo a este cambio,
 * y esa vía no envía por la API de WhatsApp.
 */
export function isWhatsappPhoneId(
  identifier: string | null | undefined,
): boolean {
  if (typeof identifier !== 'string') return false;
  return /^\d+$/.test(identifier.trim());
}

/** Campo de la API de mensajes que corresponde a un identificador dado. */
export function whatsappRecipientField(
  identifier: string | null | undefined,
): 'to' | 'recipient' {
  return isWhatsappPhoneId(identifier) ? 'to' : 'recipient';
}

/**
 * Fragmento de payload con el destinatario ya en el campo correcto.
 * Se esparce dentro del cuerpo del mensaje:
 *
 *   { messaging_product: 'whatsapp', ...buildWhatsappRecipient(id), type: 'text', ... }
 */
export function buildWhatsappRecipient(
  identifier: string,
): { to: string } | { recipient: string } {
  return isWhatsappPhoneId(identifier)
    ? { to: identifier }
    : { recipient: identifier };
}
