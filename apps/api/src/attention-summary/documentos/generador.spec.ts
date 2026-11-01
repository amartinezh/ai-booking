import { leerConfigDocumentos } from '@agenia/shared';
import type { ResumenAtencionHis } from '@agenia/shared';
import { GeneradorDocumentos } from './generador';
import { armarHojas } from './plantillas';
import { crearMedidor, dimensionesImagen, hojasAPdf } from './render';

// El generador de verdad (pdfkit y @napi-rs/canvas, sin dobles): lo que se fija
// es que cada documento sale, en carta, con texto real, la marca de agua en
// cada hoja, «Hoja N de M», la cantidad en letras, la imagen a 200 ppp y el PDF
// con clave para el correo.

jest.setTimeout(30_000);

const med = (codigo: string, nombre: string) => ({
  codigo,
  nombre,
  cum: null,
  invima: null,
  medida: null,
  concentracion: '50 MG',
  forma: 'TABLETA',
  via: 'ORAL',
  cantidad: 30,
  duracionDias: 30,
  indicacion: '1 TAB VO EN LA NOCHE',
  frecuencia: null,
  entregado: false,
});

function resumen(numMeds = 2): ResumenAtencionHis {
  return {
    version: 1,
    historia: {
      numero: '2441058',
      guardadaIso: '2026-11-01T14:07:31.000Z',
      servicio: 'S39141',
      nombreServicio: 'CONSULTA MEDICINA GENERAL',
      plantilla: 870,
      codigoPlantilla: null,
      nombrePlantilla: null,
      especialidad: 'MEDICINA GENERAL',
      edad: 63,
    },
    paciente: {
      documento: '900000001',
      tipoDocumento: 'CC',
      nombre: 'ADULTO PRUEBA',
      fechaNacimientoIso: '1963-05-17',
      celular: null,
      correo: null,
      celularAcompanante: null,
      correoAcompanante: null,
    },
    medico: {
      codigo: '95',
      nombre: 'MEDICO DE PRUEBA',
      documento: '1',
      registro: '17-1234',
    },
    afiliacion: {
      convenio: 'SUBS',
      administradora: 'EPS PRUEBA',
      tipoUsuario: 'Subsidiado',
    },
    diagnosticos: [
      {
        cie10: 'I10X',
        descripcion: 'HIPERTENSION ESENCIAL',
        tipo: null,
        principal: true,
      },
    ],
    ordenes: [
      {
        numero: '77',
        tipo: 'MEDICAMENTOS',
        farmacia: 'AI',
        escritaIso: '2026-11-01T14:09:00.000Z',
        desdeIso: null,
        serie: null,
        vigencia: 'Vigente por 72 Horas',
        medicamentos: Array.from({ length: numMeds }, (_, i) =>
          med(`M${i}`, `MEDICAMENTO ${i + 1}`),
        ),
        examenes: [],
      },
    ],
    remisiones: [],
    incapacidades: [],
    interconsultas: [],
    indicaciones: ['CONTROL EN 3 MESES'],
    campos: [],
  };
}

const ctx = {
  documentos: leerConfigDocumentos({
    documentos: { encabezado: { nombre: 'HOSPITAL DE PRUEBA', nit: '000-0' } },
  }),
  nombreClinica: 'Clínica',
  ahora: new Date('2026-11-01T17:30:00.000Z'),
  timeZone: 'America/Bogota',
};

const textos = (hoja: { tipo: string; texto?: string }[]) =>
  hoja
    .filter((e) => e.tipo === 'texto')
    .map((e) => e.texto)
    .join(' ');

describe('GeneradorDocumentos', () => {
  it('lista el resumen y la fórmula, con sus hojas', () => {
    const g = new GeneradorDocumentos(resumen(), ctx);
    expect(g.listar()).toEqual([
      expect.objectContaining({ id: 'resumen', hojas: 1 }),
      expect.objectContaining({
        id: 'formula-77',
        titulo: 'Fórmula médica N.º 77',
        hojas: 1,
      }),
    ]);
  });

  it('cada hoja: marca de agua detrás de todo, encabezado, registro y «Hoja N de M»', () => {
    const r = resumen(14);
    const g = new GeneradorDocumentos(r, ctx);
    const doc = g.listar().find((d) => d.id === 'formula-77')!;
    const hojas = armarHojas(crearMedidor(), r, doc, ctx)!;
    expect(hojas.length).toBeGreaterThan(1);
    hojas.forEach((h, i) => {
      expect(h[0]).toEqual({ tipo: 'marca', texto: 'COPIA PARA EL PACIENTE' });
      const t = textos(h);
      expect(t).toContain('HOSPITAL DE PRUEBA');
      expect(t).toContain('Fórmula médica N.º 77');
      expect(t).toContain('ADULTO PRUEBA');
      expect(t).toContain(`Hoja ${i + 1} de ${hojas.length}`);
      expect(t).toContain('Firmado electrónicamente por MEDICO DE PRUEBA');
    });
    const todo = hojas.map(textos).join(' ');
    // D19 y cantidad en letras en español.
    expect(todo).toContain('1 TAB VO EN LA NOCHE');
    expect(todo).toContain('30 (treinta)');
    // Ningún medicamento se pierde ni se repite entre hojas.
    for (let i = 1; i <= 14; i++) {
      expect(
        todo.match(new RegExp(`(^| )${i}\\. MEDICAMENTO ${i}( |$)`, 'g')),
      ).toHaveLength(1);
    }
  });

  it('nada se sale de la hoja ni pisa el pie', () => {
    const r = resumen(14);
    const g = new GeneradorDocumentos(r, ctx);
    const doc = g.listar().find((d) => d.id === 'formula-77')!;
    const medidor = crearMedidor();
    for (const h of armarHojas(medidor, r, doc, ctx)!) {
      for (const e of h) {
        if (e.tipo !== 'texto') continue;
        expect(e.x).toBeGreaterThanOrEqual(42);
        expect(
          e.x + medidor.ancho(e.texto, e.tam, e.negrita),
        ).toBeLessThanOrEqual(612 - 42 + 0.5);
        expect(e.base).toBeLessThanOrEqual(792 - 42);
      }
    }
  });

  it('PDF en carta con texto real; con clave, cifrado', async () => {
    const r = resumen();
    const g = new GeneradorDocumentos(r, ctx);
    const pdf = (await g.pdf('formula-77'))!;
    expect(pdf.nombreArchivo).toBe('Formula_01-11-2026_N77.pdf');
    expect(pdf.datos.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.datos.toString('latin1')).toMatch(/\/MediaBox \[0 0 612 792\]/);

    const doc = g.listar()[1];
    const sinComprimir = await hojasAPdf(
      armarHojas(crearMedidor(), r, doc, ctx)!,
      {
        titulo: 'x',
        autor: 'y',
        sinComprimir: true,
      },
    );
    expect(sinComprimir.toString('latin1')).toMatch(/\/Type \/Page\b/);

    const conClave = await g.pdfCompleto({ clave: '900000001' });
    expect(conClave.nombreArchivo).toBe('Documentos_01-11-2026.pdf');
    expect(conClave.datos.toString('latin1')).toMatch(/\/Encrypt/);
    expect(pdf.datos.toString('latin1')).not.toMatch(/\/Encrypt/);
  });

  it('PNG de cada hoja a 200 ppp (1.700 × 2.200); una hoja que no existe no sale', async () => {
    const g = new GeneradorDocumentos(resumen(), ctx);
    const png = (await g.png('resumen', 1))!;
    expect(png.nombreArchivo).toBe('Resumen_01-11-2026_hoja-1-de-1.png');
    expect(dimensionesImagen(png.datos)).toEqual({ ancho: 1700, alto: 2200 });
    await expect(g.png('resumen', 2)).resolves.toBeNull();
    await expect(g.png('no-existe', 1)).resolves.toBeNull();
    await expect(g.pdf('no-existe')).resolves.toBeNull();
  });

  it('con logo: va en el encabezado de las dos versiones', async () => {
    // PNG de 1×1.
    const logo =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const conLogo = { ...ctx, documentos: { ...ctx.documentos, logo } };
    const r = resumen();
    const g = new GeneradorDocumentos(r, conLogo);
    const hojas = armarHojas(crearMedidor(), r, g.listar()[0], conLogo)!;
    expect(hojas[0].some((e) => e.tipo === 'imagen')).toBe(true);
    expect(dimensionesImagen((await g.png('resumen', 1))!.datos)).toEqual({
      ancho: 1700,
      alto: 2200,
    });
    expect((await g.pdf('resumen'))!.datos.toString('latin1')).toMatch(
      /\/Subtype \/Image/,
    );
  });
});

describe('dimensionesImagen', () => {
  it('lee PNG y JPEG; otra cosa no', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    expect(dimensionesImagen(png)).toEqual({ ancho: 1, alto: 1 });
    // JPEG mínimo: SOI + SOF0 con 2 de alto y 3 de ancho.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(dimensionesImagen(jpeg)).toEqual({ ancho: 3, alto: 2 });
    expect(dimensionesImagen(Buffer.from('GIF89a'))).toBeNull();
  });
});
