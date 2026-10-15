import { LimiteCitasService } from './limite-citas.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * El servicio arma las consultas; la decisión (qué es «el mismo día», cuándo
 * se pasa del límite) vive en @agenia/shared y tiene su propia prueba. Aquí:
 * que pregunte lo correcto a la base y que la solicitud de revisión no se
 * duplique ni se pueda abusar.
 */
describe('LimiteCitasService', () => {
  const ORG = 'org-1';
  // Martes 20 de octubre de 2026, 8:37 p. m. en Bogotá = 01:37 del 21 en UTC.
  const FECHA = new Date('2026-10-21T01:37:00.000Z');

  let db: {
    organizationSettings: { findUnique: jest.Mock };
    organization: { findUnique: jest.Mock };
    patientProfile: { findMany: jest.Mock };
    appointment: { count: jest.Mock };
    appointmentLimitRequest: {
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
  };
  let service: LimiteCitasService;
  /** Citas que devuelve el conteo, por periodo: [día, mes]. */
  let citas: { dia: number; mes: number };

  beforeEach(() => {
    citas = { dia: 0, mes: 0 };
    db = {
      organizationSettings: { findUnique: jest.fn(async () => null) },
      organization: { findUnique: jest.fn(async () => ({ timezone: null })) },
      patientProfile: {
        findMany: jest.fn(async () => [
          { id: 'pat-1', cedula: '1088123456', fullName: 'Ana Ruiz' },
        ]),
      },
      appointment: {
        count: jest.fn(async ({ where }: any) => {
          const desde: Date = where.scheduleSlot.startTime.gte;
          const hasta: Date = where.scheduleSlot.startTime.lt;
          const dias = (hasta.getTime() - desde.getTime()) / 86_400_000;
          return dias <= 1 ? citas.dia : citas.mes;
        }),
      },
      appointmentLimitRequest: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
        create: jest.fn(async () => ({ id: 'sol-nueva' })),
      },
    };
    service = new LimiteCitasService(db as unknown as PrismaService);
  });

  describe('evaluar', () => {
    const evaluar = (extra: Record<string, unknown> = {}) =>
      service.evaluar({
        organizationId: ORG,
        cedula: '1.088.123.456',
        fecha: FECHA,
        ...extra,
      });

    it('sin citas ese día ni ese mes, se puede', async () => {
      expect(await evaluar()).toBeNull();
    });

    it('con una cita ese día (límite por defecto: 1), no se puede, y dice de quién', async () => {
      citas = { dia: 1, mes: 1 };
      expect(await evaluar()).toMatchObject({
        tipo: 'DAILY',
        limite: 1,
        citas: 1,
        periodo: { clave: '2026-10-20' },
        paciente: { id: 'pat-1', cedula: '1088123456', fullName: 'Ana Ruiz' },
      });
    });

    it('cuenta en el día de Bogotá, solo citas vigentes de esa cédula en la clínica', async () => {
      citas = { dia: 1, mes: 1 };
      await evaluar();
      const dia = db.appointment.count.mock.calls
        .map((c) => c[0].where)
        .find(
          (w: any) =>
            w.scheduleSlot.startTime.lt - w.scheduleSlot.startTime.gte <=
            86_400_000,
        );
      expect(dia).toEqual({
        organizationId: ORG,
        patientId: { in: ['pat-1'] },
        status: { not: 'CANCELLED' },
        scheduleSlot: {
          startTime: {
            gte: new Date('2026-10-20T05:00:00.000Z'),
            lt: new Date('2026-10-21T05:00:00.000Z'),
          },
        },
      });
    });

    it('busca la ficha por las variantes del documento, en las dos direcciones de los ceros', async () => {
      await service.evaluar({
        organizationId: ORG,
        cedula: '0012.345',
        fecha: FECHA,
      });
      expect(db.patientProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG,
            OR: [
              { cedula: { in: ['0012.345', '0012345', '12345'] } },
              { cedula: { endsWith: '12345' } },
            ],
          },
        }),
      );
    });

    it('la ficha guardada con ceros a la izquierda es del paciente que los omite', async () => {
      db.patientProfile.findMany.mockResolvedValue([
        { id: 'pat-ceros', cedula: '001088123456', fullName: 'Ana Ruiz' },
      ]);
      citas = { dia: 1, mes: 1 };
      expect(await evaluar()).toMatchObject({
        paciente: { id: 'pat-ceros', cedula: '1088123456' },
      });
    });

    it('un documento más largo que solo termina igual NO es el mismo paciente', async () => {
      db.patientProfile.findMany.mockResolvedValue([
        { id: 'otro', cedula: '91088123456', fullName: 'Otra Persona' },
      ]);
      citas = { dia: 5, mes: 5 };
      expect(await evaluar()).toBeNull();
      expect(db.appointment.count).not.toHaveBeenCalled();
    });

    it('cambio de fecha: la cita que se mueve no cuenta contra sí misma', async () => {
      await evaluar({ excluirCitaId: 'apt-9' });
      for (const [arg] of db.appointment.count.mock.calls) {
        expect(arg.where.id).toEqual({ not: 'apt-9' });
      }
    });

    it('un paciente sin ficha no tiene citas: se puede, sin contar nada', async () => {
      db.patientProfile.findMany.mockResolvedValue([]);
      expect(await evaluar()).toBeNull();
      expect(db.appointment.count).not.toHaveBeenCalled();
    });

    it('con los dos límites apagados no consulta nada más', async () => {
      db.organizationSettings.findUnique.mockResolvedValue({
        dailyAppointmentLimitEnabled: false,
        maxAppointmentsPerDay: 1,
        monthlyAppointmentLimitEnabled: false,
        maxAppointmentsPerMonth: 3,
      });
      citas = { dia: 9, mes: 9 };
      expect(await evaluar()).toBeNull();
      expect(db.patientProfile.findMany).not.toHaveBeenCalled();
    });

    it('respeta los valores de la clínica (2 al día, 4 al mes)', async () => {
      db.organizationSettings.findUnique.mockResolvedValue({
        dailyAppointmentLimitEnabled: true,
        maxAppointmentsPerDay: 2,
        monthlyAppointmentLimitEnabled: true,
        maxAppointmentsPerMonth: 4,
      });
      citas = { dia: 1, mes: 3 };
      expect(await evaluar()).toBeNull();
      citas = { dia: 1, mes: 4 };
      expect(await evaluar()).toMatchObject({ tipo: 'MONTHLY', limite: 4 });
    });

    it('las citas adicionales aprobadas para ese periodo suben el tope', async () => {
      citas = { dia: 1, mes: 1 };
      db.appointmentLimitRequest.findMany.mockResolvedValue([
        { kind: 'DAILY', extraGranted: 1 },
      ]);
      expect(await evaluar()).toBeNull();
      expect(db.appointmentLimitRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG,
            status: 'APPROVED',
            OR: [
              { kind: 'DAILY', periodKey: '2026-10-20' },
              { kind: 'MONTHLY', periodKey: '2026-10' },
            ],
          }),
        }),
      );

      citas = { dia: 2, mes: 2 };
      expect(await evaluar()).toMatchObject({
        tipo: 'DAILY',
        limite: 2,
        limiteBase: 1,
      });
    });

    it('usa la zona de la clínica si la tiene', async () => {
      db.organization.findUnique.mockResolvedValue({
        timezone: 'America/Mexico_City',
      });
      citas = { dia: 1, mes: 1 };
      // 01:37 UTC del 21 = 7:37 p. m. del 20 en Ciudad de México.
      expect((await evaluar())?.periodo.clave).toBe('2026-10-20');
    });

    it('sirve dentro de una transacción (recibe el cliente)', async () => {
      const otro = {
        ...db,
        patientProfile: { findMany: jest.fn(async () => []) },
      };
      await service.evaluar(
        { organizationId: ORG, cedula: '1', fecha: FECHA },
        otro as any,
      );
      expect(otro.patientProfile.findMany).toHaveBeenCalled();
      expect(db.patientProfile.findMany).not.toHaveBeenCalled();
    });
  });

  describe('prepararSolicitud', () => {
    const AHORA = new Date('2026-10-14T15:00:00.000Z');
    const limite = {
      tipo: 'DAILY' as const,
      limite: 1,
      limiteBase: 1,
      citas: 1,
      periodo: {
        tipo: 'DAILY' as const,
        clave: '2026-10-20',
        desde: new Date('2026-10-20T05:00:00.000Z'),
        hasta: new Date('2026-10-21T05:00:00.000Z'),
      },
      paciente: { id: 'pat-1', cedula: '1088123456', fullName: 'Ana Ruiz' },
    };
    const preparar = () =>
      service.prepararSolicitud({
        organizationId: ORG,
        limite,
        canal: 'WHATSAPP',
        telefono: '573001112233',
        operacion: 'BOOKING',
        fechaSolicitada: FECHA,
        servicio: 'Medicina General',
        ahora: AHORA,
      });

    it('crea la invitación con el contexto del freno y vence en 7 días', async () => {
      expect(await preparar()).toEqual({
        estado: 'ENLACE',
        solicitudId: 'sol-nueva',
      });
      expect(db.appointmentLimitRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG,
          cedula: '1088123456',
          fullName: 'Ana Ruiz',
          phone: '573001112233',
          kind: 'DAILY',
          periodKey: '2026-10-20',
          channel: 'WHATSAPP',
          operation: 'BOOKING',
          requestedSlotAt: FECHA,
          serviceName: 'Medicina General',
          limitAtRequest: 1,
          countAtRequest: 1,
          expiresAt: new Date('2026-10-21T15:00:00.000Z'),
        }),
        select: { id: true },
      });
    });

    it('si ya le mandó un enlace vigente para ese periodo, lo reutiliza (no deja filas repetidas)', async () => {
      db.appointmentLimitRequest.findFirst.mockResolvedValue({
        id: 'sol-vieja',
      });
      expect(await preparar()).toEqual({
        estado: 'ENLACE',
        solicitudId: 'sol-vieja',
      });
      expect(db.appointmentLimitRequest.create).not.toHaveBeenCalled();
      expect(db.appointmentLimitRequest.update).toHaveBeenCalledWith({
        where: { id: 'sol-vieja' },
        data: expect.objectContaining({
          countAtRequest: 1,
          requestedSlotAt: FECHA,
        }),
      });
      // Solo reutiliza invitaciones sin usar y vigentes, del mismo periodo.
      expect(db.appointmentLimitRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG,
            kind: 'DAILY',
            periodKey: '2026-10-20',
            status: 'INVITED',
            expiresAt: { gt: AHORA },
          }),
        }),
      );
    });

    it('con una revisión en curso para ese periodo, no abre otra', async () => {
      db.appointmentLimitRequest.count.mockResolvedValue(1);
      expect(await preparar()).toEqual({ estado: 'EN_REVISION' });
      expect(db.appointmentLimitRequest.create).not.toHaveBeenCalled();
    });

    it('con el máximo de solicitudes radicadas para ese periodo, ya no manda enlace', async () => {
      db.appointmentLimitRequest.count.mockImplementation(
        async ({ where }: any) => (where.status === 'PENDING' ? 0 : 3),
      );
      expect(await preparar()).toEqual({ estado: 'SIN_ENLACE' });
      expect(db.appointmentLimitRequest.create).not.toHaveBeenCalled();
    });

    it('por Telegram no hay teléfono: la fila nace sin él', async () => {
      await service.prepararSolicitud({
        organizationId: ORG,
        limite,
        canal: 'TELEGRAM',
        telefono: null,
        operacion: 'RESCHEDULE',
        fechaSolicitada: FECHA,
        ahora: AHORA,
      });
      const data = db.appointmentLimitRequest.create.mock.calls[0][0].data;
      expect(data.channel).toBe('TELEGRAM');
      expect(data.operation).toBe('RESCHEDULE');
      expect(data).not.toHaveProperty('phone');
    });
  });
});
