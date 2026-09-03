import {
  addBusinessHours,
  reminderWindow,
  formatForPatient,
} from './business-hours';

/**
 * El recordatorio de una cita se dispara N HORAS HÁBILES antes. Toda esa
 * aritmética vive aquí y se hace en hora de Bogotá (UTC-5, sin horario de
 * verano), así que un error de signo o de zona manda el WhatsApp el día
 * equivocado — o no lo manda nunca.
 *
 * Convención de las pruebas: los `Date` se escriben en UTC y se anota al lado
 * qué hora de Bogotá representan (UTC-5).
 */

/** Construye un UTC a partir de la hora local de Bogotá que se quiere probar. */
const bogota = (iso: string) => new Date(`${iso}-05:00`);
const enBogota = (d: Date) =>
  new Intl.DateTimeFormat('es-CO', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(d);

describe('addBusinessHours — sábado y domingo no cuentan', () => {
  it('viernes 10:00 + 24 h hábiles → lunes 10:00', () => {
    const r = addBusinessHours(bogota('2026-05-15T10:00:00'), 24);
    expect(r.toISOString()).toBe(bogota('2026-05-18T10:00:00').toISOString());
  });

  it('lunes 10:00 − 24 h hábiles → viernes 10:00 (la resta salta el fin de semana igual)', () => {
    const r = addBusinessHours(bogota('2026-05-18T10:00:00'), -24);
    expect(r.toISOString()).toBe(bogota('2026-05-15T10:00:00').toISOString());
  });

  it('lunes 00:30 − 1 h → viernes 23:30 (cruza el borde del día y del fin de semana)', () => {
    const r = addBusinessHours(bogota('2026-05-18T00:30:00'), -1);
    expect(r.toISOString()).toBe(bogota('2026-05-15T23:30:00').toISOString());
  });

  it('dentro de la semana es una suma normal: martes 09:00 + 5 → martes 14:00', () => {
    const r = addBusinessHours(bogota('2026-05-19T09:00:00'), 5);
    expect(r.toISOString()).toBe(bogota('2026-05-19T14:00:00').toISOString());
  });

  it('cruzar la medianoche de un día hábil no salta nada: miércoles 22:00 + 4 → jueves 02:00', () => {
    const r = addBusinessHours(bogota('2026-05-20T22:00:00'), 4);
    expect(r.toISOString()).toBe(bogota('2026-05-21T02:00:00').toISOString());
  });

  it('nunca aterriza en sábado ni en domingo, sea cual sea el desplazamiento', () => {
    const inicio = bogota('2026-05-15T08:00:00'); // viernes
    for (let h = 1; h <= 80; h++) {
      const r = addBusinessHours(inicio, h);
      const dia = enBogota(r).slice(0, 3).toLowerCase();
      expect(['sáb', 'dom']).not.toContain(dia);
    }
  });

  it('la semana hábil completa: viernes 08:00 + 40 h → martes 00:00', () => {
    const r = addBusinessHours(bogota('2026-05-15T08:00:00'), 40);
    expect(r.toISOString()).toBe(bogota('2026-05-19T00:00:00').toISOString());
  });

  describe('argumentos degenerados: devuelve una copia, nunca la misma referencia', () => {
    const base = bogota('2026-05-19T09:00:00');

    it.each([
      ['cero', 0],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
    ])('%s no mueve la fecha', (_etiqueta, horas) => {
      const r = addBusinessHours(base, horas);
      expect(r.getTime()).toBe(base.getTime());
      expect(r).not.toBe(base);
    });

    it('las fracciones se truncan: +1.9 h es +1 h', () => {
      const r = addBusinessHours(base, 1.9);
      expect(r.toISOString()).toBe(bogota('2026-05-19T10:00:00').toISOString());
    });
  });

  it('no muta la fecha que recibe', () => {
    const base = bogota('2026-05-15T10:00:00');
    const copia = new Date(base.getTime());
    addBusinessHours(base, 24);
    expect(base.getTime()).toBe(copia.getTime());
  });

  /**
   * 📌 DESVIACIÓN CONOCIDA respecto al comentario de la función.
   *
   * El docblock promete `addBusinessHours(sábado 12:00, +1) → lunes 01:00`, es
   * decir: "el fin de semana no existe, la cuenta arranca el lunes a las
   * 00:00". La implementación conserva la HORA DEL DÍA al saltar el bloque
   * (lunes 13:00), así que arrancando DENTRO del fin de semana la ventana sale
   * hasta 24 h más ancha de lo pedido.
   *
   * Consecuencia real: el cron de recordatorios también corre sábado y
   * domingo, y en esos ticks adelanta recordatorios que aún no tocaban. No
   * pierde ninguno ni duplica (`reminderSentAt` lo impide) — por eso se fija
   * la conducta ACTUAL aquí en vez de cambiarla, y queda documentada para
   * quien decida cuál de las dos es la buena.
   */
  it('arrancando en sábado conserva la hora del día (conducta actual, no la del docblock)', () => {
    const r = addBusinessHours(bogota('2026-05-16T12:00:00'), 1);
    expect(r.toISOString()).toBe(bogota('2026-05-18T13:00:00').toISOString());
    // Lo que el comentario de la función promete sería esto:
    expect(r.toISOString()).not.toBe(
      bogota('2026-05-18T01:00:00').toISOString(),
    );
  });
});

describe('reminderWindow', () => {
  it('la ventana empieza AHORA y termina N horas hábiles después', () => {
    const ahora = bogota('2026-05-15T10:00:00'); // viernes
    const { from, to } = reminderWindow(ahora, 24);
    expect(from).toBe(ahora);
    expect(to.toISOString()).toBe(bogota('2026-05-18T10:00:00').toISOString());
  });

  it('con 0 horas la ventana es vacía: no hay nada que recordar todavía', () => {
    const ahora = bogota('2026-05-19T10:00:00');
    const { from, to } = reminderWindow(ahora, 0);
    expect(to.getTime()).toBe(from.getTime());
  });

  it('el borde superior siempre queda por delante del inferior con N positivo', () => {
    for (const h of [1, 6, 12, 24, 48, 72]) {
      const ahora = bogota('2026-05-19T10:00:00');
      const { from, to } = reminderWindow(ahora, h);
      expect(to.getTime()).toBeGreaterThan(from.getTime());
    }
  });
});

describe('formatForPatient', () => {
  it('presenta la hora de Bogotá, no la UTC del contenedor', () => {
    // 15:00 UTC = 10:00 en Bogotá. Un contenedor en UTC sin zona explícita
    // diría "3:00 p. m." y el paciente llegaría cinco horas tarde.
    const texto = formatForPatient(new Date('2026-05-15T15:00:00Z'));
    expect(texto).toMatch(/10:00/);
    expect(texto).not.toMatch(/15:00/);
  });

  it('incluye día de la semana, día y mes en español', () => {
    const texto = formatForPatient(bogota('2026-05-15T10:00:00'));
    expect(texto.toLowerCase()).toContain('viernes');
    expect(texto).toContain('15');
    expect(texto.toLowerCase()).toContain('mayo');
  });

  it('una cita de madrugada UTC sigue cayendo el día anterior en Bogotá', () => {
    // 02:00 UTC del sábado = 21:00 del viernes en Bogotá.
    const texto = formatForPatient(new Date('2026-05-16T02:00:00Z'));
    expect(texto.toLowerCase()).toContain('viernes');
  });
});
