import { validatePadronCsv, PADRON_CSV_HEADERS } from './padron-csv';

const HEADER = PADRON_CSV_HEADERS.join(','); // cedula,regimen,telefono

describe('validatePadronCsv', () => {
  it('acepta un archivo completo y normaliza los datos', () => {
    const csv = [HEADER, '1.088.123.456,subsidiado,+57 300 123 4567'].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.validRows).toHaveLength(1);
    expect(report.validRows[0]).toMatchObject({
      cedula: '1088123456', // sin puntos
      regime: 'SUBSIDIADO',
      phone: '3001234567', // 10 dígitos, sin el 57
    });
  });

  it('acepta un archivo con solo la cédula: es el único campo obligatorio', () => {
    const csv = [HEADER, '12345678,,'].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.validRows[0]).toMatchObject({
      cedula: '12345678',
      regime: null,
      phone: null,
    });
  });

  it('tolera un teléfono con formato de basura ("0", muy corto) sin rechazar la fila', () => {
    const csv = [HEADER, '12345678,SUBSIDIADO,0', '87654321,SUBSIDIADO,2999'].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.validRows).toHaveLength(2);
    expect(report.validRows[0]).toMatchObject({ cedula: '12345678', regime: 'SUBSIDIADO', phone: null });
    expect(report.validRows[1]).toMatchObject({ cedula: '87654321', regime: 'SUBSIDIADO', phone: null });
  });

  it('acepta el delimitador ";" de Excel es-CO y encabezados con alias/tildes', () => {
    const csv = ['Cédula;Tipo de Afiliación;Celular', '12345678;contributivo;'].join('\r\n');

    const report = validatePadronCsv(csv);

    expect(report.delimiter).toBe(';');
    expect(report.ok).toBe(true);
    expect(report.validRows[0].regime).toBe('CONTRIBUTIVO');
    expect(report.validRows[0].phone).toBeNull();
  });

  it('acepta campos entre comillas con el delimitador adentro', () => {
    const csv = [HEADER, '"98,765,432",SUBSIDIADO,'].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.validRows[0].cedula).toBe('98765432');
  });

  it('rechaza el archivo sin la columna obligatoria (cedula) y cita las columnas que sí trae', () => {
    const report = validatePadronCsv('regimen,telefono\nSUBSIDIADO,123');

    expect(report.ok).toBe(false);
    expect(report.fileError).toBe(true);
    expect(report.errors[0].message).toContain('cedula');
    expect(report.errors[0].message).toContain('Columnas del archivo: regimen, telefono');
  });

  it('rechaza archivo vacío y archivo con solo encabezado', () => {
    expect(validatePadronCsv('').ok).toBe(false);
    expect(validatePadronCsv('').fileError).toBe(true);

    const soloHeader = validatePadronCsv(HEADER);
    expect(soloHeader.ok).toBe(false);
    expect(soloHeader.fileError).toBe(true);
    expect(soloHeader.errors[0].message).toContain('solo encabezado');
  });

  it('cédula inválida o duplicada son warnings, no errores: no bloquean el archivo', () => {
    const csv = [
      HEADER,
      'abc,,', // cédula no numérica (ej. fila de pie de página) → línea 2
      '0000,,', // todo-ceros → línea 3
      '33334444,,', // OK → línea 4
      '33334444,,', // cédula duplicada → línea 5
    ].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true); // ninguna de las cuatro filas produce un error bloqueante
    expect(report.errors).toHaveLength(0);
    expect(report.totalDataRows).toBe(4);
    expect(report.validRows).toHaveLength(1);
    expect(report.validRows[0].line).toBe(4);

    const byLine = (line: number) => report.warnings.find((w) => w.line === line);
    expect(byLine(2)?.column).toBe('cedula');
    expect(byLine(2)?.message).toContain('se ignora');
    expect(byLine(3)?.column).toBe('cedula'); // todo-ceros también es inválida

    const duplicada = byLine(5);
    expect(duplicada?.message).toContain('duplicada');
    expect(duplicada?.message).toContain('línea 4');
  });

  it('un archivo con SOLO cédulas duplicadas queda ok:true — el duplicado no bloquea el archivo', () => {
    const csv = [HEADER, '11112222,,', '11112222,,', '33334444,,'].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.validRows).toHaveLength(2); // solo la primera aparición de cada cédula
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatchObject({ line: 3, column: 'cedula', rawCedula: '11112222' });
    expect(report.warnings[0].message).toContain('se ignora');
  });

  it('tolera filas de pie de página al final del archivo (cédula no numérica) sin bloquear el resto', () => {
    const csv = [
      HEADER,
      '11112222,SUBSIDIADO,',
      '33334444,CONTRIBUTIVO,',
      'NOMBRE DE LA IPS,,',
      'ESE HOSPITAL SAN VICENTE DE PAUL,,',
    ].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.validRows).toHaveLength(2);
    expect(report.warnings).toHaveLength(2);
    expect(report.warnings.every((w) => w.message.includes('Cédula inválida'))).toBe(true);
  });

  it('valida régimen cuando viene con datos corruptos (telefono corrupto se tolera aparte)', () => {
    const csv = [HEADER, '11112222,SUBSIDIADO,', '55556666,RARO,12'].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(false);
    // Es un error DE ESA FILA: el resto del archivo se puede importar si
    // quien carga acepta ignorarla.
    expect(report.fileError).toBe(false);
    const columns = report.errors.map((e) => e.column);
    expect(columns).toEqual(['regimen']);
  });

  it('ignora líneas vacías al final y tolera el BOM de Excel', () => {
    const csv = `﻿${HEADER}\n77778888,,\n\n\n`;

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.totalDataRows).toBe(1);
  });

  it('rechaza un .xlsx renombrado a .csv (firma ZIP) con mensaje específico', () => {
    const fakeXlsx = 'PK' + 'basura binaria sin sentido';

    const report = validatePadronCsv(fakeXlsx);

    expect(report.ok).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].message).toContain('Excel (.xlsx)');
  });

  it('rechaza un PDF renombrado a .csv con mensaje específico', () => {
    const fakePdf = '%PDF-1.4 no es un csv';

    const report = validatePadronCsv(fakePdf);

    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toContain('PDF');
  });

  it('una fila corrida que no se puede reacomodar es un error de esa fila, con el conteo de columnas', () => {
    const csv = [
      HEADER,
      // Un valor con coma sin comillas corre todas las columnas siguientes, y
      // en una fila corrida «SUB» no cuenta como régimen: puede ser un pedazo.
      '11223344,SUB,SID,IADO',
      '55667788,SUBSIDIADO,',
    ].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(false);
    expect(report.fileError).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ line: 2, column: 'regimen', rawCedula: '11223344' });
    expect(report.errors[0].message).toContain('4 columna(s)');
    expect(report.errors[0].message).toContain('define 3');
    expect(report.validRows.map((r) => r.cedula)).toEqual(['55667788']);
  });

  it('una fila con celdas de menos al final (Excel no escribe las vacías) se lee normal', () => {
    const csv = [HEADER, '11223344,SUBSIDIADO'].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.validRows[0]).toMatchObject({ cedula: '11223344', regime: 'SUBSIDIADO', phone: null });
    expect(report.validRows[0].repair).toBeUndefined();
  });

  it('reacomoda una fila con una celda de más ANTES de la cédula y lo anota', () => {
    const csv = [
      'tipo;cedula;regimen;celular',
      'CC;87654321;CONTRIBUTIVO;3007654321',
      'CC;1;12345678;SUBSIDIADO;3001234567',
    ].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.validRows[1]).toMatchObject({ cedula: '12345678', regime: 'SUBSIDIADO', phone: '3001234567' });
    expect(report.validRows[1].repair).toContain('5 columna(s)');
    expect(report.validRows[1].repair).toContain('la cédula, el régimen y el teléfono');
    expect(report.validRows[0].repair).toBeUndefined();
  });

  it('reacomoda la fila corrida que trae las mismas columnas (Salud Total, línea 8788 del corte del 19-10-2026)', () => {
    // «HIJO DE ANGIE;VERONICA;CAÑAS;ARENAS»: el nombre trae una celda de más
    // y a la fila le falta la última (vacía), así que el conteo cuadra pero
    // en la columna del régimen cae el celular.
    const csv = [
      'Documento;Nombre;Apellido1;Apellido2;telefonomovil;Regimen;Ciudad;Email',
      '10000702;FEDERMAN;MARULANDA;OSSA;3206961849;SUBSIDIADO;Anserma;',
      '26098810324418;HIJO DE ANGIE;VERONICA;CAÑAS;ARENAS;3137722068;SUBSIDIADO;Aguadas',
    ].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.validRows[1]).toMatchObject({
      cedula: '26098810324418',
      regime: 'SUBSIDIADO',
      phone: '3137722068',
    });
    expect(report.validRows[1].repair).toContain('el régimen y el teléfono');
  });

  it('no adivina la cédula de una fila corrida si dos celdas podrían serlo: error de esa fila', () => {
    const csv = ['codigo_interno;cedula;regimen', '54;87654321;CONTRIBUTIVO', '55;443322;12345678;SUBSIDIADO'].join(
      '\n',
    );

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(false);
    expect(report.fileError).toBe(false);
    expect(report.validRows.map((r) => r.cedula)).toEqual(['87654321']);
    expect(report.errors[0].column).toBe('cedula');
    expect(report.errors[0].message).toContain('"443322" o "12345678"');
  });

  it('rechaza un archivo que supera el máximo de filas permitidas', () => {
    const rows = Array.from({ length: 20_001 }, (_, i) => `${10_000_000 + i},,`);
    const csv = [HEADER, ...rows].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(false);
    // Bloquea todo: importar solo las primeras 20.000 desactivaría al resto.
    expect(report.fileError).toBe(true);
    expect(report.errors.some((e) => e.message.includes('20000 filas'))).toBe(true);
  });

  it('adjunta la cédula cruda a los errores de una fila, para poder trazarla sin guardar toda la fila', () => {
    const csv = [HEADER, '11112222,SUBSIDIADO,', '55556666,RARO,12'].join('\n'); // regimen inválido (telefono "12" se tolera)
    const report = validatePadronCsv(csv);

    expect(report.errors.every((e) => e.rawCedula === '55556666')).toBe(true);
  });

  it('no adjunta cédula cruda a errores que no son de una fila (encabezado, conteo de filas)', () => {
    const soloHeader = validatePadronCsv(HEADER);
    expect(soloHeader.errors[0].rawCedula).toBeUndefined();
  });

  it('ignora líneas de "basura" antes del encabezado real y lo reporta', () => {
    const csv = [
      'Hospital San Vicente de Paúl',
      'Corte del padrón - agosto 2026',
      '',
      HEADER,
      '11223344,SUBSIDIADO,3001234567',
    ].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.ignoredPreambleLines).toBe(3);
    expect(report.totalDataRows).toBe(1);
    expect(report.validRows[0]).toMatchObject({ line: 5, cedula: '11223344' });
  });

  it('reporta ignoredPreambleLines en 0 cuando el encabezado ya está en la primera línea', () => {
    const csv = [HEADER, '11223344,,'].join('\n');
    const report = validatePadronCsv(csv);
    expect(report.ignoredPreambleLines).toBe(0);
  });

  it('encuentra columnas reales del hospital (nombre, eps, email, etc.) e ignora las que no necesita', () => {
    const csv = [
      'cedula,nombre_completo,eps,telefono,email,fecha_nacimiento,genero,direccion',
      '2455707906,Juan Carlos Pérez Gutiérrez,Salud Total,+57 344 246 1083,juan.perez99@outlook.com,,M,',
    ].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.validRows[0]).toMatchObject({
      cedula: '2455707906',
      regime: null, // no hay columna "regimen": queda null, no es error
      phone: '3442461083',
    });
  });

  it('mantiene el documento normalizado (sin ceros iniciales colapsados)', () => {
    // El importador y los portones de agendamiento comparten normalización,
    // pero deliberadamente NO quitan ceros a la izquierda en la primera
    // pasada — ver documento.ts.
    const csv = [HEADER, '0012345,,'].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.validRows[0].cedula).toBe('0012345');
  });

  describe('encuentra las columnas solo, sin editar el archivo de la EPS', () => {
    it('Sura (corte del 08-10-2026): la cédula es «Numero_Identificacion», no el documento del cotizante ni el código del cliente', () => {
      const csv = [
        'Cliente_Id;TIPIDE_COTIZANTE;NUMIDE_COTIZANTE;Codigo_Tipo_Identificacion_Op;Numero_Identificacion;Primer_Nombre;TELEFONO;CELULAR;Numero_Celular_Contacto;REGIMEN',
        '27871994;C;4346600;C;24388463;DORA;3166783;3122275379;;CONTRIBUTIVO',
        '19409846;C;24392363;C;24392363;MARIA;;;3001112233;SUBSIDIADO',
      ].join('\n');

      const report = validatePadronCsv(csv);

      expect(report.ok).toBe(true);
      expect(report.columns).toEqual({
        cedula: 'Numero_Identificacion',
        regimen: 'REGIMEN',
        telefono: ['CELULAR', 'TELEFONO', 'Numero_Celular_Contacto'],
      });
      expect(report.validRows[0]).toMatchObject({ cedula: '24388463', regime: 'CONTRIBUTIVO', phone: '3122275379' });
      // Sin celular propio, sirve el del contacto.
      expect(report.validRows[1]).toMatchObject({ cedula: '24392363', phone: '3001112233' });
    });

    it('Salud Total: el celular está en «telefonomovil», no en «Telefono» (relleno «2000000» o fijo de 7 dígitos)', () => {
      const csv = [
        'nit;TipoDocumento;Documento;DOC_Cotizante;Telefono;telefonomovil;Regimen;',
        '800191101;CEDULA DE CIUDADANIA   ;10000702;10000702;2000000;3206961849;SUBSIDIADO;',
        '800191101;CEDULA DE CIUDADANIA   ;10002511;10002511;3145666;;SUBSIDIADO;',
        '800191101;CEDULA DE CIUDADANIA   ;10004619;10004619;6068532500;;CONTRIBUTIVO;',
      ].join('\n');

      const report = validatePadronCsv(csv);

      expect(report.ok).toBe(true);
      expect(report.columns.cedula).toBe('Documento');
      expect(report.columns.telefono).toEqual(['telefonomovil', 'Telefono']);
      expect(report.validRows.map((r) => r.phone)).toEqual(['3206961849', null, '6068532500']);
    });

    it('entre dos columnas con nombre de cédula, decide el contenido', () => {
      const csv = ['documento;identificacion', 'CEDULA;12345678', 'CEDULA;87654321'].join('\n');

      const report = validatePadronCsv(csv);

      expect(report.columns.cedula).toBe('identificacion');
      expect(report.validRows.map((r) => r.cedula)).toEqual(['12345678', '87654321']);
    });

    it('sin encabezado de régimen, lo encuentra por contenido — pero «C» de cédula no cuenta como CONTRIBUTIVO', () => {
      const csv = ['cedula;tipo_doc;Plan de beneficios', '12345678;C;Régimen Subsidiado', '87654321;C;CONTRIBUTIVO'].join(
        '\n',
      );

      const report = validatePadronCsv(csv);

      expect(report.columns.regimen).toBe('Plan de beneficios');
      expect(report.validRows.map((r) => r.regime)).toEqual(['SUBSIDIADO', 'CONTRIBUTIVO']);
    });

    it('una columna «Régimen» sin SUBSIDIADO/CONTRIBUTIVO no se usa: no tumba las filas', () => {
      const csv = ['cedula;regimen', '12345678;1', '87654321;2'].join('\n');

      const report = validatePadronCsv(csv);

      expect(report.ok).toBe(true);
      expect(report.columns.regimen).toBeNull();
      expect(report.validRows.map((r) => r.regime)).toEqual([null, null]);
    });
  });
});
