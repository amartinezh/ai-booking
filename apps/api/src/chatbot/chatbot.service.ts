import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import { TechAlertService } from '../tech-alerts/tech-alert.service';
import {
  ChatState,
  SESSION_TTL,
  PRESENTACION_TTL,
  SALUDO_TRAS_RECORDATORIO_TTL,
  SERVICE_WINDOW_TTL,
  WAITLIST_CONFIRM_TTL,
  buildMessages,
  PARTICULAR_EPS_NAME,
  DEFAULT_MAX_RETRIES,
  SEMANTIC_MAP_TIMEOUT_MS,
  OPCIONES_CONSULTA,
  TEXTO_OPERACION,
  lineasOpcionesConsulta,
  letrasOpcionesConsulta,
  accionesNoDisponibles,
  unaOVariasCitas,
  type CanalDelBot,
  type OpcionConsulta,
} from './chatbot.constants';
import { textoParaCoincidencia } from './texto-para-coincidencia.util';
import {
  clasificarRespuestaAlBot,
  esAgradecimiento,
  esMensajeAjeno,
  esSoloSaludo,
  mismoNombre,
  nombreQueNiega,
  RESPUESTAS_AL_RECORDATORIO_EN_MENU,
} from './respuesta-recordatorio';
import { separarNombresYApellidos } from './nombre-paciente-nuevo';
import { esPreguntaEnVezDeRespuesta } from './pregunta-al-confirmar';
import { servicioQueNoSeAgenda } from './servicio-no-agendable';
import { dudaSobreLaCita } from './duda-cita-agendada';
import { cupoBloqueadoParaElAsistente } from 'src/appointments/bloqueos-agenda';
import { fueraDelPlazoParaElAsistente } from 'src/appointments/plazo-agendar';
import { KnowledgeBaseService } from './knowledge-base.service';
import {
  OrganizationSettingsService,
  CLAVE_OPERACION,
  type OperacionBot,
  type OperacionesBot,
} from './organization-settings.service';
import {
  AppointmentsService,
  AvailableSlot,
} from 'src/appointments/appointments.service';
import {
  LimiteCitasService,
  type LimiteDelPaciente,
} from 'src/appointments/limite-citas.service';
import { WaitlistService } from 'src/waitlist/waitlist.service';
import {
  InteractionLogService,
  InteractionStatus,
  FailureReason,
} from '../interaction-log/interaction-log.service';
import { ChannelActivityService } from '../interaction-log/channel-activity.service';
import * as fs from 'fs';
import * as path from 'path';
import { LlmFactoryService } from '../llm/llm-factory.service';
import {
  SchedulingExtraction,
  VocabularyHints,
} from '../llm/interfaces/llm-provider.interface';
import {
  formatAppointmentLong,
  formatAppointmentCompact,
  formatAppointmentSpoken,
  parseFechaPreferida,
  parseHoraPreferida,
  matchesHora,
  formatFechaNacimiento,
  parseFechaNacimiento,
  parseSexo,
  parseRegimen,
  isParticularEps,
  normalizeDocumento,
  reconocerEps,
  documentoSinCerosIniciales,
  esDocumentoValido,
  variantesDeTelefono,
  estadoConexionHis,
  remitenteEsDelPaciente,
  diaLocal,
  inicioDelDiaLocal,
  ESTADOS_ACTIVOS,
  cumpleAnticipacionAlReservar,
  fechaEnPalabras,
} from '@agenia/shared';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import {
  WhatsappMessageLogService,
  type OutboundMessageContext,
} from '../whatsapp-config/whatsapp-message-log.service';
import { ResolvedWhatsappCredentials } from '../whatsapp-config/dto/whatsapp-config.types';
import { SurveyService } from '../survey/survey.service';
import { TtsFactoryService } from '../audio-config/tts/tts-factory.service';
import {
  ResolutionStatus,
  Organization,
  PatientProfile,
  Prisma,
} from '@agenia/database';
import {
  buildWhatsappRecipient,
  chatIdFromTelegramSender,
  claveExcepcion,
  etiquetaPeriodo,
  isTelegramSender,
  isWhatsappPhoneId,
  severidadPorCercania,
  TITULO_EXCEPCION,
} from '@agenia/shared';
import { MirrorExceptionsService } from '../mirror/mirror-exceptions.service';
import { metaGraphUrl } from '../whatsapp-config/meta-graph';
import {
  getErrorMessage,
  getErrorStack,
  getErrorStatus,
  getAxiosErrorDetail,
  isMetaGraphErrorCode,
} from '../common/error-message.util';
import { doctorLabel } from '../common/doctor-label.util';
import {
  resolveSenderIdentity,
  telegramOriginOf,
  UNIDENTIFIED_SENDER,
} from './sender-identity';
import type {
  SenderIdentity,
  TelegramOrigin,
  WhatsappInboundEvent,
} from './sender-identity';
import { TelegramChannelService } from '../telegram/telegram-channel.service';
import {
  ConsultaHisBotService,
  type CitaHisParaMostrar,
  type PlanHisBot,
  type SeguimientoHis,
} from './consulta-his-bot.service';
import {
  ConfirmacionHisService,
  ABANDONO_CONFIRMACION_HIS_MS,
  type ConfirmacionPendiente,
  type EstadoCambioHis,
  type EstadoCancelacionHis,
} from './confirmacion-his.service';
import { Cron, CronExpression } from '@nestjs/schedule';

// La forma del evento entrante y la resolución de "quién escribió" viven en
// sender-identity.ts (ver allí el porqué del orden teléfono → BSUID → PSID).
// Se re-exporta el tipo para no romper importaciones existentes.
export type { WhatsappInboundEvent } from './sender-identity';

/**
 * Contexto de un turno de conversación, construido en el preámbulo de
 * processIncomingMessageUnsafe y pasado a los handlers de cada ChatState.
 * Reúne SOLO los locales que el despacho por estado realmente consume; los
 * handlers leen de aquí (de solo lectura: el método termina tras el switch,
 * así que ningún handler necesita reescribir estos valores).
 */
interface ChatTurnContext {
  organizationId: string;
  senderId: string;
  /**
   * Identidad completa del remitente. `senderId` es su clave canónica (ya
   * presente arriba); esto conserva además el BSUID y el teléfono por separado,
   * que es lo que `ensurePatientPersisted` necesita para guardar cada uno en su
   * propia columna.
   */
  identity: SenderIdentity;
  /** phone_number_id de Meta. Lo necesita el alta para reinyectar un turno. */
  phoneNumberId?: string;
  text: string | undefined;
  currentState: ChatState;
  aiData: SchedulingExtraction;
  MSGS: ReturnType<typeof buildMessages>;
  botName: string;
  orgName: string;
  retriesKey: string;
  retriesCount: number;
  /**
   * Qué deja hacer la clínica por el bot en este turno, operación por
   * operación: sus interruptores (/dashboard/configuracion) y, con espejo, el
   * envío al hospital encendido. Ver `operacionesDisponibles`.
   */
  operaciones: OperacionesBot;
}

/**
 * Estados en los que el paciente puede seguir con las operaciones apagadas:
 * los de la consulta de citas (solo lectura). Cualquier otro es un
 * agendamiento, una cancelación o un cambio a medias.
 */
const ESTADOS_SOLO_CONSULTA: ChatState[] = [
  ChatState.IDLE,
  ChatState.AWAITING_LOOKUP_CEDULA,
  ChatState.AWAITING_LOOKUP_CHOICE,
];

const ESTADOS_DE_CANCELAR: ChatState[] = [
  ChatState.AWAITING_CANCEL_CEDULA,
  ChatState.AWAITING_CANCEL_RETRY_CEDULA,
  ChatState.AWAITING_CANCEL_SELECTION,
  ChatState.AWAITING_CANCEL_CONFIRM,
  // Cambiar la fecha sin cupos: lo que queda pendiente es un SÍ que CANCELA.
  ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL,
];

const ESTADOS_DE_MODIFICAR: ChatState[] = [
  ChatState.AWAITING_MODIFY_CEDULA,
  ChatState.AWAITING_MODIFY_RETRY_CEDULA,
  ChatState.AWAITING_MODIFY_SELECTION,
  ChatState.AWAITING_MODIFY_NEW_SLOT,
  ChatState.AWAITING_MODIFY_CONFIRM,
];

/**
 * La operación que el paciente tiene a medias en este estado, para saber qué
 * interruptor la gobierna. `null`: consulta o reposo, que siempre se pueden.
 * Todo lo demás es agendar (incluida la lista de espera, la elección tras
 * cancelar —que abre un agendamiento— y la interrupción de un agendamiento).
 */
export function operacionDelEstado(estado: ChatState): OperacionBot | null {
  if (ESTADOS_SOLO_CONSULTA.includes(estado)) return null;
  if (ESTADOS_DE_CANCELAR.includes(estado)) return 'CANCELAR';
  if (ESTADOS_DE_MODIFICAR.includes(estado)) return 'MODIFICAR';
  return 'AGENDAR';
}

/** Las tres apagadas: el bot solo consulta («solo consultas»). */
const soloConsultas = (o: OperacionesBot): boolean =>
  !o.agendar && !o.cancelar && !o.modificar;

/** Las operaciones que sí se pueden, en el orden en que se le nombran al paciente. */
const operacionesPermitidas = (o: OperacionesBot): OperacionBot[] =>
  (['AGENDAR', 'CANCELAR', 'MODIFICAR'] as const).filter(
    (op) => o[CLAVE_OPERACION[op]],
  );

/**
 * Las opciones tras consultar las citas: solo las que la clínica deja hacer
 * por el bot, más «nada más». Con las tres prendidas son las A-D de siempre.
 */
const opcionesDeConsulta = (o: OperacionesBot): OpcionConsulta[] =>
  OPCIONES_CONSULTA.map((x) => x.opcion).filter(
    (op) => op === 'NADA' || o[CLAVE_OPERACION[op]],
  );

/**
 * Lo que significaba cada letra antes de que las opciones dependieran de los
 * interruptores. Para una consulta mostrada antes del despliegue (sin las
 * opciones guardadas en la sesión).
 */
const OPCIONES_CONSULTA_FIJAS: OpcionConsulta[] = [
  'CANCELAR',
  'MODIFICAR',
  'AGENDAR',
  'NADA',
];

/** Canal del paciente, para los textos que lo nombran (docs/PLAN_TELEGRAM.md). */
const canalDe = (senderId: string): CanalDelBot =>
  isTelegramSender(senderId) ? 'TELEGRAM' : 'WHATSAPP';

/**
 * Cuántas citas de quien escribe se nombran en una respuesta sin IA (confirmar,
 * avisar, elegir cuál cancelar): las letras A–H. Más que eso no es un recordatorio
 * normal; el resto se gestiona con el hospital.
 */
const MAX_CITAS_EN_RESPUESTA = 8;

/**
 * 🪪 Cuánto se recuerda la cédula que el paciente escribió en un mensaje
 * (2026-10-16): «cancelar cita pero me dan otra, mi cc 1058…» y, un minuto
 * después, «cancelar cita» → antes se le volvía a pedir. Se usa solo para
 * arrancar cancelar o cambiar fecha, y la cédula igual tiene que ser de un
 * perfil de quien escribe.
 */
const CEDULA_RECIENTE_TTL = 15 * 60;

/**
 * 🔁 Si en este lapso vuelve a pedir lo mismo que no se puede por aquí (agendar,
 * cancelar o cambiar la fecha), se le responde la versión corta (2026-10-17: un
 * paciente preguntó cuatro veces seguidas si podía agendar para el martes y
 * recibió cuatro veces el mismo aviso largo).
 */
const NO_DISPONIBLE_REPETIDO_TTL = 30 * 60;

/**
 * 🩺 Con qué citas trabaja AgenIA frente al paciente (2026-10-15): las de los
 * médicos con «WhatsApp ON» en Médicos Y de un servicio activo en Servicios (en
 * Anserma, solo medicina general). El hospital trae TODAS sus citas (para la
 * agenda y el rastreo), pero recordar, responder, avisar, cancelar o cambiar la
 * fecha solo con estas. Antes el bot confirmaba y ofrecía cancelar citas de
 * odontología que nunca debió tocar; y un médico de medicina general también
 * atiende hipertensos y lectura de exámenes, así que el médico solo no basta.
 * El servicio es el del cupo: el espejo lo pone igual al de la cita del hospital.
 */
const EN_ALCANCE_DEL_BOT = {
  doctor: { whatsappBookingEnabled: true },
  service: { isActive: true },
} as const;

/** Quita tildes. Solo para comparar, igual que `textoParaCoincidencia`. */
const sinTildes = (texto: string): string =>
  texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Estados desde los que «¿qué citas tengo?» abre la consulta. Fuera de ellos el
 * paciente va a mitad de algo (eligiendo horario, dando su nombre, confirmando)
 * y una frase con «mis citas» no debe tirarle el agendamiento.
 */
const LOOKUP_ENTRY_STATES: ChatState[] = [
  ChatState.IDLE,
  ChatState.AWAITING_SPECIALTY,
  ChatState.AWAITING_EPS,
  ChatState.AWAITING_LOOKUP_CEDULA,
  ChatState.AWAITING_LOOKUP_CHOICE,
];

@Injectable()
export class ChatbotService implements OnModuleInit {
  private readonly logger = new Logger(ChatbotService.name);

  // Regex construidos dinámicamente desde chatbot-patterns.txt
  private escapeRegex: RegExp = /^(hola)$/i;
  private cancelRegex: RegExp = /^(cancelar cita)/i;
  // Frases de reprogramación ("cambiar mi cita", "reagendar", ...). Match de inicio.
  private modifyRegex: RegExp =
    /^(cambiar (mi |la )?cita|reprogramar|reagendar|modificar (mi |la )?cita|mover (mi |la )?cita)/i;
  // Consulta de citas ("¿qué citas tengo?"). Frase CONTENIDA en el texto ya
  // normalizado sin tildes (ver esConsultaDeCitas). Sección [lookup] del .txt.
  private lookupRegex: RegExp =
    /(?:^| )(que citas tengo|tengo cita|mis citas|cuando es mi cita)(?= |$)/;
  private greetingRegex: RegExp = /^(hola)$/i;
  private particularRegex: RegExp = /^(particular)$/i;
  // Las mismas palabras, en CUALQUIER parte de la frase («la quiero particular»).
  private particularEnFraseRegex: RegExp = /(^|\s)(particular)(\s|$)/i;
  private farewellRegex: RegExp = /^(gracias)$/i;
  // Cierre/despedida: el paciente quiere TERMINAR la conversación ("chao",
  // "salir", "no quiero agendar"...). Match EXACTO; se aplica en cualquier
  // estado y también por voz (sobre la transcripción). Ver [goodbye] en el .txt.
  private goodbyeRegex: RegExp = /^(chao|adios|adiós|salir)$/i;
  // 🛡️ Guardrail: detecta insultos en cualquier parte del mensaje (no ancla a inicio/fin).
  private insultRegex: RegExp =
    /\b(gonorrea|hijueputa|malparid[oa]|idiota|imb[eé]cil)\b/i;
  // 🚑 Guardrail: banderas rojas clínicas en cualquier parte del mensaje.
  // Se evalúa sobre texto NORMALIZADO (minúsculas, sin tildes, puntuación →
  // espacios; ver isEmergencyText), por eso las frases van sin tilde. Default
  // de fábrica por si chatbot-patterns.txt no está disponible; la lista real
  // vive en la sección [emergency] de ese archivo.
  private emergencyRegex: RegExp =
    /(?:^|\s)(dolor (en el|de) pecho|duele (mucho )?el pecho|no puedo respirar|me falta el aire|dificultad para respirar|infarto|convulsion(es)?|sobredosis|hemorragia|me quiero matar|quiero suicidarme|perdida de conocimiento)(?=$|\s)/i;

  // Tesauro GENÉRICO de servicios (service-synonyms.txt). Cada concepto agrupa
  // "anclas" (frases que suelen estar en el nombre del catálogo) y "sinonimos"
  // (lenguaje natural del paciente). Todo normalizado al cargar. Se usa para
  // expandir la frase del paciente a anclas antes de caer al LLM.
  private serviceConcepts: Array<{
    key: string;
    anchors: string[];
    synonyms: string[];
  }> = [];

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private httpService: HttpService,
    private redis: RedisService,
    private appointmentsService: AppointmentsService,
    private waitlistService: WaitlistService,
    private interactionLog: InteractionLogService,
    private readonly channelActivity: ChannelActivityService,
    private knowledgeBase: KnowledgeBaseService,
    private organizationSettings: OrganizationSettingsService,
    private llmFactory: LlmFactoryService,
    private whatsappCredentials: WhatsappCredentialsService,
    private surveyService: SurveyService,
    private ttsFactory: TtsFactoryService,
    private messageLog: WhatsappMessageLogService,
    // Canal de Telegram (docs/PLAN_TELEGRAM.md). Opcional: sin él (tests,
    // despliegues sin el módulo) un remitente `tg:` no se atiende, pero
    // tampoco viaja nunca a Meta.
    @Optional() private readonly telegramChannel?: TelegramChannelService,
    // Fase B de la consulta de citas (docs/PLAN_CONSULTA_CITAS.md): el bot le
    // pregunta al HIS. Opcional: sin él, la consulta se queda en la Fase A.
    @Optional() private readonly consultaHis?: ConsultaHisBotService,
    // H10 (docs/PLAN_AGENDA_HUECOS.md): no se confirma una cita hasta que el
    // hospital la registra. Opcional: sin él (tests), se confirma como antes.
    @Optional() private readonly confirmacionHis?: ConfirmacionHisService,
    // 🚦 Límite de citas por paciente (/dashboard/limites-citas). Opcional:
    // sin él (tests), el bot no frena antes de reservar; la reserva igual lo
    // aplica si su servicio lo tiene.
    @Optional() private readonly limiteCitas?: LimiteCitasService,
    // 📝 Avisos de pacientes para el personal («no puedo ir», «número
    // equivocado»): quedan en la bandeja de /dashboard/bandeja. Solo escribe en
    // AgenIA, nunca en el hospital. Opcional: sin él (tests), esos mensajes
    // siguen el camino de siempre.
    @Optional() private readonly avisosPaciente?: MirrorExceptionsService,
    // 🚨 Alertas técnicas (docs/PLAN_ALERTAS_TECNICAS.md): solo los barridos del
    // HIS de cada pocos segundos. Opcional: sin él (tests), nada cambia.
    @Optional() private readonly alertasTecnicas?: TechAlertService,
  ) {}

  async onModuleInit() {
    this.loadPatterns();
    this.loadServiceSynonyms();
    // Seeder idempotente: asegura que cada organización tenga un registro EPS "Particular"
    // (pago directo). Se ejecuta en silencio si ya existe; no afecta CRON ni flujos en curso.
    try {
      await this.ensureParticularEpsForAllOrganizations();
    } catch (e: unknown) {
      this.logger.error(
        `No fue posible asegurar EPS "${PARTICULAR_EPS_NAME}": ${getErrorMessage(e)}`,
      );
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SEEDER IDEMPOTENTE — EPS "Particular" por organización
  // ══════════════════════════════════════════════════════════════
  private async ensureParticularEpsForAllOrganizations(): Promise<void> {
    const orgs = await this.prisma.organization.findMany({
      select: { id: true },
    });
    for (const org of orgs) {
      await this.ensureParticularEpsForOrg(org.id);
    }
  }

  private async ensureParticularEpsForOrg(
    organizationId: string,
  ): Promise<{ id: string; name: string } | null> {
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
          await this.prisma.eps.update({
            where: { id: existing.id },
            data: { isActive: true },
          });
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
      this.logger.log(
        `✅ EPS "${PARTICULAR_EPS_NAME}" creada para organización ${organizationId}`,
      );
      return { id: created.id, name: created.name };
    } catch (e: unknown) {
      this.logger.error(
        `Error asegurando EPS Particular para org ${organizationId}: ${getErrorMessage(e)}`,
      );
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
      this.logger.warn(
        'chatbot-patterns.txt no encontrado. Se usarán patrones por defecto.',
      );
      return;
    }

    const farewellWords: string[] = [];
    const goodbyeWords: string[] = [];
    const greetingWords: string[] = [];
    const escapeWords: string[] = [];
    const cancelPhrases: string[] = [];
    const modifyPhrases: string[] = [];
    const lookupPhrases: string[] = [];
    const particularWords: string[] = [];
    const insultWords: string[] = [];
    const emergencyPhrases: string[] = [];
    let currentSection = '';

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      if (line === '[farewell]') {
        currentSection = 'farewell';
      } else if (line === '[goodbye]') {
        currentSection = 'goodbye';
      } else if (line === '[greetings]') {
        currentSection = 'greetings';
      } else if (line === '[escape]') {
        currentSection = 'escape';
      } else if (line === '[cancel]') {
        currentSection = 'cancel';
      } else if (line === '[modify]') {
        currentSection = 'modify';
      } else if (line === '[lookup]') {
        currentSection = 'lookup';
      } else if (line === '[particular]') {
        currentSection = 'particular';
      } else if (line === '[insults]') {
        currentSection = 'insults';
      } else if (line === '[emergency]') {
        currentSection = 'emergency';
      } else if (currentSection === 'farewell') {
        farewellWords.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'goodbye') {
        goodbyeWords.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'greetings') {
        greetingWords.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'escape') {
        escapeWords.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'cancel') {
        cancelPhrases.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'modify') {
        modifyPhrases.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'lookup') {
        // Se normaliza igual que el texto entrante (esConsultaDeCitas): sin
        // tildes ni signos, así que no quedan especiales de regex.
        const normalized = sinTildes(textoParaCoincidencia(line));
        if (normalized) lookupPhrases.push(normalized);
      } else if (currentSection === 'particular') {
        particularWords.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'insults') {
        insultWords.push(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } else if (currentSection === 'emergency') {
        // Se normaliza igual que el texto entrante (isEmergencyText): tras
        // normalizeSynonym solo quedan [a-z0-9 ], así que no hay especiales
        // de regex que escapar.
        const normalized = this.normalizeSynonym(line);
        if (normalized) emergencyPhrases.push(normalized);
      }
    }

    if (farewellWords.length > 0) {
      this.farewellRegex = new RegExp(`^(${farewellWords.join('|')})$`, 'i');
    }
    if (goodbyeWords.length > 0) {
      this.goodbyeRegex = new RegExp(`^(${goodbyeWords.join('|')})$`, 'i');
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
    if (lookupPhrases.length > 0) {
      this.lookupRegex = new RegExp(
        `(?:^| )(${lookupPhrases.join('|')})(?= |$)`,
      );
    }
    if (particularWords.length > 0) {
      this.particularRegex = new RegExp(
        `^(${particularWords.join('|')})$`,
        'i',
      );
      this.particularEnFraseRegex = new RegExp(
        `(^|\\s)(${particularWords.join('|')})(\\s|$)`,
        'i',
      );
    }
    if (insultWords.length > 0) {
      // No-anchored: detecta el insulto en cualquier parte del mensaje.
      this.insultRegex = new RegExp(
        `(?:^|\\s|[¡!¿?.,;])(${insultWords.join('|')})(?=$|\\s|[!?.,;])`,
        'i',
      );
    }
    if (emergencyPhrases.length > 0) {
      // No-anchored: detecta la bandera roja en cualquier parte del mensaje.
      // Los delimitadores son solo ^/$/espacio porque el texto ya llega
      // normalizado (la puntuación se colapsó a espacios).
      this.emergencyRegex = new RegExp(
        `(?:^|\\s)(${emergencyPhrases.join('|')})(?=$|\\s)`,
        'i',
      );
    }

    this.logger.log(
      `Patrones listos — farewell: ${farewellWords.length}, goodbye: ${goodbyeWords.length}, greetings: ${greetingWords.length}, escape: ${escapeWords.length}, cancel: ${cancelPhrases.length}, modify: ${modifyPhrases.length}, particular: ${particularWords.length}, insults: ${insultWords.length}, emergency: ${emergencyPhrases.length}`,
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
      this.logger.warn(
        'service-synonyms.txt no encontrado. Tesauro de servicios deshabilitado.',
      );
      this.serviceConcepts = [];
      return;
    }

    const concepts: Array<{
      key: string;
      anchors: string[];
      synonyms: string[];
    }> = [];
    let current: { key: string; anchors: string[]; synonyms: string[] } | null =
      null;

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
    const totalSyn = this.serviceConcepts.reduce(
      (n, c) => n + c.synonyms.length + c.anchors.length,
      0,
    );
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
      const hit = [...concept.synonyms, ...concept.anchors].some((term) =>
        padded.includes(` ${term} `),
      );
      if (hit) {
        // Anclas de este concepto, más específicas (largas) primero.
        for (const a of [...concept.anchors].sort(
          (x, y) => y.length - x.length,
        )) {
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

  // ══════════════════════════════════════════════════════════════
  // VENTANA DE ATENCIÓN DE 24 H (Meta)
  // ══════════════════════════════════════════════════════════════
  //
  // Dentro de la ventana se puede responder con texto libre; fuera de ella
  // Meta rechaza el envío y hay que usar una plantilla aprobada. La clave
  // lleva el tenant delante porque la ventana es POR LÍNEA de clínica: que un
  // paciente escriba a la clínica A no autoriza a la B a escribirle.
  private serviceWindowKey(organizationId: string, senderId: string): string {
    return `wa_window:${organizationId}:${senderId}`;
  }

  /** Marca que el paciente acaba de escribir: abre/renueva su ventana de 24 h. */
  private async markServiceWindow(
    organizationId: string,
    senderId: string,
  ): Promise<void> {
    try {
      await this.redis.set(
        this.serviceWindowKey(organizationId, senderId),
        String(Date.now()),
        'EX',
        SERVICE_WINDOW_TTL,
      );
    } catch (error) {
      // La ventana es una optimización de envío, no parte del flujo del
      // paciente: si Redis falla, no se rompe la conversación.
      this.logger.warn(
        `No se pudo marcar la ventana de atención de ${senderId}: ${
          (error as Error).message
        }`,
      );
    }
  }

  /**
   * ¿Se le puede escribir texto libre a este paciente ahora mismo?
   *
   * Ante un fallo de Redis devuelve `false` (fuera de ventana) a propósito:
   * el llamador cae a plantilla, que es válida DENTRO y FUERA de la ventana.
   * Equivocarse hacia el otro lado sería un envío rechazado por Meta.
   */
  async isWithinServiceWindow(
    organizationId: string,
    senderId: string,
  ): Promise<boolean> {
    try {
      const marker = await this.redis.get(
        this.serviceWindowKey(organizationId, senderId),
      );
      return marker !== null && marker !== undefined;
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la ventana de atención de ${senderId} (se asume fuera): ${
          (error as Error).message
        }`,
      );
      return false;
    }
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
  // `recipientId` es el identificador del paciente: su teléfono o su BSUID.
  // `buildWhatsappRecipient` decide si va en `to` o en `recipient` — mandar un
  // BSUID en `to` es un envío fallido garantizado.
  //
  // `ctx` (opcional) lo pasa quien SABE para qué es el mensaje (confirmación de
  // cita, oferta de lista de espera...). Sin él se registra como respuesta del
  // bot en el libro de mensajes (WhatsappMessageLog), que guarda el wamid y el
  // estado de entrega que Meta reporta después.
  private async sendWhatsAppMessage(
    recipientId: string,
    text: string,
    ctx?: OutboundMessageContext,
  ): Promise<unknown> {
    // ✈️ Telegram: todo texto del bot pasa por aquí, así que esta es LA puerta
    // de salida del canal. Un `tg:` nunca llega a la Graph API de Meta.
    if (isTelegramSender(recipientId)) {
      return this.sendTelegramText(recipientId, text, ctx);
    }
    const creds = await this.resolveCredentialsForRecipient(recipientId);
    if (!creds) {
      this.logger.error(
        `CRÍTICO: no hay credenciales WhatsApp para ${recipientId}. El destinatario no está asociado a ninguna org configurada. Mensaje NO enviado.`,
      );
      return null;
    }
    if (!creds.isActive) {
      this.logger.error(
        `CRÍTICO: integración WhatsApp inactiva para org ${creds.organizationId}. Mensaje NO enviado a ${recipientId}.`,
      );
      return null;
    }

    const url = metaGraphUrl(`${creds.phoneNumberId}/messages`);
    try {
      const response = await lastValueFrom(
        this.httpService.post<unknown>(
          url,
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            ...buildWhatsappRecipient(recipientId),
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

      // Justo tras la respuesta de Meta, antes de cualquier otro await: el
      // webhook de estados puede llegar enseguida y necesita encontrar la fila.
      // Nunca lanza (ver WhatsappMessageLogService).
      await this.messageLog.recordOutbound({
        organizationId: creds.organizationId,
        recipientId,
        messageType: 'TEXT',
        metaResponse: response.data,
        context: ctx,
      });

      // Guardar el último mensaje enviado para audit logging
      await this.setLastSent(recipientId, text);

      return response.data;
    } catch (error: unknown) {
      this.logger.error(
        `Error enviando mensaje a ${recipientId}: ${getAxiosErrorDetail(error)}`,
      );

      if (isMetaGraphErrorCode(error, 190)) {
        this.logger.error(
          `🚨 Token de Meta inválido para org ${creds.organizationId}. ` +
            `Pídele al administrador de la clínica que regenere el Access Token ` +
            `en Configuración → Integraciones → Canal de WhatsApp.`,
        );
      }

      return null;
    }
  }

  /**
   * Texto por Telegram. Mismo contrato que `sendWhatsAppMessage`: devuelve
   * algo verdadero solo si salió, `null` si no, y nunca lanza. La clínica sale
   * del mismo `origin_org:${senderId}` que usa WhatsApp.
   */
  private async sendTelegramText(
    recipientId: string,
    text: string,
    ctx?: OutboundMessageContext,
  ): Promise<{ telegramMessageId: number | null } | null> {
    const organizationId = await this.redis.get(`origin_org:${recipientId}`);
    if (!organizationId) {
      this.logger.error(
        `CRÍTICO: no hay clínica asociada a ${recipientId}. Mensaje de Telegram NO enviado.`,
      );
      return null;
    }
    if (!this.telegramChannel) {
      this.logger.error(
        `CRÍTICO: el canal de Telegram no está cargado. Mensaje NO enviado a ${recipientId}.`,
      );
      return null;
    }
    const outcome = await this.telegramChannel.sendText(
      organizationId,
      recipientId,
      text,
      ctx,
    );
    if (!outcome.ok) return null;
    await this.setLastSent(recipientId, text);
    return { telegramMessageId: outcome.messageId };
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 2: ESTADO DE SESIÓN (REDIS)
  // ══════════════════════════════════════════════════════════════
  private async getUserState(
    organizationId: string,
    phoneId: string,
  ): Promise<ChatState> {
    const state = await this.redis.get(
      `chat_state:${organizationId}:${phoneId}`,
    );
    return (state as ChatState) || ChatState.IDLE;
  }

  private async setUserState(
    organizationId: string,
    phoneId: string,
    state: ChatState,
  ) {
    await this.redis.set(
      `chat_state:${organizationId}:${phoneId}`,
      state,
      'EX',
      SESSION_TTL,
    );
  }

  // ── Último mensaje de bot enviado (para audit logging) ──────────
  // Persistido en Redis (clave por destinatario) en vez de un Map en memoria:
  // sobrevive a reinicios, funciona con múltiples instancias y expira solo (sin
  // fuga de memoria). Mismo TTL que la sesión. Se escribe SOLO tras un envío
  // exitoso (igual que el Map anterior), para no sobreescribir el último
  // mensaje válido cuando el envío falla.
  private lastSentKey(phone: string): string {
    return `last_sent:${phone}`;
  }
  private async setLastSent(toPhone: string, text: string): Promise<void> {
    await this.redis.set(this.lastSentKey(toPhone), text, 'EX', SESSION_TTL);
  }
  private async getLastSent(phone: string): Promise<string | null> {
    return this.redis.get(this.lastSentKey(phone));
  }
  private async clearLastSent(phone: string): Promise<void> {
    await this.redis.del(this.lastSentKey(phone));
  }

  // ── Helpers de auditoría ────────────────────────────────────────
  // Colapsan el boilerplate repetido de interactionLog inyectando whatsappId
  // (= senderId) y organizationId del turno. Hacen *spread* del resto de
  // campos (`...params`), así que preservan EXACTAMENTE lo que pase el caller
  // (reason, userMessage, botReply, metadata, patientUserId, …) y el caller
  // puede sobreescribir whatsappId/organizationId si lo necesita. Son
  // envoltorios finos y fire-and-forget: delegan en los mismos métodos del
  // InteractionLogService, sin cambiar el comportamiento.
  private auditFailure(
    senderId: string,
    organizationId: string | null | undefined,
    params: { reason: FailureReason; [k: string]: any },
  ): Promise<void> {
    return this.interactionLog.logFailure({
      whatsappId: senderId,
      organizationId,
      ...params,
    });
  }
  private auditSuccess(
    senderId: string,
    organizationId: string | null | undefined,
    params: { [k: string]: any } = {},
  ): Promise<void> {
    return this.interactionLog.logSuccess({
      whatsappId: senderId,
      organizationId,
      ...params,
    });
  }
  private auditLog(
    senderId: string,
    organizationId: string | null | undefined,
    params: { status: InteractionStatus; [k: string]: any },
  ): Promise<void> {
    return this.interactionLog.log({
      whatsappId: senderId,
      organizationId,
      ...params,
    });
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
      const urlReq = metaGraphUrl(mediaId);
      const urlResponse = await lastValueFrom(
        this.httpService.get<{ url: string }>(urlReq, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      const mediaUrl = urlResponse.data.url;
      const mediaResponse = await lastValueFrom(
        this.httpService.get<ArrayBuffer>(mediaUrl, {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'arraybuffer',
        }),
      );
      return Buffer.from(mediaResponse.data);
    } catch (error: unknown) {
      this.logger.error(
        `Error descargando audio ${mediaId}: ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  private async extractDataWithLLM(
    organizationId: string,
    text: string | null,
    audioBuffer: Buffer | null,
    attempt = 1,
    vocabularyHints?: VocabularyHints,
  ): Promise<SchedulingExtraction> {
    const provider = await this.llmFactory.forOrgOrNull(organizationId);
    if (!provider) {
      this.logger.warn(
        `Org ${organizationId} sin proveedor LLM configurado — usando fallback simple.`,
      );
      return this.buildEmptyFallback(text, false);
    }

    // Reintentos del proveedor primario: env LLM_MAX_RETRIES (default 5),
    // antes era 3 vía organization settings.
    const maxRetries = this.getMaxRetriesFromEnv();
    const audioInput = audioBuffer
      ? { base64: audioBuffer.toString('base64'), mimeType: 'audio/ogg' }
      : null;

    try {
      return await provider.extractSchedulingIntent({
        text,
        audio: audioInput,
        vocabularyHints,
      });
    } catch (e: unknown) {
      // 429 cuota agotada: no reintentar (empeora), no contar como fallo permanente.
      if (getErrorStatus(e) === 429) {
        this.logger.warn(
          `${provider.name} rate limit (429) — usando fallback simple, sin incrementar contador de fallos`,
        );
        return this.buildEmptyFallback(text, true);
      }
      if (attempt < maxRetries) {
        const delayMs = attempt * 1500;
        this.logger.warn(
          `${provider.name} intento ${attempt} fallido, reintentando en ${delayMs}ms...`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        return this.extractDataWithLLM(
          organizationId,
          text,
          audioBuffer,
          attempt + 1,
          vocabularyHints,
        );
      }
      this.logger.error(
        `Error procesando IA con ${provider.name} tras ${maxRetries} intentos`,
        getErrorStack(e) ?? getErrorMessage(e),
      );

      // Failover entre proveedores: si LLM_FAILOVER_ENABLED=true, intentar
      // el resto de la cadena (OpenAI → Claude) con las credenciales que la
      // misma org tenga guardadas en BD (mapa multi-proveedor cifrado). NO
      // se usan keys del .env: cada clínica usa SUS llaves.
      if (this.isFailoverEnabled()) {
        const failoverResult = await this.tryFailoverChain(
          organizationId,
          provider.name,
          text,
          audioInput,
          vocabularyHints,
        );
        if (failoverResult) return failoverResult;
      }

      return this.buildEmptyFallback(text, false);
    }
  }

  /** Lee el cap de reintentos del LLM desde el env. Default 5. */
  private getMaxRetriesFromEnv(): number {
    const raw = process.env.LLM_MAX_RETRIES;
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 5;
  }

  /**
   * Cuántos cupos LEE la voz al presentar la agenda (los más próximos). El
   * listado completo con todas las letras sigue yendo por texto. Env
   * `VOICE_SLOTS_SPOKEN_COUNT`, default 3.
   */
  private getVoiceSlotsSpokenCount(): number {
    const raw = this.configService.get<string>('VOICE_SLOTS_SPOKEN_COUNT', '3');
    const n = parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 3;
  }

  /**
   * Versión HABLADA del resumen previo a la confirmación. Sin el nombre de
   * relleno 'Paciente' (sonaría a plantilla) y con la fecha dicha como se
   * dice ("mañana a las 8 y media de la mañana"), no como se escribe.
   */
  private resumenCitaHablado(
    MSGS: ReturnType<typeof buildMessages>,
    nombre: string | null | undefined,
    servicio: string,
    fechaIso: string | null | undefined,
  ): string {
    const nombreHablado = nombre && nombre !== 'Paciente' ? nombre : '';
    const fechaHablada = fechaIso
      ? formatAppointmentSpoken(fechaIso)
      : 'la fecha que eligió';
    return MSGS.resumenCitaAudio(nombreHablado, servicio, fechaHablada);
  }

  /**
   * Arma la frase hablada de las próximas N citas para el audio del menú de
   * cupos: "opción A, mañana a las 3 de la tarde con el Doctor Pérez. opción B,
   * ...". Las letras coinciden con el listado de texto (mismo orden A, B, C…).
   */
  private buildSpokenSlotLines(
    slots: Array<{ fecha: Date; doctor: string }>,
  ): string {
    const n = this.getVoiceSlotsSpokenCount();
    return slots
      .slice(0, n)
      .map((s, i) => {
        const letra = String.fromCharCode(65 + i);
        return `opción ${letra}, ${formatAppointmentSpoken(s.fecha)} con el Doctor ${s.doctor}.`;
      })
      .join(' ');
  }

  /**
   * Lee de Redis los cupos ofrecidos en el menú de agendamiento
   * (`temp_slot_<letra>` + `temp_slot_<letra>_fecha`) con su letra, id y fecha.
   * Permite casar un cupo por "día + hora" dichos por voz, no solo por letra.
   */
  private async loadOfferedSlots(
    organizationId: string,
    senderId: string,
  ): Promise<Array<{ letra: string; slotId: string; fecha: Date }>> {
    const keys = await this.redis.keys(
      `temp_slot_*:${organizationId}:${senderId}`,
    );
    const letras = [
      ...new Set(
        keys
          .map((k) => k.match(/^temp_slot_([A-Z]):/)?.[1])
          .filter((l): l is string => !!l),
      ),
    ].sort();

    const out: Array<{ letra: string; slotId: string; fecha: Date }> = [];
    for (const letra of letras) {
      const slotId = await this.redis.get(
        this.slotKey(organizationId, senderId, letra),
      );
      const fechaStr = await this.redis.get(
        this.slotDateKey(organizationId, senderId, letra),
      );
      if (slotId && fechaStr) {
        out.push({ letra, slotId, fecha: new Date(fechaStr) });
      }
    }
    return out;
  }

  // ── Claves de los cupos ofrecidos en el menú de agendamiento ──────
  // Van scoped por organización como TODAS las demás claves de sesión. Antes
  // eran `temp_slot_<letra>:<senderId>` (sin tenant): si un mismo paciente
  // conversaba con dos clínicas de la plataforma, las letras colisionaban y el
  // `cleanUpSession` de una borraba los cupos ofrecidos por la otra.
  // `bookAppointment` valida el tenant del slot, así que nunca hubo reserva
  // cruzada; el síntoma era un "ese horario ya lo tomaron" falso.
  private slotKey(
    organizationId: string,
    senderId: string,
    letra: string,
  ): string {
    return `temp_slot_${letra}:${organizationId}:${senderId}`;
  }
  private slotDateKey(
    organizationId: string,
    senderId: string,
    letra: string,
  ): string {
    return `temp_slot_${letra}_fecha:${organizationId}:${senderId}`;
  }

  /**
   * Casa el turno del paciente contra los cupos ofrecidos usando el día
   * (`parseFechaPreferida`) y/o la hora (`parseHoraPreferida`) que mencione.
   * Devuelve el cupo SOLO si el match es inequívoco (exactamente uno); ante
   * ambigüedad o si no se reconoce ni día ni hora, devuelve `null` para que el
   * llamador reintente o siga pidiendo la letra. Nunca agenda a ciegas.
   */
  private async matchOfferedSlotByVoice(
    organizationId: string,
    senderId: string,
    text: string | undefined,
  ): Promise<{ slotId: string; fecha: Date } | null> {
    const ventana = parseFechaPreferida(text ?? null);
    const hora = parseHoraPreferida(text ?? null);
    if (!ventana && !hora) return null;

    const offered = await this.loadOfferedSlots(organizationId, senderId);
    const matches = offered.filter((s) => {
      const inDay = ventana
        ? s.fecha >= ventana.desde && s.fecha <= ventana.hasta
        : true;
      const inHour = hora ? matchesHora(s.fecha, hora) : true;
      return inDay && inHour;
    });

    return matches.length === 1
      ? { slotId: matches[0].slotId, fecha: matches[0].fecha }
      : null;
  }

  /** Switch maestro del failover entre proveedores. Default false. */
  private isFailoverEnabled(): boolean {
    return (process.env.LLM_FAILOVER_ENABLED || '').toLowerCase() === 'true';
  }

  /**
   * Recorre la cadena de failover [CHATGPT, CLAUDE] saltando el proveedor
   * primario. Cada candidato se construye a partir de las CREDENCIALES QUE LA
   * ORG TENGA GUARDADAS EN BD (mapa multi-proveedor cifrado en
   * AiProviderConfig.encryptedApiConfig). Si no hay key guardada para ese
   * proveedor, se salta silenciosamente con un warn. Devuelve el primer éxito
   * o null si todos fallaron / no estaban configurados.
   *
   * NOTA: Claude NO acepta audio nativo; el provider de Claude no implementa
   * STT, así que en turnos de voz Claude no servirá como respaldo (lanzará).
   * El warn se registra y se continúa con el siguiente candidato.
   */
  private async tryFailoverChain(
    organizationId: string,
    primaryName: 'GEMINI' | 'CHATGPT' | 'CLAUDE',
    text: string | null,
    audio: { base64: string; mimeType: string } | null,
    vocabularyHints?: VocabularyHints,
  ): Promise<SchedulingExtraction | null> {
    const fullChain: Array<'CHATGPT' | 'CLAUDE'> = ['CHATGPT', 'CLAUDE'];
    const candidates = fullChain.filter((p) => p !== primaryName);

    for (const candidate of candidates) {
      const provider = await this.llmFactory.forOrgByProvider(
        organizationId,
        candidate,
      );
      if (!provider) {
        this.logger.warn(
          `[FAILOVER] ${candidate} sin credenciales en BD para la org — saltando`,
        );
        continue;
      }
      try {
        this.logger.warn(
          `[FAILOVER] Intentando ${candidate} tras agotar ${primaryName}`,
        );
        const result = await provider.extractSchedulingIntent({
          text,
          audio,
          vocabularyHints,
        });
        this.logger.log(`[FAILOVER] ${candidate} respondió OK`);
        return result;
      } catch (err: unknown) {
        this.logger.warn(
          `[FAILOVER] ${candidate} también falló: ${getErrorMessage(err)}`,
        );
        continue;
      }
    }
    return null;
  }

  /** Forma estándar del fallback simple cuando el LLM no produce extracción. */
  private buildEmptyFallback(
    text: string | null,
    isRateLimited: boolean,
  ): SchedulingExtraction {
    return {
      transcript: text,
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
      isFallback: true,
      isCancellation: false,
      isModification: false,
      isEmergency: false,
      isRateLimited,
    };
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
      nombre: currentState === ChatState.AWAITING_NAME ? t || null : null,
      eps: currentState === ChatState.AWAITING_EPS ? t || null : null,
      especialidad:
        currentState === ChatState.AWAITING_SPECIALTY ? t || null : null,
      doctor: null,
      fechaSolicitada: null,
      intent: 'otro' as const,
      isEscape: this.escapeRegex.test(textoParaCoincidencia(t)),
      outOfContext: false,
      ininteligible: false,
      isFallback: false,
      isCancellation: this.cancelRegex.test(textoParaCoincidencia(t)),
      isModification: this.modifyRegex.test(textoParaCoincidencia(t)),
      isEmergency: this.isEmergencyText(t),
      isRateLimited: false,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 🚑 DETECTOR DE EMERGENCIAS (regex local, sin LLM)
  // Banderas rojas clínicas ("dolor en el pecho", "no puedo respirar"...).
  // El bot NO hace triage: detectar aquí solo significa DERIVAR de
  // inmediato (línea 123 / urgencias / equipo humano), nunca diagnosticar
  // ni tranquilizar. Normaliza el texto igual que las frases cargadas de
  // [emergency] (minúsculas, sin tildes, puntuación → espacios) para que
  // "¡Convulsión!" y "convulsion" coincidan por igual.
  // ══════════════════════════════════════════════════════════════
  private isEmergencyText(text: string | null | undefined): boolean {
    if (!text) return false;
    return this.emergencyRegex.test(this.normalizeSynonym(text));
  }

  /**
   * 🚑 Deriva una POSIBLE emergencia: mensaje con línea 123 / urgencias /
   * equipo humano, cierre de sesión y auditoría EMERGENCY_ESCALATED.
   * Deliberadamente NO envía encuesta CSAT (no se le manda un link de
   * encuesta a quien acaba de reportar dolor torácico). `via` registra la
   * capa que detectó: regex pre-LLM sobre el texto, flag isEmergency del
   * LLM (Tarea D) o regex sobre la transcripción del audio.
   */
  private async escalateEmergency(p: {
    organizationId: string;
    senderId: string;
    org: Organization | null;
    MSGS: ReturnType<typeof buildMessages>;
    text: string | undefined;
    currentState: ChatState;
    via: 'EMERGENCY_REGEX' | 'EMERGENCY_LLM' | 'EMERGENCY_TRANSCRIPT_REGEX';
  }): Promise<void> {
    const humanPhone = p.org?.supportPhone || '';
    const reply = p.MSGS.guardrailEmergencia(humanPhone);
    await this.smartReply(p.organizationId, p.senderId, reply);
    await this.cleanUpSession(p.organizationId, p.senderId);

    // 📟 Alerta proactiva al equipo humano (best-effort: NUNCA rompe el
    // flujo del paciente). La derivación al 123 no sustituye el seguimiento:
    // un funcionario debe llamar al paciente. Requiere que supportPhone sea
    // un número con WhatsApp (los fijos no lo reciben; Meta rechaza y queda
    // en el log del servidor). Nota Meta: fuera de la ventana de 24h del
    // staff el envío de texto libre puede fallar — por eso el resultado se
    // registra en `staffAlerted` y la auditoría EMERGENCY_ESCALATED queda
    // SIEMPRE visible en el panel de auditoría como respaldo.
    let staffAlerted = false;
    const alertPhone = (p.org?.supportPhone || '').replace(/\D/g, '');
    if (alertPhone.length >= 10) {
      try {
        const alertText =
          `🚨 *ALERTA: POSIBLE EMERGENCIA MÉDICA*\n\n` +
          `Un paciente reportó síntomas que podrían requerir atención ` +
          `inmediata y el asistente lo derivó a la línea 123 / Urgencias.\n\n` +
          `📱 Paciente: +${p.senderId}\n` +
          `💬 Mensaje: "${(p.text || '[audio]').slice(0, 300)}"\n\n` +
          `Por favor contáctelo AHORA para hacer seguimiento.`;
        const result = await this.sendOutboundForOrg(
          p.organizationId,
          alertPhone,
          alertText,
        );
        staffAlerted = result.success;
      } catch (e: unknown) {
        this.logger.error(
          `No fue posible alertar al staff de la emergencia (org=${p.organizationId}): ${getErrorMessage(e)}`,
        );
      }
    } else {
      this.logger.warn(
        `Sin teléfono de staff válido para alertar la emergencia (org=${p.organizationId}, supportPhone="${p.org?.supportPhone || ''}").`,
      );
    }

    await this.auditLog(p.senderId, p.organizationId, {
      status: InteractionStatus.EMERGENCY_ESCALATED,
      userMessage: p.text || '[audio]',
      botReply: reply,
      metadata: {
        guardrail: p.via,
        previousState: p.currentState,
        immediate: true,
        staffAlerted,
      },
    });
  }

  // ══════════════════════════════════════════════════════════════
  // INTENT ROUTER (sin llamada a Gemini — regex local)
  // Clasifica el mensaje en IDLE sin consumir cuota de API.
  // Fail-open: 'other' → cae al flujo de agendamiento normal.
  // ══════════════════════════════════════════════════════════════
  private classifyIntentLocal(text: string): 'faq' | 'other' {
    // Normalizar: minúsculas + quitar tildes para comparación robusta
    const t = text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    // Palabras interrogativas o de solicitud de información
    const hasQuestionWord =
      /\b(como|cuanto|cuando|donde|que|cual|quien|puedo|pueden|tienen|tiene|aceptan|cobran|vale|cuestan|cuesta|atienden|funciona|hay|existe|permiten|solicitar)\b/.test(
        t,
      );

    // Temas propios de FAQ de clínica (no de agendamiento)
    const hasFaqTopic =
      /\b(eps|seguro|asegurador|laboratorio|urgencia|historia.{0,10}clinica|incapacidad|certificado|parqueo|parqueadero|visita|acompanante|factura|tarifa|costo|precio|documento|requisito|telefono|correo|direccion|telemedicin|farmacia|radiolog|ecograf|rayos|scanner|pqrs|habeas|tramite|convenio|metodo.{0,5}pago|efectivo|nequi|pse|bancolombia)\b/.test(
        t,
      );

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
    const t = (text || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    if (!t) return false;

    // Afirmaciones al inicio del mensaje ("sí", "claro", "dale", "ok"...).
    const afirmacion =
      /^(si|sip|claro|dale|ok|okay|listo|bueno|vale|por supuesto|afirmativo|correcto|exacto|de una|eso es|asi es)\b/.test(
        t,
      );

    // Verbos/sustantivos de agendamiento en cualquier parte del texto.
    const agendamiento =
      /\b(agendar|agendame|agendarme|agenda|reservar|reserva|programar|programarme|sacar|pedir|quiero|necesito|deseo|cita|citas|turno)\b/.test(
        t,
      );

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
  private faqClaimsAvailability(
    reply: string,
    kbContent: string | null,
  ): boolean {
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
    org: Organization | null,
    botName: string,
  ): Promise<void> {
    const supportPhone = org?.supportPhone || '(601) 555-0199';
    const clinicName = org?.name || 'nuestra Clínica';

    // Inyectar tono al system prompt según el estilo configurado por la org.
    const style =
      await this.organizationSettings.getCommunicationStyle(organizationId);
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
      await this.auditSuccess(senderId, organizationId, {
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
      `0. 🚨 EMERGENCIAS (MÁXIMA PRIORIDAD, por encima de todas las demás reglas): ` +
      `si la pregunta describe síntomas o una situación que PODRÍA ser una emergencia ` +
      `médica EN CURSO (dolor u opresión en el pecho, dificultad para respirar, sangrado ` +
      `abundante, pérdida de conciencia, convulsiones, ideación suicida, envenenamiento, ` +
      `sobredosis, trauma grave, reacción alérgica severa), NO respondas como FAQ: responde ` +
      `ÚNICAMENTE que lo que describe podría requerir atención médica inmediata, que llame ` +
      `YA a la línea de emergencias *123* o acuda al servicio de *Urgencias* más cercano, ` +
      `y que puede comunicarse con nuestro equipo al *${supportPhone}*. NUNCA diagnostiques, ` +
      `NUNCA minimices ("no parece grave" está PROHIBIDO) y NO agregues información de la ` +
      `base de conocimiento ni invitación a agendar. En cambio, las preguntas INFORMATIVAS ` +
      `sobre el servicio de urgencias (horario, dirección, costo) SÍ son FAQ normal.\n` +
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
        await this.auditSuccess(senderId, organizationId, {
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
        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.FAQ_HALLUCINATION,
          userMessage: question,
          botReply: availabilityRedirect,
          metadata: {
            step: 'FAQ_AVAILABILITY_BLOCKED',
            provider: provider.name,
            suppressedReply: reply,
          },
        });
        return;
      }

      await this.smartReply(organizationId, senderId, reply);
      await this.auditSuccess(senderId, organizationId, {
        userMessage: question,
        botReply: reply,
        metadata: { step: 'FAQ_ANSWERED', provider: provider.name },
      });
    } catch (err: unknown) {
      this.logger.error(`answerFAQ falló: ${getErrorMessage(err)}`);
      const fallback =
        `Lo siento, tuve un inconveniente al procesar su consulta. 😔\n\n` +
        `Para más información, comuníquese con nosotros al *${supportPhone}*.`;
      await this.smartReply(organizationId, senderId, fallback);
      await this.auditFailure(senderId, organizationId, {
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
      // Las URLs (p. ej. el enlace a la política de datos) suenan fatal leídas
      // letra por letra; las quitamos junto con su etiqueta "Consúlte/ala aquí:".
      .replace(/Cons[uú]lt[ae]la?\s+aqu[ií]:?\s*/gi, '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[*_~`[\]]/g, '') // markdown
      .replace(/\p{Extended_Pictographic}/gu, '') // todos los emojis
      .replace(/[\u{FE00}-\u{FE0F}\u{200D}]/gu, '') // variation selectors + ZWJ
      .replace(/[\uD800-\uDFFF]/g, '') // surrogates sueltos remanentes
      // ── Marcas inclusivas de género para voz ─────────────────────
      // El texto escrito usa el desdoblamiento "(a)/(o)/(as)/(os)" para no
      // marcar género ("tranquilo(a)", "Bienvenido(a)", "Dr(a).", "afiliado(a)").
      // El TTS lo lee como "tranquilo paréntesis a" o "tranquilo a". Para voz
      // quitamos el paréntesis y dejamos solo la raíz: "tranquilo(a)" → "tranquilo".
      .replace(/\(([oa]s?)\)/gi, '')
      // "Dr." / "Dra." (tras quitar el "(a)") suenan mejor expandidos a la
      // palabra completa; algunos motores no lo hacen por sí solos.
      .replace(/\bDra\.?/g, 'Doctora')
      .replace(/\bDr\.?/g, 'Doctor')
      // ── Símbolos y abreviaturas para voz ─────────────────────────
      // "#3" → "3" (el motor leería "numeral" o "almohadilla"). El "#" solo
      // aparece como prefijo de posición de lista de espera ("posición #3").
      .replace(/#(?=\d)/g, '')
      // "15 min" → "15 minutos" (el TTS deletrea o corta "min").
      .replace(/(\d+)\s*min\b/gi, '$1 minutos')
      // ── Paréntesis de ejemplos/ayudas para voz ───────────────────
      // Las aclaraciones entre paréntesis ("(Ej: Sura, Sanitas...)", "(A, B,
      // C...)") suenan mal: el motor lee "abre paréntesis". Las convertimos en
      // un inciso con comas (pausa natural) y expandimos "Ej:" → "por ejemplo".
      .replace(/\bEj\.?:?/gi, 'por ejemplo,')
      .replace(/\s*\(([^)]+)\)/g, ', $1,')
      .replace(/,\s*([,.;:])/g, '$1') // colapsa ",." / ",," que deja lo anterior
      .replace(/([.?!:;])\s*,/g, '$1') // y la coma sobrante tras "?," / ".,"
      // ── Normalización de horas para voz ──────────────────────────
      // El TTS lee "03:00" como "cero tres cero cero". Convertimos
      // "HH:MM" → "H MM" separando con espacio y quitando el cero a la
      // izquierda de la hora: "05:30" → "5 30", "03:00" → "3 00".
      .replace(/\b0?(\d{1,2}):(\d{2})\b/g, '$1 $2')
      // El meridiano ya llega como "a m"/"p m" desde los formatters
      // canónicos, pero el LLM puede generar "a.m."/"p. m."/"5pm" en texto
      // libre que no pasa por cleanMeridiem. Normalizamos SOLO las formas
      // con punto ("a. m.") o pegadas a la hora ("5 30 pm") para no tocar
      // español natural como "a mañana" o "para mí".
      .replace(/\b([ap])\.\s*m\.?/gi, '$1 m') // "a. m." / "p.m." → "a m" / "p m"
      .replace(/(\d)\s*([ap])\s*m\b/gi, '$1 $2 m') // "5 30pm" → "5 30 p m"
      // ── Números de documento para voz ───────────────────────────
      // El TTS lee "123456789" como una cifra gigante ("ciento veintitrés
      // millones...") imposible de seguir para confirmar la cédula.
      // Agrupamos en bloques de 3 desde la derecha para que se lean por
      // separado: "123456789" → "123 456 789", "1234567" → "1 234 567".
      // Solo runs de 6+ dígitos (cédulas/NITs); así no tocamos años (2026)
      // ni las horas ya normalizadas ("5 30").
      .replace(/\b\d{6,15}\b/g, (m) => this.groupDigitsForSpeech(m))
      .replace(/\s+/g, ' ')
      .trim();
    return this.ttsFactory.synthesize(organizationId, cleanText);
  }

  /**
   * Agrupa una cadena de dígitos en bloques de 3 desde la derecha, separados
   * por espacio, para que el TTS los lea por separado (claridad en cédulas):
   *   "123456789" → "123 456 789"
   *   "1234567"   → "1 234 567"
   * Es la agrupación clásica de miles; el espacio fuerza al motor a leer cada
   * bloque como un número independiente en vez de una sola cifra gigante.
   */
  private groupDigitsForSpeech(digits: string): string {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  private async uploadToWhatsApp(
    audioBuffer: Buffer,
    creds: ResolvedWhatsappCredentials,
  ): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      const blob = new Blob([new Uint8Array(audioBuffer)], {
        type: 'audio/ogg',
      });
      formData.append('file', blob, 'audio.ogg');
      const response = await fetch(
        metaGraphUrl(`${creds.phoneNumberId}/media`),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.accessToken}` },
          body: formData,
        },
      );
      const data = (await response.json()) as { id?: string };
      if (!response.ok) {
        this.logger.error(`Error subiendo audio: ${JSON.stringify(data)}`);
        return null;
      }
      return data.id ?? null;
    } catch (error: unknown) {
      this.logger.error(`Error en uploadToWhatsApp: ${getErrorMessage(error)}`);
      return null;
    }
  }

  private async sendWhatsAppAudioMessage(
    recipientId: string,
    mediaId: string,
    creds: ResolvedWhatsappCredentials,
    ctx?: OutboundMessageContext,
  ) {
    try {
      const response = await lastValueFrom(
        this.httpService.post<unknown>(
          metaGraphUrl(`${creds.phoneNumberId}/messages`),
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            ...buildWhatsappRecipient(recipientId),
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
      // En modo voz el paciente puede recibir SOLO el audio: sin registrarlo, la
      // confirmación de su cita no dejaría ningún rastro en el libro.
      await this.messageLog.recordOutbound({
        organizationId: creds.organizationId,
        recipientId,
        messageType: 'AUDIO',
        metaResponse: response.data,
        context: ctx,
      });
    } catch (error: unknown) {
      this.logger.error(
        `Error enviando audio a ${recipientId}: ${getAxiosErrorDetail(error)}`,
      );
    }
  }

  // `audioText` (opcional): cuando el `text` es un LISTADO largo (horarios,
  // citas para elegir), no queremos que el audio lea todas las opciones. El
  // llamador pasa una frase corta para hablar (p.ej. "A continuación le presento
  // las opciones que encontré con SURA") y el listado completo viaja SIEMPRE por
  // texto, independientemente de SHOW_TEXT_IN_AUDIO_MODE.
  private async smartReply(
    organizationId: string,
    senderId: string,
    text: string,
    audioText?: string,
    ctx?: OutboundMessageContext,
  ) {
    const isAiFlow =
      (await this.redis.get(`is_ai_flow:${organizationId}:${senderId}`)) ===
      'true';

    // ✈️ Telegram en modo voz: la nota se manda directo (no hay que «subirla»
    // antes como en Meta). El texto, como siempre, por sendWhatsAppMessage.
    if (isAiFlow && isTelegramSender(senderId)) {
      await this.smartReplyTelegramVoice(
        organizationId,
        senderId,
        text,
        audioText,
        ctx,
      );
      return;
    }

    if (isAiFlow) {
      // En modo voz, mostrar TAMBIÉN el texto está controlado por .env.
      // Por defecto OFF: solo se envía el audio. A futuro se puede prender con
      // SHOW_TEXT_IN_AUDIO_MODE=true sin tocar código.
      const showTextInAudioMode =
        this.configService.get<string>('SHOW_TEXT_IN_AUDIO_MODE', 'false') ===
        'true';
      try {
        const creds = await this.resolveCredentialsForOrg(organizationId);
        let audioSent = false;
        if (creds && creds.isActive) {
          // Si hay `audioText`, el audio dice solo esa frase corta; el detalle
          // (el listado) se entrega por texto más abajo.
          const speakText = audioText ?? text;
          const audioBuffer = await this.generateTTS(organizationId, speakText);
          if (audioBuffer) {
            const mediaId = await this.uploadToWhatsApp(audioBuffer, creds);
            if (mediaId) {
              await this.sendWhatsAppAudioMessage(
                senderId,
                mediaId,
                creds,
                ctx,
              );
              audioSent = true;
            }
          }
        }
        // El texto se envía cuando: (a) hay `audioText` (el audio NO contiene el
        // detalle, así que el texto es obligatorio), (b) el flag está prendido, o
        // (c) el audio no se pudo entregar (fallback para no dejar al usuario sin
        // respuesta alguna).
        if (audioText || showTextInAudioMode || !audioSent) {
          await this.sendWhatsAppMessage(senderId, text, ctx);
        }
        return;
      } catch (error: unknown) {
        this.logger.error(
          `Error en smartReply (AI flow): ${getErrorMessage(error)}`,
        );
        // Ante cualquier error en el camino de audio, garantizamos respuesta
        // por texto para no dejar al usuario sin contestación.
        await this.sendWhatsAppMessage(senderId, text, ctx);
        return;
      }
    }
    await this.sendWhatsAppMessage(senderId, text, ctx);
  }

  /** `smartReply` en modo voz por Telegram. Misma política de texto que Meta. */
  private async smartReplyTelegramVoice(
    organizationId: string,
    senderId: string,
    text: string,
    audioText?: string,
    ctx?: OutboundMessageContext,
  ): Promise<void> {
    const showTextInAudioMode =
      this.configService.get<string>('SHOW_TEXT_IN_AUDIO_MODE', 'false') ===
      'true';
    try {
      let audioSent = false;
      if (this.telegramChannel) {
        const audioBuffer = await this.generateTTS(
          organizationId,
          audioText ?? text,
        );
        if (audioBuffer) {
          const outcome = await this.telegramChannel.sendVoice(
            organizationId,
            senderId,
            audioBuffer,
            ctx,
          );
          audioSent = outcome.ok;
        }
      }
      if (audioText || showTextInAudioMode || !audioSent) {
        await this.sendWhatsAppMessage(senderId, text, ctx);
      }
    } catch (error: unknown) {
      this.logger.error(
        `Error en smartReply (voz por Telegram): ${getErrorMessage(error)}`,
      );
      await this.sendWhatsAppMessage(senderId, text, ctx);
    }
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
    } catch (e: unknown) {
      this.logger.error(
        `No se pudo enviar el enlace de encuesta a ${senderId}: ${getErrorMessage(e)}`,
      );
    }
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 4c: PADRÓN EPS — VERIFICACIÓN DE ALTA
  // Regla de negocio: agendar POR EPS exige que la cédula esté dada de alta
  // en el padrón de la clínica (EpsEnrolledPatient, cargado por CSV).
  // "Particular" (pago directo) NO pasa por el padrón.
  //
  // Si el paciente NO está de alta: mensaje amable + enlace al formulario
  // público de solicitud de revisión, auditoría y cierre de la sesión.
  // Devuelve true si el flujo debe DETENERSE (paciente bloqueado).
  // ══════════════════════════════════════════════════════════════
  private async rejectIfNotEnrolledInEps(params: {
    organizationId: string;
    senderId: string;
    cedula: string;
    epsId: string | null;
    MSGS: ReturnType<typeof buildMessages>;
    userMessage?: string | null;
  }): Promise<boolean> {
    const { organizationId, senderId, epsId, MSGS, userMessage } = params;
    if (!epsId) return false; // sin EPS asociada (flujo Particular) → no aplica

    // Autoritativo: resolvemos la EPS por id DENTRO del tenant. "Particular"
    // vive como fila de Eps en BD, por eso se detecta por nombre.
    const eps = await this.prisma.eps.findFirst({
      where: { id: epsId, organizationId },
      select: { id: true, name: true },
    });
    if (!eps || eps.name.toLowerCase() === PARTICULAR_EPS_NAME.toLowerCase()) {
      return false;
    }

    const cedula = normalizeDocumento(params.cedula);
    if (!cedula) return false; // la cédula vacía ya se rechaza aguas arriba

    // Misma función que usa el importador del padrón (documento.ts) y el
    // portón gemelo del staff (eps-enrollment.ts). Dos pasadas: el documento
    // tal como llegó, y si no aparece, la variante sin ceros a la izquierda
    // — Excel se come los ceros iniciales de una celda numérica al exportar,
    // así que el padrón puede traer "0012345" donde el paciente escribe
    // "12345". Antes de esto esa discrepancia rechazaba a alguien con
    // derecho real (ver ESTADO.md, "Normalización del documento").
    const candidatosCedula = [
      ...new Set([cedula, documentoSinCerosIniciales(cedula)]),
    ];
    const enrolled = await this.prisma.epsEnrolledPatient.findFirst({
      where: {
        organizationId,
        epsId: eps.id,
        cedula: { in: candidatosCedula },
        isActive: true,
      },
      select: { id: true },
    });
    if (enrolled) return false;

    const baseUrl = (
      this.configService.get<string>('PUBLIC_WEB_URL') ||
      'https://agendamiento-ia.com'
    ).replace(/\/+$/, '');
    const reply = MSGS.epsNoAfiliado(
      eps.name,
      `${baseUrl}/solicitud-alta/${organizationId}`,
    );
    // Texto directo (no smartReply): el mensaje contiene un enlace que no debe
    // sintetizarse a voz — mismo criterio que el enlace de la encuesta CSAT.
    await this.sendWhatsAppMessage(senderId, reply);

    await this.auditFailure(senderId, organizationId, {
      reason: FailureReason.EPS_NOT_ENROLLED,
      userMessage: userMessage || '[audio]',
      botReply: reply,
      metadata: {
        stage: 'EPS_ENROLLMENT_BLOCKED',
        cedula,
        epsId: eps.id,
        epsName: eps.name,
      },
    });
    await this.cleanUpSession(organizationId, senderId);
    return true;
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 4d: LÍMITE DE CITAS POR PACIENTE
  // Regla de negocio (/dashboard/limites-citas): el bot no le asigna a un
  // paciente más citas de las que la clínica permite el mismo día o el mismo
  // mes, contadas por la fecha de la cita. Se revisa en cuanto el bot conoce la
  // cédula Y la fecha del cupo (antes de pedir nombre, nacimiento o régimen) y
  // otra vez dentro de la reserva (`bookAppointment`), que es la palabra final.
  //
  // Si pasa del límite: disculpa + teléfono del hospital + enlace para pedir
  // una revisión, auditoría y cierre de la sesión. Devuelve true si el flujo
  // debe DETENERSE.
  // ══════════════════════════════════════════════════════════════
  private async rejectIfOverAppointmentLimit(p: {
    organizationId: string;
    senderId: string;
    cedula: string | null | undefined;
    /** Hora del cupo elegido (ISO o Date). */
    fecha: Date | string | null | undefined;
    MSGS: ReturnType<typeof buildMessages>;
    userMessage?: string | null;
    operacion: 'BOOKING' | 'RESCHEDULE';
    /** Cambio de fecha: la cita que se mueve no cuenta contra sí misma. */
    excluirCitaId?: string | null;
    servicio?: string | null;
  }): Promise<boolean> {
    if (!this.limiteCitas || !p.cedula || !p.fecha) return false;
    const fecha = new Date(p.fecha);
    if (Number.isNaN(fecha.getTime())) return false;

    let limite: LimiteDelPaciente | null;
    try {
      limite = await this.limiteCitas.evaluar({
        organizationId: p.organizationId,
        cedula: p.cedula,
        fecha,
        excluirCitaId: p.excluirCitaId,
      });
    } catch (e: unknown) {
      // Falla abierta a propósito: la reserva lo vuelve a revisar dentro de su
      // transacción, así que un error aquí no deja pasar a nadie; solo evita
      // tumbar la conversación por una lectura.
      this.logger.error(
        `No se pudo revisar el límite de citas (org=${p.organizationId}): ${getErrorMessage(e)}`,
      );
      return false;
    }
    if (!limite) return false;

    await this.avisarLimiteDeCitas({ ...p, fecha, limite });
    if (p.operacion === 'RESCHEDULE') {
      await this.cleanUpModifySession(p.organizationId, p.senderId);
    } else {
      await this.cleanUpSession(p.organizationId, p.senderId);
    }
    return true;
  }

  /**
   * El aviso al paciente que llegó al límite: deja lista la solicitud de
   * revisión (o detecta que ya hay una en curso) y le escribe. Lo usan el
   * freno temprano y las reservas que `bookAppointment` rechaza por límite.
   * No cierra la sesión: eso lo decide quien llama.
   */
  private async avisarLimiteDeCitas(p: {
    organizationId: string;
    senderId: string;
    MSGS: ReturnType<typeof buildMessages>;
    limite: LimiteDelPaciente;
    operacion: 'BOOKING' | 'RESCHEDULE';
    fecha: Date;
    servicio?: string | null;
    userMessage?: string | null;
  }): Promise<void> {
    const { organizationId, senderId, MSGS, limite, operacion } = p;
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { supportPhone: true, timezone: true },
    });
    const contacto = org?.supportPhone
      ? MSGS.contactoClinica(org.supportPhone)
      : MSGS.contactoClinicaSinTelefono();

    // La revisión: enlace para pedirla, aviso de que ya hay una en curso, o
    // nada si ya radicó el máximo para ese periodo.
    let solicitud: 'ENLACE' | 'EN_REVISION' | 'SIN_ENLACE' = 'SIN_ENLACE';
    let solicitudId: string | undefined;
    let revision = '';
    try {
      const preparada = this.limiteCitas
        ? await this.limiteCitas.prepararSolicitud({
            organizationId,
            limite,
            canal: canalDe(senderId),
            telefono: isWhatsappPhoneId(senderId) ? senderId : null,
            operacion,
            fechaSolicitada: p.fecha,
            servicio: p.servicio,
          })
        : ({ estado: 'SIN_ENLACE' } as const);
      solicitud = preparada.estado;
      if (preparada.estado === 'ENLACE') {
        const baseUrl = (
          this.configService.get<string>('PUBLIC_WEB_URL') ||
          'https://agendamiento-ia.com'
        ).replace(/\/+$/, '');
        solicitudId = preparada.solicitudId;
        revision = MSGS.limiteCitasRevisionEnlace(
          `${baseUrl}/solicitud-citas/${preparada.solicitudId}`,
        );
      } else if (preparada.estado === 'EN_REVISION') {
        revision = MSGS.limiteCitasRevisionEnCurso(
          limite.tipo === 'DAILY' ? 'ese día' : 'ese mes',
        );
      }
    } catch (e: unknown) {
      // Sin solicitud, el aviso sigue saliendo con el teléfono del hospital.
      this.logger.error(
        `No se pudo preparar la solicitud de más citas (org=${organizationId}): ${getErrorMessage(e)}`,
      );
    }

    const periodo = etiquetaPeriodo(
      limite.tipo,
      limite.periodo.clave,
      org?.timezone ?? undefined,
    );
    const aviso =
      operacion === 'RESCHEDULE'
        ? limite.tipo === 'DAILY'
          ? MSGS.limiteCitasCambioDia
          : MSGS.limiteCitasCambioMes
        : limite.tipo === 'DAILY'
          ? MSGS.limiteCitasDia
          : MSGS.limiteCitasMes;
    const reply = aviso(
      unaOVariasCitas(limite.limite),
      unaOVariasCitas(limite.citas),
      periodo,
      contacto,
      revision,
    );
    // Texto directo (no smartReply): lleva un enlace que no debe sintetizarse
    // a voz — mismo criterio que el del padrón EPS y el de la encuesta.
    await this.sendWhatsAppMessage(senderId, reply);

    await this.auditFailure(senderId, organizationId, {
      reason: FailureReason.APPOINTMENT_LIMIT_REACHED,
      userMessage: p.userMessage || '[audio]',
      botReply: reply,
      metadata: {
        stage:
          operacion === 'RESCHEDULE'
            ? 'APPOINTMENT_LIMIT_RESCHEDULE'
            : 'APPOINTMENT_LIMIT_BOOKING',
        tipo: limite.tipo,
        periodo: limite.periodo.clave,
        limite: limite.limite,
        limiteBase: limite.limiteBase,
        citas: limite.citas,
        cedula: limite.paciente.cedula,
        specialty: p.servicio ?? undefined,
        solicitud,
        solicitudId,
      },
    });
  }

  /**
   * Traduce el `epsId` guardado en la sesión al valor con el que se persiste
   * la cita: `null` cuando la EPS elegida es "Particular" (pago directo) o
   * cuando el id ya no resuelve dentro del tenant.
   *
   * "Particular" existe como fila de `Eps` únicamente para poder aparecer en
   * el menú de selección; no representa una afiliación. Los pasos previos del
   * protocolo ya la traducen a `null` (`epsIdForSlots` / `epsIdForPatient`),
   * así que este helper mantiene esa misma regla en el punto de reserva.
   */
  private async normalizeEpsIdForBooking(
    organizationId: string,
    epsId: string | null | undefined,
  ): Promise<string | null> {
    if (!epsId) return null;
    const eps = await this.prisma.eps.findFirst({
      where: { id: epsId, organizationId },
      select: { name: true },
    });
    if (!eps) return null;
    return eps.name.toLowerCase() === PARTICULAR_EPS_NAME.toLowerCase()
      ? null
      : epsId;
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 5: PERSISTENCIA DE PACIENTE — MULTI-PACIENTE
  // ══════════════════════════════════════════════════════════════
  private async ensurePatientPersisted(params: {
    cedula: string;
    nombre: string;
    identity: SenderIdentity;
    organizationId: string;
    epsId?: string | null;
    /**
     * El HIS los exige y una clínica sin espejo los ignora. Al CREAR se guardan
     * tal cual; en un paciente que ya existe solo rellenan lo que le falte.
     */
    dateOfBirth?: Date;
    gender?: string;
    regime?: string;
    /**
     * La frontera entre nombres y apellidos, tal como la dio el paciente. El
     * HIS los guarda en columnas separadas y deducirla de `nombre` es adivinar.
     */
    nombres?: string;
    apellidos?: string;
  }): Promise<PatientProfile | null> {
    const {
      cedula,
      nombre,
      identity,
      organizationId,
      epsId,
      dateOfBirth,
      gender,
      regime,
      nombres,
      apellidos,
    } = params;

    // Cada identificador va a SU columna: `whatsappId` es el teléfono y `bsuid`
    // el Business-scoped user ID. Compat hacia atrás: mientras Meta no mande
    // BSUID, `senderId` ES el teléfono (o el PSID legacy de Messenger) y se
    // sigue guardando en `whatsappId` exactamente como antes.
    //
    // ✈️ Telegram: el remitente (`tg:<chat_id>`) NO es un teléfono. Va a
    // `telegramChatId` y `whatsappId` no se toca: ahí alimentaría recordatorios
    // y enlaces `wa.me` hacia un número que no existe.
    const telegramChatId = identity.telegramChatId ?? null;
    const phoneToPersist = telegramChatId
      ? null
      : (identity.phone ?? (identity.bsuid ? null : identity.senderId));
    const { bsuid } = identity;

    // Cédula única POR CLÍNICA: buscamos solo dentro del tenant actual para
    // no adoptar (ni filtrar datos de) un paciente de otra organización.
    let patient = await this.prisma.patientProfile.findFirst({
      where: { cedula, organizationId },
    });

    if (patient) {
      // Tipado explícito (antes `any`): con `any` en `data`, el resultado del
      // update contagiaba `any` a `patient` y todo acceso posterior quedaba sin
      // verificar por el compilador.
      const updates: {
        whatsappId?: string;
        bsuid?: string;
        telegramChatId?: string;
        telegramBlockedAt?: null;
        epsId?: string;
        dateOfBirth?: Date;
        gender?: string;
        regime?: string;
      } = {};
      if (phoneToPersist && !patient.whatsappId)
        updates.whatsappId = phoneToPersist;
      // El BSUID sí se refresca aunque ya haya uno: es el identificador con el
      // que le responderemos, así que un valor viejo lo dejaría inalcanzable.
      if (bsuid && patient.bsuid !== bsuid) updates.bsuid = bsuid;
      // Igual que el BSUID: es el chat por el que se le responde, así que se
      // refresca, y un chat que vuelve a escribir ya no está bloqueado.
      if (telegramChatId && patient.telegramChatId !== telegramChatId) {
        updates.telegramChatId = telegramChatId;
        updates.telegramBlockedAt = null;
      }
      if (epsId && !patient.epsId) updates.epsId = epsId;
      // Lo que el paciente acaba de contestar porque su ficha no lo tenía (ver
      // `siguienteDatoDeAlta`). Solo rellena huecos: nunca pisa un dato que ya
      // estaba, venga del HIS o de un alta anterior.
      if (dateOfBirth && !patient.dateOfBirth)
        updates.dateOfBirth = dateOfBirth;
      if (gender && !patient.gender) updates.gender = gender;
      if (regime && !patient.regime) updates.regime = regime;
      if (Object.keys(updates).length > 0) {
        try {
          patient = await this.prisma.patientProfile.update({
            where: { id: patient.id },
            data: updates,
          });
        } catch (error: unknown) {
          this.logger.error(
            `Error actualizando paciente ${cedula}: ${getErrorMessage(error)}`,
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
          // El usuario temporal pertenece a la clínica que registró al
          // paciente; sin esto quedaría huérfano al purgar la organización.
          organizationId,
        },
      });
      patient = await this.prisma.patientProfile.create({
        data: {
          cedula,
          fullName: nombre,
          ...(nombres ? { nombres } : {}),
          ...(apellidos ? { apellidos } : {}),
          whatsappId: phoneToPersist,
          bsuid,
          ...(telegramChatId ? { telegramChatId } : {}),
          userId: tempUser.id,
          epsId: epsId || null,
          organizationId,
          // Datos que el HIS exige para dar de alta al paciente
          // (FE_NACI_PAC y NU_SEXO_PAC son NOT NULL) y el régimen, del que
          // depende el convenio de facturación. Opcionales aquí porque una
          // clínica sin espejo no los necesita.
          ...(dateOfBirth ? { dateOfBirth } : {}),
          ...(gender ? { gender } : {}),
          ...(regime ? { regime } : {}),
        },
      });
      this.logger.log(
        `✅ Paciente persistido: ${nombre} (cédula ${cedula}, WA ${identity.senderId})`,
      );
      return patient;
    } catch (error: unknown) {
      this.logger.error(
        `Error persistiendo paciente cédula ${cedula}: ${getErrorMessage(error)}`,
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
      `temp_fecha_pref:${organizationId}:${senderId}`,
      `temp_selected_slot_id:${organizationId}:${senderId}`,
      `temp_selected_date_view:${organizationId}:${senderId}`,
      `temp_waitlist_service_id:${organizationId}:${senderId}`,
      `temp_waitlist_eps_id:${organizationId}:${senderId}`,
      `temp_waitlist_doctor_id:${organizationId}:${senderId}`,
      `temp_waitlist_pending:${organizationId}:${senderId}`,
      `temp_waitlist_regimen:${organizationId}:${senderId}`,
      `temp_eps_oferta_particular:${organizationId}:${senderId}`,
      `temp_lookup_cedula:${organizationId}:${senderId}`,
      `temp_lookup_hoy:${organizationId}:${senderId}`,
      `temp_lookup_opciones:${organizationId}:${senderId}`,
      `temp_pregunta_otro_servicio:${organizationId}:${senderId}`,
      `error_count:${organizationId}:${senderId}`,
      `is_ai_flow:${organizationId}:${senderId}`,
    ];
    const slotKeys = await this.redis.keys(
      `temp_slot_*:${organizationId}:${senderId}`,
    );
    const serviceMenuKeys = await this.redis.keys(
      `temp_service_*:${organizationId}:${senderId}`,
    );
    const epsMenuKeys = await this.redis.keys(
      `temp_eps_[A-Z]_*:${organizationId}:${senderId}`,
    );
    await this.redis.del(
      ...keysToDelete,
      ...slotKeys,
      ...serviceMenuKeys,
      ...epsMenuKeys,
    );
    await this.setUserState(organizationId, senderId, ChatState.IDLE);
    // Limpiar último mensaje enviado
    await this.clearLastSent(senderId);
  }

  // ══════════════════════════════════════════════════════════════
  // HELPER 7: RESOLVER MÉDICO PREFERIDO (nombre libre → DoctorProfile.id)
  // El paciente puede escribir "Dr. Pérez", "pérez", "Juan Pérez"...
  // Devuelve el id SÓLO si hay UNA coincidencia activa inequívoca dentro
  // de la organización, para nunca asignar un médico equivocado a la cola.
  //
  // Se filtra por `whatsappBookingEnabled` además de por `isActive`. Son dos
  // cosas distintas y hacen falta las dos: `isActive` es "este médico existe y
  // trabaja aquí"; `whatsappBookingEnabled` es "este médico está encendido
  // para WhatsApp". En un espejo de hospital la segunda arranca en `false`
  // para TODOS —`homologar.ts` importa los 27 médicos del HIS apagados y el
  // piloto los va encendiendo uno a uno—, así que sin este filtro el
  // resolvedor devolvería con toda naturalidad un médico al que AgenIA no
  // puede agendar. En la lista de espera eso es una promesa que no se puede
  // cumplir: el paciente queda esperando un cupo que nunca se le va a ofrecer.
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

    // 1º intento: médicos agendables de ESE servicio (más preciso).
    const byService = await this.prisma.doctorProfile.findMany({
      where: {
        organizationId,
        serviceId,
        isActive: true,
        whatsappBookingEnabled: true,
      },
      select: { id: true, fullName: true },
    });
    const inService = pickUnique(byService);
    if (inService) return inService;

    // 2º intento: cualquier médico agendable de la organización.
    const inOrg = await this.prisma.doctorProfile.findMany({
      where: { organizationId, isActive: true, whatsappBookingEnabled: true },
      select: { id: true, fullName: true },
    });
    return pickUnique(inOrg);
  }

  private async cleanUpCancelSession(organizationId: string, senderId: string) {
    const cancelKeys = await this.redis.keys(
      `temp_cancel_*:${organizationId}:${senderId}`,
    );
    if (cancelKeys.length > 0) await this.redis.del(...cancelKeys);
    await this.redis.del(
      `temp_selected_cancel_apt:${organizationId}:${senderId}`,
      `temp_selected_cancel_slot:${organizationId}:${senderId}`,
    );
    await this.setUserState(organizationId, senderId, ChatState.IDLE);
  }

  // Limpia el contexto efímero del flujo de reprogramación (espejo del de cancelación).
  private async cleanUpModifySession(organizationId: string, senderId: string) {
    const modifyKeys = await this.redis.keys(
      `temp_modify_*:${organizationId}:${senderId}`,
    );
    if (modifyKeys.length > 0) await this.redis.del(...modifyKeys);
    const selectedKeys = await this.redis.keys(
      `temp_selected_modify_*:${organizationId}:${senderId}`,
    );
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
  ): Promise<{ lineas: string; count: number; nombres: string[] }> {
    const services = await this.prisma.medicalService.findMany({
      where: { isActive: true, organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    // Limpiar mapping previo de servicios
    const prev = await this.redis.keys(
      `temp_service_*:${organizationId}:${senderId}`,
    );
    if (prev.length > 0) await this.redis.del(...prev);

    let lineas = '';
    let maxLetra = '';
    for (let i = 0; i < services.length; i++) {
      const letra = String.fromCharCode(65 + i);
      maxLetra = letra;
      await this.redis.set(
        `temp_service_${letra}_id:${organizationId}:${senderId}`,
        services[i].id,
        'EX',
        SESSION_TTL,
      );
      await this.redis.set(
        `temp_service_${letra}_name:${organizationId}:${senderId}`,
        services[i].name,
        'EX',
        SESSION_TTL,
      );
      lineas += `*${letra})* ${services[i].name}\n`;
    }
    if (maxLetra) {
      await this.redis.set(
        `temp_service_max_letra:${organizationId}:${senderId}`,
        maxLetra,
        'EX',
        SESSION_TTL,
      );
    }
    return {
      lineas,
      count: services.length,
      nombres: services.map((s) => s.name),
    };
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

    const prev = await this.redis.keys(
      `temp_eps_${'*'}:${organizationId}:${senderId}`,
    );
    // Solo limpiar los del menú, no temp_eps_query/temp_eps_id si ya existen
    const toClean = prev.filter(
      (k) =>
        /temp_eps_[A-Z]_(id|name):/.test(k) || /temp_eps_max_letra:/.test(k),
    );
    if (toClean.length > 0) await this.redis.del(...toClean);

    let lineas = '';
    let maxLetra = '';
    for (let i = 0; i < epsList.length; i++) {
      const letra = String.fromCharCode(65 + i);
      maxLetra = letra;
      await this.redis.set(
        `temp_eps_${letra}_id:${organizationId}:${senderId}`,
        epsList[i].id,
        'EX',
        SESSION_TTL,
      );
      await this.redis.set(
        `temp_eps_${letra}_name:${organizationId}:${senderId}`,
        epsList[i].name,
        'EX',
        SESSION_TTL,
      );
      lineas += `*${letra})* ${epsList[i].name}\n`;
    }
    if (maxLetra) {
      await this.redis.set(
        `temp_eps_max_letra:${organizationId}:${senderId}`,
        maxLetra,
        'EX',
        SESSION_TTL,
      );
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
    return Promise.race([p, timeout]).finally(() =>
      clearTimeout(timer),
    ) as Promise<T>;
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
        this.logger.warn(
          `Mapeo semántico (${entityKind}) devolvió id inexistente: ${result.id}`,
        );
        return null;
      }
      this.logger.log(
        `🧭 Mapeo semántico (${entityKind}): "${text}" → ${match.name}`,
      );
      return { id: match.id, name: match.name };
    } catch (e: unknown) {
      this.logger.warn(
        `Mapeo semántico (${entityKind}) falló/timeout: ${getErrorMessage(e)}`,
      );
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
    let phraseContainsName: {
      opt: { id: string; name: string };
      len: number;
    } | null = null;
    let nameContainsPhrase: {
      opt: { id: string; name: string };
      len: number;
    } | null = null;

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
    if (phraseContainsName)
      return {
        id: phraseContainsName.opt.id,
        name: phraseContainsName.opt.name,
      };
    if (nameContainsPhrase)
      return {
        id: nameContainsPhrase.opt.id,
        name: nameContainsPhrase.opt.name,
      };
    return null;
  }

  private async resolveServiceFromInput(
    organizationId: string,
    senderId: string,
    text: string | null,
    geminiSpecialty: string | null,
  ): Promise<{ id: string; name: string } | null> {
    // 1) Letra (tolerante a voz: "be"→B, "la a"→A, etc.)
    const candidate = this.extractOptionLetter(text);
    if (candidate) {
      const id = await this.redis.get(
        `temp_service_${candidate}_id:${organizationId}:${senderId}`,
      );
      const name = await this.redis.get(
        `temp_service_${candidate}_name:${organizationId}:${senderId}`,
      );
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
        this.logger.log(
          `🔤 Tesauro: "${text ?? geminiSpecialty}" → ancla "${anchor}" → ${bySynonym.name}`,
        );
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
  ): Promise<{ id: string; name: string } | 'AMBIGUA' | null> {
    // 1) Letra (tolerante a voz: "be"→B, "la a"→A, etc.)
    const candidate = this.extractOptionLetter(text);
    if (candidate) {
      const id = await this.redis.get(
        `temp_eps_${candidate}_id:${organizationId}:${senderId}`,
      );
      const name = await this.redis.get(
        `temp_eps_${candidate}_name:${organizationId}:${senderId}`,
      );
      if (id && name) return { id, name };
    }
    // 2) "Particular" por patrón (tolerancia a typos / sinónimos del archivo de patrones)
    const raw = textoParaCoincidencia(text);
    if (raw && this.particularRegex.test(raw)) {
      const part = await this.ensureParticularEpsForOrg(organizationId);
      if (part) return part;
    }
    // Catálogo de EPS activas (reutilizado por el match por nombre y el semántico).
    const epsList = await this.prisma.eps.findMany({
      where: { isActive: true, organizationId },
      select: { id: true, name: true },
    });

    // 2b) «Particular» dentro de una frase. Si la frase nombra TAMBIÉN otra EPS
    // («tengo Sura pero la quiero particular», «no quiero particular, por Sura»),
    // no se elige por el paciente: antes ganaba el nombre más largo del catálogo,
    // o sea, Sura o Particular según cómo se llamara la EPS. Se le pregunta.
    if (raw && this.particularEnFraseRegex.test(raw)) {
      // Solo cuenta una EPS que la clínica SÍ ofrece: «tengo Coomeva pero la
      // quiero particular» con Coomeva fuera del menú no tiene otra lectura.
      const ofrecidas = epsList.filter((e) => !isParticularEps(e.name));
      const nombrada = reconocerEps(text);
      const otraEps =
        (nombrada !== null &&
          ofrecidas.some((e) => reconocerEps(e.name) === nombrada)) ||
        this.matchCatalogByName(text, ofrecidas) !== null;
      if (otraEps) return 'AMBIGUA';
      const part = await this.ensureParticularEpsForOrg(organizationId);
      if (part) return part;
    }

    // 3) Match determinista por nombre (bidireccional, sin LLM).
    const byName =
      this.matchCatalogByName(text, epsList) ||
      this.matchCatalogByName(geminiEps, epsList);
    if (byName) return byName;

    // 3b) Una EPS real reconocida por su nombre se resuelve SOLO contra sí misma:
    // la del menú que sea la misma EPS aunque se escriba distinto («mutualser» →
    // «Asociación Mutual Ser»), o ninguna. Nunca pasa al mapeo semántico: el LLM
    // podía «acercar» Coomeva a otra EPS del menú, y agendar con el convenio de
    // otra EPS es peor que decirle que la suya no está (ver `epsNoDisponible`).
    const nombrada = reconocerEps(text) ?? reconocerEps(geminiEps);
    if (nombrada) {
      return epsList.find((e) => reconocerEps(e.name) === nombrada) ?? null;
    }

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

  /**
   * ¿El paciente nombró una EPS que esta clínica NO atiende? Devuelve su nombre para
   * decírselo, o null si no nombró ninguna reconocible (entonces se le repite el
   * menú, como siempre). Solo tiene sentido después de que `resolveEpsFromInput`
   * no encontró nada en el menú.
   *
   * Dos fuentes, ambas deterministas: el catálogo de EPS de Colombia
   * (`reconocerEps`) y las EPS que la clínica tiene desactivadas (por su nombre
   * exacto, para las que no estén en el catálogo).
   */
  /**
   * ¿Nombró una EPS con la que el bot no puede agendar? null si no (o si no es una
   * EPS). `atendida` (2026-10-21): la clínica la tiene registrada pero INACTIVA en
   * EPS, es decir, la atiende pero no por el asistente (Nueva EPS en el hospital,
   * sin padrón cargado). A esa no se le ofrece la cita particular: se agenda por
   * teléfono con su EPS. Una EPS que la clínica no tiene registrada sí la recibe.
   */
  private async epsNoDisponible(
    organizationId: string,
    text: string | null,
    geminiEps: string | null,
  ): Promise<{ nombre: string; atendida: boolean } | null> {
    const epsList = await this.prisma.eps.findMany({
      where: { organizationId },
      select: { name: true, isActive: true },
    });
    const norm = (t: string | null) => textoParaCoincidencia(t) ?? '';
    const nombrada = reconocerEps(text) ?? reconocerEps(geminiEps);
    if (nombrada) {
      // Si la clínica la tiene ACTIVA, no está «no disponible»: no se ofrece nada.
      const activa = epsList.some(
        (e) => e.isActive && reconocerEps(e.name) === nombrada,
      );
      if (activa) return null;
      const inactiva = epsList.find(
        (e) =>
          !e.isActive &&
          (reconocerEps(e.name) === nombrada ||
            norm(e.name) === norm(nombrada)),
      );
      return inactiva
        ? { nombre: inactiva.name, atendida: true }
        : { nombre: nombrada, atendida: false };
    }
    const escrita = norm(text) || norm(geminiEps);
    if (!escrita) return null;
    const inactiva = epsList.find(
      (e) =>
        !e.isActive && !isParticularEps(e.name) && norm(e.name) === escrita,
    );
    return inactiva ? { nombre: inactiva.name, atendida: true } : null;
  }

  /**
   * 🏥 Su EPS la atiende la clínica, pero no por el asistente (ver
   * `epsNoDisponible`): se le dice que la agende por teléfono con su EPS y se
   * cierra el agendamiento. No se le ofrece la cita particular (2026-10-21): un
   * paciente de Nueva EPS podía aceptarla y quedar facturado como pago directo.
   */
  private async responderEpsSoloPorTelefono(
    organizationId: string,
    senderId: string,
    nombreEps: string,
    MSGS: ReturnType<typeof buildMessages>,
    userMessage: string | undefined,
  ): Promise<void> {
    const reply = MSGS.epsSoloPorTelefono(
      nombreEps,
      this.contactoDe(MSGS, await this.organizacionDe(organizationId)),
    );
    await this.smartReply(organizationId, senderId, reply);
    await this.cleanUpSession(organizationId, senderId);
    await this.auditFailure(senderId, organizationId, {
      reason: FailureReason.EPS_NOT_FOUND,
      userMessage: userMessage || '[audio]',
      botReply: reply,
      metadata: { stage: 'EPS_SOLO_POR_TELEFONO', eps: nombreEps },
    });
  }

  /**
   * Le dice que su EPS no está disponible y le ofrece la cita particular. La
   * respuesta (SÍ/NO) se lee en el mismo paso de EPS, con la marca que deja aquí.
   */
  private async ofrecerParticular(
    organizationId: string,
    senderId: string,
    nombreEps: string,
    MSGS: ReturnType<typeof buildMessages>,
    userMessage: string | undefined,
  ): Promise<void> {
    await this.redis.set(
      this.ofertaParticularKey(organizationId, senderId),
      nombreEps,
      'EX',
      SESSION_TTL,
    );
    const reply = MSGS.epsNoDisponibleOfrecerParticular(nombreEps);
    await this.smartReply(organizationId, senderId, reply);
    await this.setUserState(organizationId, senderId, ChatState.AWAITING_EPS);
    await this.auditFailure(senderId, organizationId, {
      reason: FailureReason.EPS_NOT_FOUND,
      userMessage: userMessage || '[audio]',
      botReply: reply,
      metadata: {
        stage: 'EPS_NO_DISPONIBLE_OFERTA_PARTICULAR',
        eps: nombreEps,
      },
    });
  }

  private ofertaParticularKey(
    organizationId: string,
    senderId: string,
  ): string {
    return `temp_eps_oferta_particular:${organizationId}:${senderId}`;
  }

  // Despachador de la máquina de estados: ChatState → handler. Construido una
  // sola vez (campo de instancia, no por turno). Los estados ausentes recaen en
  // el `default` (cleanUpSession). Mantener en sync al añadir estados/handlers.
  private readonly stateHandlers: Partial<
    Record<ChatState, (ctx: ChatTurnContext) => Promise<void>>
  > = {
    [ChatState.AWAITING_DATE]: (ctx) => this.handleAwaitingDate(ctx),
    // Alta de paciente nuevo (ver la sección de handlers más abajo).
    [ChatState.AWAITING_APELLIDOS]: (ctx) => this.handleAwaitingApellidos(ctx),
    [ChatState.AWAITING_BIRTHDATE]: (ctx) => this.handleAwaitingBirthdate(ctx),
    [ChatState.AWAITING_GENDER]: (ctx) => this.handleAwaitingGender(ctx),
    [ChatState.AWAITING_REGIME]: (ctx) => this.handleAwaitingRegime(ctx),
    [ChatState.AWAITING_CONFIRMATION]: (ctx) =>
      this.handleAwaitingConfirmation(ctx),
    [ChatState.AWAITING_WAITLIST_OPTIN]: (ctx) =>
      this.handleAwaitingWaitlistOptin(ctx),
    [ChatState.AWAITING_CANCEL_CEDULA]: (ctx) =>
      this.handleAwaitingCancelCedula(ctx),
    [ChatState.AWAITING_CANCEL_RETRY_CEDULA]: (ctx) =>
      this.handleAwaitingCancelRetryCedula(ctx),
    [ChatState.AWAITING_CANCEL_SELECTION]: (ctx) =>
      this.handleAwaitingCancelSelection(ctx),
    [ChatState.AWAITING_CANCEL_CONFIRM]: (ctx) =>
      this.handleAwaitingCancelConfirm(ctx),
    [ChatState.AWAITING_POST_CANCEL_CHOICE]: (ctx) =>
      this.handleAwaitingPostCancelChoice(ctx),
    [ChatState.AWAITING_INTERRUPT_CONFIRMATION]: (ctx) =>
      this.handleAwaitingInterruptConfirmation(ctx),
    [ChatState.AWAITING_MODIFY_CEDULA]: (ctx) =>
      this.handleAwaitingModifyCedula(ctx),
    [ChatState.AWAITING_MODIFY_RETRY_CEDULA]: (ctx) =>
      this.handleAwaitingModifyRetryCedula(ctx),
    [ChatState.AWAITING_MODIFY_SELECTION]: (ctx) =>
      this.handleAwaitingModifySelection(ctx),
    [ChatState.AWAITING_MODIFY_NEW_SLOT]: (ctx) =>
      this.handleAwaitingModifyNewSlot(ctx),
    [ChatState.AWAITING_MODIFY_CONFIRM]: (ctx) =>
      this.handleAwaitingModifyConfirm(ctx),
    [ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL]: (ctx) =>
      this.handleAwaitingModifyNoSlotsCancel(ctx),
    [ChatState.AWAITING_LOOKUP_CEDULA]: (ctx) =>
      this.handleAwaitingLookupCedula(ctx),
    [ChatState.AWAITING_LOOKUP_CHOICE]: (ctx) =>
      this.handleAwaitingLookupChoice(ctx),
  };

  // ══════════════════════════════════════════════════════════════
  // CORE: PROCESAMIENTO DE MENSAJES — con try/catch global y logging
  // ══════════════════════════════════════════════════════════════
  async processIncomingMessage(event: WhatsappInboundEvent) {
    // Fallback a UNIDENTIFIED_SENDER para no perder la auditoría del error si
    // llegara un evento sin remitente; `processIncomingMessageUnsafe` lo audita
    // aparte con su propia razón de fallo.
    const senderId =
      resolveSenderIdentity(event)?.senderId ?? UNIDENTIFIED_SENDER;
    const messageType = event.type;
    const userMessage = event.text?.body?.trim() || event.message?.text?.trim();

    try {
      await this.processIncomingMessageUnsafe(event);
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      const errorStack = getErrorStack(error);
      this.logger.error(
        `🚨 Error no manejado en processIncomingMessage: ${errorMessage}`,
        errorStack,
      );

      // 📝 Auditoría: registrar el error no manejado
      await this.interactionLog.logFailure({
        whatsappId: senderId,
        reason: FailureReason.UNHANDLED_ERROR,
        userMessage: userMessage || `[${messageType}]`,
        botReply: (await this.getLastSent(senderId)) || null,
        metadata: {
          errorMessage,
          errorStack: errorStack?.substring(0, 1000),
          messageType,
        },
      });
    }
  }

  /**
   * Un webhook sin remitente identificable es un SÍNTOMA, no un no-evento: lo
   * más probable es un payload nuevo de Meta que todavía no sabemos leer (o un
   * campo de identidad que cambió de nombre). Antes se hacía `return` mudo y el
   * mensaje del paciente desaparecía sin rastro.
   *
   * El tenant sí se puede resolver: `phone_number_id` viaja en la metadata
   * aunque no venga el remitente. Adjuntarlo hace que la fila sea visible en la
   * auditoría de ESA clínica y no sólo en la vista de plataforma.
   */
  private async auditUnidentifiedSender(
    event: WhatsappInboundEvent,
  ): Promise<void> {
    const metaPhoneId = event?.metadata?.phone_number_id;
    let organizationId: string | null = null;

    if (metaPhoneId) {
      try {
        const waConfig = await this.prisma.whatsappAccountConfig.findUnique({
          where: { phoneNumberId: metaPhoneId },
          select: { organizationId: true },
        });
        organizationId = waConfig?.organizationId ?? null;
      } catch (error) {
        this.logger.error(
          `No se pudo resolver el tenant del webhook sin remitente: ${
            (error as Error).message
          }`,
        );
      }
    }

    // Sólo las CLAVES del payload, nunca sus valores: basta para diagnosticar
    // qué campo nuevo trajo Meta sin volcar datos del paciente en los logs.
    const eventKeys = Object.keys(event ?? {});

    this.logger.error(
      `🚨 Webhook SIN remitente identificable: no vino from_user_id (BSUID), ni from ` +
        `(teléfono), ni sender.id (PSID). El mensaje NO se procesó. ` +
        `phone_number_id=${metaPhoneId ?? 'ausente'} tipo=${event?.type ?? 'desconocido'} ` +
        `claves=[${eventKeys.join(', ') || 'ninguna'}]. Si esto se repite, Meta ` +
        `cambió el formato del payload y hay que enseñarle el campo nuevo a ` +
        `resolveSenderIdentity (sender-identity.ts).`,
    );

    await this.interactionLog.logFailure({
      whatsappId: UNIDENTIFIED_SENDER,
      organizationId,
      reason: FailureReason.SENDER_UNIDENTIFIED,
      userMessage:
        event?.text?.body ??
        event?.message?.text ??
        `[${event?.type ?? 'desconocido'}]`,
      metadata: {
        eventKeys,
        messageType: event?.type ?? null,
        phoneNumberId: metaPhoneId ?? null,
      },
    });
  }

  /**
   * Resuelve el tenant (organización) del evento entrante a partir del
   * `phone_number_id` de Meta. Devuelve el contexto de la org, o `null` cuando
   * el mensaje debe descartarse: sin phone_number_id, sin WhatsappAccountConfig
   * que lo reclame, u organización inactiva. NO hay fallback global — eso
   * violaría el aislamiento entre tenants. Los efectos secundarios de descarte
   * (warn, mensaje de "línea inactiva" + auditoría) ocurren aquí, como antes.
   */
  private async resolveTenant(
    event: WhatsappInboundEvent,
    senderId: string,
    text: string | undefined,
    messageType: string | undefined,
  ): Promise<{
    org: Organization;
    organizationId: string;
    orgName: string;
  } | null> {
    // ✈️ Telegram: la clínica ya la resolvió (y autenticó) el webhook por su ruta.
    const telegram = telegramOriginOf(event);
    if (telegram) {
      return this.resolveTelegramTenant(telegram, senderId, text, messageType);
    }

    // Meta envía `phone_number_id` en `value.metadata` del payload entrante.
    const metaPhoneId: string | undefined = event.metadata?.phone_number_id;
    if (!metaPhoneId) {
      this.logger.warn(
        `Webhook recibió evento sin phone_number_id. Imposible enrutar tenant. Descartado.`,
      );
      return null;
    }

    const waConfig = await this.prisma.whatsappAccountConfig.findUnique({
      where: { phoneNumberId: metaPhoneId },
      include: { organization: true },
    });
    if (!waConfig?.organization) {
      this.logger.warn(
        `Webhook recibió phone_number_id=${metaPhoneId} pero no hay ninguna ` +
          `WhatsappAccountConfig que lo reclame. Mensaje descartado.`,
      );
      return null;
    }

    const org = waConfig.organization;
    // Cacheamos el orgId del destinatario en Redis: lo usamos al hacer
    // outbound (resolveCredentialsForRecipient).
    await this.redis.set(`origin_org:${senderId}`, org.id, 'EX', SESSION_TTL);

    // ⏱️ VENTANA DE ATENCIÓN (24 h). Meta sólo acepta texto libre dentro de las
    // 24 h siguientes al ÚLTIMO MENSAJE DEL PACIENTE; fuera de ella exige una
    // plantilla aprobada. Se marca aquí, en el único punto por el que pasa todo
    // mensaje entrante, y NUNCA en los envíos salientes: responder no reabre la
    // ventana, sólo la abre un mensaje del paciente.
    await this.markServiceWindow(org.id, senderId);

    if (!org.isActive) {
      const reply =
        'Esta línea clínica se encuentra inactiva temporalmente por mantenimiento administrativo.';
      await this.sendWhatsAppMessage(senderId, reply);
      await this.auditFailure(senderId, org.id, {
        reason: FailureReason.ORG_INACTIVE,
        userMessage: text || `[${messageType}]`,
        botReply: reply,
        metadata: { orgName: org.name },
      });
      return null;
    }

    return { org, organizationId: org.id, orgName: org.name };
  }

  /**
   * Tenant de un evento de Telegram. Igual que la rama de Meta salvo dos cosas:
   * la clínica viene del webhook (no de un phone_number_id) y NO se marca la
   * ventana de 24 h, que en Telegram no existe. Si la ficha tenía el chat como
   * bloqueado, se limpia: acaba de escribir.
   */
  private async resolveTelegramTenant(
    telegram: TelegramOrigin,
    senderId: string,
    text: string | undefined,
    messageType: string | undefined,
  ): Promise<{
    org: Organization;
    organizationId: string;
    orgName: string;
  } | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: telegram.organizationId },
    });
    if (!org) {
      this.logger.warn(
        `Update de Telegram para una organización que ya no existe (${telegram.organizationId}). Descartado.`,
      );
      return null;
    }

    await this.redis.set(`origin_org:${senderId}`, org.id, 'EX', SESSION_TTL);
    await this.telegramChannel?.noteInbound(org.id, telegram.chatId);

    if (!org.isActive) {
      const reply =
        'Esta línea clínica se encuentra inactiva temporalmente por mantenimiento administrativo.';
      await this.sendWhatsAppMessage(senderId, reply);
      await this.auditFailure(senderId, org.id, {
        reason: FailureReason.ORG_INACTIVE,
        userMessage: text || `[${messageType}]`,
        botReply: reply,
        metadata: { orgName: org.name, channel: 'TELEGRAM' },
      });
      return null;
    }

    return { org, organizationId: org.id, orgName: org.name };
  }

  /**
   * Pipeline de audio de un turno: avisa al paciente ("🎧…"), descarga el audio
   * de WhatsApp y lo transcribe vía el extractor LLM. Si la transcripción tiene
   * contenido útil, la adopta como `text` del turno —⭐ unificación voz↔texto:
   * a partir de ahí el audio recorre el MISMO camino determinista que el texto
   * (match por nombre contra el catálogo en pasos de menú, FAQ, reprompts),
   * evitando que valores como "consulta externa" —que el LLM no extrae como
   * `especialidad`— se pierdan. Si no se pudo descargar, marca `ininteligible`.
   * Devuelve el `aiData` y el `text` (posiblemente actualizados).
   */
  private async transcribeAudioTurn(
    organizationId: string,
    senderId: string,
    audioId: string,
    text: string | undefined,
    aiData: SchedulingExtraction,
    currentState: ChatState,
  ): Promise<{ aiData: SchedulingExtraction; text: string | undefined }> {
    await this.redis.set(
      `is_ai_flow:${organizationId}:${senderId}`,
      'true',
      'EX',
      SESSION_TTL,
    );
    await this.sendWhatsAppMessage(
      senderId,
      '🎧 Permítame un momento, lo estoy escuchando...',
    );
    let audioBuffer: Buffer | null;
    if (isTelegramSender(senderId)) {
      // ✈️ Nota de voz de Telegram: se baja por su file_id.
      audioBuffer =
        (await this.telegramChannel?.downloadVoice(organizationId, audioId)) ??
        null;
    } else {
      const audioCreds = await this.resolveCredentialsForOrg(organizationId);
      audioBuffer = audioCreds
        ? await this.downloadWhatsAppAudio(audioId, audioCreds)
        : null;
    }
    if (audioBuffer) {
      // Capa 1 (anclaje de vocabulario): pasamos el catálogo activo del tenant
      // + las letras visibles del menú (cuando el estado es de selección por
      // letra) al LLM para sesgar STT/extracción hacia los nombres reales
      // (mitiga "Sura"→"Assura", "Nueva EPS"→"9 PS", y "A" marcado
      // ininteligible en AWAITING_DATE). Falla blanda: si la lectura falla,
      // seguimos sin hints (sin regresión).
      const vocabularyHints = await this.loadVocabularyHints(
        organizationId,
        senderId,
        currentState,
      );
      aiData = await this.extractDataWithLLM(
        organizationId,
        text ?? null,
        audioBuffer,
        1,
        vocabularyHints,
      );
      if (aiData.transcript && aiData.transcript.trim()) {
        text = aiData.transcript.trim();
      }
    } else {
      aiData.ininteligible = true;
    }
    return { aiData, text };
  }

  /**
   * Carga los nombres ACTIVOS de EPS y servicios del tenant + las letras
   * visibles del menú actual (cuando aplica) como "vocab hints" para anclar
   * al LLM en transcripción y extracción (Capa 1). La lista de EPS/servicios
   * crece automáticamente cuando la clínica agrega entidades en el dashboard.
   * Las `letterOptions` se leen de Redis para pasos `isLetterSelectionState`
   * (resuelve el caso "audio corto de una sola letra marcado ininteligible").
   * Devuelve `undefined` si no hay vocabulario o si hay error (sin regresión).
   */
  private async loadVocabularyHints(
    organizationId: string,
    senderId?: string,
    currentState?: ChatState,
  ): Promise<VocabularyHints | undefined> {
    try {
      const [eps, services, letterOptions] = await Promise.all([
        this.prisma.eps.findMany({
          where: { organizationId, isActive: true },
          select: { name: true },
        }),
        this.prisma.medicalService.findMany({
          where: { organizationId, isActive: true },
          select: { name: true },
        }),
        senderId && currentState
          ? this.loadActiveSlotLetters(organizationId, senderId, currentState)
          : Promise.resolve<string[] | undefined>(undefined),
      ]);
      const epsNames = eps.map((e) => e.name).filter((n) => !!n);
      const svcNames = services.map((s) => s.name).filter((n) => !!n);
      if (
        epsNames.length === 0 &&
        svcNames.length === 0 &&
        (!letterOptions || letterOptions.length === 0)
      ) {
        return undefined;
      }
      return {
        eps: epsNames.length > 0 ? epsNames : undefined,
        services: svcNames.length > 0 ? svcNames : undefined,
        letterOptions:
          letterOptions && letterOptions.length > 0 ? letterOptions : undefined,
        // En los menús de servicio y EPS también vale el nombre de la opción.
        ...(letterOptions &&
        letterOptions.length > 0 &&
        (currentState === ChatState.AWAITING_SPECIALTY ||
          currentState === ChatState.AWAITING_EPS)
          ? { menuAcceptsNames: true }
          : {}),
      };
    } catch (e: unknown) {
      this.logger.warn(
        `No se pudieron cargar vocab hints: ${getErrorMessage(e)}`,
      );
      return undefined;
    }
  }

  /**
   * Lee de Redis las LETRAS visibles del menú actual cuando el estado es de
   * selección por letra. Cada estado guarda los slots/citas en un patrón
   * distinto; aquí se centraliza qué patrón corresponde a cada uno. Devuelve
   * la lista ordenada (A, B, C, ...) o `undefined` si no aplica/no hay datos.
   * Solo lee `keys` con un patrón acotado al paciente: no impacta a otras
   * sesiones ni escanea el keyspace global.
   */
  private async loadActiveSlotLetters(
    organizationId: string,
    senderId: string,
    currentState: ChatState,
  ): Promise<string[] | undefined> {
    let pattern: string | null = null;
    let regex: RegExp | null = null;
    switch (currentState) {
      case ChatState.AWAITING_DATE:
        // Slots de agendamiento: `temp_slot_${letra}:${orgId}:${senderId}`.
        // También existen claves `temp_slot_${letra}_fecha:...` que hay que
        // descartar: el regex se queda solo con la base (letra + ':').
        pattern = `temp_slot_*:${organizationId}:${senderId}`;
        regex = /^temp_slot_([A-Z]):/;
        break;
      case ChatState.AWAITING_CANCEL_SELECTION:
        pattern = `temp_cancel_apt_*:${organizationId}:${senderId}`;
        regex = /^temp_cancel_apt_([A-Z]):/;
        break;
      case ChatState.AWAITING_MODIFY_SELECTION:
        pattern = `temp_modify_apt_*:${organizationId}:${senderId}`;
        regex = /^temp_modify_apt_([A-Z]):/;
        break;
      case ChatState.AWAITING_MODIFY_NEW_SLOT:
        pattern = `temp_modify_slot_*:${organizationId}:${senderId}`;
        regex = /^temp_modify_slot_([A-Z]):/;
        break;
      // Menús de servicio y de EPS (buildServiceMenu / buildEpsMenu): cada
      // opción guarda `temp_<menú>_<letra>_id` y `_name`. Sin sus letras, una
      // «A» hablada salía `ininteligible` (2026-09-28).
      case ChatState.AWAITING_SPECIALTY:
        pattern = `temp_service_*_id:${organizationId}:${senderId}`;
        regex = /^temp_service_([A-Z])_id:/;
        break;
      case ChatState.AWAITING_EPS:
        pattern = `temp_eps_*_id:${organizationId}:${senderId}`;
        regex = /^temp_eps_([A-Z])_id:/;
        break;
      default:
        return undefined;
    }
    try {
      const keys = await this.redis.keys(pattern);
      const seen = new Set<string>();
      for (const k of keys) {
        const m = k.match(regex);
        if (m) seen.add(m[1]);
      }
      const letters = [...seen].sort();
      return letters.length > 0 ? letters : undefined;
    } catch (e: unknown) {
      this.logger.warn(
        `No se pudieron leer letras del menú: ${getErrorMessage(e)}`,
      );
      return undefined;
    }
  }

  /**
   * Detección de intención rápida por patrón (sin LLM), solo sobre texto.
   * Patrones cargados desde chatbot-patterns.txt (ver loadPatterns/reloadPatterns).
   * - isQuickCancel / isQuickEscape: cancelar / saludo-reinicio (cualquier estado).
   * - isQuickModify: "cambiar/reprogramar mi cita", restringido a IDLE (primera
   *   interacción) para no interrumpir un agendamiento en curso; en turnos
   *   posteriores el LLM (isModification) cubre el cambio. Tiene prioridad sobre
   *   el escape: "cambiar mi cita" empieza por "cambiar" pero NO es un reinicio.
   */
  private detectQuickIntent(
    text: string | undefined,
    messageType: string | undefined,
    currentState: ChatState,
  ): {
    isQuickCancel: boolean;
    isQuickEscape: boolean;
    isQuickModify: boolean;
  } {
    const isQuickCancel =
      messageType === 'text' &&
      !!text &&
      this.cancelRegex.test(textoParaCoincidencia(text));

    const isQuickEscape =
      messageType === 'text' &&
      !!text &&
      this.escapeRegex.test(textoParaCoincidencia(text));

    const isQuickModify =
      messageType === 'text' &&
      !!text &&
      currentState === ChatState.IDLE &&
      this.modifyRegex.test(textoParaCoincidencia(text));

    return { isQuickCancel, isQuickEscape, isQuickModify };
  }

  /**
   * Determina el `aiData` del turno (init + cadena de extracción) y, en el
   * caso de audio, puede actualizar `text` con la transcripción adoptada.
   * Caminos mutuamente excluyentes: quick-flags deterministas; primer turno
   * / turno no-estricto → LLM; audio → STT (transcribeAudioTurn); pasos de
   * cédula → dígitos; nombre → texto tal cual; menú (especialidad/EPS) → sin
   * LLM. Recibe los flags por objeto para evitar errores de orden entre los
   * varios booleanos (TS no atrapa swaps posicionales boolean↔boolean).
   */
  private async resolveTurnData(p: {
    organizationId: string;
    senderId: string;
    text: string | undefined;
    messageType: string | undefined;
    currentState: ChatState;
    isAudio: boolean;
    audioId: string | undefined;
    isStrictStep: boolean;
    isQuickCancel: boolean;
    isQuickModify: boolean;
    isQuickEscape: boolean;
  }): Promise<{ aiData: SchedulingExtraction; text: string | undefined }> {
    const {
      organizationId,
      senderId,
      messageType,
      currentState,
      isAudio,
      audioId,
      isStrictStep,
      isQuickCancel,
      isQuickModify,
      isQuickEscape,
    } = p;
    let text = p.text;
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
      isEmergency: false,
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
      // Capa 1: el primer turno extrae eps/especialidad de texto libre — pasar
      // el catálogo del tenant ayuda al LLM a mapear typos del usuario.
      const vocabularyHints = await this.loadVocabularyHints(
        organizationId,
        senderId,
        currentState,
      );
      aiData = await this.extractDataWithLLM(
        organizationId,
        text,
        null,
        1,
        vocabularyHints,
      );
    } else if (isAudio) {
      // Pipeline de audio: descarga + transcripción (STT) y, si hay
      // transcripción útil, adopción como `text` del turno (ver
      // transcribeAudioTurn). Pasamos audioId! porque isAudio lo garantiza.
      ({ aiData, text } = await this.transcribeAudioTurn(
        organizationId,
        senderId,
        audioId!, // isAudio garantiza audioId no nulo
        text,
        aiData,
        currentState,
      ));
    } else if (
      messageType === 'text' &&
      text &&
      (currentState === ChatState.AWAITING_CEDULA ||
        currentState === ChatState.AWAITING_CANCEL_CEDULA ||
        currentState === ChatState.AWAITING_MODIFY_CEDULA ||
        currentState === ChatState.AWAITING_LOOKUP_CEDULA)
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
      (currentState === ChatState.AWAITING_NAME ||
        currentState === ChatState.AWAITING_APELLIDOS)
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
      (currentState === ChatState.AWAITING_SPECIALTY ||
        currentState === ChatState.AWAITING_EPS)
    ) {
      // En selección de menú (Pasos 1 y 2) NO llamamos a Gemini para texto:
      // el resolver del menú maneja letras (case-insensitive) y match parcial por nombre.
      // Gemini con inputs cortos como "a", "B", "Sura" tiende a marcar ininteligible=true
      // y bloquea el flujo. La voz sí va al extractor (manejada arriba en isAudio).
    } else if (messageType === 'text' && text && !isStrictStep) {
      const vocabularyHints = await this.loadVocabularyHints(
        organizationId,
        senderId,
        currentState,
      );
      aiData = await this.extractDataWithLLM(
        organizationId,
        text,
        null,
        1,
        vocabularyHints,
      );
    }
    return { aiData, text };
  }
  /**
   * Paridad voz↔texto en pasos de selección por letra: si la transcripción
   * contiene una letra válida, la adopta como `text` y resetea `aiData` a la
   * forma que tendría por TEXTO en un paso estricto (todo nulo, intent 'otro'),
   * para que ni los routers de intención ni la memoria a corto plazo (entidades
   * persistidas en Redis) se disparen con valores que el LLM pudo alucinar al
   * transcribir la letra. Si no hay letra (p.ej. "mejor cancela"), no toca nada.
   * Muta `aiData` in-place; devuelve el `text` (posiblemente la letra).
   */
  private applyVoiceLetterSelection(
    text: string | undefined,
    aiData: SchedulingExtraction,
    organizationId: string,
    senderId: string,
    currentState: ChatState,
  ): string | undefined {
    const letra = this.extractOptionLetter(text);
    if (letra) {
      text = letra;
      aiData.intent = 'otro';
      aiData.isEscape = false;
      aiData.isCancellation = false;
      aiData.isModification = false;
      aiData.outOfContext = false;
      aiData.ininteligible = false;
      aiData.cedula = null;
      aiData.nombre = null;
      aiData.eps = null;
      aiData.especialidad = null;
      aiData.doctor = null;
      aiData.fechaSolicitada = null;
      this.logger.log(
        `[Tenant: ${organizationId}] 🎙️ LETRA_VOZ paciente=${senderId} estado=${currentState} letra="${letra}"`,
      );
    }
    return text;
  }

  /**
   * Espejo de `applyVoiceLetterSelection` para los pasos SÍ/NO. Cuando la
   * transcripción resuelve a un SÍ/NO inequívoco (`interpretYesNo`), el turno
   * debe recorrer EXACTAMENTE el mismo camino determinista que por texto: en
   * esos pasos el texto no llama al LLM (son `isStrictStep`), así que sus flags
   * de intención quedan en falso y fluyen directo al handler del estado.
   *
   * Por voz, en cambio, el audio SÍ pasa por el extractor para transcribirse y
   * el LLM puede devolver `isCancellation` / `isModification` / `isEscape` /
   * `outOfContext` al ver un "sí" suelto sin contexto conversacional. Sin este
   * neutralizado, esos flags disparan los routers globales ANTES del switch y
   * el turno se pierde (p.ej. un "sí" hablado en la confirmación de una
   * cancelación reiniciaría el flujo en vez de cancelar la cita).
   *
   * NO toca `isEmergency`: el guardrail de emergencia se evalúa antes que este
   * helper y debe seguir ganando siempre. Si la transcripción no resuelve a
   * SÍ/NO (p.ej. "mejor cuénteme los horarios"), no modifica nada.
   */
  private applyVoiceYesNoAnswer(
    text: string | undefined,
    aiData: SchedulingExtraction,
    organizationId: string,
    senderId: string,
    currentState: ChatState,
  ): void {
    const decision =
      currentState === ChatState.AWAITING_CANCEL_CONFIRM
        ? this.interpretarConfirmarCancelacion(text)
        : this.interpretYesNo(text);
    if (!decision) return;

    aiData.intent = 'otro';
    aiData.isEscape = false;
    aiData.isCancellation = false;
    aiData.isModification = false;
    aiData.outOfContext = false;
    aiData.ininteligible = false;
    // Entidades alucinadas al transcribir un "sí" suelto: ningún handler de
    // paso SÍ/NO las consume (todos leen su contexto de Redis), y dejarlas
    // pasar contaminaría la memoria a corto plazo de la sesión.
    aiData.cedula = null;
    aiData.nombre = null;
    aiData.eps = null;
    aiData.especialidad = null;
    aiData.doctor = null;
    aiData.fechaSolicitada = null;
    this.logger.log(
      `[Tenant: ${organizationId}] 🎙️ SI_NO_VOZ paciente=${senderId} estado=${currentState} decision="${decision}"`,
    );
  }

  /**
   * Normalización agresiva del STT para cédula por voz (paridad con texto):
   * toma la cédula del LLM o, si falta, la extrae de la transcripción tolerando
   * el ruido del STT (separadores, muletillas, números en palabras). Si obtiene
   * dígitos, los adopta en `aiData.cedula` (in-place) y devuelve false
   * (continuar). Si no hay dígitos —y no es escape/cancel/modify— reintenta
   * acotado pidiendo la cédula por TEXTO (evita el loop SÍ/NO) y devuelve true
   * (detener el turno). Solo aplica a VOZ en pasos de cédula; el texto va intacto.
   */
  private async normalizeVoiceCedula(p: {
    aiData: SchedulingExtraction;
    text: string | undefined;
    organizationId: string;
    senderId: string;
    currentState: ChatState;
    retriesCount: number;
    retriesKey: string;
    maxRetries: number;
    MSGS: ReturnType<typeof buildMessages>;
  }): Promise<boolean> {
    const {
      aiData,
      text,
      organizationId,
      senderId,
      currentState,
      retriesCount,
      retriesKey,
      maxRetries,
      MSGS,
    } = p;
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
      // El LLM, al ver "90 90 90" sin contexto, suele marcar outOfContext/
      // ininteligible y los guards aguas abajo matarían el turno aunque la
      // cédula ya esté recuperada. Espejo de `applyVoiceLetterSelection`:
      // si la voz pudo resolverse a un dato útil, los flags meta del LLM
      // dejan de ser válidos.
      aiData.outOfContext = false;
      aiData.ininteligible = false;
    } else if (
      !aiData.isEscape &&
      !aiData.isCancellation &&
      !aiData.isModification
    ) {
      // Sin dígitos tras normalizar: NO reentramos al flujo (evita el loop de
      // SÍ/NO). Reintento acotado pidiendo la cédula por texto; al agotar
      // maxReintentos, el guard del inicio cierra con maxReintentosReset.
      const newRetries = retriesCount + 1;
      await this.redis.set(
        retriesKey,
        newRetries.toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.ininteligible();
      await this.sendWhatsAppMessage(senderId, reply);

      this.logger.warn(
        `[Tenant: ${organizationId}] 🎙️ Cédula por voz no extraíble (sttCrudo="${text ?? ''}") ` +
          `— pidiendo cédula por TEXTO. Reintento ${newRetries}/${maxRetries}.`,
      );

      await this.auditFailure(senderId, organizationId, {
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
      return true;
    }
    return false;
  }

  /**
   * Contador de fallos del LLM por organización + fallback. Si el extractor
   * marcó `isFallback`: con rate-limit (429) usa el fallback simple sin penalizar
   * el contador; con error real incrementa el contador (TTL 900s) y, mientras no
   * alcance el umbral (maxRetries de la org), usa el fallback simple. Al alcanzar
   * el umbral responde "IA caída" + auditoría y devuelve `stop:true` (detener el
   * turno). Si NO hubo fallback, resetea el contador. Devuelve el `aiData`
   * (posiblemente sustituido por el fallback) y la señal `stop`.
   */
  private async handleLlmFallback(p: {
    aiData: SchedulingExtraction;
    text: string | undefined;
    organizationId: string;
    senderId: string;
    currentState: ChatState;
    org: Organization | null;
    MSGS: ReturnType<typeof buildMessages>;
  }): Promise<{ aiData: SchedulingExtraction; stop: boolean }> {
    let { aiData } = p;
    const { text, organizationId, senderId, currentState, org, MSGS } = p;
    // Antes "GEMINI_DOWN_THRESHOLD"; el umbral ahora vive en
    // OrganizationSettings.maxRetriesPerStep (consistente con la config por clínica).
    const geminiFailKey = `gemini_fail_count:${organizationId}`;
    const geminiDownThreshold =
      await this.organizationSettings.getMaxRetries(organizationId);

    if (aiData.isFallback) {
      if (aiData.isRateLimited) {
        // 429: cuota agotada — NO es un fallo de disponibilidad de Gemini.
        // Usar fallback simple sin tocar el contador permanente.
        this.logger.warn(
          `Gemini rate-limited (429) — fallback sin penalizar contador`,
        );
        aiData = this.simpleExtractFallback(text ?? null, currentState);
      } else {
        // Error real (timeout, 5xx, etc.) → incrementar contador de caída
        const currentFails = parseInt(
          (await this.redis.get(geminiFailKey)) || '0',
          10,
        );
        const newFails = currentFails + 1;
        await this.redis.set(geminiFailKey, newFails.toString(), 'EX', 900);

        if (newFails < geminiDownThreshold) {
          this.logger.warn(
            `Gemini fallo real #${newFails}/${geminiDownThreshold} — usando fallback simple`,
          );
          aiData = this.simpleExtractFallback(text ?? null, currentState);
        } else {
          this.logger.error(
            `Gemini caído (${newFails} fallos consecutivos) — mostrando mantenimiento`,
          );
          const humanPhone = org?.supportPhone || '+10 334 45 66';
          const reply = MSGS.iaCaida(humanPhone);
          await this.smartReply(organizationId, senderId, reply);

          await this.auditFailure(senderId, organizationId, {
            reason: FailureReason.GEMINI_DOWN,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: { previousState: currentState, failCount: newFails },
          });
          return { aiData, stop: true };
        }
      }
    } else {
      // Gemini respondió exitosamente: resetear contador de fallos reales
      await this.redis.del(geminiFailKey);
    }
    return { aiData, stop: false };
  }

  /**
   * Arranca el flujo de cancelación: limpia la sesión, marca el modo (voz/texto)
   * y —si ya hay cédula— busca las citas de una vez (handleCancelCedulaStep); si
   * no, la pide. Audita el inicio. Terminal: el caller hace return tras llamar.
   */
  private async startCancellationFlow(p: {
    organizationId: string;
    senderId: string;
    isAudio: boolean;
    aiData: SchedulingExtraction;
    text: string | undefined;
    MSGS: ReturnType<typeof buildMessages>;
  }): Promise<void> {
    const { organizationId, senderId, isAudio, aiData, text, MSGS } = p;
    await this.cleanUpSession(organizationId, senderId);
    await this.redis.set(
      `is_ai_flow:${organizationId}:${senderId}`,
      isAudio ? 'true' : 'false',
      'EX',
      SESSION_TTL,
    );

    // La de este mensaje o, si no trae, la que escribió hace unos minutos.
    const cedula =
      aiData.cedula ||
      (await this.redis.get(`cedula_reciente:${organizationId}:${senderId}`));
    let reply: string;
    if (cedula) {
      await this.redis.set(
        `temp_cancel_cedula:${organizationId}:${senderId}`,
        cedula,
        'EX',
        SESSION_TTL,
      );
      await this.handleCancelCedulaStep(organizationId, senderId, cedula);
      reply = (await this.getLastSent(senderId)) || '[cancelación iniciada]';
    } else {
      reply = MSGS.cancelarPedirCedula();
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_CANCEL_CEDULA,
      );
    }

    // 📝 Auditoría: inicio de flujo de cancelación
    await this.auditLog(senderId, organizationId, {
      status: InteractionStatus.CANCELLATION_FLOW,
      userMessage: text || '[audio]',
      botReply: reply,
      metadata: { aiData, hasInitialCedula: !!aiData.cedula },
    });
  }

  /**
   * Arranca el flujo de modificación / reprogramación (espejo del de
   * cancelación): si traemos cédula, busca las citas (handleModifyCedulaStep);
   * si no, la pide. La cita NO se toca hasta que el paciente confirme un nuevo
   * horario. Audita el inicio. Terminal: el caller hace return tras llamar.
   */
  private async startModificationFlow(p: {
    organizationId: string;
    senderId: string;
    isAudio: boolean;
    aiData: SchedulingExtraction;
    text: string | undefined;
    MSGS: ReturnType<typeof buildMessages>;
  }): Promise<void> {
    const { organizationId, senderId, isAudio, aiData, text, MSGS } = p;
    await this.cleanUpSession(organizationId, senderId);
    await this.redis.set(
      `is_ai_flow:${organizationId}:${senderId}`,
      isAudio ? 'true' : 'false',
      'EX',
      SESSION_TTL,
    );

    // La de este mensaje o, si no trae, la que escribió hace unos minutos.
    const cedula =
      aiData.cedula ||
      (await this.redis.get(`cedula_reciente:${organizationId}:${senderId}`));
    let reply: string;
    if (cedula) {
      await this.redis.set(
        `temp_modify_cedula:${organizationId}:${senderId}`,
        cedula,
        'EX',
        SESSION_TTL,
      );
      await this.handleModifyCedulaStep(organizationId, senderId, cedula);
      reply = (await this.getLastSent(senderId)) || '[modificación iniciada]';
    } else {
      reply = MSGS.modificarPedirCedula();
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_MODIFY_CEDULA,
      );
    }

    // 📝 Auditoría: inicio de flujo de modificación
    await this.auditLog(senderId, organizationId, {
      status: InteractionStatus.MODIFICATION_FLOW,
      userMessage: text || '[audio]',
      botReply: reply,
      metadata: {
        aiData,
        hasInitialCedula: !!aiData.cedula,
        event: 'MODIFY_FLOW_START',
      },
    });
  }

  /**
   * Maneja el escape/reinicio: limpia la sesión. Si el mensaje fue un saludo,
   * muestra bienvenida + menú de servicios y pasa a AWAITING_SPECIALTY; si fue
   * una palabra de reset ("salir", etc.), responde "Sin problema". Audita ambos
   * caminos. Terminal: el caller hace return tras llamar.
   */
  /**
   * ¿El paciente está pidiendo dejar de recibir recordatorios, o volver a recibirlos?
   * Frases FIJAS y sin LLM (D2): es una decisión sobre sus datos, no una intención que
   * se pueda inferir «casi». El texto se normaliza igual que el resto (sin tildes).
   */
  private intencionDeRecordatorios(
    text: string | null,
  ): 'DAR_DE_BAJA' | 'ACTIVAR' | null {
    const t = this.normalizeSynonym(text || '').trim();
    if (!t || (!t.includes('recordatorio') && t !== 'no recordar')) return null;
    if (
      /^(activar|activen|quiero|si quiero|deseo)\s+(los\s+|mis\s+)?recordatorios?$/.test(
        t,
      )
    ) {
      return 'ACTIVAR';
    }
    const baja =
      /^no recordar$/.test(t) ||
      /^(no|ya no)\s+(quiero|deseo|me interesa)\s+(mas\s+|recibir\s+)*(mas\s+)?(los\s+|sus\s+|estos\s+)?recordatorios?$/.test(
        t,
      ) ||
      /^(baja|baja de|quitar|quiten|cancelar|cancele[n]?|apagar|apaguen|desactivar|desactiven|no envien|no me envien|dejen de enviar(me)?)\s+(los\s+|mis\s+|de\s+)?recordatorios?$/.test(
        t,
      ) ||
      /^dejar de recibir recordatorios?$/.test(t);
    return baja ? 'DAR_DE_BAJA' : null;
  }

  /**
   * Apaga (o enciende) los recordatorios de quien escribe. Se aplica a TODOS los
   * perfiles de esta clínica que respondan a ese número: si un celular está en dos
   * historias (una familia lo comparte), «no me escriban» vale para el número.
   *
   * No cancela ninguna cita, y el mensaje lo dice: quien pide la baja no está pidiendo
   * perder su cita. Queda la constancia en la caja negra.
   */
  private async handleRecordatorios(p: {
    organizationId: string;
    senderId: string;
    text: string | null;
    activar: boolean;
    MSGS: ReturnType<typeof buildMessages>;
  }): Promise<void> {
    const { organizationId, senderId, activar, MSGS } = p;
    // ✈️ Telegram: solo por su chat. Quitarle los no-dígitos a `tg:3001234567`
    // da `3001234567`, que puede ser el celular de OTRO paciente: se le
    // apagarían sus recordatorios.
    const telegramChatId = chatIdFromTelegramSender(senderId);
    let where: Prisma.PatientProfileWhereInput;
    if (isTelegramSender(senderId)) {
      where = { organizationId, telegramChatId: telegramChatId ?? '' };
    } else {
      // El número tal como llegó (puede ser un BSUID) y sus dos formas de teléfono
      // (con y sin el 57), sin repetir.
      const identificadores = [
        ...new Set([
          senderId,
          ...variantesDeTelefono(senderId.replace(/\D/g, '')),
        ]),
      ];
      where = {
        organizationId,
        OR: [
          { whatsappId: { in: identificadores } },
          { bsuid: { in: identificadores } },
        ],
      };
    }
    const { count } = await this.prisma.patientProfile.updateMany({
      where,
      data: { remindersOptOut: !activar },
    });

    const reply =
      count === 0
        ? MSGS.recordatoriosSinRegistro()
        : activar
          ? MSGS.recordatoriosActivados()
          : MSGS.recordatoriosBaja();
    await this.smartReply(organizationId, senderId, reply);
    await this.auditSuccess(senderId, organizationId, {
      userMessage: p.text || '[audio]',
      botReply: reply,
      metadata: {
        step: activar ? 'RECORDATORIOS_ACTIVADOS' : 'RECORDATORIOS_BAJA',
        perfilesAfectados: count,
      },
    });
  }

  private presentadoKey(organizationId: string, senderId: string): string {
    return `bot_presentado:${organizationId}:${senderId}`;
  }

  /**
   * El menú de servicios con la presentación del bot («Le saluda Vicente…»)
   * solo si no se presentó ya en esta conversación (ver PRESENTACION_TTL). Sin
   * esto, tras «Sin problema, comencemos de nuevo. ¿En qué le ayudo?» el
   * siguiente mensaje volvía a presentarse como si fuera otra conversación.
   */
  private async menuServiciosPresentandose(p: {
    organizationId: string;
    senderId: string;
    MSGS: ReturnType<typeof buildMessages>;
    orgName: string;
    botName: string;
    lineas: string;
  }): Promise<string> {
    const key = this.presentadoKey(p.organizationId, p.senderId);
    const yaSePresento = !!(await this.redis.get(key));
    await this.redis.set(key, '1', 'EX', PRESENTACION_TTL);
    return yaSePresento
      ? p.MSGS.menuServiciosSinPresentacion(p.lineas)
      : p.MSGS.menuServicios(p.orgName, p.lineas, p.botName);
  }

  /**
   * 🔒 SOLO CONSULTAS — la clínica apagó las TRES operaciones del bot:
   * agendar, cancelar y cambiar citas. Responde que la plataforma
   * por ahora solo consulta citas y con quién comunicarse; se presenta si aún
   * no lo hizo en esta conversación. Deja la sesión en IDLE, lista para
   * «consultar». Terminal: el caller hace return tras llamar.
   */
  private async responderSoloConsultas(p: {
    organizationId: string;
    senderId: string;
    text: string | undefined;
    org: Organization | null;
    orgName: string;
    botName: string;
    MSGS: ReturnType<typeof buildMessages>;
    motivo: 'AGENDAR' | 'CANCELAR' | 'MODIFICAR';
  }): Promise<void> {
    const { organizationId, senderId, MSGS } = p;
    const contacto = p.org?.supportPhone
      ? MSGS.contactoClinica(p.org.supportPhone)
      : MSGS.contactoClinicaSinTelefono();
    const key = this.presentadoKey(organizationId, senderId);
    const yaSePresento = !!(await this.redis.get(key));
    // 🔁 Ya se le dijo hace poco (cualquiera de las tres): la versión corta.
    const repetidoKey = `no_disponible_dicho:${organizationId}:${senderId}:SOLO_CONSULTAS`;
    const repetido = !!(await this.redis.get(repetidoKey));
    await this.cleanUpSession(organizationId, senderId);
    await this.redis.set(key, '1', 'EX', PRESENTACION_TTL);
    await this.redis.set(repetidoKey, '1', 'EX', NO_DISPONIBLE_REPETIDO_TTL);
    const reply = repetido
      ? MSGS.soloConsultasCorto(contacto)
      : yaSePresento
        ? MSGS.soloConsultas(contacto)
        : MSGS.soloConsultasBienvenida(p.orgName, contacto, p.botName);
    await this.smartReply(organizationId, senderId, reply);
    await this.auditSuccess(senderId, organizationId, {
      userMessage: p.text || '[audio]',
      botReply: reply,
      metadata: {
        step: 'SOLO_CONSULTAS',
        motivo: p.motivo,
        ...(repetido ? { repetido: true } : {}),
      },
    });
  }

  /**
   * Qué puede hacer el paciente por el bot AHORA en esta clínica: los tres
   * interruptores de /dashboard/configuracion.
   *
   * 🚪 Con espejo, cada interruptor es también la compuerta de su operación
   * hacia el HIS (`compuerta-his.ts`, 2026-10-15): «Agendar», «Cancelar» y
   * «Cambiar fecha», sin el viejo envío al hospital. Falla cerrado: sin fila de
   * configuración, ninguna operación llega al hospital, así que el bot tampoco
   * la ofrece (el paciente creería algo que el hospital no tiene, H10).
   */
  private async operacionesDisponibles(
    organizationId: string,
  ): Promise<OperacionesBot> {
    const [interruptores, compuertas] = await Promise.all([
      this.organizationSettings.operacionesDelBot(organizationId),
      this.confirmacionHis
        ? this.confirmacionHis.compuertas(organizationId)
        : Promise.resolve(null),
    ]);
    return {
      agendar: interruptores.agendar && (compuertas?.agendar ?? true),
      cancelar: interruptores.cancelar && (compuertas?.cancelar ?? true),
      modificar: interruptores.modificar && (compuertas?.modificar ?? true),
    };
  }

  /** Las opciones de la consulta guardadas en la sesión, si son legibles. */
  private opcionesGuardadas(raw: string | null): OpcionConsulta[] | null {
    if (!raw) return null;
    try {
      const v: unknown = JSON.parse(raw);
      const validas = OPCIONES_CONSULTA.map((o) => o.opcion);
      return Array.isArray(v) &&
        v.length > 0 &&
        v.every((o) => validas.includes(o as OpcionConsulta))
        ? (v as OpcionConsulta[])
        : null;
    } catch {
      return null;
    }
  }

  /** «• Consultar sus citas: escríbame "consultar"» y una línea por cada operación permitida. */
  private lineasDeLoDisponible(
    MSGS: ReturnType<typeof buildMessages>,
    operaciones: OperacionesBot,
    opts: { atajoAgendar?: string } = {},
  ): string {
    return [
      MSGS.lineaDisponibleConsultar(),
      ...operacionesPermitidas(operaciones).map((op) =>
        MSGS.lineaDisponible(
          TEXTO_OPERACION[op].etiqueta,
          op === 'AGENDAR' && opts.atajoAgendar
            ? opts.atajoAgendar
            : TEXTO_OPERACION[op].atajo,
        ),
      ),
    ].join('\n');
  }

  /** Ya recibió el saludo tras su recordatorio (ver `saludarTrasRecordatorio`). */
  private saludoTrasRecordatorioKey(
    organizationId: string,
    senderId: string,
  ): string {
    return `saludo_tras_recordatorio:${organizationId}:${senderId}`;
  }

  /**
   * 💬 Respuesta al recordatorio desde un MENÚ del agendamiento (2026-10-22, primer
   * día con agendar encendido: …4433 saludó, recibió el menú de servicios y su «No
   * es para mí» recibió dos veces «esa opción no se logró identificar»; …7954, igual
   * con «la cita ya la tengo para mañana»).
   *
   * Solo si a este número se le envió un recordatorio hace poco. En el menú de
   * servicios se atiende lo que se le contesta a un recordatorio (confirmarla, ya
   * llegué, ¿de dónde me escriben?, ¿dónde es?, me dieron otra hora) porque ninguna
   * de esas es una opción del menú. En los de EPS y horario, solo «este número no es
   * de esa persona»: lo demás puede ser su respuesta al paso.
   *
   * Si se atendió y la respuesta no abrió otro paso, el menú se cierra: el tema
   * ya no es agendar.
   */
  private async atenderRespuestaAlRecordatorioEnMenu(
    p: Parameters<ChatbotService['atenderRespuestaAlBot']>[0] & {
      currentState: ChatState;
    },
  ): Promise<boolean> {
    const tipo = clasificarRespuestaAlBot(p.text);
    const ajeno =
      tipo === 'NUMERO_EQUIVOCADO' ||
      tipo === 'RESPUESTA_AUTOMATICA' ||
      esMensajeAjeno(p.text) ||
      !!nombreQueNiega(p.text);
    const respondeAlRecordatorio =
      p.currentState === ChatState.AWAITING_SPECIALTY &&
      !!tipo &&
      RESPUESTAS_AL_RECORDATORIO_EN_MENU.has(tipo);
    if (!ajeno && !respondeAlRecordatorio) return false;

    const recordadas = await this.citasRecordadasDelRemitente(
      p.organizationId,
      p.identity,
      { incluirTelefonoEquivocado: true },
    );
    if (recordadas.length === 0) return false;

    const { currentState, ...resto } = p;
    if (!(await this.atenderRespuestaAlBot(resto))) return false;
    if (
      (await this.getUserState(p.organizationId, p.senderId)) === currentState
    ) {
      await this.cleanUpSession(p.organizationId, p.senderId);
    }
    return true;
  }

  /**
   * Las citas de quien escribe que recibieron un recordatorio hace poco (48 h) y
   * todavía no han pasado: las que explican por qué el paciente nos contesta. Se
   * buscan por el mismo canal que lo identifica (chat de Telegram, o teléfono en
   * cualquiera de sus formas o BSUID), igual que la consulta de citas.
   *
   * TODAS, no la primera (2026-10-15): un paciente con dos citas al día siguiente
   * escribió «cancelar las citas» y el aviso quedó solo en la primera.
   */
  private async citasRecordadasDelRemitente(
    organizationId: string,
    identity: SenderIdentity,
    opts: { incluirTelefonoEquivocado?: boolean } = {},
  ) {
    const ahora = Date.now();
    const deQuien = this.perfilesDelRemitente(identity);
    if (deQuien.length === 0) return [];

    const citas = await this.prisma.appointment.findMany({
      where: {
        organizationId,
        status: 'SCHEDULED',
        reminderSentAt: { gte: new Date(ahora - 48 * 3_600_000) },
        scheduleSlot: {
          startTime: { gte: new Date(ahora - 3_600_000) },
          ...EN_ALCANCE_DEL_BOT,
        },
        patient: { OR: deQuien },
      },
      include: {
        scheduleSlot: { include: { service: true, doctor: true } },
        patient: { select: { fullName: true } },
      },
      orderBy: { scheduleSlot: { startTime: 'asc' } },
      take: MAX_CITAS_EN_RESPUESTA,
    });
    // Lo del número equivocado sí las necesita: es lo que vuelve a dejar el caso.
    return opts.incluirTelefonoEquivocado
      ? citas
      : this.sinTelefonoEquivocado(organizationId, identity, citas);
  }

  /** Las citas próximas (sin pasar) de quien escribe, recordadas o no. */
  private async citasProximasDelRemitente(
    organizationId: string,
    identity: SenderIdentity,
  ) {
    const deQuien = this.perfilesDelRemitente(identity);
    if (deQuien.length === 0) return [];
    const citas = await this.prisma.appointment.findMany({
      where: {
        organizationId,
        status: 'SCHEDULED',
        scheduleSlot: { startTime: { gt: new Date() }, ...EN_ALCANCE_DEL_BOT },
        patient: { OR: deQuien },
      },
      include: {
        scheduleSlot: { include: { service: true, doctor: true } },
        patient: { select: { fullName: true } },
      },
      orderBy: { scheduleSlot: { startTime: 'asc' } },
      take: MAX_CITAS_EN_RESPUESTA,
    });
    return this.sinTelefonoEquivocado(organizationId, identity, citas);
  }

  /**
   * «• *Odontología* — viernes, 16 de octubre a las 10:10», una por cita. Si las
   * citas son de varios pacientes del mismo número (una familia), cada línea
   * lleva el primer nombre: si no, no se sabe de quién es cuál.
   */
  private lineasDeCitas(
    MSGS: ReturnType<typeof buildMessages>,
    citas: {
      patientId: string;
      patient?: { fullName: string | null } | null;
      scheduleSlot: { startTime: Date; service?: { name: string } | null };
    }[],
    timeZone: string | undefined,
  ): string {
    const variosPacientes = new Set(citas.map((c) => c.patientId)).size > 1;
    return citas
      .map((c) => {
        const servicio = c.scheduleSlot.service?.name ?? '';
        const fecha = formatAppointmentLong(c.scheduleSlot.startTime, {
          timeZone,
        });
        const nombre = (c.patient?.fullName ?? '').trim().split(/\s+/)[0];
        return variosPacientes && nombre
          ? MSGS.lineaDeCitaDe(servicio, fecha, nombre)
          : MSGS.lineaDeCita(servicio, fecha);
      })
      .join('\n');
  }

  /**
   * Cómo se encuentran los perfiles de quien escribe: por su chat de Telegram, o
   * por su teléfono en cualquiera de sus formas o su BSUID. Vacío = no se puede
   * saber quién es.
   */
  private perfilesDelRemitente(
    identity: SenderIdentity,
  ): Prisma.PatientProfileWhereInput[] {
    if (identity.telegramChatId) {
      return [{ telegramChatId: identity.telegramChatId }];
    }
    const deQuien: Prisma.PatientProfileWhereInput[] = [];
    const telefonos = variantesDeTelefono(
      (identity.phone ?? '').replace(/\D/g, ''),
    );
    if (telefonos.length > 0) deQuien.push({ whatsappId: { in: telefonos } });
    if (identity.bsuid) deQuien.push({ bsuid: identity.bsuid });
    return deQuien;
  }

  /**
   * ☎️ De estos pacientes, los que tienen abierto en la Bandeja un caso de teléfono
   * equivocado: quien contestó desde ese número dijo que no es suyo (2026-10-21).
   * Mientras el caso esté abierto, desde WhatsApp el bot no confirma, no muestra, no
   * cancela ni cambia sus citas: antes un «Ok» del dueño del número le confirmó la
   * cita a la paciente, y nada le impedía cancelársela en el hospital. Por Telegram
   * no aplica: ese chat lo vinculó el propio paciente.
   *
   * Si la consulta falla, no frena nada (como antes de esto) y queda en el log: sin
   * base tampoco se podría cancelar ni cambiar.
   */
  private async pacientesConTelefonoEquivocado(
    organizationId: string,
    esTelegram: boolean,
    patientIds: string[],
  ): Promise<Set<string>> {
    if (esTelegram || patientIds.length === 0) return new Set();
    try {
      const filas = await this.prisma.syncException.findMany({
        where: {
          organizationId,
          kind: 'TELEFONO_EQUIVOCADO',
          status: { in: [...ESTADOS_ACTIVOS] },
          patientId: { in: patientIds },
        },
        select: { patientId: true },
      });
      return new Set(filas.flatMap((f) => (f.patientId ? [f.patientId] : [])));
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo revisar los teléfonos equivocados (org ${organizationId}): ${getErrorMessage(error)}`,
      );
      return new Set();
    }
  }

  /** Las citas, sin las de pacientes con el teléfono marcado como equivocado. */
  private async sinTelefonoEquivocado<T extends { patientId: string | null }>(
    organizationId: string,
    identity: SenderIdentity,
    citas: T[],
  ): Promise<T[]> {
    const ids = [
      ...new Set(citas.flatMap((c) => (c.patientId ? [c.patientId] : []))),
    ];
    const marcados = await this.pacientesConTelefonoEquivocado(
      organizationId,
      !!identity.telegramChatId,
      ids,
    );
    return marcados.size === 0
      ? citas
      : citas.filter((c) => !c.patientId || !marcados.has(c.patientId));
  }

  /**
   * ☎️ ¿Todas las fichas de este número tienen el teléfono marcado como equivocado?
   * Si alguna no (la familia comparte el celular), se atiende esa como siempre.
   */
  private async numeroMarcadoComoAjeno(
    organizationId: string,
    identity: SenderIdentity,
  ): Promise<boolean> {
    if (identity.telegramChatId) return false;
    const deQuien = this.perfilesDelRemitente(identity);
    if (deQuien.length === 0) return false;
    const perfiles = await this.prisma.patientProfile.findMany({
      where: { organizationId, OR: deQuien },
      select: { id: true },
      take: 10,
    });
    if (perfiles.length === 0) return false;
    const marcados = await this.pacientesConTelefonoEquivocado(
      organizationId,
      false,
      perfiles.map((f) => f.id),
    );
    return marcados.size === perfiles.length;
  }

  /**
   * Las citas de las que avisa quien dice «no puedo ir» o «quiero cambiarla»: las
   * del recordatorio que acaba de recibir (todas) y, si no hay, su ÚNICA cita
   * próxima. Con varias y sin recordatorio no se adivina cuál: ninguna.
   */
  private async citasDelAviso(
    organizationId: string,
    identity: SenderIdentity,
  ) {
    const recordadas = await this.citasRecordadasDelRemitente(
      organizationId,
      identity,
    );
    if (recordadas.length > 0) return recordadas;
    const proximas = await this.citasProximasDelRemitente(
      organizationId,
      identity,
    );
    return proximas.length === 1 ? proximas : [];
  }

  /**
   * 💬 Respuestas que el bot atiende sin la IA (2026-10-13, primer lote de
   * recordatorios: a todas se les respondía «la plataforma no está activa…»):
   *
   *   «Sí voy», «gracias», «ok» tras su recordatorio → «¡Gracias por confirmar!
   *   Le esperamos el {fecha}».
   *   «¿De dónde me hablan?» → quién escribe y, si acaba de recibir un
   *   recordatorio, por cuál cita.
   *
   *   (2026-10-15) «esa cita es en q lugar» tras su recordatorio → cuándo y
   *   dónde es su cita; «está equivocado de número» → ya no se le escribe y el
   *   personal corrige el teléfono; «no puedo asistir» / «necesito reagendar»
   *   con esa operación apagada → el aviso queda para el personal.
   *
   * Devuelve true si atendió el mensaje. Una confirmación o una pregunta SIN
   * recordatorio reciente no se atienden aquí: siguen el camino de siempre (un
   * «gracias» suelto es una despedida).
   */
  private async atenderRespuestaAlBot(p: {
    organizationId: string;
    senderId: string;
    identity: SenderIdentity;
    text: string;
    MSGS: ReturnType<typeof buildMessages>;
    botName: string;
    orgName: string;
    org: Organization | null;
    operaciones: OperacionesBot;
    timeZone: string | undefined;
  }): Promise<boolean> {
    const tipo = clasificarRespuestaAlBot(p.text);
    // ☎️ «hola yo no soy dario» (2026-10-17) tras el recordatorio a Darío: el número
    // es de otra persona. Solo si el nombre que niega es el del paciente al que se
    // le escribió, y si el mensaje no pide otra cosa (no ir, cambiarla, preguntar),
    // que entonces es de alguien que sí conoce al paciente.
    if (!tipo || tipo === 'CONFIRMA' || tipo === 'QUIEN_ESCRIBE') {
      const negado = nombreQueNiega(p.text);
      if (negado && (await this.esNombreDeUnRecordado(p, negado))) {
        return this.atenderNumeroEquivocado(p);
      }
      // 📭 «Que pena está equivocada», «Este mensaje no era para mí» (2026-10-19):
      // solo tras un recordatorio a este número; sin él, «está equivocada» puede
      // ser de otra conversación y no se le apagan los recordatorios a nadie.
      if (
        esMensajeAjeno(p.text) &&
        (
          await this.citasRecordadasDelRemitente(p.organizationId, p.identity, {
            incluirTelefonoEquivocado: true,
          })
        ).length > 0
      ) {
        return this.atenderNumeroEquivocado(p);
      }
    }
    if (tipo === 'RESPUESTA_AUTOMATICA') {
      return this.atenderNumeroEquivocado(p, { automatica: true });
    }
    if (tipo === 'NUMERO_EQUIVOCADO') return this.atenderNumeroEquivocado(p);
    const saludo = !tipo && esSoloSaludo(p.text);
    // ☎️ Este número ya quedó como de otra persona (2026-10-21: tras «Yo no soy
    // Deysi», su «Ok» recibió «¡Gracias por confirmar!» con la cita de la paciente):
    // nada de su cita, ni confirmarla ni cancelarla; solo que ya se sabe.
    if (
      (tipo || saludo) &&
      (await this.numeroMarcadoComoAjeno(p.organizationId, p.identity))
    ) {
      return this.responderNumeroYaMarcado(p);
    }
    // 👋 Un saludo a secas tras el recordatorio (2026-10-20, …2705): antes recibía
    // «no es posible agendar», que a quien no es el paciente no le explica nada.
    // Ahora: de qué cita le escribimos y de quién, qué puede hacer por aquí, y que
    // avise si el número no es de esa persona.
    // Con agendar ENCENDIDO (2026-10-22, primer día): el saludo abría el menú de
    // servicios y quien contestaba al recordatorio —«No es para mí», «la cita ya la
    // tengo»— quedaba atrapado en él. Ahora recibe lo mismo, con «agendar» entre lo
    // que puede hacer; solo la PRIMERA vez: si vuelve a saludar, ya sabe de su cita
    // y busca otra cosa (el menú de siempre).
    if (
      saludo &&
      (!p.operaciones.agendar ||
        !(await this.redis.get(
          this.saludoTrasRecordatorioKey(p.organizationId, p.senderId),
        )))
    ) {
      return this.saludarTrasRecordatorio(p);
    }
    if (!tipo) return false;
    if (tipo === 'PREGUNTA_TURNO' || tipo === 'YA_LLEGO') {
      return this.responderEnElHospital(p, tipo);
    }
    if (tipo === 'OTRA_HORA') return this.responderOtraHora(p);
    if (tipo === 'NO_ASISTIRA' || tipo === 'CAMBIAR') {
      const pide = tipo === 'NO_ASISTIRA' ? 'CANCELAR' : 'MODIFICAR';
      const atendido =
        tipo === 'NO_ASISTIRA' && p.operaciones.cancelar
          ? await this.ofrecerCancelar(p)
          : await this.atenderAvisoDelPaciente(p, pide);
      // 🩺 Sus citas son todas de otro servicio o de un médico sin «WhatsApp ON»:
      // no se tocan, pero el aviso le llega al personal.
      return (
        atendido || this.avisarSiSoloTieneCitasFueraDelAlcance({ ...p, pide })
      );
    }

    const citas = await this.citasRecordadasDelRemitente(
      p.organizationId,
      p.identity,
    );
    const cita = citas[0];
    if ((tipo === 'CONFIRMA' || tipo === 'PREGUNTA_CITA') && !cita) {
      return false;
    }

    const fecha = cita
      ? formatAppointmentLong(cita.scheduleSlot.startTime, {
          timeZone: p.timeZone,
        })
      : '';
    const servicio = cita?.scheduleSlot.service?.name ?? '';
    // Con varias citas recordadas se nombran todas: confirmar o explicar solo la
    // primera dejaba a la segunda como si no existiera.
    const lineas =
      citas.length > 1 ? this.lineasDeCitas(p.MSGS, citas, p.timeZone) : '';
    const reply =
      tipo === 'CONFIRMA'
        ? lineas
          ? p.MSGS.recordatorioConfirmadoVarias(lineas)
          : p.MSGS.recordatorioConfirmado(fecha, servicio)
        : tipo === 'PREGUNTA_CITA'
          ? lineas
            ? p.MSGS.preguntaSobreCitas(
                lineas,
                p.orgName,
                this.contactoDe(p.MSGS, p.org),
              )
            : p.MSGS.preguntaSobreCita(
                servicio,
                fecha,
                p.orgName,
                this.contactoDe(p.MSGS, p.org),
              )
          : lineas
            ? p.MSGS.quienEscribeConCitas(p.botName, p.orgName, lineas)
            : cita
              ? p.MSGS.quienEscribeConCita(
                  p.botName,
                  p.orgName,
                  servicio,
                  fecha,
                )
              : p.MSGS.quienEscribe(p.botName, p.orgName);

    await this.smartReply(p.organizationId, p.senderId, reply);
    await this.auditSuccess(p.senderId, p.organizationId, {
      userMessage: p.text,
      botReply: reply,
      metadata: {
        step:
          tipo === 'CONFIRMA'
            ? 'RECORDATORIO_CONFIRMADO'
            : tipo === 'PREGUNTA_CITA'
              ? 'PREGUNTA_SOBRE_CITA'
              : 'QUIEN_ESCRIBE',
        appointmentId: cita?.id ?? null,
        ...(citas.length > 1 ? { appointmentIds: citas.map((c) => c.id) } : {}),
      },
    });
    return true;
  }

  /**
   * ¿`nombre` (normalizado, de `nombreQueNiega`) es uno de los nombres de un
   * paciente al que se le envió el recordatorio a este número?
   */
  private async esNombreDeUnRecordado(
    p: { organizationId: string; identity: SenderIdentity },
    nombre: string,
  ): Promise<boolean> {
    const citas = await this.citasRecordadasDelRemitente(
      p.organizationId,
      p.identity,
      { incluirTelefonoEquivocado: true },
    );
    // Por cómo suena (2026-10-21: «no soy Deysi» con la paciente DEICY).
    return citas.some((c) =>
      textoParaCoincidencia(c.patient?.fullName ?? '')
        .split(' ')
        .some((parte) => mismoNombre(parte, nombre)),
    );
  }

  /**
   * ☎️ A quien escribe desde un número ya marcado como de otra persona (ver
   * `pacientesConTelefonoEquivocado`): que ya se sabe, y con quién hablar si tiene
   * una cita propia. Nada de la cita del paciente.
   */
  private async responderNumeroYaMarcado(p: {
    organizationId: string;
    senderId: string;
    text: string;
    MSGS: ReturnType<typeof buildMessages>;
    org: Organization | null;
  }): Promise<boolean> {
    const reply = p.MSGS.numeroYaMarcado(this.contactoDe(p.MSGS, p.org));
    await this.smartReply(p.organizationId, p.senderId, reply);
    await this.auditSuccess(p.senderId, p.organizationId, {
      userMessage: p.text,
      botReply: reply,
      metadata: { step: 'NUMERO_YA_MARCADO' },
    });
    return true;
  }

  /**
   * 🩺 Las citas próximas de quien escribe con las que AgenIA NO trabaja: de un
   * médico sin «WhatsApp ON» o de un servicio inactivo (odontología, hipertensos…).
   */
  private async citasFueraDelAlcanceDelRemitente(
    organizationId: string,
    identity: SenderIdentity,
  ) {
    const deQuien = this.perfilesDelRemitente(identity);
    if (deQuien.length === 0) return [];
    const citas = await this.citasFueraDelAlcance(organizationId, {
      patient: { OR: deQuien },
    });
    return this.sinTelefonoEquivocado(organizationId, identity, citas);
  }

  private async citasFueraDelAlcance(
    organizationId: string,
    dequien: Prisma.AppointmentWhereInput,
  ) {
    return this.prisma.appointment.findMany({
      where: {
        organizationId,
        status: 'SCHEDULED',
        scheduleSlot: {
          startTime: { gt: new Date() },
          OR: [
            { doctor: { whatsappBookingEnabled: false } },
            { service: { isActive: false } },
          ],
        },
        ...dequien,
      },
      include: {
        scheduleSlot: { include: { service: true, doctor: true } },
        patient: { select: { fullName: true } },
      },
      orderBy: { scheduleSlot: { startTime: 'asc' } },
      take: MAX_CITAS_EN_RESPUESTA,
    });
  }

  /**
   * 🩺 «No puedo ir» o «cámbienmela» de quien SOLO tiene citas con las que AgenIA
   * no trabaja (2026-10-16): no se toca la cita ni se escribe nada en el hospital,
   * pero el aviso queda en la Bandeja para el personal. Antes se le decía «se
   * manejan con el hospital» y nadie se enteraba: casos reales de odontología e
   * hipertensos el mismo día de la cita.
   *
   * Si tiene alguna cita con la que AgenIA sí trabaja, false: la atiende el
   * camino de siempre. Sin bandeja (clínica sin espejo), false.
   */
  private async avisarSiSoloTieneCitasFueraDelAlcance(p: {
    organizationId: string;
    senderId: string;
    identity: SenderIdentity;
    text: string;
    MSGS: ReturnType<typeof buildMessages>;
    org: Organization | null;
    pide: 'CANCELAR' | 'MODIFICAR';
  }): Promise<boolean> {
    if (!this.avisosPaciente) return false;
    const enAlcance = await this.citasProximasDelRemitente(
      p.organizationId,
      p.identity,
    );
    if (enAlcance.length > 0) return false;
    const fuera = await this.citasFueraDelAlcanceDelRemitente(
      p.organizationId,
      p.identity,
    );
    return this.avisarCitasFueraDelAlcance(p, fuera);
  }

  /**
   * Deja en la Bandeja un aviso por cada cita (fuera del alcance del bot) y se lo
   * dice al paciente, sin prometerle que la cita quedó cancelada o cambiada.
   * Solo nombra las citas cuyo aviso quedó registrado.
   */
  private async avisarCitasFueraDelAlcance(
    p: {
      organizationId: string;
      senderId: string;
      text: string;
      MSGS: ReturnType<typeof buildMessages>;
      org: Organization | null;
      pide: 'CANCELAR' | 'MODIFICAR';
    },
    todas: Awaited<ReturnType<ChatbotService['citasFueraDelAlcance']>>,
  ): Promise<boolean> {
    if (!this.avisosPaciente || todas.length === 0) return false;
    const ahora = new Date();
    const citas: typeof todas = [];
    for (const cita of todas) {
      const inicio = cita.scheduleSlot.startTime;
      try {
        await this.avisosPaciente.registrar(
          p.organizationId,
          {
            kind: 'AVISO_INASISTENCIA',
            dedupeKey: claveExcepcion.avisoInasistencia(cita.id),
            severity: severidadPorCercania(
              'MEDIA',
              (inicio.getTime() - ahora.getTime()) / 60_000,
            ),
            title: TITULO_EXCEPCION.AVISO_INASISTENCIA,
            appointmentId: cita.id,
            patientId: cita.patientId,
            epsId: cita.epsId,
            doctorId: cita.scheduleSlot.doctorId,
            appointmentStartAt: inicio,
            meta: {
              pide: p.pide,
              mensaje: p.text.slice(0, 300),
              canal: canalDe(p.senderId),
              fueraDelAlcance: true,
              ...(todas.length > 1 ? { citasDelAviso: todas.length } : {}),
            },
          },
          ahora,
        );
        citas.push(cita);
      } catch (error: unknown) {
        this.logger.error(
          `No se pudo registrar el aviso de una cita fuera del alcance (cita ${cita.id}): ${getErrorMessage(error)}`,
        );
      }
    }
    if (citas.length === 0) return false;

    const timeZone = p.org?.timezone || undefined;
    const contacto = this.contactoDe(p.MSGS, p.org);
    const cita = citas[0];
    const servicio = cita.scheduleSlot.service?.name ?? '';
    const fecha = formatAppointmentLong(cita.scheduleSlot.startTime, {
      timeZone,
    });
    const lineas =
      citas.length > 1 ? this.lineasDeCitas(p.MSGS, citas, timeZone) : '';
    const reply =
      p.pide === 'CANCELAR'
        ? lineas
          ? p.MSGS.avisoFueraDelAlcanceCancelarVarias(lineas, contacto)
          : p.MSGS.avisoFueraDelAlcanceCancelar(servicio, fecha, contacto)
        : lineas
          ? p.MSGS.avisoFueraDelAlcanceCambiarVarias(lineas, contacto)
          : p.MSGS.avisoFueraDelAlcanceCambiar(servicio, fecha, contacto);
    await this.smartReply(p.organizationId, p.senderId, reply);
    await this.cleanUpSession(p.organizationId, p.senderId);
    await this.auditSuccess(p.senderId, p.organizationId, {
      userMessage: p.text,
      botReply: reply,
      metadata: {
        step: 'AVISO_FUERA_DEL_ALCANCE_REGISTRADO',
        pide: p.pide,
        appointmentId: cita.id,
        ...(citas.length > 1 ? { appointmentIds: citas.map((c) => c.id) } : {}),
      },
    });
    return true;
  }

  /**
   * 🏥 Quien escribe ya está en el hospital, o a punto:
   *
   *   · PREGUNTA_TURNO (2026-10-16) — «¿qué número me toca con el doctor, para yo
   *     esperar acá?». Antes se le contestaba «Le escribe Vicente…».
   *   · YA_LLEGO (2026-10-17) — «Acá estamos esperando», «ya llegué». Antes recibía
   *     «por aquí solo puedo ayudarle con sus citas».
   *
   * AgenIA no sabe el turno ni el consultorio: se le recuerda su cita —la del
   * recordatorio o la próxima— y que se los dan en la recepción. Si avisa que llegó
   * y su cita es OTRO día, se le dice: puede haber venido el día que no era.
   */
  private async responderEnElHospital(
    p: {
      organizationId: string;
      senderId: string;
      identity: SenderIdentity;
      text: string;
      MSGS: ReturnType<typeof buildMessages>;
      org: Organization | null;
      timeZone: string | undefined;
    },
    tipo: 'PREGUNTA_TURNO' | 'YA_LLEGO',
  ): Promise<boolean> {
    const recordadas = await this.citasRecordadasDelRemitente(
      p.organizationId,
      p.identity,
    );
    const cita =
      recordadas[0] ??
      (await this.citasProximasDelRemitente(p.organizationId, p.identity))[0];
    const contacto = this.contactoDe(p.MSGS, p.org);
    const servicio = cita?.scheduleSlot.service?.name ?? '';
    const fecha = cita
      ? formatAppointmentLong(cita.scheduleSlot.startTime, {
          timeZone: p.timeZone,
        })
      : '';
    const otroDia =
      tipo === 'YA_LLEGO' &&
      !!cita &&
      diaLocal(cita.scheduleSlot.startTime, p.timeZone) !==
        diaLocal(new Date(), p.timeZone);
    const reply = !cita
      ? tipo === 'YA_LLEGO'
        ? p.MSGS.yaLlegoSinCita(contacto)
        : p.MSGS.preguntaTurnoSinCita(contacto)
      : otroDia
        ? p.MSGS.yaLlegoOtroDia(servicio, fecha, contacto)
        : tipo === 'YA_LLEGO'
          ? p.MSGS.yaLlego(
              servicio,
              fecha,
              doctorLabel(cita.scheduleSlot.doctor),
            )
          : p.MSGS.preguntaTurno(
              servicio,
              fecha,
              doctorLabel(cita.scheduleSlot.doctor),
              contacto,
            );
    await this.smartReply(p.organizationId, p.senderId, reply);
    await this.auditSuccess(p.senderId, p.organizationId, {
      userMessage: p.text,
      botReply: reply,
      metadata: {
        step: tipo,
        appointmentId: cita?.id ?? null,
        ...(otroDia ? { citaEsOtroDia: true } : {}),
      },
    });
    return true;
  }

  /**
   * 🕐 «En ventanilla me dijeron que a las 5:50» (2026-10-20, con la cita a las
   * 6:10): le dieron otra hora o día. Se le dice la que está registrada en el
   * hospital —la del recordatorio o, si no hay, la próxima— y que tenga en cuenta
   * lo que le dijeron o lo confirme: AgenIA no sabe qué le dijeron en ventanilla
   * (a menudo es llegar antes para la admisión). Antes la IA lo tomaba por querer
   * agendar y recibía «no es posible agendar».
   */
  private async responderOtraHora(p: {
    organizationId: string;
    senderId: string;
    identity: SenderIdentity;
    text: string;
    MSGS: ReturnType<typeof buildMessages>;
    org: Organization | null;
    timeZone: string | undefined;
  }): Promise<boolean> {
    const recordadas = await this.citasRecordadasDelRemitente(
      p.organizationId,
      p.identity,
    );
    const cita =
      recordadas[0] ??
      (await this.citasProximasDelRemitente(p.organizationId, p.identity))[0];
    const contacto = this.contactoDe(p.MSGS, p.org);
    const reply = cita
      ? p.MSGS.otraHora(
          cita.scheduleSlot.service?.name ?? '',
          formatAppointmentLong(cita.scheduleSlot.startTime, {
            timeZone: p.timeZone,
          }),
          doctorLabel(cita.scheduleSlot.doctor),
          contacto,
        )
      : p.MSGS.otraHoraSinCita(contacto);
    await this.smartReply(p.organizationId, p.senderId, reply);
    await this.auditSuccess(p.senderId, p.organizationId, {
      userMessage: p.text,
      botReply: reply,
      metadata: { step: 'OTRA_HORA', appointmentId: cita?.id ?? null },
    });
    return true;
  }

  /**
   * 👋 Saludo a secas de quien acaba de recibir un recordatorio (ver
   * `atenderRespuestaAlBot`). Sin recordatorio en las últimas 48 h, false: el
   * saludo sigue el camino de siempre.
   */
  private async saludarTrasRecordatorio(p: {
    organizationId: string;
    senderId: string;
    identity: SenderIdentity;
    text: string;
    MSGS: ReturnType<typeof buildMessages>;
    botName: string;
    orgName: string;
    operaciones: OperacionesBot;
    timeZone: string | undefined;
  }): Promise<boolean> {
    const citas = await this.citasRecordadasDelRemitente(
      p.organizationId,
      p.identity,
    );
    const cita = citas[0];
    if (!cita) return false;
    // «Hola» es el atajo de agendar en los demás avisos; aquí no: otro «Hola» ya
    // no es este saludo sino el menú, pero «agendar» lo dice sin dudas.
    const opciones = this.lineasDeLoDisponible(p.MSGS, p.operaciones, {
      atajoAgendar: '"agendar"',
    });
    const reply =
      citas.length > 1
        ? p.MSGS.saludoTrasRecordatorioVarias(
            p.botName,
            p.orgName,
            this.lineasDeCitas(p.MSGS, citas, p.timeZone),
            opciones,
          )
        : p.MSGS.saludoTrasRecordatorio(
            p.botName,
            p.orgName,
            (cita.patient?.fullName ?? '').trim().split(/\s+/)[0],
            cita.scheduleSlot.service?.name ?? '',
            formatAppointmentLong(cita.scheduleSlot.startTime, {
              timeZone: p.timeZone,
            }),
            opciones,
          );
    // Ya se presentó: lo que siga no repite la bienvenida.
    await this.redis.set(
      this.presentadoKey(p.organizationId, p.senderId),
      '1',
      'EX',
      PRESENTACION_TTL,
    );
    // Y ya sabe de su cita: con agendar encendido, el próximo saludo es el menú.
    await this.redis.set(
      this.saludoTrasRecordatorioKey(p.organizationId, p.senderId),
      '1',
      'EX',
      SALUDO_TRAS_RECORDATORIO_TTL,
    );
    await this.smartReply(p.organizationId, p.senderId, reply);
    await this.auditSuccess(p.senderId, p.organizationId, {
      userMessage: p.text,
      botReply: reply,
      metadata: {
        step: 'SALUDO_TRAS_RECORDATORIO',
        appointmentId: cita.id,
        ...(citas.length > 1 ? { appointmentIds: citas.map((c) => c.id) } : {}),
      },
    });
    return true;
  }

  /** «el hospital al *606 853 8860*», o «el hospital» si no tiene teléfono. */
  /**
   * 🗓️ Si no hay cupos dentro del plazo máximo para agendar pero sí más adelante:
   * hasta qué día se agenda y desde cuál escribir, en palabras («domingo 25 de
   * octubre»). null si no es el plazo (no hay plazo, o tampoco hay cupos después):
   * entonces se responde como siempre. Si la consulta falla, también null.
   */
  private async cupoMasAllaDelPlazo(
    serviceName: string,
    epsId: string | null,
    organizationId: string,
  ): Promise<{ hasta: string; desde: string; desdeIso: string } | null> {
    try {
      const r = await this.appointmentsService.cupoMasAllaDelPlazo(
        serviceName,
        epsId,
        organizationId,
      );
      return r
        ? {
            hasta: fechaEnPalabras(r.ultimoDia, { conAnio: false }),
            desde: fechaEnPalabras(r.desde, { conAnio: false }),
            desdeIso: r.desde,
          }
        : null;
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo revisar el plazo para agendar (org ${organizationId}): ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  private contactoDe(
    MSGS: ReturnType<typeof buildMessages>,
    org: Organization | null,
  ): string {
    return org?.supportPhone
      ? MSGS.contactoClinica(org.supportPhone)
      : MSGS.contactoClinicaSinTelefono();
  }

  /**
   * ❌ «No puedo asistir», «cancelar cita», «ya no la necesito»… con cancelar
   * ENCENDIDO (2026-10-15): el bot le ofrece cancelar y espera su SÍ. Antes, solo
   * «cancelar cita» al principio del mensaje abría la cancelación; «Buen día, no
   * puedo asistir» —lo que más escriben— caía a la IA y no pasaba nada.
   *
   *   · Las citas del recordatorio que acaba de recibir o, si no hay, sus citas
   *     próximas. «cancelar cita» tal cual sin recordatorio: el flujo de siempre,
   *     que pide la cédula.
   *   · UNA cita: se le muestra y se le pregunta si la cancela
   *     (`AWAITING_CANCEL_CONFIRM`, el mismo paso del flujo de siempre: el SÍ la
   *     cancela y espera al hospital).
   *   · VARIAS: elige cuál con una letra (`AWAITING_CANCEL_SELECTION`, el mismo
   *     paso del flujo de siempre). Antes se le ofrecía solo la primera.
   *   · Sin citas: false, sigue el camino de siempre.
   *
   * Solo citas de los perfiles de quien escribe: nunca la de otra persona.
   */
  private async ofrecerCancelar(p: {
    organizationId: string;
    senderId: string;
    identity: SenderIdentity;
    text: string;
    MSGS: ReturnType<typeof buildMessages>;
    org: Organization | null;
  }): Promise<boolean> {
    const { organizationId, senderId, MSGS } = p;
    const timeZone = p.org?.timezone || undefined;
    const esElAtajo = this.cancelRegex.test(textoParaCoincidencia(p.text));
    const recordadas = await this.citasRecordadasDelRemitente(
      organizationId,
      p.identity,
    );
    const candidatas =
      recordadas.length > 0
        ? recordadas
        : esElAtajo
          ? []
          : await this.citasProximasDelRemitente(organizationId, p.identity);
    // 🕐 Una cita cuya hora ya pasó (las recordadas incluyen la última hora) no
    // se ofrece cancelar: en el hospital sería borrar una cita ya cumplida o
    // perdida (caso real 2026-10-16: «no podré asistir a las 7:30» a las 7:25 y
    // el SÍ podía llegar después).
    const ahora = Date.now();
    const citas = candidatas.filter(
      (c) => c.scheduleSlot.startTime.getTime() > ahora,
    );
    if (candidatas.length > 0 && citas.length === 0) {
      const reply = MSGS.citaYaPaso(
        this.contactoDe(MSGS, await this.organizacionDe(organizationId)),
      );
      await this.smartReply(organizationId, senderId, reply);
      await this.auditSuccess(senderId, organizationId, {
        userMessage: p.text,
        botReply: reply,
        metadata: { step: 'CITA_YA_PASO' },
      });
      return true;
    }
    if (citas.length === 0) return false;

    if (citas.length === 1) {
      const cita = citas[0];
      await this.redis.set(
        `temp_selected_cancel_apt:${organizationId}:${senderId}`,
        cita.id,
        'EX',
        SESSION_TTL,
      );
      await this.redis.set(
        `temp_selected_cancel_slot:${organizationId}:${senderId}`,
        cita.scheduleSlotId,
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.cancelarOfrecer(
        cita.scheduleSlot.service?.name ?? '',
        doctorLabel(cita.scheduleSlot.doctor),
        formatAppointmentLong(cita.scheduleSlot.startTime, { timeZone }),
      );
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_CANCEL_CONFIRM,
      );
      await this.auditSuccess(senderId, organizationId, {
        userMessage: p.text,
        botReply: reply,
        metadata: { step: 'CANCELAR_OFRECIDO', appointmentId: cita.id },
      });
      return true;
    }

    // Varias: el mismo mapeo letra → cita que usa el flujo de siempre, escrito
    // ANTES de ofrecer el menú (ver handleCancelCedulaStep).
    const variosPacientes = new Set(citas.map((c) => c.patientId)).size > 1;
    let lineas = '';
    let maxLetra = 'A';
    for (let idx = 0; idx < citas.length; idx++) {
      const cita = citas[idx];
      const letra = String.fromCharCode(65 + idx);
      maxLetra = letra;
      await this.redis.set(
        `temp_cancel_apt_${letra}:${organizationId}:${senderId}`,
        cita.id,
        'EX',
        SESSION_TTL,
      );
      await this.redis.set(
        `temp_cancel_slot_${letra}:${organizationId}:${senderId}`,
        cita.scheduleSlotId,
        'EX',
        SESSION_TTL,
      );
      const nombre = (cita.patient?.fullName ?? '').trim().split(/\s+/)[0];
      lineas +=
        `*${letra})* ${cita.scheduleSlot.service?.name ?? ''} · ` +
        `${doctorLabel(cita.scheduleSlot.doctor)} · ` +
        formatAppointmentCompact(cita.scheduleSlot.startTime, { timeZone }) +
        (variosPacientes && nombre ? ` (${nombre})` : '') +
        '\n';
    }
    await this.redis.set(
      `temp_cancel_max_letra:${organizationId}:${senderId}`,
      maxLetra,
      'EX',
      SESSION_TTL,
    );
    const reply = MSGS.cancelarElegirCual(lineas.trimEnd());
    await this.smartReply(organizationId, senderId, reply);
    await this.setUserState(
      organizationId,
      senderId,
      ChatState.AWAITING_CANCEL_SELECTION,
    );
    await this.auditSuccess(senderId, organizationId, {
      userMessage: p.text,
      botReply: reply,
      metadata: {
        step: 'CANCELAR_ELEGIR_CITA',
        appointmentIds: citas.map((c) => c.id),
      },
    });
    return true;
  }

  /** 🔎 Cuánto tiempo después de agendar una duda del paciente abre el caso. */
  private static readonly VENTANA_REVISAR_CITA_MS = 24 * 60 * 60 * 1000;

  private preguntaOtroServicioKey(organizationId: string, senderId: string) {
    return `temp_pregunta_otro_servicio:${organizationId}:${senderId}`;
  }

  /**
   * 🔎 «Revisar una cita agendada por el asistente» (2026-10-23): poco después de
   * agendar, el paciente pregunta si la cita era para otro servicio o dice que no
   * era la que necesitaba (`dudaSobreLaCita`). Deja el caso en la Bandeja con la
   * cita y lo que escribió. No responde nada ni toca la cita: eso lo decide una
   * persona con el paciente.
   */
  private async revisarCitaRecienAgendada(p: {
    organizationId: string;
    senderId: string;
    identity: SenderIdentity;
    text: string;
  }): Promise<void> {
    // Primero el texto: la base solo se consulta para lo que parece una duda.
    if (!this.avisosPaciente || !dudaSobreLaCita(p.text, null)) return;
    const deQuien = this.perfilesDelRemitente(p.identity);
    if (deQuien.length === 0) return;
    const ahora = new Date();
    const cita = await this.prisma.appointment.findFirst({
      where: {
        organizationId: p.organizationId,
        origin: { in: ['WHATSAPP', 'TELEGRAM'] },
        status: 'SCHEDULED',
        createdAt: {
          gte: new Date(
            ahora.getTime() - ChatbotService.VENTANA_REVISAR_CITA_MS,
          ),
        },
        scheduleSlot: { startTime: { gt: ahora } },
        patient: { OR: deQuien },
      },
      include: { scheduleSlot: { include: { service: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (!cita) return;
    const duda = dudaSobreLaCita(
      p.text,
      cita.scheduleSlot.service?.name ?? null,
    );
    if (!duda) return;
    await this.registrarRevisionDeCita(
      p.organizationId,
      cita,
      {
        motivo: duda.motivo,
        ...(duda.motivo === 'OTRO_SERVICIO'
          ? { servicioPedido: duda.servicio }
          : {}),
        mensaje: p.text.slice(0, 300),
        canal: canalDe(p.senderId),
      },
      ahora,
    );
  }

  /**
   * 🔎 Confirmó la cita después de preguntar si era para otro servicio que no se
   * agenda por aquí (`aclararCitaOtroServicio`): se le aclaró y dijo que sí, pero
   * conviene que una persona lo confirme. Best-effort: la cita ya está agendada.
   */
  private async revisarSiConfirmoTrasPreguntar(
    organizationId: string,
    senderId: string,
    appointmentId: string | undefined,
  ): Promise<void> {
    try {
      const key = this.preguntaOtroServicioKey(organizationId, senderId);
      const guardado = await this.redis.get(key);
      if (!guardado || !appointmentId || !this.avisosPaciente) return;
      await this.redis.del(key);
      const pregunta = JSON.parse(guardado) as {
        servicio?: string;
        mensaje?: string;
      };
      const cita = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { scheduleSlot: true },
      });
      if (!cita || cita.organizationId !== organizationId) return;
      await this.registrarRevisionDeCita(
        organizationId,
        cita,
        {
          motivo: 'CONFIRMO_TRAS_PREGUNTAR',
          servicioPedido: pregunta.servicio ?? null,
          mensaje: (pregunta.mensaje ?? '').slice(0, 300),
          canal: canalDe(senderId),
        },
        new Date(),
      );
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo dejar la cita ${appointmentId ?? '?'} para revisión: ${getErrorMessage(error)}`,
      );
    }
  }

  private async registrarRevisionDeCita(
    organizationId: string,
    cita: {
      id: string;
      patientId: string;
      epsId: string | null;
      scheduleSlot: { startTime: Date; doctorId: string };
    },
    meta: Record<string, unknown>,
    ahora: Date,
  ): Promise<void> {
    const inicio = cita.scheduleSlot.startTime;
    await this.avisosPaciente!.registrar(
      organizationId,
      {
        kind: 'REVISAR_CITA_ASISTENTE',
        dedupeKey: claveExcepcion.revisarCitaAsistente(cita.id),
        severity: severidadPorCercania(
          'MEDIA',
          (inicio.getTime() - ahora.getTime()) / 60_000,
        ),
        title: TITULO_EXCEPCION.REVISAR_CITA_ASISTENTE,
        appointmentId: cita.id,
        patientId: cita.patientId,
        epsId: cita.epsId,
        doctorId: cita.scheduleSlot.doctorId,
        appointmentStartAt: inicio,
        meta,
      },
      ahora,
    );
  }

  /**
   * 📝 «No puedo asistir» / «necesito reagendar» con esa operación APAGADA
   * (2026-10-15: seis avisos así en dos días, que solo quedaban en la caja negra).
   *
   * El aviso queda en la bandeja del personal (`AVISO_INASISTENCIA`) con la cita,
   * el paciente y lo que escribió. NO se toca la cita ni se escribe NADA en el
   * hospital: liberar el cupo lo decide una persona, en el hospital. Cuando la
   * cita se cancela o cambia de hora, el vigilante cierra el aviso solo.
   *
   * Con la operación ENCENDIDA el bot la hace él mismo: false, sigue el camino de
   * siempre. Sin una cita a la que atar el aviso, también: el «comuníquese con el
   * hospital» de siempre.
   */
  private async atenderAvisoDelPaciente(
    p: {
      organizationId: string;
      senderId: string;
      identity: SenderIdentity;
      text: string;
      MSGS: ReturnType<typeof buildMessages>;
      org: Organization | null;
      operaciones: OperacionesBot;
    },
    pide: 'CANCELAR' | 'MODIFICAR',
  ): Promise<boolean> {
    if (p.operaciones[CLAVE_OPERACION[pide]]) return false;
    if (!this.avisosPaciente) return false;
    const todas = await this.citasDelAviso(p.organizationId, p.identity);
    if (todas.length === 0) return false;

    // Un aviso por CADA cita (2026-10-15: «cancelar las citas» de quien tenía dos
    // dejó en la bandeja solo la primera). Las que no se pudieron registrar no se
    // le nombran al paciente: prometerle un aviso que no existe sería mentirle.
    const ahora = new Date();
    const citas: typeof todas = [];
    for (const cita of todas) {
      const inicio = cita.scheduleSlot.startTime;
      try {
        await this.avisosPaciente.registrar(
          p.organizationId,
          {
            kind: 'AVISO_INASISTENCIA',
            dedupeKey: claveExcepcion.avisoInasistencia(cita.id),
            severity: severidadPorCercania(
              'MEDIA',
              (inicio.getTime() - ahora.getTime()) / 60_000,
            ),
            title: TITULO_EXCEPCION.AVISO_INASISTENCIA,
            appointmentId: cita.id,
            patientId: cita.patientId,
            epsId: cita.epsId,
            doctorId: cita.scheduleSlot.doctorId,
            appointmentStartAt: inicio,
            meta: {
              pide,
              mensaje: p.text.slice(0, 300),
              canal: canalDe(p.senderId),
              ...(todas.length > 1 ? { citasDelAviso: todas.length } : {}),
            },
          },
          ahora,
        );
        citas.push(cita);
      } catch (error: unknown) {
        this.logger.error(
          `No se pudo registrar el aviso del paciente (cita ${cita.id}): ${getErrorMessage(error)}`,
        );
      }
    }
    if (citas.length === 0) return false;

    const timeZone = p.org?.timezone || undefined;
    const cita = citas[0];
    const fecha = formatAppointmentLong(cita.scheduleSlot.startTime, {
      timeZone,
    });
    const servicio = cita.scheduleSlot.service?.name ?? '';
    const contacto = this.contactoDe(p.MSGS, p.org);
    const lineas =
      citas.length > 1 ? this.lineasDeCitas(p.MSGS, citas, timeZone) : '';
    const aviso =
      pide === 'CANCELAR'
        ? lineas
          ? p.MSGS.avisoInasistenciaRegistradoVarias(lineas, contacto)
          : p.MSGS.avisoInasistenciaRegistrado(servicio, fecha, contacto)
        : lineas
          ? p.MSGS.avisoCambioRegistradoVarias(lineas, contacto)
          : p.MSGS.avisoCambioRegistrado(servicio, fecha, contacto);
    // Si otra operación sigue encendida (p. ej. cambiar la fecha a quien no
    // puede ir), se la ofrece, como el aviso de operación no disponible.
    const reply = soloConsultas(p.operaciones)
      ? aviso
      : `${aviso}\n\n${p.MSGS.avisoTambienPuede(this.lineasDeLoDisponible(p.MSGS, p.operaciones))}`;
    await this.smartReply(p.organizationId, p.senderId, reply);
    await this.auditSuccess(p.senderId, p.organizationId, {
      userMessage: p.text,
      botReply: reply,
      metadata: {
        step:
          pide === 'CANCELAR'
            ? 'AVISO_INASISTENCIA_REGISTRADO'
            : 'AVISO_CAMBIO_REGISTRADO',
        appointmentId: cita.id,
        ...(citas.length > 1 ? { appointmentIds: citas.map((c) => c.id) } : {}),
      },
    });
    return true;
  }

  /**
   * ☎️ «Vicentico está equivocado de número» (2026-10-15): el teléfono que el
   * hospital tiene de un paciente es de otra persona. A ese número no se le
   * vuelve a escribir:
   *
   *   · Con espejo (hay bandeja): queda un caso por paciente con ese número
   *     (`TELEFONO_EQUIVOCADO`) y el cron de recordatorios no le escribe mientras
   *     siga abierto. Cuando el personal corrige el teléfono y lo cierra —o lo
   *     descarta, si no era cierto—, los recordatorios vuelven solos: no queda
   *     ninguna marca en el paciente que alguien tenga que acordarse de quitar.
   *     AgenIA no cambia el número: lo corrige una persona (el espejo nunca pisa
   *     un teléfono que AgenIA ya tiene, así que corregirlo solo en el hospital
   *     no basta).
   *   · Sin espejo no hay bandeja: se apagan sus recordatorios como en la baja.
   *
   * Solo WhatsApp: un chat de Telegram lo vincula el propio paciente. Si ningún
   * perfil tiene ese número, no hay nada que corregir: false.
   *
   * 🤖 `automatica` (2026-10-15): al recordatorio le contestó la contestadora de
   * un negocio («Gracias por comunicarte al restaurante…»). Mismo caso para el
   * personal —probablemente el número no es del paciente—, pero SIN responderle.
   */
  private async atenderNumeroEquivocado(
    p: {
      organizationId: string;
      senderId: string;
      identity: SenderIdentity;
      text: string;
      MSGS: ReturnType<typeof buildMessages>;
      orgName: string;
    },
    opts: { automatica?: boolean } = {},
  ): Promise<boolean> {
    const automatica = opts.automatica === true;
    // 🤖 A una contestadora no se le contesta nunca: ni el caso ni la disculpa.
    // Si se le respondiera, ella respondería otra vez (y se le estarían mandando
    // datos de la cita a un negocio). Por eso aquí se devuelve true aunque no
    // haya nada que registrar.
    const silencio = async (motivo: string): Promise<boolean> => {
      await this.auditSuccess(p.senderId, p.organizationId, {
        userMessage: p.text,
        botReply: '[sin respuesta: contestadora automática]',
        metadata: { step: 'RESPUESTA_AUTOMATICA', motivo },
      });
      return true;
    };
    if (isTelegramSender(p.senderId)) {
      return automatica ? silencio('TELEGRAM') : false;
    }
    const deQuien = this.perfilesDelRemitente(p.identity);
    if (deQuien.length === 0) {
      return automatica ? silencio('SIN_REMITENTE') : false;
    }
    const where: Prisma.PatientProfileWhereInput = {
      organizationId: p.organizationId,
      OR: deQuien,
    };
    const perfiles = await this.prisma.patientProfile.findMany({
      where,
      select: { id: true, epsId: true },
      take: 10,
    });
    if (perfiles.length === 0) {
      return automatica ? silencio('SIN_PACIENTE') : false;
    }

    const espejo = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId: p.organizationId },
      select: { enabled: true },
    });
    let casos = 0;
    let bajas = 0;
    if (espejo?.enabled && this.avisosPaciente) {
      // La cita del recordatorio de cada paciente, si la hay: con ella el caso le
      // sale también al agendador acotado a ese médico.
      const citas = await this.citasRecordadasDelRemitente(
        p.organizationId,
        p.identity,
        { incluirTelefonoEquivocado: true },
      );
      const ahora = new Date();
      for (const perfil of perfiles) {
        const deEsteRecordatorio =
          citas.find((c) => c.patientId === perfil.id) ?? null;
        try {
          const r = await this.avisosPaciente.registrar(
            p.organizationId,
            {
              kind: 'TELEFONO_EQUIVOCADO',
              dedupeKey: claveExcepcion.telefonoEquivocado(perfil.id),
              severity: 'MEDIA',
              title: TITULO_EXCEPCION.TELEFONO_EQUIVOCADO,
              patientId: perfil.id,
              epsId: deEsteRecordatorio?.epsId ?? perfil.epsId,
              doctorId: deEsteRecordatorio?.scheduleSlot.doctorId ?? null,
              appointmentId: deEsteRecordatorio?.id ?? null,
              // Sin hora de cita: el número sigue mal aunque la cita pase, así
              // que el caso no vence solo.
              meta: {
                mensaje: p.text.slice(0, 300),
                perfilesConElNumero: perfiles.length,
                ...(automatica ? { motivo: 'RESPUESTA_AUTOMATICA' } : {}),
              },
            },
            ahora,
          );
          // IGNORADA: alguien ya lo había cerrado a mano y no se reabre solo; el
          // caso no frena nada, así que ese perfil va por la baja de abajo.
          if (r !== 'IGNORADA') casos++;
        } catch (error: unknown) {
          this.logger.error(
            `No se pudo registrar el número equivocado (paciente ${perfil.id}): ${getErrorMessage(error)}`,
          );
        }
      }
    }
    // Sin bandeja, o si el caso de alguno no quedó abierto: la baja de siempre.
    // Prometer «no le escribiremos más» sin nada que lo cumpla sería mentirle.
    if (casos < perfiles.length) {
      ({ count: bajas } = await this.prisma.patientProfile.updateMany({
        where,
        data: { remindersOptOut: true },
      }));
    }

    const reply = automatica
      ? '[sin respuesta: contestadora automática]'
      : p.MSGS.numeroEquivocado(p.orgName);
    if (!automatica) await this.smartReply(p.organizationId, p.senderId, reply);
    await this.auditSuccess(p.senderId, p.organizationId, {
      userMessage: p.text,
      botReply: reply,
      metadata: {
        step: automatica ? 'RESPUESTA_AUTOMATICA' : 'NUMERO_EQUIVOCADO',
        perfilesAfectados: perfiles.length,
        casosEnBandeja: casos,
        bajasDeRecordatorios: bajas,
      },
    });
    return true;
  }

  /**
   * 🔒 La operación que pidió el paciente está apagada en esta clínica.
   *
   * Con las TRES apagadas es «solo consultas» (`responderSoloConsultas`, el
   * aviso de siempre). Con solo una o dos, el aviso dice cuál no se puede, con
   * quién hacerla y qué SÍ se puede por aquí, con la frase que lo abre: decirle
   * «solo consultas» a quien sí puede cancelar sería falso.
   *
   * Deja la sesión en IDLE. Terminal: el caller hace return tras llamar.
   */
  private async responderOperacionNoDisponible(p: {
    organizationId: string;
    senderId: string;
    text: string | undefined;
    org: Organization | null;
    orgName: string;
    botName: string;
    MSGS: ReturnType<typeof buildMessages>;
    motivo: OperacionBot;
    operaciones: OperacionesBot;
  }): Promise<void> {
    if (soloConsultas(p.operaciones)) {
      await this.responderSoloConsultas(p);
      return;
    }
    const { organizationId, senderId, MSGS, motivo } = p;
    const contacto = p.org?.supportPhone
      ? MSGS.contactoClinica(p.org.supportPhone)
      : MSGS.contactoClinicaSinTelefono();
    const disponibles = operacionesPermitidas(p.operaciones);
    const lineas = this.lineasDeLoDisponible(MSGS, p.operaciones);
    const { nombre, hacerla } = TEXTO_OPERACION[motivo];
    const key = this.presentadoKey(organizationId, senderId);
    const yaSePresento = !!(await this.redis.get(key));
    // 🔁 Ya se le dijo hace poco: la versión corta, sin repetir la lista.
    const repetidoKey = `no_disponible_dicho:${organizationId}:${senderId}:${motivo}`;
    const repetido = !!(await this.redis.get(repetidoKey));
    await this.cleanUpSession(organizationId, senderId);
    await this.redis.set(key, '1', 'EX', PRESENTACION_TTL);
    await this.redis.set(repetidoKey, '1', 'EX', NO_DISPONIBLE_REPETIDO_TTL);
    const reply = repetido
      ? MSGS.operacionNoDisponibleCorto(hacerla, contacto)
      : yaSePresento
        ? MSGS.operacionNoDisponible(nombre, hacerla, contacto, lineas)
        : MSGS.operacionNoDisponibleBienvenida(
            p.orgName,
            nombre,
            hacerla,
            contacto,
            lineas,
            p.botName,
          );
    await this.smartReply(organizationId, senderId, reply);
    await this.auditSuccess(senderId, organizationId, {
      userMessage: p.text || '[audio]',
      botReply: reply,
      metadata: {
        step: 'OPERACION_NO_DISPONIBLE',
        motivo,
        disponibles,
        ...(repetido ? { repetido: true } : {}),
      },
    });
  }

  private async handleEscape(p: {
    organizationId: string;
    senderId: string;
    text: string | undefined;
    currentState: ChatState;
    MSGS: ReturnType<typeof buildMessages>;
    orgName: string;
    botName: string;
    org: Organization | null;
    operaciones: OperacionesBot;
  }): Promise<void> {
    const {
      organizationId,
      senderId,
      text,
      currentState,
      MSGS,
      orgName,
      botName,
    } = p;
    await this.cleanUpSession(organizationId, senderId);

    const isGreeting = this.greetingRegex.test(textoParaCoincidencia(text));

    // 🔒 Sin agendar por el bot, el saludo no abre el menú de servicios: dice
    // qué se puede hacer por aquí (o «solo consultas» si no se puede nada).
    if (isGreeting && !p.operaciones.agendar) {
      await this.responderOperacionNoDisponible({
        organizationId,
        senderId,
        text,
        org: p.org,
        orgName,
        botName,
        MSGS,
        motivo: 'AGENDAR',
        operaciones: p.operaciones,
      });
      return;
    }

    if (isGreeting) {
      // Saludo → mostrar bienvenida + menú de servicios con letras (Paso 1).
      const { lineas, count } = await this.buildServiceMenu(
        organizationId,
        senderId,
      );
      const reply =
        count > 0
          ? await this.menuServiciosPresentandose({
              organizationId,
              senderId,
              MSGS,
              orgName,
              botName,
              lineas,
            })
          : MSGS.bienvenida(
              orgName,
              'Ej: Medicina General, Odontología',
              botName,
            );

      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_SPECIALTY,
      );

      await this.auditSuccess(senderId, organizationId, {
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: {
          step: 'WELCOME',
          previousState: currentState,
          newState: ChatState.AWAITING_SPECIALTY,
          triggeredBy: 'greeting_escape',
          servicesCount: count,
        },
      });
    } else {
      // Palabra de reset ("salir", "reiniciar", etc.) → mostrar "Sin problema"
      const reply = MSGS.escape();
      await this.smartReply(organizationId, senderId, reply);

      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.ESCAPED,
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: { previousState: currentState },
      });
    }
  }

  /**
   * ¿El paciente quiere CERRAR la conversación? ("chao", "salir", "no quiero
   * agendar", "hasta luego"...). Match EXACTO contra el diccionario [goodbye],
   * previa normalización tolerante: minúsculas, sin signos de puntuación ni
   * emojis al inicio/fin y colapsando espacios internos. Así "Chao." / "¡Hasta
   * luego!" / "  no quiero seguir  " coinciden, sin abrir la puerta a falsos
   * positivos (sigue anclado a ^...$, no es "contiene"). Se aplica tanto a
   * TEXTO como a la TRANSCRIPCIÓN de un audio → paridad voz↔texto.
   */
  private matchesGoodbye(text: string | undefined | null): boolean {
    // La normalización que antes vivía aquí dentro es ahora
    // `textoParaCoincidencia`, compartida por TODOS los diccionarios anclados:
    // era la única tolerante, y por eso «chao.» funcionaba mientras `*"Hola"*`
    // no. Ver el porqué en texto-para-coincidencia.util.ts.
    const normalized = textoParaCoincidencia(text);
    if (!normalized) return false;
    return this.goodbyeRegex.test(normalized);
  }

  /**
   * Cierre cordial de la conversación: limpia la sesión (estado → IDLE) y
   * envía una despedida. A diferencia de handleEscape (reinicio: "comencemos
   * de nuevo"), aquí el paciente NO quiere seguir, así que NO reabrimos el
   * flujo. Terminal: el caller hace return tras llamar.
   */
  private async handleGoodbye(p: {
    organizationId: string;
    senderId: string;
    text: string | undefined;
    currentState: ChatState;
    MSGS: ReturnType<typeof buildMessages>;
  }): Promise<void> {
    const { organizationId, senderId, text, currentState, MSGS } = p;
    await this.cleanUpSession(organizationId, senderId);
    // Se despidió: si vuelve, es otra conversación y el bot se presenta otra vez.
    await this.redis.del(this.presentadoKey(organizationId, senderId));
    const reply = MSGS.despedidaCorta();
    await this.smartReply(organizationId, senderId, reply);
    await this.auditSuccess(senderId, organizationId, {
      userMessage: text || '[audio]',
      botReply: reply,
      metadata: { step: 'GOODBYE', previousState: currentState },
    });
  }

  /**
   * 🧲 ESCENARIO 2 — Pide confirmación antes de abandonar un agendamiento en
   * curso para pasar a cancelar una cita existente. Guarda el estado previo
   * para poder retomar si el paciente responde NO.
   *
   * Fuente ÚNICA de esta transición: la dispara tanto el interceptor por
   * TEXTO (`cancelRegex` → isQuickCancel, evaluado antes del LLM) como el
   * camino de VOZ (flag `isCancellation` del extractor, que solo se conoce
   * después de transcribir). Sin el segundo, la misma frase dicha en voz alta
   * abortaba el agendamiento sin preguntar. Terminal: el caller hace return.
   */
  private async promptSchedulingInterrupt(p: {
    organizationId: string;
    senderId: string;
    text: string | undefined;
    currentState: ChatState;
    MSGS: ReturnType<typeof buildMessages>;
    via: 'text_regex' | 'voice_llm';
  }): Promise<void> {
    const { organizationId, senderId, text, currentState, MSGS, via } = p;

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

    await this.auditLog(senderId, organizationId, {
      status: InteractionStatus.CANCELLATION_FLOW,
      userMessage: text || (via === 'voice_llm' ? '[audio]' : '[texto]'),
      botReply: reply,
      metadata: {
        event: 'SCHEDULING_INTERRUPT_PROMPT',
        interruptedState: currentState,
        via,
      },
    });
  }

  private async processIncomingMessageUnsafe(event: WhatsappInboundEvent) {
    const identity = resolveSenderIdentity(event);
    // Sin remitente no hay nada que procesar ni a quién responder — pero eso NO
    // se descarta en silencio: hasta este cambio, un payload sin `from` (justo
    // lo que Meta envía cuando el paciente oculta su número tras un username)
    // se perdía sin log, sin auditoría y sin excepción. El paciente escribía y
    // nadie se enteraba nunca.
    if (!identity) {
      await this.auditUnidentifiedSender(event);
      return;
    }
    // `senderId` queda como `string` para el resto del turno (se usa como clave
    // de Redis y destinatario por doquier).
    const senderId = identity.senderId;
    const messageType = event.type;
    // `text` puede reasignarse: cuando llega audio, lo sustituimos por la
    // transcripción literal del paciente para que la voz recorra EXACTAMENTE
    // el mismo camino determinista que el texto (ver rama `isAudio` abajo).
    let text = event.text?.body?.trim() || event.message?.text?.trim();
    const audioId = event.audio?.id;

    // ── IDENTIFICACIÓN DEL TENANT ──────────────────────────────
    // Resolvemos la organización destino a partir del phone_number_id de Meta
    // (ver resolveTenant). Devuelve null si el turno debe descartarse (sin
    // tenant enrutable u organización inactiva); los efectos de descarte
    // (warn / mensaje de "línea inactiva" + auditoría) ocurren dentro del
    // helper. El destructure deja `organizationId`/`orgName` como `string`.
    const tenant = await this.resolveTenant(event, senderId, text, messageType);
    if (!tenant) return;
    const { org, organizationId, orgName } = tenant;

    // 📈 Un registro por mensaje que llega a una clínica, sea cual sea su tipo
    // (también stickers o imágenes que el bot ignora: el paciente sí escribió).
    // Los webhooks ya descartaron los reintentos duplicados, así que el conteo
    // es exacto. Sin texto; remitente seudonimizado. Nunca lanza.
    await this.channelActivity.record({
      organizationId,
      senderId,
      event: 'INBOUND',
      messageType,
    });

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
    // ✈️ Por Telegram, los textos que nombran el canal dicen «Telegram».
    const MSGS = buildMessages(communicationStyle, canalDe(senderId));

    // 🔒 Interruptores de operaciones de la clínica (/dashboard/configuracion):
    // agendar, cancelar y cambiar la fecha, cada uno por su lado. Se leen en
    // cada mensaje: apagar uno surte efecto en el siguiente turno.
    const operaciones = await this.operacionesDisponibles(organizationId);

    // `let`: con el interruptor apagado, un flujo de operación a medias se
    // descarta y el turno sigue como si la conversación empezara (ver abajo).
    let currentState = await this.getUserState(organizationId, senderId);
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

    // 🚑 GUARDRAIL: POSIBLE EMERGENCIA MÉDICA → DERIVACIÓN INMEDIATA ──
    // Máxima prioridad: se evalúa ANTES que insultos, reintentos y estados
    // (incluidos los pasos estrictos, donde el LLM ni se llama — un "me
    // duele mucho el pecho" en AWAITING_CONFIRMATION NO debe recibir un
    // reintento de SÍ/NO). Una cita a días vista no es respuesta para un
    // posible infarto: se deriva a 123/urgencias/humano y se corta el
    // agendamiento. El AUDIO se cubre tras el LLM (flag isEmergency de la
    // Tarea D + regex sobre la transcripción adoptada, ver más abajo).
    if (messageType === 'text' && this.isEmergencyText(text)) {
      await this.escalateEmergency({
        organizationId,
        senderId,
        org,
        MSGS,
        text,
        currentState,
        via: 'EMERGENCY_REGEX',
      });
      return;
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

      await this.auditLog(senderId, organizationId, {
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
      await this.sendSurveyLink(
        organizationId,
        senderId,
        ResolutionStatus.BLOCKED_INSULT,
        {
          chatSummary: 'Sesión cerrada por insulto detectado (regex).',
        },
      );
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
      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.ABANDONED,
        failureReason: FailureReason.MAX_RETRIES,
        userMessage: text || `[${messageType}]`,
        botReply: replyText,
        metadata: { previousState: currentState, retriesCount, maxRetries },
      });

      // ⭐ CSAT: cierre por error técnico / exceso de reintentos.
      await this.sendSurveyLink(
        organizationId,
        senderId,
        ResolutionStatus.SYSTEM_ERROR,
        {
          chatSummary: `Sesión cerrada por exceso de reintentos (${maxRetries}).`,
        },
      );
      return;
    }

    // 🔒 OPERACIÓN APAGADA A MEDIAS: si la clínica apagó la operación que el
    // paciente tenía en curso (agendaba, cancelaba o cambiaba una cita, o
    // esperaba la respuesta a un cupo de la lista de espera), ese flujo ya no
    // puede terminar. Se descarta y el mensaje se atiende desde cero:
    // «consultar» abre la consulta y lo que pida una operación apagada recibe
    // su aviso (más abajo). Va antes de clasificar el paso, para que un «A» o un
    // «SÍ» sueltos no se lean como respuesta a un paso que ya no existe.
    const enCurso = operacionDelEstado(currentState);
    if (enCurso && !operaciones[CLAVE_OPERACION[enCurso]]) {
      this.logger.log(
        `[Tenant: ${organizationId}] Operación ${enCurso} apagada: se descarta el flujo ${currentState} de ${senderId}`,
      );
      await this.cleanUpSession(organizationId, senderId);
      currentState = ChatState.IDLE;
    }

    const isStrictStep =
      currentState === ChatState.AWAITING_DATE ||
      currentState === ChatState.AWAITING_CONFIRMATION ||
      // Alta de paciente nuevo: una fecha y dos letras. Deterministas — no
      // llaman al LLM, y sin esto el turno caía al protocolo general y volvía
      // a preguntar lo mismo en bucle.
      currentState === ChatState.AWAITING_APELLIDOS ||
      currentState === ChatState.AWAITING_BIRTHDATE ||
      currentState === ChatState.AWAITING_GENDER ||
      currentState === ChatState.AWAITING_REGIME ||
      currentState === ChatState.AWAITING_CANCEL_RETRY_CEDULA ||
      currentState === ChatState.AWAITING_CANCEL_SELECTION ||
      currentState === ChatState.AWAITING_CANCEL_CONFIRM ||
      currentState === ChatState.AWAITING_WAITLIST_CONFIRM ||
      currentState === ChatState.AWAITING_WAITLIST_OPTIN ||
      currentState === ChatState.AWAITING_POST_CANCEL_CHOICE ||
      // Pasos deterministas de reprogramación (letra / SÍ-NO; no llaman al LLM).
      currentState === ChatState.AWAITING_MODIFY_RETRY_CEDULA ||
      currentState === ChatState.AWAITING_MODIFY_SELECTION ||
      currentState === ChatState.AWAITING_MODIFY_NEW_SLOT ||
      currentState === ChatState.AWAITING_MODIFY_CONFIRM ||
      currentState === ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL ||
      // Consulta de citas: elegir qué hacer con ellas (A-D), sin LLM.
      currentState === ChatState.AWAITING_LOOKUP_CHOICE ||
      // Escenario 2: la confirmación de interrupción es un paso SÍ/NO por texto;
      // como los demás pasos estrictos, no llama al LLM y fluye al switch.
      currentState === ChatState.AWAITING_INTERRUPT_CONFIRMATION;

    // Pasos que esperan un SÍ/NO. A diferencia del resto de pasos estrictos,
    // ESTOS aceptan voz: el audio se transcribe y la respuesta se normaliza con
    // interpretYesNo (texto y voz sirven por igual), y `applyVoiceYesNoAnswer`
    // neutraliza los flags que el LLM pudo inventar al transcribir un "sí".
    //
    // La lista cubre TODOS los pasos SÍ/NO del protocolo, incluidos los de
    // cancelación y reprogramación: sin ellos, un paciente que venía hablando
    // recorría el flujo entero por voz y era rechazado (audioPasoEstricto)
    // justo en el "¿está seguro?" final. Los pasos *_RETRY_CEDULA aceptan
    // además una cédula dictada; si el STT no produce dígitos, el handler
    // reprompta igual que por texto (sin regresión).
    const isYesNoStep =
      currentState === ChatState.AWAITING_WAITLIST_CONFIRM ||
      currentState === ChatState.AWAITING_WAITLIST_OPTIN ||
      currentState === ChatState.AWAITING_CONFIRMATION ||
      currentState === ChatState.AWAITING_CANCEL_CONFIRM ||
      currentState === ChatState.AWAITING_CANCEL_RETRY_CEDULA ||
      currentState === ChatState.AWAITING_POST_CANCEL_CHOICE ||
      currentState === ChatState.AWAITING_INTERRUPT_CONFIRMATION ||
      currentState === ChatState.AWAITING_MODIFY_CONFIRM ||
      currentState === ChatState.AWAITING_MODIFY_RETRY_CEDULA ||
      currentState === ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL;

    // Pasos de SELECCIÓN POR LETRA (elegir horario o cita de un listado A/B/C).
    // Igual que el SÍ/NO de waitlist, ESTOS aceptan voz: el audio se transcribe
    // y la letra se normaliza con extractOptionLetter ("be"→B, "la a"→A, etc.).
    // Sin esta excepción, decir la letra por voz se rechazaba como "paso estricto".
    const isLetterSelectionStep =
      currentState === ChatState.AWAITING_DATE ||
      currentState === ChatState.AWAITING_CANCEL_SELECTION ||
      currentState === ChatState.AWAITING_MODIFY_SELECTION ||
      currentState === ChatState.AWAITING_MODIFY_NEW_SLOT ||
      currentState === ChatState.AWAITING_LOOKUP_CHOICE;

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

    if (isAudio && isStrictStep && !isYesNoStep && !isLetterSelectionStep) {
      const reply = MSGS.audioPasoEstricto();
      await this.sendWhatsAppMessage(senderId, reply);

      // 📝 Auditoría: rechazo de audio en paso estricto
      await this.auditSuccess(senderId, organizationId, {
        userMessage: '[audio]',
        botReply: reply,
        metadata: {
          reason: 'AUDIO_REJECTED_IN_STRICT_STEP',
          state: currentState,
        },
      });
      return;
    }

    // 🔎 ¿Duda de la cita que el asistente le acaba de agendar («¿esto sí es para
    // las ecografías?», 2026-10-23)? Queda el caso en la Bandeja para el personal.
    // Solo eso: la conversación sigue exactamente igual, y si falla, también.
    if (
      messageType === 'text' &&
      !!text &&
      (currentState === ChatState.IDLE ||
        currentState === ChatState.AWAITING_SPECIALTY)
    ) {
      await this.revisarCitaRecienAgendada({
        organizationId,
        senderId,
        identity,
        text,
      }).catch((error: unknown) => {
        this.logger.error(
          `No se pudo revisar la duda sobre una cita del asistente (org ${organizationId}): ${getErrorMessage(error)}`,
        );
      });
    }

    // 💬 Respuesta al bot: «sí voy» / «gracias» tras un recordatorio, o «¿de
    // dónde me hablan?». Antes de la despedida: un «muchas gracias» de quien
    // acaba de recibir su recordatorio es una confirmación, no un adiós.
    if (
      messageType === 'text' &&
      !!text &&
      currentState === ChatState.IDLE &&
      (await this.atenderRespuestaAlBot({
        organizationId,
        senderId,
        identity,
        text,
        MSGS,
        botName,
        orgName,
        org,
        operaciones,
        timeZone: org?.timezone || undefined,
      }).catch((error: unknown) => {
        // Un atajo que falla no se lleva el mensaje: sigue el camino de siempre.
        this.logger.error(
          `Respuesta al bot sin IA falló (org ${organizationId}): ${getErrorMessage(error)}`,
        );
        return false;
      }))
    ) {
      return;
    }

    // 💬 …y la misma respuesta al recordatorio desde un menú del agendamiento
    // (2026-10-22): un saludo abrió el menú y lo que siguió era para el recordatorio.
    if (
      messageType === 'text' &&
      !!text &&
      (currentState === ChatState.AWAITING_SPECIALTY ||
        currentState === ChatState.AWAITING_EPS ||
        currentState === ChatState.AWAITING_DATE) &&
      (await this.atenderRespuestaAlRecordatorioEnMenu({
        organizationId,
        senderId,
        identity,
        text,
        MSGS,
        botName,
        orgName,
        org,
        operaciones,
        timeZone: org?.timezone || undefined,
        currentState,
      }).catch((error: unknown) => {
        this.logger.error(
          `Respuesta al recordatorio desde el menú falló (org ${organizationId}): ${getErrorMessage(error)}`,
        );
        return false;
      }))
    ) {
      return;
    }

    // EARLY RETURN: despedida en IDLE — no reabrir el flujo de agendamiento.
    // También un agradecimiento con cortesías (2026-10-17: «Muchas gracias por su
    // ayuda buen día 🙏» recibía «no es posible agendar citas» por el «buen día»).
    if (
      messageType === 'text' &&
      !!text &&
      currentState === ChatState.IDLE &&
      (this.farewellRegex.test(textoParaCoincidencia(text)) ||
        esAgradecimiento(text))
    ) {
      const reply = MSGS.despedidaCorta();
      await this.smartReply(organizationId, senderId, reply);
      await this.auditSuccess(senderId, organizationId, {
        userMessage: text,
        botReply: reply,
        metadata: { step: 'FAREWELL' },
      });
      return;
    }

    // EARLY RETURN: cierre de la conversación por TEXTO en CUALQUIER estado
    // ("chao", "salir", "no quiero agendar"...). Determinista (sin LLM) para no
    // gastar una llamada al extractor en el primer turno. La VOZ se atiende más
    // abajo, tras adoptar la transcripción (ver bloque [goodbye] post-turno).
    if (messageType === 'text' && this.matchesGoodbye(text)) {
      await this.handleGoodbye({
        organizationId,
        senderId,
        text,
        currentState,
        MSGS,
      });
      return;
    }

    // Detección de intención rápida por patrón (sin LLM). Ver detectQuickIntent.
    const { isQuickCancel, isQuickEscape, isQuickModify } =
      this.detectQuickIntent(text, messageType, currentState);

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
    // Solo si la clínica deja cancelar por el bot: si no, «cancelar» cae más
    // abajo en el aviso de que cancelar no está disponible por aquí.
    if (
      isQuickCancel &&
      operaciones.cancelar &&
      SCHEDULING_FLOW_STATES.includes(currentState)
    ) {
      await this.promptSchedulingInterrupt({
        organizationId,
        senderId,
        text,
        currentState,
        MSGS,
        via: 'text_regex',
      });
      return;
    }

    // ══════════════════════════════════════════════════════════
    // 🔍 CONSULTA DE CITAS POR TEXTO ("¿qué citas tengo?")
    // Determinista y antes del LLM: con el menú abierto el texto ni llega al
    // LLM, y la regla local de "quiere agendar" veía «citas» y re-mostraba el
    // menú. La voz y las paráfrasis se atienden tras el LLM (isLookup).
    // ══════════════════════════════════════════════════════════
    if (
      messageType === 'text' &&
      LOOKUP_ENTRY_STATES.includes(currentState) &&
      this.esConsultaDeCitas(text)
    ) {
      await this.startLookupFlow({
        organizationId,
        senderId,
        identity,
        text,
        isAudio: false,
        cedula: this.cedulaEnTexto(text),
        MSGS,
        via: 'text_regex',
      });
      return;
    }

    // Determinación de `aiData` del turno: init + cadena de extracción
    // (quick-flags; primer turno / no-estricto → LLM; audio → STT con adopción
    // de transcripción; cédula → dígitos; nombre tal cual; menú → sin LLM).
    // Ver resolveTurnData. Puede actualizar `text` (transcripción adoptada).
    const turn = await this.resolveTurnData({
      organizationId,
      senderId,
      text,
      messageType,
      currentState,
      isAudio,
      audioId,
      isStrictStep,
      isQuickCancel,
      isQuickModify,
      isQuickEscape,
    });
    let aiData = turn.aiData;
    text = turn.text;

    this.logger.log(`🧠 LLM extrajo: ${JSON.stringify(aiData)}`);

    // 🪪 La cédula que escribió en este mensaje se recuerda unos minutos: si
    // enseguida pide cancelar o cambiar la fecha, no se le vuelve a pedir.
    if (aiData.cedula && esDocumentoValido(normalizeDocumento(aiData.cedula))) {
      await this.redis.set(
        `cedula_reciente:${organizationId}:${senderId}`,
        normalizeDocumento(aiData.cedula),
        'EX',
        CEDULA_RECIENTE_TTL,
      );
    }

    // 🚑 GUARDRAIL POST-LLM: EMERGENCIA EN AUDIO O PARÁFRASIS ──────────
    // Defensa en profundidad sobre el guardrail regex pre-LLM (que solo ve
    // TEXTO): (a) el flag isEmergency de la Tarea D captura paráfrasis que
    // el diccionario [emergency] no enumera ("siento una presión horrible
    // aquí en el corazón"); (b) el regex sobre `text` —que a esta altura ya
    // es la TRANSCRIPCIÓN adoptada si el turno fue audio— cubre la nota de
    // voz aunque el LLM no marque el flag (Boolean(parsed.isEmergency) es
    // fail-open hacia false). Se evalúa ANTES que goodbye/cédula/menús y
    // que el INTENT ROUTER (insultos/FAQ): la emergencia siempre gana,
    // incluso si el intent fue "agendar_cita".
    if (aiData.isEmergency || this.isEmergencyText(text)) {
      await this.escalateEmergency({
        organizationId,
        senderId,
        org,
        MSGS,
        text,
        currentState,
        via: aiData.isEmergency
          ? 'EMERGENCY_LLM'
          : 'EMERGENCY_TRANSCRIPT_REGEX',
      });
      return;
    }

    // 💬 Respuesta al recordatorio POR VOZ (2026-10-16): «confirmo mi asistencia»,
    // «no puedo ir», «¿dónde es?» dichos en una nota de voz. El atajo de arriba
    // solo ve TEXTO; aquí ya está adoptada la transcripción. Sin esto, un paciente
    // que confirmó por audio recibió «en este momento no es posible agendar citas».
    if (
      isAudio &&
      !!text &&
      currentState === ChatState.IDLE &&
      (await this.atenderRespuestaAlBot({
        organizationId,
        senderId,
        identity,
        text,
        MSGS,
        botName,
        orgName,
        org,
        operaciones,
        timeZone: org?.timezone || undefined,
      }).catch((error: unknown) => {
        this.logger.error(
          `Respuesta al bot por voz falló (org ${organizationId}): ${getErrorMessage(error)}`,
        );
        return false;
      }))
    ) {
      return;
    }

    // 🙏 Un agradecimiento por VOZ en reposo: la misma despedida que por texto.
    if (
      isAudio &&
      !!text &&
      currentState === ChatState.IDLE &&
      esAgradecimiento(text)
    ) {
      const reply = MSGS.despedidaCorta();
      await this.smartReply(organizationId, senderId, reply);
      await this.auditSuccess(senderId, organizationId, {
        userMessage: text,
        botReply: reply,
        metadata: { step: 'FAREWELL', via: 'AUDIO' },
      });
      return;
    }

    // ══════════════════════════════════════════════════════════
    // 👋 CIERRE DE LA CONVERSACIÓN POR VOZ (diccionario [goodbye])
    // ──────────────────────────────────────────────────────────
    // Paridad voz↔texto: el TEXTO ya se atendió en el early-return de arriba;
    // aquí cubrimos el AUDIO, una vez adoptada la transcripción como `text`.
    // El paciente quiere TERMINAR ("chao", "no quiero agendar", "hasta luego").
    // Match EXACTO normalizado → no colisiona con SÍ/NO; aun así excluimos los
    // pasos de selección por letra por defensa en profundidad. Cierra cordial
    // (despedidaCorta) y resetea la sesión, sin reabrir el flujo (≠ escape).
    if (isAudio && !isLetterSelectionStep && this.matchesGoodbye(text)) {
      await this.handleGoodbye({
        organizationId,
        senderId,
        text,
        currentState,
        MSGS,
      });
      return;
    }

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
        currentState === ChatState.AWAITING_MODIFY_CEDULA ||
        currentState === ChatState.AWAITING_LOOKUP_CEDULA)
    ) {
      const stop = await this.normalizeVoiceCedula({
        aiData,
        text,
        organizationId,
        senderId,
        currentState,
        retriesCount,
        retriesKey,
        maxRetries,
        MSGS,
      });
      if (stop) return;
    }

    // ══════════════════════════════════════════════════════════
    // 🎙️ SELECCIÓN POR VOZ — PARIDAD CON TEXTO EN PASOS DE LETRA
    // ──────────────────────────────────────────────────────────
    // En los pasos de selección por letra (elegir horario/cita de un listado),
    // el TEXTO no llama al LLM (isStrictStep) → su `intent` queda en 'otro' y
    // fluye directo al switch. La VOZ, en cambio, pasó por el extractor para
    // transcribirse y pudo recibir un `intent` que dispararía los routers de
    // cancelación/modificación/FAQ ANTES del switch, perdiendo el turno.
    //
    // Cuando la transcripción SÍ contiene una letra válida, la adoptamos como
    // `text` y neutralizamos los flags de intención para que el audio recorra
    // EXACTAMENTE el mismo camino determinista que el texto. Si NO hay letra
    // (p.ej. "mejor cancela"), dejamos pasar el intent del LLM tal cual.
    if (isAudio && isLetterSelectionStep) {
      text = this.applyVoiceLetterSelection(
        text,
        aiData,
        organizationId,
        senderId,
        currentState,
      );
    }

    // ══════════════════════════════════════════════════════════
    // 🎙️ SÍ/NO POR VOZ — PARIDAD CON TEXTO EN PASOS DE CONFIRMACIÓN
    // ──────────────────────────────────────────────────────────
    // Mismo razonamiento que el bloque de letras de arriba, aplicado a los
    // pasos SÍ/NO (confirmar cita, confirmar cancelación, confirmar
    // reprogramación, lista de espera...). Ver applyVoiceYesNoAnswer.
    if (isAudio && isYesNoStep) {
      this.applyVoiceYesNoAnswer(
        text,
        aiData,
        organizationId,
        senderId,
        currentState,
      );
    }

    // Contador de fallos LLM / fallback (ver handleLlmFallback). Si la IA está
    // caída tras varios fallos, el helper ya respondió mantenimiento y pide
    // detener el turno (stop). En otro caso devuelve el aiData (posiblemente
    // sustituido por el fallback simple).
    const fb = await this.handleLlmFallback({
      aiData,
      text,
      organizationId,
      senderId,
      currentState,
      org,
      MSGS,
    });
    if (fb.stop) return;
    aiData = fb.aiData;

    // 🧲 ESCENARIO 2 (paridad de VOZ): por texto la interrupción amable ya se
    // interceptó arriba con `cancelRegex` (antes de gastar una llamada al LLM).
    // Por voz la intención solo se conoce tras transcribir, así que el chequeo
    // se repite aquí, ANTES del router de cancelación, para que el paciente
    // confirme en vez de perder su agendamiento en curso. Los pasos de letra y
    // de SÍ/NO ya neutralizaron `isCancellation` si la voz resolvió a una
    // opción concreta, así que aquí solo entran intenciones reales.
    if (
      isAudio &&
      aiData.isCancellation &&
      operaciones.cancelar &&
      SCHEDULING_FLOW_STATES.includes(currentState)
    ) {
      await this.promptSchedulingInterrupt({
        organizationId,
        senderId,
        text,
        currentState,
        MSGS,
        via: 'voice_llm',
      });
      return;
    }

    // 🔔 BAJA (o alta) DE RECORDATORIOS — docs/PLAN_ALTA_EN_CALIENTE.md, D2.
    // Va ANTES de las demás intenciones: «no quiero más recordatorios» no es una
    // cancelación de cita, y confundirlas le cancelaría la cita a quien solo pidió
    // que dejáramos de escribirle. Se decide con frases fijas, sin LLM: es una
    // decisión sobre sus datos y no puede quedar a interpretación.
    const recordatorios = this.intencionDeRecordatorios(text ?? null);
    if (recordatorios) {
      await this.handleRecordatorios({
        organizationId,
        senderId,
        text: text ?? null,
        activar: recordatorios === 'ACTIVAR',
        MSGS,
      });
      return;
    }

    // 🔒 Cancelar o cambiar una cita con su interruptor apagado: no se abre el
    // flujo; el aviso dice con quién comunicarse y qué sí se puede por aquí. Va
    // después de la baja de recordatorios, que no es una operación sobre la
    // cita y sigue funcionando. Si el paciente pide las dos cosas, manda
    // cancelar, igual que el router de abajo.
    const pideCancelar = aiData.isCancellation || isQuickCancel;
    const pideModificar = aiData.isModification || isQuickModify;
    if (pideCancelar || pideModificar) {
      const motivo: OperacionBot = pideCancelar ? 'CANCELAR' : 'MODIFICAR';
      if (!operaciones[CLAVE_OPERACION[motivo]]) {
        // 📋 Antes del «no es posible por aquí»: si tiene una cita, el aviso le
        // queda al personal (la suya, o la de otro servicio que AgenIA no toca).
        // Caso real 2026-10-16: «me encuentro enferma… ¿me la pueden poner para
        // más tarde?» recibía solo el teléfono y nadie en el hospital se enteraba.
        const pide = motivo === 'CANCELAR' ? 'CANCELAR' : 'MODIFICAR';
        const delAviso = {
          organizationId,
          senderId,
          identity,
          text: text || '[audio]',
          MSGS,
          org,
          operaciones,
          pide,
        } as const;
        const avisado =
          currentState === ChatState.IDLE &&
          (await (async () =>
            (await this.atenderAvisoDelPaciente(delAviso, pide)) ||
            (await this.avisarSiSoloTieneCitasFueraDelAlcance(
              delAviso,
            )))().catch((error: unknown) => {
            this.logger.error(
              `Aviso del paciente falló (org ${organizationId}): ${getErrorMessage(error)}`,
            );
            return false;
          }));
        if (avisado) return;
        await this.responderOperacionNoDisponible({
          organizationId,
          senderId,
          text,
          org,
          orgName,
          botName,
          MSGS,
          motivo,
          operaciones,
        });
        return;
      }
    }

    if (aiData.isCancellation || isQuickCancel) {
      await this.startCancellationFlow({
        organizationId,
        senderId,
        isAudio,
        aiData,
        text,
        MSGS,
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
      await this.startModificationFlow({
        organizationId,
        senderId,
        isAudio,
        aiData,
        text,
        MSGS,
      });
      return;
    }

    // 🔍 Consulta de citas por VOZ o por paráfrasis que solo el LLM reconoce.
    if (
      LOOKUP_ENTRY_STATES.includes(currentState) &&
      (aiData.isLookup || (isAudio && this.esConsultaDeCitas(text)))
    ) {
      await this.startLookupFlow({
        organizationId,
        senderId,
        identity,
        text,
        isAudio,
        cedula: aiData.cedula,
        MSGS,
        via: aiData.isLookup ? 'llm' : 'voice_regex',
      });
      return;
    }

    if (aiData.isEscape) {
      await this.handleEscape({
        organizationId,
        senderId,
        text,
        currentState,
        MSGS,
        orgName,
        botName,
        org,
        operaciones,
      });
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

        await this.auditLog(senderId, organizationId, {
          status: InteractionStatus.ABANDONED,
          failureReason: FailureReason.OUT_OF_CONTEXT,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: { guardrail: 'INSULT_LLM', previousState: currentState },
        });

        // ⭐ CSAT: cierre por lenguaje abusivo (detección LLM).
        await this.sendSurveyLink(
          organizationId,
          senderId,
          ResolutionStatus.BLOCKED_INSULT,
          {
            chatSummary: 'Sesión cerrada por insulto detectado (LLM).',
          },
        );
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

    // En los pasos SÍ/NO (waitlist + confirmación de cita) con una respuesta
    // usable (texto o transcripción de voz), saltamos los guardas de
    // outOfContext/ininteligible: el LLM tiende a marcar un "sí"/"no" suelto
    // como fuera de contexto y bloquearía el turno.
    const yesNoVoiceAnswer = isYesNoStep && !!text && !!text.trim();

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

    if (aiData.outOfContext && !yesNoVoiceAnswer && !menuVoiceAnswer) {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      // Con agendar apagado no se invita a agendar («¿qué servicio busca?»
      // contradecía el aviso de que por aquí no se agenda): se dice qué sí se
      // puede y con quién hacer lo demás.
      const reply = operaciones.agendar
        ? MSGS.outOfContext(botName)
        : MSGS.outOfContextSinAgendar(
            botName,
            this.lineasDeLoDisponible(MSGS, operaciones),
            org?.supportPhone
              ? MSGS.contactoClinica(org.supportPhone)
              : MSGS.contactoClinicaSinTelefono(),
          );
      await this.smartReply(organizationId, senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.OUT_OF_CONTEXT,
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: { retriesCount: retriesCount + 1 },
      });
      return;
    }

    if (aiData.ininteligible && !yesNoVoiceAnswer && !menuVoiceAnswer) {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.ininteligible();
      await this.smartReply(organizationId, senderId, reply);

      await this.auditFailure(senderId, organizationId, {
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

    // 🔒 SIN AGENDAR: lo que llega aquí en IDLE termina en la cascada de
    // agendamiento (ACK del primer turno, menú de servicios...). Con agendar
    // apagado se responde el aviso en su lugar. La consulta, las FAQ, la
    // despedida, los guardrails, cancelar y cambiar ya se atendieron arriba;
    // los pasos de la consulta (cédula, opción) siguen a sus handlers.
    if (!operaciones.agendar && currentState === ChatState.IDLE) {
      await this.responderOperacionNoDisponible({
        organizationId,
        senderId,
        text,
        org,
        orgName,
        botName,
        MSGS,
        motivo: 'AGENDAR',
        operaciones,
      });
      return;
    }

    if (currentState === ChatState.AWAITING_WAITLIST_CONFIRM) {
      await this.handleWaitlistConfirmStep(organizationId, senderId, text);
      return;
    }

    // ══════════════════════════════════════════════════════════
    // MEMORIA A CORTO PLAZO (cascada de contexto)
    // ══════════════════════════════════════════════════════════
    const savedCedula = await this.redis.get(
      `temp_cedula:${organizationId}:${senderId}`,
    );
    const savedNombre = await this.redis.get(
      `temp_nombre:${organizationId}:${senderId}`,
    );
    const savedEspecialidad = await this.redis.get(
      `temp_especialidad:${organizationId}:${senderId}`,
    );
    const savedEspecialidadId = await this.redis.get(
      `temp_especialidad_id:${organizationId}:${senderId}`,
    );
    const savedDoctor = await this.redis.get(
      `temp_doctor:${organizationId}:${senderId}`,
    );
    const savedEps = await this.redis.get(
      `temp_eps_query:${organizationId}:${senderId}`,
    );
    // Preferencia de fecha ("mañana", "el lunes"): el paciente puede decirla en
    // cualquier turno, pero la cascada servicio→EPS→slots abarca varios. La
    // persistimos para que sobreviva hasta el momento de mostrar los cupos.
    const savedFechaPref = await this.redis.get(
      `temp_fecha_pref:${organizationId}:${senderId}`,
    );

    const finalCedula = aiData.cedula || savedCedula;
    const finalNombre = aiData.nombre || savedNombre;
    const finalEspecialidad = aiData.especialidad || savedEspecialidad;
    const finalDoctor = aiData.doctor || savedDoctor;
    const finalEps = aiData.eps || savedEps;
    const finalFechaPref = aiData.fechaSolicitada || savedFechaPref;

    if (finalCedula)
      await this.redis.set(
        `temp_cedula:${organizationId}:${senderId}`,
        finalCedula,
        'EX',
        SESSION_TTL,
      );
    if (finalNombre)
      await this.redis.set(
        `temp_nombre:${organizationId}:${senderId}`,
        finalNombre,
        'EX',
        SESSION_TTL,
      );
    // 🪪 Acaba de escribir sus NOMBRES (paso 1 de 2): los apellidos se le vuelven
    // a pedir. Unos apellidos de un intento anterior de la misma cédula se
    // saltaban el paso 2 y la ficha quedaba con nombres de un intento y
    // apellidos del otro (2026-10-23: «Diana María» en AgenIA, y al hospital los
    // nombres y apellidos que la paciente había rechazado).
    if (currentState === ChatState.AWAITING_NAME && aiData.nombre) {
      await this.redis.del(`temp_apellidos:${organizationId}:${senderId}`);
    }
    if (finalDoctor)
      await this.redis.set(
        `temp_doctor:${organizationId}:${senderId}`,
        finalDoctor,
        'EX',
        SESSION_TTL,
      );
    if (finalEps)
      await this.redis.set(
        `temp_eps_query:${organizationId}:${senderId}`,
        finalEps,
        'EX',
        SESSION_TTL,
      );
    if (finalEspecialidad)
      await this.redis.set(
        `temp_especialidad:${organizationId}:${senderId}`,
        finalEspecialidad,
        'EX',
        SESSION_TTL,
      );
    if (finalFechaPref)
      await this.redis.set(
        `temp_fecha_pref:${organizationId}:${senderId}`,
        finalFechaPref,
        'EX',
        SESSION_TTL,
      );

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
      aiData.cedula ||
      aiData.nombre ||
      aiData.eps ||
      aiData.especialidad ||
      aiData.doctor ||
      aiData.fechaSolicitada
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
          // Scoped al tenant: la misma cédula puede existir en otra clínica
          // y su nombre NO debe filtrarse en esta conversación.
          const paciente = await this.prisma.patientProfile.findFirst({
            where: { cedula: aiData.cedula, organizationId },
            select: { fullName: true },
          });
          cedulaAck = aiData.cedula;
          if (paciente?.fullName) {
            nombreAck = nombreAck || paciente.fullName;
            // El paciente ya existe → no volver a pedir el nombre más adelante.
            await this.redis.set(
              `temp_nombre:${organizationId}:${senderId}`,
              paciente.fullName,
              'EX',
              SESSION_TTL,
            );
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
        botName,
        clinicaName: orgName,
      });
      await this.smartReply(organizationId, senderId, ack);
      sentTurn1Ack = true;
      // El ACK ya trae la presentación («Le saluda…»).
      await this.redis.set(
        this.presentadoKey(organizationId, senderId),
        '1',
        'EX',
        PRESENTACION_TTL,
      );

      await this.auditSuccess(senderId, organizationId, {
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
      currentState === ChatState.AWAITING_CANCEL_RETRY_CEDULA ||
      currentState === ChatState.AWAITING_CANCEL_SELECTION ||
      currentState === ChatState.AWAITING_CANCEL_CONFIRM;

    // El flujo de reprogramación tiene su propia máquina de estados (switch) y
    // NO debe pasar por la cascada de agendamiento (servicio→EPS→slots).
    const isModifyFlow =
      currentState === ChatState.AWAITING_MODIFY_CEDULA ||
      currentState === ChatState.AWAITING_MODIFY_RETRY_CEDULA ||
      currentState === ChatState.AWAITING_MODIFY_SELECTION ||
      currentState === ChatState.AWAITING_MODIFY_NEW_SLOT ||
      currentState === ChatState.AWAITING_MODIFY_CONFIRM ||
      currentState === ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL;

    // La consulta de citas tampoco pasa por la cascada: su paso de cédula lo
    // atiende su handler (el de elegir A-D ya es un paso estricto).
    const isLookupFlow = currentState === ChatState.AWAITING_LOOKUP_CEDULA;

    // ══════════════════════════════════════════════════════════
    // FLUJO PRINCIPAL DE AGENDAMIENTO (pasos no-estrictos)
    // ══════════════════════════════════════════════════════════
    if (!isStrictStep && !isCancelFlow && !isModifyFlow && !isLookupFlow) {
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
      const waitlistPending = await this.redis.get(
        `temp_waitlist_pending:${organizationId}:${senderId}`,
      );
      if (waitlistPending === '1' && finalCedula) {
        const soloNumeros = finalCedula.replace(/\D/g, '');
        // No validamos longitud: se acepta cualquier número (solo rechazo si viene vacío).
        if (!soloNumeros) {
          await this.redis.set(
            retriesKey,
            (retriesCount + 1).toString(),
            'EX',
            SESSION_TTL,
          );
          await this.redis.del(`temp_cedula:${organizationId}:${senderId}`);
          const reply = MSGS.cancelarCedulaInvalida();
          await this.smartReply(organizationId, senderId, reply);

          await this.auditFailure(senderId, organizationId, {
            reason: FailureReason.PATIENT_NOT_FOUND,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              stage: 'WAITLIST_OPTIN_CEDULA_INVALID',
              cedula: finalCedula,
            },
          });
          return;
        }

        const serviceIdWl = await this.redis.get(
          `temp_waitlist_service_id:${organizationId}:${senderId}`,
        );
        const epsIdRawWl = await this.redis.get(
          `temp_waitlist_eps_id:${organizationId}:${senderId}`,
        );
        const epsIdForWl =
          epsIdRawWl && epsIdRawWl.length > 0 ? epsIdRawWl : null;
        const preferredDoctorIdWl =
          (await this.redis.get(
            `temp_waitlist_doctor_id:${organizationId}:${senderId}`,
          )) || null;
        const serviceNameWl =
          (await this.redis.get(
            `temp_especialidad:${organizationId}:${senderId}`,
          )) || '';

        if (!serviceIdWl) {
          const reply = MSGS.sesionExpirada();
          await this.smartReply(organizationId, senderId, reply);
          await this.cleanUpSession(organizationId, senderId);
          return;
        }

        // 🪪 PADRÓN EPS: entrar a la cola por EPS también exige estar de alta
        // (la cola termina reservando un cupo de esa EPS al liberarse).
        if (
          await this.rejectIfNotEnrolledInEps({
            organizationId,
            senderId,
            cedula: soloNumeros,
            epsId: epsIdForWl,
            MSGS,
            userMessage: text,
          })
        ) {
          return;
        }

        // Si el paciente NO está registrado EN ESTA CLÍNICA y no nos dio
        // nombre, pedirlo (la cédula es única por organización).
        const existing = await this.prisma.patientProfile.findFirst({
          where: { cedula: finalCedula, organizationId },
        });
        if (!existing && !finalNombre) {
          // Aquí se pide el nombre COMPLETO de una vez: la lista de espera no
          // llega al HIS, así que no necesita la frontera nombres/apellidos y
          // no tiene sentido cobrarle al paciente un turno más.
          const reply = MSGS.nombreParaLista();
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(
            organizationId,
            senderId,
            ChatState.AWAITING_NAME,
          );

          await this.auditSuccess(senderId, organizationId, {
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
          identity,
          organizationId: organizationId,
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
              organizationId: organizationId,
              preferredDoctorId: preferredDoctorIdWl,
            });
            positionWl = result.position;
            wlEntryId = result.id || null;
          } catch (e: unknown) {
            this.logger.error(
              `Error joinWaitlist (post-cedula): ${getErrorMessage(e)}`,
            );
          }
        }

        const replyOk = MSGS.unidoAWaitlist(
          nombreFinalWl,
          serviceNameWl,
          positionWl,
        );
        await this.smartReply(organizationId, senderId, replyOk);

        if (wlEntryId && patientWl) {
          await this.interactionLog.logWaitlistJoined({
            whatsappId: senderId,
            organizationId: organizationId,
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
        await this.sendSurveyLink(
          organizationId,
          senderId,
          ResolutionStatus.QUEUED,
          {
            patientId: patientWl?.id ?? null,
            chatSummary: `Ingresó a lista de espera de ${serviceNameWl} (posición ${positionWl}).`,
          },
        );

        await this.cleanUpSession(organizationId, senderId);
        return;
      }

      // ── PASO 1: SERVICIO ─────────────────────────────────────
      let resolvedServiceId = savedEspecialidadId;
      let resolvedServiceName = savedEspecialidad;

      if (!resolvedServiceId) {
        // ¿Podemos resolverlo del input actual o de aiData?
        const inputForService =
          currentState === ChatState.AWAITING_SPECIALTY ? text : null;
        const match = await this.resolveServiceFromInput(
          organizationId,
          senderId,
          inputForService ?? null,
          finalEspecialidad || finalDoctor,
        );

        if (match) {
          resolvedServiceId = match.id;
          resolvedServiceName = match.name;
          await this.redis.set(
            `temp_especialidad:${organizationId}:${senderId}`,
            match.name,
            'EX',
            SESSION_TTL,
          );
          await this.redis.set(
            `temp_especialidad_id:${organizationId}:${senderId}`,
            match.id,
            'EX',
            SESSION_TTL,
          );
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
          // 🦷 ¿Pidió un servicio que no se agenda por el asistente
          // («Odontología», «Ecografía Doppler…», 2026-10-23)? No es un error
          // suyo: se le dice con quién comunicarse y se le deja el menú, SIN
          // penalizar reintentos (antes: tres «no logré interpretar» y
          // «demasiados intentos»).
          {
            const menu = await this.buildServiceMenu(organizationId, senderId);
            const pedido =
              menu.count > 0 ? servicioQueNoSeAgenda(text, menu.nombres) : null;
            if (pedido) {
              const reply = MSGS.servicioNoSeAgendaPorAqui(
                pedido,
                this.contactoDe(MSGS, org),
                menu.lineas,
              );
              await this.smartReply(organizationId, senderId, reply);
              await this.auditSuccess(senderId, organizationId, {
                userMessage: text || '[audio]',
                botReply: reply,
                metadata: { step: 'SERVICIO_NO_AGENDABLE', pedido },
              });
              return;
            }
          }
          // ¿El paciente confirma que quiere agendar (ej: "sí quiero agendar
          // una cita")? No es una opción del menú, pero tampoco un error: le
          // re-presentamos el menú con calidez y SIN penalizar reintentos.
          if (this.looksLikeScheduleIntent(text)) {
            const { lineas, count } = await this.buildServiceMenu(
              organizationId,
              senderId,
            );
            const reply =
              count > 0
                ? MSGS.repromptAgendarServicio(lineas)
                : MSGS.bienvenida(
                    orgName,
                    'Ej: Medicina General, Odontología',
                    botName,
                  );
            await this.smartReply(organizationId, senderId, reply);

            await this.auditSuccess(senderId, organizationId, {
              userMessage: text || '[audio]',
              botReply: reply,
              metadata: {
                step: 'SPECIALTY_REPROMPT_SCHEDULE_INTENT',
                servicesCount: count,
              },
            });
            return;
          }
          // El usuario respondió algo que no pudimos mapear al menú → reintento
          await this.redis.set(
            retriesKey,
            (retriesCount + 1).toString(),
            'EX',
            SESSION_TTL,
          );
          const { lineas, count } = await this.buildServiceMenu(
            organizationId,
            senderId,
          );
          const reply =
            count > 0
              ? MSGS.servicioInvalido(lineas)
              : MSGS.bienvenida(
                  orgName,
                  'Ej: Medicina General, Odontología',
                  botName,
                );
          await this.smartReply(organizationId, senderId, reply);

          await this.auditFailure(senderId, organizationId, {
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
        const { lineas, count } = await this.buildServiceMenu(
          organizationId,
          senderId,
        );
        // Si acabamos de enviar el ACK del primer turno, usamos el reprompt
        // (que NO vuelve a saludar) en vez de la bienvenida completa, para no
        // mandar dos saludos seguidos en el mismo turno.
        const reply =
          count > 0
            ? sentTurn1Ack
              ? MSGS.repromptAgendarServicio(lineas)
              : await this.menuServiciosPresentandose({
                  organizationId,
                  senderId,
                  MSGS,
                  orgName,
                  botName,
                  lineas,
                })
            : MSGS.bienvenida(
                orgName,
                'Ej: Medicina General, Odontología',
                botName,
              );
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(
          organizationId,
          senderId,
          ChatState.AWAITING_SPECIALTY,
        );

        await this.auditSuccess(senderId, organizationId, {
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
      let resolvedEpsId = await this.redis.get(
        `temp_eps_id:${organizationId}:${senderId}`,
      );
      let resolvedEpsName = await this.redis.get(
        `temp_eps_query:${organizationId}:${senderId}`,
      );

      if (!resolvedEpsId || !resolvedEpsName) {
        const inputForEps =
          currentState === ChatState.AWAITING_EPS ? text : null;

        // ¿Contesta a «su EPS no está disponible, ¿desea una cita particular?»?
        // SÍ → sigue como Particular en este mismo turno; NO → se despide. Otra
        // cosa (una letra del menú, otra EPS) se resuelve como siempre.
        const ofertaPendiente =
          currentState === ChatState.AWAITING_EPS
            ? await this.redis.get(
                this.ofertaParticularKey(organizationId, senderId),
              )
            : null;
        if (ofertaPendiente) {
          await this.redis.del(
            this.ofertaParticularKey(organizationId, senderId),
          );
        }
        const respuestaOferta = ofertaPendiente
          ? this.interpretYesNo(text)
          : null;
        if (respuestaOferta === 'NO') {
          const reply = MSGS.epsNoDisponibleDespedida();
          await this.smartReply(organizationId, senderId, reply);
          await this.auditLog(senderId, organizationId, {
            status: InteractionStatus.ESCAPED,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              event: 'EPS_NO_DISPONIBLE_PARTICULAR_RECHAZADA',
              eps: ofertaPendiente,
            },
          });
          await this.cleanUpSession(organizationId, senderId);
          return;
        }

        const match =
          respuestaOferta === 'SI'
            ? await this.ensureParticularEpsForOrg(organizationId)
            : await this.resolveEpsFromInput(
                organizationId,
                senderId,
                inputForEps ?? null,
                finalEps,
              );

        if (match === 'AMBIGUA') {
          const { lineas } = await this.buildEpsMenu(organizationId, senderId);
          const reply = MSGS.epsParticularOEps(lineas);
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(
            organizationId,
            senderId,
            ChatState.AWAITING_EPS,
          );
          await this.auditSuccess(senderId, organizationId, {
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: { step: 'EPS_PARTICULAR_O_EPS_ACLARAR' },
          });
          return;
        }
        if (match) {
          resolvedEpsId = match.id;
          resolvedEpsName = match.name;
          await this.redis.set(
            `temp_eps_id:${organizationId}:${senderId}`,
            match.id,
            'EX',
            SESSION_TTL,
          );
          await this.redis.set(
            `temp_eps_query:${organizationId}:${senderId}`,
            match.name,
            'EX',
            SESSION_TTL,
          );
        } else if (currentState === ChatState.AWAITING_EPS && text) {
          // Nombró una EPS real que esta clínica no atiende: repetirle el menú
          // solo gasta reintentos. Se le dice, y se le ofrece la cita particular.
          // Va antes que la FAQ: «¿atienden Coomeva?» se contesta justo así.
          const noDisponible = await this.epsNoDisponible(
            organizationId,
            text,
            finalEps,
          );
          if (noDisponible?.atendida) {
            await this.responderEpsSoloPorTelefono(
              organizationId,
              senderId,
              noDisponible.nombre,
              MSGS,
              text,
            );
            return;
          }
          if (noDisponible) {
            await this.ofrecerParticular(
              organizationId,
              senderId,
              noDisponible.nombre,
              MSGS,
              text,
            );
            return;
          }
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
            const { lineas, count } = await this.buildEpsMenu(
              organizationId,
              senderId,
            );
            const reply =
              count > 0 ? MSGS.repromptAgendarEps(lineas) : MSGS.pedirEps();
            await this.smartReply(organizationId, senderId, reply);

            await this.auditSuccess(senderId, organizationId, {
              userMessage: text || '[audio]',
              botReply: reply,
              metadata: {
                step: 'EPS_REPROMPT_SCHEDULE_INTENT',
                epsCount: count,
              },
            });
            return;
          }
          // El usuario respondió algo no mapeable al menú → reintento
          await this.redis.set(
            retriesKey,
            (retriesCount + 1).toString(),
            'EX',
            SESSION_TTL,
          );
          const { lineas, count } = await this.buildEpsMenu(
            organizationId,
            senderId,
          );
          const reply = count > 0 ? MSGS.epsInvalida(lineas) : MSGS.pedirEps();
          await this.smartReply(organizationId, senderId, reply);

          await this.auditFailure(senderId, organizationId, {
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
        // La EPS vino en un mensaje anterior («quiero cita con Coomeva»): si no la
        // atendemos, se dice ya, sin pasar por el menú.
        if (currentState !== ChatState.AWAITING_EPS) {
          const noDisponible = await this.epsNoDisponible(
            organizationId,
            null,
            finalEps,
          );
          if (noDisponible?.atendida) {
            await this.responderEpsSoloPorTelefono(
              organizationId,
              senderId,
              noDisponible.nombre,
              MSGS,
              text,
            );
            return;
          }
          if (noDisponible) {
            await this.ofrecerParticular(
              organizationId,
              senderId,
              noDisponible.nombre,
              MSGS,
              text,
            );
            return;
          }
        }
        const { lineas, count } = await this.buildEpsMenu(
          organizationId,
          senderId,
        );
        const reply =
          count > 0
            ? MSGS.menuEps(resolvedServiceName!, lineas)
            : MSGS.pedirEps();
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(
          organizationId,
          senderId,
          ChatState.AWAITING_EPS,
        );

        await this.auditSuccess(senderId, organizationId, {
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
        (resolvedEpsName || '').toLowerCase() ===
        PARTICULAR_EPS_NAME.toLowerCase();
      const epsIdForSlots: string | null = isParticular ? null : resolvedEpsId;
      const epsIdForPatient: string | null = isParticular
        ? null
        : resolvedEpsId;

      // ── PASO 3: SLOTS o WAITLIST OPT-IN ──────────────────────
      const selectedSlotId = await this.redis.get(
        `temp_selected_slot_id:${organizationId}:${senderId}`,
      );

      if (!selectedSlotId) {
        // ── Preferencia de fecha ("mañana", "el lunes"...) ──────
        // Si el paciente pidió una fecha y se reconoce, filtramos los cupos a
        // esa ventana. Tres resultados posibles:
        //   • hay cupos ese día            → menú "para <fecha>"
        //   • no ese día pero sí próximos  → fallback suave con los próximos
        //   • ninguno (ni próximos)        → waitlist (conducta actual)
        // Si la frase no se reconoce (null), todo se comporta como siempre.
        const fechaPrefRaw = await this.redis.get(
          `temp_fecha_pref:${organizationId}:${senderId}`,
        );
        const ventana = parseFechaPreferida(fechaPrefRaw);

        let slots: AvailableSlot[];
        let slotsMode: 'normal' | 'fecha' | 'fallback' = 'normal';
        if (ventana) {
          slots = await this.appointmentsService.getAvailableSlots(
            resolvedServiceName as string,
            epsIdForSlots,
            organizationId,
            { desde: ventana.desde, hasta: ventana.hasta },
          );
          if (slots.length > 0) {
            slotsMode = 'fecha';
          } else {
            // Sin cupos en la fecha pedida: ofrecemos los más próximos.
            slots = await this.appointmentsService.getAvailableSlots(
              resolvedServiceName as string,
              epsIdForSlots,
              organizationId,
            );
            if (slots.length > 0) slotsMode = 'fallback';
          }
        } else {
          slots = await this.appointmentsService.getAvailableSlots(
            resolvedServiceName as string,
            epsIdForSlots,
            organizationId,
          );
        }

        if (slots.length === 0) {
          // Guardar contexto para que AWAITING_WAITLIST_OPTIN sepa qué hacer.
          await this.redis.set(
            `temp_waitlist_service_id:${organizationId}:${senderId}`,
            resolvedServiceId,
            'EX',
            SESSION_TTL,
          );
          await this.redis.set(
            `temp_waitlist_eps_id:${organizationId}:${senderId}`,
            epsIdForPatient || '',
            'EX',
            SESSION_TTL,
          );

          // Médico preferido (si el paciente lo mencionó): nombre libre → id inequívoco.
          const preferredDoctorIdForWl = await this.resolvePreferredDoctorId(
            organizationId,
            resolvedServiceId,
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
            await this.redis.del(
              `temp_waitlist_doctor_id:${organizationId}:${senderId}`,
            );
          }

          // 🗓️ ¿Es el plazo máximo para agendar, y no una agenda llena? Entonces
          // se le dice hasta cuándo se agenda y desde cuándo escribir; la lista
          // de espera se le ofrece igual (2026-10-23).
          const masAlla = await this.cupoMasAllaDelPlazo(
            resolvedServiceName as string,
            epsIdForSlots,
            organizationId,
          );
          const reply = masAlla
            ? MSGS.sinCuposEnElPlazo(
                resolvedServiceName as string,
                resolvedEpsName,
                masAlla.hasta,
                masAlla.desde,
              )
            : MSGS.preguntaWaitlist(
                resolvedServiceName as string,
                resolvedEpsName,
              );
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(
            organizationId,
            senderId,
            ChatState.AWAITING_WAITLIST_OPTIN,
          );

          await this.auditSuccess(senderId, organizationId, {
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              step: 'WAITLIST_OPTIN_OFFERED',
              service: resolvedServiceName,
              eps: resolvedEpsName,
              ...(masAlla ? { porPlazo: true, desde: masAlla.desdeIso } : {}),
            },
          });
          return;
        }

        const isVoiceTurn =
          (await this.redis.get(`is_ai_flow:${organizationId}:${senderId}`)) ===
          'true';

        // ── Match por voz "día + hora" ("la quiero mañana a las 3") ──
        // Solo cuando los cupos ya están acotados al día pedido (slotsMode
        // 'fecha') y el turno vino por voz. Si la hora casa con UN único cupo,
        // saltamos el menú y vamos directo a la confirmación (el resumen
        // existente pide el SÍ/NO). Si es ambiguo o no casa, cae al menú y la
        // voz lee las opciones más próximas (abajo).
        if (isVoiceTurn && slotsMode === 'fecha') {
          const horaPref =
            parseHoraPreferida(aiData.transcript ?? text ?? null) ??
            parseHoraPreferida(fechaPrefRaw);
          if (horaPref && ventana) {
            // Contra TODOS los cupos del día, no solo los que se ofrecen en el
            // menú (mitad mañana, mitad tarde): "a las 3" puede existir aunque
            // no esté entre los ofrecidos.
            const delDia = await this.appointmentsService.getAvailableSlots(
              resolvedServiceName as string,
              epsIdForSlots,
              organizationId,
              { desde: ventana.desde, hasta: ventana.hasta },
              { todos: true },
            );
            const matches = delDia.filter((s) =>
              matchesHora(s.fecha, horaPref),
            );
            if (matches.length === 1) {
              await this.advanceAfterSlotSelected({
                organizationId,
                senderId,
                slotId: matches[0].slotId,
                slotFechaStr: matches[0].fecha.toISOString(),
                MSGS,
                userMessage: text,
                via: 'voice_datetime',
              });
              return;
            }
          }
        }

        // Hay slots: mostrar menú con letras y pedir selección.
        let lineasFechas = '';
        const slotsMetadata: {
          letter: string;
          slotId: string;
          doctor: string;
          fecha: string;
        }[] = [];
        for (let i = 0; i < slots.length; i++) {
          const letra = String.fromCharCode(65 + i);
          await this.redis.set(
            this.slotKey(organizationId, senderId, letra),
            slots[i].slotId,
            'EX',
            SESSION_TTL,
          );
          await this.redis.set(
            this.slotDateKey(organizationId, senderId, letra),
            slots[i].fecha.toISOString(),
            'EX',
            SESSION_TTL,
          );
          lineasFechas +=
            `*${letra})* ${formatAppointmentLong(slots[i].fecha)} ` +
            `· ${slots[i].doctor}\n`;
          slotsMetadata.push({
            letter: letra,
            slotId: slots[i].slotId,
            doctor: slots[i].doctor,
            fecha: slots[i].fecha.toISOString(),
          });
        }

        const fechaLabel = ventana?.label ?? '';
        let reply: string;
        if (slotsMode === 'fecha') {
          reply = MSGS.cuposParaFecha(
            resolvedEpsName,
            fechaLabel,
            lineasFechas,
          );
        } else if (slotsMode === 'fallback') {
          reply = MSGS.sinCuposEsaFechaProximos(
            fechaLabel,
            resolvedEpsName,
            lineasFechas,
          );
        } else {
          reply = MSGS.cuposDisponibles('', resolvedEpsName, lineasFechas);
        }
        // En voz: el audio LEE las próximas N opciones (env
        // VOICE_SLOTS_SPOKEN_COUNT) en lenguaje natural ("opción A, mañana a
        // las 3 de la tarde..."); el listado completo con todas las letras
        // siempre viaja por texto para que el paciente pueda revisarlo.
        const audioText = isVoiceTurn
          ? MSGS.cuposDisponiblesAudioHablado(
              resolvedEpsName,
              this.buildSpokenSlotLines(slots),
            )
          : MSGS.cuposDisponiblesAudio(resolvedEpsName);
        await this.smartReply(organizationId, senderId, reply, audioText);
        await this.setUserState(
          organizationId,
          senderId,
          ChatState.AWAITING_DATE,
        );

        await this.auditSuccess(senderId, organizationId, {
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: {
            step: 'SLOTS_OFFERED',
            slotsCount: slots.length,
            slots: slotsMetadata,
            eps: resolvedEpsName,
            specialty: resolvedServiceName,
            fechaPref: fechaLabel || undefined,
            slotsMode,
          },
        });
        return;
      }

      // ── PASO 4: CÉDULA (sólo si ya hay slot seleccionado) ────
      if (!finalCedula) {
        // Si el paciente YA estaba en el paso de cédula y su respuesta no traía
        // dígitos, esto es un reintento fallido y se contabiliza como en el
        // resto de pasos. Sin esto, `error_count` nunca subía aquí y el guard
        // de máximo de reintentos no se alcanzaba: la conversación podía
        // reciclar indefinidamente hasta que la cerrara el cron de inactividad.
        // La PRIMERA vez que pedimos la cédula (venimos de elegir cupo, con
        // otro estado) no penaliza: aún no ha tenido oportunidad de responder.
        const esReintentoDeCedula = currentState === ChatState.AWAITING_CEDULA;
        if (esReintentoDeCedula) {
          await this.redis.set(
            retriesKey,
            (retriesCount + 1).toString(),
            'EX',
            SESSION_TTL,
          );
        }

        const fechaVista = await this.redis.get(
          `temp_selected_date_view:${organizationId}:${senderId}`,
        );
        const fechaFormateada = fechaVista
          ? formatAppointmentLong(fechaVista)
          : '';
        const reply = esReintentoDeCedula
          ? MSGS.cancelarCedulaInvalida()
          : MSGS.pedirCedulaPostSlot(fechaFormateada);
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(
          organizationId,
          senderId,
          ChatState.AWAITING_CEDULA,
        );

        if (esReintentoDeCedula) {
          await this.auditFailure(senderId, organizationId, {
            reason: FailureReason.PATIENT_NOT_FOUND,
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              stage: 'BOOKING_CEDULA_MISSING_DIGITS',
              retriesCount: retriesCount + 1,
              maxRetries,
            },
          });
        } else {
          await this.auditSuccess(senderId, organizationId, {
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              step: 'ASKING_CEDULA_POST_SLOT',
              specialty: resolvedServiceName,
              eps: resolvedEpsName,
            },
          });
        }
        return;
      }

      // Validación de cédula: no validamos longitud, se acepta cualquier número
      // (solo rechazo si viene vacío/sin dígitos).
      const soloNumerosAgendamiento = finalCedula.replace(/\D/g, '');
      if (!soloNumerosAgendamiento) {
        await this.redis.set(
          retriesKey,
          (retriesCount + 1).toString(),
          'EX',
          SESSION_TTL,
        );
        await this.redis.del(`temp_cedula:${organizationId}:${senderId}`);
        const reply = MSGS.cancelarCedulaInvalida();
        await this.smartReply(organizationId, senderId, reply);

        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.PATIENT_NOT_FOUND,
          userMessage: text || '[audio]',
          botReply: reply,
          metadata: { stage: 'BOOKING_CEDULA_INVALID', cedula: finalCedula },
        });
        return;
      }

      // 🪪 PADRÓN EPS: agendar por EPS exige que la cédula esté dada de alta.
      if (
        await this.rejectIfNotEnrolledInEps({
          organizationId,
          senderId,
          cedula: soloNumerosAgendamiento,
          epsId: epsIdForPatient,
          MSGS,
          userMessage: text,
        })
      ) {
        return;
      }

      // 🚦 LÍMITE DE CITAS: con la cédula y la fecha del cupo ya se sabe si
      // este paciente puede tener otra cita ese día y ese mes. Va antes de
      // pedirle nombre, nacimiento o régimen, para no hacerlo contestar en vano.
      if (
        await this.rejectIfOverAppointmentLimit({
          organizationId,
          senderId,
          cedula: finalCedula,
          fecha: await this.redis.get(
            `temp_selected_date_view:${organizationId}:${senderId}`,
          ),
          MSGS,
          userMessage: text,
          operacion: 'BOOKING',
          servicio: resolvedServiceName,
        })
      ) {
        return;
      }

      // Cargar contexto del paciente (solo dentro del tenant actual).
      const patient = await this.prisma.patientProfile.findFirst({
        where: { cedula: finalCedula, organizationId },
        include: { eps: true },
      });

      if (patient) {
        if (!finalNombre) {
          await this.redis.set(
            `temp_nombre:${organizationId}:${senderId}`,
            patient.fullName,
            'EX',
            SESSION_TTL,
          );
        }
        // Al paciente existente ahora también se le completan nacimiento, sexo
        // y régimen desde la sesión: esos datos tienen que ser de ESTA cédula.
        // Mismo guardia que el del paciente nuevo, de abajo — sin él, el
        // régimen que dio otra persona desde este número se le pegaba a esta.
        const cedulaAltaPrevia = await this.redis.get(
          this.altaCedulaKey(organizationId, senderId),
        );
        if (cedulaAltaPrevia !== finalCedula) {
          await Promise.all([
            this.redis.del(
              this.altaKey(organizationId, senderId, 'nacimiento'),
            ),
            this.redis.del(this.altaKey(organizationId, senderId, 'sexo')),
            this.redis.del(this.altaKey(organizationId, senderId, 'regimen')),
          ]);
          await this.redis.set(
            this.altaCedulaKey(organizationId, senderId),
            finalCedula,
            'EX',
            SESSION_TTL,
          );
        }
      } else {
        // 🚨 Todo el estado temporal del alta (nombres, apellidos, nacimiento,
        // sexo, régimen) vive bajo `organizationId:senderId` — el número de
        // WhatsApp, NUNCA la cédula. Si el mismo número da de alta a una
        // SEGUNDA persona nueva (otro hijo, un familiar) antes de que esa
        // sesión expire, el código de abajo encuentra esos campos "ya
        // guardados" y se salta las preguntas — pero son los datos de la
        // primera persona, no de esta. Sin este guardia, un paciente nuevo
        // podía quedar con el apellido, la fecha de nacimiento y el sexo de
        // alguien más, en silencio, sin volver a preguntar nada.
        const cedulaAltaPrevia = await this.redis.get(
          this.altaCedulaKey(organizationId, senderId),
        );
        if (cedulaAltaPrevia && cedulaAltaPrevia !== finalCedula) {
          await Promise.all([
            this.redis.del(`temp_nombre:${organizationId}:${senderId}`),
            this.redis.del(`temp_nombres:${organizationId}:${senderId}`),
            this.redis.del(`temp_apellidos:${organizationId}:${senderId}`),
            this.redis.del(
              this.altaKey(organizationId, senderId, 'nacimiento'),
            ),
            this.redis.del(this.altaKey(organizationId, senderId, 'sexo')),
            this.redis.del(this.altaKey(organizationId, senderId, 'regimen')),
          ]);
        }
        await this.redis.set(
          this.altaCedulaKey(organizationId, senderId),
          finalCedula,
          'EX',
          SESSION_TTL,
        );

        // Paciente nuevo: pedir nombre.
        if (!finalNombre) {
          const reply = MSGS.primeraVez();
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(
            organizationId,
            senderId,
            ChatState.AWAITING_NAME,
          );

          await this.auditSuccess(senderId, organizationId, {
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: {
              step: 'ASKING_NAME_NEW_PATIENT',
              cedula: finalCedula,
            },
          });
          return;
        }

        // Paciente nuevo CON nombres: falta la segunda mitad. Los apellidos se
        // preguntan aparte porque el HIS los guarda en columnas propias, y
        // recomponer la frontera después es adivinar: "JUAN CARLOS PEREZ" es
        // un nombre y dos apellidos, o dos nombres y uno, y no hay forma de
        // saberlo. Preguntando, la frontera la pone el paciente.
        const apellidosGuardados = await this.redis.get(
          `temp_apellidos:${organizationId}:${senderId}`,
        );
        if (!apellidosGuardados) {
          await this.redis.set(
            `temp_nombres:${organizationId}:${senderId}`,
            finalNombre,
            'EX',
            SESSION_TTL,
          );
          const reply = MSGS.pedirApellidos(finalNombre);
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(
            organizationId,
            senderId,
            ChatState.AWAITING_APELLIDOS,
          );
          await this.extenderSesionDeAlta(organizationId, senderId);
          await this.auditSuccess(senderId, organizationId, {
            userMessage: text || '[audio]',
            botReply: reply,
            metadata: { step: 'ALTA_PEDIR_APELLIDOS', cedula: finalCedula },
          });
          return;
        }
      }

      // Persistencia con nombre + EPS final. Cubre ambos casos: crea al
      // paciente nuevo (arriba ya garantizamos que tenemos su nombre) y
      // completa whatsappId/EPS del que ya existía.
      // 🆕 ALTA DE PACIENTE NUEVO — datos que el HIS exige y que hasta ahora
      // el chatbot no pedía: `FE_NACI_PAC` y `NU_SEXO_PAC` son NOT NULL en
      // PACIENTES, y sin el régimen no se puede resolver el convenio de
      // facturación (la misma EPS tiene convenios distintos por régimen).
      //
      // Al paciente nuevo se le pregunta todo; al que ya existe, solo lo que
      // le falte a su ficha (ver `siguienteDatoDeAlta`). A quien la tiene
      // completa no se le pregunta nada.
      const siguiente = await this.siguienteDatoDeAlta(
        organizationId,
        senderId,
        epsIdForPatient,
        patient,
        finalCedula,
      );
      if (siguiente) {
        await this.pedirDatoDeAlta(
          organizationId,
          senderId,
          siguiente,
          MSGS,
          resolvedEpsName,
          text,
        );
        return;
      }

      // 🔒 AQUÍ NO SE GUARDA NADA DEL PACIENTE — A PROPÓSITO.
      //
      // El resumen que viene a continuación es donde el paciente lee que, al
      // responder SÍ, «autoriza el tratamiento de sus datos personales
      // —incluidos los datos sensibles de salud—» conforme a la Ley 1581 de
      // 2012. Escribir su ficha ANTES de enseñarle ese aviso es tratar sus
      // datos sin su autorización, que es justo lo que la ley ordena al revés.
      //
      // Aquí se creaba el `PatientProfile` (y su `User` temporal) con nombres,
      // apellidos, fecha de nacimiento, sexo y régimen. Se comprobó en la
      // campaña E2E del 2026-09-22: un paciente contestó todas las preguntas,
      // respondió NO a la confirmación... y su ficha completa se quedó
      // guardada igual. Dos minutos antes de que dijera que no.
      //
      // Lo capturado sigue vivo en la sesión de Redis y se persiste en la
      // confirmación, que además ya aborta con SESSION_EXPIRED si esa sesión
      // se perdió — así que no hay ventana en la que el sí llegue sin datos.
      //
      // Mostrar resumen y pasar a confirmación.
      const nombreAgend = finalNombre || patient?.fullName || 'Paciente';
      const fechaVistaFinal = await this.redis.get(
        `temp_selected_date_view:${organizationId}:${senderId}`,
      );
      const fechaFormateadaResumen = fechaVistaFinal
        ? formatAppointmentLong(fechaVistaFinal)
        : '';
      const replyResumen = MSGS.resumenCita(
        nombreAgend,
        finalCedula,
        resolvedEpsName,
        resolvedServiceName as string,
        fechaFormateadaResumen,
        this.configService.get<string>('PRIVACY_POLICY_URL'),
      );
      // smartReply y no texto directo: en flujo de voz el resumen también se
      // ESCUCHA (el paciente lo recibía solo escrito, retroalimentación del
      // 2026-09-24). El texto completo —con el aviso de la Ley 1581 y el
      // enlace— viaja siempre, porque `audioText` lo obliga.
      await this.smartReply(
        organizationId,
        senderId,
        replyResumen,
        this.resumenCitaHablado(
          MSGS,
          nombreAgend,
          resolvedServiceName as string,
          fechaVistaFinal,
        ),
      );
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_CONFIRMATION,
      );

      await this.auditSuccess(senderId, organizationId, {
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
    // Contexto del turno para los handlers de estado (ver ChatTurnContext).
    const ctx: ChatTurnContext = {
      organizationId,
      senderId,
      identity,
      phoneNumberId: event?.metadata?.phone_number_id,
      text,
      currentState,
      aiData,
      MSGS,
      botName,
      orgName,
      retriesKey,
      retriesCount,
      operaciones,
    };

    // Despacho por estado. Estados con handler registrado → se delega; el
    // resto (incluido IDLE, ya resuelto en el preámbulo) → limpieza de sesión,
    // equivalente al `default` del switch original.
    const handler = this.stateHandlers[currentState];
    if (handler) {
      await handler(ctx);
    } else {
      await this.cleanUpSession(organizationId, senderId);
    }
  }

  /** Handler de estado: AWAITING_DATE. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingDate(ctx: ChatTurnContext): Promise<void> {
    const {
      organizationId,
      senderId,
      text,
      currentState,
      MSGS,
      retriesKey,
      retriesCount,
    } = ctx;
    const letraElegida = this.extractOptionLetter(text);
    const slotId = await this.redis.get(
      this.slotKey(organizationId, senderId, letraElegida),
    );
    const slotFechaStr = await this.redis.get(
      this.slotDateKey(organizationId, senderId, letraElegida),
    );

    // Sin letra válida: el paciente (típicamente por voz) puede referirse al
    // cupo por su día/hora ("la de mañana a las 3") en vez de la letra.
    // Intentamos casar UN único cupo de los ofrecidos; si resulta ambiguo o no
    // se reconoce, caemos al reintento (disculpa + volver a preguntar).
    if (!slotId || !slotFechaStr) {
      const matched = await this.matchOfferedSlotByVoice(
        organizationId,
        senderId,
        text,
      );
      if (matched) {
        await this.advanceAfterSlotSelected({
          organizationId,
          senderId,
          slotId: matched.slotId,
          slotFechaStr: matched.fecha.toISOString(),
          MSGS,
          userMessage: text,
          via: 'voice_datetime',
        });
        return;
      }

      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.errorSlotInvalido();
      await this.smartReply(organizationId, senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidLetter: letraElegida, state: currentState },
      });
      return;
    }

    await this.advanceAfterSlotSelected({
      organizationId,
      senderId,
      slotId,
      slotFechaStr,
      MSGS,
      userMessage: text,
      selectedLetter: letraElegida,
      via: 'letter',
    });
  }

  /**
   * Transición común tras elegir un cupo (por letra o por voz "día+hora"):
   * persiste el slot seleccionado y avanza al resumen (si la cédula ya está en
   * memoria) o a pedir la cédula. Fuente ÚNICA de esta transición para que la
   * selección por letra y el match por voz se comporten idénticamente.
   */
  private async advanceAfterSlotSelected(p: {
    organizationId: string;
    senderId: string;
    slotId: string;
    slotFechaStr: string;
    MSGS: ReturnType<typeof buildMessages>;
    userMessage: string | undefined;
    selectedLetter?: string;
    via: 'letter' | 'voice_datetime';
  }): Promise<void> {
    const {
      organizationId,
      senderId,
      slotId,
      slotFechaStr,
      MSGS,
      userMessage,
      selectedLetter,
      via,
    } = p;

    await this.redis.set(
      `temp_selected_slot_id:${organizationId}:${senderId}`,
      slotId,
      'EX',
      SESSION_TTL,
    );
    await this.redis.set(
      `temp_selected_date_view:${organizationId}:${senderId}`,
      slotFechaStr,
      'EX',
      SESSION_TTL,
    );

    const fechaFormateada = formatAppointmentLong(slotFechaStr);

    // Si el usuario ya tenía cédula en memoria (re-agendamiento), saltamos
    // directo al resumen para no preguntar dos veces.
    const cedulaPrevia = await this.redis.get(
      `temp_cedula:${organizationId}:${senderId}`,
    );
    const nombrePrevio = await this.redis.get(
      `temp_nombre:${organizationId}:${senderId}`,
    );

    if (cedulaPrevia) {
      // 🪪 PADRÓN EPS: este atajo salta el paso de cédula del flujo unificado,
      // así que la verificación de alta debe repetirse aquí.
      const epsIdPrevio = await this.redis.get(
        `temp_eps_id:${organizationId}:${senderId}`,
      );
      if (
        await this.rejectIfNotEnrolledInEps({
          organizationId,
          senderId,
          cedula: cedulaPrevia,
          epsId: epsIdPrevio,
          MSGS,
          userMessage,
        })
      ) {
        return;
      }

      // 🚦 LÍMITE DE CITAS: mismo motivo que la verificación de arriba.
      if (
        await this.rejectIfOverAppointmentLimit({
          organizationId,
          senderId,
          cedula: cedulaPrevia,
          fecha: slotFechaStr,
          MSGS,
          userMessage,
          operacion: 'BOOKING',
          servicio: await this.redis.get(
            `temp_especialidad:${organizationId}:${senderId}`,
          ),
        })
      ) {
        return;
      }

      // Paciente con cédula ya conocida → resumen + confirmación.
      const specAgend =
        (await this.redis.get(
          `temp_especialidad:${organizationId}:${senderId}`,
        )) || 'Servicio';
      const epsAgend =
        (await this.redis.get(
          `temp_eps_query:${organizationId}:${senderId}`,
        )) || 'EPS';
      const reply = MSGS.resumenCita(
        nombrePrevio || 'Paciente',
        cedulaPrevia,
        epsAgend,
        specAgend,
        fechaFormateada,
        this.configService.get<string>('PRIVACY_POLICY_URL'),
      );
      await this.smartReply(
        organizationId,
        senderId,
        reply,
        this.resumenCitaHablado(MSGS, nombrePrevio, specAgend, slotFechaStr),
      );
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_CONFIRMATION,
      );

      await this.auditSuccess(senderId, organizationId, {
        userMessage,
        botReply: reply,
        metadata: {
          step: 'SLOT_SELECTED_CEDULA_KNOWN',
          selectedLetter,
          via,
          slotId,
          slotDate: slotFechaStr,
        },
      });
      return;
    }

    // Sin cédula previa → pedir cédula (Paso 4 del protocolo).
    // smartReply (no texto directo): en flujo de voz la pregunta también se
    // escucha, igual que el resumen de arriba.
    const reply = MSGS.pedirCedulaPostSlot(fechaFormateada);
    await this.smartReply(organizationId, senderId, reply);
    await this.setUserState(
      organizationId,
      senderId,
      ChatState.AWAITING_CEDULA,
    );

    await this.auditSuccess(senderId, organizationId, {
      userMessage,
      botReply: reply,
      metadata: {
        step: 'SLOT_SELECTED_ASK_CEDULA',
        selectedLetter,
        via,
        slotId,
        slotDate: slotFechaStr,
      },
    });
  }

  /** Handler de estado: AWAITING_CONFIRMATION. Extraído de processIncomingMessageUnsafe (#2). */
  // ══════════════════════════════════════════════════════════════
  // ALTA DE PACIENTE NUEVO — nacimiento, sexo y régimen
  //
  // El HIS del hospital exige `FE_NACI_PAC` y `NU_SEXO_PAC` NOT NULL para
  // crear un paciente, y el convenio de facturación se resuelve con
  // EPS + régimen. Nada de esto se preguntaba: el chatbot solo capturaba
  // nombre y cédula, así que una cita de un paciente nuevo era imposible de
  // escribir en el HIS.
  //
  // Los tres van en turnos SEPARADOS, no en un solo mensaje: el extractor LLM
  // está devolviendo nulos (esta organización no tiene proveedor configurado),
  // así que todo el parseo es determinista y un dato por turno es lo único
  // fiable.
  // ══════════════════════════════════════════════════════════════

  private altaKey(
    organizationId: string,
    senderId: string,
    dato: 'nacimiento' | 'sexo' | 'regimen',
  ): string {
    return `temp_alta_${dato}:${organizationId}:${senderId}`;
  }

  /**
   * De quién son los datos temporales de alta que haya en Redis ahora mismo.
   * Sirve para detectar cuándo el mismo número de WhatsApp arranca el alta de
   * una SEGUNDA persona nueva antes de que expire la sesión de la primera —
   * sin esto, `siguienteDatoDeAlta` encontraba nombres/apellidos/nacimiento/
   * sexo/régimen "ya guardados" y se los adjudicaba a la persona equivocada.
   */
  private altaCedulaKey(organizationId: string, senderId: string): string {
    return `temp_alta_cedula:${organizationId}:${senderId}`;
  }

  /** El cupo de la lista de espera que quedó esperando el régimen del paciente. */
  private listaRegimenKey(organizationId: string, senderId: string): string {
    return `temp_waitlist_regimen:${organizationId}:${senderId}`;
  }

  /**
   * Qué dato falta todavía, o null si ya están todos.
   *
   * `perfil` es el paciente que YA existe, o null si es nuevo. Un paciente que ya
   * existe no está necesariamente completo: el alta en caliente lo crea con lo que
   * trae el HIS (nacimiento y sexo, nunca el régimen), y los que se registraron
   * antes de que el bot preguntara estos datos no tienen ninguno. Antes a quien ya
   * existía no se le preguntaba nada — caso real del 2026-09-26: una paciente de
   * Salud Total sin régimen agendó, el bot le confirmó y el agente rechazó la cita
   * diez veces porque sin régimen no hay convenio. El hospital nunca la tuvo.
   * Ahora se pregunta solo lo que le falta a SU ficha, y nada más.
   */
  private async siguienteDatoDeAlta(
    organizationId: string,
    senderId: string,
    epsId: string | null,
    perfil: Pick<
      PatientProfile,
      'dateOfBirth' | 'gender' | 'regime'
    > | null = null,
    cedula: string | null = null,
  ): Promise<'nacimiento' | 'sexo' | 'regimen' | null> {
    if (
      !perfil?.dateOfBirth &&
      !(await this.redis.get(
        this.altaKey(organizationId, senderId, 'nacimiento'),
      ))
    )
      return 'nacimiento';
    if (
      !perfil?.gender &&
      !(await this.redis.get(this.altaKey(organizationId, senderId, 'sexo')))
    )
      return 'sexo';

    // El régimen solo aplica con EPS: un particular paga directo y su convenio
    // no depende de nada. Preguntárselo sería una pregunta de más para nada.
    if (perfil?.regime) return null;
    if (!epsId) return null;
    const eps = await this.prisma.eps.findUnique({ where: { id: epsId } });
    if (!eps || isParticularEps(eps.name)) return null;

    if (await this.redis.get(this.altaKey(organizationId, senderId, 'regimen')))
      return null;

    // El padrón de ESA EPS lo dice sin ninguna duda (una sola EPS, la elegida, y un
    // solo régimen): no se le pregunta lo que ya se sabe. Se guarda en la sesión
    // como si lo hubiera contestado, y viaja por el mismo camino hasta su ficha al
    // decir SÍ. Con cualquier duda, se pregunta: preguntar nunca es un error.
    const delPadron = cedula
      ? await this.appointmentsService.regimenDelPadron(
          organizationId,
          cedula,
          epsId,
        )
      : null;
    if (delPadron) {
      await this.redis.set(
        this.altaKey(organizationId, senderId, 'regimen'),
        delPadron,
        'EX',
        SESSION_TTL,
      );
      return null;
    }
    return 'regimen';
  }

  private async pedirDatoDeAlta(
    organizationId: string,
    senderId: string,
    dato: 'nacimiento' | 'sexo' | 'regimen',
    MSGS: ReturnType<typeof buildMessages>,
    epsName: string,
    userMessage?: string,
  ): Promise<void> {
    const porDato = {
      nacimiento: {
        reply: MSGS.pedirNacimiento(),
        state: ChatState.AWAITING_BIRTHDATE,
      },
      sexo: { reply: MSGS.pedirSexo(), state: ChatState.AWAITING_GENDER },
      regimen: {
        reply: MSGS.pedirRegimen(epsName),
        state: ChatState.AWAITING_REGIME,
      },
    }[dato];

    // Esta pregunta es del alta, no de la lista de espera: un cupo de lista que
    // quedó esperando el régimen en otra conversación no debe reservarse con la
    // respuesta de esta (ver `handleAwaitingRegime`).
    await this.redis.del(this.listaRegimenKey(organizationId, senderId));
    await this.smartReply(organizationId, senderId, porDato.reply);
    await this.auditarAlta(
      organizationId,
      senderId,
      userMessage,
      porDato.reply,
      `ALTA_PEDIR_${dato.toUpperCase()}`,
    );
    await this.setUserState(organizationId, senderId, porDato.state);
    await this.extenderSesionDeAlta(organizationId, senderId);
  }

  /**
   * Deja en InteractionLog los turnos del alta.
   *
   * 🚨 No los registraba nadie: los tres datos que el HIS exige — fecha de
   * nacimiento, sexo y régimen — se preguntaban, se guardaban y acababan en la
   * historia clínica del paciente sin dejar una sola fila de auditoría. Si
   * mañana una historia sale con el sexo equivocado, sin esto no hay forma de
   * saber si el paciente escribió mal o lo entendimos mal nosotros. Se
   * descubrió porque la prueba de punta a punta esperaba la respuesta del bot
   * en InteractionLog y en estos tres turnos no aparecía nunca.
   */
  private async auditarAlta(
    organizationId: string,
    senderId: string,
    userMessage: string | undefined,
    botReply: string,
    step: string,
  ): Promise<void> {
    await this.auditSuccess(senderId, organizationId, {
      userMessage: userMessage ?? '',
      botReply,
      metadata: { step },
    });
  }

  /** Responde y audita en un solo paso, para los turnos del alta. */
  private async responderAlta(
    ctx: ChatTurnContext,
    reply: string,
    step: string,
  ): Promise<void> {
    await this.smartReply(ctx.organizationId, ctx.senderId, reply);
    await this.auditarAlta(
      ctx.organizationId,
      ctx.senderId,
      ctx.text,
      reply,
      step,
    );
  }

  /** Lo capturado hasta ahora, en el formato que espera `ensurePatientPersisted`. */
  private async datosDeAltaGuardados(
    organizationId: string,
    senderId: string,
  ): Promise<{
    dateOfBirth?: Date;
    gender?: string;
    regime?: string;
    nombres?: string;
    apellidos?: string;
  }> {
    const [nacimiento, sexo, regimen, nombres, apellidos] = await Promise.all([
      this.redis.get(this.altaKey(organizationId, senderId, 'nacimiento')),
      this.redis.get(this.altaKey(organizationId, senderId, 'sexo')),
      this.redis.get(this.altaKey(organizationId, senderId, 'regimen')),
      this.redis.get(`temp_nombres:${organizationId}:${senderId}`),
      this.redis.get(`temp_apellidos:${organizationId}:${senderId}`),
    ]);
    return {
      ...(nacimiento ? { dateOfBirth: new Date(nacimiento) } : {}),
      ...(sexo ? { gender: sexo } : {}),
      ...(regimen ? { regime: regimen } : {}),
      // La frontera nombres/apellidos viaja hasta PatientProfile: es lo que
      // evita que el driver tenga que adivinarla luego.
      ...(nombres ? { nombres } : {}),
      ...(apellidos ? { apellidos } : {}),
    };
  }

  /**
   * Un paciente nuevo ahora contesta tres preguntas más, y el cron cierra las
   * sesiones inactivas a los 300 s. Tres turnos extra son tres oportunidades
   * más de distraerse y perder la reserva a medio camino, así que mientras
   * dura el alta la sesión aguanta más.
   */
  private async extenderSesionDeAlta(
    organizationId: string,
    senderId: string,
  ): Promise<void> {
    await this.redis.set(
      `alta_en_curso:${organizationId}:${senderId}`,
      '1',
      'EX',
      SESSION_TTL,
    );
  }

  /**
   * Segundo paso del nombre: los apellidos.
   *
   * Se preguntan aparte porque el HIS los guarda en columnas propias y
   * recomponer la frontera después es adivinar: "JUAN CARLOS PEREZ" puede ser
   * un nombre y dos apellidos, o dos nombres y un apellido. Preguntando, la
   * frontera la pone el paciente.
   *
   * `temp_nombre` sigue guardando el nombre COMPUESTO: el resumen, la reserva
   * y todo lo que viene después no se enteran de que ahora son dos preguntas.
   */
  private async handleAwaitingApellidos(ctx: ChatTurnContext): Promise<void> {
    const { organizationId, senderId, text, MSGS } = ctx;
    const apellidos = (text ?? '').trim().replace(/\s+/g, ' ');

    if (apellidos.length < 2) {
      await this.responderAlta(
        ctx,
        MSGS.apellidosNoEntendidos(),
        'ALTA_APELLIDOS_NO_ENTENDIDOS',
      );
      return;
    }

    const nombresDados =
      (await this.redis.get(`temp_nombres:${organizationId}:${senderId}`)) ??
      '';
    // 🪪 Si repitió el nombre en los dos pasos (2026-10-22: «Juan camilo hurtado
    // ramos» + «Hurtado ramos»), se separa lo que no tiene otra lectura; si
    // escribió exactamente lo mismo, se le vuelven a pedir los apellidos.
    const separado = separarNombresYApellidos(nombresDados, apellidos);
    if (separado.repetido) {
      await this.responderAlta(
        ctx,
        MSGS.apellidosRepetidos(separado.nombres),
        'ALTA_APELLIDOS_REPETIDOS',
      );
      return;
    }
    const { nombres } = separado;

    if (nombres !== nombresDados.trim()) {
      await this.redis.set(
        `temp_nombres:${organizationId}:${senderId}`,
        nombres,
        'EX',
        SESSION_TTL,
      );
    }
    await this.redis.set(
      `temp_apellidos:${organizationId}:${senderId}`,
      separado.apellidos,
      'EX',
      SESSION_TTL,
    );
    await this.redis.set(
      `temp_nombre:${organizationId}:${senderId}`,
      `${nombres} ${separado.apellidos}`.trim(),
      'EX',
      SESSION_TTL,
    );

    await this.continuarAlta(ctx);
  }

  private async handleAwaitingBirthdate(ctx: ChatTurnContext): Promise<void> {
    const { organizationId, senderId, text, MSGS } = ctx;

    // El paciente confirma la fecha que se le devolvió en el turno anterior.
    const pendiente = await this.redis.get(
      `temp_alta_nacimiento_pendiente:${organizationId}:${senderId}`,
    );
    if (
      pendiente &&
      /^(s[ií]|si|correcto|ok|exacto|as[ií] es)$/i.test((text ?? '').trim())
    ) {
      await this.redis.set(
        this.altaKey(organizationId, senderId, 'nacimiento'),
        pendiente,
        'EX',
        SESSION_TTL,
      );
      await this.redis.del(
        `temp_alta_nacimiento_pendiente:${organizationId}:${senderId}`,
      );
      await this.continuarAlta(ctx);
      return;
    }

    const fecha = parseFechaNacimiento(text);
    if (!fecha) {
      await this.responderAlta(
        ctx,
        MSGS.nacimientoNoEntendido(),
        'ALTA_NACIMIENTO_NO_ENTENDIDO',
      );
      return;
    }

    // ⭐ Se le devuelve lo entendido ANTES de darlo por bueno. Una fecha mal
    // leída no da error: se propaga en silencio hasta la historia clínica del
    // paciente, y de ella depende el rango de edad que el HIS valida.
    await this.redis.set(
      `temp_alta_nacimiento_pendiente:${organizationId}:${senderId}`,
      fecha.iso,
      'EX',
      SESSION_TTL,
    );
    await this.responderAlta(
      ctx,
      MSGS.confirmarNacimiento(formatFechaNacimiento(fecha.date)),
      'ALTA_CONFIRMAR_NACIMIENTO',
    );
  }

  private async handleAwaitingGender(ctx: ChatTurnContext): Promise<void> {
    const { organizationId, senderId, text, MSGS } = ctx;
    const t = (text ?? '').trim();
    // El menú ofrece A/B; también se acepta la palabra escrita.
    const sexo = /^a$/i.test(t) ? 'M' : /^b$/i.test(t) ? 'F' : parseSexo(t);
    if (!sexo) {
      await this.responderAlta(
        ctx,
        MSGS.sexoNoEntendido(),
        'ALTA_SEXO_NO_ENTENDIDO',
      );
      return;
    }
    await this.redis.set(
      this.altaKey(organizationId, senderId, 'sexo'),
      sexo,
      'EX',
      SESSION_TTL,
    );
    await this.continuarAlta(ctx);
  }

  private async handleAwaitingRegime(ctx: ChatTurnContext): Promise<void> {
    const { organizationId, senderId, text, MSGS } = ctx;
    const regimen = parseRegimen((text ?? '').trim());
    if (!regimen) {
      await this.responderAlta(
        ctx,
        MSGS.regimenNoEntendido(),
        'ALTA_REGIMEN_NO_ENTENDIDO',
      );
      return;
    }
    // ¿Se le preguntó al confirmar un cupo de la lista de espera? Entonces el
    // paciente ya existe: se completa su ficha y se reserva ESE cupo.
    const deLista = await this.redis.get(
      this.listaRegimenKey(organizationId, senderId),
    );
    if (deLista) {
      await this.redis.del(this.listaRegimenKey(organizationId, senderId));
      const { slotId, patientId, epsId } = JSON.parse(deLista) as {
        slotId: string;
        patientId: string;
        epsId: string | null;
      };
      // Solo rellena el hueco: no pisa un régimen que ya estuviera.
      await this.prisma.patientProfile.updateMany({
        where: { id: patientId, organizationId, regime: null },
        data: { regime: regimen },
      });
      await this.reservarCupoDeLista(
        organizationId,
        senderId,
        text,
        MSGS,
        slotId,
        patientId,
        epsId ?? null,
      );
      return;
    }

    await this.redis.set(
      this.altaKey(organizationId, senderId, 'regimen'),
      regimen,
      'EX',
      SESSION_TTL,
    );
    await this.continuarAlta(ctx);
  }

  /**
   * Avanza al siguiente dato pendiente o, si ya están todos, retoma el flujo
   * normal reinyectando el turno — así el resumen y la confirmación se
   * construyen con el MISMO código de siempre, sin duplicar esa lógica aquí.
   */
  private async continuarAlta(ctx: ChatTurnContext): Promise<void> {
    const { organizationId, senderId, MSGS } = ctx;
    const [epsId, cedula] = await Promise.all([
      this.redis.get(`temp_eps_id:${organizationId}:${senderId}`),
      this.redis.get(`temp_cedula:${organizationId}:${senderId}`),
    ]);
    // Sin esto, al paciente existente al que solo le faltaba el régimen se le
    // pedirían después nacimiento y sexo que su ficha ya tiene.
    const perfil = cedula
      ? await this.prisma.patientProfile.findFirst({
          where: { cedula, organizationId },
          select: { dateOfBirth: true, gender: true, regime: true },
        })
      : null;
    const siguiente = await this.siguienteDatoDeAlta(
      organizationId,
      senderId,
      epsId,
      perfil,
      cedula,
    );

    if (siguiente) {
      const eps = epsId
        ? await this.prisma.eps.findUnique({ where: { id: epsId } })
        : null;
      await this.pedirDatoDeAlta(
        organizationId,
        senderId,
        siguiente,
        MSGS,
        eps?.name ?? PARTICULAR_EPS_NAME,
        ctx.text,
      );
      return;
    }

    // Datos completos: se persiste al paciente y se muestra el resumen por el
    // MISMO camino que el flujo normal. Se probó antes reinyectando un turno
    // sintético con la cédula, pero eso re-resuelve el tenant, ensucia la
    // auditoría con un mensaje que el paciente nunca escribió y se arriesga a
    // recursión. Una llamada directa dice lo que hace.
    await this.mostrarResumenParaConfirmar(ctx);
  }

  /**
   * Muestra el resumen previo a la confirmación. NO guarda nada.
   *
   * Sale del flujo principal para que el alta de paciente nuevo pueda retomar
   * exactamente aquí cuando termina de recoger nacimiento, sexo y régimen —
   * sin duplicar la construcción del resumen ni el consentimiento de Habeas
   * Data, que es justo el tipo de cosa que se desincroniza con el tiempo.
   *
   * 🔒 SE LLAMABA `persistirYMostrarResumen`, y el nombre era exacto: creaba
   * el `PatientProfile` con nombres, apellidos, nacimiento, sexo y régimen
   * JUSTO ANTES de enseñarle al paciente el aviso que dice que, al responder
   * SÍ, autoriza el tratamiento de sus datos —incluidos los sensibles de
   * salud— conforme a la Ley 1581 de 2012. Es el orden invertido: primero se
   * trataban los datos, después se pedía permiso.
   *
   * Se midió en la campaña E2E del 2026-09-22: un paciente contestó las cinco
   * preguntas, respondió NO a la confirmación, y su ficha completa se quedó
   * guardada igual — escrita dos minutos antes de que dijera que no.
   *
   * Lo capturado vive en la sesión de Redis hasta la confirmación, que aborta
   * con SESSION_EXPIRED si esa sesión se perdió: no hay ventana en la que un
   * SÍ llegue sin los datos.
   */
  private async mostrarResumenParaConfirmar(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const { organizationId, senderId, MSGS, text } = ctx;
    const g = (k: string) =>
      this.redis.get(`${k}:${organizationId}:${senderId}`);

    const [cedula, nombre, epsId, servicio, fechaVista] = await Promise.all([
      g('temp_cedula'),
      g('temp_nombre'),
      g('temp_eps_id'),
      g('temp_especialidad'),
      g('temp_selected_date_view'),
    ]);

    if (!cedula) {
      // La sesión expiró a mitad del alta. Sin cédula no hay a quién agendar.
      await this.smartReply(organizationId, senderId, MSGS.sesionExpirada());
      await this.cleanUpSession(organizationId, senderId);
      return;
    }

    const eps = epsId
      ? await this.prisma.eps.findUnique({ where: { id: epsId } })
      : null;

    // Solo para MOSTRAR su nombre en el resumen. La traducción de "Particular"
    // a `null` —que no es una afiliación y no debe quedar ligada al paciente ni
    // a la cita— la hace ahora la confirmación, que es donde se guarda.
    const reply = MSGS.resumenCita(
      nombre || 'Paciente',
      cedula,
      eps?.name ?? PARTICULAR_EPS_NAME,
      servicio ?? '',
      fechaVista ? formatAppointmentLong(fechaVista) : '',
      this.configService.get<string>('PRIVACY_POLICY_URL'),
    );
    await this.smartReply(
      organizationId,
      senderId,
      reply,
      this.resumenCitaHablado(MSGS, nombre, servicio ?? '', fechaVista),
    );
    await this.setUserState(
      organizationId,
      senderId,
      ChatState.AWAITING_CONFIRMATION,
    );

    await this.auditSuccess(senderId, organizationId, {
      userMessage: text || '[alta]',
      botReply: reply,
      metadata: {
        step: 'BOOKING_SUMMARY_SHOWN',
        cedula,
        eps: eps?.name ?? PARTICULAR_EPS_NAME,
        specialty: servicio,
        viaAltaPacienteNuevo: true,
      },
    });
  }

  private async handleAwaitingConfirmation(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const {
      organizationId,
      senderId,
      identity,
      text,
      MSGS,
      orgName,
      retriesKey,
      retriesCount,
    } = ctx;
    // Interpretación tolerante a voz: una transcripción tipo "Sí, por favor"
    // o "Confirmo" debe contar como SÍ (mismo patrón que la cola de espera).
    // El whitelist literal anterior ('SI'/'SÍ') sólo matcheaba el texto exacto
    // y fallaba con casi cualquier transcripción de audio.
    // ❓ Pero una PREGUNTA no es un SÍ (2026-10-23: «¿Esto si es para las
    // ecografías?» agendó una cita de medicina general que no pidió): se le
    // aclara qué cita es y se le vuelve a pedir SÍ o NO. Un «no» sigue siendo no.
    const pregunta = esPreguntaEnVezDeRespuesta(text);
    const decision = this.decisionSiNoSinPreguntas(text);
    const respuesta = text?.toUpperCase().trim() || '';

    if (decision === 'SI') {
      const cedulaFinal = await this.redis.get(
        `temp_cedula:${organizationId}:${senderId}`,
      );
      const nombreFinal = await this.redis.get(
        `temp_nombre:${organizationId}:${senderId}`,
      );
      const specFinal = await this.redis.get(
        `temp_especialidad:${organizationId}:${senderId}`,
      );
      const epsIdFinal = await this.redis.get(
        `temp_eps_id:${organizationId}:${senderId}`,
      );
      const slotIdFinal = await this.redis.get(
        `temp_selected_slot_id:${organizationId}:${senderId}`,
      );
      const fechaVistaFinal = await this.redis.get(
        `temp_selected_date_view:${organizationId}:${senderId}`,
      );

      if (!cedulaFinal || !specFinal || !slotIdFinal || !fechaVistaFinal) {
        const reply = MSGS.sesionExpirada();
        await this.smartReply(organizationId, senderId, reply);
        await this.cleanUpSession(organizationId, senderId);

        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.SESSION_EXPIRED,
          userMessage: text,
          botReply: reply,
          metadata: { stage: 'AWAITING_CONFIRMATION_SI' },
        });
        return;
      }

      // 🪪 PADRÓN EPS: última barrera antes de reservar (defensa en
      // profundidad: cubre cualquier camino que llegue a la confirmación).
      if (
        await this.rejectIfNotEnrolledInEps({
          organizationId,
          senderId,
          cedula: cedulaFinal,
          epsId: epsIdFinal || null,
          MSGS,
          userMessage: text,
        })
      ) {
        return;
      }

      // "Particular" (pago directo) vive como fila de Eps en BD para poder
      // listarse en el menú, pero NO es una afiliación: todo el flujo previo la
      // traduce a `null` (cupos universales, sin padrón). La confirmación debe
      // hacer lo mismo, o el paciente y su cita quedarían ligados a la fila
      // "Particular" como si tuviera convenio.
      const epsIdForBooking = await this.normalizeEpsIdForBooking(
        organizationId,
        epsIdFinal,
      );

      // 🔒 EL PACIENTE NACE AQUÍ, no antes: este es el primer punto del flujo
      // posterior al SÍ, es decir, a la autorización de la Ley 1581 que el
      // resumen le acaba de mostrar. Los datos del alta (nacimiento, sexo,
      // régimen y la frontera nombres/apellidos) viajaban antes en la escritura
      // temprana que había junto al resumen; ahora se recogen aquí de la sesión.
      // Sin ellos, un paciente que el hospital no tenga no se puede dar de alta
      // en `PACIENTES` (FE_NACI_PAC y NU_SEXO_PAC son NOT NULL) — es el
      // escenario 12 de las pruebas E2E.
      const patient = await this.ensurePatientPersisted({
        cedula: cedulaFinal,
        nombre: nombreFinal || 'Paciente Registrado',
        identity,
        organizationId: organizationId,
        epsId: epsIdForBooking,
        ...(await this.datosDeAltaGuardados(organizationId, senderId)),
      });

      if (!patient) {
        const reply = MSGS.cancelarError();
        await this.smartReply(organizationId, senderId, reply);
        await this.cleanUpSession(organizationId, senderId);

        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.UNHANDLED_ERROR,
          userMessage: text,
          botReply: reply,
          metadata: {
            stage: 'PATIENT_PERSISTENCE_FAILED',
            cedula: cedulaFinal,
          },
        });
        return;
      }

      // La EPS de la CITA es la de esta sesión de agendamiento, no la que el
      // perfil traiga de reservas anteriores (un paciente puede venir hoy como
      // Particular y la próxima vez por su EPS).
      const bookingResult = await this.appointmentsService.bookAppointment(
        patient.id,
        slotIdFinal,
        epsIdForBooking,
        isTelegramSender(senderId) ? 'TELEGRAM' : 'WHATSAPP',
        organizationId,
      );

      if (bookingResult.success) {
        const fechaFormateada = formatAppointmentLong(fechaVistaFinal);

        // 🏥 H10: la confirmación final solo sale con la cita en el HIS.
        const enElHospital = await this.confirmarConElHospital({
          organizationId,
          senderId,
          MSGS,
          appointmentId: bookingResult.appointmentId,
          fechaTexto: fechaFormateada,
        });
        if (enElHospital === 'RECHAZADA') {
          // El hospital ya tenía ocupado ese horario (o se cruza con otra
          // cita): la API anuló la cita en AgenIA. Se le ofrece elegir otro,
          // igual que cuando otro paciente toma el cupo.
          const reply = MSGS.slotTomado();
          await this.smartReply(organizationId, senderId, reply);
          await this.setUserState(
            organizationId,
            senderId,
            ChatState.AWAITING_DATE,
          );
          await this.auditFailure(senderId, organizationId, {
            reason: FailureReason.SLOT_TAKEN,
            userMessage: text,
            botReply: reply,
            metadata: {
              stage: 'HIS_REJECTED',
              slotId: slotIdFinal,
              cedula: cedulaFinal,
              appointmentId: bookingResult.appointmentId,
            },
          });
          return;
        }
        if (enElHospital === 'PENDIENTE') {
          // Ya se le dijo que se le escribe al quedar registrada (el barrido
          // de confirmaciones pendientes lo hace). No se confirma nada aquí.
          await this.revisarSiConfirmoTrasPreguntar(
            organizationId,
            senderId,
            bookingResult.appointmentId,
          );
          await this.auditLog(senderId, organizationId, {
            status: InteractionStatus.SUCCESS,
            userMessage: text,
            botReply: '[confirmación pendiente del hospital]',
            metadata: {
              stage: 'HIS_CONFIRMATION_PENDING',
              appointmentId: bookingResult.appointmentId,
            },
          });
          await this.cleanUpSession(organizationId, senderId);
          return;
        }

        const reply = MSGS.citaConfirmada(orgName, fechaFormateada);
        const confirmacion: OutboundMessageContext = {
          kind: 'BOOKING_CONFIRMATION',
          appointmentId: bookingResult.appointmentId,
        };
        await this.smartReply(
          organizationId,
          senderId,
          reply,
          undefined,
          confirmacion,
        );
        await this.revisarSiConfirmoTrasPreguntar(
          organizationId,
          senderId,
          bookingResult.appointmentId,
        );

        // 📝 Auditoría: cita agendada (evento de negocio crítico)
        const slotInfo = await this.prisma.scheduleSlot.findUnique({
          where: { id: slotIdFinal },
          include: { doctor: true, service: true },
        });
        const epsNameFinal = epsIdFinal
          ? (await this.prisma.eps.findUnique({ where: { id: epsIdFinal } }))
              ?.name
          : undefined;

        // En flujo de VOZ el paciente solo escuchó la confirmación; le dejamos
        // un resumen escrito como respaldo. `sendWhatsAppMessage` directo (no
        // `smartReply`) para garantizar texto y no re-sintetizar a audio. Solo
        // voz: el flujo de texto ya mostró estos datos antes de confirmar.
        const isVoiceFlow =
          (await this.redis.get(`is_ai_flow:${organizationId}:${senderId}`)) ===
          'true';
        if (isVoiceFlow) {
          await this.sendWhatsAppMessage(
            senderId,
            MSGS.resumenCitaConfirmadaTexto(
              nombreFinal || 'Paciente',
              cedulaFinal,
              epsNameFinal || PARTICULAR_EPS_NAME,
              slotInfo?.service?.name || specFinal,
              fechaFormateada,
            ),
            confirmacion,
          );
        }

        await this.interactionLog.logBookingConfirmed({
          whatsappId: senderId,
          organizationId: organizationId,
          appointmentId: bookingResult.appointmentId || 'unknown',
          patientCedula: cedulaFinal,
          serviceName: slotInfo?.service?.name || specFinal,
          doctorName: slotInfo?.doctor?.fullName || 'desconocido',
          slotDate: new Date(fechaVistaFinal),
          epsName: epsNameFinal,
          userMessage: text,
          botReply: reply,
        });
        // ⭐ CSAT: flujo cerrado con cita agendada → encuesta.
        await this.sendSurveyLink(
          organizationId,
          senderId,
          ResolutionStatus.BOOKED,
          {
            patientId: patient.id,
            chatSummary: `Cita agendada (${specFinal}) para ${fechaFormateada}.`,
          },
        );
      } else if (bookingResult.reason === 'EPS_REGIME_NOT_BILLABLE') {
        // No es un cupo: es su EPS+régimen sin convenio. Reintentar con otro
        // horario NUNCA lo arregla, así que a diferencia de los otros dos
        // casos no se vuelve a AWAITING_DATE — se cierra la conversación y
        // se le dice que hable con la clínica.
        const reply = MSGS.epsRegimenNoFacturable();
        await this.smartReply(organizationId, senderId, reply);

        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.EPS_REGIME_NOT_BILLABLE,
          userMessage: text,
          botReply: reply,
          metadata: {
            slotId: slotIdFinal,
            cedula: cedulaFinal,
            epsId: epsIdForBooking,
          },
        });
        await this.cleanUpSession(organizationId, senderId);
        return;
      } else if (bookingResult.reason === 'PATIENT_REGIME_MISSING') {
        // Red de seguridad: `siguienteDatoDeAlta` ya debió pedirlo antes del
        // resumen. Si aun así llega sin régimen, NO se confirma una cita que el
        // hospital no va a poder recibir: se le pregunta, y al contestar vuelve
        // al resumen por el camino de siempre (`continuarAlta`). El cupo no se
        // ocupó, así que sigue libre mientras responde.
        const eps = epsIdForBooking
          ? await this.prisma.eps.findUnique({ where: { id: epsIdForBooking } })
          : null;
        const reply = MSGS.pedirRegimen(eps?.name ?? PARTICULAR_EPS_NAME);
        await this.redis.del(this.listaRegimenKey(organizationId, senderId));
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(
          organizationId,
          senderId,
          ChatState.AWAITING_REGIME,
        );
        await this.extenderSesionDeAlta(organizationId, senderId);
        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.PATIENT_REGIME_MISSING,
          userMessage: text,
          botReply: reply,
          metadata: {
            stage: 'BOOKING_PATIENT_REGIME_MISSING',
            slotId: slotIdFinal,
            cedula: cedulaFinal,
          },
        });
        return;
      } else if (
        bookingResult.reason === 'PATIENT_LIMIT_REACHED' &&
        bookingResult.limite
      ) {
        // 🚦 La reserva tiene la palabra final del límite de citas: aquí llega
        // quien completó el límite entre el freno temprano y el SÍ (p. ej. el
        // hospital le dio otra cita mientras tanto). Otro horario del mismo día
        // no lo arregla, así que se cierra como el freno temprano.
        await this.avisarLimiteDeCitas({
          organizationId,
          senderId,
          MSGS,
          limite: bookingResult.limite,
          operacion: 'BOOKING',
          fecha: new Date(fechaVistaFinal),
          servicio: specFinal,
          userMessage: text,
        });
        await this.cleanUpSession(organizationId, senderId);
        return;
      } else {
        // El servicio distingue "se lo llevó otro paciente" de "el médico dejó
        // de aceptar WhatsApp". Antes ambos casos usaban el mismo texto, y el
        // segundo le mentía al paciente: el horario seguía libre.
        const reply =
          bookingResult.reason === 'DOCTOR_NOT_BOOKABLE'
            ? MSGS.medicoNoDisponiblePorWhatsapp()
            : MSGS.slotTomado();
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(
          organizationId,
          senderId,
          ChatState.AWAITING_DATE,
        );

        await this.auditFailure(senderId, organizationId, {
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
    } else if (decision === 'NO') {
      const reply = MSGS.citaNoConfirmada();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpSession(organizationId, senderId);
      // 🪪 Dijo NO al resumen: algo de lo que dio para su ficha pudo estar mal
      // (2026-10-23: rechazó «Diana Castañeda Castañeda Ortiz»). El próximo
      // intento lo vuelve a preguntar todo, en vez de reusarlo en silencio.
      await this.redis.del(
        `temp_nombres:${organizationId}:${senderId}`,
        `temp_apellidos:${organizationId}:${senderId}`,
        this.altaKey(organizationId, senderId, 'nacimiento'),
        this.altaKey(organizationId, senderId, 'sexo'),
        this.altaKey(organizationId, senderId, 'regimen'),
        this.altaCedulaKey(organizationId, senderId),
      );

      // 📝 Auditoría: usuario rechazó la confirmación
      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.ESCAPED,
        userMessage: text,
        botReply: reply,
        metadata: { stage: 'CONFIRMATION_REJECTED' },
      });
    } else if (pregunta) {
      // ❓ Preguntó: qué cita se le va a agendar, y si nombra otro servicio que
      // no se agenda por aquí («¿esto es para las ecografías?»), con quién.
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const [servicio, fecha] = await Promise.all([
        this.redis.get(`temp_especialidad:${organizationId}:${senderId}`),
        this.redis.get(`temp_selected_date_view:${organizationId}:${senderId}`),
      ]);
      const otroServicio = servicio
        ? servicioQueNoSeAgenda(text, [servicio])
        : null;
      // 🔎 Si después confirma igual, la cita queda para revisión en la Bandeja.
      if (otroServicio) {
        await this.redis.set(
          this.preguntaOtroServicioKey(organizationId, senderId),
          JSON.stringify({
            servicio: otroServicio,
            mensaje: (text ?? '').slice(0, 300),
          }),
          'EX',
          SESSION_TTL,
        );
      }
      const reply =
        servicio && fecha
          ? otroServicio
            ? MSGS.aclararCitaOtroServicio(
                servicio,
                formatAppointmentLong(fecha),
                otroServicio,
                this.contactoDe(
                  MSGS,
                  await this.organizacionDe(organizationId),
                ),
              )
            : MSGS.aclararCitaAntesDeConfirmar(
                servicio,
                formatAppointmentLong(fecha),
              )
          : MSGS.respuestaInvalidaSiNo();
      await this.smartReply(organizationId, senderId, reply);

      await this.auditSuccess(senderId, organizationId, {
        userMessage: text,
        botReply: reply,
        metadata: {
          step: 'CONFIRMACION_CON_PREGUNTA',
          ...(otroServicio ? { pedido: otroServicio } : {}),
        },
      });
    } else {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.respuestaInvalidaSiNo();
      await this.sendWhatsAppMessage(senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: {
          invalidResponse: respuesta,
          stage: 'AWAITING_CONFIRMATION',
        },
      });
    }
  }

  /** Handler de estado: AWAITING_WAITLIST_OPTIN. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingWaitlistOptin(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const {
      organizationId,
      senderId,
      identity,
      text,
      MSGS,
      retriesKey,
      retriesCount,
    } = ctx;
    const respuesta = text?.toUpperCase().trim() || '';
    // Acepta SÍ/NO por texto y por voz (transcripción), de forma tolerante.
    const decision = this.interpretYesNo(text);

    if (decision === 'SI') {
      // El usuario acepta entrar a la cola de espera.
      const serviceId = await this.redis.get(
        `temp_waitlist_service_id:${organizationId}:${senderId}`,
      );
      const epsIdRaw = await this.redis.get(
        `temp_waitlist_eps_id:${organizationId}:${senderId}`,
      );
      const epsIdForWl = epsIdRaw && epsIdRaw.length > 0 ? epsIdRaw : null;
      const preferredDoctorIdOptin =
        (await this.redis.get(
          `temp_waitlist_doctor_id:${organizationId}:${senderId}`,
        )) || null;
      const serviceName =
        (await this.redis.get(
          `temp_especialidad:${organizationId}:${senderId}`,
        )) || '';
      const cedulaPrevia = await this.redis.get(
        `temp_cedula:${organizationId}:${senderId}`,
      );
      const nombrePrevio = await this.redis.get(
        `temp_nombre:${organizationId}:${senderId}`,
      );

      if (!serviceId) {
        const reply = MSGS.sesionExpirada();
        await this.smartReply(organizationId, senderId, reply);
        await this.cleanUpSession(organizationId, senderId);

        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.SESSION_EXPIRED,
          userMessage: text,
          botReply: reply,
          metadata: { stage: 'WAITLIST_OPTIN_NO_CONTEXT' },
        });
        return;
      }

      // Si todavía no tenemos cédula, la pedimos ahora (necesaria para la cola).
      if (!cedulaPrevia) {
        const reply = `Para unirle a la lista de espera, ¿me comparte su *número de cédula*?`;
        await this.smartReply(organizationId, senderId, reply);
        await this.setUserState(
          organizationId,
          senderId,
          ChatState.AWAITING_CEDULA,
        );
        // Marcador para que la cascada sepa que estamos en flujo waitlist-pending
        await this.redis.set(
          `temp_waitlist_pending:${organizationId}:${senderId}`,
          '1',
          'EX',
          SESSION_TTL,
        );

        await this.auditSuccess(senderId, organizationId, {
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
        identity,
        organizationId: organizationId,
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
            organizationId: organizationId,
            preferredDoctorId: preferredDoctorIdOptin,
          });
          position = result.position;
          waitlistEntryId = result.id || null;
        } catch (e: unknown) {
          this.logger.error(
            `Error agregando a waitlist (opt-in): ${getErrorMessage(e)}`,
          );
        }
      }

      const reply = MSGS.unidoAWaitlist(nombrePaciente, serviceName, position);
      await this.smartReply(organizationId, senderId, reply);

      if (waitlistEntryId && patientForWl) {
        await this.interactionLog.logWaitlistJoined({
          whatsappId: senderId,
          organizationId: organizationId,
          waitlistEntryId,
          patientCedula: cedulaPrevia,
          serviceName,
          epsName: '',
          position,
          userMessage: text,
          botReply: reply,
        });
      } else {
        await this.auditFailure(senderId, organizationId, {
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

      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.ESCAPED,
        userMessage: text,
        botReply: reply,
        metadata: { event: 'WAITLIST_OPTIN_DECLINED' },
      });
    } else {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.respuestaInvalidaSiNo();
      await this.sendWhatsAppMessage(senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidResponse: respuesta, stage: 'WAITLIST_OPTIN' },
      });
    }
  }

  /** Handler de estado: AWAITING_CANCEL_CEDULA. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingCancelCedula(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const {
      organizationId,
      senderId,
      text,
      aiData,
      MSGS,
      retriesKey,
      retriesCount,
    } = ctx;
    let cedula = '';
    if (aiData.cedula) {
      cedula = aiData.cedula;
    } else if (text) {
      const soloNumeros = text.replace(/\D/g, '');
      cedula = soloNumeros;
    }

    // No validamos longitud: se acepta cualquier número (solo rechazo si viene vacío).
    if (!cedula) {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.cancelarCedulaInvalida();
      await this.smartReply(organizationId, senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.PATIENT_NOT_FOUND,
        userMessage: text,
        botReply: reply,
        metadata: { stage: 'CANCEL_CEDULA_INVALID' },
      });
      return;
    }

    await this.redis.set(
      `temp_cancel_cedula:${organizationId}:${senderId}`,
      cedula,
      'EX',
      SESSION_TTL,
    );
    await this.handleCancelCedulaStep(organizationId, senderId, cedula);
  }

  /** Handler de estado: AWAITING_CANCEL_RETRY_CEDULA. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingCancelRetryCedula(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const { organizationId, senderId, text, MSGS, retriesKey, retriesCount } =
      ctx;
    const decision = this.interpretYesNo(text);
    const digits = (text || '').replace(/\D/g, '');

    if (decision === 'NO') {
      const reply = MSGS.cancelarDespedida();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpCancelSession(organizationId, senderId);

      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.ESCAPED,
        userMessage: text,
        botReply: reply,
        metadata: { event: 'CANCEL_RETRY_DECLINED' },
      });
    } else if (digits.length > 0 && decision !== 'SI') {
      // El paciente respondió con otra cédula directamente → la consultamos.
      await this.redis.set(
        `temp_cancel_cedula:${organizationId}:${senderId}`,
        digits,
        'EX',
        SESSION_TTL,
      );
      await this.handleCancelCedulaStep(organizationId, senderId, digits);
    } else if (decision === 'SI') {
      const reply = MSGS.cancelarPedirCedula();
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_CANCEL_CEDULA,
      );

      await this.auditSuccess(senderId, organizationId, {
        userMessage: text,
        botReply: reply,
        metadata: { step: 'CANCEL_RETRY_CEDULA_YES' },
      });
    } else {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.respuestaInvalidaSiNo();
      await this.sendWhatsAppMessage(senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidResponse: text, stage: 'CANCEL_RETRY_CEDULA' },
      });
    }
  }

  /** Handler de estado: AWAITING_CANCEL_SELECTION. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingCancelSelection(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const { organizationId, senderId, text, MSGS, retriesKey, retriesCount } =
      ctx;
    const letraElegida = this.extractOptionLetter(text);
    const aptId = await this.redis.get(
      `temp_cancel_apt_${letraElegida}:${organizationId}:${senderId}`,
    );
    const slotId = await this.redis.get(
      `temp_cancel_slot_${letraElegida}:${organizationId}:${senderId}`,
    );

    if (!aptId || !slotId) {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const maxLetra =
        (await this.redis.get(
          `temp_cancel_max_letra:${organizationId}:${senderId}`,
        )) || 'A';
      const reply = `No reconozco esa opción. Por favor, responda con una de las letras disponibles (A${maxLetra !== 'A' ? `–${maxLetra}` : ''}).`;
      await this.smartReply(organizationId, senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidLetter: letraElegida, stage: 'CANCEL_SELECTION' },
      });
      return;
    }

    await this.redis.set(
      `temp_selected_cancel_apt:${organizationId}:${senderId}`,
      aptId,
      'EX',
      SESSION_TTL,
    );
    await this.redis.set(
      `temp_selected_cancel_slot:${organizationId}:${senderId}`,
      slotId,
      'EX',
      SESSION_TTL,
    );

    const apt = await this.prisma.appointment.findUnique({
      where: { id: aptId },
      include: { scheduleSlot: { include: { doctor: true, service: true } } },
    });

    let reply = '';
    if (apt) {
      const fechaFormateada = formatAppointmentLong(apt.scheduleSlot.startTime);
      reply = MSGS.cancelarConfirmar(
        apt.scheduleSlot.service.name,
        doctorLabel(apt.scheduleSlot.doctor),
        fechaFormateada,
      );
      await this.smartReply(organizationId, senderId, reply);
    }
    await this.setUserState(
      organizationId,
      senderId,
      ChatState.AWAITING_CANCEL_CONFIRM,
    );

    await this.auditSuccess(senderId, organizationId, {
      userMessage: text,
      botReply: reply,
      metadata: {
        step: 'CANCEL_APPOINTMENT_SELECTED',
        appointmentId: aptId,
        slotId,
      },
    });
  }

  /** Handler de estado: AWAITING_CANCEL_CONFIRM. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingCancelConfirm(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const { organizationId, senderId, text, MSGS, retriesKey, retriesCount } =
      ctx;
    const respuesta = text?.toUpperCase().trim() || '';
    // Interpretación tolerante (texto y voz), igual que el resto de pasos
    // SÍ/NO. El whitelist literal anterior ('SI'/'SÍ'/'SI.'/'SÍ.') rechazaba
    // respuestas naturales ("Sí, confirmo", "claro") justo en el paso más caro
    // de fallar: el paciente ya identificó su cita y quiere cancelarla.
    // Aquí «cancelar» es SÍ (es lo que se le preguntó): ver
    // `interpretarConfirmarCancelacion`. ❓ Una pregunta no es un SÍ.
    const decisionCancelar = this.interpretarConfirmarCancelacion(text);
    const decision =
      decisionCancelar === 'SI' && esPreguntaEnVezDeRespuesta(text)
        ? null
        : decisionCancelar;

    if (decision === 'SI') {
      const aptId = await this.redis.get(
        `temp_selected_cancel_apt:${organizationId}:${senderId}`,
      );
      const slotId = await this.redis.get(
        `temp_selected_cancel_slot:${organizationId}:${senderId}`,
      );

      if (!aptId || !slotId) {
        const reply = MSGS.sesionExpirada();
        await this.smartReply(organizationId, senderId, reply);
        await this.cleanUpCancelSession(organizationId, senderId);

        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.SESSION_EXPIRED,
          userMessage: text,
          botReply: reply,
          metadata: { stage: 'CANCEL_CONFIRM_NO_DATA' },
        });
        return;
      }

      await this.cancelarCitaElegida(ctx, {
        aptId,
        slotId,
        via: null,
        limpiar: () => this.cleanUpCancelSession(organizationId, senderId),
      });
    } else if (decision === 'NO') {
      const reply = MSGS.cancelarAbortada();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpCancelSession(organizationId, senderId);

      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.ESCAPED,
        userMessage: text,
        botReply: reply,
        metadata: { event: 'CANCELLATION_ABORTED' },
      });
    } else {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.respuestaInvalidaSiNo();
      await this.sendWhatsAppMessage(senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidResponse: respuesta, stage: 'CANCEL_CONFIRM' },
      });
    }
  }

  /**
   * Cancela la cita que el paciente acaba de confirmar (SÍ).
   *
   * Sin espejo, como siempre: cita cancelada y cupo libre en una transacción, y
   * «cancelada con éxito».
   *
   * 🏥 Con espejo (H10 de la cancelación, 2026-10-15) el bot NO dice «cancelada»
   * hasta que el hospital la borra: antes lo decía al marcarla en AgenIA. Se
   * marca la cita y se espera al HIS; el cupo NO se libera todavía (si en el
   * hospital esa hora es de otro paciente, el cupo está ocupado allá):
   *   CONFIRMADA  → se libera el cupo (MIRROR), se avisa a la lista de espera y
   *                 «cancelada con éxito».
   *   NO_APLICADA → «no pude cancelarla allá»; el personal tiene el caso.
   *   PENDIENTE   → «el hospital aún la está registrando»; el cron le escribe
   *                 cuando llegue (`atenderConfirmacionesHisPendientes`).
   */
  private async cancelarCitaElegida(
    ctx: ChatTurnContext,
    p: {
      aptId: string;
      slotId: string;
      via: 'MODIFY_NO_SLOTS' | null;
      limpiar: () => Promise<void>;
    },
  ): Promise<void> {
    const { organizationId, senderId, text, MSGS } = ctx;
    const { aptId, slotId } = p;

    // 🩺 Solo citas de médicos con «WhatsApp ON» y de un servicio activo (la
    // lista ya las filtra; esto es por si la sesión guardó otra). Con espejo, la
    // base también lo frena.
    const cita = await this.prisma.appointment.findFirst({
      where: { id: aptId, organizationId },
      select: {
        patientId: true,
        scheduleSlot: {
          select: {
            startTime: true,
            doctor: { select: { whatsappBookingEnabled: true } },
            service: { select: { isActive: true } },
          },
        },
      },
    });
    if (
      cita?.scheduleSlot?.doctor?.whatsappBookingEnabled === false ||
      cita?.scheduleSlot?.service?.isActive === false
    ) {
      await this.responderCitasFueraDelAlcance({
        organizationId,
        senderId,
        MSGS,
        userMessage: text || '[audio]',
        flow: 'CANCELAR',
      });
      await p.limpiar();
      return;
    }

    // ☎️ Entre la oferta y el SÍ pudo quedar marcado el número como de otra
    // persona: entonces no se cancela (se escribiría en el hospital).
    if (
      cita?.patientId &&
      (
        await this.pacientesConTelefonoEquivocado(
          organizationId,
          isTelegramSender(senderId),
          [cita.patientId],
        )
      ).size > 0
    ) {
      const reply = MSGS.numeroYaMarcado(
        this.contactoDe(MSGS, await this.organizacionDe(organizationId)),
      );
      await this.smartReply(organizationId, senderId, reply);
      await this.auditSuccess(senderId, organizationId, {
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: {
          step: 'NUMERO_YA_MARCADO',
          flow: 'CANCELAR',
          appointmentId: aptId,
        },
      });
      await p.limpiar();
      return;
    }

    // 🕐 Entre la oferta y el SÍ pueden pasar minutos u horas: si la hora de la
    // cita ya llegó, no se cancela (en el hospital sería borrar una cita ya
    // cumplida o perdida). Con espejo, la base también lo frena (CITA_PASADA).
    const inicio = cita?.scheduleSlot?.startTime;
    if (inicio && inicio.getTime() <= Date.now()) {
      const reply = MSGS.citaYaPaso(
        this.contactoDe(MSGS, await this.organizacionDe(organizationId)),
      );
      await this.smartReply(organizationId, senderId, reply);
      await this.auditSuccess(senderId, organizationId, {
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: { step: 'CITA_YA_PASO', appointmentId: aptId },
      });
      await p.limpiar();
      return;
    }

    const conHospital = await this.requiereConfirmacionHis(organizationId);

    try {
      if (conHospital) {
        await this.prisma.appointment.update({
          where: { id: aptId },
          data: { status: 'CANCELLED' },
        });
      } else {
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
      }
    } catch (e: unknown) {
      this.logger.error(
        `Error cancelando cita${p.via ? ` (vía ${p.via})` : ''}`,
        getErrorStack(e) ?? getErrorMessage(e),
      );
      const reply = MSGS.cancelarError();
      await this.smartReply(organizationId, senderId, reply);
      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.CANCEL_ERROR,
        userMessage: text,
        botReply: reply,
        metadata: {
          error: getErrorMessage(e),
          appointmentId: aptId,
          ...(p.via ? { via: p.via } : {}),
        },
      });
      await p.limpiar();
      return;
    }

    let estado: EstadoCancelacionHis = 'CONFIRMADA';
    let fechaTexto = '';
    if (conHospital) {
      const his = this.confirmacionHis!;
      const cupo = await this.prisma.scheduleSlot.findUnique({
        where: { id: slotId },
        select: { startTime: true },
      });
      fechaTexto = cupo
        ? formatAppointmentLong(cupo.startTime, {
            timeZone: (await this.zonaHorariaDe(organizationId)) ?? undefined,
          })
        : '';
      await this.smartReply(
        organizationId,
        senderId,
        MSGS.confirmandoCancelacion(),
      );
      const seq =
        (await his.eventoDelCambio(organizationId, aptId)) ?? undefined;
      if (!seq) {
        this.logger.error(
          `Cancelación de la cita ${aptId} (org ${organizationId}) sin evento en la ` +
            'cola hacia el HIS: no se puede confirmar con el hospital.',
        );
      }
      estado = await his.esperarCancelacion(organizationId, aptId, seq);
      if (estado === 'CONFIRMADA') {
        await his.liberarCupoAnterior(organizationId, slotId);
      } else if (estado === 'PENDIENTE') {
        await his.registrarPendiente({
          organizationId,
          senderId,
          appointmentId: aptId,
          fechaTexto,
          desde: new Date().toISOString(),
          tipo: 'CANCELACION',
          seq,
          cupoAnteriorId: slotId,
        });
      }
    }

    if (estado !== 'CONFIRMADA') {
      const reply =
        estado === 'NO_APLICADA'
          ? MSGS.cancelacionNoAplicada(
              fechaTexto,
              this.contactoDe(MSGS, await this.organizacionDe(organizationId)),
            )
          : MSGS.cancelacionEnRegistro(fechaTexto);
      await this.smartReply(organizationId, senderId, reply);
      await this.auditSuccess(senderId, organizationId, {
        userMessage: text,
        botReply: reply,
        metadata: {
          event:
            estado === 'NO_APLICADA'
              ? 'APPOINTMENT_CANCEL_NOT_APPLIED_BY_HIS'
              : 'APPOINTMENT_CANCEL_PENDING_HIS',
          appointmentId: aptId,
          slotId,
          ...(p.via ? { via: p.via } : {}),
        },
      });
      await p.limpiar();
      await this.cleanUpSession(organizationId, senderId);
      return;
    }

    const replyExito = MSGS.cancelarExitosa();
    await this.smartReply(organizationId, senderId, replyExito);
    // 📝 Auditoría: cancelación exitosa
    await this.auditSuccess(senderId, organizationId, {
      userMessage: text,
      botReply: replyExito,
      metadata: {
        event: 'APPOINTMENT_CANCELLED',
        ...(p.via ? { via: p.via } : {}),
        appointmentId: aptId,
        slotId,
        ...(conHospital ? { confirmadaPorElHospital: true } : {}),
      },
    });

    // Cupo libre: se le ofrece a la lista de espera ANTES de preguntar si desea
    // agendar.
    await this.avisarListaDeEsperaCupoLiberado(organizationId, slotId);

    // ¿Le quedan otras citas del recordatorio? («cancelar las citas»): se le
    // recuerda cómo cancelar la siguiente, una por una.
    const quedan = await this.citasRecordadasDelRemitente(
      organizationId,
      ctx.identity,
    ).catch(() => []);
    if (quedan.some((c) => c.id !== aptId)) {
      await this.smartReply(organizationId, senderId, MSGS.cancelarOtraCita());
    }

    // Preguntar si desea agendar en otro horario (si se puede por el bot).
    await this.cerrarTrasCancelar(ctx, p.limpiar);
  }

  private async organizacionDe(
    organizationId: string,
  ): Promise<Organization | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
  }

  private async zonaHorariaDe(organizationId: string): Promise<string | null> {
    return (await this.organizacionDe(organizationId))?.timezone ?? null;
  }

  /**
   * Cierre tras cancelar una cita: se ofrece reagendar solo si la clínica deja
   * agendar por el bot. Si no, se despide y cierra con la encuesta, igual que
   * cuando el paciente responde que no quiere reagendar.
   */
  private async cerrarTrasCancelar(
    ctx: ChatTurnContext,
    limpiarFlujo: () => Promise<void>,
  ): Promise<void> {
    const { organizationId, senderId, MSGS } = ctx;
    if (ctx.operaciones.agendar) {
      const replyOfrecer = MSGS.cancelarOfreceAgendar();
      await this.smartReply(organizationId, senderId, replyOfrecer);
      await limpiarFlujo();
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_POST_CANCEL_CHOICE,
      );
      return;
    }
    const reply = MSGS.cancelarDespedida();
    await this.smartReply(organizationId, senderId, reply);
    await this.cleanUpSession(organizationId, senderId);
    await this.sendSurveyLink(
      organizationId,
      senderId,
      ResolutionStatus.CANCELLED,
      {
        chatSummary:
          'Cita cancelada con éxito; agendar por el asistente está apagado, no se ofreció reagendar.',
      },
    );
  }

  /** Handler de estado: AWAITING_POST_CANCEL_CHOICE. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingPostCancelChoice(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const {
      organizationId,
      senderId,
      text,
      MSGS,
      botName,
      orgName,
      retriesKey,
      retriesCount,
    } = ctx;
    const respuesta = text?.toUpperCase().trim() || '';
    // Tolerante a SÍ/NO natural (texto y voz), como el resto de pasos SÍ/NO.
    const decision = this.interpretYesNo(text);

    if (decision === 'SI') {
      // Tras cancelar, ofrecer menú con letras (Paso 1 del nuevo protocolo).
      const { lineas, count } = await this.buildServiceMenu(
        organizationId,
        senderId,
      );
      const reply =
        count > 0
          ? await this.menuServiciosPresentandose({
              organizationId,
              senderId,
              MSGS,
              orgName,
              botName,
              lineas,
            })
          : MSGS.bienvenida(
              orgName,
              'Ej: Medicina General, Odontología',
              botName,
            );
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_SPECIALTY,
      );

      await this.auditSuccess(senderId, organizationId, {
        userMessage: text,
        botReply: reply,
        metadata: { event: 'POST_CANCEL_NEW_BOOKING_STARTED' },
      });
    } else if (decision === 'NO') {
      const reply = MSGS.cancelarDespedida();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpSession(organizationId, senderId);

      await this.auditSuccess(senderId, organizationId, {
        userMessage: text,
        botReply: reply,
        metadata: { event: 'POST_CANCEL_DECLINED' },
      });

      // ⭐ ESCENARIO 3 — CSAT: el flujo principal de cancelación cerró con
      // éxito (cita ya cancelada en AWAITING_CANCEL_CONFIRM) y el paciente
      // declinó reagendar → este es el punto terminal del flujo. Si en
      // cambio acepta reagendar, el cierre BOOKED engancha su propia
      // encuesta, evitando enviar dos encuestas en una misma sesión.
      await this.sendSurveyLink(
        organizationId,
        senderId,
        ResolutionStatus.CANCELLED,
        {
          chatSummary:
            'Cita cancelada con éxito; el paciente no quiso reagendar.',
        },
      );
    } else {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.respuestaInvalidaSiNo();
      await this.sendWhatsAppMessage(senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidResponse: respuesta, stage: 'POST_CANCEL_CHOICE' },
      });
    }
  }

  /** Handler de estado: AWAITING_INTERRUPT_CONFIRMATION. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingInterruptConfirmation(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const { organizationId, senderId, text, MSGS, retriesKey, retriesCount } =
      ctx;
    // Tolerante a SÍ/NO natural (texto), igual que los demás pasos SÍ/NO.
    const decision = this.interpretYesNo(text);
    const prevState = await this.redis.get(
      `temp_interrupt_prev_state:${organizationId}:${senderId}`,
    );

    // 🔒 La clínica apagó cancelar entre la pregunta y la respuesta.
    if (decision === 'SI' && !ctx.operaciones.cancelar) {
      await this.redis.del(
        `temp_interrupt_prev_state:${organizationId}:${senderId}`,
      );
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });
      await this.responderOperacionNoDisponible({
        organizationId,
        senderId,
        text,
        org,
        orgName: ctx.orgName,
        botName: ctx.botName,
        MSGS,
        motivo: 'CANCELAR',
        operaciones: ctx.operaciones,
      });
      return;
    }

    if (decision === 'SI') {
      // Confirmó: abandonamos el agendamiento e iniciamos la cancelación,
      // reutilizando el MISMO arranque del flujo existente (pedir cédula).
      await this.redis.del(
        `temp_interrupt_prev_state:${organizationId}:${senderId}`,
      );
      await this.cleanUpSession(organizationId, senderId);
      await this.redis.set(
        `is_ai_flow:${organizationId}:${senderId}`,
        'false',
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.cancelarPedirCedula();
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_CANCEL_CEDULA,
      );

      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.CANCELLATION_FLOW,
        userMessage: text,
        botReply: reply,
        metadata: {
          event: 'SCHEDULING_INTERRUPT_CONFIRMED',
          interruptedState: prevState,
        },
      });
    } else if (decision === 'NO') {
      // Rechazó: restauramos el estado anterior y retomamos el agendamiento
      // justo donde iba. El estado restaurado hace que el próximo mensaje
      // del paciente se procese en el paso correcto.
      await this.redis.del(
        `temp_interrupt_prev_state:${organizationId}:${senderId}`,
      );
      const restoreState =
        (prevState as ChatState) || ChatState.AWAITING_SPECIALTY;
      await this.setUserState(organizationId, senderId, restoreState);
      const reply = MSGS.interrupcionRetomar();
      await this.smartReply(organizationId, senderId, reply);

      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.ESCAPED,
        userMessage: text,
        botReply: reply,
        metadata: {
          event: 'SCHEDULING_INTERRUPT_DECLINED',
          restoredState: restoreState,
        },
      });
    } else {
      // No se entendió la respuesta: re-preguntamos SÍ/NO y penalizamos
      // reintento, igual que el resto de pasos estrictos.
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.respuestaInvalidaSiNo();
      await this.sendWhatsAppMessage(senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidResponse: text, stage: 'INTERRUPT_CONFIRM' },
      });
    }
  }

  /** Handler de estado: AWAITING_MODIFY_CEDULA. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingModifyCedula(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const {
      organizationId,
      senderId,
      text,
      aiData,
      MSGS,
      retriesKey,
      retriesCount,
    } = ctx;
    let cedula = '';
    if (aiData.cedula) {
      cedula = aiData.cedula;
    } else if (text) {
      cedula = text.replace(/\D/g, '');
    }

    if (!cedula) {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.cancelarCedulaInvalida();
      await this.smartReply(organizationId, senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.PATIENT_NOT_FOUND,
        userMessage: text,
        botReply: reply,
        metadata: { stage: 'MODIFY_CEDULA_INVALID' },
      });
      return;
    }

    await this.redis.set(
      `temp_modify_cedula:${organizationId}:${senderId}`,
      cedula,
      'EX',
      SESSION_TTL,
    );
    await this.handleModifyCedulaStep(organizationId, senderId, cedula);
  }

  /** Handler de estado: AWAITING_MODIFY_RETRY_CEDULA. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingModifyRetryCedula(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const { organizationId, senderId, text, MSGS, retriesKey, retriesCount } =
      ctx;
    const decision = this.interpretYesNo(text);
    const digits = (text || '').replace(/\D/g, '');

    if (decision === 'NO') {
      const reply = MSGS.cancelarDespedida();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpModifySession(organizationId, senderId);

      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.ESCAPED,
        userMessage: text,
        botReply: reply,
        metadata: { event: 'MODIFY_RETRY_DECLINED' },
      });
    } else if (digits.length > 0 && decision !== 'SI') {
      // El paciente respondió con otra cédula directamente → la consultamos.
      await this.redis.set(
        `temp_modify_cedula:${organizationId}:${senderId}`,
        digits,
        'EX',
        SESSION_TTL,
      );
      await this.handleModifyCedulaStep(organizationId, senderId, digits);
    } else if (decision === 'SI') {
      const reply = MSGS.modificarPedirCedula();
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_MODIFY_CEDULA,
      );

      await this.auditSuccess(senderId, organizationId, {
        userMessage: text,
        botReply: reply,
        metadata: { step: 'MODIFY_RETRY_CEDULA_YES' },
      });
    } else {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.respuestaInvalidaSiNo();
      await this.sendWhatsAppMessage(senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidResponse: text, stage: 'MODIFY_RETRY_CEDULA' },
      });
    }
  }

  /** Handler de estado: AWAITING_MODIFY_SELECTION. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingModifySelection(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const { organizationId, senderId, text, retriesKey, retriesCount } = ctx;
    const letraElegida = this.extractOptionLetter(text);
    const aptId = await this.redis.get(
      `temp_modify_apt_${letraElegida}:${organizationId}:${senderId}`,
    );
    const slotId = await this.redis.get(
      `temp_modify_slot_${letraElegida}:${organizationId}:${senderId}`,
    );

    if (!aptId || !slotId) {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const maxLetra =
        (await this.redis.get(
          `temp_modify_max_letra:${organizationId}:${senderId}`,
        )) || 'A';
      const reply = `No reconozco esa opción. Por favor, responda con una de las letras disponibles (A${maxLetra !== 'A' ? `–${maxLetra}` : ''}).`;
      await this.smartReply(organizationId, senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidLetter: letraElegida, stage: 'MODIFY_SELECTION' },
      });
      return;
    }

    await this.redis.set(
      `temp_selected_modify_apt:${organizationId}:${senderId}`,
      aptId,
      'EX',
      SESSION_TTL,
    );
    await this.redis.set(
      `temp_selected_modify_slot:${organizationId}:${senderId}`,
      slotId,
      'EX',
      SESSION_TTL,
    );
    await this.offerModifySlots(organizationId, senderId, aptId);
  }

  /** Handler de estado: AWAITING_MODIFY_NEW_SLOT. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingModifyNewSlot(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const { organizationId, senderId, text, MSGS, retriesKey, retriesCount } =
      ctx;
    const letraElegida = this.extractOptionLetter(text);
    const newSlotId = await this.redis.get(
      `temp_modify_newslot_${letraElegida}:${organizationId}:${senderId}`,
    );
    const newSlotFecha = await this.redis.get(
      `temp_modify_newslot_${letraElegida}_fecha:${organizationId}:${senderId}`,
    );

    if (!newSlotId || !newSlotFecha) {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const maxLetra =
        (await this.redis.get(
          `temp_modify_newslot_max_letra:${organizationId}:${senderId}`,
        )) || 'A';
      const reply = `No reconozco esa opción. Por favor, responda con una de las letras disponibles (A${maxLetra !== 'A' ? `–${maxLetra}` : ''}).`;
      await this.smartReply(organizationId, senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidLetter: letraElegida, stage: 'MODIFY_NEW_SLOT' },
      });
      return;
    }

    await this.redis.set(
      `temp_selected_modify_newslot:${organizationId}:${senderId}`,
      newSlotId,
      'EX',
      SESSION_TTL,
    );
    await this.redis.set(
      `temp_selected_modify_newslot_fecha:${organizationId}:${senderId}`,
      newSlotFecha,
      'EX',
      SESSION_TTL,
    );

    const aptId = await this.redis.get(
      `temp_selected_modify_apt:${organizationId}:${senderId}`,
    );
    const apt = aptId
      ? await this.prisma.appointment.findUnique({
          where: { id: aptId },
          include: {
            scheduleSlot: { include: { doctor: true, service: true } },
            patient: { select: { cedula: true } },
          },
        })
      : null;

    if (!apt) {
      const reply = MSGS.sesionExpirada();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpModifySession(organizationId, senderId);
      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { stage: 'MODIFY_NEW_SLOT_NO_APT' },
      });
      return;
    }

    // 🚦 LÍMITE DE CITAS: mover la cita a un día o un mes en el que ya tiene
    // el máximo sería otra forma de saltárselo. La cita que se mueve no cuenta
    // contra sí misma (moverla dentro del mismo día o mes siempre se puede).
    if (
      await this.rejectIfOverAppointmentLimit({
        organizationId,
        senderId,
        cedula: apt.patient?.cedula,
        fecha: newSlotFecha,
        MSGS,
        userMessage: text,
        operacion: 'RESCHEDULE',
        excluirCitaId: apt.id,
        servicio: apt.scheduleSlot.service.name,
      })
    ) {
      return;
    }

    const fechaActual = formatAppointmentLong(apt.scheduleSlot.startTime);
    const fechaNueva = formatAppointmentLong(newSlotFecha);
    const reply = MSGS.modificarConfirmar(
      apt.scheduleSlot.service.name,
      doctorLabel(apt.scheduleSlot.doctor),
      fechaActual,
      fechaNueva,
    );
    await this.smartReply(organizationId, senderId, reply);
    await this.setUserState(
      organizationId,
      senderId,
      ChatState.AWAITING_MODIFY_CONFIRM,
    );

    await this.auditSuccess(senderId, organizationId, {
      userMessage: text,
      botReply: reply,
      metadata: {
        step: 'MODIFY_NEW_SLOT_SELECTED',
        appointmentId: apt.id,
        newSlotId,
      },
    });
  }

  /** Handler de estado: AWAITING_MODIFY_CONFIRM. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingModifyConfirm(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const { organizationId, senderId, text, MSGS, retriesKey, retriesCount } =
      ctx;
    const decision = this.decisionSiNoSinPreguntas(text);

    if (decision === 'SI') {
      const aptId = await this.redis.get(
        `temp_selected_modify_apt:${organizationId}:${senderId}`,
      );
      const oldSlotId = await this.redis.get(
        `temp_selected_modify_slot:${organizationId}:${senderId}`,
      );
      const newSlotId = await this.redis.get(
        `temp_selected_modify_newslot:${organizationId}:${senderId}`,
      );
      const newSlotFecha = await this.redis.get(
        `temp_selected_modify_newslot_fecha:${organizationId}:${senderId}`,
      );

      if (!aptId || !oldSlotId || !newSlotId || !newSlotFecha) {
        const reply = MSGS.sesionExpirada();
        await this.smartReply(organizationId, senderId, reply);
        await this.cleanUpModifySession(organizationId, senderId);

        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.SESSION_EXPIRED,
          userMessage: text,
          botReply: reply,
          metadata: { stage: 'MODIFY_CONFIRM_NO_DATA' },
        });
        return;
      }

      // 🏥 H10 para el cambio de fecha: con espejo, el cambio se confirma solo
      // cuando el HIS lo registra. Mientras tanto el cupo de ANTES sigue
      // reservado: si el HIS lo rechaza, la cita vuelve a él
      // (`MirrorDispatchService.markRejectedByHis`) sin que nadie se lo haya
      // llevado entre tanto. Sin espejo, se libera en el acto, como siempre.
      // ☎️ Entre la elección y el SÍ pudo quedar marcado el número como de otra
      // persona: entonces no se mueve (se escribiría en el hospital).
      const deQuienEs = await this.prisma.appointment.findFirst({
        where: { id: aptId, organizationId },
        select: { patientId: true },
      });
      if (
        deQuienEs?.patientId &&
        (
          await this.pacientesConTelefonoEquivocado(
            organizationId,
            isTelegramSender(senderId),
            [deQuienEs.patientId],
          )
        ).size > 0
      ) {
        const reply = MSGS.numeroYaMarcado(
          this.contactoDe(MSGS, await this.organizacionDe(organizationId)),
        );
        await this.smartReply(organizationId, senderId, reply);
        await this.cleanUpModifySession(organizationId, senderId);
        await this.auditSuccess(senderId, organizationId, {
          userMessage: text,
          botReply: reply,
          metadata: {
            step: 'NUMERO_YA_MARCADO',
            flow: 'MODIFICAR',
            appointmentId: aptId,
          },
        });
        return;
      }
      // 🚦 El cambio de fecha hace su propia transacción y NO pasa por
      // `bookAppointment`: el límite de citas se revisa otra vez aquí, porque
      // pudo entrarle otra cita desde que eligió el cupo.
      if (this.limiteCitas) {
        const citaAMover = await this.prisma.appointment.findUnique({
          where: { id: aptId },
          select: { patient: { select: { cedula: true } } },
        });
        if (
          await this.rejectIfOverAppointmentLimit({
            organizationId,
            senderId,
            cedula: citaAMover?.patient?.cedula,
            fecha: newSlotFecha,
            MSGS,
            userMessage: text,
            operacion: 'RESCHEDULE',
            excluirCitaId: aptId,
          })
        ) {
          return;
        }
      }

      const esperaAlHospital =
        await this.requiereConfirmacionHis(organizationId);

      try {
        // Reprogramación atómica: validamos que el nuevo cupo siga libre,
        // movemos la cita a él, ocupamos el nuevo y (sin espejo) liberamos el
        // anterior.
        await this.prisma.$transaction(async (tx) => {
          const newSlot = await tx.scheduleSlot.findUnique({
            where: { id: newSlotId },
            include: {
              doctor: { select: { whatsappBookingEnabled: true } },
              service: { select: { isActive: true } },
            },
          });
          if (
            !newSlot ||
            !newSlot.doctor ||
            !newSlot.isAvailable ||
            newSlot.organizationId !== organizationId
          ) {
            throw new Error('NEW_SLOT_TAKEN');
          }
          // 🚦 El reagendamiento hace su propia transacción y NO pasa por
          // `bookAppointment`, así que el interruptor del médico hay que
          // revalidarlo también aquí — si no, apagar a un médico impediría
          // reservar con él pero no MOVER una cita hacia su agenda, y el
          // hueco seguiría abierto por la puerta de atrás.
          if (
            !newSlot.doctor.whatsappBookingEnabled ||
            newSlot.service?.isActive === false
          ) {
            throw new Error('NEW_SLOT_DOCTOR_NOT_BOOKABLE');
          }
          // ⏱️ Anticipación mínima, también al confirmar el cambio: si ya empieza
          // muy pronto, es un cupo que ya no está y se le ofrecen otros.
          if (!cumpleAnticipacionAlReservar(newSlot.startTime, new Date())) {
            throw new Error('NEW_SLOT_TAKEN');
          }
          // 📅 Ni hacia un día u hora sin citas por el asistente.
          if (
            await cupoBloqueadoParaElAsistente(
              tx,
              organizationId,
              newSlot.startTime,
            )
          ) {
            throw new Error('NEW_SLOT_TAKEN');
          }
          // 🗓️ Ni más allá del plazo máximo para agendar.
          if (
            await fueraDelPlazoParaElAsistente(
              tx,
              organizationId,
              newSlot.startTime,
            )
          ) {
            throw new Error('NEW_SLOT_TAKEN');
          }
          await tx.appointment.update({
            where: { id: aptId },
            data: { scheduleSlotId: newSlotId },
          });
          if (!esperaAlHospital) {
            await tx.scheduleSlot.update({
              where: { id: oldSlotId },
              data: { isAvailable: true },
            });
          }
          await tx.scheduleSlot.update({
            where: { id: newSlotId },
            data: { isAvailable: false },
          });
        });

        const fechaNuevaFmt = formatAppointmentLong(newSlotFecha);
        let cupoAnteriorLibre = !esperaAlHospital;

        if (esperaAlHospital && this.confirmacionHis) {
          const cupoAnterior = await this.prisma.scheduleSlot.findUnique({
            where: { id: oldSlotId },
          });
          const fechaAnteriorFmt = cupoAnterior
            ? formatAppointmentLong(cupoAnterior.startTime)
            : '';
          const enElHospital = await this.confirmarCambioConElHospital({
            organizationId,
            senderId,
            MSGS,
            appointmentId: aptId,
            cupoNuevoId: newSlotId,
            cupoAnteriorId: oldSlotId,
            fechaTexto: fechaNuevaFmt,
            fechaAnteriorTexto: fechaAnteriorFmt,
          });

          if (enElHospital === 'RECHAZADA') {
            // La cita ya volvió a su hora de antes (la API la revirtió al
            // recibir el rechazo): se le dice y se le ofrecen otros horarios.
            const reply = MSGS.cambioRechazadoPorHospital(
              fechaNuevaFmt,
              fechaAnteriorFmt,
            );
            await this.smartReply(organizationId, senderId, reply);
            await this.auditFailure(senderId, organizationId, {
              reason: FailureReason.SLOT_TAKEN,
              userMessage: text,
              botReply: reply,
              metadata: {
                stage: 'MODIFY_RECHAZADO_POR_HIS',
                appointmentId: aptId,
                oldSlotId,
                newSlotId,
              },
            });
            await this.offerModifySlots(organizationId, senderId, aptId);
            return;
          }
          if (enElHospital === 'PENDIENTE') {
            // Ya se le dijo que se le escribe al quedar registrado; el barrido
            // de pendientes libera el cupo de antes cuando el HIS confirme.
            await this.auditSuccess(senderId, organizationId, {
              userMessage: text,
              botReply: MSGS.cambioEnRegistro(fechaNuevaFmt),
              metadata: {
                event: 'APPOINTMENT_RESCHEDULE_PENDING_HIS',
                appointmentId: aptId,
                oldSlotId,
                newSlotId,
              },
            });
            await this.cleanUpModifySession(organizationId, senderId);
            return;
          }
          if (enElHospital === 'ANULADA') {
            // La cita se anuló mientras se esperaba al hospital: no hay cambio
            // que confirmar.
            const reply = MSGS.modificarError();
            await this.smartReply(organizationId, senderId, reply);
            await this.auditFailure(senderId, organizationId, {
              reason: FailureReason.MODIFY_ERROR,
              userMessage: text,
              botReply: reply,
              metadata: {
                stage: 'MODIFY_CITA_ANULADA_EN_ESPERA',
                appointmentId: aptId,
              },
            });
            await this.cleanUpModifySession(organizationId, senderId);
            return;
          }
          // CONFIRMADA: el HIS ya anuló la cita vieja; su cupo queda libre.
          cupoAnteriorLibre = await this.confirmacionHis.liberarCupoAnterior(
            organizationId,
            oldSlotId,
          );
        }

        const replyOk = MSGS.modificarExitosa(fechaNuevaFmt);
        await this.smartReply(organizationId, senderId, replyOk);

        await this.auditSuccess(senderId, organizationId, {
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
        if (cupoAnteriorLibre) {
          await this.avisarListaDeEsperaCupoLiberado(organizationId, oldSlotId);
        }

        await this.cleanUpModifySession(organizationId, senderId);
        // ⭐ CSAT: la reprogramación deja una cita activa → encuesta BOOKED.
        await this.sendSurveyLink(
          organizationId,
          senderId,
          ResolutionStatus.BOOKED,
          {
            chatSummary: `Cita reprogramada para ${fechaNuevaFmt}.`,
          },
        );
      } catch (e: unknown) {
        this.logger.error(
          'Error reprogramando cita',
          getErrorStack(e) ?? getErrorMessage(e),
        );
        // El nuevo cupo fue tomado por otro paciente entre tanto → volver a ofrecer.
        const mensaje = e instanceof Error ? e.message : undefined;
        if (
          mensaje === 'NEW_SLOT_TAKEN' ||
          mensaje === 'NEW_SLOT_DOCTOR_NOT_BOOKABLE'
        ) {
          // Dos motivos distintos con el mismo desenlace (volver a ofrecer),
          // pero mensajes distintos: decir "lo tomó otro paciente" cuando el
          // cupo sigue libre le hace perder el tiempo a quien luego llama.
          const reply =
            mensaje === 'NEW_SLOT_DOCTOR_NOT_BOOKABLE'
              ? MSGS.medicoNoDisponiblePorWhatsapp()
              : MSGS.slotTomado();
          await this.smartReply(organizationId, senderId, reply);
          await this.auditFailure(senderId, organizationId, {
            reason: FailureReason.SLOT_TAKEN,
            userMessage: text,
            botReply: reply,
            metadata: {
              stage: 'MODIFY_NEW_SLOT_TAKEN',
              appointmentId: aptId,
              newSlotId,
            },
          });
          // Reofrecemos cupos frescos para el mismo appointment.
          await this.offerModifySlots(organizationId, senderId, aptId);
          return;
        }
        const reply = MSGS.modificarError();
        await this.smartReply(organizationId, senderId, reply);
        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.MODIFY_ERROR,
          userMessage: text,
          botReply: reply,
          metadata: { error: getErrorMessage(e), appointmentId: aptId },
        });
        await this.cleanUpModifySession(organizationId, senderId);
      }
    } else if (decision === 'NO') {
      // No confirma el cambio → dejamos la cita en su fecha original.
      const reply = MSGS.modificarAbortada();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpModifySession(organizationId, senderId);

      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.ESCAPED,
        userMessage: text,
        botReply: reply,
        metadata: { event: 'MODIFY_ABORTED' },
      });
    } else {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.respuestaInvalidaSiNo();
      await this.sendWhatsAppMessage(senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidResponse: text, stage: 'MODIFY_CONFIRM' },
      });
    }
  }

  /** Handler de estado: AWAITING_MODIFY_NO_SLOTS_CANCEL. Extraído de processIncomingMessageUnsafe (#2). */
  private async handleAwaitingModifyNoSlotsCancel(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const { organizationId, senderId, text, MSGS, retriesKey, retriesCount } =
      ctx;
    // No había cupos para reprogramar. SÍ → cancelamos la cita; NO → no tocamos nada.
    const decision = this.decisionSiNoSinPreguntas(text);

    if (decision === 'SI') {
      const aptId = await this.redis.get(
        `temp_selected_modify_apt:${organizationId}:${senderId}`,
      );
      const slotId = await this.redis.get(
        `temp_selected_modify_slot:${organizationId}:${senderId}`,
      );

      if (!aptId || !slotId) {
        const reply = MSGS.sesionExpirada();
        await this.smartReply(organizationId, senderId, reply);
        await this.cleanUpModifySession(organizationId, senderId);

        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.SESSION_EXPIRED,
          userMessage: text,
          botReply: reply,
          metadata: { stage: 'MODIFY_NO_SLOTS_CANCEL_NO_DATA' },
        });
        return;
      }

      // Reutiliza la cancelación (y su cierre: ofrecer reagendar).
      await this.cancelarCitaElegida(ctx, {
        aptId,
        slotId,
        via: 'MODIFY_NO_SLOTS',
        limpiar: () => this.cleanUpModifySession(organizationId, senderId),
      });
    } else if (decision === 'NO') {
      // El paciente prefiere conservar su cita: NO tocamos nada.
      const reply = MSGS.modificarSinCambios();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpModifySession(organizationId, senderId);

      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.ESCAPED,
        userMessage: text,
        botReply: reply,
        metadata: { event: 'MODIFY_NO_SLOTS_KEEP_APPOINTMENT' },
      });
    } else {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.respuestaInvalidaSiNo();
      await this.sendWhatsAppMessage(senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { invalidResponse: text, stage: 'MODIFY_NO_SLOTS_CANCEL' },
      });
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
    // Pasada multi-etapa de español hablado → dígitos. El ORDEN importa: los
    // compuestos largos se reemplazan ANTES que los simples, así "noventa y
    // nueve" se convierte en "99" antes de que "noventa" se vuelva "90". Los
    // dígitos producidos se separan por espacios y luego se concatenan en
    // orden, así "noventa, noventa, noventa" → "909090" y "uno cero ocho ocho"
    // → "1088". Solo cubre 0–99 (más "cien"): los pacientes que dictan cédula
    // suelen usar dígitos sueltos o pares; los "ciento X" se omiten porque
    // crearían ambigüedad ("ciento ocho" ≠ "108" si el siguiente número se
    // pega como dígito independiente).
    let s = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); // quita tildes

    // (1) Decenas + "y" + unidad: 31..99 excepto 21..29 (que es "veintiX").
    const decenas: Record<string, number> = {
      treinta: 30,
      cuarenta: 40,
      cincuenta: 50,
      sesenta: 60,
      setenta: 70,
      ochenta: 80,
      noventa: 90,
    };
    const unidades: Record<string, number> = {
      uno: 1,
      una: 1,
      dos: 2,
      tres: 3,
      cuatro: 4,
      cinco: 5,
      seis: 6,
      siete: 7,
      ocho: 8,
      nueve: 9,
    };
    const decRe = Object.keys(decenas).join('|');
    const uniRe = Object.keys(unidades).join('|');
    s = s.replace(
      new RegExp(`\\b(${decRe})\\s+y\\s+(${uniRe})\\b`, 'g'),
      (_m, d: string, u: string) => ` ${decenas[d] + unidades[u]} `,
    );

    // (2) Compuestos "veintiX" (21..29) — palabra única.
    const veinti: Record<string, number> = {
      veintiuno: 21,
      veintiuna: 21,
      veintidos: 22,
      veintitres: 23,
      veinticuatro: 24,
      veinticinco: 25,
      veintiseis: 26,
      veintisiete: 27,
      veintiocho: 28,
      veintinueve: 29,
    };
    for (const [w, n] of Object.entries(veinti)) {
      s = s.replace(new RegExp(`\\b${w}\\b`, 'g'), ` ${n} `);
    }

    // (3) Adolescentes 10..19.
    const teens: Record<string, number> = {
      diez: 10,
      once: 11,
      doce: 12,
      trece: 13,
      catorce: 14,
      quince: 15,
      dieciseis: 16,
      diecisiete: 17,
      dieciocho: 18,
      diecinueve: 19,
    };
    for (const [w, n] of Object.entries(teens)) {
      s = s.replace(new RegExp(`\\b${w}\\b`, 'g'), ` ${n} `);
    }

    // (4) Decenas sueltas 20..90.
    s = s.replace(/\bveinte\b/g, ' 20 ');
    for (const [w, n] of Object.entries(decenas)) {
      s = s.replace(new RegExp(`\\b${w}\\b`, 'g'), ` ${n} `);
    }

    // (5) "cien" → 100 (solo cuando va solo; "ciento X" no se cubre).
    s = s.replace(/\bcien\b/g, ' 100 ');

    // (6) Dígitos sueltos 0..9.
    const singles: Record<string, number> = { cero: 0, ...unidades };
    for (const [w, n] of Object.entries(singles)) {
      s = s.replace(new RegExp(`\\b${w}\\b`, 'g'), ` ${n} `);
    }

    // (7) Cualquier otra letra/símbolo fuera: quedan solo dígitos en orden.
    return s.replace(/\D/g, '');
  }

  /**
   * ❓ SÍ/NO de un paso que agenda, mueve o cancela una cita: como
   * `interpretYesNo`, pero una pregunta no cuenta como SÍ («¿Esto si es para las
   * ecografías?», 2026-10-23). Un «no» sigue siendo no; la pregunta cae al
   * «responda SÍ o NO» de cada paso.
   */
  private decisionSiNoSinPreguntas(
    text: string | undefined | null,
  ): 'SI' | 'NO' | null {
    const decision = this.interpretYesNo(text);
    return decision === 'SI' && esPreguntaEnVezDeRespuesta(text)
      ? null
      : decision;
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

    const noRegex =
      /\b(no|nop|nel|negativo|nunca|cancelar|cancela|para nada|no gracias)\b/;
    const siRegex =
      /\b(si|sip|sii+|claro|dale|ok|okay|oka|listo|bueno|vale|por supuesto|afirmativo|correcto|exacto|de una|asi es|eso es|confirmo|confirmar|acepto|aceptar|quiero|deseo)\b/;

    // "no" gana cuando aparece explícito (p.ej. "no quiero", "no gracias") para
    // evitar falsos positivos con palabras afirmativas en la misma frase.
    if (noRegex.test(t)) return 'NO';
    if (siRegex.test(t)) return 'SI';
    return null;
  }

  /**
   * SÍ/NO del paso «¿cancelo esta cita?». Aquí «cancelar», «cancélela» o «anúlela»
   * son SÍ: es justo lo que se le preguntó. En los demás pasos SÍ/NO «cancelar» es
   * abandonar (`interpretYesNo`), y con esa regla este paso tomaba «sí, cancelar»
   * por NO y le dejaba la cita a quien la quería cancelar (2026-10-15).
   */
  private interpretarConfirmarCancelacion(
    text: string | undefined | null,
  ): 'SI' | 'NO' | null {
    if (!text) return null;
    const t = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return null;
    if (
      /\bno (la |lo |me la )?(cancel\w*|cansel\w*|anul\w*)|\b(mantener\w*|mantenga\w*|conservar\w*|dejarla|dejela|dejenla|dejala)\b/.test(
        t,
      )
    ) {
      return 'NO';
    }
    if (/\b(cancel\w*|cansel\w*|anul\w*)\b/.test(t)) return 'SI';
    return this.interpretYesNo(text);
  }

  // Extrae la LETRA de opción (A–Z) que eligió el usuario, tolerando voz.
  // Por texto el usuario escribe "A"; por voz el STT transcribe la letra como
  // su nombre fonético ("be", "ce", "efe"), con muletillas ("ah", "eh") o
  // antepuesta a "opción/letra/la" ("la a", "opción dos", "la primera").
  //
  // Es CONSERVADOR a propósito: solo resuelve cuando el enunciado es en esencia
  // la selección (letra suelta, nombre de letra, u ordinal/número, con prefijo
  // opcional). Así evita falsos positivos al interpretar preposiciones sueltas
  // ("de", "se") dentro de una frase larga. Devuelve '' si no reconoce nada.
  private extractOptionLetter(text: string | undefined | null): string {
    if (!text) return '';
    const t = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // quita tildes
      .replace(/[^\w\s]/g, ' ') // signos de puntuación → espacio
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';

    // Una sola letra (caso típico por texto): "a", "b".
    if (/^[a-z]$/.test(t)) return t.toUpperCase();

    // Quita el prefijo introductorio ("opción/letra/la/el/número") y se queda
    // con el núcleo de la selección. El `+` exterior encadena varios rellenos
    // seguidos ("la opción a" = "la " + "opcion "): con un solo `replace` sin
    // repetición, "la opción a" solo perdía "la " y quedaba "opcion a" (no
    // coincide con ninguna letra ni fonética) → la selección por voz más
    // natural en español se reportaba como "Esa opción no se logró
    // identificar" pese a que el STT transcribió bien.
    const core = t
      .replace(
        /^(?:(?:la|el|las|los|opcion|opciones|letra|numero|numeral)\s+)+/,
        '',
      )
      .trim();

    // Nombre fonético de la letra dicho solo (incluye errores típicos del STT).
    const phonetic: Record<string, string> = {
      a: 'A',
      ah: 'A',
      ha: 'A',
      be: 'B',
      ve: 'B',
      uve: 'B',
      ce: 'C',
      se: 'C',
      de: 'D',
      e: 'E',
      eh: 'E',
      efe: 'F',
      ge: 'G',
      je: 'G',
      hache: 'H',
      ache: 'H',
      i: 'I',
      y: 'I',
      jota: 'J',
      ka: 'K',
      ca: 'K',
      ele: 'L',
      eme: 'M',
      ene: 'N',
      enie: 'Ñ',
      o: 'O',
      oh: 'O',
      pe: 'P',
      cu: 'Q',
      erre: 'R',
      ere: 'R',
      ese: 'S',
      te: 'T',
      u: 'U',
      equis: 'X',
      ye: 'Y',
      zeta: 'Z',
      seta: 'Z',
    };
    if (core in phonetic) return phonetic[core];
    if (/^[a-z]$/.test(core)) return core.toUpperCase();

    // Ordinal o número dicho solo: "primera"/"uno"/"1" → A, "segunda"/"dos" → B…
    const ordinal: Record<string, number> = {
      primera: 1,
      primero: 1,
      uno: 1,
      una: 1,
      '1': 1,
      segunda: 2,
      segundo: 2,
      dos: 2,
      '2': 2,
      tercera: 3,
      tercero: 3,
      tres: 3,
      '3': 3,
      cuarta: 4,
      cuarto: 4,
      cuatro: 4,
      '4': 4,
      quinta: 5,
      quinto: 5,
      cinco: 5,
      '5': 5,
      sexta: 6,
      sexto: 6,
      seis: 6,
      '6': 6,
      septima: 7,
      septimo: 7,
      siete: 7,
      '7': 7,
      octava: 8,
      octavo: 8,
      ocho: 8,
      '8': 8,
    };
    if (core in ordinal) return String.fromCharCode(64 + ordinal[core]);

    // La misma letra dicha dos o tres veces: el STT transcribe «A a» o «be, be»
    // cuando el paciente repite la letra para que se le entienda (caso real en
    // el menú de servicios, 2026-09-28). Sin ambigüedad solo si TODAS las
    // palabras son la misma letra: «a b» o «a medicina» no eligen nada.
    const partes = core.split(' ');
    if (partes.length >= 2 && partes.length <= 3) {
      const letras = partes.map((p) =>
        /^[a-z]$/.test(p) ? p.toUpperCase() : (phonetic[p] ?? ''),
      );
      if (letras[0] && letras.every((l) => l === letras[0])) return letras[0];
    }

    return '';
  }

  /**
   * Reserva el cupo que la lista de espera le ofreció al paciente y le contesta.
   * Sale de `handleWaitlistConfirmStep` para poder retomarla después de pedirle
   * el régimen (`handleAwaitingRegime`), sin duplicar la confirmación.
   */
  private async reservarCupoDeLista(
    organizationId: string,
    senderId: string,
    text: string | undefined,
    MSGS: ReturnType<typeof buildMessages>,
    slotId: string,
    patientId: string,
    epsId: string | null,
  ): Promise<void> {
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      include: { eps: true },
    });

    // 🚨 La EPS de la CITA es la de la entrada en la lista (null = particular), no
    // la de la ficha. Antes se usaba `patient.epsId`: un paciente del padrón de Sura
    // que entró a la lista como PARTICULAR salía agendado —y facturado— por Sura, y
    // uno que entró por su EPS pero con la ficha sin EPS, como particular.
    const eps = epsId
      ? await this.prisma.eps.findUnique({ where: { id: epsId } })
      : null;
    const epsNombre = eps?.name || PARTICULAR_EPS_NAME;

    const bookingResult = await this.appointmentsService.bookAppointment(
      patientId,
      slotId,
      epsId,
      isTelegramSender(senderId) ? 'TELEGRAM' : 'WHATSAPP',
      organizationId,
    );

    if (bookingResult.success) {
      const slot = await this.prisma.scheduleSlot.findUnique({
        where: { id: slotId },
        include: { doctor: true, service: true },
      });
      const fechaFormateada = slot ? formatAppointmentLong(slot.startTime) : '';

      // 🏥 H10: tampoco se confirma un cupo de la lista sin el hospital.
      const enElHospital = await this.confirmarConElHospital({
        organizationId,
        senderId,
        MSGS,
        appointmentId: bookingResult.appointmentId,
        fechaTexto: fechaFormateada,
      });
      if (enElHospital === 'RECHAZADA') {
        await this.smartReply(organizationId, senderId, MSGS.slotTomado());
        await this.cleanUpSession(organizationId, senderId);
        return;
      }
      if (enElHospital === 'PENDIENTE') {
        await this.cleanUpSession(organizationId, senderId);
        return;
      }
      const orgInfo = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });
      const reply = MSGS.citaConfirmada(
        orgInfo?.name || 'nuestra Clínica',
        fechaFormateada,
      );
      const confirmacion: OutboundMessageContext = {
        kind: 'BOOKING_CONFIRMATION',
        appointmentId: bookingResult.appointmentId,
      };
      await this.smartReply(
        organizationId,
        senderId,
        reply,
        undefined,
        confirmacion,
      );

      // En flujo de VOZ el paciente solo escuchó la confirmación; le dejamos
      // un resumen escrito como respaldo. `sendWhatsAppMessage` directo (no
      // `smartReply`) para garantizar texto y no re-sintetizar a audio.
      const isVoiceFlow =
        (await this.redis.get(`is_ai_flow:${organizationId}:${senderId}`)) ===
        'true';
      if (isVoiceFlow && slot && patient) {
        await this.sendWhatsAppMessage(
          senderId,
          MSGS.resumenCitaConfirmadaTexto(
            patient.fullName || 'Paciente',
            patient.cedula,
            epsNombre,
            slot.service.name,
            fechaFormateada,
          ),
          confirmacion,
        );
      }

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
          epsName: eps?.name,
          userMessage: text,
          botReply: reply,
        });
      }
    } else if (bookingResult.reason === 'PATIENT_REGIME_MISSING') {
      // Quien entró a la lista de espera no pasó por el alta: la lista no
      // alimenta al HIS y no se le preguntó el régimen. Ahora que el cupo SÍ va
      // al hospital, se le pregunta aquí y se reserva el MISMO cupo al contestar
      // (`handleAwaitingRegime`). El cupo no se ocupó: sigue libre mientras tanto.
      await this.redis.set(
        this.listaRegimenKey(organizationId, senderId),
        JSON.stringify({ slotId, patientId, epsId }),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.pedirRegimen(epsNombre);
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_REGIME,
      );
      await this.extenderSesionDeAlta(organizationId, senderId);
      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.PATIENT_REGIME_MISSING,
        userMessage: text,
        botReply: reply,
        metadata: {
          stage: 'WAITLIST_PATIENT_REGIME_MISSING',
          slotId,
          patientId,
        },
      });
    } else if (
      bookingResult.reason === 'PATIENT_LIMIT_REACHED' &&
      bookingResult.limite
    ) {
      // 🚦 El cupo que liberó la lista de espera le daría más citas de las
      // permitidas ese día o ese mes. Mismo aviso que al agendar.
      const slot = await this.prisma.scheduleSlot.findUnique({
        where: { id: slotId },
        include: { service: true },
      });
      await this.avisarLimiteDeCitas({
        organizationId,
        senderId,
        MSGS,
        limite: bookingResult.limite,
        operacion: 'BOOKING',
        fecha: slot?.startTime ?? bookingResult.limite.periodo.desde,
        servicio: slot?.service?.name,
        userMessage: text,
      });
    } else if (bookingResult.reason === 'EPS_REGIME_NOT_BILLABLE') {
      // No es un cupo: es su EPS+régimen sin convenio (ver la nota gemela
      // en handleConfirmationStep). No tiene sentido devolverlo a la lista
      // de espera de ESTE cupo — el problema no es el horario.
      const reply = MSGS.epsRegimenNoFacturable();
      await this.smartReply(organizationId, senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.EPS_REGIME_NOT_BILLABLE,
        userMessage: text,
        botReply: reply,
        metadata: {
          stage: 'WAITLIST_EPS_REGIME_NOT_BILLABLE',
          slotId,
          patientId,
        },
      });
    } else {
      // El servicio distingue "se lo llevó otro paciente" de "el médico dejó
      // de aceptar WhatsApp". Antes ambos casos usaban el mismo texto, y el
      // segundo le mentía al paciente: el horario seguía libre.
      const reply =
        bookingResult.reason === 'DOCTOR_NOT_BOOKABLE'
          ? MSGS.medicoNoDisponiblePorWhatsapp()
          : MSGS.slotTomado();
      await this.smartReply(organizationId, senderId, reply);

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SLOT_TAKEN,
        userMessage: text,
        botReply: reply,
        metadata: { stage: 'WAITLIST_SLOT_TAKEN', slotId, patientId },
      });
    }
  }

  private async handleWaitlistConfirmStep(
    organizationId: string,
    senderId: string,
    text: string | undefined,
  ) {
    // Sombra del pool de mensajes según el estilo activo de la org.
    const MSGS = buildMessages(
      await this.organizationSettings.getCommunicationStyle(organizationId),
      canalDe(senderId),
    );
    const respuesta = text?.toUpperCase().trim() || '';
    // Acepta SÍ/NO por texto y por voz (transcripción), de forma tolerante.
    // ❓ Una pregunta no es un SÍ: reserva el cupo.
    const decision = this.decisionSiNoSinPreguntas(text);

    if (decision === 'SI') {
      const { slotId, patientId, epsId } =
        await this.waitlistService.confirmFromWaitlist({
          whatsappId: senderId,
          organizationId,
          confirmed: true,
        });

      if (!slotId || !patientId) {
        const reply = MSGS.sesionExpirada();
        await this.smartReply(organizationId, senderId, reply);
        await this.cleanUpSession(organizationId, senderId);

        await this.auditFailure(senderId, organizationId, {
          reason: FailureReason.SESSION_EXPIRED,
          userMessage: text,
          botReply: reply,
          metadata: { stage: 'WAITLIST_CONFIRM_NO_DATA' },
        });
        return;
      }

      await this.reservarCupoDeLista(
        organizationId,
        senderId,
        text,
        MSGS,
        slotId,
        patientId,
        epsId,
      );
    } else if (decision === 'NO') {
      await this.waitlistService.confirmFromWaitlist({
        whatsappId: senderId,
        organizationId,
        confirmed: false,
      });
      const reply = MSGS.waitlistCupoRechazado();
      await this.smartReply(organizationId, senderId, reply);

      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.ESCAPED,
        userMessage: text,
        botReply: reply,
        metadata: { event: 'WAITLIST_OFFER_REJECTED' },
      });
    } else {
      const reply = MSGS.respuestaInvalidaSiNo();
      await this.sendWhatsAppMessage(senderId, reply);

      await this.auditFailure(senderId, organizationId, {
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
  // CONSULTA DE CITAS ("¿qué citas tengo?") — solo lectura
  // ──────────────────────────────────────────────────────────────
  // Fase A: muestra las citas registradas en AgenIA (que, con el alta en
  // caliente, ya incluyen las agendadas en el hospital desde que se encendió).
  // NO le pregunta al HIS en vivo: si la clínica tiene hospital, lo advierte.
  //
  // Regla de identidad (decisión del 2026-10-02): el detalle (servicio,
  // médico, hora) solo se muestra si quien escribe es el paciente
  // (remitenteEsDelPaciente). A cualquier otro, una respuesta mínima que no
  // distingue "no existe ese documento" de "no tiene citas".
  // ══════════════════════════════════════════════════════════════

  /**
   * ¿El texto PREGUNTA por citas ya agendadas? Frases de [lookup] contenidas
   * en el texto sin tildes ni signos, con dos salvedades: «no tengo cita» es lo
   * contrario, y si en el mismo mensaje pide cancelar, cambiar o agendar, manda
   * eso (lo resuelven sus propios flujos o el LLM).
   */
  private esConsultaDeCitas(text: string | undefined | null): boolean {
    const t = sinTildes(textoParaCoincidencia(text));
    // «Consultar» A SECAS es consultar sus citas (decisión del 2026-10-03:
    // en prueba se leía como «quiero una consulta médica» y abría el menú).
    // Solo como mensaje completo: contenida, «quiero consultar con un
    // médico» abriría la consulta de citas.
    if (t === 'consultar') return true;
    if (!t || !this.lookupRegex.test(t)) return false;
    if (/(?:^| )no (?:tengo|tiene|tenemos)(?= |$)/.test(t)) return false;
    return !/(?:^| )(?:cancel\w*|anul\w*|cambi\w*|reprogram\w*|reagend\w*|modific\w*|mover|muev\w*|agendar\w*|agendame|reservar|separar|sacar|pedir|recordatorios?)(?= |$)/.test(
      t,
    );
  }

  /** Una cédula escrita en el mismo mensaje («mis citas, cédula 1088123456»). */
  private cedulaEnTexto(text: string | undefined | null): string | null {
    const m = /\d[\d.\s]{4,}\d/.exec(text ?? '');
    const digits = m ? m[0].replace(/\D/g, '') : '';
    return digits.length >= 5 ? digits : null;
  }

  /**
   * Arranca la consulta. Orden: la cédula del mensaje; si no hay, el paciente
   * que identifica al remitente (si es UNO solo); si no, se pide la cédula.
   * Terminal: el caller hace return tras llamar.
   */
  private async startLookupFlow(p: {
    organizationId: string;
    senderId: string;
    identity: SenderIdentity;
    text: string | undefined;
    isAudio: boolean;
    cedula: string | null;
    MSGS: ReturnType<typeof buildMessages>;
    via: 'text_regex' | 'voice_regex' | 'llm';
  }): Promise<void> {
    const { organizationId, senderId, identity, text, isAudio, MSGS, via } = p;
    await this.cleanUpSession(organizationId, senderId);
    await this.redis.set(
      `is_ai_flow:${organizationId}:${senderId}`,
      isAudio ? 'true' : 'false',
      'EX',
      SESSION_TTL,
    );
    if (/(?:^| )hoy(?= |$)/.test(sinTildes(textoParaCoincidencia(text)))) {
      await this.redis.set(
        `temp_lookup_hoy:${organizationId}:${senderId}`,
        '1',
        'EX',
        SESSION_TTL,
      );
    }

    const cedula = (p.cedula ?? '').replace(/\D/g, '');
    if (cedula) {
      await this.showLookup({
        organizationId,
        senderId,
        identity,
        cedula,
        userMessage: text || '[audio]',
        MSGS,
        via,
      });
      return;
    }

    const propios = await this.pacientesDelRemitente(organizationId, identity);
    if (propios.length === 1) {
      await this.showLookup({
        organizationId,
        senderId,
        identity,
        cedula: propios[0].cedula,
        userMessage: text || '[audio]',
        MSGS,
        via,
      });
      return;
    }

    // Ninguno, o varios (un celular compartido por la familia): que diga de quién.
    const reply = MSGS.consultaPedirCedula();
    await this.smartReply(organizationId, senderId, reply);
    await this.setUserState(
      organizationId,
      senderId,
      ChatState.AWAITING_LOOKUP_CEDULA,
    );
    await this.auditSuccess(senderId, organizationId, {
      userMessage: text || '[audio]',
      botReply: reply,
      metadata: {
        step: 'LOOKUP_ASK_CEDULA',
        via,
        perfilesDelRemitente: propios.length,
      },
    });
  }

  /**
   * Fichas de esta clínica que responden al canal de quien escribe. La consulta
   * es un primer filtro; la decisión la toma `remitenteEsDelPaciente`, la misma
   * regla que decide si se muestra el detalle.
   */
  private async pacientesDelRemitente(
    organizationId: string,
    identity: SenderIdentity,
  ): Promise<PatientProfile[]> {
    const or: Prisma.PatientProfileWhereInput[] = [];
    if (identity.telegramChatId) {
      or.push({ telegramChatId: identity.telegramChatId });
    } else {
      const telefonos = variantesDeTelefono(
        (identity.phone ?? '').replace(/\D/g, ''),
      );
      if (telefonos.length > 0) or.push({ whatsappId: { in: telefonos } });
      if (identity.bsuid) or.push({ bsuid: identity.bsuid });
    }
    if (or.length === 0) return [];
    const candidatos = await this.prisma.patientProfile.findMany({
      where: { organizationId, OR: or },
      take: 5,
    });
    const propios = candidatos.filter((c) =>
      remitenteEsDelPaciente(c, identity),
    );
    // ☎️ Una ficha con el teléfono marcado como de otra persona no es «propia».
    const marcados = await this.pacientesConTelefonoEquivocado(
      organizationId,
      !!identity.telegramChatId,
      propios.map((c) => c.id),
    );
    return propios.filter((c) => !marcados.has(c.id));
  }

  /** Busca y responde. Deja la sesión en AWAITING_LOOKUP_CHOICE o cerrada. */
  private async showLookup(p: {
    organizationId: string;
    senderId: string;
    identity: SenderIdentity;
    cedula: string;
    userMessage: string;
    MSGS: ReturnType<typeof buildMessages>;
    via: string;
  }): Promise<void> {
    const { organizationId, senderId, identity, cedula, userMessage, MSGS } = p;
    const ahora = new Date();
    const [org, mirror, patient, operaciones] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { supportPhone: true, timezone: true },
      }),
      this.prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId },
        select: {
          enabled: true,
          lookupEnabled: true,
          botLookupMode: true,
          lastLookupCapable: true,
          lastHeartbeatAt: true,
          lastHisReachable: true,
        },
      }),
      this.prisma.patientProfile.findFirst({
        where: { cedula, organizationId },
      }),
      // 🔒 La consulta solo ofrece lo que la clínica deja hacer por el bot.
      this.operacionesDisponibles(organizationId),
    ]);
    const timeZone = org?.timezone || undefined;
    const contacto = org?.supportPhone
      ? MSGS.contactoClinica(org.supportPhone)
      : MSGS.contactoClinicaSinTelefono();
    // El estado de la conexión PARA EL BOT (su interruptor, no el del personal).
    // Queda en la bitácora con cada consulta.
    const { modo: modoBot, conexion } = this.consultaHis
      ? this.consultaHis.conexionDelBot(mirror, ahora)
      : {
          modo: 'OFF' as const,
          conexion: estadoConexionHis(
            mirror ? { ...mirror, lookupEnabled: false } : null,
            ahora,
          ),
        };
    const pidioHoy = !!(await this.redis.get(
      `temp_lookup_hoy:${organizationId}:${senderId}`,
    ));

    // Desde la medianoche local: «¿qué citas tengo hoy?» a las 3 p. m. debe ver
    // también la de las 8 a. m. (sigue SCHEDULED hasta que alguien la cierre).
    const citas = patient
      ? await this.prisma.appointment.findMany({
          where: {
            patientId: patient.id,
            status: 'SCHEDULED',
            scheduleSlot: {
              startTime: { gte: inicioDelDiaLocal(ahora, timeZone) },
            },
          },
          include: {
            scheduleSlot: { include: { doctor: true, service: true } },
          },
          orderBy: { scheduleSlot: { startTime: 'asc' } },
          take: 20,
        })
      : [];
    const hoy = diaLocal(ahora, timeZone);
    const deHoy = citas.filter(
      (c) => diaLocal(c.scheduleSlot.startTime, timeZone) === hoy,
    );
    const futuras = citas.filter((c) => c.scheduleSlot.startTime >= ahora);
    // Sin "hoy" solo cuenta lo que no ha pasado; con "hoy", también lo de hoy.
    const relevantes = pidioHoy
      ? citas.filter((c) => deHoy.includes(c) || futuras.includes(c))
      : futuras;

    // ☎️ Con el teléfono marcado como de otra persona, como si escribiera otro.
    const esDelRemitente =
      !!patient &&
      remitenteEsDelPaciente(patient, identity) &&
      (
        await this.pacientesConTelefonoEquivocado(
          organizationId,
          !!identity.telegramChatId,
          [patient.id],
        )
      ).size === 0;
    const metadata: Record<string, unknown> = {
      via: p.via,
      conexionHis: conexion.estado,
      motivoConexionHis: conexion.motivo,
      modoBotHis: modoBot,
      citas: relevantes.length,
      pidioHoy,
      soloConsultas: soloConsultas(operaciones),
      operaciones,
    };

    if (!esDelRemitente) {
      const reply =
        relevantes.length > 0
          ? MSGS.consultaMinima(String(relevantes.length), contacto)
          : MSGS.consultaMinimaSinCitas(contacto);
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpSession(organizationId, senderId);
      // Sin la cédula en la bitácora: quien la escribió no probó ser su dueño.
      await this.auditSuccess(senderId, organizationId, {
        userMessage: '[cédula]',
        botReply: reply,
        metadata: {
          ...metadata,
          step: 'LOOKUP_MINIMAL',
          pacienteExiste: !!patient,
        },
      });
      return;
    }

    // Fase B: ¿se le pregunta al HIS? Solo aquí, con el remitente ya probado.
    const plan: PlanHisBot = this.consultaHis
      ? await this.consultaHis.planificar({
          organizationId,
          senderId,
          patient,
          modo: modoBot,
          conexion,
          ahora,
          timeZone,
        })
      : { accion: 'SIN_CONSULTA' };
    metadata.accionHis = plan.accion;
    if (plan.accion === 'CONSULTANDO') metadata.requestId = plan.requestId;
    // En sombra el paciente ve exactamente la Fase A: se consulta para medir.
    const hisVisible = modoBot === 'ON';
    let aviso = '';
    if (hisVisible && plan.accion === 'CONSULTANDO') {
      aviso = `\n\n${MSGS.consultaConfirmandoHospital()}`;
    } else if (hisVisible && plan.accion === 'REUTILIZADA') {
      // Ya se sabe qué tiene el hospital: sin advertencia, y lo nuevo, a la vista.
      aviso =
        plan.nuevas.length > 0
          ? `\n\n${MSGS.consultaHisNuevas(this.lineasHis(plan.nuevas, MSGS, timeZone), contacto)}`
          : '';
    } else if (conexion.estado !== 'SIN_HOSPITAL') {
      aviso = `\n\n${MSGS.consultaAvisoHospital(contacto)}`;
    }

    if (relevantes.length === 0) {
      const reply =
        (operaciones.agendar
          ? MSGS.consultaSinCitas(patient.fullName)
          : soloConsultas(operaciones)
            ? MSGS.consultaSinCitasSoloLectura(patient.fullName, contacto)
            : MSGS.consultaSinCitasSinAgendar(patient.fullName, contacto)) +
        aviso;
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpSession(organizationId, senderId);
      await this.auditSuccess(senderId, organizationId, {
        userMessage,
        botReply: reply,
        metadata: { ...metadata, step: 'LOOKUP_NONE' },
      });
      return;
    }

    const linea = (c: (typeof citas)[number]) =>
      `• ${c.scheduleSlot.service.name} · ${doctorLabel(c.scheduleSlot.doctor)} · ` +
      formatAppointmentCompact(c.scheduleSlot.startTime, { timeZone });
    let cuerpo: string;
    if (pidioHoy) {
      const despues = futuras.filter((c) => !deHoy.includes(c));
      cuerpo =
        `${MSGS.consultaTituloHoy()}\n` +
        (deHoy.length > 0
          ? deHoy.map(linea).join('\n')
          : MSGS.consultaSinCitasHoy());
      if (despues.length > 0) {
        cuerpo += `\n\n${MSGS.consultaTituloProximas()}\n${despues.map(linea).join('\n')}`;
      }
    } else {
      cuerpo = relevantes.map(linea).join('\n');
    }

    // 🔒 Solo consultas: el detalle cierra con quién comunicarse en lugar de
    // las opciones A-D, y la conversación vuelve a IDLE (no hay qué elegir).
    if (soloConsultas(operaciones)) {
      const reply =
        MSGS.consultaDetalle(patient.fullName, cuerpo) +
        aviso +
        `\n\n${MSGS.consultaSoloLectura(contacto)}`;
      await this.smartReply(
        organizationId,
        senderId,
        reply,
        MSGS.consultaDetalleAudioSoloLectura(patient.fullName),
      );
      await this.cleanUpSession(organizationId, senderId);
      await this.auditSuccess(senderId, organizationId, {
        userMessage,
        botReply: reply,
        metadata: { ...metadata, step: 'LOOKUP_SHOWN', patientId: patient.id },
      });
      return;
    }

    // Solo lo que la clínica deja hacer por el bot, con letras seguidas; lo
    // demás, con quién hacerlo. Las opciones quedan en la sesión: la letra que
    // responda el paciente se lee contra ESTA lista, no contra una fija.
    const opciones = opcionesDeConsulta(operaciones);
    const noDisponibles = (
      ['CANCELAR', 'MODIFICAR', 'AGENDAR'] as const
    ).filter((op) => !operaciones[CLAVE_OPERACION[op]]);
    const reply =
      MSGS.consultaDetalle(patient.fullName, cuerpo) +
      aviso +
      `\n\n${MSGS.consultaOpcionesDe(lineasOpcionesConsulta(opciones))}` +
      (noDisponibles.length > 0
        ? `\n\n${MSGS.consultaNoDisponibles(accionesNoDisponibles(noDisponibles), contacto)}`
        : '');
    await this.redis.set(
      `temp_lookup_cedula:${organizationId}:${senderId}`,
      patient.cedula,
      'EX',
      SESSION_TTL,
    );
    await this.redis.set(
      `temp_lookup_opciones:${organizationId}:${senderId}`,
      JSON.stringify(opciones),
      'EX',
      SESSION_TTL,
    );
    // En voz: el audio solo anuncia; el listado va por texto. Si no se puede
    // cancelar ni cambiar, el audio no lo promete.
    await this.smartReply(
      organizationId,
      senderId,
      reply,
      operaciones.cancelar || operaciones.modificar
        ? MSGS.consultaDetalleAudio(patient.fullName)
        : MSGS.consultaDetalleAudioSoloLectura(patient.fullName),
    );
    await this.setUserState(
      organizationId,
      senderId,
      ChatState.AWAITING_LOOKUP_CHOICE,
    );
    await this.auditSuccess(senderId, organizationId, {
      userMessage,
      botReply: reply,
      metadata: { ...metadata, step: 'LOOKUP_SHOWN', patientId: patient.id },
    });
  }

  /** Las citas que solo están en el hospital, una por línea, con nombres. */
  private lineasHis(
    citas: CitaHisParaMostrar[],
    MSGS: ReturnType<typeof buildMessages>,
    timeZone: string | undefined,
  ): string {
    return citas
      .map(
        (c) =>
          `• ${c.servicio || MSGS.consultaCitaHospital()}` +
          (c.medico ? ` · ${c.medico}` : '') +
          ` · ${formatAppointmentCompact(new Date(c.startIso), { timeZone })}`,
      )
      .join('\n');
  }

  /** ¿Esta clínica espeja al HIS? Solo entonces hay que esperar al hospital. */
  private async requiereConfirmacionHis(
    organizationId: string,
  ): Promise<boolean> {
    return this.confirmacionHis
      ? this.confirmacionHis.requiereConfirmacion(organizationId)
      : false;
  }

  /**
   * 🏥 H10 para el CAMBIO de fecha: le pide al paciente unos segundos y espera
   * a que el HIS registre el cambio. Si no responde a tiempo, NO confirma: le
   * dice que se le escribe al quedar registrado y deja el cambio en la lista
   * que atiende `atenderConfirmacionesHisPendientes` (que también libera el
   * cupo de antes al confirmarse).
   */
  private async confirmarCambioConElHospital(p: {
    organizationId: string;
    senderId: string;
    MSGS: ReturnType<typeof buildMessages>;
    appointmentId: string;
    cupoNuevoId: string;
    cupoAnteriorId: string;
    fechaTexto: string;
    fechaAnteriorTexto: string;
  }): Promise<EstadoCambioHis> {
    const his = this.confirmacionHis!;
    await this.smartReply(
      p.organizationId,
      p.senderId,
      p.MSGS.confirmandoCambio(),
    );
    const seq =
      (await his.eventoDelCambio(p.organizationId, p.appointmentId)) ??
      undefined;
    if (!seq) {
      this.logger.error(
        `Cambio de fecha de la cita ${p.appointmentId} (org ${p.organizationId}) ` +
          'sin evento en la cola hacia el HIS: no se puede confirmar con el hospital.',
      );
    }
    const estado = await his.esperarCambio(
      p.organizationId,
      p.appointmentId,
      seq,
      p.cupoNuevoId,
    );
    if (estado === 'PENDIENTE') {
      await his.registrarPendiente({
        organizationId: p.organizationId,
        senderId: p.senderId,
        appointmentId: p.appointmentId,
        fechaTexto: p.fechaTexto,
        desde: new Date().toISOString(),
        tipo: 'CAMBIO',
        seq,
        cupoNuevoId: p.cupoNuevoId,
        cupoAnteriorId: p.cupoAnteriorId,
        fechaAnteriorTexto: p.fechaAnteriorTexto,
      });
      await this.smartReply(
        p.organizationId,
        p.senderId,
        p.MSGS.cambioEnRegistro(p.fechaTexto),
      );
    }
    return estado;
  }

  /** Un cupo quedó libre: se le ofrece al primero de la lista de espera. */
  private async avisarListaDeEsperaCupoLiberado(
    organizationId: string,
    slotId: string,
  ): Promise<void> {
    const cupo = await this.prisma.scheduleSlot.findUnique({
      where: { id: slotId },
      include: { doctor: true },
    });
    if (!cupo) return;
    try {
      await this.waitlistService.notifyWaitlist({
        slotId: cupo.id,
        serviceId: cupo.serviceId,
        epsId: cupo.allowedEpsId,
        organizationId,
        doctorName: cupo.doctor.fullName,
        slotDate: cupo.startTime,
      });
    } catch (e: unknown) {
      this.logger.error(
        `Error notificando waitlist (reprogramación): ${getErrorMessage(e)}`,
      );
    }
  }

  /**
   * 🏥 H10 (docs/PLAN_AGENDA_HUECOS.md): espera a que la cita quede registrada
   * en el HIS antes de confirmarla. Mientras, le dice al paciente que espere
   * unos segundos. Si el hospital no responde a tiempo, NO confirma: le dice que
   * se le escribe al quedar registrada y deja la cita en la lista que atiende
   * `atenderConfirmacionesHisPendientes`. Sin espejo (o sin el servicio), la
   * cita vive solo en AgenIA y se confirma como siempre.
   */
  private async confirmarConElHospital(p: {
    organizationId: string;
    senderId: string;
    MSGS: ReturnType<typeof buildMessages>;
    appointmentId: string | undefined;
    fechaTexto: string;
  }): Promise<'CONFIRMADA' | 'RECHAZADA' | 'PENDIENTE'> {
    if (!this.confirmacionHis || !p.appointmentId) return 'CONFIRMADA';
    if (!(await this.confirmacionHis.requiereConfirmacion(p.organizationId))) {
      return 'CONFIRMADA';
    }

    await this.smartReply(
      p.organizationId,
      p.senderId,
      p.MSGS.confirmandoCita(),
    );
    const estado = await this.confirmacionHis.esperar(
      p.organizationId,
      p.appointmentId,
    );
    if (estado === 'PENDIENTE') {
      await this.confirmacionHis.registrarPendiente({
        organizationId: p.organizationId,
        senderId: p.senderId,
        appointmentId: p.appointmentId,
        fechaTexto: p.fechaTexto,
        desde: new Date().toISOString(),
      });
      await this.smartReply(
        p.organizationId,
        p.senderId,
        p.MSGS.citaEnRegistro(p.fechaTexto),
      );
    }
    return estado;
  }

  /**
   * 🏥 H10, segundo mensaje: las citas cuyo registro en el HIS no llegó a
   * tiempo. Cada 10 s. Confirmada → confirmación final. Rechazada → se le
   * avisa y se le invita a elegir otro horario. Sin resultado en 24 h → se
   * abandona (la bandeja de excepciones ya avisó al personal).
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async atenderConfirmacionesHisPendientes(): Promise<void> {
    if (!this.confirmacionHis) return;
    try {
      const pendientes = await this.confirmacionHis.pendientes();
      for (const p of pendientes) {
        try {
          const vencida =
            Date.now() - new Date(p.desde).getTime() >
            ABANDONO_CONFIRMACION_HIS_MS;
          if (p.tipo === 'CANCELACION') {
            const estado = await this.confirmacionHis.estadoCancelacion(
              p.organizationId,
              p.appointmentId,
              p.seq,
            );
            if (estado === 'PENDIENTE' && !vencida) continue;
            if (!(await this.confirmacionHis.reclamar(p))) continue;
            await this.atenderCancelacionHisPendiente(p, estado, vencida);
            continue;
          }
          if (p.tipo === 'CAMBIO') {
            const estado = await this.confirmacionHis.estadoCambio(
              p.organizationId,
              p.appointmentId,
              p.seq,
              p.cupoNuevoId ?? '',
            );
            if (estado === 'PENDIENTE' && !vencida) continue;
            if (!(await this.confirmacionHis.reclamar(p))) continue;
            await this.atenderCambioHisPendiente(p, estado, vencida);
            continue;
          }
          const estado = await this.confirmacionHis.estado(
            p.organizationId,
            p.appointmentId,
          );
          if (estado === 'PENDIENTE' && !vencida) continue;
          if (!(await this.confirmacionHis.reclamar(p))) continue;
          await this.atenderConfirmacionHisPendiente(p, estado, vencida);
        } catch (error: unknown) {
          this.logger.error(
            `Confirmación pendiente del HIS (cita ${p.appointmentId}) falló: ${getErrorMessage(error)}`,
          );
        }
      }
      await this.alertasTecnicas?.cronBien('confirmaciones-his');
    } catch (error: unknown) {
      this.logger.error(
        `Barrido de confirmaciones pendientes del HIS falló: ${getErrorMessage(error)}`,
      );
      await this.alertasTecnicas?.cronFallo(
        'confirmaciones-his',
        'Confirmaciones del HIS al paciente',
        error,
      );
    }
  }

  private async atenderConfirmacionHisPendiente(
    p: {
      organizationId: string;
      senderId: string;
      appointmentId: string;
      fechaTexto: string;
    },
    estado: 'CONFIRMADA' | 'RECHAZADA' | 'PENDIENTE',
    vencida: boolean,
  ): Promise<void> {
    const { organizationId, senderId } = p;
    const MSGS = buildMessages(
      await this.organizationSettings.getCommunicationStyle(organizationId),
      canalDe(senderId),
    );
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, supportPhone: true },
    });

    let reply: string | null = null;
    if (estado === 'CONFIRMADA') {
      reply = MSGS.citaConfirmada(org?.name || 'nuestra Clínica', p.fechaTexto);
      await this.smartReply(organizationId, senderId, reply, undefined, {
        kind: 'BOOKING_CONFIRMATION',
        appointmentId: p.appointmentId,
      });
    } else if (estado === 'RECHAZADA') {
      const contacto = org?.supportPhone
        ? MSGS.contactoClinica(org.supportPhone)
        : MSGS.contactoClinicaSinTelefono();
      reply = MSGS.citaNoRegistradaEnHospital(p.fechaTexto, contacto);
      await this.smartReply(organizationId, senderId, reply);
    }

    await this.auditLog(senderId, organizationId, {
      status:
        estado === 'CONFIRMADA'
          ? InteractionStatus.SUCCESS
          : InteractionStatus.FAILED,
      userMessage: '[confirmación del hospital]',
      botReply: reply ?? '[sin mensaje: confirmación abandonada tras 24 h]',
      metadata: {
        stage: 'HIS_CONFIRMATION_FOLLOWUP',
        appointmentId: p.appointmentId,
        estado,
        vencida,
      },
    });
  }

  /**
   * 🏥 H10, segundo mensaje de un CAMBIO de fecha cuyo registro en el HIS no
   * llegó a tiempo. Confirmado → se libera el cupo de antes (y se le ofrece a la
   * lista de espera) y se le confirma al paciente. Rechazado → la cita ya
   * volvió a su hora de antes: se le avisa. Anulada o sin resultado en 24 h →
   * no se le escribe (la bandeja de excepciones ya avisó al personal; el
   * barrido de agenda reabre el cupo de antes si el hospital lo tiene libre).
   */
  private async atenderCambioHisPendiente(
    p: ConfirmacionPendiente,
    estado: EstadoCambioHis,
    vencida: boolean,
  ): Promise<void> {
    const { organizationId, senderId } = p;
    const MSGS = buildMessages(
      await this.organizationSettings.getCommunicationStyle(organizationId),
      canalDe(senderId),
    );

    let reply: string | null = null;
    if (estado === 'CONFIRMADA') {
      if (
        p.cupoAnteriorId &&
        (await this.confirmacionHis!.liberarCupoAnterior(
          organizationId,
          p.cupoAnteriorId,
        ))
      ) {
        await this.avisarListaDeEsperaCupoLiberado(
          organizationId,
          p.cupoAnteriorId,
        );
      }
      reply = MSGS.modificarExitosa(p.fechaTexto);
      await this.smartReply(organizationId, senderId, reply);
    } else if (estado === 'RECHAZADA') {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { supportPhone: true },
      });
      const contacto = org?.supportPhone
        ? MSGS.contactoClinica(org.supportPhone)
        : MSGS.contactoClinicaSinTelefono();
      reply = MSGS.cambioNoRegistradoEnHospital(
        p.fechaTexto,
        p.fechaAnteriorTexto ?? '',
        contacto,
      );
      await this.smartReply(organizationId, senderId, reply);
    }

    await this.auditLog(senderId, organizationId, {
      status:
        estado === 'CONFIRMADA'
          ? InteractionStatus.SUCCESS
          : InteractionStatus.FAILED,
      userMessage: '[confirmación del hospital]',
      botReply:
        reply ??
        (estado === 'ANULADA'
          ? '[sin mensaje: la cita se anuló mientras se esperaba al hospital]'
          : '[sin mensaje: confirmación abandonada tras 24 h]'),
      metadata: {
        stage: 'HIS_RESCHEDULE_FOLLOWUP',
        appointmentId: p.appointmentId,
        estado,
        vencida,
      },
    });
  }

  /**
   * 🏥 H10, segundo mensaje de una CANCELACIÓN cuyo registro en el HIS no llegó
   * a tiempo. Confirmada → se libera el cupo (y se le ofrece a la lista de
   * espera) y se le confirma al paciente. No aplicada → se le dice; el personal
   * tiene el caso en la bandeja. Sin resultado en 24 h → no se le escribe (la
   * bandeja ya avisó al personal).
   */
  private async atenderCancelacionHisPendiente(
    p: ConfirmacionPendiente,
    estado: EstadoCancelacionHis,
    vencida: boolean,
  ): Promise<void> {
    const { organizationId, senderId } = p;
    const MSGS = buildMessages(
      await this.organizationSettings.getCommunicationStyle(organizationId),
      canalDe(senderId),
    );

    let reply: string | null = null;
    if (estado === 'CONFIRMADA') {
      if (
        p.cupoAnteriorId &&
        (await this.confirmacionHis!.liberarCupoAnterior(
          organizationId,
          p.cupoAnteriorId,
        ))
      ) {
        await this.avisarListaDeEsperaCupoLiberado(
          organizationId,
          p.cupoAnteriorId,
        );
      }
      reply = MSGS.cancelacionConfirmadaDespues(p.fechaTexto);
    } else if (estado === 'NO_APLICADA') {
      reply = MSGS.cancelacionNoAplicada(
        p.fechaTexto,
        this.contactoDe(MSGS, await this.organizacionDe(organizationId)),
      );
    }
    if (reply) await this.smartReply(organizationId, senderId, reply);

    await this.auditLog(senderId, organizationId, {
      status:
        estado === 'CONFIRMADA'
          ? InteractionStatus.SUCCESS
          : InteractionStatus.FAILED,
      userMessage: '[confirmación del hospital]',
      botReply: reply ?? '[sin mensaje: confirmación abandonada tras 24 h]',
      metadata: {
        stage: 'HIS_CANCEL_FOLLOWUP',
        appointmentId: p.appointmentId,
        estado,
        vencida,
      },
    });
  }

  /**
   * Fase B, segundo mensaje (D5): atiende los resultados del HIS que el bot
   * pidió. Cada 5 s; reclamar es un compare-and-set, así que con varias réplicas
   * solo una le escribe al paciente.
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async atenderSeguimientosHis(): Promise<void> {
    if (!this.consultaHis) return;
    try {
      const ahora = new Date();
      const seguimientos = await this.consultaHis.reclamarSeguimientos(
        ahora,
        async (organizationId) =>
          (
            await this.prisma.organization.findUnique({
              where: { id: organizationId },
              select: { timezone: true },
            })
          )?.timezone || undefined,
      );
      for (const s of seguimientos) {
        try {
          await this.atenderSeguimientoHis(s);
        } catch (error: unknown) {
          this.logger.error(
            `Seguimiento de la consulta al HIS ${s.requestId} falló: ${getErrorMessage(error)}`,
          );
        }
      }
      await this.alertasTecnicas?.cronBien('seguimientos-his');
    } catch (error: unknown) {
      this.logger.error(
        `Barrido de consultas al HIS del bot falló: ${getErrorMessage(error)}`,
      );
      await this.alertasTecnicas?.cronFallo(
        'seguimientos-his',
        'Consultas del bot al HIS',
        error,
      );
    }
  }

  private async atenderSeguimientoHis(s: SeguimientoHis): Promise<void> {
    const { organizationId, senderId } = s;
    const [org, mirror] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { supportPhone: true, timezone: true },
      }),
      this.prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId },
        select: { botLookupMode: true },
      }),
    ]);
    const modo = mirror?.botLookupMode ?? 'OFF';
    const MSGS = buildMessages(
      await this.organizationSettings.getCommunicationStyle(organizationId),
      canalDe(senderId),
    );
    const contacto = org?.supportPhone
      ? MSGS.contactoClinica(org.supportPhone)
      : MSGS.contactoClinicaSinTelefono();

    // Solo se le escribe si está en ON, sigue en la consulta (o ya la cerró) y
    // hay algo que decir: con novedades, o si el hospital no contestó (se le
    // prometió escribir). Sin novedades: silencio (D6).
    const estado = await this.getUserState(organizationId, senderId);
    const sigueAhi =
      estado === ChatState.IDLE || estado === ChatState.AWAITING_LOOKUP_CHOICE;
    let reply: string | null = null;
    if (modo === 'ON' && sigueAhi) {
      if (s.status !== 'RESUELTA') {
        reply = MSGS.consultaHisNoDisponible(contacto);
      } else if (s.nuevas.length > 0) {
        reply = MSGS.consultaHisNuevas(
          this.lineasHis(s.nuevas, MSGS, org?.timezone || undefined),
          contacto,
        );
      }
    }
    if (reply) await this.smartReply(organizationId, senderId, reply);

    // La medición del criterio de entrada (D8) sale de aquí, en SHADOW y en ON.
    await this.auditSuccess(senderId, organizationId, {
      userMessage: '[consulta al hospital]',
      botReply: reply ?? '[sin mensaje]',
      metadata: {
        step: 'HIS_LOOKUP_RESULT',
        requestId: s.requestId,
        modoBotHis: modo,
        status: s.status,
        citasHis: s.citasHis,
        nuevas: s.nuevas.length,
        enviado: !!reply,
        estadoConversacion: estado,
      },
    });
  }

  /** Handler de estado: AWAITING_LOOKUP_CEDULA. */
  private async handleAwaitingLookupCedula(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const {
      organizationId,
      senderId,
      identity,
      text,
      aiData,
      MSGS,
      retriesKey,
      retriesCount,
    } = ctx;
    const cedula = (aiData.cedula || text || '').replace(/\D/g, '');
    if (!cedula) {
      await this.redis.set(
        retriesKey,
        (retriesCount + 1).toString(),
        'EX',
        SESSION_TTL,
      );
      const reply = MSGS.cancelarCedulaInvalida();
      await this.smartReply(organizationId, senderId, reply);
      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.PATIENT_NOT_FOUND,
        userMessage: text,
        botReply: reply,
        metadata: { stage: 'LOOKUP_CEDULA_INVALID' },
      });
      return;
    }
    await this.showLookup({
      organizationId,
      senderId,
      identity,
      cedula,
      userMessage: text || '[audio]',
      MSGS,
      via: 'cedula',
    });
  }

  /**
   * Handler de estado: AWAITING_LOOKUP_CHOICE. Solo se llega aquí tras mostrar
   * el detalle, es decir, con el remitente ya reconocido como el paciente: A y
   * B entran a cancelar / reprogramar con su cédula, sin volver a pedirla.
   */
  private async handleAwaitingLookupChoice(
    ctx: ChatTurnContext,
  ): Promise<void> {
    const {
      organizationId,
      senderId,
      text,
      MSGS,
      botName,
      orgName,
      retriesKey,
      retriesCount,
    } = ctx;
    const letra = this.extractOptionLetter(text);
    const cedula = await this.redis.get(
      `temp_lookup_cedula:${organizationId}:${senderId}`,
    );
    // La letra se lee contra las opciones que se le MOSTRARON (dependen de los
    // interruptores de la clínica). Sin ellas en la sesión —consulta mostrada
    // antes de este cambio— vale el orden fijo de siempre (A-D).
    const opciones =
      this.opcionesGuardadas(
        await this.redis.get(
          `temp_lookup_opciones:${organizationId}:${senderId}`,
        ),
      ) ?? OPCIONES_CONSULTA_FIJAS;
    const elegida: OpcionConsulta | undefined = letra
      ? opciones[letra.charCodeAt(0) - 65]
      : undefined;

    // 🔒 Las opciones se mostraron antes de que la clínica apagara esa
    // operación: ya no se puede por el bot.
    if (
      elegida &&
      elegida !== 'NADA' &&
      !ctx.operaciones[CLAVE_OPERACION[elegida]]
    ) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });
      await this.responderOperacionNoDisponible({
        organizationId,
        senderId,
        text,
        org,
        orgName,
        botName,
        MSGS,
        motivo: elegida,
        operaciones: ctx.operaciones,
      });
      return;
    }

    if ((elegida === 'CANCELAR' || elegida === 'MODIFICAR') && !cedula) {
      const reply = MSGS.sesionExpirada();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpSession(organizationId, senderId);
      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: text,
        botReply: reply,
        metadata: { stage: 'LOOKUP_CHOICE_NO_CEDULA' },
      });
      return;
    }

    if (elegida === 'CANCELAR' && cedula) {
      await this.cleanUpSession(organizationId, senderId);
      await this.redis.set(
        `temp_cancel_cedula:${organizationId}:${senderId}`,
        cedula,
        'EX',
        SESSION_TTL,
      );
      await this.handleCancelCedulaStep(organizationId, senderId, cedula);
      await this.auditLog(senderId, organizationId, {
        status: InteractionStatus.CANCELLATION_FLOW,
        userMessage: text || '[audio]',
        botReply:
          (await this.getLastSent(senderId)) || '[cancelación iniciada]',
        metadata: { event: 'LOOKUP_TO_CANCEL' },
      });
      return;
    }

    if (elegida === 'MODIFICAR' && cedula) {
      await this.cleanUpSession(organizationId, senderId);
      await this.redis.set(
        `temp_modify_cedula:${organizationId}:${senderId}`,
        cedula,
        'EX',
        SESSION_TTL,
      );
      await this.handleModifyCedulaStep(organizationId, senderId, cedula);
      await this.auditSuccess(senderId, organizationId, {
        userMessage: text || '[audio]',
        botReply:
          (await this.getLastSent(senderId)) || '[modificación iniciada]',
        metadata: { event: 'LOOKUP_TO_MODIFY' },
      });
      return;
    }

    if (elegida === 'AGENDAR') {
      await this.cleanUpSession(organizationId, senderId);
      const { lineas, count } = await this.buildServiceMenu(
        organizationId,
        senderId,
      );
      const reply =
        count > 0
          ? MSGS.repromptAgendarServicio(lineas)
          : MSGS.bienvenida(
              orgName,
              'Ej: Medicina General, Odontología',
              botName,
            );
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_SPECIALTY,
      );
      await this.auditSuccess(senderId, organizationId, {
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: { event: 'LOOKUP_TO_NEW_BOOKING' },
      });
      return;
    }

    if (elegida === 'NADA') {
      const reply = MSGS.despedidaCorta();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpSession(organizationId, senderId);
      await this.auditSuccess(senderId, organizationId, {
        userMessage: text || '[audio]',
        botReply: reply,
        metadata: { event: 'LOOKUP_DONE' },
      });
      return;
    }

    await this.redis.set(
      retriesKey,
      (retriesCount + 1).toString(),
      'EX',
      SESSION_TTL,
    );
    const reply = MSGS.consultaOpcionInvalidaDe(
      letrasOpcionesConsulta(opciones),
      lineasOpcionesConsulta(opciones),
    );
    await this.smartReply(organizationId, senderId, reply);
    await this.auditFailure(senderId, organizationId, {
      reason: FailureReason.OUT_OF_CONTEXT,
      userMessage: text,
      botReply: reply,
      metadata: { stage: 'LOOKUP_CHOICE_INVALID', letra },
    });
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
    const MSGS = buildMessages(
      await this.organizationSettings.getCommunicationStyle(organizationId),
      canalDe(senderId),
    );
    const patient = await this.prisma.patientProfile.findFirst({
      where: { cedula, organizationId },
    });

    if (!patient) {
      const reply = MSGS.cancelarPacienteNoExiste(cedula);
      await this.smartReply(organizationId, senderId, reply);
      // Mantener en AWAITING_CANCEL_CEDULA para que el usuario pueda reintentar sin reiniciar
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_CANCEL_CEDULA,
      );

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.PATIENT_NOT_FOUND,
        userMessage: cedula,
        botReply: reply,
        metadata: { searchedCedula: cedula },
      });
      return;
    }

    if (!this.perfilEsDelRemitente(patient, senderId)) {
      await this.rechazarCitaDeOtroCanal({
        organizationId,
        senderId,
        MSGS,
        operacion: 'CANCELAR',
        cedula,
        patientId: patient.id,
      });
      return;
    }
    // ☎️ Es su número, pero quedó marcado como de otra persona: no se toca.
    if (
      (
        await this.pacientesConTelefonoEquivocado(
          organizationId,
          isTelegramSender(senderId),
          [patient.id],
        )
      ).size > 0
    ) {
      await this.rechazarCitaDeOtroCanal({
        organizationId,
        senderId,
        MSGS,
        operacion: 'CANCELAR',
        cedula,
        patientId: patient.id,
        telefonoEquivocado: true,
      });
      return;
    }

    const activeAppointments = await this.prisma.appointment.findMany({
      where: {
        patientId: patient.id,
        status: 'SCHEDULED',
        scheduleSlot: { startTime: { gte: new Date() }, ...EN_ALCANCE_DEL_BOT },
      },
      include: {
        scheduleSlot: { include: { doctor: true, service: true } },
      },
      orderBy: { scheduleSlot: { startTime: 'asc' } },
    });

    if (
      activeAppointments.length === 0 &&
      (await this.tieneCitasFueraDelAlcance(patient.id))
    ) {
      await this.responderCitasFueraDelAlcance({
        organizationId,
        senderId,
        MSGS,
        userMessage: cedula,
        flow: 'CANCELAR',
        patientId: patient.id,
      });
      return;
    }

    if (activeAppointments.length === 0) {
      // Sin citas para esta cédula → ofrecemos consultar con otra (loop).
      // NO penalizamos reintentos: una cédula válida sin citas no es un "error".
      // El loop se cierra cuando el paciente dice NO o por el cron de inactividad.
      const reply = MSGS.cancelarSinCitasReintentar(cedula);
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_CANCEL_RETRY_CEDULA,
      );

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.NO_APPOINTMENTS_TO_CANCEL,
        userMessage: cedula,
        botReply: reply,
        metadata: {
          patientCedula: cedula,
          patientId: patient.id,
          offeredRetry: true,
        },
      });
      return;
    }

    if (activeAppointments.length === 1) {
      const apt = activeAppointments[0];
      await this.redis.set(
        `temp_selected_cancel_apt:${organizationId}:${senderId}`,
        apt.id,
        'EX',
        SESSION_TTL,
      );
      await this.redis.set(
        `temp_selected_cancel_slot:${organizationId}:${senderId}`,
        apt.scheduleSlotId,
        'EX',
        SESSION_TTL,
      );

      const fechaFormateada = formatAppointmentLong(apt.scheduleSlot.startTime);
      const reply = MSGS.cancelarConfirmar(
        apt.scheduleSlot.service.name,
        doctorLabel(apt.scheduleSlot.doctor),
        fechaFormateada,
      );
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_CANCEL_CONFIRM,
      );

      await this.auditSuccess(senderId, organizationId, {
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

    // El mapping letra → cita DEBE quedar escrito antes de ofrecer el menú:
    // es lo que resuelve la respuesta del paciente en el turno siguiente. Se
    // recorre con `for...of` + `await` (como offerModifySlots) en vez del
    // `forEach` anterior, que disparaba los `set` sin esperarlos — el turno
    // respondía antes de que la escritura ocurriera y, si Redis rechazaba, la
    // promesa quedaba sin manejar y tumbaba el proceso Node.
    let lineas = '';
    let maxLetra = '';
    for (let idx = 0; idx < activeAppointments.length; idx++) {
      const apt = activeAppointments[idx];
      const letra = String.fromCharCode(65 + idx);
      maxLetra = letra;
      await this.redis.set(
        `temp_cancel_apt_${letra}:${organizationId}:${senderId}`,
        apt.id,
        'EX',
        SESSION_TTL,
      );
      await this.redis.set(
        `temp_cancel_slot_${letra}:${organizationId}:${senderId}`,
        apt.scheduleSlotId,
        'EX',
        SESSION_TTL,
      );
      const fecha = formatAppointmentCompact(apt.scheduleSlot.startTime);
      lineas += `*${letra})* ${apt.scheduleSlot.service.name} · ${doctorLabel(apt.scheduleSlot.doctor)} · ${fecha}\n`;
    }
    await this.redis.set(
      `temp_cancel_max_letra:${organizationId}:${senderId}`,
      maxLetra,
      'EX',
      SESSION_TTL,
    );

    const reply = MSGS.cancelarSeleccionar(patient.fullName, lineas);
    // En voz: el audio solo anuncia; el listado de citas va por texto.
    await this.smartReply(
      organizationId,
      senderId,
      reply,
      MSGS.cancelarSeleccionarAudio(patient.fullName),
    );
    await this.setUserState(
      organizationId,
      senderId,
      ChatState.AWAITING_CANCEL_SELECTION,
    );

    await this.auditSuccess(senderId, organizationId, {
      userMessage: cedula,
      botReply: reply,
      metadata: {
        step: 'CANCEL_SHOWING_MULTIPLE',
        appointmentsCount: activeAppointments.length,
        patientCedula: cedula,
      },
    });
  }

  /**
   * 🔐 ¿Este perfil es de quien escribe? Su chat de Telegram, o su teléfono (en
   * cualquiera de sus formas) o su BSUID por WhatsApp.
   *
   * Cancelar y cambiar la fecha ya escriben en el hospital (2026-10-15): sin esto,
   * cualquiera que conociera un número de documento podía cancelarle la cita a
   * otra persona escribiendo su cédula. Mismo criterio que la consulta de citas,
   * que solo muestra el detalle al número registrado del paciente.
   */
  private perfilEsDelRemitente(
    perfil: {
      whatsappId: string | null;
      bsuid: string | null;
      telegramChatId: string | null;
    },
    senderId: string,
  ): boolean {
    if (isTelegramSender(senderId)) {
      const chat = chatIdFromTelegramSender(senderId);
      return !!chat && perfil.telegramChatId === chat;
    }
    if (perfil.bsuid && perfil.bsuid === senderId) return true;
    if (!perfil.whatsappId) return false;
    return (
      perfil.whatsappId === senderId ||
      variantesDeTelefono(senderId.replace(/\D/g, '')).includes(
        perfil.whatsappId,
      )
    );
  }

  /**
   * ¿El paciente tiene citas próximas fuera del bot (médico SIN «WhatsApp ON» o
   * servicio inactivo)?
   */
  private async tieneCitasFueraDelAlcance(patientId: string): Promise<boolean> {
    const n = await this.prisma.appointment.count({
      where: {
        patientId,
        status: 'SCHEDULED',
        scheduleSlot: {
          startTime: { gte: new Date() },
          OR: [
            { doctor: { whatsappBookingEnabled: false } },
            { service: { isActive: false } },
          ],
        },
      },
    });
    return n > 0;
  }

  /**
   * 🩺 Sus citas son todas de médicos fuera del bot (odontología, psicología…):
   * no se le dice «no tiene citas» —sí las tiene— sino que esas se gestionan con
   * el hospital. No se toca nada.
   */
  private async responderCitasFueraDelAlcance(p: {
    organizationId: string;
    senderId: string;
    MSGS: ReturnType<typeof buildMessages>;
    userMessage: string;
    flow: 'CANCELAR' | 'MODIFICAR';
    /**
     * El paciente (ya comprobado de quien escribe): con él, sus citas fuera del
     * alcance dejan aviso en la Bandeja (`avisarCitasFueraDelAlcance`).
     */
    patientId?: string;
  }): Promise<void> {
    if (p.patientId) {
      const avisado = await this.avisarCitasFueraDelAlcance(
        {
          organizationId: p.organizationId,
          senderId: p.senderId,
          text: p.userMessage,
          MSGS: p.MSGS,
          org: await this.organizacionDe(p.organizationId),
          pide: p.flow,
        },
        await this.citasFueraDelAlcance(p.organizationId, {
          patientId: p.patientId,
        }),
      ).catch((error: unknown) => {
        this.logger.error(
          `Aviso de cita fuera del alcance falló (org ${p.organizationId}): ${getErrorMessage(error)}`,
        );
        return false;
      });
      if (avisado) return;
    }
    const reply = p.MSGS.citasFueraDelAlcance(
      this.contactoDe(p.MSGS, await this.organizacionDe(p.organizationId)),
    );
    await this.smartReply(p.organizationId, p.senderId, reply);
    await this.cleanUpSession(p.organizationId, p.senderId);
    await this.auditLog(p.senderId, p.organizationId, {
      status: InteractionStatus.ESCAPED,
      userMessage: p.userMessage,
      botReply: reply,
      metadata: { step: 'CITAS_FUERA_DEL_ALCANCE', flow: p.flow },
    });
  }

  /** La cédula es de un paciente que no es de quien escribe: no se toca nada. */
  private async rechazarCitaDeOtroCanal(p: {
    organizationId: string;
    senderId: string;
    MSGS: ReturnType<typeof buildMessages>;
    operacion: 'CANCELAR' | 'MODIFICAR';
    cedula: string;
    patientId: string;
    /** El número es el de la ficha, pero tiene abierto un caso de teléfono equivocado. */
    telefonoEquivocado?: boolean;
  }): Promise<void> {
    const contacto = this.contactoDe(
      p.MSGS,
      await this.organizacionDe(p.organizationId),
    );
    const reply = p.telefonoEquivocado
      ? p.MSGS.numeroYaMarcado(contacto)
      : p.MSGS.citaDeOtroCanal(TEXTO_OPERACION[p.operacion].hacerla, contacto);
    await this.smartReply(p.organizationId, p.senderId, reply);
    await this.cleanUpSession(p.organizationId, p.senderId);
    await this.auditFailure(p.senderId, p.organizationId, {
      reason: FailureReason.PATIENT_CHANNEL_MISMATCH,
      userMessage: p.cedula,
      botReply: reply,
      metadata: {
        flow: p.operacion,
        patientId: p.patientId,
        ...(p.telefonoEquivocado ? { telefonoEquivocado: true } : {}),
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
    const MSGS = buildMessages(
      await this.organizationSettings.getCommunicationStyle(organizationId),
      canalDe(senderId),
    );
    const patient = await this.prisma.patientProfile.findFirst({
      where: { cedula, organizationId },
    });

    if (!patient) {
      const reply = MSGS.modificarPacienteNoExiste(cedula);
      await this.smartReply(organizationId, senderId, reply);
      // Permite reintentar la cédula sin reiniciar el flujo.
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_MODIFY_CEDULA,
      );

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.PATIENT_NOT_FOUND,
        userMessage: cedula,
        botReply: reply,
        metadata: { searchedCedula: cedula, flow: 'MODIFY' },
      });
      return;
    }

    if (!this.perfilEsDelRemitente(patient, senderId)) {
      await this.rechazarCitaDeOtroCanal({
        organizationId,
        senderId,
        MSGS,
        operacion: 'MODIFICAR',
        cedula,
        patientId: patient.id,
      });
      return;
    }
    // ☎️ Es su número, pero quedó marcado como de otra persona: no se toca.
    if (
      (
        await this.pacientesConTelefonoEquivocado(
          organizationId,
          isTelegramSender(senderId),
          [patient.id],
        )
      ).size > 0
    ) {
      await this.rechazarCitaDeOtroCanal({
        organizationId,
        senderId,
        MSGS,
        operacion: 'MODIFICAR',
        cedula,
        patientId: patient.id,
        telefonoEquivocado: true,
      });
      return;
    }

    const activeAppointments = await this.prisma.appointment.findMany({
      where: {
        patientId: patient.id,
        status: 'SCHEDULED',
        scheduleSlot: { startTime: { gte: new Date() }, ...EN_ALCANCE_DEL_BOT },
      },
      include: {
        scheduleSlot: { include: { doctor: true, service: true } },
      },
      orderBy: { scheduleSlot: { startTime: 'asc' } },
    });

    if (
      activeAppointments.length === 0 &&
      (await this.tieneCitasFueraDelAlcance(patient.id))
    ) {
      await this.responderCitasFueraDelAlcance({
        organizationId,
        senderId,
        MSGS,
        userMessage: cedula,
        flow: 'MODIFICAR',
        patientId: patient.id,
      });
      return;
    }

    if (activeAppointments.length === 0) {
      // Sin citas para esta cédula → ofrecemos consultar con otra (loop).
      // NO penalizamos reintentos: una cédula válida sin citas no es un "error".
      // El loop se cierra cuando el paciente dice NO o por el cron de inactividad.
      const reply = MSGS.modificarSinCitasReintentar(cedula);
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_MODIFY_RETRY_CEDULA,
      );

      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.NO_APPOINTMENTS_TO_MODIFY,
        userMessage: cedula,
        botReply: reply,
        metadata: {
          patientCedula: cedula,
          patientId: patient.id,
          offeredRetry: true,
        },
      });
      return;
    }

    if (activeAppointments.length === 1) {
      // Cita única → la fijamos y pasamos directo a ofrecer nuevos horarios.
      const apt = activeAppointments[0];
      await this.redis.set(
        `temp_selected_modify_apt:${organizationId}:${senderId}`,
        apt.id,
        'EX',
        SESSION_TTL,
      );
      await this.redis.set(
        `temp_selected_modify_slot:${organizationId}:${senderId}`,
        apt.scheduleSlotId,
        'EX',
        SESSION_TTL,
      );
      await this.offerModifySlots(organizationId, senderId, apt.id);
      return;
    }

    // Mismo criterio que handleCancelCedulaStep: la escritura del mapping
    // letra → cita se espera antes de ofrecer el menú.
    let lineas = '';
    let maxLetra = '';
    for (let idx = 0; idx < activeAppointments.length; idx++) {
      const apt = activeAppointments[idx];
      const letra = String.fromCharCode(65 + idx);
      maxLetra = letra;
      await this.redis.set(
        `temp_modify_apt_${letra}:${organizationId}:${senderId}`,
        apt.id,
        'EX',
        SESSION_TTL,
      );
      await this.redis.set(
        `temp_modify_slot_${letra}:${organizationId}:${senderId}`,
        apt.scheduleSlotId,
        'EX',
        SESSION_TTL,
      );
      const fecha = formatAppointmentCompact(apt.scheduleSlot.startTime);
      lineas += `*${letra})* ${apt.scheduleSlot.service.name} · ${doctorLabel(apt.scheduleSlot.doctor)} · ${fecha}\n`;
    }
    await this.redis.set(
      `temp_modify_max_letra:${organizationId}:${senderId}`,
      maxLetra,
      'EX',
      SESSION_TTL,
    );

    const reply = MSGS.modificarSeleccionar(patient.fullName, lineas);
    // En voz: el audio solo anuncia; el listado de citas va por texto.
    await this.smartReply(
      organizationId,
      senderId,
      reply,
      MSGS.modificarSeleccionarAudio(patient.fullName),
    );
    await this.setUserState(
      organizationId,
      senderId,
      ChatState.AWAITING_MODIFY_SELECTION,
    );

    await this.auditSuccess(senderId, organizationId, {
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
    const MSGS = buildMessages(
      await this.organizationSettings.getCommunicationStyle(organizationId),
      canalDe(senderId),
    );

    const apt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { scheduleSlot: { include: { doctor: true, service: true } } },
    });

    if (!apt) {
      const reply = MSGS.sesionExpirada();
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpModifySession(organizationId, senderId);
      await this.auditFailure(senderId, organizationId, {
        reason: FailureReason.SESSION_EXPIRED,
        userMessage: '[modify]',
        botReply: reply,
        metadata: { stage: 'MODIFY_OFFER_SLOTS_NO_APT', appointmentId },
      });
      return;
    }

    const serviceName = apt.scheduleSlot.service.name;
    const fechaActual = formatAppointmentLong(apt.scheduleSlot.startTime);

    const slots = await this.appointmentsService.getAvailableSlots(
      serviceName,
      apt.epsId,
      organizationId,
    );
    // Excluimos el cupo que el paciente ya tiene (no tiene sentido "moverla" al mismo).
    const candidateSlots = slots.filter((s) => s.slotId !== apt.scheduleSlotId);

    // 🗓️ Sin otro horario dentro del plazo máximo para agendar, pero sí más
    // adelante (2026-10-23): no se le ofrece cancelar —sí hay horarios, solo que
    // todavía no se dan—; la cita queda como está y se le dice desde cuándo
    // escribir.
    const masAlla =
      candidateSlots.length === 0
        ? await this.cupoMasAllaDelPlazo(serviceName, apt.epsId, organizationId)
        : null;
    if (masAlla) {
      const reply = MSGS.modificarSinCuposEnElPlazo(
        serviceName,
        masAlla.hasta,
        masAlla.desde,
      );
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpModifySession(organizationId, senderId);
      await this.cleanUpSession(organizationId, senderId);
      await this.auditSuccess(senderId, organizationId, {
        userMessage: '[modify]',
        botReply: reply,
        metadata: {
          step: 'MODIFY_NO_SLOTS_POR_PLAZO',
          appointmentId,
          service: serviceName,
          desde: masAlla.desdeIso,
        },
      });
      return;
    }

    // 🔒 Sin cupos y sin poder cancelar por el bot: no se ofrece cancelarla;
    // la cita se queda como está y se dice con quién cancelarla.
    if (
      candidateSlots.length === 0 &&
      !(await this.operacionesDisponibles(organizationId)).cancelar
    ) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { supportPhone: true },
      });
      const contacto = org?.supportPhone
        ? MSGS.contactoClinica(org.supportPhone)
        : MSGS.contactoClinicaSinTelefono();
      const reply = MSGS.modificarSinCuposSinCancelar(serviceName, contacto);
      await this.smartReply(organizationId, senderId, reply);
      await this.cleanUpModifySession(organizationId, senderId);
      await this.cleanUpSession(organizationId, senderId);
      await this.auditSuccess(senderId, organizationId, {
        userMessage: '[modify]',
        botReply: reply,
        metadata: {
          step: 'MODIFY_NO_SLOTS_SIN_CANCELAR',
          appointmentId,
          service: serviceName,
        },
      });
      return;
    }

    if (candidateSlots.length === 0) {
      // Sin cupos alternativos → ofrecer cancelar la cita actual.
      const reply = MSGS.modificarSinCupos(serviceName);
      await this.smartReply(organizationId, senderId, reply);
      await this.setUserState(
        organizationId,
        senderId,
        ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL,
      );

      await this.auditSuccess(senderId, organizationId, {
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
    const slotsMetadata: { letter: string; slotId: string; fecha: string }[] =
      [];
    for (let i = 0; i < candidateSlots.length; i++) {
      const letra = String.fromCharCode(65 + i);
      await this.redis.set(
        `temp_modify_newslot_${letra}:${organizationId}:${senderId}`,
        candidateSlots[i].slotId,
        'EX',
        SESSION_TTL,
      );
      await this.redis.set(
        `temp_modify_newslot_${letra}_fecha:${organizationId}:${senderId}`,
        candidateSlots[i].fecha.toISOString(),
        'EX',
        SESSION_TTL,
      );
      await this.redis.set(
        `temp_modify_newslot_max_letra:${organizationId}:${senderId}`,
        letra,
        'EX',
        SESSION_TTL,
      );
      lineas +=
        `*${letra})* ${formatAppointmentLong(candidateSlots[i].fecha)} ` +
        `· ${candidateSlots[i].doctor}\n`;
      slotsMetadata.push({
        letter: letra,
        slotId: candidateSlots[i].slotId,
        fecha: candidateSlots[i].fecha.toISOString(),
      });
    }

    const reply = MSGS.modificarMostrarCupos(serviceName, fechaActual, lineas);
    // En voz: el audio solo anuncia; los nuevos horarios van por texto.
    await this.smartReply(
      organizationId,
      senderId,
      reply,
      MSGS.modificarMostrarCuposAudio(serviceName),
    );
    await this.setUserState(
      organizationId,
      senderId,
      ChatState.AWAITING_MODIFY_NEW_SLOT,
    );

    await this.auditSuccess(senderId, organizationId, {
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
    ctx?: OutboundMessageContext,
  ): Promise<{ success: boolean; error?: string }> {
    if (!organizationId || !to || !message) {
      return { success: false, error: 'missing-params' };
    }
    try {
      // Seed del caché de tenant para outbound posterior y para resolver la
      // siguiente respuesta entrante del paciente.
      await this.redis.set(
        `origin_org:${to}`,
        organizationId,
        'EX',
        SESSION_TTL,
      );

      const result = await this.sendWhatsAppMessage(to, message, ctx);
      if (!result) {
        // Un `tg:` no pasó por Meta: el error lo dice, para que la auditoría
        // (y la caída a WhatsApp del recordatorio) no lo confunda.
        return {
          success: false,
          error: isTelegramSender(to)
            ? 'telegram-send-failed'
            : 'meta-api-error',
        };
      }
      return { success: true };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      this.logger.error(
        `Error en sendOutboundForOrg (org=${organizationId}, to=${to}): ${message}`,
      );
      return { success: false, error: message };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // INTERFAZ EXTERNA (OUTBOUND desde el Dashboard)
  // ══════════════════════════════════════════════════════════════
  // El tenant viene SIEMPRE del token del funcionario (vía controller). Antes
  // se resolvía con el caché `origin_org:{to}` (la última clínica con la que
  // habló el número), lo que podía enrutar el mensaje por la línea de OTRA
  // clínica si el paciente conversaba con varias.
  async sendOutboundMessage(
    to: string,
    message: string,
    organizationId: string,
    ctx?: OutboundMessageContext,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!organizationId) {
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
        where: { id: organizationId },
      });
      if (!org) {
        const errMsg = 'Organización no encontrada para outbound';
        this.logger.error(`${errMsg}: ${organizationId}`);
        await this.interactionLog.logOutbound({
          whatsappId: to,
          botReply: message,
          success: false,
          error: errMsg,
        });
        return { success: false, error: errMsg };
      }
      // Seed del tenant: la próxima respuesta entrante del paciente (y los
      // flujos que aún dependan del caché) resuelven a esta misma clínica.
      await this.redis.set(`origin_org:${to}`, org.id, 'EX', SESSION_TTL);
      await this.smartReply(org.id, to, message, undefined, ctx);

      await this.interactionLog.logOutbound({
        whatsappId: to,
        organizationId: org.id,
        botReply: message,
        success: true,
      });

      return { success: true };
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Error en sendOutboundMessage: ${errorMessage}`);
      await this.interactionLog.logOutbound({
        whatsappId: to,
        botReply: message,
        success: false,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
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
      const {
        whatsappId,
        organizationId,
        nombre,
        especialidad,
        doctor,
        slotDate,
      } = params;
      // Sombra del pool de mensajes según el estilo activo de la org.
      const MSGS = buildMessages(
        await this.organizationSettings.getCommunicationStyle(organizationId),
        canalDe(whatsappId),
      );
      const fechaFormateada = formatAppointmentLong(slotDate);
      await this.setUserState(
        organizationId,
        whatsappId,
        ChatState.AWAITING_WAITLIST_CONFIRM,
      );
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
      const reply = MSGS.waitlistCupoDisponible(
        nombre,
        especialidad,
        fechaFormateada,
        doctor,
      );
      await this.sendWhatsAppMessage(whatsappId, reply, {
        kind: 'WAITLIST_OFFER',
      });

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
    } catch (error: unknown) {
      this.logger.error(
        `Error en notifyWaitlistCandidate: ${getErrorMessage(error)}`,
      );
    }
  }
}
