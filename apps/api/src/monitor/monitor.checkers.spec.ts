import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MonitorCheckers } from './monitor.checkers';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SERVICES_CONFIG } from './services.config';

// ══════════════════════════════════════════════════════════════════════════
// El checker del espejo nace de un fallo real: el 2026-08-31 el agente
// mandaba heartbeat puntual mientras fallaba el 100 % de sus eventos.
// `lastHeartbeatAt` al día, SyncOutbox atascado, el hospital sin ver una sola
// cita — y el panel en verde. "El agente respira" y "el agente sincroniza"
// son cosas distintas y el monitor solo miraba la primera.
// ══════════════════════════════════════════════════════════════════════════
describe('MonitorCheckers — espejo con el HIS', () => {
  let checkers: MonitorCheckers;
  let prisma: any;

  const svc = SERVICES_CONFIG.find((s) => s.key === 'mirror')!;
  const AHORA = Date.now();
  const haceMinutos = (m: number) => new Date(AHORA - m * 60_000);

  const conEstado = (opts: {
    configs?: any[];
    deadLetters?: number;
    pendienteDesde?: Date | null;
  }) => {
    prisma.hospitalMirrorConfig.findMany.mockResolvedValue(
      opts.configs ?? [
        { organizationId: 'org1', lastHeartbeatAt: haceMinutos(1) },
      ],
    );
    prisma.syncOutbox.count.mockResolvedValue(opts.deadLetters ?? 0);
    prisma.syncOutbox.findFirst.mockResolvedValue(
      opts.pendienteDesde === undefined || opts.pendienteDesde === null
        ? null
        : { createdAt: opts.pendienteDesde, eventId: 'e1' },
    );
  };

  beforeEach(async () => {
    prisma = {
      hospitalMirrorConfig: { findMany: jest.fn(() => []) },
      syncOutbox: {
        count: jest.fn(() => 0),
        findFirst: jest.fn(() => null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitorCheckers,
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
        { provide: IntegrationsService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    checkers = module.get(MonitorCheckers);
  });

  it('el servicio "mirror" está registrado y activo', () => {
    expect(svc).toBeDefined();
    expect(svc.enabled).toBe(true);
  });

  it('sin organizaciones con espejo, no aplica (ni verde ni rojo)', async () => {
    conEstado({ configs: [] });

    const r = await checkers.checkService(svc);

    expect(r.skip).toBe(true);
  });

  it('todo al día → UP', async () => {
    conEstado({});

    const r = await checkers.checkService(svc);

    expect(r.status).toBe('UP');
    expect(r.errorMessage).toBeNull();
  });

  // 🚨 El caso que el panel mostraba en verde.
  it('heartbeat puntual pero eventos en dead-letter → DOWN', async () => {
    conEstado({ deadLetters: 3 });

    const r = await checkers.checkService(svc);

    expect(r.status).toBe('DOWN');
    expect(r.errorMessage).toContain('dead-letter');
    expect(r.errorMessage).toContain('el hospital NO los tiene');
  });

  it('la cola no avanza → DEGRADED', async () => {
    conEstado({ pendienteDesde: haceMinutos(30) });

    const r = await checkers.checkService(svc);

    expect(r.status).toBe('DEGRADED');
    expect(r.errorMessage).toContain('no avanza');
  });

  it('un evento pendiente RECIENTE no alarma: la cola respira', async () => {
    conEstado({ pendienteDesde: haceMinutos(2) });

    expect((await checkers.checkService(svc)).status).toBe('UP');
  });

  it('sin heartbeat reciente → DOWN: el agente no está corriendo', async () => {
    conEstado({
      configs: [{ organizationId: 'org1', lastHeartbeatAt: haceMinutos(60) }],
    });

    const r = await checkers.checkService(svc);

    expect(r.status).toBe('DOWN');
    expect(r.errorMessage).toContain('Sin heartbeat');
  });

  it('un agente que nunca hizo handshake se nombra distinto', async () => {
    conEstado({ configs: [{ organizationId: 'org1', lastHeartbeatAt: null }] });

    const r = await checkers.checkService(svc);

    expect(r.status).toBe('DOWN');
    expect(r.errorMessage).toContain('nunca ha hecho handshake');
  });

  it('el dead-letter pesa más que una cola lenta', async () => {
    conEstado({ deadLetters: 1, pendienteDesde: haceMinutos(30) });

    // DEGRADED no puede tapar un DOWN.
    expect((await checkers.checkService(svc)).status).toBe('DOWN');
  });

  it('acumula los problemas de todas las organizaciones', async () => {
    prisma.hospitalMirrorConfig.findMany.mockResolvedValue([
      { organizationId: 'org1', lastHeartbeatAt: haceMinutos(1) },
      { organizationId: 'org2', lastHeartbeatAt: haceMinutos(90) },
    ]);
    prisma.syncOutbox.count.mockResolvedValue(0);
    prisma.syncOutbox.findFirst.mockResolvedValue(null);

    const r = await checkers.checkService(svc);

    expect(r.status).toBe('DOWN');
    expect(r.errorMessage).toContain('org2');
    expect(r.errorMessage).not.toContain('org1');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Los otros tres checkers (Gemini, Meta, TTS) + el despacho y el timeout.
// Comparten una regla dura: `checkService` NUNCA lanza. Si lanzara, se llevaría
// por delante el tick del cron o la respuesta del endpoint en vivo.
// ══════════════════════════════════════════════════════════════════════════
describe('MonitorCheckers — Gemini, Meta, TTS y el despacho', () => {
  let checkers: MonitorCheckers;
  let prisma: any;
  let integrations: { diagnoseGemini: jest.Mock; diagnoseMeta: jest.Mock };
  let config: { get: jest.Mock };
  let listVoices: jest.Mock;

  const svc = (key: string, timeoutMs = 5000) =>
    ({
      key,
      displayName: key,
      group: 'google',
      enabled: true,
      timeoutMs,
    }) as never;

  beforeEach(async () => {
    prisma = {
      hospitalMirrorConfig: { findMany: jest.fn(async () => []) },
      syncOutbox: {
        count: jest.fn(async () => 0),
        findFirst: jest.fn(async () => null),
      },
      organization: { findFirst: jest.fn(async () => ({ id: 'org-testigo' })) },
    };
    integrations = {
      diagnoseGemini: jest.fn(async () => ({ success: true, rtt_ms: 120 })),
      diagnoseMeta: jest.fn(async () => ({ success: true, rtt_ms: 90 })),
    };
    config = { get: jest.fn(() => undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitorCheckers,
        { provide: ConfigService, useValue: config },
        { provide: IntegrationsService, useValue: integrations },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    checkers = module.get(MonitorCheckers);
    jest.spyOn((checkers as any).logger, 'warn').mockImplementation(() => {});

    listVoices = jest.fn(async () => [{ voices: [] }]);
    (checkers as any).ttsClient = { listVoices };
  });

  describe('organización testigo', () => {
    it('Gemini y Meta se validan contra la organización activa más antigua', async () => {
      await checkers.checkService(svc('gemini'));

      expect(prisma.organization.findFirst).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      expect(integrations.diagnoseGemini).toHaveBeenCalledWith('org-testigo');
    });

    it('sin ninguna organización activa el check se OMITE, no se marca en rojo', async () => {
      prisma.organization.findFirst.mockResolvedValue(null);

      const r = await checkers.checkService(svc('meta'));

      expect(r).toMatchObject({
        skip: true,
        errorCode: 'NO_ORG',
        status: 'UP',
      });
      expect(integrations.diagnoseMeta).not.toHaveBeenCalled();
    });

    it('si la consulta de la organización falla, se omite en vez de reventar', async () => {
      prisma.organization.findFirst.mockRejectedValue(new Error('BD caída'));

      const r = await checkers.checkService(svc('gemini'));
      expect(r.skip).toBe(true);
    });
  });

  describe('graduación por latencia', () => {
    it('rápido → UP', async () => {
      const r = await checkers.checkService(svc('gemini'));
      expect(r).toMatchObject({
        status: 'UP',
        latencyMs: 120,
        httpStatus: 200,
      });
      expect(r.errorCode).toBeNull();
    });

    it('lento pero vivo → DEGRADED, con el umbral en el mensaje', async () => {
      integrations.diagnoseGemini.mockResolvedValue({
        success: true,
        rtt_ms: 4500,
      });

      const r = await checkers.checkService(svc('gemini'));

      expect(r.status).toBe('DEGRADED');
      expect(r.errorCode).toBe('HIGH_LATENCY');
      expect(r.errorMessage).toContain('3000ms');
    });

    it('el umbral se puede mover por .env', async () => {
      config.get.mockImplementation((k: string) =>
        k === 'MONITOR_DEGRADED_THRESHOLD_MS' ? '100' : undefined,
      );
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MonitorCheckers,
          { provide: ConfigService, useValue: config },
          { provide: IntegrationsService, useValue: integrations },
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      const otro = module.get(MonitorCheckers);

      await expect(otro.checkService(svc('gemini'))).resolves.toMatchObject({
        status: 'DEGRADED',
      });
    });
  });

  describe('fallos del diagnóstico', () => {
    it('Gemini caído se reporta DOWN conservando código y mensaje', async () => {
      integrations.diagnoseGemini.mockResolvedValue({
        success: false,
        error_code: 'AUTH',
        error_message: 'API key inválida',
        rtt_ms: 80,
      });

      await expect(checkers.checkService(svc('gemini'))).resolves.toEqual({
        status: 'DOWN',
        latencyMs: 80,
        errorCode: 'AUTH',
        errorMessage: 'API key inválida',
      });
    });

    it('Meta caído igual', async () => {
      integrations.diagnoseMeta.mockResolvedValue({
        success: false,
        error_code: 'TIMEOUT',
        error_message: 'no respondió',
      });

      await expect(checkers.checkService(svc('meta'))).resolves.toMatchObject({
        status: 'DOWN',
        errorCode: 'TIMEOUT',
        latencyMs: null,
      });
    });
  });

  describe('Google Cloud TTS', () => {
    it('el check es liviano: lista voces, no sintetiza (no gasta cuota)', async () => {
      const r = await checkers.checkService(svc('tts'));

      expect(listVoices).toHaveBeenCalledWith({ languageCode: 'es-US' });
      expect(r.status).toBe('UP');
    });

    it.each([
      ['permission denied', 'AUTH'],
      ['could not load the default credentials', 'AUTH'],
      ['UNAUTHENTICATED', 'AUTH'],
      ['Deadline exceeded', 'TIMEOUT'],
      ['request timeout', 'TIMEOUT'],
      ['algo raro pasó', 'UNKNOWN'],
    ])('«%s» se clasifica como %s', async (mensaje, codigo) => {
      listVoices.mockRejectedValue(new Error(mensaje));

      await expect(checkers.checkService(svc('tts'))).resolves.toMatchObject({
        status: 'DOWN',
        errorCode: codigo,
      });
    });

    it('el campo `details` de gRPC también se lee', async () => {
      listVoices.mockRejectedValue({ details: 'PERMISSION_DENIED' });

      await expect(checkers.checkService(svc('tts'))).resolves.toMatchObject({
        errorCode: 'AUTH',
        errorMessage: 'PERMISSION_DENIED',
      });
    });
  });

  describe('despacho y blindaje', () => {
    it('un servicio sin checker se reporta explícito, no en verde por omisión', async () => {
      await expect(
        checkers.checkService(svc('servicio-inventado')),
      ).resolves.toMatchObject({
        status: 'DOWN',
        errorCode: 'NO_CHECKER',
      });
    });

    it('🛡️ un checker que revienta NO propaga: se devuelve DOWN', async () => {
      integrations.diagnoseGemini.mockRejectedValue(new Error('boom'));

      await expect(checkers.checkService(svc('gemini'))).resolves.toMatchObject(
        {
          status: 'DOWN',
          errorCode: 'UNKNOWN',
          errorMessage: 'boom',
        },
      );
    });

    it('un checker que se cuelga se corta por timeout y lo dice', async () => {
      integrations.diagnoseGemini.mockImplementation(
        () => new Promise(() => undefined),
      );

      await expect(
        checkers.checkService(svc('gemini', 20)),
      ).resolves.toMatchObject({
        status: 'DOWN',
        errorCode: 'TIMEOUT',
        errorMessage: expect.stringContaining('20ms'),
      });
    });
  });
});
