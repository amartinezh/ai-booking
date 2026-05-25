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
  PARTICULAR_EPS_NAME,
  DEFAULT_MAX_RETRIES,
  SEMANTIC_MAP_TIMEOUT_MS,
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
import * as fs from 'fs';
import * as path from 'path';
import { LlmFactoryService } from '../llm/llm-factory.service';
import { SchedulingExtraction } from '../llm/interfaces/llm-provider.interface';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { ResolvedWhatsappCredentials } from '../whatsapp-config/dto/whatsapp-config.types';
import { SurveyService } from '../survey/survey.service';
import { TtsFactoryService } from '../audio-config/tts/tts-factory.service';
import { ResolutionStatus } from '@antigravity/database';

@Injectable()
export class ChatbotService implements OnModuleInit {
  private readonly logger = new Logger(ChatbotService.name);

  // Regex construidos dinámicamente desde chatbot-patterns.txt
  private escapeRegex: RegExp = /^(hola)$/i;
  private cancelRegex: RegExp = /^(cancelar cita)/i;
  // Frases de reprogramación ("cambiar mi cita", "reagendar", ...). Match de inicio.
  private modifyRegex: RegExp = /^(cambiar (mi |la )?cita|reprogramar|reagendar|modificar (mi |la )?cita|mover (mi |la )?cita)/i;
  private greetingRegex: RegExp = /^(hola)$/i;
  private particularRegex: RegExp = /^(particular)$/i;
  private farewellRegex: RegExp = /^(gracias)$/i;
  // 🛡️ Guardrail: detecta insultos en cualquier parte del mensaje (no ancla a inicio/fin).
  private insultRegex: RegExp = /\b(gonorrea|hijueputa|malparid[oa]|idiota|imb[eé]cil)\b/i;

  // Tesauro GENÉRICO de servicios (service-synonyms.txt). Cada concepto agrupa
  // "anclas" (frases que suelen estar en el nombre del catálogo) y "sinonimos"
  // (lenguaje natural del paciente). Todo normalizado al cargar. Se usa para
  // expandir la frase del paciente a anclas antes de caer al LLM.
  private serviceConcepts: Array<{ key: string; anchors: string[]; synonyms: string[] }> = [];

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
    private llmFactory: LlmFactoryService,
    private whatsappCredentials: WhatsappCredentialsService,
    private surveyService: SurveyService,
    private ttsFactory: TtsFactoryService,
  ) {}

  async onModuleInit() {
    this.loadPatterns();
    this.loadServiceSynonyms();
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
    const modifyPhrases: string[] = [];
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
      } else if (line === '[modify]') {
        currentSection = 'modify';
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
      } else if (currentSection === 'modify') {
        modifyPhrases.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
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
    if (modifyPhrases.length > 0) {
      this.modifyRegex = new RegExp(`^(${modifyPhrases.join('|')})`, 'i');
    }
    if (particularWords.length > 0) {
      this.particularRegex = new RegExp(`^(${particularWords.join('|')})$`, 'i');
    }
    if (insultWords.length > 0) {
      // No-anchored: detecta el insulto en cualquier parte del mensaje.
      this.insultRegex = new RegExp(`(?:^|\\s|[¡!¿?.,;])(${insultWords.join('|')})(?=$|\\s|[!?.,;])`, 'i');
    }

    this.logger.log(
      `Patrones listos — farewell: ${farewellWords.length}, greetings: ${greetingWords.length}, escape: ${escapeWords.length}, cancel: ${cancelPhrases.length}, modify: ${modifyPhrases.length}, particular: ${particularWords.length}, insults: ${insultWords.length}`,
    );
  }

  reloadPatterns(): void {
    this.loadPatterns();
    this.loadServiceSynonyms();
  }

  // ══════════════════════════════════════════════════════════════
  // TESAURO DE SERVICIOS (service-synonyms.txt) — genérico por concepto.
  // Lee anclas + sinónimos de cada concepto y los normaliza. No mapea a
  // serviceId: solo expande lenguaje natural → anclas para el matcher.
  // ══════════════════════════════════════════════════════════════
  private normalizeSynonym(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private loadServiceSynonyms(): void {
    const candidates = [
      path.resolve(__dirname, 'service-synonyms.txt'),
      path.resolve(process.cwd(), 'src', 'chatbot', 'service-synonyms.txt'),
    ];

    let content: string | null = null;
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, 'utf-8');
        this.logger.log(`Tesauro de servicios cargado desde: ${filePath}`);
        break;
      }
    }

    if (!content) {
      this.logger.warn('service-synonyms.txt no encontrado. Tesauro de servicios deshabilitado.');
      this.serviceConcepts = [];
      return;
    }

    const concepts: Array<{ key: string; anchors: string[]; synonyms: string[] }> = [];
    let current: { key: string; anchors: string[]; synonyms: string[] } | null = null;

    const parseList = (value: string): string[] =>
      value
        .split('|')
        .map((t) => this.normalizeSynonym(t))
        .filter((t) => t.length >= 3);

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const header = line.match(/^\[concepto:\s*([^\]]+)\]$/i);
      if (header) {
        current = { key: header[1].trim(), anchors: [], synonyms: [] };
        concepts.push(current);
        continue;
      }
      if (!current) continue;

      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const field = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1);
      if (field === 'anclas') current.anchors = parseList(value);
      else if (field === 'sinonimos') current.synonyms = parseList(value);
    }

    this.serviceConcepts = concepts.filter((c) => c.anchors.length > 0);
    const totalSyn = this.serviceConcepts.reduce((n, c) => n + c.synonyms.length + c.anchors.length, 0);
    this.logger.log(
      `Tesauro listo — conceptos: ${this.serviceConcepts.length}, términos: ${totalSyn}`,
    );
  }

  // Expande la frase del paciente a las ANCLAS de los conceptos cuyos
  // sinónimos/anclas aparezcan como secuencia de palabras completas en el
  // texto. Devuelve las anclas (más específicas primero, por longitud) para
  // probarlas contra el catálogo real con matchCatalogByName. No usa LLM.
  private expandToAnchors(text: string | null): string[] {
    const np = this.normalizeSynonym(text || '');
    if (np.length < 3 || this.serviceConcepts.length === 0) return [];
    const padded = ` ${np} `;

    const anchors: string[] = [];
    for (const concept of this.serviceConcepts) {
      const hit = [...concept.synonyms, ...concept.anchors].some(
        (term) => padded.includes(` ${term} `),
      );
      if (hit) {
        // Anclas de este concepto, más específicas (largas) primero.
        for (const a of [...concept.anchors].sort((x, y) => y.length - x.length)) {
          if (!anchors.includes(a)) anchors.push(a);
        }
      }
    }
    return anchors;
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 0: RESOLUCIÓN DE TENANT + CREDENCIALES WHATSAPP
  // ══════════════════════════════════════════════════════════════
  //
  // Para mensajes outbound necesitamos: phoneNumberId desde el que enviar
  // + accessToken (cifrado en DB). El "tenant" del destinatario se cachea
  // en Redis como `origin_org:${senderId}` durante el flujo entrante.
  // Si no hay caché, devolvemos null y el caller decide qué hacer.
  private async resolveCredentialsForRecipient(
    senderId: string,
  ): Promise<ResolvedWhatsappCredentials | null> {
    const orgId = await this.redis.get(`origin_org:${senderId}`);
    if (!orgId) return null;
    return this.whatsappCredentials.forOrg(orgId);
  }

  private async resolveCredentialsForOrg(
    organizationId: string,
  ): Promise<ResolvedWhatsappCredentials | null> {
    return this.whatsappCredentials.forOrg(organizationId);
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 1: ENVÍO DE MENSAJES OUTBOUND (META API)
  // 🛡️ A prueba de errores: nunca crashea el proceso.
  // 📝 Captura el último mensaje enviado para auditoría.
  // ══════════════════════════════════════════════════════════════
  private lastSentByUser = new Map<string, string>(); // En memoria, no persistente

  private async sendWhatsAppMessage(toPhone: string, text: string) {
    const creds = await this.resolveCredentialsForRecipient(toPhone);
    if (!creds) {
      this.logger.error(
        `CRÍTICO: no hay credenciales WhatsApp para ${toPhone}. El destinatario no está asociado a ninguna org configurada. Mensaje NO enviado.`,
      );
      return null;
    }
    if (!creds.isActive) {
      this.logger.error(
        `CRÍTICO: integración WhatsApp inactiva para org ${creds.organizationId}. Mensaje NO enviado a ${toPhone}.`,
      );
      return null;
    }

    const url = `https://graph.facebook.com/v19.0/${creds.phoneNumberId}/messages`;
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
              Authorization: `Bearer ${creds.accessToken}`,
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
          `🚨 Token de Meta inválido para org ${creds.organizationId}. ` +
            `Pídele al administrador de la clínica que regenere el Access Token ` +
            `en Configuración → Integraciones → Canal de WhatsApp.`,
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
  private async downloadWhatsAppAudio(
    mediaId: string,
    creds: ResolvedWhatsappCredentials,
  ): Promise<Buffer | null> {
    try {
      const token = creds.accessToken;
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

  private async extractDataWithLLM(
    organizationId: string,
    text: string | null,
    audioBuffer: Buffer | null,
    attempt = 1,
  ): Promise<SchedulingExtraction> {
    const provider = await this.llmFactory.forOrgOrNull(organizationId);
    if (!provider) {
      this.logger.warn(
        `Org ${organizationId} sin proveedor LLM configurado — usando fallback simple.`,
      );
      return {
        transcript: text, cedula: null, nombre: null, eps: null, especialidad: null, doctor: null,
        fechaSolicitada: null, intent: 'otro',
        isEscape: false, outOfContext: false, ininteligible: false,
        isFallback: true, isCancellation: false, isModification: false, isRateLimited: false,
      };
    }

    const maxRetries = await this.organizationSettings.getMaxRetries(organizationId);

    try {
      return await provider.extractSchedulingIntent({
        text,
        audio: audioBuffer
          ? { base64: audioBuffer.toString('base64'), mimeType: 'audio/ogg' }
          : null,
      });
    } catch (e) {
      // 429: cuota agotada — no reintentar (sería peor), no contar como fallo permanente
      if (e?.status === 429) {
        this.logger.warn(`${provider.name} rate limit (429) — usando fallback simple, sin incrementar contador de fallos`);
        return {
          transcript: text, cedula: null, nombre: null, eps: null, especialidad: null, doctor: null,
          fechaSolicitada: null, intent: 'otro',
          isEscape: false, outOfContext: false, ininteligible: false,
          isFallback: true, isCancellation: false, isModification: false, isRateLimited: true,
        };
      }
      if (attempt < maxRetries) {
        const delayMs = attempt * 1500;
        this.logger.warn(`${provider.name} intento ${attempt} fallido, reintentando en ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        return this.extractDataWithLLM(organizationId, text, audioBuffer, attempt + 1);
      }
      this.logger.error(`Error procesando IA con ${provider.name} tras ${maxRetries} intentos`, e);
      return {
        transcript: text, cedula: null, nombre: null, eps: null, especialidad: null, doctor: null,
        fechaSolicitada: null, intent: 'otro',
        isEscape: false, outOfContext: false, ininteligible: false,
        isFallback: true, isCancellation: false, isModification: false, isRateLimited: false,
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
      transcript: t || null,
      cedula: isOnlyDigits ? digits : null,
      // En el paso de nombre o EPS, pasar el texto raw para que el flujo lo procese
      nombre: currentState === ChatState.AWAITING_NAME ? (t || null) : null,
      eps: currentState === ChatState.AWAITING_EPS ? (t || null) : null,
      especialidad: currentState === ChatState.AWAITING_SPECIALTY ? (t || null) : null,
      doctor: null,
      fechaSolicitada: null,
      intent: 'otro' as const,
      isEscape: this.escapeRegex.test(t),
      outOfContext: false,
      ininteligible: false,
      isFallback: false,
      isCancellation: this.cancelRegex.test(t),
      isModification: this.modifyRegex.test(t),
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
  // DETECTOR DE INTENCIÓN DE AGENDAR (regex local, sin LLM)
  // Se usa en los pasos de menú (AWAITING_SPECIALTY / AWAITING_EPS) cuando el
  // texto NO mapeó a una opción: si el paciente está afirmando que quiere
  // agendar (ej: "sí quiero agendar una cita", "dale", "necesito una cita"),
  // re-presentamos el menú con calidez en vez del mensaje de "no entendí".
  // Nota: las PREGUNTAS abiertas ya las captura classifyIntentLocal ('faq')
  // y se evalúan ANTES, así "¿cuánto cuesta una cita?" no cae aquí.
  // ══════════════════════════════════════════════════════════════
  private looksLikeScheduleIntent(text: string): boolean {
    const t = (text || '').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!t) return false;

    // Afirmaciones al inicio del mensaje ("sí", "claro", "dale", "ok"...).
    const afirmacion =
      /^(si|sip|claro|dale|ok|okay|listo|bueno|vale|por supuesto|afirmativo|correcto|exacto|de una|eso es|asi es)\b/.test(t);

    // Verbos/sustantivos de agendamiento en cualquier parte del texto.
    const agendamiento =
      /\b(agendar|agendame|agendarme|agenda|reservar|reserva|programar|programarme|sacar|pedir|quiero|necesito|deseo|cita|citas|turno)\b/.test(t);

    return afirmacion || agendamiento;
  }

  // ══════════════════════════════════════════════════════════════
  // GUARDRAIL: ¿la respuesta de FAQ afirma disponibilidad de citas?
  // El RAG solo conoce la base de conocimiento (info general de la clínica),
  // NUNCA la agenda. Cualquier afirmación de cupo/espacio/turno disponible es
  // por definición fabricada. Detectamos dos clases:
  //   • DURAS: ofertas de cupo/espacio/turno/disponibilidad de cita → siempre
  //     se interceptan (jamás son legítimas vía RAG).
  //   • BLANDAS: "horario especial/exclusivo", "atención exclusiva" → solo se
  //     interceptan si la frase NO aparece textualmente en la KB (puede ser un
  //     horario de operación legítimamente documentado, p.ej. festivos).
  // ══════════════════════════════════════════════════════════════
  private faqClaimsAvailability(reply: string, kbContent: string | null): boolean {
    const norm = (s: string) =>
      (s || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const r = norm(reply);
    const kb = norm(kbContent || '');

    // Ofertas explícitas de disponibilidad de cita → nunca legítimas vía RAG.
    const hardPatterns: RegExp[] = [
      /(hay|tenemos|tengo|queda|quedan)\s+(un |una |unos |unas )?(espacio|espacios|cupo|cupos|turno|turnos|disponibilidad)\b/,
      /(espacio|espacios|cupo|cupos|turno|turnos)\s+(disponible|disponibles|libre|libres)\b/,
      /disponibilidad\s+(de|para)\s+(la |tu |su )?(cita|citas|agenda)\b/,
    ];
    if (hardPatterns.some((p) => p.test(r))) return true;

    // Afirmaciones de horario "especial/exclusivo": solo si no están en la KB.
    const softPatterns: RegExp[] = [
      /horario\s+(especial|exclusivo)/,
      /atencion\s+exclusiva/,
    ];
    for (const p of softPatterns) {
      const m = r.match(p);
      if (m && !kb.includes(m[0])) return true;
    }
    return false;
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

    // Mensaje seguro cuando el guardrail intercepta una afirmación de
    // disponibilidad: NO promete cupos, solo encamina al flujo de agendamiento
    // (única fuente real de la agenda).
    const availabilityRedirect =
      style === 'INFORMAL'
        ? `Para revisar la disponibilidad real y agendar tu cita, escríbeme *Hola* y seguimos el proceso paso a paso. 😊`
        : `Para revisar la disponibilidad real y agendar su cita, escríbame *Hola* y seguimos el proceso paso a paso. 😊`;

    const systemPrompt =
      `Eres *${botName}*, el recepcionista virtual de *${clinicName}*. ` +
      `Tu único rol en este momento es responder preguntas generales de pacientes ` +
      `basándote EXCLUSIVAMENTE en la BASE DE CONOCIMIENTO que se incluye a continuación.\n\n` +
      `${toneBlock}\n\n` +
      `REGLAS ESTRICTAS QUE DEBES SEGUIR:\n` +
      `1. NUNCA inventes información que no esté en la base de conocimiento.\n` +
      `2. ⛔ DISPONIBILIDAD DE CITAS: la base de conocimiento NO contiene cupos, ` +
      `agenda ni horarios libres de citas. NUNCA afirmes, inventes ni insinúes que ` +
      `hay un cupo, espacio, "horario especial" u "horario exclusivo" disponible ` +
      `para una EPS, servicio, médico o fecha. Esa información SOLO existe en el ` +
      `sistema de agendamiento, no aquí. Si el paciente pregunta por disponibilidad ` +
      `o por reservar un horario concreto, NO respondas con horas ni cupos: invítalo ` +
      `a iniciar el agendamiento (ver regla 8).\n` +
      `3. Solo puedes mencionar una hora/horario si está COPIADO TEXTUALMENTE de la ` +
      `base de conocimiento y corresponde a un horario de OPERACIÓN de la clínica ` +
      `(atención telefónica, farmacia, visitas, etc.), JAMÁS a la disponibilidad de ` +
      `una cita. No combines ni "deduzcas" horarios de fragmentos distintos.\n` +
      `4. Si la respuesta no está en la base de conocimiento, responde exactamente: ` +
      `"Esa información no está disponible en este momento. Para más detalles, ` +
      `comuníquese con nosotros al *${supportPhone}*."\n` +
      `5. Usa formato de WhatsApp: *negrita* para énfasis importante, guiones para listas. ` +
      `NO uses HTML ni markdown avanzado (#, ##, **).\n` +
      `6. Sé cálido, empático y profesional. Lenguaje sencillo y cercano — respeta el TONO Y ESTILO definido arriba.\n` +
      `7. Sé conciso: máximo 4 oraciones o puntos clave, salvo que la pregunta requiera más detalle.\n` +
      `8. Si el paciente menciona querer agendar una cita, indícale: ` +
      (style === 'INFORMAL'
        ? `"Para agendar, cuéntame qué especialidad necesitas o escríbeme *Hola* para empezar."\n`
        : `"Para agendar, indíqueme la especialidad que necesita o escriba *Hola* para comenzar."\n`) +
      `9. Termina SIEMPRE invitando sutilmente a agendar con ` +
      (style === 'INFORMAL'
        ? `"¿Te gustaría agendar una cita ahora? 😊"`
        : `"¿Desea agendar una cita ahora? 😊"`) +
      ` salvo que ya hayas derivado al teléfono de soporte. Esta invitación es la ` +
      `ÚNICA frase sobre agendar permitida: NUNCA la acompañes de una hora, cupo o ` +
      `disponibilidad concreta.\n\n` +
      `--- BASE DE CONOCIMIENTO ---\n` +
      `${kbContent}\n` +
      `--- FIN DE BASE DE CONOCIMIENTO ---\n\n` +
      `Responde la siguiente pregunta del paciente:`;

    try {
      const provider = await this.llmFactory.forOrgOrNull(organizationId);
      if (!provider) {
        const reply =
          `Esta clínica no tiene un proveedor de IA configurado. ` +
          `Para más detalles, comuníquese al *${supportPhone}*.`;
        await this.smartReply(organizationId, senderId, reply);
        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: question,
          botReply: reply,
          metadata: { step: 'FAQ_NO_PROVIDER' },
        });
        return;
      }

      const reply = await provider.answerFAQ(systemPrompt, question);

      // ── GUARDRAIL DE SALIDA (anti-alucinación de cupos) ──────────
      // El RAG NO conoce la agenda; aun con el prompt endurecido puede
      // recombinar fragmentos de la KB y afirmar un "horario especial" o un
      // cupo disponible. Si la respuesta hace una afirmación de DISPONIBILIDAD
      // que no está respaldada por la KB, la reemplazamos por un redirect seguro
      // al flujo de agendamiento (única fuente real de la agenda) y lo auditamos.
      if (this.faqClaimsAvailability(reply, kbContent)) {
        this.logger.warn(
          `FAQ interceptada por afirmar disponibilidad no respaldada: "${reply.slice(0, 160)}"`,
        );
        await this.smartReply(organizationId, senderId, availabilityRedirect);
        await this.interactionLog.logFailure({
          whatsappId: senderId,
          organizationId,
          reason: FailureReason.FAQ_HALLUCINATION,
          userMessage: question,
          botReply: availabilityRedirect,
          metadata: { step: 'FAQ_AVAILABILITY_BLOCKED', provider: provider.name, suppressedReply: reply },
        });
        return;
      }

      await this.smartReply(organizationId, senderId, reply);
      await this.interactionLog.logSuccess({
        whatsappId: senderId,
        organizationId,
        userMessage: question,
        botReply: reply,
        metadata: { step: 'FAQ_ANSWERED', provider: provider.name },
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
  private async generateTTS(
    organizationId: string,
    text: string,
  ): Promise<Buffer | null> {
    // El saneado (markdown/emojis) es agnóstico al proveedor; se hace una vez
    // aquí. La elección de motor y el fallback los resuelve TtsFactoryService
    // según la config de la organización.
    //
    // ⚠️ Unicode-safe: usamos la bandera `u` y `\p{Extended_Pictographic}` para
    // remover emojis por CODE POINT. La versión anterior listaba emojis en una
    // clase `[...]` sin `u`, lo que partía pares surrogate y dejaba surrogates
    // sueltos → UTF-8 inválido → ElevenLabs respondía 400 invalid_unicode. La
    // última pasada elimina cualquier surrogate suelto remanente (defensa final).
    const cleanText = text
      .replace(/[*_~`[\]]/g, '') // markdown
      .replace(/\p{Extended_Pictographic}/gu, '') // todos los emojis
      .replace(/[\u{FE00}-\u{FE0F}\u{200D}]/gu, '') // variation selectors + ZWJ
      .replace(/[\uD800-\uDFFF]/g, '') // surrogates sueltos remanentes
      .replace(/\s+/g, ' ')
      .trim();
    return this.ttsFactory.synthesize(organizationId, cleanText);
  }

  private async uploadToWhatsApp(
    audioBuffer: Buffer,
    creds: ResolvedWhatsappCredentials,
  ): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/ogg' });
      formData.append('file', blob, 'audio.ogg');
      const response = await fetch(
        `https://graph.facebook.com/v19.0/${creds.phoneNumberId}/media`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.accessToken}` },
          body: formData,
        },
      );
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

  private async sendWhatsAppAudioMessage(
    toPhone: string,
    mediaId: string,
    creds: ResolvedWhatsappCredentials,
  ) {
    try {
      await lastValueFrom(
        this.httpService.post(
          `https://graph.facebook.com/v19.0/${creds.phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: toPhone,
            type: 'audio',
            audio: { id: mediaId },
          },
          {
            headers: {
              Authorization: `Bearer ${creds.accessToken}`,
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
        const creds = await this.resolveCredentialsForOrg(organizationId);
        if (creds && creds.isActive) {
          const audioBuffer = await this.generateTTS(organizationId, text);
          if (audioBuffer) {
            const mediaId = await this.uploadToWhatsApp(audioBuffer, creds);
            if (mediaId) {
              await this.sendWhatsAppAudioMessage(senderId, mediaId, creds);
            }
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
  // HELPER 4b: ENCUESTA DE SATISFACCIÓN (CSAT) POST-CHAT
  // Al cerrar CUALQUIER flujo (cita, waitlist, insulto, error) generamos un
  // token de un solo uso y enviamos su enlace como ÚLTIMO mensaje de WhatsApp.
  //
  // Nunca lanza: si la encuesta falla, el flujo principal ya respondió y no
  // queremos que un error de CSAT tumbe la conversación.
  // ══════════════════════════════════════════════════════════════
  private async sendSurveyLink(
    organizationId: string,
    senderId: string,
    resolutionStatus: ResolutionStatus,
    options?: { patientId?: string | null; chatSummary?: string | null },
  ): Promise<void> {
    if (!organizationId) return;
    try {
      const token = await this.surveyService.generateSurveyToken({
        patientId: options?.patientId ?? null,
        organizationId,
        resolutionStatus,
        chatSummary: options?.chatSummary ?? null,
      });

      const baseUrl = (
        this.configService.get<string>('PUBLIC_WEB_URL') ||
        'https://agendamiento-ia.com'
      ).replace(/\/+$/, '');
      const url = `${baseUrl}/encuesta/${token}`;

      const message =
        `Antes de irnos, ¿me regala 10 segundos? 🙏\n\n` +
        `Por favor califique mi atención en este enlace seguro y único:\n${url}`;

      // Enlace como mensaje separado, posterior a la respuesta del flujo.
      await this.sendWhatsAppMessage(senderId, message);
    } catch (e) {
      this.logger.error(`No se pudo enviar el enlace de encuesta a ${senderId}: ${e.message}`);
    }
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
      `temp_waitlist_doctor_id:${organizationId}:${senderId}`,
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

  // ══════════════════════════════════════════════════════════════
  // HELPER 7: RESOLVER MÉDICO PREFERIDO (nombre libre → DoctorProfile.id)
  // El paciente puede escribir "Dr. Pérez", "pérez", "Juan Pérez"...
  // Devuelve el id SÓLO si hay UNA coincidencia activa inequívoca dentro
  // de la organización, para nunca asignar un médico equivocado a la cola.
  // ══════════════════════════════════════════════════════════════
  private async resolvePreferredDoctorId(
    organizationId: string,
    serviceId: string,
    doctorName: string | null | undefined,
  ): Promise<string | null> {
    if (!doctorName) return null;

    const clean = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // quita acentos
        .replace(/\b(dr|dra|doctor|doctora|medico|medico)\b\.?/g, '')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const needle = clean(doctorName);
    if (needle.length < 3) return null;

    const pickUnique = (doctors: { id: string; fullName: string }[]) => {
      const hits = doctors.filter((d) => {
        const hay = clean(d.fullName);
        return hay.includes(needle) || needle.includes(hay);
      });
      return hits.length === 1 ? hits[0].id : null;
    };

    // 1º intento: médicos activos de ESE servicio (más preciso).
    const byService = await this.prisma.doctorProfile.findMany({
      where: { organizationId, serviceId, isActive: true },
      select: { id: true, fullName: true },
    });
    const inService = pickUnique(byService);
    if (inService) return inService;

    // 2º intento: cualquier médico activo de la organización.
    const inOrg = await this.prisma.doctorProfile.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, fullName: true },
    });
    return pickUnique(inOrg);
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

  // Limpia el contexto efímero del flujo de reprogramación (espejo del de cancelación).
  private async cleanUpModifySession(organizationId: string, senderId: string) {
    const modifyKeys = await this.redis.keys(`temp_modify_*:${organizationId}:${senderId}`);
    if (modifyKeys.length > 0) await this.redis.del(...modifyKeys);
    const selectedKeys = await this.redis.keys(`temp_selected_modify_*:${organizationId}:${senderId}`);
    if (selectedKeys.length > 0) await this.redis.del(...selectedKeys);
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
  // Promesa con timeout: si `p` no resuelve en `ms`, rechaza. Lo usamos para
  // que una API de LLM lenta no congele el turno (clave en voz).
  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('SEMANTIC_MAP_TIMEOUT')), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
  }

  // ══════════════════════════════════════════════════════════════
  // MAPEO SEMÁNTICO (LLM) contra el catálogo real de la clínica.
  // Último recurso cuando letra/substring no resolvieron. Valida que el id
  // devuelto exista en el catálogo (anti-alucinación) y aplica timeout.
  // Devuelve null de forma segura ante cualquier fallo → cae al menú.
  // ══════════════════════════════════════════════════════════════
  private async semanticMatchFromCatalog(
    organizationId: string,
    phrase: string | null,
    entityKind: string,
    options: { id: string; name: string }[],
  ): Promise<{ id: string; name: string } | null> {
    const text = (phrase || '').trim();
    // Solo vale la pena para frases (no letras sueltas) y con catálogo no vacío.
    if (text.length < 4 || options.length === 0) return null;

    const provider = await this.llmFactory.forOrgOrNull(organizationId);
    if (!provider) return null;

    try {
      const result = await this.withTimeout(
        provider.mapEntityToCatalog({
          text,
          options: options.map((o) => ({ id: o.id, name: o.name })),
          entityKind,
        }),
        SEMANTIC_MAP_TIMEOUT_MS,
      );
      if (!result?.id) return null;
      // Validación dura: el id debe pertenecer al catálogo real de esta org.
      const match = options.find((o) => o.id === result.id);
      if (!match) {
        this.logger.warn(`Mapeo semántico (${entityKind}) devolvió id inexistente: ${result.id}`);
        return null;
      }
      this.logger.log(`🧭 Mapeo semántico (${entityKind}): "${text}" → ${match.name}`);
      return { id: match.id, name: match.name };
    } catch (e) {
      this.logger.warn(`Mapeo semántico (${entityKind}) falló/timeout: ${e?.message}`);
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // MATCH DETERMINISTA POR NOMBRE (bidireccional, sin LLM).
  // Compara la frase del usuario contra los nombres del catálogo en ambas
  // direcciones, con normalización (minúsculas, sin tildes) y límites de
  // palabra:
  //   • Frase CONTIENE el nombre  → "quiero una consulta externa" ⊇ "Consulta externa".
  //   • Nombre CONTIENE la frase   → "consulta" ⊆ "Consulta externa" (query corta).
  // Prefiere la coincidencia más específica (nombre más largo). Esto hace que
  // el bot reconozca lenguaje natural aunque el proveedor LLM esté apagado.
  // ══════════════════════════════════════════════════════════════
  private matchCatalogByName(
    phrase: string | null,
    options: { id: string; name: string }[],
  ): { id: string; name: string } | null {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const np = norm(phrase || '');
    if (np.length < 3) return null;
    const paddedPhrase = ` ${np} `;

    let exact: { id: string; name: string } | null = null;
    let phraseContainsName: { opt: { id: string; name: string }; len: number } | null = null;
    let nameContainsPhrase: { opt: { id: string; name: string }; len: number } | null = null;

    for (const o of options) {
      const nn = norm(o.name);
      if (nn.length < 3) continue;
      if (nn === np) {
        exact = { id: o.id, name: o.name };
        break;
      }
      // Dirección A: la frase del usuario contiene el nombre del catálogo
      // como secuencia de palabras completas. La más específica = nombre más largo.
      if (paddedPhrase.includes(` ${nn} `)) {
        if (!phraseContainsName || nn.length > phraseContainsName.len) {
          phraseContainsName = { opt: o, len: nn.length };
        }
      }
      // Dirección B: el nombre del catálogo contiene la frase (query corta).
      else if (` ${nn} `.includes(paddedPhrase)) {
        if (!nameContainsPhrase || nn.length < nameContainsPhrase.len) {
          nameContainsPhrase = { opt: o, len: nn.length };
        }
      }
    }

    if (exact) return exact;
    if (phraseContainsName) return { id: phraseContainsName.opt.id, name: phraseContainsName.opt.name };
    if (nameContainsPhrase) return { id: nameContainsPhrase.opt.id, name: nameContainsPhrase.opt.name };
    return null;
  }

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

    // Catálogo activo (lo reutilizamos para el match por nombre y el semántico).
    const services = await this.prisma.medicalService.findMany({
      where: { isActive: true, organizationId },
      select: { id: true, name: true },
    });

    // 2/3) Match determinista por nombre (bidireccional, sin LLM). Probamos
    // primero las palabras reales del usuario y, si existe, la pista de Gemini.
    const byName =
      this.matchCatalogByName(text, services) ||
      this.matchCatalogByName(geminiSpecialty, services);
    if (byName) return byName;

    // 2.5) Tesauro genérico (sin LLM): expande sinónimos del paciente
    // ("rayos x", "vacunas", "sicologo"…) a las anclas del concepto y las
    // prueba contra el catálogo real. Resuelve frases que no comparten
    // substring con el nombre del servicio. Si ningún ancla coincide con el
    // catálogo de ESTA clínica, sigue al LLM (red de seguridad).
    for (const anchor of [
      ...this.expandToAnchors(text),
      ...this.expandToAnchors(geminiSpecialty),
    ]) {
      const bySynonym = this.matchCatalogByName(anchor, services);
      if (bySynonym) {
        this.logger.log(`🔤 Tesauro: "${text ?? geminiSpecialty}" → ancla "${anchor}" → ${bySynonym.name}`);
        return bySynonym;
      }
    }

    // 4) Mapeo semántico (LLM) contra el catálogo real — último recurso.
    // Resuelve frases como "necesito una cita de consulta externa para mañana"
    // que el substring no captura. La frase original es la mejor señal.
    const phrase = (text || geminiSpecialty || '').trim();
    const semantic = await this.semanticMatchFromCatalog(
      organizationId,
      phrase,
      'servicio médico',
      services,
    );
    if (semantic) return semantic;

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
    // Catálogo de EPS activas (reutilizado por el match por nombre y el semántico).
    const epsList = await this.prisma.eps.findMany({
      where: { isActive: true, organizationId },
      select: { id: true, name: true },
    });

    // 3) Match determinista por nombre (bidireccional, sin LLM).
    const byName =
      this.matchCatalogByName(text, epsList) ||
      this.matchCatalogByName(geminiEps, epsList);
    if (byName) return byName;

    // 4) Mapeo semántico (LLM) contra el catálogo real de EPS — último recurso.
    const phrase = (text || geminiEps || '').trim();
    const semantic = await this.semanticMatchFromCatalog(
      organizationId,
      phrase,
      'EPS o aseguradora',
      epsList,
    );
    if (semantic) return semantic;

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
    // `text` puede reasignarse: cuando llega audio, lo sustituimos por la
    // transcripción literal del paciente para que la voz recorra EXACTAMENTE
    // el mismo camino determinista que el texto (ver rama `isAudio` abajo).
    let text = event.text?.body?.trim() || event.message?.text?.trim();
    const audioId = event.audio?.id;

    // ── IDENTIFICACIÓN DEL TENANT ──────────────────────────────
    // Meta envía `phone_number_id` en `value.metadata` del payload entrante.
    // Buscamos la WhatsappAccountConfig que lo tenga registrado para saber
    // a qué clínica enrutar el mensaje. Si no hay match, descartamos: NO
    // hay fallback global — eso violaba el aislamiento entre tenants.
    const metaPhoneId: string | undefined = event.metadata?.phone_number_id;

    let organizationId: string | null = null;
    let orgName = 'nuestra Clínica';
    let org: any = null;

    if (metaPhoneId) {
      const waConfig = await this.prisma.whatsappAccountConfig.findUnique({
        where: { phoneNumberId: metaPhoneId },
        include: { organization: true },
      });
      if (waConfig?.organization) {
        org = waConfig.organization;
        // Cacheamos el orgId del destinatario en Redis: lo usamos al hacer
        // outbound (resolveCredentialsForRecipient).
        await this.redis.set(`origin_org:${senderId}`, org.id, 'EX', SESSION_TTL);

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
      } else {
        this.logger.warn(
          `Webhook recibió phone_number_id=${metaPhoneId} pero no hay ninguna ` +
            `WhatsappAccountConfig que lo reclame. Mensaje descartado.`,
        );
        return;
      }
    } else {
      this.logger.warn(
        `Webhook recibió evento sin phone_number_id. Imposible enrutar tenant. Descartado.`,
      );
      return;
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

    // ⏱️ Marca de actividad: cada mensaje entrante de una conversación activa
    // refresca el TTL del estado. Así el cron de cierre por inactividad mide el
    // tiempo real desde el ÚLTIMO mensaje del paciente (no desde el último
    // cambio de estado), incluso en turnos que no avanzan el flujo (FAQ,
    // reintentos), evitando cerrar conversaciones que siguen activas.
    if (organizationId && currentState !== ChatState.IDLE) {
      await this.redis.expire(
        `chat_state:${organizationId}:${senderId}`,
        SESSION_TTL,
      );
    }

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

      // ⭐ CSAT: cierre por lenguaje abusivo.
      await this.sendSurveyLink(organizationId, senderId, ResolutionStatus.BLOCKED_INSULT, {
        chatSummary: 'Sesión cerrada por insulto detectado (regex).',
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

      // ⭐ CSAT: cierre por error técnico / exceso de reintentos.
      await this.sendSurveyLink(organizationId, senderId, ResolutionStatus.SYSTEM_ERROR, {
        chatSummary: `Sesión cerrada por exceso de reintentos (${maxRetries}).`,
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
      currentState === ChatState.AWAITING_POST_CANCEL_CHOICE ||
      // Pasos deterministas de reprogramación (letra / SÍ-NO; no llaman al LLM).
      currentState === ChatState.AWAITING_MODIFY_SELECTION ||
      currentState === ChatState.AWAITING_MODIFY_NEW_SLOT ||
      currentState === ChatState.AWAITING_MODIFY_CONFIRM ||
      currentState === ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL ||
      // Escenario 2: la confirmación de interrupción es un paso SÍ/NO por texto;
      // como los demás pasos estrictos, no llama al LLM y fluye al switch.
      currentState === ChatState.AWAITING_INTERRUPT_CONFIRMATION;

    // Pasos de lista de espera que esperan un SÍ/NO. A diferencia del resto de
    // pasos estrictos, ESTOS aceptan voz: el audio se transcribe y la respuesta
    // se normaliza con interpretYesNo (texto y voz sirven por igual).
    const isWaitlistYesNoStep =
      currentState === ChatState.AWAITING_WAITLIST_CONFIRM ||
      currentState === ChatState.AWAITING_WAITLIST_OPTIN;

    // Pasos de SELECCIÓN DE MENÚ (servicio / EPS). El texto en estos pasos
    // NO llama al LLM (ver más abajo), así que su `intent` queda en 'otro' y
    // jamás toca el router global de FAQ. La voz, en cambio, DEBE pasar por el
    // LLM para transcribirse, y el LLM clasifica como `consulta_faq` cualquier
    // mención de una EPS/servicio (ver shared-prompts: "EPS que atienden…").
    // Sin esta marca, una selección hablada como "Nueva EPS" se desviaría al
    // RAG de answerFAQ (que puede alucinar horarios/cupos) y nunca llegaría al
    // resolver del menú → el turno se pierde y el flujo parece reiniciarse.
    // Los resolvers de servicio/EPS ya atienden FAQs legítimas vía
    // classifyIntentLocal SIN perder el estado, así que aquí los dejamos pasar.
    const isMenuStep =
      currentState === ChatState.AWAITING_SPECIALTY ||
      currentState === ChatState.AWAITING_EPS;

    const isAudio = messageType === 'audio' && !!audioId;

    if (isAudio && isStrictStep && !isWaitlistYesNoStep) {
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

    // Intención de REPROGRAMAR detectada por patrón (sin LLM). La restringimos
    // a IDLE — la "primera interacción" — para no interrumpir un agendamiento
    // en curso; en turnos no-estrictos posteriores, el LLM (isModification) ya
    // cubre el cambio de intención. Tiene prioridad sobre el escape: frases como
    // "cambiar mi cita" empiezan por "cambiar" pero NO son un reinicio.
    const isQuickModify =
      messageType === 'text' &&
      !!text &&
      currentState === ChatState.IDLE &&
      this.modifyRegex.test(text.trim());

    // ══════════════════════════════════════════════════════════
    // 🧲 ESCENARIO 2 — INTERRUPCIÓN AMABLE DEL AGENDAMIENTO
    // Capa ADITIVA (Open/Closed): si el interceptor de intención de
    // cancelación (cancelRegex) dispara mientras el paciente está en un
    // estado AVANZADO del protocolo de agendamiento, NO abortamos de
    // inmediato (comportamiento anterior). Guardamos el estado en curso y
    // pedimos confirmación. El early-return impide que el flujo determinista
    // posterior (escape / cancelación directa) procese este turno; ningún
    // estado existente se reescribe.
    // Nota: el Escenario 1 (cancelación temprana en IDLE) NO entra aquí y
    // sigue cubierto por el camino existente (isCancellation → flujo de
    // cancelación → AWAITING_CANCEL_CEDULA).
    // ══════════════════════════════════════════════════════════
    const SCHEDULING_FLOW_STATES: ChatState[] = [
      ChatState.AWAITING_SPECIALTY,
      ChatState.AWAITING_EPS,
      ChatState.AWAITING_DATE,
      ChatState.AWAITING_NAME,
      ChatState.AWAITING_CEDULA,
      ChatState.AWAITING_CONFIRMATION,
    ];
    if (isQuickCancel && SCHEDULING_FLOW_STATES.includes(currentState)) {
      // Recordamos dónde estaba el paciente para retomar si responde NO.
      await this.redis.set(
        `temp_interrupt_prev_state:${organizationId}:${senderId}`,
        currentState,
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.interrupcionAgendamiento();
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_INTERRUPT_CONFIRMATION,
      );

      await this.interactionLog.log({
        whatsappId: senderId,
        organizationId,
        status: InteractionStatus.CANCELLATION_FLOW,
        userMessage: text || '[texto]',
        botReply: reply,
        metadata: {
          event: 'SCHEDULING_INTERRUPT_PROMPT',
          interruptedState: currentState,
        },
      });
      return;
    }

    let aiData: SchedulingExtraction = {
      transcript: null,
      cedula: null,
      nombre: null,
      eps: null,
      especialidad: null,
      doctor: null,
      fechaSolicitada: null,
      intent: 'otro',
      isEscape: false,
      outOfContext: false,
      ininteligible: false,
      isFallback: false,
      isCancellation: false,
      isModification: false,
      isRateLimited: false,
    };

    if (isQuickCancel && currentState === ChatState.IDLE) {
      aiData.isCancellation = true;
    } else if (isQuickModify) {
      // "cambiar/reprogramar mi cita" en IDLE → reprogramación determinista (sin LLM).
      aiData.isModification = true;
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
      currentState === ChatState.IDLE
    ) {
      // ── PROTOCOLO DEL PRIMER TURNO (Fase 1) ──────────────────
      // Entrada abierta: cualquier texto inicial del paciente (que no fuera
      // un saludo/escape/cancelación puros, ya atendidos arriba sin gastar
      // LLM) pasa por el extractor, que en UNA sola llamada realiza:
      //   Tarea A — guardrail de seguridad (intent='insulto_abuso')
      //   Tarea B — extracción de entidades (cédula, nombre, EPS, etc.)
      //   Tarea C — clasificación de intención (agendar_cita | consulta_faq | otro)
      // El branching por intención se centraliza en el INTENT ROUTER (abajo).
      aiData = await this.extractDataWithLLM(organizationId, text, null);
    } else if (isAudio) {
      await this.redis.set(`is_ai_flow:${organizationId}:${senderId}`, 'true', 'EX', SESSION_TTL);
      await this.sendWhatsAppMessage(senderId, '🎧 Permítame un momento, lo estoy escuchando...');
      const audioCreds = await this.resolveCredentialsForOrg(organizationId);
      const audioBuffer = audioCreds
        ? await this.downloadWhatsAppAudio(audioId, audioCreds)
        : null;
      if (audioBuffer) {
        aiData = await this.extractDataWithLLM(organizationId, text, audioBuffer);
        // ⭐ Unificación voz↔texto: adoptamos la transcripción literal como el
        // `text` del turno. A partir de aquí el audio recorre el MISMO camino
        // determinista que el texto (match por nombre contra el catálogo en
        // los pasos de menú, FAQ, reprompts), evitando que valores como
        // "consulta externa" —que el LLM no extrae como `especialidad`— se
        // pierdan. Solo lo hacemos si la transcripción tiene contenido útil.
        if (aiData.transcript && aiData.transcript.trim()) {
          text = aiData.transcript.trim();
        }
      } else {
        aiData.ininteligible = true;
      }
    } else if (
      messageType === 'text' &&
      text &&
      (currentState === ChatState.AWAITING_CEDULA ||
        currentState === ChatState.AWAITING_CANCEL_CEDULA ||
        currentState === ChatState.AWAITING_MODIFY_CEDULA)
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
      currentState === ChatState.AWAITING_NAME
    ) {
      // En el paso de nombre capturamos el texto TAL CUAL, sin llamar a Gemini.
      // Antes el nombre pasaba por el extractor y el clasificador de seguridad
      // podía marcar apellidos legítimos (p.ej. "Negro") como intent='insulto_abuso',
      // disparando el guardrail y borrando toda la sesión. Aquí ya pedimos un
      // nombre libre de forma explícita; las palabras de escape ("salir",
      // "cancelar") ya fueron capturadas por isQuickEscape más arriba.
      aiData.nombre = text.trim();
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
      aiData = await this.extractDataWithLLM(organizationId, text, null);
    }

    this.logger.log(`🧠 LLM extrajo: ${JSON.stringify(aiData)}`);

    // ══════════════════════════════════════════════════════════
    // 🎙️ CÉDULA POR VOZ — NORMALIZACIÓN AGRESIVA DEL STT + SAFEGUARD
    // ──────────────────────────────────────────────────────────
    // Para TEXTO ya extrajimos los dígitos directo con regex (rama de arriba):
    // por eso "por texto sí finaliza". La VOZ, en cambio, depende de que el LLM
    // devuelva `cedula`, pero el STT introduce ruido que el extractor no espera:
    // separadores ("1.088.123", "10 88 12 34"), muletillas ("mi cédula es…") o
    // números en palabras ("uno cero ocho ocho"). Si el LLM no devolvió una
    // cédula limpia, `aiData.cedula` queda null → `finalCedula` null → el
    // short-circuit de waitlist-pending se salta y el flujo recae en la oferta
    // de lista de espera ("¿Te anoto? SÍ/NO") en bucle.
    //
    // Aquí aplicamos a la transcripción la MISMA intención que al texto, pero
    // tolerante al ruido del STT: palabras→dígitos y luego solo dígitos. Solo
    // afecta a VOZ en pasos de cédula; el flujo de texto queda intacto.
    if (
      isAudio &&
      (currentState === ChatState.AWAITING_CEDULA ||
        currentState === ChatState.AWAITING_CANCEL_CEDULA ||
        currentState === ChatState.AWAITING_MODIFY_CEDULA)
    ) {
      const fromLlm = (aiData.cedula || '').replace(/\D/g, '');
      const fromTranscript = this.extractCedulaFromSpeech(text);
      const cedulaVoz = fromLlm.length > 0 ? fromLlm : fromTranscript;

      this.logger.log(
        `[Tenant: ${organizationId}] 🎙️ CEDULA_VOZ paciente=${senderId} estado=${currentState} ` +
        `sttCrudo="${text ?? ''}" llmCedula="${aiData.cedula ?? ''}" normalizada="${cedulaVoz}"`,
      );

      if (cedulaVoz.length > 0) {
        // Adoptamos la cédula normalizada para que la cascada (finalCedula) y el
        // short-circuit de waitlist la vean igual que si hubiera llegado por texto.
        aiData.cedula = cedulaVoz;
      } else if (!aiData.isEscape && !aiData.isCancellation && !aiData.isModification) {
        // Sin dígitos tras normalizar: NO reentramos al flujo (evita el loop de
        // SÍ/NO). Reintento acotado pidiendo la cédula por texto; al agotar
        // maxReintentos, el guard del inicio cierra con maxReintentosReset.
        const newRetries = retriesCount + 1;
        await this.redis.set(retriesKey, newRetries.toString(), 'EX', SESSION_TTL);
        const reply = MSGS.ininteligible();
        await this.sendWhatsAppMessage(senderId, reply);

        this.logger.warn(
          `[Tenant: ${organizationId}] 🎙️ Cédula por voz no extraíble (sttCrudo="${text ?? ''}") ` +
          `— pidiendo cédula por TEXTO. Reintento ${newRetries}/${maxRetries}.`,
        );

        await this.interactionLog.logFailure({
          whatsappId: senderId,
          organizationId,
          reason: FailureReason.UNINTELLIGIBLE_AUDIO,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: {
            stage: 'CEDULA_VOICE_UNRESOLVED',
            state: currentState,
            sttTranscript: text ?? null,
            retriesCount: newRetries,
          },
        });
        return;
      }
    }

    // ── CONTADOR DE FALLOS LLM (por organización) ──────────────
    // Antes "GEMINI_DOWN_THRESHOLD"; el umbral ahora vive en
    // OrganizationSettings.maxRetriesPerStep (consistente con la config por clínica).
    const geminiFailKey = `gemini_fail_count:${organizationId}`;
    const geminiDownThreshold = await this.organizationSettings.getMaxRetries(organizationId);

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

    // ══════════════════════════════════════════════════════════
    // 🔄 INICIO DEL FLUJO DE MODIFICACIÓN / REPROGRAMACIÓN
    // Espejo del arranque de cancelación: si traemos cédula, buscamos las
    // citas de una vez; si no, la pedimos. La cita NO se toca hasta que el
    // paciente confirme un nuevo horario (o decida cancelarla si no hay cupos).
    // ══════════════════════════════════════════════════════════
    if (aiData.isModification || isQuickModify) {
      await this.cleanUpSession(organizationId, senderId);
      await this.redis.set(
        `is_ai_flow:${organizationId}:${senderId}`,
        isAudio ? 'true' : 'false',
        'EX',
        SESSION_TTL,
      );

      let reply: string;
      if (aiData.cedula) {
        await this.redis.set(`temp_modify_cedula:${organizationId}:${senderId}`, aiData.cedula, 'EX', SESSION_TTL);
        await this.handleModifyCedulaStep(organizationId, senderId, aiData.cedula);
        reply = this.lastSentByUser.get(senderId) || '[modificación iniciada]';
      } else {
        reply = MSGS.modificarPedirCedula();
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_MODIFY_CEDULA);
      }

      // 📝 Auditoría: inicio de flujo de modificación
      await this.interactionLog.log({
        whatsappId: senderId,
        organizationId,
        status: InteractionStatus.MODIFICATION_FLOW,
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: { aiData, hasInitialCedula: !!aiData.cedula, event: 'MODIFY_FLOW_START' },
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

    // ══════════════════════════════════════════════════════════
    // INTENT ROUTER (Fase 2 — Branching dinámico)
    // Actúa cuando el LLM produjo una clasificación real (no fallback)
    // y NO estamos en un paso estricto de selección (donde el input es una
    // letra/opción, no lenguaje libre). Esto cubre el Primer Turno (IDLE) y
    // los turnos subsiguientes no-estrictos (Fase 4: el paciente puede
    // cambiar de intención a mitad del agendamiento, p.ej. lanzar una FAQ).
    // ══════════════════════════════════════════════════════════
    if (!aiData.isFallback && !isStrictStep) {
      // ── Tarea A: insulto/abuso → respuesta firme y cierre de sesión ──
      // Defensa en profundidad: complementa el guardrail por regex (que ya
      // atrapó los casos obvios antes de gastar una llamada al LLM).
      if (aiData.intent === 'insulto_abuso') {
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
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: { guardrail: 'INSULT_LLM', previousState: currentState },
        });

        // ⭐ CSAT: cierre por lenguaje abusivo (detección LLM).
        await this.sendSurveyLink(organizationId, senderId, ResolutionStatus.BLOCKED_INSULT, {
          chatSummary: 'Sesión cerrada por insulto detectado (LLM).',
        });
        return;
      }

      // ── Tarea C: consulta_faq → RAG sobre la base de conocimiento ──
      // No cambia el estado: si el paciente venía agendando, conserva su
      // progreso y la respuesta cierra invitando a continuar.
      // ⚠️ En pasos de menú (servicio/EPS) NO desviamos a FAQ aquí: una
      // selección hablada ("Nueva EPS") la clasifica el LLM como consulta_faq
      // y se perdería el turno. El resolver del menú (más abajo) intenta primero
      // mapear la selección y, si de verdad es una pregunta abierta, llama a
      // answerFAQ él mismo SIN perder el estado (vía classifyIntentLocal).
      if (
        aiData.intent === 'consulta_faq' &&
        !isMenuStep &&
        !!text &&
        (await this.knowledgeBase.hasContent(organizationId))
      ) {
        await this.answerFAQ(text, organizationId, senderId, org, botName);
        return;
      }
    }

    // En los pasos SÍ/NO de la cola con una respuesta usable (texto o transcripción
    // de voz), saltamos los guardas de outOfContext/ininteligible: el LLM tiende a
    // marcar un "sí"/"no" suelto como fuera de contexto y bloquearía el turno.
    const waitlistVoiceAnswer = isWaitlistYesNoStep && !!text && !!text.trim();

    // Voz en pasos de menú (servicio/EPS): el LLM, sin contexto conversacional,
    // marca una EPS suelta ("Sura", "Nueva EPS") como outOfContext/ininteligible
    // y los guardas de abajo cortarían el turno ANTES del resolver del menú →
    // el paciente regraba y vuelve a fallar (loop). Igual que en waitlist,
    // dejamos pasar el transcript: el resolver determinista mapea
    // letra/nombre/Particular/semántico y, si de verdad no mapea, reprompta el
    // menú SIN perder el estado (mejor que el reset genérico "fuera de contexto").
    // El texto en estos pasos no llama al LLM, así que estos flags ya eran false:
    // sin regresión por escrito.
    const menuVoiceAnswer = isMenuStep && !!text && !!text.trim();

    if (aiData.outOfContext && !waitlistVoiceAnswer && !menuVoiceAnswer) {
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

    if (aiData.ininteligible && !waitlistVoiceAnswer && !menuVoiceAnswer) {
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

    // ══════════════════════════════════════════════════════════
    // ACK DEL PRIMER TURNO (Fase 2 — Acknowledge)
    // Si en el PRIMER mensaje (estado IDLE) el LLM extrajo entidades para
    // agendar, el Agente las confirma ANTES de pedir lo que falta. La cédula
    // se VALIDA contra PostgreSQL antes de darla por confirmada (Fase 3).
    // No hace `return`: tras el ACK, el flujo continúa hacia el primer dato
    // faltante (servicio → EPS → slot...), evitando re-preguntar lo conocido.
    // ══════════════════════════════════════════════════════════
    // Marca si en este turno ya enviamos el ACK del primer turno. Si es así,
    // el render del menú de servicios que viene a continuación NO debe volver
    // a saludar (evita el doble mensaje: ACK + bienvenida completa).
    let sentTurn1Ack = false;

    const extrajoEntidadesTurno1 = !!(
      aiData.cedula || aiData.nombre || aiData.eps ||
      aiData.especialidad || aiData.doctor || aiData.fechaSolicitada
    );
    if (
      currentState === ChatState.IDLE &&
      !aiData.isCancellation &&
      extrajoEntidadesTurno1
    ) {
      let cedulaAck: string | null = null;
      let nombreAck: string | null = aiData.nombre;

      if (aiData.cedula) {
        const soloNumeros = aiData.cedula.replace(/\D/g, '');
        // No validamos longitud: se acepta cualquier número de cédula.
        if (soloNumeros.length > 0) {
          // Validación contra PostgreSQL antes de "confirmar" la cédula.
          const paciente = await this.prisma.patientProfile.findUnique({
            where: { cedula: aiData.cedula },
            select: { fullName: true },
          });
          cedulaAck = aiData.cedula;
          if (paciente?.fullName) {
            nombreAck = nombreAck || paciente.fullName;
            // El paciente ya existe → no volver a pedir el nombre más adelante.
            await this.redis.set(`temp_nombre:${organizationId}:${senderId}`, paciente.fullName, 'EX', SESSION_TTL);
          }
        } else {
          // Formato inválido: no la damos por confirmada ni la arrastramos.
          await this.redis.del(`temp_cedula:${organizationId}:${senderId}`);
        }
      }

      const ack = MSGS.ackTurno1({
        nombre: nombreAck,
        cedula: cedulaAck,
        especialidad: aiData.especialidad,
        eps: aiData.eps,
        fecha: aiData.fechaSolicitada,
      });
      await this.smartReply(organizationId, senderId, ack);
      sentTurn1Ack = true;

      await this.interactionLog.logSuccess({
        whatsappId: senderId,
        organizationId,
        userMessage: text || '[audio]',
        botReply: ack,
        metadata: {
          step: 'TURN1_ACK',
          intent: aiData.intent,
          extracted: {
            cedula: cedulaAck,
            nombre: nombreAck,
            especialidad: aiData.especialidad,
            eps: aiData.eps,
            doctor: aiData.doctor,
            fecha: aiData.fechaSolicitada,
          },
        },
      });
    }

    const isCancelFlow =
      currentState === ChatState.AWAITING_CANCEL_CEDULA ||
      currentState === ChatState.AWAITING_CANCEL_SELECTION ||
      currentState === ChatState.AWAITING_CANCEL_CONFIRM;

    // El flujo de reprogramación tiene su propia máquina de estados (switch) y
    // NO debe pasar por la cascada de agendamiento (servicio→EPS→slots).
    const isModifyFlow =
      currentState === ChatState.AWAITING_MODIFY_CEDULA ||
      currentState === ChatState.AWAITING_MODIFY_SELECTION ||
      currentState === ChatState.AWAITING_MODIFY_NEW_SLOT ||
      currentState === ChatState.AWAITING_MODIFY_CONFIRM ||
      currentState === ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL;

    // ══════════════════════════════════════════════════════════
    // FLUJO PRINCIPAL DE AGENDAMIENTO (pasos no-estrictos)
    // ══════════════════════════════════════════════════════════
    if (!isStrictStep && !isCancelFlow && !isModifyFlow) {
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
        // No validamos longitud: se acepta cualquier número (solo rechazo si viene vacío).
        if (!soloNumeros) {
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
        const preferredDoctorIdWl = (await this.redis.get(`temp_waitlist_doctor_id:${organizationId}:${senderId}`)) || null;
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
              preferredDoctorId: preferredDoctorIdWl,
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

        // ⭐ CSAT: flujo cerrado en lista de espera → encuesta.
        await this.sendSurveyLink(organizationId, senderId, ResolutionStatus.QUEUED, {
          patientId: patientWl?.id ?? null,
          chatSummary: `Ingresó a lista de espera de ${serviceNameWl} (posición ${positionWl}).`,
        });

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
          // No mapeó a un servicio del menú. Antes de marcar reintento,
          // ¿es una pregunta abierta (FAQ)? Si hay KB y el texto luce como
          // pregunta, respondemos desde la base de conocimiento SIN perder el
          // estado del menú (el usuario sigue en AWAITING_SPECIALTY y puede
          // elegir su letra después). Esto evita que "¿qué servicios tienen?"
          // caiga en el mensaje de "servicio inválido".
          if (
            this.classifyIntentLocal(text) === 'faq' &&
            (await this.knowledgeBase.hasContent(organizationId))
          ) {
            await this.answerFAQ(text, organizationId, senderId, org, botName);
            return;
          }
          // ¿El paciente confirma que quiere agendar (ej: "sí quiero agendar
          // una cita")? No es una opción del menú, pero tampoco un error: le
          // re-presentamos el menú con calidez y SIN penalizar reintentos.
          if (this.looksLikeScheduleIntent(text)) {
            const { lineas, count } = await this.buildServiceMenu(organizationId, senderId);
            const reply = count > 0
              ? MSGS.repromptAgendarServicio(lineas)
              : MSGS.bienvenida(orgName, 'Ej: Medicina General, Odontología', botName);
            await this.smartReply(organizationId, senderId, reply);

            await this.interactionLog.logSuccess({
              whatsappId: senderId,
              organizationId,
              userMessage: text || '[audio]',
              botReply: reply,
              metadata: { step: 'SPECIALTY_REPROMPT_SCHEDULE_INTENT', servicesCount: count },
            });
            return;
          }
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
        // Si acabamos de enviar el ACK del primer turno, usamos el reprompt
        // (que NO vuelve a saludar) en vez de la bienvenida completa, para no
        // mandar dos saludos seguidos en el mismo turno.
        const reply = count > 0
          ? (sentTurn1Ack
              ? MSGS.repromptAgendarServicio(lineas)
              : MSGS.menuServicios(orgName, lineas, botName))
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
          // No mapeó a una EPS del menú. Igual que en el paso de servicio:
          // si es una pregunta abierta y hay KB, respondemos desde la base de
          // conocimiento sin perder el estado (sigue en AWAITING_EPS).
          if (
            this.classifyIntentLocal(text) === 'faq' &&
            (await this.knowledgeBase.hasContent(organizationId))
          ) {
            await this.answerFAQ(text, organizationId, senderId, org, botName);
            return;
          }
          // Afirmación de agendar en el paso de EPS → re-presentar el menú de
          // EPS con calidez, sin penalizar reintentos.
          if (this.looksLikeScheduleIntent(text)) {
            const { lineas, count } = await this.buildEpsMenu(organizationId, senderId);
            const reply = count > 0
              ? MSGS.repromptAgendarEps(lineas)
              : MSGS.pedirEps();
            await this.smartReply(organizationId, senderId, reply);

            await this.interactionLog.logSuccess({
              whatsappId: senderId,
              organizationId,
              userMessage: text || '[audio]',
              botReply: reply,
              metadata: { step: 'EPS_REPROMPT_SCHEDULE_INTENT', epsCount: count },
            });
            return;
          }
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

          // Médico preferido (si el paciente lo mencionó): nombre libre → id inequívoco.
          const preferredDoctorIdForWl = await this.resolvePreferredDoctorId(
            organizationId!,
            resolvedServiceId!,
            finalDoctor,
          );
          if (preferredDoctorIdForWl) {
            await this.redis.set(
              `temp_waitlist_doctor_id:${organizationId}:${senderId}`,
              preferredDoctorIdForWl,
              'EX',
              SESSION_TTL,
            );
          } else {
            // Evita arrastrar un médico de una solicitud anterior si esta no aplica.
            await this.redis.del(`temp_waitlist_doctor_id:${organizationId}:${senderId}`);
          }

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

      // Validación de cédula: no validamos longitud, se acepta cualquier número
      // (solo rechazo si viene vacío/sin dígitos).
      const soloNumerosAgendamiento = finalCedula.replace(/\D/g, '');
      if (!soloNumerosAgendamiento) {
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
            // ⭐ CSAT: flujo cerrado con cita agendada → encuesta.
            await this.sendSurveyLink(organizationId, senderId, ResolutionStatus.BOOKED, {
              patientId: patient.id,
              chatSummary: `Cita agendada (${specFinal}) para ${fechaFormateada}.`,
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
        // Acepta SÍ/NO por texto y por voz (transcripción), de forma tolerante.
        const decision = this.interpretYesNo(text);

        if (decision === 'SI') {
          // El usuario acepta entrar a la cola de espera.
          const serviceId = await this.redis.get(`temp_waitlist_service_id:${organizationId}:${senderId}`);
          const epsIdRaw = await this.redis.get(`temp_waitlist_eps_id:${organizationId}:${senderId}`);
          const epsIdForWl = epsIdRaw && epsIdRaw.length > 0 ? epsIdRaw : null;
          const preferredDoctorIdOptin = (await this.redis.get(`temp_waitlist_doctor_id:${organizationId}:${senderId}`)) || null;
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
                preferredDoctorId: preferredDoctorIdOptin,
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

        } else if (decision === 'NO') {
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

        // No validamos longitud: se acepta cualquier número (solo rechazo si viene vacío).
        if (!cedula) {
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

          // ⭐ ESCENARIO 3 — CSAT: el flujo principal de cancelación cerró con
          // éxito (cita ya cancelada en AWAITING_CANCEL_CONFIRM) y el paciente
          // declinó reagendar → este es el punto terminal del flujo. Si en
          // cambio acepta reagendar, el cierre BOOKED engancha su propia
          // encuesta, evitando enviar dos encuestas en una misma sesión.
          await this.sendSurveyLink(organizationId, senderId, ResolutionStatus.CANCELLED, {
            chatSummary: 'Cita cancelada con éxito; el paciente no quiso reagendar.',
          });

        } else {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const reply = MSGS.respuestaInvalidaSiNo();
          await this.sendWhatsAppMessage(senderId, reply);
        }
        break;
      }

      // ══════════════════════════════════════════════════════════
      // ESCENARIO 2 — CONFIRMACIÓN DE INTERRUPCIÓN DEL AGENDAMIENTO
      // El paciente pidió cancelar a mitad del agendamiento; aquí decide si
      // realmente interrumpe (SÍ → flujo de cancelación) o retoma (NO →
      // restaura el estado guardado). Caso nuevo y aislado: no toca el resto
      // de la máquina de estados.
      // ══════════════════════════════════════════════════════════
      case ChatState.AWAITING_INTERRUPT_CONFIRMATION: {
        // Tolerante a SÍ/NO natural (texto), igual que los demás pasos SÍ/NO.
        const decision = this.interpretYesNo(text);
        const prevState = await this.redis.get(
          `temp_interrupt_prev_state:${organizationId}:${senderId}`,
        );

        if (decision === 'SI') {
          // Confirmó: abandonamos el agendamiento e iniciamos la cancelación,
          // reutilizando el MISMO arranque del flujo existente (pedir cédula).
          await this.redis.del(`temp_interrupt_prev_state:${organizationId}:${senderId}`);
          await this.cleanUpSession(organizationId, senderId);
          await this.redis.set(
            `is_ai_flow:${organizationId}:${senderId}`,
            'false',
            'EX',
            SESSION_TTL,
          );
          const reply = MSGS.cancelarPedirCedula();
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(organizationId, senderId, ChatState.AWAITING_CANCEL_CEDULA);

          await this.interactionLog.log({
            whatsappId: senderId,
            organizationId,
            status: InteractionStatus.CANCELLATION_FLOW,
            userMessage: text,
            botReply: reply,
            metadata: { event: 'SCHEDULING_INTERRUPT_CONFIRMED', interruptedState: prevState },
          });

        } else if (decision === 'NO') {
          // Rechazó: restauramos el estado anterior y retomamos el agendamiento
          // justo donde iba. El estado restaurado hace que el próximo mensaje
          // del paciente se procese en el paso correcto.
          await this.redis.del(`temp_interrupt_prev_state:${organizationId}:${senderId}`);
          const restoreState = (prevState as ChatState) || ChatState.AWAITING_SPECIALTY;
          await this.setUserState(organizationId, senderId, restoreState);
          const reply = MSGS.interrupcionRetomar();
          await this.smartReply(organizationId, senderId, reply);

          await this.interactionLog.log({
            whatsappId: senderId,
            organizationId,
            status: InteractionStatus.ESCAPED,
            userMessage: text,
            botReply: reply,
            metadata: { event: 'SCHEDULING_INTERRUPT_DECLINED', restoredState: restoreState },
          });

        } else {
          // No se entendió la respuesta: re-preguntamos SÍ/NO y penalizamos
          // reintento, igual que el resto de pasos estrictos.
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const reply = MSGS.respuestaInvalidaSiNo();
          await this.sendWhatsAppMessage(senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.SESSION_EXPIRED,
            userMessage: text,
            botReply: reply,
            metadata: { invalidResponse: text, stage: 'INTERRUPT_CONFIRM' },
          });
        }
        break;
      }

      // ══════════════════════════════════════════════════════════
      // FLUJO DE MODIFICACIÓN / REPROGRAMACIÓN
      // ══════════════════════════════════════════════════════════
      case ChatState.AWAITING_MODIFY_CEDULA: {
        let cedula = '';
        if (aiData.cedula) {
          cedula = aiData.cedula;
        } else if (text) {
          cedula = text.replace(/\D/g, '');
        }

        if (!cedula) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const reply = MSGS.cancelarCedulaInvalida();
          await this.smartReply(organizationId, senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.PATIENT_NOT_FOUND,
            userMessage: text,
            botReply: reply,
            metadata: { stage: 'MODIFY_CEDULA_INVALID' },
          });
          return;
        }

        await this.redis.set(`temp_modify_cedula:${organizationId}:${senderId}`, cedula, 'EX', SESSION_TTL);
        await this.handleModifyCedulaStep(organizationId, senderId, cedula);
        break;
      }

      case ChatState.AWAITING_MODIFY_SELECTION: {
        const letraElegida = text?.toUpperCase().trim() || '';
        const aptId = await this.redis.get(`temp_modify_apt_${letraElegida}:${organizationId}:${senderId}`);
        const slotId = await this.redis.get(`temp_modify_slot_${letraElegida}:${organizationId}:${senderId}`);

        if (!aptId || !slotId) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const maxLetra = await this.redis.get(`temp_modify_max_letra:${organizationId}:${senderId}`) || 'A';
          const reply = `No reconozco esa opción. Por favor responda con una de las letras disponibles (A${maxLetra !== 'A' ? `–${maxLetra}` : ''}).`;
          await this.smartReply(organizationId, senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.SESSION_EXPIRED,
            userMessage: text,
            botReply: reply,
            metadata: { invalidLetter: letraElegida, stage: 'MODIFY_SELECTION' },
          });
          return;
        }

        await this.redis.set(`temp_selected_modify_apt:${organizationId}:${senderId}`, aptId, 'EX', SESSION_TTL);
        await this.redis.set(`temp_selected_modify_slot:${organizationId}:${senderId}`, slotId, 'EX', SESSION_TTL);
        await this.offerModifySlots(organizationId, senderId, aptId);
        break;
      }

      case ChatState.AWAITING_MODIFY_NEW_SLOT: {
        const letraElegida = text?.toUpperCase().trim() || '';
        const newSlotId = await this.redis.get(`temp_modify_newslot_${letraElegida}:${organizationId}:${senderId}`);
        const newSlotFecha = await this.redis.get(`temp_modify_newslot_${letraElegida}_fecha:${organizationId}:${senderId}`);

        if (!newSlotId || !newSlotFecha) {
          await this.redis.set(retriesKey, (retriesCount + 1).toString(), 'EX', SESSION_TTL);
          const maxLetra = await this.redis.get(`temp_modify_newslot_max_letra:${organizationId}:${senderId}`) || 'A';
          const reply = `No reconozco esa opción. Por favor responda con una de las letras disponibles (A${maxLetra !== 'A' ? `–${maxLetra}` : ''}).`;
          await this.smartReply(organizationId, senderId, reply);

          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.SESSION_EXPIRED,
            userMessage: text,
            botReply: reply,
            metadata: { invalidLetter: letraElegida, stage: 'MODIFY_NEW_SLOT' },
          });
          return;
        }

        await this.redis.set(`temp_selected_modify_newslot:${organizationId}:${senderId}`, newSlotId, 'EX', SESSION_TTL);
        await this.redis.set(`temp_selected_modify_newslot_fecha:${organizationId}:${senderId}`, newSlotFecha, 'EX', SESSION_TTL);

        const aptId = await this.redis.get(`temp_selected_modify_apt:${organizationId}:${senderId}`);
        const apt = aptId
          ? await this.prisma.appointment.findUnique({
              where: { id: aptId },
              include: { scheduleSlot: { include: { doctor: true, service: true } } },
            })
          : null;

        if (!apt) {
          const reply = MSGS.sesionExpirada();
          await this.smartReply(organizationId, senderId, reply);
          await this.cleanUpModifySession(organizationId, senderId);
          await this.interactionLog.logFailure({
            whatsappId: senderId,
            organizationId,
            reason: FailureReason.SESSION_EXPIRED,
            userMessage: text,
            botReply: reply,
            metadata: { stage: 'MODIFY_NEW_SLOT_NO_APT' },
          });
          return;
        }

        const fechaActual = new Date(apt.scheduleSlot.startTime).toLocaleString('es-CO', {
          weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        });
        const fechaNueva = new Date(newSlotFecha).toLocaleString('es-CO', {
          weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        });
        const reply = MSGS.modificarConfirmar(
          apt.scheduleSlot.service.name,
          apt.scheduleSlot.doctor.fullName,
          fechaActual,
          fechaNueva,
        );
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(organizationId, senderId, ChatState.AWAITING_MODIFY_CONFIRM);

        await this.interactionLog.logSuccess({
          whatsappId: senderId,
          organizationId,
          userMessage: text,
          botReply: reply,
          metadata: {
            step: 'MODIFY_NEW_SLOT_SELECTED',
            appointmentId: apt.id,
            newSlotId,
          },
        });
        break;
      }

      case ChatState.AWAITING_MODIFY_CONFIRM: {
        const decision = this.interpretYesNo(text);

        if (decision === 'SI') {
          const aptId = await this.redis.get(`temp_selected_modify_apt:${organizationId}:${senderId}`);
          const oldSlotId = await this.redis.get(`temp_selected_modify_slot:${organizationId}:${senderId}`);
          const newSlotId = await this.redis.get(`temp_selected_modify_newslot:${organizationId}:${senderId}`);
          const newSlotFecha = await this.redis.get(`temp_selected_modify_newslot_fecha:${organizationId}:${senderId}`);

          if (!aptId || !oldSlotId || !newSlotId || !newSlotFecha) {
            const reply = MSGS.sesionExpirada();
            await this.smartReply(organizationId, senderId, reply);
            await this.cleanUpModifySession(organizationId, senderId);

            await this.interactionLog.logFailure({
              whatsappId: senderId,
              organizationId,
              reason: FailureReason.SESSION_EXPIRED,
              userMessage: text,
              botReply: reply,
              metadata: { stage: 'MODIFY_CONFIRM_NO_DATA' },
            });
            return;
          }

          try {
            // Reprogramación atómica: validamos que el nuevo cupo siga libre,
            // movemos la cita a él, liberamos el cupo anterior y ocupamos el nuevo.
            await this.prisma.$transaction(async (tx) => {
              const newSlot = await tx.scheduleSlot.findUnique({ where: { id: newSlotId } });
              if (!newSlot || !newSlot.isAvailable || newSlot.organizationId !== organizationId) {
                throw new Error('NEW_SLOT_TAKEN');
              }
              await tx.appointment.update({
                where: { id: aptId },
                data: { scheduleSlotId: newSlotId },
              });
              await tx.scheduleSlot.update({
                where: { id: oldSlotId },
                data: { isAvailable: true },
              });
              await tx.scheduleSlot.update({
                where: { id: newSlotId },
                data: { isAvailable: false },
              });
            });

            const fechaNuevaFmt = new Date(newSlotFecha).toLocaleString('es-CO', {
              weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
            });
            const replyOk = MSGS.modificarExitosa(fechaNuevaFmt);
            await this.smartReply(organizationId, senderId, replyOk);

            await this.interactionLog.logSuccess({
              whatsappId: senderId,
              organizationId,
              userMessage: text,
              botReply: replyOk,
              metadata: {
                event: 'APPOINTMENT_RESCHEDULED',
                appointmentId: aptId,
                oldSlotId,
                newSlotId,
              },
            });

            // El cupo anterior queda libre → notificar a la lista de espera.
            const freedSlot = await this.prisma.scheduleSlot.findUnique({
              where: { id: oldSlotId },
              include: { doctor: true },
            });
            if (freedSlot) {
              try {
                await this.waitlistService.notifyWaitlist({
                  slotId: freedSlot.id,
                  serviceId: freedSlot.serviceId,
                  epsId: freedSlot.allowedEpsId,
                  organizationId: organizationId!,
                  doctorName: freedSlot.doctor.fullName,
                  slotDate: freedSlot.startTime,
                });
              } catch (e) {
                this.logger.error(`Error notificando waitlist (reprogramación): ${e.message}`);
              }
            }

            await this.cleanUpModifySession(organizationId, senderId);
            // ⭐ CSAT: la reprogramación deja una cita activa → encuesta BOOKED.
            await this.sendSurveyLink(organizationId, senderId, ResolutionStatus.BOOKED, {
              chatSummary: `Cita reprogramada para ${fechaNuevaFmt}.`,
            });
          } catch (e) {
            this.logger.error('Error reprogramando cita', e);
            // El nuevo cupo fue tomado por otro paciente entre tanto → volver a ofrecer.
            if (e.message === 'NEW_SLOT_TAKEN') {
              const reply = MSGS.slotTomado();
              await this.smartReply(organizationId, senderId, reply);
              await this.interactionLog.logFailure({
                whatsappId: senderId,
                organizationId,
                reason: FailureReason.SLOT_TAKEN,
                userMessage: text,
                botReply: reply,
                metadata: { stage: 'MODIFY_NEW_SLOT_TAKEN', appointmentId: aptId, newSlotId },
              });
              // Reofrecemos cupos frescos para el mismo appointment.
              await this.offerModifySlots(organizationId, senderId, aptId);
              return;
            }
            const reply = MSGS.modificarError();
            await this.smartReply(organizationId, senderId, reply);
            await this.interactionLog.logFailure({
              whatsappId: senderId,
              organizationId,
              reason: FailureReason.MODIFY_ERROR,
              userMessage: text,
              botReply: reply,
              metadata: { error: e.message, appointmentId: aptId },
            });
            await this.cleanUpModifySession(organizationId, senderId);
          }
        } else if (decision === 'NO') {
          // No confirma el cambio → dejamos la cita en su fecha original.
          const reply = MSGS.modificarAbortada();
          await this.smartReply(organizationId, senderId, reply);
          await this.cleanUpModifySession(organizationId, senderId);

          await this.interactionLog.log({
            whatsappId: senderId,
            organizationId,
            status: InteractionStatus.ESCAPED,
            userMessage: text,
            botReply: reply,
            metadata: { event: 'MODIFY_ABORTED' },
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
            metadata: { invalidResponse: text, stage: 'MODIFY_CONFIRM' },
          });
        }
        break;
      }

      case ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL: {
        // No había cupos para reprogramar. SÍ → cancelamos la cita; NO → no tocamos nada.
        const decision = this.interpretYesNo(text);

        if (decision === 'SI') {
          const aptId = await this.redis.get(`temp_selected_modify_apt:${organizationId}:${senderId}`);
          const slotId = await this.redis.get(`temp_selected_modify_slot:${organizationId}:${senderId}`);

          if (!aptId || !slotId) {
            const reply = MSGS.sesionExpirada();
            await this.smartReply(organizationId, senderId, reply);
            await this.cleanUpModifySession(organizationId, senderId);

            await this.interactionLog.logFailure({
              whatsappId: senderId,
              organizationId,
              reason: FailureReason.SESSION_EXPIRED,
              userMessage: text,
              botReply: reply,
              metadata: { stage: 'MODIFY_NO_SLOTS_CANCEL_NO_DATA' },
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

            await this.interactionLog.logSuccess({
              whatsappId: senderId,
              organizationId,
              userMessage: text,
              botReply: replyExito,
              metadata: { event: 'APPOINTMENT_CANCELLED', via: 'MODIFY_NO_SLOTS', appointmentId: aptId, slotId },
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
                this.logger.error(`Error notificando waitlist (cancelación vía modify): ${e.message}`);
              }
            }

            // Reutilizamos el cierre del flujo de cancelación: ofrecer reagendar.
            const replyOfrecer = MSGS.cancelarOfreceAgendar();
            await this.smartReply(organizationId, senderId, replyOfrecer);
            await this.cleanUpModifySession(organizationId, senderId);
            await this.setUserState(organizationId, senderId, ChatState.AWAITING_POST_CANCEL_CHOICE);
          } catch (e) {
            this.logger.error('Error cancelando cita (vía modify)', e);
            const reply = MSGS.cancelarError();
            await this.smartReply(organizationId, senderId, reply);

            await this.interactionLog.logFailure({
              whatsappId: senderId,
              organizationId,
              reason: FailureReason.CANCEL_ERROR,
              userMessage: text,
              botReply: reply,
              metadata: { error: e.message, appointmentId: aptId, via: 'MODIFY_NO_SLOTS' },
            });
            await this.cleanUpModifySession(organizationId, senderId);
          }
        } else if (decision === 'NO') {
          // El paciente prefiere conservar su cita: NO tocamos nada.
          const reply = MSGS.modificarSinCambios();
          await this.smartReply(organizationId, senderId, reply);
          await this.cleanUpModifySession(organizationId, senderId);

          await this.interactionLog.log({
            whatsappId: senderId,
            organizationId,
            status: InteractionStatus.ESCAPED,
            userMessage: text,
            botReply: reply,
            metadata: { event: 'MODIFY_NO_SLOTS_KEEP_APPOINTMENT' },
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
            metadata: { invalidResponse: text, stage: 'MODIFY_NO_SLOTS_CANCEL' },
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
  // Interpreta una respuesta afirmativa/negativa de forma tolerante, sirviendo
  // tanto para texto escrito como para transcripciones de voz. Normaliza
  // acentos y puntuación, y acepta variantes naturales ("sí, claro", "no
  // gracias", "dale", "negativo"). Devuelve 'SI' | 'NO' | null.
  // Normaliza una transcripción de STT a la cédula numérica que contiene.
  // Tolera el "ruido" típico del audio: separadores y puntuación
  // ("1.088.123", "10 88 12 34"), muletillas ("mi cédula es…") y números
  // dictados en palabras ("uno cero ocho ocho"). Devuelve solo dígitos
  // (cadena vacía si no hay ninguno). NO valida longitud — esa regla vive en
  // el handler del paso (igual que en el flujo de texto).
  private extractCedulaFromSpeech(text: string | undefined | null): string {
    if (!text) return '';
    const wordToDigit: Record<string, string> = {
      cero: '0', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4',
      cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9',
    };
    const normalized = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // quita tildes (marcas diacriticas)
      .replace(/[a-z]+/g, (w) => (w in wordToDigit ? wordToDigit[w] : ' ')); // palabra→dígito; resto fuera
    // Tras mapear palabras numéricas, conservamos únicamente dígitos.
    return normalized.replace(/\D/g, '');
  }

  private interpretYesNo(text: string | undefined | null): 'SI' | 'NO' | null {
    if (!text) return null;
    const t = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quita tildes (marcas diacriticas)
      .replace(/[^\w\s]/g, ' ') // signos de puntuación → espacio
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return null;

    const noRegex = /\b(no|nop|nel|negativo|nunca|cancelar|cancela|para nada|no gracias)\b/;
    const siRegex = /\b(si|sip|sii+|claro|dale|ok|okay|oka|listo|bueno|vale|por supuesto|afirmativo|correcto|exacto|de una|asi es|eso es|confirmo|confirmar|acepto|aceptar|quiero|deseo)\b/;

    // "no" gana cuando aparece explícito (p.ej. "no quiero", "no gracias") para
    // evitar falsos positivos con palabras afirmativas en la misma frase.
    if (noRegex.test(t)) return 'NO';
    if (siRegex.test(t)) return 'SI';
    return null;
  }

  private async handleWaitlistConfirmStep(
    organizationId: string,
    senderId: string,
    text: string | undefined,
  ) {
    // Sombra del pool de mensajes según el estilo activo de la org.
    const MSGS = buildMessages(await this.organizationSettings.getCommunicationStyle(organizationId));
    const respuesta = text?.toUpperCase().trim() || '';
    // Acepta SÍ/NO por texto y por voz (transcripción), de forma tolerante.
    const decision = this.interpretYesNo(text);

    if (decision === 'SI') {
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

    } else if (decision === 'NO') {
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
  // FLUJO DE BÚSQUEDA POR CÉDULA PARA MODIFICACIÓN (REPROGRAMACIÓN)
  // Espejo de handleCancelCedulaStep: ubica al paciente, lista sus citas
  // próximas y, cuando hay una sola, pasa directo a buscar nuevos cupos.
  // ══════════════════════════════════════════════════════════════
  private async handleModifyCedulaStep(
    organizationId: string,
    senderId: string,
    cedula: string,
  ) {
    const MSGS = buildMessages(await this.organizationSettings.getCommunicationStyle(organizationId));
    const patient = await this.prisma.patientProfile.findFirst({
      where: { cedula, organizationId },
    });

    if (!patient) {
      const reply = MSGS.modificarPacienteNoExiste(cedula);
      await this.smartReply(organizationId, senderId, reply);
      // Permite reintentar la cédula sin reiniciar el flujo.
      await this.setUserState(organizationId, senderId, ChatState.AWAITING_MODIFY_CEDULA);

      await this.interactionLog.logFailure({
        whatsappId: senderId,
        organizationId,
        reason: FailureReason.PATIENT_NOT_FOUND,
        userMessage: cedula,
        botReply: reply,
        metadata: { searchedCedula: cedula, flow: 'MODIFY' },
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
      const reply = MSGS.modificarSinCitas(cedula);
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(organizationId, senderId, ChatState.IDLE);

      await this.interactionLog.logFailure({
        whatsappId: senderId,
        organizationId,
        reason: FailureReason.NO_APPOINTMENTS_TO_MODIFY,
        userMessage: cedula,
        botReply: reply,
        metadata: { patientCedula: cedula, patientId: patient.id },
      });
      return;
    }

    if (activeAppointments.length === 1) {
      // Cita única → la fijamos y pasamos directo a ofrecer nuevos horarios.
      const apt = activeAppointments[0];
      await this.redis.set(`temp_selected_modify_apt:${organizationId}:${senderId}`, apt.id, 'EX', SESSION_TTL);
      await this.redis.set(`temp_selected_modify_slot:${organizationId}:${senderId}`, apt.scheduleSlotId, 'EX', SESSION_TTL);
      await this.offerModifySlots(organizationId, senderId, apt.id);
      return;
    }

    let lineas = '';
    activeAppointments.forEach((apt, idx) => {
      const letra = String.fromCharCode(65 + idx);
      this.redis.set(`temp_modify_apt_${letra}:${organizationId}:${senderId}`, apt.id, 'EX', SESSION_TTL);
      this.redis.set(`temp_modify_slot_${letra}:${organizationId}:${senderId}`, apt.scheduleSlotId, 'EX', SESSION_TTL);
      this.redis.set(`temp_modify_max_letra:${organizationId}:${senderId}`, letra, 'EX', SESSION_TTL);
      const fecha = new Date(apt.scheduleSlot.startTime).toLocaleString('es-CO', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
      });
      lineas += `*${letra})* ${apt.scheduleSlot.service.name} · Dr. ${apt.scheduleSlot.doctor.fullName} · ${fecha}\n`;
    });

    const reply = MSGS.modificarSeleccionar(patient.fullName, lineas);
    await this.smartReply(organizationId, senderId, reply);
    await this.setUserState(organizationId, senderId, ChatState.AWAITING_MODIFY_SELECTION);

    await this.interactionLog.logSuccess({
      whatsappId: senderId,
      organizationId,
      userMessage: cedula,
      botReply: reply,
      metadata: {
        step: 'MODIFY_SHOWING_MULTIPLE',
        appointmentsCount: activeAppointments.length,
        patientCedula: cedula,
      },
    });
  }

  // ══════════════════════════════════════════════════════════════
  // OFRECER NUEVOS CUPOS PARA REPROGRAMAR LA CITA SELECCIONADA
  // Busca espacios del MISMO servicio/EPS (excluyendo el cupo actual). Si no
  // hay → ofrece cancelar la cita (AWAITING_MODIFY_NO_SLOTS_CANCEL). Si hay →
  // muestra el menú con letras (AWAITING_MODIFY_NEW_SLOT). NO toca la cita aún.
  // ══════════════════════════════════════════════════════════════
  private async offerModifySlots(
    organizationId: string,
    senderId: string,
    appointmentId: string,
  ) {
    const MSGS = buildMessages(await this.organizationSettings.getCommunicationStyle(organizationId));

    const apt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { scheduleSlot: { include: { doctor: true, service: true } } },
    });

    if (!apt) {
      const reply = MSGS.sesionExpirada();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpModifySession(organizationId, senderId);
      await this.interactionLog.logFailure({
        whatsappId: senderId,
        organizationId,
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: '[modify]',
        botReply: reply,
        metadata: { stage: 'MODIFY_OFFER_SLOTS_NO_APT', appointmentId },
      });
      return;
    }

    const serviceName = apt.scheduleSlot.service.name;
    const fechaActual = new Date(apt.scheduleSlot.startTime).toLocaleString('es-CO', {
      weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit',
    });

    const slots = await this.appointmentsService.getAvailableSlots(
      serviceName,
      apt.epsId,
      organizationId,
    );
    // Excluimos el cupo que el paciente ya tiene (no tiene sentido "moverla" al mismo).
    const candidateSlots = slots.filter((s) => s.slotId !== apt.scheduleSlotId);

    if (candidateSlots.length === 0) {
      // Sin cupos alternativos → ofrecer cancelar la cita actual.
      const reply = MSGS.modificarSinCupos(serviceName);
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(organizationId, senderId, ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL);

      await this.interactionLog.logSuccess({
        whatsappId: senderId,
        organizationId,
        userMessage: '[modify]',
        botReply: reply,
        metadata: {
          step: 'MODIFY_NO_SLOTS_OFFER_CANCEL',
          appointmentId,
          service: serviceName,
        },
      });
      return;
    }

    let lineas = '';
    const slotsMetadata: any[] = [];
    for (let i = 0; i < candidateSlots.length; i++) {
      const letra = String.fromCharCode(65 + i);
      await this.redis.set(`temp_modify_newslot_${letra}:${organizationId}:${senderId}`, candidateSlots[i].slotId, 'EX', SESSION_TTL);
      await this.redis.set(`temp_modify_newslot_${letra}_fecha:${organizationId}:${senderId}`, candidateSlots[i].fecha.toISOString(), 'EX', SESSION_TTL);
      await this.redis.set(`temp_modify_newslot_max_letra:${organizationId}:${senderId}`, letra, 'EX', SESSION_TTL);
      lineas +=
        `*${letra})* ${candidateSlots[i].fecha.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })} ` +
        `a las ${candidateSlots[i].fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} ` +
        `· Dr. ${candidateSlots[i].doctor}\n`;
      slotsMetadata.push({ letter: letra, slotId: candidateSlots[i].slotId, fecha: candidateSlots[i].fecha.toISOString() });
    }

    const reply = MSGS.modificarMostrarCupos(serviceName, fechaActual, lineas);
    await this.smartReply(organizationId, senderId, reply);
    await this.setUserState(organizationId, senderId, ChatState.AWAITING_MODIFY_NEW_SLOT);

    await this.interactionLog.logSuccess({
      whatsappId: senderId,
      organizationId,
      userMessage: '[modify]',
      botReply: reply,
      metadata: {
        step: 'MODIFY_SLOTS_OFFERED',
        appointmentId,
        service: serviceName,
        slotsCount: candidateSlots.length,
        slots: slotsMetadata,
      },
    });
  }

  // ══════════════════════════════════════════════════════════════
  // INTERFAZ EXTERNA — OUTBOUND CON TENANT EXPLÍCITO
  // ══════════════════════════════════════════════════════════════
  //
  // Usado por flujos automáticos que ya conocen el `organizationId` y no
  // dependen del caché Redis `origin_org` (ej. cron de recordatorios,
  // notificaciones programadas, jobs administrativos). Siembra el caché
  // para que cualquier respuesta inmediata del paciente resuelva al mismo
  // tenant durante SESSION_TTL.
  async sendOutboundForOrg(
    organizationId: string,
    to: string,
    message: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!organizationId || !to || !message) {
      return { success: false, error: 'missing-params' };
    }
    try {
      // Seed del caché de tenant para outbound posterior y para resolver la
      // siguiente respuesta entrante del paciente.
      await this.redis.set(`origin_org:${to}`, organizationId, 'EX', SESSION_TTL);

      const result = await this.sendWhatsAppMessage(to, message);
      if (!result) {
        return { success: false, error: 'meta-api-error' };
      }
      return { success: true };
    } catch (error: any) {
      this.logger.error(
        `Error en sendOutboundForOrg (org=${organizationId}, to=${to}): ${error.message}`,
      );
      return { success: false, error: error.message };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // INTERFAZ EXTERNA (OUTBOUND desde el Dashboard)
  // ══════════════════════════════════════════════════════════════
  async sendOutboundMessage(to: string, message: string): Promise<{ success: boolean; error?: string }> {
    try {
      const orgId = await this.redis.get(`origin_org:${to}`);
      if (!orgId) {
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
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
      });
      if (!org) {
        const errMsg = 'Organización no encontrada para outbound';
        this.logger.error(`${errMsg}: ${orgId}`);
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
      // Notificación proactiva: el paciente no escribió antes, así que el caché
      // `origin_org` no existe. Lo establecemos a partir del organizationId
      // recibido para que sendWhatsAppMessage pueda resolver credenciales.
      await this.redis.set(
        `origin_org:${whatsappId}`,
        organizationId,
        'EX',
        SESSION_TTL,
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