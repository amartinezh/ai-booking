/**
 * ══════════════════════════════════════════════════════════════════════════
 * IDENTIDAD DEL REMITENTE ENTRANTE (WhatsApp Cloud API)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Desde 2026 un usuario de WhatsApp puede ocultar su número tras un username.
 * Cuando lo hace, Meta deja de enviar `wa_id`/`from` en el webhook y solo
 * manda el BSUID (Business-scoped user ID, ej. `CO.13491208655302741918`) en
 * `messages[].from_user_id`. Ojo: en `messages[]` el campo NO se llama
 * `user_id` (ese nombre es el de `contacts[]`). Leer solo `user_id` dejó sin
 * respuesta al primer paciente con número oculto (2026-10-02).
 *
 * Este módulo es el ÚNICO lugar donde se decide "quién escribió". Aislarlo así
 * evita que cada punto de entrada (controller, cola, servicio) improvise su
 * propia respuesta a esa pregunta, que es justo como se coló la falla silenciosa
 * que este cambio corrige.
 */

/**
 * Marca de un evento que llegó por Telegram (docs/PLAN_TELEGRAM.md §3).
 *
 * Es un `Symbol` y no un campo normal A PROPÓSITO: el webhook de Meta pasa al
 * bot los objetos `messages[]` tal como vienen en el JSON, y un JSON no puede
 * fabricar una propiedad `Symbol`. Así, ni un payload falsificado (con
 * META_REQUIRE_SIGNATURE=false) puede hacerse pasar por Telegram ni elegir la
 * clínica. Solo `TelegramWebhookController`, que ya validó el secreto de la
 * clínica, la pone.
 */
export const TELEGRAM_ORIGIN: unique symbol = Symbol('agenia.telegram-origin');

/** Lo que el webhook de Telegram garantiza del evento que entrega al bot. */
export interface TelegramOrigin {
  /** Clínica dueña del bot (resuelta por la ruta del webhook, no por el payload). */
  organizationId: string;
  /** `chat_id` sin prefijo. */
  chatId: string;
  /** Remitente del bot: `tg:<chat_id>`. */
  senderId: string;
}

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
   * usernames. Es el nombre real del campo en `messages[]`.
   */
  from_user_id?: string;
  /**
   * BSUID con el nombre que usa `contacts[]`. En `messages[]` no viene, pero
   * se acepta por tolerancia (y lo usan las pruebas antiguas).
   */
  user_id?: string;
  /**
   * Parent BSUID (`CO.ENT.*`), con sus dos nombres (`messages[]` y
   * `contacts[]`). Correlaciona al MISMO usuario entre portafolios
   * vinculados. Se declara para dejar constancia de que existe y de que NO lo
   * usamos: sería exactamente la llave de join cross-tenant sobre datos de
   * salud que el aislamiento por organización evita. No se lee ni se persiste.
   */
  from_parent_user_id?: string;
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
  /** Solo en eventos de Telegram. Ver TELEGRAM_ORIGIN. */
  [TELEGRAM_ORIGIN]?: TelegramOrigin;
}

/** Origen de Telegram del evento, o `null` si es de WhatsApp. */
export function telegramOriginOf(
  event: WhatsappInboundEvent | null | undefined,
): TelegramOrigin | null {
  return event?.[TELEGRAM_ORIGIN] ?? null;
}

/** Identidad resuelta de un evento entrante. */
export interface SenderIdentity {
  /**
   * Clave canónica del remitente: namespace de sesión en Redis, `whatsappId`
   * de auditoría y destinatario de las respuestas del turno.
   *
   * Prioriza el TELÉFONO; el BSUID solo es la clave cuando el teléfono no
   * viene (paciente con número oculto). Decisión del 2026-10-02: Meta manda
   * el BSUID desde abril pero nunca se leyó, así que toda la historia (sesiones,
   * lista de espera, auditoría, fichas) está atada al teléfono. Preferir el
   * BSUID habría cambiado la clave de TODOS los pacientes al desplegar y los
   * habría pasado a todos al envío por `recipient`, nunca usado en producción.
   * Costo aceptado: si a un paciente le desaparece el teléfono del webhook,
   * su clave cambia a BSUID en ese momento. El BSUID se guarda igual en su
   * columna para todos (ver persistencia del paciente).
   */
  senderId: string;
  /** BSUID si el webhook lo trajo. */
  bsuid: string | null;
  /** Teléfono si el webhook lo trajo. */
  phone: string | null;
  /**
   * `chat_id` de Telegram (sin prefijo). Solo existe en eventos de Telegram;
   * en WhatsApp la propiedad ni siquiera se crea.
   */
  telegramChatId?: string;
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

  // Telegram primero: su remitente no es teléfono ni BSUID, y `from`/`user_id`
  // no se miran aunque vinieran.
  const telegram = telegramOriginOf(event);
  if (telegram) {
    return {
      senderId: telegram.senderId,
      bsuid: null,
      phone: null,
      telegramChatId: telegram.chatId,
    };
  }

  const bsuid = clean(event.from_user_id) ?? clean(event.user_id);
  const phone = clean(event.from);
  // PSID de Messenger: sirve como clave de sesión, pero no es teléfono ni BSUID.
  const legacyId = clean(event.sender?.id);

  const senderId = phone ?? bsuid ?? legacyId;
  if (!senderId) return null;

  return { senderId, bsuid, phone };
}
