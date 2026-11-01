import { createHash } from 'crypto';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ResumenAtencionHis } from '@agenia/shared';
import { ResumenDocumentosService } from './resumen-documentos.service';
import {
  INTENTOS_FECHA,
  ResumenEnlacesService,
  fechaValida,
} from './resumen-enlaces.service';
import { pedidoDeArchivo } from './resumen-documentos.controller';

// La página del resumen (plan §3.5). Lo que se fija:
//  · del token solo se guarda su huella, y vence con el contenido;
//  · sin la fecha de nacimiento no se ve nada; 5 equivocadas bloquean una hora;
//  · el acceso firmado es de ESE enlace, vence y no se puede falsificar;
//  · cada paso queda en la bitácora con la IP y el navegador, sin contenido.

jest.setTimeout(30_000);

const ORG = 'org-1';
const ORIGEN = { ip: '190.0.0.1', navegador: 'Android' };
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

function resumen(
  fechaNacimientoIso: string | null = '1963-05-17',
): ResumenAtencionHis {
  return {
    version: 1,
    historia: {
      numero: '2441058',
      guardadaIso: '2026-11-01T14:07:31.000Z',
      servicio: 'S39141',
      nombreServicio: null,
      plantilla: null,
      codigoPlantilla: null,
      nombrePlantilla: null,
      especialidad: null,
      edad: 63,
    },
    paciente: {
      documento: '900000001',
      tipoDocumento: 'CC',
      nombre: 'ADULTO PRUEBA',
      fechaNacimientoIso,
      celular: null,
      correo: null,
      celularAcompanante: null,
      correoAcompanante: null,
    },
    medico: {
      codigo: null,
      nombre: 'MEDICO DE PRUEBA',
      documento: null,
      registro: null,
    },
    afiliacion: { convenio: null, administradora: null, tipoUsuario: null },
    diagnosticos: [
      {
        cie10: 'I10X',
        descripcion: 'HIPERTENSION',
        tipo: null,
        principal: true,
      },
    ],
    ordenes: [],
    remisiones: [],
    incapacidades: [],
    interconsultas: [],
    indicaciones: ['CONTROL'],
    campos: [],
  };
}

function armar(o: { fecha?: string | null; contenidoBorrado?: boolean } = {}) {
  const links: any[] = [];
  const accesos: any[] = [];
  const eventos: any[] = [];
  const resumenFila = {
    id: 'sum-1',
    hisKey: '2441058',
    organizationId: ORG,
    version: 1,
    content: o.contenidoBorrado
      ? null
      : JSON.stringify(resumen(o.fecha === undefined ? '1963-05-17' : o.fecha)),
    contentExpiresAt: new Date(Date.now() + 10 * 86_400_000),
    organization: { name: 'Hospital AgenIA' },
  };
  const prisma: any = {
    attentionSummary: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === resumenFila.id &&
        where.organizationId === ORG &&
        (where.purgedAt !== null || !o.contenidoBorrado)
          ? resumenFila
          : null,
      ),
    },
    attentionSummaryLink: {
      create: jest.fn(async ({ data }: any) => {
        const l = {
          id: `link-${links.length + 1}`,
          failedAttempts: 0,
          lockedUntil: null,
          revokedAt: null,
          ...data,
        };
        links.push(l);
        return l;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const l = links.find((x) => x.tokenHash === where.tokenHash);
        return l ? { ...l, attentionSummary: resumenFila } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const l = links.find((x) => x.id === where.id);
        for (const [k, v] of Object.entries(data)) {
          l[k] =
            typeof v === 'object' && v !== null && 'increment' in (v as any)
              ? l[k] + (v as any).increment
              : v;
        }
        return l;
      }),
    },
    attentionSummaryAccess: {
      create: jest.fn(async ({ data }: any) => accesos.push(data)),
    },
    hospitalMirrorConfig: {
      findUnique: jest.fn(async () => ({
        resumenAtencion: {
          documentos: { encabezado: { nombre: 'E.S.E. HOSPITAL' } },
        },
      })),
    },
    organization: {
      findUnique: jest.fn(async () => ({
        name: 'Hospital AgenIA',
        timezone: null,
      })),
    },
  };
  const crypto: any = { decrypt: (s: string) => s };
  const bitacora: any = { event: jest.fn(async (e: any) => eventos.push(e)) };
  const documentos = new ResumenDocumentosService(prisma, crypto, bitacora);
  const servicio = new ResumenEnlacesService(
    prisma,
    crypto,
    documentos,
    bitacora,
  );
  return { servicio, links, accesos, eventos, prisma };
}

const QUIEN = { userId: 'u-1', email: 'admin@hospital.co' };

describe('ResumenEnlacesService', () => {
  const secretoAntes = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = 'secreto-de-prueba';
  });
  afterAll(() => {
    process.env.JWT_SECRET = secretoAntes;
  });

  it('el enlace de prueba guarda la huella del token, no el token, y vence con el contenido', async () => {
    const a = armar();
    const { token, expiraIso } = await a.servicio.crearEnlaceDePrueba(
      ORG,
      'sum-1',
      QUIEN,
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.links[0]).toMatchObject({
      tokenHash: hash(token),
      purpose: 'PRUEBA',
      createdByUserId: 'u-1',
    });
    expect(JSON.stringify(a.links)).not.toContain(token);
    // El contenido se borra en 10 días: el enlace no dura más.
    expect(Date.parse(expiraIso)).toBeLessThanOrEqual(
      Date.now() + 10 * 86_400_000,
    );
    expect(a.eventos[0]).toMatchObject({
      action: 'ATTENTION_SUMMARY_TEST_LINK_CREATED',
      organizationId: ORG,
    });
    expect(JSON.stringify(a.eventos)).not.toContain(token);
  });

  it('no hay enlace para un resumen ajeno o ya borrado', async () => {
    await expect(
      armar().servicio.crearEnlaceDePrueba('otra', 'sum-1', QUIEN),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      armar({ contenidoBorrado: true }).servicio.crearEnlaceDePrueba(
        ORG,
        'sum-1',
        QUIEN,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('abrir: pide la fecha y anota la visita; un token raro o desconocido no dice nada', async () => {
    const a = armar();
    const { token } = await a.servicio.crearEnlaceDePrueba(ORG, 'sum-1', QUIEN);
    await expect(a.servicio.abrir(token, ORIGEN)).resolves.toEqual({
      estado: 'PIDE_FECHA',
      hospital: 'E.S.E. HOSPITAL',
    });
    expect(a.accesos).toEqual([
      expect.objectContaining({
        kind: 'ABRIR',
        ip: '190.0.0.1',
        userAgent: 'Android',
        linkId: 'link-1',
      }),
    ]);
    await expect(a.servicio.abrir('x'.repeat(22), ORIGEN)).resolves.toEqual({
      estado: 'NO_DISPONIBLE',
    });
    await expect(a.servicio.abrir('../../etc', ORIGEN)).resolves.toEqual({
      estado: 'NO_DISPONIBLE',
    });
  });

  it('vencido, revocado o con el contenido borrado: no disponible', async () => {
    const a = armar();
    const { token } = await a.servicio.crearEnlaceDePrueba(ORG, 'sum-1', QUIEN);
    a.links[0].expiresAt = new Date(Date.now() - 1);
    await expect(a.servicio.abrir(token, ORIGEN)).resolves.toEqual({
      estado: 'NO_DISPONIBLE',
    });
    a.links[0].expiresAt = new Date(Date.now() + 1000_000);
    a.links[0].revokedAt = new Date();
    await expect(
      a.servicio.verificar(token, '1963-05-17', ORIGEN),
    ).resolves.toEqual({ ok: false, estado: 'NO_DISPONIBLE' });
  });

  it('sin fecha de nacimiento en el HIS no hay cómo verificar en línea', async () => {
    const a = armar({ fecha: null });
    const { token } = await a.servicio.crearEnlaceDePrueba(ORG, 'sum-1', QUIEN);
    await expect(a.servicio.abrir(token, ORIGEN)).resolves.toMatchObject({
      estado: 'SIN_FECHA',
    });
    await expect(
      a.servicio.verificar(token, '1963-05-17', ORIGEN),
    ).resolves.toEqual({ ok: false, estado: 'SIN_FECHA' });
  });

  it('fecha correcta: acceso firmado que abre el contenido y los documentos, y la visita queda anotada', async () => {
    const a = armar();
    const { token } = await a.servicio.crearEnlaceDePrueba(ORG, 'sum-1', QUIEN);
    const v = await a.servicio.verificar(token, '1963-05-17', ORIGEN);
    if (!v.ok) throw new Error('debía verificar');

    const c = await a.servicio.contenido(token, v.acceso, ORIGEN);
    expect(c).toMatchObject({
      hospital: 'E.S.E. HOSPITAL',
      paciente: 'ADULTO PRUEBA',
      medico: 'MEDICO DE PRUEBA',
      actualizado: false,
      documentos: [expect.objectContaining({ id: 'resumen', hojas: 1 })],
    });
    expect(c!.secciones[0]).toEqual({
      titulo: 'Diagnósticos',
      renglones: ['HIPERTENSION (I10X)'],
    });

    const pdf = await a.servicio.archivo(
      token,
      v.acceso,
      { documento: 'resumen', formato: 'pdf', hoja: 1 },
      ORIGEN,
    );
    expect(pdf!.datos.subarray(0, 5).toString()).toBe('%PDF-');
    expect(a.accesos.map((x) => x.kind)).toEqual([
      'VERIFICAR_OK',
      'VER',
      'DOCUMENTO',
    ]);
    expect(a.accesos[2].documentId).toBe('resumen:pdf');
    expect(JSON.stringify(a.accesos)).not.toMatch(/ADULTO|HIPERTENSION|1963/);
  });

  it('el acceso es de ESE enlace, vence y no se puede falsificar', async () => {
    const a = armar();
    const uno = await a.servicio.crearEnlaceDePrueba(ORG, 'sum-1', QUIEN);
    const otro = await a.servicio.crearEnlaceDePrueba(ORG, 'sum-1', QUIEN);
    const v = await a.servicio.verificar(uno.token, '1963-05-17', ORIGEN);
    if (!v.ok) throw new Error('debía verificar');

    await expect(
      a.servicio.contenido(otro.token, v.acceso, ORIGEN),
    ).resolves.toBeNull();
    await expect(
      a.servicio.contenido(
        uno.token,
        v.acceso.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
        ORIGEN,
      ),
    ).resolves.toBeNull();
    const [id, , firma] = v.acceso.split('.');
    await expect(
      a.servicio.contenido(
        uno.token,
        `${id}.${Date.now() + 10 * 3_600_000}.${firma}`,
        ORIGEN,
      ),
    ).resolves.toBeNull();
    await expect(
      a.servicio.contenido(uno.token, undefined, ORIGEN),
    ).resolves.toBeNull();
    await expect(
      a.servicio.archivo(
        uno.token,
        'falso',
        { documento: 'resumen', formato: 'pdf', hoja: 1 },
        ORIGEN,
      ),
    ).resolves.toBeNull();

    // Vencido (30 minutos).
    const real = Date.now;
    Date.now = () => real() + 31 * 60_000;
    try {
      await expect(
        a.servicio.contenido(uno.token, v.acceso, ORIGEN),
      ).resolves.toBeNull();
    } finally {
      Date.now = real;
    }
  });

  it(`${INTENTOS_FECHA} fechas equivocadas bloquean una hora, aun con la fecha correcta; acertar antes reinicia la cuenta`, async () => {
    const a = armar();
    const { token } = await a.servicio.crearEnlaceDePrueba(ORG, 'sum-1', QUIEN);
    await expect(
      a.servicio.verificar(token, '1963-05-18', ORIGEN),
    ).resolves.toEqual({
      ok: false,
      estado: 'FECHA_INCORRECTA',
      intentosRestantes: 4,
    });
    await expect(
      a.servicio.verificar(token, '1963-05-17', ORIGEN),
    ).resolves.toMatchObject({ ok: true });
    expect(a.links[0].failedAttempts).toBe(0);

    for (let i = 0; i < INTENTOS_FECHA - 1; i++)
      await a.servicio.verificar(token, '2000-01-01', ORIGEN);
    const ultimo = await a.servicio.verificar(token, 'basura', ORIGEN);
    expect(ultimo).toMatchObject({ ok: false, estado: 'BLOQUEADO' });
    await expect(
      a.servicio.verificar(token, '1963-05-17', ORIGEN),
    ).resolves.toMatchObject({ ok: false, estado: 'BLOQUEADO' });
    await expect(a.servicio.abrir(token, ORIGEN)).resolves.toMatchObject({
      estado: 'BLOQUEADO',
    });
    expect(a.accesos.filter((x) => x.kind === 'VERIFICAR_FALLO')).toHaveLength(
      INTENTOS_FECHA + 1,
    );
    expect(a.accesos.at(-2).kind).toBe('BLOQUEADO');
  });

  it('sin JWT_SECRET la página no da acceso', async () => {
    const a = armar();
    const { token } = await a.servicio.crearEnlaceDePrueba(ORG, 'sum-1', QUIEN);
    delete process.env.JWT_SECRET;
    await expect(
      a.servicio.verificar(token, '1963-05-17', ORIGEN),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('fechaValida y pedidoDeArchivo', () => {
  it('solo fechas que existen', () => {
    expect(fechaValida('1963-05-17')).toBe(true);
    expect(fechaValida('2026-02-29')).toBe(false);
    expect(fechaValida('17/05/1963')).toBe(false);
    expect(fechaValida(null)).toBe(false);
  });

  it('documento, formato y hoja válidos; lo demás se rechaza', () => {
    expect(
      pedidoDeArchivo({ documento: 'formula-77', formato: 'png', hoja: '2' }),
    ).toEqual({ documento: 'formula-77', formato: 'png', hoja: 2 });
    expect(pedidoDeArchivo({ documento: 'todo', formato: 'pdf' })).toEqual({
      documento: 'todo',
      formato: 'pdf',
      hoja: 1,
    });
    expect(() =>
      pedidoDeArchivo({ documento: '../x', formato: 'pdf' }),
    ).toThrow();
    expect(() =>
      pedidoDeArchivo({ documento: 'resumen', formato: 'exe' }),
    ).toThrow();
    expect(() =>
      pedidoDeArchivo({ documento: 'resumen', formato: 'png', hoja: '0' }),
    ).toThrow();
  });
});
