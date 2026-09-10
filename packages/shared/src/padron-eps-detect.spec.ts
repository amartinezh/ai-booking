import { detectPadronEps } from './padron-eps-detect';

const CANDIDATES = [
  { id: 'eps-1', name: 'Salud Total' },
  { id: 'eps-2', name: 'Sura' },
];

describe('detectPadronEps', () => {
  it('detecta la EPS por una columna "eps" con valor mayoritario', () => {
    const csv = [
      'cedula,nombre_completo,eps,telefono',
      '111,Juan Pérez,Salud Total,3001234567',
      '222,Ana Gómez,Salud Total,3009876543',
      '333,Luis Ruiz,Salud Total,',
    ].join('\n');

    const result = detectPadronEps(csv, 'reporte.csv', CANDIDATES);

    expect(result?.eps.id).toBe('eps-1');
    expect(result?.source).toBe('columna del archivo');
  });

  it('detecta la EPS por una columna "aseguradora" aunque el valor sea más largo (Suramericana ⊃ Sura)', () => {
    const csv = ['cedula,aseguradora', '111,Suramericana', '222,Suramericana'].join('\n');

    const result = detectPadronEps(csv, 'archivo.csv', CANDIDATES);

    expect(result?.eps.id).toBe('eps-2');
    expect(result?.source).toBe('columna del archivo');
  });

  it('cuando no hay columna de EPS, cae al nombre del archivo', () => {
    const csv = ['cedula,regimen,telefono', '111,SUBSIDIADO,'].join('\n');

    const result = detectPadronEps(csv, 'Base de Datos Salud total 10-08-2026.xlsx', CANDIDATES);

    expect(result?.eps.id).toBe('eps-1');
    expect(result?.source).toBe('nombre del archivo');
  });

  it('reconoce "Suramericana" en el nombre del archivo como la EPS "Sura"', () => {
    const csv = ['cedula,regimen,telefono', '111,,'].join('\n');

    const result = detectPadronEps(csv, 'Base de Datos Suramericana 19-08-2026.csv', CANDIDATES);

    expect(result?.eps.id).toBe('eps-2');
  });

  it('no adivina cuando la columna eps tiene valores mixtos sin mayoría clara', () => {
    const csv = [
      'cedula,eps',
      '111,Salud Total',
      '222,Sura',
      '333,Nueva EPS',
    ].join('\n');

    const result = detectPadronEps(csv, 'padron.csv', CANDIDATES);

    // El valor más frecuente empata entre varios y ninguno domina de forma
    // clara sobre uno solo de los dos candidatos autorizados.
    expect(result).toBeNull();
  });

  it('no adivina cuando el nombre del archivo no menciona ninguna EPS conocida', () => {
    const csv = ['cedula,regimen,telefono', '111,,'].join('\n');

    const result = detectPadronEps(csv, 'padron_corte_agosto.csv', CANDIDATES);

    expect(result).toBeNull();
  });

  it('no adivina cuando el nombre del archivo coincide con más de una EPS candidata', () => {
    const csv = ['cedula,regimen,telefono', '111,,'].join('\n');

    const result = detectPadronEps(csv, 'salud total y sura consolidado.csv', CANDIDATES);

    expect(result).toBeNull();
  });

  it('devuelve null si no hay EPS candidatas', () => {
    const csv = ['cedula,eps', '111,Salud Total'].join('\n');

    expect(detectPadronEps(csv, 'archivo.csv', [])).toBeNull();
  });
});
