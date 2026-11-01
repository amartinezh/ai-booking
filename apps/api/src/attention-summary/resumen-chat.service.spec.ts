import type { ResumenAtencionHis } from '@agenia/shared';
import { ResumenChatService } from './resumen-chat.service';
import { hashDelDestino } from './resumen-envio.service';

// La conversación del resumen (Fase 4). Lo que se fija: un botón de otro número
// no abre nada; con el número verificado salen los documentos; si no, se pide
// la fecha de nacimiento (5 equivocadas, una hora de bloqueo); «mis documentos»
// encuentra el último envío; un texto que no es fecha deja seguir al asistente.

const ORG = 'org-1';
const NUMERO = '573001234567';
const ID = '6f9619ff-8b86-d011-b42d-00cf4fc964ff';

const resumen = (fecha: string | null = '1980-05-17'): ResumenAtencionHis => ({
  version: 1,
  historia: {
    numero: '2441058',
    guardadaIso: '2026-11-01T14:00:00.000Z',
    servicio: 'S39141',
    nombreServicio: null,
    plantilla: null,
    codigoPlantilla: null,
    nombrePlantilla: null,
    especialidad: null,
    edad: 46,
  },
  paciente: {
    documento: '900000001',
    tipoDocumento: 'CC',
    nombre: 'ADULTO PRUEBA',
    fechaNacimientoIso: fecha,
    celular: null,
    correo: null,
    celularAcompanante: null,
    correoAcompanante: null,
  },
  medico: { codigo: null, nombre: null, documento: null, registro: null },
  afiliacion: { convenio: null, administradora: null, tipoUsuario: null },
  diagnosticos: [],
  ordenes: [],
  remisiones: [],
  incapacidades: [],
  interconsultas: [],
  indicaciones: ['CONTROL'],
  campos: [],
});

function armar(
  o: {
    perfil?: { whatsappId: string | null; bsuid: string | null } | null;
    escribio?: boolean;
    fecha?: string | null;
    destino?: string;
    sinContenido?: boolean;
  } = {},
) {
  const entrega: any = {
    id: ID,
    failedAttempts: 0,
    lockedUntil: null,
    destinationHash: hashDelDestino(o.destino ?? NUMERO),
    attentionSummary: {
      id: 's-1',
      organizationId: ORG,
      patientProfileId: o.perfil === undefined ? null : 'p-1',
      content: o.sinContenido
        ? null
        : JSON.stringify(
            resumen(o.fecha === undefined ? '1980-05-17' : o.fecha),
          ),
      contentExpiresAt: new Date(Date.now() + 10 * 86_400_000),
      organization: { timezone: null },
    },
  };
  const accesos: any[] = [];
  const memoria = new Map<string, string>();
  const prisma: any = {
    attentionSummaryDelivery: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id && where.id !== ID ? null : entrega,
      ),
      update: jest.fn(async ({ data }: any) => {
        for (const [k, v] of Object.entries(data))
          entrega[k] =
            typeof v === 'object' && v && 'increment' in (v as any)
              ? entrega[k] + (v as any).increment
              : v;
        return entrega;
      }),
    },
    attentionSummaryAccess: {
      create: jest.fn(async ({ data }: any) => accesos.push(data)),
    },
    patientProfile: { findUnique: jest.fn(async () => o.perfil ?? null) },
    interactionLog: {
      findFirst: jest.fn(async () => (o.escribio ? { id: 'i' } : null)),
    },
  };
  const redis: any = {
    get: jest.fn(async (k: string) => memoria.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => memoria.set(k, v)),
    del: jest.fn(async (k: string) => memoria.delete(k)),
  };
  const generador = {
    listar: () => [
      { id: 'resumen', titulo: 'Resumen de la atención', hojas: 1 },
      { id: 'formula-77', titulo: 'Fórmula médica N.º 77', hojas: 2 },
    ],
    pdf: jest.fn(async (id: string) => ({
      datos: Buffer.from('%PDF'),
      tipo: 'application/pdf',
      nombreArchivo: `${id}.pdf`,
    })),
    png: jest.fn(async (id: string, h: number) => ({
      datos: Buffer.from('png'),
      tipo: 'image/png',
      nombreArchivo: `${id}-${h}.png`,
    })),
  };
  const documentos: any = { generador: jest.fn(async () => generador) };
  const enlaces: any = {
    crearEnlace: jest.fn(async () => ({ token: 'TOKEN' })),
  };
  const textos: string[] = [];
  const whatsapp: any = {
    texto: jest.fn(async (_o: string, _d: string, t: string) => {
      textos.push(t);
      return { ok: true };
    }),
    subir: jest.fn(
      async (_o: string, _d: Buffer, _t: string, n: string) => `media-${n}`,
    ),
    documento: jest.fn(async () => ({ ok: true })),
    imagen: jest.fn(async () => ({ ok: true })),
  };
  const s = new ResumenChatService(
    prisma,
    { decrypt: (x: string) => x } as any,
    redis,
    documentos,
    enlaces,
    whatsapp,
  );
  return { s, entrega, accesos, textos, whatsapp, enlaces, memoria };
}

describe('ResumenChatService', () => {
  const antes = process.env.PUBLIC_WEB_URL;
  beforeEach(() => {
    process.env.PUBLIC_WEB_URL = 'https://hospital.example/';
  });
  afterAll(() => {
    process.env.PUBLIC_WEB_URL = antes;
  });

  it('un botón que no es de un resumen sigue al asistente; uno de otro número no abre nada', async () => {
    const a = armar();
    await expect(
      a.s.manejarBoton(ORG, NUMERO, 'Recibir mis documentos'),
    ).resolves.toBe(false);
    const otro = armar({ destino: '573009999999' });
    await expect(
      otro.s.manejarBoton(ORG, NUMERO, `resumen:${ID}`),
    ).resolves.toBe(true);
    expect(otro.textos).toEqual([
      expect.stringContaining('no corresponde a este número'),
    ]);
    expect(otro.whatsapp.documento).not.toHaveBeenCalled();
  });

  it('número verificado (el de la ficha y ya escribió): salen los PDF, una imagen por hoja y el enlace', async () => {
    const a = armar({
      perfil: { whatsappId: NUMERO, bsuid: null },
      escribio: true,
    });
    await a.s.manejarBoton(ORG, NUMERO, `resumen:${ID}`);
    expect(a.whatsapp.documento).toHaveBeenCalledTimes(2);
    expect(a.whatsapp.imagen).toHaveBeenCalledTimes(3);
    expect(a.whatsapp.imagen.mock.calls[2][3]).toBe(
      'Fórmula médica N.º 77 (hoja 2 de 2)',
    );
    expect(a.textos[0]).toBe(
      'Con gusto. Estos son los documentos de su consulta del domingo, 1 de noviembre:',
    );
    expect(a.textos.at(-1)).toContain('https://hospital.example/resumen/TOKEN');
    expect(a.enlaces.crearEnlace).toHaveBeenCalledWith(
      's-1',
      expect.any(Date),
      'PACIENTE',
      null,
    );
    expect(a.entrega).toMatchObject({
      status: 'DOCUMENTOS_ENVIADOS',
      verifiedBy: 'NUMERO',
    });
    expect(a.accesos.map((x) => x.kind)).toEqual(['VERIFICAR_OK', 'DOCUMENTO']);
  });

  it('el número del HIS que nunca escribió no cuenta como verificado: pide la fecha', async () => {
    const a = armar({
      perfil: { whatsappId: NUMERO, bsuid: null },
      escribio: false,
    });
    await a.s.manejarBoton(ORG, NUMERO, `resumen:${ID}`);
    expect(a.textos).toEqual([
      expect.stringContaining('escriba la fecha de nacimiento'),
    ]);
    expect(a.whatsapp.documento).not.toHaveBeenCalled();
  });

  it('fecha correcta: entrega; equivocada: dice cuántos intentos quedan', async () => {
    const a = armar();
    await a.s.manejarBoton(ORG, NUMERO, `resumen:${ID}`);
    await expect(a.s.manejarTexto(ORG, NUMERO, '18/05/1980')).resolves.toBe(
      true,
    );
    expect(a.textos.at(-1)).toBe('La fecha no coincide. Le quedan 4 intentos.');
    await expect(
      a.s.manejarTexto(ORG, NUMERO, '17 de mayo de 1980'),
    ).resolves.toBe(true);
    expect(a.entrega).toMatchObject({
      status: 'DOCUMENTOS_ENVIADOS',
      verifiedBy: 'FECHA_NACIMIENTO',
      failedAttempts: 0,
    });
    expect(a.memoria.size).toBe(0);
  });

  it('cinco equivocadas: bloqueo de una hora; después, ni con la correcta', async () => {
    const a = armar();
    await a.s.manejarBoton(ORG, NUMERO, `resumen:${ID}`);
    for (let i = 0; i < 5; i++)
      await a.s.manejarTexto(ORG, NUMERO, '01/01/2000');
    expect(a.textos.at(-1)).toContain('hay que esperar una hora');
    expect(a.entrega.lockedUntil).toBeInstanceOf(Date);
    await a.s.manejarBoton(ORG, NUMERO, `resumen:${ID}`);
    expect(a.textos.at(-1)).toContain('hay que esperar una hora');
    expect(a.whatsapp.documento).not.toHaveBeenCalled();
  });

  it('un texto que no es una fecha suelta la espera y deja seguir al asistente', async () => {
    const a = armar();
    await a.s.manejarBoton(ORG, NUMERO, `resumen:${ID}`);
    await expect(
      a.s.manejarTexto(ORG, NUMERO, 'quiero una cita'),
    ).resolves.toBe(false);
    await expect(a.s.manejarTexto(ORG, NUMERO, 'hola')).resolves.toBe(false);
  });

  it('«mis documentos» busca el último envío a este número; sin fecha en el HIS, al hospital', async () => {
    const a = armar({ fecha: null });
    await expect(a.s.manejarTexto(ORG, NUMERO, 'mis documentos')).resolves.toBe(
      true,
    );
    expect(a.textos).toEqual([
      expect.stringContaining('pida sus documentos en el hospital'),
    ]);
  });

  it('contenido ya borrado: no disponible; Telegram no pasa por aquí todavía', async () => {
    const a = armar({ sinContenido: true });
    await a.s.manejarBoton(ORG, NUMERO, `resumen:${ID}`);
    expect(a.textos).toEqual([
      expect.stringContaining('ya no están disponibles'),
    ]);
    await expect(
      a.s.manejarTexto(ORG, 'tg:123', 'mis documentos'),
    ).resolves.toBe(false);
  });
});
