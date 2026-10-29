import { esRechazoPorAgendaDelHis } from './rechazo-del-his';

describe('esRechazoPorAgendaDelHis', () => {
  it.each([
    'El médico RU70 no tiene turno el 2026-10-30: la agenda de AgenIA y la del HIS no coinciden.',
    'no se reagendó, la cita anterior sigue en pie: El médico RU70 no tiene turno el 2026-10-30: la agenda de AgenIA y la del HIS no coinciden.',
  ])('«%s» → sí', (motivo) => {
    expect(esRechazoPorAgendaDelHis(motivo)).toBe(true);
  });

  it.each([
    'timeout conectando al HIS',
    'se cruza con otra cita del HIS (07:50, 20 min)',
    '',
    undefined,
    null,
    42,
  ])('%s → no', (motivo) => {
    expect(esRechazoPorAgendaDelHis(motivo)).toBe(false);
  });
});
