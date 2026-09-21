import { Prisma } from '@agenia/database';
import {
  MirrorExceptionsService,
  type EntradaExcepcion,
} from './mirror-exceptions.service';

/**
 * El ciclo de vida de una excepción de sincronización: qué pasa con la fila cuando
 * el problema se vuelve a encontrar, cambia o desaparece. Lo que se fija:
 *
 *  · el mismo problema actualiza la MISMA fila (no abre otra);
 *  · la gravedad solo sube;
 *  · una decisión humana es firme; lo que cerró el sistema se reabre si vuelve;
 *  · dos réplicas de la API pueden correr a la vez: todo es compare-and-set.
 */
describe('MirrorExceptionsService', () => {
  const ORG = 'org-1';
  const AHORA = new Date('2026-09-22T15:00:00.000Z');

  const entrada = (over: Partial<EntradaExcepcion> = {}): EntradaExcepcion => ({
    kind: 'CITA_NO_ENTREGADA',
    dedupeKey: 'cita:apt-1:7',
    severity: 'MEDIA',
    title: 'Cita que el hospital aún no tiene',
    detail: 'Lleva 25 min en la cola',
    appointmentId: 'apt-1',
    outboxSeq: BigInt(7),
    epsId: 'eps-1',
    doctorId: 'doc-1',
    appointmentStartAt: new Date('2026-09-25T15:00:00.000Z'),
    meta: { motivo: 'EN_COLA' },
    ...over,
  });

  const fila = (over: Record<string, unknown> = {}) => ({
    id: 'ex-1',
    organizationId: ORG,
    status: 'ABIERTA',
    severity: 'MEDIA',
    detail: 'Lleva 25 min en la cola',
    occurrences: 1,
    lastSeenAt: new Date(AHORA.getTime() - 60_000),
    assignedToUserId: null,
    ...over,
  });

  const build = (existente: unknown = null) => {
    const prisma = {
      syncException: {
        findUnique: jest.fn(async (..._a: unknown[]) => existente),
        create: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'ex-nueva',
            ...data,
          }),
        ),
        update: jest.fn(async (..._a: unknown[]) => ({})),
        updateMany: jest.fn(async (..._a: unknown[]) => ({ count: 1 })),
      },
      syncExceptionLog: { create: jest.fn(async (..._a: unknown[]) => ({})) },
    };
    return { service: new MirrorExceptionsService(prisma as never), prisma };
  };

  const acciones = (p: ReturnType<typeof build>['prisma']) =>
    p.syncExceptionLog.create.mock.calls.map(
      (c) => (c[0] as { data: { action: string } }).data.action,
    );

  describe('un problema nuevo', () => {
    it('abre una excepción ABIERTA, de esa clínica, con lo que se sabe y su primera constancia', async () => {
      const { service, prisma } = build();

      await expect(service.registrar(ORG, entrada(), AHORA)).resolves.toBe(
        'CREADA',
      );

      expect(prisma.syncException.create.mock.calls[0][0]).toMatchObject({
        data: {
          organizationId: ORG,
          kind: 'CITA_NO_ENTREGADA',
          dedupeKey: 'cita:apt-1:7',
          severity: 'MEDIA',
          status: 'ABIERTA',
          appointmentId: 'apt-1',
          outboxSeq: BigInt(7),
          epsId: 'eps-1',
          doctorId: 'doc-1',
          firstSeenAt: AHORA,
          lastSeenAt: AHORA,
          occurrences: 1,
        },
      });
      expect(acciones(prisma)).toEqual(['CREADA']);
    });

    it('la busca por su identidad DENTRO de la clínica', async () => {
      const { service, prisma } = build();
      await service.registrar(ORG, entrada(), AHORA);
      expect(prisma.syncException.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_dedupeKey: {
            organizationId: ORG,
            dedupeKey: 'cita:apt-1:7',
          },
        },
      });
    });

    it('sin datos estructurados: meta queda en nulo de la base, no en el JSON "null"', async () => {
      const { service, prisma } = build();
      await service.registrar(ORG, entrada({ meta: null }), AHORA);
      expect(
        (
          prisma.syncException.create.mock.calls[0][0] as {
            data: { meta: unknown };
          }
        ).data.meta,
      ).toBe(Prisma.DbNull);
    });

    it('la auditoría fija cuántas veces se repitió y cuándo fue la última', async () => {
      const { service, prisma } = build();
      const ultima = new Date('2026-09-22T14:30:00.000Z');
      await service.registrar(
        ORG,
        entrada({ kind: 'ERROR_SYNC', occurrences: 14, lastSeenAt: ultima }),
        AHORA,
      );
      expect(prisma.syncException.create.mock.calls[0][0]).toMatchObject({
        data: { occurrences: 14, lastSeenAt: ultima },
      });
    });
  });

  describe('dos réplicas a la vez', () => {
    it('🏁 si otra réplica la abrió en ese instante (P2002), se actualiza en vez de fallar', async () => {
      const { service, prisma } = build();
      prisma.syncException.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(fila({ severity: 'MEDIA' }));
      prisma.syncException.create.mockRejectedValueOnce(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );

      await expect(
        service.registrar(ORG, entrada({ detail: 'otro detalle' }), AHORA),
      ).resolves.toBe('ACTUALIZADA');
      expect(prisma.syncException.create).toHaveBeenCalledTimes(1);
      expect(prisma.syncException.update).toHaveBeenCalledTimes(1);
    });

    it('un choque persistente NO entra en bucle: al segundo intento se propaga', async () => {
      const { service, prisma } = build();
      prisma.syncException.create.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );

      await expect(service.registrar(ORG, entrada(), AHORA)).rejects.toThrow(
        'unique',
      );
      expect(prisma.syncException.create).toHaveBeenCalledTimes(2);
    });

    it('cualquier otro error de la base se propaga tal cual', async () => {
      const { service, prisma } = build();
      prisma.syncException.create.mockRejectedValueOnce(
        new Error('connection refused'),
      );
      await expect(service.registrar(ORG, entrada(), AHORA)).rejects.toThrow(
        'connection refused',
      );
    });
  });

  describe('una decisión humana es firme', () => {
    it.each(['RESUELTA', 'DESCARTADA'])(
      'una %s NO se reabre aunque el problema siga ahí',
      async (status) => {
        const { service, prisma } = build(fila({ status }));

        await expect(
          service.registrar(ORG, entrada({ severity: 'CRITICA' }), AHORA),
        ).resolves.toBe('IGNORADA');

        expect(prisma.syncException.update).not.toHaveBeenCalled();
        expect(prisma.syncException.updateMany).not.toHaveBeenCalled();
        expect(prisma.syncException.create).not.toHaveBeenCalled();
        expect(prisma.syncExceptionLog.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('lo que el sistema cerró solo se reabre si el problema vuelve', () => {
    it('AUTO_RESUELTA → ABIERTA, sin dueño, sin cierre y con el aviso a cero (para que VUELVA a avisar)', async () => {
      const { service, prisma } = build(
        fila({ status: 'AUTO_RESUELTA', assignedToUserId: 'u-9' }),
      );

      await expect(
        service.registrar(ORG, entrada({ severity: 'ALTA' }), AHORA),
      ).resolves.toBe('REABIERTA');

      const arg = prisma.syncException.updateMany.mock.calls[0][0] as {
        where: unknown;
        data: Record<string, unknown>;
      };
      // Compare-and-set: solo se reabre si sigue AUTO_RESUELTA.
      expect(arg.where).toEqual({ id: 'ex-1', status: 'AUTO_RESUELTA' });
      expect(arg.data).toMatchObject({
        status: 'ABIERTA',
        severity: 'ALTA',
        assignedToUserId: null,
        resolvedAt: null,
        resolvedByUserId: null,
        resolutionNote: null,
        notifiedAt: null,
        notifiedSeverity: null,
      });
      expect(acciones(prisma)).toEqual(['REAPARECIDA']);
    });

    it('si alguien la tocó entre la lectura y el cambio, no se pisa', async () => {
      const { service, prisma } = build(fila({ status: 'AUTO_RESUELTA' }));
      prisma.syncException.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.registrar(ORG, entrada(), AHORA)).resolves.toBe(
        'SIN_CAMBIOS',
      );
      expect(prisma.syncExceptionLog.create).not.toHaveBeenCalled();
    });
  });

  describe('una excepción activa', () => {
    it('sin cambios y vista hace poco: NO se reescribe (el vigilante corre cada pocos minutos)', async () => {
      const { service, prisma } = build(fila());

      await expect(service.registrar(ORG, entrada(), AHORA)).resolves.toBe(
        'SIN_CAMBIOS',
      );

      expect(prisma.syncException.update).not.toHaveBeenCalled();
      expect(prisma.syncExceptionLog.create).not.toHaveBeenCalled();
    });

    it('sin cambios pero vista hace más de 15 min: se refresca `lastSeenAt`', async () => {
      const { service, prisma } = build(
        fila({ lastSeenAt: new Date(AHORA.getTime() - 20 * 60_000) }),
      );

      await expect(service.registrar(ORG, entrada(), AHORA)).resolves.toBe(
        'ACTUALIZADA',
      );

      expect(prisma.syncException.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'ex-1' },
        data: { lastSeenAt: AHORA },
      });
    });

    it('⬆️ si la gravedad SUBE, escala y lo deja anotado', async () => {
      const { service, prisma } = build(fila({ severity: 'MEDIA' }));

      await expect(
        service.registrar(ORG, entrada({ severity: 'CRITICA' }), AHORA),
      ).resolves.toBe('ESCALADA');

      expect(prisma.syncException.update.mock.calls[0][0]).toMatchObject({
        data: { severity: 'CRITICA' },
      });
      expect(prisma.syncExceptionLog.create.mock.calls[0][0]).toMatchObject({
        data: { action: 'ESCALADA', note: 'MEDIA → CRITICA' },
      });
    });

    it('⬇️ la gravedad NUNCA baja sola, ni siquiera cuando cambia otra cosa', async () => {
      const { service, prisma } = build(fila({ severity: 'CRITICA' }));

      await expect(
        service.registrar(
          ORG,
          entrada({ severity: 'MEDIA', detail: 'otro detalle' }),
          AHORA,
        ),
      ).resolves.toBe('ACTUALIZADA');

      expect(
        (
          prisma.syncException.update.mock.calls[0][0] as {
            data: { severity: string };
          }
        ).data.severity,
      ).toBe('CRITICA');
      expect(acciones(prisma)).toEqual([]);
    });

    it('si cambia el detalle técnico, se actualiza', async () => {
      const { service, prisma } = build(fila());
      await expect(
        service.registrar(ORG, entrada({ detail: 'Failed to connect' }), AHORA),
      ).resolves.toBe('ACTUALIZADA');
      expect(prisma.syncException.update.mock.calls[0][0]).toMatchObject({
        data: { detail: 'Failed to connect' },
      });
    });

    it('si la auditoría cuenta más repeticiones, se actualiza con el nuevo total y la última fecha', async () => {
      const { service, prisma } = build(fila({ occurrences: 3 }));
      const ultima = new Date('2026-09-22T14:59:00.000Z');

      await expect(
        service.registrar(
          ORG,
          entrada({ occurrences: 5, lastSeenAt: ultima }),
          AHORA,
        ),
      ).resolves.toBe('ACTUALIZADA');

      expect(prisma.syncException.update.mock.calls[0][0]).toMatchObject({
        data: { occurrences: 5, lastSeenAt: ultima },
      });
    });

    it('👤 una EN_REVISION se actualiza igual y NO le cambia el dueño ni el estado', async () => {
      const { service, prisma } = build(
        fila({ status: 'EN_REVISION', assignedToUserId: 'u-9' }),
      );

      await service.registrar(ORG, entrada({ severity: 'ALTA' }), AHORA);

      const data = (
        prisma.syncException.update.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('assignedToUserId');
    });
  });

  describe('autoResolver', () => {
    it('cierra solo lo ACTIVO de esa clínica (compare-and-set) y deja la constancia', async () => {
      const { service, prisma } = build();

      await expect(
        service.autoResolver(
          ORG,
          'ex-1',
          'El envío ya llegó al hospital.',
          AHORA,
        ),
      ).resolves.toBe(true);

      expect(prisma.syncException.updateMany.mock.calls[0][0]).toMatchObject({
        where: {
          id: 'ex-1',
          organizationId: ORG,
          status: { in: ['ABIERTA', 'EN_REVISION'] },
        },
        data: {
          status: 'AUTO_RESUELTA',
          assignedToUserId: null,
          assignedAt: null,
          resolvedAt: AHORA,
          resolvedByUserId: null,
          resolutionNote: 'El envío ya llegó al hospital.',
        },
      });
      expect(prisma.syncExceptionLog.create.mock.calls[0][0]).toMatchObject({
        data: {
          exceptionId: 'ex-1',
          action: 'AUTO_RESUELTA',
          actorUserId: null,
        },
      });
    });

    it('si alguien la cerró antes (a mano), no se pisa y no deja constancia', async () => {
      const { service, prisma } = build();
      prisma.syncException.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.autoResolver(ORG, 'ex-1', 'x', AHORA)).resolves.toBe(
        false,
      );
      expect(prisma.syncExceptionLog.create).not.toHaveBeenCalled();
    });

    it('una nota larguísima se recorta', async () => {
      const { service, prisma } = build();
      await service.autoResolver(ORG, 'ex-1', 'x'.repeat(2000), AHORA);
      expect(
        (
          prisma.syncException.updateMany.mock.calls[0][0] as {
            data: { resolutionNote: string };
          }
        ).data.resolutionNote,
      ).toHaveLength(500);
    });
  });

  describe('reclamar el aviso (compare-and-set)', () => {
    it('la primera vez (nunca avisada) solo gana si SIGUE abierta y sin aviso previo', async () => {
      const { service, prisma } = build();

      await expect(
        service.reclamarAviso(
          { id: 'ex-1', severity: 'MEDIA', notifiedSeverity: null },
          AHORA,
        ),
      ).resolves.toBe(true);

      expect(prisma.syncException.updateMany.mock.calls[0][0]).toEqual({
        where: { id: 'ex-1', status: 'ABIERTA', notifiedSeverity: null },
        data: { notifiedAt: AHORA, notifiedSeverity: 'MEDIA' },
      });
    });

    it('al subir de gravedad reclama sobre la gravedad anterior', async () => {
      const { service, prisma } = build();
      await service.reclamarAviso(
        { id: 'ex-1', severity: 'ALTA', notifiedSeverity: 'MEDIA' },
        AHORA,
      );
      expect(prisma.syncException.updateMany.mock.calls[0][0]).toMatchObject({
        where: { notifiedSeverity: 'MEDIA' },
      });
    });

    it('🏁 si otra réplica ya la reclamó (0 filas), esta NO avisa', async () => {
      const { service, prisma } = build();
      prisma.syncException.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.reclamarAviso(
          { id: 'ex-1', severity: 'MEDIA', notifiedSeverity: null },
          AHORA,
        ),
      ).resolves.toBe(false);
    });

    it('si el aviso no salió, se devuelve la reclamación SOLO si sigue siendo la de esta vuelta', async () => {
      const { service, prisma } = build();
      const previo = new Date('2026-09-22T10:00:00.000Z');

      await service.devolverAviso(
        { id: 'ex-1', notifiedAt: previo, notifiedSeverity: 'MEDIA' },
        AHORA,
      );

      expect(prisma.syncException.updateMany.mock.calls[0][0]).toEqual({
        where: { id: 'ex-1', notifiedAt: AHORA },
        data: { notifiedAt: previo, notifiedSeverity: 'MEDIA' },
      });
    });
  });

  describe('el historial', () => {
    it('perder una línea NO tumba al vigilante', async () => {
      const { service, prisma } = build();
      prisma.syncExceptionLog.create.mockRejectedValueOnce(
        new Error('db caída'),
      );
      await expect(
        service.anotar('ex-1', 'TOMADA', 'u-1', 'BOOKING_AGENT', 'nota'),
      ).resolves.toBeUndefined();
    });

    it('guarda quién (id y rol) y una nota acotada', async () => {
      const { service, prisma } = build();
      await service.anotar(
        'ex-1',
        'TOMADA',
        'u-1',
        'BOOKING_AGENT',
        'x'.repeat(900),
      );
      expect(prisma.syncExceptionLog.create.mock.calls[0][0]).toMatchObject({
        data: {
          exceptionId: 'ex-1',
          action: 'TOMADA',
          actorUserId: 'u-1',
          actorRole: 'BOOKING_AGENT',
        },
      });
      expect(
        (
          prisma.syncExceptionLog.create.mock.calls[0][0] as {
            data: { note: string };
          }
        ).data.note,
      ).toHaveLength(500);
    });
  });
});
