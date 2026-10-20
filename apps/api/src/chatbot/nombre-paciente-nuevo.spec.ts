import { separarNombresYApellidos } from './nombre-paciente-nuevo';

describe('separarNombresYApellidos — el paciente nuevo repite su nombre', () => {
  it('🧾 el caso real (2026-10-22): nombre completo en «nombres» y luego los apellidos', () => {
    expect(
      separarNombresYApellidos('Juan camilo hurtado ramos', 'Hurtado ramos'),
    ).toEqual({
      nombres: 'Juan camilo',
      apellidos: 'Hurtado ramos',
      repetido: false,
    });
  });

  it('solo el primer apellido en el segundo paso: el segundo también sale de los nombres', () => {
    expect(
      separarNombresYApellidos('Juan Camilo Hurtado Ramos', 'Hurtado'),
    ).toEqual({
      nombres: 'Juan Camilo',
      apellidos: 'Hurtado Ramos',
      repetido: false,
    });
  });

  it('sin importar mayúsculas ni tildes', () => {
    expect(
      separarNombresYApellidos(
        'María Fernanda Gómez Restrepo',
        'gomez restrepo',
      ),
    ).toMatchObject({ nombres: 'María Fernanda', apellidos: 'gomez restrepo' });
  });

  it('un nombre y dos apellidos en «nombres»', () => {
    expect(
      separarNombresYApellidos('Pedro Gómez Ruiz', 'Gómez Ruiz'),
    ).toMatchObject({ nombres: 'Pedro', apellidos: 'Gómez Ruiz' });
  });

  it('los apellidos repiten los nombres al principio', () => {
    expect(
      separarNombresYApellidos('Juan Camilo', 'Juan Camilo Hurtado Ramos'),
    ).toEqual({
      nombres: 'Juan Camilo',
      apellidos: 'Hurtado Ramos',
      repetido: false,
    });
  });

  it('lo mismo en los dos pasos → repetido (se vuelven a pedir los apellidos)', () => {
    expect(
      separarNombresYApellidos('Juan Camilo Hurtado', 'juan camilo hurtado'),
    ).toMatchObject({ repetido: true });
  });

  it.each([
    ['Juan Camilo', 'Hurtado Ramos'], // lo normal
    ['María José', 'José'], // una sola palabra repetida: puede ser así
    ['Juan Hurtado', 'Hurtado'], // ídem
    ['Martín', 'Martín Pérez'], // Martín también es apellido
    ['Ana', 'Pérez Pérez'], // los dos apellidos iguales
  ])('«%s» + «%s» se deja como lo escribió', (nombres, apellidos) => {
    expect(separarNombresYApellidos(nombres, apellidos)).toEqual({
      nombres,
      apellidos,
      repetido: false,
    });
  });

  it('espacios de más no estorban', () => {
    expect(
      separarNombresYApellidos(
        '  Juan   Camilo  Hurtado Ramos ',
        ' Hurtado  Ramos ',
      ),
    ).toMatchObject({ nombres: 'Juan Camilo', apellidos: 'Hurtado Ramos' });
  });
});
