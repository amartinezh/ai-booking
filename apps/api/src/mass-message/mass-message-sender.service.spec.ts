import { BadRequestException } from '@nestjs/common';
import { MassMessageSenderService } from './mass-message-sender.service';

/**
 * El envío de Mensajes masivos (docs/PLAN_MENSAJES_MASIVOS.md §8), con una base
 * en memoria lo bastante fiel para seguir el estado del envío y de cada persona.
 */
const ORG = 'org-1';
const ENVIO = 'envio-1';
/** Jueves 5 de noviembre de 2026, 10:00 a. m. en Bogotá: dentro del horario. */
const EN_HORARIO = new Date('2026-11-05T15:00:00Z');

type Fila = Record<string, any>;

function construir(
  opts: {
    texto?: string;
    contactos?: string[];
    bajas?: string[];
    bloqueosMeta?: string[];
    status?: string;
    imagen?: boolean;
    plantillaProblemas?: string[];
    envios?: Array<{ success: boolean; error?: string; wamid?: string }>;
  } = {},
) {
  const envio: Fila = {
    id: ENVIO,
    organizationId: ORG,
    listId: 'lista-1',
    status: opts.status ?? 'BORRADOR',
    messageText:
      opts.texto ??
      'La jornada de vacunación es el sábado en la sede principal.',
    imageMime: opts.imagen ? 'image/jpeg' : null,
    imageBytes: opts.imagen ? 1000 : null,
    imageData: opts.imagen
      ? Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
      : null,
    imageMediaId: null,
    imageMediaUploadedAt: null,
    templateKind: null,
    ratePerMinute: 300,
    lockedUntil: null,
    startedAt: null,
  };
  const contactos = (
    opts.contactos ?? ['+573001110001', '+573001110002', '+573001110003']
  ).map((c, i) => ({
    id: `c${i}`,
    fullName: `${['Ana', 'Luis', 'Eva', 'Juan'][i % 4]} Pérez`,
    firstName: ['Ana', 'Luis', 'Eva', 'Juan'][i % 4],
    phoneE164: c,
    createdAt: new Date(i),
  }));
  let destinatarios: Fila[] = [];
  const bajas = new Set(opts.bajas ?? []);
  const cumple = (fila: Fila, where: Fila) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return true;
      if (v && typeof v === 'object' && 'in' in v)
        return (v.in as unknown[]).includes(fila[k]);
      return fila[k] === v;
    });

  const prisma = {
    organization: { findUnique: jest.fn(async () => ({ timezone: null })) },
    massContact: {
      findMany: jest.fn(async (args: any) =>
        args.select.id
          ? contactos
          : contactos.map((c) => ({ phoneE164: c.phoneE164 })),
      ),
    },
    massMessageOptOut: {
      findMany: jest.fn(async ({ where }: any) =>
        where.destination.in
          .filter((d: string) => bajas.has(d))
          .map((destination: string) => ({ destination })),
      ),
      findUnique: jest.fn(async ({ where }: any) =>
        bajas.has(where.organizationId_destination.destination)
          ? { id: 'b' }
          : null,
      ),
    },
    whatsappMessageLog: {
      findMany: jest.fn(async ({ where }: any) =>
        (opts.bloqueosMeta ?? [])
          .filter((b) => where.recipientId.in.includes(b.replace('+', '')))
          .map((b) => ({ recipientId: b.replace('+', '') })),
      ),
    },
    massCampaign: {
      findFirst: jest.fn(async () => ({ ...envio })),
      findUnique: jest.fn(async () => ({ ...envio })),
      findMany: jest.fn(async () =>
        ['EN_COLA', 'ENVIANDO'].includes(envio.status)
          ? [{ id: ENVIO, organizationId: ORG }]
          : [],
      ),
      update: jest.fn(async ({ data }: any) => Object.assign(envio, data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.status && !cumple(envio, { status: where.status }))
          return { count: 0 };
        Object.assign(envio, data);
        return { count: 1 };
      }),
    },
    massCampaignRecipient: {
      deleteMany: jest.fn(async () => {
        destinatarios = [];
        return { count: 0 };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        destinatarios = data.map((d: Fila, i: number) => ({
          id: `d${i}`,
          attempts: 0,
          ...d,
        }));
        return { count: data.length };
      }),
      findMany: jest.fn(async ({ where, take }: any) =>
        destinatarios.filter((d) => cumple(d, where)).slice(0, take ?? 9999),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const d = destinatarios.find((x) => x.id === where.id) as Fila;
        const { attempts, ...resto } = data;
        Object.assign(d, resto);
        if (attempts?.increment) d.attempts += attempts.increment;
        return d;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const filas = destinatarios.filter((d) => cumple(d, where));
        filas.forEach((d) => Object.assign(d, data));
        return { count: filas.length };
      }),
      groupBy: jest.fn(async () => {
        const grupos = new Map<string, number>();
        destinatarios.forEach((d) =>
          grupos.set(d.outcome, (grupos.get(d.outcome) ?? 0) + 1),
        );
        return [...grupos].map(([outcome, n]) => ({
          outcome,
          _count: { _all: n },
        }));
      }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const respuestas = [...(opts.envios ?? [])];
  const plantillas = {
    findTemplate: jest.fn(async () => ({
      name: 'comunicado_general',
      language: 'es',
    })),
    sendTemplate: jest.fn(
      async () => respuestas.shift() ?? { success: true, wamid: 'wamid.x' },
    ),
  };
  const meta = {
    verificarPlantilla: jest.fn(async (_o: string, tipo: string) => ({
      tipo,
      configurada: true,
      nombre: 'comunicado_general',
      idioma: 'es',
      verificadaConMeta: true,
      estadoMeta: 'APPROVED',
      categoria: 'MARKETING',
      encabezado: tipo === 'MASS_MESSAGE_IMAGE' ? 'IMAGE' : null,
      cuerpo: 'Hola {{1}}, {{2}}',
      pie: null,
      problemas: opts.plantillaProblemas ?? [],
    })),
    subirImagen: jest.fn(async () => ({ id: 'media-1' })),
  };
  const systemLog = { event: jest.fn(), warning: jest.fn() };
  const service = new MassMessageSenderService(
    prisma as any,
    plantillas as any,
    meta as any,
    systemLog as any,
  );
  return {
    service,
    prisma,
    plantillas,
    meta,
    systemLog,
    envio,
    destinatarios: () => destinatarios,
  };
}

describe('MassMessageSenderService — previa', () => {
  it('descuenta las bajas y los bloqueos en Meta, y dice cuánto escribir para confirmar', async () => {
    const ctx = construir({
      bajas: ['+573001110001'],
      bloqueosMeta: ['+573001110002'],
    });
    const p = await ctx.service.previa(ORG, ENVIO, EN_HORARIO);
    expect(p).toMatchObject({
      contactos: 3,
      bajas: 1,
      bajasEnMeta: 1,
      aEnviar: 1,
      tipoPlantilla: 'MASS_MESSAGE_TEXT',
      bloqueos: [],
    });
    expect(p.horarioAbierto).toBe(true);
  });

  it('un texto con saltos de línea, una plantilla sin aprobar o una lista vacía bloquean', async () => {
    const p = await construir({
      texto: 'Uno\nDos',
      plantillaProblemas: ['La plantilla no está aprobada.'],
      contactos: [],
    }).service.previa(ORG, ENVIO, EN_HORARIO);
    expect(p.bloqueos.join(' ')).toEqual(
      expect.stringContaining('saltos de línea'),
    );
    expect(p.bloqueos).toEqual(
      expect.arrayContaining([
        'La lista no tiene contactos.',
        'La plantilla no está aprobada.',
      ]),
    );
  });

  it('con imagen usa la plantilla con imagen', async () => {
    const p = await construir({ imagen: true }).service.previa(
      ORG,
      ENVIO,
      EN_HORARIO,
    );
    expect(p.tipoPlantilla).toBe('MASS_MESSAGE_IMAGE');
    expect(p.bloqueos).toEqual([]);
  });
});

describe('MassMessageSenderService — iniciar', () => {
  it('sin la cantidad exacta no confirma', async () => {
    const ctx = construir();
    await expect(
      ctx.service.iniciar(ORG, ENVIO, { userId: 'u1' }, 2),
    ).rejects.toThrow(BadRequestException);
    expect(ctx.envio.status).toBe('BORRADOR');
  });

  it('toma la foto de destinatarios: las bajas quedan OMITIDAS con su motivo', async () => {
    const ctx = construir({ bajas: ['+573001110003'] });
    const r = await ctx.service.iniciar(
      ORG,
      ENVIO,
      { userId: 'u1', email: 'admin@clinica.co' },
      2,
    );
    expect(r).toMatchObject({ estado: 'EN_COLA', aEnviar: 2 });
    expect(
      ctx.destinatarios().map((d) => [d.phoneE164, d.outcome, d.skipReason]),
    ).toEqual([
      ['+573001110001', 'PENDIENTE', null],
      ['+573001110002', 'PENDIENTE', null],
      ['+573001110003', 'OMITIDO', 'BAJA'],
    ]);
    expect(ctx.envio).toMatchObject({
      status: 'EN_COLA',
      total: 3,
      skipped: 1,
      templateKind: 'MASS_MESSAGE_TEXT',
      templateName: 'comunicado_general',
      confirmedByEmail: 'admin@clinica.co',
    });
    expect(ctx.systemLog.event).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MASS_MESSAGE_CONFIRMED' }),
    );
  });

  it('no se confirma dos veces', async () => {
    const ctx = construir({ status: 'EN_COLA' });
    await expect(
      ctx.service.iniciar(ORG, ENVIO, { userId: 'u1' }, 3),
    ).rejects.toThrow('ya se confirmó');
  });
});

describe('MassMessageSenderService — la vuelta', () => {
  const confirmado = async (opts: Parameters<typeof construir>[0] = {}) => {
    const ctx = construir(opts);
    await ctx.service.iniciar(
      ORG,
      ENVIO,
      { userId: 'u1' },
      (opts.contactos?.length ?? 3) - (opts.bajas?.length ?? 0),
    );
    return ctx;
  };

  it('envía a cada persona con su nombre y el texto, y termina', async () => {
    const ctx = await confirmado();
    await ctx.service.vuelta(EN_HORARIO);
    expect(ctx.plantillas.sendTemplate).toHaveBeenCalledTimes(3);
    expect(ctx.plantillas.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: '573001110001',
        kind: 'MASS_MESSAGE_TEXT',
        bodyParams: [
          'Ana',
          'La jornada de vacunación es el sábado en la sede principal.',
        ],
        headerImageId: undefined,
      }),
    );
    expect(
      ctx
        .destinatarios()
        .every((d) => d.outcome === 'ENVIADO' && d.wamid === 'wamid.x'),
    ).toBe(true);
    expect(ctx.envio).toMatchObject({
      status: 'TERMINADO',
      sent: 3,
      failed: 0,
      lockedUntil: null,
    });
  });

  it('fuera del horario de la Ley 2300 no envía nada', async () => {
    const ctx = await confirmado();
    await ctx.service.vuelta(new Date('2026-11-08T15:00:00Z')); // domingo
    expect(ctx.plantillas.sendTemplate).not.toHaveBeenCalled();
    expect(ctx.envio.status).toBe('EN_COLA');
  });

  it('con imagen la sube una vez a Meta y la manda en el encabezado', async () => {
    const ctx = await confirmado({ imagen: true });
    await ctx.service.vuelta(EN_HORARIO);
    expect(ctx.meta.subirImagen).toHaveBeenCalledTimes(1);
    expect(ctx.plantillas.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MASS_MESSAGE_IMAGE',
        headerImageId: 'media-1',
      }),
    );
  });

  it('un número sin WhatsApp queda FALLIDO y el envío sigue', async () => {
    const ctx = await confirmado({
      envios: [{ success: false, error: '{"error":{"code":131026}}' }],
    });
    await ctx.service.vuelta(EN_HORARIO);
    expect(ctx.destinatarios().map((d) => d.outcome)).toEqual([
      'FALLIDO',
      'ENVIADO',
      'ENVIADO',
    ]);
    expect(ctx.destinatarios()[0].errorCode).toBe('131026');
    expect(ctx.envio).toMatchObject({
      status: 'TERMINADO',
      sent: 2,
      failed: 1,
    });
  });

  it('un error de la clínica (plantilla que no existe) pausa el envío sin gastar la lista', async () => {
    const ctx = await confirmado({
      envios: [{ success: false, error: '{"error":{"code":132001}}' }],
    });
    await ctx.service.vuelta(EN_HORARIO);
    expect(ctx.plantillas.sendTemplate).toHaveBeenCalledTimes(1);
    expect(ctx.destinatarios().map((d) => d.outcome)).toEqual([
      'PENDIENTE',
      'PENDIENTE',
      'PENDIENTE',
    ]);
    expect(ctx.envio.status).toBe('PAUSADO');
    expect(ctx.envio.lastError).toContain('no existe');
    expect(ctx.systemLog.warning).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MASS_MESSAGE_PAUSED' }),
    );
  });

  it('quien pidió la baja después de confirmar no recibe', async () => {
    const ctx = await confirmado();
    ctx.prisma.massMessageOptOut.findUnique.mockImplementation(
      async ({ where }: any) =>
        where.organizationId_destination.destination === '+573001110002'
          ? { id: 'b' }
          : null,
    );
    await ctx.service.vuelta(EN_HORARIO);
    expect(ctx.destinatarios().map((d) => d.outcome)).toEqual([
      'ENVIADO',
      'OMITIDO',
      'ENVIADO',
    ]);
  });

  it('un envío pausado a mitad de tanda se detiene antes del siguiente mensaje', async () => {
    const ctx = await confirmado();
    ctx.plantillas.sendTemplate.mockImplementationOnce(async () => {
      ctx.envio.status = 'PAUSADO';
      return { success: true, wamid: 'w' };
    });
    await ctx.service.vuelta(EN_HORARIO);
    expect(ctx.plantillas.sendTemplate).toHaveBeenCalledTimes(1);
    expect(ctx.envio.status).toBe('PAUSADO');
  });
});

describe('MassMessageSenderService — control', () => {
  it('cancelar deja a los que faltaban como OMITIDOS', async () => {
    const ctx = construir();
    await ctx.service.iniciar(ORG, ENVIO, { userId: 'u1' }, 3);
    await ctx.service.cancelar(ORG, ENVIO);
    expect(ctx.envio.status).toBe('CANCELADO');
    expect(
      ctx
        .destinatarios()
        .every((d) => d.outcome === 'OMITIDO' && d.skipReason === 'CANCELADO'),
    ).toBe(true);
  });

  it('pausar un borrador no se puede', async () => {
    await expect(construir().service.pausar(ORG, ENVIO)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('reintentar solo vuelve a la cola a los fallos pasajeros', async () => {
    const ctx = construir({
      envios: [
        { success: false, error: '{"error":{"code":131049}}' },
        { success: false, error: '{"error":{"code":131026}}' },
      ],
    });
    await ctx.service.iniciar(ORG, ENVIO, { userId: 'u1' }, 3);
    await ctx.service.vuelta(EN_HORARIO);
    expect(ctx.envio.status).toBe('TERMINADO');
    await expect(ctx.service.reintentarFallidos(ORG, ENVIO)).resolves.toEqual({
      reintentos: 1,
    });
    expect(ctx.destinatarios().map((d) => d.outcome)).toEqual([
      'PENDIENTE',
      'FALLIDO',
      'ENVIADO',
    ]);
    expect(ctx.envio.status).toBe('EN_COLA');
  });
});

describe('MassMessageSenderService — prueba', () => {
  it('manda al celular de prueba con el nombre escrito', async () => {
    const ctx = construir();
    await expect(
      ctx.service.enviarPrueba(ORG, ENVIO, '300 999 8877', 'ANDRÉS'),
    ).resolves.toEqual({ ok: true, wamid: 'wamid.x' });
    expect(ctx.plantillas.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: '573009998877',
        bodyParams: ['Andrés', expect.any(String)],
      }),
    );
  });

  it('un fijo o un texto con errores no se prueban; un rechazo de Meta se explica', async () => {
    await expect(
      construir().service.enviarPrueba(ORG, ENVIO, '6018765432'),
    ).rejects.toThrow('celular válido');
    await expect(
      construir({ texto: 'Hola {nombre}' }).service.enviarPrueba(
        ORG,
        ENVIO,
        '3009998877',
      ),
    ).rejects.toThrow('Corrija el texto');
    const r = await construir({
      envios: [{ success: false, error: '{"error":{"code":190}}' }],
    }).service.enviarPrueba(ORG, ENVIO, '3009998877');
    expect(r).toEqual({ ok: false, motivo: expect.stringContaining('token') });
  });
});
