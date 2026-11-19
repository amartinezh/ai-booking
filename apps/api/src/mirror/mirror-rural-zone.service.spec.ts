import { BadRequestException } from '@nestjs/common';
import { MirrorRuralZoneService } from './mirror-rural-zone.service';

const ORG = 'org-1';
const AHORA = new Date('2026-11-20T08:00:00Z');
const INICIO = new Date('2026-11-20T07:59:00Z');

function armar(opts: { regla: number | null; total?: number }) {
  const prisma = {
    organizationSettings: {
      findUnique: jest.fn(async () => ({
        saturdayRuralSharePercent: opts.regla,
      })),
    },
    hospitalMirrorConfig: {
      findUnique: jest.fn(async () => ({
        ruralListSyncedAt: new Date('2026-11-19T08:00:00Z'),
      })),
      update: jest.fn(async () => ({})),
    },
    ruralPatient: {
      count: jest.fn(async () => opts.total ?? 0),
      deleteMany: jest.fn(async () => ({ count: 3 })),
    },
    $executeRaw: jest.fn(async () => 0),
  };
  return { prisma, svc: new MirrorRuralZoneService(prisma as never) };
}

const lote = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    inicioIso: INICIO.toISOString(),
    documentos: ['1001', '0012345678', ' 75.036.620 ', '0000', 'abc', '1001'],
    ultimo: false,
    ...over,
  }) as never;

describe('MirrorRuralZoneService — la lista de pacientes de zona rural', () => {
  describe('estado', () => {
    it('con la regla encendida, el agente debe mandarla; dice cuándo llegó la última', async () => {
      const { svc } = armar({ regla: 50 });
      expect(await svc.estado(ORG)).toEqual({
        pedir: true,
        ultimaIso: '2026-11-19T08:00:00.000Z',
      });
    });

    it('con la regla apagada, no', async () => {
      const { svc } = armar({ regla: null });
      expect((await svc.estado(ORG)).pedir).toBe(false);
    });
  });

  describe('recibirLote', () => {
    it('con la regla apagada no guarda nada', async () => {
      const { svc, prisma } = armar({ regla: null });
      expect(await svc.recibirLote(ORG, lote(), AHORA)).toEqual({
        aceptados: 0,
        ignorado: true,
      });
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('guarda solo documentos válidos, sin ceros a la izquierda ni repetidos', async () => {
      const { svc, prisma } = armar({ regla: 50 });
      expect(await svc.recibirLote(ORG, lote(), AHORA)).toEqual({
        aceptados: 3,
      });
      const sql = (prisma.$executeRaw.mock.calls[0] as unknown[])[0] as {
        values: unknown[];
      };
      expect(sql.values).toContainEqual(['1001', '12345678', '75036620']);
      // El inicio viaja como texto UTC y se convierte en SQL: un Date suelto se
      // corría 5 horas con la base en la hora de Bogotá (2026-11-19).
      expect(sql.values).toContainEqual(INICIO.toISOString());
      expect(sql.values).not.toContainEqual(INICIO);
      // Un lote que no es el último no borra nada.
      expect(prisma.ruralPatient.deleteMany).not.toHaveBeenCalled();
    });

    it('el último lote reemplaza la lista: borra lo que no vino y anota cuántos quedaron', async () => {
      const { svc, prisma } = armar({ regla: 50, total: 27729 });
      expect(await svc.recibirLote(ORG, lote({ ultimo: true }), AHORA)).toEqual(
        { aceptados: 3, total: 27729 },
      );
      expect(prisma.ruralPatient.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: ORG, seenAt: { lt: INICIO } },
      });
      expect(prisma.hospitalMirrorConfig.update).toHaveBeenCalledWith({
        where: { organizationId: ORG },
        data: { ruralListSyncedAt: AHORA, ruralListCount: 27729 },
      });
    });

    it('un envío que termina sin ningún documento no borra la lista anterior', async () => {
      const { svc, prisma } = armar({ regla: 50, total: 0 });
      expect(
        await svc.recibirLote(
          ORG,
          lote({ ultimo: true, documentos: [] }),
          AHORA,
        ),
      ).toEqual({ aceptados: 0, total: 0, conservada: true });
      expect(prisma.ruralPatient.deleteMany).not.toHaveBeenCalled();
      expect(prisma.hospitalMirrorConfig.update).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it.each([
      ['sin arreglo de documentos', { documentos: 'x' }],
      ['demasiados documentos', { documentos: new Array(10001).fill('1001') }],
      ['ultimo que no es booleano', { ultimo: 'si' }],
      ['inicio inválido', { inicioIso: 'ayer' }],
      ['inicio en el futuro', { inicioIso: '2026-11-20T10:00:00Z' }],
      ['envío demasiado viejo', { inicioIso: '2026-11-19T20:00:00Z' }],
    ])('rechaza un lote con %s', async (_caso, over) => {
      const { svc, prisma } = armar({ regla: 50 });
      await expect(svc.recibirLote(ORG, lote(over), AHORA)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });
});
