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
  });
});
