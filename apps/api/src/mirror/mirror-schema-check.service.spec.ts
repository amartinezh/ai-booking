import { Test, TestingModule } from '@nestjs/testing';
import { MirrorSchemaCheckService } from './mirror-schema-check.service';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════════════════════
// El defecto que este servicio existe para hacer visible:
//
// fn_sync_outbox() y sus tres triggers son SQL manual dentro de una migracion
// de Prisma, y este repo construye sus bases con `prisma db push`, que NUNCA
// ejecuta el SQL de migrations/. El instalador ademas sella las migraciones
// como aplicadas sin correrlas. El 2026-08-31 se comprobo sobre la base de
// desarrollo: ninguno de los tres triggers existia, SyncOutbox estaba vacio y
// el espejo con el HIS llevaba semanas muerto sin un solo error.
//
// db:apply-sql cierra la causa. Esto cierra el SILENCIO.
// ═══════════════════════════════════════════════════════════════════════════
describe('MirrorSchemaCheckService', () => {
  let service: MirrorSchemaCheckService;
  let prisma: {
    hospitalMirrorConfig: { count: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let errores: string[];
  let avisos: string[];

  /** Respuestas de pg_proc / pg_trigger, en el orden en que se consultan. */
  const conObjetos = (opciones: { funcion?: boolean; triggers?: string[] }) => {
    const { funcion = true, triggers } = opciones;
    const todos = [
      'trg_sync_outbox_schedule_slot',
      'trg_sync_outbox_doctor_profile',
      'trg_sync_outbox_appointment',
    ];
    prisma.$queryRaw
      .mockResolvedValueOnce([{ n: BigInt(funcion ? 1 : 0) }])
      .mockResolvedValueOnce((triggers ?? todos).map((tgname) => ({ tgname })));
  };

  beforeEach(async () => {
    prisma = {
      hospitalMirrorConfig: { count: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorSchemaCheckService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MirrorSchemaCheckService);

    errores = [];
    avisos = [];
    jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation((m: string) => errores.push(m));
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation((m: string) => avisos.push(m));
    jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
  });

  it('sin ninguna organizacion con espejo, ni siquiera consulta el esquema', async () => {
    prisma.hospitalMirrorConfig.count.mockResolvedValue(0);

    const r = await service.verify();

    expect(r.ok).toBe(true);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(errores).toEqual([]);
  });

  it('con espejo activo y todo el DDL presente, no grita', async () => {
    prisma.hospitalMirrorConfig.count.mockResolvedValue(1);
    conObjetos({});

    const r = await service.verify();

    expect(r).toEqual({ ok: true, missing: [] });
    expect(errores).toEqual([]);
  });

  it('con espejo activo y la funcion ausente, lo reporta como error', async () => {
    prisma.hospitalMirrorConfig.count.mockResolvedValue(1);
    conObjetos({ funcion: false });

    const r = await service.verify();

    expect(r.ok).toBe(false);
    expect(r.missing).toContain('funcion fn_sync_outbox()');
    expect(errores).toHaveLength(1);
  });

  it('nombra exactamente que triggers faltan', async () => {
    prisma.hospitalMirrorConfig.count.mockResolvedValue(1);
    conObjetos({ triggers: ['trg_sync_outbox_appointment'] });

    const r = await service.verify();

    expect(r.missing).toEqual([
      'trigger trg_sync_outbox_schedule_slot',
      'trigger trg_sync_outbox_doctor_profile',
    ]);
  });

  it('el mensaje de error dice que se pierden citas y como arreglarlo', async () => {
    prisma.hospitalMirrorConfig.count.mockResolvedValue(2);
    conObjetos({ funcion: false, triggers: [] });

    await service.verify();

    // El mensaje es lo unico que va a ver quien opere esto a las 3 de la
    // manana: tiene que decir el impacto y el comando exacto.
    expect(errores[0]).toContain('ESPEJO ROTO');
    expect(errores[0]).toContain('2 organizacion(es)');
    expect(errores[0]).toContain('db:apply-sql');
    expect(errores[0]).toContain('NO vera las citas de WhatsApp');
  });

  it('si el chequeo mismo revienta, la API igual arranca', async () => {
    prisma.hospitalMirrorConfig.count.mockRejectedValue(
      new Error('la base todavia no acepta conexiones'),
    );

    // No debe propagar: una clinica sin espejo funciona sin estos triggers y
    // tumbar el arranque por un modulo opcional seria peor que el problema.
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(avisos[0]).toContain('No se pudo verificar');
  });
});
