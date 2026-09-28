import {
  MENSAJES_QUE_NOMBRAN_EL_CANAL,
  MSGS,
  buildMessages,
  type CanalDelBot,
} from './chatbot.constants';

/**
 * Cada canal nombra el suyo (docs/PLAN_TELEGRAM.md): un paciente de Telegram
 * no puede leer «esté pendiente de su WhatsApp», y el de WhatsApp tiene que
 * leer exactamente lo mismo que antes de que existiera Telegram.
 *
 * Recorre TODOS los mensajes de los dos estilos y TODAS sus variantes: `pick`
 * elige al azar, así que se controla `Math.random` para pasar por cada índice.
 */
type Fn = (...args: unknown[]) => string;
const ESTILOS = ['FORMAL', 'INFORMAL'] as const;
const ARGS = ['Ana', 'Medicina General', 2, 'Sura', 'lunes 5'];
/** Suficiente para recorrer cualquier `pick` de hasta 12 opciones. */
const PASOS = 12;

/** Todas las variantes de un mensaje, en orden de índice. */
function variantes(fn: Fn): string[] {
  const out: string[] = [];
  const spy = jest.spyOn(Math, 'random');
  try {
    for (let k = 0; k < PASOS; k++) {
      spy.mockReturnValue(k / PASOS);
      out.push(fn(...ARGS));
    }
  } finally {
    spy.mockRestore();
  }
  return out;
}

const mensajes = (estilo: (typeof ESTILOS)[number], canal: CanalDelBot) =>
  Object.entries(buildMessages(estilo, canal) as Record<string, Fn>);

describe('mensajes del bot según el canal', () => {
  describe('WhatsApp: exactamente lo de siempre', () => {
    it('devuelve EL MISMO objeto que antes (sin canal = WhatsApp)', () => {
      for (const estilo of ESTILOS) {
        expect(buildMessages(estilo, 'WHATSAPP')).toBe(buildMessages(estilo));
      }
      expect(buildMessages('FORMAL', 'WHATSAPP')).toBe(MSGS);
    });

    it.each(ESTILOS)(
      '%s: los textos que nombran el canal siguen diciendo WhatsApp',
      (estilo) => {
        for (const clave of MENSAJES_QUE_NOMBRAN_EL_CANAL) {
          const fn = buildMessages(estilo, 'WHATSAPP')[clave] as Fn;
          expect(variantes(fn).some((t) => t.includes('WhatsApp'))).toBe(true);
        }
      },
    );
  });

  describe('Telegram', () => {
    it.each(ESTILOS)(
      '%s: NINGÚN mensaje, en ninguna variante, dice «WhatsApp»',
      (estilo) => {
        const conWhatsapp: string[] = [];
        for (const [clave, fn] of mensajes(estilo, 'TELEGRAM')) {
          if (variantes(fn).some((t) => /whatsapp/i.test(t))) {
            conWhatsapp.push(clave);
          }
        }
        // Si esto falla: un mensaje nuevo nombra el canal. Agréguelo a
        // MENSAJES_QUE_NOMBRAN_EL_CANAL (chatbot.constants.ts).
        expect(conWhatsapp).toEqual([]);
      },
    );

    it.each(ESTILOS)(
      '%s: cada variante es la de WhatsApp con el canal cambiado, y nada más',
      (estilo) => {
        const wa = new Map(mensajes(estilo, 'WHATSAPP'));
        for (const [clave, fn] of mensajes(estilo, 'TELEGRAM')) {
          const esperadas = variantes(wa.get(clave)!).map((t) =>
            t.replace(/\bWhatsApp\b/g, 'Telegram'),
          );
          expect(variantes(fn)).toEqual(esperadas);
        }
      },
    );

    it('los que nombran el canal dicen «Telegram»', () => {
      for (const estilo of ESTILOS) {
        for (const clave of MENSAJES_QUE_NOMBRAN_EL_CANAL) {
          const fn = buildMessages(estilo, 'TELEGRAM')[clave] as Fn;
          expect(variantes(fn).some((t) => t.includes('Telegram'))).toBe(true);
        }
      }
    });

    it('ejemplos que lee el paciente', () => {
      const spy = jest.spyOn(Math, 'random').mockReturnValue(0);
      try {
        expect(
          buildMessages('FORMAL', 'TELEGRAM').unidoAWaitlist(
            'Ana',
            'Medicina',
            2,
          ),
        ).toContain('Esté pendiente de su Telegram');
        expect(
          buildMessages('INFORMAL', 'TELEGRAM').unidoAWaitlist(
            'Ana',
            'Medicina',
            2,
          ),
        ).toContain('Pendiente de tu Telegram');
      } finally {
        spy.mockRestore();
      }
    });
  });
});
