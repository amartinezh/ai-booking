import { Test, TestingModule } from '@nestjs/testing';
import { ChatbotService } from './chatbot.service';
import { ChatState } from './chatbot.constants';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { RedisService } from '../redis/redis.service';
import { AppointmentsService } from 'src/appointments/appointments.service';
import { WaitlistService } from 'src/waitlist/waitlist.service';
import { InteractionLogService } from '../interaction-log/interaction-log.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { LlmFactoryService } from '../llm/llm-factory.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { SurveyService } from '../survey/survey.service';
import { AudioConfigService } from '../audio-config/audio-config.service';
import { TtsFactoryService } from '../audio-config/tts/tts-factory.service';
import { SchedulingExtraction } from '../llm/interfaces/llm-provider.interface';

// ════════════════════════════════════════════════════════════════════
// PRUEBAS END-TO-END DE LOS PROCEDIMIENTOS DE CITAS
//
// Cada test conduce una CONVERSACIÓN COMPLETA turno a turno a través de
// `processIncomingMessage`, igual que lo haría el webhook de Meta. No se
// mockea ningún método interno del servicio (salvo la capa de envío a
// WhatsApp y el enlace CSAT), así que se ejercita la máquina de estados
// real, la memoria de sesión en Redis y las transacciones de Prisma.
// ════════════════════════════════════════════════════════════════════

const ORG_ID = 'org-1';
const ORG_NAME = 'Hospital San Vicente';
const PHONE_ID = 'phone-number-id-123';
const SENDER = '573001112233';

const SVC_MEDICINA = { id: 'svc-med', name: 'Medicina General' };
const SVC_ODONTO = { id: 'svc-odo', name: 'Odontología' };
const EPS_PARTICULAR = { id: 'eps-part', name: 'Particular' };
const EPS_SURA = { id: 'eps-sura', name: 'Sura' };

// Fechas fijas en el futuro para que los cupos nunca "venzan" durante el test.
const FECHA_A = new Date('2026-09-15T14:00:00.000Z');
const FECHA_B = new Date('2026-09-16T15:00:00.000Z');
const FECHA_C = new Date('2026-09-20T09:00:00.000Z');

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

const audioEvent = (id = 'media-1') => ({
  from: SENDER,
  type: 'audio',
  audio: { id },
  metadata: { phone_number_id: PHONE_ID },
});

// ── Prisma falso con estado mutable (pacientes, citas, cupos) ────────
type Db = {
  orgsByPhoneId: Record<string, any>;
  services: { id: string; name: string; organizationId?: string }[];
  epsList: { id: string; name: string }[];
  patients: any[];
  appointments: any[];
  slots: any[];
  enrolled: { cedula: string; epsId: string }[];
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
      findMany: jest.fn(() => db.epsList),
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
      findFirst: jest.fn(
        ({ where }: any) =>
          db.enrolled.find(
            (e) => e.cedula === where.cedula && e.epsId === where.epsId,
          ) ?? null,
      ),
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

describe('ChatbotService — flujos completos de citas (E2E conversacional)', () => {
  let service: ChatbotService;
  let redis: ReturnType<typeof createFakeRedis>;
  let prisma: ReturnType<typeof createPrisma>;
  let db: Db;
  let appointments: {
    getAvailableSlots: jest.Mock;
    bookAppointment: jest.Mock;
  };
  let waitlist: {
    joinWaitlist: jest.Mock;
    notifyWaitlist: jest.Mock;
    confirmFromWaitlist: jest.Mock;
  };
  let interactionLog: Record<string, jest.Mock>;
  let surveySpy: jest.SpyInstance;
  let sendSpy: jest.SpyInstance;
  let provider: {
    name: string;
    extractSchedulingIntent: jest.Mock;
    answerFAQ: jest.Mock;
    mapEntityToCatalog: jest.Mock;
  };

  const sent = (): string[] =>
    sendSpy.mock.calls.map((c: any[]) => c[1] as string);
  const lastSent = (): string => sent()[sent().length - 1] ?? '';
  const state = (): Promise<string | null> =>
    redis.store.get(`chat_state:${ORG_ID}:${SENDER}`) ?? null;
  const say = (body: string) => service.processIncomingMessage(textEvent(body));

  beforeEach(async () => {
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
      slots: [],
      enrolled: [],
    };
    prisma = createPrisma(db);

    provider = {
      name: 'GEMINI',
      extractSchedulingIntent: jest.fn(() => extraction()),
      answerFAQ: jest.fn(() => 'respuesta FAQ'),
      mapEntityToCatalog: jest.fn(() => ({ id: null })),
    };

    appointments = {
      getAvailableSlots: jest.fn(() => []),
      bookAppointment: jest.fn(() => ({
        success: true,
        appointmentId: 'apt-new',
      })),
    };
    waitlist = {
      joinWaitlist: jest.fn(() => ({ id: 'wl-1', position: 2 })),
      notifyWaitlist: jest.fn(() => undefined),
      confirmFromWaitlist: jest.fn(() => ({
        slotId: null,
        patientId: null,
      })),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
        { provide: HttpService, useValue: { post: jest.fn() } },
        { provide: RedisService, useValue: redis },
        { provide: AppointmentsService, useValue: appointments },
        { provide: WaitlistService, useValue: waitlist },
        { provide: InteractionLogService, useValue: interactionLog },
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
          },
        },
        {
          provide: LlmFactoryService,
          useValue: { forOrgOrNull: jest.fn(() => provider) },
        },
        {
          provide: WhatsappCredentialsService,
          useValue: { forOrg: jest.fn(() => null) },
        },
        {
          provide: SurveyService,
          useValue: { generateSurveyToken: jest.fn(() => 'tok') },
        },
        {
          provide: AudioConfigService,
          useValue: { getEffective: jest.fn(() => null) },
        },
        {
          provide: TtsFactoryService,
          useValue: { synthesize: jest.fn(() => null) },
        },
      ],
    }).compile();

    service = module.get<ChatbotService>(ChatbotService);
    // Cargamos los patrones reales (chatbot-patterns.txt) como en producción.
    service.reloadPatterns();

    sendSpy = jest
      .spyOn(service as any, 'sendWhatsAppMessage')
      .mockResolvedValue(undefined);
    surveySpy = jest
      .spyOn(service as any, 'sendSurveyLink')
      .mockResolvedValue(undefined);
  });

  // ──────────────────────────────────────────────────────────────────
  // 1. AGENDAMIENTO — camino feliz completo
  // ──────────────────────────────────────────────────────────────────
  describe('1. Agendamiento', () => {
    beforeEach(() => {
      db.slots = [
        slotRow('slot-a', FECHA_A, 'Ana Pérez', SVC_MEDICINA),
        slotRow('slot-b', FECHA_B, 'Luis Gómez', SVC_MEDICINA),
      ];
      appointments.getAvailableSlots.mockImplementation(() =>
        db.slots
          .filter((s) => s.isAvailable)
          .map((s) => ({
            slotId: s.id,
            fecha: s.startTime,
            doctor: s.doctor.fullName,
            servicio: s.service.name,
          })),
      );
    });

    it('1.1 paciente NUEVO: Hola → servicio → EPS → cupo → cédula → nombre → SÍ reserva la cita', async () => {
      await say('Hola');
      expect(await state()).toBe(ChatState.AWAITING_SPECIALTY);
      expect(lastSent()).toContain('Medicina General');

      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_EPS);
      expect(lastSent()).toContain('Particular');

      await say('A'); // Particular
      expect(await state()).toBe(ChatState.AWAITING_DATE);
      expect(appointments.getAvailableSlots).toHaveBeenCalledWith(
        'Medicina General',
        null, // Particular no filtra por EPS
        ORG_ID,
      );

      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_CEDULA);
      expect(lastSent()).toMatch(/c[ée]dula/i);

      await say('1088123456');
      expect(await state()).toBe(ChatState.AWAITING_NAME);

      await decirNombre(say);
      // Paciente nuevo: ahora se le piden nacimiento y sexo antes del resumen.
      expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);
      await responderAlta(say);

      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
      const resumen = lastSent();
      expect(resumen).toContain('Juan Pérez');
      expect(resumen).toContain('1088123456');
      expect(resumen).toContain('Medicina General');
      expect(resumen).toMatch(/Ley 1581/); // consentimiento Habeas Data

      await say('Sí');
      expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
      const [patientId, slotId, , origin, orgId] =
        appointments.bookAppointment.mock.calls[0];
      expect(slotId).toBe('slot-a');
      expect(origin).toBe('WHATSAPP');
      expect(orgId).toBe(ORG_ID);
      expect(patientId).toBe(db.patients[0].id);

      // ⭐ La frontera nombres/apellidos llega a PatientProfile SEPARADA.
      //
      // Es lo único que no se puede deducir después: "JUAN CARLOS PEREZ" puede
      // ser un nombre y dos apellidos, o dos nombres y uno. El HIS los guarda
      // en columnas distintas, así que preguntarlo es la única forma de no
      // adivinar el apellido de un paciente en su historia clínica.
      const creado = db.patients.at(-1)!;
      expect(creado.nombres).toBe('Juan');
      expect(creado.apellidos).toBe('Pérez');
      // `fullName` se conserva compuesto: medio sistema lo usa para mostrar.
      expect(creado.fullName).toBe('Juan Pérez');

      // ⭐ Los tres turnos del alta TAMBIÉN quedan auditados.
      //
      // No lo estaban: nacimiento, sexo y régimen se preguntaban, se guardaban
      // y acababan en la historia clínica del paciente sin dejar una sola fila
      // en InteractionLog. Si una historia sale con el sexo equivocado, sin
      // esto no hay manera de saber si el paciente escribió mal o lo
      // entendimos mal nosotros.
      const pasosDeAlta = interactionLog.logSuccess.mock.calls
        .map((c: any[]) => c[0]?.metadata?.step)
        .filter((p: string) => p?.startsWith('ALTA_'));
      expect(pasosDeAlta).toEqual(
        expect.arrayContaining([
          'ALTA_PEDIR_NACIMIENTO',
          'ALTA_CONFIRMAR_NACIMIENTO',
          'ALTA_PEDIR_SEXO',
        ]),
      );
      // Y guardan lo que el paciente escribió, no solo lo que respondió el bot.
      const turnoNacimiento = interactionLog.logSuccess.mock.calls.find(
        (c: any[]) => c[0]?.metadata?.step === 'ALTA_CONFIRMAR_NACIMIENTO',
      );
      expect(turnoNacimiento[0].userMessage).toBe('15/03/1980');

      expect(interactionLog.logBookingConfirmed).toHaveBeenCalledTimes(1);
      expect(surveySpy).toHaveBeenCalledWith(
        ORG_ID,
        SENDER,
        'BOOKED',
        expect.anything(),
      );
      // Sesión cerrada y limpia tras confirmar.
      expect(await state()).toBe(ChatState.IDLE);
      expect(
        redis.store.get(`temp_cedula:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
    });

    it('1.2 paciente EXISTENTE: no vuelve a pedir el nombre', async () => {
      db.patients.push({
        id: 'pat-known',
        cedula: '999888',
        fullName: 'María Ruiz',
        organizationId: ORG_ID,
        epsId: null,
        whatsappId: SENDER,
      });

      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('999888');

      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
      expect(lastSent()).toContain('María Ruiz');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('1.3 responder NO en la confirmación no agenda y cierra la sesión', async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      // Paciente nuevo: nacimiento, sexo antes del resumen.
      await responderAlta(say);

      await say('No');
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('1.4 cupo tomado por otro paciente (carrera): informa y devuelve al menú de horarios', async () => {
      appointments.bookAppointment.mockResolvedValueOnce({
        success: false,
        message: 'tomado',
      });

      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      // Paciente nuevo: nacimiento, sexo antes del resumen.
      await responderAlta(say);
      await say('Sí');

      expect(lastSent()).toMatch(/acaba de (tomar|reservarse)/i);
      expect(await state()).toBe(ChatState.AWAITING_DATE);
      // El paciente puede elegir otra letra sin reiniciar.
      await say('B');
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
    });

    it('1.5 letra inexistente en el menú de horarios → reintento sin perder el estado', async () => {
      await say('Hola');
      await say('A');
      await say('A');

      await say('Z');
      expect(await state()).toBe(ChatState.AWAITING_DATE);
      expect(redis.store.get(`error_count:${ORG_ID}:${SENDER}`)).toBe('1');
    });

    it('1.6 sesión expirada en la confirmación (Redis vacío) → aborta sin reservar', async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      // Paciente nuevo: nacimiento, sexo antes del resumen.
      await responderAlta(say);

      redis.store.delete(`temp_selected_slot_id:${ORG_ID}:${SENDER}`);
      await say('Sí');

      expect(appointments.bookAppointment).not.toHaveBeenCalled();
      expect(lastSent()).toMatch(/sesi[óo]n|tiempo/i);
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('1.7 "Salir" a mitad del agendamiento cierra la conversación sin reabrir el flujo', async () => {
      await say('Hola');
      await say('A');
      await say('Salir');

      expect(await state()).toBe(ChatState.IDLE);
      expect(lastSent()).toMatch(/gusto|hasta|buen d[íi]a/i);
      expect(
        redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
    });

    it('1.8 agotar los reintentos cierra la sesión y dispara CSAT de error', async () => {
      await say('Hola');
      await say('xyzzy 1');
      await say('xyzzy 2');
      await say('xyzzy 3');
      expect(redis.store.get(`error_count:${ORG_ID}:${SENDER}`)).toBe('3');

      await say('xyzzy 4');
      expect(await state()).toBe(ChatState.IDLE);
      expect(surveySpy).toHaveBeenCalledWith(
        ORG_ID,
        SENDER,
        'SYSTEM_ERROR',
        expect.anything(),
      );
    });

    // Regresión F6: el paso de cédula sí contabiliza reintentos, así que el
    // guard de máximo de reintentos lo alcanza en vez de reciclar sin fin.
    it('1.8b respuestas sin dígitos en el paso de cédula agotan reintentos y cierran', async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_CEDULA);

      await say('no la tengo a la mano');
      expect(redis.store.get(`error_count:${ORG_ID}:${SENDER}`)).toBe('1');
      expect(await state()).toBe(ChatState.AWAITING_CEDULA);

      await say('sigo sin encontrarla');
      await say('tampoco ahora');
      expect(redis.store.get(`error_count:${ORG_ID}:${SENDER}`)).toBe('3');

      await say('nada');
      expect(await state()).toBe(ChatState.IDLE);
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
    });

    it('1.8c la PRIMERA petición de cédula no penaliza reintentos', async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A'); // elige cupo → primera vez que se pide la cédula

      expect(await state()).toBe(ChatState.AWAITING_CEDULA);
      expect(
        redis.store.get(`error_count:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
    });

    it('1.8d una cédula válida tras un intento fallido limpia el contador', async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('no la recuerdo');
      expect(redis.store.get(`error_count:${ORG_ID}:${SENDER}`)).toBe('1');

      await say('1088123456');
      expect(
        redis.store.get(`error_count:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
      expect(await state()).toBe(ChatState.AWAITING_NAME);
    });

    it('1.9 EPS con convenio: los cupos se filtran por epsId y el padrón bloquea al no afiliado', async () => {
      await say('Hola');
      await say('A');
      await say('B'); // Sura

      expect(appointments.getAvailableSlots).toHaveBeenCalledWith(
        'Medicina General',
        EPS_SURA.id,
        ORG_ID,
      );

      await say('A');
      await say('1088123456'); // no está en el padrón

      expect(lastSent()).toMatch(/solicitud-alta|dado de alta/i);
      expect(await state()).toBe(ChatState.IDLE);
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
    });

    it('1.10 EPS con convenio y paciente EN el padrón: llega a confirmación y reserva', async () => {
      db.enrolled.push({ cedula: '1088123456', epsId: EPS_SURA.id });

      await say('Hola');
      await say('A');
      await say('B');
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      // Paciente nuevo: nacimiento, sexo y régimen antes del resumen.
      await responderAlta(say, { conEps: true });
      await say('Sí');

      expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 2. CANCELACIÓN
  // ──────────────────────────────────────────────────────────────────
  describe('2. Cancelación', () => {
    const CEDULA = '1088123456';

    const seedPatientWithAppointments = (n: number) => {
      db.patients.push({
        id: 'pat-1',
        cedula: CEDULA,
        fullName: 'Juan Pérez',
        organizationId: ORG_ID,
        epsId: null,
        whatsappId: SENDER,
      });
      const fechas = [FECHA_A, FECHA_B, FECHA_C];
      for (let i = 0; i < n; i++) {
        const slot = slotRow(
          `slot-${i}`,
          fechas[i],
          `Dr ${i}`,
          i === 1 ? SVC_ODONTO : SVC_MEDICINA,
        );
        slot.isAvailable = false;
        db.slots.push(slot);
        db.appointments.push({
          id: `apt-${i}`,
          patientId: 'pat-1',
          scheduleSlotId: slot.id,
          status: 'SCHEDULED',
          epsId: null,
          organizationId: ORG_ID,
        });
      }
    };

    it('2.1 una sola cita: cancelar → cédula → SÍ libera el cupo, notifica la lista de espera y ofrece reagendar', async () => {
      seedPatientWithAppointments(1);

      await say('cancelar cita');
      expect(await state()).toBe(ChatState.AWAITING_CANCEL_CEDULA);

      await say(CEDULA);
      expect(await state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);
      expect(lastSent()).toContain('Medicina General');

      await say('SI');
      expect(db.appointments[0].status).toBe('CANCELLED');
      expect(db.slots[0].isAvailable).toBe(true);
      expect(waitlist.notifyWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({ slotId: 'slot-0', organizationId: ORG_ID }),
      );
      expect(await state()).toBe(ChatState.AWAITING_POST_CANCEL_CHOICE);

      await say('NO');
      expect(await state()).toBe(ChatState.IDLE);
      expect(surveySpy).toHaveBeenCalledWith(
        ORG_ID,
        SENDER,
        'CANCELLED',
        expect.anything(),
      );
    });

    it('2.2 varias citas: lista con letras y cancela exactamente la elegida', async () => {
      seedPatientWithAppointments(3);

      await say('cancelar cita');
      await say(CEDULA);
      expect(await state()).toBe(ChatState.AWAITING_CANCEL_SELECTION);
      expect(lastSent()).toContain('Odontología');

      await say('B'); // la segunda (Odontología)
      expect(await state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);
      expect(lastSent()).toContain('Odontología');

      await say('SI');
      expect(db.appointments[1].status).toBe('CANCELLED');
      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(db.appointments[2].status).toBe('SCHEDULED');
      expect(db.slots[1].isAvailable).toBe(true);
      expect(db.slots[0].isAvailable).toBe(false);
    });

    it('2.3 responder NO en la confirmación conserva la cita intacta', async () => {
      seedPatientWithAppointments(1);

      await say('cancelar cita');
      await say(CEDULA);
      await say('NO');

      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(db.slots[0].isAvailable).toBe(false);
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('2.4 tras cancelar, SÍ reabre el menú de servicios para agendar de nuevo', async () => {
      seedPatientWithAppointments(1);

      await say('cancelar cita');
      await say(CEDULA);
      await say('SI');
      await say('SI'); // sí quiero reagendar

      expect(await state()).toBe(ChatState.AWAITING_SPECIALTY);
      expect(lastSent()).toContain('Medicina General');
    });

    it('2.5 cédula sin citas → entra al loop de reintento y NO penaliza reintentos', async () => {
      db.patients.push({
        id: 'pat-1',
        cedula: CEDULA,
        fullName: 'Juan Pérez',
        organizationId: ORG_ID,
      });

      await say('cancelar cita');
      await say(CEDULA);

      expect(await state()).toBe(ChatState.AWAITING_CANCEL_RETRY_CEDULA);
      expect(
        redis.store.get(`error_count:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
    });

    it('2.6 cédula inexistente → permite reintentar sin salir del flujo', async () => {
      await say('cancelar cita');
      await say('000000');

      expect(await state()).toBe(ChatState.AWAITING_CANCEL_CEDULA);
      expect(lastSent()).toContain('000000');
    });

    // Regresión F1: la confirmación de cancelación usa interpretYesNo(), no
    // un whitelist literal, así que acepta respuestas naturales.
    it.each([
      'Sí, confirmo',
      'si por favor',
      'claro',
      'dale',
      'SÍ',
      'si.',
      'listo, acepto',
    ])('2.7 "%s" confirma la cancelación', async (respuesta) => {
      seedPatientWithAppointments(1);

      await say('cancelar cita');
      await say(CEDULA);
      await say(respuesta);

      expect(db.appointments[0].status).toBe('CANCELLED');
      expect(db.slots[0].isAvailable).toBe(true);
      expect(await state()).toBe(ChatState.AWAITING_POST_CANCEL_CHOICE);
    });

    it.each(['no gracias', 'mejor no', 'nunca', 'negativo', 'cancelar'])(
      '2.7b "%s" aborta la cancelación conservando la cita',
      async (respuesta) => {
        seedPatientWithAppointments(1);

        await say('cancelar cita');
        await say(CEDULA);
        await say(respuesta);

        expect(db.appointments[0].status).toBe('SCHEDULED');
        expect(db.slots[0].isAvailable).toBe(false);
      },
    );

    it('2.7c una respuesta que no es SÍ ni NO no cancela nada y reintenta', async () => {
      seedPatientWithAppointments(1);

      await say('cancelar cita');
      await say(CEDULA);
      await say('¿y a qué hora abren?');

      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(await state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);
      expect(redis.store.get(`error_count:${ORG_ID}:${SENDER}`)).toBe('1');
    });

    it('2.8 "claro que sí" reabre el menú en la oferta de reagendar post-cancelación', async () => {
      seedPatientWithAppointments(1);

      await say('cancelar cita');
      await say(CEDULA);
      await say('SI');
      await say('claro que sí');

      expect(await state()).toBe(ChatState.AWAITING_SPECIALTY);
      expect(lastSent()).toContain('Medicina General');
    });

    // Regresión F2: AWAITING_CANCEL_CONFIRM ya está en `isYesNoStep`, así que
    // el paciente que viene hablando puede cerrar el trámite por voz.
    it('2.9 el audio se acepta en la confirmación de cancelación', async () => {
      seedPatientWithAppointments(1);

      await say('cancelar cita');
      await say(CEDULA);

      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('x'));
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ isActive: true, accessToken: 't' });
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({ transcript: 'sí, cancélela por favor' }),
      );

      await service.processIncomingMessage(audioEvent());

      expect(lastSent()).not.toContain('por *texto*');
      expect(db.appointments[0].status).toBe('CANCELLED');
      expect(await state()).toBe(ChatState.AWAITING_POST_CANCEL_CHOICE);
    });

    it('2.9b un "sí" hablado no se desvía aunque el LLM marque otra intención', async () => {
      seedPatientWithAppointments(1);

      await say('cancelar cita');
      await say(CEDULA);

      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('x'));
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ isActive: true, accessToken: 't' });
      // El extractor, al ver un "sí" suelto, alucina intención y entidades.
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({
          transcript: 'sí',
          intent: 'consulta_faq',
          outOfContext: true,
          isModification: true,
          eps: 'Sanitas',
          cedula: '77777',
        }),
      );

      await service.processIncomingMessage(audioEvent());

      expect(db.appointments[0].status).toBe('CANCELLED');
      // Las entidades alucinadas no contaminaron la memoria de sesión: ni se
      // guardó la EPS inventada ni se pisó la cédula real del paciente.
      expect(
        redis.store.get(`temp_eps_query:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
      expect(redis.store.get(`temp_cedula:${ORG_ID}:${SENDER}`)).toBe(CEDULA);
    });

    it('2.10 interrupción amable: "cancelar cita" mientras agenda pide confirmación y puede retomarse', async () => {
      await say('Hola');
      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_EPS);

      await say('cancelar cita');
      expect(await state()).toBe(ChatState.AWAITING_INTERRUPT_CONFIRMATION);

      await say('No');
      expect(await state()).toBe(ChatState.AWAITING_EPS); // retoma donde iba
    });

    // Regresión F3: por VOZ la interrupción amable se comporta igual que por
    // texto — pide confirmación en vez de abortar el agendamiento en curso.
    it('2.11 por VOZ la interrupción también pide confirmación y conserva el progreso', async () => {
      await say('Hola');
      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_EPS);

      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('x'));
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ isActive: true, accessToken: 't' });
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({
          transcript: 'quiero cancelar mi cita',
          isCancellation: true,
        }),
      );

      await service.processIncomingMessage(audioEvent());

      expect(await state()).toBe(ChatState.AWAITING_INTERRUPT_CONFIRMATION);
      // El progreso del agendamiento sigue intacto por si responde NO.
      expect(redis.store.get(`temp_especialidad_id:${ORG_ID}:${SENDER}`)).toBe(
        SVC_MEDICINA.id,
      );

      // Y retomarlo por voz devuelve al paciente justo donde iba.
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({ transcript: 'no, sigamos' }),
      );
      await service.processIncomingMessage(audioEvent());
      expect(await state()).toBe(ChatState.AWAITING_EPS);
    });

    it('2.12 una cancelación hablada desde IDLE sí arranca el flujo directo', async () => {
      jest
        .spyOn(service as any, 'downloadWhatsAppAudio')
        .mockResolvedValue(Buffer.from('x'));
      jest
        .spyOn(service as any, 'resolveCredentialsForOrg')
        .mockResolvedValue({ isActive: true, accessToken: 't' });
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({
          transcript: 'quiero cancelar mi cita',
          isCancellation: true,
        }),
      );

      await service.processIncomingMessage(audioEvent());

      // En IDLE no hay agendamiento que interrumpir → va directo a la cédula.
      expect(await state()).toBe(ChatState.AWAITING_CANCEL_CEDULA);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 3. REPROGRAMACIÓN (MODIFY)
  // ──────────────────────────────────────────────────────────────────
  describe('3. Reprogramación', () => {
    const CEDULA = '1088123456';

    beforeEach(() => {
      db.patients.push({
        id: 'pat-1',
        cedula: CEDULA,
        fullName: 'Juan Pérez',
        organizationId: ORG_ID,
        epsId: null,
        whatsappId: SENDER,
      });
      const ocupado = slotRow('slot-old', FECHA_A, 'Ana Pérez', SVC_MEDICINA);
      ocupado.isAvailable = false;
      db.slots.push(ocupado);
      db.slots.push(slotRow('slot-new', FECHA_B, 'Luis Gómez', SVC_MEDICINA));
      db.appointments.push({
        id: 'apt-0',
        patientId: 'pat-1',
        scheduleSlotId: 'slot-old',
        status: 'SCHEDULED',
        epsId: null,
        organizationId: ORG_ID,
      });
      appointments.getAvailableSlots.mockImplementation(() =>
        db.slots
          .filter((s) => s.isAvailable)
          .map((s) => ({
            slotId: s.id,
            fecha: s.startTime,
            doctor: s.doctor.fullName,
            servicio: s.service.name,
          })),
      );
    });

    it('3.1 camino feliz: reprogramar → cédula → nuevo cupo → SÍ mueve la cita atómicamente', async () => {
      await say('reprogramar mi cita');
      expect(await state()).toBe(ChatState.AWAITING_MODIFY_CEDULA);

      await say(CEDULA);
      expect(await state()).toBe(ChatState.AWAITING_MODIFY_NEW_SLOT);
      // El cupo actual no se ofrece como alternativa.
      expect(lastSent()).not.toContain('slot-old');

      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_MODIFY_CONFIRM);

      await say('Sí');
      expect(db.appointments[0].scheduleSlotId).toBe('slot-new');
      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(db.slots.find((s) => s.id === 'slot-old')!.isAvailable).toBe(true);
      expect(db.slots.find((s) => s.id === 'slot-new')!.isAvailable).toBe(
        false,
      );
      expect(waitlist.notifyWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({ slotId: 'slot-old' }),
      );
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('3.2 el nuevo cupo se lo llevan justo antes de confirmar → reofrece cupos frescos', async () => {
      await say('reprogramar mi cita');
      await say(CEDULA);
      await say('A');

      // Otro paciente toma el cupo entre la oferta y el SÍ.
      db.slots.find((s) => s.id === 'slot-new')!.isAvailable = false;
      db.slots.push(slotRow('slot-alt', FECHA_C, 'Otra Dra', SVC_MEDICINA));

      await say('Sí');
      expect(db.appointments[0].scheduleSlotId).toBe('slot-old'); // sin cambios
      expect(await state()).toBe(ChatState.AWAITING_MODIFY_NEW_SLOT);
    });

    it('3.3 sin cupos alternativos → ofrece cancelar; NO conserva la cita', async () => {
      db.slots.find((s) => s.id === 'slot-new')!.isAvailable = false;

      await say('reagendar');
      await say(CEDULA);
      expect(await state()).toBe(ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL);

      await say('No');
      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('3.4 sin cupos alternativos + SÍ → cancela la cita y ofrece reagendar', async () => {
      db.slots.find((s) => s.id === 'slot-new')!.isAvailable = false;

      await say('reagendar');
      await say(CEDULA);
      await say('Sí');

      expect(db.appointments[0].status).toBe('CANCELLED');
      expect(db.slots.find((s) => s.id === 'slot-old')!.isAvailable).toBe(true);
      expect(await state()).toBe(ChatState.AWAITING_POST_CANCEL_CHOICE);
    });

    it('3.5 responder NO en la confirmación deja la cita en su fecha original', async () => {
      await say('reprogramar mi cita');
      await say(CEDULA);
      await say('A');
      await say('No');

      expect(db.appointments[0].scheduleSlotId).toBe('slot-old');
      expect(db.slots.find((s) => s.id === 'slot-new')!.isAvailable).toBe(true);
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('3.6 "cambiar mi cita" en medio de un agendamiento NO secuestra el flujo', async () => {
      await say('Hola');
      await say('A');
      await say('cambiar mi cita');

      // isQuickModify solo aplica en IDLE; el turno se trata como texto del menú EPS.
      expect(await state()).toBe(ChatState.AWAITING_EPS);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 4. LISTA DE ESPERA
  // ──────────────────────────────────────────────────────────────────
  describe('4. Lista de espera', () => {
    it('4.1 sin cupos → opt-in → cédula → nombre → entra a la cola con posición', async () => {
      appointments.getAvailableSlots.mockResolvedValue([]);

      await say('Hola');
      await say('A');
      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_WAITLIST_OPTIN);

      await say('Sí');
      expect(await state()).toBe(ChatState.AWAITING_CEDULA);
      expect(redis.store.get(`temp_waitlist_pending:${ORG_ID}:${SENDER}`)).toBe(
        '1',
      );

      await say('1088123456');
      expect(await state()).toBe(ChatState.AWAITING_NAME);

      // Un solo turno: la lista de espera no llega al HIS, así que no necesita
      // la frontera nombres/apellidos y no le cobra un turno extra al paciente.
      await say('Juan Pérez');
      expect(waitlist.joinWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: SVC_MEDICINA.id,
          organizationId: ORG_ID,
          whatsappId: SENDER,
        }),
      );
      expect(lastSent()).toContain('2'); // posición
      expect(surveySpy).toHaveBeenCalledWith(
        ORG_ID,
        SENDER,
        'QUEUED',
        expect.anything(),
      );
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('4.2 declinar el opt-in cierra el flujo sin encolar', async () => {
      appointments.getAvailableSlots.mockResolvedValue([]);

      await say('Hola');
      await say('A');
      await say('A');
      await say('No');

      expect(waitlist.joinWaitlist).not.toHaveBeenCalled();
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('4.3 cupo liberado: notificación proactiva → SÍ reserva la cita del cupo ofrecido', async () => {
      const slot = slotRow('slot-free', FECHA_C, 'Ana Pérez', SVC_MEDICINA);
      db.slots.push(slot);
      db.patients.push({
        id: 'pat-wl',
        cedula: '55555',
        fullName: 'Rosa Díaz',
        organizationId: ORG_ID,
        epsId: null,
        eps: null,
      });
      waitlist.confirmFromWaitlist.mockResolvedValue({
        slotId: 'slot-free',
        patientId: 'pat-wl',
      });

      await service.notifyWaitlistCandidate({
        whatsappId: SENDER,
        organizationId: ORG_ID,
        nombre: 'Rosa Díaz',
        especialidad: 'Medicina General',
        doctor: 'Ana Pérez',
        slotDate: FECHA_C,
      });
      expect(await state()).toBe(ChatState.AWAITING_WAITLIST_CONFIRM);

      await say('Sí');
      expect(waitlist.confirmFromWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({ confirmed: true }),
      );
      expect(appointments.bookAppointment).toHaveBeenCalledWith(
        'pat-wl',
        'slot-free',
        null,
        'WHATSAPP',
        ORG_ID,
      );
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('4.4 rechazar el cupo ofrecido lo devuelve a la cola sin reservar', async () => {
      await service.notifyWaitlistCandidate({
        whatsappId: SENDER,
        organizationId: ORG_ID,
        nombre: 'Rosa Díaz',
        especialidad: 'Medicina General',
        doctor: 'Ana Pérez',
        slotDate: FECHA_C,
      });

      await say('No');
      expect(waitlist.confirmFromWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({ confirmed: false }),
      );
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 5. AISLAMIENTO MULTI-TENANT
  // ──────────────────────────────────────────────────────────────────
  describe('5. Aislamiento multi-tenant', () => {
    const ORG2 = 'org-2';
    const PHONE_ID2 = 'phone-number-id-456';

    beforeEach(() => {
      db.orgsByPhoneId[PHONE_ID2] = {
        id: ORG2,
        name: 'Clínica Norte',
        isActive: true,
        supportPhone: '6011234567',
      };
      db.slots = [slotRow('slot-orgA', FECHA_A, 'Ana Pérez', SVC_MEDICINA)];
      appointments.getAvailableSlots.mockImplementation(() =>
        db.slots.map((s) => ({
          slotId: s.id,
          fecha: s.startTime,
          doctor: s.doctor.fullName,
          servicio: s.service.name,
        })),
      );
    });

    // Regresión F4: `temp_slot_<letra>` va scoped por organización, como el
    // resto de claves de sesión.
    it('5.1 las claves temp_slot_* llevan organizationId', async () => {
      await say('Hola');
      await say('A');
      await say('A');

      const slotKeys = [...redis.store.keys()].filter((k) =>
        k.startsWith('temp_slot_'),
      );
      expect(slotKeys.length).toBeGreaterThan(0);
      expect(slotKeys.every((k) => k.includes(ORG_ID))).toBe(true);
      expect(slotKeys).toContain(`temp_slot_A:${ORG_ID}:${SENDER}`);
    });

    it('5.2 cerrar la sesión en una clínica NO borra los cupos ofrecidos por la otra', async () => {
      await say('Hola');
      await say('A');
      await say('A');
      expect(redis.store.has(`temp_slot_A:${ORG_ID}:${SENDER}`)).toBe(true);

      // El mismo paciente escribe a OTRA clínica y se despide.
      await service.processIncomingMessage(textEvent('chao', PHONE_ID2));

      expect(redis.store.has(`temp_slot_A:${ORG_ID}:${SENDER}`)).toBe(true);
      expect(await state()).toBe(ChatState.AWAITING_DATE);

      // Y el paciente puede retomar su elección en la clínica original.
      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_CEDULA);
    });

    it('5.2b las letras de cupo de dos clínicas no se pisan entre sí', async () => {
      // Clínica A ofrece su cupo.
      await say('Hola');
      await say('A');
      await say('A');
      expect(redis.store.get(`temp_slot_A:${ORG_ID}:${SENDER}`)).toBe(
        'slot-orgA',
      );

      // Clínica B ofrece OTRO cupo, también bajo la letra A.
      db.slots = [slotRow('slot-orgB', FECHA_B, 'Otro Dr', SVC_MEDICINA)];
      await service.processIncomingMessage(textEvent('Hola', PHONE_ID2));
      await service.processIncomingMessage(textEvent('A', PHONE_ID2));
      await service.processIncomingMessage(textEvent('A', PHONE_ID2));

      expect(redis.store.get(`temp_slot_A:${ORG2}:${SENDER}`)).toBe(
        'slot-orgB',
      );
      expect(redis.store.get(`temp_slot_A:${ORG_ID}:${SENDER}`)).toBe(
        'slot-orgA',
      );
    });

    it('5.3 phone_number_id desconocido → el mensaje se descarta sin responder', async () => {
      await service.processIncomingMessage(textEvent('Hola', 'desconocido'));
      expect(sent()).toHaveLength(0);
    });

    it('5.4 organización inactiva → avisa mantenimiento y no abre flujo', async () => {
      db.orgsByPhoneId[PHONE_ID].isActive = false;
      await say('Hola');

      expect(lastSent()).toMatch(/inactiva/i);
      expect(await state()).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 6. GUARDRAILES SOBRE FLUJOS DE CITAS
  // ──────────────────────────────────────────────────────────────────
  describe('6. Guardrailes durante el agendamiento', () => {
    beforeEach(() => {
      db.slots = [slotRow('slot-a', FECHA_A, 'Ana Pérez', SVC_MEDICINA)];
      appointments.getAvailableSlots.mockImplementation(() =>
        db.slots.map((s) => ({
          slotId: s.id,
          fecha: s.startTime,
          doctor: s.doctor.fullName,
          servicio: s.service.name,
        })),
      );
    });

    it('6.1 bandera roja clínica en la confirmación deriva a urgencias y aborta la reserva', async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('1088123456');
      await decirNombre(say);

      await say('me duele mucho el pecho');
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
      expect(lastSent()).toMatch(/123|urgencias/i);
      expect(await state()).toBe(ChatState.IDLE);
      expect(surveySpy).not.toHaveBeenCalled(); // no se encuesta una emergencia
    });

    it('6.2 insulto en pleno flujo cierra la sesión sin agendar', async () => {
      await say('Hola');
      await say('A');
      await say('eres un idiota');

      expect(await state()).toBe(ChatState.IDLE);
      expect(surveySpy).toHaveBeenCalledWith(
        ORG_ID,
        SENDER,
        'BLOCKED_INSULT',
        expect.anything(),
      );
    });

    it('6.3 un error no manejado se audita y no tumba el proceso', async () => {
      appointments.getAvailableSlots.mockRejectedValueOnce(new Error('boom'));

      await say('Hola');
      await say('A');
      await expect(say('A')).resolves.toBeUndefined();

      expect(interactionLog.logFailure).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'UNHANDLED_ERROR' }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 7. ROBUSTEZ DE LA PERSISTENCIA
  // ──────────────────────────────────────────────────────────────────
  describe('7. Persistencia', () => {
    beforeEach(() => {
      db.slots = [slotRow('slot-a', FECHA_A, 'Ana Pérez', SVC_MEDICINA)];
      appointments.getAvailableSlots.mockImplementation(() =>
        db.slots.map((s) => ({
          slotId: s.id,
          fecha: s.startTime,
          doctor: s.doctor.fullName,
          servicio: s.service.name,
        })),
      );
    });

    it('7.1 un paciente nuevo se persiste UNA sola vez (sin duplicar User/PatientProfile)', async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      // Paciente nuevo: nacimiento, sexo antes del resumen.
      await responderAlta(say);
      await say('Sí');

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(prisma.patientProfile.create).toHaveBeenCalledTimes(1);
      expect(db.patients).toHaveLength(1);
    });

    // Regresión F7: "Particular" es pago directo, no una afiliación. Ni el
    // perfil ni la cita quedan ligados a esa fila de EPS.
    it('7.2 con Particular ni el paciente ni la cita quedan ligados a una EPS', async () => {
      await say('Hola');
      await say('A');
      await say('A'); // Particular
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      // Paciente nuevo: nacimiento, sexo antes del resumen.
      await responderAlta(say);
      await say('Sí');

      expect(db.patients[0].epsId).toBeNull();
      expect(appointments.bookAppointment.mock.calls[0][2]).toBeNull();
    });

    it('7.2b con EPS de convenio la cita sí queda ligada a esa EPS', async () => {
      db.enrolled.push({ cedula: '1088123456', epsId: EPS_SURA.id });

      await say('Hola');
      await say('A');
      await say('B'); // Sura
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      // Paciente nuevo: nacimiento, sexo y régimen antes del resumen.
      await responderAlta(say, { conEps: true });
      await say('Sí');

      expect(db.patients[0].epsId).toBe(EPS_SURA.id);
      expect(appointments.bookAppointment.mock.calls[0][2]).toBe(EPS_SURA.id);
    });

    // Regresión F5: handleCancelCedulaStep espera cada escritura del mapping
    // letra→cita antes de ofrecer el menú (antes usaba `forEach` sin await: el
    // turno respondía antes de escribir y un rechazo de Redis quedaba sin
    // manejar, tumbando el proceso Node).
    it('7.3 el mapping letra→cita queda escrito ANTES de ofrecer el menú', async () => {
      db.patients.push({
        id: 'pat-1',
        cedula: '1088123456',
        fullName: 'Juan Pérez',
        organizationId: ORG_ID,
      });
      for (let i = 0; i < 2; i++) {
        const s = slotRow(`slot-${i}`, FECHA_A, `Dr ${i}`, SVC_MEDICINA);
        s.isAvailable = false;
        db.slots.push(s);
        db.appointments.push({
          id: `apt-${i}`,
          patientId: 'pat-1',
          scheduleSlotId: s.id,
          status: 'SCHEDULED',
          organizationId: ORG_ID,
        });
      }

      // Redis "lento" solo para el mapping de cancelación.
      const originalSet = redis.set.getMockImplementation()!;
      redis.set.mockImplementation(async (k: string, v: string) => {
        if (k.startsWith('temp_cancel_apt_')) {
          await new Promise((r) => setTimeout(r, 30));
        }
        return originalSet(k, v);
      });

      await say('cancelar cita');
      await say('1088123456');

      // Al terminar el turno el mapping ya está persistido: el paciente puede
      // responder con su letra de inmediato, sin carrera.
      expect(await state()).toBe(ChatState.AWAITING_CANCEL_SELECTION);
      expect(redis.store.has(`temp_cancel_apt_A:${ORG_ID}:${SENDER}`)).toBe(
        true,
      );
      expect(redis.store.has(`temp_cancel_apt_B:${ORG_ID}:${SENDER}`)).toBe(
        true,
      );
      expect(redis.store.get(`temp_cancel_max_letra:${ORG_ID}:${SENDER}`)).toBe(
        'B',
      );

      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);
    });

    it('7.4 un fallo de Redis al listar las citas se propaga al try/catch global', async () => {
      db.patients.push({
        id: 'pat-1',
        cedula: '1088123456',
        fullName: 'Juan Pérez',
        organizationId: ORG_ID,
      });
      for (let i = 0; i < 2; i++) {
        const s = slotRow(`slot-${i}`, FECHA_A, `Dr ${i}`, SVC_MEDICINA);
        s.isAvailable = false;
        db.slots.push(s);
        db.appointments.push({
          id: `apt-${i}`,
          patientId: 'pat-1',
          scheduleSlotId: s.id,
          status: 'SCHEDULED',
          organizationId: ORG_ID,
        });
      }

      const originalSet = redis.set.getMockImplementation()!;
      redis.set.mockImplementation((k: string, v: string) => {
        if (k.startsWith('temp_cancel_apt_')) throw new Error('redis down');
        return originalSet(k, v);
      });

      await say('cancelar cita');
      // El rechazo ya NO queda huérfano: lo captura processIncomingMessage.
      await expect(say('1088123456')).resolves.toBeUndefined();
      expect(interactionLog.logFailure).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'UNHANDLED_ERROR' }),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 8. Alta de paciente nuevo (bloque F)
  //
  // El HIS del hospital exige FE_NACI_PAC y NU_SEXO_PAC NOT NULL, y el
  // convenio de facturación se resuelve con EPS + régimen. Nada de esto se
  // preguntaba: una cita de paciente nuevo era imposible de escribir en el HIS.
  // ══════════════════════════════════════════════════════════════════
  describe('8. Alta de paciente nuevo', () => {
    beforeEach(() => {
      db.slots = [slotRow('slot-a', FECHA_A, 'Ana Pérez', SVC_MEDICINA)];
      appointments.getAvailableSlots.mockImplementation(() =>
        db.slots.map((s) => ({
          slotId: s.id,
          fecha: s.startTime,
          doctor: s.doctor.fullName,
          servicio: s.service.name,
        })),
      );
    });

    const hastaElNombre = async (epsLetra = 'A') => {
      await say('Hola');
      await say('A');
      await say(epsLetra);
      await say('A');
      await say('1088123456');
      await decirNombre(say);
    };

    it('8.1 a un paciente NUEVO se le piden nacimiento y sexo', async () => {
      await hastaElNombre();
      expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);
      expect(lastSent()).toMatch(/fecha de nacimiento/i);
    });

    it('8.2 devuelve la fecha entendida ANTES de darla por buena', async () => {
      await hastaElNombre();
      await say('15/03/1980');

      // Una fecha mal leída no da error: se propaga en silencio hasta la
      // historia clínica. Por eso se confirma, con día Y año.
      expect(lastSent()).toContain('15');
      expect(lastSent()).toContain('1980');
      expect(lastSent()).toMatch(/marzo/i);
      expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);
    });

    it('8.3 una fecha que no entiende hace repreguntar, no adivinar', async () => {
      await hastaElNombre();
      await say('no me acuerdo');

      expect(lastSent()).toMatch(/15\/03\/1980/);
      expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);
    });

    it('8.4 si la fecha estaba mal, escribirla de nuevo la corrige', async () => {
      await hastaElNombre();
      await say('15/03/1980');
      await say('20/07/1990'); // en vez de confirmar, la reescribe
      expect(lastSent()).toContain('1990');

      await say('SI');
      expect(await state()).toBe(ChatState.AWAITING_GENDER);
    });

    it('8.5 el sexo acepta la letra del menú y la palabra', async () => {
      await hastaElNombre();
      await say('15/03/1980');
      await say('SI');
      expect(await state()).toBe(ChatState.AWAITING_GENDER);

      await say('masculino');
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
    });

    it('8.6 con Particular NO se pregunta el régimen: no lo necesita', async () => {
      await hastaElNombre('A'); // Particular
      await responderAlta(say);

      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
    });

    it('8.7 los tres datos quedan guardados en el paciente', async () => {
      await hastaElNombre();
      await responderAlta(say);
      await say('Sí');

      const p = db.patients[0];
      expect(p.dateOfBirth?.toISOString().slice(0, 10)).toBe('1980-03-15');
      expect(p.gender).toBe('M');
    });

    it('8.8 a un paciente que YA existe no se le pregunta nada de esto', async () => {
      db.patients.push({
        id: 'pat-viejo',
        cedula: '1088123456',
        fullName: 'Juan Pérez',
        organizationId: ORG_ID,
        epsId: null,
      });

      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('1088123456');

      // Sin nombre, sin nacimiento, sin sexo: directo al resumen.
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
    });
  });
});
