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
      phone: '573001234567',
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

  it('rechaza el archivo sin la columna obligatoria (cedula)', () => {
    const report = validatePadronCsv('regimen,telefono\nSUBSIDIADO,123');

    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toContain('cedula');
  });

  it('rechaza archivo vacío y archivo con solo encabezado', () => {
    expect(validatePadronCsv('').ok).toBe(false);

    const soloHeader = validatePadronCsv(HEADER);
    expect(soloHeader.ok).toBe(false);
    expect(soloHeader.errors[0].message).toContain('solo encabezado');
  });

  it('reporta errores por línea: cédula inválida y duplicados', () => {
    const csv = [
      HEADER,
      'abc,,', // cédula no numérica → línea 2
      '0000,,', // todo-ceros → línea 3
      '33334444,,', // OK → línea 4
      '33334444,,', // cédula duplicada → línea 5
    ].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(false);
    expect(report.totalDataRows).toBe(4);
    expect(report.validRows).toHaveLength(1);
    expect(report.validRows[0].line).toBe(4);

    const byLine = (line: number) => report.errors.find((e) => e.line === line);
    expect(byLine(2)?.column).toBe('cedula');
    expect(byLine(3)?.column).toBe('cedula'); // todo-ceros también es inválida
    expect(byLine(5)?.message).toContain('duplicada');
    expect(byLine(5)?.message).toContain('línea 4');
  });

  it('valida los campos opcionales cuando vienen con datos corruptos', () => {
    const csv = [HEADER, '55556666,RARO,12'].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(false);
    const columns = report.errors.map((e) => e.column);
    expect(columns).toEqual(expect.arrayContaining(['regimen', 'telefono']));
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

  it('reporta con detalle una fila con más columnas de las que define el encabezado (coma suelta)', () => {
    const csv = [
      HEADER,
      // Un valor con coma sin comillas corre todas las columnas siguientes.
      '11223344,SUB,SID,IADO',
    ].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].line).toBe(2);
    expect(report.errors[0].message).toContain('4 columna(s)');
    expect(report.errors[0].message).toContain('3');
    // No debe intentar validar campo por campo sobre datos desalineados.
    expect(report.errors[0].column).toBeUndefined();
  });

  it('reporta con detalle una fila con menos columnas de las que define el encabezado', () => {
    const csv = [HEADER, '11223344,SUBSIDIADO'].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toContain('2 columna(s)');
    expect(report.errors[0].message).toContain('3');
  });

  it('rechaza un archivo que supera el máximo de filas permitidas', () => {
    const rows = Array.from({ length: 20_001 }, (_, i) => `${10_000_000 + i},,`);
    const csv = [HEADER, ...rows].join('\n');

    const report = validatePadronCsv(csv);

    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.message.includes('20000 filas'))).toBe(true);
  });

  it('adjunta la cédula cruda a los errores de una fila, para poder trazarla sin guardar toda la fila', () => {
    const csv = [HEADER, '55556666,RARO,12'].join('\n'); // regimen y telefono inválidos
    const report = validatePadronCsv(csv);

    expect(report.errors.every((e) => e.rawCedula === '55556666')).toBe(true);
  });

  it('no adjunta cédula cruda a errores que no son de una fila (encabezado, conteo de filas)', () => {
    const soloHeader = validatePadronCsv(HEADER);
    expect(soloHeader.errors[0].rawCedula).toBeUndefined();
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
});
