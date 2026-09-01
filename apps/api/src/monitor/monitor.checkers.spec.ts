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
      hospitalMirrorConfig: { findMany: jest.fn(async () => []) },
      syncOutbox: {
        count: jest.fn(async () => 0),
        findFirst: jest.fn(async () => null),
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
