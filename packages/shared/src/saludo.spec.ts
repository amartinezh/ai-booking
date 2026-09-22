import { saludoPorHora } from './saludo';

/** Un instante UTC; la función tiene que leerlo en hora de Bogotá (UTC-5). */
const utc = (iso: string) => new Date(iso);

describe('saludoPorHora', () => {
  // 🐛 El caso que lo destapó: un recordatorio salió a las 2:21 p. m. de
  // Bogotá —19:21 UTC— dando los «Buenos días». El saludo estaba fijo en el
  // código; ahora se calcula, y en la zona de la clínica.
  it('las 2:21 p. m. de Bogotá son buenas tardes, no buenos días', () => {
    expect(saludoPorHora(utc('2026-09-22T19:21:54Z'))).toBe('Buenas tardes');
  });

  it.each([
    ['2026-09-22T05:00:00Z', '12:00 a m', 'Buenos días'],
    ['2026-09-22T13:00:00Z', '08:00 a m', 'Buenos días'],
    ['2026-09-22T16:59:00Z', '11:59 a m', 'Buenos días'],
    ['2026-09-22T17:00:00Z', '12:00 m', 'Buenas tardes'],
    ['2026-09-22T23:59:00Z', '06:59 p m', 'Buenas tardes'],
    ['2026-09-23T00:00:00Z', '07:00 p m', 'Buenas noches'],
    ['2026-09-23T04:59:00Z', '11:59 p m', 'Buenas noches'],
  ])('%s (%s en Bogotá) → %s', (iso, _local, esperado) => {
    expect(saludoPorHora(utc(iso))).toBe(esperado);
  });

  // ⚠️ Sin zona explícita, un contenedor en UTC leería las 19 h y saludaría
  // «Buenas noches» a alguien que está almorzando. El default NO es el reloj
  // del servidor.
  it('no usa el reloj del contenedor: el default es America/Bogota', () => {
    const tarde = utc('2026-09-22T19:21:54Z');
    expect(saludoPorHora(tarde)).toBe('Buenas tardes');
    expect(saludoPorHora(tarde, { timeZone: 'UTC' })).toBe('Buenas noches');
  });

  it('respeta la zona que le pasen (multi-tenant)', () => {
    const t = utc('2026-09-22T19:21:54Z');
    expect(saludoPorHora(t, { timeZone: 'America/Mexico_City' })).toBe(
      'Buenas tardes',
    );
    expect(saludoPorHora(t, { timeZone: 'Europe/Madrid' })).toBe(
      'Buenas noches',
    );
  });

  it('la medianoche es buenos días, no un día menos', () => {
    // 05:00 UTC = 00:00 en Bogotá. Con hourCycle h12 esto habría dado 12.
    expect(saludoPorHora(utc('2026-09-22T05:00:00Z'))).toBe('Buenos días');
  });
});
