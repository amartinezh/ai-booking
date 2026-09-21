import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MirrorNoticeService } from './mirror-notice.service';

/**
 * Cubre lo que este servicio garantiza (PLAN_AVISOS_MASIVOS.md §5): la Llave
 * 2+3 se revisa aunque el token del agente sea válido; el roster se aplica
 * con la MISMA idempotencia que el CSV (dedup por documento+hora, aviso
 * previo, agenIAPatientId); una petición ya resuelta no se vuelve a aplicar;
 * y una ventana o un lote de destinatarios fuera de los topes configurados
 * se rechaza o se trunca, nunca en silencio.
 */
describe('MirrorNoticeService', () => {
  const ORG = 'org-1';
  const DRIVER = 'cnt-sanvicente-anserma';

  const CONFIG_ESPEJO_ON = {
    driverKey: DRIVER,
    enabled: true,
    avisosMasivos: {
      enabled: true,
      fuente: 'ESPEJO',
      maxDestinatariosPorLote: 300,
    },
  };

  const build = (overrides?: {
    hospitalMirrorConfig?: any;
    request?: any;
    patients?: any[];
    previousSends?: any[];
    batch?: any;
  }) => {
    const patients = overrides?.patients ?? [];
    const previousSends = overrides?.previousSends ?? [];

    const prisma = {
      hospitalMirrorConfig: {
        findUnique: jest.fn(async () =>
          overrides?.hospitalMirrorConfig !== undefined
            ? overrides.hospitalMirrorConfig
            : CONFIG_ESPEJO_ON,
        ),
      },
      noticeRosterRequest: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () =>
          overrides?.request !== undefined
            ? overrides.request
            : {
                id: 'req-1',
                organizationId: ORG,
                batchId: 'batch-1',
                doctorExternalKey: '76',
                status: 'PENDIENTE',
              },
        ),
        create: jest.fn(async ({ data }: any) => ({
          id: 'req-nuevo',
          ...data,
        })),
        update: jest.fn(async () => ({})),
      },
      massNoticeBatch: {
        findFirst: jest.fn(async () =>
          overrides?.batch !== undefined ? overrides.batch : { id: 'batch-1' },
        ),
        update: jest.fn(async () => ({})),
      },
      massNoticeRecipient: {
        deleteMany: jest.fn(async () => ({})),
        createMany: jest.fn(async () => ({})),
        findMany: jest.fn(async () => previousSends),
      },
      patientProfile: {
        findMany: jest.fn(async () => patients),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    const service = new MirrorNoticeService(prisma);
    return { service, prisma };
  };

  const CANDIDATO = {
    doctorExternalKey: '76',
    serviceExternalKey: '890266ESP',
    startTimeIso: '2026-09-24T12:00:00.000Z',
    patientDocument: '1037456123',
    patientFullName: 'Luz Elena Restrepo Gómez',
    patientPhone: '3114567890',
  };

  // ── Llave 2/3 ──────────────────────────────────────────────────────────
  //
  // La LECTURA con una llave apagada responde lista vacía, no 403: el agente la
  // sondea cada ~30 s porque su driver tiene la capacidad, aunque la clínica la
  // tenga apagada, y un 403 en cada vuelta dejaba ~150 líneas de error al día en
  // el journal de la VM de Anserma (2026-09-21), tapando los errores de verdad.
  // Lo que la llave protege se conserva: el agente no recibe NINGUNA petición y
  // ni siquiera se consulta la tabla. La ESCRITURA sigue respondiendo 403.
  describe('las tres llaves', () => {
    const sinLeerLaTabla = (ctx: ReturnType<typeof build>) =>
      expect(ctx.prisma.noticeRosterRequest.findMany).not.toHaveBeenCalled();

    it('getPendingRequests con otro driver: lista vacía, sin tocar la tabla', async () => {
      const ctx = build({
        hospitalMirrorConfig: { ...CONFIG_ESPEJO_ON, driverKey: 'otro-driver' },
      });
      await expect(
        ctx.service.getPendingRequests(ORG, 'otro-driver'),
      ).resolves.toEqual([]);
      sinLeerLaTabla(ctx);
    });

    it('getPendingRequests con avisosMasivos.enabled = false: lista vacía, sin tocar la tabla', async () => {
      const ctx = build({
        hospitalMirrorConfig: {
          ...CONFIG_ESPEJO_ON,
          avisosMasivos: { enabled: false, fuente: 'ESPEJO' },
        },
      });
      await expect(
        ctx.service.getPendingRequests(ORG, DRIVER),
      ).resolves.toEqual([]);
      sinLeerLaTabla(ctx);
    });

    it('getPendingRequests con fuente CSV (no ESPEJO): lista vacía, sin tocar la tabla', async () => {
      const ctx = build({
        hospitalMirrorConfig: {
          ...CONFIG_ESPEJO_ON,
          avisosMasivos: { enabled: true, fuente: 'CSV' },
        },
      });
      await expect(
        ctx.service.getPendingRequests(ORG, DRIVER),
      ).resolves.toEqual([]);
      sinLeerLaTabla(ctx);
    });

    it('getPendingRequests sin fila de espejo: lista vacía', async () => {
      const ctx = build({ hospitalMirrorConfig: null });
      await expect(
        ctx.service.getPendingRequests(ORG, DRIVER),
      ).resolves.toEqual([]);
      sinLeerLaTabla(ctx);
    });

    it('🔒 applyRoster (ESCRIBE) sigue respondiendo 403 antes de tocar la petición', async () => {
      const ctx = build({ hospitalMirrorConfig: null });
      await expect(
        ctx.service.applyRoster(ORG, DRIVER, {
          requestId: 'req-1',
          candidates: [],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(ctx.prisma.noticeRosterRequest.findFirst).not.toHaveBeenCalled();
    });

    it('🔒 applyRoster con la función apagada, o con otro driver: 403 con el motivo', async () => {
      const apagada = build({
        hospitalMirrorConfig: {
          ...CONFIG_ESPEJO_ON,
          avisosMasivos: { enabled: false, fuente: 'ESPEJO' },
        },
      });
      await expect(
        apagada.service.applyRoster(ORG, DRIVER, {
          requestId: 'req-1',
          candidates: [],
        }),
      ).rejects.toThrow('no están habilitados para esta clínica');

      const otroDriver = build({ hospitalMirrorConfig: CONFIG_ESPEJO_ON });
      await expect(
        otroDriver.service.applyRoster(ORG, 'otro-driver', {
          requestId: 'req-1',
          candidates: [],
        }),
      ).rejects.toThrow('no están disponibles para este driver');
    });
  });

  // ── getPendingRequests ─────────────────────────────────────────────────
  describe('getPendingRequests', () => {
    it('mapea las filas PENDIENTE a DTOs con fechas ISO', async () => {
      const ctx = build();
      ctx.prisma.noticeRosterRequest.findMany.mockResolvedValue([
        {
          id: 'req-1',
          doctorExternalKey: '76',
          fromIso: new Date('2026-09-24T00:00:00.000Z'),
          toIso: new Date('2026-09-25T00:00:00.000Z'),
        },
      ]);

      const result = await ctx.service.getPendingRequests(ORG, DRIVER);

      expect(result).toEqual([
        {
          requestId: 'req-1',
          doctorExternalKey: '76',
          fromIso: '2026-09-24T00:00:00.000Z',
          toIso: '2026-09-25T00:00:00.000Z',
        },
      ]);
      expect(ctx.prisma.noticeRosterRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG, status: 'PENDIENTE' },
          take: 5,
        }),
      );
    });
  });

  // ── applyRoster ────────────────────────────────────────────────────────
  describe('applyRoster', () => {
    it('404 si la petición no existe (o no es de esta organización)', async () => {
      const ctx = build({ request: null });
      await expect(
        ctx.service.applyRoster(ORG, DRIVER, {
          requestId: 'x',
          candidates: [],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('idempotente: una petición ya RESUELTA no se vuelve a aplicar', async () => {
      const ctx = build({
        request: {
          id: 'req-1',
          organizationId: ORG,
          batchId: 'batch-1',
          status: 'RESUELTA',
        },
      });

      const result = await ctx.service.applyRoster(ORG, DRIVER, {
        requestId: 'req-1',
        candidates: [CANDIDATO],
      });

      expect(result).toEqual({
        requestId: 'req-1',
        applied: 0,
        truncated: false,
      });
      expect(ctx.prisma.massNoticeRecipient.createMany).not.toHaveBeenCalled();
    });

    it('aplica candidatos válidos: reemplaza PENDIENTE, crea filas, marca RESUELTA', async () => {
      const ctx = build();

      const result = await ctx.service.applyRoster(ORG, DRIVER, {
        requestId: 'req-1',
        candidates: [CANDIDATO],
      });

      expect(result).toEqual({
        requestId: 'req-1',
        applied: 1,
        truncated: false,
      });
      expect(ctx.prisma.massNoticeRecipient.deleteMany).toHaveBeenCalledWith({
        where: { batchId: 'batch-1', outcome: 'PENDIENTE' },
      });
      expect(ctx.prisma.massNoticeRecipient.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              batchId: 'batch-1',
              patientDocument: '1037456123',
              patientName: 'Luz Elena Restrepo Gómez',
              phoneE164: '+573114567890',
              doctorExternalKey: '76',
              serviceExternalKey: '890266ESP',
              selected: true,
              previousSentAt: null,
            }),
          ],
        }),
      );
      expect(ctx.prisma.noticeRosterRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          status: 'RESUELTA',
          resolvedAt: expect.any(Date),
          truncated: false,
        },
      });
    });

    it('descarta candidatos con documento inválido o fecha ilegible', async () => {
      const ctx = build();

      const result = await ctx.service.applyRoster(ORG, DRIVER, {
        requestId: 'req-1',
        candidates: [
          { ...CANDIDATO, patientDocument: '00' },
          { ...CANDIDATO, startTimeIso: 'fecha-invalida' },
        ],
      });

      expect(result.applied).toBe(0);
      expect(ctx.prisma.massNoticeRecipient.createMany).not.toHaveBeenCalled();
    });

    it('deduplica candidatos repetidos (mismo documento y misma hora)', async () => {
      const ctx = build();

      const result = await ctx.service.applyRoster(ORG, DRIVER, {
        requestId: 'req-1',
        candidates: [CANDIDATO, { ...CANDIDATO }],
      });

      expect(result.applied).toBe(1);
    });

    it('trunca al máximo configurado y lo reporta, nunca en silencio', async () => {
      const ctx = build({
        hospitalMirrorConfig: {
          ...CONFIG_ESPEJO_ON,
          avisosMasivos: {
            enabled: true,
            fuente: 'ESPEJO',
            maxDestinatariosPorLote: 1,
          },
        },
      });
      const segundo = {
        ...CANDIDATO,
        patientDocument: '87654321',
        startTimeIso: '2026-09-24T12:20:00.000Z',
      };

      const result = await ctx.service.applyRoster(ORG, DRIVER, {
        requestId: 'req-1',
        candidates: [CANDIDATO, segundo],
      });

      expect(result.applied).toBe(1);
      expect(result.truncated).toBe(true);
    });

    it('resuelve agenIAPatientId contra PatientProfile por cédula', async () => {
      const ctx = build({
        patients: [{ id: 'patient-agenia-1', cedula: '1037456123' }],
      });

      await ctx.service.applyRoster(ORG, DRIVER, {
        requestId: 'req-1',
        candidates: [CANDIDATO],
      });

      expect(ctx.prisma.massNoticeRecipient.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({ agenIAPatientId: 'patient-agenia-1' }),
          ],
        }),
      );
    });

    it('marca "aviso previo" y NO preselecciona cuando ya hay un envío ENVIADO para esa cita', async () => {
      const ctx = build({
        previousSends: [
          {
            patientDocument: '1037456123',
            appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
            sentAt: new Date('2026-09-10T00:00:00.000Z'),
            batchId: 'batch-viejo',
          },
        ],
      });

      await ctx.service.applyRoster(ORG, DRIVER, {
        requestId: 'req-1',
        candidates: [CANDIDATO],
      });

      expect(ctx.prisma.massNoticeRecipient.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              selected: false,
              previousSentAt: new Date('2026-09-10T00:00:00.000Z'),
              previousSentBatchId: 'batch-viejo',
            }),
          ],
        }),
      );
    });

    it('un teléfono ausente o inválido del HIS deja phoneE164 en null (no rompe el lote)', async () => {
      const ctx = build();

      await ctx.service.applyRoster(ORG, DRIVER, {
        requestId: 'req-1',
        candidates: [{ ...CANDIDATO, patientPhone: '8871234' }], // fijo, no celular
      });

      expect(ctx.prisma.massNoticeRecipient.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              phoneE164: null,
              phoneIsCompanion: false,
            }),
          ],
        }),
      );
    });

    it('sin celular propio pero con teléfono de acompañante: lo usa y lo marca (§3.4/J.5, nunca en silencio)', async () => {
      const ctx = build();

      await ctx.service.applyRoster(ORG, DRIVER, {
        requestId: 'req-1',
        candidates: [
          {
            ...CANDIDATO,
            patientPhone: undefined,
            companionPhone: '3009876543',
          },
        ],
      });

      expect(ctx.prisma.massNoticeRecipient.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              phoneE164: '+573009876543',
              phoneIsCompanion: true,
            }),
          ],
        }),
      );
    });

    it('con celular propio válido, ignora el teléfono del acompañante aunque venga (no lo pisa)', async () => {
      const ctx = build();

      await ctx.service.applyRoster(ORG, DRIVER, {
        requestId: 'req-1',
        candidates: [{ ...CANDIDATO, companionPhone: '3009876543' }],
      });

      expect(ctx.prisma.massNoticeRecipient.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              phoneE164: '+573114567890',
              phoneIsCompanion: false,
            }),
          ],
        }),
      );
    });

    it('sin celular propio y sin acompañante utilizable: phoneE164 null, phoneIsCompanion false', async () => {
      const ctx = build();

      await ctx.service.applyRoster(ORG, DRIVER, {
        requestId: 'req-1',
        candidates: [
          { ...CANDIDATO, patientPhone: undefined, companionPhone: '8871234' }, // fijo, no celular
        ],
      });

      expect(ctx.prisma.massNoticeRecipient.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              phoneE164: null,
              phoneIsCompanion: false,
            }),
          ],
        }),
      );
    });

    it('si algo falla al aplicar, marca la petición ERROR con el motivo y relanza', async () => {
      const ctx = build();
      ctx.prisma.massNoticeRecipient.createMany.mockRejectedValue(
        new Error('boom'),
      );

      await expect(
        ctx.service.applyRoster(ORG, DRIVER, {
          requestId: 'req-1',
          candidates: [CANDIDATO],
        }),
      ).rejects.toThrow('boom');

      expect(ctx.prisma.noticeRosterRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1' },
          data: expect.objectContaining({ status: 'ERROR', error: 'boom' }),
        }),
      );
    });
  });

  // ── createRequest ──────────────────────────────────────────────────────
  describe('createRequest', () => {
    const INPUT = {
      batchId: 'batch-1',
      doctorExternalKey: '76',
      fromIso: '2026-09-24T00:00:00.000Z',
      toIso: '2026-09-25T00:00:00.000Z',
    };

    it('rechaza si la clínica no tiene la fuente ESPEJO habilitada', async () => {
      const ctx = build({
        hospitalMirrorConfig: {
          ...CONFIG_ESPEJO_ON,
          avisosMasivos: { enabled: true, fuente: 'CSV' },
        },
      });
      await expect(
        ctx.service.createRequest(ORG, INPUT),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza una ventana invertida o ilegible', async () => {
      const ctx = build();
      await expect(
        ctx.service.createRequest(ORG, {
          ...INPUT,
          fromIso: INPUT.toIso,
          toIso: INPUT.fromIso,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        ctx.service.createRequest(ORG, { ...INPUT, fromIso: 'no-es-fecha' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza una ventana más ancha que ventanaDiasMax — nadie cancela un año de agenda', async () => {
      const ctx = build({
        hospitalMirrorConfig: {
          ...CONFIG_ESPEJO_ON,
          avisosMasivos: { enabled: true, fuente: 'ESPEJO', ventanaDiasMax: 5 },
        },
      });
      await expect(
        ctx.service.createRequest(ORG, {
          ...INPUT,
          fromIso: '2026-09-01T00:00:00.000Z',
          toIso: '2026-10-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404 si el lote no existe (o no es de esta organización)', async () => {
      const ctx = build({ batch: null });
      await expect(
        ctx.service.createRequest(ORG, INPUT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('crea la petición y devuelve su id', async () => {
      const ctx = build();

      const result = await ctx.service.createRequest(ORG, INPUT);

      expect(result.requestId).toBe('req-nuevo');
      expect(ctx.prisma.noticeRosterRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: ORG,
            batchId: 'batch-1',
            doctorExternalKey: '76',
          }),
        }),
      );
    });
  });

  // ── getRequestStatus ───────────────────────────────────────────────────
  describe('getRequestStatus', () => {
    it('devuelve null si no existe (o pertenece a otro tenant)', async () => {
      const ctx = build({ request: null });
      const result = await ctx.service.getRequestStatus(ORG, 'req-x');
      expect(result).toBeNull();
    });

    it('devuelve status, error y truncated', async () => {
      const ctx = build({
        request: { status: 'ERROR', error: 'algo falló', truncated: false },
      });
      const result = await ctx.service.getRequestStatus(ORG, 'req-1');
      expect(result).toEqual({
        status: 'ERROR',
        error: 'algo falló',
        truncated: false,
      });
    });

    it('propaga truncated: true cuando el roster se recortó', async () => {
      const ctx = build({
        request: { status: 'RESUELTA', error: null, truncated: true },
      });
      const result = await ctx.service.getRequestStatus(ORG, 'req-1');
      expect(result).toEqual({
        status: 'RESUELTA',
        error: null,
        truncated: true,
      });
    });
  });
});
