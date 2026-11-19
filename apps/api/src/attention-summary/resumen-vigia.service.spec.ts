import { ResumenVigiaService, llaveLeerVisto } from './resumen-vigia.service';

// 🚨 El vigía de los documentos de la consulta (plan §8.11): la lectura que se
// detuvo y los avisos que no se entregan. Sin base ni Redis de verdad.

const ORG = 'org-1';
const AHORA = new Date('2026-11-19T15:00:00.000Z');
const LEYENDO = { leerDelHospital: true, servicios: { S39141: {} } };

function armar(
  o: {
    config?: unknown;
    vueltaIso?: string | null;
    error?: string | null;
    latido?: Date | null;
    visto?: string | null;
    cifras?: { avisos: number; entregados: number; fallidos: number };
    errores?: { codigo: string | null; n: number }[];
  } = {},
) {
  const memoria = new Map<string, string>(
    o.visto ? [[llaveLeerVisto(ORG), o.visto]] : [],
  );
  const redis: any = {
    set: jest.fn(async (k: string, v: string, modo?: string) => {
      if (modo === 'NX' && memoria.has(k)) return null;
      memoria.set(k, v);
      return 'OK';
    }),
    get: jest.fn(async (k: string) => memoria.get(k) ?? null),
    del: jest.fn(async (k: string) => memoria.delete(k)),
  };
  const consultas: unknown[] = [
    o.cifras ? [o.cifras] : [{ avisos: 0, entregados: 0, fallidos: 0 }],
    o.errores ?? [],
  ];
  const prisma: any = {
    hospitalMirrorConfig: {
      findMany: jest.fn(async () => [
        {
          organizationId: ORG,
          resumenAtencion: o.config ?? LEYENDO,
          resumenAtencionMedicion: o.vueltaIso
            ? {
                vueltas: [
                  { iso: o.vueltaIso, detectarMs: 30, leerMs: 0, historias: 0 },
                ],
              }
            : null,
          resumenAtencionError: o.error ?? null,
          lastHeartbeatAt:
            o.latido === undefined
              ? new Date('2026-11-19T14:59:00.000Z')
              : o.latido,
          organization: {
            name: 'Hospital San Vicente de Paúl',
            isActive: true,
          },
        },
      ]),
    },
    $queryRaw: jest.fn(async () => consultas.shift() ?? []),
  };
  const alertas: any = {
    avisar: jest.fn(async () => undefined),
    resolver: jest.fn(async () => undefined),
    cronBien: jest.fn(async () => undefined),
    cronFallo: jest.fn(async () => undefined),
  };
  return {
    s: new ResumenVigiaService(prisma, redis, alertas),
    alertas,
    memoria,
  };
}

const avisos = (a: any, kind: string) =>
  a.alertas.avisar.mock.calls
    .map((c: any[]) => c[0])
    .filter((x: any) => x.kind === kind);

describe('la lectura del hospital', () => {
  it('al día: la última vuelta hace 5 minutos resuelve', async () => {
    const a = armar({ vueltaIso: '2026-11-19T14:55:00.000Z' });
    await a.s.vigilar(AHORA);
    expect(avisos(a, 'RESUMEN_LECTURA_DETENIDA')).toHaveLength(0);
    expect(a.alertas.resolver).toHaveBeenCalledWith(`resumen:lectura:${ORG}`);
  });

  it('40 minutos sin vuelta: avisa con el latido y el error que reporta el agente', async () => {
    const a = armar({
      vueltaIso: '2026-11-19T14:20:00.000Z',
      error: "The SELECT permission was denied on the column 'TX_CASO_HREM'",
    });
    await a.s.vigilar(AHORA);
    const [alerta] = avisos(a, 'RESUMEN_LECTURA_DETENIDA');
    expect(alerta).toMatchObject({
      dedupeKey: `resumen:lectura:${ORG}`,
      organizationId: ORG,
      organizationName: 'Hospital San Vicente de Paúl',
    });
    expect(alerta.detail).toContain('hace 40 min');
    expect(alerta.detail).toContain('Último latido del agente: hace 1 min.');
    expect(alerta.detail).toContain(
      'Error que reporta el agente: The SELECT permission was denied',
    );
  });

  it('recién encendida y sin ninguna vuelta: espera 30 minutos desde que la API la vio encendida', async () => {
    const primera = armar({ vueltaIso: null });
    await primera.s.vigilar(AHORA);
    expect(primera.memoria.get(llaveLeerVisto(ORG))).toBe(AHORA.toISOString());
    expect(avisos(primera, 'RESUMEN_LECTURA_DETENIDA')).toHaveLength(0);

    const despues = armar({
      vueltaIso: null,
      visto: '2026-11-19T14:25:00.000Z',
      error: null,
    });
    await despues.s.vigilar(AHORA);
    const [alerta] = avisos(despues, 'RESUMEN_LECTURA_DETENIDA');
    expect(alerta.detail).toContain(
      'encendido hace 35 min y el agente no ha subido ninguna vuelta',
    );
    expect(alerta.detail).toContain('El agente no reporta un error');
  });

  it('apagada: resuelve y olvida desde cuándo estaba encendida', async () => {
    const a = armar({
      config: { leerDelHospital: false },
      visto: '2026-11-19T10:00:00.000Z',
    });
    await a.s.vigilar(AHORA);
    expect(avisos(a, 'RESUMEN_LECTURA_DETENIDA')).toHaveLength(0);
    expect(a.memoria.has(llaveLeerVisto(ORG))).toBe(false);
    expect(a.alertas.resolver).toHaveBeenCalledWith(`resumen:lectura:${ORG}`);
  });
});

describe('la entrega de los avisos', () => {
  it('pocos avisos no dicen nada; con buena entrega se resuelve', async () => {
    const pocos = armar({
      vueltaIso: '2026-11-19T14:55:00.000Z',
      cifras: { avisos: 6, entregados: 1, fallidos: 5 },
    });
    await pocos.s.vigilar(AHORA);
    expect(avisos(pocos, 'RESUMEN_NO_ENTREGADOS')).toHaveLength(0);
    const bien = armar({
      vueltaIso: '2026-11-19T14:55:00.000Z',
      cifras: { avisos: 40, entregados: 38, fallidos: 2 },
    });
    await bien.s.vigilar(AHORA);
    expect(avisos(bien, 'RESUMEN_NO_ENTREGADOS')).toHaveLength(0);
    expect(bien.alertas.resolver).toHaveBeenCalledWith(
      `resumen:entrega:${ORG}`,
    );
  });

  it('menos del 70 % entregado: avisa con los errores de Meta más comunes', async () => {
    const a = armar({
      vueltaIso: '2026-11-19T14:55:00.000Z',
      cifras: { avisos: 20, entregados: 10, fallidos: 9 },
      errores: [
        { codigo: '131026', n: 7 },
        { codigo: null, n: 2 },
      ],
    });
    await a.s.vigilar(AHORA);
    const [alerta] = avisos(a, 'RESUMEN_NO_ENTREGADOS');
    expect(alerta.detail).toContain(
      'De 20 avisos de WhatsApp a pacientes en las últimas 24 h, Meta confirmó la entrega de 10 (50 %)',
    );
    expect(alerta.detail).toContain('131026 (7), sin código (2)');
    expect(alerta.detail).toContain('Solo a quienes no les llegó');
  });
});
