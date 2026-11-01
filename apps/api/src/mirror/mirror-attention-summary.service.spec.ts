import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@agenia/database';
import type { ResumenAtencionHis } from '@agenia/shared';
import { MirrorAttentionSummaryService } from './mirror-attention-summary.service';

// Resumen de la atención, Fase 1 (lectura en sombra). Lo que se fija aquí:
//   · con «Leer del hospital» apagado el agente no lee y nada clínico entra;
//   · el contenido se guarda cifrado, con su borrado a los 30 días (D11);
//   · la misma historia no se duplica; una distinta sube la versión (D10);
//   · solo entran los servicios de la matriz;
//   · el cursor solo avanza y la medición de cada vuelta se guarda;
//   · abrir un resumen para revisarlo lo descifra y deja constancia.

const ORG = 'org-1';

function resumen(
  numero = '2441058',
  cambios: Partial<ResumenAtencionHis> = {},
): ResumenAtencionHis {
  return {
    version: 1,
    historia: {
      numero,
      guardadaIso: '2026-11-01T14:00:00.000Z',
      servicio: 'S39141',
      nombreServicio: 'CONSULTA MEDICINA GENERAL',
      plantilla: 870,
      codigoPlantilla: 'HISOO1',
      nombrePlantilla: 'CONSULTA EXTERNA',
      especialidad: 'MEDICINA GENERAL',
      edad: 46,
    },
    paciente: {
      documento: '00900000001',
      tipoDocumento: 'CC',
      nombre: 'ADULTO PRUEBA',
      fechaNacimientoIso: null,
      celular: '3001234567',
      correo: null,
      celularAcompanante: null,
      correoAcompanante: null,
    },
    medico: {
      codigo: '95',
      nombre: 'MEDICO DE PRUEBA',
      documento: null,
      registro: null,
    },
    afiliacion: {
      convenio: 'SUBS',
      administradora: 'EPS SURAMERICANA S.A',
      tipoUsuario: 'Subsidiado',
    },
    diagnosticos: [
      {
        cie10: 'I10X',
        descripcion: 'HIPERTENSION ESENCIAL',
        tipo: 'IMPRESION DIAGNOSTICA',
        principal: true,
      },
    ],
    ordenes: [],
    remisiones: [],
    incapacidades: [],
    interconsultas: [],
    indicaciones: ['CONTROL EN 3 MESES CON RESULTADOS'],
    campos: [],
    ...cambios,
  };
}

const CONFIG_LEYENDO = {
  leerDelHospital: true,
  servicios: { S39141: {}, 'S39141-1': { WHATSAPP: true } },
};

function armar(
  opciones: {
    config?: unknown;
    cursor?: string | null;
    sinFila?: boolean;
    existente?: {
      id: string;
      contentHash: string;
      purgedAt: Date | null;
    } | null;
    perfiles?: { id: string }[];
    crearFalla?: Error;
    medicion?: unknown;
    paraRevisar?: {
      id: string;
      hisKey: string;
      version: number;
      attendedAt: Date;
      content: string | null;
    } | null;
  } = {},
) {
  const creados: any[] = [];
  const actualizados: any[] = [];
  const cursores: string[] = [];
  const escrituras: any[] = [];
  const prisma: any = {
    hospitalMirrorConfig: {
      findUnique: jest.fn(async () =>
        opciones.sinFila
          ? null
          : {
              resumenAtencion: opciones.config ?? null,
              resumenAtencionCursor: opciones.cursor ?? null,
              resumenAtencionMedicion: opciones.medicion ?? null,
            },
      ),
      update: jest.fn(async ({ data }: any) => {
        escrituras.push(data);
        if (data.resumenAtencionCursor !== undefined)
          cursores.push(data.resumenAtencionCursor);
        return {};
      }),
    },
    attentionSummary: {
      findUnique: jest.fn(async () => opciones.existente ?? null),
      findFirst: jest.fn(async () => opciones.paraRevisar ?? null),
      create: jest.fn(async ({ data }: any) => {
        if (opciones.crearFalla) throw opciones.crearFalla;
        creados.push(data);
        return data;
      }),
      update: jest.fn(async (args: any) => {
        actualizados.push(args);
        return {};
      }),
    },
    $queryRaw: jest.fn(async () => opciones.perfiles ?? []),
  };
  const crypto: any = {
    encrypt: jest.fn((s: string) => `cifrado(${s.length})`),
    decrypt: jest.fn((s: string) => s.replace(/^cifrado:/, '')),
  };
  const bitacora: any = { event: jest.fn(async () => undefined) };
  return {
    servicio: new MirrorAttentionSummaryService(prisma, crypto, bitacora),
    prisma,
    crypto,
    bitacora,
    creados,
    actualizados,
    cursores,
    escrituras,
  };
}

describe('estadoParaElAgente', () => {
  it('sin configuración del espejo, o sin la función, no se lee nada', async () => {
    for (const opciones of [
      { sinFila: true },
      { config: null },
      { config: {} },
    ]) {
      const { servicio } = armar(opciones);
      await expect(servicio.estadoParaElAgente(ORG)).resolves.toEqual({
        leer: false,
        cursor: null,
        calmaMinutos: 120,
        maxPorLote: 50,
        servicios: [],
        camposPlantilla: null,
      });
    }
  });

  it('con la lectura apagada no le pasa servicios ni campos al agente, aunque la matriz los tenga', async () => {
    const { servicio } = armar({
      config: {
        leerDelHospital: false,
        servicios: { S39141: { WHATSAPP: true } },
        camposPlantilla: [{ plantilla: 870, campo: 'MC:', seccion: 'Motivo' }],
      },
      cursor: '100',
    });
    const estado = await servicio.estadoParaElAgente(ORG);
    expect(estado.leer).toBe(false);
    expect(estado.servicios).toEqual([]);
    expect(estado.camposPlantilla).toBeNull();
    expect(estado.cursor).toBe('100');
  });

  it('con la lectura encendida le dice desde dónde y qué servicios', async () => {
    const { servicio } = armar({
      config: { ...CONFIG_LEYENDO, calmaMinutos: 150 },
      cursor: '2441000',
    });
    await expect(servicio.estadoParaElAgente(ORG)).resolves.toEqual({
      leer: true,
      cursor: '2441000',
      calmaMinutos: 150,
      maxPorLote: 50,
      servicios: ['S39141', 'S39141-1'],
      camposPlantilla: null,
    });
  });
});

describe('recibirLote', () => {
  it('con la lectura apagada responde 403 y no guarda nada ni mueve el cursor', async () => {
    const { servicio, creados, cursores } = armar({
      config: { servicios: { S39141: {} } },
    });
    await expect(
      servicio.recibirLote(ORG, {
        resumenes: [resumen()],
        nextCursor: '2441058',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(creados).toHaveLength(0);
    expect(cursores).toHaveLength(0);
  });

  it('rechaza un cuerpo mal formado', async () => {
    const { servicio } = armar({ config: CONFIG_LEYENDO });
    await expect(
      servicio.recibirLote(ORG, { resumenes: 'x' as any, nextCursor: '1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      servicio.recibirLote(ORG, { resumenes: [], nextCursor: 'abc' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const muchos = Array.from({ length: 51 }, (_, i) => resumen(String(i + 1)));
    await expect(
      servicio.recibirLote(ORG, { resumenes: muchos, nextCursor: '99' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('guarda un resumen nuevo cifrado, con borrado a los 30 días, y lo une con su paciente', async () => {
    const { servicio, creados, cursores } = armar({
      config: CONFIG_LEYENDO,
      cursor: '2441000',
      perfiles: [{ id: 'pac-1' }],
    });
    const antes = Date.now();
    const r = await servicio.recibirLote(ORG, {
      resumenes: [resumen()],
      nextCursor: '2441058',
    });

    expect(r).toEqual({
      recibidos: 1,
      nuevos: 1,
      actualizados: 0,
      sinCambios: 0,
      rechazados: [],
    });
    const fila = creados[0];
    expect(fila).toMatchObject({
      organizationId: ORG,
      hisKey: '2441058',
      patientProfileId: 'pac-1',
      serviceCode: 'S39141',
    });
    expect(fila.attendedAt).toEqual(new Date('2026-11-01T14:00:00.000Z'));
    // Cifrado: nada del contenido en claro.
    expect(fila.content).toMatch(/^cifrado\(\d+\)$/);
    expect(fila.content).not.toContain('900000001');
    expect(fila.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const dias = (fila.contentExpiresAt.getTime() - antes) / 86_400_000;
    expect(dias).toBeGreaterThanOrEqual(29.99);
    expect(dias).toBeLessThan(30.01);
    expect(cursores).toEqual(['2441058']);
  });

  it('si el documento casa con dos pacientes (con y sin ceros), no elige ninguno', async () => {
    const { servicio, creados } = armar({
      config: CONFIG_LEYENDO,
      perfiles: [{ id: 'a' }, { id: 'b' }],
    });
    await servicio.recibirLote(ORG, {
      resumenes: [resumen()],
      nextCursor: '2441058',
    });
    expect(creados[0].patientProfileId).toBeNull();
  });

  it('la misma historia con el mismo contenido no se duplica ni se reescribe', async () => {
    const primero = armar({ config: CONFIG_LEYENDO });
    await primero.servicio.recibirLote(ORG, {
      resumenes: [resumen()],
      nextCursor: '2441058',
    });
    const hash = primero.creados[0].contentHash;

    const { servicio, actualizados, creados } = armar({
      config: CONFIG_LEYENDO,
      existente: { id: 's1', contentHash: hash, purgedAt: null },
    });
    const r = await servicio.recibirLote(ORG, {
      resumenes: [resumen()],
      nextCursor: '2441058',
    });
    expect(r.sinCambios).toBe(1);
    expect(actualizados).toHaveLength(0);
    expect(creados).toHaveLength(0);
  });

  it('una versión distinta (el médico agregó algo) actualiza el contenido y sube la versión', async () => {
    const { servicio, actualizados } = armar({
      config: CONFIG_LEYENDO,
      existente: { id: 's1', contentHash: 'otra', purgedAt: null },
    });
    const r = await servicio.recibirLote(ORG, {
      resumenes: [resumen()],
      nextCursor: '2441058',
    });
    expect(r.actualizados).toBe(1);
    expect(actualizados[0].where).toEqual({ id: 's1' });
    expect(actualizados[0].data.version).toEqual({ increment: 1 });
    expect(actualizados[0].data.content).toMatch(/^cifrado/);
  });

  it('un resumen caducado no revive', async () => {
    const { servicio, actualizados } = armar({
      config: CONFIG_LEYENDO,
      existente: { id: 's1', contentHash: 'otra', purgedAt: new Date() },
    });
    const r = await servicio.recibirLote(ORG, {
      resumenes: [resumen()],
      nextCursor: '2441058',
    });
    expect(r.sinCambios).toBe(1);
    expect(actualizados).toHaveLength(0);
  });

  it('solo entran los servicios de la matriz; uno inválido no tumba el lote', async () => {
    const { servicio, creados } = armar({ config: CONFIG_LEYENDO });
    const urgencias = resumen('2441059', {
      historia: {
        ...resumen().historia,
        numero: '2441059',
        servicio: 'S39145',
      },
    });
    const roto = { ...resumen('2441060'), paciente: null };
    const r = await servicio.recibirLote(ORG, {
      resumenes: [urgencias, roto as any, resumen('2441061')],
      nextCursor: '2441061',
    });
    expect(r.nuevos).toBe(1);
    expect(r.rechazados).toEqual([
      { numero: '2441059', motivo: 'servicio fuera de la matriz' },
      { numero: '2441060', motivo: 'falta el paciente' },
    ]);
    expect(creados.map((c) => c.hisKey)).toEqual(['2441061']);
  });

  it('dos lotes con la misma historia a la vez: el segundo cuenta como sin cambios', async () => {
    const choque = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const { servicio } = armar({ config: CONFIG_LEYENDO, crearFalla: choque });
    const r = await servicio.recibirLote(ORG, {
      resumenes: [resumen()],
      nextCursor: '2441058',
    });
    expect(r.sinCambios).toBe(1);
    expect(r.rechazados).toEqual([]);
  });

  it('un error al guardar queda como rechazado, sin el contenido en el motivo', async () => {
    const { servicio } = armar({
      config: CONFIG_LEYENDO,
      crearFalla: new Error('base caída'),
    });
    const r = await servicio.recibirLote(ORG, {
      resumenes: [resumen()],
      nextCursor: '2441058',
    });
    expect(r.rechazados).toEqual([
      { numero: '2441058', motivo: 'error al guardar' },
    ]);
  });

  it('el cursor solo avanza', async () => {
    const atrasado = armar({ config: CONFIG_LEYENDO, cursor: '2441100' });
    await atrasado.servicio.recibirLote(ORG, {
      resumenes: [],
      nextCursor: '2441058',
    });
    expect(atrasado.cursores).toEqual([]);

    const adelante = armar({ config: CONFIG_LEYENDO, cursor: '2441100' });
    await adelante.servicio.recibirLote(ORG, {
      resumenes: [],
      nextCursor: '2441200',
    });
    expect(adelante.cursores).toEqual(['2441200']);

    const primera = armar({ config: CONFIG_LEYENDO, cursor: null });
    await primera.servicio.recibirLote(ORG, { resumenes: [], nextCursor: '5' });
    expect(primera.cursores).toEqual(['5']);
  });
});

describe('medición de cada vuelta', () => {
  it('se guarda aunque el cursor no avance, sin tocar el cursor', async () => {
    const a = armar({ config: CONFIG_LEYENDO, cursor: '2441100' });
    await a.servicio.recibirLote(ORG, {
      resumenes: [],
      nextCursor: '2441100',
      medicion: { detectarMs: 140, leerMs: 0, historias: 0 },
    });
    expect(a.escrituras).toHaveLength(1);
    expect(a.escrituras[0].resumenAtencionCursor).toBeUndefined();
    expect(a.escrituras[0].resumenAtencionMedicion.vueltas).toEqual([
      expect.objectContaining({ detectarMs: 140, leerMs: 0, historias: 0 }),
    ]);
  });

  it('se suma a las vueltas guardadas', async () => {
    const a = armar({
      config: CONFIG_LEYENDO,
      cursor: '1',
      medicion: {
        vueltas: [
          {
            iso: '2026-11-01T10:00:00.000Z',
            detectarMs: 90,
            leerMs: 400,
            historias: 2,
          },
        ],
      },
    });
    await a.servicio.recibirLote(ORG, {
      resumenes: [],
      nextCursor: '2',
      medicion: { detectarMs: 100, leerMs: 0, historias: 0 },
    });
    expect(a.cursores).toEqual(['2']);
    expect(
      a.escrituras[0].resumenAtencionMedicion.vueltas.map(
        (v: { detectarMs: number }) => v.detectarMs,
      ),
    ).toEqual([90, 100]);
  });

  it('una medición rota no se guarda y no frena el lote; sin medición (agente anterior) tampoco', async () => {
    const rota = armar({ config: CONFIG_LEYENDO, cursor: '5' });
    await rota.servicio.recibirLote(ORG, {
      resumenes: [],
      nextCursor: '5',
      medicion: { detectarMs: -3, leerMs: 0, historias: 0 },
    });
    expect(rota.escrituras).toEqual([]);

    const vieja = armar({ config: CONFIG_LEYENDO, cursor: '5' });
    await vieja.servicio.recibirLote(ORG, { resumenes: [], nextCursor: '6' });
    expect(vieja.escrituras).toEqual([{ resumenAtencionCursor: '6' }]);
  });
});

describe('abrirParaRevisar', () => {
  const QUIEN = { userId: 'u-1', email: 'admin@hospital.co' };
  const fila = (content: string | null) => ({
    id: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
    hisKey: '2441058',
    version: 2,
    attendedAt: new Date('2026-11-01T14:00:00.000Z'),
    content,
  });

  it('descifra el resumen de SU clínica y deja constancia sin el contenido', async () => {
    const r = resumen();
    const a = armar({
      paraRevisar: fila(`cifrado:${JSON.stringify(r)}`),
    });
    const abierto = await a.servicio.abrirParaRevisar(
      ORG,
      fila(null).id,
      QUIEN,
    );

    expect(a.prisma.attentionSummary.findFirst.mock.calls[0][0].where).toEqual({
      id: fila(null).id,
      organizationId: ORG,
    });
    expect(abierto).toEqual({
      resumen: r,
      hisKey: '2441058',
      version: 2,
      attendedAt: '2026-11-01T14:00:00.000Z',
    });
    expect(a.bitacora.event).toHaveBeenCalledTimes(1);
    const evento = a.bitacora.event.mock.calls[0][0];
    expect(evento).toMatchObject({
      action: 'ATTENTION_SUMMARY_VIEWED',
      userId: 'u-1',
      organizationId: ORG,
      metadata: { summaryId: fila(null).id, hisKey: '2441058' },
    });
    expect(JSON.stringify(evento)).not.toMatch(
      /ADULTO PRUEBA|HIPERTENSION|00900000001/,
    );
  });

  it('de otra clínica o inexistente: no existe; ya purgado: se borró', async () => {
    await expect(
      armar({ paraRevisar: null }).servicio.abrirParaRevisar(ORG, 'x', QUIEN),
    ).rejects.toBeInstanceOf(NotFoundException);
    const purgado = armar({ paraRevisar: fila(null) });
    await expect(
      purgado.servicio.abrirParaRevisar(ORG, 'x', QUIEN),
    ).rejects.toBeInstanceOf(GoneException);
    expect(purgado.bitacora.event).not.toHaveBeenCalled();
  });
});
