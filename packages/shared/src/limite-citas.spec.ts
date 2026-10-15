import {
  LIMITE_CITAS,
  etiquetaPeriodo,
  evaluarLimiteCitas,
  limitesDeLaClinica,
  normalizarLimiteDia,
  normalizarLimiteMes,
  periodoDelLimite,
  type LimitesCitas,
} from './limite-citas';

/** Ese instante de Bogotá (UTC-5), con minutos no redondos. */
const bogota = (y: number, m: number, d: number, h: number, min = 37) =>
  new Date(Date.UTC(y, m - 1, d, h + 5, min));

const TODOS: LimitesCitas = { diaActivo: true, maxDia: 1, mesActivo: true, maxMes: 3 };

describe('normalizarLimiteDia / normalizarLimiteMes', () => {
  it('sin valor o con basura cae al default (1 al día, 3 al mes)', () => {
    for (const v of [null, undefined, NaN, 0, -2, 'x']) {
      expect(normalizarLimiteDia(v)).toBe(LIMITE_CITAS.DEFAULT_DIA);
      expect(normalizarLimiteMes(v)).toBe(LIMITE_CITAS.DEFAULT_MES);
    }
  });

  it('redondea y acota al rango permitido', () => {
    expect(normalizarLimiteDia(2.6)).toBe(3);
    expect(normalizarLimiteDia(99)).toBe(LIMITE_CITAS.MAX_DIA);
    expect(normalizarLimiteMes('5')).toBe(5);
    expect(normalizarLimiteMes(400)).toBe(LIMITE_CITAS.MAX_MES);
  });
});

describe('limitesDeLaClinica', () => {
  it('una clínica sin fila de ajustes tiene los dos límites encendidos con 1 y 3', () => {
    expect(limitesDeLaClinica(null)).toEqual(TODOS);
  });

  it('respeta lo apagado y lo configurado', () => {
    expect(
      limitesDeLaClinica({
        dailyAppointmentLimitEnabled: false,
        maxAppointmentsPerDay: 2,
        monthlyAppointmentLimitEnabled: true,
        maxAppointmentsPerMonth: 6,
      }),
    ).toEqual({ diaActivo: false, maxDia: 2, mesActivo: true, maxMes: 6 });
  });
});

describe('periodoDelLimite', () => {
  // 🐛 La razón de existir de la zona: 8:37 p. m. del 20 en Bogotá es la
  // 1:37 a. m. del 21 en UTC. Contado en UTC caería en el día siguiente.
  it('el día es el de Bogotá, no el de UTC', () => {
    const p = periodoDelLimite('DAILY', bogota(2026, 10, 20, 20));
    expect(p.clave).toBe('2026-10-20');
    expect(p.desde.toISOString()).toBe('2026-10-20T05:00:00.000Z');
    expect(p.hasta.toISOString()).toBe('2026-10-21T05:00:00.000Z');
  });

  it('el mes también: la noche del 31 de octubre en Bogotá sigue siendo octubre', () => {
    const p = periodoDelLimite('MONTHLY', bogota(2026, 10, 31, 21));
    expect(p.clave).toBe('2026-10');
    expect(p.desde.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(p.hasta.toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });

  it('diciembre termina en enero del año siguiente', () => {
    const p = periodoDelLimite('MONTHLY', bogota(2026, 12, 15, 9));
    expect(p.clave).toBe('2026-12');
    expect(p.hasta.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });

  it('el último día del mes termina el primero del siguiente', () => {
    const p = periodoDelLimite('DAILY', bogota(2027, 2, 28, 10));
    expect(p.clave).toBe('2027-02-28');
    expect(p.hasta.toISOString()).toBe('2027-03-01T05:00:00.000Z');
  });

  it('acepta otra zona (multi-tenant)', () => {
    // 23:37 del 20 en Ciudad de México (UTC-6) = 05:37 UTC del 21.
    const instante = new Date(Date.UTC(2026, 9, 21, 5, 37));
    expect(periodoDelLimite('DAILY', instante, 'America/Mexico_City').clave).toBe('2026-10-20');
    expect(periodoDelLimite('DAILY', instante).clave).toBe('2026-10-21');
  });
});

describe('etiquetaPeriodo', () => {
  it('día con el año y mes en palabras', () => {
    expect(etiquetaPeriodo('DAILY', '2026-10-20')).toBe('martes, 20 de octubre de 2026');
    expect(etiquetaPeriodo('MONTHLY', '2026-10')).toBe('octubre de 2026');
  });

  it('una clave rara se muestra tal cual en vez de inventar una fecha', () => {
    expect(etiquetaPeriodo('DAILY', 'x')).toBe('x');
    expect(etiquetaPeriodo('MONTHLY', '2026-10-20')).toBe('2026-10-20');
  });
});

describe('evaluarLimiteCitas', () => {
  const fecha = bogota(2026, 10, 20, 9);
  const dia = periodoDelLimite('DAILY', fecha);
  const mes = periodoDelLimite('MONTHLY', fecha);
  const evaluar = (
    citasDia: number,
    citasMes: number,
    limites: LimitesCitas = TODOS,
    adicionales = { dia: 0, mes: 0 },
  ) =>
    evaluarLimiteCitas({
      limites,
      dia: { periodo: dia, citas: citasDia, adicionales: adicionales.dia },
      mes: { periodo: mes, citas: citasMes, adicionales: adicionales.mes },
    });

  it('sin citas ese día ni ese mes, se puede', () => {
    expect(evaluar(0, 0)).toBeNull();
  });

  it('con una cita ese día y el límite en 1, no se puede (límite diario)', () => {
    expect(evaluar(1, 1)).toMatchObject({ tipo: 'DAILY', limite: 1, limiteBase: 1, citas: 1 });
  });

  it('con 3 citas en el mes y ninguna ese día, no se puede (límite mensual)', () => {
    expect(evaluar(0, 3)).toMatchObject({ tipo: 'MONTHLY', limite: 3, citas: 3 });
  });

  it('con 2 citas en el mes, la tercera sí', () => {
    expect(evaluar(0, 2)).toBeNull();
  });

  it('si pasa de los dos, avisa el diario (es el más concreto)', () => {
    expect(evaluar(1, 3)?.tipo).toBe('DAILY');
  });

  it('un límite apagado no frena', () => {
    expect(evaluar(5, 2, { ...TODOS, diaActivo: false })).toBeNull();
    expect(evaluar(0, 9, { ...TODOS, mesActivo: false })).toBeNull();
  });

  it('las citas adicionales aprobadas suben el tope solo de su periodo', () => {
    expect(evaluar(1, 1, TODOS, { dia: 1, mes: 0 })).toBeNull();
    expect(evaluar(2, 2, TODOS, { dia: 1, mes: 0 })).toMatchObject({ tipo: 'DAILY', limite: 2, limiteBase: 1 });
    expect(evaluar(0, 3, TODOS, { dia: 1, mes: 0 })?.tipo).toBe('MONTHLY');
    expect(evaluar(0, 3, TODOS, { dia: 0, mes: 2 })).toBeNull();
  });

  it('un paciente que ya pasaba del límite (citas del hospital) sigue frenado', () => {
    expect(evaluar(0, 5)).toMatchObject({ tipo: 'MONTHLY', citas: 5 });
  });
});
