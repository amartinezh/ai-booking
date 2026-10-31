import {
  domingoDePascua,
  esFestivoColombia,
  festivosColombia,
} from './festivos-colombia';

/**
 * 🇨🇴 Festivos de Colombia, calculados (2026-10-31): no cuentan para el plazo
 * máximo para agendar por el asistente.
 */
describe('festivos de Colombia', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
  ])('Domingo de Pascua de %i: %s', (anio, fecha) => {
    expect(domingoDePascua(anio)).toBe(fecha);
  });

  it('2026: los 18 festivos del calendario oficial', () => {
    expect(festivosColombia(2026)).toEqual([
      '2026-01-01', // Año Nuevo
      '2026-01-12', // Reyes (6 de enero, pasa al lunes)
      '2026-03-23', // San José
      '2026-04-02', // Jueves Santo
      '2026-04-03', // Viernes Santo
      '2026-05-01', // Día del Trabajo
      '2026-05-18', // Ascensión
      '2026-06-08', // Corpus Christi
      '2026-06-15', // Sagrado Corazón
      '2026-06-29', // San Pedro y San Pablo (ya es lunes)
      '2026-07-20', // Independencia
      '2026-08-07', // Batalla de Boyacá
      '2026-08-17', // Asunción
      '2026-10-12', // Día de la Raza (ya es lunes)
      '2026-11-02', // Todos los Santos (1 de noviembre, domingo)
      '2026-11-16', // Independencia de Cartagena
      '2026-12-08', // Inmaculada Concepción
      '2026-12-25', // Navidad
    ]);
  });

  it('2024 y 2027 también cuadran con el calendario oficial', () => {
    expect(festivosColombia(2024)).toEqual([
      '2024-01-01',
      '2024-01-08',
      '2024-03-25',
      '2024-03-28',
      '2024-03-29',
      '2024-05-01',
      '2024-05-13',
      '2024-06-03',
      '2024-06-10',
      '2024-07-01',
      '2024-07-20',
      '2024-08-07',
      '2024-08-19',
      '2024-10-14',
      '2024-11-04',
      '2024-11-11',
      '2024-12-08',
      '2024-12-25',
    ]);
    expect(festivosColombia(2027)).toEqual([
      '2027-01-01',
      '2027-01-11',
      '2027-03-22',
      '2027-03-25',
      '2027-03-26',
      '2027-05-01',
      '2027-05-10',
      '2027-05-31',
      '2027-06-07',
      '2027-07-05',
      '2027-07-20',
      '2027-08-07',
      '2027-08-16',
      '2027-10-18',
      '2027-11-01',
      '2027-11-15',
      '2027-12-08',
      '2027-12-25',
    ]);
  });

  it('esFestivoColombia', () => {
    expect(esFestivoColombia('2026-11-02')).toBe(true);
    // El 1 de noviembre pasó al lunes: ese domingo no es el festivo.
    expect(esFestivoColombia('2026-11-01')).toBe(false);
    expect(esFestivoColombia('2026-11-03')).toBe(false);
    expect(esFestivoColombia('no es fecha')).toBe(false);
  });
});
