import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import { ChatState } from './chatbot.constants';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { ResolvedWhatsappCredentials } from '../whatsapp-config/dto/whatsapp-config.types';

@Injectable()
export class ChatbotCron {
  private readonly logger = new Logger(ChatbotCron.name);

  constructor(
    private readonly redis: RedisService,
    private readonly httpService: HttpService,
    private readonly whatsappCredentials: WhatsappCredentialsService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleAbandonedSessions() {
    this.logger.debug('🧹 Ejecutando limpieza de sesiones abandonadas...');

    // Las keys del flujo conversacional siguen la forma:
    //   chat_state:${organizationId}:${whatsappPhone}
    // El cron las recorre y, antes de mandar el aviso de cierre, resuelve
    // las credenciales del tenant.
    const keys = await this.redis.keys('chat_state:*');
    if (keys.length === 0) return;

    for (const key of keys) {
      const state = await this.redis.get(key);
      if (!state || state === ChatState.IDLE) continue;

      const rest = key.slice('chat_state:'.length);
      const [organizationId, ...phoneParts] = rest.split(':');
      const whatsappPhone = phoneParts.join(':');
      if (!organizationId || !whatsappPhone) continue;

      const ttl = await this.redis.ttl(key);
      if (ttl <= 0 || ttl > 600) continue;

      this.logger.log(
        `⚠️ Sesión org=${organizationId} ${whatsappPhone} a punto de expirar (estado: ${state}). Notificando cierre.`,
      );

      const creds = await this.whatsappCredentials.forOrg(organizationId);
      if (!creds || !creds.isActive) {
        this.logger.warn(
          `No hay credenciales WhatsApp activas para org ${organizationId}. Aviso de cierre NO enviado a ${whatsappPhone}.`,
        );
      } else {
        await this.sendAbandonedNotification(creds, whatsappPhone);
      }

      await this.cleanUpSession(organizationId, whatsappPhone);
    }
  }

  private async sendAbandonedNotification(
    creds: ResolvedWhatsappCredentials,
    toPhone: string,
  ) {
    const url = `https://graph.facebook.com/v19.0/${creds.phoneNumberId}/messages`;
    const data = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type: 'text',
      text: {
        preview_url: false,
        body:
          "Hola. Lo siento, he cerrado nuestra comunicación por inactividad prolongada por su seguridad y privacidad de datos. ¡En caso de querer un servicio aquí estoy, solo escríbame 'Hola' nuevamente!",
      },
    };
    const headers = {
      Authorization: `Bearer ${creds.accessToken}`,
      'Content-Type': 'application/json',
    };
    try {
      await lastValueFrom(this.httpService.post(url, data, { headers }));
    } catch (error: any) {
      this.logger.error(
        `Error enviando mensaje de abandono a ${toPhone}: ${error.message}`,
      );
    }
  }

  private async cleanUpSession(organizationId: string, whatsappPhone: string) {
    await this.redis.del(`chat_state:${organizationId}:${whatsappPhone}`);
    const keysToDelete = [
      `temp_cedula:${whatsappPhone}`,
      `temp_nombre:${whatsappPhone}`,
      `temp_eps_query:${whatsappPhone}`,
      `temp_eps_id:${whatsappPhone}`,
      `temp_especialidad:${whatsappPhone}`,
      `temp_doctor:${whatsappPhone}`,
      `temp_selected_slot_id:${whatsappPhone}`,
      `temp_selected_date_view:${whatsappPhone}`,
      `error_count:${whatsappPhone}`,
      `is_ai_flow:${organizationId}:${whatsappPhone}`,
    ];
    const slotKeys = await this.redis.keys(`temp_slot_*:${whatsappPhone}`);
    await this.redis.del(...keysToDelete, ...slotKeys);
  }
}
