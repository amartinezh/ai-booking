import { RETENCION_DATOS, diasDeRetencion } from './retencion';

// §12 #4 del plan del rastreo: plazos de retención de datos personales.
describe('RETENCION_DATOS — los plazos decididos', () => {
  it('conversaciones 180 días, bitácora de consultas un año, nunca menos de 30', () => {
    expect(RETENCION_DATOS).toEqual({
      conversacionesDias: 180,
      bitacoraRastreoDias: 365,
      minimoDias: 30,
    });
  });

  it('la bitácora de accesos vive más que lo consultado: sirve para responder «¿quién miró mis datos?»', () => {
    expect(RETENCION_DATOS.bitacoraRastreoDias).toBeGreaterThan(RETENCION_DATOS.conversacionesDias);
  });
});

describe('diasDeRetencion — el plazo del entorno, con red de seguridad', () => {
  it('sin valor en el entorno: el de por defecto, sin aviso', () => {
    expect(diasDeRetencion(undefined, 180)).toEqual({ dias: 180, aviso: null });
    expect(diasDeRetencion('  ', 180)).toEqual({ dias: 180, aviso: null });
  });

  it('un entero válido se respeta, también si alarga el plazo', () => {
    expect(diasDeRetencion('90', 180)).toEqual({ dias: 90, aviso: null });
    expect(diasDeRetencion('730', 365)).toEqual({ dias: 730, aviso: null });
  });

  it('🛡️ por debajo del mínimo NO se aplica: un «1» de más no puede borrar la conversación de ayer', () => {
    const r = diasDeRetencion('1', 180);
    expect(r.dias).toBe(180);
    expect(r.aviso).toMatch(/mínimo/);
    expect(diasDeRetencion('30', 180).dias).toBe(30);
    expect(diasDeRetencion('29', 180).dias).toBe(180);
  });

  it.each(['abc', '12.5', '-5', '1e9x'])('«%s» no es un plazo: se usa el de por defecto y se dice', (v) => {
    const r = diasDeRetencion(v, 365);
    expect(r.dias).toBe(365);
    expect(r.aviso).not.toBeNull();
  });
});
