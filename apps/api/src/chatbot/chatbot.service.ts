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
  // ══════════════════════════════════════════════════════════════
  private async sendWhatsAppMessage(toPhone: string, text: string) {
    const token = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneId = await this.getOriginPhoneId(toPhone);
    if (!phoneId) throw new Error('CRÍTICO: META_PHONE_ID no resuelto');

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
      return response.data;
    } catch (error) {
      this.logger.error(`Error enviando mensaje a ${toPhone}`, error.response?.data || error.message);
      throw error;
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
  // HELPER 3: DESCARGA Y PROCESAMIENTO DE AUDIO (WHATSAPP → GEMINI)
  // ══════════════════════════════════════════════════════════════
  private async downloadWhatsAppAudio(mediaId: string): Promise<Buffer> {
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
  private async generateTTS(text: string): Promise<Buffer> {
    const cleanText = text.replace(/[*_~`\[\]🎙️⏳✅❌📅👤⚕️⚠️🎉📝🔔😔😊🏥💳🪪]/g, '').trim();
    const request = {
      input: { text: cleanText },
      voice: { languageCode: 'es-US', name: 'es-US-Neural2-A' },
      audioConfig: { audioEncoding: 'OGG_OPUS' as const },
    };
    const [response] = await this.ttsClient.synthesizeSpeech(request);
    if (!response.audioContent) throw new Error('Google Cloud TTS no devolvió audio');
    return Buffer.from(response.audioContent);
  }

  private async uploadToWhatsApp(audioBuffer: Buffer, senderId: string): Promise<string> {
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
    if (!response.ok) throw new Error(`Error subiendo audio: ${JSON.stringify(data)}`);
    return data.id;
  }

  private async sendWhatsAppAudioMessage(toPhone: string, mediaId: string) {
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
  }

  private async smartReply(organizationId: string, senderId: string, text: string) {
    const isAiFlow =
      (await this.redis.get(`is_ai_flow:${organizationId}:${senderId}`)) === 'true';

    if (isAiFlow) {
      try {
        const audioBuffer = await this.generateTTS(text);
        const mediaId = await this.uploadToWhatsApp(audioBuffer, senderId);
        await this.sendWhatsAppAudioMessage(senderId, mediaId);
        await this.sendWhatsAppMessage(senderId, text);
        return;
      } catch (error) {
        this.logger.error('Error TTS, fallback a texto', error);
      }
    }
    await this.sendWhatsAppMessage(senderId, text);
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 5: LIMPIEZA DE SESIÓN
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
  // CORE: PROCESAMIENTO DE MENSAJES ENTRANTES
  // ══════════════════════════════════════════════════════════════
  async processIncomingMessage(event: any) {
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
          await this.sendWhatsAppMessage(
            senderId,
            'Esta línea clínica se encuentra inactiva temporalmente por mantenimiento administrativo.',
          );
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

    // ── CONTADOR DE REINTENTOS ─────────────────────────────────
    const retriesKey = `error_count:${organizationId}:${senderId}`;
    const retriesCount = parseInt((await this.redis.get(retriesKey)) || '0');

    if (retriesCount >= 3) {
      this.logger.warn(`Máximo de reintentos para ${senderId}`);
      await this.cleanUpSession(organizationId, senderId);
      const humanPhone = org?.supportPhone || '';
      if (humanPhone) {
        await this.smartReply(organizationId, senderId, MSGS.maxReintentos(humanPhone));
      } else {
        await this.smartReply(organizationId, senderId, MSGS.maxReintentosReset());
      }
      return;
    }

    // ── PASOS ESTRICTOS: SIN AUDIO ─────────────────────────────
    const isStrictStep =
      currentState === ChatState.AWAITING_DATE ||
      currentState === ChatState.AWAITING_CONFIRMATION ||
      currentState === ChatState.AWAITING_CANCEL_SELECTION ||
      currentState === ChatState.AWAITING_CANCEL_CONFIRM ||
      currentState === ChatState.AWAITING_WAITLIST_CONFIRM;

    const isAudio = messageType === 'audio' && !!audioId;

    if (isAudio && isStrictStep) {
      await this.sendWhatsAppMessage(senderId, MSGS.audioPasoEstricto());
      return;
    }

    // ── DETECCIÓN RÁPIDA SIN GEMINI ────────────────────────────
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
      try {
        const audioBuffer = await this.downloadWhatsAppAudio(audioId);
        aiData = await this.extractDataWithGemini(null, audioBuffer);
      } catch (e) {
        this.logger.error('Error descargando audio', e);
        aiData.ininteligible = true;
      }
    } else if (messageType === 'text' && text && !isStrictStep) {
      aiData = await this.extractDataWithGemini(text, null);
    }

    this.logger.log(`🧠 Gemini extrajo: ${JSON.stringify(aiData)}`);

    // ── GUARDS GLOBALES ────────────────────────────────────────

    // 0. IA CAÍDA
    if (aiData.isFallback) {
      await this.cleanUpSession(organizationId, senderId);
      const humanPhone = org?.supportPhone || '+573000000000';
      await this.smartReply(organizationId, senderId, MSGS.iaCaida(humanPhone));
      return;
    }

    // 0.5. CANCELACIÓN DE CITA (flujo omnicanal)
    if (aiData.isCancellation || isQuickCancel) {
      await this.cleanUpSession(organizationId, senderId);
      await this.redis.set(
        `is_ai_flow:${organizationId}:${senderId}`,
        isAudio ? 'true' : 'false',
        'EX',
        SESSION_TTL,
      );
      if (aiData.cedula) {
        await this.redis.set(`temp_cancel_cedula:${organizationId}:${senderId}`, aiData.cedula, 'EX', SESSION_TTL);
        await this.handleCancelCedulaStep(organizationId, senderId, aiData.cedula);
      } else {
        await this.smartReply(organizationId, senderId, MSGS.cancelarPedirCedula());
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_CEDULA);
      }
      return;
    }

    // 1. ESCAPE / REINICIO
    if (aiData.isEscape) {
      await this.cleanUpSession(organizationId, senderId);
      await this.smartReply(organizationId, senderId, MSGS.escape());
      return;
    }

    // 2. FUERA DE CONTEXTO
    if (aiData.outOfContext) {
      await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
      await this.smartReply(organizationId, senderId, MSGS.outOfContext());
      return;
    }

    // 3. ININTELIGIBLE
    if (aiData.ininteligible) {
      await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
      await this.smartReply(organizationId, senderId, MSGS.ininteligible());
      return;
    }

    // Limpiar reintentos si extracción fue exitosa
    if (aiData.cedula || aiData.especialidad || aiData.eps || aiData.doctor) {
      await this.redis.del(retriesKey);
    }

    // ── FLUJO DE CONFIRMACIÓN DE WAITLIST ──────────────────────
    // (tiene precedencia sobre el flujo normal si hay un cupo pendiente)
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

        await this.smartReply(
          organizationId,
          senderId,
          MSGS.bienvenida(orgName, serviciosText),
        );
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);
        return;
      }

      // Resolver especialidad a partir del doctor si aplica
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
          await this.smartReply(
            organizationId,
            senderId,
            `Lo siento, no encontré ningún médico con el nombre *"${finalDoctor}"* en nuestra institución.\n\n` +
            `Por favor indíqueme la especialidad deseada o el nombre correcto del médico.`,
          );
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);
          return;
        }
        if (doctores.length > 1) {
          let opciones = '';
          doctores.forEach((d, i) => {
            opciones += `*${i + 1}.* Dr. ${d.fullName} _(${d.service?.name})_\n`;
          });
          await this.redis.del(`temp_doctor:${organizationId}:${senderId}`);
          await this.smartReply(
            organizationId,
            senderId,
            `Encontré varios médicos con el nombre *"${finalDoctor}"*:\n\n${opciones}\nPor favor indíqueme el apellido completo o la especialidad.`,
          );
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);
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
        await this.smartReply(
          organizationId,
          senderId,
          MSGS.pedirCedula(finalDoctor || finalEspecialidadConDoctor || 'la especialidad solicitada'),
        );
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CEDULA);
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
          await this.smartReply(organizationId, senderId, MSGS.primeraVez());
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_NAME);
          return;
        }
      }

      const epsEfectiva = finalEps || dbPatientEpsName;

      // ── PASO 3: EPS ───────────────────────────────────────
      if (!epsEfectiva) {
        await this.smartReply(organizationId, senderId, MSGS.pedirEps());
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_EPS);
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
        await this.smartReply(organizationId, senderId, MSGS.epsNoEncontrada(epsEfectiva));
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_EPS);
        return;
      }

      if (!epsMatches[0].isActive) {
        await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
        await this.redis.del(`temp_eps_query:${organizationId}:${senderId}`);
        await this.smartReply(organizationId, senderId, MSGS.epsInactiva(epsMatches[0].name));
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_EPS);
        return;
      }

      const matchedEpsId = epsMatches[0].id;
      const matchedEpsName = epsMatches[0].name;
      await this.redis.set(`temp_eps_id:${organizationId}:${senderId}`, matchedEpsId, 'EX', SESSION_TTL);

      // ── BUSCAR SLOTS DISPONIBLES ──────────────────────────
      const slots = await this.appointmentsService.getAvailableSlots(
        finalEspecialidadConDoctor as string,
        matchedEpsId,
        organizationId!,
      );

      // ── SIN DISPONIBILIDAD → WAITLIST ─────────────────────
      if (slots.length === 0) {
        const nombrePaciente = finalNombre || patient?.fullName || 'paciente';

        // Obtener o crear el paciente para el ID
        let patientForWaitlist = patient;
        if (!patientForWaitlist) {
          // Crear usuario y paciente temporales
          const tempUser = await this.prisma.user.create({
            data: {
              email: `temp_${Date.now()}@paciente.local`,
              password: 'none',
              role: 'PATIENT',
            },
          });
          patientForWaitlist = await this.prisma.patientProfile.create({
            data: {
              cedula: finalCedula,
              fullName: finalNombre || 'Paciente',
              whatsappId: senderId,
              userId: tempUser.id,
              epsId: matchedEpsId,
              organizationId: organizationId!,
            },
          });
        }

        // Agregar a la lista de espera
        const serviceRecord = await this.prisma.medicalService.findFirst({
          where: {
            name: { contains: finalEspecialidadConDoctor as string, mode: 'insensitive' },
            organizationId: organizationId!,
          },
        });

        let position = 1;
        if (serviceRecord) {
          const result = await this.waitlistService.joinWaitlist({
            patientId: patientForWaitlist.id,
            serviceId: serviceRecord.id,
            epsId: matchedEpsId,
            whatsappId: senderId,
            organizationId: organizationId!,
          });
          position = result.position;
        }

        await this.smartReply(
          organizationId,
          senderId,
          MSGS.sinDisponibilidad(nombrePaciente, matchedEpsName, finalEspecialidadConDoctor as string, position),
        );

        // ✅ FIX CRÍTICO: limpiar estado para evitar loop infinito
        await this.cleanUpSession(organizationId, senderId);
        return;
      }

      // ── MOSTRAR CUPOS DISPONIBLES ─────────────────────────
      const nombrePaciente = finalNombre || patient?.fullName || '';
      let lineasFechas = '';
      for (let i = 0; i < slots.length; i++) {
        const letra = String.fromCharCode(65 + i);
        await this.redis.set(`temp_slot_${letra}:${senderId}`, slots[i].slotId, 'EX', SESSION_TTL);
        await this.redis.set(`temp_slot_${letra}_fecha:${senderId}`, slots[i].fecha.toISOString(), 'EX', SESSION_TTL);
        lineasFechas +=
          `*${letra})* ${slots[i].fecha.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })} ` +
          `a las ${slots[i].fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} ` +
          `· Dr. ${slots[i].doctor}\n`;
      }

      await this.smartReply(
        organizationId,
        senderId,
        MSGS.cuposDisponibles(nombrePaciente, matchedEpsName, lineasFechas),
      );
      await this.setUserState(organizationId, senderId, ChatState.AWAITING_DATE);
      return;
    }

    // ══════════════════════════════════════════════════════════
    // MÁQUINA DE ESTADOS — PASOS ESTRICTOS Y FLUJOS DE CANCELACIÓN
    // ══════════════════════════════════════════════════════════
    switch (currentState) {

      // ── SELECCIÓN DE FECHA ─────────────────────────────────
      case ChatState.AWAITING_DATE: {
        const letraElegida = text?.toUpperCase().trim() || '';
        const slotId = await this.redis.get(`temp_slot_${letraElegida}:${senderId}`);
        const slotFechaStr = await this.redis.get(`temp_slot_${letraElegida}_fecha:${senderId}`);

        if (!slotId || !slotFechaStr) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          await this.smartReply(organizationId, senderId, MSGS.errorSlotInvalido());
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

        await this.sendWhatsAppMessage(
          senderId,
          MSGS.resumenCita(nombreAgend, cedulaAgend || '', epsAgend, specAgend, fechaFormateada),
        );
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CONFIRMATION);
        break;
      }

      // ── CONFIRMACIÓN FINAL DE CITA ─────────────────────────
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
            await this.smartReply(organizationId, senderId, MSGS.sesionExpirada());
            await this.cleanUpSession(organizationId, senderId);
            return;
          }

          let patient = await this.prisma.patientProfile.findUnique({ where: { cedula: cedulaFinal } });

          if (!patient) {
            const tempUser = await this.prisma.user.create({
              data: {
                email: `temp_${Date.now()}@paciente.local`,
                password: 'none',
                role: 'PATIENT',
              },
            });
            patient = await this.prisma.patientProfile.create({
              data: {
                cedula: cedulaFinal,
                fullName: nombreFinal || 'Paciente Registrado',
                whatsappId: senderId,
                userId: tempUser.id,
                epsId: epsIdFinal || null,
                organizationId: organizationId!,
              },
            });
          } else if (epsIdFinal && patient.epsId !== epsIdFinal) {
            patient = await this.prisma.patientProfile.update({
              where: { id: patient.id },
              data: { epsId: epsIdFinal },
            });
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
            await this.smartReply(organizationId, senderId, MSGS.citaConfirmada(orgName, fechaFormateada));
          } else {
            await this.smartReply(organizationId, senderId, MSGS.slotTomado());
            // Volver a AWAITING_DATE para que elija otro slot
            await this.setUserState(organizationId, senderId, ChatState.AWAITING_DATE);
            return;
          }

          await this.cleanUpSession(organizationId, senderId);

        } else if (['NO', 'NO.', 'CANCELAR'].includes(respuesta)) {
          await this.smartReply(organizationId, senderId, MSGS.citaNoConfirmada());
          await this.cleanUpSession(organizationId, senderId);
        } else {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          await this.sendWhatsAppMessage(senderId, MSGS.respuestaInvalidaSiNo());
        }
        break;
      }

      // ── CANCELACIÓN: PEDIR CÉDULA ──────────────────────────
      case ChatState.AWAITING_CANCEL_CEDULA: {
        // Extraer cédula del texto o del aiData (si vino de audio)
        let cedula = '';
        if (aiData.cedula) {
          cedula = aiData.cedula;
        } else if (text) {
          // ✅ FIX: validar que sea numérico antes de consultar BD
          const soloNumeros = text.replace(/\D/g, '');
          cedula = soloNumeros;
        }

        if (!cedula || cedula.length < 5) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          await this.smartReply(organizationId, senderId, MSGS.cancelarCedulaInvalida());
          return;
        }

        await this.redis.set(`temp_cancel_cedula:${organizationId}:${senderId}`, cedula, 'EX', SESSION_TTL);
        await this.handleCancelCedulaStep(organizationId, senderId, cedula);
        break;
      }

      // ── CANCELACIÓN: SELECCIONAR CITA ─────────────────────
      case ChatState.AWAITING_CANCEL_SELECTION: {
        const letraElegida = text?.toUpperCase().trim() || '';
        const aptId = await this.redis.get(`temp_cancel_apt_${letraElegida}:${organizationId}:${senderId}`);
        const slotId = await this.redis.get(`temp_cancel_slot_${letraElegida}:${organizationId}:${senderId}`);

        if (!aptId || !slotId) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const maxLetra = await this.redis.get(`temp_cancel_max_letra:${organizationId}:${senderId}`) || 'A';
          await this.smartReply(
            organizationId,
            senderId,
            `No reconozco esa opción. Por favor responda con una de las letras disponibles (A${maxLetra !== 'A' ? `–${maxLetra}` : ''}).`,
          );
          return;
        }

        await this.redis.set(`temp_selected_cancel_apt:${organizationId}:${senderId}`, aptId, 'EX', SESSION_TTL);
        await this.redis.set(`temp_selected_cancel_slot:${organizationId}:${senderId}`, slotId, 'EX', SESSION_TTL);

        const apt = await this.prisma.appointment.findUnique({
          where: { id: aptId },
          include: { scheduleSlot: { include: { doctor: true, service: true } } },
        });

        if (apt) {
          const fechaFormateada = new Date(apt.scheduleSlot.startTime).toLocaleString('es-CO', {
            weekday: 'long', day: 'numeric', month: 'long',
            hour: '2-digit', minute: '2-digit',
          });
          await this.smartReply(
            organizationId,
            senderId,
            MSGS.cancelarConfirmar(apt.scheduleSlot.service.name, apt.scheduleSlot.doctor.fullName, fechaFormateada),
          );
        }
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_CONFIRM);
        break;
      }

      // ── CANCELACIÓN: CONFIRMACIÓN FINAL ───────────────────
      case ChatState.AWAITING_CANCEL_CONFIRM: {
        const respuesta = text?.toUpperCase().trim() || '';

        if (['SI', 'SÍ', 'SÍ.', 'SI.'].includes(respuesta)) {
          const aptId = await this.redis.get(`temp_selected_cancel_apt:${organizationId}:${senderId}`);
          const slotId = await this.redis.get(`temp_selected_cancel_slot:${organizationId}:${senderId}`);

          if (!aptId || !slotId) {
            await this.smartReply(organizationId, senderId, MSGS.sesionExpirada());
            await this.cleanUpCancelSession(organizationId, senderId);
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

            await this.smartReply(organizationId, senderId, MSGS.cancelarExitosa());

            // ✅ Notificar a la waitlist que hay un slot libre
            const slot = await this.prisma.scheduleSlot.findUnique({
              where: { id: slotId },
              include: { doctor: true, service: true },
            });
            if (slot) {
              await this.waitlistService.notifyWaitlist({
                slotId: slot.id,
                serviceId: slot.serviceId,
                epsId: slot.allowedEpsId,
                organizationId: organizationId!,
                doctorName: slot.doctor.fullName,
                slotDate: slot.startTime,
              });
            }
          } catch (e) {
            this.logger.error('Error cancelando cita', e);
            await this.smartReply(organizationId, senderId, MSGS.cancelarError());
          }

          await this.cleanUpCancelSession(organizationId, senderId);

        } else if (['NO', 'NO.', 'CANCELAR'].includes(respuesta)) {
          await this.smartReply(organizationId, senderId, MSGS.cancelarAbortada());
          await this.cleanUpCancelSession(organizationId, senderId);
        } else {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          await this.sendWhatsAppMessage(senderId, MSGS.respuestaInvalidaSiNo());
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
        await this.smartReply(organizationId, senderId, MSGS.sesionExpirada());
        await this.cleanUpSession(organizationId, senderId);
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
        const slot = await this.prisma.scheduleSlot.findUnique({ where: { id: slotId } });
        const fechaFormateada = slot
          ? new Date(slot.startTime).toLocaleString('es-CO', {
            weekday: 'long', day: 'numeric', month: 'long',
            hour: '2-digit', minute: '2-digit',
          })
          : '';
        const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
        await this.smartReply(
          organizationId,
          senderId,
          MSGS.citaConfirmada(org?.name || 'nuestra Clínica', fechaFormateada),
        );
      } else {
        // El cupo fue tomado por otro paciente entre el aviso y la confirmación
        await this.smartReply(organizationId, senderId, MSGS.slotTomado());
      }

    } else if (['NO', 'NO.', 'CANCELAR'].includes(respuesta)) {
      await this.waitlistService.confirmFromWaitlist({
        whatsappId: senderId,
        organizationId,
        confirmed: false,
      });
      await this.smartReply(
        organizationId,
        senderId,
        `Entendido. El cupo fue liberado. Sigue en nuestra lista de espera por si aparece otro. 😊`,
      );
    } else {
      await this.sendWhatsAppMessage(senderId, MSGS.respuestaInvalidaSiNo());
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
      await this.smartReply(organizationId, senderId, MSGS.cancelarPacienteNoExiste(cedula));
      await this.setUserState(organizationId, senderId, ChatState.IDLE);
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
      await this.smartReply(organizationId, senderId, MSGS.cancelarSinCitas(cedula));
      await this.setUserState(organizationId, senderId, ChatState.IDLE);
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
      await this.smartReply(
        organizationId,
        senderId,
        MSGS.cancelarConfirmar(apt.scheduleSlot.service.name, apt.scheduleSlot.doctor.fullName, fechaFormateada),
      );
      await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_CONFIRM);
      return;
    }

    // Múltiples citas: listar opciones
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

    await this.smartReply(
      organizationId,
      senderId,
      MSGS.cancelarSeleccionar(patient.fullName, lineas),
    );
    await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_SELECTION);
  }

  // ══════════════════════════════════════════════════════════════
  // INTERFAZ EXTERNA (OUTBOUND desde el Dashboard)
  // ══════════════════════════════════════════════════════════════
  async sendOutboundMessage(to: string, message: string) {
    const origin = await this.redis.get(`origin_phone:${to}`);
    if (!origin) throw new Error('No hay tenant asociado para outbound message');
    const org = await this.prisma.organization.findFirst({
      where: { whatsappPhoneId: origin },
    });
    if (!org) throw new Error('Organización no encontrada para outbound');
    await this.smartReply(org.id, to, message);
  }

  // ══════════════════════════════════════════════════════════════
  // NOTIFICACIÓN PÚBLICA DE CUPO DISPONIBLE (llamado por WaitlistService)
  // ══════════════════════════════════════════════════════════════
  async notifyWaitlistCandidate(params: {
    whatsappId: string;
    organizationId: string;
    nombre: string;
    especialidad: string;
    doctor: string;
    slotDate: Date;
  }) {
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
    await this.sendWhatsAppMessage(
      whatsappId,
      MSGS.waitlistCupoDisponible(nombre, especialidad, fechaFormateada, doctor),
    );
  }
}