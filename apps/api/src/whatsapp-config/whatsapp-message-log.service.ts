import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  WhatsappMessageKind,
  WhatsappMessageStatus,
  WhatsappMessageType,
} from '@agenia/database';
import { PrismaService } from '../prisma/prisma.service';
import { getErrorMessage } from '../common/error-message.util';

/**
 * Lo que un llamador que SABE para qué es el mensaje le pasa al sender.
 *
 * Los senders de bajo nivel (`sendWhatsAppMessage`, el de audio, las
 * plantillas) no saben si van a confirmar una cita o a contestar una duda: lo
 * sabe quien los llama. Sin contexto el mensaje se registra igual, como
 * `BOT_REPLY` y sin cita.
 */
export interface OutboundMessageContext {
  kind?: WhatsappMessageKind;
  appointmentId?: string | null;
}

/** Un `statuses[]` del webhook de Meta, en lo que este servicio usa. */
export interface MetaStatusUpdate {
  /** El `wamid` del mensaje al que se refiere el estado. */
  id?: string;
  /** 'sent' | 'delivered' | 'read' | 'failed' (y otros que se ignoran). */
  status?: string;
  /** Segundos Unix, como texto. */
  timestamp?: string;
  errors?: Array<{
    code?: number | string;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
}

const ESTADO_DE_META: Record<string, WhatsappMessageStatus | undefined> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

/**
 * Desde qué estados se puede pasar a cada uno. Solo se AVANZA:
 * ACCEPTED < SENT < DELIVERED < READ.
 *
 * Meta no garantiza el orden de los webhooks: un `sent` puede llegar después de
 * un `delivered`, y pisar el estado más avanzado con el más viejo dejaría el
 * libro diciendo que un mensaje ya entregado solo salió. FAILED solo cabe antes
 * de la entrega: un mensaje entregado o leído no "falla" después.
 */
const PUEDE_VENIR_DE: Record<WhatsappMessageStatus, WhatsappMessageStatus[]> = {
  ACCEPTED: [],
  SENT: ['ACCEPTED'],
  DELIVERED: ['ACCEPTED', 'SENT'],
  READ: ['ACCEPTED', 'SENT', 'DELIVERED'],
  FAILED: ['ACCEPTED', 'SENT'],
};

const MAX_ERROR_DETAIL_CHARS = 500;

/**
 * `messages[0].id` de la respuesta de la Cloud API al aceptar un envío:
 * `{ messaging_product, contacts: [...], messages: [{ id: 'wamid.…' }] }`.
 * Devuelve null si la respuesta no trae uno (no rompe el envío que ya salió).
 */
export function extractWamid(metaResponse: unknown): string | null {
  if (typeof metaResponse !== 'object' || metaResponse === null) return null;
  const messages = (metaResponse as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return null;
  const first: unknown = messages[0];
  if (typeof first !== 'object' || first === null) return null;
  const id = (first as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Libro de mensajes SALIENTES de WhatsApp (docs/PLAN_RASTREO_PACIENTE.md §2.3
 * y §8 #7).
 *
 * `recordOutbound` lo llaman los senders justo después de que Meta acepta el
 * envío; `applyStatus` lo llama el webhook cuando Meta reporta
 * enviado/entregado/leído/fallido.
 *
 * Es un registro de evidencia, no lógica de negocio: **nunca lanza**. Si la
 * base falla, el mensaje ya salió y el flujo del paciente sigue igual — mismo
 * criterio que `InteractionLogService`.
 */
@Injectable()
export class WhatsappMessageLogService {
  private readonly logger = new Logger(WhatsappMessageLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordOutbound(params: {
    organizationId: string;
    recipientId: string;
    messageType: WhatsappMessageType;
    /** La respuesta cruda de Meta al envío (de ahí sale el wamid). */
    metaResponse: unknown;
    context?: OutboundMessageContext;
  }): Promise<void> {
    try {
      const wamid = extractWamid(params.metaResponse);
      if (!wamid) {
        // El mensaje salió pero no hay con qué seguirle la pista.
        this.logger.debug(
          `Meta no devolvió wamid para un envío a ${params.recipientId}; no se registra en el libro.`,
        );
        return;
      }

      await this.prisma.whatsappMessageLog.create({
        data: {
          wamid,
          organizationId: params.organizationId,
          recipientId: params.recipientId,
          messageType: params.messageType,
          kind: params.context?.kind ?? 'BOT_REPLY',
          appointmentId: params.context?.appointmentId ?? null,
        },
      });
    } catch (error: unknown) {
      // P2002: el mismo wamid ya estaba (un reintento del registro). Inocuo.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      this.logger.error(
        `No se pudo registrar el mensaje saliente en el libro (no afecta el envío): ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Aplica un estado del webhook. Devuelve `true` si cambió una fila.
   *
   * Un solo `updateMany` condicionado al estado de origen, sin leer antes: dos
   * webhooks concurrentes del mismo mensaje no se pisan, y uno atrasado (un
   * `sent` después de un `delivered`) simplemente no encuentra fila que
   * actualizar.
   *
   * Un estado de un wamid que no está en el libro (un mensaje anterior a esta
   * función, o enviado por otro medio) se ignora: este servicio solo actualiza,
   * nunca crea filas desde el webhook, así que un estado falso no puede
   * inventar un mensaje.
   */
  async applyStatus(update: MetaStatusUpdate): Promise<boolean> {
    try {
      const nuevo = update.status ? ESTADO_DE_META[update.status] : undefined;
      if (!update.id || !nuevo) return false;

      const error = nuevo === 'FAILED' ? update.errors?.[0] : undefined;
      const detalle = error
        ? (error.error_data?.details ?? error.message ?? error.title)
        : undefined;

      const { count } = await this.prisma.whatsappMessageLog.updateMany({
        where: { wamid: update.id, status: { in: PUEDE_VENIR_DE[nuevo] } },
        data: {
          status: nuevo,
          statusAt: fechaDeMeta(update.timestamp),
          errorCode:
            error?.code !== undefined && error.code !== null
              ? String(error.code)
              : undefined,
          errorDetail: detalle
            ? detalle.slice(0, MAX_ERROR_DETAIL_CHARS)
            : undefined,
        },
      });

      if (count === 0) {
        this.logger.debug(
          `Estado '${update.status}' de ${update.id} sin efecto (mensaje desconocido o estado ya superado).`,
        );
      }
      return count > 0;
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo aplicar el estado '${update.status}' de ${update.id}: ${getErrorMessage(error)}`,
      );
      return false;
    }
  }
}

/** Segundos Unix (texto) → Date; si no es válido, ahora. */
function fechaDeMeta(timestamp: string | undefined): Date {
  const segundos = Number(timestamp);
  if (!Number.isFinite(segundos) || segundos <= 0) return new Date();
  return new Date(segundos * 1000);
}
