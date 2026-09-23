import { textoParaCoincidencia } from './texto-para-coincidencia.util';

/** Los diccionarios reales del bot, compilados igual que en el servicio. */
const SALUDO = /^(hola)$/i;
const PARTICULAR = /^(particular)$/i;
const CANCELAR = /^(cancelar cita)/i;
const DESPEDIDA = /^(chao|adios|adiós|salir)$/i;

const coincide = (re: RegExp, entrada: string) =>
  re.test(textoParaCoincidencia(entrada));

describe('textoParaCoincidencia', () => {
  // 🚨 EL CASO QUE LO ORIGINÓ. El bot escribe, literal:
  //   «también puede escribirme *"Hola"* y agendar como *Particular*»
  // Las comillas son texto suyo; los asteriscos, el marcado de WhatsApp que
  // viaja al copiar. Estas tres frases son SALIDAS DE EMERGENCIA: si el
  // paciente copia la que le acaban de dar y no coincide, se queda sin salida.
  describe('el paciente copia la frase que el bot le acaba de escribir', () => {
    it.each([
      '*"Hola"*',
      '"Hola"',
      '*Hola*',
      '_Hola_',
      '“Hola”', // comillas tipográficas: las pone el teclado del móvil
      'Hola.',
      '¡Hola!',
      '  hola  ',
    ])('%s sigue siendo un saludo', (entrada) => {
      expect(coincide(SALUDO, entrada)).toBe(true);
    });

    it.each(['*Particular*', '"Particular"', 'Particular.', '*particular*'])(
      '%s sigue siendo «particular»',
      (entrada) => {
        expect(coincide(PARTICULAR, entrada)).toBe(true);
      },
    );

    // Esta viaja en CADA recordatorio: «responda *cancelar cita*».
    it.each(['*cancelar cita*', '"cancelar cita"', 'Cancelar cita.'])(
      '%s sigue cancelando',
      (entrada) => {
        expect(coincide(CANCELAR, entrada)).toBe(true);
      },
    );
  });

  // Una nota de voz transcrita casi siempre llega puntuada. Sin normalizar,
  // un paciente que DICE «hola» producía `Hola.` y no coincidía con nada.
  describe('transcripciones de audio', () => {
    it.each([
      ['Hola.', SALUDO],
      ['Chao.', DESPEDIDA],
      ['¿Particular?', PARTICULAR],
    ])('%s coincide igual que escrito', (entrada, re) => {
      expect(coincide(re, entrada)).toBe(true);
    });
  });

  describe('lo que NO debe cambiar', () => {
    it('no inventa coincidencias: sigue anclado', () => {
      expect(coincide(SALUDO, 'hola quiero una cita')).toBe(false);
      expect(coincide(PARTICULAR, 'no soy particular')).toBe(false);
      expect(coincide(DESPEDIDA, 'salir de dudas')).toBe(false);
    });

    it('respeta las tildes: los diccionarios distinguen «adios» de «adiós»', () => {
      expect(textoParaCoincidencia('Adiós')).toBe('adiós');
    });

    it('un guion se vuelve espacio, no se come la separación', () => {
      expect(textoParaCoincidencia('cancelar-cita')).toBe('cancelar cita');
    });

    it('vacío, nulo y solo signos dan cadena vacía', () => {
      expect(textoParaCoincidencia('')).toBe('');
      expect(textoParaCoincidencia(null)).toBe('');
      expect(textoParaCoincidencia(undefined)).toBe('');
      expect(textoParaCoincidencia('***')).toBe('');
      expect(textoParaCoincidencia('🙏')).toBe('');
    });

    it('conserva los dígitos: una cédula no se desarma', () => {
      expect(textoParaCoincidencia('9990000013')).toBe('9990000013');
    });
  });
});
