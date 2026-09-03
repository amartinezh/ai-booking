import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResolutionStatus } from '@agenia/database';
import { SurveyService } from './survey.service';
import {
  UserMood,
  computeUserMood,
  moodToRatingWhere,
} from './dto/survey-report.types';
import { PrismaService } from '../prisma/prisma.service';

// ───────────────────────────────────────────────────────────────
// Helpers de prueba
// ───────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';
const PATIENT_ID = 'patient-1';
const TOKEN = 'survey-token-uuid';

// Prisma falso: sólo el modelo chatSurvey con los métodos que usa el service.
function createFakePrisma() {
  return {
    chatSurvey: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

describe('SurveyService — generación, gate y regla de oro (CSAT)', () => {
  let service: SurveyService;
  let prisma: ReturnType<typeof createFakePrisma>;

  beforeEach(async () => {
    prisma = createFakePrisma();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [SurveyService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(SurveyService);
  });

  afterEach(() => jest.clearAllMocks());

  // ───────────────────────────────────────────────────────────
  // generateSurveyToken
  // ───────────────────────────────────────────────────────────
  describe('generateSurveyToken', () => {
    it('inserta el registro y devuelve el UUID con expiración a ~24h', async () => {
      prisma.chatSurvey.create.mockResolvedValue({ id: TOKEN });

      const before = Date.now();
      const id = await service.generateSurveyToken({
        patientId: PATIENT_ID,
        organizationId: ORG_ID,
        resolutionStatus: ResolutionStatus.BOOKED,
        chatSummary: 'Cita agendada.',
      });
      const after = Date.now();

      expect(id).toBe(TOKEN);
      expect(prisma.chatSurvey.create).toHaveBeenCalledTimes(1);

      const arg = prisma.chatSurvey.create.mock.calls[0][0];
      expect(arg.data.patientId).toBe(PATIENT_ID);
      expect(arg.data.organizationId).toBe(ORG_ID);
      expect(arg.data.resolutionStatus).toBe(ResolutionStatus.BOOKED);

      // expiresAt ≈ now + 24h (con holgura por el tiempo de ejecución del test)
      const expiresMs = (arg.data.expiresAt as Date).getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(
        before + 24 * 60 * 60 * 1000 - 1000,
      );
      expect(expiresMs).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 1000);
    });

    it('persiste patientId = null cuando el paciente no se identificó (insulto/error)', async () => {
      prisma.chatSurvey.create.mockResolvedValue({ id: TOKEN });

      await service.generateSurveyToken({
        patientId: null,
        organizationId: ORG_ID,
        resolutionStatus: ResolutionStatus.BLOCKED_INSULT,
      });

      const arg = prisma.chatSurvey.create.mock.calls[0][0];
      expect(arg.data.patientId).toBeNull();
      expect(arg.data.resolutionStatus).toBe(ResolutionStatus.BLOCKED_INSULT);
    });
  });

  // ───────────────────────────────────────────────────────────
  // getValidSurvey — gate del frontend
  // ───────────────────────────────────────────────────────────
  describe('getValidSurvey', () => {
    const validRow = () => ({
      id: TOKEN,
      isUsed: false,
      expiresAt: new Date(Date.now() + 60_000),
      resolutionStatus: ResolutionStatus.BOOKED,
      chatSummary: 'resumen',
      organization: { name: 'Clínica Demo' },
    });

    it('devuelve la vista pública cuando el token es válido', async () => {
      prisma.chatSurvey.findUnique.mockResolvedValue(validRow());

      const view = await service.getValidSurvey(TOKEN);

      expect(view).toEqual({
        id: TOKEN,
        resolutionStatus: ResolutionStatus.BOOKED,
        chatSummary: 'resumen',
        organizationName: 'Clínica Demo',
      });
    });

    it('devuelve null si el id es vacío (no consulta la BD)', async () => {
      const view = await service.getValidSurvey('');
      expect(view).toBeNull();
      expect(prisma.chatSurvey.findUnique).not.toHaveBeenCalled();
    });

    it('devuelve null si el token no existe', async () => {
      prisma.chatSurvey.findUnique.mockResolvedValue(null);
      expect(await service.getValidSurvey(TOKEN)).toBeNull();
    });

    it('devuelve null si ya se usó', async () => {
      prisma.chatSurvey.findUnique.mockResolvedValue({
        ...validRow(),
        isUsed: true,
      });
      expect(await service.getValidSurvey(TOKEN)).toBeNull();
    });

    it('devuelve null si expiró', async () => {
      prisma.chatSurvey.findUnique.mockResolvedValue({
        ...validRow(),
        expiresAt: new Date(Date.now() - 1000),
      });
      expect(await service.getValidSurvey(TOKEN)).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────
  // submitSurvey — REGLA DE ORO
  // ───────────────────────────────────────────────────────────
  describe('submitSurvey (regla de oro)', () => {
    it('persiste la calificación y exige isUsed:false + expiresAt > now en el WHERE', async () => {
      prisma.chatSurvey.updateMany.mockResolvedValue({ count: 1 });

      const before = new Date();
      const res = await service.submitSurvey(TOKEN, {
        rating: 5,
        feedback: '  excelente  ',
      });
      expect(res).toEqual({ success: true });

      const arg = prisma.chatSurvey.updateMany.mock.calls[0][0];
      // Guardas de seguridad en el WHERE
      expect(arg.where.id).toBe(TOKEN);
      expect(arg.where.isUsed).toBe(false);
      expect(arg.where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      // Marca el token como consumido y normaliza el feedback (trim)
      expect(arg.data.isUsed).toBe(true);
      expect(arg.data.rating).toBe(5);
      expect(arg.data.feedback).toBe('excelente');
    });

    it('guarda feedback null cuando viene vacío o sólo espacios', async () => {
      prisma.chatSurvey.updateMany.mockResolvedValue({ count: 1 });

      await service.submitSurvey(TOKEN, { rating: 4, feedback: '   ' });
      expect(
        prisma.chatSurvey.updateMany.mock.calls[0][0].data.feedback,
      ).toBeNull();

      await service.submitSurvey(TOKEN, { rating: 4 });
      expect(
        prisma.chatSurvey.updateMany.mock.calls[1][0].data.feedback,
      ).toBeNull();
    });

    it.each([0, 6, -1, 2.5, NaN])(
      'rechaza rating inválido (%p) sin tocar la BD',
      async (rating) => {
        await expect(
          service.submitSurvey(TOKEN, { rating: rating }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.chatSurvey.updateMany).not.toHaveBeenCalled();
      },
    );

    it('lanza NotFound si el token es inválido / usado / expirado (count = 0)', async () => {
      prisma.chatSurvey.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.submitSurvey(TOKEN, { rating: 3 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // 🔒 DOBLE ENVÍO: el segundo intento NO debe poder escribir.
    it('un segundo envío del mismo token falla (un solo uso garantizado)', async () => {
      // 1er submit: el update atómico encuentra el registro y lo marca usado.
      prisma.chatSurvey.updateMany.mockResolvedValueOnce({ count: 1 });
      // 2do submit: el WHERE (isUsed:false) ya no matchea → count 0.
      prisma.chatSurvey.updateMany.mockResolvedValueOnce({ count: 0 });

      const first = await service.submitSurvey(TOKEN, { rating: 5 });
      expect(first).toEqual({ success: true });

      await expect(
        service.submitSurvey(TOKEN, { rating: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.chatSurvey.updateMany).toHaveBeenCalledTimes(2);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// REPORTES CSAT — dos vistas de la misma tabla con reglas de exposición
// distintas. El Super Admin ve todo; la clínica ve un payload minimalista y
// SOLO de sus pacientes. Si el `select` de la vista limitada se ampliara sin
// querer, una clínica leería el resumen de conversación de sus pacientes (y,
// peor, la consulta sin `where` leería los de otra).
// ══════════════════════════════════════════════════════════════════════════
describe('SurveyService — reportes', () => {
  let service: SurveyService;
  let prisma: {
    chatSurvey: { count: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const encuesta = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    createdAt: new Date('2026-05-10T14:00:00Z'),
    rating: 5,
    feedback: 'excelente',
    chatSummary: 'el paciente agendó su cita',
    resolutionStatus: ResolutionStatus.BOOKED,
    isUsed: true,
    patient: {
      id: 'p1',
      fullName: 'Ana Pérez',
      whatsappId: '573001112233',
      cedula: '1088',
    },
    organization: { id: ORG_ID, name: 'Clínica Demo' },
    ...over,
  });

  const consulta = () => prisma.chatSurvey.findMany.mock.calls[0][0];

  beforeEach(async () => {
    prisma = {
      chatSurvey: {
        count: jest.fn(() => 1),
        findMany: jest.fn(() => [encuesta()]),
      },
      // El servicio agrupa count+findMany en una transacción de lectura.
      $transaction: jest.fn(async (ops: unknown[]) =>
        Promise.all(ops as never),
      ),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [SurveyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(SurveyService);
  });

  const baseQuery = {
    page: 1,
    pageSize: 25,
    sortBy: 'createdAt' as const,
    sortDir: 'desc' as const,
  };

  describe('paginación (compartida por las dos vistas)', () => {
    it.each([
      ['página 0', { page: 0 }, { page: 1, skip: 0 }],
      ['página negativa', { page: -3 }, { page: 1, skip: 0 }],
      ['página 3 de 25', { page: 3 }, { page: 3, skip: 50 }],
    ])('%s', async (_e, over, esperado) => {
      const r = await service.findDetailedForSuperAdmin({
        ...baseQuery,
        ...over,
      });
      expect(r.page).toBe(esperado.page);
      expect(consulta().skip).toBe(esperado.skip);
    });

    it.each([
      // pageSize 0 es falsy: el servicio lo trata como "sin valor" y usa 25.
      ['tamaño 0 cae al default de 25', 0, 25],
      ['tamaño 1000 baja al tope de 100', 1000, 100],
      ['tamaño 50 se respeta', 50, 50],
    ])('%s', async (_e, pageSize, esperado) => {
      const r = await service.findDetailedForSuperAdmin({
        ...baseQuery,
        pageSize,
      });
      expect(r.pageSize).toBe(esperado);
      expect(consulta().take).toBe(esperado);
    });

    it('🔒 SIEMPRE hay take: nunca se vuelca la tabla entera', async () => {
      await service.findDetailedForSuperAdmin(baseQuery);
      expect(consulta().take).toBeGreaterThan(0);
    });

    it('el total de páginas es al menos 1, incluso sin resultados', async () => {
      prisma.chatSurvey.count.mockReturnValue(0);
      prisma.chatSurvey.findMany.mockReturnValue([]);

      const r = await service.findDetailedForSuperAdmin(baseQuery);
      expect(r).toMatchObject({ total: 0, rows: [], totalPages: 1 });
    });

    it('el total de páginas redondea hacia arriba', async () => {
      prisma.chatSurvey.count.mockReturnValue(26);
      const r = await service.findDetailedForSuperAdmin(baseQuery);
      expect(r.totalPages).toBe(2);
    });
  });

  describe('orden (allowlist contra inyección de columnas)', () => {
    it.each([
      ['createdAt desc', 'createdAt', 'desc', { createdAt: 'desc' }],
      ['rating asc', 'rating', 'asc', { rating: 'asc' }],
    ])('%s', async (_e, sortBy, sortDir, esperado) => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        sortBy: sortBy as never,
        sortDir: sortDir as never,
      });
      expect(consulta().orderBy).toEqual(esperado);
    });

    it('un campo fuera de la lista cae a createdAt: no se ordena por lo que llegue', async () => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        sortBy: 'patient.cedula' as never,
      });
      expect(consulta().orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  describe('findDetailedForSuperAdmin — filtros', () => {
    it('sin filtros no restringe nada', async () => {
      await service.findDetailedForSuperAdmin(baseQuery);
      expect(consulta().where).toEqual({});
    });

    it('el rango de fechas incluye el día final COMPLETO', async () => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      });

      const { createdAt } = consulta().where;
      expect(createdAt.gte).toEqual(new Date('2026-05-01'));
      expect(createdAt.lte.getHours()).toBe(23);
      expect(createdAt.lte.getMinutes()).toBe(59);
    });

    it('una fecha ilegible se ignora en vez de generar un rango imposible', async () => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        startDate: 'ayer',
        endDate: 'mañana',
      });
      expect(consulta().where).toEqual({});
    });

    it('el filtro por clínica y por estado de resolución viajan al WHERE', async () => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        organizationId: ORG_ID,
        resolutionStatus: ResolutionStatus.BOOKED,
      });

      expect(consulta().where).toMatchObject({
        organizationId: ORG_ID,
        resolutionStatus: ResolutionStatus.BOOKED,
      });
    });

    it.each([
      ['NEGATIVE', { gte: 1, lte: 2 }],
      ['NEUTRAL', { equals: 3 }],
      ['HAPPY', { gte: 4, lte: 5 }],
    ])(
      'el ánimo %s se traduce a un rango de calificación',
      async (mood, esperado) => {
        await service.findDetailedForSuperAdmin({
          ...baseQuery,
          mood: mood as never,
        });
        expect(consulta().where.rating).toEqual(esperado);
      },
    );

    it('la fila expone el detalle completo, con el ánimo derivado', async () => {
      const r = await service.findDetailedForSuperAdmin(baseQuery);

      expect(r.rows[0]).toEqual({
        id: 's1',
        createdAt: '2026-05-10T14:00:00.000Z',
        rating: 5,
        userMood: 'HAPPY',
        feedback: 'excelente',
        chatSummary: 'el paciente agendó su cita',
        resolutionStatus: ResolutionStatus.BOOKED,
        isUsed: true,
        patient: {
          id: 'p1',
          fullName: 'Ana Pérez',
          whatsappId: '573001112233',
          cedula: '1088',
        },
        organization: { id: ORG_ID, name: 'Clínica Demo' },
      });
    });

    it('una encuesta sin paciente identificado no rompe la fila', async () => {
      prisma.chatSurvey.findMany.mockReturnValue([encuesta({ patient: null })]);

      const r = await service.findDetailedForSuperAdmin(baseQuery);
      expect(r.rows[0].patient).toBeNull();
    });

    it('una encuesta aún sin calificar no tiene ánimo', async () => {
      prisma.chatSurvey.findMany.mockReturnValue([encuesta({ rating: null })]);

      const r = await service.findDetailedForSuperAdmin(baseQuery);
      expect(r.rows[0].userMood).toBeNull();
    });
  });

  describe('findLimitedForClinic — la vista de la clínica', () => {
    it('🏢 el WHERE lleva SIEMPRE la organización, aunque el controller ya validó', async () => {
      await service.findLimitedForClinic(ORG_ID, baseQuery);
      expect(consulta().where).toEqual({ organizationId: ORG_ID });
    });

    it('🔒 NO expone el resumen de la conversación ni ids internos del paciente', async () => {
      const r = await service.findLimitedForClinic(ORG_ID, baseQuery);

      expect(r.rows[0]).toEqual({
        id: 's1',
        createdAt: '2026-05-10T14:00:00.000Z',
        patientName: 'Ana Pérez',
        whatsappPhone: '573001112233',
        rating: 5,
        userMood: 'HAPPY',
        message: 'excelente',
      });
      expect(JSON.stringify(r)).not.toContain('chatSummary');
      expect(JSON.stringify(r)).not.toContain('1088'); // la cédula no viaja
    });

    it('el `select` de Prisma tampoco pide los campos internos', async () => {
      await service.findLimitedForClinic(ORG_ID, baseQuery);

      const select = consulta().select;
      expect(select.chatSummary).toBeUndefined();
      expect(select.resolutionStatus).toBeUndefined();
      expect(select.patient.select.cedula).toBeUndefined();
    });

    it('un paciente sin identificar aparece como anónimo, no como null', async () => {
      prisma.chatSurvey.findMany.mockReturnValue([encuesta({ patient: null })]);

      const r = await service.findLimitedForClinic(ORG_ID, baseQuery);
      expect(r.rows[0].patientName).toBe('Paciente anónimo');
      expect(r.rows[0].whatsappPhone).toBeNull();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('clasificación de ánimo (CSAT)', () => {
  it.each([
    [1, 'NEGATIVE'],
    [2, 'NEGATIVE'],
    [3, 'NEUTRAL'],
    [4, 'HAPPY'],
    [5, 'HAPPY'],
  ])('una calificación de %i es %s', (rating, esperado) => {
    expect(computeUserMood(rating)).toBe(esperado);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])(
    'sin calificar (%s) no hay ánimo, y eso NO es «negativo»',
    (_e, rating) => {
      expect(computeUserMood(rating)).toBeNull();
    },
  );

  it('los tres rangos cubren 1-5 sin huecos ni solapes', () => {
    const rangos = [
      moodToRatingWhere(UserMood.NEGATIVE),
      moodToRatingWhere(UserMood.NEUTRAL),
      moodToRatingWhere(UserMood.HAPPY),
    ];
    const cubierto = new Set<number>();
    for (const r of rangos) {
      if ('equals' in r && r.equals != null) cubierto.add(r.equals);
      else
        for (let i = r.gte as number; i <= (r.lte as number); i++) {
          expect(cubierto.has(i)).toBe(false); // sin solapes
          cubierto.add(i);
        }
    }
    expect([...cubierto].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
