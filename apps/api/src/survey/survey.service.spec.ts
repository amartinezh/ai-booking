import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResolutionStatus, SurveyExperience } from '@agenia/database';
import { SURVEY_EXPORT_LIMIT, SurveyService } from './survey.service';
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

// Las tres respuestas obligatorias; cada prueba cambia lo que le interesa.
const respuestas = (over: Record<string, unknown> = {}) =>
  ({
    rating: 5,
    wouldRecommend: true,
    experience: SurveyExperience.GOOD,
    ...over,
  }) as never;

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
  describe('saveRating — paso 1: la estrella se guarda sola', () => {
    it('guarda la estrella con su hora y NO cierra la encuesta', async () => {
      prisma.chatSurvey.updateMany.mockResolvedValue({ count: 1 });
      const before = new Date();

      await expect(service.saveRating(TOKEN, 4)).resolves.toEqual({
        success: true,
      });

      const arg = prisma.chatSurvey.updateMany.mock.calls[0][0];
      expect(arg.where.id).toBe(TOKEN);
      expect(arg.where.isUsed).toBe(false);
      expect(arg.where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(arg.data).toEqual({
        rating: 4,
        answeredAt: arg.where.expiresAt.gt,
      });
      // Sigue abierta para completar lo de la IPS.
      expect(arg.data.isUsed).toBeUndefined();
    });

    it.each([0, 6, 2.5, 'cinco', null, undefined])(
      'rechaza una estrella inválida (%p) sin tocar la BD',
      async (rating) => {
        await expect(service.saveRating(TOKEN, rating)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(prisma.chatSurvey.updateMany).not.toHaveBeenCalled();
      },
    );

    it('🔒 una encuesta ya completa o vencida no se reescribe (count = 0 → 404)', async () => {
      prisma.chatSurvey.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.saveRating(TOKEN, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('submitSurvey (regla de oro)', () => {
    it('persiste las respuestas y exige isUsed:false + expiresAt > now en el WHERE', async () => {
      prisma.chatSurvey.updateMany.mockResolvedValue({ count: 1 });

      const before = new Date();
      const res = await service.submitSurvey(
        TOKEN,
        respuestas({
          wouldRecommend: false,
          experience: SurveyExperience.FAIR,
          feedback: '  excelente  ',
        }),
      );
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
      expect(arg.data.wouldRecommend).toBe(false);
      expect(arg.data.experience).toBe(SurveyExperience.FAIR);
      expect(arg.data.feedback).toBe('excelente');
      // La hora de respuesta es la misma con la que se verificó el enlace.
      expect(arg.data.answeredAt).toEqual(arg.where.expiresAt.gt);
    });

    it('«No responde» es una respuesta válida a la experiencia', async () => {
      prisma.chatSurvey.updateMany.mockResolvedValue({ count: 1 });
      await service.submitSurvey(
        TOKEN,
        respuestas({ experience: SurveyExperience.NO_ANSWER }),
      );
      expect(
        prisma.chatSurvey.updateMany.mock.calls[0][0].data.experience,
      ).toBe(SurveyExperience.NO_ANSWER);
    });

    it('guarda feedback null cuando viene vacío o sólo espacios', async () => {
      prisma.chatSurvey.updateMany.mockResolvedValue({ count: 1 });

      await service.submitSurvey(TOKEN, respuestas({ feedback: '   ' }));
      expect(
        prisma.chatSurvey.updateMany.mock.calls[0][0].data.feedback,
      ).toBeNull();

      await service.submitSurvey(TOKEN, respuestas());
      expect(
        prisma.chatSurvey.updateMany.mock.calls[1][0].data.feedback,
      ).toBeNull();
    });

    it.each([0, 6, -1, 2.5, NaN])(
      'rechaza rating inválido (%p) sin tocar la BD',
      async (rating) => {
        await expect(
          service.submitSurvey(TOKEN, respuestas({ rating })),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.chatSurvey.updateMany).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['sin respuesta', undefined],
      ['null', null],
      ['texto «sí»', 'sí'],
      ['número 1', 1],
    ])(
      '«¿Recomendaría?» %s se rechaza: solo sí o no',
      async (_e, wouldRecommend) => {
        await expect(
          service.submitSurvey(TOKEN, respuestas({ wouldRecommend })),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.chatSurvey.updateMany).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['sin respuesta', undefined],
      ['inventada', 'EXCELENTE'],
      ['en minúsculas', 'good'],
    ])('«¿Cómo le fue?» %s se rechaza', async (_e, experience) => {
      await expect(
        service.submitSurvey(TOKEN, respuestas({ experience })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.chatSurvey.updateMany).not.toHaveBeenCalled();
    });

    it('lanza NotFound si el token es inválido / usado / expirado (count = 0)', async () => {
      prisma.chatSurvey.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.submitSurvey(TOKEN, respuestas({ rating: 3 })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // 🔒 DOBLE ENVÍO: el segundo intento NO debe poder escribir.
    it('un segundo envío del mismo token falla (un solo uso garantizado)', async () => {
      // 1er submit: el update atómico encuentra el registro y lo marca usado.
      prisma.chatSurvey.updateMany.mockResolvedValueOnce({ count: 1 });
      // 2do submit: el WHERE (isUsed:false) ya no matchea → count 0.
      prisma.chatSurvey.updateMany.mockResolvedValueOnce({ count: 0 });

      const first = await service.submitSurvey(TOKEN, respuestas());
      expect(first).toEqual({ success: true });

      await expect(
        service.submitSurvey(TOKEN, respuestas({ rating: 1 })),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.chatSurvey.updateMany).toHaveBeenCalledTimes(2);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// REPORTES CSAT — dos vistas de la misma tabla con reglas de exposición
// distintas. El Super Admin ve todo; la clínica no ve el resumen de la
// conversación ni la cédula, y SOLO ve sus pacientes. Si el `select` de la
// vista limitada se ampliara sin querer, una clínica leería el resumen de
// conversación de sus pacientes (y, peor, la consulta sin `where` leería los
// de otra).
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
    answeredAt: new Date('2026-05-10T14:03:00Z'),
    expiresAt: new Date('2026-05-11T14:00:00Z'),
    rating: 5,
    wouldRecommend: true,
    experience: SurveyExperience.GOOD,
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
      ['createdAt desc', 'createdAt', 'desc', [{ createdAt: 'desc' }]],
      ['createdAt asc', 'createdAt', 'asc', [{ createdAt: 'asc' }]],
      [
        'rating asc: las sin responder al final, a igual nota la más reciente',
        'rating',
        'asc',
        [{ rating: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      ],
      [
        'rating desc: las sin responder también al final',
        'rating',
        'desc',
        [{ rating: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      ],
      [
        'answeredAt',
        'answeredAt',
        'desc',
        [
          { answeredAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
      ],
      [
        'paciente por nombre',
        'patient',
        'asc',
        [{ patient: { fullName: 'asc' } }, { createdAt: 'desc' }],
      ],
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
      expect(consulta().orderBy).toEqual([{ createdAt: 'desc' }]);
    });
  });

  describe('filtros (los mismos para lista, estadísticas y descarga)', () => {
    it('sin filtros no restringe nada', async () => {
      await service.findDetailedForSuperAdmin(baseQuery);
      expect(consulta().where).toEqual({});
    });

    it('🕔 el rango de fechas va en la hora de Bogotá e incluye el día final COMPLETO', async () => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      });

      const { createdAt } = consulta().where;
      // 1-may 00:00 en Bogotá = 05:00 UTC (no las 7 p. m. del 30 de abril).
      expect(createdAt.gte).toEqual(new Date('2026-05-01T05:00:00.000Z'));
      // Hasta el 1-jun 00:00 de Bogotá, excluido: el 31 entra completo.
      expect(createdAt.lt).toEqual(new Date('2026-06-01T05:00:00.000Z'));
    });

    it('el fin de mes y de año pasan al día siguiente correcto', async () => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        endDate: '2026-12-31',
      });
      expect(consulta().where.createdAt).toEqual({
        lt: new Date('2027-01-01T05:00:00.000Z'),
      });
    });

    it.each([
      ['ilegibles', 'ayer', 'mañana'],
      ['imposibles', '2026-02-30', '2026-13-01'],
    ])(
      'fechas %s se ignoran en vez de generar un rango imposible',
      async (_e, ini, fin) => {
        await service.findDetailedForSuperAdmin({
          ...baseQuery,
          startDate: ini,
          endDate: fin,
        });
        expect(consulta().where).toEqual({});
      },
    );

    it('el filtro por clínica y por gestión viajan al WHERE', async () => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        organizationId: ORG_ID,
        resolutionStatus: ResolutionStatus.BOOKED,
      });

      expect(consulta().where).toEqual({
        AND: [
          { organizationId: ORG_ID },
          { resolutionStatus: ResolutionStatus.BOOKED },
        ],
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

    it('estrellas exactas y ánimo a la vez se SUMAN (no se pisan)', async () => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        rating: 5,
        mood: UserMood.NEGATIVE,
      });
      expect(consulta().where).toEqual({
        AND: [{ rating: { gte: 1, lte: 2 } }, { rating: 5 }],
      });
    });

    it.each([0, 6, 2.5])(
      'estrellas fuera de 1-5 (%p) se ignoran',
      async (rating) => {
        await service.findDetailedForSuperAdmin({ ...baseQuery, rating });
        expect(consulta().where).toEqual({});
      },
    );

    it('«¿Recomendaría?» = No filtra por false (no lo confunde con «sin filtro»)', async () => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        wouldRecommend: false,
      });
      expect(consulta().where).toEqual({ wouldRecommend: false });
    });

    it('experiencia y «con comentario»', async () => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        experience: SurveyExperience.BAD,
        withComment: true,
      });
      expect(consulta().where).toEqual({
        AND: [
          { experience: SurveyExperience.BAD },
          { feedback: { not: null } },
        ],
      });
    });

    it.each([
      ['ANSWERED', (w: any) => expect(w).toEqual({ isUsed: true })],
      [
        'PARTIAL',
        (w: any) => expect(w).toEqual({ isUsed: false, rating: { not: null } }),
      ],
      [
        'PENDING',
        (w: any) => {
          expect(w.isUsed).toBe(false);
          expect(w.rating).toBeNull();
          expect(w.expiresAt.gt).toBeInstanceOf(Date);
        },
      ],
      [
        'EXPIRED',
        (w: any) => {
          expect(w.isUsed).toBe(false);
          // Con estrella no es «vencida sin respuesta»: es «solo estrellas».
          expect(w.rating).toBeNull();
          expect(w.expiresAt.lte).toBeInstanceOf(Date);
        },
      ],
    ])('estado %s', async (status, comprobar) => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        status: status as never,
      });
      comprobar(consulta().where);
    });

    it('🔎 la búsqueda de texto mira nombre y comentario, sin distinguir mayúsculas', async () => {
      await service.findDetailedForSuperAdmin({ ...baseQuery, q: '  ana  ' });
      const texto = { contains: 'ana', mode: 'insensitive' };
      expect(consulta().where).toEqual({
        OR: [{ patient: { is: { fullName: texto } } }, { feedback: texto }],
      });
    });

    it('🔎 con 3+ dígitos también busca en cédula y teléfono (solo los dígitos)', async () => {
      await service.findDetailedForSuperAdmin({
        ...baseQuery,
        q: '310 630',
      });
      const { OR } = consulta().where;
      expect(OR).toContainEqual({
        patient: { is: { cedula: { contains: '310630' } } },
      });
      expect(OR).toContainEqual({
        patient: { is: { whatsappId: { contains: '310630' } } },
      });
    });

    it('🔎 una búsqueda de solo espacios no filtra', async () => {
      await service.findDetailedForSuperAdmin({ ...baseQuery, q: '   ' });
      expect(consulta().where).toEqual({});
    });
  });

  describe('findDetailedForSuperAdmin — filas', () => {
    it('la fila expone el detalle completo, con el ánimo y el estado derivados', async () => {
      const r = await service.findDetailedForSuperAdmin(baseQuery);

      expect(r.rows[0]).toEqual({
        id: 's1',
        createdAt: '2026-05-10T14:00:00.000Z',
        answeredAt: '2026-05-10T14:03:00.000Z',
        status: 'ANSWERED',
        rating: 5,
        userMood: 'HAPPY',
        wouldRecommend: true,
        experience: 'GOOD',
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

    it('una encuesta aún sin calificar no tiene ánimo; vencida o pendiente según su enlace', async () => {
      prisma.chatSurvey.findMany.mockReturnValue([
        encuesta({
          id: 'vencida',
          isUsed: false,
          rating: null,
          answeredAt: null,
          expiresAt: new Date(Date.now() - 1000),
        }),
        encuesta({
          id: 'abierta',
          isUsed: false,
          rating: null,
          answeredAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ]);

      const r = await service.findDetailedForSuperAdmin(baseQuery);
      expect(r.rows[0]).toMatchObject({ userMood: null, status: 'EXPIRED' });
      expect(r.rows[1]).toMatchObject({ userMood: null, status: 'PENDING' });
    });

    it('con estrella y sin enviar el resto es «solo estrellas», con el enlace abierto o vencido', async () => {
      prisma.chatSurvey.findMany.mockReturnValue([
        encuesta({
          id: 'abierta',
          isUsed: false,
          rating: 2,
          wouldRecommend: null,
          experience: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        encuesta({
          id: 'vencida',
          isUsed: false,
          rating: 4,
          wouldRecommend: null,
          experience: null,
          expiresAt: new Date(Date.now() - 1000),
        }),
      ]);
      const r = await service.findDetailedForSuperAdmin(baseQuery);
      expect(r.rows.map((x) => x.status)).toEqual(['PARTIAL', 'PARTIAL']);
      expect(r.rows[0].userMood).toBe('NEGATIVE');
    });

    it('una encuesta anterior a las preguntas de la IPS las trae en null', async () => {
      prisma.chatSurvey.findMany.mockReturnValue([
        encuesta({ wouldRecommend: null, experience: null }),
      ]);
      const r = await service.findDetailedForSuperAdmin(baseQuery);
      expect(r.rows[0]).toMatchObject({
        rating: 5,
        wouldRecommend: null,
        experience: null,
      });
    });
  });

  describe('findLimitedForClinic — la vista de la clínica', () => {
    it('🏢 el WHERE lleva SIEMPRE la organización, aunque el controller ya validó', async () => {
      await service.findLimitedForClinic(ORG_ID, baseQuery);
      expect(consulta().where).toEqual({ organizationId: ORG_ID });
    });

    it('🏢 con filtros, la organización sigue en el WHERE', async () => {
      await service.findLimitedForClinic(ORG_ID, {
        ...baseQuery,
        q: 'ana',
        experience: SurveyExperience.BAD,
      });
      expect(consulta().where.AND).toContainEqual({ organizationId: ORG_ID });
    });

    it('🔒 NO expone el resumen de la conversación, la cédula ni ids internos del paciente', async () => {
      const r = await service.findLimitedForClinic(ORG_ID, baseQuery);

      expect(r.rows[0]).toEqual({
        id: 's1',
        createdAt: '2026-05-10T14:00:00.000Z',
        answeredAt: '2026-05-10T14:03:00.000Z',
        status: 'ANSWERED',
        patientName: 'Ana Pérez',
        whatsappPhone: '573001112233',
        rating: 5,
        userMood: 'HAPPY',
        wouldRecommend: true,
        experience: 'GOOD',
        message: 'excelente',
        // La gestión que cerró el chat sí viaja: no es un dato del paciente.
        resolutionStatus: ResolutionStatus.BOOKED,
      });
      expect(JSON.stringify(r)).not.toContain('chatSummary');
      expect(JSON.stringify(r)).not.toContain('1088'); // la cédula no viaja
      expect(JSON.stringify(r)).not.toContain('p1'); // ni el id del paciente
    });

    it('el `select` de Prisma tampoco pide los campos internos', async () => {
      await service.findLimitedForClinic(ORG_ID, baseQuery);

      const select = consulta().select;
      expect(select.chatSummary).toBeUndefined();
      expect(select.organization).toBeUndefined();
      expect(select.patient.select.cedula).toBeUndefined();
      expect(select.patient.select.id).toBeUndefined();
    });

    it('un paciente sin identificar aparece como anónimo, no como null', async () => {
      prisma.chatSurvey.findMany.mockReturnValue([encuesta({ patient: null })]);

      const r = await service.findLimitedForClinic(ORG_ID, baseQuery);
      expect(r.rows[0].patientName).toBe('Paciente anónimo');
      expect(r.rows[0].whatsappPhone).toBeNull();
    });
  });

  describe('descarga', () => {
    it('la de la clínica usa el mismo recorte de columnas y su organización', async () => {
      const r = await service.exportLimitedForClinic(ORG_ID, baseQuery);
      expect(consulta().where).toEqual({ organizationId: ORG_ID });
      expect(consulta().select.chatSummary).toBeUndefined();
      expect(JSON.stringify(r)).not.toContain('1088');
      expect(r).toMatchObject({ total: 1, truncated: false });
    });

    it('tiene tope de filas y avisa si se cortó', async () => {
      prisma.chatSurvey.count.mockReturnValue(SURVEY_EXPORT_LIMIT + 1);
      const r = await service.exportDetailedForSuperAdmin(baseQuery);
      expect(consulta().take).toBe(SURVEY_EXPORT_LIMIT);
      expect(r.truncated).toBe(true);
    });
  });

  describe('getStats', () => {
    it('🏢 calcula sobre los mismos filtros, con la organización en el WHERE', async () => {
      prisma.chatSurvey.findMany.mockReturnValue([]);
      prisma.chatSurvey.count.mockReturnValue(0);
      await service.getStats({
        organizationId: ORG_ID,
        experience: SurveyExperience.BAD,
      });
      expect(consulta().where).toEqual({
        AND: [{ organizationId: ORG_ID }, { experience: SurveyExperience.BAD }],
      });
      expect(consulta().take).toBeGreaterThan(0);
      // Los comentarios se cuentan sobre el mismo WHERE.
      const conComentario = prisma.chatSurvey.count.mock.calls.find(
        ([arg]) => arg.where.AND,
      )[0];
      expect(conComentario.where.AND[1]).toEqual({ feedback: { not: null } });
    });

    it('arma los indicadores con las filas que devuelve la base', async () => {
      prisma.chatSurvey.findMany.mockReturnValue([
        encuesta(),
        encuesta({ rating: 1, wouldRecommend: false, experience: 'BAD' }),
      ]);
      prisma.chatSurvey.count.mockReturnValue(2);
      const r = await service.getStats(
        { startDate: '2026-05-01', endDate: '2026-05-31' },
        new Date('2026-06-01T12:00:00Z'),
      );
      expect(r).toMatchObject({
        sent: 2,
        answered: 2,
        averageRating: 3,
        recommendRate: 0.5,
        goodRate: 0.5,
        truncated: false,
      });
      expect(r.trend.points).toHaveLength(31);
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
