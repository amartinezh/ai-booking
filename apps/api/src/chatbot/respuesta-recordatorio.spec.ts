import { clasificarRespuestaAlBot } from './respuesta-recordatorio';

/**
 * Las frases son las que escribieron los pacientes la noche del primer lote de
 * recordatorios (2026-10-13), tal cual, con su ortografía.
 */
describe('clasificarRespuestaAlBot', () => {
  it.each([
    'Si dios quiere mañana boy ala cita',
    'Si yo voy a asistir mañana',
    'Ok muchas gracias',
    'Muchas gracias',
    'Hola, muchas gracias',
    'Bueno',
    'Sí',
    'Listo, allá estaré',
    'Confirmo',
    'Está bien gracias',
  ])('«%s» → CONFIRMA', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('CONFIRMA');
  });

  it.each([
    'De donde me ablan',
    '¿De dónde me hablan?',
    'Quién es?',
    'quien me escribe',
    '¿De dónde me escriben?',
  ])('«%s» → QUIEN_ESCRIBE', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('QUIEN_ESCRIBE');
  });

  it.each([
    'Esque no voy a poder ir ala cita mañana',
    'Como hago para canselarla',
    'Necesito cancelar esa cita',
    'Y yo no puedo ir mañana',
    'No es que mañana tengo una cita de control',
    'Gracias, pero no puedo asistir',
    'Sí, pero quiero cambiar la hora',
    'Ok, ¿la puedo mover para otro día?',
  ])('🛡️ «%s» NUNCA es una confirmación', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBeNull();
  });

  it.each([
    'Hola',
    'Buenas noches',
    'Sí voy, ¿tengo que llevar la orden?',
    'consultar',
    '',
    null,
  ])('«%s» no se clasifica: sigue el camino de siempre', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBeNull();
  });

  it('un párrafo largo no se toma por confirmación aunque diga «gracias»', () => {
    expect(
      clasificarRespuestaAlBot(
        'Buenas noches muchas gracias quería saber si la doctora atiende también por la tarde porque trabajo hasta las cinco',
      ),
    ).toBeNull();
  });
});
