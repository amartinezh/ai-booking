import {
  analizarArchivoDeContactos,
  clasificarTelefono,
  extraerContactos,
  leerMapeoDeIa,
  muestraParaIa,
  nombrePropio,
  normalizarContacto,
  partirLinea,
} from './mensajes-masivos-contactos';

describe('clasificarTelefono', () => {
  it.each([
    ['3001234567', '+573001234567'],
    ['300 123 4567', '+573001234567'],
    ['(300) 123-4567', '+573001234567'],
    ['573001234567', '+573001234567'],
    ['+57 300 123 4567', '+573001234567'],
    ['0057 3001234567', '+573001234567'],
  ])('%s es celular colombiano', (crudo, e164) => {
    expect(clasificarTelefono(crudo)).toEqual({ clase: 'CELULAR', e164 });
  });

  it('un número de otro país con indicativo se acepta tal cual', () => {
    expect(clasificarTelefono('+58 412 1234567')).toEqual({ clase: 'CELULAR', e164: '+584121234567' });
  });

  it.each(['6018765432', '+57 601 8765432', '8765432'])('%s es fijo: no tiene WhatsApp', (crudo) => {
    expect(clasificarTelefono(crudo).clase).toBe('FIJO');
  });

  it.each(['12345', '1088123456', 'no tiene', ''])('%s no sirve', (crudo) => {
    expect(clasificarTelefono(crudo)).toEqual({ clase: 'INVALIDO', e164: null });
  });
});

describe('nombrePropio', () => {
  it('pasa a nombre propio y deja las partículas en minúscula', () => {
    expect(nombrePropio('  MARÍA  DE LOS ÁNGELES pérez ')).toBe('María de los Ángeles Pérez');
  });
  it('sin letras no es un nombre', () => {
    expect(nombrePropio('12345')).toBeNull();
  });
});

describe('partirLinea', () => {
  it('respeta las comillas y las comillas dobladas', () => {
    expect(partirLinea('"Pérez, Ana",3001234567,"dice ""hola"""', ',')).toEqual(['Pérez, Ana', '3001234567', 'dice "hola"']);
  });
});

describe('analizarArchivoDeContactos — tablas', () => {
  it('Excel con encabezados: «Teléfono» lleno de celulares cuenta como celular', () => {
    const a = analizarArchivoDeContactos(
      'Nombre;Teléfono;Correo electrónico;Cédula\nAna Pérez;300 123 4567;ana@correo.com;1088123456\nLuis Gómez;3109876543;;10203040\n',
    );
    expect(a.formato).toBe('TABLA');
    expect(a.separador).toBe(';');
    expect(a.tieneEncabezado).toBe(true);
    expect(a.columnas.map((c) => c.tipo)).toEqual(['NOMBRE_COMPLETO', 'CELULAR', 'CORREO', 'DOCUMENTO']);
    expect(a.confianza).toBe('ALTA');
  });

  it('sin encabezado: reconoce cada columna por su contenido', () => {
    const a = analizarArchivoDeContactos('Ana Pérez,3001234567,ana@correo.com\nLuis Gómez,3109876543,luis@correo.com\nEva Ríos,3204445566,\n');
    expect(a.tieneEncabezado).toBe(false);
    expect(a.filas).toHaveLength(3);
    expect(a.columnas.map((c) => c.tipo)).toEqual(['NOMBRE_COMPLETO', 'CELULAR', 'CORREO']);
  });

  it('exportación de Google Contactos (en inglés, con columnas de sobra)', () => {
    const a = analizarArchivoDeContactos(
      'Given Name,Family Name,Phone 1 - Type,Phone 1 - Value,E-mail 1 - Value\nAna,Pérez,Mobile,+57 300 123 4567,ana@gmail.com\nLuis,Gómez,Mobile,310 987 6543,\n',
    );
    const tipos = a.columnas.map((c) => c.tipo);
    expect(tipos[0]).toBe('NOMBRES');
    expect(tipos[1]).toBe('APELLIDOS');
    expect(tipos[3]).toBe('CELULAR');
    expect(tipos[4]).toBe('CORREO');
    const r = extraerContactos(a);
    expect(r.contactos[0]).toMatchObject({ nombreCompleto: 'Ana Pérez', primerNombre: 'Ana', celular: '+573001234567', correo: 'ana@gmail.com' });
  });

  it('separador tabulador y un preámbulo antes de la tabla', () => {
    const a = analizarArchivoDeContactos('Listado de pacientes\n\nnombre\tcelular\nAna\t3001234567\nLuis\t3109876543\n');
    expect(a.separador).toBe('\t');
    expect(a.tieneEncabezado).toBe(true);
    expect(a.filas).toHaveLength(2);
  });

  it('dos columnas de teléfono: una queda de celular y la otra de respaldo', () => {
    const a = analizarArchivoDeContactos('nombre,celular,celular 2\nAna,3001234567,3110000000\nLuis,3109876543,\n');
    expect(a.columnas.filter((c) => c.tipo === 'CELULAR')).toHaveLength(1);
    expect(a.columnas.filter((c) => c.tipo === 'TELEFONO')).toHaveLength(1);
  });

  it('sin ninguna columna de celular, la confianza es baja', () => {
    expect(analizarArchivoDeContactos('nombre,ciudad\nAna,Anserma\nLuis,Riosucio\n').confianza).toBe('BAJA');
  });
});

describe('analizarArchivoDeContactos — otros formatos', () => {
  it('vCard del celular: nombre, el celular (no el fijo) y el correo', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Pérez;Ana;;;',
      'FN:Ana Pérez',
      'TEL;type=HOME:6018765432',
      'TEL;type=CELL:+57 300 123 4567',
      'EMAIL;type=INTERNET:ana@correo.com',
      'END:VCARD',
      'BEGIN:VCARD',
      'N:Gómez;Luis;;;',
      'TEL:3109876543',
      'END:VCARD',
    ].join('\r\n');
    const a = analizarArchivoDeContactos(vcf);
    expect(a.formato).toBe('VCARD');
    const r = extraerContactos(a);
    expect(r.contactos.map((c) => [c.nombreCompleto, c.celular, c.correo])).toEqual([
      ['Ana Pérez', '+573001234567', 'ana@correo.com'],
      ['Luis Gómez', '+573109876543', null],
    ]);
  });

  it('listado pegado de un chat o un correo, una persona por línea', () => {
    const a = analizarArchivoDeContactos('1. Ana Pérez - 300 123 4567\n2. Luis Gómez cel: 3109876543 luis@correo.com\n\nEva Ríos 320 444 5566');
    expect(a.formato).toBe('TEXTO_LIBRE');
    const r = extraerContactos(a);
    expect(r.contactos.map((c) => [c.nombreCompleto, c.celular, c.correo])).toEqual([
      ['Ana Pérez', '+573001234567', null],
      ['Luis Gómez', '+573109876543', 'luis@correo.com'],
      ['Eva Ríos', '+573204445566', null],
    ]);
  });
});

describe('extraerContactos', () => {
  const archivo = [
    'nombre,celular,correo',
    'ANA PÉREZ,3001234567,ANA@Correo.com',
    'Luis,6018765432,',
    'Eva,12345,',
    'Juan,,',
    'Ana bis,300 123 4567,',
    'Sin Correo Bueno,3204445566,no-es-correo',
    ',3112223344,',
  ].join('\n');

  it('descarta fijos, inválidos, vacíos y repetidos, y explica por qué', () => {
    const r = extraerContactos(analizarArchivoDeContactos(archivo));
    expect(r.contactos.map((c) => c.celular)).toEqual(['+573001234567', '+573204445566', '+573112223344']);
    expect(r.resumen).toMatchObject({ filas: 7, validos: 3, fijos: 1, celularInvalido: 1, sinCelular: 1, duplicados: 1, correosInvalidos: 1, sinNombre: 1 });
    expect(r.problemas.find((p) => p.motivo === 'DUPLICADO')?.mensaje).toContain('fila 1');
    expect(r.contactos[0]).toMatchObject({ nombreCompleto: 'Ana Pérez', primerNombre: 'Ana', correo: 'ana@correo.com' });
  });

  it('el correo inválido y la falta de nombre avisan pero no descartan', () => {
    const r = extraerContactos(analizarArchivoDeContactos(archivo));
    const noDescartan = r.problemas.filter((p) => !p.descarta).map((p) => p.motivo).sort();
    expect(noDescartan).toEqual(['CORREO_INVALIDO', 'SIN_NOMBRE']);
  });

  it('con el mapeo corregido a mano manda el mapeo, no la detección', () => {
    const a = analizarArchivoDeContactos('a,b\nAna,3001234567\n');
    const r = extraerContactos(a, ['IGNORAR', 'CELULAR']);
    expect(r.contactos[0].nombreCompleto).toBeNull();
    expect(r.contactos[0].celular).toBe('+573001234567');
  });

  it('las columnas «Otro dato» se guardan con su encabezado', () => {
    const a = analizarArchivoDeContactos('nombre,celular,EPS\nAna,3001234567,Sura\n');
    const r = extraerContactos(a, ['NOMBRE_COMPLETO', 'CELULAR', 'OTRO']);
    expect(r.contactos[0].extras).toEqual({ EPS: 'Sura' });
  });

  it('un celular escondido en una celda con dos números', () => {
    const r = extraerContactos(analizarArchivoDeContactos('nombre,telefono\nAna,6018765432 / 300 123 4567\n'));
    expect(r.contactos[0].celular).toBe('+573001234567');
  });
});

describe('muestraParaIa', () => {
  it('tapa los dígitos de en medio y el usuario del correo', () => {
    const a = analizarArchivoDeContactos('nombre,celular,correo\nAna Pérez,3001234567,ana.perez@gmail.com\n');
    const m = muestraParaIa(a);
    expect(m.encabezados).toEqual(['nombre', 'celular', 'correo']);
    expect(m.filas[0][1]).toBe('300•••••67');
    expect(m.filas[0][2]).toBe('a•••@gmail.com');
    expect(JSON.stringify(m)).not.toContain('1234567');
  });
});

describe('leerMapeoDeIa', () => {
  it('acepta solo tipos e índices válidos', () => {
    expect(
      leerMapeoDeIa({ columnas: [{ indice: 0, tipo: 'celular' }, { indice: 1, tipo: 'INVENTADO' }, { indice: 9, tipo: 'CORREO' }] }, 3),
    ).toEqual(['CELULAR', 'OTRO', 'OTRO']);
  });
  it('una respuesta sin columnas no sirve', () => {
    expect(leerMapeoDeIa({ hola: 1 }, 2)).toBeNull();
    expect(leerMapeoDeIa(null, 2)).toBeNull();
  });
});

describe('normalizarContacto (el servidor no confía en el navegador)', () => {
  it('vuelve a normalizar y rechaza un celular que no sirve', () => {
    expect(normalizarContacto({ celular: '300 123 4567', nombreCompleto: 'ANA PÉREZ', correo: 'X@Y.CO' })).toMatchObject({
      celular: '+573001234567',
      nombreCompleto: 'Ana Pérez',
      primerNombre: 'Ana',
      correo: 'x@y.co',
    });
    expect(normalizarContacto({ celular: '6018765432' })).toBeNull();
    expect(normalizarContacto({ celular: 3001234567 })).toBeNull();
  });
});
