import { Test, TestingModule } from '@nestjs/testing';
import { ChatbotService } from './chatbot.service';
import { ChatState } from './chatbot.constants';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { RedisService } from '../redis/redis.service';
import { AppointmentsService } from 'src/appointments/appointments.service';
import {
  LimiteCitasService,
  type LimiteDelPaciente,
} from 'src/appointments/limite-citas.service';
import { WaitlistService } from 'src/waitlist/waitlist.service';
import { InteractionLogService } from '../interaction-log/interaction-log.service';
import { ChannelActivityService } from '../interaction-log/channel-activity.service';
const channelActivity = { record: jest.fn(async () => undefined) };
import {
  diaLocal,
  etiquetaPeriodo,
  fechaEnPalabras,
  franjaDelCupo,
  horaLocalAUtc,
  periodoDelLimite,
  regimenSeguroDelPadron,
  sumarDiasAFecha,
} from '@agenia/shared';
import { KnowledgeBaseService } from './knowledge-base.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { LlmFactoryService } from '../llm/llm-factory.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { WhatsappMessageLogService } from '../whatsapp-config/whatsapp-message-log.service';
import { WhatsappTemplateService } from '../whatsapp-config/whatsapp-template.service';
import { SurveyService } from '../survey/survey.service';
import { AudioConfigService } from '../audio-config/audio-config.service';
import { TtsFactoryService } from '../audio-config/tts/tts-factory.service';
import { SchedulingExtraction } from '../llm/interfaces/llm-provider.interface';
import { MirrorExceptionsService } from '../mirror/mirror-exceptions.service';

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
      // La cita recordada de quien escribe (respuestas al bot): en estos flujos
      // nadie acaba de recibir un recordatorio.
      findFirst: jest.fn(() => null),
      // Citas de médicos sin «WhatsApp ON» (fuera del alcance del bot).
      count: jest.fn(
        ({ where }: any) =>
          db.appointments.filter((a) => {
            const slot = db.slots.find((x) => x.id === a.scheduleSlotId);
            const quiere = where.scheduleSlot?.doctor?.whatsappBookingEnabled;
            return (
              a.patientId === where.patientId &&
              a.status === where.status &&
              (quiere === undefined ||
                (slot?.doctor?.whatsappBookingEnabled ?? true) === quiere)
            );
          }).length,
      ),
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
    regimenDelPadron: jest.Mock;
    cupoMasAllaDelPlazo: jest.Mock;
    hayCuposDesde: jest.Mock;
  };
  // La Bandeja: lo que el bot deja para el personal.
  let avisos: { registrar: jest.Mock };
  let waitlist: {
    joinWaitlist: jest.Mock;
    notifyWaitlist: jest.Mock;
    confirmFromWaitlist: jest.Mock;
  };
  // 📨 Plantillas de WhatsApp: por defecto la clínica no tiene ninguna.
  let plantillas: { findTemplate: jest.Mock; sendTemplate: jest.Mock };
  // 🚦 Límite de citas por paciente: por defecto nadie lo alcanza, así que
  // los flujos de siempre no cambian; la sección 11 lo enciende.
  let limiteCitas: { evaluar: jest.Mock; prepararSolicitud: jest.Mock };
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
  // `redis.store` es un Map en memoria, así que la lectura es síncrona; se
  // declara `async` para que los `await state()` de abajo sigan siendo
  // legítimos (antes la firma prometía una promesa que nunca lo era, y
  // TypeScript lo rechazaba).
  const state = async (): Promise<string | null> =>
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

    avisos = { registrar: jest.fn(async () => 'CREADA') };
    appointments = {
      // Sin plazo para agendar, como siempre: «agenda completa» es agenda completa.
      cupoMasAllaDelPlazo: jest.fn(async () => null),
      getAvailableSlots: jest.fn(() => []),
      // Sin otro día que ofrecer: el menú de siempre, sin la opción «Otro día».
      hayCuposDesde: jest.fn(async () => false),
      bookAppointment: jest.fn(() => ({
        success: true,
        appointmentId: 'apt-new',
      })),
      // La regla REAL sobre el padrón del doble: lo que se prueba es qué hace el
      // bot con la respuesta, y la respuesta tiene que ser la de producción.
      regimenDelPadron: jest.fn(
        (_org: string, cedula: string, epsId: string | null) =>
          regimenSeguroDelPadron(
            db.enrolled
              .filter((e) => e.cedula === cedula)
              .map((e) => ({ epsId: e.epsId, regime: e.regime ?? null })),
            epsId,
          ),
      ),
    };
    plantillas = {
      findTemplate: jest.fn(async () => null),
      sendTemplate: jest.fn(async () => ({ success: true })),
    };
    waitlist = {
      joinWaitlist: jest.fn(() => ({ id: 'wl-1', position: 2 })),
      notifyWaitlist: jest.fn(() => undefined),
      confirmFromWaitlist: jest.fn(() => ({
        slotId: null,
        patientId: null,
      })),
    };
    limiteCitas = {
      evaluar: jest.fn(async () => null),
      prepararSolicitud: jest.fn(async () => ({
        estado: 'ENLACE',
        solicitudId: 'sol-1',
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
        { provide: MirrorExceptionsService, useValue: avisos },
        { provide: WaitlistService, useValue: waitlist },
        { provide: WhatsappTemplateService, useValue: plantillas },
        { provide: LimiteCitasService, useValue: limiteCitas },
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
            operacionesDelBot: jest.fn(() => ({
              agendar: true,
              cancelar: true,
              modificar: true,
            })),
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

      // 📬 La confirmación sale ligada a SU cita en el libro de mensajes: es
      // lo que permite responder después "¿le llegó la confirmación de esta
      // cita?" sin adivinar por hora y teléfono.
      const confirmaciones = sendSpy.mock.calls.filter(
        (c: any[]) => c[2]?.kind === 'BOOKING_CONFIRMATION',
      );
      expect(confirmaciones).toHaveLength(1);
      expect(confirmaciones[0][2]).toEqual({
        kind: 'BOOKING_CONFIRMATION',
        appointmentId: 'apt-new',
      });

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
        // Ficha completa: a la que le falta algo sí se le pregunta (ver 8.10).
        dateOfBirth: new Date('1975-06-01'),
        gender: 'F',
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
  // ──────────────────────────────────────────────────────────────────
  // 🏥 H10 (docs/PLAN_AGENDA_HUECOS.md): el bot NO confirma la cita hasta que
  // el hospital la registra. Mientras, pide unos segundos.
  // ──────────────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────
  // 1B. Otro día u otra hora en el menú de cupos (2026-10-27)
  //
  // El 26 y 27 de octubre, de 34 personas que vieron cupos, 17 agendaron. Al
  // menos 5 pidieron otro día («para mañana no hay», «Podría ser para el
  // miércoles 28») y recibieron «Esa letra no aparece entre las opciones».
  // ──────────────────────────────────────────────────────────────────
  describe('1B. Otro día u otra hora en el menú de cupos', () => {
    // Fechas relativas a HOY en Bogotá: «mañana» y «pasado mañana» se resuelven
    // con el reloj real, así que los cupos también.
    const hoy = diaLocal(new Date());
    const enDia = (n: number, hora: number, min = 0): Date => {
      const [y, m, d] = sumarDiasAFecha(hoy, n).split('-').map(Number);
      return new Date(horaLocalAUtc(y, m, d, hora).getTime() + min * 60_000);
    };
    const enPalabras = (n: number) =>
      fechaEnPalabras(sumarDiasAFecha(hoy, n), { conAnio: false });
    const elegido = () =>
      redis.store.get(`temp_selected_slot_id:${ORG_ID}:${SENDER}`);
    const letra = (l: string) =>
      redis.store.get(`temp_slot_${l}:${ORG_ID}:${SENDER}`);

    // Lo que hace la búsqueda real con la ventana, la franja y los ya vistos;
    // ofrece los 3 primeros, como la clínica.
    const libres = () =>
      db.slots
        .filter((c) => c.isAvailable)
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    beforeEach(() => {
      db.slots = [
        slotRow('m-0800', enDia(1, 8), 'Ana Pérez', SVC_MEDICINA),
        slotRow('m-0820', enDia(1, 8, 20), 'Ana Pérez', SVC_MEDICINA),
        slotRow('m-1400', enDia(1, 14), 'Luis Gómez', SVC_MEDICINA),
        slotRow('p-0800', enDia(2, 8), 'Ana Pérez', SVC_MEDICINA),
        slotRow('p-1500', enDia(2, 15), 'Luis Gómez', SVC_MEDICINA),
      ];
      appointments.getAvailableSlots.mockImplementation(
        (
          _svc: string,
          _eps: string | null,
          _org: string,
          ventana?: { desde: Date; hasta?: Date | null } | null,
          opts: { todos?: boolean; franja?: string; excluir?: string[] } = {},
        ) => {
          const cupos = libres()
            .filter(
              (c) =>
                !ventana ||
                (c.startTime >= ventana.desde &&
                  (!ventana.hasta || c.startTime <= ventana.hasta)),
            )
            .filter(
              (c) => !opts.franja || franjaDelCupo(c.startTime) === opts.franja,
            )
            .filter((c) => !opts.excluir?.includes(c.id))
            .map((c) => ({
              slotId: c.id,
              fecha: c.startTime,
              doctor: c.doctor.fullName,
              servicio: c.service.name,
            }));
          return opts.todos ? cupos : cupos.slice(0, 3);
        },
      );
      appointments.hayCuposDesde.mockImplementation(
        async (_s: string, _e: string | null, _o: string, desde: Date) =>
          libres().some((c) => c.startTime >= desde),
      );
    });

    const hastaLosCupos = async () => {
      await say('Hola');
      await say('A'); // Medicina General
      await say('A'); // Particular
      expect(await state()).toBe(ChatState.AWAITING_DATE);
    };

    it('1B.1 el menú trae «D) Otro día» cuando hay cupos después del último día ofrecido', async () => {
      await hastaLosCupos();
      expect(lastSent()).toMatch(/\*D\)\* Otro día/);
      expect(letra('A')).toBe('m-0800');
      expect(letra('C')).toBe('m-1400');
    });

    it('1B.2 sin cupos otro día, el menú es el de siempre', async () => {
      db.slots = db.slots.filter((c) => c.id.startsWith('m-'));
      await hastaLosCupos();
      expect(lastSent()).not.toMatch(/Otro día/);
    });

    it('1B.3 «D» muestra el día siguiente, y su «A» es el cupo de ese día', async () => {
      await hastaLosCupos();
      await say('D');

      expect(await state()).toBe(ChatState.AWAITING_DATE);
      expect(lastSent()).toContain(enPalabras(2));
      expect(letra('A')).toBe('p-0800');
      expect(letra('B')).toBe('p-1500');
      // La «C» del menú anterior ya no existe: no puede apuntar a un cupo que no ve.
      expect(letra('C')).toBeUndefined();

      await say('A');
      expect(elegido()).toBe('p-0800');
      expect(await state()).toBe(ChatState.AWAITING_CEDULA);
    });

    it('1B.4 «Podría ser para el <día> por favor» (caso 1782) busca ese día', async () => {
      await hastaLosCupos();
      const [, mes, dia] = sumarDiasAFecha(hoy, 2).split('-').map(Number);
      const meses = [
        'enero',
        'febrero',
        'marzo',
        'abril',
        'mayo',
        'junio',
        'julio',
        'agosto',
        'septiembre',
        'octubre',
        'noviembre',
        'diciembre',
      ];
      await say(`Podría ser para el ${dia} de ${meses[mes - 1]} por favor`);

      expect(lastSent()).toMatch(
        new RegExp(`para \\*${enPalabras(2)}\\*`, 'i'),
      );
      expect(letra('A')).toBe('p-0800');
      expect(interactionLog.logFailure).not.toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'SLOT_NOT_UNDERSTOOD' }),
      );
    });

    it('1B.5 «pasado mañana» también', async () => {
      await hastaLosCupos();
      await say('¿Y para pasado mañana no hay?');
      expect(letra('A')).toBe('p-0800');
    });

    it('1B.6 «en la tarde» trae los de la tarde que no ha visto', async () => {
      await hastaLosCupos();
      await say('en la tarde');
      // El de las 2 p. m. de mañana ya lo vio; el de la tarde que sigue, no.
      expect(letra('A')).toBe('p-1500');
      expect(letra('B')).toBeUndefined();
      expect(lastSent()).toContain('la tarde');
    });

    it('1B.7 «Otro horario» trae los que siguen, sin repetir', async () => {
      await hastaLosCupos();
      await say('Otro horario');
      expect(letra('A')).toBe('p-0800');
      expect(letra('B')).toBe('p-1500');
    });

    it('1B.8 «No» (caso 8872) pasa al día siguiente', async () => {
      await hastaLosCupos();
      await say('No');
      expect(letra('A')).toBe('p-0800');
      expect(await state()).toBe(ChatState.AWAITING_DATE);
    });

    it('1B.9 «mañana» con los tres cupos de mañana a la vista: le pide la letra, no adivina', async () => {
      await hastaLosCupos();
      await say('Puede ser para mañana');
      expect(lastSent()).toMatch(/letra/);
      expect(elegido()).toBeUndefined();
      expect(letra('A')).toBe('m-0800');
      expect(await state()).toBe(ChatState.AWAITING_DATE);
    });

    it('1B.10 lo que no se entiende queda como «no se entendió el horario», no como sesión vencida', async () => {
      await hastaLosCupos();
      await say('Q pena');
      expect(lastSent()).toMatch(/día u hora/);
      expect(interactionLog.logFailure).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'SLOT_NOT_UNDERSTOOD' }),
      );
      expect(interactionLog.logFailure).not.toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'SESSION_EXPIRED' }),
      );
    });

    it('1B.11 sin nada distinto que ofrecer: lo dice y sus letras siguen valiendo', async () => {
      db.slots = db.slots.filter((c) => c.id.startsWith('m-'));
      await hastaLosCupos();
      await say('Otro horario');
      expect(lastSent()).toMatch(/no tengo otros horarios/i);
      expect(letra('A')).toBe('m-0800');

      await say('B');
      expect(elegido()).toBe('m-0820');
    });

    it('1B.12 un día más allá del plazo para agendar: le dice hasta cuándo y desde cuándo escribir', async () => {
      // Plazo de 2 días: hoy y mañana.
      (prisma as any).organizationSettings = {
        findUnique: jest.fn(async () => ({ bookingMaxDaysAhead: 2 })),
      };
      await hastaLosCupos();
      await say('pasado mañana');
      expect(lastSent()).toContain(`hasta el *${enPalabras(1)}*`);
      expect(lastSent()).toContain(`desde el *${enPalabras(1)}*`);
      // No se le cambió el menú.
      expect(letra('A')).toBe('m-0800');
      delete (prisma as any).organizationSettings;
    });

    it('1B.13 tras pedir otro día, agendar sigue igual hasta la cita', async () => {
      await hastaLosCupos();
      await say('otro día');
      await say('B'); // p-1500
      await say('1088123456');
      await decirNombre(say);
      await responderAlta(say);
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
      await say('Sí');
      expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
      expect(appointments.bookAppointment.mock.calls[0][1]).toBe('p-1500');
    });

    // ── Diagnóstico del 2026-10-28: frases reales que no se entendían ──
    it('1B.14 «Muchas gracias» en el menú: se despide en vez de pedir la letra', async () => {
      await hastaLosCupos();
      await say('Muchas gracias');
      expect(await state()).toBe(ChatState.IDLE);
      expect(lastSent()).not.toMatch(/letra/);
      expect(interactionLog.logFailure).not.toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'SLOT_NOT_UNDERSTOOD' }),
      );
    });

    it.each([
      ['Perdón es B', 'm-0820'],
      ['Laletra C', 'm-1400'],
      ['mejor la A', 'm-0800'],
    ])('1B.15 «%s»: la letra dentro de la frase', async (frase, cupo) => {
      await hastaLosCupos();
      await say(frase);
      expect(elegido()).toBe(cupo);
    });

    it('1B.16 dos cupos a la misma hora y nombra al médico: elige el de ese médico', async () => {
      db.slots = [
        slotRow('m-0800', enDia(1, 8), 'Ana Pérez', SVC_MEDICINA),
        slotRow('x-0800', enDia(1, 8), 'Luis Gómez', SVC_MEDICINA),
        slotRow('m-1400', enDia(1, 14), 'Luis Gómez', SVC_MEDICINA),
      ];
      await hastaLosCupos();
      await say('Mañana alas 8am con el doctor Luis');
      expect(elegido()).toBe('x-0800');
    });

    it('1B.17 «Para las 3:30»: busca los más cercanos a esa hora, aunque ya los haya visto', async () => {
      await hastaLosCupos();
      appointments.getAvailableSlots.mockClear();
      await say('Para las 3:30');
      const opciones = appointments.getAvailableSlots.mock.calls.at(-1)?.[4];
      expect(opciones).toEqual(
        expect.objectContaining({
          franja: 'TARDE',
          excluir: [],
          hora: { hour24: 3, minute: 30, meridiemKnown: false },
        }),
      );
    });

    it('1B.18 «Otra» a secas trae los que siguen', async () => {
      await hastaLosCupos();
      await say('Otra');
      expect(letra('A')).toBe('p-0800');
    });

    it('1B.19 «Tarde» a secas trae la tarde que no ha visto', async () => {
      await hastaLosCupos();
      await say('Tarde');
      expect(letra('A')).toBe('p-1500');
    });

    // ── El cupo elegido queda apartado mientras termina (2026-10-28) ──
    const apartado = (cupo: string) =>
      redis.store.get(`cupo_apartado:${ORG_ID}:${cupo}`);
    const OTRO = '573009998877';

    it('1B.20 al elegir, el cupo queda apartado para él', async () => {
      await hastaLosCupos();
      await say('A');
      expect(apartado('m-0800')).toBe(SENDER);
    });

    it('1B.21 a otro paciente no se le ofrece un cupo apartado', async () => {
      redis.store.set(`cupo_apartado:${ORG_ID}:m-0800`, OTRO);
      await hastaLosCupos();
      expect(letra('A')).toBe('m-0820');
    });

    it('1B.22 lo apartó otro después de verlo en el menú: menú nuevo sin ese cupo', async () => {
      await hastaLosCupos();
      redis.store.set(`cupo_apartado:${ORG_ID}:m-0800`, OTRO);
      await say('A');
      expect(lastSent()).toMatch(/acaba de tomar otro paciente/);
      expect(lastSent()).toMatch(/quedan/);
      expect(letra('A')).toBe('m-0820');
      expect(elegido()).toBeUndefined();
      expect(apartado('m-0800')).toBe(OTRO);
      expect(interactionLog.logFailure).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'SLOT_TAKEN' }),
      );
    });

    it('1B.23 elegir otra letra suelta el anterior, y salir suelta el que tenía', async () => {
      await hastaLosCupos();
      await say('A');
      await say('Salir');
      expect(apartado('m-0800')).toBeUndefined();
    });

    it('1B.24 ya lo tomaron al confirmar: menú nuevo con lo que queda, sin pedir «la letra nuevamente»', async () => {
      await hastaLosCupos();
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      await responderAlta(say);
      db.slots.find((c) => c.id === 'm-0800')!.isAvailable = false;
      appointments.bookAppointment.mockResolvedValueOnce({
        success: false,
        reason: 'SLOT_TAKEN',
      });
      await say('Sí');
      expect(lastSent()).toMatch(/Estos son los que quedan/);
      expect(letra('A')).toBe('m-0820');
      expect(await state()).toBe(ChatState.AWAITING_DATE);
      expect(apartado('m-0800')).toBeUndefined();
    });

    it('1B.25 ya lo tomaron y no queda nada: lo dice y cierra', async () => {
      db.slots = [slotRow('m-0800', enDia(1, 8), 'Ana Pérez', SVC_MEDICINA)];
      await hastaLosCupos();
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      await responderAlta(say);
      db.slots[0].isAvailable = false;
      appointments.bookAppointment.mockResolvedValueOnce({
        success: false,
        reason: 'SLOT_TAKEN',
      });
      await say('Sí');
      expect(lastSent()).toMatch(/no quedan más horarios/);
      expect(await state()).toBe(ChatState.IDLE);
    });
  });

  describe('1H. Confirmación con el hospital (H10)', () => {
    let confirmacion: {
      requiereConfirmacion: jest.Mock;
      puedeAgendar: jest.Mock;
      compuertas: jest.Mock;
      esperar: jest.Mock;
      registrarPendiente: jest.Mock;
      pendientes: jest.Mock;
      estado: jest.Mock;
      reclamar: jest.Mock;
    };

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
      confirmacion = {
        requiereConfirmacion: jest.fn(async () => true),
        puedeAgendar: jest.fn(async () => true),
        compuertas: jest.fn(async () => ({
          agendar: true,
          cancelar: true,
          modificar: true,
          otros: true,
        })),
        esperar: jest.fn(async () => 'CONFIRMADA'),
        registrarPendiente: jest.fn(async () => undefined),
        pendientes: jest.fn(async () => []),
        estado: jest.fn(async () => 'PENDIENTE'),
        reclamar: jest.fn(async () => true),
      };
      (service as any).confirmacionHis = confirmacion;
    });

    const agendarHastaElSi = async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('1088123456');
      await decirNombre(say);
      await responderAlta(say);
      await say('Sí');
    };
    const confirmacionesFinales = () =>
      sendSpy.mock.calls.filter(
        (c: any[]) => c[2]?.kind === 'BOOKING_CONFIRMATION',
      );

    it('CONFIRMADA: primero pide unos segundos, después confirma (y solo después)', async () => {
      await agendarHastaElSi();

      expect(confirmacion.esperar).toHaveBeenCalledWith(ORG_ID, 'apt-new');
      const textos = sent();
      const iEspera = textos.findIndex((t) =>
        /(confirmando|registrando) su cita/i.test(t),
      );
      const iConfirma = sendSpy.mock.calls.findIndex(
        (c: any[]) => c[2]?.kind === 'BOOKING_CONFIRMATION',
      );
      expect(iEspera).toBeGreaterThanOrEqual(0);
      expect(iConfirma).toBeGreaterThan(iEspera);
      expect(interactionLog.logBookingConfirmed).toHaveBeenCalledTimes(1);
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('RECHAZADA por el hospital: NO confirma y le ofrece elegir otro horario', async () => {
      confirmacion.esperar.mockResolvedValueOnce('RECHAZADA');

      await agendarHastaElSi();

      expect(confirmacionesFinales()).toHaveLength(0);
      expect(interactionLog.logBookingConfirmed).not.toHaveBeenCalled();
      expect(lastSent()).toMatch(/acaba de (tomar|reservarse)/i);
      expect(await state()).toBe(ChatState.AWAITING_DATE);
      // Puede elegir otra letra sin reiniciar.
      await say('B');
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
    });

    it('sin respuesta a tiempo: NO confirma, avisa que le escribe y deja la cita pendiente', async () => {
      confirmacion.esperar.mockResolvedValueOnce('PENDIENTE');

      await agendarHastaElSi();

      expect(confirmacionesFinales()).toHaveLength(0);
      expect(lastSent()).toMatch(/aún no termina de registrar/i);
      expect(confirmacion.registrarPendiente).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          senderId: SENDER,
          appointmentId: 'apt-new',
        }),
      );
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('una clínica SIN espejo confirma como siempre, sin pedir espera', async () => {
      confirmacion.requiereConfirmacion.mockResolvedValue(false);

      await agendarHastaElSi();

      expect(confirmacion.esperar).not.toHaveBeenCalled();
      expect(
        sent().some((t) => /(confirmando|registrando) su cita/i.test(t)),
      ).toBe(false);
      expect(confirmacionesFinales()).toHaveLength(1);
    });

    it('con el envío al hospital APAGADO (y cancelar y cambiar cerrados) el bot no agenda: queda en «solo consultas»', async () => {
      confirmacion.compuertas.mockResolvedValue({
        agendar: false,
        cancelar: false,
        modificar: false,
        otros: false,
      });

      await say('Hola');

      expect(lastSent()).toMatch(/no está activa para agendar/i);
      expect(appointments.getAvailableSlots).not.toHaveBeenCalled();
    });

    it('🚪 con el envío de citas nuevas apagado pero «Cancelar» abierto, no agenda y dice que cancelar sí se puede', async () => {
      confirmacion.compuertas.mockResolvedValue({
        agendar: false,
        cancelar: true,
        modificar: false,
        otros: false,
      });

      await say('Hola');

      expect(lastSent()).not.toMatch(/no está activa para agendar, cancelar/i);
      expect(lastSent()).toContain(
        'Cancelar una cita: escríbame *"cancelar cita"*',
      );
      expect(appointments.getAvailableSlots).not.toHaveBeenCalled();
    });

    describe('barrido de confirmaciones pendientes', () => {
      const pendiente = (desde = new Date().toISOString()) => ({
        organizationId: ORG_ID,
        senderId: SENDER,
        appointmentId: 'apt-new',
        fechaTexto: 'lunes 5 de octubre, 8:00 a. m.',
        desde,
      });

      it('cuando el hospital la registra, llega la confirmación final ligada a la cita', async () => {
        confirmacion.pendientes.mockResolvedValue([pendiente()]);
        confirmacion.estado.mockResolvedValue('CONFIRMADA');

        await service.atenderConfirmacionesHisPendientes();

        expect(confirmacion.reclamar).toHaveBeenCalled();
        expect(confirmacionesFinales()).toHaveLength(1);
        expect(confirmacionesFinales()[0][2]).toEqual({
          kind: 'BOOKING_CONFIRMATION',
          appointmentId: 'apt-new',
        });
      });

      it('si el hospital la rechaza, se le avisa con el teléfono del hospital', async () => {
        confirmacion.pendientes.mockResolvedValue([pendiente()]);
        confirmacion.estado.mockResolvedValue('RECHAZADA');
        prisma.organization.findUnique.mockResolvedValue({
          id: ORG_ID,
          name: ORG_NAME,
          supportPhone: '6068538838',
        });

        await service.atenderConfirmacionesHisPendientes();

        expect(confirmacionesFinales()).toHaveLength(0);
        expect(lastSent()).toMatch(/no pudo registrar su cita/i);
        expect(lastSent()).toContain('6068538838');
      });

      it('si sigue pendiente, no se le escribe ni se reclama', async () => {
        confirmacion.pendientes.mockResolvedValue([pendiente()]);
        confirmacion.estado.mockResolvedValue('PENDIENTE');

        await service.atenderConfirmacionesHisPendientes();

        expect(confirmacion.reclamar).not.toHaveBeenCalled();
        expect(sendSpy).not.toHaveBeenCalled();
      });

      it('si otra réplica ya la tomó, esta no le escribe', async () => {
        confirmacion.pendientes.mockResolvedValue([pendiente()]);
        confirmacion.estado.mockResolvedValue('CONFIRMADA');
        confirmacion.reclamar.mockResolvedValue(false);

        await service.atenderConfirmacionesHisPendientes();

        expect(sendSpy).not.toHaveBeenCalled();
      });

      it('pendiente por más de 24 h: se abandona sin escribirle', async () => {
        const hace25h = new Date(Date.now() - 25 * 3600_000).toISOString();
        confirmacion.pendientes.mockResolvedValue([pendiente(hace25h)]);
        confirmacion.estado.mockResolvedValue('PENDIENTE');

        await service.atenderConfirmacionesHisPendientes();

        expect(confirmacion.reclamar).toHaveBeenCalled();
        expect(sendSpy).not.toHaveBeenCalled();
      });
    });
  });

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
      // Con un celular de la familia, de quién es la cita (2026-10-28).
      expect(lastSent()).toContain('👤 *Juan Pérez*');

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

    it('2.2b ❓ una pregunta en la confirmación no cancela; «¿me la cancela?» sí', async () => {
      seedPatientWithAppointments(1);

      await say('cancelar cita');
      await say(CEDULA);
      await say('¿Si la cancelo me pueden dar otra para la otra semana?');
      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(await state()).toBe(ChatState.AWAITING_CANCEL_CONFIRM);

      await say('¿Me la cancela por favor?');
      expect(db.appointments[0].status).toBe('CANCELLED');
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

    it('🔐 2.10 la cédula de OTRO paciente (otro número) no se cancela: ni se listan sus citas', async () => {
      db.patients.push({
        id: 'pat-otro',
        cedula: '1099887766',
        fullName: 'María Gómez',
        organizationId: ORG_ID,
        whatsappId: '573009998877',
      });
      const s = slotRow('slot-otro', FECHA_A, 'Ana Pérez', SVC_MEDICINA);
      s.isAvailable = false;
      db.slots.push(s);
      db.appointments.push({
        id: 'apt-otro',
        patientId: 'pat-otro',
        scheduleSlotId: 'slot-otro',
        status: 'SCHEDULED',
        organizationId: ORG_ID,
      });

      await say('cancelar cita');
      await say('1099887766');

      expect(lastSent()).toContain(
        'Por seguridad, solo puedo cancelar una cita',
      );
      expect(sent().join('\n')).not.toContain('María');
      expect(sent().join('\n')).not.toContain('Ana Pérez');
      expect(db.appointments[0].status).toBe('SCHEDULED');
      expect(interactionLog.logFailure).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'PATIENT_CHANNEL_MISMATCH' }),
      );
      expect([null, ChatState.IDLE]).toContain(await state());
    });

    it('2.5 cédula sin citas → entra al loop de reintento y NO penaliza reintentos', async () => {
      db.patients.push({
        id: 'pat-1',
        cedula: CEDULA,
        fullName: 'Juan Pérez',
        organizationId: ORG_ID,
        whatsappId: SENDER,
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
    // ⏱️ El cambio de fecha revisa la anticipación mínima al confirmar
    // (2026-10-21): con el reloj real, los cupos de ejemplo (septiembre de 2026)
    // ya pasaron. Solo se congela la fecha; los temporizadores siguen siendo reales.
    beforeEach(() => {
      jest.useFakeTimers({
        now: new Date('2026-09-01T12:00:00.000Z'),
        doNotFake: [
          'nextTick',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout',
          'queueMicrotask',
          'hrtime',
          'performance',
        ],
      });
    });
    afterEach(() => jest.useRealTimers());

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

    // 2026-10-28: «Nesesito otra cita para lectura de examenes», justo después
    // de agendar, movió la cita recién agendada.
    it('3.1b «Necesito otra cita para…» es una cita NUEVA aunque el extractor diga cambio', async () => {
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ isModification: true }),
      );
      await say('Nesesito otra cita para lectura de examenes');
      expect(await state()).not.toBe(ChatState.AWAITING_MODIFY_CEDULA);
      expect(await state()).not.toBe(ChatState.AWAITING_MODIFY_NEW_SLOT);
      expect(db.appointments[0].scheduleSlotId).toBe('slot-old');
    });

    it('3.1c «otra cita porque no puedo ir» sí es un cambio', async () => {
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ isModification: true }),
      );
      await say('Necesito otra cita porque no puedo ir');
      expect([
        ChatState.AWAITING_MODIFY_CEDULA,
        ChatState.AWAITING_MODIFY_NEW_SLOT,
      ]).toContain(await state());
    });

    // ── 2026-10-28: el menú de cambiar la fecha solo entendía la letra. A
    // «Ninguna, es que mañana debo viajar a Pereira» contestaba «No reconozco
    // esa opción» y la paciente se fue con su cita en pie.
    describe('3.M el menú de cambiar la fecha entiende más que la letra', () => {
      const letraCambio = (l: string) =>
        redis.store.get(`temp_modify_newslot_${l}:${ORG_ID}:${SENDER}`);
      // La búsqueda real: con la ventana y sin los que se excluyen.
      beforeEach(() => {
        appointments.getAvailableSlots.mockImplementation(
          (
            _svc: string,
            _eps: string | null,
            _org: string,
            ventana?: { desde: Date; hasta?: Date | null } | null,
            opts: { excluir?: string[] } = {},
          ) =>
            db.slots
              .filter((c) => c.isAvailable)
              .filter(
                (c) =>
                  !ventana ||
                  (c.startTime >= ventana.desde &&
                    (!ventana.hasta || c.startTime <= ventana.hasta)),
              )
              .filter((c) => !opts.excluir?.includes(c.id))
              .map((c) => ({
                slotId: c.id,
                fecha: c.startTime,
                doctor: c.doctor.fullName,
                servicio: c.service.name,
              })),
        );
      });
      const hastaElMenu = async () => {
        await say('reprogramar mi cita');
        await say(CEDULA);
        expect(await state()).toBe(ChatState.AWAITING_MODIFY_NEW_SLOT);
        expect(letraCambio('A')).toBe('slot-new');
      };

      it('3.M1 «Ninguna» con horarios otro día: le ofrece esos', async () => {
        await hastaElMenu();
        // Un horario de otro día que no estaba entre los que se le mostraron.
        db.slots.push(slotRow('slot-later', FECHA_C, 'Otra Dra', SVC_MEDICINA));
        await say('Ninguna esque mañana devo viajar a Pereira');
        expect(await state()).toBe(ChatState.AWAITING_MODIFY_NEW_SLOT);
        expect(letraCambio('A')).toBe('slot-later');
        expect(db.appointments[0].scheduleSlotId).toBe('slot-old');
      });

      it('3.M2 «Ninguna» sin más horarios: le ofrece cancelarla, y el SÍ la cancela', async () => {
        await hastaElMenu();
        await say('Ninguna');
        expect(await state()).toBe(ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL);
        expect(lastSent()).toMatch(/cancele/);
        await say('Sí');
        expect(db.appointments[0].status).toBe('CANCELLED');
      });

      it('3.M3 «Ninguna» sin más horarios y con cancelar apagado: el pedido queda en la Bandeja', async () => {
        (service as any).organizationSettings.operacionesDelBot.mockReturnValue(
          {
            agendar: true,
            cancelar: false,
            modificar: true,
          },
        );
        await hastaElMenu();
        await say('Ninguna');
        expect(avisos.registrar).toHaveBeenCalledWith(
          ORG_ID,
          expect.objectContaining({
            kind: 'AVISO_INASISTENCIA',
            appointmentId: 'apt-0',
            meta: expect.objectContaining({ pide: 'MODIFICAR' }),
          }),
          expect.any(Date),
        );
        expect(lastSent()).toMatch(/Dejé su solicitud/);
        expect(await state()).toBe(ChatState.IDLE);
        expect(db.appointments[0].status).toBe('SCHEDULED');
      });

      it('3.M4 «Perdón es la A»: la letra dentro de la frase', async () => {
        await hastaElMenu();
        await say('Perdón es la A');
        expect(await state()).toBe(ChatState.AWAITING_MODIFY_CONFIRM);
      });

      it('3.M5 «Muchas gracias»: se despide y la cita no se toca', async () => {
        await hastaElMenu();
        await say('Muchas gracias');
        expect(await state()).toBe(ChatState.IDLE);
        expect(letraCambio('A')).toBeUndefined();
        expect(db.appointments[0].scheduleSlotId).toBe('slot-old');
      });

      it('3.M6 lo que no entiende: le dice que puede escribir el día, la hora o «Ninguna»', async () => {
        await hastaElMenu();
        await say('xyz');
        expect(lastSent()).toMatch(/No reconozco esa opción/);
        expect(lastSent()).toMatch(/Ninguna/);
        expect(await state()).toBe(ChatState.AWAITING_MODIFY_NEW_SLOT);
      });

      it('3.M7 trae «Otro día» cuando hay horarios después, y elegirla los muestra', async () => {
        appointments.hayCuposDesde.mockResolvedValue(true);
        await hastaElMenu();
        expect(lastSent()).toMatch(/\*B\)\* Otro día/);
        expect(
          redis.store.get(`temp_modify_otro_dia:${ORG_ID}:${SENDER}`),
        ).toBe('B');
        db.slots.push(slotRow('slot-later', FECHA_C, 'Otra Dra', SVC_MEDICINA));
        await say('B');
        expect(await state()).toBe(ChatState.AWAITING_MODIFY_NEW_SLOT);
        expect(letraCambio('A')).toBe('slot-later');
      });
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

    it('3.2b 📅 el administrador bloquea el día del nuevo cupo antes del SÍ → no se mueve y reofrece', async () => {
      await say('reprogramar mi cita');
      await say(CEDULA);
      await say('A'); // slot-new, 16 de septiembre

      // Configuración › Días sin citas: ese día ya no se ofrece por el asistente.
      (prisma._tx as any).bookingBlock = {
        findMany: jest.fn(() => [
          {
            date: '2026-09-16',
            repeatWeekly: false,
            startMinute: null,
            endMinute: null,
          },
        ]),
      };
      (prisma._tx as any).organization = {
        findUnique: jest.fn(() => ({ timezone: 'America/Bogota' })),
      };
      db.slots.push(slotRow('slot-alt', FECHA_C, 'Otra Dra', SVC_MEDICINA));

      await say('Sí');
      expect(db.appointments[0].scheduleSlotId).toBe('slot-old'); // sin cambios
      expect(db.slots.find((s) => s.id === 'slot-new')!.isAvailable).toBe(true);
      expect(await state()).toBe(ChatState.AWAITING_MODIFY_NEW_SLOT);
    });

    it('3.2c 🗓️ el administrador acorta el plazo para agendar antes del SÍ → no se mueve y reofrece', async () => {
      await say('reprogramar mi cita');
      await say(CEDULA);
      await say('A'); // slot-new, 16 de septiembre

      // Configuración › Plazo máximo para agendar: hoy (1 de septiembre) es el
      // día 1; con 7 días el 16 ya no se da por el asistente.
      (prisma._tx as any).organizationSettings = {
        findUnique: jest.fn(() => ({ bookingMaxDaysAhead: 7 })),
      };
      (prisma._tx as any).organization = {
        findUnique: jest.fn(() => ({ timezone: 'America/Bogota' })),
      };
      db.slots.push(slotRow('slot-alt', FECHA_C, 'Otra Dra', SVC_MEDICINA));

      await say('Sí');
      expect(db.appointments[0].scheduleSlotId).toBe('slot-old'); // sin cambios
      expect(db.slots.find((s) => s.id === 'slot-new')!.isAvailable).toBe(true);
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

    it('3.4b 🗓️ sin otro horario dentro del plazo pero sí después: no ofrece cancelar, dice desde cuándo escribir', async () => {
      db.slots.find((s) => s.id === 'slot-new')!.isAvailable = false;
      appointments.cupoMasAllaDelPlazo.mockResolvedValue({
        ultimoDia: '2026-10-24',
        primerDia: '2026-10-26',
        desde: '2026-10-25',
      });

      await say('reagendar');
      await say(CEDULA);
      expect(lastSent()).toContain(
        'Por ahora agendamos citas hasta el *sábado 24 de octubre*',
      );
      expect(lastSent()).toContain(
        'Escríbanos desde el *domingo 25 de octubre*',
      );
      expect(lastSent()).toContain('Su cita actual sigue en pie');
      expect(lastSent()).not.toContain('cancele');
      expect(await state()).not.toBe(ChatState.AWAITING_MODIFY_NO_SLOTS_CANCEL);
      expect(db.appointments[0].status).toBe('SCHEDULED');
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

    // ────────────────────────────────────────────────────────────────
    // 🏥 H10 para el CAMBIO de fecha: el bot no confirma el cambio hasta que
    // el hospital lo registra, y mientras tanto el cupo de antes sigue
    // reservado (si el hospital lo rechaza, la cita vuelve a él).
    // ────────────────────────────────────────────────────────────────
    describe('3H. Cambio de fecha con el hospital (H10)', () => {
      let confirmacion: Record<string, jest.Mock>;
      const cupo = (id: string) => db.slots.find((s) => s.id === id)!;
      const exito = () =>
        sent().filter((t) => /reprogramada|Moví su cita/i.test(t));

      beforeEach(() => {
        confirmacion = {
          requiereConfirmacion: jest.fn(async () => true),
          puedeAgendar: jest.fn(async () => true),
          compuertas: jest.fn(async () => ({
            agendar: true,
            cancelar: true,
            modificar: true,
            otros: true,
          })),
          eventoDelCambio: jest.fn(async () => '77'),
          esperarCambio: jest.fn(async () => 'CONFIRMADA'),
          estadoCambio: jest.fn(async () => 'PENDIENTE'),
          liberarCupoAnterior: jest.fn(async (_org: string, id: string) => {
            cupo(id).isAvailable = true;
            return true;
          }),
          registrarPendiente: jest.fn(async () => undefined),
          pendientes: jest.fn(async () => []),
          reclamar: jest.fn(async () => true),
          estado: jest.fn(async () => 'PENDIENTE'),
          esperar: jest.fn(async () => 'CONFIRMADA'),
        };
        (service as any).confirmacionHis = confirmacion;
      });

      const cambiarHastaElSi = async () => {
        await say('reprogramar mi cita');
        await say(CEDULA);
        await say('A');
        await say('Sí');
      };

      it('CONFIRMADA: pide unos segundos con el cupo de antes RESERVADO, y solo después confirma y lo libera', async () => {
        let anteriorReservadoAlEsperar: boolean | undefined;
        confirmacion.esperarCambio.mockImplementation(async () => {
          anteriorReservadoAlEsperar = !cupo('slot-old').isAvailable;
          return 'CONFIRMADA';
        });

        await cambiarHastaElSi();

        expect(confirmacion.esperarCambio).toHaveBeenCalledWith(
          ORG_ID,
          'apt-0',
          '77',
          'slot-new',
        );
        expect(anteriorReservadoAlEsperar).toBe(true);
        const textos = sent();
        const iEspera = textos.findIndex((t) =>
          /(registrando el cambio|pasando su cita al nuevo horario)/i.test(t),
        );
        const iExito = textos.findIndex((t) =>
          /reprogramada|Moví su cita/i.test(t),
        );
        expect(iEspera).toBeGreaterThanOrEqual(0);
        expect(iExito).toBeGreaterThan(iEspera);
        expect(confirmacion.liberarCupoAnterior).toHaveBeenCalledWith(
          ORG_ID,
          'slot-old',
        );
        expect(waitlist.notifyWaitlist).toHaveBeenCalledWith(
          expect.objectContaining({ slotId: 'slot-old' }),
        );
        expect(db.appointments[0].scheduleSlotId).toBe('slot-new');
        expect(await state()).toBe(ChatState.IDLE);
      });

      it('RECHAZADA: no confirma, dice que la cita sigue en su hora de antes y ofrece otros horarios', async () => {
        db.slots.push(slotRow('slot-alt', FECHA_C, 'Otra Dra', SVC_MEDICINA));
        // Lo que hace la API al recibir el rechazo: la cita vuelve a su cupo y
        // el nuevo queda cerrado.
        confirmacion.esperarCambio.mockImplementation(async () => {
          db.appointments[0].scheduleSlotId = 'slot-old';
          cupo('slot-new').isAvailable = false;
          return 'RECHAZADA';
        });

        await cambiarHastaElSi();

        expect(exito()).toHaveLength(0);
        expect(
          sent().some(
            (t) => /no pudo registrar el cambio/i.test(t) && /sigue el/.test(t),
          ),
        ).toBe(true);
        expect(confirmacion.liberarCupoAnterior).not.toHaveBeenCalled();
        expect(waitlist.notifyWaitlist).not.toHaveBeenCalled();
        expect(cupo('slot-old').isAvailable).toBe(false);
        // Puede elegir otro horario sin empezar de nuevo.
        expect(await state()).toBe(ChatState.AWAITING_MODIFY_NEW_SLOT);
      });

      it('sin respuesta a tiempo: no confirma, avisa que le escribe y deja el cambio pendiente con sus cupos', async () => {
        confirmacion.esperarCambio.mockResolvedValue('PENDIENTE');

        await cambiarHastaElSi();

        expect(exito()).toHaveLength(0);
        expect(lastSent()).toMatch(/aún no termina de registrar el cambio/i);
        expect(confirmacion.registrarPendiente).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: ORG_ID,
            senderId: SENDER,
            appointmentId: 'apt-0',
            tipo: 'CAMBIO',
            seq: '77',
            cupoNuevoId: 'slot-new',
            cupoAnteriorId: 'slot-old',
          }),
        );
        // El cupo de antes sigue reservado hasta que el hospital responda.
        expect(cupo('slot-old').isAvailable).toBe(false);
        expect(waitlist.notifyWaitlist).not.toHaveBeenCalled();
        expect(await state()).toBe(ChatState.IDLE);
      });

      it('una clínica SIN espejo cambia como siempre: sin espera y liberando el cupo de antes en el acto', async () => {
        confirmacion.requiereConfirmacion.mockResolvedValue(false);

        await cambiarHastaElSi();

        expect(confirmacion.esperarCambio).not.toHaveBeenCalled();
        expect(cupo('slot-old').isAvailable).toBe(true);
        expect(exito()).toHaveLength(1);
      });

      describe('barrido de cambios pendientes', () => {
        const pendiente = {
          organizationId: ORG_ID,
          senderId: SENDER,
          appointmentId: 'apt-0',
          fechaTexto: 'martes 6 de octubre, 9:00 a. m.',
          desde: new Date().toISOString(),
          tipo: 'CAMBIO',
          seq: '77',
          cupoNuevoId: 'slot-new',
          cupoAnteriorId: 'slot-old',
          fechaAnteriorTexto: 'lunes 5 de octubre, 8:00 a. m.',
        };

        it('cuando el hospital lo registra: libera el cupo de antes, avisa a la lista y confirma', async () => {
          confirmacion.pendientes.mockResolvedValue([pendiente]);
          confirmacion.estadoCambio.mockResolvedValue('CONFIRMADA');

          await service.atenderConfirmacionesHisPendientes();

          expect(confirmacion.estadoCambio).toHaveBeenCalledWith(
            ORG_ID,
            'apt-0',
            '77',
            'slot-new',
          );
          expect(confirmacion.estado).not.toHaveBeenCalled();
          expect(confirmacion.liberarCupoAnterior).toHaveBeenCalledWith(
            ORG_ID,
            'slot-old',
          );
          expect(waitlist.notifyWaitlist).toHaveBeenCalledWith(
            expect.objectContaining({ slotId: 'slot-old' }),
          );
          expect(lastSent()).toContain('martes 6 de octubre');
        });

        it('si el hospital lo rechaza: le dice que su cita sigue en su hora de antes, con el teléfono', async () => {
          confirmacion.pendientes.mockResolvedValue([pendiente]);
          confirmacion.estadoCambio.mockResolvedValue('RECHAZADA');
          prisma.organization.findUnique.mockResolvedValue({
            id: ORG_ID,
            name: ORG_NAME,
            supportPhone: '6068538838',
          });

          await service.atenderConfirmacionesHisPendientes();

          const r = lastSent();
          expect(r).toMatch(/no pudo registrar el cambio/i);
          expect(r).toContain('sigue el lunes 5 de octubre, 8:00 a. m.');
          expect(r).toContain('"cambiar cita"');
          expect(r).toContain('6068538838');
          expect(confirmacion.liberarCupoAnterior).not.toHaveBeenCalled();
        });

        it('si la cita se anuló mientras tanto, no se le escribe', async () => {
          confirmacion.pendientes.mockResolvedValue([pendiente]);
          confirmacion.estadoCambio.mockResolvedValue('ANULADA');

          await service.atenderConfirmacionesHisPendientes();

          expect(confirmacion.reclamar).toHaveBeenCalled();
          expect(sendSpy).not.toHaveBeenCalled();
        });

        it('si sigue pendiente, ni se reclama ni se le escribe', async () => {
          confirmacion.pendientes.mockResolvedValue([pendiente]);
          confirmacion.estadoCambio.mockResolvedValue('PENDIENTE');

          await service.atenderConfirmacionesHisPendientes();

          expect(confirmacion.reclamar).not.toHaveBeenCalled();
          expect(sendSpy).not.toHaveBeenCalled();
        });
      });
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
        epsId: null,
      });

      // La oferta sale: Meta la acepta.
      sendSpy.mockResolvedValueOnce({ messages: [{ id: 'wamid.oferta' }] });
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
      // La oferta sale: Meta la acepta.
      sendSpy.mockResolvedValueOnce({ messages: [{ id: 'wamid.oferta' }] });
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

    // 📨 2026-10-26: a quien no escribió en 24 h, WhatsApp solo le entrega una
    // plantilla aprobada. La lista de espera decide la vía; el bot la envía.
    describe('4.5 oferta con la plantilla «Oferta de cupo»', () => {
      const ofrecer = (via?: 'TEXTO' | 'PLANTILLA') =>
        service.notifyWaitlistCandidate({
          whatsappId: SENDER,
          organizationId: ORG_ID,
          nombre: 'HENRY ANTONIO OSPINA MARIN',
          especialidad: 'Medicina General',
          doctor: 'Ana Pérez',
          slotDate: FECHA_C,
          slotId: 'slot-free',
          via,
        });

      it('sale la plantilla con primer nombre, servicio y fecha (sin el punto de «a. m.»), y su SÍ reserva el cupo', async () => {
        db.slots.push(slotRow('slot-free', FECHA_C, 'Ana Pérez', SVC_MEDICINA));
        db.patients.push({
          id: 'pat-wl',
          cedula: '9695539',
          fullName: 'HENRY ANTONIO OSPINA MARIN',
          organizationId: ORG_ID,
          epsId: null,
          eps: null,
        });
        waitlist.confirmFromWaitlist.mockResolvedValue({
          slotId: 'slot-free',
          patientId: 'pat-wl',
          epsId: null,
        });

        expect(await ofrecer('PLANTILLA')).toBe(true);

        expect(plantillas.sendTemplate).toHaveBeenCalledTimes(1);
        const envio = plantillas.sendTemplate.mock.calls[0][0];
        expect(envio).toMatchObject({
          organizationId: ORG_ID,
          recipientId: SENDER,
          kind: 'WAITLIST_SLOT_OFFER',
        });
        expect(envio.bodyParams).toHaveLength(3);
        expect(envio.bodyParams[0]).toBe('HENRY');
        expect(envio.bodyParams[1]).toBe('Medicina General');
        expect(envio.bodyParams[2]).not.toMatch(/\.$/);
        // Por plantilla, no por texto libre.
        expect(sendSpy).not.toHaveBeenCalled();
        expect(await state()).toBe(ChatState.AWAITING_WAITLIST_CONFIRM);
        expect(interactionLog.logWaitlistNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            slotId: 'slot-free',
            botReply: expect.stringContaining(
              '[Plantilla WAITLIST_SLOT_OFFER]',
            ),
          }),
        );

        await say('Sí');
        expect(appointments.bookAppointment).toHaveBeenCalledWith(
          'pat-wl',
          'slot-free',
          null,
          'WHATSAPP',
          ORG_ID,
        );
      });

      it('si Meta rechaza la plantilla: devuelve false y la conversación queda como estaba', async () => {
        redis.store.set(
          `chat_state:${ORG_ID}:${SENDER}`,
          ChatState.AWAITING_SPECIALTY,
        );
        plantillas.sendTemplate.mockResolvedValueOnce({
          success: false,
          error: 'template-not-configured',
        });

        expect(await ofrecer('PLANTILLA')).toBe(false);

        expect(await state()).toBe(ChatState.AWAITING_SPECIALTY);
        expect(interactionLog.logWaitlistNotification).not.toHaveBeenCalled();
      });

      it('si el texto no sale: devuelve false y, sin paso previo, la conversación queda en reposo', async () => {
        sendSpy.mockResolvedValueOnce(null);

        expect(await ofrecer('TEXTO')).toBe(false);

        expect(
          redis.store.get(`chat_state:${ORG_ID}:${SENDER}`),
        ).toBeUndefined();
        expect(plantillas.sendTemplate).not.toHaveBeenCalled();
      });

      it('sin decir la vía, como antes: texto libre', async () => {
        sendSpy.mockResolvedValueOnce({ messages: [{ id: 'wamid.oferta' }] });
        expect(await ofrecer()).toBe(true);
        expect(plantillas.sendTemplate).not.toHaveBeenCalled();
        expect(lastSent()).toContain('Ana Pérez');
      });

      it('ofertaDeCupoConPlantilla: solo con la plantilla activa de la clínica', async () => {
        expect(await service.ofertaDeCupoConPlantilla(ORG_ID)).toBe(false);
        plantillas.findTemplate.mockResolvedValueOnce({
          name: 'oferta_cupo_lista_espera',
        });
        expect(await service.ofertaDeCupoConPlantilla(ORG_ID)).toBe(true);
        expect(plantillas.findTemplate).toHaveBeenLastCalledWith(
          ORG_ID,
          'WAITLIST_SLOT_OFFER',
        );
        plantillas.findTemplate.mockRejectedValueOnce(new Error('BD caída'));
        expect(await service.ofertaDeCupoConPlantilla(ORG_ID)).toBe(false);
      });
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
        whatsappId: SENDER,
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
      const originalSet = redis.set.getMockImplementation()! as (
        k: string,
        v: string,
      ) => unknown;
      // El doble de Redis declara `set` síncrono; aquí se necesita meter una
      // demora, así que la implementación asíncrona se inyecta por `as never`.
      redis.set.mockImplementation((async (k: string, v: string) => {
        if (k.startsWith('temp_cancel_apt_')) {
          await new Promise((r) => setTimeout(r, 30));
        }
        return originalSet(k, v);
      }) as never);

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
        whatsappId: SENDER,
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

    // 🪪 2026-10-26: una paciente nueva escribió «Otro horario» en el paso de
    // los nombres (quería otro horario) y el asistente lo aceptó como nombre.
    describe('8.N frases que no son un nombre', () => {
      const hastaPedirNombre = async () => {
        await say('Hola');
        await say('A');
        await say('A');
        await say('A');
        await say('1088123456');
        expect(await state()).toBe(ChatState.AWAITING_NAME);
      };

      it('«Otro horario» en los nombres: se le vuelve a pedir, sin guardarlo', async () => {
        await hastaPedirNombre();
        await say('Otro horario');

        expect(lastSent()).toMatch(/no parece un nombre/);
        expect(lastSent()).toMatch(/Cancelar/);
        expect(await state()).toBe(ChatState.AWAITING_NAME);
        expect(
          redis.store.get(`temp_nombre:${ORG_ID}:${SENDER}`),
        ).toBeUndefined();

        await say('Agustín');
        expect(await state()).toBe(ChatState.AWAITING_APELLIDOS);
        expect(lastSent()).toContain('Agustín');
      });

      it('«en la tarde» en los apellidos: se le vuelven a pedir', async () => {
        await hastaPedirNombre();
        await say('Agustín');
        await say('en la tarde');

        expect(lastSent()).toMatch(/no parecen unos apellidos/);
        expect(await state()).toBe(ChatState.AWAITING_APELLIDOS);

        await say('González Giraldo');
        expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);
      });
    });

    // ═══════════════════════════════════════════════════════════════════
    // 🔒 NADA SE GUARDA ANTES DE QUE EL PACIENTE AUTORICE (Ley 1581)
    // ═══════════════════════════════════════════════════════════════════
    //
    // El resumen es donde el paciente lee que al responder SÍ autoriza el
    // tratamiento de sus datos —incluidos los sensibles de salud—. Guardar su
    // ficha antes de enseñarle ese aviso es tratarlos sin autorización.
    //
    // Se descubrió en la campaña E2E del 2026-09-22: un paciente contestó
    // nombre, nacimiento, sexo y régimen, respondió NO a la confirmación, y su
    // ficha completa se quedó guardada igual — escrita dos minutos ANTES de
    // que dijera que no.
    describe('8.0 el consentimiento va primero', () => {
      it('con el resumen a la vista, todavía NO existe la ficha', async () => {
        await hastaElNombre();
        await responderAlta(say);

        expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
        expect(lastSent()).toMatch(/Ley 1581/);
        expect(db.patients).toHaveLength(0);
      });

      it('si responde NO, no queda ni ficha ni usuario', async () => {
        await hastaElNombre();
        await responderAlta(say);
        await say('No');

        expect(db.patients).toHaveLength(0);
        expect(appointments.bookAppointment).not.toHaveBeenCalled();
      });

      it('al responder SÍ nace la ficha, y con los datos del alta completos', async () => {
        await hastaElNombre();
        await responderAlta(say);
        await say('Sí');

        expect(db.patients).toHaveLength(1);
        const creado = db.patients[0];
        // Sin estos tres el driver NO puede dar de alta al paciente en el HIS
        // (`FE_NACI_PAC` y `NU_SEXO_PAC` son NOT NULL) — escenario 12 de las
        // pruebas E2E. Viajaban en la escritura temprana; ahora tienen que
        // llegar desde la sesión hasta la confirmación.
        expect(creado.dateOfBirth).toEqual(new Date('1980-03-15'));
        expect(creado.gender).toBe('M');
        expect(creado.nombres).toBe('Juan');
        expect(creado.apellidos).toBe('Pérez');
      });
    });

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

    // 2026-10-28: una paciente de 65 años la escribió diez veces y se fue.
    it.each([
      ['19 01 1961', '1961'],
      ['1961 19 de enero', '1961'],
      ['Día 19 año 1961 mes Enero', '1961'],
      ['26 de diciembre Del año 1971', '1971'],
    ])('8.4b «%s» se entiende', async (frase, anio) => {
      await hastaElNombre();
      await say(frase);
      expect(lastSent()).toContain(anio);
      expect(lastSent()).toMatch(/correcto|está bien/i);
    });

    it('8.4c «Está correcto» confirma la fecha', async () => {
      await hastaElNombre();
      await say('4/5 /1966');
      await say('Esta correcto');
      expect(await state()).toBe(ChatState.AWAITING_GENDER);
    });

    it('8.4d tras tres intentos, se la pide por partes: día, mes y año', async () => {
      await hastaElNombre();
      await say('no sé');
      await say('Quincecero tres');
      await say('mi fecha');
      expect(lastSent()).toMatch(/día del mes/);

      await say('19');
      expect(lastSent()).toMatch(/mes/);
      await say('enero');
      expect(lastSent()).toMatch(/año/);
      await say('1961');
      expect(lastSent()).toMatch(/19 de enero de 1961/);

      await say('Sí');
      expect(await state()).toBe(ChatState.AWAITING_GENDER);
    });

    it('8.4e por partes, una fecha que no existe vuelve a empezar', async () => {
      await hastaElNombre();
      for (const t of ['x', 'y', 'z']) await say(t);
      await say('31');
      await say('febrero');
      await say('1980');
      expect(lastSent()).toMatch(/no existe/);
      expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);
      await say('28');
      expect(lastSent()).toMatch(/mes/);
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

    it('8.9 dos pacientes NUEVOS y distintos desde el mismo WhatsApp no se contaminan entre sí', async () => {
      // Regresión: `siguienteDatoDeAlta` guardaba nombres/apellidos/nacimiento/
      // sexo/régimen bajo organizationId:senderId — nunca la cédula. Si el
      // mismo número daba de alta a una SEGUNDA persona nueva antes de que
      // expirara la sesión de la primera, el bot encontraba esos campos "ya
      // guardados" y se los adjudicaba en silencio a la segunda persona, sin
      // volver a preguntar. Detectado dando de alta a "Pedro" y luego, en el
      // mismo hilo, a "Juan" — Juan terminó con el apellido y la fecha de
      // nacimiento de Pedro.
      await hastaElNombre(); // primera persona: Juan Pérez, cédula 1088123456
      await responderAlta(say);
      await say('Sí'); // confirma y agenda

      // Segunda persona, MISMO hilo de WhatsApp, cédula distinta, nombre y
      // apellido distintos.
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('99887766');
      await say('Pedro');

      // Si el bug sigue vivo, esto saltaría directo a AWAITING_CONFIRMATION
      // (o a otro estado) reutilizando el apellido de Juan sin preguntar.
      expect(lastSent()).toMatch(/apellido/i);
      expect(await state()).toBe(ChatState.AWAITING_APELLIDOS);

      await say('Gómez');
      expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);
      expect(lastSent()).toMatch(/fecha de nacimiento/i);

      await responderAlta(say);
      await say('Sí');

      const pedro = db.patients.find((p) => p.cedula === '99887766');
      expect(pedro?.fullName).toContain('Pedro');
      expect(pedro?.fullName).toContain('Gómez');
      expect(pedro?.fullName).not.toContain('Pérez');
    });

    // ═══════════════════════════════════════════════════════════════════
    // 🪪 EL NOMBRE EN DOS PASOS, SIN REPETIR (2026-10-22)
    // ═══════════════════════════════════════════════════════════════════
    //
    // Caso real del primer día con agendar encendido: a «sus nombres (solo los
    // nombres…)» el paciente respondió su nombre COMPLETO, luego sus apellidos, y
    // quedó «Juan camilo hurtado ramos Hurtado ramos».
    describe('8.11 nombres y apellidos', () => {
      const hastaLaCedula = async () => {
        await say('Hola');
        await say('A');
        await say('A');
        await say('A');
        await say('1088123456');
      };

      it('pide los nombres como «Paso 1 de 2», solo nombres, y los apellidos como «Paso 2 de 2»', async () => {
        await hastaLaCedula();
        expect(lastSent()).toContain('*Paso 1 de 2:*');
        expect(lastSent()).toContain('*solo sus NOMBRES*, sin apellidos');
        expect(lastSent()).toContain('siguiente');

        await say('Juan Camilo');
        expect(lastSent()).toContain('Nombres: *Juan Camilo*');
        expect(lastSent()).toContain('*Paso 2 de 2:*');
        expect(lastSent()).toContain('*solo sus APELLIDOS*');
      });

      it('🧾 nombre completo en el paso de los nombres → no se repiten los apellidos', async () => {
        await hastaLaCedula();
        await say('Juan camilo hurtado ramos');
        await say('Hurtado ramos');
        expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);

        await responderAlta(say);
        // El resumen ya lo muestra bien.
        expect(lastSent()).toContain('Juan camilo Hurtado ramos');
        expect(lastSent()).not.toContain('ramos Hurtado');
        await say('Sí');

        const p = db.patients.find((x) => x.cedula === '1088123456');
        expect(p?.fullName).toBe('Juan camilo Hurtado ramos');
        expect(p?.nombres).toBe('Juan camilo');
        expect(p?.apellidos).toBe('Hurtado ramos');
      });

      it('lo mismo en los dos pasos → vuelve a pedir SOLO los apellidos', async () => {
        await hastaLaCedula();
        await say('Juan Camilo Hurtado');
        await say('juan camilo hurtado');
        expect(await state()).toBe(ChatState.AWAITING_APELLIDOS);
        expect(lastSent()).toContain(
          'Escribió lo mismo que en el paso anterior',
        );
        expect(lastSent()).toContain('*solo sus APELLIDOS*');

        await say('Ramos');
        expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);
      });
    });

    it('8.8 a un paciente que YA existe con su ficha completa no se le pregunta nada de esto', async () => {
      db.patients.push({
        id: 'pat-viejo',
        cedula: '1088123456',
        fullName: 'Juan Pérez',
        organizationId: ORG_ID,
        epsId: null,
        dateOfBirth: new Date('1980-03-15'),
        gender: 'M',
      });

      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('1088123456');

      // Sin nombre, sin nacimiento, sin sexo: directo al resumen.
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
    });

    // ═══════════════════════════════════════════════════════════════════
    // 🧾 EL PACIENTE QUE YA EXISTE NO ESTÁ NECESARIAMENTE COMPLETO
    // ═══════════════════════════════════════════════════════════════════
    //
    // Caso real del 2026-09-26: una paciente de Salud Total que ya existía sin
    // régimen (el alta en caliente crea al paciente con nacimiento y sexo del
    // HIS, pero nunca con régimen) agendó por WhatsApp. El bot no le preguntó
    // nada, le confirmó la cita, y el agente la rechazó diez veces: sin régimen
    // no hay convenio. El hospital nunca la tuvo y la paciente creía tener cita.
    describe('8.10 al paciente existente se le pregunta SOLO lo que le falta', () => {
      const existente = (extra: Record<string, unknown> = {}) =>
        db.patients.push({
          id: 'pat-his',
          cedula: '1088123456',
          fullName: 'Juan Pérez',
          organizationId: ORG_ID,
          epsId: EPS_SURA.id,
          dateOfBirth: new Date('1980-03-15'),
          gender: 'M',
          regime: null,
          ...extra,
        });
      const hastaLaCedulaConSura = async () => {
        db.enrolled.push({ cedula: '1088123456', epsId: EPS_SURA.id });
        await say('Hola');
        await say('A');
        await say('B'); // Sura
        await say('A');
        await say('1088123456');
      };

      it('🚨 con EPS y sin régimen: pregunta el régimen, y solo eso', async () => {
        existente();
        await hastaLaCedulaConSura();

        expect(await state()).toBe(ChatState.AWAITING_REGIME);
        expect(lastSent()).toMatch(/subsidiad|contributiv/i);

        await say('A'); // subsidiado
        // Nacimiento y sexo ya estaban en su ficha: no se vuelven a pedir.
        expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
      });

      it('al responder SÍ el régimen queda en su ficha, sin pisar lo demás', async () => {
        existente();
        await hastaLaCedulaConSura();
        await say('A');
        await say('Sí');

        const p = db.patients.find((x) => x.id === 'pat-his');
        expect(p.regime).toBe('SUBSIDIADO');
        expect(p.dateOfBirth).toEqual(new Date('1980-03-15'));
        expect(p.gender).toBe('M');
        expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
      });

      it('si ya tiene régimen no se le pregunta, y nunca se le cambia', async () => {
        existente({ regime: 'CONTRIBUTIVO' });
        await hastaLaCedulaConSura();

        expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
        await say('Sí');
        expect(db.patients[0].regime).toBe('CONTRIBUTIVO');
      });

      it('una ficha vieja sin nacimiento ni sexo los pide (el HIS los exige para darlo de alta)', async () => {
        existente({ dateOfBirth: null, gender: null });
        await hastaLaCedulaConSura();

        expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);
        await responderAlta(say, { conEps: true });
        expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
        await say('Sí');

        const p = db.patients[0];
        expect(p.dateOfBirth).toEqual(new Date('1980-03-15'));
        expect(p.gender).toBe('M');
        expect(p.regime).toBe('CONTRIBUTIVO');
      });

      it('el régimen que dio OTRA persona desde el mismo WhatsApp no se le pega', async () => {
        // Primera persona, nueva, con Sura: contesta SUBSIDIADO y agenda.
        db.enrolled.push({ cedula: '99887766', epsId: EPS_SURA.id });
        await say('Hola');
        await say('A');
        await say('B');
        await say('A');
        await say('99887766');
        await decirNombre(say);
        await responderAlta(say);
        await say('A'); // subsidiado
        await say('Sí');

        // Segunda persona, ya existente y sin régimen, mismo hilo.
        existente();
        await hastaLaCedulaConSura();

        expect(await state()).toBe(ChatState.AWAITING_REGIME);
      });

      // El padrón de la EPS ya trae el régimen: si no hay NINGUNA duda (una sola
      // EPS, la elegida, y un solo régimen), no se le pregunta al paciente.
      describe('régimen tomado del padrón', () => {
        const conPadron = (
          filas: { epsId: string; regime: string | null }[],
        ) => {
          db.enrolled = filas.map((f) => ({ cedula: '1088123456', ...f }));
        };
        const hastaLaCedula = async () => {
          await say('Hola');
          await say('A');
          await say('B'); // Sura
          await say('A');
          await say('1088123456');
        };

        it('paciente existente sin régimen: no se le pregunta y al SÍ queda en su ficha', async () => {
          existente();
          conPadron([{ epsId: EPS_SURA.id, regime: 'SUBSIDIADO' }]);
          await hastaLaCedula();

          expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
          await say('Sí');
          expect(db.patients[0].regime).toBe('SUBSIDIADO');
          expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
        });

        it('paciente nuevo: nacimiento y sexo sí, el régimen ya no', async () => {
          conPadron([{ epsId: EPS_SURA.id, regime: 'CONTRIBUTIVO' }]);
          await hastaLaCedula();
          await decirNombre(say);
          await responderAlta(say); // sin el turno del régimen

          expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
          await say('Sí');
          expect(db.patients[0].regime).toBe('CONTRIBUTIVO');
        });

        it.each([
          ['el padrón no trae régimen', [{ epsId: EPS_SURA.id, regime: null }]],
          [
            'el documento está en dos EPS',
            [
              { epsId: EPS_SURA.id, regime: 'SUBSIDIADO' },
              { epsId: EPS_PARTICULAR.id, regime: 'SUBSIDIADO' },
            ],
          ],
          [
            'las filas de la EPS se contradicen',
            [
              { epsId: EPS_SURA.id, regime: 'SUBSIDIADO' },
              { epsId: EPS_SURA.id, regime: 'CONTRIBUTIVO' },
            ],
          ],
        ])('con duda (%s) se le pregunta', async (_caso, filas) => {
          existente();
          conPadron(filas);
          await hastaLaCedula();

          expect(await state()).toBe(ChatState.AWAITING_REGIME);
        });
      });

      it('red de seguridad: si la reserva se frena por falta de régimen, lo pregunta y vuelve al resumen', async () => {
        existente({ regime: 'CONTRIBUTIVO' });
        await hastaLaCedulaConSura();
        appointments.bookAppointment.mockResolvedValueOnce({
          success: false,
          reason: 'PATIENT_REGIME_MISSING',
        });
        await say('Sí');

        // NUNCA se le dice «confirmada» a una cita que el hospital no va a tener.
        expect(lastSent()).not.toMatch(/confirmad/i);
        expect(await state()).toBe(ChatState.AWAITING_REGIME);
        expect(interactionLog.logFailure).toHaveBeenCalledWith(
          expect.objectContaining({ reason: 'PATIENT_REGIME_MISSING' }),
        );

        await say('B');
        expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
        await say('Sí');
        expect(appointments.bookAppointment).toHaveBeenCalledTimes(2);
      });
    });
  });
  // ══════════════════════════════════════════════════════════════════
  // 9. EPS que la clínica no atiende
  //
  // Antes, «Coomeva» en el paso de EPS repetía el menú y gastaba un reintento,
  // una y otra vez, hasta cerrar la sesión: una interacción que no valía la pena.
  // Ahora se le dice que esa EPS no está disponible y se le ofrece la cita
  // particular. SÍ → sigue como Particular; NO → se despide.
  // ══════════════════════════════════════════════════════════════════
  describe('9. EPS no disponible → ofrecer cita particular', () => {
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

    const hastaElMenuDeEps = async () => {
      await say('Hola');
      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_EPS);
    };

    it('9.1 nombra una EPS real que no está en el menú: se le dice y se le ofrece particular', async () => {
      await hastaElMenuDeEps();
      await say('Coomeva');

      expect(lastSent()).toMatch(
        /La EPS \*Coomeva\* no se encuentra disponible|no es posible agendar con la EPS \*Coomeva\*/i,
      );
      expect(lastSent()).toMatch(/particular/i);
      // Sabe lo que acepta: es pago directo (2026-10-21).
      expect(lastSent()).toMatch(/pago directo/i);
      expect(await state()).toBe(ChatState.AWAITING_EPS);
      // No se cuenta como un error del paciente: no gasta reintentos.
      expect(
        redis.store.get(`error_count:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
    });

    it('9.2 SÍ → sigue como Particular, en el mismo turno, hasta agendar sin EPS', async () => {
      await hastaElMenuDeEps();
      await say('Coomeva');
      await say('Sí');

      // Ya está viendo los horarios: no se le vuelve a preguntar la EPS.
      expect(await state()).toBe(ChatState.AWAITING_DATE);
      expect(redis.store.get(`temp_eps_query:${ORG_ID}:${SENDER}`)).toBe(
        'Particular',
      );

      await say('A');
      await say('1088123456');
      await decirNombre(say);
      await responderAlta(say); // Particular: sin régimen
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
      await say('Sí');

      expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
      // Particular viaja como «sin EPS»: ni padrón ni convenio.
      expect(appointments.bookAppointment.mock.calls[0][2]).toBeNull();
    });

    it('9.3 NO → se despide y cierra la conversación, sin agendar', async () => {
      await hastaElMenuDeEps();
      await say('Coomeva');
      await say('No');

      expect(lastSent()).toMatch(/particular/i);
      expect(await state()).toBe(ChatState.IDLE);
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
      expect(
        redis.store.has(`temp_eps_oferta_particular:${ORG_ID}:${SENDER}`),
      ).toBe(false);
    });

    it('9.4 en vez de contestar, elige una EPS del menú: se toma esa', async () => {
      db.enrolled.push({ cedula: '1088123456', epsId: EPS_SURA.id });
      await hastaElMenuDeEps();
      await say('Coomeva');
      await say('B'); // Sura

      expect(await state()).toBe(ChatState.AWAITING_DATE);
      expect(redis.store.get(`temp_eps_query:${ORG_ID}:${SENDER}`)).toBe(
        'Sura',
      );
    });

    it('9.5 una EPS que SÍ está en el menú, escrita por su nombre, no dispara la oferta', async () => {
      await hastaElMenuDeEps();
      await say('eps sura');

      expect(await state()).toBe(ChatState.AWAITING_DATE);
      expect(lastSent()).not.toMatch(/no se encuentra disponible/i);
    });

    it('9.6 algo que no es una EPS sigue repitiendo el menú, como antes', async () => {
      await hastaElMenuDeEps();
      await say('asdfgh');

      expect(lastSent()).not.toMatch(/pago directo/i);
      expect(lastSent()).not.toMatch(/no se encuentra disponible/i);
      expect(await state()).toBe(ChatState.AWAITING_EPS);
    });

    it('9.7 🚨 el LLM no puede «acercar» una EPS nombrada a otra del menú', async () => {
      // Si el mapeo semántico devolviera Sura para «Coomeva», se agendaría con
      // el convenio de otra EPS. Una EPS reconocida nunca llega al LLM.
      provider.mapEntityToCatalog.mockResolvedValue({ id: EPS_SURA.id });
      await hastaElMenuDeEps();
      await say('Coomeva');

      expect(provider.mapEntityToCatalog).not.toHaveBeenCalled();
      expect(lastSent()).toMatch(/Coomeva/);
      expect(
        redis.store.get(`temp_eps_id:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();
    });

    // 🏥 2026-10-21: una EPS que la clínica tiene registrada pero INACTIVA la
    // atiende, solo que no por el asistente (Nueva EPS en el hospital). A esa no
    // se le ofrece la particular: podía aceptarla y quedar como pago directo.
    it('9.8 una EPS que la clínica tiene DESACTIVADA (la atiende, no por aquí) → por teléfono, sin ofrecer particular', async () => {
      db.epsList.push({ id: 'eps-nueva', name: 'Nueva EPS', isActive: false });
      await hastaElMenuDeEps();
      await say('nueva eps');

      expect(lastSent()).toContain(
        'Por este medio todavía no puedo agendar citas con *Nueva EPS*',
      );
      expect(lastSent()).toContain('comuníquese con');
      expect(lastSent()).not.toMatch(/particular/i);
      expect(
        redis.store.has(`temp_eps_oferta_particular:${ORG_ID}:${SENDER}`),
      ).toBe(false);
      // Se cierra el agendamiento: no queda esperando un SÍ.
      expect([null, ChatState.IDLE]).toContain(await state());
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
    });

    it('9.8b la misma EPS dicha en el primer mensaje también va por teléfono', async () => {
      db.epsList.push({ id: 'eps-nueva', name: 'Nueva EPS', isActive: false });
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ eps: 'Nueva EPS' }),
      );
      await say('Hola, necesito una cita, tengo Nueva EPS');
      await say('A'); // servicio

      expect(lastSent()).toContain('todavía no puedo agendar citas con');
      expect(lastSent()).not.toMatch(/particular/i);
    });

    it('9.8c una EPS que la clínica NO tiene registrada sigue recibiendo la particular', async () => {
      await hastaElMenuDeEps();
      await say('Coosalud');

      expect(lastSent()).toMatch(/particular/i);
      expect(lastSent()).toMatch(/pago directo/i);
    });

    it('9.9 la EPS dicha en el primer mensaje se contesta sin pasar por el menú', async () => {
      provider.extractSchedulingIntent.mockResolvedValueOnce(
        extraction({ eps: 'Coomeva' }),
      );
      await say('Hola, necesito una cita, tengo Coomeva');
      await say('A'); // servicio

      expect(lastSent()).toMatch(/Coomeva/);
      expect(lastSent()).toMatch(/particular/i);
      expect(await state()).toBe(ChatState.AWAITING_EPS);
    });
  });
  // ══════════════════════════════════════════════════════════════════
  // 10. Afiliado a una EPS (y en su padrón) que quiere una cita PARTICULAR
  //
  // La EPS de la CITA es la que elige el paciente; la de su ficha es solo su
  // EPS de siempre. Con Particular no hay padrón, ni régimen, ni convenio de
  // EPS: el HIS la recibe con el convenio particular.
  // ══════════════════════════════════════════════════════════════════
  describe('10. En el padrón de su EPS pero quiere cita particular', () => {
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
      // Afiliado a Sura, en su padrón y con régimen: todo lo que haría falta
      // para agendar por la EPS… pero pide particular.
      db.enrolled.push({
        cedula: '1088123456',
        epsId: EPS_SURA.id,
        regime: 'SUBSIDIADO',
      });
      db.patients.push({
        id: 'pat-sura',
        cedula: '1088123456',
        fullName: 'Juan Pérez',
        organizationId: ORG_ID,
        epsId: EPS_SURA.id,
        dateOfBirth: new Date('1980-03-15'),
        gender: 'M',
        regime: null,
      });
    });

    const hastaElMenuDeEps = async () => {
      await say('Hola');
      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_EPS);
    };

    it('10.1 elige Particular en el menú: agenda sin EPS y su ficha sigue siendo de Sura', async () => {
      await hastaElMenuDeEps();
      await say('A'); // Particular
      await say('A'); // horario
      await say('1088123456');

      // Sin régimen que preguntar ni padrón que exigir: directo al resumen.
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
      expect(lastSent()).toMatch(/Particular/);
      await say('Sí');

      expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
      expect(appointments.bookAppointment.mock.calls[0][2]).toBeNull();
      const ficha = db.patients.find((p) => p.id === 'pat-sura');
      expect(ficha.epsId).toBe(EPS_SURA.id);
      // El régimen del padrón es de su afiliación a Sura: una cita particular no
      // lo toca (ni lo necesita).
      expect(ficha.regime).toBeNull();
    });

    it('10.2 «la quiero particular por favor» en una frase también es Particular', async () => {
      await hastaElMenuDeEps();
      await say('la quiero particular por favor');

      expect(await state()).toBe(ChatState.AWAITING_DATE);
      expect(redis.store.get(`temp_eps_query:${ORG_ID}:${SENDER}`)).toBe(
        'Particular',
      );
    });

    it.each([
      ['tengo sura pero la quiero particular'],
      ['no quiero particular, por sura'],
    ])(
      '10.3 «%s» nombra las dos: no elige por él, le pregunta',
      async (frase) => {
        await hastaElMenuDeEps();
        await say(frase);

        expect(await state()).toBe(ChatState.AWAITING_EPS);
        expect(lastSent()).toMatch(/particular/i);
        expect(lastSent()).toMatch(/A\)\* Particular/);
        expect(
          redis.store.get(`temp_eps_id:${ORG_ID}:${SENDER}`),
        ).toBeUndefined();

        await say('A'); // Particular
        expect(await state()).toBe(ChatState.AWAITING_DATE);
        expect(redis.store.get(`temp_eps_query:${ORG_ID}:${SENDER}`)).toBe(
          'Particular',
        );
      },
    );

    it('10.4 «tengo Coomeva pero la quiero particular»: Coomeva no está, así que es Particular', async () => {
      await hastaElMenuDeEps();
      await say('tengo coomeva pero la quiero particular');

      expect(await state()).toBe(ChatState.AWAITING_DATE);
      expect(redis.store.get(`temp_eps_query:${ORG_ID}:${SENDER}`)).toBe(
        'Particular',
      );
    });

    describe('10.5 lista de espera: la cita sale con la EPS con la que ENTRÓ, no con la de su ficha', () => {
      const confirmarCupoDeLista = async (epsIdDeLaEntrada: string | null) => {
        db.slots.push(slotRow('slot-free', FECHA_C, 'Ana Pérez', SVC_MEDICINA));
        waitlist.confirmFromWaitlist.mockResolvedValue({
          slotId: 'slot-free',
          patientId: 'pat-sura',
          epsId: epsIdDeLaEntrada,
        });
        // La oferta sale: Meta la acepta.
        sendSpy.mockResolvedValueOnce({ messages: [{ id: 'wamid.oferta' }] });
        await service.notifyWaitlistCandidate({
          whatsappId: SENDER,
          organizationId: ORG_ID,
          nombre: 'Juan Pérez',
          especialidad: 'Medicina General',
          doctor: 'Ana Pérez',
          slotDate: FECHA_C,
        });
        await say('Sí');
      };

      it('🚨 entró como particular → se agenda particular aunque su ficha sea de Sura', async () => {
        await confirmarCupoDeLista(null);

        expect(appointments.bookAppointment).toHaveBeenCalledWith(
          'pat-sura',
          'slot-free',
          null,
          'WHATSAPP',
          ORG_ID,
        );
      });

      it('entró por Sura → se agenda por Sura', async () => {
        await confirmarCupoDeLista(EPS_SURA.id);

        expect(appointments.bookAppointment.mock.calls[0][2]).toBe(EPS_SURA.id);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 11. LÍMITE DE CITAS POR PACIENTE (/dashboard/limites-citas)
  // El bot no le asigna a un paciente más citas de las permitidas el mismo
  // día o el mismo mes: se disculpa, lo remite al teléfono del hospital y le
  // deja el enlace para pedir una revisión. La regla (qué cuenta, en qué
  // zona) se prueba en limite-citas.service.spec y en @agenia/shared; aquí,
  // dónde la consulta el bot y qué hace con la respuesta.
  // ──────────────────────────────────────────────────────────────────
  describe('11. Límite de citas por paciente', () => {
    const CEDULA = '999888';
    const TELEFONO_HOSPITAL = '6068538838';

    /** Lo que responde el servicio cuando el paciente ya tiene el máximo. */
    const superado = (
      tipo: 'DAILY' | 'MONTHLY',
      fecha: Date,
      citas = tipo === 'DAILY' ? 1 : 3,
    ): LimiteDelPaciente => ({
      tipo,
      limite: tipo === 'DAILY' ? 1 : 3,
      limiteBase: tipo === 'DAILY' ? 1 : 3,
      citas,
      periodo: periodoDelLimite(tipo, fecha),
      paciente: { id: 'pat-known', cedula: CEDULA, fullName: 'María Ruiz' },
    });

    const fallasPorLimite = () =>
      interactionLog.logFailure.mock.calls.filter(
        (c: any[]) => c[0]?.reason === 'APPOINTMENT_LIMIT_REACHED',
      );

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
      db.patients.push({
        id: 'pat-known',
        cedula: CEDULA,
        fullName: 'María Ruiz',
        organizationId: ORG_ID,
        epsId: null,
        whatsappId: SENDER,
        dateOfBirth: new Date('1975-06-01'),
        gender: 'F',
      });
      // El aviso remite al teléfono del hospital.
      prisma.organization.findUnique.mockImplementation(() => ({
        id: ORG_ID,
        name: ORG_NAME,
        supportPhone: TELEFONO_HOSPITAL,
        timezone: null,
      }));
    });

    it('11.1 ya tiene una cita ese día: al dar la cédula se disculpa, da el teléfono y el enlace de revisión, y no reserva', async () => {
      limiteCitas.evaluar.mockResolvedValue(superado('DAILY', FECHA_A));

      await say('Hola');
      await say('A'); // Medicina General
      await say('A'); // Particular
      await say('A'); // cupo A (FECHA_A)
      await say(CEDULA);

      // Se consultó con SU cédula y la hora del cupo que eligió.
      expect(limiteCitas.evaluar).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          cedula: CEDULA,
          fecha: FECHA_A,
        }),
      );
      const aviso = lastSent();
      expect(aviso).toMatch(/Lamentamos no poder agendarle/);
      expect(aviso).toContain('máximo *una cita* el mismo día');
      expect(aviso).toContain(etiquetaPeriodo('DAILY', '2026-09-15'));
      expect(aviso).toContain(TELEFONO_HOSPITAL);
      expect(aviso).toContain('/solicitud-citas/sol-1');
      expect(aviso).toContain('"Hola"'); // puede elegir otro día

      // La solicitud se preparó con el contexto del freno.
      expect(limiteCitas.prepararSolicitud).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          canal: 'WHATSAPP',
          telefono: SENDER,
          operacion: 'BOOKING',
          fechaSolicitada: FECHA_A,
          servicio: 'Medicina General',
        }),
      );
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
      expect(await state()).toBe(ChatState.IDLE);
      expect(
        redis.store.get(`temp_selected_slot_id:${ORG_ID}:${SENDER}`),
      ).toBeUndefined();

      const [falla] = fallasPorLimite();
      expect(falla[0].metadata).toEqual(
        expect.objectContaining({
          stage: 'APPOINTMENT_LIMIT_BOOKING',
          tipo: 'DAILY',
          periodo: '2026-09-15',
          solicitud: 'ENLACE',
          solicitudId: 'sol-1',
        }),
      );
    });

    it('11.2 límite del mes con una revisión ya en curso: no manda otro enlace, le dice que está en estudio', async () => {
      limiteCitas.evaluar.mockResolvedValue(superado('MONTHLY', FECHA_A));
      limiteCitas.prepararSolicitud.mockResolvedValue({
        estado: 'EN_REVISION',
      });

      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say(CEDULA);

      const aviso = lastSent();
      expect(aviso).toContain('máximo *3 citas* en un mismo mes');
      expect(aviso).toContain('*septiembre de 2026*');
      expect(aviso).toMatch(
        /Ya recibimos su \*solicitud de revisión\* para ese mes/,
      );
      expect(aviso).not.toContain('/solicitud-citas/');
      expect(aviso).toContain(TELEFONO_HOSPITAL);
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
    });

    it('11.3 ya radicó el máximo de solicitudes: solo el teléfono del hospital', async () => {
      limiteCitas.evaluar.mockResolvedValue(superado('DAILY', FECHA_A));
      limiteCitas.prepararSolicitud.mockResolvedValue({ estado: 'SIN_ENLACE' });

      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say(CEDULA);

      const aviso = lastSent();
      expect(aviso).toContain(TELEFONO_HOSPITAL);
      expect(aviso).not.toMatch(/solicitud de revisión|solicitud-citas/);
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('11.4 si la solicitud no se puede preparar, el aviso sale igual con el teléfono', async () => {
      limiteCitas.evaluar.mockResolvedValue(superado('DAILY', FECHA_A));
      limiteCitas.prepararSolicitud.mockRejectedValue(new Error('BD caída'));

      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say(CEDULA);

      expect(lastSent()).toContain(TELEFONO_HOSPITAL);
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
      expect(await state()).toBe(ChatState.IDLE);
    });

    // 2026-10-28: una madre daba su cédula al agendarles a sus hijos, leía
    // «usted ya tiene una cita», escribía «Cancelar» y confirmaba «Sí»: así se
    // anularon las citas de dos niños.
    it('11.9 el aviso dice de quién es la cédula y cómo agendar para otra persona', async () => {
      limiteCitas.evaluar.mockResolvedValue(superado('DAILY', FECHA_A));
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say(CEDULA);
      expect(lastSent()).toContain('*María Ruiz* (cédula terminada en 9888)');
      expect(lastSent()).toMatch(/para otra persona/);
    });

    it('11.10 «Cancelar» justo después del aviso deja la solicitud: no ofrece anular ninguna cita', async () => {
      limiteCitas.evaluar.mockResolvedValue(superado('DAILY', FECHA_A));
      provider.extractSchedulingIntent.mockResolvedValue(
        extraction({ isCancellation: true }),
      );
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say(CEDULA);
      await say('Cancelar');
      expect(lastSent()).toMatch(/no agendé nada más/);
      expect(lastSent()).toMatch(/Cancelar mi cita/);
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('11.11 «Cancelar mi cita» después del aviso sí abre la cancelación', async () => {
      limiteCitas.evaluar.mockResolvedValue(superado('DAILY', FECHA_A));
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say(CEDULA);
      await say('Cancelar mi cita');
      expect(lastSent()).not.toMatch(/no agendé nada más/);
    });

    it('11.5 sin límite alcanzado sigue al resumen como siempre', async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say(CEDULA);

      expect(limiteCitas.evaluar).toHaveBeenCalledTimes(1);
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
      expect(fallasPorLimite()).toHaveLength(0);
    });

    it('11.6 un error al revisar el límite no tumba la conversación (la reserva lo revisa otra vez)', async () => {
      limiteCitas.evaluar.mockRejectedValue(new Error('timeout'));

      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say(CEDULA);

      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
    });

    it('11.7 la reserva lo frena en el SÍ (le entró otra cita mientras tanto): aviso y no confirma', async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say(CEDULA);
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);

      appointments.bookAppointment.mockResolvedValueOnce({
        success: false,
        reason: 'PATIENT_LIMIT_REACHED',
        limite: superado('DAILY', FECHA_A),
      });
      await say('Sí');

      expect(lastSent()).toMatch(/Lamentamos no poder agendarle/);
      expect(lastSent()).toContain('/solicitud-citas/sol-1');
      expect(interactionLog.logBookingConfirmed).not.toHaveBeenCalled();
      expect(surveySpy).not.toHaveBeenCalled();
      expect(fallasPorLimite()).toHaveLength(1);
      expect(await state()).toBe(ChatState.IDLE);
    });

    it('11.8 cupo de la lista de espera que lo pasaría del límite: aviso en vez de confirmación', async () => {
      db.slots.push(slotRow('slot-free', FECHA_C, 'Ana Pérez', SVC_MEDICINA));
      waitlist.confirmFromWaitlist.mockResolvedValue({
        slotId: 'slot-free',
        patientId: 'pat-known',
        epsId: null,
      });
      appointments.bookAppointment.mockResolvedValueOnce({
        success: false,
        reason: 'PATIENT_LIMIT_REACHED',
        limite: superado('MONTHLY', FECHA_C),
      });

      // La oferta sale: Meta la acepta.
      sendSpy.mockResolvedValueOnce({ messages: [{ id: 'wamid.oferta' }] });
      await service.notifyWaitlistCandidate({
        whatsappId: SENDER,
        organizationId: ORG_ID,
        nombre: 'María Ruiz',
        especialidad: 'Medicina General',
        doctor: 'Ana Pérez',
        slotDate: FECHA_C,
      });
      await say('Sí');

      expect(lastSent()).toContain('en un mismo mes');
      expect(limiteCitas.prepararSolicitud).toHaveBeenCalledWith(
        expect.objectContaining({
          operacion: 'BOOKING',
          fechaSolicitada: FECHA_C,
          servicio: 'Medicina General',
        }),
      );
      expect(interactionLog.logBookingConfirmed).not.toHaveBeenCalled();
      expect(await state()).toBe(ChatState.IDLE);
    });

    describe('cambio de fecha', () => {
      // ⏱️ El cambio de fecha revisa la anticipación mínima al confirmar
      // (2026-10-21): con el reloj real, los cupos de ejemplo (septiembre de 2026)
      // ya pasaron. Solo se congela la fecha; los temporizadores siguen siendo reales.
      beforeEach(() => {
        jest.useFakeTimers({
          now: new Date('2026-09-01T12:00:00.000Z'),
          doNotFake: [
            'nextTick',
            'setImmediate',
            'clearImmediate',
            'setInterval',
            'clearInterval',
            'setTimeout',
            'clearTimeout',
            'queueMicrotask',
            'hrtime',
            'performance',
          ],
        });
      });
      afterEach(() => jest.useRealTimers());

      beforeEach(() => {
        const ocupado = slotRow('slot-old', FECHA_C, 'Ana Pérez', SVC_MEDICINA);
        ocupado.isAvailable = false;
        db.slots.push(ocupado);
        db.appointments.push({
          id: 'apt-0',
          patientId: 'pat-known',
          scheduleSlotId: 'slot-old',
          status: 'SCHEDULED',
          epsId: null,
          organizationId: ORG_ID,
          patient: { cedula: CEDULA },
        });
      });

      it('11.9 mover la cita a un día con el máximo: aviso de cambio y la cita no se mueve', async () => {
        limiteCitas.evaluar.mockResolvedValue(superado('DAILY', FECHA_A));

        await say('reprogramar mi cita');
        await say(CEDULA);
        expect(await state()).toBe(ChatState.AWAITING_MODIFY_NEW_SLOT);
        await say('A'); // FECHA_A

        // La cita que se mueve no cuenta contra sí misma.
        expect(limiteCitas.evaluar).toHaveBeenCalledWith(
          expect.objectContaining({
            cedula: CEDULA,
            fecha: FECHA_A,
            excluirCitaId: 'apt-0',
          }),
        );
        expect(lastSent()).toMatch(
          /Lamentamos no poder cambiar su cita a esa fecha/,
        );
        expect(lastSent()).toContain('"cambiar cita"');
        expect(limiteCitas.prepararSolicitud).toHaveBeenCalledWith(
          expect.objectContaining({ operacion: 'RESCHEDULE' }),
        );
        expect(db.appointments[0].scheduleSlotId).toBe('slot-old');
        expect(await state()).toBe(ChatState.IDLE);
      });

      it('11.10 se revisa otra vez al confirmar (el cambio no pasa por la reserva)', async () => {
        await say('reprogramar mi cita');
        await say(CEDULA);
        await say('A');
        expect(await state()).toBe(ChatState.AWAITING_MODIFY_CONFIRM);

        limiteCitas.evaluar.mockResolvedValue(superado('DAILY', FECHA_A));
        await say('Sí');

        expect(limiteCitas.evaluar).toHaveBeenLastCalledWith(
          expect.objectContaining({ excluirCitaId: 'apt-0', fecha: FECHA_A }),
        );
        expect(db.appointments[0].scheduleSlotId).toBe('slot-old');
        expect(db.slots.find((s) => s.id === 'slot-a')!.isAvailable).toBe(true);
        expect(await state()).toBe(ChatState.IDLE);
      });

      it('11.11 sin límite alcanzado, el cambio sigue como siempre', async () => {
        await say('reprogramar mi cita');
        await say(CEDULA);
        await say('A');
        await say('Sí');

        expect(db.appointments[0].scheduleSlotId).toBe('slot-a');
        expect(fallasPorLimite()).toHaveLength(0);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // El bot se presenta UNA vez por conversación
  // Captura de Telegram del 2026-10-02: tras «Sin problema, comencemos de
  // nuevo. ¿En qué le ayudo?», el siguiente menú volvía a decir «Soy Vicente,
  // su asistente virtual…» como si fuera otra conversación.
  // ──────────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════
  // 12. Lo que pasó el primer día de agendar abierto (2026-10-23)
  // ══════════════════════════════════════════════════════════════════════
  describe('12. Preguntas en el resumen, nombres al reintentar y servicios que no se agendan', () => {
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

    const pacienteCompleto = () =>
      db.patients.push({
        id: 'pat-laura',
        cedula: '1002593442',
        fullName: 'LAURA CAMILA RUIZ SUAREZ',
        organizationId: ORG_ID,
        epsId: null,
        dateOfBirth: new Date('2001-09-16'),
        gender: 'F',
      });
    const hastaElResumen = async () => {
      await say('Hola');
      await say('A');
      await say('A');
      await say('A');
      await say('1002593442');
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
    };

    it('12.1 ❓ «¿Esto si es para las ecografías?» no agenda: aclara qué cita es y con quién pedir las ecografías', async () => {
      pacienteCompleto();
      prisma.organization.findUnique.mockImplementation(() => ({
        id: ORG_ID,
        name: ORG_NAME,
        supportPhone: '6068538838',
      }));
      await hastaElResumen();

      await say('Esto si es para las ecografías ?');
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
      expect(await state()).toBe(ChatState.AWAITING_CONFIRMATION);
      expect(lastSent()).toContain('es de *Medicina General*');
      // La fecha como la ve el paciente, no la del sistema.
      expect(lastSent()).not.toContain('T14:00:00');
      expect(lastSent()).toContain('No es para *ecografías*');
      expect(lastSent()).toContain('6068538838');

      // Ya sabe de qué es: su SÍ ahora sí agenda.
      await say('Sí');
      expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
    });

    it('12.2 una pregunta que no nombra otro servicio aclara la cita sin hablar de otro', async () => {
      pacienteCompleto();
      await hastaElResumen();

      await say('¿Es con la doctora Ana?');
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
      expect(lastSent()).toContain('es de *Medicina General*');
      expect(lastSent()).not.toContain('No es para');
    });

    it.each(['Sí, ¿a qué hora debo llegar?', 'Claro. ¿Qué debo llevar?'])(
      '12.3 «%s» responde primero: agenda como siempre',
      async (texto) => {
        pacienteCompleto();
        await hastaElResumen();
        await say(texto);
        expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
      },
    );

    it('12.4 🪪 dijo NO al resumen y reintenta: sus nombres nuevos llevan apellidos nuevos (no los del intento anterior)', async () => {
      const llegarAlNombre = async () => {
        await say('Hola');
        await say('A');
        await say('A');
        await say('A');
        if ((await state()) === ChatState.AWAITING_CEDULA) {
          await say('1054925390');
        }
        expect(await state()).toBe(ChatState.AWAITING_NAME);
      };

      // Primer intento: puso un apellido en los nombres y rechazó el resumen.
      await llegarAlNombre();
      await say('Diana Castañeda');
      await say('Castañeda Ortiz');
      await responderAlta(say);
      expect(lastSent()).toContain('Diana Castañeda Castañeda Ortiz');
      await say('No');
      expect(appointments.bookAppointment).not.toHaveBeenCalled();

      // Segundo intento: ahora sí solo sus nombres.
      await llegarAlNombre();
      await say('Diana María');
      expect(await state()).toBe(ChatState.AWAITING_APELLIDOS);
      expect(lastSent()).toContain('*Paso 2 de 2:*');
      await say('Castañeda Ortiz');
      // Lo del alta se le vuelve a preguntar: dijo NO a lo anterior.
      expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);
      await responderAlta(say);
      expect(lastSent()).toContain('Diana María Castañeda Ortiz');
      await say('Sí');

      const p = db.patients.find((x) => x.cedula === '1054925390');
      expect(p?.fullName).toBe('Diana María Castañeda Ortiz');
      expect(p?.nombres).toBe('Diana María');
      expect(p?.apellidos).toBe('Castañeda Ortiz');
    });

    it('12.4b 🪪 empezó de nuevo con «Hola» a mitad del alta: sus nombres nuevos también llevan apellidos nuevos', async () => {
      const llegarAlNombre = async () => {
        if ((await state()) !== ChatState.AWAITING_SPECIALTY) await say('Hola');
        await say('A');
        await say('A');
        await say('A');
        if ((await state()) === ChatState.AWAITING_CEDULA) {
          await say('1054925390');
        }
        expect(await state()).toBe(ChatState.AWAITING_NAME);
      };

      await say('Hola');
      await llegarAlNombre();
      await say('Diana Castañeda');
      await say('Castañeda Ortiz');
      expect(await state()).toBe(ChatState.AWAITING_BIRTHDATE);
      await say('Hola'); // vuelve a empezar, sin decir NO

      await llegarAlNombre();
      await say('Diana María');
      expect(await state()).toBe(ChatState.AWAITING_APELLIDOS);
      await say('Castañeda Ortiz');
      await responderAlta(say);
      expect(lastSent()).toContain('Diana María Castañeda Ortiz');
    });

    it('12.5 🦷 pidió un servicio que no se agenda por aquí: con quién comunicarse y el menú, sin gastar intentos', async () => {
      await say('Hola');
      expect(await state()).toBe(ChatState.AWAITING_SPECIALTY);

      for (let i = 0; i < 4; i++) {
        await say(
          'Ecografía Doppler de vasos arteriales de miembros inferiores',
        );
        expect(await state()).toBe(ChatState.AWAITING_SPECIALTY);
      }
      expect(lastSent()).toContain('no se agendan citas de *ecografías*');
      expect(lastSent()).toContain('6068538838');
      expect(lastSent()).toContain('Medicina General');

      // Y si necesita medicina general, sigue como siempre.
      await say('A');
      expect(await state()).toBe(ChatState.AWAITING_EPS);
    });

    it('12.7 🗓️ sin cupos por el plazo: hasta cuándo se agenda y desde cuándo escribir, y la lista de espera igual', async () => {
      appointments.getAvailableSlots.mockImplementation(() => []);
      appointments.cupoMasAllaDelPlazo.mockResolvedValue({
        ultimoDia: '2026-10-24',
        primerDia: '2026-10-26',
        desde: '2026-10-25',
      });
      await say('Hola');
      await say('A');
      await say('A');
      expect(lastSent()).toContain(
        'Por ahora agendamos citas hasta el *sábado 24 de octubre*',
      );
      expect(lastSent()).toContain(
        'Escríbanos desde el *domingo 25 de octubre*',
      );
      expect(lastSent()).not.toContain('completa');
      expect(lastSent()).toContain('*lista de espera*');
      expect(await state()).toBe(ChatState.AWAITING_WAITLIST_OPTIN);
    });

    it('12.7b sin plazo (o tampoco hay cupos después): el mensaje de siempre', async () => {
      appointments.getAvailableSlots.mockImplementation(() => []);
      await say('Hola');
      await say('A');
      await say('A');
      expect(lastSent()).not.toContain('Por ahora agendamos citas hasta');
      expect(lastSent()).toContain('lista de espera');
      expect(await state()).toBe(ChatState.AWAITING_WAITLIST_OPTIN);
    });

    const reservarDeVerdad = () =>
      appointments.bookAppointment.mockImplementation(() => {
        db.appointments.push({
          id: 'apt-new',
          patientId: 'pat-laura',
          scheduleSlotId: 'slot-a',
          status: 'SCHEDULED',
          epsId: null,
          organizationId: ORG_ID,
        });
        return { success: true, appointmentId: 'apt-new' };
      });
    const casosDeRevision = () =>
      avisos.registrar.mock.calls.filter(
        (c: any[]) => c[1]?.kind === 'REVISAR_CITA_ASISTENTE',
      );

    it('12.8 🔎 preguntó si era para las ecografías y confirmó igual: la cita queda para revisión en la Bandeja', async () => {
      pacienteCompleto();
      reservarDeVerdad();
      await hastaElResumen();
      await say('Esto si es para las ecografías ?');
      await say('Sí');

      expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
      expect(casosDeRevision()).toHaveLength(1);
      expect(casosDeRevision()[0][1]).toMatchObject({
        kind: 'REVISAR_CITA_ASISTENTE',
        dedupeKey: 'revisar-cita:apt-new',
        appointmentId: 'apt-new',
        patientId: 'pat-laura',
        meta: {
          motivo: 'CONFIRMO_TRAS_PREGUNTAR',
          servicioPedido: 'ecografías',
          mensaje: 'Esto si es para las ecografías ?',
        },
      });
    });

    it('12.9 una cita agendada sin dudas no deja nada en la Bandeja', async () => {
      pacienteCompleto();
      reservarDeVerdad();
      await hastaElResumen();
      await say('Sí');
      expect(appointments.bookAppointment).toHaveBeenCalledTimes(1);
      expect(casosDeRevision()).toHaveLength(0);
    });

    it('12.9b preguntó por las ecografías y dijo NO: no queda nada para la siguiente cita', async () => {
      pacienteCompleto();
      reservarDeVerdad();
      await hastaElResumen();
      await say('Esto si es para las ecografías ?');
      await say('No');
      await hastaElResumen();
      await say('Sí');
      expect(casosDeRevision()).toHaveLength(0);
    });

    it('12.6 un servicio del menú de la clínica («Odontología» aquí sí se ofrece) sigue el camino de siempre', async () => {
      await say('Hola');
      await say('Odontología');
      expect(await state()).toBe(ChatState.AWAITING_EPS);
      expect(lastSent()).not.toContain('no se agendan citas');
    });
  });

  describe('presentación del bot', () => {
    const SE_PRESENTA = /Le saluda \*|Le habla \*|Soy \*/;

    it('tras «comencemos de nuevo», el menú sale sin volver a presentarse', async () => {
      await say('Hola');
      expect(lastSent()).toMatch(SE_PRESENTA);

      await say('Cancelar'); // salida del menú → «comencemos de nuevo»
      expect(await state()).toBe(ChatState.IDLE);
      // Cualquiera de las variantes de MSGS.escape().
      expect(lastSent()).toMatch(/comencemos de nuevo|Volvamos a empezar/);

      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ intent: 'agendar_cita' }),
      );
      await say('necesito una cita');
      expect(await state()).toBe(ChatState.AWAITING_SPECIALTY);
      expect(lastSent()).toContain('Medicina General');
      expect(lastSent()).not.toMatch(SE_PRESENTA);
    });

    it('un segundo «Hola» en la misma conversación tampoco repite la presentación', async () => {
      await say('Hola');
      await say('Hola');
      expect(lastSent()).toContain('Medicina General');
      expect(lastSent()).not.toMatch(SE_PRESENTA);
    });

    it('el primer contacto sí se presenta, aunque no empiece por «Hola»', async () => {
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ intent: 'agendar_cita' }),
      );
      await say('necesito una cita');
      expect(lastSent()).toMatch(SE_PRESENTA);
    });

    it('tras despedirse, una conversación nueva vuelve a presentarse', async () => {
      await say('Hola');
      await say('chao');
      expect(await state()).toBe(ChatState.IDLE);
      await say('Hola');
      expect(lastSent()).toMatch(SE_PRESENTA);
    });

    it('si el ACK del primer turno ya se presentó, el menú que sigue no lo repite', async () => {
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ intent: 'agendar_cita', cedula: '1088123456' }),
      );
      await say('quiero una cita, mi cédula es 1088123456');
      const [ack, menu] = sent().slice(-2);
      expect(ack).toMatch(/Le saluda \*/);
      expect(menu).not.toMatch(SE_PRESENTA);

      // Y si sale y vuelve a pedir cita en la misma conversación, tampoco.
      await say('Cancelar');
      provider.extractSchedulingIntent.mockReturnValue(
        extraction({ intent: 'agendar_cita' }),
      );
      await say('necesito una cita');
      expect(lastSent()).not.toMatch(SE_PRESENTA);
    });
  });
});
