import { AVISOS_CSV_HEADERS, validateAvisosCsv } from './avisos-csv';

const HEADER = AVISOS_CSV_HEADERS.join(','); // documento,nombre,telefono,fecha_hora_cita

describe('validateAvisosCsv', () => {
  it('acepta un archivo completo y normaliza los datos', () => {
    const csv = [HEADER, '1.088.123.456,Juan Pérez,300 123 4567,2026-09-24 07:00'].join('\n');

    const report = validateAvisosCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.validRows).toHaveLength(1);
    expect(report.validRows[0]).toMatchObject({
      documento: '1088123456', // sin puntos
      nombre: 'Juan Pérez',
      phoneE164: '+573001234567',
    });
    // 2026-09-24 07:00 hora Bogotá (UTC-5) = 12:00 UTC.
    expect(report.validRows[0].appointmentAtUtc.toISOString()).toBe('2026-09-24T12:00:00.000Z');
  });

  it('acepta el nombre vacío: es la única columna opcional', () => {
    const csv = [HEADER, '12345678,,3001234567,2026-09-24 07:00'].join('\n');

    const report = validateAvisosCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.validRows[0].nombre).toBeNull();
  });

  it('acepta el delimitador ";" de Excel es-CO y encabezados con alias/tildes', () => {
    const csv = [
      'Cédula;Nombre Completo;Celular;Fecha y hora de la cita',
      '12345678;Ana Ruiz;3001234567;2026-09-24 07:00',
    ].join('\r\n');

    const report = validateAvisosCsv(csv);

    expect(report.delimiter).toBe(';');
    expect(report.ok).toBe(true);
    expect(report.validRows[0].documento).toBe('12345678');
  });

  it('acepta campos entre comillas con el delimitador adentro', () => {
    const csv = [HEADER, '"98,765,432",Nombre,3001234567,2026-09-24 07:00'].join('\n');

    const report = validateAvisosCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.validRows[0].documento).toBe('98765432');
  });

  it('acepta un número de serie de Excel para la fecha (celda con formato fecha real)', () => {
    // La celda de Excel guarda la hora de PARED tal cual se escribió
    // ("2026-09-24 07:00"), sin zona horaria — el serial se deriva de esa
    // lectura naive, y el validador es quien la convierte a UTC (+5h).
    const serial = Date.UTC(2026, 8, 24, 7, 0, 0) / 86_400_000 + 25569;
    const csv = [HEADER, `12345678,Nombre,3001234567,${serial}`].join('\n');

    const report = validateAvisosCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.validRows[0].appointmentAtUtc.toISOString()).toBe('2026-09-24T12:00:00.000Z');
  });

  it('rechaza el archivo sin las columnas obligatorias', () => {
    const report = validateAvisosCsv('nombre,telefono\nJuan,3001234567');

    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toContain('documento');
    expect(report.errors[0].message).toContain('fecha_hora_cita');
  });

  it('rechaza archivo vacío y archivo con solo encabezado', () => {
    expect(validateAvisosCsv('').ok).toBe(false);

    const soloHeader = validateAvisosCsv(HEADER);
    expect(soloHeader.ok).toBe(false);
    expect(soloHeader.errors[0].message).toContain('solo encabezado');
  });

  it('rechaza documento inválido, teléfono fijo y fecha mal formada, cada uno con su línea', () => {
    const csv = [
      HEADER,
      '00,Nombre,3001234567,2026-09-24 07:00', // documento solo ceros
      '12345678,Nombre,8871234,2026-09-24 07:00', // fijo, no celular
      '12345678,Nombre,3001234568,24/09/2026', // formato de fecha no soportado
    ].join('\n');

    const report = validateAvisosCsv(csv);

    expect(report.ok).toBe(false);
    expect(report.errors).toHaveLength(3);
    expect(report.errors[0]).toMatchObject({ line: 2, column: 'documento' });
    expect(report.errors[1]).toMatchObject({ line: 3, column: 'telefono' });
    expect(report.errors[2]).toMatchObject({ line: 4, column: 'fecha_hora_cita' });
  });

  it('rechaza teléfono y fecha vacíos con su propio mensaje (son obligatorios)', () => {
    const csv = [HEADER, '12345678,Nombre,,2026-09-24 07:00', '87654321,Nombre,3001234567,'].join(
      '\n',
    );

    const report = validateAvisosCsv(csv);

    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toContain('Falta el teléfono');
    expect(report.errors[1].message).toContain('Falta la fecha');
  });

  it('rechaza el mismo documento duplicado para la MISMA cita, pero acepta dos citas distintas', () => {
    const csv = [
      HEADER,
      '12345678,Nombre,3001234567,2026-09-24 07:00',
      '12345678,Nombre,3001234567,2026-09-24 07:00', // duplicado exacto
      '12345678,Nombre,3001234567,2026-09-24 09:00', // misma persona, otra cita: válido
    ].join('\n');

    const report = validateAvisosCsv(csv);

    expect(report.ok).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].message).toContain('duplicado');
    expect(report.validRows).toHaveLength(2);
  });

  it('normaliza un teléfono ya en formato +57 sin duplicar el indicativo', () => {
    const csv = [HEADER, '12345678,Nombre,+57 300 123 4567,2026-09-24 07:00'].join('\n');

    const report = validateAvisosCsv(csv);

    expect(report.ok).toBe(true);
    expect(report.validRows[0].phoneE164).toBe('+573001234567');
  });

  it('rechaza un "31 de abril" inexistente', () => {
    const csv = [HEADER, '12345678,Nombre,3001234567,2026-04-31 07:00'].join('\n');

    const report = validateAvisosCsv(csv);

    expect(report.ok).toBe(false);
    expect(report.errors[0].column).toBe('fecha_hora_cita');
  });

  it('rechaza una fila con más columnas de las que declara el encabezado', () => {
    const csv = [HEADER, '12345678,Nombre,3001234567,2026-09-24 07:00,extra'].join('\n');

    const report = validateAvisosCsv(csv);

    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toContain('columna(s)');
  });

  it('detecta un .xlsx renombrado a .csv por su firma binaria', () => {
    const report = validateAvisosCsv('PK\x03\x04resto-de-bytes-binarios');

    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toContain('Excel');
  });

  // ── Contra el mock real del repo (copiado literal, no leído del disco:
  // este paquete es puro, sin I/O — ver el docblock de padron-csv.ts) ──────
  // docs/drivers/cnt-sanvicente-anserma/avisos/avisos_mock_es01_internista.csv
  // se commitea ya validado con ESTE MISMO validador: 12 filas ok, 2
  // rechazadas (línea 12: fijo de 7 dígitos; línea 13: documento vacío) — ver
  // el README de esa carpeta. Si el mock cambia, este test debe cambiar con él.
  const MOCK_CSV = [
    'documento,nombre,telefono,fecha_hora_cita',
    '1037456123,Luz Elena Restrepo Gómez,3114567890,2026-09-24 07:00',
    '71298456,Jorge Iván Cardona Ruiz,3007891234,2026-09-24 07:20',
    '43876521,Marta Cecilia Gallego Osorio,3159873456,2026-09-24 07:40',
    '98456712,Hernán Darío Zuluaga Mejía,3187654321,2026-09-24 08:00',
    '1128934567,Diana Patricia Loaiza Vélez,3201122334,2026-09-24 08:20',
    '8734129,Wilson Andrés Tabares Cifuentes,3045566778,2026-09-24 08:40',
    '1053798246,Sandra Milena Arroyave Correa,3112233445,2026-09-24 09:00',
    '76543219,Gustavo Adolfo Henao Villa,3223344556,2026-09-24 09:20',
    '1039871245,Beatriz Elena Marulanda Ospina,3134455667,2026-09-24 09:40',
    '39456781,Carlos Mario Quintero Ríos,3195566778,2026-09-24 10:00',
    '1029384756,Rocío del Pilar Echeverri Buitrago,8871234,2026-09-24 10:20',
    ',Fabián Alberto Correa Londoño,3167788990,2026-09-24 10:40',
    '1145623478,Nubia Esperanza Cano Restrepo,3178899001,2026-09-24 11:00',
    '52341678,Rubén Darío Peláez Aguirre,3209900112,2026-09-24 11:20',
  ].join('\n');

  it('valida el mock real del driver: 12 filas ok, 2 rechazadas con su motivo', () => {
    const report = validateAvisosCsv(MOCK_CSV);

    expect(report.totalDataRows).toBe(14);
    expect(report.validRows).toHaveLength(12);
    expect(report.errors).toHaveLength(2);
    expect(report.errors.map((e) => e.line).sort()).toEqual([12, 13]);
    expect(report.errors.find((e) => e.line === 12)?.column).toBe('telefono');
    expect(report.errors.find((e) => e.line === 13)?.column).toBe('documento');
  });
});
