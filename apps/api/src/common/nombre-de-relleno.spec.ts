import { NOMBRE_DE_RELLENO, esNombreDeRelleno } from './nombre-de-relleno';

describe('nombre de relleno de una ficha de paciente', () => {
  it.each([
    NOMBRE_DE_RELLENO,
    'Paciente',
    'PACIENTE REGISTRADO',
    '  paciente   registrado ',
    'Paciente Registrado.',
    '',
    '   ',
    null,
    undefined,
  ])('«%s» es de relleno: la ficha no tiene nombre', (nombre) => {
    expect(esNombreDeRelleno(nombre)).toBe(true);
  });

  it.each([
    'María Fernanda López',
    'Paciente López', // un apellido real que empieza igual no es relleno
    'Registrado',
    'Pacientes',
    'José',
  ])('«%s» es un nombre de verdad', (nombre) => {
    expect(esNombreDeRelleno(nombre)).toBe(false);
  });
});
