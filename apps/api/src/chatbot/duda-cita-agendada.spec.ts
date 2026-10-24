import { dudaSobreLaCita } from './duda-cita-agendada';

const MEDICINA = 'Consulta ambulatoria de medicina general';

describe('dudaSobreLaCita — el paciente duda de la cita que le acaban de agendar', () => {
  it.each([
    // 2026-10-23, tal cual.
    ['Me indicas por favor si si es para las ecografías', 'ecografías'],
    ['Esto si es para las ecografías ?', 'ecografías'],
    ['la cita es para odontología?', 'odontología'],
    ['lo que necesito es una ecografía de mama', 'ecografías'],
  ])('«%s» → pregunta por %s', (texto, servicio) => {
    expect(dudaSobreLaCita(texto, MEDICINA)).toEqual({
      motivo: 'OTRO_SERVICIO',
      servicio,
    });
  });

  it.each([
    'no era para eso',
    'no era la cita que necesitaba',
    'Yo no pedí esa cita',
    'me equivoqué de cita',
    'no es la cita que necesito',
    'No la necesito, se equivocaron',
  ])('«%s» → no era la que necesitaba', (texto) => {
    expect(dudaSobreLaCita(texto, MEDICINA)).toEqual({ motivo: 'NO_LA_PIDIO' });
  });

  it.each([
    'Gracias',
    'Sí voy',
    '¿A qué hora abre el laboratorio?', // otro servicio, pero no de su cita
    'Ecografía', // no se refiere a la cita
    '¿A qué hora debo llegar?',
    'Hola',
    '',
  ])('«%s» → nada', (texto) => {
    expect(dudaSobreLaCita(texto, MEDICINA)).toBeNull();
  });

  it('si la cita ES de ese servicio, no hay duda', () => {
    expect(
      dudaSobreLaCita('¿Esto es para la ecografía?', 'Ecografía obstétrica'),
    ).toBeNull();
  });

  it('sin el servicio (antes de buscar la cita) dice si PODRÍA serlo', () => {
    expect(
      dudaSobreLaCita('Me indicas si es para las ecografías', null),
    ).not.toBeNull();
    expect(dudaSobreLaCita('Gracias', null)).toBeNull();
  });
});
