import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { ChatState } from './chatbot.constants';

@Injectable()
export class ChatbotCron {
  private readonly logger = new Logger(ChatbotCron.name);

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleAbandonedSessions() {
    this.logger.debug('🧹 Ejecutando limpieza de sesiones abandonadas...');
    
    // Buscar todos los estados actuales
    const keys = await this.redis.keys('chat_state:*');
    if (keys.length === 0) return;

    for (const key of keys) {
      const state = await this.redis.get(key);
      const phoneId = key.replace('chat_state:', '');

      // Solo nos importan sesiones que NO sean IDLE
      if (state && state !== ChatState.IDLE) {
        // En Redis TTL, si algo está a punto de morir (ej. < 5 mins de los 60 mins), podemos avisar
        const ttl = await this.redis.ttl(key);
        
        // Asumiendo SESSION_TTL = 3600 (1 hora)
        // Si le quedan menos de 10 minutos para expirar e hicimos el run ahora
        if (ttl > 0 && ttl <= 600) {
          this.logger.log(`⚠️ Sesión de ${phoneId} está por expirar (estado: ${state}). Notificando cierre.`);
          
          await this.sendWhatsAppMessage(
            phoneId,
            "Hola. Lo siento, he cerrado nuestra comunicación por inactividad prolongada por su seguridad y privacidad de datos. ¡En caso de querer un servicio aquí estoy, solo escríbame 'Hola' nuevamente!",
          );
          
          // Borrar datos inmediatamente para no volver a notificar en el sgt run
          await this.cleanUpSession(phoneId);
        }
      }
    }
  }

  private async sendWhatsAppMessage(toPhone: string, text: string) {
    const token = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneId = this.configService.get<string>('META_PHONE_ID');

    if (!phoneId) return;

    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

    const data = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    try {
      await lastValueFrom(this.httpService.post(url, data, { headers }));
    } catch (error: any) {
      this.logger.error(`Error enviando mensaje de abandono a ${toPhone}`, error.message);
    }
  }

  private async cleanUpSession(phoneId: string) {
    await this.redis.del(`chat_state:${phoneId}`);
    const keysToDelete = [
      `temp_cedula:${phoneId}`,
      `temp_nombre:${phoneId}`,
      `temp_eps_query:${phoneId}`,
      `temp_eps_id:${phoneId}`,
      `temp_especialidad:${phoneId}`,
      `temp_doctor:${phoneId}`,
      `temp_selected_slot_id:${phoneId}`,
      `temp_selected_date_view:${phoneId}`,
      `error_count:${phoneId}`,
      `is_ai_flow:${phoneId}`
    ];
    const slotKeys = await this.redis.keys(`temp_slot_*:${phoneId}`);
    await this.redis.del(...keysToDelete, ...slotKeys);
  }
}
