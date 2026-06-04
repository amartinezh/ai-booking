import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';

@Controller('chatbot')
export class ChatbotController {
  private readonly logger = new Logger(ChatbotController.name);

  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly whatsappCredentials: WhatsappCredentialsService,
  ) {}

  // 1. Verificación del Webhook (Facebook te llama aquí primero).
  //
  // En modo multi-tenant ya no hay un VERIFY_TOKEN global: cada clínica define
  // el suyo en Configuración → Integraciones → WhatsApp y lo registra con Meta.
  // Buscamos la clínica que reclame el token enviado. Si no existe ninguna,
  // rechazamos.
  @Get('webhook')
  async verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode !== 'subscribe' || !token) {
      throw new ForbiddenException('Invalid webhook verification request');
    }
    const orgId =
      await this.whatsappCredentials.organizationIdByVerifyToken(token);
    if (!orgId) {
      this.logger.warn(
        `Verificación de webhook rechazada — verify_token desconocido`,
      );
      throw new ForbiddenException('Invalid verification token');
    }
    this.logger.log(`Webhook verificado para org ${orgId}`);
    return challenge;
  }

  // 2. Recepción de Mensajes (Aquí llega el "Hola").
  //
  // El enrutamiento al tenant correcto ocurre dentro de ChatbotService a partir
  // de `value.metadata.phone_number_id`, así que este endpoint sólo desempaca.
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleMessage(@Body() body: any) {
    if (body.object === 'page' || body.object === 'whatsapp_business_account') {
      body.entry?.forEach(async (entry: any) => {
        if (entry.changes && entry.changes.length > 0) {
          const change = entry.changes[0];
          const value = change.value;

          if (value?.messages && value.messages.length > 0) {
            const messageEvent = value.messages[0];
            // 💡 Inyectamos la metadata (phone_number_id) al evento para que
            // processIncomingMessage pueda enrutar al tenant correcto.
            messageEvent.metadata = value.metadata;
            await this.chatbotService.processIncomingMessage(messageEvent);
          } else if (value?.statuses && value.statuses.length > 0) {
            const statusEvent = value.statuses[0];
            this.logger.debug(
              `Status update recibido: ${statusEvent.status} para el mensaje ${statusEvent.id}`,
            );
          }
        } else if (entry.messaging && entry.messaging.length > 0) {
          const webhookEvent = entry.messaging[0];
          await this.chatbotService.processIncomingMessage(webhookEvent);
        }
      });

      // SIEMPRE retornar 200 OK rápido a Meta, o bloquearán el Webhook.
      return 'EVENT_RECEIVED';
    }

    return 'UNKNOWN_SOURCE';
  }

  // 3. Envío de Mensajes Manuales (Outbound desde el Dashboard)
  @Post('outbound')
  @HttpCode(HttpStatus.OK)
  async sendOutboundMessage(@Body() body: { to: string; message: string }) {
    if (!body.to || !body.message) {
      throw new Error('Faltan parámetros (to, message)');
    }
    await this.chatbotService.sendOutboundMessage(body.to, body.message);
    return { success: true };
  }
}
