import { Test, TestingModule } from '@nestjs/testing';
import { MirrorCatalogService } from './mirror-catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CatalogInput } from './dto/mirror.types';

/**
 * El catálogo es el ÚNICO productor de candidatos a homologación: sin estas
 * filas nadie puede emparejar un médico del hospital con uno de AgenIA, y sin
 * esa equivalencia no sale ni entra una sola cita del HIS.
 *
 * Las dos reglas que importan y que un refactor puede romper sin ruido:
 *  1. Esto NO escribe `MirrorEntityMap` — candidato ≠ equivalencia.
 *  2. Lo que el HIS deja de reportar NO se borra; se queda con su `lastSeenAt`.
 */
describe('MirrorCatalogService', () => {
  let service: MirrorCatalogService;
  let prisma: {
    mirrorCatalogEntry: { findMany: jest.Mock; upsert: jest.Mock };
    mirrorEntityMap: { count: jest.Mock; upsert?: jest.Mock };
  };

  const ORG = 'org-1';
  const doctores = (entries: CatalogInput['entries']): CatalogInput => ({
    kind: 'DOCTOR',
    entries,
  });

  beforeEach(async () => {
    prisma = {
      mirrorCatalogEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      mirrorEntityMap: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorCatalogService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MirrorCatalogService);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  });

  it('un catálogo entero nuevo cuenta como creado', async () => {
    const r = await service.upload(
      ORG,
      doctores([
        { externalKey: '76', label: 'RUIZ ANA' },
        { externalKey: '81', label: 'PEREZ LUIS' },
      ]),
    );

    expect(r).toEqual({
      kind: 'DOCTOR',
      created: 2,
      updated: 0,
      vanished: 0,
      homologated: 0,
    });
    expect(prisma.mirrorCatalogEntry.upsert).toHaveBeenCalledTimes(2);
  });

  it('lo que ya se conocía cuenta como refrescado, no como nuevo', async () => {
    prisma.mirrorCatalogEntry.findMany.mockResolvedValue([
      { externalKey: '76' },
    ]);

    const r = await service.upload(
      ORG,
      doctores([
        { externalKey: '76', label: 'RUIZ ANA MARIA' },
        { externalKey: '81', label: 'PEREZ LUIS' },
      ]),
    );

    expect(r.created).toBe(1);
    expect(r.updated).toBe(1);
  });

  it('lo que el HIS ya no reporta se cuenta como desaparecido pero NO se borra', async () => {
    prisma.mirrorCatalogEntry.findMany.mockResolvedValue([
      { externalKey: '76' },
      { externalKey: '81' },
      { externalKey: '99' },
    ]);

    const r = await service.upload(
      ORG,
      doctores([{ externalKey: '76', label: 'RUIZ ANA' }]),
    );

    expect(r.vanished).toBe(2);
    // Ni deleteMany, ni delete: el servicio no tiene por dónde borrar.
    expect(
      (prisma.mirrorCatalogEntry as Record<string, unknown>).deleteMany,
    ).toBeUndefined();
  });

  it('el upsert va con la llave de tres partes (org + tipo + clave del HIS)', async () => {
    await service.upload(
      ORG,
      doctores([
        { externalKey: '76', label: 'RUIZ ANA', extra: { cedula: '1' } },
      ]),
    );

    expect(prisma.mirrorCatalogEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_entityType_externalKey: {
            organizationId: ORG,
            entityType: 'DOCTOR',
            externalKey: '76',
          },
        },
        create: expect.objectContaining({
          organizationId: ORG,
          entityType: 'DOCTOR',
          externalKey: '76',
          label: 'RUIZ ANA',
          extra: { cedula: '1' },
        }),
        update: expect.objectContaining({
          label: 'RUIZ ANA',
          extra: { cedula: '1' },
        }),
      }),
    );
  });

  it('una clave con espacios se normaliza antes de guardarse', async () => {
    await service.upload(ORG, doctores([{ externalKey: '  76 ', label: 'X' }]));

    const args = prisma.mirrorCatalogEntry.upsert.mock.calls[0][0];
    expect(args.where.organizationId_entityType_externalKey.externalKey).toBe(
      '76',
    );
  });

  it('una entrada SIN clave se descarta: no hay nada que homologar', async () => {
    const r = await service.upload(
      ORG,
      doctores([
        { externalKey: '', label: 'SIN CLAVE' },
        { externalKey: '   ', label: 'SOLO ESPACIOS' },
        { externalKey: '76', label: 'BUENA' },
      ]),
    );

    expect(prisma.mirrorCatalogEntry.upsert).toHaveBeenCalledTimes(1);
    expect(r.created).toBe(1);
  });

  it('sin etiqueta se usa la propia clave, para que la fila sea legible igual', async () => {
    await service.upload(
      ORG,
      doctores([{ externalKey: '76' } as CatalogInput['entries'][number]]),
    );

    const args = prisma.mirrorCatalogEntry.upsert.mock.calls[0][0];
    expect(args.create.label).toBe('76');
    expect(args.create.extra).toEqual({});
  });

  it('reporta cuántas de las que llegaron YA tienen equivalencia', async () => {
    prisma.mirrorEntityMap.count.mockResolvedValue(1);

    const r = await service.upload(
      ORG,
      doctores([
        { externalKey: '76', label: 'A' },
        { externalKey: '81', label: 'B' },
      ]),
    );

    expect(r.homologated).toBe(1);
    expect(prisma.mirrorEntityMap.count).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        entityType: 'DOCTOR',
        externalKey: { in: ['76', '81'] },
      },
    });
  });

  it('NO escribe la tabla de equivalencias: eso lo decide una persona', async () => {
    await service.upload(ORG, doctores([{ externalKey: '76', label: 'A' }]));

    expect(
      (prisma.mirrorEntityMap as Record<string, unknown>).upsert,
    ).toBeUndefined();
    expect(
      (prisma.mirrorEntityMap as Record<string, unknown>).create,
    ).toBeUndefined();
  });

  it('un catálogo vacío es información legítima: cero de todo, sin escrituras', async () => {
    prisma.mirrorCatalogEntry.findMany.mockResolvedValue([
      { externalKey: '76' },
    ]);

    const r = await service.upload(ORG, doctores([]));

    expect(prisma.mirrorCatalogEntry.upsert).not.toHaveBeenCalled();
    expect(r).toEqual({
      kind: 'DOCTOR',
      created: 0,
      updated: 0,
      vanished: 1,
      homologated: 0,
    });
  });

  it('los servicios recorren el mismo camino que los médicos', async () => {
    const r = await service.upload(ORG, {
      kind: 'SERVICE',
      entries: [{ externalKey: 'S-1', label: 'CONSULTA EXTERNA' }],
    });

    expect(r.kind).toBe('SERVICE');
    expect(prisma.mirrorCatalogEntry.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, entityType: 'SERVICE' },
      select: { externalKey: true },
    });
  });

  it('el catálogo previo se lee acotado a la organización: nunca ve el de otra clínica', async () => {
    await service.upload(ORG, doctores([{ externalKey: '76', label: 'A' }]));

    expect(prisma.mirrorCatalogEntry.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, entityType: 'DOCTOR' },
      select: { externalKey: true },
    });
  });

  it('una clave repetida en el mismo envío no infla el conteo de nuevas', async () => {
    const r = await service.upload(
      ORG,
      doctores([
        { externalKey: '76', label: 'A' },
        { externalKey: '76', label: 'A (repetido)' },
      ]),
    );

    // Se hacen los dos upserts (son idempotentes contra la misma fila) pero el
    // hospital tiene UN médico 76, y el conteo de "nuevas" no debe decir dos.
    expect(r.created + r.updated).toBe(2);
    expect(prisma.mirrorEntityMap.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ externalKey: { in: ['76'] } }),
      }),
    );
  });
});
