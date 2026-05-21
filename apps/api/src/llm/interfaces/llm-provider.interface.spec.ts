import { normalizeIntent } from './llm-provider.interface';

describe('normalizeIntent', () => {
  it('acepta los valores válidos tal cual', () => {
    expect(normalizeIntent('agendar_cita')).toBe('agendar_cita');
    expect(normalizeIntent('consulta_faq')).toBe('consulta_faq');
    expect(normalizeIntent('insulto_abuso')).toBe('insulto_abuso');
  });

  it('normaliza mayúsculas y espacios', () => {
    expect(normalizeIntent('  AGENDAR_CITA ')).toBe('agendar_cita');
    expect(normalizeIntent('Consulta_FAQ')).toBe('consulta_faq');
  });

  it('cae a "otro" (fail-open) ante valores desconocidos o vacíos', () => {
    expect(normalizeIntent('otro')).toBe('otro');
    expect(normalizeIntent('saludo')).toBe('otro');
    expect(normalizeIntent('')).toBe('otro');
    expect(normalizeIntent(null)).toBe('otro');
    expect(normalizeIntent(undefined)).toBe('otro');
    expect(normalizeIntent(42)).toBe('otro');
    expect(normalizeIntent({})).toBe('otro');
  });
});
