import { MirrorEngine, translateOutboxAppointment } from './engine';
import type { MirrorApiClient } from './mirror-api-client';
import type { HisDriver } from './driver.interface';
import type { AgentStateStore } from './agent-state-store';
import type { OutboxEventDto } from '@agenia/shared';

describe('translateOutboxAppointment', () => {
  it('mapea la fila cruda de Postgres a payload canónico', () => {
    const dto: OutboxEventDto = {
      seq: '5',
      eventId: 'evt-1',
      entityType: 'APPOINTMENT',
      entityId: 'apt1',
      op: 'INSERT',
      payload: {
        id: 'apt1',
        patientId: 'pat1',
        scheduleSlotId: 'slot1',
        status: 'SCHEDULED',
      },
      createdAt: '2026-08-27T10:00:00.000Z',
    };

    const canonical = translateOutboxAppointment(dto);

    expect(canonical).toEqual({
      eventId: 'evt-1',
      entityType: 'APPOINTMENT',
      op: 'INSERT',
      occurredAtIso: '2026-08-27T10:00:00.000Z',
      payload: {
        agenIAAppointmentId: 'apt1',
        agenIAPatientId: 'pat1',
        agenIAScheduleSlotId: 'slot1',
        attendanceStatus: undefined,
      },
    });
  });

  it('si el payload no trae id, cae al entityId del outbox (nunca queda sin identidad)', () => {
    const dto: OutboxEventDto = {
      seq: '1',
      eventId: 'evt-2',
      entityType: 'APPOINTMENT',
      entityId: 'apt-fallback',
      op: 'DELETE',
      payload: {},
      createdAt: new Date().toISOString(),
    };

    const canonical = translateOutboxAppointment(dto);
    expect(canonical.payload.agenIAAppointmentId).toBe('apt-fallback');
  });
});

describe('MirrorEngine', () => {
  let api: jest.Mocked<MirrorApiClient>;
  let driver: jest.Mocked<HisDriver>;
  let state: AgentStateStore;
  let engine: MirrorEngine;

  const outboxEvent = (
    overrides: Partial<OutboxEventDto> = {},
  ): OutboxEventDto => ({
    seq: '1',
    eventId: 'evt-1',
    entityType: 'APPOINTMENT',
    entityId: 'apt1',
    op: 'INSERT',
    payload: { id: 'apt1', patientId: 'p1', scheduleSlotId: 's1' },
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    api = {
      handshake: jest.fn(),
      getPendingEvents: jest.fn(),
      ack: jest.fn(),
      pushChanges: jest.fn(),
      heartbeat: jest.fn(),
    };
    driver = {
      key: 'test-driver',
      connect: jest.fn(),
      disconnect: jest.fn(),
      healthCheck: jest.fn(),
      fetchAvailability: jest.fn(),
      detectChanges: jest.fn(),
      createAppointment: jest.fn(),
      cancelAppointment: jest.fn(),
      updateAttendance: jest.fn(),
      resolveCatalogMapping: jest.fn(),
    };

    const outboxCursor = { value: '0' };
    const driverCursor = { value: null as unknown };
    const applied = new Set<string>();
    state = {
      getOutboxCursor: () => Promise.resolve(outboxCursor.value),
      setOutboxCursor: (seq) => {
        outboxCursor.value = seq;
        return Promise.resolve();
      },
      getDriverCursor: () => Promise.resolve(driverCursor.value),
      setDriverCursor: (c) => {
        driverCursor.value = c;
        return Promise.resolve();
      },
      hasAppliedLocally: (id) => Promise.resolve(applied.has(id)),
      markAppliedLocally: (id) => {
        applied.add(id);
        return Promise.resolve();
      },
    };

    engine = new MirrorEngine(api, driver, state, '0.1.0-test');
  });

  describe('pullAndApplyOutboxEvents — despacho por op', () => {
    it('op=INSERT → driver.createAppointment', async () => {
      api.getPendingEvents.mockResolvedValueOnce([outboxEvent({ op: 'INSERT' })]);
      driver.createAppointment.mockResolvedValueOnce({ success: true });

      const result = await engine.pullAndApplyOutboxEvents();

      expect(driver.createAppointment).toHaveBeenCalledTimes(1);
      expect(driver.cancelAppointment).not.toHaveBeenCalled();
      expect(result).toEqual({ applied: 1, skippedIdempotent: 0, failed: 0 });
    });

    it('op=DELETE → driver.cancelAppointment', async () => {
      api.getPendingEvents.mockResolvedValueOnce([outboxEvent({ op: 'DELETE' })]);
      driver.cancelAppointment.mockResolvedValueOnce({ success: true });

      await engine.pullAndApplyOutboxEvents();

      expect(driver.cancelAppointment).toHaveBeenCalledTimes(1);
    });

    it('op=UPDATE → driver.updateAttendance', async () => {
      api.getPendingEvents.mockResolvedValueOnce([outboxEvent({ op: 'UPDATE' })]);
      driver.updateAttendance.mockResolvedValueOnce({ success: true });

      await engine.pullAndApplyOutboxEvents();

      expect(driver.updateAttendance).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotencia local', () => {
    it('event_id ya aplicado localmente → NO vuelve a llamar al driver, pero sí hace ack', async () => {
      api.getPendingEvents.mockResolvedValueOnce([outboxEvent({ eventId: 'evt-dup' })]);
      driver.createAppointment.mockResolvedValueOnce({ success: true });

      // Primera pasada: se aplica y se marca localmente.
      await engine.pullAndApplyOutboxEvents();
      expect(driver.createAppointment).toHaveBeenCalledTimes(1);

      // Segunda pasada: el servidor reenvía el mismo evento (ack se perdió,
      // por ejemplo) — el agente NO debe volver a tocar el HIS.
      api.getPendingEvents.mockResolvedValueOnce([outboxEvent({ eventId: 'evt-dup' })]);
      const result = await engine.pullAndApplyOutboxEvents();

      expect(driver.createAppointment).toHaveBeenCalledTimes(1); // sigue en 1
      expect(result.skippedIdempotent).toBe(1);
    });
  });

  describe('reporte de éxito/fallo al servidor', () => {
    it('éxito → va en seqs; fallo → va en failedSeqs, NUNCA se pierde en silencio', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ eventId: 'ok-1', seq: '10' }),
        outboxEvent({ eventId: 'fail-1', seq: '11' }),
      ]);
      driver.createAppointment
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, message: 'HIS lo rechazó' });

      await engine.pullAndApplyOutboxEvents();

      expect(api.ack).toHaveBeenCalledWith({
        seqs: ['10'],
        failedSeqs: ['11'],
      });
    });
  });

  describe('cursor', () => {
    it('avanza el cursor local al último seq recibido, incluso si algo falló', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ seq: '7' }),
        outboxEvent({ eventId: 'e2', seq: '8' }),
      ]);
      driver.createAppointment.mockResolvedValue({ success: true });

      await engine.pullAndApplyOutboxEvents();

      const cursor = await state.getOutboxCursor();
      expect(cursor).toBe('8');
    });
  });

  describe('entidades no soportadas todavía (Fase 2+)', () => {
    it('SLOT/DOCTOR/... → failedSeq, no intenta llamar métodos de cita del driver', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ entityType: 'SLOT', eventId: 'slot-evt' }),
      ]);

      const result = await engine.pullAndApplyOutboxEvents();

      expect(driver.createAppointment).not.toHaveBeenCalled();
      expect(result.failed).toBe(1);
    });
  });

  describe('detectAndPushChanges', () => {
    it('sin cambios detectados → no llama pushChanges, sí actualiza el cursor', async () => {
      driver.detectChanges.mockResolvedValueOnce({ events: [], nextCursor: 'c1' });

      const result = await engine.detectAndPushChanges();

      expect(api.pushChanges).not.toHaveBeenCalled();
      expect(result.pushed).toBe(0);
      expect(await state.getDriverCursor()).toBe('c1');
    });

    it('con cambios → los sube todos juntos en un solo POST', async () => {
      const events = [
        {
          eventId: 'e1',
          entityType: 'APPOINTMENT' as const,
          op: 'CANCEL' as const,
          occurredAtIso: new Date().toISOString(),
          payload: {},
        },
      ];
      driver.detectChanges.mockResolvedValueOnce({ events, nextCursor: 'c2' });

      await engine.detectAndPushChanges();

      expect(api.pushChanges).toHaveBeenCalledWith({ events });
    });
  });
});
