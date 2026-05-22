import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResolutionStatus } from '@antigravity/database';
import { SurveyService } from './survey.service';
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
      providers: [
        SurveyService,
        { provide: PrismaService, useValue: prisma },
      ],
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
      expect(expiresMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000);
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
      prisma.chatSurvey.findUnique.mockResolvedValue({ ...validRow(), isUsed: true });
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
      const res = await service.submitSurvey(TOKEN, { rating: 5, feedback: '  excelente  ' });
      expect(res).toEqual({ success: true });

      const arg = prisma.chatSurvey.updateMany.mock.calls[0][0];
      // Guardas de seguridad en el WHERE
      expect(arg.where.id).toBe(TOKEN);
      expect(arg.where.isUsed).toBe(false);
      expect(arg.where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      // Marca el token como consumido y normaliza el feedback (trim)
      expect(arg.data.isUsed).toBe(true);
      expect(arg.data.rating).toBe(5);
      expect(arg.data.feedback).toBe('excelente');
    });

    it('guarda feedback null cuando viene vacío o sólo espacios', async () => {
      prisma.chatSurvey.updateMany.mockResolvedValue({ count: 1 });

      await service.submitSurvey(TOKEN, { rating: 4, feedback: '   ' });
      expect(prisma.chatSurvey.updateMany.mock.calls[0][0].data.feedback).toBeNull();

      await service.submitSurvey(TOKEN, { rating: 4 });
      expect(prisma.chatSurvey.updateMany.mock.calls[1][0].data.feedback).toBeNull();
    });

    it.each([0, 6, -1, 2.5, NaN])(
      'rechaza rating inválido (%p) sin tocar la BD',
      async (rating) => {
        await expect(
          service.submitSurvey(TOKEN, { rating: rating as number }),
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
