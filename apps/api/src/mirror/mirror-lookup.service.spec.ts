import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import { MirrorLookupService } from './mirror-lookup.service';

/**
 * Consulta en vivo al HIS (rastreo de paciente, Fase 2) — el lado del agente.
 * Lo que este servicio garantiza:
 *
 *  · con el interruptor apagado no entrega nada (y no es un error);
 *  · el tenant es parte de toda búsqueda;
 *  · una consulta por cupo NO le manda al agente el documento del paciente;
 *  · lo que el agente responde no se guarda tal cual: el documento de un tercero
 *    sale enmascarado y lo que nadie pidió se descarta;
 *  · una respuesta mal formada NO se convierte en "el HIS no tiene nada";
 *  · una petición se responde UNA sola vez (compare-and-set);
 *  · lo vencido se expira y se purga (`params` lleva un documento).
 */
describe('MirrorLookupService', () => {
  const ORG = 'org-1';
  const INI = '2026-09-22T15:00:00.000Z';
  const DESDE = '2026-09-01T05:00:00.000Z';
  const HASTA = '2026-12-01T05:00:00.000Z';

  const PARAMS_DOC = {
    patientDocuments: ['1088123456'],
    fromIso: DESDE,
    toIso: HASTA,
  };
  const PARAMS_CUPO = {
    slots: [{ doctorExternalKey: '76', startTimeIso: INI }],
    compareDocuments: ['1088123456'],
  };

  const fila = (over: Record<string, unknown> = {}) => ({
    doctorExternalKey: '76',
    startTimeIso: INI,
    serviceExternalKey: '890201',
    patientDocument: '1088123456',
    status: 'SCHEDULED',
    ...over,
  });

  const peticion = (over: Record<string, unknown> = {}) => ({
    id: 'req-1',
    organizationId: ORG,
    kind: 'BY_DOCUMENT',
    params: PARAMS_DOC,
    status: 'PENDIENTE',
    createdAt: new Date(),
    ...over,
  });

  const build = (opts?: {
    lookupEnabled?: boolean | null;
    pendientes?: unknown[];
    request?: unknown;
    updateManyCount?: number;
  }) => {
    const prisma = {
      hospitalMirrorConfig: {
        findUnique: jest.fn(async () =>
          opts?.lookupEnabled === null
            ? null
            : { lookupEnabled: opts?.lookupEnabled ?? true },
        ),
      },
      hisLookupRequest: {
        findMany: jest.fn(async () => opts?.pendientes ?? []),
        findFirst: jest.fn(async () =>
          opts && 'request' in opts ? opts.request : peticion(),
        ),
        updateMany: jest.fn(async () => ({
          count: opts?.updateManyCount ?? 1,
        })),
      },
    };
    const service = new MirrorLookupService(prisma as never);
    return { service, prisma };
  };

  const datosUltimoUpdate = (prisma: ReturnType<typeof build>['prisma']) =>
    prisma.hisLookupRequest.updateMany.mock.calls.at(-1)![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };

  // ══════════════════════════════════════════════════════════════════════
  describe('getPendingRequests', () => {
    it('con el interruptor APAGADO devuelve [] sin mirar las peticiones (y sin error)', async () => {
      const { service, prisma } = build({ lookupEnabled: false });

      await expect(service.getPendingRequests(ORG)).resolves.toEqual([]);
      expect(prisma.hisLookupRequest.findMany).not.toHaveBeenCalled();
    });

    it('sin configuración de espejo también devuelve []', async () => {
      const { service } = build({ lookupEnabled: null });
      await expect(service.getPendingRequests(ORG)).resolves.toEqual([]);
    });

    it('pide SOLO las de su organización, pendientes y recientes, de la más vieja a la más nueva', async () => {
      const { service, prisma } = build();

      await service.getPendingRequests(ORG);

      const arg = prisma.hisLookupRequest.findMany.mock.calls[0][0] as {
        where: {
          organizationId: string;
          status: string;
          createdAt: { gte: Date };
        };
        orderBy: unknown;
        take: number;
      };
      expect(arg.where.organizationId).toBe(ORG);
      expect(arg.where.status).toBe('PENDIENTE');
      expect(arg.orderBy).toEqual({ createdAt: 'asc' });
      expect(arg.take).toBeLessThanOrEqual(5);
      // "Recientes": no se le entrega al agente lo que la pantalla ya abandonó.
      const edad = Date.now() - arg.where.createdAt.gte.getTime();
      expect(edad).toBeGreaterThanOrEqual(59_000);
      expect(edad).toBeLessThanOrEqual(61_000);
    });

    it('por documento: entrega lo que se pregunta', async () => {
      const { service } = build({ pendientes: [peticion()] });

      await expect(service.getPendingRequests(ORG)).resolves.toEqual([
        {
          requestId: 'req-1',
          kind: 'BY_DOCUMENT',
          patientDocuments: ['1088123456'],
          fromIso: DESDE,
          toIso: HASTA,
        },
      ]);
    });

    it('🔒 por cupo: el documento del paciente NO viaja al agente', async () => {
      const { service } = build({
        pendientes: [peticion({ kind: 'BY_SLOT', params: PARAMS_CUPO })],
      });

      const [dto] = await service.getPendingRequests(ORG);

      expect(dto).toEqual({
        requestId: 'req-1',
        kind: 'BY_SLOT',
        slots: [{ doctorExternalKey: '76', startTimeIso: INI }],
      });
      expect(JSON.stringify(dto)).not.toContain('1088123456');
      expect(JSON.stringify(dto)).not.toContain('compareDocuments');
    });

    it('params inválidos: NO se le mandan al agente y la petición se cierra con error', async () => {
      const { service, prisma } = build({
        pendientes: [
          peticion({ id: 'mala', params: { patientDocuments: ['12'] } }),
          peticion({ id: 'buena' }),
        ],
      });

      const salida = await service.getPendingRequests(ORG);

      expect(salida.map((d) => d.requestId)).toEqual(['buena']);
      const { where, data } = datosUltimoUpdate(prisma);
      expect(where).toEqual({
        id: 'mala',
        organizationId: ORG,
        status: 'PENDIENTE',
      });
      expect(data).toMatchObject({
        status: 'ERROR',
        error: 'Petición inválida.',
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  describe('applyResult', () => {
    it('busca la petición DENTRO de la organización: la de otra clínica no existe', async () => {
      const { service, prisma } = build({ request: null });

      await expect(
        service.applyResult(ORG, {
          requestId: 'de-otra-clinica',
          appointments: [],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.hisLookupRequest.findFirst).toHaveBeenCalledWith({
        where: { id: 'de-otra-clinica', organizationId: ORG },
      });
      expect(prisma.hisLookupRequest.updateMany).not.toHaveBeenCalled();
    });

    it.each(['RESUELTA', 'ERROR', 'EXPIRADA'])(
      'una petición ya %s no se vuelve a responder (reintento del agente): stored=false, sin escribir',
      async (status) => {
        const { service, prisma } = build({ request: peticion({ status }) });

        await expect(
          service.applyResult(ORG, {
            requestId: 'req-1',
            appointments: [fila()],
          }),
        ).resolves.toEqual({ requestId: 'req-1', stored: false });
        expect(prisma.hisLookupRequest.updateMany).not.toHaveBeenCalled();
      },
    );

    it('una respuesta TARDÍA se descarta y la petición queda EXPIRADA, sin guardar datos', async () => {
      const { service, prisma } = build({
        request: peticion({ createdAt: new Date(Date.now() - 61_000) }),
      });

      await expect(
        service.applyResult(ORG, {
          requestId: 'req-1',
          appointments: [fila()],
        }),
      ).resolves.toEqual({ requestId: 'req-1', stored: false });

      const { data } = datosUltimoUpdate(prisma);
      expect(data.status).toBe('EXPIRADA');
      expect(data).not.toHaveProperty('result');
    });

    describe('respuestas sin citas', () => {
      it('unsupported → ERROR con el motivo', async () => {
        const { service, prisma } = build();

        await expect(
          service.applyResult(ORG, {
            requestId: 'req-1',
            appointments: [],
            unsupported: true,
          }),
        ).resolves.toEqual({ requestId: 'req-1', stored: true });
        expect(datosUltimoUpdate(prisma).data).toMatchObject({
          status: 'ERROR',
          error: expect.stringContaining('no implementa'),
        });
      });

      it('error del agente → ERROR con su texto, recortado', async () => {
        const { service, prisma } = build();

        await service.applyResult(ORG, {
          requestId: 'req-1',
          appointments: [],
          error: 'x'.repeat(2000),
        });

        const { data } = datosUltimoUpdate(prisma);
        expect(data.status).toBe('ERROR');
        expect(data.error).toHaveLength(300);
      });

      it('un error en blanco no cuenta como error: se procesa como respuesta', async () => {
        const { service, prisma } = build();

        await service.applyResult(ORG, {
          requestId: 'req-1',
          appointments: [],
          error: '   ',
        });

        expect(datosUltimoUpdate(prisma).data.status).toBe('RESUELTA');
      });
    });

    it.each([
      ['sin la lista de citas', {}],
      ['con la lista como texto', { appointments: 'nada' }],
      ['con la lista como objeto', { appointments: { 0: fila() } }],
      ['con la lista nula', { appointments: null }],
    ])(
      '🚨 una respuesta %s es un ERROR, NO "el HIS no tiene nada"',
      async (_n, cuerpo) => {
        const { service, prisma } = build();

        await service.applyResult(ORG, {
          requestId: 'req-1',
          ...cuerpo,
        } as never);

        const { data } = datosUltimoUpdate(prisma);
        expect(data.status).toBe('ERROR');
        expect(data).not.toHaveProperty('result');
      },
    );

    it('la petición con params inválidos (fila corrupta) se cierra con error en vez de guardar nada', async () => {
      const { service, prisma } = build({
        request: peticion({ params: { patientDocuments: [] } }),
      });

      await service.applyResult(ORG, {
        requestId: 'req-1',
        appointments: [fila()],
      });

      expect(datosUltimoUpdate(prisma).data).toMatchObject({
        status: 'ERROR',
        error: 'Petición inválida.',
      });
    });

    describe('por documento', () => {
      it('guarda las citas del paciente, RESUELTA, con la constancia de cuándo', async () => {
        const { service, prisma } = build();

        await expect(
          service.applyResult(ORG, {
            requestId: 'req-1',
            appointments: [fila()],
          }),
        ).resolves.toEqual({ requestId: 'req-1', stored: true });

        const { where, data } = datosUltimoUpdate(prisma);
        expect(where).toEqual({
          id: 'req-1',
          organizationId: ORG,
          status: 'PENDIENTE',
        });
        expect(data).toMatchObject({
          status: 'RESUELTA',
          truncated: false,
          resolvedAt: expect.any(Date),
          result: {
            kind: 'BY_DOCUMENT',
            citas: [
              expect.objectContaining({
                doctorExternalKey: '76',
                startIso: INI,
                titular: 'PACIENTE',
                documentoTercero: null,
              }),
            ],
          },
        });
      });

      it('🚨 una fila de OTRO documento (defecto del agente) no se guarda', async () => {
        const { service, prisma } = build();

        await service.applyResult(ORG, {
          requestId: 'req-1',
          appointments: [fila(), fila({ patientDocument: '52123456' })],
        });

        const { data } = datosUltimoUpdate(prisma);
        expect(JSON.stringify(data.result)).not.toContain('52123456');
        expect((data.result as { citas: unknown[] }).citas).toHaveLength(1);
      });

      it('sin filas: RESUELTA con lista vacía ("el HIS no tiene citas de este documento")', async () => {
        const { service, prisma } = build();

        await service.applyResult(ORG, {
          requestId: 'req-1',
          appointments: [],
        });

        expect(datosUltimoUpdate(prisma).data).toMatchObject({
          status: 'RESUELTA',
          result: { kind: 'BY_DOCUMENT', citas: [], truncado: false },
        });
      });

      it('el recorte del agente se conserva y se declara en la fila', async () => {
        const { service, prisma } = build();

        await service.applyResult(ORG, {
          requestId: 'req-1',
          appointments: [fila()],
          truncated: true,
        });

        expect(datosUltimoUpdate(prisma).data).toMatchObject({
          truncated: true,
          result: { truncado: true },
        });
      });
    });

    describe('por cupo', () => {
      const porCupo = () =>
        build({ request: peticion({ kind: 'BY_SLOT', params: PARAMS_CUPO }) });

      it('🔒 el cupo lo ocupa OTRA persona: se guarda su documento ENMASCARADO, nunca completo', async () => {
        const { service, prisma } = porCupo();

        await service.applyResult(ORG, {
          requestId: 'req-1',
          appointments: [fila({ patientDocument: '52123456' })],
        });

        const { data } = datosUltimoUpdate(prisma);
        const guardado = JSON.stringify(data);
        expect(guardado).not.toContain('52123456');
        expect(guardado).toContain('•••3456');
        expect(data.result).toMatchObject({
          kind: 'BY_SLOT',
          cupos: [{ filas: [expect.objectContaining({ titular: 'OTRO' })] }],
        });
      });

      it('lo guardado no conserva la lista de documentos con los que se comparó', async () => {
        const { service, prisma } = porCupo();

        await service.applyResult(ORG, {
          requestId: 'req-1',
          appointments: [fila()],
        });

        expect(
          JSON.stringify(datosUltimoUpdate(prisma).data.result),
        ).not.toContain('1088123456');
      });

      it('🚨 filas de cupos que NADIE pidió se descartan', async () => {
        const { service, prisma } = porCupo();

        await service.applyResult(ORG, {
          requestId: 'req-1',
          appointments: [
            fila(),
            fila({ doctorExternalKey: '91', patientDocument: '99999999' }),
          ],
        });

        const guardado = JSON.stringify(datosUltimoUpdate(prisma).data.result);
        expect(guardado).not.toContain('99999999');
        expect(guardado).not.toContain('"91"');
      });

      it('cupo libre: RESUELTA con un cupo sin filas (distinto de un error)', async () => {
        const { service, prisma } = porCupo();

        await service.applyResult(ORG, {
          requestId: 'req-1',
          appointments: [],
        });

        expect(datosUltimoUpdate(prisma).data).toMatchObject({
          status: 'RESUELTA',
          result: {
            kind: 'BY_SLOT',
            cupos: [{ doctorExternalKey: '76', filas: [] }],
          },
        });
      });
    });

    describe('una sola respuesta (compare-and-set)', () => {
      it('si otra respuesta se adelantó entre la lectura y la escritura → stored=false', async () => {
        const { service } = build({ updateManyCount: 0 });

        await expect(
          service.applyResult(ORG, {
            requestId: 'req-1',
            appointments: [fila()],
          }),
        ).resolves.toEqual({ requestId: 'req-1', stored: false });
      });

      it('lo mismo para un error del agente', async () => {
        const { service } = build({ updateManyCount: 0 });

        await expect(
          service.applyResult(ORG, {
            requestId: 'req-1',
            appointments: [],
            error: 'boom',
          }),
        ).resolves.toEqual({ requestId: 'req-1', stored: false });
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  describe('mantenimiento (cron)', () => {
    it('expira lo pendiente que ya nadie espera', async () => {
      const { service, prisma } = build({ updateManyCount: 2 });

      await service.mantenimiento();

      const { where, data } = prisma.hisLookupRequest.updateMany.mock
        .calls[0][0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      expect(where).toMatchObject({
        status: 'PENDIENTE',
        createdAt: { lt: expect.any(Date) },
      });
      expect(data).toMatchObject({
        status: 'EXPIRADA',
        resolvedAt: expect.any(Date),
      });
    });

    it('🔒 PURGA lo vencido: borra params y result, deja el metadato', async () => {
      const { service, prisma } = build();

      await service.mantenimiento();

      const { where, data } = prisma.hisLookupRequest.updateMany.mock
        .calls[1][0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      expect(where).toEqual({
        purgedAt: null,
        purgeAt: { lt: expect.any(Date) },
      });
      expect(data.params).toEqual({});
      expect(data.result).toBe(Prisma.DbNull);
      expect(data.purgedAt).toEqual(expect.any(Date));
      // No toca lo que hace de metadato.
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('error');
    });

    it('un fallo de la base no revienta el cron (se reintenta al minuto siguiente)', async () => {
      const { service, prisma } = build();
      prisma.hisLookupRequest.updateMany.mockRejectedValueOnce(
        new Error('db caída'),
      );

      await expect(service.mantenimiento()).resolves.toBeUndefined();
    });
  });
});
