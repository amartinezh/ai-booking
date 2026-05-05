// @ts-nocheck
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import { ChatState, SESSION_TTL, WAITLIST_CONFIRM_TTL, MSGS } from './chatbot.constants';
import { AppointmentsService } from 'src/appointments/appointments.service';
import { WaitlistService } from 'src/waitlist/waitlist.service';
import {
  InteractionLogService,
  InteractionStatus,
  FailureReason,
} from '../interaction-log/interaction-log.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import textToSpeech from '@google-cloud/text-to-speech';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly ttsClient = new textToSpeech.TextToSpeechClient();

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private httpService: HttpService,
    private redis: RedisService,
    private appointmentsService: AppointmentsService,
    private waitlistService: WaitlistService,
    private interactionLog: InteractionLogService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn('⚠️ GEMINI_API_KEY no definida. Las funciones de audio fallarán.');
    }
    this.genAI = new GoogleGenerativeAI(apiKey || 'dummy');
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 0: RESOLUCIÓN DE TENANT
  // ══════════════════════════════════════════════════════════════
  private async getOriginPhoneId(senderId: string): Promise<string> {
    const origin = await this.redis.get(`origin_phone:${senderId}`);
    return origin || this.configService.get<string>('META_PHONE_ID') || '';
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 1: ENVÍO DE MENSAJES OUTBOUND (META API)
  // 🛡️ A prueba de errores: nunca crashea el proceso.
  // 📝 Captura el último mensaje enviado para auditoría.
  // ══════════════════════════════════════════════════════════════
  private lastSentByUser = new Map<string, string>(); // En memoria, no persistente

  private async sendWhatsAppMessage(toPhone: string, text: string) {
    const token = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneId = await this.getOriginPhoneId(toPhone);

    if (!phoneId) {
      this.logger.error(`CRÍTICO: META_PHONE_ID no resuelto para ${toPhone}. Mensaje NO enviado.`);
      return null;
    }

    if (!token) {
      this.logger.error(`CRÍTICO: META_ACCESS_TOKEN no configurado. Mensaje NO enviado a ${toPhone}.`);
      return null;
    }

    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
    try {
      const response = await lastValueFrom(
        this.httpService.post(
          url,
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: toPhone,
            type: 'text',
            text: { preview_url: false, body: text },
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      // Guardar el último mensaje enviado para audit logging
      this.lastSentByUser.set(toPhone, text);

      return response.data;
    } catch (error) {
      const errorBody = error.response?.data || error.message || error;
      const errorString = typeof errorBody === 'object' ? JSON.stringify(errorBody) : errorBody;
      this.logger.error(`Error enviando mensaje a ${toPhone}: ${errorString}`);

      if (error.response?.data?.error?.code === 190) {
        this.logger.error(
          `🚨 TOKEN DE META EXPIRADO O REVOCADO. Renueva META_ACCESS_TOKEN en .env.production y recrea el contenedor.`,
        );
      }

      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 2: ESTADO DE SESIÓN (REDIS)
  // ══════════════════════════════════════════════════════════════
  private async getUserState(organizationId: string, phoneId: string): Promise<ChatState> {
    const state = await this.redis.get(`chat_state:${organizationId}:${phoneId}`);
    return (state as ChatState) || ChatState.IDLE;
  }

  private async setUserState(organizationId: string, phoneId: string, state: ChatState) {
    await this.redis.set(`chat_state:${organizationId}:${phoneId}`, state, 'EX', SESSION_TTL);
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 3: AUDIO (WHATSAPP → GEMINI)
  // ══════════════════════════════════════════════════════════════
  private async downloadWhatsAppAudio(mediaId: string): Promise<Buffer | null> {
    try {
      const token = this.configService.get<string>('META_ACCESS_TOKEN');
      const urlReq = `https://graph.facebook.com/v19.0/${mediaId}`;
      const urlResponse = await lastValueFrom(
        this.httpService.get(urlReq, { headers: { Authorization: `Bearer ${token}` } }),
      );
      const mediaUrl = urlResponse.data.url;
      const mediaResponse = await lastValueFrom(
        this.httpService.get(mediaUrl, {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'arraybuffer',
        }),
      );
      return Buffer.from(mediaResponse.data);
    } catch (error) {
      this.logger.error(`Error descargando audio ${mediaId}: ${error.message}`);
      return null;
    }
  }

  private async extractDataWithGemini(
    text: string | null,
    audioBuffer: Buffer | null,
  ): Promise<{
    cedula: string | null;
    nombre: string | null;
    eps: string | null;
    especialidad: string | null;
    doctor: string | null;
    isEscape: boolean;
    outOfContext: boolean;
    ininteligible: boolean;
    isFallback: boolean;
    isCancellation: boolean;
  }> {
    const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `
        Eres un asistente médico hiper-empático en una clínica colombiana que analiza solicitudes de agendamiento.
        Analiza el texto o audio provisto.

        REGLA DE CANCELACIÓN: Si el usuario dice "cancelar una cita", "anular cita" o "suspender mi cita", pon "isCancellation" en true.
        REGLA DE ESCAPE: Si el usuario quiere reiniciar, volver atrás o salir del flujo (ej: "me equivoqué", "salir", "volver", "reiniciar"), pon "isEscape" en true. (NOTA: "cancelar cita" es isCancellation, NO isEscape). Saludos como "Hola" no son escape.
        REGLA DE FUERA DE CONTEXTO: Si el paciente dice groserías o temas sin relación médica, pon "outOfContext" en true.
        REGLA DE RUIDO: Si el audio es vacío, inentendible o solo hay ruido, pon "ininteligible" en true.

        Devuelve ÚNICAMENTE JSON válido sin bloques de código:
        {
            "cedula": "Número sin puntos (Ej: 1088123456). Si no menciona, null.",
            "nombre": "Nombre completo. Si no menciona, null.",
            "eps": "Nombre de EPS o aseguradora. Si no menciona, null.",
            "especialidad": "Especialidad médica normalizada. Si no menciona, null.",
            "doctor": "Nombre del médico si pide uno específico. Si no menciona, null.",
            "isEscape": false,
            "outOfContext": false,
            "ininteligible": false,
            "isCancellation": false
        }`;

    const parts: any[] = [prompt];
    if (text) parts.push(`Texto del usuario: "${text}"`);
    if (audioBuffer) {
      parts.push({
        inlineData: {
          data: audioBuffer.toString('base64'),
          mimeType: 'audio/ogg',
        },
      });
    }

    try {
      const result = await model.generateContent(parts);
      const responseText = result.response.text().trim();
      const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '');
      const parsed = JSON.parse(cleanedText);
      parsed.isFallback = false;
      return parsed;
    } catch (e) {
      this.logger.error('Error procesando IA con Gemini', e);
      return {
        cedula: null, nombre: null, eps: null, especialidad: null, doctor: null,
        isEscape: false, outOfContext: false, ininteligible: false,
        isFallback: true, isCancellation: false,
      };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 4: TEXT-TO-SPEECH Y SMART REPLY
  // ══════════════════════════════════════════════════════════════
  private async generateTTS(text: string): Promise<Buffer | null> {
    try {
      const cleanText = text.replace(/[*_~`\[\]🎙️⏳✅❌📅👤⚕️⚠️🎉📝🔔😔😊🏥💳🪪]/g, '').trim();
      const request = {
        input: { text: cleanText },
        voice: { languageCode: 'es-US', name: 'es-US-Neural2-A' },
        audioConfig: { audioEncoding: 'OGG_OPUS' as const },
      };
      const [response] = await this.ttsClient.synthesizeSpeech(request);
      if (!response.audioContent) {
        this.logger.error('Google Cloud TTS no devolvió audio');
        return null;
      }
      return Buffer.from(response.audioContent);
    } catch (error) {
      this.logger.error(`Error en generateTTS: ${error.message}`);
      return null;
    }
  }

  private async uploadToWhatsApp(audioBuffer: Buffer, senderId: string): Promise<string | null> {
    try {
      const token = this.configService.get<string>('META_ACCESS_TOKEN');
      const phoneId = await this.getOriginPhoneId(senderId);
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/ogg' });
      formData.append('file', blob, 'audio.ogg');
      const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        this.logger.error(`Error subiendo audio: ${JSON.stringify(data)}`);
        return null;
      }
      return data.id;
    } catch (error) {
      this.logger.error(`Error en uploadToWhatsApp: ${error.message}`);
      return null;
    }
  }

  private async sendWhatsAppAudioMessage(toPhone: string, mediaId: string) {
    try {
      const token = this.configService.get<string>('META_ACCESS_TOKEN');
      const phoneId = await this.getOriginPhoneId(toPhone);
      await lastValueFrom(
        this.httpService.post(
          `https://graph.facebook.com/v19.0/${phoneId}/messages`,
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: toPhone,
            type: 'audio',
            audio: { id: mediaId },
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
    } catch (error) {
      this.logger.error(`Error enviando audio a ${toPhone}: ${error.response?.data || error.message}`);
    }
  }

  private async smartReply(organizationId: string, senderId: string, text: string) {
    const isAiFlow =
      (await this.redis.get(`is_ai_flow:${organizationId}:${senderId}`)) === 'true';

    if (isAiFlow) {
      try {
        const audioBuffer = await this.generateTTS(text);
        if (audioBuffer) {
          const mediaId = await this.uploadToWhatsApp(audioBuffer, senderId);
          if (mediaId) {
            await this.sendWhatsAppAudioMessage(senderId, mediaId);
          }
        }
        await this.sendWhatsAppMessage(senderId, text);
        return;
      } catch (error) {
        this.logger.error(`Error en smartReply (AI flow): ${error.message}`);
      }
    }
    await this.sendWhatsAppMessage(senderId, text);
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 5: PERSISTENCIA DE PACIENTE — MULTI-PACIENTE
  // ══════════════════════════════════════════════════════════════
  private async ensurePatientPersisted(params: {
    cedula: string;
    nombre: string;
    senderId: string;
    organizationId: string;
    epsId?: string | null;
  }): Promise<any> {
    const { cedula, nombre, senderId, organizationId, epsId } = params;

    let patient = await this.prisma.patientProfile.findUnique({
      where: { cedula },
    });

    if (patient) {
      const updates: any = {};
      if (!patient.whatsappId) updates.whatsappId = senderId;
      if (!patient.organizationId) updates.organizationId = organizationId;
      if (epsId && !patient.epsId) updates.epsId = epsId;
      if (Object.keys(updates).length > 0) {
        try {
          patient = await this.prisma.patientProfile.update({
            where: { id: patient.id },
            data: updates,
          });
        } catch (error) {
          this.logger.error(
            `Error actualizando paciente ${cedula}: ${error.message || JSON.stringify(error)}`,
          );
        }
      }
      return patient;
    }

    try {
      const tempUser = await this.prisma.user.create({
        data: {
          email: `temp_${Date.now()}_${cedula}@paciente.local`,
          password: 'none',
          role: 'PATIENT',
        },
      });
      patient = await this.prisma.patientProfile.create({
        data: {
          cedula,
          fullName: nombre,
          whatsappId: senderId,
          userId: tempUser.id,
          epsId: epsId || null,
          organizationId,
        },
      });
      this.logger.log(`✅ Paciente persistido: ${nombre} (cédula ${cedula}, WA ${senderId})`);
      return patient;
    } catch (error) {
      this.logger.error(
        `Error persistiendo paciente cédula ${cedula}: ${error.message || JSON.stringify(error)}`,
      );
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 6: LIMPIEZA DE SESIÓN
  // ══════════════════════════════════════════════════════════════
  private async cleanUpSession(organizationId: string, senderId: string) {
    const keysToDelete = [
      `temp_cedula:${organizationId}:${senderId}`,
      `temp_nombre:${organizationId}:${senderId}`,
      `temp_eps_query:${organizationId}:${senderId}`,
      `temp_eps_id:${organizationId}:${senderId}`,
      `temp_especialidad:${organizationId}:${senderId}`,
      `temp_especialidad_id:${organizationId}:${senderId}`,
      `temp_doctor:${organizationId}:${senderId}`,
      `temp_selected_slot_id:${organizationId}:${senderId}`,
      `temp_selected_date_view:${organizationId}:${senderId}`,
      `error_count:${organizationId}:${senderId}`,
      `is_ai_flow:${organizationId}:${senderId}`,
    ];
    const slotKeys = await this.redis.keys(`temp_slot_*:${senderId}`);
    await this.redis.del(...keysToDelete, ...slotKeys);
    await this.setUserState(organizationId, senderId, ChatState.IDLE);
    // Limpiar último mensaje enviado en memoria
    this.lastSentByUser.delete(senderId);
  }

  private async cleanUpCancelSession(organizationId: string, senderId: string) {
    const cancelKeys = await this.redis.keys(`temp_cancel_*:${organizationId}:${senderId}`);
    if (cancelKeys.length > 0) await this.redis.del(...cancelKeys);
    await this.redis.del(
      `temp_selected_cancel_apt:${organizationId}:${senderId}`,
      `temp_selected_cancel_slot:${organizationId}:${senderId}`,
    );
    await this.setUserState(organizationId, senderId, ChatState.IDLE);
  }

  // ══════════════════════════════════════════════════════════════
  // CORE: PROCESAMIENTO DE MENSAJES — con try/catch global y logging
  // ══════════════════════════════════════════════════════════════
  async processIncomingMessage(event: any) {
    const senderId = event.from || event.sender?.id;
    const messageType = event.type;
    const userMessage = event.text?.body?.trim() || event.message?.text?.trim();

    try {
      await this.processIncomingMessageUnsafe(event);
    } catch (error) {
      this.logger.error(
        `🚨 Error no manejado en processIncomingMessage: ${error.message}`,
        error.stack,
      );

      // 📝 Auditoría: registrar el error no manejado
      await this.interactionLog.logFailure({
        whatsappId: senderId,
        reason: FailureReason.UNHANDLED_ERROR,
        userMessage: userMessage || `[${messageType}]`,
        botReply: this.lastSentByUser.get(senderId) || null,
        metadata: {
          errorMessage: error.message,
          errorStack: error.stack?.substring(0, 1000),
          messageType,
        },
      });
    }
  }

  private async processIncomingMessageUnsafe(event: any) {
    const senderId = event.from || event.sender?.id;
    const messageType = event.type;
    const text = event.text?.body?.trim() || event.message?.text?.trim();
    const audioId = event.audio?.id;

    // ── IDENTIFICACIÓN DEL TENANT ──────────────────────────────
    const metaPhoneId =
      event.metadata?.phone_number_id ||
      this.configService.get<string>('META_PHONE_ID');

    let organizationId: string | null = null;
    let orgName = 'nuestra Clínica';
    let org: any = null;

    if (metaPhoneId) {
      await this.redis.set(`origin_phone:${senderId}`, metaPhoneId, 'EX', SESSION_TTL);
      org = await this.prisma.organization.findUnique({
        where: { whatsappPhoneId: metaPhoneId },
      });
      if (org) {
        if (!org.isActive) {
          const reply = 'Esta línea clínica se encuentra inactiva temporalmente por mantenimiento administrativo.';
          await this.sendWhatsAppMessage(senderId, reply);

          // 📝 Auditoría
          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId: org.id,
            reason: FailureReason.ORG_INACTIVE,
            userMessage: text || `[${messageType}]`,
            botReply: reply,
            metadata: { orgName: org.name },
          });
          return;
        }
        organizationId = org.id;
        orgName = org.name;
      }
    }

    if (!organizationId) {
      const firstOrg = await this.prisma.organization.findFirst();
      if (firstOrg) {
        organizationId = firstOrg.id;
        orgName = firstOrg.name;
        org = firstOrg;
      }
    }

    if (messageType !== 'text' && messageType !== 'audio') return;

    const currentState = await this.getUserState(organizationId, senderId);
    this.logger.log(
      `[Tenant: ${organizationId}] Usuario ${senderId} en estado: ${currentState}. Tipo: ${messageType}`,
    );

    const retriesKey = `error_count:${organizationId}:${senderId}`;
    const retriesCount = parseInt((await this.redis.get(retriesKey)) || '0');

    // ── MÁXIMO REINTENTOS ──────────────────────────────────────
    if (retriesCount >= 3) {
      this.logger.warn(`Máximo de reintentos para ${senderId}`);
      await this.cleanUpSession(organizationId, senderId);
      const humanPhone = org?.supportPhone || '';
      const replyText = humanPhone
        ? MSGS.maxReintentos(humanPhone)
        : MSGS.maxReintentosReset();
      await this.smartReply(organizationId, senderId, replyText);

      // 📝 Auditoría: usuario abandonó por exceso de reintentos
      await this.interactionLog.log({
        whatsappId: senderId,
        organizationId,
        status: InteractionStatus.ABANDONED,
        failureReason: FailureReason.MAX_RETRIES,
        userMessage: text || `[${messageType}]`,
        botReply: replyText,
        metadata: { previousState: currentState, retriesCount },
      });
      return;
    }

    const isStrictStep =
      currentState === ChatState.AWAITING_DATE ||
      currentState === ChatState.AWAITING_CONFIRMATION ||
      currentState === ChatState.AWAITING_CANCEL_SELECTION ||
      currentState === ChatState.AWAITING_CANCEL_CONFIRM ||
      currentState === ChatState.AWAITING_WAITLIST_CONFIRM;

    const isAudio = messageType === 'audio' && !!audioId;

    if (isAudio && isStrictStep) {
      const reply = MSGS.audioPasoEstricto();
      await this.sendWhatsAppMessage(senderId, reply);

      // 📝 Auditoría: rechazo de audio en paso estricto
      await this.interactionLog.logSuccess({
        whatsappId: senderId,
        organizationId,
        userMessage: '[audio]',
        botReply: reply,
        metadata: { reason: 'AUDIO_REJECTED_IN_STRICT_STEP', state: currentState },
      });
      return;
    }

    const isQuickCancel =
      messageType === 'text' &&
      text &&
      /^(cancelar cita|anular cita|quiero cancelar|necesito cancelar)/i.test(text.trim());

    const isQuickEscape =
      messageType === 'text' &&
      text &&
      /^(hola|salir|reiniciar|volver|me equivoque|me equivoqué|otra cita|cambiar|no quiero|detener|menu|menú)$/i.test(
        text.trim(),
      );

    let aiData = {
      cedula: null as string | null,
      nombre: null as string | null,
      eps: null as string | null,
      especialidad: null as string | null,
      doctor: null as string | null,
      isEscape: false,
      outOfContext: false,
      ininteligible: false,
      isFallback: false,
      isCancellation: false,
    };

    if (isQuickCancel && currentState === ChatState.IDLE) {
      aiData.isCancellation = true;
    } else if (isQuickEscape && currentState !== ChatState.IDLE) {
      aiData.isEscape = true;
    } else if (
      text &&
      text.trim().toLowerCase() === 'cancelar' &&
      currentState !== ChatState.IDLE
    ) {
      aiData.isEscape = true;
    } else if (isQuickEscape && currentState === ChatState.IDLE && text.trim().toLowerCase() === 'hola') {
      // saludo simple, no llama Gemini
    } else if (isAudio) {
      await this.redis.set(`is_ai_flow:${organizationId}:${senderId}`, 'true', 'EX', SESSION_TTL);
      await this.sendWhatsAppMessage(senderId, '🎧 Permítame un momento, lo estoy escuchando...');
      const audioBuffer = await this.downloadWhatsAppAudio(audioId);
      if (audioBuffer) {
        aiData = await this.extractDataWithGemini(null, audioBuffer);
      } else {
        aiData.ininteligible = true;
      }
    } else if (messageType === 'text' && text && !isStrictStep) {
      aiData = await this.extractDataWithGemini(text, null);
    }

    this.logger.log(`🧠 Gemini extrajo: ${JSON.stringify(aiData)}`);

    // ── GUARDS GLOBALES ────────────────────────────────────────

    if (aiData.isFallback) {
      await this.cleanUpSession(organizationId, senderId);
      const humanPhone = org?.supportPhone || '+573000000000';
      const reply = MSGS.iaCaida(humanPhone);
      await this.smartReply(organizationId, senderId, reply);

      // 📝 Auditoría: Gemini falló
      await this.interactionLog.logFailure({
        whatsappId: senderId,
        organizationId,
        reason: FailureReason.GEMINI_DOWN,
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: { previousState: currentState },
      });
      return;
    }

    if (aiData.isCancellation || isQuickCancel) {
      await this.cleanUpSession(organizationId, senderId);
      await this.redis.set(
        `is_ai_flow:${organizationId}:${senderId}`,
        isAudio ? 'true' : 'false',
        'EX',
        SESSION_TTL,
      );

      let reply: string;
      if (aiData.cedula) {
        await this.redis.set(`temp_cancel_cedula:${organizationId}:${senderId}`, aiData.cedula, 'EX', SESSION_TTL);
        await this.handleCancelCedulaStep(organizationId, senderId, aiData.cedula);
        reply = this.lastSentByUser.get(senderId) || '[cancelación iniciada]';
      } else {
        reply = MSGS.cancelarPedirCedula();
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_CEDULA);
      }

      // 📝 Auditoría: inicio de flujo de cancelación
      await this.interactionLog.log({
        whatsappId: senderId,
        organizationId,
        status: InteractionStatus.CANCELLATION_FLOW,
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: { aiData, hasInitialCedula: !!aiData.cedula },
      });
      return;
    }

    if (aiData.isEscape) {
      await this.cleanUpSession(organizationId, senderId);
      const reply = MSGS.escape();
      await this.smartReply(organizationId, senderId, reply);

      // 📝 Auditoría: usuario reinició el flujo
      await this.interactionLog.log({
        whatsappId: senderId,
        organizationId,
        status: InteractionStatus.ESCAPED,
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: { previousState: currentState },
      });
      return;
    }

    if (aiData.outOfContext) {
      await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
      const reply = MSGS.outOfContext();
      await this.smartReply(organizationId, senderId, reply);

      await this.interactionLog.logFailure({
        whatsappId: senderId,
        organizationId,
        reason: FailureReason.OUT_OF_CONTEXT,
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: { retriesCount: retriesCount + 1 },
      });
      return;
    }

    if (aiData.ininteligible) {
      await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
      const reply = MSGS.ininteligible();
      await this.smartReply(organizationId, senderId, reply);

      await this.interactionLog.logFailure({
        whatsappId: senderId,
        organizationId,
        reason: FailureReason.UNINTELLIGIBLE_AUDIO,
        userMessage: '[audio inentendible]',
        botReply: reply,
        metadata: { retriesCount: retriesCount + 1 },
      });
      return;
    }

    if (aiData.cedula || aiData.especialidad || aiData.eps || aiData.doctor) {
      await this.redis.del(retriesKey);
    }

    if (currentState === ChatState.AWAITING_WAITLIST_CONFIRM) {
      await this.handleWaitlistConfirmStep(organizationId, senderId, text);
      return;
    }

    // ══════════════════════════════════════════════════════════
    // MEMORIA A CORTO PLAZO (cascada de contexto)
    // ══════════════════════════════════════════════════════════
    const savedCedula = await this.redis.get(`temp_cedula:${organizationId}:${senderId}`);
    const savedNombre = await this.redis.get(`temp_nombre:${organizationId}:${senderId}`);
    const savedEspecialidad = await this.redis.get(`temp_especialidad:${organizationId}:${senderId}`);
    const savedEspecialidadId = await this.redis.get(`temp_especialidad_id:${organizationId}:${senderId}`);
    const savedDoctor = await this.redis.get(`temp_doctor:${organizationId}:${senderId}`);
    const savedEps = await this.redis.get(`temp_eps_query:${organizationId}:${senderId}`);

    const finalCedula = aiData.cedula || savedCedula;
    const finalNombre = aiData.nombre || savedNombre;
    const finalEspecialidad = aiData.especialidad || savedEspecialidad;
    const finalDoctor = aiData.doctor || savedDoctor;
    const finalEps = aiData.eps || savedEps;

    if (finalCedula) await this.redis.set(`temp_cedula:${organizationId}:${senderId}`, finalCedula, 'EX', SESSION_TTL);
    if (finalNombre) await this.redis.set(`temp_nombre:${organizationId}:${senderId}`, finalNombre, 'EX', SESSION_TTL);
    if (finalDoctor) await this.redis.set(`temp_doctor:${organizationId}:${senderId}`, finalDoctor, 'EX', SESSION_TTL);
    if (finalEps) await this.redis.set(`temp_eps_query:${organizationId}:${senderId}`, finalEps, 'EX', SESSION_TTL);
    if (finalEspecialidad) await this.redis.set(`temp_especialidad:${organizationId}:${senderId}`, finalEspecialidad, 'EX', SESSION_TTL);

    const isCancelFlow =
      currentState === ChatState.AWAITING_CANCEL_CEDULA ||
      currentState === ChatState.AWAITING_CANCEL_SELECTION ||
      currentState === ChatState.AWAITING_CANCEL_CONFIRM;

    // ══════════════════════════════════════════════════════════
    // FLUJO PRINCIPAL DE AGENDAMIENTO (pasos no-estrictos)
    // ══════════════════════════════════════════════════════════
    if (!isStrictStep && !isCancelFlow) {

      // ── PASO 1: ESPECIALIDAD O MÉDICO ──────────────────────
      if (!finalEspecialidad && !finalDoctor) {
        const activeServices = await this.prisma.medicalService.findMany({
          where: { isActive: true, organizationId },
          select: { name: true },
          orderBy: { name: 'asc' },
        });
        const serviciosText =
          activeServices.length > 0
            ? `Opciones: ${activeServices.map((s) => s.name).join(' · ')}`
            : 'Ej: Medicina General, Odontología';

        const reply = MSGS.bienvenida(orgName, serviciosText);
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);

        // 📝 Auditoría: bienvenida / pidiendo especialidad
        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: {
            step: 'WELCOME',
            previousState: currentState,
            newState: ChatState.AWAITING_SPECIALTY,
            aiData,
          },
        });
        return;
      }

      let finalEspecialidadConDoctor = finalEspecialidad;
      let finalEspecialidadIdResuelto = savedEspecialidadId;

      if (finalDoctor && !finalEspecialidad) {
        const doctores = await this.prisma.doctorProfile.findMany({
          where: {
            fullName: { contains: finalDoctor, mode: 'insensitive' },
            isActive: true,
            organizationId,
          },
          include: { service: true },
        });
        if (doctores.length === 0) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          await this.redis.del(`temp_doctor:${organizationId}:${senderId}`);
          const reply = `Lo siento, no encontré ningún médico con el nombre *"${finalDoctor}"* en nuestra institución.\n\nPor favor indíqueme la especialidad deseada o el nombre correcto del médico.`;
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.DOCTOR_NOT_FOUND,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: { searchedDoctor: finalDoctor },
          });
          return;
        }
        if (doctores.length > 1) {
          let opciones = '';
          doctores.forEach((d, i) => {
            opciones += `*${i + 1}.* Dr. ${d.fullName} _(${d.service?.name})_\n`;
          });
          await this.redis.del(`temp_doctor:${organizationId}:${senderId}`);
          const reply = `Encontré varios médicos con el nombre *"${finalDoctor}"*:\n\n${opciones}\nPor favor indíqueme el apellido completo o la especialidad.`;
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);

          await this.interactionLog.logSuccess({
            whatsappId: senderId,
            organizationId,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              step: 'DOCTOR_DISAMBIGUATION',
              candidates: doctores.map(d => d.fullName),
            },
          });
          return;
        }
        finalEspecialidadConDoctor = doctores[0].service?.name || finalEspecialidad;
        finalEspecialidadIdResuelto = doctores[0].serviceId || null;
        if (finalEspecialidadConDoctor) {
          await this.redis.set(`temp_especialidad:${organizationId}:${senderId}`, finalEspecialidadConDoctor, 'EX', SESSION_TTL);
        }
      } else if (finalEspecialidad && !savedEspecialidadId) {
        const svc = await this.prisma.medicalService.findFirst({
          where: {
            name: { contains: finalEspecialidad, mode: 'insensitive' },
            isActive: true,
            organizationId,
          },
        });
        if (svc) {
          finalEspecialidadIdResuelto = svc.id;
          await this.redis.set(`temp_especialidad_id:${organizationId}:${senderId}`, svc.id, 'EX', SESSION_TTL);
        }
      }

      // ── PASO 2: CÉDULA ────────────────────────────────────
      if (!finalCedula) {
        const reply = MSGS.pedirCedula(finalDoctor || finalEspecialidadConDoctor || 'la especialidad solicitada');
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CEDULA);

        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: {
            step: 'ASKING_CEDULA',
            specialty: finalEspecialidadConDoctor,
            doctor: finalDoctor,
          },
        });
        return;
      }

      // Cargar contexto del paciente si existe
      let dbPatientEpsId: string | null = null;
      let dbPatientEpsName: string | null = null;
      const patient = await this.prisma.patientProfile.findUnique({
        where: { cedula: finalCedula },
        include: { eps: true },
      });

      if (patient) {
        if (!finalNombre) {
          await this.redis.set(`temp_nombre:${organizationId}:${senderId}`, patient.fullName, 'EX', SESSION_TTL);
        }
        if (patient.eps) {
          dbPatientEpsId = patient.epsId;
          dbPatientEpsName = patient.eps.name;
        }
      } else {
        // Paciente nuevo: pedir nombre
        if (!finalNombre) {
          const reply = MSGS.primeraVez();
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_NAME);

          await this.interactionLog.logSuccess({
            whatsappId: senderId,
            organizationId,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              step: 'ASKING_NAME_NEW_PATIENT',
              cedula: finalCedula,
            },
          });
          return;
        }

        await this.ensurePatientPersisted({
          cedula: finalCedula,
          nombre: finalNombre,
          senderId,
          organizationId: organizationId!,
          epsId: null,
        });
      }

      const epsEfectiva = finalEps || dbPatientEpsName;

      // ── PASO 3: EPS ───────────────────────────────────────
      if (!epsEfectiva) {
        const reply = MSGS.pedirEps();
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_EPS);

        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: { step: 'ASKING_EPS', cedula: finalCedula },
        });
        return;
      }

      const epsMatches = await this.prisma.eps.findMany({
        where: {
          name: { contains: epsEfectiva, mode: 'insensitive' },
          organizationId: organizationId!,
        },
      });

      if (epsMatches.length === 0) {
        await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
        await this.redis.del(`temp_eps_query:${organizationId}:${senderId}`);
        const reply = MSGS.epsNoEncontrada(epsEfectiva);
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_EPS);

        await this.interactionLog.logFailure({
          whatsappId: senderId,
          organizationId,
          reason: FailureReason.EPS_NOT_FOUND,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: { searchedEps: epsEfectiva },
        });
        return;
      }

      if (!epsMatches[0].isActive) {
        await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
        await this.redis.del(`temp_eps_query:${organizationId}:${senderId}`);
        const reply = MSGS.epsInactiva(epsMatches[0].name);
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_EPS);

        await this.interactionLog.logFailure({
          whatsappId: senderId,
          organizationId,
          reason: FailureReason.EPS_INACTIVE,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: { eps: epsMatches[0].name },
        });
        return;
      }

      const matchedEpsId = epsMatches[0].id;
      const matchedEpsName = epsMatches[0].name;
      await this.redis.set(`temp_eps_id:${organizationId}:${senderId}`, matchedEpsId, 'EX', SESSION_TTL);

      if (finalCedula && finalNombre) {
        await this.ensurePatientPersisted({
          cedula: finalCedula,
          nombre: finalNombre,
          senderId,
          organizationId: organizationId!,
          epsId: matchedEpsId,
        });
      }

      // ── BUSCAR SLOTS DISPONIBLES ──────────────────────────
      const slots = await this.appointmentsService.getAvailableSlots(
        finalEspecialidadConDoctor as string,
        matchedEpsId,
        organizationId!,
      );

      // ── SIN DISPONIBILIDAD → WAITLIST ─────────────────────
      if (slots.length === 0) {
        const nombrePaciente = finalNombre || patient?.fullName || 'paciente';

        const patientForWaitlist = await this.ensurePatientPersisted({
          cedula: finalCedula,
          nombre: nombrePaciente,
          senderId,
          organizationId: organizationId!,
          epsId: matchedEpsId,
        });

        let position = 1;
        let waitlistEntryId: string | null = null;
        if (patientForWaitlist) {
          const serviceRecord = await this.prisma.medicalService.findFirst({
            where: {
              name: { contains: finalEspecialidadConDoctor as string, mode: 'insensitive' },
              organizationId: organizationId!,
            },
          });

          if (serviceRecord) {
            try {
              const result = await this.waitlistService.joinWaitlist({
                patientId: patientForWaitlist.id,
                serviceId: serviceRecord.id,
                epsId: matchedEpsId,
                whatsappId: senderId,
                organizationId: organizationId!,
              });
              position = result.position;
              waitlistEntryId = result.id || null;
            } catch (e) {
              this.logger.error(`Error agregando a waitlist: ${e.message}`);
            }
          }
        }

        const reply = MSGS.sinDisponibilidad(nombrePaciente, matchedEpsName, finalEspecialidadConDoctor as string, position);
        await this.smartReply(organizationId, senderId, reply);
        await this.cleanUpSession(organizationId, senderId);

        // 📝 Auditoría: paciente entró a waitlist (evento de negocio)
        if (waitlistEntryId && patientForWaitlist) {
          await this.interactionLog.logWaitlistJoined({
            whatsappId: senderId,
            organizationId: organizationId!,
            waitlistEntryId,
            patientCedula: finalCedula,
            serviceName: finalEspecialidadConDoctor as string,
            epsName: matchedEpsName,
            position,
            userMessage: text || '[audio]',
            botReply: reply,
          });
        } else {
          // Si no se pudo crear waitlist, registrar como fallo
          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId: organizationId!,
            reason: FailureReason.NO_AGENDA,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              cedula: finalCedula,
              eps: matchedEpsName,
              specialty: finalEspecialidadConDoctor,
              waitlistFailed: true,
            },
          });
        }
        return;
      }

      // ── MOSTRAR CUPOS DISPONIBLES ─────────────────────────
      const nombrePaciente = finalNombre || patient?.fullName || '';
      let lineasFechas = '';
      const slotsMetadata = [];
      for (let i = 0; i < slots.length; i++) {
        const letra = String.fromCharCode(65 + i);
        await this.redis.set(`temp_slot_${letra}:${senderId}`, slots[i].slotId, 'EX', SESSION_TTL);
        await this.redis.set(`temp_slot_${letra}_fecha:${senderId}`, slots[i].fecha.toISOString(), 'EX', SESSION_TTL);
        lineasFechas +=
          `*${letra})* ${slots[i].fecha.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })} ` +
          `a las ${slots[i].fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} ` +
          `· Dr. ${slots[i].doctor}\n`;
        slotsMetadata.push({
          letter: letra,
          slotId: slots[i].slotId,
          doctor: slots[i].doctor,
          fecha: slots[i].fecha.toISOString(),
        });
      }

      const reply = MSGS.cuposDisponibles(nombrePaciente, matchedEpsName, lineasFechas);
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(organizationId, senderId, ChatState.AWAITING_DATE);

      // 📝 Auditoría: cupos mostrados
      await this.interactionLog.logSuccess({
        whatsappId: senderId,
        organizationId,
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: {
          step: 'SLOTS_OFFERED',
          slotsCount: slots.length,
          slots: slotsMetadata,
          patientCedula: finalCedula,
          eps: matchedEpsName,
          specialty: finalEspecialidadConDoctor,
        },
      });
      return;
    }

    // ══════════════════════════════════════════════════════════
    // MÁQUINA DE ESTADOS — PASOS ESTRICTOS Y CANCELACIÓN
    // ══════════════════════════════════════════════════════════
    switch (currentState) {

      case ChatState.AWAITING_DATE: {
        const letraElegida = text?.toUpperCase().trim() || '';
        const slotId = await this.redis.get(`temp_slot_${letraElegida}:${senderId}`);
        const slotFechaStr = await this.redis.get(`temp_slot_${letraElegida}_fecha:${senderId}`);

        if (!slotId || !slotFechaStr) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const reply = MSGS.errorSlotInvalido();
          await this.smartReply(organizationId, senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.SESSION_EXPIRED,
            userMessage: text,
            botReply: reply,
            metadata: { invalidLetter: letraElegida, state: currentState },
          });
          return;
        }

        await this.redis.set(`temp_selected_slot_id:${organizationId}:${senderId}`, slotId, 'EX', SESSION_TTL);
        await this.redis.set(`temp_selected_date_view:${organizationId}:${senderId}`, slotFechaStr, 'EX', SESSION_TTL);

        const cedulaAgend = await this.redis.get(`temp_cedula:${organizationId}:${senderId}`);
        const nombreAgend = await this.redis.get(`temp_nombre:${organizationId}:${senderId}`) || 'Paciente';
        const specAgend = await this.redis.get(`temp_especialidad:${organizationId}:${senderId}`) || 'Servicio';
        const epsAgend = await this.redis.get(`temp_eps_query:${organizationId}:${senderId}`) || 'EPS';
        const fechaFormateada = new Date(slotFechaStr).toLocaleString('es-CO', {
          weekday: 'long', day: 'numeric', month: 'long',
          hour: '2-digit', minute: '2-digit',
        });

        const reply = MSGS.resumenCita(nombreAgend, cedulaAgend || '', epsAgend, specAgend, fechaFormateada);
        await this.sendWhatsAppMessage(senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CONFIRMATION);

        // 📝 Auditoría: paciente seleccionó slot
        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text,
          botReply: reply,
          metadata: {
            step: 'SLOT_SELECTED',
            selectedLetter: letraElegida,
            slotId,
            slotDate: slotFechaStr,
            cedula: cedulaAgend,
          },
        });
        break;
      }

      case ChatState.AWAITING_CONFIRMATION: {
        const respuesta = text?.toUpperCase().trim() || '';

        if (['SI', 'SÍ', 'SÍ.', 'SI.'].includes(respuesta)) {
          const cedulaFinal = await this.redis.get(`temp_cedula:${organizationId}:${senderId}`);
          const nombreFinal = await this.redis.get(`temp_nombre:${organizationId}:${senderId}`);
          const specFinal = await this.redis.get(`temp_especialidad:${organizationId}:${senderId}`);
          const epsIdFinal = await this.redis.get(`temp_eps_id:${organizationId}:${senderId}`);
          const slotIdFinal = await this.redis.get(`temp_selected_slot_id:${organizationId}:${senderId}`);
          const fechaVistaFinal = await this.redis.get(`temp_selected_date_view:${organizationId}:${senderId}`);

          if (!cedulaFinal || !specFinal || !slotIdFinal || !fechaVistaFinal) {
            const reply = MSGS.sesionExpirada();
            await this.smartReply(organizationId, senderId, reply);
            await this.cleanUpSession(organizationId, senderId);

            await this.interactionLog.logFailure({
              whatsappId: senderId,
              organizationId,
              reason: FailureReason.SESSION_EXPIRED,
              userMessage: text,
              botReply: reply,
              metadata: { stage: 'AWAITING_CONFIRMATION_SI' },
            });
            return;
          }

          const patient = await this.ensurePatientPersisted({
            cedula: cedulaFinal,
            nombre: nombreFinal || 'Paciente Registrado',
            senderId,
            organizationId: organizationId!,
            epsId: epsIdFinal || null,
          });

          if (!patient) {
            const reply = MSGS.cancelarError();
            await this.smartReply(organizationId, senderId, reply);
            await this.cleanUpSession(organizationId, senderId);

            await this.interactionLog.logFailure({
              whatsappId: senderId,
              organizationId,
              reason: FailureReason.UNHANDLED_ERROR,
              userMessage: text,
              botReply: reply,
              metadata: { stage: 'PATIENT_PERSISTENCE_FAILED', cedula: cedulaFinal },
            });
            return;
          }

          const bookingResult = await this.appointmentsService.bookAppointment(
            patient.id,
            slotIdFinal as string,
            patient.epsId,
            'WHATSAPP',
            organizationId!,
          );

          if (bookingResult.success) {
            const fechaFormateada = new Date(fechaVistaFinal).toLocaleString('es-CO', {
              weekday: 'long', day: 'numeric', month: 'long',
              hour: '2-digit', minute: '2-digit',
            });
            const reply = MSGS.citaConfirmada(orgName, fechaFormateada);
            await this.smartReply(organizationId, senderId, reply);

            // 📝 Auditoría: cita agendada (evento de negocio crítico)
            const slotInfo = await this.prisma.scheduleSlot.findUnique({
              where: { id: slotIdFinal as string },
              include: { doctor: true, service: true },
            });
            await this.interactionLog.logBookingConfirmed({
              whatsappId: senderId,
              organizationId: organizationId!,
              appointmentId: bookingResult.appointmentId || 'unknown',
              patientCedula: cedulaFinal,
              serviceName: slotInfo?.service?.name || specFinal,
              doctorName: slotInfo?.doctor?.fullName || 'desconocido',
              slotDate: new Date(fechaVistaFinal),
              epsName: epsIdFinal ? (await this.prisma.eps.findUnique({ where: { id: epsIdFinal } }))?.name : undefined,
              userMessage: text,
              botReply: reply,
            });
          } else {
            const reply = MSGS.slotTomado();
            await this.smartReply(organizationId, senderId, reply);
            await this.setUserState(organizationId, senderId, ChatState.AWAITING_DATE);

            await this.interactionLog.logFailure({
              whatsappId: senderId,
              organizationId,
              reason: FailureReason.SLOT_TAKEN,
              userMessage: text,
              botReply: reply,
              metadata: {
                slotId: slotIdFinal,
                cedula: cedulaFinal,
              },
            });
            return;
          }

          await this.cleanUpSession(organizationId, senderId);

        } else if (['NO', 'NO.', 'CANCELAR'].includes(respuesta)) {
          const reply = MSGS.citaNoConfirmada();
          await this.smartReply(organizationId, senderId, reply);
          await this.cleanUpSession(organizationId, senderId);

          // 📝 Auditoría: usuario rechazó la confirmación
          await this.interactionLog.log({
            whatsappId: senderId,
            organizationId,
            status: InteractionStatus.ESCAPED,
            userMessage: text,
            botReply: reply,
            metadata: { stage: 'CONFIRMATION_REJECTED' },
          });
        } else {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const reply = MSGS.respuestaInvalidaSiNo();
          await this.sendWhatsAppMessage(senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.SESSION_EXPIRED,
            userMessage: text,
            botReply: reply,
            metadata: { invalidResponse: respuesta, stage: 'AWAITING_CONFIRMATION' },
          });
        }
        break;
      }

      case ChatState.AWAITING_CANCEL_CEDULA: {
        let cedula = '';
        if (aiData.cedula) {
          cedula = aiData.cedula;
        } else if (text) {
          const soloNumeros = text.replace(/\D/g, '');
          cedula = soloNumeros;
        }

        if (!cedula || cedula.length < 5) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const reply = MSGS.cancelarCedulaInvalida();
          await this.smartReply(organizationId, senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.PATIENT_NOT_FOUND,
            userMessage: text,
            botReply: reply,
            metadata: { stage: 'CANCEL_CEDULA_INVALID' },
          });
          return;
        }

        await this.redis.set(`temp_cancel_cedula:${organizationId}:${senderId}`, cedula, 'EX', SESSION_TTL);
        await this.handleCancelCedulaStep(organizationId, senderId, cedula);
        break;
      }

      case ChatState.AWAITING_CANCEL_SELECTION: {
        const letraElegida = text?.toUpperCase().trim() || '';
        const aptId = await this.redis.get(`temp_cancel_apt_${letraElegida}:${organizationId}:${senderId}`);
        const slotId = await this.redis.get(`temp_cancel_slot_${letraElegida}:${organizationId}:${senderId}`);

        if (!aptId || !slotId) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const maxLetra = await this.redis.get(`temp_cancel_max_letra:${organizationId}:${senderId}`) || 'A';
          const reply = `No reconozco esa opción. Por favor responda con una de las letras disponibles (A${maxLetra !== 'A' ? `–${maxLetra}` : ''}).`;
          await this.smartReply(organizationId, senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.SESSION_EXPIRED,
            userMessage: text,
            botReply: reply,
            metadata: { invalidLetter: letraElegida, stage: 'CANCEL_SELECTION' },
          });
          return;
        }

        await this.redis.set(`temp_selected_cancel_apt:${organizationId}:${senderId}`, aptId, 'EX', SESSION_TTL);
        await this.redis.set(`temp_selected_cancel_slot:${organizationId}:${senderId}`, slotId, 'EX', SESSION_TTL);

        const apt = await this.prisma.appointment.findUnique({
          where: { id: aptId },
          include: { scheduleSlot: { include: { doctor: true, service: true } } },
        });

        let reply = '';
        if (apt) {
          const fechaFormateada = new Date(apt.scheduleSlot.startTime).toLocaleString('es-CO', {
            weekday: 'long', day: 'numeric', month: 'long',
            hour: '2-digit', minute: '2-digit',
          });
          reply = MSGS.cancelarConfirmar(apt.scheduleSlot.service.name, apt.scheduleSlot.doctor.fullName, fechaFormateada);
          await this.smartReply(organizationId, senderId, reply);
        }
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_CONFIRM);

        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text,
          botReply: reply,
          metadata: {
            step: 'CANCEL_APPOINTMENT_SELECTED',
            appointmentId: aptId,
            slotId,
          },
        });
        break;
      }

      case ChatState.AWAITING_CANCEL_CONFIRM: {
        const respuesta = text?.toUpperCase().trim() || '';

        if (['SI', 'SÍ', 'SÍ.', 'SI.'].includes(respuesta)) {
          const aptId = await this.redis.get(`temp_selected_cancel_apt:${organizationId}:${senderId}`);
          const slotId = await this.redis.get(`temp_selected_cancel_slot:${organizationId}:${senderId}`);

          if (!aptId || !slotId) {
            const reply = MSGS.sesionExpirada();
            await this.smartReply(organizationId, senderId, reply);
            await this.cleanUpCancelSession(organizationId, senderId);

            await this.interactionLog.logFailure({
              whatsappId: senderId,
              organizationId,
              reason: FailureReason.SESSION_EXPIRED,
              userMessage: text,
              botReply: reply,
              metadata: { stage: 'CANCEL_CONFIRM_NO_DATA' },
            });
            return;
          }

          try {
            await this.prisma.$transaction([
              this.prisma.appointment.update({
                where: { id: aptId },
                data: { status: 'CANCELLED' },
              }),
              this.prisma.scheduleSlot.update({
                where: { id: slotId },
                data: { isAvailable: true },
              }),
            ]);

            const reply = MSGS.cancelarExitosa();
            await this.smartReply(organizationId, senderId, reply);

            // 📝 Auditoría: cancelación exitosa
            await this.interactionLog.logSuccess({
              whatsappId: senderId,
              organizationId,
              userMessage: text,
              botReply: reply,
              metadata: {
                event: 'APPOINTMENT_CANCELLED',
                appointmentId: aptId,
                slotId,
              },
            });

            const slot = await this.prisma.scheduleSlot.findUnique({
              where: { id: slotId },
              include: { doctor: true, service: true },
            });
            if (slot) {
              try {
                await this.waitlistService.notifyWaitlist({
                  slotId: slot.id,
                  serviceId: slot.serviceId,
                  epsId: slot.allowedEpsId,
                  organizationId: organizationId!,
                  doctorName: slot.doctor.fullName,
                  slotDate: slot.startTime,
                });
              } catch (e) {
                this.logger.error(`Error notificando waitlist: ${e.message}`);
              }
            }
          } catch (e) {
            this.logger.error('Error cancelando cita', e);
            const reply = MSGS.cancelarError();
            await this.smartReply(organizationId, senderId, reply);

            await this.interactionLog.logFailure({
              whatsappId: senderId,
              organizationId,
              reason: FailureReason.CANCEL_ERROR,
              userMessage: text,
              botReply: reply,
              metadata: { error: e.message, appointmentId: aptId },
            });
          }

          await this.cleanUpCancelSession(organizationId, senderId);

        } else if (['NO', 'NO.', 'CANCELAR'].includes(respuesta)) {
          const reply = MSGS.cancelarAbortada();
          await this.smartReply(organizationId, senderId, reply);
          await this.cleanUpCancelSession(organizationId, senderId);

          await this.interactionLog.log({
            whatsappId: senderId,
            organizationId,
            status: InteractionStatus.ESCAPED,
            userMessage: text,
            botReply: reply,
            metadata: { event: 'CANCELLATION_ABORTED' },
          });
        } else {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const reply = MSGS.respuestaInvalidaSiNo();
          await this.sendWhatsAppMessage(senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.SESSION_EXPIRED,
            userMessage: text,
            botReply: reply,
            metadata: { invalidResponse: respuesta, stage: 'CANCEL_CONFIRM' },
          });
        }
        break;
      }

      default:
        await this.cleanUpSession(organizationId, senderId);
        break;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // FLUJO DE CONFIRMACIÓN DE CUPO DE WAITLIST
  // ══════════════════════════════════════════════════════════════
  private async handleWaitlistConfirmStep(
    organizationId: string,
    senderId: string,
    text: string | undefined,
  ) {
    const respuesta = text?.toUpperCase().trim() || '';

    if (['SI', 'SÍ', 'SÍ.', 'SI.'].includes(respuesta)) {
      const { slotId, patientId } = await this.waitlistService.confirmFromWaitlist({
        whatsappId: senderId,
        organizationId,
        confirmed: true,
      });

      if (!slotId || !patientId) {
        const reply = MSGS.sesionExpirada();
        await this.smartReply(organizationId, senderId, reply);
        await this.cleanUpSession(organizationId, senderId);

        await this.interactionLog.logFailure({
          whatsappId: senderId,
          organizationId,
          reason: FailureReason.SESSION_EXPIRED,
          userMessage: text,
          botReply: reply,
          metadata: { stage: 'WAITLIST_CONFIRM_NO_DATA' },
        });
        return;
      }

      const patient = await this.prisma.patientProfile.findUnique({
        where: { id: patientId },
        include: { eps: true },
      });

      const bookingResult = await this.appointmentsService.bookAppointment(
        patientId,
        slotId,
        patient?.epsId || null,
        'WHATSAPP',
        organizationId,
      );

      if (bookingResult.success) {
        const slot = await this.prisma.scheduleSlot.findUnique({
          where: { id: slotId },
          include: { doctor: true, service: true },
        });
        const fechaFormateada = slot
          ? new Date(slot.startTime).toLocaleString('es-CO', {
            weekday: 'long', day: 'numeric', month: 'long',
            hour: '2-digit', minute: '2-digit',
          })
          : '';
        const orgInfo = await this.prisma.organization.findUnique({ where: { id: organizationId } });
        const reply = MSGS.citaConfirmada(orgInfo?.name || 'nuestra Clínica', fechaFormateada);
        await this.smartReply(organizationId, senderId, reply);

        // 📝 Auditoría: cita agendada desde waitlist
        if (slot && patient) {
          await this.interactionLog.logBookingConfirmed({
            whatsappId: senderId,
            organizationId,
            appointmentId: bookingResult.appointmentId || 'unknown',
            patientCedula: patient.cedula,
            serviceName: slot.service.name,
            doctorName: slot.doctor.fullName,
            slotDate: slot.startTime,
            epsName: patient.eps?.name,
            userMessage: text,
            botReply: reply,
          });
        }
      } else {
        const reply = MSGS.slotTomado();
        await this.smartReply(organizationId, senderId, reply);

        await this.interactionLog.logFailure({
          whatsappId: senderId,
          organizationId,
          reason: FailureReason.SLOT_TAKEN,
          userMessage: text,
          botReply: reply,
          metadata: { stage: 'WAITLIST_SLOT_TAKEN', slotId, patientId },
        });
      }

    } else if (['NO', 'NO.', 'CANCELAR'].includes(respuesta)) {
      await this.waitlistService.confirmFromWaitlist({
        whatsappId: senderId,
        organizationId,
        confirmed: false,
      });
      const reply = `Entendido. El cupo fue liberado. Sigue en nuestra lista de espera por si aparece otro. 😊`;
      await this.smartReply(organizationId, senderId, reply);

      await this.interactionLog.log({
        whatsappId: senderId,
        organizationId,
        status: InteractionStatus.ESCAPED,
        userMessage: text,
        botReply: reply,
        metadata: { event: 'WAITLIST_OFFER_REJECTED' },
      });
    } else {
      const reply = MSGS.respuestaInvalidaSiNo();
      await this.sendWhatsAppMessage(senderId, reply);

      await this.interactionLog.logFailure({
        whatsappId: senderId,
        organizationId,
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidResponse: respuesta, stage: 'WAITLIST_CONFIRM' },
      });
      return;
    }

    await this.cleanUpSession(organizationId, senderId);
  }

  // ══════════════════════════════════════════════════════════════
  // FLUJO DE BÚSQUEDA POR CÉDULA PARA CANCELACIÓN
  // ══════════════════════════════════════════════════════════════
  private async handleCancelCedulaStep(
    organizationId: string,
    senderId: string,
    cedula: string,
  ) {
    const patient = await this.prisma.patientProfile.findFirst({
      where: { cedula, organizationId },
    });

    if (!patient) {
      const reply = MSGS.cancelarPacienteNoExiste(cedula);
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(organizationId, senderId, ChatState.IDLE);

      await this.interactionLog.logFailure({
        whatsappId: senderId,
        organizationId,
        reason: FailureReason.PATIENT_NOT_FOUND,
        userMessage: cedula,
        botReply: reply,
        metadata: { searchedCedula: cedula },
      });
      return;
    }

    const activeAppointments = await this.prisma.appointment.findMany({
      where: {
        patientId: patient.id,
        status: 'SCHEDULED',
        scheduleSlot: { startTime: { gte: new Date() } },
      },
      include: {
        scheduleSlot: { include: { doctor: true, service: true } },
      },
      orderBy: { scheduleSlot: { startTime: 'asc' } },
    });

    if (activeAppointments.length === 0) {
      const reply = MSGS.cancelarSinCitas(cedula);
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(organizationId, senderId, ChatState.IDLE);

      await this.interactionLog.logFailure({
        whatsappId: senderId,
        organizationId,
        reason: FailureReason.NO_APPOINTMENTS_TO_CANCEL,
        userMessage: cedula,
        botReply: reply,
        metadata: { patientCedula: cedula, patientId: patient.id },
      });
      return;
    }

    if (activeAppointments.length === 1) {
      const apt = activeAppointments[0];
      await this.redis.set(`temp_selected_cancel_apt:${organizationId}:${senderId}`, apt.id, 'EX', SESSION_TTL);
      await this.redis.set(`temp_selected_cancel_slot:${organizationId}:${senderId}`, apt.scheduleSlotId, 'EX', SESSION_TTL);

      const fechaFormateada = new Date(apt.scheduleSlot.startTime).toLocaleString('es-CO', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit',
      });
      const reply = MSGS.cancelarConfirmar(apt.scheduleSlot.service.name, apt.scheduleSlot.doctor.fullName, fechaFormateada);
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_CONFIRM);

      await this.interactionLog.logSuccess({
        whatsappId: senderId,
        organizationId,
        userMessage: cedula,
        botReply: reply,
        metadata: {
          step: 'CANCEL_SHOWING_SINGLE',
          appointmentId: apt.id,
          patientCedula: cedula,
        },
      });
      return;
    }

    let lineas = '';
    activeAppointments.forEach((apt, idx) => {
      const letra = String.fromCharCode(65 + idx);
      this.redis.set(`temp_cancel_apt_${letra}:${organizationId}:${senderId}`, apt.id, 'EX', SESSION_TTL);
      this.redis.set(`temp_cancel_slot_${letra}:${organizationId}:${senderId}`, apt.scheduleSlotId, 'EX', SESSION_TTL);
      this.redis.set(`temp_cancel_max_letra:${organizationId}:${senderId}`, letra, 'EX', SESSION_TTL);
      const fecha = new Date(apt.scheduleSlot.startTime).toLocaleString('es-CO', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
      });
      lineas += `*${letra})* ${apt.scheduleSlot.service.name} · Dr. ${apt.scheduleSlot.doctor.fullName} · ${fecha}\n`;
    });

    const reply = MSGS.cancelarSeleccionar(patient.fullName, lineas);
    await this.smartReply(organizationId, senderId, reply);
    await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_SELECTION);

    await this.interactionLog.logSuccess({
      whatsappId: senderId,
      organizationId,
      userMessage: cedula,
      botReply: reply,
      metadata: {
        step: 'CANCEL_SHOWING_MULTIPLE',
        appointmentsCount: activeAppointments.length,
        patientCedula: cedula,
      },
    });
  }

  // ══════════════════════════════════════════════════════════════
  // INTERFAZ EXTERNA (OUTBOUND desde el Dashboard)
  // ══════════════════════════════════════════════════════════════
  async sendOutboundMessage(to: string, message: string): Promise<{ success: boolean; error?: string }> {
    try {
      const origin = await this.redis.get(`origin_phone:${to}`);
      if (!origin) {
        const errMsg = 'No hay tenant asociado para outbound message';
        this.logger.error(`${errMsg}: ${to}`);
        await this.interactionLog.logOutbound({
          whatsappId: to,
          botReply: message,
          success: false,
          error: errMsg,
        });
        return { success: false, error: errMsg };
      }
      const org = await this.prisma.organization.findFirst({
        where: { whatsappPhoneId: origin },
      });
      if (!org) {
        const errMsg = 'Organización no encontrada para outbound';
        this.logger.error(`${errMsg}: ${origin}`);
        await this.interactionLog.logOutbound({
          whatsappId: to,
          botReply: message,
          success: false,
          error: errMsg,
        });
        return { success: false, error: errMsg };
      }
      await this.smartReply(org.id, to, message);

      await this.interactionLog.logOutbound({
        whatsappId: to,
        organizationId: org.id,
        botReply: message,
        success: true,
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Error en sendOutboundMessage: ${error.message}`);
      await this.interactionLog.logOutbound({
        whatsappId: to,
        botReply: message,
        success: false,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // NOTIFICACIÓN PÚBLICA DE CUPO DISPONIBLE
  // ══════════════════════════════════════════════════════════════
  async notifyWaitlistCandidate(params: {
    whatsappId: string;
    organizationId: string;
    nombre: string;
    especialidad: string;
    doctor: string;
    slotDate: Date;
    slotId?: string;
    patientCedula?: string;
  }) {
    try {
      const { whatsappId, organizationId, nombre, especialidad, doctor, slotDate } = params;
      const fechaFormateada = slotDate.toLocaleString('es-CO', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit',
      });
      await this.setUserState(organizationId, whatsappId, ChatState.AWAITING_WAITLIST_CONFIRM);
      await this.redis.set(
        `is_ai_flow:${organizationId}:${whatsappId}`,
        'false',
        'EX',
        WAITLIST_CONFIRM_TTL,
      );
      const reply = MSGS.waitlistCupoDisponible(nombre, especialidad, fechaFormateada, doctor);
      await this.sendWhatsAppMessage(whatsappId, reply);

      // 📝 Auditoría: notificación de waitlist enviada
      await this.interactionLog.logWaitlistNotification({
        whatsappId,
        organizationId,
        patientCedula: params.patientCedula || 'unknown',
        slotId: params.slotId || 'unknown',
        doctorName: doctor,
        slotDate,
        botReply: reply,
      });
    } catch (error) {
      this.logger.error(`Error en notifyWaitlistCandidate: ${error.message}`);
    }
  }
}