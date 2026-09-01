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
      // `objectContaining` en vez de igualdad exacta: el contexto que el
      // servidor resuelve (hora, médico, servicio, cupo anterior) crece con
      // cada driver nuevo, y fijar la forma completa aquí obliga a tocar este
      // test cada vez sin que aporte nada. Lo que importa es la identidad.
      payload: expect.objectContaining({
        agenIAAppointmentId: 'apt1',
        agenIAPatientId: 'pat1',
        agenIAScheduleSlotId: 'slot1',
        status: 'SCHEDULED',
      }),
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
      reconcile: jest.fn(),
      uploadAvailability: jest.fn(),
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
      rescheduleAppointment: jest.fn(),
      updateAttendance: jest.fn(),
      snapshotAppointments: jest.fn(),
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
      expect(result).toEqual({
        applied: 1,
        skippedIdempotent: 0,
        skippedUnsupported: 0,
        failed: 0,
        failures: [],
      });
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
        skippedSeqs: [],
      });
    });
  });

  // ⚠️ El bloque que faltaba. TODOS los mocks de driver de este archivo usan
  // `mockResolvedValue`, es decir, drivers que DEVUELVEN un resultado. El
  // único driver real del repo hace lo contrario: LANZA, porque sus métodos
  // de escritura siguen sin implementar. Por eso los 11 tests de este archivo
  // pasaban en verde mientras el camino real fallaba el 100% de las veces.
  describe('el driver LANZA en vez de devolver {success:false}', () => {
    it('no aborta el lote: se hace ack igual y el seq va en failedSeqs', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ eventId: 'boom-1', seq: '20' }),
      ]);
      driver.createAppointment.mockRejectedValueOnce(
        new Error('createAppointment: pendiente de Fase 3'),
      );

      const result = await engine.pullAndApplyOutboxEvents();

      // Lo crítico: el ack SÍ ocurre. Sin él el servidor nunca sube `attempts`,
      // el evento no llega jamás a dead-letter y no se dispara ninguna alerta.
      expect(api.ack).toHaveBeenCalledWith({ seqs: [], failedSeqs: ['20'], skippedSeqs: [] });
      expect(result.failed).toBe(1);
      expect(result.applied).toBe(0);
    });

    it('reporta el motivo y marca que fue una excepción, no un rechazo', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ eventId: 'boom-2', seq: '21' }),
      ]);
      driver.createAppointment.mockRejectedValueOnce(
        new Error('el HIS cerró la conexión'),
      );

      const { failures } = await engine.pullAndApplyOutboxEvents();

      expect(failures).toEqual([
        {
          seq: '21',
          eventId: 'boom-2',
          message: 'el HIS cerró la conexión',
          threw: true,
        },
      ]);
    });

    it('un evento que revienta NO impide que los siguientes se apliquen', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ eventId: 'boom-3', seq: '30' }),
        outboxEvent({ eventId: 'ok-3', seq: '31' }),
      ]);
      driver.createAppointment
        .mockRejectedValueOnce(new Error('revienta'))
        .mockResolvedValueOnce({ success: true });

      const result = await engine.pullAndApplyOutboxEvents();

      // Capa 3 del plan §6: un evento que falla bloquea solo su entidad.
      expect(result.applied).toBe(1);
      expect(result.failed).toBe(1);
      expect(api.ack).toHaveBeenCalledWith({
        seqs: ['31'],
        failedSeqs: ['30'],
        skippedSeqs: [],
      });
    });

    it('el evento que lanzó NO se marca aplicado localmente: se reintenta', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ eventId: 'boom-4', seq: '40' }),
      ]);
      driver.createAppointment.mockRejectedValueOnce(new Error('revienta'));
      await engine.pullAndApplyOutboxEvents();

      // Segunda pasada: el servidor lo reenvía y el driver ya funciona.
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ eventId: 'boom-4', seq: '40' }),
      ]);
      driver.createAppointment.mockResolvedValueOnce({ success: true });
      const segunda = await engine.pullAndApplyOutboxEvents();

      expect(segunda.applied).toBe(1);
      expect(segunda.skippedIdempotent).toBe(0);
    });

    it('el cursor avanza aunque todo el lote haya reventado', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ eventId: 'b1', seq: '50' }),
        outboxEvent({ eventId: 'b2', seq: '51' }),
      ]);
      driver.createAppointment.mockRejectedValue(new Error('revienta'));

      await engine.pullAndApplyOutboxEvents();

      expect(await state.getOutboxCursor()).toBe('51');
    });

    it('un rechazo normal se distingue de una excepción', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ eventId: 'rechazo', seq: '60' }),
      ]);
      driver.createAppointment.mockResolvedValueOnce({
        success: false,
        message: 'violación de PK: el cupo ya está ocupado',
      });

      const { failures } = await engine.pullAndApplyOutboxEvents();

      expect(failures[0].threw).toBeUndefined();
      expect(failures[0].message).toBe(
        'violación de PK: el cupo ya está ocupado',
      );
    });
  });

  // 🛑 D3: nunca una escritura a medias en el HIS. Si el servidor entrega un
  // evento cuya homologación está incompleta, el motor lo rechaza SIN llamar
  // al driver — una cita sin código de médico en la agenda del hospital es
  // peor que una cita que no llegó.
  describe('homologación incompleta', () => {
    it('NO llama al driver cuando faltan claves del HIS', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({
          seq: '70',
          context: { missingMappings: ['DOCTOR doc-abc'] },
        }),
      ]);

      const result = await engine.pullAndApplyOutboxEvents();

      expect(driver.createAppointment).not.toHaveBeenCalled();
      expect(driver.cancelAppointment).not.toHaveBeenCalled();
      expect(driver.updateAttendance).not.toHaveBeenCalled();
      expect(result.failed).toBe(1);
    });

    it('el motivo dice qué falta y dónde arreglarlo', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({
          seq: '71',
          context: { missingMappings: ['DOCTOR doc-abc', 'SERVICE svc-xyz'] },
        }),
      ]);

      const { failures } = await engine.pullAndApplyOutboxEvents();

      expect(failures[0].message).toContain('DOCTOR doc-abc');
      expect(failures[0].message).toContain('SERVICE svc-xyz');
      expect(failures[0].message).toContain('MirrorEntityMap');
      // No es una excepción: es un rechazo deliberado y ordenado.
      expect(failures[0].threw).toBeUndefined();
    });

    it('se reporta como failedSeq: entra al backoff y acaba en dead-letter', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ seq: '72', context: { missingMappings: ['DOCTOR d1'] } }),
      ]);

      await engine.pullAndApplyOutboxEvents();

      expect(api.ack).toHaveBeenCalledWith({ seqs: [], failedSeqs: ['72'], skippedSeqs: [] });
    });

    it('missingMappings vacío no bloquea nada', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ seq: '73', context: { missingMappings: [] } }),
      ]);
      driver.createAppointment.mockResolvedValueOnce({ success: true });

      const result = await engine.pullAndApplyOutboxEvents();

      expect(driver.createAppointment).toHaveBeenCalledTimes(1);
      expect(result.applied).toBe(1);
    });

    it('el driver recibe las claves del HIS ya resueltas', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({
          seq: '74',
          context: {
            doctorExternalKey: '76',
            serviceExternalKey: 'S39141-1',
            startTimeIso: '2026-09-03T12:20:00.000Z',
            patientDocument: '9696544',
          },
        }),
      ]);
      driver.createAppointment.mockResolvedValueOnce({ success: true });

      await engine.pullAndApplyOutboxEvents();

      const recibido = driver.createAppointment.mock.calls[0][0];
      expect(recibido.payload.doctorExternalKey).toBe('76');
      expect(recibido.payload.serviceExternalKey).toBe('S39141-1');
      expect(recibido.payload.startTimeIso).toBe('2026-09-03T12:20:00.000Z');
      expect(recibido.payload.patientDocument).toBe('9696544');
    });
  });

  // ⚠️ DEFECTO 11. AgenIA modela la CANCELACIÓN como un cambio de estado, no
  // como un DELETE de la fila: `status = 'CANCELLED'`. El motor enrutaba todo
  // UPDATE a `updateAttendance`, así que una cancelación por WhatsApp llegaba
  // al hospital como una actualización de asistencia — el hospital nunca se
  // enteraba y el cupo seguía vendido en su agenda.
  describe('UPDATE no es una sola cosa', () => {
    const conPayload = (payload: Record<string, unknown>, ctx = {}) =>
      outboxEvent({
        seq: '90',
        op: 'UPDATE',
        payload,
        context: ctx,
      });

    it('estado CANCELLED → cancelAppointment, NO updateAttendance', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        conPayload({ id: 'apt1', status: 'CANCELLED' }),
      ]);
      driver.cancelAppointment.mockResolvedValueOnce({ success: true });

      await engine.pullAndApplyOutboxEvents();

      expect(driver.cancelAppointment).toHaveBeenCalledTimes(1);
      expect(driver.updateAttendance).not.toHaveBeenCalled();
    });

    it('la cancelación viaja con op CANONICAL "CANCEL"', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        conPayload({ id: 'apt1', status: 'CANCELLED' }),
      ]);
      driver.cancelAppointment.mockResolvedValueOnce({ success: true });

      await engine.pullAndApplyOutboxEvents();

      expect(driver.cancelAppointment.mock.calls[0][0].op).toBe('CANCEL');
    });

    it('el cupo cambió → rescheduleAppointment', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        conPayload(
          { id: 'apt1', status: 'SCHEDULED' },
          {
            startTimeIso: '2026-09-03T13:00:00.000Z',
            previousStartTimeIso: '2026-09-03T12:00:00.000Z',
            previousDoctorExternalKey: '76',
          },
        ),
      ]);
      driver.rescheduleAppointment.mockResolvedValueOnce({ success: true });

      await engine.pullAndApplyOutboxEvents();

      expect(driver.rescheduleAppointment).toHaveBeenCalledTimes(1);
      expect(driver.cancelAppointment).not.toHaveBeenCalled();
      expect(driver.createAppointment).not.toHaveBeenCalled();
    });

    it('el cupo NO cambió → es asistencia, no reagendamiento', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        conPayload(
          { id: 'apt1', status: 'SCHEDULED', attendanceStatus: 'ATTENDED' },
          {
            startTimeIso: '2026-09-03T12:00:00.000Z',
            previousStartTimeIso: '2026-09-03T12:00:00.000Z',
          },
        ),
      ]);
      driver.updateAttendance.mockResolvedValueOnce({ success: true });

      await engine.pullAndApplyOutboxEvents();

      expect(driver.updateAttendance).toHaveBeenCalledTimes(1);
      expect(driver.rescheduleAppointment).not.toHaveBeenCalled();
    });

    it('una cancelación gana sobre un cambio de cupo simultáneo', async () => {
      // Estado terminal: si la cita quedó cancelada, da igual a qué cupo
      // apuntara. Reagendar una cita cancelada dejaría un cupo vendido.
      api.getPendingEvents.mockResolvedValueOnce([
        conPayload(
          { id: 'apt1', status: 'CANCELLED' },
          {
            startTimeIso: '2026-09-03T13:00:00.000Z',
            previousStartTimeIso: '2026-09-03T12:00:00.000Z',
          },
        ),
      ]);
      driver.cancelAppointment.mockResolvedValueOnce({ success: true });

      await engine.pullAndApplyOutboxEvents();

      expect(driver.cancelAppointment).toHaveBeenCalledTimes(1);
      expect(driver.rescheduleAppointment).not.toHaveBeenCalled();
    });

    it('un DELETE físico también es una cancelación para el HIS', async () => {
      api.getPendingEvents.mockResolvedValueOnce([
        outboxEvent({ seq: '91', op: 'DELETE' }),
      ]);
      driver.cancelAppointment.mockResolvedValueOnce({ success: true });

      await engine.pullAndApplyOutboxEvents();

      expect(driver.cancelAppointment).toHaveBeenCalledTimes(1);
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

  // ════════════════════════════════════════════════════════════════════════
  // Descubierto corriendo el agente en la VM simulada: cada reserva de cita
  // genera TAMBIÉN un evento SLOT (el cupo pasa a ocupado) y este driver no
  // espeja SLOT. Como fallo, cada uno quemaba sus diez intentos hasta
  // dead-letter: a la décima cita el monitor quedaba en DOWN permanente por
  // una decisión de diseño. Una alerta siempre en rojo no es una alerta.
  // ════════════════════════════════════════════════════════════════════════
  describe('entidades no soportadas todavía (Fase 2+)', () => {
    const eventoSlot = () =>
      outboxEvent({ entityType: 'SLOT', eventId: 'slot-evt', seq: '7' });

    it('SLOT/DOCTOR/... no llega a los métodos de cita del driver', async () => {
      api.getPendingEvents.mockResolvedValueOnce([eventoSlot()]);

      await engine.pullAndApplyOutboxEvents();

      expect(driver.createAppointment).not.toHaveBeenCalled();
    });

    it('NO cuenta como fallo: reintentarlo daría siempre lo mismo', async () => {
      api.getPendingEvents.mockResolvedValueOnce([eventoSlot()]);

      const result = await engine.pullAndApplyOutboxEvents();

      expect(result.failed).toBe(0);
      expect(result.skippedUnsupported).toBe(1);
    });

    it('se reporta como skippedSeq, no como failedSeq', async () => {
      api.getPendingEvents.mockResolvedValueOnce([eventoSlot()]);

      await engine.pullAndApplyOutboxEvents();

      expect(api.ack).toHaveBeenCalledWith({
        seqs: [],
        failedSeqs: [],
        skippedSeqs: ['7'],
      });
    });

    it('un fallo de verdad sigue yendo por failedSeqs', async () => {
      // El riesgo del cambio anterior es tapar errores reales como "saltados".
      driver.createAppointment.mockResolvedValueOnce({
        success: false,
        message: 'el HIS rechazó la fila',
      });
      api.getPendingEvents.mockResolvedValueOnce([outboxEvent({ seq: '8' })]);

      const result = await engine.pullAndApplyOutboxEvents();

      expect(result.failed).toBe(1);
      expect(result.skippedUnsupported).toBe(0);
      expect(api.ack).toHaveBeenCalledWith(
        expect.objectContaining({ failedSeqs: ['8'], skippedSeqs: [] }),
      );
    });

    it('una cita entre eventos SLOT sí se aplica', async () => {
      // Un tipo saltado no puede frenar la cola de los que sí importan.
      driver.createAppointment.mockResolvedValue({ success: true });
      api.getPendingEvents.mockResolvedValueOnce([
        eventoSlot(),
        outboxEvent({ seq: '9', eventId: 'cita-evt' }),
      ]);

      const result = await engine.pullAndApplyOutboxEvents();

      expect(driver.createAppointment).toHaveBeenCalledTimes(1);
      expect(result.applied).toBe(1);
      expect(result.skippedUnsupported).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // La capa 5 del plan §6 existía a medias: el endpoint estaba en el servidor
  // y NADIE lo llamaba. La única defensa contra la deriva silenciosa no corría
  // nunca. Se vio en la VM simulada: una cita agendada por ventanilla mientras
  // el agente estaba caído quedó fuera de AgenIA y ningún mecanismo la
  // encontraba.
  // ════════════════════════════════════════════════════════════════════════
  describe('reconcile', () => {
    const ventana = {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-12-01T00:00:00.000Z'),
    };

    it('sube al servidor la instantánea que da el driver', async () => {
      driver.snapshotAppointments.mockResolvedValue([
        { doctorExternalKey: '76', startTimeIso: '2026-09-03T13:20:00.000Z' },
      ]);
      api.reconcile.mockResolvedValue({
        inAgenIA: 1, inHis: 1, missingInHis: [], missingInAgenIA: [], inSync: true,
      });

      await engine.reconcile(ventana);

      expect(api.reconcile).toHaveBeenCalledWith({
        fromIso: '2026-09-01T00:00:00.000Z',
        toIso: '2026-12-01T00:00:00.000Z',
        appointments: [
          { doctorExternalKey: '76', startTimeIso: '2026-09-03T13:20:00.000Z' },
        ],
      });
    });

    it('le pasa al driver la misma ventana que reporta al servidor', async () => {
      driver.snapshotAppointments.mockResolvedValue([]);
      api.reconcile.mockResolvedValue({
        inAgenIA: 0, inHis: 0, missingInHis: [], missingInAgenIA: [], inSync: true,
      });

      await engine.reconcile(ventana);

      expect(driver.snapshotAppointments).toHaveBeenCalledWith(ventana);
    });

    it('devuelve el veredicto del servidor tal cual', async () => {
      driver.snapshotAppointments.mockResolvedValue([]);
      api.reconcile.mockResolvedValue({
        inAgenIA: 3, inHis: 2, missingInHis: ['76|x'], missingInAgenIA: [], inSync: false,
      });

      const r = await engine.reconcile(ventana);

      expect(r.inSync).toBe(false);
      expect(r.missingInHis).toEqual(['76|x']);
    });

    it('un HIS inalcanzable propaga el error: no se reporta un falso "todo bien"', async () => {
      driver.snapshotAppointments.mockRejectedValue(new Error('SQL caído'));

      await expect(engine.reconcile(ventana)).rejects.toThrow('SQL caído');
      expect(api.reconcile).not.toHaveBeenCalled();
    });
  });

  describe('syncAvailability — Fase 2', () => {
    const ventana = {
      from: new Date('2026-09-03T00:00:00.000Z'),
      to: new Date('2026-09-04T00:00:00.000Z'),
    };
    const respuesta = {
      mode: 'ON' as const,
      created: 1,
      updated: 0,
      removed: 0,
      skipped: [],
      conflicts: [],
    };

    it('sube la rejilla que calculó el driver, con la ventana', async () => {
      driver.fetchAvailability.mockResolvedValue([
        {
          doctorExternalKey: '91-1',
          startTimeIso: '2026-09-03T12:00:00.000Z',
          endTimeIso: '2026-09-03T12:20:00.000Z',
          occupied: false,
        },
      ]);
      api.uploadAvailability.mockResolvedValue(respuesta);

      await engine.syncAvailability(ventana);

      expect(api.uploadAvailability).toHaveBeenCalledWith({
        fromIso: '2026-09-03T00:00:00.000Z',
        toIso: '2026-09-04T00:00:00.000Z',
        slots: [
          {
            doctorExternalKey: '91-1',
            startTimeIso: '2026-09-03T12:00:00.000Z',
            endTimeIso: '2026-09-03T12:20:00.000Z',
            occupied: false,
          },
        ],
      });
    });

    it('un día sin turnos se sube VACÍO, no se omite', async () => {
      // "Ese día el médico no atiende" es información: si no se envía, el
      // servidor no puede borrar los cupos que sobraron de antes.
      driver.fetchAvailability.mockResolvedValue([]);
      api.uploadAvailability.mockResolvedValue({ ...respuesta, created: 0 });

      await engine.syncAvailability(ventana);

      expect(api.uploadAvailability).toHaveBeenCalledWith(
        expect.objectContaining({ slots: [] }),
      );
    });

    it('`occupied` ausente cuenta como libre, nunca como indefinido', async () => {
      driver.fetchAvailability.mockResolvedValue([
        {
          doctorExternalKey: '91-1',
          startTimeIso: '2026-09-03T12:00:00.000Z',
          endTimeIso: '2026-09-03T12:20:00.000Z',
        },
      ]);
      api.uploadAvailability.mockResolvedValue(respuesta);

      await engine.syncAvailability(ventana);

      expect(api.uploadAvailability.mock.calls[0][0].slots[0].occupied).toBe(false);
    });

    it('si el HIS no responde, no se sube una agenda vacía', async () => {
      // Subir [] tras un fallo borraría la agenda entera de ese día.
      driver.fetchAvailability.mockRejectedValue(new Error('SQL caído'));

      await expect(engine.syncAvailability(ventana)).rejects.toThrow('SQL caído');
      expect(api.uploadAvailability).not.toHaveBeenCalled();
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
