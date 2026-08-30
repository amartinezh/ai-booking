import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';
import { ChatbotService } from './chatbot.service';
import { resolveSenderIdentity } from './sender-identity';
import { InboundQueueService } from './inbound-queue.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';

@Controller('chatbot')
export class ChatbotController {
  private readonly logger = new Logger(ChatbotController.name);

  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly whatsappCredentials: WhatsappCredentialsService,
    private readonly inboundQueue: InboundQueueService,
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
  //
  // 🔏 FIRMA: si la clínica configuró su App Secret (o existe META_APP_SECRET
  // en el env), exigimos la firma X-Hub-Signature-256 de Meta sobre el body
  // crudo. Sin ella, cualquiera que conociera la URL podría inyectar mensajes
  // falsos y manipular las sesiones/citas del tenant.
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleMessage(
    @Body() body: any,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    if (body.object === 'page' || body.object === 'whatsapp_business_account') {
      const authorized = await this.verifyMetaSignature(
        body,
        req.rawBody,
        signature,
      );
      if (!authorized) {
        this.logger.warn(
          'Webhook POST rechazado: firma X-Hub-Signature-256 ausente o inválida.',
        );
        throw new ForbiddenException('Invalid webhook signature');
      }

      // Meta puede agrupar VARIOS entries, cambios y mensajes en un solo webhook
      // (típico bajo alta carga). Antes sólo se leía `[0]` de cada nivel y el
      // resto se descartaba en silencio: recorremos TODOS.
      for (const entry of body.entry ?? []) {
        if (entry.changes && entry.changes.length > 0) {
          for (const change of entry.changes) {
            const value = change.value;

            if (value?.messages && value.messages.length > 0) {
              for (const messageEvent of value.messages) {
                // 💡 Inyectamos la metadata (phone_number_id) al evento para que
                // processIncomingMessage pueda enrutar al tenant correcto.
                messageEvent.metadata = value.metadata;
                // La clave de serialización sale del resolver, no de `from`:
                // con un remitente que oculta su número `from` no viene y la
                // cola caía al wamid — único por mensaje, así que los mensajes
                // de ese paciente dejaban de encadenarse en orden.
                await this.dispatch(
                  messageEvent,
                  messageEvent.id,
                  resolveSenderIdentity(messageEvent)?.senderId,
                );
              }
            } else if (value?.statuses && value.statuses.length > 0) {
              for (const statusEvent of value.statuses) {
                this.logger.debug(
                  `Status update recibido: ${statusEvent.status} para el mensaje ${statusEvent.id}`,
                );
              }
            }
          }
        } else if (entry.messaging && entry.messaging.length > 0) {
          for (const webhookEvent of entry.messaging) {
            await this.dispatch(
              webhookEvent,
              webhookEvent.message?.mid,
              resolveSenderIdentity(webhookEvent)?.senderId,
            );
          }
        }
      }

      // SIEMPRE retornar 200 OK rápido a Meta, o bloquearán el Webhook. El
      // procesamiento real corre asíncrono dentro de la cola (backpressure +
      // serialización por remitente); aquí sólo deduplicamos y encolamos.
      return 'EVENT_RECEIVED';
    }

    return 'UNKNOWN_SOURCE';
  }

  // 3. Envío de Mensajes Manuales (Outbound desde el Dashboard)
  //
  // 🏢 Requiere sesión con rol clínico: el mensaje sale SIEMPRE por la línea
  // de la clínica del token (no por la última con la que habló el paciente).
  @Post('outbound')
  @UseGuards(RolesGuard)
  @Roles('ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR')
  @HttpCode(HttpStatus.OK)
  async sendOutboundMessage(
    @Body() body: { to: string; message: string },
    @CurrentTenant() organizationId: string,
  ) {
    if (!body.to || !body.message) {
      throw new BadRequestException('Faltan parámetros (to, message)');
    }
    await this.chatbotService.sendOutboundMessage(
      body.to,
      body.message,
      organizationId,
    );
    return { success: true };
  }

  // ── helpers ────────────────────────────────────────────────────────────

  /**
   * Deduplica por wamid y encola un evento entrante. El procesamiento real es
   * asíncrono (cola con backpressure + serialización por remitente); aquí sólo:
   *   1. Descartamos duplicados (reentrega del mismo webhook por Meta).
   *   2. Encolamos; si la cola está saturada, revertimos el dedup para que el
   *      reintento de Meta pueda volver a procesarse (no se pierde el mensaje).
   */
  private async dispatch(
    event: any,
    wamid: string | undefined,
    senderId: string | undefined,
  ): Promise<void> {
    const admitted = await this.inboundQueue.admit(wamid);
    if (!admitted) {
      this.logger.debug(`Mensaje duplicado descartado (wamid=${wamid}).`);
      return;
    }

    const accepted = this.inboundQueue.enqueue(
      senderId || wamid || 'unknown',
      () => this.chatbotService.processIncomingMessage(event),
    );
    if (!accepted) {
      await this.inboundQueue.releaseAdmission(wamid);
      this.logger.warn(
        `Backpressure: cola de entrada saturada (${this.inboundQueue.inFlight} ` +
          `en vuelo). Mensaje ${wamid ?? '(sin id)'} rechazado; Meta lo reintentará.`,
      );
    }
  }

  /**
   * Valida la firma HMAC-SHA256 de Meta sobre el body crudo.
   *
   * Resolución del secreto (en orden):
   *   1. App Secret de la clínica dueña del `phone_number_id` del payload.
   *   2. META_APP_SECRET del entorno (plataformas de una sola app de Meta).
   *   3. Sin secreto → por defecto se RECHAZA el evento (verificación
   *      obligatoria). Para migrar un tenant legacy que aún no configuró su App
   *      Secret, se puede poner `META_REQUIRE_SIGNATURE=false` en el entorno y
   *      volver temporalmente al modo permisivo (con warning).
   */
  private async verifyMetaSignature(
    body: any,
    rawBody?: Buffer,
    signature?: string,
  ): Promise<boolean> {
    const metaPhoneId: string | undefined =
      body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    const orgSecret = metaPhoneId
      ? await this.whatsappCredentials.appSecretByPhoneNumberId(metaPhoneId)
      : null;
    const secret = orgSecret || process.env.META_APP_SECRET || null;

    // Obligatoria por defecto: sólo se relaja si META_REQUIRE_SIGNATURE=false.
    const requireSignature = process.env.META_REQUIRE_SIGNATURE !== 'false';

    if (!secret) {
      if (requireSignature) {
        this.logger.warn(
          'Webhook RECHAZADO: no hay App Secret de la clínica ni META_APP_SECRET, ' +
            'y la verificación de firma es obligatoria. Configure el App Secret o, ' +
            'sólo para migración, ponga META_REQUIRE_SIGNATURE=false.',
        );
        return false;
      }
      this.logger.warn(
        'Webhook aceptado SIN verificación de firma (META_REQUIRE_SIGNATURE=false): ' +
          'configure el App Secret de la clínica (o META_APP_SECRET) para rechazar ' +
          'payloads falsificados.',
      );
      return true;
    }

    if (!signature || !rawBody) return false;

    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected),
      );
    } catch {
      // Longitudes distintas (firma malformada) → inválida.
      return false;
    }
  }
}
