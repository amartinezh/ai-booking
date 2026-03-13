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
  // HELPER 1: COMUNICACIÓN OUTBOUND (META API)
  // ==========================================
  private async sendWhatsAppMessage(toPhone: string, text: string) {
    const token = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneId = this.configService.get<string>('META_PHONE_ID');

    if (!phoneId) {
      throw new Error(
        'CRÍTICO: META_PHONE_ID no está definido en el archivo .env',
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
  private async getUserState(phoneId: string): Promise<ChatState> {
    const state = await this.redis.get(`chat_state:${phoneId}`);
    return (state as ChatState) || ChatState.IDLE;
  }

  private async setUserState(phoneId: string, state: ChatState) {
    await this.redis.set(`chat_state:${phoneId}`, state, 'EX', SESSION_TTL);
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

  private async extractDataWithGemini(audioBuffer: Buffer): Promise<{
    cedula: string | null;
    nombre: string | null;
    eps: string | null;
    especialidad: string | null;
    ininteligible: boolean;
  }> {
    const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `
        Eres un asistente médico hiper-empático en el Hospital San Vicente (Colombia). 
        Escucha el audio adjunto de un paciente.
        
        REGLA DE RUIDO Y SILENCIO: Si el audio está vacío o solo hay ruido sin intención clara, pon "ininteligible" en true y los demás null.

        Extrae la siguiente información y devuélvela ÚNICAMENTE en JSON válido sin envolturas de código (\`\`\`json):
        {
            "cedula": "Número sin puntos (Ej: 1088123456). Si no menciona, null.",
            "nombre": "Nombre completo de la persona que habla (Ej: Juan Perez). Si no menciona, null.",
            "eps": "El nombre de su EPS o aseguradora (Ej: Sura, Sanitas, Nueva EPS, Asmet Salud, Particular, Savia). Si no menciona, null.",
            "especialidad": "Normaliza a la especialidad médica solicitada (Ej: Odontología, Medicina General, Pediatría). Si no la dice, null.",
            "ininteligible": false
        }`;

    const audioPart = {
      inlineData: {
        data: audioBuffer.toString('base64'),
        mimeType: 'audio/ogg',
      },
    };

    const result = await model.generateContent([prompt, audioPart]);
    const responseText = result.response.text().trim();

    const cleanedText = responseText
      .replace(/```json/g, '')
      .replace(/```/g, '');

    try {
      return JSON.parse(cleanedText);
    } catch (e) {
      this.logger.error('Error parseando el JSON de Gemini', responseText);
      return {
        cedula: null,
        nombre: null,
        eps: null,
        especialidad: null,
        ininteligible: true,
      };
    }
  }

  private async analyzeIntentWithGemini(text: string): Promise<{ isEscape: boolean; reason?: string }> {
    const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `
        Eres un analizador de intenciones para un Chatbot Médico de WhatsApp.
        El usuario acaba de enviar el siguiente mensaje: "${text}"

        TAREA:
        Detecta si el sentimiento o la intención de este mensaje es querer cancelar, reiniciar, salir, cambiar de opinión, arrepentirse, o pedir hablar con un humano en lugar de seguir respondiendo a lo que se le preguntó.
        Las palabras sueltas como "hola", "cancelar", "menú", "volver", "equivoqué" también cuentan como intención de escape/reinicio.

        Si detectas este sentimiento, responde con isEscape: true y un motivo breve en 'reason'.
        Si simplemente está respondiendo normal a una pregunta (Ej: dando su cédula, diciendo una especialidad, "Sura", "A", "Sí"), pon isEscape: false.

        Devuelve ÚNICAMENTE un JSON válido sin envolturas de código (\`\`\`json):
        { "isEscape": boolean, "reason": "string o null" }
    `;

    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text().trim().replace(/```json/g, '').replace(/```/g, '');
      return JSON.parse(responseText);
    } catch (e) {
      this.logger.error('Error analizando intención con Gemini', e);
      return { isEscape: false };
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

  private async uploadToWhatsApp(audioBuffer: Buffer): Promise<string> {
    const token = this.configService.get<string>('META_ACCESS_TOKEN');
    const phoneId = this.configService.get<string>('META_PHONE_ID');

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
    const phoneId = this.configService.get<string>('META_PHONE_ID');
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

  private async smartReply(senderId: string, text: string) {
    const isAiFlow =
      (await this.redis.get(`is_ai_flow:${senderId}`)) === 'true';

    if (isAiFlow) {
      try {
        this.logger.log(`🎙️ Respondiendo con nota de voz a ${senderId}...`);
        const audioBuffer = await this.generateTTS(text);
        const mediaId = await this.uploadToWhatsApp(audioBuffer);
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

    if (messageType !== 'text' && messageType !== 'audio') {
      return;
    }

    const currentState = await this.getUserState(senderId);
    this.logger.log(
      `Usuario ${senderId} en estado: ${currentState}. Tipo: ${messageType}`,
    );

    // ========================================================
    // 🛑 INTERCEPTOR DE ESCAPE GLOBAL (SENTIMIENTO & PALABRAS CLAVE)
    // ========================================================
    if (messageType === 'text' && text && currentState !== ChatState.IDLE) {
      const isQuickEscape = /^(hola|cancelar|salir|reiniciar|volver|me equivoque|me equivoqué|otra cita|cambiar|no quiero|detener|menu|menú)$/i.test(text.trim());

      let isEscape = isQuickEscape;
      // Si el texto tiene más de 2 palabras y no fue escape rápido, usamos Inteligencia Artificial (Empatía)
      if (!isEscape && text.split(' ').length > 2) {
        const intent = await this.analyzeIntentWithGemini(text);
        isEscape = intent.isEscape;
      }

      if (isEscape) {
        this.logger.log(`🚨 Escape detectado (Humano/IA) para ${senderId}: "${text}"`);
        // Reiniciar memoria borrando sesión y estado
        await this.redis.del(`is_ai_flow:${senderId}`);
        await this.setUserState(senderId, ChatState.IDLE);
        await this.smartReply(senderId, "✅ Entendido. He cancelado lo que estábamos haciendo. ¡No hay problema!\n\n¿En qué más le puedo ayudar el día de hoy? (Puede escribirme de nuevo la especialidad deseada)");
        return;
      }
    }

    // ========================================================
    // FLUJO DE IA (AUDIO)
    // ========================================================
    if (messageType === 'audio' && audioId) {
      // Aseguramos que el flujo se marque como IA desde que envían el primer audio
      await this.redis.set(`is_ai_flow:${senderId}`, 'true', 'EX', SESSION_TTL);

      // 🛡️ PROTECCIÓN UX: Si estamos pidiendo la fecha o confirmando, obligamos a escribir
      if (
        currentState === ChatState.AWAITING_DATE ||
        currentState === ChatState.AWAITING_CONFIRMATION
      ) {
        await this.sendWhatsAppMessage(
          senderId,
          '🎙️ Para este paso tan importante, por favor escríbame su respuesta en texto (la letra o la palabra SÍ/NO) para evitar errores en su cita médica.',
        );
        return;
      }

      await this.sendWhatsAppMessage(
        senderId,
        '🎧 Permítame un momento por favor, lo estoy escuchando atentamente...',
      );

      try {
        const audioBuffer = await this.downloadWhatsAppAudio(audioId);
        const aiData = await this.extractDataWithGemini(audioBuffer);

        this.logger.log(`🧠 Gemini extrajo: ${JSON.stringify(aiData)}`);

        if (aiData.ininteligible) {
          const botMessage = '🎙️ Disculpe, había mucho ruido de fondo o el audio se escuchó cortado y no alcancé a entenderle bien. ¿Podría acercarse un poquito el celular y volver a grabarme la nota de voz?';
          await this.smartReply(senderId, botMessage);

          // Caja Negra: Se registra el fallo por audio ininteligible
          try {
            await this.prisma.interactionLog.create({
              data: {
                whatsappId: senderId,
                status: 'FAILED',
                failureReason: 'UNINTELLIGIBLE_AUDIO',
                userMessage: '[Audio File]',
                botReply: botMessage,
                metadata: aiData as any,
              }
            });
          } catch (logErr) {
            this.logger.error('Error guardando en InteractionLog (Audio)', logErr);
          }

          return;
        }

        // 🧠 MEMORIA A CORTO PLAZO (MERGE STATE)
        const savedCedula = await this.redis.get(`temp_cedula:${senderId}`);
        const savedEspecialidad = await this.redis.get(
          `temp_especialidad:${senderId}`,
        );

        const finalCedula = aiData.cedula || savedCedula;
        const finalEspecialidad = aiData.especialidad || savedEspecialidad;

        if (finalCedula && finalEspecialidad) {
          await this.redis.set(
            `temp_cedula:${senderId}`,
            finalCedula,
            'EX',
            SESSION_TTL,
          );
          await this.redis.set(
            `temp_especialidad:${senderId}`,
            finalEspecialidad,
            'EX',
            SESSION_TTL,
          );

          // VALIDACIÓN EPS AUTOMÁTICA EN LA BD O PREGUNTA POR AI:
          let epsNameFromDb: string | null = null;
          let epsIdFromDb: string | null = null;

          const patient = await this.prisma.patientProfile.findUnique({
            where: { cedula: finalCedula },
            include: { eps: true },
          });

          // Si el paciente existe y ya tiene EPS... la usamos automáticamente
          if (patient?.epsId && patient?.eps) {
            epsIdFromDb = patient.epsId;
            epsNameFromDb = patient.eps.name;
          }

          // TODO: Futuro - Si la AI extrajo la EPS, asociarla si es nuevo.

          const slots = await this.appointmentsService.getAvailableSlots(
            finalEspecialidad,
            epsIdFromDb,
          );

          if (slots.length === 0) {
            const noDispoMsg = epsNameFromDb
              ? `Entendí que necesita cita para *${finalEspecialidad}*. Revisé su perfil como afiliado a *${epsNameFromDb}*, pero lamentablemente no hay cupos asignados por la aseguradora en este momento. Intente otro día.`
              : `Entendí que necesita cita para *${finalEspecialidad}*, pero no hay agenda abierta. Intente mañana.`;
            await this.smartReply(senderId, noDispoMsg);

            // Caja Negra: Se audita demanda de médicos sin disponibilidad (AI Flow)
            try {
              await this.prisma.interactionLog.create({
                data: {
                  whatsappId: senderId,
                  status: 'FAILED',
                  failureReason: 'NO_AGENDA',
                  userMessage: `[AI Deducción] Servicio: ${finalEspecialidad}`,
                  botReply: noDispoMsg,
                  metadata: { extractedData: aiData, epsNameFromDb },
                  patientId: patient?.id
                }
              });
            } catch (logErr) {
              this.logger.error('Error guardando en InteractionLog (AI Flow NO_AGENDA)', logErr);
            }

            await this.setUserState(senderId, ChatState.IDLE);
            return;
          }

          let mensajeFechas = `Identificamos su solicitud. Cédula: *${finalCedula}*, Especialidad: *${finalEspecialidad}*.\n`;
          if (epsNameFromDb)
            mensajeFechas += `🏥 Consultando cupos para su EPS registrada: *${epsNameFromDb}*.\n`;
          mensajeFechas += `\n📅 *Fechas disponibles:*\n`;

          slots.forEach((slot, index) => {
            const letra = String.fromCharCode(65 + index);
            // 🛑🚨 GUARDAMOS YA NO LA FECHA, SINO EL ID DEL SLOT FÍSICO
            this.redis.set(
              `temp_slot_${letra}:${senderId}`,
              slot.slotId,
              'EX',
              SESSION_TTL,
            );
            this.redis.set(
              `temp_slot_${letra}_fecha:${senderId}`,
              slot.fecha.toISOString(),
              'EX',
              SESSION_TTL,
            );
            mensajeFechas += `${letra}) ${slot.fecha.toLocaleDateString('es-CO')} a las ${slot.fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} con el Dr(a) ${slot.doctor}\n`;
          });
          mensajeFechas += `\n(Responda escribiendo la letra, ej: A)`;

          await this.smartReply(senderId, mensajeFechas);
          await this.setUserState(senderId, ChatState.AWAITING_DATE);
        } else if (finalEspecialidad && !finalCedula) {
          await this.redis.set(
            `temp_especialidad:${senderId}`,
            finalEspecialidad,
            'EX',
            SESSION_TTL,
          );
          await this.smartReply(
            senderId,
            `Entendí que busca cita para *${finalEspecialidad}*. Por favor, ¿me puede decir o escribir su número de cédula?`,
          );
          await this.setUserState(senderId, ChatState.AWAITING_CEDULA);
        } else if (finalCedula && !finalEspecialidad) {
          await this.redis.set(
            `temp_cedula:${senderId}`,
            finalCedula,
            'EX',
            SESSION_TTL,
          );
          await this.smartReply(
            senderId,
            `Tengo registrada su cédula: *${finalCedula}*. ¿Para qué especialidad necesita la cita (Ej: Medicina General, Odontología)?`,
          );
          await this.setUserState(senderId, ChatState.AWAITING_SPECIALTY);
        } else {
          await this.smartReply(
            senderId,
            "Disculpe, no pude entender qué trámite necesita. ¿Podría volver a grabarlo o escribirme 'Hola' para empezar de nuevo?",
          );
        }
      } catch (error: any) {
        this.logger.error('Fallo general procesando IA', error);
        const failMsg = "Ups! 🛑 Tuve un pequeño contratiempo con mi sistema de lectura. Por favor, escríbame 'Hola' para hacerlo manualmente, o reiniciemos la conversación.";
        await this.smartReply(senderId, failMsg);

        try {
          await this.prisma.interactionLog.create({
            data: {
              whatsappId: senderId,
              status: 'FAILED',
              failureReason: 'AI_SYSTEM_FAILURE',
              userMessage: '[Audio Process Error]',
              botReply: failMsg,
              metadata: { errorMsg: error?.message || 'Unknown' }
            }
          });
        } catch (logErr) {
          this.logger.error('Error guardando en InteractionLog (System Failure)', logErr);
        }
      }
      return;
    }

    // ========================================================
    // FLUJO TRADICIONAL (TEXTO / ESTADOS AVANZADOS)
    // ========================================================
    switch (currentState) {
      case ChatState.IDLE:
        const activeServices = await this.prisma.medicalService.findMany({
          where: { isActive: true },
          select: { name: true },
          orderBy: { name: 'asc' }
        });

        let servicesText = "";
        if (activeServices.length > 0) {
          const namesList = activeServices.map(s => s.name).join(', ');
          servicesText = `(Opciones disponibles: ${namesList})`;
        } else {
          servicesText = "(Ej: Medicina General o Odontología)";
        }

        await this.smartReply(
          senderId,
          `👋 ¡Hola! Bienvenido al sistema de agendamiento del Hospital San Vicente.\n\nPuedo ayudarle con la asignación de citas médicas. Por favor, *escríbame la especialidad* que desea ${servicesText} o envíeme un *audio corto*.`,
        );
        await this.setUserState(senderId, ChatState.AWAITING_SPECIALTY);
        break;

      case ChatState.AWAITING_SPECIALTY:
        let especialidad = text;
        if (text === '1' || text.toLowerCase().includes('general')) especialidad = 'Medicina General';
        if (text === '2' || text.toLowerCase().includes('odonto')) especialidad = 'Odontología';

        await this.redis.set(`temp_especialidad:${senderId}`, especialidad, 'EX', SESSION_TTL);
        await this.smartReply(
          senderId,
          `✅ Correcto, buscaremos agenda para *${especialidad}*.\n\nPara verificar la disponibilidad de agenda, *por favor indíqueme el nombre de su EPS* (Aseguradora) a la que se encuentra afiliado. (Ej: Sura, Sanitas, Particular).`,
        );
        await this.setUserState(senderId, ChatState.AWAITING_EPS);
        break;

      case ChatState.AWAITING_EPS:
        const epsInput = text.trim();
        await this.redis.set(`temp_eps_query:${senderId}`, epsInput, 'EX', SESSION_TTL);

        // Búsqueda difusa (Like %epsInput%)
        const epsMatches = await this.prisma.eps.findMany({
          where: { name: { contains: epsInput, mode: 'insensitive' } }
        });

        let matchedEpsId: string | null = null;
        let matchedEpsName = epsInput;

        if (epsMatches.length > 0) {
          matchedEpsId = epsMatches[0].id;
          matchedEpsName = epsMatches[0].name;
          if (matchedEpsId) {
            await this.redis.set(`temp_eps_id:${senderId}`, matchedEpsId, 'EX', SESSION_TTL);
          }
        }

        const specRecuperada = await this.redis.get(`temp_especialidad:${senderId}`);
        if (!specRecuperada) {
          await this.smartReply(senderId, "⏳ Su sesión ha expirado. Por favor, escriba 'Hola' de nuevo.");
          await this.setUserState(senderId, ChatState.IDLE);
          return;
        }

        // Consultar Agenda de Servicios + EPS (Triage Administrativo)
        const slots = await this.appointmentsService.getAvailableSlots(specRecuperada, matchedEpsId);

        if (slots.length === 0) {
          const noDispoMsg = `Lo sentimos. He revisado los horarios disponibles para usuarios de *${matchedEpsName}* en *${specRecuperada}* y no hay agenda abierta por convenio en este momento. Intente más tarde o consulte con su entidad.`;
          await this.smartReply(senderId, noDispoMsg);

          // Caja Negra: Se audita el déficit de ofertas frente a la EPS (Text Flow)
          try {
            await this.prisma.interactionLog.create({
              data: {
                whatsappId: senderId,
                status: 'FAILED',
                failureReason: 'NO_AGENDA',
                userMessage: epsInput,
                botReply: noDispoMsg,
                metadata: { requestedService: specRecuperada, requestedEps: matchedEpsName }
              }
            });
          } catch (logErr) {
            this.logger.error('Error guardando en InteractionLog (Text Flow NO_AGENDA)', logErr);
          }

          await this.setUserState(senderId, ChatState.IDLE);
          return;
        }

        let mensajeFechas = `Estoy revisando los horarios disponibles para usuarios de *${matchedEpsName}*.\n\nTengo las siguientes opciones:\n\n`;

        slots.forEach((slot, index) => {
          const letra = String.fromCharCode(65 + index);
          this.redis.set(`temp_slot_${letra}:${senderId}`, slot.slotId, 'EX', SESSION_TTL);
          this.redis.set(`temp_slot_${letra}_fecha:${senderId}`, slot.fecha.toISOString(), 'EX', SESSION_TTL);
          mensajeFechas += `*${letra})* ${slot.fecha.toLocaleDateString('es-CO')} a las ${slot.fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}\n`;
        });
        mensajeFechas += `\n👉 Por favor indíqueme qué horario prefiere (Responda solo con la letra, ej: A).`;

        await this.smartReply(senderId, mensajeFechas);
        await this.setUserState(senderId, ChatState.AWAITING_DATE);
        break;

      case ChatState.AWAITING_DATE:
        const letraElegida = text.toUpperCase();

        const slotId = await this.redis.get(`temp_slot_${letraElegida}:${senderId}`);
        const slotFechaStr = await this.redis.get(`temp_slot_${letraElegida}_fecha:${senderId}`);

        if (!slotId || !slotFechaStr) {
          await this.smartReply(senderId, 'Esa no parece ser una de las letras disponibles. Por favor responda con la letra correcta (ej: A), o si prefiere cancelar y cambiar de especialidad, escriba "Salir".');
          return;
        }

        await this.redis.set(`temp_selected_slot_id:${senderId}`, slotId, 'EX', SESSION_TTL);
        await this.redis.set(`temp_selected_date_view:${senderId}`, slotFechaStr, 'EX', SESSION_TTL);

        // Pedimos ahora los datos del paciente
        await this.smartReply(
          senderId,
          `Perfecto. Usted ha seleccionado el ${new Date(slotFechaStr).toLocaleString('es-CO')}.\n\nAhora voy a solicitar algunos datos para registrar su cita.\n\n👤 *Por favor indíqueme su nombre completo.*`,
        );
        await this.setUserState(senderId, ChatState.AWAITING_NAME);
        break;

      case ChatState.AWAITING_NAME:
        await this.redis.set(`temp_nombre:${senderId}`, text.trim(), 'EX', SESSION_TTL);
        await this.smartReply(senderId, `Gracias.\n\nAhora indíqueme su *número de cédula* para finalizar (solo números).`);
        await this.setUserState(senderId, ChatState.AWAITING_CEDULA);
        break;

      case ChatState.AWAITING_CEDULA:
        if (!/^\d{6,11}$/.test(text)) {
          await this.smartReply(senderId, 'Ese formato no parece correcto. Por favor, envíeme solo su número de cédula sin puntos ni comas, o escriba "Volver" si desea reiniciar.');
          return;
        }
        await this.redis.set(`temp_cedula:${senderId}`, text, 'EX', SESSION_TTL);

        const cedulaAgendamiento = text;
        const nombreAgendamiento = await this.redis.get(`temp_nombre:${senderId}`) || 'Usuario';
        const specAgendamiento = await this.redis.get(`temp_especialidad:${senderId}`) || 'Servicio';
        const epsAgendamiento = await this.redis.get(`temp_eps_query:${senderId}`) || 'Universal';
        const fechaVistaAgendamiento = await this.redis.get(`temp_selected_date_view:${senderId}`);

        if (!fechaVistaAgendamiento) {
          await this.smartReply(senderId, "⏳ La sesión expiró. Escribe 'Hola' para intentar de nuevo.");
          await this.setUserState(senderId, ChatState.IDLE);
          return;
        }

        const resumenMsg = `Voy a confirmar la información registrada:\n\n👤 Nombre: ${nombreAgendamiento}\n🪪 Cédula: ${cedulaAgendamiento}\n🏦 EPS: ${epsAgendamiento}\n\nLa cita para ${specAgendamiento} quedó programada para el ${new Date(fechaVistaAgendamiento).toLocaleString('es-CO')}.\n\n⚠️ *¿La información es correcta?*\n(Responda *SÍ* para agendar o *NO* para cancelar)`;

        // Mantenemos texto escrito explícito por seguridad
        await this.sendWhatsAppMessage(senderId, resumenMsg);
        await this.setUserState(senderId, ChatState.AWAITING_CONFIRMATION);
        break;

      case ChatState.AWAITING_CONFIRMATION:
        const respuesta = text.toUpperCase().trim();

        if (
          respuesta === 'SI' ||
          respuesta === 'SÍ' ||
          respuesta === 'SÍ.' ||
          respuesta === 'SI.'
        ) {
          // EL USUARIO FIRMÓ EL CONTRATO. A PROCEDER A BASE DE DATOS.
          const finalCedula = await this.redis.get(`temp_cedula:${senderId}`);
          const finalNombre = await this.redis.get(`temp_nombre:${senderId}`);
          const finalSpec = await this.redis.get(`temp_especialidad:${senderId}`);
          const finalEpsId = await this.redis.get(`temp_eps_id:${senderId}`);
          const finalSlotId = await this.redis.get(`temp_selected_slot_id:${senderId}`);
          const finalFechaVista = await this.redis.get(`temp_selected_date_view:${senderId}`);
          const isAiFlow = (await this.redis.get(`is_ai_flow:${senderId}`)) === 'true';

          // 🛡️ TYPE GUARD
          if (!finalCedula || !finalSpec || !finalSlotId || !finalFechaVista) {
            await this.smartReply(
              senderId,
              "⏳ Lo siento, su tiempo de sesión expiró antes de confirmar. Por favor, escriba 'Hola' para comenzar de nuevo.",
            );
            await this.setUserState(senderId, ChatState.IDLE);
            return;
          }

          // 🚨 BUSCAMOS O CREAMOS AL PACIENTE (UPSERT LÓGICO Y MATCH DE EPS)
          let patient = await this.prisma.patientProfile.findUnique({
            where: { cedula: finalCedula },
          });

          if (!patient) {
            const tempUser = await this.prisma.user.create({
              data: {
                email: `temp_${Date.now()}@sanvicente.test`,
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
                epsId: finalEpsId || null, // Asignamos EPS cruzada
              },
            });
          } else {
            // Si el paciente ya existía pero su EPS ahora es diferente o la hemos cruzado, la actualizamos
            if (finalEpsId && patient.epsId !== finalEpsId) {
              patient = await this.prisma.patientProfile.update({
                where: { id: patient.id },
                data: { epsId: finalEpsId }
              });
            }
          }

          // 👉 EJECUTAMOS LA TRANSACCION HIS
          const bookingResult = await this.appointmentsService.bookAppointment(
            patient.id,
            finalSlotId,
            patient.epsId,
            isAiFlow,
          );

          if (bookingResult.success) {
            await this.smartReply(
              senderId,
              `✨ Perfecto.\nSu cita ha sido agendada correctamente en el Hospital San Vicente de Paúl.\n\nRecuerde presentarse 15 minutos antes de la hora programada (${new Date(finalFechaVista).toLocaleString('es-CO')}).\n\nGracias por comunicarse con nosotros. Le deseamos un buen día.`,
            );
          } else {
            await this.smartReply(
              senderId,
              `⚠️ ${bookingResult.message}\nEs posible que deba repetir el proceso o contactarnos telefónicamente.`,
            );
          }

          // Limpieza final
          await this.setUserState(senderId, ChatState.IDLE);
          const keysToDelete = [
            `temp_cedula:${senderId}`,
            `temp_nombre:${senderId}`,
            `temp_eps_query:${senderId}`,
            `temp_eps_id:${senderId}`,
            `temp_especialidad:${senderId}`,
            `temp_selected_slot_id:${senderId}`,
            `temp_selected_date_view:${senderId}`,
          ];
          const slotKeys = await this.redis.keys(`temp_slot_*:${senderId}`);
          await this.redis.del(...keysToDelete, ...slotKeys);
        } else if (respuesta === 'NO' || respuesta === 'CANCELAR') {
          await this.smartReply(
            senderId,
            "✅ Entendido. He cancelado su solicitud temporal por inactividad. Siéntase libre de enviarme un 'Hola' cuando desee agendar de nuevo. ¡Que esté muy bien!",
          );
          await this.setUserState(senderId, ChatState.IDLE);

          const keysToDelete = [
            `temp_cedula:${senderId}`,
            `temp_nombre:${senderId}`,
            `temp_eps_query:${senderId}`,
            `temp_eps_id:${senderId}`,
            `temp_especialidad:${senderId}`,
            `temp_selected_slot_id:${senderId}`,
            `temp_selected_date_view:${senderId}`,
          ];
          const slotKeys = await this.redis.keys(`temp_slot_*:${senderId}`);
          await this.redis.del(...keysToDelete, ...slotKeys);
        } else {
          // Obligamos a texto
          await this.sendWhatsAppMessage(
            senderId,
            '⚠️ Por favor, responda únicamente con la palabra *SÍ* para confirmar su cita médica, o *NO* para anular el proceso.',
          );
        }
        break;

      default:
        await this.setUserState(senderId, ChatState.IDLE);
        break;
    }
  }
}
