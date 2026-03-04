import { Controller, Get, Post, Body, Query, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import { ConfigService } from '@nestjs/config';

@Controller('chatbot')
export class ChatbotController {
    private readonly logger = new Logger(ChatbotController.name);

    constructor(
        private readonly chatbotService: ChatbotService,
        private readonly configService: ConfigService,
    ) { }

    // 1. Verificación del Webhook (Facebook te llama aquí primero)
    @Get('webhook')
    verifyWebhook(
        @Query('hub.mode') mode: string,
        @Query('hub.verify_token') token: string,
        @Query('hub.challenge') challenge: string,
    ) {
        const MY_VERIFY_TOKEN = this.configService.get<string>('META_VERIFY_TOKEN');

        if (mode === 'subscribe' && token === MY_VERIFY_TOKEN) {
            this.logger.log('Webhook verified successfully!');
            return challenge;
        }
        throw new Error('Invalid verification token');
    }

    // 2. Recepción de Mensajes (Aquí llega el "Hola")
    @Post('webhook')
    @HttpCode(HttpStatus.OK)
    async handleMessage(@Body() body: any) {
        // 1. Validar que es un evento válido
        if (body.object === 'page' || body.object === 'whatsapp_business_account') {

            // 2. Iterar sobre las entradas (Meta puede enviar eventos en lote)
            body.entry?.forEach(async (entry: any) => {

                // --- LÓGICA PARA WHATSAPP ---
                if (entry.changes && entry.changes.length > 0) {
                    const change = entry.changes[0];
                    const value = change.value;

                    // A. ¿Es un mensaje entrante (texto, imagen, audio)?
                    if (value?.messages && value.messages.length > 0) {
                        const messageEvent = value.messages[0];
                        // Pasamos el evento válido a nuestro servicio
                        await this.chatbotService.processIncomingMessage(messageEvent);
                    }
                    // B. ¿Es una confirmación de estado (entregado, leído, enviado)?
                    else if (value?.statuses && value.statuses.length > 0) {
                        const statusEvent = value.statuses[0];
                        // Aquí solo logueamos, no necesitamos responderle al bot
                        this.logger.debug(`Status update recibido: ${statusEvent.status} para el mensaje ${statusEvent.id}`);
                    }
                }

                // --- LÓGICA PARA FACEBOOK MESSENGER (Si lo usamos después) ---
                else if (entry.messaging && entry.messaging.length > 0) {
                    const webhookEvent = entry.messaging[0];
                    await this.chatbotService.processIncomingMessage(webhookEvent);
                }
            });

            // 3. SIEMPRE retornar 200 OK rápido a Meta, o bloquearán el Webhook
            return 'EVENT_RECEIVED';
        }

        // Si llega basura que no es de Meta, devolvemos 404
        return 'UNKNOWN_SOURCE';
    }
}