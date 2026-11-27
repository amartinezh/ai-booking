import { pideSalirDeLaLista } from './salir-de-la-lista';

/**
 * Los textos reales de producción (26-nov-2026) con los que la gente pidió salir de
 * la lista de espera y el asistente no la sacó, y los que NO deben sacarla.
 */
describe('pideSalirDeLaLista', () => {
  it.each([
    'Quiero salir de la lista de espera',
    'Salir de lista de espera',
    'Salir de la lista,ya no se necesita la cita medica muchas gracias',
    'Ya no quiero estar en lista de espera',
    'Ya no quiero permanecer en lista',
    'No quiero recibir más ofertas',
    'no quiero recibir mas mensajes',
    'Sáquenme de la lista por favor',
    'quítenme de la lista de espera',
    'No, sáquenme de la lista',
    'No. Quiero salir de la lista',
    'por favor no me envíen más ofertas',
    'dejen de mandar cupos',
    'no más ofertas gracias',
  ])('«%s» pide salir de la lista', (texto) => {
    expect(pideSalirDeLaLista(texto)).toBe('LISTA');
  });

  it.each([
    'Ya no lo necesito muchas gracias',
    'ya no lo necesito  gracias',
    'ya no necesito la. cita',
    'ya no quiero seguir gracias',
    'no ya asistí a consulta muchas gracias',
    'No , tuve traslado a pereira',
    'Ya no necesito esa cita muchas gracias',
    'Ya conseguí una cita  Muchas gracias no necesito nada',
    'Ya no necesito citas',
    'Muy buenos días, para informarle q ya me dieron la cita muchas gracias por su atención prestada',
    'Gracias que ya tengo la cita. Muy amable.',
    'ella ya no se encuentra en el municipio, ella se fue para Pereira el viernes',
    'ya me atendieron gracias',
  ])('«%s» dice que ya no la necesita', (texto) => {
    expect(pideSalirDeLaLista(texto)).toBe('NO_LA_NECESITA');
  });

  it.each([
    'No',
    'NO',
    'no que sea en la tarde',
    'No tienes uno para el jueves',
    'no tiene una para mañana es urgente',
    'Salir',
    'salir',
    'Cancelar',
    'lista de espera',
    'Sí, anóteme en la lista',
    'no me saquen de la lista',
    'No quiero salir de la lista, sigo esperando',
    'sigo pendiente si me hace el favor',
    'buen día no quiero la cita con el doctor germán garcía.',
    'No es para sacar una cita',
    'Me podrías sacar otra cita',
    'Estaba en la lista de turno de asignación de cita para medicina general',
    'ya no necesito esa hora, ¿tiene otra?',
    'Señorita ya me dieron la cita para hoy las 4:50',
    '',
    null,
    undefined,
  ])('«%s» no es salir de la lista', (texto) => {
    expect(pideSalirDeLaLista(texto)).toBeNull();
  });
});
