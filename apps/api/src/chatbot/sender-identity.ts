/**
 * ══════════════════════════════════════════════════════════════════════════
 * IDENTIDAD DEL REMITENTE ENTRANTE (WhatsApp Cloud API)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Desde 2026 un usuario de WhatsApp puede ocultar su número tras un username.
 * Cuando lo hace, Meta deja de enviar `wa_id`/`from` en el webhook y manda en
 * su lugar el BSUID (Business-scoped user ID, ej. `CO.13491208655302741918`).
 *
 * Este módulo es el ÚNICO lugar donde se decide "quién escribió". Aislarlo así
 * evita que cada punto de entrada (controller, cola, servicio) improvise su
 * propia respuesta a esa pregunta, que es justo como se coló la falla silenciosa
 * que este cambio corrige.
 */

/**
 * Evento entrante del webhook de Meta, ya desempacado por ChatbotController.
 * El controller extrae `value.messages[0]` (formato WhatsApp Cloud API) o
 * `entry.messaging[0]` (formato Messenger legacy) e inyecta `metadata`.
 * Todos los campos son opcionales: el payload real varía según el tipo de
 * mensaje (texto, audio, status, etc.).
 */
export interface WhatsappInboundEvent {
  /**
   * Teléfono del remitente (`wa_id`). DEJA DE VENIR cuando el paciente oculta
   * su número: Meta sólo lo reenvía si hubo contacto en los últimos 30 días,
   * si el paciente lo autoriza con REQUEST_CONTACT_INFO, o si está en su
   * contact book. Nunca asumir que está presente.
   */
  from?: string;
  /**
   * BSUID: identidad estable del paciente frente a NUESTRO portafolio de
   * negocio, y lo único que Meta garantiza en todo webhook tras el cambio de
   * usernames.
   */
  user_id?: string;
  /**
   * Parent BSUID (`CO.ENT.*`). Correlaciona al MISMO usuario entre portafolios
   * vinculados. Se declara para dejar constancia de que existe y de que NO lo
   * usamos: sería exactamente la llave de join cross-tenant sobre datos de
   * salud que el aislamiento por organización evita. No se lee ni se persiste.
   */
  parent_user_id?: string;
  /** wamid del mensaje (formato WhatsApp Cloud API). Usado para dedup/cola. */
  id?: string;
  type?: string;
  /** Messenger legacy (PSID). Ni teléfono ni BSUID. */
  sender?: { id?: string };
  text?: { body?: string };
  /** `mid` solo en formato Messenger legacy; Cloud API usa el `id` de arriba. */
  message?: { text?: string; mid?: string };
  audio?: { id?: string };
  metadata?: { phone_number_id?: string };
}

/** Identidad resuelta de un evento entrante. */
export interface SenderIdentity {
  /**
   * Clave canónica del remitente: namespace de sesión en Redis, `whatsappId`
   * de auditoría y destinatario de las respuestas del turno.
   *
   * Prioriza el BSUID sobre el teléfono a propósito. El teléfono es VOLÁTIL
   * (va y viene con la caché de 30 días de Meta): si se prefiriera, la clave
   * cambiaría el día que la caché caduque, en mitad de una relación ya
   * establecida, partiendo la sesión y el historial del paciente. El BSUID es
   * estable dentro del portafolio, así que la clave cambia UNA vez —cuando
   * Meta empiece a enviarlo— y nunca más.
   */
  senderId: string;
  /** BSUID si el webhook lo trajo. */
  bsuid: string | null;
  /** Teléfono si el webhook lo trajo. */
  phone: string | null;
}

/**
 * `whatsappId` que se guarda en auditoría/perfil cuando no hay remitente
 * identificable. La columna es NOT NULL, y una fila con este valor es la señal
 * de que llegó un payload que no supimos leer.
 */
export const UNIDENTIFIED_SENDER = 'unknown';

const clean = (value?: string): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Resuelve la identidad del remitente de un evento entrante.
 * Devuelve `null` cuando el payload no trae NINGÚN identificador utilizable
 * — caso en el que el llamador debe auditar y avisar, nunca descartar en
 * silencio.
 */
export function resolveSenderIdentity(
  event: WhatsappInboundEvent | null | undefined,
): SenderIdentity | null {
  if (!event) return null;

  const bsuid = clean(event.user_id);
  const phone = clean(event.from);
  // PSID de Messenger: sirve como clave de sesión, pero no es teléfono ni BSUID.
  const legacyId = clean(event.sender?.id);

  const senderId = bsuid ?? phone ?? legacyId;
  if (!senderId) return null;

  return { senderId, bsuid, phone };
}
