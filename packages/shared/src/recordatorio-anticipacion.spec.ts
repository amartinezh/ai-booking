import {
  ANTICIPACION_RECORDATORIO,
  citaDemasiadoCercaParaRecordar,
  normalizarAnticipacionRecordatorio,
  textoAnticipacion,
} from './recordatorio-anticipacion';

describe('normalizarAnticipacionRecordatorio', () => {
  it('sin valor o inválido → 60 (el default)', () => {
    for (const v of [null, undefined, '', 'abc', NaN, -5]) {
      expect(normalizarAnticipacionRecordatorio(v)).toBe(60);
    }
  });

  it('0 es válido: sin mínimo, como antes', () => {
    expect(normalizarAnticipacionRecordatorio(0)).toBe(0);
    expect(normalizarAnticipacionRecordatorio('0')).toBe(0);
  });

  it('redondea y recorta al máximo', () => {
    expect(normalizarAnticipacionRecordatorio(44.6)).toBe(45);
    expect(normalizarAnticipacionRecordatorio(10_000)).toBe(
      ANTICIPACION_RECORDATORIO.MAX,
    );
  });

  it('las opciones del panel son todas válidas', () => {
    for (const o of ANTICIPACION_RECORDATORIO.OPCIONES) {
      expect(normalizarAnticipacionRecordatorio(o)).toBe(o);
    }
  });
});

describe('citaDemasiadoCercaParaRecordar', () => {
  const ahora = new Date('2026-10-17T13:41:00.000Z');
  const en = (min: number) => new Date(ahora.getTime() + min * 60_000);

  it('caso real: cita a 4 minutos con mínimo de 1 hora → no se recuerda', () => {
    expect(citaDemasiadoCercaParaRecordar(en(4), ahora, 60)).toBe(true);
  });

  it('justo en el mínimo o más lejos → sí se recuerda', () => {
    expect(citaDemasiadoCercaParaRecordar(en(60), ahora, 60)).toBe(false);
    expect(citaDemasiadoCercaParaRecordar(en(600), ahora, 60)).toBe(false);
  });

  it('con 0 (sin mínimo), nunca', () => {
    expect(citaDemasiadoCercaParaRecordar(en(1), ahora, 0)).toBe(false);
  });
});

describe('textoAnticipacion', () => {
  it('lo dice como lo leería el administrador', () => {
    expect(textoAnticipacion(0)).toBe('sin mínimo');
    expect(textoAnticipacion(30)).toBe('30 minutos');
    expect(textoAnticipacion(60)).toBe('1 hora');
    expect(textoAnticipacion(90)).toBe('1 h 30 min');
    expect(textoAnticipacion(180)).toBe('3 horas');
  });
});
