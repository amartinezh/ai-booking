// @ts-nocheck
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import {
  ChatState,
  SESSION_TTL,
  WAITLIST_CONFIRM_TTL,
  MSGS,
  buildMessages,
  MIN_CEDULA_LENGTH,
  PARTICULAR_EPS_NAME,
  DEFAULT_MAX_RETRIES,
} from './chatbot.constants';
import { KnowledgeBaseService } from './knowledge-base.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { AppointmentsService } from 'src/appointments/appointments.service';
import { WaitlistService } from 'src/waitlist/waitlist.service';
import {
  InteractionLogService,
  InteractionStatus,
  FailureReason,
} from '../interaction-log/interaction-log.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import textToSpeech from '@google-cloud/text-to-speech';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ChatbotService implements OnModuleInit {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly ttsClient = new textToSpeech.TextToSpeechClient();

  // Regex construidos dinámicamente desde chatbot-patterns.txt
  private escapeRegex: RegExp = /^(hola)$/i;
  private cancelRegex: RegExp = /^(cancelar cita)/i;
  private greetingRegex: RegExp = /^(hola)$/i;
  private particularRegex: RegExp = /^(particular)$/i;
  private farewellRegex: RegExp = /^(gracias)$/i;
  // 🛡️ Guardrail: detecta insultos en cualquier parte del mensaje (no ancla a inicio/fin).
  private insultRegex: RegExp = /\b(gonorrea|hijueputa|malparid[oa]|idiota|imb[eé]cil)\b/i;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private httpService: HttpService,
    private redis: RedisService,
    private appointmentsService: AppointmentsService,
    private waitlistService: WaitlistService,
    private interactionLog: InteractionLogService,
    private knowledgeBase: KnowledgeBaseService,
    private organizationSettings: OrganizationSettingsService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn('⚠️ GEMINI_API_KEY no definida. Las funciones de audio fallarán.');
    }
    this.genAI = new GoogleGenerativeAI(apiKey || 'dummy');
  }

  async onModuleInit() {
    this.loadPatterns();
    // Seeder idempotente: asegura que cada organización tenga un registro EPS "Particular"
    // (pago directo). Se ejecuta en silencio si ya existe; no afecta CRON ni flujos en curso.
    try {
      await this.ensureParticularEpsForAllOrganizations();
    } catch (e) {
      this.logger.error(`No fue posible asegurar EPS "${PARTICULAR_EPS_NAME}": ${e.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SEEDER IDEMPOTENTE — EPS "Particular" por organización
  // ══════════════════════════════════════════════════════════════
  private async ensureParticularEpsForAllOrganizations(): Promise<void> {
    const orgs = await this.prisma.organization.findMany({ select: { id: true } });
    for (const org of orgs) {
      await this.ensureParticularEpsForOrg(org.id);
    }
  }

  private async ensureParticularEpsForOrg(organizationId: string): Promise<{ id: string; name: string } | null> {
    try {
      const existing = await this.prisma.eps.findFirst({
        where: {
          organizationId,
          name: { equals: PARTICULAR_EPS_NAME, mode: 'insensitive' },
        },
      });
      if (existing) {
        // Garantizar que esté activa para que aparezca en el menú
        if (!existing.isActive) {
          await this.prisma.eps.update({ where: { id: existing.id }, data: { isActive: true } });
        }
        return { id: existing.id, name: existing.name };
      }
      const created = await this.prisma.eps.create({
        data: {
          name: PARTICULAR_EPS_NAME,
          isActive: true,
          organizationId,
        },
      });
      this.logger.log(`✅ EPS "${PARTICULAR_EPS_NAME}" creada para organización ${organizationId}`);
      return { id: created.id, name: created.name };
    } catch (e) {
      this.logger.error(`Error asegurando EPS Particular para org ${organizationId}: ${e.message}`);
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // CARGA DE PATRONES DESDE ARCHIVO PLANO
  // Lee chatbot-patterns.txt y construye los regex de escape/cancel.
  // Llamar reloadPatterns() si se edita el archivo en caliente.
  // ══════════════════════════════════════════════════════════════
  private loadPatterns(): void {
    const candidates = [
      path.resolve(__dirname, 'chatbot-patterns.txt'),
      path.resolve(process.cwd(), 'src', 'chatbot', 'chatbot-patterns.txt'),
    ];

    let content: string | null = null;
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, 'utf-8');
        this.logger.log(`Patrones cargados desde: ${filePath}`);
        break;
      }
    }

    if (!content) {
      this.logger.warn('chatbot-patterns.txt no encontrado. Se usarán patrones por defecto.');
      return;
    }

    const farewellWords: string[] = [];
    const greetingWords: string[] = [];
    const escapeWords: string[] = [];
    const cancelPhrases: string[] = [];
    const particularWords: string[] = [];
    const insultWords: string[] = [];
    let currentSection = '';

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      if (line === '[farewell]') {
        currentSection = 'farewell';
      } else if (line === '[greetings]') {
        currentSection = 'greetings';
      } else if (line === '[escape]') {
        currentSection = 'escape';
      } else if (line === '[cancel]') {
        currentSection = 'cancel';
      } else if (line === '[particular]') {
        currentSection = 'particular';
      } else if (line === '[insults]') {
        currentSection = 'insults';
      } else if (currentSection === 'farewell') {
        farewellWords.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'greetings') {
        greetingWords.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'escape') {
        escapeWords.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'cancel') {
        cancelPhrases.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'particular') {
        particularWords.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'insults') {
        insultWords.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      }
    }

    if (farewellWords.length > 0) {
      this.farewellRegex = new RegExp(`^(${farewellWords.join('|')})$`, 'i');
    }
    if (greetingWords.length > 0) {
      this.greetingRegex = new RegExp(`^(${greetingWords.join('|')})$`, 'i');
    }
    if (escapeWords.length > 0) {
      this.escapeRegex = new RegExp(`^(${escapeWords.join('|')})$`, 'i');
    }
    if (cancelPhrases.length > 0) {
      this.cancelRegex = new RegExp(`^(${cancelPhrases.join('|')})`, 'i');
    }
    if (particularWords.length > 0) {
      this.particularRegex = new RegExp(`^(${particularWords.join('|')})$`, 'i');
    }
    if (insultWords.length > 0) {
      // No-anchored: detecta el insulto en cualquier parte del mensaje.
      this.insultRegex = new RegExp(`(?:^|\\s|[¡!¿?.,;])(${insultWords.join('|')})(?=$|\\s|[!?.,;])`, 'i');
    }

    this.logger.log(
      `Patrones listos — farewell: ${farewellWords.length}, greetings: ${greetingWords.length}, escape: ${escapeWords.length}, cancel: ${cancelPhrases.length}, particular: ${particularWords.length}, insults: ${insultWords.length}`,
    );
  }

  reloadPatterns(): void {
    this.loadPatterns();
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
    attempt = 1,
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
    isRateLimited: boolean;
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

    const maxRetries = parseInt(this.configService.get<string>('GEMINI_MAX_RETRIES') || '3', 10);

    try {
      const result = await model.generateContent(parts);
      const responseText = result.response.text().trim();
      const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '');
      const parsed = JSON.parse(cleanedText);
      parsed.isFallback = false;
      parsed.isRateLimited = false;
      return parsed;
    } catch (e) {
      // 429: cuota agotada — no reintentar (sería peor), no contar como fallo permanente
      if (e?.status === 429) {
        this.logger.warn(`Gemini rate limit (429) — usando fallback simple, sin incrementar contador de fallos`);
        return {
          cedula: null, nombre: null, eps: null, especialidad: null, doctor: null,
          isEscape: false, outOfContext: false, ininteligible: false,
          isFallback: true, isCancellation: false, isRateLimited: true,
        };
      }
      if (attempt < maxRetries) {
        const delayMs = attempt * 1500;
        this.logger.warn(`Gemini intento ${attempt} fallido, reintentando en ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        return this.extractDataWithGemini(text, audioBuffer, attempt + 1);
      }
      this.logger.error(`Error procesando IA con Gemini tras ${maxRetries} intentos`, e);
      return {
        cedula: null, nombre: null, eps: null, especialidad: null, doctor: null,
        isEscape: false, outOfContext: false, ininteligible: false,
        isFallback: true, isCancellation: false, isRateLimited: false,
      };
    }
  }

  // Extrae datos básicos del texto cuando Gemini no está disponible.
  // Usa currentState para saber qué campo está esperando el flujo y evitar bucles.
  private simpleExtractFallback(text: string | null, currentState?: ChatState) {
    const t = text?.trim() || '';
    const digits = t.replace(/\D/g, '');
    const isOnlyDigits = /^\d+$/.test(t);

    return {
      cedula: isOnlyDigits ? digits : null,
      // En el paso de nombre o EPS, pasar el texto raw para que el flujo lo procese
      nombre: currentState === ChatState.AWAITING_NAME ? (t || null) : null,
      eps: currentState === ChatState.AWAITING_EPS ? (t || null) : null,
      especialidad: currentState === ChatState.AWAITING_SPECIALTY ? (t || null) : null,
      doctor: null,
      isEscape: this.escapeRegex.test(t),
      outOfContext: false,
      ininteligible: false,
      isFallback: false,
      isCancellation: this.cancelRegex.test(t),
      isRateLimited: false,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // INTENT ROUTER (sin llamada a Gemini — regex local)
  // Clasifica el mensaje en IDLE sin consumir cuota de API.
  // Fail-open: 'other' → cae al flujo de agendamiento normal.
  // ══════════════════════════════════════════════════════════════
  private classifyIntentLocal(text: string): 'faq' | 'other' {
    // Normalizar: minúsculas + quitar tildes para comparación robusta
    const t = text.trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');

    // Palabras interrogativas o de solicitud de información
    const hasQuestionWord = /\b(como|cuanto|cuando|donde|que|cual|quien|puedo|pueden|tienen|tiene|aceptan|cobran|vale|cuestan|cuesta|atienden|funciona|hay|existe|permiten|solicitar)\b/.test(t);

    // Temas propios de FAQ de clínica (no de agendamiento)
    const hasFaqTopic = /\b(eps|seguro|asegurador|laboratorio|urgencia|historia.{0,10}clinica|incapacidad|certificado|parqueo|parqueadero|visita|acompanante|factura|tarifa|costo|precio|documento|requisito|telefono|correo|direccion|telemedicin|farmacia|radiolog|ecograf|rayos|scanner|pqrs|habeas|tramite|convenio|metodo.{0,5}pago|efectivo|nequi|pse|bancolombia)\b/.test(t);

    if (hasQuestionWord || hasFaqTopic) return 'faq';
    return 'other';
  }

  // ══════════════════════════════════════════════════════════════
  // FAQ HANDLER
  // Responde preguntas generales usando la base de conocimiento.
  // No modifica el estado de la sesión (el usuario sigue en IDLE).
  // ══════════════════════════════════════════════════════════════
  private async answerFAQ(
    question: string,
    organizationId: string,
    senderId: string,
    org: any,
    botName: string,
  ): Promise<void> {
    const supportPhone = org?.supportPhone || '(601) 555-0199';
    const clinicName = org?.name || 'nuestra Clínica';

    // Inyectar tono al system prompt según el estilo configurado por la org.
    const style = await this.organizationSettings.getCommunicationStyle(organizationId);
    const toneBlock =
      style === 'INFORMAL'
        ? `TONO Y ESTILO (INFORMAL):\n` +
          `- Trato cercano y amable usando *tú* (no "usted").\n` +
          `- Lenguaje conversacional, fluido, tipo charla con un amigo (sin caer en groserías ni sobrefamiliaridad).\n` +
          `- Saludos variados ("¡Hola!", "¡Hey!", "¿Cómo estás?"). No comiences siempre igual.\n` +
          `- Frases tipo párrafo en vez de listas rígidas, pero si presentas opciones, intégralas como viñetas A/B/C dentro del texto para que el usuario responda fácil.\n` +
          `- Modismos suaves colombianos OK ("dale", "tranqui", "te cuento", "mira"). Evita lo vulgar.`
        : `TONO Y ESTILO (FORMAL):\n` +
          `- Trato respetuoso usando *usted* en todo momento.\n` +
          `- Estructura clara con opciones A/B/C en líneas separadas cuando corresponda.\n` +
          `- Vocabulario profesional con calidez colombiana ("con mucho gusto", "claro que sí", "permítame").\n` +
          `- Conciso, ordenado, sin coloquialismos fuertes.`;

    const kbContent = await this.knowledgeBase.getContent(organizationId);

    if (!kbContent) {
      const reply =
        style === 'INFORMAL'
          ? `Esa información no la tengo en este momento, perdón. 😊 Para más detalles, comunícate al *${supportPhone}* o pásate por recepción.`
          : `Esa información no está disponible en este momento. 😊\n\nPara más detalles, comuníquese con nosotros al *${supportPhone}* o visítenos en recepción.`;
      await this.smartReply(organizationId, senderId, reply);
      await this.interactionLog.logSuccess({
        whatsappId: senderId,
        organizationId,
        userMessage: question,
        botReply: reply,
        metadata: { step: 'FAQ_NO_KB', communicationStyle: style },
      });
      return;
    }

    const systemPrompt =
      `Eres *${botName}*, el recepcionista virtual de *${clinicName}*. ` +
      `Tu único rol en este momento es responder preguntas generales de pacientes ` +
      `basándote EXCLUSIVAMENTE en la BASE DE CONOCIMIENTO que se incluye a continuación.\n\n` +
      `${toneBlock}\n\n` +
      `REGLAS ESTRICTAS QUE DEBES SEGUIR:\n` +
      `1. NUNCA inventes información que no esté en la base de conocimiento.\n` +
      `2. Si la respuesta no está en la base de conocimiento, responde exactamente: ` +
      `"Esa información no está disponible en este momento. Para más detalles, ` +
      `comuníquese con nosotros al *${supportPhone}*."\n` +
      `3. Usa formato de WhatsApp: *negrita* para énfasis importante, guiones para listas. ` +
      `NO uses HTML ni markdown avanzado (#, ##, **).\n` +
      `4. Sé cálido, empático y profesional. Lenguaje sencillo y cercano — respeta el TONO Y ESTILO definido arriba.\n` +
      `5. Sé conciso: máximo 4 oraciones o puntos clave, salvo que la pregunta requiera más detalle.\n` +
      `6. Si el paciente menciona querer agendar una cita, indícale: ` +
      (style === 'INFORMAL'
        ? `"Para agendar, cuéntame qué especialidad necesitas o escríbeme *Hola* para empezar."\n`
        : `"Para agendar, indíqueme la especialidad que necesita o escriba *Hola* para comenzar."\n`) +
      `7. Termina siempre con ` +
      (style === 'INFORMAL'
        ? `"¿Te ayudo con algo más? 😊"`
        : `"¿Hay algo más en lo que pueda ayudarle? 😊"`) +
      ` salvo que ya hayas derivado al teléfono de soporte.\n\n` +
      `--- BASE DE CONOCIMIENTO ---\n` +
      `${kbContent}\n` +
      `--- FIN DE BASE DE CONOCIMIENTO ---\n\n` +
      `Responde la siguiente pregunta del paciente:`;

    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent([systemPrompt, `Pregunta: "${question}"`]);
      const reply = result.response.text().trim();

      await this.smartReply(organizationId, senderId, reply);
      await this.interactionLog.logSuccess({
        whatsappId: senderId,
        organizationId,
        userMessage: question,
        botReply: reply,
        metadata: { step: 'FAQ_ANSWERED' },
      });
    } catch (err) {
      this.logger.error(`answerFAQ falló: ${err.message}`);
      const fallback =
        `Lo siento, tuve un inconveniente al procesar su consulta. 😔\n\n` +
        `Para más información, comuníquese con nosotros al *${supportPhone}*.`;
      await this.smartReply(organizationId, senderId, fallback);
      await this.interactionLog.logFailure({
        whatsappId: senderId,
        organizationId,
        reason: FailureReason.GEMINI_DOWN,
        userMessage: question,
        botReply: fallback,
        metadata: { step: 'FAQ_ERROR' },
      });
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
      `temp_eps_max_letra:${organizationId}:${senderId}`,
      `temp_especialidad:${organizationId}:${senderId}`,
      `temp_especialidad_id:${organizationId}:${senderId}`,
      `temp_service_max_letra:${organizationId}:${senderId}`,
      `temp_doctor:${organizationId}:${senderId}`,
      `temp_selected_slot_id:${organizationId}:${senderId}`,
      `temp_selected_date_view:${organizationId}:${senderId}`,
      `temp_waitlist_service_id:${organizationId}:${senderId}`,
      `temp_waitlist_eps_id:${organizationId}:${senderId}`,
      `temp_waitlist_pending:${organizationId}:${senderId}`,
      `error_count:${organizationId}:${senderId}`,
      `is_ai_flow:${organizationId}:${senderId}`,
    ];
    const slotKeys = await this.redis.keys(`temp_slot_*:${senderId}`);
    const serviceMenuKeys = await this.redis.keys(`temp_service_*:${organizationId}:${senderId}`);
    const epsMenuKeys = await this.redis.keys(`temp_eps_[A-Z]_*:${organizationId}:${senderId}`);
    await this.redis.del(...keysToDelete, ...slotKeys, ...serviceMenuKeys, ...epsMenuKeys);
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
  // HELPERS: MENÚS CON LETRAS PARA SERVICIO Y EPS
  // Persisten el mapping letra → id en Redis para resolver el input
  // del usuario en el turno siguiente. NO ejecutan llamadas a Gemini.
  // ══════════════════════════════════════════════════════════════
  private async buildServiceMenu(
    organizationId: string,
    senderId: string,
  ): Promise<{ lineas: string; count: number }> {
    const services = await this.prisma.medicalService.findMany({
      where: { isActive: true, organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    // Limpiar mapping previo de servicios
    const prev = await this.redis.keys(`temp_service_*:${organizationId}:${senderId}`);
    if (prev.length > 0) await this.redis.del(...prev);

    let lineas = '';
    let maxLetra = '';
    for (let i = 0; i < services.length; i++) {
      const letra = String.fromCharCode(65 + i);
      maxLetra = letra;
      await this.redis.set(`temp_service_${letra}_id:${organizationId}:${senderId}`, services[i].id, 'EX', SESSION_TTL);
      await this.redis.set(`temp_service_${letra}_name:${organizationId}:${senderId}`, services[i].name, 'EX', SESSION_TTL);
      lineas += `*${letra})* ${services[i].name}\n`;
    }
    if (maxLetra) {
      await this.redis.set(`temp_service_max_letra:${organizationId}:${senderId}`, maxLetra, 'EX', SESSION_TTL);
    }
    return { lineas, count: services.length };
  }

  private async buildEpsMenu(
    organizationId: string,
    senderId: string,
  ): Promise<{ lineas: string; count: number }> {
    // Garantizar que "Particular" exista para esta org (idempotente).
    await this.ensureParticularEpsForOrg(organizationId);

    const epsList = await this.prisma.eps.findMany({
      where: { isActive: true, organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const prev = await this.redis.keys(`temp_eps_${'*'}:${organizationId}:${senderId}`);
    // Solo limpiar los del menú, no temp_eps_query/temp_eps_id si ya existen
    const toClean = prev.filter(k => /temp_eps_[A-Z]_(id|name):/.test(k) || /temp_eps_max_letra:/.test(k));
    if (toClean.length > 0) await this.redis.del(...toClean);

    let lineas = '';
    let maxLetra = '';
    for (let i = 0; i < epsList.length; i++) {
      const letra = String.fromCharCode(65 + i);
      maxLetra = letra;
      await this.redis.set(`temp_eps_${letra}_id:${organizationId}:${senderId}`, epsList[i].id, 'EX', SESSION_TTL);
      await this.redis.set(`temp_eps_${letra}_name:${organizationId}:${senderId}`, epsList[i].name, 'EX', SESSION_TTL);
      lineas += `*${letra})* ${epsList[i].name}\n`;
    }
    if (maxLetra) {
      await this.redis.set(`temp_eps_max_letra:${organizationId}:${senderId}`, maxLetra, 'EX', SESSION_TTL);
    }
    return { lineas, count: epsList.length };
  }

  // Resuelve el input del usuario contra el menú de servicios:
  // 1) Letra exacta en el mapping. 2) Match parcial por nombre (insensitive contains).
  // 3) Si Gemini devolvió `especialidad`, intenta resolver por ese texto.
  private async resolveServiceFromInput(
    organizationId: string,
    senderId: string,
    text: string | null,
    geminiSpecialty: string | null,
  ): Promise<{ id: string; name: string } | null> {
    // 1) Letra
    const candidate = (text || '').trim().toUpperCase();
    if (/^[A-Z]$/.test(candidate)) {
      const id = await this.redis.get(`temp_service_${candidate}_id:${organizationId}:${senderId}`);
      const name = await this.redis.get(`temp_service_${candidate}_name:${organizationId}:${senderId}`);
      if (id && name) return { id, name };
    }
    // 2/3) Match parcial por nombre en BD
    const query = (geminiSpecialty || text || '').trim();
    if (query.length >= 3) {
      const svc = await this.prisma.medicalService.findFirst({
        where: {
          name: { contains: query, mode: 'insensitive' },
          isActive: true,
          organizationId,
        },
      });
      if (svc) return { id: svc.id, name: svc.name };
    }
    return null;
  }

  private async resolveEpsFromInput(
    organizationId: string,
    senderId: string,
    text: string | null,
    geminiEps: string | null,
  ): Promise<{ id: string; name: string } | null> {
    // 1) Letra
    const candidate = (text || '').trim().toUpperCase();
    if (/^[A-Z]$/.test(candidate)) {
      const id = await this.redis.get(`temp_eps_${candidate}_id:${organizationId}:${senderId}`);
      const name = await this.redis.get(`temp_eps_${candidate}_name:${organizationId}:${senderId}`);
      if (id && name) return { id, name };
    }
    // 2) "Particular" por patrón (tolerancia a typos / sinónimos del archivo de patrones)
    const raw = (text || '').trim();
    if (raw && this.particularRegex.test(raw)) {
      const part = await this.ensureParticularEpsForOrg(organizationId);
      if (part) return part;
    }
    // 3) Match parcial por nombre en BD (incluye "Particular" si el usuario lo escribió)
    const query = (geminiEps || text || '').trim();
    if (query.length >= 3) {
      const eps = await this.prisma.eps.findFirst({
        where: {
          name: { contains: query, mode: 'insensitive' },
          isActive: true,
          organizationId,
        },
      });
      if (eps) return { id: eps.id, name: eps.name };
    }
    return null;
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

    const botName = await this.organizationSettings.getBotName(organizationId);
    const maxRetries = organizationId
      ? await this.organizationSettings.getMaxRetries(organizationId)
      : DEFAULT_MAX_RETRIES;

    // Resolver el estilo de comunicación de la organización y construir
    // el pool de mensajes para todo este turno. La variable local `MSGS`
    // sombrea al import del mismo nombre dentro de esta función — todos
    // los `MSGS.xxx()` siguientes usan el pool del estilo activo, sin
    // tocar la lógica de extracción de datos ni el flujo del protocolo.
    const communicationStyle = organizationId
      ? await this.organizationSettings.getCommunicationStyle(organizationId)
      : 'FORMAL';
    const MSGS = buildMessages(communicationStyle);

    const currentState = await this.getUserState(organizationId, senderId);
    this.logger.log(
      `[Tenant: ${organizationId}] Usuario ${senderId} en estado: ${currentState}. Tipo: ${messageType}`,
    );

    // 🛡️ GUARDRAIL: INSULTO → DERIVACIÓN INMEDIATA ───────────────
    // Se evalúa lo más temprano posible, antes de cualquier procesamiento
    // (Gemini, reintentos, estados). El audio no se inspecciona aquí (irá
    // a Gemini con outOfContext; eso se maneja como off-topic).
    if (messageType === 'text' && !!text && this.insultRegex.test(text)) {
      const humanPhone = org?.supportPhone || '';
      const reply = humanPhone
        ? MSGS.guardrailInsulto(humanPhone, botName)
        : MSGS.maxReintentosReset();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpSession(organizationId, senderId);

      await this.interactionLog.log({
        whatsappId: senderId,
        organizationId,
        status: InteractionStatus.ABANDONED,
        failureReason: FailureReason.OUT_OF_CONTEXT,
        userMessage: text,
        botReply: reply,
        metadata: {
          guardrail: 'INSULT_DETECTED',
          previousState: currentState,
          immediate: true,
        },
      });
      return;
    }

    const retriesKey = `error_count:${organizationId}:${senderId}`;
    const retriesCount = parseInt((await this.redis.get(retriesKey)) || '0');

    // ── MÁXIMO REINTENTOS (configurable por org) ──────────────
    if (retriesCount >= maxRetries) {
      this.logger.warn(`Máximo de reintentos (${maxRetries}) para ${senderId}`);
      await this.cleanUpSession(organizationId, senderId);
      const humanPhone = org?.supportPhone || '';
      const replyText = humanPhone
        ? MSGS.guardrailOffTopic(humanPhone, botName)
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
        metadata: { previousState: currentState, retriesCount, maxRetries },
      });
      return;
    }

    const isStrictStep =
      currentState === ChatState.AWAITING_DATE ||
      currentState === ChatState.AWAITING_CONFIRMATION ||
      currentState === ChatState.AWAITING_CANCEL_SELECTION ||
      currentState === ChatState.AWAITING_CANCEL_CONFIRM ||
      currentState === ChatState.AWAITING_WAITLIST_CONFIRM ||
      currentState === ChatState.AWAITING_WAITLIST_OPTIN ||
      currentState === ChatState.AWAITING_POST_CANCEL_CHOICE;

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

    // EARLY RETURN: despedida en IDLE — no reabrir el flujo de agendamiento
    if (
      messageType === 'text' &&
      !!text &&
      currentState === ChatState.IDLE &&
      this.farewellRegex.test(text.trim())
    ) {
      const reply = MSGS.despedidaCorta();
      await this.smartReply(organizationId, senderId, reply);
      await this.interactionLog.logSuccess({
        whatsappId: senderId,
        organizationId,
        userMessage: text,
        botReply: reply,
        metadata: { step: 'FAREWELL' },
      });
      return;
    }

    // Patrones cargados desde chatbot-patterns.txt (ver loadPatterns / reloadPatterns)
    const isQuickCancel =
      messageType === 'text' &&
      !!text &&
      this.cancelRegex.test(text.trim());

    const isQuickEscape =
      messageType === 'text' &&
      !!text &&
      this.escapeRegex.test(text.trim());

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
      isRateLimited: false,
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
    } else if (isQuickEscape && currentState === ChatState.IDLE) {
      // saludo o reinicio simple en estado IDLE — no llama Gemini (→ bienvenida abajo)
    } else if (
      messageType === 'text' &&
      !!text &&
      currentState === ChatState.IDLE &&
      await this.knowledgeBase.hasContent(organizationId)
    ) {
      // Intent routing: solo en IDLE y cuando la KB está disponible.
      // Clasifica ANTES de llamar al extractor principal para evitar una llamada Gemini innecesaria.
      const intent = this.classifyIntentLocal(text);
      this.logger.log(`🎯 Intent (local): ${intent} para mensaje: "${text}"`);

      if (intent === 'faq') {
        await this.answerFAQ(text, organizationId, senderId, org, botName);
        return;
      }
      // Para scheduling / cancellation / greeting / other → extracción normal
      aiData = await this.extractDataWithGemini(text, null);
    } else if (isAudio) {
      await this.redis.set(`is_ai_flow:${organizationId}:${senderId}`, 'true', 'EX', SESSION_TTL);
      await this.sendWhatsAppMessage(senderId, '🎧 Permítame un momento, lo estoy escuchando...');
      const audioBuffer = await this.downloadWhatsAppAudio(audioId);
      if (audioBuffer) {
        aiData = await this.extractDataWithGemini(text, audioBuffer);
      } else {
        aiData.ininteligible = true;
      }
    } else if (
      messageType === 'text' &&
      text &&
      (currentState === ChatState.AWAITING_CEDULA || currentState === ChatState.AWAITING_CANCEL_CEDULA)
    ) {
      // En pasos de cédula, extraemos dígitos directamente sin llamar a Gemini.
      // Esto evita que "000", "123", etc. sean clasificados como ininteligibles.
      const digits = text.replace(/\D/g, '');
      if (digits.length > 0) {
        aiData.cedula = digits;
      }
      // Si el texto no tiene dígitos (ej: "salir") ya fue capturado por isQuickEscape arriba.
    } else if (
      messageType === 'text' &&
      text &&
      (currentState === ChatState.AWAITING_SPECIALTY || currentState === ChatState.AWAITING_EPS)
    ) {
      // En selección de menú (Pasos 1 y 2) NO llamamos a Gemini para texto:
      // el resolver del menú maneja letras (case-insensitive) y match parcial por nombre.
      // Gemini con inputs cortos como "a", "B", "Sura" tiende a marcar ininteligible=true
      // y bloquea el flujo. La voz sí va al extractor (manejada arriba en isAudio).
    } else if (messageType === 'text' && text && !isStrictStep) {
      aiData = await this.extractDataWithGemini(text, null);
    }

    this.logger.log(`🧠 Gemini extrajo: ${JSON.stringify(aiData)}`);

    // ── CONTADOR DE FALLOS GEMINI (por organización) ───────────
    const geminiFailKey = `gemini_fail_count:${organizationId}`;
    const geminiDownThreshold = parseInt(
      this.configService.get<string>('GEMINI_DOWN_THRESHOLD') || '3', 10,
    );

    if (aiData.isFallback) {
      if (aiData.isRateLimited) {
        // 429: cuota agotada — NO es un fallo de disponibilidad de Gemini.
        // Usar fallback simple sin tocar el contador permanente.
        this.logger.warn(`Gemini rate-limited (429) — fallback sin penalizar contador`);
        aiData = this.simpleExtractFallback(text, currentState);
      } else {
        // Error real (timeout, 5xx, etc.) → incrementar contador de caída
        const currentFails = parseInt((await this.redis.get(geminiFailKey)) || '0', 10);
        const newFails = currentFails + 1;
        await this.redis.set(geminiFailKey, newFails.toString(), 'EX', 900);

        if (newFails < geminiDownThreshold) {
          this.logger.warn(`Gemini fallo real #${newFails}/${geminiDownThreshold} — usando fallback simple`);
          aiData = this.simpleExtractFallback(text, currentState);
        } else {
          this.logger.error(`Gemini caído (${newFails} fallos consecutivos) — mostrando mantenimiento`);
          const humanPhone = org?.supportPhone || '+573000000000';
          const reply = MSGS.iaCaida(humanPhone);
          await this.smartReply(organizationId, senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.GEMINI_DOWN,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: { previousState: currentState, failCount: newFails },
          });
          return;
        }
      }
    } else {
      // Gemini respondió exitosamente: resetear contador de fallos reales
      await this.redis.del(geminiFailKey);
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

      const isGreeting = this.greetingRegex.test(text?.trim() || '');

      if (isGreeting) {
        // Saludo → mostrar bienvenida + menú de servicios con letras (Paso 1).
        const { lineas, count } = await this.buildServiceMenu(organizationId, senderId);
        const reply = count > 0
          ? MSGS.menuServicios(orgName, lineas, botName)
          : MSGS.bienvenida(orgName, 'Ej: Medicina General, Odontología', botName);

        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);

        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: { step: 'WELCOME', previousState: currentState, newState: ChatState.AWAITING_SPECIALTY, triggeredBy: 'greeting_escape', servicesCount: count },
        });
      } else {
        // Palabra de reset ("salir", "reiniciar", etc.) → mostrar "Sin problema"
        const reply = MSGS.escape();
        await this.smartReply(organizationId, senderId, reply);

        await this.interactionLog.log({
          whatsappId: senderId,
          organizationId,
          status: InteractionStatus.ESCAPED,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: { previousState: currentState },
        });
      }
      return;
    }

    if (aiData.outOfContext) {
      await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
      const reply = MSGS.outOfContext(botName);
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
      // ════════════════════════════════════════════════════════
      // NUEVO PROTOCOLO DE ATENCIÓN
      //   PASO 1: SERVICIO  (menú con letras + NLP + voz)
      //   PASO 2: EPS       (menú con letras + NLP + voz; Particular vive en BD)
      //   PASO 3: SLOTS o WAITLIST OPT-IN
      //   PASO 4: CÉDULA + (nombre si paciente nuevo) → CONFIRMACIÓN
      // ════════════════════════════════════════════════════════

      // ── SHORT-CIRCUIT: cédula post-opt-in a waitlist ─────────
      // El usuario aceptó entrar a la cola y nos faltaba su cédula.
      // En este caminito NO buscamos slots: directamente unimos a la cola.
      const waitlistPending = await this.redis.get(`temp_waitlist_pending:${organizationId}:${senderId}`);
      if (waitlistPending === '1' && finalCedula) {
        const soloNumeros = finalCedula.replace(/\D/g, '');
        if (!soloNumeros || soloNumeros.length < MIN_CEDULA_LENGTH) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          await this.redis.del(`temp_cedula:${organizationId}:${senderId}`);
          const reply = MSGS.cancelarCedulaInvalida();
          await this.smartReply(organizationId, senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.PATIENT_NOT_FOUND,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: { stage: 'WAITLIST_OPTIN_CEDULA_INVALID', cedula: finalCedula },
          });
          return;
        }

        const serviceIdWl = await this.redis.get(`temp_waitlist_service_id:${organizationId}:${senderId}`);
        const epsIdRawWl = await this.redis.get(`temp_waitlist_eps_id:${organizationId}:${senderId}`);
        const epsIdForWl = epsIdRawWl && epsIdRawWl.length > 0 ? epsIdRawWl : null;
        const serviceNameWl = await this.redis.get(`temp_especialidad:${organizationId}:${senderId}`) || '';

        if (!serviceIdWl) {
          const reply = MSGS.sesionExpirada();
          await this.smartReply(organizationId, senderId, reply);
          await this.cleanUpSession(organizationId, senderId);
          return;
        }

        // Si el paciente NO está registrado y no nos dio nombre, pedirlo.
        const existing = await this.prisma.patientProfile.findUnique({
          where: { cedula: finalCedula },
        });
        if (!existing && !finalNombre) {
          const reply = MSGS.primeraVez();
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_NAME);

          await this.interactionLog.logSuccess({
            whatsappId: senderId,
            organizationId,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              step: 'WAITLIST_OPTIN_ASK_NAME',
              cedula: finalCedula,
            },
          });
          return;
        }

        const nombreFinalWl = finalNombre || existing?.fullName || 'Paciente';
        const patientWl = await this.ensurePatientPersisted({
          cedula: finalCedula,
          nombre: nombreFinalWl,
          senderId,
          organizationId: organizationId!,
          epsId: epsIdForWl,
        });

        let positionWl = 1;
        let wlEntryId: string | null = null;
        if (patientWl) {
          try {
            const result = await this.waitlistService.joinWaitlist({
              patientId: patientWl.id,
              serviceId: serviceIdWl,
              epsId: epsIdForWl,
              whatsappId: senderId,
              organizationId: organizationId!,
            });
            positionWl = result.position;
            wlEntryId = result.id || null;
          } catch (e) {
            this.logger.error(`Error joinWaitlist (post-cedula): ${e.message}`);
          }
        }

        const replyOk = MSGS.unidoAWaitlist(nombreFinalWl, serviceNameWl, positionWl);
        await this.smartReply(organizationId, senderId, replyOk);

        if (wlEntryId && patientWl) {
          await this.interactionLog.logWaitlistJoined({
            whatsappId: senderId,
            organizationId: organizationId!,
            waitlistEntryId: wlEntryId,
            patientCedula: finalCedula,
            serviceName: serviceNameWl,
            epsName: '',
            position: positionWl,
            userMessage: text || '[audio]',
            botReply: replyOk,
          });
        }

        await this.cleanUpSession(organizationId, senderId);
        return;
      }

      // ── PASO 1: SERVICIO ─────────────────────────────────────
      let resolvedServiceId = savedEspecialidadId;
      let resolvedServiceName = savedEspecialidad;

      if (!resolvedServiceId) {
        // ¿Podemos resolverlo del input actual o de aiData?
        const inputForService = currentState === ChatState.AWAITING_SPECIALTY ? text : null;
        const match = await this.resolveServiceFromInput(
          organizationId,
          senderId,
          inputForService,
          finalEspecialidad || finalDoctor,
        );

        if (match) {
          resolvedServiceId = match.id;
          resolvedServiceName = match.name;
          await this.redis.set(`temp_especialidad:${organizationId}:${senderId}`, match.name, 'EX', SESSION_TTL);
          await this.redis.set(`temp_especialidad_id:${organizationId}:${senderId}`, match.id, 'EX', SESSION_TTL);
        } else if (currentState === ChatState.AWAITING_SPECIALTY && text) {
          // El usuario respondió algo que no pudimos mapear al menú → reintento
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const { lineas, count } = await this.buildServiceMenu(organizationId, senderId);
          const reply = count > 0
            ? MSGS.servicioInvalido(lineas)
            : MSGS.bienvenida(orgName, 'Ej: Medicina General, Odontología', botName);
          await this.smartReply(organizationId, senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.OUT_OF_CONTEXT,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              stage: 'SPECIALTY_INVALID',
              retriesCount: retriesCount + 1,
              maxRetries,
            },
          });
          return;
        }
      }

      if (!resolvedServiceId) {
        // Primera vez (o sesión limpia): renderizar menú
        const { lineas, count } = await this.buildServiceMenu(organizationId, senderId);
        const reply = count > 0
          ? MSGS.menuServicios(orgName, lineas, botName)
          : MSGS.bienvenida(orgName, 'Ej: Medicina General, Odontología', botName);
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);

        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: {
            step: 'SERVICE_MENU_SHOWN',
            previousState: currentState,
            newState: ChatState.AWAITING_SPECIALTY,
            servicesCount: count,
          },
        });
        return;
      }

      // ── PASO 2: EPS ──────────────────────────────────────────
      let resolvedEpsId = await this.redis.get(`temp_eps_id:${organizationId}:${senderId}`);
      let resolvedEpsName = await this.redis.get(`temp_eps_query:${organizationId}:${senderId}`);

      if (!resolvedEpsId || !resolvedEpsName) {
        const inputForEps = currentState === ChatState.AWAITING_EPS ? text : null;
        const match = await this.resolveEpsFromInput(
          organizationId,
          senderId,
          inputForEps,
          finalEps,
        );

        if (match) {
          resolvedEpsId = match.id;
          resolvedEpsName = match.name;
          await this.redis.set(`temp_eps_id:${organizationId}:${senderId}`, match.id, 'EX', SESSION_TTL);
          await this.redis.set(`temp_eps_query:${organizationId}:${senderId}`, match.name, 'EX', SESSION_TTL);
        } else if (currentState === ChatState.AWAITING_EPS && text) {
          // El usuario respondió algo no mapeable al menú → reintento
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const { lineas, count } = await this.buildEpsMenu(organizationId, senderId);
          const reply = count > 0
            ? MSGS.epsInvalida(lineas)
            : MSGS.pedirEps();
          await this.smartReply(organizationId, senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.EPS_NOT_FOUND,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              stage: 'EPS_INVALID',
              retriesCount: retriesCount + 1,
              maxRetries,
            },
          });
          return;
        }
      }

      if (!resolvedEpsId || !resolvedEpsName) {
        const { lineas, count } = await this.buildEpsMenu(organizationId, senderId);
        const reply = count > 0
          ? MSGS.menuEps(resolvedServiceName!, lineas)
          : MSGS.pedirEps();
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_EPS);

        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: {
            step: 'EPS_MENU_SHOWN',
            service: resolvedServiceName,
            epsCount: count,
          },
        });
        return;
      }

      // Pago directo → al reservar, no asociamos epsId al slot.
      const isParticular =
        (resolvedEpsName || '').toLowerCase() === PARTICULAR_EPS_NAME.toLowerCase();
      const epsIdForSlots: string | null = isParticular ? null : resolvedEpsId;
      const epsIdForPatient: string | null = isParticular ? null : resolvedEpsId;

      // ── PASO 3: SLOTS o WAITLIST OPT-IN ──────────────────────
      const selectedSlotId = await this.redis.get(`temp_selected_slot_id:${organizationId}:${senderId}`);

      if (!selectedSlotId) {
        const slots = await this.appointmentsService.getAvailableSlots(
          resolvedServiceName as string,
          epsIdForSlots,
          organizationId!,
        );

        if (slots.length === 0) {
          // Guardar contexto para que AWAITING_WAITLIST_OPTIN sepa qué hacer.
          await this.redis.set(`temp_waitlist_service_id:${organizationId}:${senderId}`, resolvedServiceId!, 'EX', SESSION_TTL);
          await this.redis.set(`temp_waitlist_eps_id:${organizationId}:${senderId}`, epsIdForPatient || '', 'EX', SESSION_TTL);

          const reply = MSGS.preguntaWaitlist(resolvedServiceName as string, resolvedEpsName);
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_WAITLIST_OPTIN);

          await this.interactionLog.logSuccess({
            whatsappId: senderId,
            organizationId,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              step: 'WAITLIST_OPTIN_OFFERED',
              service: resolvedServiceName,
              eps: resolvedEpsName,
            },
          });
          return;
        }

        // Hay slots: mostrar menú con letras y pedir selección.
        let lineasFechas = '';
        const slotsMetadata: any[] = [];
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

        const reply = MSGS.cuposDisponibles('', resolvedEpsName, lineasFechas);
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_DATE);

        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: {
            step: 'SLOTS_OFFERED',
            slotsCount: slots.length,
            slots: slotsMetadata,
            eps: resolvedEpsName,
            specialty: resolvedServiceName,
          },
        });
        return;
      }

      // ── PASO 4: CÉDULA (sólo si ya hay slot seleccionado) ────
      if (!finalCedula) {
        const fechaVista = await this.redis.get(`temp_selected_date_view:${organizationId}:${senderId}`);
        const fechaFormateada = fechaVista
          ? new Date(fechaVista).toLocaleString('es-CO', {
              weekday: 'long', day: 'numeric', month: 'long',
              hour: '2-digit', minute: '2-digit',
            })
          : '';
        const reply = MSGS.pedirCedulaPostSlot(fechaFormateada);
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CEDULA);

        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: {
            step: 'ASKING_CEDULA_POST_SLOT',
            specialty: resolvedServiceName,
            eps: resolvedEpsName,
          },
        });
        return;
      }

      // Validación de cédula (idéntica al flujo de cancelación).
      const soloNumerosAgendamiento = finalCedula.replace(/\D/g, '');
      if (!soloNumerosAgendamiento || soloNumerosAgendamiento.length < MIN_CEDULA_LENGTH) {
        await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
        await this.redis.del(`temp_cedula:${organizationId}:${senderId}`);
        const reply = MSGS.cancelarCedulaInvalida();
        await this.smartReply(organizationId, senderId, reply);

        await this.interactionLog.logFailure({
          whatsappId: senderId,
          organizationId,
          reason: FailureReason.PATIENT_NOT_FOUND,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: { stage: 'BOOKING_CEDULA_INVALID', cedula: finalCedula },
        });
        return;
      }

      // Cargar contexto del paciente.
      const patient = await this.prisma.patientProfile.findUnique({
        where: { cedula: finalCedula },
        include: { eps: true },
      });

      if (patient) {
        if (!finalNombre) {
          await this.redis.set(`temp_nombre:${organizationId}:${senderId}`, patient.fullName, 'EX', SESSION_TTL);
        }
      } else {
        // Paciente nuevo: pedir nombre.
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
          epsId: epsIdForPatient,
        });
      }

      // Asegurar persistencia con nombre + EPS final.
      if (finalCedula && finalNombre) {
        await this.ensurePatientPersisted({
          cedula: finalCedula,
          nombre: finalNombre,
          senderId,
          organizationId: organizationId!,
          epsId: epsIdForPatient,
        });
      }

      // Mostrar resumen y pasar a confirmación.
      const nombreAgend = finalNombre || patient?.fullName || 'Paciente';
      const fechaVistaFinal = await this.redis.get(`temp_selected_date_view:${organizationId}:${senderId}`);
      const fechaFormateadaResumen = fechaVistaFinal
        ? new Date(fechaVistaFinal).toLocaleString('es-CO', {
            weekday: 'long', day: 'numeric', month: 'long',
            hour: '2-digit', minute: '2-digit',
          })
        : '';
      const replyResumen = MSGS.resumenCita(
        nombreAgend,
        finalCedula,
        resolvedEpsName,
        resolvedServiceName as string,
        fechaFormateadaResumen,
      );
      await this.sendWhatsAppMessage(senderId, replyResumen);
      await this.setUserState(organizationId, senderId, ChatState.AWAITING_CONFIRMATION);

      await this.interactionLog.logSuccess({
        whatsappId: senderId,
        organizationId,
        userMessage: text || '[audio]',
        botReply: replyResumen,
        metadata: {
          step: 'BOOKING_SUMMARY_SHOWN',
          cedula: finalCedula,
          eps: resolvedEpsName,
          specialty: resolvedServiceName,
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

        const fechaFormateada = new Date(slotFechaStr).toLocaleString('es-CO', {
          weekday: 'long', day: 'numeric', month: 'long',
          hour: '2-digit', minute: '2-digit',
        });

        // Nuevo protocolo: tras elegir el slot, capturamos los datos del paciente.
        // Si el usuario ya tenía cédula en memoria (re-agendamiento), saltamos
        // directo al resumen para no preguntar dos veces.
        const cedulaPrevia = await this.redis.get(`temp_cedula:${organizationId}:${senderId}`);
        const nombrePrevio = await this.redis.get(`temp_nombre:${organizationId}:${senderId}`);

        if (cedulaPrevia) {
          // Paciente con cédula ya conocida → resumen + confirmación.
          const specAgend = await this.redis.get(`temp_especialidad:${organizationId}:${senderId}`) || 'Servicio';
          const epsAgend = await this.redis.get(`temp_eps_query:${organizationId}:${senderId}`) || 'EPS';
          const reply = MSGS.resumenCita(
            nombrePrevio || 'Paciente',
            cedulaPrevia,
            epsAgend,
            specAgend,
            fechaFormateada,
          );
          await this.sendWhatsAppMessage(senderId, reply);
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_CONFIRMATION);

          await this.interactionLog.logSuccess({
            whatsappId: senderId,
            organizationId,
            userMessage: text,
            botReply: reply,
            metadata: {
              step: 'SLOT_SELECTED_CEDULA_KNOWN',
              selectedLetter: letraElegida,
              slotId,
              slotDate: slotFechaStr,
            },
          });
          break;
        }

        // Sin cédula previa → pedir cédula (Paso 4 del protocolo).
        const reply = MSGS.pedirCedulaPostSlot(fechaFormateada);
        await this.sendWhatsAppMessage(senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_CEDULA);

        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text,
          botReply: reply,
          metadata: {
            step: 'SLOT_SELECTED_ASK_CEDULA',
            selectedLetter: letraElegida,
            slotId,
            slotDate: slotFechaStr,
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

      case ChatState.AWAITING_WAITLIST_OPTIN: {
        const respuesta = text?.toUpperCase().trim() || '';

        if (['SI', 'SÍ', 'SÍ.', 'SI.'].includes(respuesta)) {
          // El usuario acepta entrar a la cola de espera.
          const serviceId = await this.redis.get(`temp_waitlist_service_id:${organizationId}:${senderId}`);
          const epsIdRaw = await this.redis.get(`temp_waitlist_eps_id:${organizationId}:${senderId}`);
          const epsIdForWl = epsIdRaw && epsIdRaw.length > 0 ? epsIdRaw : null;
          const serviceName = await this.redis.get(`temp_especialidad:${organizationId}:${senderId}`) || '';
          const cedulaPrevia = await this.redis.get(`temp_cedula:${organizationId}:${senderId}`);
          const nombrePrevio = await this.redis.get(`temp_nombre:${organizationId}:${senderId}`);

          if (!serviceId) {
            const reply = MSGS.sesionExpirada();
            await this.smartReply(organizationId, senderId, reply);
            await this.cleanUpSession(organizationId, senderId);

            await this.interactionLog.logFailure({
              whatsappId: senderId,
              organizationId,
              reason: FailureReason.SESSION_EXPIRED,
              userMessage: text,
              botReply: reply,
              metadata: { stage: 'WAITLIST_OPTIN_NO_CONTEXT' },
            });
            return;
          }

          // Si todavía no tenemos cédula, la pedimos ahora (necesaria para la cola).
          if (!cedulaPrevia) {
            const reply =
              `Para unirle a la lista de espera, ¿me comparte su *número de cédula*?`;
            await this.smartReply(organizationId, senderId, reply);
            await this.setUserState(organizationId, senderId, ChatState.AWAITING_CEDULA);
            // Marcador para que la cascada sepa que estamos en flujo waitlist-pending
            await this.redis.set(`temp_waitlist_pending:${organizationId}:${senderId}`, '1', 'EX', SESSION_TTL);

            await this.interactionLog.logSuccess({
              whatsappId: senderId,
              organizationId,
              userMessage: text,
              botReply: reply,
              metadata: { step: 'WAITLIST_OPTIN_ASK_CEDULA' },
            });
            return;
          }

          const nombrePaciente = nombrePrevio || 'Paciente';
          const patientForWl = await this.ensurePatientPersisted({
            cedula: cedulaPrevia,
            nombre: nombrePaciente,
            senderId,
            organizationId: organizationId!,
            epsId: epsIdForWl,
          });

          let position = 1;
          let waitlistEntryId: string | null = null;
          if (patientForWl) {
            try {
              const result = await this.waitlistService.joinWaitlist({
                patientId: patientForWl.id,
                serviceId,
                epsId: epsIdForWl,
                whatsappId: senderId,
                organizationId: organizationId!,
              });
              position = result.position;
              waitlistEntryId = result.id || null;
            } catch (e) {
              this.logger.error(`Error agregando a waitlist (opt-in): ${e.message}`);
            }
          }

          const reply = MSGS.unidoAWaitlist(nombrePaciente, serviceName, position);
          await this.smartReply(organizationId, senderId, reply);

          if (waitlistEntryId && patientForWl) {
            await this.interactionLog.logWaitlistJoined({
              whatsappId: senderId,
              organizationId: organizationId!,
              waitlistEntryId,
              patientCedula: cedulaPrevia,
              serviceName,
              epsName: '',
              position,
              userMessage: text,
              botReply: reply,
            });
          } else {
            await this.interactionLog.logFailure({
              whatsappId: senderId,
              organizationId: organizationId!,
              reason: FailureReason.NO_AGENDA,
              userMessage: text,
              botReply: reply,
              metadata: {
                cedula: cedulaPrevia,
                specialty: serviceName,
                waitlistFailed: true,
              },
            });
          }

          await this.cleanUpSession(organizationId, senderId);

        } else if (['NO', 'NO.'].includes(respuesta)) {
          const reply = MSGS.noUnidoAWaitlist();
          await this.smartReply(organizationId, senderId, reply);
          await this.cleanUpSession(organizationId, senderId);

          await this.interactionLog.log({
            whatsappId: senderId,
            organizationId,
            status: InteractionStatus.ESCAPED,
            userMessage: text,
            botReply: reply,
            metadata: { event: 'WAITLIST_OPTIN_DECLINED' },
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
            metadata: { invalidResponse: respuesta, stage: 'WAITLIST_OPTIN' },
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

        if (!cedula || cedula.length < MIN_CEDULA_LENGTH) {
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

            const replyExito = MSGS.cancelarExitosa();
            await this.smartReply(organizationId, senderId, replyExito);

            // 📝 Auditoría: cancelación exitosa
            await this.interactionLog.logSuccess({
              whatsappId: senderId,
              organizationId,
              userMessage: text,
              botReply: replyExito,
              metadata: {
                event: 'APPOINTMENT_CANCELLED',
                appointmentId: aptId,
                slotId,
              },
            });

            // Liberar cupo y notificar waitlist ANTES de preguntar si desea agendar
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

            // Preguntar si desea agendar en otro horario
            const replyOfrecer = MSGS.cancelarOfreceAgendar();
            await this.smartReply(organizationId, senderId, replyOfrecer);
            await this.cleanUpCancelSession(organizationId, senderId);
            await this.setUserState(organizationId, senderId, ChatState.AWAITING_POST_CANCEL_CHOICE);

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
            await this.cleanUpCancelSession(organizationId, senderId);
          }

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

      case ChatState.AWAITING_POST_CANCEL_CHOICE: {
        const respuesta = text?.toUpperCase().trim() || '';

        if (['SI', 'SÍ', 'SÍ.', 'SI.'].includes(respuesta)) {
          // Tras cancelar, ofrecer menú con letras (Paso 1 del nuevo protocolo).
          const { lineas, count } = await this.buildServiceMenu(organizationId, senderId);
          const reply = count > 0
            ? MSGS.menuServicios(orgName, lineas, botName)
            : MSGS.bienvenida(orgName, 'Ej: Medicina General, Odontología', botName);
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_SPECIALTY);

          await this.interactionLog.logSuccess({
            whatsappId: senderId,
            organizationId,
            userMessage: text,
            botReply: reply,
            metadata: { event: 'POST_CANCEL_NEW_BOOKING_STARTED' },
          });

        } else if (['NO', 'NO.'].includes(respuesta)) {
          const reply = MSGS.cancelarDespedida();
          await this.smartReply(organizationId, senderId, reply);
          await this.cleanUpSession(organizationId, senderId);

          await this.interactionLog.logSuccess({
            whatsappId: senderId,
            organizationId,
            userMessage: text,
            botReply: reply,
            metadata: { event: 'POST_CANCEL_DECLINED' },
          });

        } else {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const reply = MSGS.respuestaInvalidaSiNo();
          await this.sendWhatsAppMessage(senderId, reply);
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
    // Sombra del pool de mensajes según el estilo activo de la org.
    const MSGS = buildMessages(await this.organizationSettings.getCommunicationStyle(organizationId));
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
      const reply = MSGS.waitlistCupoRechazado();
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
    // Sombra del pool de mensajes según el estilo activo de la org.
    const MSGS = buildMessages(await this.organizationSettings.getCommunicationStyle(organizationId));
    const patient = await this.prisma.patientProfile.findFirst({
      where: { cedula, organizationId },
    });

    if (!patient) {
      const reply = MSGS.cancelarPacienteNoExiste(cedula);
      await this.smartReply(organizationId, senderId, reply);
      // Mantener en AWAITING_CANCEL_CEDULA para que el usuario pueda reintentar sin reiniciar
      await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_CEDULA);

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
      // Sombra del pool de mensajes según el estilo activo de la org.
      const MSGS = buildMessages(await this.organizationSettings.getCommunicationStyle(organizationId));
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