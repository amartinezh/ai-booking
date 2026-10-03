import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { of } from 'rxjs';
import { ChatbotService } from './chatbot.service';
import { ChatState } from './chatbot.constants';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { RedisService } from '../redis/redis.service';
import { AppointmentsService } from 'src/appointments/appointments.service';
import { WaitlistService } from 'src/waitlist/waitlist.service';
import { InteractionLogService } from '../interaction-log/interaction-log.service';
import { ChannelActivityService } from '../interaction-log/channel-activity.service';
const channelActivity = { record: jest.fn(async () => undefined) };
import { KnowledgeBaseService } from './knowledge-base.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { LlmFactoryService } from '../llm/llm-factory.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { WhatsappMessageLogService } from '../whatsapp-config/whatsapp-message-log.service';
import { SurveyService } from '../survey/survey.service';
import { AudioConfigService } from '../audio-config/audio-config.service';
import { TtsFactoryService } from '../audio-config/tts/tts-factory.service';
import { SchedulingExtraction } from '../llm/interfaces/llm-provider.interface';
import { TelegramChannelService } from '../telegram/telegram-channel.service';
import { TELEGRAM_ORIGIN, type WhatsappInboundEvent } from './sender-identity';

// ════════════════════════════════════════════════════════════════════
// EL BOT POR TELEGRAM (docs/PLAN_TELEGRAM.md, Fase 2)
//
// Conversaciones completas por `processIncomingMessage`, como las de
// `chatbot.flows.e2e.spec.ts`, pero con un remitente `tg:<chat_id>`. El bot
// es el REAL; solo el canal de Telegram es un doble que registra cada envío.
//
// Lo que se prueba en TODOS los casos: ningún envío sale hacia la Graph API
// de Meta (`HttpService.post`) ni a las credenciales de WhatsApp. Y lo que se
// prueba aparte: que Telegram y WhatsApp convivan sin mezclarse.
//
// Los dobles de Redis y Prisma son copia de los de la suite de WhatsApp: esa
// suite no se edita, para que siga probando el comportamiento de siempre.
// ════════════════════════════════════════════════════════════════════

const ORG_ID = 'org-1';
const ORG_NAME = 'Hospital San Vicente';
const PHONE_ID = 'phone-number-id-123';
/** Teléfono de WhatsApp del paciente de la suite original. */
const SENDER = '573001112233';
/** Chat de Telegram con los MISMOS dígitos que un celular: el peor caso. */
const CHAT = '3001112233';
const TG = `tg:${CHAT}`;

const SVC_MEDICINA = { id: 'svc-med', name: 'Medicina General' };
const SVC_ODONTO = { id: 'svc-odo', name: 'Odontología' };
const EPS_PARTICULAR = { id: 'eps-part', name: 'Particular' };
const EPS_SURA = { id: 'eps-sura', name: 'Sura' };

const FECHA_A = new Date('2026-09-15T14:00:00.000Z');
const FECHA_B = new Date('2026-09-16T15:00:00.000Z');

// ── Redis falso en memoria (get/set/del/keys con globs) ──────────────
function createFakeRedis() {
  const store = new Map<string, string>();
  const globToRegex = (pattern: string) => {
    const escaped = pattern
      .replace(/[.+?^${}()|\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$');
  };
  return {
    store,
    get: jest.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
    set: jest.fn((k: string, v: string) => {
      store.set(k, String(v));
      return 'OK';
    }),
    del: jest.fn((...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    }),
    keys: jest.fn((pattern: string) => {
      const re = globToRegex(pattern);
      return [...store.keys()].filter((k) => re.test(k));
    }),
    expire: jest.fn((k: string) => (store.has(k) ? 1 : 0)),
    ttl: jest.fn((k: string) => (store.has(k) ? -1 : -2)),
  };
}

function extraction(
  over: Partial<SchedulingExtraction> = {},
): SchedulingExtraction {
  return {
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
    ...over,
  };
}

const textEvent = (body: string, phoneId = PHONE_ID) => ({
  from: SENDER,
  type: 'text',
  text: { body },
  metadata: { phone_number_id: phoneId },
});

// ── Prisma falso con estado mutable (pacientes, citas, cupos) ────────
type Db = {
  orgsByPhoneId: Record<string, any>;
  services: { id: string; name: string; organizationId?: string }[];
  epsList: { id: string; name: string; isActive?: boolean }[];
  patients: any[];
  appointments: any[];
  slots: any[];
  enrolled: { cedula: string; epsId: string; regime?: string | null }[];
};

function createPrisma(db: Db) {
  let patientSeq = 0;
  const tx = {
    scheduleSlot: {
      findUnique: jest.fn(({ where }: any) =>
        db.slots.find((s) => s.id === where.id),
      ),
      update: jest.fn(({ where, data }: any) => {
        const s = db.slots.find((x) => x.id === where.id);
        if (s) Object.assign(s, data);
        return s;
      }),
    },
    appointment: {
      update: jest.fn(({ where, data }: any) => {
        const a = db.appointments.find((x) => x.id === where.id);
        if (a) Object.assign(a, data);
        return a;
      }),
      create: jest.fn(({ data }: any) => {
        const a = { id: `apt-${db.appointments.length + 1}`, ...data };
        db.appointments.push(a);
        return a;
      }),
    },
  };

  return {
    _tx: tx,
    whatsappAccountConfig: {
      findUnique: jest.fn(({ where }: any) => {
        const org = db.orgsByPhoneId[where.phoneNumberId];
        return org ? { organization: org } : null;
      }),
    },
    organization: {
      findMany: jest.fn(() => []),
      findUnique: jest.fn(() => ({ id: ORG_ID, name: ORG_NAME })),
    },
    medicalService: {
      findMany: jest.fn(() => db.services),
      findFirst: jest.fn(() => null),
    },
    eps: {
      // Respeta `isActive` como la consulta real (sin el campo, la EPS está activa).
      findMany: jest.fn(({ where }: any = {}) =>
        db.epsList
          .map((e) => ({ isActive: true, ...e }))
          .filter(
            (e) =>
              where?.isActive === undefined || e.isActive === where.isActive,
          ),
      ),
      findFirst: jest.fn(({ where }: any) => {
        if (where?.id) return db.epsList.find((e) => e.id === where.id) ?? null;
        if (where?.name?.equals) {
          const needle = String(where.name.equals).toLowerCase();
          return (
            db.epsList.find((e) => e.name.toLowerCase() === needle) ?? null
          );
        }
        return null;
      }),
      findUnique: jest.fn(({ where }: any) =>
        db.epsList.find((e) => e.id === where.id),
      ),
      create: jest.fn(({ data }: any) => {
        const e = { id: `eps-${db.epsList.length + 1}`, ...data };
        db.epsList.push(e);
        return e;
      }),
      update: jest.fn(() => ({})),
    },
    epsEnrolledPatient: {
      // `where.cedula` llega como `{ in: [...] }`: el gate busca por la
      // cédula tal como llegó Y por la variante sin ceros a la izquierda en
      // una sola consulta (ver documento.ts / ESTADO.md, "Normalización del
      // documento: una función, dos pasadas").
      findFirst: jest.fn(({ where }: any) => {
        const candidatos: string[] = Array.isArray(where.cedula?.in)
          ? where.cedula.in
          : [where.cedula];
        return (
          db.enrolled.find(
            (e) => candidatos.includes(e.cedula) && e.epsId === where.epsId,
          ) ?? null
        );
      }),
    },
    patientProfile: {
      findFirst: jest.fn(
        ({ where }: any) =>
          db.patients.find((p) => p.cedula === where.cedula) ?? null,
      ),
      findUnique: jest.fn(
        ({ where }: any) => db.patients.find((p) => p.id === where.id) ?? null,
      ),
      create: jest.fn(({ data }: any) => {
        const p = { id: `pat-${++patientSeq}`, ...data };
        db.patients.push(p);
        return p;
      }),
      update: jest.fn(({ where, data }: any) => {
        const p = db.patients.find((x) => x.id === where.id);
        if (p) Object.assign(p, data);
        return p;
      }),
    },
    user: { create: jest.fn(() => ({ id: `user-${Date.now()}` })) },
    doctorProfile: { findMany: jest.fn(() => []) },
    appointment: {
      findMany: jest.fn(({ where }: any) =>
        db.appointments
          .filter(
            (a) => a.patientId === where.patientId && a.status === where.status,
          )
          .map((a) => ({
            ...a,
            scheduleSlot: db.slots.find((s) => s.id === a.scheduleSlotId),
          })),
      ),
      findUnique: jest.fn(({ where }: any) => {
        const a = db.appointments.find((x) => x.id === where.id);
        if (!a) return null;
        return {
          ...a,
          scheduleSlot: db.slots.find((s) => s.id === a.scheduleSlotId),
        };
      }),
      update: tx.appointment.update,
    },
    scheduleSlot: {
      findUnique: tx.scheduleSlot.findUnique,
      update: tx.scheduleSlot.update,
    },
    $transaction: jest.fn((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(tx),
    ),
  };
}

/**
 * Los tres turnos que un paciente NUEVO responde tras dar su nombre.
 *
 * El HIS del hospital exige `FE_NACI_PAC` y `NU_SEXO_PAC` NOT NULL, y el
 * convenio de facturación se resuelve con EPS + régimen — datos que el
 * chatbot no pedía y sin los cuales la cita era imposible de escribir en el
 * HIS. A un paciente que YA existe no se le pregunta nada de esto.
 *
 * El régimen solo se pregunta cuando hay EPS: un particular no lo necesita.
 */
/**
 * El nombre se pregunta en DOS turnos: nombres y apellidos.
 *
 * No es un capricho del test: el HIS guarda nombres y apellidos en columnas
 * separadas y partir "JUAN CARLOS PEREZ" después es adivinar. Preguntando, la
 * frontera la pone el paciente.
 */
async function decirNombre(say: (t: string) => Promise<void>) {
  await say('Juan');
  await say('Pérez');
}

async function responderAlta(
  say: (t: string) => Promise<void>,
  opts: { conEps?: boolean } = {},
) {
  await say('15/03/1980'); // nacimiento
  await say('SI'); // confirma la fecha que el bot le devolvió
  await say('A'); // sexo: masculino
  if (opts.conEps) await say('B'); // régimen: contributivo
}

function slotRow(id: string, fecha: Date, doctor: string, service: any) {
  return {
    id,
    startTime: fecha,
    isAvailable: true,
    organizationId: ORG_ID,
    serviceId: service.id,
    allowedEpsId: null,
    // `whatsappBookingEnabled` va aquí porque la consulta real lo incluye:
    // el reagendamiento revalida el interruptor del médico antes de mover la
    // cita al cupo nuevo (bloque E).
    doctor: { fullName: doctor, whatsappBookingEnabled: true },
    service,
  };
}

// ── Eventos de Telegram, con la marca que solo pone el webhook ──────
let updateSeq = 0;
const tgEvent = (body: string, chatId = CHAT, org = ORG_ID) =>
  ({
    id: `tg:ruta:${++updateSeq}`,
    type: 'text',
    text: { body },
    [TELEGRAM_ORIGIN]: {
      organizationId: org,
      chatId,
      senderId: `tg:${chatId}`,
    },
  }) as WhatsappInboundEvent;

const tgVoice = (fileId = 'voz-1', chatId = CHAT) =>
  ({
    id: `tg:ruta:${++updateSeq}`,
    type: 'audio',
    audio: { id: fileId },
    [TELEGRAM_ORIGIN]: {
      organizationId: ORG_ID,
      chatId,
      senderId: `tg:${chatId}`,
    },
  }) as WhatsappInboundEvent;

describe('ChatbotService — el bot por Telegram (E2E conversacional)', () => {
  let service: ChatbotService;
  let redis: ReturnType<typeof createFakeRedis>;
  let prisma: ReturnType<typeof createPrisma> & Record<string, any>;
  let db: Db;
  let appointments: {
    getAvailableSlots: jest.Mock;
    bookAppointment: jest.Mock;
    regimenDelPadron: jest.Mock;
  };
  let waitlist: Record<string, jest.Mock>;
  let interactionLog: Record<string, jest.Mock>;
  let http: { post: jest.Mock; get: jest.Mock };
  let waCreds: { forOrg: jest.Mock };
  let tts: { synthesize: jest.Mock };
  let channel: {
    sendText: jest.Mock;
    sendVoice: jest.Mock;
    downloadVoice: jest.Mock;
    noteInbound: jest.Mock;
  };
  let provider: {
    name: string;
    extractSchedulingIntent: jest.Mock;
    answerFAQ: jest.Mock;
    mapEntityToCatalog: jest.Mock;
  };

  /** Textos enviados por Telegram a un chat. */
  const tgSent = (senderId = TG): string[] =>
    channel.sendText.mock.calls
      .filter((c: any[]) => c[1] === senderId)
      .map((c: any[]) => c[2] as string);
  const lastTg = (senderId = TG) => tgSent(senderId).at(-1) ?? '';
  const state = (senderId = TG) =>
    redis.store.get(`chat_state:${ORG_ID}:${senderId}`) ?? null;
  const say = (body: string) => service.processIncomingMessage(tgEvent(body));

  /** La garantía de todo el archivo: nada de Telegram sale por Meta. */
  const expectNothingToMeta = () => {
    expect(http.post).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
  };

  const bootstrap = async (withChannel = true) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_k: string, d?: unknown) => d) },
        },
        { provide: HttpService, useValue: http },
        { provide: RedisService, useValue: redis },
        { provide: AppointmentsService, useValue: appointments },
        { provide: WaitlistService, useValue: waitlist },
        { provide: InteractionLogService, useValue: interactionLog },
        { provide: ChannelActivityService, useValue: channelActivity },
        {
          provide: WhatsappMessageLogService,
          useValue: { recordOutbound: jest.fn() },
        },
        {
          provide: KnowledgeBaseService,
          useValue: {
            hasContent: jest.fn(() => false),
            getContent: jest.fn(() => null),
          },
        },
        {
          provide: OrganizationSettingsService,
          useValue: {
            getBotName: jest.fn(() => 'AgenIA'),
            getMaxRetries: jest.fn(() => 3),
            getCommunicationStyle: jest.fn(() => 'FORMAL'),
            isBookingEnabled: jest.fn(() => true),
          },
        },
        {
          provide: LlmFactoryService,
          useValue: { forOrgOrNull: jest.fn(() => provider) },
        },
        { provide: WhatsappCredentialsService, useValue: waCreds },
        {
          provide: SurveyService,
          useValue: { generateSurveyToken: jest.fn(() => 'tok') },
        },
        {
          provide: AudioConfigService,
          useValue: { getEffective: jest.fn(() => null) },
        },
        { provide: TtsFactoryService, useValue: tts },
        ...(withChannel
          ? [{ provide: TelegramChannelService, useValue: channel }]
          : []),
      ],
    }).compile();
    service = module.get(ChatbotService);
    service.reloadPatterns();
    // La encuesta final no es parte de lo que se prueba aquí.
    jest.spyOn(service as any, 'sendSurveyLink').mockResolvedValue(undefined);
  };

  beforeEach(async () => {
    for (const l of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(Logger.prototype, l).mockImplementation();
    }
    redis = createFakeRedis();
    db = {
      orgsByPhoneId: {
        [PHONE_ID]: {
          id: ORG_ID,
          name: ORG_NAME,
          isActive: true,
          supportPhone: '6068538838',
        },
      },
      services: [SVC_MEDICINA, SVC_ODONTO],
      epsList: [EPS_PARTICULAR, EPS_SURA],
      patients: [],
      appointments: [],
      slots: [
        slotRow('slot-a', FECHA_A, 'Ana Pérez', SVC_MEDICINA),
        slotRow('slot-b', FECHA_B, 'Luis Gómez', SVC_MEDICINA),
      ],
      enrolled: [],
    };
    prisma = createPrisma(db) as any;
    // Telegram resuelve la clínica por id (la ruta del webhook), no por el
    // phone_number_id: el doble devuelve la organización completa.
    prisma.organization.findUnique = jest.fn(({ where }: any) =>
      where?.id === ORG_ID ? db.orgsByPhoneId[PHONE_ID] : null,
    );
    // `updateMany` real sobre el arreglo: lo usa la baja de recordatorios.
    prisma.patientProfile.updateMany = jest.fn(({ where, data }: any) => {
      const matches = (p: any) => {
        if (where.organizationId && p.organizationId !== where.organizationId)
          return false;
        if ('telegramChatId' in where)
          return p.telegramChatId === where.telegramChatId;
        if (where.OR) {
          return where.OR.some((c: any) => {
            const [campo, cond] = Object.entries(c)[0] as [string, any];
            return cond.in.includes(p[campo]);
          });
        }
        return true;
      };
      const hits = db.patients.filter(matches);
      hits.forEach((p) => Object.assign(p, data));
      return { count: hits.length };
    });

    provider = {
      name: 'GEMINI',
      extractSchedulingIntent: jest.fn(() => extraction()),
      answerFAQ: jest.fn(() => 'respuesta FAQ'),
      mapEntityToCatalog: jest.fn(() => ({ id: null })),
    };
    appointments = {
      getAvailableSlots: jest.fn(() =>
        db.slots
          .filter((s) => s.isAvailable)
          .map((s) => ({
            slotId: s.id,
            fecha: s.startTime,
            doctor: s.doctor.fullName,
            servicio: s.service.name,
          })),
      ),
      bookAppointment: jest.fn(() => ({
        success: true,
        appointmentId: 'apt-new',
      })),
      regimenDelPadron: jest.fn(() => null),
    };
    waitlist = {
      joinWaitlist: jest.fn(() => ({ id: 'wl-1', position: 2 })),
      notifyWaitlist: jest.fn(() => undefined),
      confirmFromWaitlist: jest.fn(() => ({ slotId: null, patientId: null })),
    };
    interactionLog = {
      logSuccess: jest.fn(async () => {}),
      logFailure: jest.fn(async () => {}),
      log: jest.fn(async () => {}),
      logWaitlistJoined: jest.fn(async () => {}),
      logBookingConfirmed: jest.fn(async () => {}),
      logWaitlistNotification: jest.fn(async () => {}),
      logOutbound: jest.fn(async () => {}),
    };
    // Meta responde y la clínica TIENE WhatsApp activo: si un `tg:` se
    // escapara hacia la Graph API, llegaría de verdad a `http.post` y
    // `expectNothingToMeta` lo detectaría (con credenciales nulas la fuga
    // se cortaría antes y pasaría inadvertida).
    http = {
      post: jest.fn(() => of({ data: { messages: [{ id: 'wamid.x' }] } })),
      get: jest.fn(() => of({ data: {} })),
    };
    waCreds = {
      forOrg: jest.fn(() => ({
        organizationId: ORG_ID,
        phoneNumberId: PHONE_ID,
        accessToken: 'EAA-token',
        isActive: true,
      })),
    };
    tts = { synthesize: jest.fn(() => Buffer.from('OggS-tts')) };
    channel = {
      sendText: jest.fn(async () => ({
        ok: true,
        messageId: 1,
        errorCode: null,
        blocked: false,
      })),
      sendVoice: jest.fn(async () => ({
        ok: true,
        messageId: 2,
        errorCode: null,
        blocked: false,
      })),
      downloadVoice: jest.fn(async () => Buffer.from('OggS-paciente')),
      noteInbound: jest.fn(async () => undefined),
    };
    await bootstrap();
  });

  afterEach(() => jest.restoreAllMocks());

  // ──────────────────────────────────────────────────────────────────
  describe('1. Agendamiento por Telegram', () => {
    it('1.1 /start → … → SÍ: agenda con origen TELEGRAM y todo sale por Telegram', async () => {
      await say('Hola'); // lo que el webhook entrega para /start
      expect(state()).toBe(ChatState.AWAITING_SPECIALTY);
      expect(lastTg()).toContain('Medicina General');
      expect(channel.sendText.mock.calls[0][0]).toBe(ORG_ID);

      await say('A');
      await say('A'); // Particular
      expect(state()).toBe(ChatState.AWAITING_DATE);
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      await responderAlta(say);
      expect(state()).toBe(ChatState.AWAITING_CONFIRMATION);
      expect(lastTg()).toContain('Juan Pérez');

      await say('Sí');
      expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
      const [patientId, slotId, , origin, orgId] =
        appointments.bookAppointment.mock.calls[0];
      expect(origin).toBe('TELEGRAM');
      expect(slotId).toBe('slot-a');
      expect(orgId).toBe(ORG_ID);

      const paciente = db.patients.find((p) => p.id === patientId);
      // El chat va a SU columna; nunca a la del teléfono de WhatsApp.
      expect(paciente.telegramChatId).toBe(CHAT);
      expect(paciente.whatsappId).toBeNull();
      expect(paciente.bsuid).toBeNull();

      // La confirmación llegó por Telegram, con su contexto para el libro.
      const confirmacion = channel.sendText.mock.calls.find(
        (c: any[]) => c[3]?.kind === 'BOOKING_CONFIRMATION',
      );
      expect(confirmacion).toBeDefined();
      expect(confirmacion![1]).toBe(TG);

      expectNothingToMeta();
      expect(waCreds.forOrg).not.toHaveBeenCalled();
      // Telegram no tiene ventana de 24 h: no se marca.
      expect(
        [...redis.store.keys()].some((k) => k.startsWith('wa_window:')),
      ).toBe(false);
    });

    it('1.2 paciente que ya existía por WhatsApp: MISMA ficha, se le suma el chat y su teléfono queda intacto', async () => {
      db.patients.push({
        id: 'pat-wa',
        cedula: '999888',
        fullName: 'María Ruiz',
        organizationId: ORG_ID,
        epsId: null,
        whatsappId: SENDER,
        bsuid: null,
        dateOfBirth: new Date('1975-06-01'),
        gender: 'F',
      });

      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('999888');
      expect(state()).toBe(ChatState.AWAITING_CONFIRMATION);
      expect(lastTg()).toContain('María Ruiz');
      await say('Sí');

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(db.patients).toHaveLength(1);
      expect(db.patients[0]).toMatchObject({
        whatsappId: SENDER,
        telegramChatId: CHAT,
        telegramBlockedAt: null,
      });
      expectNothingToMeta();
    });

    it('1.3 una madre agenda para ella y para su hijo desde el MISMO Telegram: dos fichas con el mismo chat', async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      await responderAlta(say);
      await say('Sí');

      await say('Hola');
      await say('A');
      await say('A');
      await say('A'); // el cupo que queda
      await say('1099000111');
      await say('Pedro');
      await say('Pérez');
      await responderAlta(say);
      await say('Sí');

      expect(appointments.bookAppointment).toHaveBeenCalledTimes(2);
      const fichas = db.patients.filter((p) => p.telegramChatId === CHAT);
      expect(fichas.map((p) => p.cedula).sort()).toEqual([
        '1088123456',
        '1099000111',
      ]);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  describe('2. Convivencia con WhatsApp', () => {
    it('2.1 la misma persona escribe a la vez por los dos canales: dos sesiones que no se mezclan', async () => {
      const waSay = (body: string) =>
        service.processIncomingMessage(textEvent(body));
      await waSay('Hola'); // WhatsApp: menú de servicios
      await say('Hola'); // Telegram: menú de servicios
      await waSay('A'); // WhatsApp avanza a EPS
      expect(state(SENDER)).toBe(ChatState.AWAITING_EPS);
      expect(state(TG)).toBe(ChatState.AWAITING_SPECIALTY);

      await say('B'); // Telegram elige Odontología
      await say('A');
      await waSay('A');
      expect(state(TG)).toBe(ChatState.AWAITING_DATE);
      expect(state(SENDER)).toBe(ChatState.AWAITING_DATE);
      // Cada sesión buscó cupos para SU servicio: la elección de uno no se
      // coló en la otra.
      const servicios = appointments.getAvailableSlots.mock.calls.map(
        (c: any[]) => c[0],
      );
      expect(servicios).toEqual(
        expect.arrayContaining(['Odontología', 'Medicina General']),
      );
      expect(appointments.getAvailableSlots.mock.calls[0][0]).toBe(
        'Odontología',
      ); // Telegram eligió primero
      expect(appointments.getAvailableSlots.mock.calls[1][0]).toBe(
        'Medicina General',
      );

      // Cada canal responde por el suyo: el tenant cacheado es por remitente.
      expect(redis.store.get(`origin_org:${TG}`)).toBe(ORG_ID);
      expect(redis.store.get(`origin_org:${SENDER}`)).toBe(ORG_ID);
      expect(channel.sendText.mock.calls.every((c: any[]) => c[1] === TG)).toBe(
        true,
      );
      // Lo de WhatsApp siguió su camino de siempre: a Meta, y SOLO al teléfono.
      expect(http.post).toHaveBeenCalled();
      for (const [, body] of http.post.mock.calls) {
        expect(body.to).toBe(SENDER);
        expect(JSON.stringify(body)).not.toContain('tg:');
      }
      // La ventana de 24 h solo la abrió WhatsApp.
      expect(redis.store.has(`wa_window:${ORG_ID}:${SENDER}`)).toBe(true);
      expect(redis.store.has(`wa_window:${ORG_ID}:${TG}`)).toBe(false);
    });

    it('2.2 🐛 baja de recordatorios por Telegram NO toca al paciente cuyo celular tiene los mismos dígitos', async () => {
      db.patients.push(
        {
          id: 'pat-celular',
          cedula: '111',
          organizationId: ORG_ID,
          whatsappId: CHAT, // su celular son justo los dígitos del chat
          remindersOptOut: false,
        },
        {
          id: 'pat-telegram',
          cedula: '222',
          organizationId: ORG_ID,
          whatsappId: null,
          telegramChatId: CHAT,
          remindersOptOut: false,
        },
      );

      await say('no quiero recibir recordatorios');

      expect(
        db.patients.find((p) => p.id === 'pat-telegram').remindersOptOut,
      ).toBe(true);
      expect(
        db.patients.find((p) => p.id === 'pat-celular').remindersOptOut,
      ).toBe(false);
      expectNothingToMeta();
    });

    it('2.3 la baja de recordatorios por WhatsApp sigue funcionando como siempre', async () => {
      db.patients.push({
        id: 'pat-wa',
        cedula: '111',
        organizationId: ORG_ID,
        whatsappId: SENDER,
        remindersOptOut: false,
      });
      jest.spyOn(service as any, 'sendWhatsAppMessage').mockResolvedValue(true);
      await service.processIncomingMessage(
        textEvent('no quiero recibir recordatorios'),
      );
      expect(db.patients[0].remindersOptOut).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  describe('2c. Actividad por canal (gráficas de «Canales en vivo»)', () => {
    it('cada mensaje entrante se registra UNA vez, con su remitente, para su clínica', async () => {
      channelActivity.record.mockClear();
      await service.processIncomingMessage(textEvent('Hola'));
      await say('Hola');
      const inbound = channelActivity.record.mock.calls
        .map((c) => c[0])
        .filter((c) => c.event === 'INBOUND');
      expect(inbound).toEqual([
        {
          organizationId: ORG_ID,
          senderId: SENDER,
          event: 'INBOUND',
          messageType: 'text',
        },
        {
          organizationId: ORG_ID,
          senderId: TG,
          event: 'INBOUND',
          messageType: 'text',
        },
      ]);
    });
  });

  describe('2b. Cada canal nombra el suyo', () => {
    // Se fija el azar en la variante de `epsInvalida` que nombra el canal.
    const conVarianteDelCanal = () =>
      jest.spyOn(Math, 'random').mockReturnValue(0.34);

    it('una EPS que no se reconoce: por Telegram dice «Telegram», nunca «WhatsApp»', async () => {
      await say('Hola');
      await say('A');
      conVarianteDelCanal();
      await say('zzzz qqqq');
      const texto = lastTg();
      expect(texto).toContain('por Telegram');
      expect(texto).not.toMatch(/whatsapp/i);
    });

    it('la misma conversación por WhatsApp sigue diciendo «WhatsApp»', async () => {
      const waSay = (body: string) =>
        service.processIncomingMessage(textEvent(body));
      const envios = jest
        .spyOn(service as any, 'sendWhatsAppMessage')
        .mockResolvedValue(true);
      await waSay('Hola');
      await waSay('A');
      conVarianteDelCanal();
      await waSay('zzzz qqqq');
      const texto = envios.mock.calls.at(-1)![1] as string;
      expect(texto).toContain('por WhatsApp');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  describe('3. Voz', () => {
    it('3.1 la nota de voz se baja de Telegram, se transcribe y la respuesta sale como voz por Telegram', async () => {
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({ transcript: 'Hola, quiero una cita' }),
      );
      await service.processIncomingMessage(tgVoice('voz-77'));

      expect(channel.downloadVoice).toHaveBeenCalledWith(ORG_ID, 'voz-77');
      expect(provider.extractSchedulingIntent).toHaveBeenCalled();
      // «🎧 Permítame un momento…» y la respuesta: algo salió por Telegram…
      expect(
        channel.sendText.mock.calls.length +
          channel.sendVoice.mock.calls.length,
      ).toBeGreaterThan(0);
      // …y la respuesta del bot en modo voz, como nota de voz.
      expect(channel.sendVoice).toHaveBeenCalledWith(
        ORG_ID,
        TG,
        Buffer.from('OggS-tts'),
        undefined,
      );
      expectNothingToMeta();
    });

    it('3.1b 🐛 «A» hablada en el menú de servicios: el LLM recibe las letras del menú y «A a» elige la A', async () => {
      await say('Hola');
      expect(state()).toBe(ChatState.AWAITING_SPECIALTY);
      // Lo que devolvió Gemini en el caso real: oyó la letra, pero la marcó ininteligible.
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({ transcript: 'A a', ininteligible: true }),
      );
      await service.processIncomingMessage(tgVoice('voz-letra'));

      const hints =
        provider.extractSchedulingIntent.mock.calls.at(-1)![0].vocabularyHints;
      expect(hints).toMatchObject({
        letterOptions: ['A', 'B'],
        menuAcceptsNames: true,
      });
      expect(state()).toBe(ChatState.AWAITING_EPS);
      expect(tgSent().join(' ')).not.toMatch(
        /no (logré|pude) entender|no se escuch/i,
      );
    });

    it('3.1c lo mismo en el menú de EPS («be be» → B = Sura)', async () => {
      await say('Hola');
      await say('A');
      expect(state()).toBe(ChatState.AWAITING_EPS);
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({ transcript: 'be be', ininteligible: true }),
      );
      await service.processIncomingMessage(tgVoice('voz-eps'));
      const hints =
        provider.extractSchedulingIntent.mock.calls.at(-1)![0].vocabularyHints;
      expect(hints).toMatchObject({ menuAcceptsNames: true });
      expect(hints.letterOptions).toContain('B');
      expect(state()).not.toBe(ChatState.AWAITING_EPS);
    });

    it('3.1d en el menú, decir el NOMBRE por voz sigue funcionando', async () => {
      await say('Hola');
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({ transcript: 'Odontología', especialidad: 'Odontología' }),
      );
      await service.processIncomingMessage(tgVoice('voz-nombre'));
      expect(state()).toBe(ChatState.AWAITING_EPS);
      expect(appointments.getAvailableSlots).not.toHaveBeenCalled();
    });

    it('3.1e también por WhatsApp (el arreglo es del bot, no del canal)', async () => {
      jest.spyOn(service as any, 'sendWhatsAppMessage').mockResolvedValue(true);
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('x'));
      await service.processIncomingMessage(textEvent('Hola'));
      expect(state(SENDER)).toBe(ChatState.AWAITING_SPECIALTY);
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({ transcript: 'A a', ininteligible: true }),
      );
      await service.processIncomingMessage({
        from: SENDER,
        type: 'audio',
        audio: { id: 'media-1' },
        metadata: { phone_number_id: PHONE_ID },
      } as never);
      expect(state(SENDER)).toBe(ChatState.AWAITING_EPS);
    });

    it('3.2 si la voz no se puede enviar, la respuesta llega por texto', async () => {
      channel.sendVoice.mockResolvedValue({
        ok: false,
        messageId: null,
        errorCode: 400,
        blocked: false,
      });
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({ transcript: 'Hola' }),
      );
      await service.processIncomingMessage(tgVoice());
      expect(tgSent().length).toBeGreaterThanOrEqual(2); // «🎧…» + respuesta
      expectNothingToMeta();
    });

    it('3.3 si la nota no se puede bajar, se trata como ininteligible (no se cae)', async () => {
      channel.downloadVoice.mockResolvedValue(null);
      await expect(
        service.processIncomingMessage(tgVoice()),
      ).resolves.toBeUndefined();
      expect(provider.extractSchedulingIntent).not.toHaveBeenCalled();
      expectNothingToMeta();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  describe('4. Salidas que no nacen de un turno', () => {
    it('4.1 la oferta de la lista de espera llega por Telegram', async () => {
      await service.notifyWaitlistCandidate({
        whatsappId: TG, // WaitlistEntry.whatsappId guarda el remitente tal cual
        organizationId: ORG_ID,
        nombre: 'Juan',
        especialidad: 'Medicina General',
        doctor: 'Ana Pérez',
        slotDate: FECHA_A,
      });
      expect(channel.sendText).toHaveBeenCalledWith(
        ORG_ID,
        TG,
        expect.stringContaining('Medicina General'),
        { kind: 'WAITLIST_OFFER' },
      );
      expect(state()).toBe(ChatState.AWAITING_WAITLIST_CONFIRM);
      expectNothingToMeta();
    });

    it('4.2 el mensaje manual del panel a un paciente de Telegram sale por Telegram', async () => {
      const res = await service.sendOutboundMessage(
        TG,
        'Recuerde traer su carné',
        ORG_ID,
        {
          kind: 'MANUAL',
        },
      );
      expect(res.success).toBe(true);
      expect(channel.sendText).toHaveBeenCalledWith(
        ORG_ID,
        TG,
        'Recuerde traer su carné',
        { kind: 'MANUAL' },
      );
      expectNothingToMeta();
    });

    it('4.3 sendOutboundForOrg informa el fallo cuando Telegram no entrega', async () => {
      channel.sendText.mockResolvedValue({
        ok: false,
        messageId: null,
        errorCode: 403,
        blocked: true,
      });
      await expect(
        service.sendOutboundForOrg(ORG_ID, TG, 'Hola'),
      ).resolves.toEqual({ success: false, error: 'telegram-send-failed' });
      expectNothingToMeta();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  describe('5. Bordes', () => {
    it('5.1 escribir por Telegram limpia la marca de bloqueo de ese chat', async () => {
      await say('Hola');
      expect(channel.noteInbound).toHaveBeenCalledWith(ORG_ID, CHAT);
    });

    it('5.2 clínica inactiva: se le avisa por Telegram y no se procesa', async () => {
      db.orgsByPhoneId[PHONE_ID].isActive = false;
      await say('Hola');
      expect(lastTg()).toMatch(/inactiva/);
      expect(state()).toBeNull();
      expectNothingToMeta();
    });

    it('5.3 clínica que ya no existe: se descarta sin responder', async () => {
      await service.processIncomingMessage(
        tgEvent('Hola', CHAT, 'org-borrada'),
      );
      expect(channel.sendText).not.toHaveBeenCalled();
      expectNothingToMeta();
    });

    it('5.4 sin el canal de Telegram cargado, un tg: se pierde con log pero JAMÁS viaja a Meta', async () => {
      await bootstrap(false);
      await say('Hola');
      expectNothingToMeta();
    });

    it('5.5 un payload de Meta que imita campos de Telegram NO se trata como Telegram', async () => {
      jest.spyOn(service as any, 'sendWhatsAppMessage').mockResolvedValue(true);
      await service.processIncomingMessage({
        ...textEvent('Hola'),
        channel: 'telegram',
        telegram: { organizationId: 'org-2', chatId: '1', senderId: 'tg:1' },
      } as any);
      // Se procesó como WhatsApp: remitente = teléfono, sin tocar Telegram.
      expect(state(SENDER)).toBe(ChatState.AWAITING_SPECIALTY);
      expect(state('tg:1')).toBeNull();
      expect(channel.sendText).not.toHaveBeenCalled();
    });
  });
});
