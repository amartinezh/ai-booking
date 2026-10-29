import { Test, TestingModule } from '@nestjs/testing';
import { MirrorDispatchService, backoffMs } from './mirror-dispatch.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MirrorDispatchService', () => {
  let service: MirrorDispatchService;
  let prisma: {
    hospitalMirrorConfig: {
      findUniqueOrThrow: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    organizationSettings: { findUnique: jest.Mock };
    syncOutbox: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    // Modelos que consulta la hidratación (bloque D).
    scheduleSlot: { findMany: jest.Mock };
    patientProfile: { findMany: jest.Mock };
    eps: { findMany: jest.Mock };
    mirrorEntityMap: { findMany: jest.Mock };
    syncAudit: {
      create: jest.Mock;
      createMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      hospitalMirrorConfig: {
        findUniqueOrThrow: jest.fn(() =>
          Promise.resolve({
            mappingVersion: 1,
            mappingJson: null,
            pushEnabled: true,
            pullEnabled: true,
          }),
        ),
        // El interruptor de envío al hospital, que el long-poll consulta en cada vuelta.
        findUnique: jest.fn(() => Promise.resolve({ pushEnabled: true })),
        update: jest.fn(() => Promise.resolve({})),
      },
      // «Agendar», «Cancelar» y «Cambiar fecha» (una compuerta por operación):
      // encendidas, salvo donde la prueba diga otra cosa.
      organizationSettings: {
        findUnique: jest.fn(async () => ({
          bookingEnabled: true as boolean,
          cancelEnabled: true as boolean,
          rescheduleEnabled: true as boolean,
        })),
      },
      syncOutbox: {
        findMany: jest.fn(() => Promise.resolve([])),
        findFirst: jest.fn(),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        update: jest.fn(),
      },
      // Modelos que consulta la hidratación (bloque D).
      scheduleSlot: { findMany: jest.fn(() => Promise.resolve([])) },
      patientProfile: { findMany: jest.fn(() => Promise.resolve([])) },
      eps: { findMany: jest.fn(() => Promise.resolve([])) },
      mirrorEntityMap: { findMany: jest.fn(() => Promise.resolve([])) },
      syncAudit: {
        create: jest.fn(() => Promise.resolve({})),
        createMany: jest.fn(() => Promise.resolve({ count: 0 })),
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorDispatchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MirrorDispatchService>(MirrorDispatchService);
    // Ventanas de long-poll cortas — el default de producción (25s) haría
    // estos tests lentísimos y frágiles. Ver el comentario en el servicio.
    (service as unknown as { longPollMs: number }).longPollMs = 30;
    (service as unknown as { longPollIntervalMs: number }).longPollIntervalMs =
      10;
  });

  describe('getPendingEvents — orden', () => {
    it('devuelve inmediatamente si ya hay eventos pendientes, ordenados por seq asc', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        {
          seq: BigInt(5),
          eventId: 'e5',
          entityType: 'APPOINTMENT',
          entityId: 'x',
          op: 'INSERT',
          payload: {},
          createdAt: new Date(),
        },
      ]);

      const result = await service.getPendingEvents('org1', BigInt(0));

      expect(result).toHaveLength(1);
      expect(result[0].seq).toBe('5'); // BigInt serializado como string
      expect(prisma.syncOutbox.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { seq: 'asc' } }),
      );
    });

    it('filtra por deliveredAt=null y deadLettered=false — nunca reentrega lo ya entregado', async () => {
      // mockResolvedValue (no "Once"): el long-poll puede reintentar más de
      // una vez dentro de la ventana corta de 30ms antes de rendirse.
      prisma.syncOutbox.findMany.mockResolvedValue([]);

      await service.getPendingEvents('org1', BigInt(0));

      const where = prisma.syncOutbox.findMany.mock.calls[0][0].where;
      expect(where.deliveredAt).toBeNull();
      expect(where.deadLettered).toBe(false);
      expect(where.organizationId).toBe('org1');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🚪 Un interruptor por operación (2026-10-15): «Agendar», «Cancelar» y
  // «Cambiar fecha» de Configuración. Lo que no es ninguna de las tres
  // (cupos, asistencia, EPS, el borrado de una cita) no va nunca al hospital:
  // la API lo cierra sin entregarlo, para que no quede nada en la cola.
  // ══════════════════════════════════════════════════════════════════════
  describe('getPendingEvents — un interruptor por operación', () => {
    const fila = (
      seq: number,
      entityId: string,
      op: string,
      payload: Record<string, unknown> = {},
      entityType = 'APPOINTMENT',
    ) => ({
      seq: BigInt(seq),
      eventId: `e${seq}`,
      entityType,
      entityId,
      op,
      payload,
      createdAt: new Date(),
      nextAttemptAt: null,
    });
    const alta = (seq: number, id: string) => fila(seq, id, 'INSERT');
    const cancelacion = (seq: number, id: string) =>
      fila(seq, id, 'UPDATE', { status: 'CANCELLED', scheduleSlotId: 's1' });
    const cambio = (seq: number, id: string) =>
      fila(seq, id, 'UPDATE', {
        status: 'SCHEDULED',
        scheduleSlotId: 's2',
        __old: { scheduleSlotId: 's1' },
      });
    const interruptores = (
      agendar: boolean | null,
      cancelar: boolean | null,
      cambiar: boolean | null,
    ) =>
      prisma.organizationSettings.findUnique.mockResolvedValue({
        bookingEnabled: agendar,
        cancelEnabled: cancelar,
        rescheduleEnabled: cambiar,
      });
    const seqs = (r: { seq: string }[]) => r.map((e) => e.seq);
    /** Los seq que la API cerró sin entregar (lo que nunca va al hospital). */
    const cerrados = (): string[] =>
      prisma.syncOutbox.updateMany.mock.calls
        .map((c: any[]) => c[0])
        .filter((a: any) => a.where?.seq?.in)
        .flatMap((a: any) => a.where.seq.in.map(String));

    it('«Agendar» apagado: el alta no se entrega; «Cancelar» encendido: la cancelación sí', async () => {
      interruptores(false, true, false);
      prisma.syncOutbox.findMany.mockResolvedValue([
        alta(1, 'cita-1'),
        cancelacion(2, 'cita-2'),
      ]);
      expect(seqs(await service.getPendingEvents('org1', BigInt(0)))).toEqual([
        '2',
      ]);
    });

    it('«Cambiar fecha» encendido: el cambio sale; con «Cancelar» apagado la cancelación no', async () => {
      interruptores(false, false, true);
      prisma.syncOutbox.findMany.mockResolvedValue([
        cancelacion(3, 'cita-3'),
        cambio(4, 'cita-4'),
      ]);
      expect(seqs(await service.getPendingEvents('org1', BigInt(0)))).toEqual([
        '4',
      ]);
    });

    it('🔢 la cancelación de una cita cuya ALTA está retenida no sale antes que el alta', async () => {
      interruptores(false, true, false);
      prisma.syncOutbox.findMany.mockResolvedValue([
        alta(5, 'cita-5'),
        cancelacion(6, 'cita-5'),
      ]);
      expect(await service.getPendingEvents('org1', BigInt(0))).toEqual([]);
    });

    it('🚪 cupos, asistencia y el BORRADO de una cita no se entregan nunca: se cierran sin enviar', async () => {
      interruptores(true, true, true);
      prisma.syncOutbox.findMany.mockResolvedValue([
        fila(7, 'slot-1', 'UPDATE', {}, 'SLOT'),
        fila(8, 'cita-8', 'UPDATE', {
          status: 'SCHEDULED',
          scheduleSlotId: 's1',
          __old: { scheduleSlotId: 's1' },
        }),
        fila(9, 'cita-9', 'DELETE'),
        alta(10, 'cita-10'),
      ]);
      expect(seqs(await service.getPendingEvents('org1', BigInt(0)))).toEqual([
        '10',
      ]);
      expect(cerrados().sort()).toEqual(['7', '8', '9']);
      expect(prisma.syncAudit.createMany).toHaveBeenCalledTimes(1);
      const auditados = prisma.syncAudit.createMany.mock.calls[0][0].data;
      expect(auditados.map((a: any) => a.outcome)).toEqual([
        'SKIPPED',
        'SKIPPED',
        'SKIPPED',
      ]);
    });

    it('🔢 un evento que no va al hospital no tapa a la cancelación que viene detrás de la misma cita', async () => {
      interruptores(false, true, false);
      // Primera vuelta: el cambio de EPS (OTRO) se cierra; la cancelación espera su turno.
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila(11, 'cita-11', 'UPDATE', { status: 'SCHEDULED', epsId: 'x' }),
        cancelacion(12, 'cita-11'),
      ]);
      // Segunda vuelta: ya solo queda la cancelación, y sale.
      prisma.syncOutbox.findMany.mockResolvedValue([
        cancelacion(12, 'cita-11'),
      ]);
      expect(seqs(await service.getPendingEvents('org1', BigInt(0)))).toEqual([
        '12',
      ]);
      expect(cerrados()).toEqual(['11']);
    });

    it('todo apagado: no entrega nada, pero cierra lo que nunca va al hospital (no queda nada en la cola)', async () => {
      interruptores(false, false, false);
      prisma.syncOutbox.findMany.mockResolvedValue([
        fila(13, 'slot-2', 'UPDATE', {}, 'SLOT'),
      ]);
      expect(await service.getPendingEvents('org1', BigInt(0))).toEqual([]);
      expect(cerrados()).toContain('13');
    });

    it('falla cerrado: sin fila de configuración, o con valores que no son true, no sale nada', async () => {
      prisma.organizationSettings.findUnique.mockResolvedValue(null);
      prisma.syncOutbox.findMany.mockResolvedValue([alta(14, 'cita-14')]);
      expect(await service.getPendingEvents('org1', BigInt(0))).toEqual([]);

      interruptores(null, null, null);
      expect(await service.getPendingEvents('org1', BigInt(0))).toEqual([]);
    });

    it('se consulta en cada vuelta: encender «Agendar» a mitad del long-poll entrega en esa misma llamada', async () => {
      prisma.organizationSettings.findUnique
        .mockResolvedValueOnce({ bookingEnabled: false })
        .mockResolvedValue({ bookingEnabled: true });
      prisma.syncOutbox.findMany.mockResolvedValue([alta(15, 'cita-15')]);
      expect(await service.getPendingEvents('org1', BigInt(0))).toHaveLength(1);
    });

    it('consulta los interruptores de SU clínica', async () => {
      await service.getPendingEvents('org-xyz', BigInt(0));
      expect(prisma.organizationSettings.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-xyz' } }),
      );
    });

    it('ya no depende del viejo «envío al hospital» (pushEnabled)', async () => {
      prisma.hospitalMirrorConfig.findUnique.mockResolvedValue({
        pushEnabled: false,
      });
      interruptores(true, false, false);
      prisma.syncOutbox.findMany.mockResolvedValue([alta(16, 'cita-16')]);
      expect(seqs(await service.getPendingEvents('org1', BigInt(0)))).toEqual([
        '16',
      ]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // "El agente respira" y "el agente alcanza su HIS" son cosas distintas: el
  // agente puede latir puntual mientras falla el 100 % de sus escrituras. Esa
  // diferencia solo existía en el log del servidor, así que la única forma de
  // enterarse era que alguien estuviera mirando en ese instante. Ahora se
  // guarda, y el panel del hospital la muestra.
  // ══════════════════════════════════════════════════════════════════════
  describe('heartbeat', () => {
    const datosDelUpdate = () =>
      prisma.hospitalMirrorConfig.update.mock.calls[0][0].data;

    it('registra el latido', async () => {
      await service.heartbeat('org1', 'driver-x', {});

      expect(datosDelUpdate().lastHeartbeatAt).toEqual(expect.any(Date));
    });

    it('guarda que el HIS NO respondía, no solo lo loguea', async () => {
      await service.heartbeat('org1', 'driver-x', {
        hisReachable: false,
        hisDetail: 'Failed to connect to 192.168.1.16:1433',
      });

      expect(datosDelUpdate()).toMatchObject({
        lastHisReachable: false,
        lastHisDetail: 'Failed to connect to 192.168.1.16:1433',
      });
    });

    it('guarda también el caso bueno: sin él no se distingue de "nunca reportó"', async () => {
      await service.heartbeat('org1', 'driver-x', { hisReachable: true });

      expect(datosDelUpdate().lastHisReachable).toBe(true);
    });

    it('un agente viejo que no reporta salud del HIS deja el campo en nulo', async () => {
      // Nulo significa "no lo sé", que es distinto de "no alcanza".
      await service.heartbeat('org1', 'driver-x', {});

      expect(datosDelUpdate().lastHisReachable).toBeNull();
    });

    // La consulta en vivo al HIS solo se encola si el agente dice que su driver
    // la implementa; "no lo dice" (agente anterior) debe valer como "no puede".
    it('guarda si el driver del agente implementa la consulta en vivo', async () => {
      await service.heartbeat('org1', 'driver-x', { lookupCapable: true });
      expect(datosDelUpdate().lastLookupCapable).toBe(true);
    });

    it('guarda que NO la implementa (es distinto de no haberlo dicho)', async () => {
      await service.heartbeat('org1', 'driver-x', { lookupCapable: false });
      expect(datosDelUpdate().lastLookupCapable).toBe(false);
    });

    it('un agente anterior a la consulta en vivo deja el campo en nulo', async () => {
      await service.heartbeat('org1', 'driver-x', {});
      expect(datosDelUpdate().lastLookupCapable).toBeNull();
    });

    it('un detalle largo se recorta: no se rompe el insert por un stack trace', async () => {
      await service.heartbeat('org1', 'driver-x', {
        hisReachable: false,
        hisDetail: 'x'.repeat(2000),
      });

      expect(datosDelUpdate().lastHisDetail).toHaveLength(500);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🏷️ Versión del agente (2026-10-29). El agente se actualiza a mano en el
  // servidor del hospital y no había cómo saber cuándo quedó instalada una
  // actualización. Se anota en la bitácora del espejo SOLO cuando cambia.
  // ══════════════════════════════════════════════════════════════════════
  describe('versión del agente', () => {
    const NUEVA = {
      sha256:
        '80286425153a757c944b78d78c8419231bfef33c68fa7c5c1275e94a14ce09bd',
      commit: '1344b1d',
      dirty: true,
      builtAtIso: '2026-10-29T19:10:58.817Z',
    };
    const renglon = (sha256: string) => ({
      detail: JSON.stringify({
        sha256,
        commit: null,
        dirty: false,
        builtAtIso: null,
        anterior: null,
      }),
    });

    it('una versión nueva deja un renglón con la anterior', async () => {
      prisma.syncAudit.findFirst.mockResolvedValue(renglon('b1142c02c319'));

      await service.heartbeat('org1', 'driver-x', { agentVersion: NUEVA });

      expect(prisma.syncAudit.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org1', direction: 'AGENT', op: 'VERSION' },
        orderBy: { createdAt: 'desc' },
        select: { detail: true },
      });
      expect(prisma.syncAudit.create).toHaveBeenCalledTimes(1);
      const data = prisma.syncAudit.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        organizationId: 'org1',
        direction: 'AGENT',
        entityType: 'AGENT',
        op: 'VERSION',
        outcome: 'OK',
      });
      expect(JSON.parse(data.detail)).toEqual({
        sha256: '80286425153a',
        commit: '1344b1d',
        dirty: true,
        builtAtIso: '2026-10-29T19:10:58.817Z',
        anterior: 'b1142c02c319',
      });
    });

    it('la misma versión no repite el renglón, y los latidos siguientes no consultan la base', async () => {
      prisma.syncAudit.findFirst.mockResolvedValue(renglon('80286425153a'));

      await service.heartbeat('org1', 'driver-x', { agentVersion: NUEVA });
      await service.heartbeat('org1', 'driver-x', { agentVersion: NUEVA });
      await service.heartbeat('org1', 'driver-x', { agentVersion: NUEVA });

      expect(prisma.syncAudit.create).not.toHaveBeenCalled();
      expect(prisma.syncAudit.findFirst).toHaveBeenCalledTimes(1);
    });

    it('el handshake también la anota (es lo primero que hace el agente al arrancar)', async () => {
      await service.handshake('org1', 'driver-x', null, {
        driverVersion: '0.1.0-fase1',
        agentClockIso: new Date().toISOString(),
        agentVersion: NUEVA,
      });

      expect(prisma.syncAudit.create).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(prisma.syncAudit.create.mock.calls[0][0].data.detail)
          .anterior,
      ).toBeNull();
    });

    it('volver a una versión anterior también queda anotado', async () => {
      prisma.syncAudit.findFirst.mockResolvedValue(renglon('b1142c02c319'));
      await service.heartbeat('org1', 'driver-x', { agentVersion: NUEVA });
      prisma.syncAudit.findFirst.mockResolvedValue(renglon('80286425153a'));
      await service.heartbeat('org1', 'driver-x', {
        agentVersion: { sha256: 'b1142c02c319' },
      });

      expect(prisma.syncAudit.create).toHaveBeenCalledTimes(2);
      expect(
        JSON.parse(prisma.syncAudit.create.mock.calls[1][0].data.detail),
      ).toMatchObject({ sha256: 'b1142c02c319', anterior: '80286425153a' });
    });

    it('un agente anterior (sin versión) o una huella inválida: nada que anotar', async () => {
      await service.heartbeat('org1', 'driver-x', {});
      await service.heartbeat('org1', 'driver-x', {
        agentVersion: { sha256: 'no-es-hex' },
      });

      expect(prisma.syncAudit.findFirst).not.toHaveBeenCalled();
      expect(prisma.syncAudit.create).not.toHaveBeenCalled();
    });

    it('si la bitácora falla, el latido se guarda igual y se reintenta en el siguiente', async () => {
      prisma.syncAudit.findFirst.mockRejectedValueOnce(new Error('base caída'));
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await expect(
        service.heartbeat('org1', 'driver-x', { agentVersion: NUEVA }),
      ).resolves.toBeUndefined();
      expect(prisma.hospitalMirrorConfig.update).toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();

      await service.heartbeat('org1', 'driver-x', { agentVersion: NUEVA });
      expect(prisma.syncAudit.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('ack — reintentos y dead-letter', () => {
    it('seqs exitosos → marca deliveredAt, no toca attempts', async () => {
      await service.ack('org1', { seqs: ['1', '2'] });

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1', seq: { in: [BigInt(1), BigInt(2)] } },
        data: {
          deliveredAt: expect.any(Date),
          nextAttemptAt: null,
          lastError: null,
        },
      });
    });

    describe('🧾 constancia de lo que se escribió en el hospital', () => {
      const cancelacion = {
        eventId: 'e-cancel',
        entityType: 'APPOINTMENT',
        entityId: 'apt-1',
        op: 'UPDATE',
        payload: { status: 'CANCELLED' },
      };

      it('cada seq exitoso deja una fila AGENIA_TO_HIS OK con la operación', async () => {
        prisma.syncOutbox.findMany.mockResolvedValueOnce([cancelacion]);

        await service.ack('org1', { seqs: ['5'] });

        expect(prisma.syncOutbox.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              organizationId: 'org1',
              seq: { in: [BigInt(5)] },
              deliveredAt: null,
            },
          }),
        );
        expect(prisma.syncAudit.createMany).toHaveBeenCalledWith({
          data: [
            {
              organizationId: 'org1',
              direction: 'AGENIA_TO_HIS',
              entityType: 'APPOINTMENT',
              entityId: 'apt-1',
              op: 'UPDATE',
              outcome: 'OK',
              eventId: 'e-cancel',
              detail:
                'Escrito en el sistema del hospital: cancelación de la cita.',
            },
          ],
        });
      });

      it('un ack repetido (ya entregado) no duplica la constancia', async () => {
        prisma.syncOutbox.findMany.mockResolvedValueOnce([]);

        await service.ack('org1', { seqs: ['5'] });

        expect(prisma.syncAudit.createMany).not.toHaveBeenCalled();
      });

      it('sin seqs exitosos no consulta nada', async () => {
        await service.ack('org1', { seqs: [], failedSeqs: [] });

        expect(prisma.syncOutbox.findMany).not.toHaveBeenCalled();
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Cada reserva de cita genera además un evento SLOT (el cupo pasa a
    // ocupado) que este driver no espeja. Tratarlo como fallo lo mandaba a
    // dead-letter tras diez intentos y dejaba el monitor en DOWN permanente:
    // a la décima cita, una alerta rota para siempre por diseño.
    // ══════════════════════════════════════════════════════════════════════
    describe('skippedSeqs — el driver no espeja ese tipo de entidad', () => {
      const eventoSlot = {
        eventId: 'e-slot',
        entityType: 'SLOT',
        entityId: 'slot-1',
        op: 'UPDATE',
      };

      it('se cierra como entregado: no se reintenta nunca más', async () => {
        prisma.syncOutbox.findFirst.mockResolvedValueOnce(eventoSlot);

        await service.ack('org1', { seqs: [], skippedSeqs: ['7'] });

        expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
          where: { seq: BigInt(7), organizationId: 'org1' },
          data: { deliveredAt: expect.any(Date), nextAttemptAt: null },
        });
      });

      it('NO sube attempts: no es un fallo', async () => {
        prisma.syncOutbox.findFirst.mockResolvedValueOnce(eventoSlot);

        await service.ack('org1', { seqs: [], skippedSeqs: ['7'] });

        const incrementos = prisma.syncOutbox.updateMany.mock.calls.filter(
          (c: any[]) => c[0]?.data?.attempts,
        );
        expect(incrementos).toHaveLength(0);
      });

      it('no es un descarte silencioso: queda en SyncAudit como SKIPPED', async () => {
        prisma.syncOutbox.findFirst.mockResolvedValueOnce(eventoSlot);

        await service.ack('org1', { seqs: [], skippedSeqs: ['7'] });

        expect(prisma.syncAudit.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            organizationId: 'org1',
            outcome: 'SKIPPED',
            entityType: 'SLOT',
            eventId: 'e-slot',
          }),
        });
      });

      it('un agente no puede cerrar el evento de otra clínica', async () => {
        // Mismo aislamiento de tenant que markAttemptFailed: `seq` es una
        // secuencia global, no por organización.
        prisma.syncOutbox.findFirst.mockResolvedValueOnce(null);

        await service.ack('org2', { seqs: [], skippedSeqs: ['7'] });

        expect(prisma.syncAudit.create).not.toHaveBeenCalled();
        const cierres = prisma.syncOutbox.updateMany.mock.calls.filter(
          (c: any[]) => c[0]?.where?.seq === BigInt(7),
        );
        expect(cierres).toHaveLength(0);
      });
    });

    it('failedSeqs → incrementa attempts, NO marca delivered (queda pendiente)', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 2 })
        .mockResolvedValueOnce({
          seq: BigInt(9),
          eventId: 'e9',
          attempts: 3,
          deadLettered: false,
          nextAttemptAt: new Date(),
        });

      await service.ack('org1', { seqs: [], failedSeqs: ['9'] });

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { seq: BigInt(9), organizationId: 'org1' },
        data: {
          attempts: { increment: 1 },
          nextAttemptAt: expect.any(Date), // backoff: no antes de esa hora
        },
      });
      // no se marcó deadLettered: solo hubo el updateMany del incremento
      const marcasDeadLetter = prisma.syncOutbox.updateMany.mock.calls.filter(
        (c: any[]) => c[0]?.data?.deadLettered === true,
      );
      expect(marcasDeadLetter).toHaveLength(0);
    });

    // ══════════════════════════════════════════════════════════════════════
    // El motivo del fallo viaja con el seq. Antes solo existía en el journal de
    // la VM del hospital: saber por qué un evento cayó a dead-letter exigía
    // entrar por SSH (docs/PLAN_RASTREO_PACIENTE.md §8 #4).
    // ══════════════════════════════════════════════════════════════════════
    describe('failures — el motivo del fallo viaja con el seq', () => {
      const fila = (attempts = 2) => ({
        seq: BigInt(9),
        eventId: 'e9',
        attempts,
        deadLettered: false,
        nextAttemptAt: new Date(),
      });
      /** Los argumentos de los updateMany que subieron `attempts`. */
      const incrementos = () =>
        prisma.syncOutbox.updateMany.mock.calls
          .map((c: any[]) => c[0])
          .filter((a: any) => a?.data?.attempts?.increment === 1);

      beforeEach(() => {
        prisma.syncOutbox.findFirst.mockResolvedValue(fila());
      });

      it('guarda el motivo en lastError junto con el intento', async () => {
        await service.ack('org1', {
          seqs: [],
          failedSeqs: ['9'],
          failures: [{ seq: '9', error: 'violación de PK: cupo ya vendido' }],
        });

        expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
          where: { seq: BigInt(9), organizationId: 'org1' },
          data: {
            attempts: { increment: 1 },
            nextAttemptAt: expect.any(Date),
            lastError: 'violación de PK: cupo ya vendido',
          },
        });
      });

      it('🔁 un agente ANTIGUO (solo failedSeqs) cuenta el intento igual y no toca lastError', async () => {
        await service.ack('org1', { seqs: [], failedSeqs: ['9'] });

        const [llamada] = incrementos();
        expect(llamada.data.attempts).toEqual({ increment: 1 });
        // `undefined` = Prisma ignora el campo: el motivo anterior se conserva.
        expect(llamada.data.lastError).toBeUndefined();
      });

      it('🚨 el mismo seq en failedSeqs Y en failures gasta UN intento, no dos', async () => {
        await service.ack('org1', {
          seqs: [],
          failedSeqs: ['9'],
          failures: [{ seq: '9', error: 'boom' }],
        });

        expect(incrementos()).toHaveLength(1);
      });

      it('un seq solo presente en failures también cuenta como fallido', async () => {
        await service.ack('org1', {
          seqs: [],
          failures: [{ seq: '9', error: 'boom' }],
        });

        expect(incrementos()).toHaveLength(1);
        expect(incrementos()[0].data.lastError).toBe('boom');
      });

      it('cada seq lleva SU motivo (no el del vecino)', async () => {
        await service.ack('org1', {
          seqs: [],
          failedSeqs: ['9', '10'],
          failures: [
            { seq: '9', error: 'motivo del nueve' },
            { seq: '10', error: 'motivo del diez' },
          ],
        });

        const porSeq = new Map(
          incrementos().map((a: any) => [
            String(a.where.seq),
            a.data.lastError,
          ]),
        );
        expect(porSeq.get('9')).toBe('motivo del nueve');
        expect(porSeq.get('10')).toBe('motivo del diez');
      });

      it('trunca el motivo: un mensaje de driver puede traer una traza entera', async () => {
        await service.ack('org1', {
          seqs: [],
          failures: [{ seq: '9', error: 'x'.repeat(5000) }],
        });

        expect(incrementos()[0].data.lastError).toHaveLength(1000);
      });

      it('un motivo vacío o en blanco NO pisa el anterior', async () => {
        await service.ack('org1', {
          seqs: [],
          failures: [{ seq: '9', error: '   ' }],
        });

        expect(incrementos()[0].data.lastError).toBeUndefined();
      });

      it('un seq no numérico en failures se ignora sin romper el ack (BigInt lanzaría)', async () => {
        await expect(
          service.ack('org1', {
            seqs: ['1'],
            failures: [
              { seq: 'abc', error: 'x' },
              { seq: '9', error: 'ok' },
              null as never,
            ],
          }),
        ).resolves.toEqual({ acknowledged: 1 });

        expect(incrementos()).toHaveLength(1);
        expect(incrementos()[0].where.seq).toBe(BigInt(9));
      });

      it('un evento que por fin se entrega pierde su motivo de error', async () => {
        await service.ack('org1', { seqs: ['9'] });

        expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ lastError: null }),
          }),
        );
      });
    });

    it('failedSeqs que alcanza el máximo de intentos → se marca dead-letter', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 9 }) // lectura previa (para el backoff)
        .mockResolvedValueOnce({
          seq: BigInt(9),
          eventId: 'e9',
          attempts: 10,
          deadLettered: false,
          nextAttemptAt: new Date(),
        });

      await service.ack('org1', { seqs: [], failedSeqs: ['9'] });

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { seq: BigInt(9), organizationId: 'org1' },
        data: { deadLettered: true },
      });
    });

    it('un evento ya en dead-letter no se vuelve a marcar (ni a re-alertar)', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 13 })
        .mockResolvedValueOnce({
          seq: BigInt(9),
          eventId: 'e9',
          attempts: 14,
          deadLettered: true,
          nextAttemptAt: new Date(),
        });

      await service.ack('org1', { seqs: [], failedSeqs: ['9'] });

      const marcas = prisma.syncOutbox.updateMany.mock.calls.filter(
        (c: any[]) => c[0]?.data?.deadLettered === true,
      );
      expect(marcas).toHaveLength(0);
    });
  });

  // 🔒 El `seq` de SyncOutbox es una secuencia GLOBAL, compartida entre todas
  // las clínicas. Hasta que markAttemptFailed filtró por organización, un
  // agente podía reportar como fallido el seq de OTRO tenant y subirle los
  // intentos hasta mandarle el evento a dead-letter.
  describe('aislamiento entre organizaciones', () => {
    it('un seq que no es de la organización que lo reporta NO se toca', async () => {
      // updateMany no afecta ninguna fila: el seq existe, pero es de otra org.
      prisma.syncOutbox.updateMany.mockResolvedValueOnce({ count: 0 });

      await service.markAttemptFailed('org-atacante', '9');

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { seq: BigInt(9), organizationId: 'org-atacante' },
        data: {
          attempts: { increment: 1 },
          nextAttemptAt: expect.any(Date),
        },
      });
      // y se corta ahí: no vuelve a leer la fila ajena ni la manda a
      // dead-letter. La lectura previa del backoff ya filtró por organización
      // y devolvió null, así que tampoco filtró datos de otro tenant.
      expect(prisma.syncOutbox.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledTimes(1);
    });

    it('el filtro por organización viaja en TODAS las escrituras del camino', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 9 })
        .mockResolvedValueOnce({
          seq: BigInt(4),
          eventId: 'e4',
          attempts: 10,
          deadLettered: false,
          nextAttemptAt: new Date(),
        });

      await service.markAttemptFailed('org-duena', '4');

      for (const [args] of prisma.syncOutbox.updateMany.mock.calls) {
        expect(args.where.organizationId).toBe('org-duena');
      }
      expect(
        prisma.syncOutbox.findFirst.mock.calls[0][0].where.organizationId,
      ).toBe('org-duena');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Reintentos con backoff (opción C).
//
// Antes de esto el dispatcher filtraba `seq > cursor` y el agente avanzaba su
// cursor local aunque el evento fallara: un evento fallido NO se volvía a
// servir nunca mientras el agente siguiera vivo. Comprobado en vivo el
// 2026-08-31 — `attempts` subía una vez por reinicio del agente, así que el
// dead-letter de 10 intentos no llegaba jamás.
// ═════════════════════════════════════════════════════════════════════════
describe('MirrorDispatchService — entrega con backoff', () => {
  let service: MirrorDispatchService;
  let prisma: any;

  const fila = (over: Partial<Record<string, any>> = {}) => ({
    seq: BigInt(1),
    eventId: 'e1',
    entityType: 'APPOINTMENT',
    entityId: 'apt-1',
    op: 'INSERT',
    payload: {},
    createdAt: new Date('2026-08-31T12:00:00Z'),
    deliveredAt: null,
    attempts: 0,
    deadLettered: false,
    nextAttemptAt: null,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      hospitalMirrorConfig: {
        findUniqueOrThrow: jest.fn(() => Promise.resolve({})),
        findUnique: jest.fn(() => Promise.resolve({ pushEnabled: true })),
        update: jest.fn(() => Promise.resolve({})),
      },
      // «Agendar», «Cancelar» y «Cambiar fecha» (una compuerta por operación):
      // encendidas, salvo donde la prueba diga otra cosa.
      organizationSettings: {
        findUnique: jest.fn(async () => ({
          bookingEnabled: true as boolean,
          cancelEnabled: true as boolean,
          rescheduleEnabled: true as boolean,
        })),
      },
      syncOutbox: {
        findMany: jest.fn(() => Promise.resolve([])),
        findFirst: jest.fn(() => Promise.resolve(null)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        update: jest.fn(),
      },
      // Modelos que consulta la hidratación (bloque D).
      scheduleSlot: { findMany: jest.fn(() => Promise.resolve([])) },
      patientProfile: { findMany: jest.fn(() => Promise.resolve([])) },
      eps: { findMany: jest.fn(() => Promise.resolve([])) },
      mirrorEntityMap: { findMany: jest.fn(() => Promise.resolve([])) },
      // Lo que nunca va al hospital se cierra con su constancia.
      syncAudit: { createMany: jest.fn(async () => ({ count: 0 })) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorDispatchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(MirrorDispatchService);
    (service as any).longPollMs = 5;
    (service as any).longPollIntervalMs = 1;
  });

  describe('backoffMs', () => {
    it('crece exponencialmente y se detiene en el techo de 5 minutos', () => {
      expect(backoffMs(1)).toBe(2_000);
      expect(backoffMs(2)).toBe(4_000);
      expect(backoffMs(5)).toBe(32_000);
      expect(backoffMs(8)).toBe(256_000);
      expect(backoffMs(9)).toBe(300_000); // techo
      expect(backoffMs(50)).toBe(300_000); // no desborda con exponentes grandes
    });

    it('los 10 intentos se agotan en menos de media hora', () => {
      let total = 0;
      for (let i = 1; i <= 10; i++) total += backoffMs(i);
      expect(total).toBeLessThan(30 * 60_000);
      // ...pero no en segundos: el HIS debe tener margen para reiniciarse.
      expect(total).toBeGreaterThan(10 * 60_000);
    });
  });

  describe('el cursor ya NO filtra: un evento fallido vuelve a entregarse', () => {
    it('la consulta no menciona el seq del cursor, solo "pendiente"', async () => {
      await service.getPendingEvents('org1', BigInt(999));

      const where = prisma.syncOutbox.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        organizationId: 'org1',
        deliveredAt: null,
        deadLettered: false,
        // 🪞 Anti-eco: lo que nació en el HIS no vuelve al HIS.
        origin: { not: 'MIRROR' },
      });
      expect(JSON.stringify(where)).not.toContain('gt');
    });

    it('🪞 lo nacido en el HIS se excluye en la CONSULTA, no después: si no, taparía la cola', async () => {
      await service.getPendingEvents('org1', BigInt(0));
      const args = prisma.syncOutbox.findMany.mock.calls[0][0];
      expect(args.where.origin).toEqual({ not: 'MIRROR' });
      // Las filas del espejo son las más viejas (menor `seq`): si se filtraran
      // después de leer, ocuparían la ventana entera y las entregables no entrarían.
      expect(args.orderBy).toEqual({ seq: 'asc' });
    });

    it('un evento con seq POR DEBAJO del cursor se sigue entregando', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ seq: BigInt(2), eventId: 'viejo-fallido', attempts: 3 }),
      ]);

      // El agente ya avanzó su cursor a 50 — antes esto devolvía vacío.
      const eventos = await service.getPendingEvents('org1', BigInt(50));

      expect(eventos.map((e) => e.eventId)).toEqual(['viejo-fallido']);
    });
  });

  describe('backoff: no se reintenta antes de tiempo', () => {
    it('un evento cuyo nextAttemptAt aún no llega NO se entrega', async () => {
      prisma.syncOutbox.findMany.mockResolvedValue([
        fila({ nextAttemptAt: new Date(Date.now() + 60_000) }),
      ]);

      expect(await service.getPendingEvents('org1', BigInt(0))).toEqual([]);
    });

    it('cuando su nextAttemptAt ya pasó, se entrega', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ nextAttemptAt: new Date(Date.now() - 1_000) }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(0));
      expect(eventos).toHaveLength(1);
    });

    it('nextAttemptAt nulo (nunca intentado) se entrega de inmediato', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ nextAttemptAt: null }),
      ]);

      expect(await service.getPendingEvents('org1', BigInt(0))).toHaveLength(1);
    });

    it('cada fallo empuja el siguiente intento más lejos', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 2 }) // lectura previa
        .mockResolvedValueOnce(fila({ attempts: 3 })); // relectura post-update

      const antes = Date.now();
      await service.markAttemptFailed('org1', '1');

      const data = prisma.syncOutbox.updateMany.mock.calls[0][0].data;
      expect(data.attempts).toEqual({ increment: 1 });
      // 3er intento -> 8 segundos
      const delta = data.nextAttemptAt.getTime() - antes;
      expect(delta).toBeGreaterThanOrEqual(8_000);
      expect(delta).toBeLessThan(9_000);
    });

    it('un ack exitoso limpia el backoff que hubiera quedado', async () => {
      await service.ack('org1', { seqs: ['1'] });

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1', seq: { in: [BigInt(1)] } },
        data: {
          deliveredAt: expect.any(Date),
          nextAttemptAt: null,
          lastError: null,
        },
      });
    });
  });

  // ⭐ Sin el cursor global se pierde el orden estricto por seq. Lo que hay que
  // conservar es el orden POR ENTIDAD: si el INSERT de una cita falla y su
  // DELETE se aplica igual, el HIS recibe la cancelación de una cita que no
  // existe.
  describe('orden por entidad', () => {
    it('entrega como mucho UN evento por entidad en cada lote', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ seq: BigInt(1), eventId: 'insert', entityId: 'apt-1' }),
        fila({
          seq: BigInt(2),
          eventId: 'delete',
          entityId: 'apt-1',
          op: 'DELETE',
        }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(0));

      expect(eventos.map((e) => e.eventId)).toEqual(['insert']);
    });

    it('entidades distintas SÍ viajan juntas: el rendimiento no se resiente', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ seq: BigInt(1), eventId: 'a', entityId: 'apt-1' }),
        fila({ seq: BigInt(2), eventId: 'b', entityId: 'apt-2' }),
        fila({ seq: BigInt(3), eventId: 'c', entityId: 'apt-3' }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(0));

      expect(eventos.map((e) => e.eventId)).toEqual(['a', 'b', 'c']);
    });

    it('si el primer evento de una entidad espera backoff, los suyos también esperan', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({
          seq: BigInt(1),
          eventId: 'insert-fallido',
          entityId: 'apt-1',
          nextAttemptAt: new Date(Date.now() + 60_000),
        }),
        fila({
          seq: BigInt(2),
          eventId: 'delete',
          entityId: 'apt-1',
          op: 'DELETE',
        }),
        fila({ seq: BigInt(3), eventId: 'otra-cita', entityId: 'apt-9' }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(0));

      // El DELETE de apt-1 NO puede adelantarse a su INSERT atascado...
      expect(eventos.map((e) => e.eventId)).toEqual(['otra-cita']);
    });

    it('la misma entityId de tipos distintos son entidades distintas', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({
          seq: BigInt(1),
          eventId: 'slot',
          entityType: 'SLOT',
          entityId: 'x',
        }),
        fila({
          seq: BigInt(2),
          eventId: 'cita',
          entityType: 'APPOINTMENT',
          entityId: 'x',
        }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(0));
      // El cupo no va al hospital (se cierra sin enviar), pero no frena a la cita
      // de mismo id: son entidades distintas.
      expect(eventos.map((e) => e.eventId)).toEqual(['cita']);
    });

    it('respeta el límite del lote', async () => {
      prisma.syncOutbox.findMany.mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) =>
          fila({ seq: BigInt(i + 1), eventId: `e${i}`, entityId: `apt-${i}` }),
        ),
      );

      const eventos = await service.getPendingEvents('org1', BigInt(0), 3);
      expect(eventos).toHaveLength(3);
    });

    it('lee una ventana mayor que el límite, porque el filtro por entidad descarta filas', async () => {
      await service.getPendingEvents('org1', BigInt(0), 10);

      expect(prisma.syncOutbox.findMany.mock.calls[0][0].take).toBeGreaterThan(
        10,
      );
    });
  });

  describe('sin pérdidas', () => {
    it('un ack perdido no deja el evento varado: vuelve a entregarse', async () => {
      // El agente aplicó el evento pero su ack se perdió en la red, así que
      // deliveredAt sigue en null. Antes, con el cursor ya avanzado, el evento
      // quedaba invisible para siempre.
      prisma.syncOutbox.findMany.mockResolvedValueOnce([
        fila({ seq: BigInt(7), eventId: 'ack-perdido' }),
      ]);

      const eventos = await service.getPendingEvents('org1', BigInt(100));

      expect(eventos.map((e) => e.eventId)).toEqual(['ack-perdido']);
    });

    it('lo entregado y lo dead-letter nunca se reentregan', async () => {
      await service.getPendingEvents('org1', BigInt(0));

      const where = prisma.syncOutbox.findMany.mock.calls[0][0].where;
      expect(where.deliveredAt).toBeNull();
      expect(where.deadLettered).toBe(false);
    });

    it('el dead-letter ya es alcanzable: 10 fallos reales lo disparan', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ attempts: 9 })
        .mockResolvedValueOnce(fila({ attempts: 10, deadLettered: false }));

      await service.markAttemptFailed('org1', '1');

      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledWith({
        where: { seq: BigInt(1), organizationId: 'org1' },
        data: { deadLettered: true },
      });
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Hidratación del evento (bloque D).
//
// El trigger serializa la fila de Appointment tal cual, y esa fila NO tiene
// hora, ni médico, ni servicio: eso vive en ScheduleSlot. El driver recibía
// cuatro UUIDs de AgenIA y nada con qué construir el INSERT del HIS.
// ═════════════════════════════════════════════════════════════════════════
describe('MirrorDispatchService — hidratación del evento', () => {
  let service: MirrorDispatchService;
  let prisma: any;
  let avisos: string[];

  const SLOT = {
    id: 'slot-1',
    startTime: new Date('2026-09-03T12:20:00.000Z'),
    endTime: new Date('2026-09-03T12:40:00.000Z'),
    doctorId: 'doc-1',
    serviceId: 'svc-1',
  };
  const PACIENTE = {
    id: 'pat-1',
    cedula: '9696544',
    fullName: 'PACIENTE DE PRUEBA UNO',
    dateOfBirth: new Date('1980-05-12T00:00:00.000Z'),
    gender: 'M',
  };
  const EPS = { id: 'eps-1', nit: '800088702', name: 'Nueva EPS' };

  const eventoCrudo = (payload: Record<string, unknown> = {}) => ({
    seq: BigInt(1),
    eventId: 'e1',
    entityType: 'APPOINTMENT',
    entityId: 'apt-1',
    op: 'INSERT',
    payload: {
      id: 'apt-1',
      patientId: 'pat-1',
      scheduleSlotId: 'slot-1',
      epsId: 'eps-1',
      ...payload,
    },
    createdAt: new Date('2026-08-31T03:48:16.919Z'),
    deliveredAt: null,
    attempts: 0,
    deadLettered: false,
    nextAttemptAt: null,
  });

  /** Configura las cuatro consultas de la hidratación. */
  const conCatalogo = (opts: {
    slot?: boolean;
    paciente?: boolean;
    eps?: boolean;
    mapas?: { entityType: string; agenIAId: string; externalKey: string }[];
  }) => {
    prisma.scheduleSlot.findMany.mockResolvedValue(
      opts.slot === false ? [] : [SLOT],
    );
    prisma.patientProfile.findMany.mockResolvedValue(
      opts.paciente === false ? [] : [PACIENTE],
    );
    prisma.eps.findMany.mockResolvedValue(opts.eps === false ? [] : [EPS]);
    prisma.mirrorEntityMap.findMany.mockResolvedValue(
      opts.mapas ?? [
        { entityType: 'DOCTOR', agenIAId: 'doc-1', externalKey: '76' },
        { entityType: 'SERVICE', agenIAId: 'svc-1', externalKey: 'S39141-1' },
      ],
    );
  };

  beforeEach(async () => {
    prisma = {
      hospitalMirrorConfig: {
        findUniqueOrThrow: jest.fn(() => Promise.resolve({})),
        findUnique: jest.fn(() => Promise.resolve({ pushEnabled: true })),
        update: jest.fn(() => Promise.resolve({})),
      },
      // «Agendar», «Cancelar» y «Cambiar fecha» (una compuerta por operación):
      // encendidas, salvo donde la prueba diga otra cosa.
      organizationSettings: {
        findUnique: jest.fn(async () => ({
          bookingEnabled: true as boolean,
          cancelEnabled: true as boolean,
          rescheduleEnabled: true as boolean,
        })),
      },
      syncOutbox: {
        findMany: jest.fn(() => Promise.resolve([])),
        findFirst: jest.fn(() => Promise.resolve(null)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        update: jest.fn(),
      },
      scheduleSlot: { findMany: jest.fn(() => Promise.resolve([])) },
      patientProfile: { findMany: jest.fn(() => Promise.resolve([])) },
      eps: { findMany: jest.fn(() => Promise.resolve([])) },
      mirrorEntityMap: { findMany: jest.fn(() => Promise.resolve([])) },
      // Lo que nunca va al hospital se cierra con su constancia.
      syncAudit: { createMany: jest.fn(async () => ({ count: 0 })) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorDispatchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(MirrorDispatchService);
    (service as any).longPollMs = 5;
    (service as any).longPollIntervalMs = 1;
    avisos = [];
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation((m: string) => avisos.push(m));
  });

  it('completa hora, médico, servicio, paciente y EPS', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({});

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context).toEqual({
      startTimeIso: '2026-09-03T12:20:00.000Z',
      endTimeIso: '2026-09-03T12:40:00.000Z',
      doctorExternalKey: '76',
      serviceExternalKey: 'S39141-1',
      patientDocument: '9696544',
      patientFullName: 'PACIENTE DE PRUEBA UNO',
      patientBirthDateIso: '1980-05-12T00:00:00.000Z',
      patientGender: 'M',
      epsNit: '800088702',
      epsName: 'Nueva EPS',
    });
  });

  it('conserva intacta la fila cruda del trigger junto al contexto', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({});

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.payload).toMatchObject({ id: 'apt-1', patientId: 'pat-1' });
  });

  it('sin homologación del médico, marca missingMappings y avisa', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({
      mapas: [
        { entityType: 'SERVICE', agenIAId: 'svc-1', externalKey: 'S39141-1' },
      ],
    });

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.missingMappings).toEqual(['DOCTOR doc-1']);
    expect(evento.context?.doctorExternalKey).toBeUndefined();
    expect(avisos[0]).toContain('SIN homologar');
  });

  it('acumula TODAS las homologaciones que faltan, no solo la primera', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({ mapas: [] });

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.missingMappings).toEqual([
      'DOCTOR doc-1',
      'SERVICE svc-1',
    ]);
  });

  it('un cupo que ya no existe se reporta, no se entrega a medias', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({ slot: false });

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.missingMappings).toContain('SLOT slot-1');
    expect(evento.context?.startTimeIso).toBeUndefined();
  });

  it('una cita particular (sin EPS) es válida: no falta nada', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([
      eventoCrudo({ epsId: null }),
    ]);
    conCatalogo({ eps: false });

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.missingMappings).toBeUndefined();
    expect(evento.context?.epsNit).toBeUndefined();
  });

  it('una cita que declara EPS pero no se encuentra SÍ es un problema', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({ eps: false });

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.missingMappings).toContain('EPS eps-1');
  });

  it('hidrata en LOTE: cuatro consultas, no cuatro por evento', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([
      eventoCrudo(),
      { ...eventoCrudo(), seq: BigInt(2), eventId: 'e2', entityId: 'apt-2' },
      { ...eventoCrudo(), seq: BigInt(3), eventId: 'e3', entityId: 'apt-3' },
    ]);
    conCatalogo({});

    await service.getPendingEvents('org1', BigInt(0));

    // Un lote de 100 citas producía 400 consultas sueltas antes de agrupar.
    expect(prisma.scheduleSlot.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.patientProfile.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.eps.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.mirrorEntityMap.findMany).toHaveBeenCalledTimes(1);
  });

  it('las consultas de hidratación filtran por organización', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({});

    await service.getPendingEvents('org1', BigInt(0));

    for (const modelo of [
      'scheduleSlot',
      'patientProfile',
      'eps',
      'mirrorEntityMap',
    ]) {
      expect(
        prisma[modelo].findMany.mock.calls[0][0].where.organizationId,
      ).toBe('org1');
    }
  });

  it('un evento que no es de cita no se entrega ni se hidrata: no va al hospital', async () => {
    prisma.syncOutbox.findMany.mockResolvedValueOnce([
      { ...eventoCrudo(), entityType: 'SLOT' },
    ]);

    const eventos = await service.getPendingEvents('org1', BigInt(0));

    expect(eventos).toEqual([]);
    expect(prisma.scheduleSlot.findMany).not.toHaveBeenCalled();
  });

  it('un paciente sin nacimiento ni sexo no rompe la hidratación', async () => {
    // Pacientes creados antes de que el chatbot pidiera esos datos (bloque F).
    prisma.syncOutbox.findMany.mockResolvedValueOnce([eventoCrudo()]);
    conCatalogo({});
    prisma.patientProfile.findMany.mockResolvedValue([
      { ...PACIENTE, dateOfBirth: null, gender: null },
    ]);

    const [evento] = await service.getPendingEvents('org1', BigInt(0));

    expect(evento.context?.patientDocument).toBe('9696544');
    expect(evento.context?.patientBirthDateIso).toBeUndefined();
    expect(evento.context?.missingMappings).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// HIDRATACIÓN — la pieza que convierte una fila cruda de `Appointment` en algo
// que un HIS puede escribir.
//
// El trigger serializa la fila tal cual, y esa fila NO tiene la hora, ni el
// médico, ni el servicio: solo cuatro UUIDs de AgenIA. Todo lo que el driver
// necesita para construir su INSERT se resuelve aquí. Si algo falta, el evento
// tiene que salir MARCADO como no aplicable — escribir una cita a medias en la
// agenda de un hospital es el riesgo #1 de la tabla de riesgos del plan.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorDispatchService — hidratación del contexto que va al HIS', () => {
  let service: MirrorDispatchService;
  let prisma: any;

  const ORG = 'org1';
  const AHORA = new Date('2026-09-02T10:00:00.000Z');

  const filaOutbox = (over: Record<string, unknown> = {}) => ({
    seq: 1n,
    eventId: 'evt-1',
    entityType: 'APPOINTMENT',
    entityId: 'apt-1',
    op: 'INSERT',
    payload: {
      id: 'apt-1',
      scheduleSlotId: 'slot-1',
      patientId: 'pac-1',
      epsId: 'eps-1',
    },
    origin: 'LOCAL',
    createdAt: AHORA,
    deliveredAt: null,
    deadLettered: false,
    attempts: 0,
    nextAttemptAt: null,
    ...over,
  });

  const SLOT = {
    id: 'slot-1',
    startTime: new Date('2026-09-10T12:00:00.000Z'),
    endTime: new Date('2026-09-10T12:20:00.000Z'),
    doctorId: 'doc-1',
    serviceId: 'svc-1',
  };
  const PACIENTE = {
    id: 'pac-1',
    cedula: '9696544',
    fullName: 'JUAN CARLOS PEREZ',
    nombres: 'JUAN CARLOS',
    apellidos: 'PEREZ',
    dateOfBirth: new Date('1980-03-15T00:00:00.000Z'),
    gender: 'M',
    regime: 'SUBSIDIADO',
  };
  const EPS = { id: 'eps-1', nit: '800088702', name: 'NUEVA EPS' };
  const MAPAS = [
    { entityType: 'DOCTOR', agenIAId: 'doc-1', externalKey: '76' },
    { entityType: 'SERVICE', agenIAId: 'svc-1', externalKey: 'S-9' },
  ];

  const traer = () => service.getPendingEvents(ORG, 0n, 100);

  beforeEach(async () => {
    prisma = {
      hospitalMirrorConfig: {
        findUniqueOrThrow: jest.fn(),
        findUnique: jest.fn(async () => ({ pushEnabled: true })),
        update: jest.fn(),
      },
      // «Agendar», «Cancelar» y «Cambiar fecha» (una compuerta por operación):
      // encendidas, salvo donde la prueba diga otra cosa.
      organizationSettings: {
        findUnique: jest.fn(async () => ({
          bookingEnabled: true as boolean,
          cancelEnabled: true as boolean,
          rescheduleEnabled: true as boolean,
        })),
      },
      syncOutbox: {
        findMany: jest.fn(async () => [filaOutbox()]),
        findFirst: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      scheduleSlot: { findMany: jest.fn(async () => [SLOT]) },
      patientProfile: { findMany: jest.fn(async () => [PACIENTE]) },
      eps: { findMany: jest.fn(async () => [EPS]) },
      mirrorEntityMap: { findMany: jest.fn(async () => MAPAS) },
      syncAudit: { create: jest.fn(), createMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorDispatchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(MirrorDispatchService);
    (service as any).longPollMs = 20;
    (service as any).longPollIntervalMs = 5;
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
  });

  it('una cita completa sale con TODO lo que el driver necesita y sin faltantes', async () => {
    const [evento] = await traer();

    expect(evento.context).toEqual({
      startTimeIso: '2026-09-10T12:00:00.000Z',
      endTimeIso: '2026-09-10T12:20:00.000Z',
      doctorExternalKey: '76',
      serviceExternalKey: 'S-9',
      patientDocument: '9696544',
      patientFullName: 'JUAN CARLOS PEREZ',
      patientNombres: 'JUAN CARLOS',
      patientApellidos: 'PEREZ',
      patientBirthDateIso: '1980-03-15T00:00:00.000Z',
      patientGender: 'M',
      patientRegime: 'SUBSIDIADO',
      epsNit: '800088702',
      epsName: 'NUEVA EPS',
    });
    expect(evento.context?.missingMappings).toBeUndefined();
    expect(evento.seq).toBe('1'); // BigInt serializado: JSON no tiene int64
  });

  it('todas las lecturas van acotadas a la organización', async () => {
    await traer();

    for (const modelo of ['scheduleSlot', 'patientProfile', 'eps'] as const) {
      expect(prisma[modelo].findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG }),
        }),
      );
    }
    expect(prisma.mirrorEntityMap.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG }),
      }),
    );
  });

  it('un lote grande no dispara una consulta por cita: son cuatro, sea cual sea el tamaño', async () => {
    prisma.syncOutbox.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) =>
        filaOutbox({ seq: BigInt(i + 1), eventId: `e${i}`, entityId: `a${i}` }),
      ),
    );

    await traer();

    expect(prisma.scheduleSlot.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.patientProfile.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.eps.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.mirrorEntityMap.findMany).toHaveBeenCalledTimes(1);
  });

  describe('🚨 homologaciones que faltan → el evento sale marcado NO aplicable', () => {
    it('médico sin homologar', async () => {
      prisma.mirrorEntityMap.findMany.mockResolvedValue([MAPAS[1]]);

      const [evento] = await traer();

      expect(evento.context?.missingMappings).toEqual(['DOCTOR doc-1']);
      expect(evento.context?.doctorExternalKey).toBeUndefined();
    });

    it('servicio sin homologar', async () => {
      prisma.mirrorEntityMap.findMany.mockResolvedValue([MAPAS[0]]);

      const [evento] = await traer();
      expect(evento.context?.missingMappings).toEqual(['SERVICE svc-1']);
    });

    it('el cupo desapareció entre la captura y la entrega', async () => {
      prisma.scheduleSlot.findMany.mockResolvedValue([]);

      const [evento] = await traer();

      expect(evento.context?.missingMappings).toEqual(['SLOT slot-1']);
      expect(evento.context?.startTimeIso).toBeUndefined();
    });

    it('el paciente no está: el HIS necesita la historia para dar de alta', async () => {
      prisma.patientProfile.findMany.mockResolvedValue([]);

      const [evento] = await traer();
      expect(evento.context?.missingMappings).toContain('PATIENT pac-1');
    });

    it('la cita declara una EPS que no existe', async () => {
      prisma.eps.findMany.mockResolvedValue([]);

      const [evento] = await traer();
      expect(evento.context?.missingMappings).toContain('EPS eps-1');
    });

    it('una cita PARTICULAR (sin EPS) no cuenta como faltante', async () => {
      prisma.syncOutbox.findMany.mockResolvedValue([
        filaOutbox({
          payload: {
            id: 'apt-1',
            scheduleSlotId: 'slot-1',
            patientId: 'pac-1',
            epsId: null,
          },
        }),
      ]);
      prisma.eps.findMany.mockResolvedValue([]);

      const [evento] = await traer();

      expect(evento.context?.missingMappings).toBeUndefined();
      expect(evento.context?.epsNit).toBeUndefined();
    });

    it('🗑️ un DELETE (purga de una clínica) no se entrega nunca: no es una cancelación para el hospital', async () => {
      prisma.syncOutbox.findMany.mockResolvedValue([
        filaOutbox({ op: 'DELETE' }),
      ]);

      expect(await traer()).toEqual([]);
      expect(prisma.scheduleSlot.findMany).not.toHaveBeenCalled();
    });

    it('una cancelación sin médico o sin cupo sigue sin poder anularse: se marca no aplicable', async () => {
      prisma.syncOutbox.findMany.mockResolvedValue([
        filaOutbox({
          op: 'UPDATE',
          payload: {
            id: 'apt-1',
            scheduleSlotId: 'slot-1',
            patientId: 'pac-1',
            epsId: 'eps-1',
            status: 'CANCELLED',
          },
        }),
      ]);
      prisma.mirrorEntityMap.findMany.mockResolvedValue([]);
      expect((await traer())[0].context?.missingMappings).toContain(
        'DOCTOR doc-1',
      );

      prisma.scheduleSlot.findMany.mockResolvedValue([]);
      expect((await traer())[0].context?.missingMappings).toContain(
        'SLOT slot-1',
      );
    });

    it('varios faltantes se reportan todos juntos, no solo el primero', async () => {
      prisma.mirrorEntityMap.findMany.mockResolvedValue([]);
      prisma.patientProfile.findMany.mockResolvedValue([]);

      const [evento] = await traer();

      expect(evento.context?.missingMappings).toEqual([
        'DOCTOR doc-1',
        'SERVICE svc-1',
        'PATIENT pac-1',
      ]);
    });
  });

  describe('reagendamiento — el cupo anterior viaja en `__old`', () => {
    const SLOT_VIEJO = {
      id: 'slot-0',
      startTime: new Date('2026-09-09T12:00:00.000Z'),
      endTime: new Date('2026-09-09T12:20:00.000Z'),
      doctorId: 'doc-1',
      serviceId: 'svc-1',
    };

    const conOld = (oldSlotId: string | undefined) =>
      filaOutbox({
        op: 'UPDATE',
        payload: {
          id: 'apt-1',
          scheduleSlotId: 'slot-1',
          patientId: 'pac-1',
          epsId: 'eps-1',
          __old: { id: 'apt-1', scheduleSlotId: oldSlotId },
        },
      });

    it('con el cupo movido, se adjunta la hora y el médico del anterior', async () => {
      prisma.syncOutbox.findMany.mockResolvedValue([conOld('slot-0')]);
      prisma.scheduleSlot.findMany.mockResolvedValue([SLOT, SLOT_VIEJO]);

      const [evento] = await traer();

      expect(evento.context?.previousStartTimeIso).toBe(
        '2026-09-09T12:00:00.000Z',
      );
      expect(evento.context?.previousDoctorExternalKey).toBe('76');
      expect(evento.context?.missingMappings).toBeUndefined();
    });

    it('el cupo anterior se pide en la MISMA consulta que el actual', async () => {
      prisma.syncOutbox.findMany.mockResolvedValue([conOld('slot-0')]);
      prisma.scheduleSlot.findMany.mockResolvedValue([SLOT, SLOT_VIEJO]);

      await traer();

      const where = prisma.scheduleSlot.findMany.mock.calls[0][0].where;
      expect(where.id.in).toEqual(expect.arrayContaining(['slot-1', 'slot-0']));
    });

    it('un UPDATE que NO movió el cupo no es un reagendamiento: ni siquiera sale hacia el hospital', async () => {
      // Desenlace de asistencia: misma fila, mismo cupo.
      prisma.syncOutbox.findMany.mockResolvedValue([conOld('slot-1')]);

      expect(await traer()).toEqual([]);
    });

    it('si el cupo anterior ya no existe, se reporta como faltante', async () => {
      prisma.syncOutbox.findMany.mockResolvedValue([conOld('slot-0')]);
      prisma.scheduleSlot.findMany.mockResolvedValue([SLOT]);

      const [evento] = await traer();
      expect(evento.context?.missingMappings).toContain(
        'SLOT slot-0 (cupo anterior)',
      );
    });

    it('si el médico del cupo anterior no está homologado, también se reporta', async () => {
      prisma.syncOutbox.findMany.mockResolvedValue([conOld('slot-0')]);
      prisma.scheduleSlot.findMany.mockResolvedValue([
        SLOT,
        { ...SLOT_VIEJO, doctorId: 'doc-viejo' },
      ]);

      const [evento] = await traer();
      expect(evento.context?.missingMappings).toContain(
        'DOCTOR doc-viejo (cupo anterior)',
      );
    });
  });

  describe('datos opcionales del paciente', () => {
    it('un paciente antiguo sin nombres/apellidos separados no rompe nada', async () => {
      prisma.patientProfile.findMany.mockResolvedValue([
        {
          ...PACIENTE,
          nombres: null,
          apellidos: null,
          dateOfBirth: null,
          gender: null,
          regime: null,
        },
      ]);

      const [evento] = await traer();

      expect(evento.context?.patientDocument).toBe('9696544');
      expect(evento.context?.patientNombres).toBeUndefined();
      expect(evento.context?.patientBirthDateIso).toBeUndefined();
      expect(evento.context?.patientRegime).toBeUndefined();
      expect(evento.context?.missingMappings).toBeUndefined();
    });

    it('una EPS sin NIT viaja igual con su nombre', async () => {
      prisma.eps.findMany.mockResolvedValue([{ ...EPS, nit: null }]);

      const [evento] = await traer();
      expect(evento.context?.epsNit).toBeUndefined();
      expect(evento.context?.epsName).toBe('NUEVA EPS');
    });
  });

  describe('eventos que no son citas', () => {
    it('un evento SLOT no sale: no va al hospital', async () => {
      prisma.syncOutbox.findMany.mockResolvedValue([
        filaOutbox({ entityType: 'SLOT', entityId: 'slot-1' }),
      ]);

      expect(await traer()).toEqual([]);
      expect(prisma.scheduleSlot.findMany).not.toHaveBeenCalled();
    });

    it('un lote mixto entrega e hidrata solo las citas', async () => {
      prisma.syncOutbox.findMany.mockResolvedValue([
        filaOutbox({ seq: 1n, eventId: 'e-slot', entityType: 'SLOT' }),
        filaOutbox({ seq: 2n, eventId: 'e-cita', entityId: 'apt-2' }),
      ]);

      const eventos = await traer();

      expect(eventos.map((e) => e.eventId)).toEqual(['e-cita']);
      expect(eventos[0].context?.doctorExternalKey).toBe('76');
    });
  });

  describe('🛡️ si la hidratación revienta, NADA se escribe en el HIS', () => {
    it('el evento se entrega marcado como no aplicable, con el motivo real', async () => {
      prisma.scheduleSlot.findMany.mockRejectedValue(
        new Error('connection terminated'),
      );

      const [evento] = await traer();

      expect(evento.context?.missingMappings).toEqual([
        'hidratación falló: connection terminated',
      ]);
      // La fila cruda sí viaja: el agente necesita el seq para reportar.
      expect(evento.seq).toBe('1');
      expect(evento.eventId).toBe('evt-1');
    });

    it('no se traga el poll entero: el agente recibe respuesta, no un 500', async () => {
      prisma.patientProfile.findMany.mockRejectedValue(new Error('boom'));
      await expect(traer()).resolves.toHaveLength(1);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🏥 H10/H11 (docs/PLAN_AGENDA_HUECOS.md): cuando el HIS rechaza el ALTA de una
// cita de forma definitiva (hora tomada o cruce), reintentarla no sirve. La API
// la anula en AgenIA para que el bot le ofrezca otra hora al paciente.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorDispatchService — rechazo definitivo del HIS', () => {
  const ORG = 'org-1';
  let prisma: any;
  let tx: any;
  let service: MirrorDispatchService;

  const evento = (over: Record<string, unknown> = {}) => ({
    eventId: 'ev-1',
    entityType: 'APPOINTMENT',
    entityId: 'apt-1',
    op: 'INSERT',
    ...over,
  });

  beforeEach(() => {
    tx = {
      $executeRawUnsafe: jest.fn(async () => 0),
      appointment: {
        findFirst: jest.fn(async () => ({
          id: 'apt-1',
          status: 'SCHEDULED',
          scheduleSlotId: 'slot-1',
          metaLog: { origenBot: true },
        })),
        update: jest.fn(async () => ({})),
      },
      scheduleSlot: { update: jest.fn(async () => ({})) },
      syncOutbox: { updateMany: jest.fn(async () => ({ count: 1 })) },
      syncAudit: { create: jest.fn(async () => ({})) },
    };
    prisma = {
      syncOutbox: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        findFirst: jest.fn(async () => evento()),
      },
      syncAudit: { create: jest.fn(async () => ({})) },
      $transaction: jest.fn(async (cb: (t: any) => unknown) => cb(tx)),
    };
    service = new MirrorDispatchService(prisma);
  });

  const ackConRechazo = () =>
    service.ack(ORG, {
      seqs: [],
      failedSeqs: ['7'],
      failures: [
        {
          seq: '7',
          error: 'se cruza con otra cita del HIS',
          rechazoDelHis: true,
        },
      ],
    });

  // 🏥 2026-10-29 (`AltasNoRegistradasService`): el alta no llegó al hospital.
  it('con la marca «no llegó»: la guarda en la cita, y el cierre y la auditoría lo dicen así', async () => {
    await service.markRejectedByHis(ORG, '7', 'no llegó tras 10 intentos', {
      noLlego: true,
      yaSeLeEscribio: true,
    });

    const upd = tx.appointment.update.mock.calls[0][0];
    expect(upd.data.status).toBe('CANCELLED');
    expect(upd.data.metaLog.rechazoDelHis).toMatchObject({
      motivo: 'no llegó tras 10 intentos',
      noLlego: true,
      yaSeLeEscribio: true,
    });
    expect(tx.scheduleSlot.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { isAvailable: false },
    });
    const cierre = tx.syncOutbox.updateMany.mock.calls[0][0].data;
    expect(cierre.lastError).toBe(
      'No llegó al hospital: no llegó tras 10 intentos',
    );
    expect(cierre.deliveredAt).toBeInstanceOf(Date);
    expect(tx.syncAudit.create.mock.calls[0][0].data.detail).toMatch(
      /no llegó al hospital.*le avisa al paciente que no quedó registrada/,
    );
  });

  it('sin marcas, la cita no las lleva (el rechazo de siempre)', async () => {
    await ackConRechazo();
    const r = tx.appointment.update.mock.calls[0][0].data.metaLog.rechazoDelHis;
    expect(r.noLlego).toBeUndefined();
    expect(r.yaSeLeEscribio).toBeUndefined();
    expect(tx.syncOutbox.updateMany.mock.calls[0][0].data.lastError).toMatch(
      /^Rechazada por el HIS: /,
    );
  });

  it('anula la cita en AgenIA con origen MIRROR, guarda el motivo y CIERRA el cupo', async () => {
    await ackConRechazo();

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      `SET LOCAL agenia.sync_origin = 'MIRROR'`,
    );
    expect(tx.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      tx.appointment.update.mock.invocationCallOrder[0],
    );
    const upd = tx.appointment.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'apt-1' });
    expect(upd.data.status).toBe('CANCELLED');
    expect(upd.data.metaLog.origenBot).toBe(true); // no pisa lo que había
    expect(upd.data.metaLog.rechazoDelHis.motivo).toBe(
      'se cruza con otra cita del HIS',
    );
    // El hospital ya tiene ese tiempo ocupado: liberarlo lo volvería a ofrecer.
    expect(tx.scheduleSlot.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { isAvailable: false },
    });
  });

  it('cierra el evento (no se reintenta) con el motivo y deja constancia en la auditoría', async () => {
    await ackConRechazo();

    const cierre = tx.syncOutbox.updateMany.mock.calls[0][0];
    expect(cierre.where).toEqual({ seq: BigInt(7), organizationId: ORG });
    expect(cierre.data.deliveredAt).toBeInstanceOf(Date);
    expect(cierre.data.lastError).toContain('Rechazada por el HIS');
    expect(tx.syncAudit.create.mock.calls[0][0].data).toMatchObject({
      organizationId: ORG,
      entityId: 'apt-1',
      op: 'INSERT',
      outcome: 'CONFLICT',
    });
    // No pasó además por el camino de reintentos.
    expect(prisma.syncOutbox.updateMany).toHaveBeenCalledTimes(1); // solo el de `seqs`
  });

  it('una cita ya anulada no se toca otra vez, pero el evento igual se cierra', async () => {
    tx.appointment.findFirst.mockResolvedValue({
      id: 'apt-1',
      status: 'CANCELLED',
      scheduleSlotId: 'slot-1',
      metaLog: null,
    });

    await ackConRechazo();

    expect(tx.appointment.update).not.toHaveBeenCalled();
    expect(tx.syncOutbox.updateMany).toHaveBeenCalled();
  });

  // 2026-10-29: el agente que corre en el hospital todavía no marca «médico sin
  // turno ese día»; la API lo reconoce por el motivo. Antes se reintentaba diez
  // veces, quedaba en dead-letter y la paciente esperaba una confirmación.
  it('«no tiene turno» sin la marca del agente también es rechazo definitivo', async () => {
    await service.ack(ORG, {
      seqs: [],
      failedSeqs: ['7'],
      failures: [
        {
          seq: '7',
          error:
            'El médico RU70 no tiene turno el 2026-10-30: la agenda de AgenIA y la del HIS no coinciden.',
        },
      ],
    });

    const upd = tx.appointment.update.mock.calls[0][0];
    expect(upd.data.status).toBe('CANCELLED');
    expect(upd.data.metaLog.rechazoDelHis.motivo).toContain('no tiene turno');
    expect(tx.scheduleSlot.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { isAvailable: false },
    });
  });

  it('otro fallo sin la marca (p. ej. el HIS no responde) se sigue reintentando', async () => {
    await service.ack(ORG, {
      seqs: [],
      failedSeqs: ['7'],
      failures: [{ seq: '7', error: 'timeout conectando al HIS' }],
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('la marca en un evento que NO es alta de cita se trata como fallo normal (se reintenta)', async () => {
    prisma.syncOutbox.findFirst.mockResolvedValue(
      evento({ entityType: 'SLOT' }),
    );

    await ackConRechazo();

    expect(prisma.$transaction).not.toHaveBeenCalled();
    // markAttemptFailed: sube intentos en vez de cerrar.
    const llamadas = prisma.syncOutbox.updateMany.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(
      llamadas.some((d: any) => d.attempts?.increment === 1 && !d.deliveredAt),
    ).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 🛡️ Cancelación NO aplicada (2026-10-15): en el hospital, esa hora es de otro
  // paciente. El agente no borró nada; la cita sigue cancelada en AgenIA.
  // ────────────────────────────────────────────────────────────────────────
  describe('cancelación no aplicada por el HIS (otro paciente)', () => {
    const inicio = new Date(Date.now() + 26 * 3_600_000);
    let exceptions: { registrar: jest.Mock };

    beforeEach(() => {
      prisma.syncOutbox.findFirst.mockResolvedValue(
        evento({
          op: 'UPDATE',
          payload: { status: 'CANCELLED', scheduleSlotId: 'slot-1' },
        }),
      );
      tx.appointment.findFirst.mockResolvedValue({
        id: 'apt-1',
        patientId: 'pac-1',
        epsId: 'eps-1',
        scheduleSlotId: 'slot-1',
        metaLog: { origenBot: true },
        scheduleSlot: { startTime: inicio, doctorId: 'doc-1' },
      });
      tx.scheduleSlot.updateMany = jest.fn(async () => ({ count: 1 }));
      exceptions = { registrar: jest.fn(async () => 'CREADA') };
      service = new MirrorDispatchService(prisma, exceptions as any);
    });

    const ackOtroPaciente = () =>
      service.ack(ORG, {
        seqs: [],
        failedSeqs: ['7'],
        failures: [
          {
            seq: '7',
            error:
              'en el hospital, la cita de ese médico a esa hora es de otro paciente',
            rechazoDelHis: true,
          },
        ],
      });

    it('no reabre la cita: deja la marca en metaLog y CIERRA el cupo, con origen MIRROR', async () => {
      await ackOtroPaciente();
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        `SET LOCAL agenia.sync_origin = 'MIRROR'`,
      );
      const upd = tx.appointment.update.mock.calls[0][0];
      expect(upd.data).not.toHaveProperty('status');
      expect(upd.data.metaLog.origenBot).toBe(true);
      expect(upd.data.metaLog.cancelacionNoAplicadaEnElHis.motivo).toMatch(
        /otro paciente/,
      );
      expect(tx.scheduleSlot.updateMany.mock.calls[0][0].data).toEqual({
        isAvailable: false,
      });
    });

    it('cierra el evento sin reintentos, deja auditoría y abre el caso en la bandeja', async () => {
      await ackOtroPaciente();
      const cierre = tx.syncOutbox.updateMany.mock.calls[0][0];
      expect(cierre.data.deliveredAt).toBeInstanceOf(Date);
      expect(cierre.data.lastError).toContain('Cancelación no aplicada');
      expect(tx.syncAudit.create.mock.calls[0][0].data).toMatchObject({
        op: 'UPDATE',
        outcome: 'CONFLICT',
      });
      expect(exceptions.registrar).toHaveBeenCalledTimes(1);
      expect(exceptions.registrar.mock.calls[0][1]).toMatchObject({
        kind: 'CANCELACION_NO_APLICADA',
        dedupeKey: 'cancelacion:apt-1',
        appointmentId: 'apt-1',
        patientId: 'pac-1',
        doctorId: 'doc-1',
        appointmentStartAt: inicio,
      });
      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledTimes(1); // solo el de `seqs`
    });

    it('si la bandeja falla, el evento igual queda cerrado', async () => {
      exceptions.registrar.mockRejectedValue(new Error('bd'));
      await expect(ackOtroPaciente()).resolves.toBeDefined();
      expect(tx.syncOutbox.updateMany).toHaveBeenCalled();
    });
  });

  it('sin la marca, un fallo sigue el camino de siempre', async () => {
    await service.ack(ORG, {
      seqs: [],
      failedSeqs: ['7'],
      failures: [{ seq: '7', error: 'timeout' }],
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────────
  // 🏥 H10 para el CAMBIO de fecha: el HIS rechazó mover la cita. El agente
  // reagenda en una transacción, así que en el hospital sigue en su hora de
  // antes: AgenIA vuelve a ella (no la anula).
  // ────────────────────────────────────────────────────────────────────────
  describe('cambio de fecha rechazado', () => {
    const cambio = (payload: Record<string, unknown> = {}) =>
      evento({
        op: 'UPDATE',
        payload: {
          scheduleSlotId: 'slot-new',
          __old: { scheduleSlotId: 'slot-old' },
          ...payload,
        },
      });
    const citaEnElNuevo = {
      id: 'apt-1',
      status: 'SCHEDULED',
      scheduleSlotId: 'slot-new',
      metaLog: { origenBot: true },
    };

    beforeEach(() => {
      prisma.syncOutbox.findFirst.mockResolvedValue(cambio());
      tx.appointment.findFirst
        .mockResolvedValueOnce(citaEnElNuevo) // la cita
        .mockResolvedValueOnce(null); // nadie más en el cupo de antes
      tx.scheduleSlot.findFirst = jest.fn(async () => ({ id: 'slot-old' }));
    });

    it('🚨 la cita VUELVE a su cupo anterior (no se anula), con origen MIRROR y el motivo', async () => {
      await ackConRechazo();

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        `SET LOCAL agenia.sync_origin = 'MIRROR'`,
      );
      const upd = tx.appointment.update.mock.calls[0][0];
      expect(upd.where).toEqual({ id: 'apt-1' });
      expect(upd.data.scheduleSlotId).toBe('slot-old');
      expect(upd.data.status).toBeUndefined();
      expect(upd.data.metaLog.origenBot).toBe(true);
      expect(upd.data.metaLog.cambioRechazadoPorElHis).toMatchObject({
        motivo: 'se cruza con otra cita del HIS',
        cupoRechazado: 'slot-new',
      });
    });

    it('el cupo de antes queda ocupado por la cita y el nuevo CERRADO (el HIS tiene ese tiempo)', async () => {
      await ackConRechazo();

      expect(tx.scheduleSlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-old' },
        data: { isAvailable: false },
      });
      expect(tx.scheduleSlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-new' },
        data: { isAvailable: false },
      });
    });

    it('cierra el evento (no se reintenta) y deja constancia en la auditoría', async () => {
      await ackConRechazo();

      const cierre = tx.syncOutbox.updateMany.mock.calls[0][0];
      expect(cierre.data.deliveredAt).toBeInstanceOf(Date);
      expect(cierre.data.lastError).toContain('Cambio rechazado por el HIS');
      expect(tx.syncAudit.create.mock.calls[0][0].data).toMatchObject({
        entityId: 'apt-1',
        op: 'UPDATE',
        outcome: 'CONFLICT',
      });
      expect(prisma.syncOutbox.updateMany).toHaveBeenCalledTimes(1); // solo el de `seqs`
    });

    it('si el cupo de antes ya tiene OTRA cita viva, no se revierte: fallo normal (bandeja)', async () => {
      tx.appointment.findFirst.mockReset();
      tx.appointment.findFirst
        .mockResolvedValueOnce(citaEnElNuevo)
        .mockResolvedValueOnce({ id: 'apt-otro' });

      await ackConRechazo();

      expect(tx.appointment.update).not.toHaveBeenCalled();
      expect(tx.syncOutbox.updateMany).not.toHaveBeenCalled();
      const llamadas = prisma.syncOutbox.updateMany.mock.calls.map(
        (c: any[]) => c[0].data,
      );
      expect(
        llamadas.some(
          (d: any) => d.attempts?.increment === 1 && !d.deliveredAt,
        ),
      ).toBe(true);
    });

    it('si la cita ya no está en el cupo nuevo (alguien la movió), no se toca: fallo normal', async () => {
      tx.appointment.findFirst.mockReset();
      tx.appointment.findFirst.mockResolvedValueOnce({
        ...citaEnElNuevo,
        scheduleSlotId: 'slot-otro',
      });

      await ackConRechazo();

      expect(tx.appointment.update).not.toHaveBeenCalled();
    });

    it('un UPDATE que no cambia de cupo (asistencia) no es un cambio de fecha: fallo normal', async () => {
      prisma.syncOutbox.findFirst.mockResolvedValue(
        cambio({ __old: { scheduleSlotId: 'slot-new' } }),
      );

      await ackConRechazo();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
