import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import { ChatState, SESSION_TTL } from './chatbot.constants';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { ResolvedWhatsappCredentials } from '../whatsapp-config/dto/whatsapp-config.types';
import { buildWhatsappRecipient } from '@agenia/shared';
import { metaGraphUrl } from '../whatsapp-config/meta-graph';

@Injectable()
export class ChatbotCron {
  private readonly logger = new Logger(ChatbotCron.name);

  /**
   * Minutos de inactividad antes de cerrar la conversación, configurable vía
   * `.env` con CHATBOT_INACTIVITY_TIMEOUT_MINUTES (por defecto 5 minutos).
   * Debe ser menor que SESSION_TTL (la sesión se refresca con cada mensaje del
   * paciente; si el inactivo supera este umbral, el cron cierra y notifica).
   */
  private readonly inactivityTimeoutSec = Math.min(
    SESSION_TTL - 60,
    Math.max(
      60,
      (Number(process.env.CHATBOT_INACTIVITY_TIMEOUT_MINUTES) || 5) * 60,
    ),
  );

  /**
   * Umbral más largo mientras se está dando de alta a un paciente nuevo.
   *
   * Un paciente nuevo contesta tres preguntas más que antes (nacimiento, sexo
   * y régimen — datos que el HIS exige y que el chatbot no pedía). Tres turnos
   * extra son tres oportunidades más de distraerse, y con el umbral normal de
   * 5 minutos la reserva se pierde a mitad del registro justo cuando ya había
   * invertido el mayor esfuerzo. Solo aplica mientras dura el alta: en cuanto
   * se completa, la sesión vuelve al umbral normal.
   */
  private readonly altaInactivityTimeoutSec = Math.min(
    SESSION_TTL - 60,
    Math.max(
      this.inactivityTimeoutSec,
      (Number(process.env.CHATBOT_INTAKE_TIMEOUT_MINUTES) || 15) * 60,
    ),
  );

  constructor(
    private readonly redis: RedisService,
    private readonly httpService: HttpService,
    private readonly whatsappCredentials: WhatsappCredentialsService,
  ) {}

  // Corre cada minuto para honrar umbrales cortos (p.ej. 5 min) con buena
  // granularidad: la sesión se cierra a más tardar ~1 min después del umbral.
  @Cron(CronExpression.EVERY_MINUTE)
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

      // `ttl` es lo que le queda a la sesión antes de expirar. Como la key se
      // fija en SESSION_TTL y se refresca con cada mensaje del paciente, el
      // tiempo inactivo equivale a SESSION_TTL - ttl. Cerramos cuando supera
      // el umbral configurable.
      const ttl = await this.redis.ttl(key);
      if (ttl <= 0) continue;
      const idleSec = SESSION_TTL - ttl;

      // El alta de un paciente nuevo aguanta más: ver altaInactivityTimeoutSec.
      const enAlta =
        (await this.redis.get(
          `alta_en_curso:${organizationId}:${whatsappPhone}`,
        )) !== null;
      const umbral = enAlta
        ? this.altaInactivityTimeoutSec
        : this.inactivityTimeoutSec;
      if (idleSec < umbral) continue;

      this.logger.log(
        `⚠️ Sesión org=${organizationId} ${whatsappPhone} inactiva ${idleSec}s ` +
          `(umbral ${umbral}s${enAlta ? ', alta en curso' : ''}, estado: ${state}). Cerrando.`,
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
    recipientId: string,
  ) {
    const url = metaGraphUrl(`${creds.phoneNumberId}/messages`);
    const data = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      // Teléfono → `to`; BSUID → `recipient` (ver @agenia/shared).
      ...buildWhatsappRecipient(recipientId),
      type: 'text',
      text: {
        preview_url: false,
        body: "Hola. Lo siento, he cerrado nuestra comunicación por inactividad prolongada por su seguridad y privacidad de datos. ¡En caso de querer un servicio aquí estoy, solo escríbame 'Hola' nuevamente!",
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
        `Error enviando mensaje de abandono a ${recipientId}: ${error.message}`,
      );
    }
  }

  // Mismas claves (y mismo namespacing org:phone) que ChatbotService.cleanUpSession,
  // para no dejar datos de sesión colgados tras el cierre por inactividad.
  private async cleanUpSession(organizationId: string, whatsappPhone: string) {
    const base = `${organizationId}:${whatsappPhone}`;
    const keysToDelete = [
      `chat_state:${base}`,
      `temp_cedula:${base}`,
      `temp_nombre:${base}`,
      `temp_eps_query:${base}`,
      `temp_eps_id:${base}`,
      `temp_eps_max_letra:${base}`,
      `temp_especialidad:${base}`,
      `temp_especialidad_id:${base}`,
      `temp_service_max_letra:${base}`,
      `temp_doctor:${base}`,
      `temp_selected_slot_id:${base}`,
      `temp_selected_date_view:${base}`,
      `temp_waitlist_service_id:${base}`,
      `temp_waitlist_eps_id:${base}`,
      `temp_waitlist_doctor_id:${base}`,
      `temp_waitlist_pending:${base}`,
      `error_count:${base}`,
      `is_ai_flow:${base}`,
    ];
    // Los cupos ofrecidos van scoped por organización como el resto de la
    // sesión (ver slotKey/slotDateKey en ChatbotService): sin el tenant en el
    // patrón, cerrar por inactividad en una clínica borraba también los cupos
    // que otra le estuviera ofreciendo al mismo paciente.
    const slotKeys = await this.redis.keys(`temp_slot_*:${base}`);
    const serviceMenuKeys = await this.redis.keys(`temp_service_*:${base}`);
    const epsMenuKeys = await this.redis.keys(`temp_eps_[A-Z]_*:${base}`);
    // Claves efímeras de los flujos de cancelación y reprogramación (espejo de
    // cleanUp(Cancel|Modify)Session en ChatbotService): evita dejar contexto
    // colgado cuando el cierre lo dispara el cron de inactividad.
    const cancelKeys = await this.redis.keys(`temp_cancel_*:${base}`);
    const selectedCancelKeys = await this.redis.keys(
      `temp_selected_cancel_*:${base}`,
    );
    const modifyKeys = await this.redis.keys(`temp_modify_*:${base}`);
    const selectedModifyKeys = await this.redis.keys(
      `temp_selected_modify_*:${base}`,
    );
    await this.redis.del(
      ...keysToDelete,
      ...slotKeys,
      ...serviceMenuKeys,
      ...epsMenuKeys,
      ...cancelKeys,
      ...selectedCancelKeys,
      ...modifyKeys,
      ...selectedModifyKeys,
    );
  }
}
