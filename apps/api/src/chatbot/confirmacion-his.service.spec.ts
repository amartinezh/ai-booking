import { ConfirmacionHisService } from './confirmacion-his.service';

/** H10 (docs/PLAN_AGENDA_HUECOS.md): ¿la cita ya está en el HIS? */
describe('ConfirmacionHisService', () => {
  let prisma: any;
  let redis: any;
  let svc: ConfirmacionHisService;
  const ORG = 'org-1';

  beforeEach(() => {
    const hash = new Map<string, string>();
    prisma = {
      hospitalMirrorConfig: { findUnique: jest.fn(async () => null) },
      organizationSettings: { findUnique: jest.fn(async () => null) },
      appointment: {
        findFirst: jest.fn(async () => ({ status: 'SCHEDULED' })),
      },
      syncOutbox: { findFirst: jest.fn(async () => null) },
    };
    redis = {
      hset: jest.fn(
        async (_k: string, f: string, v: string) => void hash.set(f, v),
      ),
      hgetall: jest.fn(async () => Object.fromEntries(hash)),
      hdel: jest.fn(async (_k: string, f: string) => (hash.delete(f) ? 1 : 0)),
    };
    svc = new ConfirmacionHisService(prisma, redis);
    svc.intervaloSondeoMs = 1;
  });

  describe('estado', () => {
    it('cita viva + su alta entregada al HIS → CONFIRMADA', async () => {
      prisma.syncOutbox.findFirst.mockResolvedValue({
        deliveredAt: new Date(),
      });
      expect(await svc.estado(ORG, 'apt-1')).toBe('CONFIRMADA');
    });

    it('cita viva + alta sin entregar → PENDIENTE', async () => {
      prisma.syncOutbox.findFirst.mockResolvedValue({ deliveredAt: null });
      expect(await svc.estado(ORG, 'apt-1')).toBe('PENDIENTE');
    });

    it('sin evento en la cola (no salió hacia el HIS) → PENDIENTE, nunca CONFIRMADA', async () => {
      expect(await svc.estado(ORG, 'apt-1')).toBe('PENDIENTE');
    });

    it('cita anulada (la API la anuló porque el HIS la rechazó) → RECHAZADA', async () => {
      prisma.appointment.findFirst.mockResolvedValue({ status: 'CANCELLED' });
      prisma.syncOutbox.findFirst.mockResolvedValue({
        deliveredAt: new Date(),
      });
      expect(await svc.estado(ORG, 'apt-1')).toBe('RECHAZADA');
    });

    it('cita inexistente o de otra clínica → RECHAZADA', async () => {
      prisma.appointment.findFirst.mockResolvedValue(null);
      expect(await svc.estado(ORG, 'apt-1')).toBe('RECHAZADA');
      expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'apt-1', organizationId: ORG },
        }),
      );
    });

    it('mira el ALTA de esa cita, de esa clínica, y nunca un evento nacido en el HIS', async () => {
      await svc.estado(ORG, 'apt-1');
      expect(prisma.syncOutbox.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG,
            entityType: 'APPOINTMENT',
            entityId: 'apt-1',
            op: 'INSERT',
            origin: { not: 'MIRROR' },
          },
        }),
      );
    });
  });

  describe('esperar', () => {
    it('vuelve en cuanto el hospital la registra', async () => {
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ deliveredAt: null })
        .mockResolvedValueOnce({ deliveredAt: null })
        .mockResolvedValue({ deliveredAt: new Date() });
      expect(await svc.esperar(ORG, 'apt-1', 5_000)).toBe('CONFIRMADA');
      expect(prisma.syncOutbox.findFirst).toHaveBeenCalledTimes(3);
    });

    it('sin respuesta antes del tope → PENDIENTE', async () => {
      prisma.syncOutbox.findFirst.mockResolvedValue({ deliveredAt: null });
      expect(await svc.esperar(ORG, 'apt-1', 20)).toBe('PENDIENTE');
    });
  });

  describe('puedeAgendar / requiereConfirmacion', () => {
    it('sin espejo: agenda y no espera', async () => {
      expect(await svc.puedeAgendar(ORG)).toBe(true);
      expect(await svc.requiereConfirmacion(ORG)).toBe(false);
    });

    it('espejo con el envío al hospital APAGADO: no agenda (nunca habría confirmación)', async () => {
      prisma.hospitalMirrorConfig.findUnique.mockResolvedValue({
        enabled: true,
        pushEnabled: false,
      });
      expect(await svc.puedeAgendar(ORG)).toBe(false);
    });

    it('espejo con el envío encendido: agenda y espera confirmación', async () => {
      prisma.hospitalMirrorConfig.findUnique.mockResolvedValue({
        enabled: true,
        pushEnabled: true,
      });
      expect(await svc.puedeAgendar(ORG)).toBe(true);
      expect(await svc.requiereConfirmacion(ORG)).toBe(true);
    });
  });

  // 🚪 2026-10-15: una compuerta por operación.
  describe('compuertas', () => {
    it('sin espejo no hay compuerta (todo vive solo en AgenIA)', async () => {
      expect(await svc.compuertas(ORG)).toBeNull();
    });

    it('con espejo: el envío abre citas nuevas; cancelar y cambiar, su interruptor', async () => {
      prisma.hospitalMirrorConfig.findUnique.mockResolvedValue({
        enabled: true,
        pushEnabled: false,
      });
      prisma.organizationSettings.findUnique.mockResolvedValue({
        cancelEnabled: true,
        rescheduleEnabled: false,
      });
      expect(await svc.compuertas(ORG)).toEqual({
        agendar: false,
        cancelar: true,
        modificar: false,
        otros: false,
      });
    });
  });

  describe('cancelación', () => {
    it('su evento entregado → CONFIRMADA', async () => {
      prisma.appointment.findFirst.mockResolvedValue({ metaLog: null });
      prisma.syncOutbox.findFirst.mockResolvedValue({
        deliveredAt: new Date(),
      });
      expect(await svc.estadoCancelacion(ORG, 'apt-1', '9')).toBe('CONFIRMADA');
      expect(prisma.syncOutbox.findFirst.mock.calls[0][0].where).toEqual({
        organizationId: ORG,
        seq: BigInt(9),
      });
    });

    it('marca de «no aplicada» en la cita → NO_APLICADA, aunque el evento esté cerrado', async () => {
      prisma.appointment.findFirst.mockResolvedValue({
        metaLog: { cancelacionNoAplicadaEnElHis: { motivo: 'otro paciente' } },
      });
      prisma.syncOutbox.findFirst.mockResolvedValue({
        deliveredAt: new Date(),
      });
      expect(await svc.estadoCancelacion(ORG, 'apt-1', '9')).toBe(
        'NO_APLICADA',
      );
    });

    it('sin entregar, o sin evento conocido → PENDIENTE (nunca se da por hecha)', async () => {
      prisma.appointment.findFirst.mockResolvedValue({ metaLog: {} });
      prisma.syncOutbox.findFirst.mockResolvedValue({ deliveredAt: null });
      expect(await svc.estadoCancelacion(ORG, 'apt-1', '9')).toBe('PENDIENTE');
      expect(await svc.estadoCancelacion(ORG, 'apt-1', undefined)).toBe(
        'PENDIENTE',
      );
    });

    it('esperarCancelacion vuelve en cuanto el hospital responde', async () => {
      prisma.appointment.findFirst.mockResolvedValue({ metaLog: null });
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ deliveredAt: null })
        .mockResolvedValue({ deliveredAt: new Date() });
      expect(await svc.esperarCancelacion(ORG, 'apt-1', '9', 1_000)).toBe(
        'CONFIRMADA',
      );
    });

    it('una cancelación pendiente no pisa un alta ni un cambio de la misma cita', async () => {
      const base = {
        organizationId: ORG,
        senderId: 's',
        appointmentId: 'apt-1',
        fechaTexto: 'x',
        desde: new Date().toISOString(),
      };
      await svc.registrarPendiente(base);
      await svc.registrarPendiente({ ...base, tipo: 'CAMBIO' });
      await svc.registrarPendiente({ ...base, tipo: 'CANCELACION' });
      expect(await svc.pendientes()).toHaveLength(3);
    });
  });

  describe('pendientes', () => {
    const p = {
      organizationId: ORG,
      senderId: '573001112233',
      appointmentId: 'apt-1',
      fechaTexto: 'lunes',
      desde: '2026-10-06T12:00:00.000Z',
    };

    it('se registran y se listan', async () => {
      await svc.registrarPendiente(p);
      expect(await svc.pendientes()).toEqual([p]);
    });

    it('reclamar es compare-and-set: solo la primera réplica la toma', async () => {
      await svc.registrarPendiente(p);
      expect(await svc.reclamar(p)).toBe(true);
      expect(await svc.reclamar(p)).toBe(false);
      expect(await svc.pendientes()).toEqual([]);
    });

    it('una entrada ilegible se descarta sin romper el barrido', async () => {
      await redis.hset('x', 'org-1|roto', '{no es json');
      await svc.registrarPendiente(p);
      expect(await svc.pendientes()).toEqual([p]);
      expect(redis.hdel).toHaveBeenCalledWith(expect.any(String), 'org-1|roto');
    });

    it('un alta y un CAMBIO de la misma cita no se pisan; el alta conserva su clave de antes', async () => {
      const cambio = { ...p, tipo: 'CAMBIO' as const, seq: '9' };
      await svc.registrarPendiente(p);
      await svc.registrarPendiente(cambio);

      expect(await svc.pendientes()).toHaveLength(2);
      expect(redis.hset).toHaveBeenCalledWith(
        expect.any(String),
        'org-1|apt-1',
        expect.any(String),
      );
      expect(redis.hset).toHaveBeenCalledWith(
        expect.any(String),
        'org-1|apt-1|CAMBIO',
        expect.any(String),
      );
      expect(await svc.reclamar(cambio)).toBe(true);
      expect(await svc.pendientes()).toEqual([p]);
    });
  });

  // 🏥 H10 para el CAMBIO de fecha.
  describe('cambio de fecha', () => {
    const enElNuevo = { status: 'SCHEDULED', scheduleSlotId: 'slot-new' };

    it('cita en el cupo nuevo + su evento entregado → CONFIRMADA', async () => {
      prisma.appointment.findFirst.mockResolvedValue(enElNuevo);
      prisma.syncOutbox.findFirst.mockResolvedValue({
        deliveredAt: new Date(),
      });
      expect(await svc.estadoCambio(ORG, 'apt-1', '9', 'slot-new')).toBe(
        'CONFIRMADA',
      );
      expect(prisma.syncOutbox.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG, seq: BigInt(9) },
        }),
      );
    });

    it('evento sin entregar → PENDIENTE', async () => {
      prisma.appointment.findFirst.mockResolvedValue(enElNuevo);
      prisma.syncOutbox.findFirst.mockResolvedValue({ deliveredAt: null });
      expect(await svc.estadoCambio(ORG, 'apt-1', '9', 'slot-new')).toBe(
        'PENDIENTE',
      );
    });

    it('🚨 la cita volvió a otro cupo (la API la revirtió por el rechazo) → RECHAZADA, aunque el evento esté cerrado', async () => {
      prisma.appointment.findFirst.mockResolvedValue({
        status: 'SCHEDULED',
        scheduleSlotId: 'slot-old',
      });
      prisma.syncOutbox.findFirst.mockResolvedValue({
        deliveredAt: new Date(),
      });
      expect(await svc.estadoCambio(ORG, 'apt-1', '9', 'slot-new')).toBe(
        'RECHAZADA',
      );
    });

    it('cita anulada o inexistente → ANULADA', async () => {
      prisma.appointment.findFirst.mockResolvedValue({
        status: 'CANCELLED',
        scheduleSlotId: 'slot-new',
      });
      expect(await svc.estadoCambio(ORG, 'apt-1', '9', 'slot-new')).toBe(
        'ANULADA',
      );
      prisma.appointment.findFirst.mockResolvedValue(null);
      expect(await svc.estadoCambio(ORG, 'apt-1', '9', 'slot-new')).toBe(
        'ANULADA',
      );
    });

    it('sin evento del cambio nunca se confirma (solo se detecta la reversión)', async () => {
      prisma.appointment.findFirst.mockResolvedValue(enElNuevo);
      prisma.syncOutbox.findFirst.mockResolvedValue({
        deliveredAt: new Date(),
      });
      expect(await svc.estadoCambio(ORG, 'apt-1', undefined, 'slot-new')).toBe(
        'PENDIENTE',
      );
      expect(prisma.syncOutbox.findFirst).not.toHaveBeenCalled();
    });

    it('esperarCambio vuelve en cuanto el hospital lo registra', async () => {
      prisma.appointment.findFirst.mockResolvedValue(enElNuevo);
      prisma.syncOutbox.findFirst
        .mockResolvedValueOnce({ deliveredAt: null })
        .mockResolvedValue({ deliveredAt: new Date() });
      expect(
        await svc.esperarCambio(ORG, 'apt-1', '9', 'slot-new', 5_000),
      ).toBe('CONFIRMADA');
    });

    it('eventoDelCambio sigue el último UPDATE de la cita que va HACIA el HIS', async () => {
      prisma.syncOutbox.findFirst.mockResolvedValue({ seq: BigInt(42) });
      expect(await svc.eventoDelCambio(ORG, 'apt-1')).toBe('42');
      expect(prisma.syncOutbox.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          entityType: 'APPOINTMENT',
          entityId: 'apt-1',
          op: 'UPDATE',
          origin: { not: 'MIRROR' },
        },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
    });

    it('liberarCupoAnterior: origen MIRROR y solo si nadie tiene una cita viva ahí', async () => {
      const tx = {
        $executeRawUnsafe: jest.fn(async () => 0),
        scheduleSlot: { updateMany: jest.fn(async () => ({ count: 1 })) },
      };
      prisma.$transaction = jest.fn(async (cb: (t: any) => unknown) => cb(tx));

      expect(await svc.liberarCupoAnterior(ORG, 'slot-old')).toBe(true);
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        `SET LOCAL agenia.sync_origin = 'MIRROR'`,
      );
      expect(tx.scheduleSlot.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'slot-old',
          organizationId: ORG,
          appointments: { none: { status: { not: 'CANCELLED' } } },
        },
        data: { isAvailable: true },
      });

      tx.scheduleSlot.updateMany.mockResolvedValue({ count: 0 });
      expect(await svc.liberarCupoAnterior(ORG, 'slot-old')).toBe(false);
    });
  });
});
