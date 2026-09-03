import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * La operación más destructiva del sistema: borrar una clínica entera, con
 * sus historias clínicas. Es irreversible, así que las pruebas se centran en
 * lo que impide que ocurra por error o sin dejar rastro:
 *
 *  - Segundo factor obligatorio, comparado en tiempo constante, y FAIL-CLOSED
 *    si el servidor no lo tiene configurado.
 *  - Todo dentro de UNA transacción, hijos antes que padres (si falla a la
 *    mitad, la clínica queda entera y no con las FKs rotas).
 *  - La auditoría se escribe DENTRO de la misma transacción: no puede haber
 *    un borrado sin evidencia ni una evidencia sin borrado.
 */
describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: any;
  let tx: any;
  let config: { get: jest.Mock };

  const ORG = 'org-1';
  const ACTOR = {
    actorId: 'u-1',
    actorEmail: 'admin@agenia.co',
    ipAddress: '9.9.9.9',
  };
  const CLAVE = 'clave-de-purga-larga';

  /** Modelo con deleteMany/findMany que devuelve `count` filas borradas. */
  const modelo = (count = 0, filas: unknown[] = []) => ({
    findMany: jest.fn(async () => filas),
    deleteMany: jest.fn(async () => ({ count })),
    delete: jest.fn(async () => ({})),
    count: jest.fn(async () => 0),
  });

  beforeEach(async () => {
    tx = {
      user: modelo(2, [{ id: 'u-1' }]),
      patientProfile: modelo(3, [{ id: 'p-1' }]),
      doctorProfile: modelo(1, [{ id: 'd-1' }]),
      medicalService: modelo(4, [{ id: 's-1' }]),
      eps: modelo(5, [{ id: 'e-1' }]),
      scheduleSlot: modelo(6, [{ id: 'sl-1' }]),
      appointment: modelo(7, [{ id: 'a-1' }]),
      clinicalRecord: modelo(8),
      waitlistEntry: modelo(9),
      interactionLog: modelo(10),
      agentProfile: modelo(11),
      supportTicket: modelo(12),
      organizationSettings: modelo(1),
      aiProviderConfig: modelo(1),
      whatsappAccountConfig: modelo(1),
      organization: { delete: jest.fn(async () => ({})) },
      globalAuditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) },
    };

    prisma = {
      organization: {
        findUnique: jest.fn(async () => ({ id: ORG, name: 'Clínica Demo' })),
      },
      user: { count: jest.fn(async () => 0) },
      patientProfile: { count: jest.fn(async () => 0) },
      appointment: { count: jest.fn(async () => 0) },
      systemLog: { count: jest.fn(async () => 0) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    config = { get: jest.fn(() => CLAVE) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(OrganizationsService);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  // ────────────────────────────────────────────────────────────────
  describe('🔐 segundo factor de la purga', () => {
    it('la clave correcta deja pasar', async () => {
      await expect(service.purge(ORG, CLAVE, ACTOR)).resolves.toMatchObject({
        success: true,
      });
    });

    it.each([
      ['ausente', undefined],
      ['vacía', ''],
    ])('una clave %s se rechaza antes de tocar nada', async (_e, clave) => {
      await expect(service.purge(ORG, clave, ACTOR)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('una clave incorrecta se rechaza', async () => {
      await expect(service.purge(ORG, 'otra-clave', ACTOR)).rejects.toThrow(
        /incorrecta/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('una clave del largo correcto pero distinta también se rechaza', async () => {
      const impostora = 'X'.repeat(CLAVE.length);
      await expect(service.purge(ORG, impostora, ACTOR)).rejects.toThrow(
        /incorrecta/,
      );
    });

    it('🚨 FAIL-CLOSED: sin SUPERADMIN_PURGE_PASSWORD en el servidor, NADIE purga', async () => {
      config.get.mockReturnValue(undefined);

      await expect(service.purge(ORG, 'lo-que-sea', ACTOR)).rejects.toThrow(
        /deshabilitada/,
      );
      expect(service['logger'].error).toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('la comparación no cortocircuita por longitud (anti timing-attack)', () => {
      const iguales = (a: string, b: string) =>
        (
          service as unknown as {
            constantTimeEquals: (a: string, b: string) => boolean;
          }
        ).constantTimeEquals(a, b);

      expect(iguales('abc', 'abc')).toBe(true);
      expect(iguales('abc', 'abd')).toBe(false);
      expect(iguales('abc', 'abcdefghij')).toBe(false);
      expect(iguales('', '')).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe('purge', () => {
    it('una clínica que no existe se rechaza antes de abrir la transacción', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.purge(ORG, CLAVE, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('todo el borrado ocurre en UNA transacción, con timeout amplio', async () => {
      await service.purge(ORG, CLAVE, ACTOR);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][1]).toEqual({
        timeout: 30_000,
        maxWait: 10_000,
      });
    });

    it('las historias clínicas caen ANTES que las citas (si no, revientan las FKs)', async () => {
      const orden: string[] = [];
      tx.clinicalRecord.deleteMany.mockImplementation(async () => {
        orden.push('clinicalRecord');
        return { count: 0 };
      });
      tx.appointment.deleteMany.mockImplementation(async () => {
        orden.push('appointment');
        return { count: 0 };
      });
      tx.scheduleSlot.deleteMany.mockImplementation(async () => {
        orden.push('scheduleSlot');
        return { count: 0 };
      });

      await service.purge(ORG, CLAVE, ACTOR);

      expect(orden).toEqual(['clinicalRecord', 'appointment', 'scheduleSlot']);
    });

    it('la organización se borra al FINAL, después de todos sus hijos', async () => {
      const orden: string[] = [];
      tx.user.deleteMany.mockImplementation(async () => {
        orden.push('user');
        return { count: 0 };
      });
      tx.organization.delete.mockImplementation(async () => {
        orden.push('organization');
        return {};
      });

      await service.purge(ORG, CLAVE, ACTOR);

      expect(orden.indexOf('user')).toBeLessThan(orden.indexOf('organization'));
    });

    it('las historias se buscan por CUALQUIER vínculo, no solo por el escalar', async () => {
      // El escalar `organizationId` es opcional en el esquema y no siempre
      // está poblado: confiar solo en él dejaba historias huérfanas.
      await service.purge(ORG, CLAVE, ACTOR);

      const where = tx.clinicalRecord.deleteMany.mock.calls[0][0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { organizationId: ORG },
          { appointmentId: { in: ['a-1'] } },
          { patientId: { in: ['p-1'] } },
          { doctorId: { in: ['d-1'] } },
        ]),
      );
    });

    it('📜 la auditoría se escribe DENTRO de la transacción, con el actor y su IP', async () => {
      await service.purge(ORG, CLAVE, ACTOR);

      expect(tx.globalAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ORGANIZATION_PURGED',
            actorId: 'u-1',
            actorEmail: 'admin@agenia.co',
            organizationId: ORG,
            organizationName: 'Clínica Demo',
            ipAddress: '9.9.9.9',
          }),
        }),
      );
    });

    it('la auditoría registra CUÁNTO se borró de cada cosa', async () => {
      await service.purge(ORG, CLAVE, ACTOR);

      const { metadata } = tx.globalAuditLog.create.mock.calls[0][0].data;
      expect(metadata.purged).toMatchObject({
        clinicalRecords: 8,
        appointments: 7,
        scheduleSlots: 6,
        patients: 3,
        doctors: 1,
        users: 2,
      });
    });

    it('el resultado devuelve el conteo y el id de la evidencia', async () => {
      const r = await service.purge(ORG, CLAVE, ACTOR);

      expect(r).toMatchObject({
        success: true,
        organizationId: ORG,
        organizationName: 'Clínica Demo',
        auditLogId: 'audit-1',
      });
      expect(r.purged.appointments).toBe(7);
    });

    it('si algo falla a mitad, el error sube y no hay purga a medias', async () => {
      tx.appointment.deleteMany.mockRejectedValue(
        new Error('violación de llave foránea'),
      );

      await expect(service.purge(ORG, CLAVE, ACTOR)).rejects.toThrow(
        /llave foránea/,
      );
      expect(tx.globalAuditLog.create).not.toHaveBeenCalled();
    });

    it('un actor sin identificar no bloquea la purga pero queda anotado como desconocido', async () => {
      await service.purge(ORG, CLAVE, {
        actorId: null,
        actorEmail: null,
        ipAddress: null,
      });

      const { message } = tx.globalAuditLog.create.mock.calls[0][0].data;
      expect(message).toContain('desconocido');
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe('quickStats', () => {
    it('una clínica inexistente se rechaza', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.quickStats(ORG)).rejects.toThrow(NotFoundException);
    });

    it('devuelve solo agregados, nunca registros crudos', async () => {
      prisma.user.count.mockResolvedValue(3);
      prisma.patientProfile.count.mockResolvedValue(120);
      prisma.appointment.count.mockResolvedValue(40);
      prisma.systemLog.count.mockResolvedValue(999);

      const r = await service.quickStats(ORG);

      expect(r).toEqual({
        organizationId: ORG,
        organizationName: 'Clínica Demo',
        metrics: {
          totalDoctors: 3,
          totalPatients: 120,
          totalSchedulers: 3,
          totalScheduledAppointments: 40,
          closedAppointmentsWithRecord: 40,
          closedAppointmentsWithoutRecord: 40,
          aiMessagesProcessed: 999,
        },
      });
    });

    it('🏢 TODAS las agregaciones van acotadas a la organización', async () => {
      await service.quickStats(ORG);

      for (const modelo of [
        prisma.user,
        prisma.patientProfile,
        prisma.appointment,
        prisma.systemLog,
      ]) {
        for (const llamada of modelo.count.mock.calls) {
          expect(llamada[0].where.organizationId).toBe(ORG);
        }
      }
    });

    it('separa las citas cerradas con y sin historia clínica', async () => {
      await service.quickStats(ORG);

      const wheres = prisma.appointment.count.mock.calls.map(
        (c: [{ where: Record<string, unknown> }]) => c[0].where,
      );
      expect(wheres).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ clinicalRecord: { isNot: null } }),
          expect.objectContaining({ clinicalRecord: { is: null } }),
        ]),
      );
    });
  });
});
