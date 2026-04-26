// @ts-nocheck
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import { ChatState, SESSION_TTL } from './chatbot.constants';
import { AppointmentsService } from 'src/appointments/appointments.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import textToSpeech from '@google-cloud/text-to-speech'; // 🛑 NUEVO: Importación oficial de Google TTS

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly ttsClient = new textToSpeech.TextToSpeechClient(); // 🛑 NUEVO: Cliente de Google Cloud TTS

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private httpService: HttpService,
    private redis: RedisService,
    private appointmentsService: AppointmentsService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        '⚠️ GEMINI_API_KEY no definida. Las funciones de audio fallarán.',
      );
    }
    this.genAI = new GoogleGenerativeAI(apiKey || 'dummy');
  }

  // ==========================================
  // HELPER 0: RUTEADOR DE TENANT (MULTI-TENANT)
  // ==========================================
  private async getOriginPhoneId(senderId: string): Promise<string> {
    const origin = await this.redis.get(`origin_phone:${senderId}`);
    return origin || this.configService.get<string>('META_PHONE_ID') || '';
  }

  // ==========================================
  // HELPER 1: COMUNICACIÓN OUTBOUND (META API)
  // ==========================================
  private async sendWhatsAppMessage(toPhone: string, text: string) {
    const token = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneId = await this.getOriginPhoneId(toPhone);

    if (!phoneId) {
      throw new Error(
        'CRÍTICO: META_PHONE_ID o phoneId no resuelto',
      );
    }
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
      const response = await lastValueFrom(
        this.httpService.post(url, data, { headers }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Error enviando mensaje a ${toPhone}`,
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  // ==========================================
  // HELPER 2: LECTURA/ESCRITURA DE ESTADO (REDIS)
  // ==========================================
  private async getUserState(organizationId: string, phoneId: string): Promise<ChatState> {
    const state = await this.redis.get(`chat_state:${organizationId}:${phoneId}`);
    return (state as ChatState) || ChatState.IDLE;
  }

  private async setUserState(organizationId: string, phoneId: string, state: ChatState) {
    await this.redis.set(`chat_state:${organizationId}:${phoneId}`, state, 'EX', SESSION_TTL);
  }

  // ==========================================
  // HELPER 3: IA Y MULTIMEDIA
  // ==========================================
  private async downloadWhatsAppAudio(mediaId: string): Promise<Buffer> {
    const token = this.configService.get<string>('META_ACCESS_TOKEN');

    const urlReq = `https://graph.facebook.com/v19.0/${mediaId}`;
    const urlResponse = await lastValueFrom(
      this.httpService.get(urlReq, {
        headers: { Authorization: `Bearer ${token}` },
      }),
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
        Eres un asistente médico hiper-empático en el Hospital San Vicente (Colombia) que analiza las solicitudes de agendamiento de pacientes. 
        Analiza el texto o el audio provisto.
        
        REGLA DE CANCELACIÓN: Si el usuario expresa explícitamente que desea "cancelar una cita", "anular cita", o "suspender mi cita", pon "isCancellation" en true.
        REGLA DE ESCAPE: Si el usuario desea interrumpir el flujo actual, volver atrás, reiniciar (Ej: "me equivoqué", "salir", "volver"), pon "isEscape" en true. (Nota: Si dice "cancelar cita", eso es isCancellation, NO isEscape). SALUDOS inofensivos como "Hola" no son escape ni outOfContext.
        REGLA DE FUERA DE CONTEXTO: Si el paciente dice groserías o temas sin sentido médico, pon "outOfContext" en true. 
        REGLA DE RUIDO Y SILENCIO: Si es un audio vacío, inentendible o solo hay ruido sin intención clara, pon "ininteligible" en true.

        Extrae la siguiente información y devuélvela ÚNICAMENTE en JSON válido sin envolturas de código (\`\`\`json):
        {
            "cedula": "Número sin puntos (Ej: 1088123456). Si no menciona, null.",
            "nombre": "Nombre completo de la persona que habla (Ej: Juan Perez). Si no menciona, null.",
            "eps": "El nombre de su EPS o aseguradora. Si no menciona, null.",
            "especialidad": "Normaliza a la especialidad médica solicitada. Si no la menciona, null.",
            "doctor": "Nombre del médico si pide cita con uno en específico. Si no menciona, null.",
            "isEscape": false,
            "outOfContext": false,
            "ininteligible": false,
            "isCancellation": false
        }`;

    const parts: any[] = [prompt];
    if (text) {
      parts.push(`Texto del usuario: "${text}"`);
    }

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

      const cleanedText = responseText
        .replace(/```json/g, '')
        .replace(/```/g, '');

      const parsed = JSON.parse(cleanedText);
      parsed.isFallback = false;
      return parsed;
    } catch (e) {
      this.logger.error('Error procesando IA con Gemini', e);
      return {
        cedula: null,
        nombre: null,
        eps: null,
        especialidad: null,
        doctor: null,
        isEscape: false,
        outOfContext: false,
        ininteligible: false,
        isFallback: true, 
        isCancellation: false,
      };
    }
  }

  // ==========================================
  // HELPER 4: TEXT-TO-SPEECH Y SMART REPLY (NUEVO)
  // ==========================================
  private async generateTTS(text: string): Promise<Buffer> {
    this.logger.log(
      '🎙️ Generando voz con Google Cloud TTS (Acento Colombiano)...',
    );
    const cleanText = text.replace(/[\*🎙️⏳✅❌📅👤⚕️⚠️🎉📝]/g, '').trim();

    const request = {
      input: { text: cleanText },
      voice: { languageCode: 'es-US', name: 'es-US-Neural2-A' },
      audioConfig: { audioEncoding: 'OGG_OPUS' as const },
    };

    try {
      const [response] = await this.ttsClient.synthesizeSpeech(request);
      if (!response.audioContent) {
        throw new Error('Google Cloud no devolvió contenido de audio');
      }
      return Buffer.from(response.audioContent);
    } catch (error) {
      this.logger.error('Error crítico en Google TTS:', error);
      throw error;
    }
  }

  private async uploadToWhatsApp(audioBuffer: Buffer, senderId: string): Promise<string> {
    const token = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneId = await this.getOriginPhoneId(senderId);

    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/ogg' });
    formData.append('file', blob, 'audio.ogg');

    const response = await fetch(
      `https://graph.facebook.com/v19.0/${phoneId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      },
    );

    const data = await response.json();
    if (!response.ok)
      throw new Error(
        `Error subiendo media a WhatsApp: ${JSON.stringify(data)}`,
      );
    return data.id;
  }

  private async sendWhatsAppAudioMessage(toPhone: string, mediaId: string) {
    const token = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneId = await this.getOriginPhoneId(toPhone);
    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

    const data = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type: 'audio',
      audio: { id: mediaId },
    };

    await lastValueFrom(
      this.httpService.post(url, data, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }),
    );
  }

  private async smartReply(organizationId: string, senderId: string, text: string) {
    const isAiFlow =
      (await this.redis.get(`is_ai_flow:${organizationId}:${senderId}`)) === 'true';

    if (isAiFlow) {
      try {
        this.logger.log(`🎙️ Respondiendo con nota de voz a ${senderId}...`);
        const audioBuffer = await this.generateTTS(text);
        const mediaId = await this.uploadToWhatsApp(audioBuffer, senderId);
        await this.sendWhatsAppAudioMessage(senderId, mediaId);

        // Opcional: Enviamos el texto de respaldo por si no pueden escuchar el audio
        await this.sendWhatsAppMessage(senderId, text);
        return;
      } catch (error) {
        this.logger.error(
          'Error enviando voz, haciendo fallback automático a texto',
          error,
        );
      }
    }

    // Si la IA no está activada o falló el TTS, enviamos texto puro
    await this.sendWhatsAppMessage(senderId, text);
  }

  // ==========================================
  // CORE: MÁQUINA DE ESTADOS (INBOUND)
  // ==========================================
  async processIncomingMessage(event: any) {
    const senderId = event.from || event.sender?.id;
    const messageType = event.type;
    const text = event.text?.body?.trim() || event.message?.text?.trim();
    const audioId = event.audio?.id;

    // 🏢 MULTI-TENANT: IDENTIFICACIÓN DEL TENANT VÍA METADATA
    const metaPhoneId = event.metadata?.phone_number_id || this.configService.get<string>('META_PHONE_ID');
    let organizationId: string | null = null;
    let fallbackOrgInfo = '';

    if (metaPhoneId) {
      await this.redis.set(`origin_phone:${senderId}`, metaPhoneId, 'EX', SESSION_TTL);
      const org = await this.prisma.organization.findUnique({
        // @ts-ignore: Prisma cache invalidation error in monorepo
        where: { whatsappPhoneId: metaPhoneId }
      });
      if (org) {
        if (!org.isActive) {
          await this.sendWhatsAppMessage(senderId, "Esta línea clínica se encuentra inactiva temporalmente por mantenimiento administrativo.");
          return;
        }
        organizationId = org.id;
        fallbackOrgInfo = org.name;
      }
    }

    // Si no logramos identificar el Tenant, usamos uno global o rechazamos
    if (!organizationId) {
       this.logger.warn(`No se pudo identificar el Tenant para el número asociado: ${metaPhoneId}`);
       // Fallback temporal si no hay mapeo estricto configurado en la DB
       const firstOrg = await this.prisma.organization.findFirst();
       if (firstOrg) organizationId = firstOrg.id;
    }

    if (messageType !== 'text' && messageType !== 'audio') {
      return;
    }

    const currentState = await this.getUserState(organizationId, senderId);
    this.logger.log(`[Tenant: ${organizationId}] Usuario ${senderId} en estado: ${currentState}. Tipo: ${messageType}`);

    // Contador de reintentos
    const retriesKey = `error_count:${organizationId}:${senderId}`;
    let retriesCount = parseInt((await this.redis.get(retriesKey)) || '0');

    if (retriesCount >= 3) {
      this.logger.warn(`Máximo de reintentos alcanzado para ${senderId}`);
      await this.cleanUpUserCounters(organizationId, senderId);

      const humanAgentPhone = (org as any)?.supportPhone || '+573000000000';

      if (!humanAgentPhone || humanAgentPhone === 'NO') {
        const resetMessage = "Entiendo que estamos teniendo algunas dificultades para comunicarnos claramente. Por seguridad, he reiniciado la sesión. ¡Cuando desee empezar de nuevo solo escríbame 'Hola'!";
        await this.smartReply(organizationId, senderId, resetMessage);
      } else {
        const handoffMessage = `Entiendo que estamos teniendo algunas dificultades. Por favor, comuníquese directamente con uno de nuestros asesores para ayudarle a programar su cita a través del siguiente enlace:\n\n👉 https://wa.me/${humanAgentPhone}`;
        await this.smartReply(organizationId, senderId, handoffMessage);
      }
      return;
    }

    const isStrictStep = currentState === ChatState.AWAITING_DATE || currentState === ChatState.AWAITING_CONFIRMATION || currentState === ChatState.AWAITING_CANCEL_SELECTION || currentState === ChatState.AWAITING_CANCEL_CONFIRM;
    const isAudio = messageType === 'audio' && !!audioId;

    if (isAudio && isStrictStep) {
      await this.sendWhatsAppMessage(senderId, '🎙️ Para este paso, por favor responda en texto (la letra o la palabra SÍ/NO) para evitar errores.');
      return;
    }

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
        isCancellation: false
    };

    const isQuickCancel = messageType === 'text' && text && /^(cancelar cita|anular cita|quiero cancelar|necesito cancelar)/i.test(text.trim());
    const isQuickEscape = messageType === 'text' && text && /^(hola|salir|reiniciar|volver|me equivoque|me equivoqué|otra cita|cambiar|no quiero|detener|menu|menú)$/i.test(text.trim());

    if ((isQuickCancel || (text && text.trim().toLowerCase() === 'cancelar')) && currentState === ChatState.IDLE) {
       aiData.isCancellation = true;
    } else if (isQuickEscape && currentState !== ChatState.IDLE) {
       aiData.isEscape = true;
    } else if (text && text.trim().toLowerCase() === 'cancelar' && currentState !== ChatState.IDLE) {
       aiData.isEscape = true;
    } else if (isQuickEscape && currentState === ChatState.IDLE && text.trim().toLowerCase() === 'hola') {
       // initial greeting, no NLP needed
    } else if (isAudio) {
      await this.redis.set(`is_ai_flow:${organizationId}:${senderId}`, 'true', 'EX', SESSION_TTL);
      await this.sendWhatsAppMessage(senderId, '🎧 Permítame un momento por favor, lo estoy escuchando atentamente...');
      try {
        const audioBuffer = await this.downloadWhatsAppAudio(audioId);
        aiData = await this.extractDataWithGemini(null, audioBuffer);
      } catch (e) {
        this.logger.error('Error audio', e);
        aiData.ininteligible = true;
      }
    } else if (messageType === 'text' && text && !isStrictStep) {
      aiData = await this.extractDataWithGemini(text, null);
    }

    this.logger.log(`🧠 Gemini extrajo: ${JSON.stringify(aiData)}`);

    // 🛑 0. FALLBACK DE IA (CAÍDA O LÍMITES)
    if (aiData.isFallback) {
      await this.cleanUpUserCounters(organizationId, senderId);
      const humanAgentPhone = (org as any)?.supportPhone || '+573000000000' || 'nuestro contact center';
      const phoneLink = humanAgentPhone !== 'nuestro contact center' ? `👉 https://wa.me/${humanAgentPhone}` : '';
      await this.smartReply(organizationId, senderId, `⚠️ Nuestro sistema de inteligencia artificial está en mantenimiento.\nPor favor comuníquese al teléfono ${humanAgentPhone} para ese efecto.\n${phoneLink}`);
      return;
    }

    // 🛑 0.5 CANCELACIÓN OMNICANAL DE CITAS
    if (aiData.isCancellation || isQuickCancel) {
      this.logger.log(`Iniciando flujo de Cancelación para ${senderId}`);
      await this.cleanUpUserCounters(organizationId, senderId);
      await this.redis.set(`is_ai_flow:${organizationId}:${senderId}`, isAudio ? 'true' : 'false', 'EX', SESSION_TTL);
      
      if (aiData.cedula) {
         await this.redis.set(`temp_cancel_cedula:${organizationId}:${senderId}`, aiData.cedula, 'EX', SESSION_TTL);
         await this.handleCancelCedulaStep(organizationId, senderId, aiData.cedula);
         return;
      } else {
         await this.smartReply(organizationId, senderId, "Entiendo que desea cancelar una cita existente.\nPara poder buscarla en nuestro sistema, por favor indíqueme o escríbame el *número de cédula* del paciente a cancelar.");
         await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_CEDULA);
         return;
      }
    }

    // 🛑 1. ESCAPE O REINICIO
    if (aiData.isEscape) {
      await this.redis.del(retriesKey);
      await this.redis.del(`is_ai_flow:${organizationId}:${senderId}`);
      await this.setUserState(organizationId, senderId, ChatState.IDLE);
      await this.smartReply(organizationId, senderId, "✅ Entendido. He cancelado lo que estábamos haciendo. ¡No hay problema!\n\n¿En qué más le puedo ayudar el día de hoy?");
      return;
    }

    // 🛑 2. FUERA DE CONTEXTO
    if (aiData.outOfContext) {
      await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
      await this.smartReply(organizationId, senderId, "Soy un asistente exclusivo para agendamiento médico integral en el Hospital San Vicente. Por favor, vuelva a indicarme su solicitud relacionada con citas, o especifique la especialidad que busca.");
      return;
    }

    // 🛑 3. ININTELIGIBLE O AUDIO VACÍO
    if (aiData.ininteligible) {
      await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
      await this.smartReply(organizationId, senderId, "🎙️ Disculpe, había mucho ruido de fondo o no entendí el mensaje claramente. ¿Podría volver a intentar de forma un poco más pausada o escribirme texto?");
      return;
    }

    // Reestablecemos reintentos si hubo éxito de extracción parcial
    if (aiData.cedula || aiData.especialidad || aiData.eps || aiData.doctor) {
      await this.redis.del(retriesKey);
    }

    // ========================================================
    // MEMORIA A CORTO PLAZO E INFERENCIA DE CASCADA
    // ========================================================
    const savedCedula = await this.redis.get(`temp_cedula:${organizationId}:${senderId}`);
    const savedNombre = await this.redis.get(`temp_nombre:${organizationId}:${senderId}`);
    const savedEspecialidad = await this.redis.get(`temp_especialidad:${organizationId}:${senderId}`);
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

    const isCancelFlow = currentState === ChatState.AWAITING_CANCEL_CEDULA || 
                         currentState === ChatState.AWAITING_CANCEL_SELECTION || 
                         currentState === ChatState.AWAITING_CANCEL_CONFIRM;

    if (!isStrictStep && !isCancelFlow) {
      // --- PASO 1: ESPECIALIDAD O MÉDICO ---
      if (!finalEspecialidad && !finalDoctor) {
         if (currentState === ChatState.IDLE) {
           const activeServices = await this.prisma.medicalService.findMany({
             where: { isActive: true, organizationId }, select: { name: true }, orderBy: { name: 'asc' }
           });
           let servicesText = "(Ej: Medicina General o Odontología)";
           if (activeServices.length > 0) {
             servicesText = `(Opciones: ${activeServices.map(s => s.name).join(', ')})`;
           }
           await this.smartReply(organizationId, senderId, `👋 ¡Hola! Bienvenido al sistema de agendamiento de ${fallbackOrgInfo || 'nuestra Clínica'}.\n\nPuedo ayudarle con la asignación de citas médicas. Por favor, *escríbame la especialidad* que desea ${servicesText} o el nombre del *médico*.`);
           await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);
         } else {
           await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
           await this.smartReply(organizationId, senderId, "¿Para qué especialidad médica necesita su cita? o ¿Con qué médico?");
           await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);
         }
         return;
      }

      let finalEspecialidadConDoctor = finalEspecialidad;
      if (finalDoctor && !finalEspecialidad) {
        const doctores = await this.prisma.doctorProfile.findMany({
          where: { fullName: { contains: finalDoctor, mode: 'insensitive' }, isActive: true, organizationId },
          include: { service: true }
        });
        
        if (doctores.length === 0) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          await this.redis.del(`temp_doctor:${organizationId}:${senderId}`);
          await this.smartReply(organizationId, senderId, `Lo siento, no reconozco a ningún médico con el nombre "${finalDoctor}" laborando en nuestra institución actualmente. Por favor indíqueme nuevamente la especialidad deseada u otro médico.`);
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);
          return;
        } else if (doctores.length > 1) {
          let opciones = '';
          doctores.forEach((d, i) => opciones += `${i+1}. Dr. ${d.fullName} (${d.service?.name})\n`);
          await this.redis.del(`temp_doctor:${organizationId}:${senderId}`);
          await this.smartReply(organizationId, senderId, `He encontrado varios médicos coincidiendo con "${finalDoctor}". Por favor indíqueme el apellido o la especialidad para ser más precisos:\n\n${opciones}`);
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);
          return;
        } else {
          finalEspecialidadConDoctor = doctores[0].service?.name || finalEspecialidad;
          if (finalEspecialidadConDoctor) {
            await this.redis.set(`temp_especialidad:${organizationId}:${senderId}`, finalEspecialidadConDoctor, 'EX', SESSION_TTL);
          }
        }
      }

      // --- PASO 2: IDENTIDAD (CEDULA) ---
      if (!finalCedula) {
         await this.smartReply(organizationId, senderId, `Entendí que busca cita para *${finalDoctor || finalEspecialidadConDoctor}*. Por favor, ¿me puede decir o escribir su *número de cédula*?`);
         await this.setUserState(organizationId, senderId, ChatState.AWAITING_CEDULA);
         return;
      }

      let dbPatientContextEpsId: string | null = null;
      let dbPatientContextEpsName: string | null = null;
      const patient = await this.prisma.patientProfile.findUnique({
         where: { cedula: finalCedula }, include: { eps: true }
      });

      // Aseguramos que el paciente, de existir, se asocie o se restrinja al Tenant.
      // (Si no pertenece a la organización, la API actual podría migrarlo implícitamente o rechazarlo, 
      // pero para evitar fugas solo le permitimos agendar si organizationId mathcea o es null).

      if (patient) {
         if (!finalNombre) {
            await this.redis.set(`temp_nombre:${organizationId}:${senderId}`, patient.fullName, 'EX', SESSION_TTL);
         }
         if (patient.eps) {
            dbPatientContextEpsId = patient.epsId;
            dbPatientContextEpsName = patient.eps.name;
         }
      } else {
         if (!finalNombre) {
            await this.smartReply(organizationId, senderId, `Tengo registrada su solicitud para la cédula *${finalCedula}*.\n\n👤 Como es su primera vez solicitando citas con nosotros, por favor indíqueme su *nombre completo*.`);
            await this.setUserState(organizationId, senderId, ChatState.AWAITING_NAME);
            return;
         }
      }

      const epsEfectiva = finalEps || dbPatientContextEpsName;

      // --- PASO 3: ASEGURADORA (EPS) ---
      if (!epsEfectiva) {
         await this.smartReply(organizationId, senderId, `Para verificar la disponibilidad de agenda, *por favor indíqueme el nombre de su EPS o Aseguradora* a la que se encuentra afiliado.\n(Si desea pagar por el servicio, diga "Particular").`);
         await this.setUserState(organizationId, senderId, ChatState.AWAITING_EPS);
         return;
      }

      const epsMatches = await this.prisma.eps.findMany({
        where: { name: { contains: epsEfectiva, mode: 'insensitive' }, organizationId: organizationId! }
      });

      if (epsMatches.length === 0 || !epsMatches[0].isActive) {
         await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
         await this.redis.del(`temp_eps_query:${organizationId}:${senderId}`);
         const noConvenioText = epsMatches.length === 0 
           ? `Lamentablemente no he podido identificar la EPS "${epsEfectiva}" o está mal escrita. Por favor inténtelo nuevamente escribiendo el nombre correctamente.` 
           : `Lo siento, pero en este momento no préstamos servicios por convenio con la aseguradora "${epsMatches[0].name}".`;
         await this.smartReply(organizationId, senderId, noConvenioText);
         await this.setUserState(organizationId, senderId, ChatState.AWAITING_EPS);
         return;
      }

      const matchedEpsId = epsMatches[0].id;
      const matchedEpsName = epsMatches[0].name;
      await this.redis.set(`temp_eps_id:${organizationId}:${senderId}`, matchedEpsId, 'EX', SESSION_TTL);

      // --- BUSCAR AGENDA Y OFRECER CUPOS ---
      const slots = await this.appointmentsService.getAvailableSlots(
        finalEspecialidadConDoctor as string,
        matchedEpsId,
        organizationId!
      );

      if (slots.length === 0) {
        const noDispoMsg = `Revisé nuestros recursos disponibles para usuarios de *${matchedEpsName}* en *${finalEspecialidadConDoctor}* y lamentablemente no hay agenda abierta por convenio en este momento. Intente otro día.`;
        await this.smartReply(organizationId, senderId, noDispoMsg);
        await this.setUserState(organizationId, senderId, ChatState.IDLE);
        return;
      }

      let mensajeFechas = `Identificamos su solicitud. Cédula: *${finalCedula}*.\n`;
      mensajeFechas += `🏥 Consultando cupos para su EPS: *${matchedEpsName}*.\n\n📅 *Fechas disponibles:*\n`;

      slots.forEach((slot, index) => {
        const letra = String.fromCharCode(65 + index);
        this.redis.set(`temp_slot_${letra}:${senderId}`, slot.slotId, 'EX', SESSION_TTL);
        this.redis.set(`temp_slot_${letra}_fecha:${senderId}`, slot.fecha.toISOString(), 'EX', SESSION_TTL);
        mensajeFechas += `*${letra})* ${slot.fecha.toLocaleDateString('es-CO')} a las ${slot.fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}\n`;
      });
      mensajeFechas += `\n👉 Por favor indíqueme qué horario prefiere (Responda escribiendo solo la letra, ej: A).`;

      await this.smartReply(organizationId, senderId, mensajeFechas);
      await this.setUserState(organizationId, senderId, ChatState.AWAITING_DATE);
      return;
    }

    // ========================================================
    // FLUJO ESTRICTO PARA SELECCIONAR FECHA E INTENCIÓN FINAL
    // ========================================================
    switch (currentState) {
      case ChatState.AWAITING_DATE: {
        const letraElegida = text?.toUpperCase().trim() || '';
        const slotId = await this.redis.get(`temp_slot_${letraElegida}:${senderId}`);
        const slotFechaStr = await this.redis.get(`temp_slot_${letraElegida}_fecha:${senderId}`);

        if (!slotId || !slotFechaStr) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          await this.smartReply(organizationId, senderId, 'Esa no parece ser una de las letras disponibles. Por favor responda con la letra correcta (ej: A), o si prefiere cancelar y cambiar de especialidad, escriba "Salir".');
          return;
        }

        await this.redis.set(`temp_selected_slot_id:${organizationId}:${senderId}`, slotId, 'EX', SESSION_TTL);
        await this.redis.set(`temp_selected_date_view:${organizationId}:${senderId}`, slotFechaStr, 'EX', SESSION_TTL);

        const cedulaAgendamiento = await this.redis.get(`temp_cedula:${organizationId}:${senderId}`);
        const nombreAgendamiento = await this.redis.get(`temp_nombre:${organizationId}:${senderId}`) || 'Usuario';
        const specAgendamiento = await this.redis.get(`temp_especialidad:${organizationId}:${senderId}`) || 'Servicio';
        const epsAgendamiento = await this.redis.get(`temp_eps_query:${organizationId}:${senderId}`) || 'Universal';

        const resumenMsg = `Voy a confirmar la información de su cita médica:\n\n👤 Nombre: ${nombreAgendamiento}\n🪪 Cédula: ${cedulaAgendamiento}\n🏦 EPS: ${epsAgendamiento}\n🏥 Servicio: ${specAgendamiento}\n📅 Fecha: ${new Date(slotFechaStr).toLocaleString('es-CO')}\n\n⚠️ *¿La información es correcta?*\n(Responda *SÍ* para agendar definitivamente o *NO* para cancelar)`;

        await this.sendWhatsAppMessage(senderId, resumenMsg);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CONFIRMATION);
        break;
      }

      case ChatState.AWAITING_CONFIRMATION: {
        const respuesta = text?.toUpperCase().trim() || '';

        if (respuesta === 'SI' || respuesta === 'SÍ' || respuesta === 'SÍ.' || respuesta === 'SI.') {
          const finalCedula = await this.redis.get(`temp_cedula:${organizationId}:${senderId}`);
          const finalNombre = await this.redis.get(`temp_nombre:${organizationId}:${senderId}`);
          const finalSpec = await this.redis.get(`temp_especialidad:${organizationId}:${senderId}`);
          const finalEpsId = await this.redis.get(`temp_eps_id:${organizationId}:${senderId}`);
          const finalSlotId = await this.redis.get(`temp_selected_slot_id:${organizationId}:${senderId}`);
          const finalFechaVista = await this.redis.get(`temp_selected_date_view:${organizationId}:${senderId}`);
          const isAiFlow = (await this.redis.get(`is_ai_flow:${organizationId}:${senderId}`)) === 'true';

          if (!finalCedula || !finalSpec || !finalSlotId || !finalFechaVista) {
            await this.smartReply(organizationId, senderId, "⏳ Lo siento, su tiempo de sesión expiró antes de confirmar. Por favor, escriba 'Hola' para comenzar de nuevo.");
            await this.setUserState(organizationId, senderId, ChatState.IDLE);
            return;
          }

          let patient = await this.prisma.patientProfile.findUnique({
            where: { cedula: finalCedula },
          });

          if (!patient) {
            const tempUser = await this.prisma.user.create({
              data: {
                email: `temp_${Date.now()}@paciente.test`,
                password: 'none',
                role: 'PATIENT',
              },
            });
            patient = await this.prisma.patientProfile.create({
              data: {
                cedula: finalCedula,
                fullName: finalNombre || 'Paciente Registrado',
                whatsappId: senderId,
                userId: tempUser.id,
                epsId: finalEpsId || null,
              },
            });
          } else if (finalEpsId && patient.epsId !== finalEpsId) {
            patient = await this.prisma.patientProfile.update({
              where: { id: patient.id },
              data: { epsId: finalEpsId }
            });
          }

          const bookingResult = await this.appointmentsService.bookAppointment(
            patient.id, finalSlotId as string, patient.epsId, 'WHATSAPP', organizationId!
          );

          if (bookingResult.success) {
            await this.smartReply(organizationId, senderId, `✨ Perfecto.\nSu cita ha sido agendada correctamente en ${fallbackOrgInfo || 'nuestra Clínica'}.\n\nRecuerde presentarse 15 minutos antes de la hora programada (${new Date(finalFechaVista).toLocaleString('es-CO')}).\n\nGracias por comunicarse con nosotros. Le deseamos mucha salud.`);
          } else {
            await this.smartReply(organizationId, senderId, `⚠️ ${bookingResult.message}\nEs posible que deba repetir el proceso o contactarnos telefónicamente.`);
          }

          await this.setUserState(organizationId, senderId, ChatState.IDLE);
          const keysToDelete = [
            `temp_cedula:${organizationId}:${senderId}`, `temp_nombre:${organizationId}:${senderId}`, `temp_eps_query:${organizationId}:${senderId}`, `temp_eps_id:${organizationId}:${senderId}`,
            `temp_especialidad:${organizationId}:${senderId}`, `temp_doctor:${organizationId}:${senderId}`, `temp_selected_slot_id:${organizationId}:${senderId}`, `temp_selected_date_view:${organizationId}:${senderId}`,
            `error_count:${organizationId}:${senderId}`, `is_ai_flow:${organizationId}:${senderId}`
          ];
          const slotKeys = await this.redis.keys(`temp_slot_*:${senderId}`);
          await this.redis.del(...keysToDelete, ...slotKeys);

        } else if (respuesta === 'NO' || respuesta === 'CANCELAR') {
          await this.smartReply(organizationId, senderId, "✅ Entendido. He cancelado su solicitud temporal. Siéntase libre de enviarme un 'Hola' cuando desee agendar de nuevo. ¡Que esté muy bien!");
          await this.setUserState(organizationId, senderId, ChatState.IDLE);

          const keysToDelete = [
            `temp_cedula:${organizationId}:${senderId}`, `temp_nombre:${organizationId}:${senderId}`, `temp_eps_query:${organizationId}:${senderId}`, `temp_eps_id:${organizationId}:${senderId}`,
            `temp_especialidad:${organizationId}:${senderId}`, `temp_doctor:${organizationId}:${senderId}`, `temp_selected_slot_id:${organizationId}:${senderId}`, `temp_selected_date_view:${organizationId}:${senderId}`,
            `error_count:${organizationId}:${senderId}`, `is_ai_flow:${organizationId}:${senderId}`
          ];
          const slotKeys = await this.redis.keys(`temp_slot_*:${senderId}`);
          await this.redis.del(...keysToDelete, ...slotKeys);
        } else {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          await this.sendWhatsAppMessage(senderId, '⚠️ Por favor, responda únicamente con la palabra *SÍ* para confirmar su cita médica, o *NO* para anular el proceso.');
        }
        break;
      }

      // ==========================================
      // CASOS DE CANCELACIÓN
      // ==========================================
      case ChatState.AWAITING_CANCEL_CEDULA: {
        let cedula = text?.trim() || '';
        if (isAudio && aiData.cedula) cedula = aiData.cedula;
        else if (!isAudio && aiData.cedula) cedula = aiData.cedula;

        if (!cedula || cedula.length < 5) {
           await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
           await this.smartReply(organizationId, senderId, "No pude detectar un número de cédula válido. Por favor, escriba o diga el número de documento del paciente de la cita a cancelar.");
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
          await this.smartReply(organizationId, senderId, `Lo siento, no reconozco esa opción. Por favor, responda con una de las letras de la lista (ej: A${maxLetra !== 'A' ? ' - ' + maxLetra : ''}).`);
          return;
        }

        await this.redis.set(`temp_selected_cancel_apt:${organizationId}:${senderId}`, aptId, 'EX', SESSION_TTL);
        await this.redis.set(`temp_selected_cancel_slot:${organizationId}:${senderId}`, slotId, 'EX', SESSION_TTL);

        await this.smartReply(organizationId, senderId, `Va a cancelar definitivamente esta cita.\n\n⚠️ *¿Está completamente seguro?*\n(Responda *SÍ* para ejecutar la cancelación o *NO* para abortar y mantener la cita).`);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_CONFIRM);
        break;
      }

      case ChatState.AWAITING_CANCEL_CONFIRM: {
        const respuesta = text?.toUpperCase().trim() || '';

        if (respuesta === 'SI' || respuesta === 'SÍ' || respuesta === 'SÍ.' || respuesta === 'SI.') {
          const aptId = await this.redis.get(`temp_selected_cancel_apt:${organizationId}:${senderId}`);
          const slotId = await this.redis.get(`temp_selected_cancel_slot:${organizationId}:${senderId}`);

          if (!aptId || !slotId) {
             await this.smartReply(organizationId, senderId, "⏳ Lo siento, la sesión expiró. Por favor comience el proceso de cancelación nuevamente diciendo 'Cancelar cita'.");
             await this.setUserState(organizationId, senderId, ChatState.IDLE);
             return;
          }

          try {
             await this.prisma.$transaction([
                this.prisma.appointment.update({
                   where: { id: aptId },
                   data: { status: 'CANCELLED' }
                }),
                this.prisma.scheduleSlot.update({
                   where: { id: slotId },
                   data: { isAvailable: true }
                })
             ]);
             await this.smartReply(organizationId, senderId, "✅ Su cita médica ha sido **cancelada exitosamente**.\nEl cupo ha sido liberado.\n\n¿Desea agendar una *nueva cita* o le puedo ayudar en algo más?");
          } catch (e) {
             this.logger.error('Error cancelando cita desde WhatsApp', e);
             await this.smartReply(organizationId, senderId, "Lo siento, ocurrió un error en nuestro sistema al intentar cancelar la cita. Por favor comuníquese con el Call Center.");
          }
          await this.setUserState(organizationId, senderId, ChatState.IDLE);
          const keysToDelete = await this.redis.keys(`temp_cancel_*:${senderId}`);
          if (keysToDelete.length > 0) await this.redis.del(...keysToDelete, `temp_selected_cancel_apt:${organizationId}:${senderId}`, `temp_selected_cancel_slot:${organizationId}:${senderId}`);
        } else if (respuesta === 'NO' || respuesta === 'CANCELAR') {
          await this.smartReply(organizationId, senderId, "✅ Perfecto. La cancelación ha sido abortada y **su cita sigue activa y agendada**.\n\n¿Qué más puedo hacer por usted?");
          await this.setUserState(organizationId, senderId, ChatState.IDLE);
          const keysToDelete = await this.redis.keys(`temp_cancel_*:${senderId}`);
          if (keysToDelete.length > 0) await this.redis.del(...keysToDelete, `temp_selected_cancel_apt:${organizationId}:${senderId}`, `temp_selected_cancel_slot:${organizationId}:${senderId}`);
        } else {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          await this.sendWhatsAppMessage(senderId, '⚠️ Por favor, responda únicamente con la palabra *SÍ* para confirmar la cancelación, o *NO* para mantener su cita.');
        }
        break;
      }

      default:
        await this.setUserState(organizationId, senderId, ChatState.IDLE);
        break;
    }
  }

  private async handleCancelCedulaStep(organizationId: string, senderId: string, cedula: string) {
      const patient = await this.prisma.patientProfile.findFirst({ where: { cedula , organizationId } });

      if (!patient) {
         await this.smartReply(organizationId, senderId, `No pude encontrar ningún paciente registrado con la cédula *${cedula}*.\nPor lo tanto no hay citas para cancelar.\n\nSi el número es incorrecto diga 'Cancelar Cita' nuevamente.`);
         await this.setUserState(organizationId, senderId, ChatState.IDLE);
         return;
      }

      const activeAppointments = await this.prisma.appointment.findMany({
         where: { 
            patientId: patient.id,
            status: 'SCHEDULED', // Only active
            scheduleSlot: { startTime: { gte: new Date() } } // Only future or current
         },
         include: {
            scheduleSlot: { include: { doctor: true, service: true } }
         },
         orderBy: { scheduleSlot: { startTime: 'asc' } }
      });

      if (activeAppointments.length === 0) {
         await this.smartReply(organizationId, senderId, `Actualmente el paciente con cédula *${cedula}* **no tiene citas futuras activas** programadas en nuestro sistema.\n\n¿Desea que le ayude agendando una nueva cita?`);
         await this.setUserState(organizationId, senderId, ChatState.IDLE);
         return;
      }

      if (activeAppointments.length === 1) {
         const apt = activeAppointments[0];
         await this.redis.set(`temp_selected_cancel_apt:${organizationId}:${senderId}`, apt.id, 'EX', SESSION_TTL);
         await this.redis.set(`temp_selected_cancel_slot:${organizationId}:${senderId}`, apt.scheduleSlotId, 'EX', SESSION_TTL);
         
         await this.smartReply(organizationId, senderId, `Encontramos 1 cita programada:\n\n🏥 *${apt.scheduleSlot.service.name}*\n👨‍⚕️ Dr. ${apt.scheduleSlot.doctor.fullName}\n📅 ${new Date(apt.scheduleSlot.startTime).toLocaleString('es-CO')}\n\n⚠️ *¿Está seguro que desea cancelar esta cita y liberar su cupo?*\n(Responda SÍ o NO)`);
         await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_CONFIRM);
         return;
      }

      let mazo = `Encontramos ${activeAppointments.length} citas programadas para la cédula ${cedula}.\n¿Cuál desea cancelar?\n`;
      activeAppointments.forEach((apt, idx) => {
         const letra = String.fromCharCode(65 + idx);
         this.redis.set(`temp_cancel_apt_${letra}:${organizationId}:${senderId}`, apt.id, 'EX', SESSION_TTL);
         this.redis.set(`temp_cancel_slot_${letra}:${organizationId}:${senderId}`, apt.scheduleSlotId, 'EX', SESSION_TTL);
         this.redis.set(`temp_cancel_max_letra:${organizationId}:${senderId}`, letra, 'EX', SESSION_TTL);
         mazo += `\n*${letra})* ${apt.scheduleSlot.service.name} con Dr. ${apt.scheduleSlot.doctor.fullName} - ${new Date(apt.scheduleSlot.startTime).toLocaleString('es-CO')}`;
      });

      mazo += `\n\n👉 Por favor, envíeme **la letra** (A, B, C...) de la cita que quiere cancelar.`;
      await this.smartReply(organizationId, senderId, mazo);
      await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_SELECTION);
  }

  // ==========================================
  // INTERFAZ EXTERNA (Outbound)
  // ==========================================
  async sendOutboundMessage(to: string, message: string) {
    // [Modificado por IA] Necesitamos resolver el tenant para poder invocar smartReply o mantener la firma del método
    const origin = await this.redis.get(`origin_phone:${to}`);
    if (!origin) throw new Error("No hay tenant asociado temporal para outboud message");
    const org = await this.prisma.organization.findFirst({ where: { metaPhoneId: origin } });
    if (!org) throw new Error("No org");
    await this.smartReply(org.id, to, message);
  }

  // ==========================================
  // HELPER MÉTODOS DE LIMPIEZA
  // ==========================================
  private async cleanUpUserCounters(organizationId: string, senderId: string) {
    await this.redis.del(`error_count:${organizationId}:${senderId}`);
    await this.redis.del(`is_ai_flow:${organizationId}:${senderId}`);
    await this.setUserState(organizationId, senderId, ChatState.IDLE);
  }
}
