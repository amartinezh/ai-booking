import {
  esCancelarASecas,
  nombraCambioDeCita,
  pideCancelarUnaCita,
  pideCitaNueva,
} from './cita-nueva-o-cambio';

describe('pideCitaNueva — una cita más, no cambiar la que tiene', () => {
  it.each([
    'Nesesito otra cita para lectura de examenes', // caso real, 2026-10-28
    'Necesito otra cita por la Nueva EPS',
    'quiero otra cita para mi hijo',
    'una cita nueva por favor',
    'Y necesito otra consulta',
  ])('«%s» → cita nueva', (frase) => {
    expect(pideCitaNueva(frase)).toBe(true);
  });

  it.each([
    'Necesito otra cita porque no puedo ir',
    'quiero cambiar mi cita por otra cita',
    'necesito otra cita en vez de la del jueves',
    'otra cita, la que tengo no me sirve',
    'reprogramar, necesito otra cita',
    'cambiar cita',
    'necesito una cita', // sin «otra»: lo decide el resto del asistente
    '',
    null,
  ])('«%s» → no', (frase) => {
    expect(pideCitaNueva(frase)).toBe(false);
  });
});

describe('esCancelarASecas', () => {
  it.each(['Cancelar', 'cancelar.', ' CANCELAR ', 'Cancelo', 'cancelar todo'])(
    '«%s» → sí',
    (frase) => {
      expect(esCancelarASecas(frase)).toBe(true);
    },
  );

  it.each([
    'Cancelar mi cita',
    'cancelar la cita del jueves',
    'quiero cancelar',
    'Hola',
    null,
  ])('«%s» → no: nombra la cita o es otra cosa', (frase) => {
    expect(esCancelarASecas(frase)).toBe(false);
  });
});

// 2026-11-12: «la otra a las 6 nos queda muy difícil» mientras elegía horario abrió
// «cambiar fecha» a quien no tenía cita.
describe('nombraCambioDeCita', () => {
  it.each([
    'Necesito cambiar la cita de mi mamá',
    'Es posible cambiarme la hora de la cita',
    '¿Me la pueden mover para el viernes?',
    'quiero reprogramar',
    'Hay que aplazarla',
    'Necesito otra fecha',
    'Trasladar la cita',
    'Modificar mi cita',
  ])('«%s» nombra el cambio', (texto) => {
    expect(nombraCambioDeCita(texto)).toBe(true);
  });

  it.each([
    'Ay, qué pena, pero es que somos de una vereda y nos queda muy difícil la otra a las 6',
    'Preferiblemente que sea en las horas de la tarde la cita',
    'Debe de ser el turno después de las 11:30',
    'No me sirve a las 6',
    'No puedo en la mañana',
    '',
  ])('«%s» no lo nombra', (texto) => {
    expect(nombraCambioDeCita(texto)).toBe(false);
  });
});

describe('pideCancelarUnaCita — anular una cita, dicho como lo dice la gente', () => {
  // Casos reales del 28-oct al 14-nov de 2026 en el menú de servicios.
  it.each([
    'Buenos días para cancelar está cita',
    'Para cancelar está cita de mañana 29 ya me dieron una para hoy muchas gracias',
    'Me podrían ayudar a cancelar cita de control trimestral',
    'Por favor necesito cancelar esta consulta',
    'Cancelar una cita',
    'Para cancelar',
    'Para cancelar cita',
    'Cancelación de cita',
    'Para cancelar una cita por favor',
    'Es para cancelar una cita',
    'Es pa cancelar',
    // Variantes
    'Anular la cita del jueves',
    'quisiera cancelar',
    'Canselar una cita',
    'cancelación',
  ])('«%s» → sí', (frase) => {
    expect(pideCancelarUnaCita(frase)).toBe(true);
  });

  it.each([
    'cancelar', // a secas: abandonar lo que está haciendo
    'Cancelar todo',
    'cancelo',
    'no quiero cancelar, quiero agendar',
    'No es para cancelar la cita',
    'me cancelaron la cita y necesito otra',
    'mi cita fue cancelada',
    'cancelar los recordatorios',
    'quiero agendar una cita',
    'Consulta ambulatoria de medicina general',
    'Control prenatal',
    'Hola buenos días',
    '',
    null,
  ])('«%s» → no', (frase) => {
    expect(pideCancelarUnaCita(frase)).toBe(false);
  });
});
