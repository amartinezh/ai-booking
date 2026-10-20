import { DATO_OCULTO } from './alertas-tecnicas';
import { MOTIVOS_CIERRE } from './soporte-bot';
import {
  CONTADORES_SOPORTE,
  TEXTO_MOTIVO_CIERRE,
  VIGILANCIA_SOPORTE,
  claveCifrasDelDia,
  diasDelPeriodo,
  filtroDeConversaciones,
  inicioDelPeriodo,
  percentil,
  periodoDeCifras,
  porcentaje,
  preguntasSinCubrir,
  promedio,
  sumarContadores,
  ventanaDe,
} from './soporte-bot-cifras';

// Martes 20 de octubre de 2026, 00:30 en Colombia (05:30 UTC).
const AHORA = new Date('2026-10-20T05:30:00Z');

describe('el periodo de las cifras', () => {
  it('7 o 30 días; cualquier otra cosa, 7', () => {
    expect(periodoDeCifras('30')).toBe(30);
    expect(periodoDeCifras(30)).toBe(30);
    expect(periodoDeCifras('7')).toBe(7);
    expect(periodoDeCifras('90')).toBe(7);
    expect(periodoDeCifras(undefined)).toBe(7);
    expect(VIGILANCIA_SOPORTE.periodos).toEqual([7, 30]);
  });

  it('los días son los de Colombia, del más viejo a hoy (no los de UTC)', () => {
    expect(diasDelPeriodo(AHORA, 3)).toEqual([
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
    ]);
    // A las 23:00 del 19 en Colombia ya es 20 en UTC: hoy sigue siendo el 19.
    expect(diasDelPeriodo(new Date('2026-10-20T04:00:00Z'), 1)).toEqual([
      '2026-10-19',
    ]);
    expect(diasDelPeriodo(new Date('2026-03-02T15:00:00Z'), 3)).toEqual([
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  it('empieza a la medianoche de Colombia del primer día', () => {
    expect(inicioDelPeriodo(AHORA, 7).toISOString()).toBe(
      '2026-10-14T05:00:00.000Z',
    );
  });
});

describe('los contadores de Redis', () => {
  it('un hash por día', () => {
    expect(claveCifrasDelDia('2026-10-20')).toBe('soporte:cifras:2026-10-20');
    expect(CONTADORES_SOPORTE).toEqual([
      'codigos',
      'fallidos',
      'bloqueos',
      'sinCodigo',
    ]);
  });

  it('suma los días e ignora lo vacío o raro', () => {
    expect(
      sumarContadores([
        { codigos: '3', fallidos: '1' },
        null,
        {},
        { codigos: '2', sinCodigo: '5', otra: '9', bloqueos: 'x' },
        undefined,
      ]),
    ).toEqual({ codigos: 5, fallidos: 1, bloqueos: 0, sinCodigo: 5 });
  });

  it('la ventana de N minutos', () => {
    const a = new Date('2026-10-20T15:00:00Z');
    expect(ventanaDe(a, 10)).toBe(
      ventanaDe(new Date(a.getTime() + 9 * 60_000), 10),
    );
    expect(ventanaDe(a, 10)).toBe(
      ventanaDe(new Date(a.getTime() + 10 * 60_000), 10) - 1,
    );
  });
});

describe('cuentas', () => {
  it('percentil por rango más cercano', () => {
    expect(percentil([], 90)).toBeNull();
    expect(percentil([5], 90)).toBe(5);
    expect(percentil([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 90)).toBe(9);
    expect(percentil([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 50)).toBe(5);
    expect(percentil([3, NaN, 1], 0)).toBe(1);
  });

  it('promedio redondeado y porcentaje sin base', () => {
    expect(promedio([])).toBeNull();
    expect(promedio([1, 2])).toBe(2);
    expect(porcentaje(1, 3)).toBe(33);
    expect(porcentaje(0, 0)).toBeNull();
  });
});

describe('lo que el manual no cubrió', () => {
  it('la pregunta es lo que escribió antes de esa respuesta, sin comandos y con los datos ocultos', () => {
    const r = preguntasSinCubrir([
      { id: 's0', direction: 'SALIDA', text: 'Listo, Ana.', uncovered: false },
      { id: 'e1', direction: 'ENTRADA', text: 'hola', uncovered: false },
      {
        id: 'e2',
        direction: 'ENTRADA',
        text: '¿puedo exportar a Excel la agenda de la paciente 1053789456?',
        uncovered: false,
      },
      {
        id: 's1',
        direction: 'SALIDA',
        text: 'Eso no lo tengo…',
        uncovered: true,
      },
      { id: 'e3', direction: 'ENTRADA', text: '/nuevo', uncovered: false },
      { id: 's2', direction: 'SALIDA', text: 'Cuéntame…', uncovered: true },
      {
        id: 'e4',
        direction: 'ENTRADA',
        text: '¿y los informes?',
        uncovered: false,
      },
      { id: 's3', direction: 'SALIDA', text: 'Pulsa…', uncovered: false },
    ]);
    expect(r).toEqual([
      {
        respuestaId: 's1',
        pregunta: `hola · ¿puedo exportar a Excel la agenda de la paciente ${DATO_OCULTO}?`,
      },
    ]);
  });

  it('sin mensajes, nada', () => {
    expect(preguntasSinCubrir([])).toEqual([]);
  });
});

describe('las conversaciones', () => {
  it('el filtro: lo que no se conoce es «todas»', () => {
    expect(filtroDeConversaciones('CON_CASO')).toBe('CON_CASO');
    expect(filtroDeConversaciones('SIN_CUBRIR')).toBe('SIN_CUBRIR');
    expect(filtroDeConversaciones('NO_UTIL')).toBe('NO_UTIL');
    expect(filtroDeConversaciones('x')).toBe('TODAS');
  });

  it('cada motivo de cierre tiene su texto', () => {
    for (const m of MOTIVOS_CIERRE) expect(TEXTO_MOTIVO_CIERRE[m]).toBeTruthy();
  });
});
