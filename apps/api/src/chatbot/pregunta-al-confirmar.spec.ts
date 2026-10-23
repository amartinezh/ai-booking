import { esPreguntaEnVezDeRespuesta } from './pregunta-al-confirmar';

describe('esPreguntaEnVezDeRespuesta — una pregunta no es un «sí»', () => {
  it.each([
    // 2026-10-23, tal cual: agendó medicina general a quien venía por ecografías.
    'Esto si es para las ecografías ?',
    '¿Es para las ecografías?',
    'Si es para la ecografía?',
    '¿Es con la doctora Ana?',
    '¿A qué hora debo llegar?',
    'y eso es para mañana?',
    // Sin signos: lo que no tiene otra lectura.
    'Me indicas por favor si si es para las ecografías',
    'me confirma si es con el mismo médico',
    'quisiera saber si es presencial',
    'esto si es para la ecografia',
    'Una pregunta, es en el primer piso',
  ])('«%s» pregunta', (texto) => {
    expect(esPreguntaEnVezDeRespuesta(texto)).toBe(true);
  });

  it.each([
    'Sí',
    'si',
    'SI',
    'Sí, confirmo',
    'Si señor',
    'Claro que sí',
    'Cómo no',
    'Que sí',
    'listo',
    'Sí, por favor',
    // Responde primero y pregunta después.
    'Sí, ¿a qué hora debo llegar?',
    'Sí ¿a qué hora?',
    'Claro. ¿Qué debo llevar?',
    'Ok, ¿llevo la orden?',
    // Pide justo lo que se le pregunta.
    '¿Me la puede agendar por favor?',
    '¿me la cancela?',
    '¿Puede cancelarla?',
    '¿Me la puedes pasar para ese día?',
    'No',
    '',
  ])('«%s» no se toma como pregunta', (texto) => {
    expect(esPreguntaEnVezDeRespuesta(texto)).toBe(false);
  });

  it('«No, ¿hay otro día?» sí pregunta, pero el paso lo toma como NO: solo el SÍ se frena', () => {
    expect(esPreguntaEnVezDeRespuesta('No, ¿hay otro día?')).toBe(true);
  });

  it('null y undefined no son preguntas', () => {
    expect(esPreguntaEnVezDeRespuesta(null)).toBe(false);
    expect(esPreguntaEnVezDeRespuesta(undefined)).toBe(false);
  });
});
