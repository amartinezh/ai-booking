import {
  esRechazoPorAgendaDelHis,
  esRechazoPorFaltarDatosDelPaciente,
} from './rechazo-del-his';

describe('esRechazoPorAgendaDelHis', () => {
  it.each([
    'El médico RU70 no tiene turno el 2026-10-30: la agenda de AgenIA y la del HIS no coinciden.',
    'no se reagendó, la cita anterior sigue en pie: El médico RU70 no tiene turno el 2026-10-30: la agenda de AgenIA y la del HIS no coinciden.',
    // 2026-10-29: el turno sigue, pero esa hora ya no está en él.
    'El médico RU66 no atiende a las 12:10 el 2026-10-30: esa hora no está en su turno.',
    'no se reagendó, la cita anterior sigue en pie: El médico RU66 no atiende a las 12:10 el 2026-10-30: esa hora no está en su turno.',
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

describe('esRechazoPorFaltarDatosDelPaciente (2026-11-25)', () => {
  it.each([
    'El paciente 1077000999 no existe en el HIS y faltan datos para darlo de alta (nacimiento y/o sexo). PACIENTES los exige NOT NULL.',
    'no llegó al sistema del hospital tras 10 intentos (último error: El paciente 1077000888 no existe en el HIS y faltan datos para darlo de alta (nacimiento y/o sexo).)',
  ])('«%s» → sí', (motivo) => {
    expect(esRechazoPorFaltarDatosDelPaciente(motivo)).toBe(true);
  });

  it.each([
    'El médico RU71 no tiene turno el 2026-11-27: la agenda de AgenIA y la del HIS no coinciden.',
    'timeout conectando al HIS',
    'faltan datos para escribir la cita: médico',
    '',
    undefined,
    null,
  ])('%s → no', (motivo) => {
    expect(esRechazoPorFaltarDatosDelPaciente(motivo)).toBe(false);
  });

  it('no es un rechazo por la agenda (el chat lo atiende distinto)', () => {
    expect(
      esRechazoPorAgendaDelHis(
        'El paciente 1 no existe en el HIS y faltan datos para darlo de alta (nacimiento y/o sexo).',
      ),
    ).toBe(false);
  });
});
