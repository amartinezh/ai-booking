import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ChannelActivityEvent } from '@agenia/database';
import { isTelegramSender } from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { getErrorMessage } from '../common/error-message.util';

/**
 * 📈 Registro liviano de la actividad de los canales (ver `ChannelActivityLog`).
 *
 * Una fila por mensaje que entra al bot y otra por cada desenlace (cita
 * agendada, fallo o abandono). Solo lo necesario para las gráficas: canal,
 * clínica, hora y un remitente SEUDONIMIZADO.
 *
 * Por qué HMAC con clave y no un hash simple: un celular colombiano tiene 10
 * dígitos; un SHA-256 plano se revierte probando los ~10⁹ posibles en minutos.
 * Con la clave del servidor, la tabla sola no dice quién escribió. La clínica
 * entra en el HMAC para que el mismo paciente no se pueda cruzar entre
 * clínicas (igual que el BSUID, que Meta ya aísla por organización).
 *
 * Fire-and-forget, como `InteractionLogService`: un fallo aquí nunca frena ni
 * rompe la conversación.
 */
@Injectable()
export class ChannelActivityService {
  private readonly logger = new Logger(ChannelActivityService.name);
  private readonly key: string | null;
  private avisadoSinClave = false;

  constructor(private readonly prisma: PrismaService) {
    this.key =
      process.env.CHANNEL_ACTIVITY_HASH_KEY?.trim() ||
      process.env.ENCRYPTION_KEY?.trim() ||
      null;
  }

  /** HMAC de clínica + remitente, recortado a 32 hex (128 bits: sin colisiones prácticas). */
  hashSender(organizationId: string, senderId: string): string | null {
    if (!this.key) return null;
    return createHmac('sha256', this.key)
      .update(`channel-activity:${organizationId}:${senderId.trim()}`)
      .digest('hex')
      .slice(0, 32);
  }

  async record(params: {
    organizationId: string | null | undefined;
    senderId: string | null | undefined;
    event: ChannelActivityEvent;
    messageType?: string | null;
  }): Promise<void> {
    try {
      const { organizationId, senderId } = params;
      if (!organizationId || !senderId) return;
      const senderHash = this.hashSender(organizationId, senderId);
      if (!senderHash) {
        if (!this.avisadoSinClave) {
          this.avisadoSinClave = true;
          this.logger.warn(
            'Sin CHANNEL_ACTIVITY_HASH_KEY ni ENCRYPTION_KEY: no se registra la actividad de canales ' +
              '(sin clave, el remitente no se puede seudonimizar de forma segura).',
          );
        }
        return;
      }
      await this.prisma.channelActivityLog.create({
        data: {
          organizationId,
          channel: isTelegramSender(senderId) ? 'TELEGRAM' : 'WHATSAPP',
          event: params.event,
          senderHash,
          messageType: params.messageType?.slice(0, 20) ?? null,
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Error registrando actividad de canal (no afecta el flujo): ${getErrorMessage(error)}`,
      );
    }
  }
}
