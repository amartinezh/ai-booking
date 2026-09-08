import { validatePadronCsv, PADRON_CSV_HEADERS } from './padron-csv';

const EPS_CATALOG = ['Sura', 'Nueva EPS', 'Particular'];

const HEADER = PADRON_CSV_HEADERS.join(',');

describe('validatePadronCsv', () => {
  it('acepta un archivo completo y normaliza los datos', () => {
    const csv = [
      HEADER,
      '1.088.123.456,Ana María Pérez,sura,+57 300 123 4567,ANA@MAIL.COM,1990-05-10,f,Calle 1 #2-3',
    ].join('\n');

    const report = validatePadronCsv(csv, EPS_CATALOG);

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.validRows).toHaveLength(1);
    expect(report.validRows[0]).toMatchObject({
      cedula: '1088123456', // sin puntos
      fullName: 'Ana María Pérez',
      epsName: 'Sura', // casado al nombre exacto del catálogo
      phone: '573001234567',
      email: 'ana@mail.com', // minúsculas
      dateOfBirth: '1990-05-10',
      gender: 'F',
      address: 'Calle 1 #2-3',
    });
  });

  it('acepta el delimitador ";" de Excel es-CO y encabezados con alias/tildes', () => {
    const csv = [
      'Cédula;Nombre Completo;EPS;Teléfono;Correo;Fecha de Nacimiento;Sexo;Dirección',
      '12345678;Juan Rojas;NUEVA eps;;;;;',
    ].join('\r\n');

    const report = validatePadronCsv(csv, EPS_CATALOG);

    expect(report.delimiter).toBe(';');
    expect(report.ok).toBe(true);
    expect(report.validRows[0].epsName).toBe('Nueva EPS');
    expect(report.validRows[0].phone).toBeNull();
  });

  it('acepta fecha DD/MM/AAAA y campos entre comillas con el delimitador adentro', () => {
    const csv = [HEADER, '"98765432","Pérez, Luisa",Sura,,,10/12/1985,,'].join('\n');

    const report = validatePadronCsv(csv, EPS_CATALOG);

    expect(report.ok).toBe(true);
    expect(report.validRows[0].fullName).toBe('Pérez, Luisa');
    expect(report.validRows[0].dateOfBirth).toBe('1985-12-10');
  });

  it('rechaza el archivo sin columnas obligatorias', () => {
    const report = validatePadronCsv('nombre,telefono\nJuan,123', EPS_CATALOG);

    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toContain('cedula');
    expect(report.errors[0].message).toContain('eps');
  });

  it('rechaza archivo vacío y archivo con solo encabezado', () => {
    expect(validatePadronCsv('', EPS_CATALOG).ok).toBe(false);

    const soloHeader = validatePadronCsv(HEADER, EPS_CATALOG);
    expect(soloHeader.ok).toBe(false);
    expect(soloHeader.errors[0].message).toContain('solo encabezado');
  });

  it('reporta errores por línea: cédula inválida, EPS desconocida y duplicados', () => {
    const csv = [
      HEADER,
      'abc,Pedro Gómez,Sura,,,,,', // cédula no numérica → línea 2
      '11112222,María Díaz,Coosalud,,,,,', // EPS fuera de catálogo → línea 3
      '33334444,Luis Vera,Sura,,,,,', // OK → línea 4
      '33334444,Luis Vera Bis,Sura,,,,,', // cédula duplicada → línea 5
    ].join('\n');

    const report = validatePadronCsv(csv, EPS_CATALOG);

    expect(report.ok).toBe(false);
    expect(report.totalDataRows).toBe(4);
    expect(report.validRows).toHaveLength(1);
    expect(report.validRows[0].line).toBe(4);

    const byLine = (line: number) => report.errors.find((e) => e.line === line);
    expect(byLine(2)?.column).toBe('cedula');
    expect(byLine(3)?.message).toContain('Coosalud');
    expect(byLine(5)?.message).toContain('duplicada');
    expect(byLine(5)?.message).toContain('línea 4');
  });

  it('valida los campos opcionales cuando vienen con datos corruptos', () => {
    const csv = [
      HEADER,
      '55556666,Rosa Lema,Sura,12,notanemail,31/02/2000,X,',
    ].join('\n');

    const report = validatePadronCsv(csv, EPS_CATALOG);

    expect(report.ok).toBe(false);
    const columns = report.errors.map((e) => e.column);
    expect(columns).toEqual(
      expect.arrayContaining(['telefono', 'email', 'fecha_nacimiento', 'genero']),
    );
  });

  it('ignora líneas vacías al final y tolera el BOM de Excel', () => {
    const csv = `﻿${HEADER}\n77778888,Iván Soto,Particular,,,,,\n\n\n`;

    const report = validatePadronCsv(csv, EPS_CATALOG);

    expect(report.ok).toBe(true);
    expect(report.totalDataRows).toBe(1);
  });

  it('rechaza un .xlsx renombrado a .csv (firma ZIP) con mensaje específico', () => {
    const fakeXlsx = 'PK' + 'basura binaria sin sentido';

    const report = validatePadronCsv(fakeXlsx, EPS_CATALOG);

    expect(report.ok).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].message).toContain('Excel (.xlsx)');
  });

  it('rechaza un PDF renombrado a .csv con mensaje específico', () => {
    const fakePdf = '%PDF-1.4 no es un csv';

    const report = validatePadronCsv(fakePdf, EPS_CATALOG);

    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toContain('PDF');
  });

  it('reporta con detalle una fila con más columnas de las que define el encabezado (coma suelta)', () => {
    const csv = [
      HEADER,
      // "Pérez, Luisa" sin comillas: la coma interna corre todas las columnas siguientes.
      '11223344,Pérez, Luisa,Sura,,,,,',
    ].join('\n');

    const report = validatePadronCsv(csv, EPS_CATALOG);

    expect(report.ok).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].line).toBe(2);
    expect(report.errors[0].message).toContain('9 columna(s)');
    expect(report.errors[0].message).toContain('8');
    // No debe intentar validar campo por campo sobre datos desalineados.
    expect(report.errors[0].column).toBeUndefined();
  });

  it('reporta con detalle una fila con menos columnas de las que define el encabezado', () => {
    const csv = [HEADER, '11223344,Luis Vera,Sura'].join('\n');

    const report = validatePadronCsv(csv, EPS_CATALOG);

    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toContain('3 columna(s)');
    expect(report.errors[0].message).toContain('8');
  });

  it('rechaza un archivo que supera el máximo de filas permitidas', () => {
    const rows = Array.from(
      { length: 20_001 },
      (_, i) => `${10_000_000 + i},Paciente ${i},Sura,,,,,`,
    );
    const csv = [HEADER, ...rows].join('\n');

    const report = validatePadronCsv(csv, EPS_CATALOG);

    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.message.includes('20000 filas'))).toBe(true);
  });
});
