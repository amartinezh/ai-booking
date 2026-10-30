import {
  BOT_NAME,
  CONSENT_1581_FORMAL,
  CONSENT_1581_INFORMAL,
  MSGS,
  buildMessages,
  type CommStyle,
  type Messages,
} from './chatbot.constants';

/**
 * El pool de mensajes: 88 redacciones × 2 estilos, y CADA UNA sale por
 * WhatsApp a un paciente. Nada de esto tenía prueba, y el modo de fallo no es
 * teórico — es el clásico "Su cita con undefined el undefined": un argumento
 * que se dejó de pasar, o una variante nueva de una frase a la que se le
 * olvidó un placeholder. No revienta nada; solo llega mal escrito al paciente.
 *
 * En vez de escribir 176 aserciones a mano, se recorre el pool entero y se
 * exige el CONTRATO: mismos nombres en los dos estilos, texto no vacío, y
 * cero `undefined`/`null`/`[object Object]` filtrados al mensaje.
 */

/**
 * Argumento genérico: sirve como texto en una plantilla y también como el
 * objeto `p` que reciben los constructores de resumen.
 */
const arg = (i: number) =>
  // Objeto String: se comporta como texto (interpolación, `.toLowerCase()`) y
  // a la vez lleva los campos del objeto `p` que reciben los resúmenes.
  Object.assign(new String(`«v${i}»`), {
    nombre: 'ANA',
    cedula: '1234567',
    especialidad: 'Medicina General',
    eps: 'NUEVA EPS',
    fecha: 'lunes 10 de junio, 10:00 a. m.',
    botName: BOT_NAME,
    clinicaName: 'Clínica Demo',
    // 🏥 Los avisos de cita cancelada / cambiada por el hospital (2026-10-22).
    clinica: 'Clínica Demo',
    servicio: 'Medicina General',
    medico: 'Dr(a). Ruiz',
    contacto: 'el hospital al *606 000 0000*',
    puedeAgendar: true,
    fechaAntes: 'lunes 10 de junio, 10:00 a. m.',
    fechaNueva: 'martes 11 de junio, 9:00 a. m.',
    medicoNuevo: 'Dr(a). Gómez',
  });

/**
 * Nombres de los parámetros declarados. Los que empiezan por `_` están ahí a
 * propósito sin usarse (firma uniforme del pool) y no se exigen en la salida.
 */
const nombresDeParametros = (fn: (...a: unknown[]) => unknown): string[] => {
  const fuente = fn.toString();
  const abre = fuente.indexOf('(');
  const cierra = fuente.indexOf(')', abre);
  if (abre === -1 || cierra === -1) return [];
  return fuente
    .slice(abre + 1, cierra)
    .split(',')
    .map((p) => p.split(':')[0].split('=')[0].trim())
    .filter(Boolean);
};

const ESTILOS: CommStyle[] = ['FORMAL', 'INFORMAL'];
const claves = (m: Messages) => Object.keys(m).sort();

/** Llama a un constructor con tantos argumentos genéricos como declare. */
const invocar = (fn: (...a: unknown[]) => unknown) =>
  fn(...Array.from({ length: fn.length }, (_, i) => arg(i)));

describe('pool de mensajes del chatbot', () => {
  it('los dos estilos exponen EXACTAMENTE las mismas claves (drop-in)', () => {
    expect(claves(buildMessages('INFORMAL'))).toEqual(
      claves(buildMessages('FORMAL')),
    );
  });

  it('el pool no está vacío — si alguien lo borra, esta suite lo dice', () => {
    expect(claves(MSGS).length).toBeGreaterThan(50);
  });

  it('buildMessages elige el pool por estilo y MSGS es el formal', () => {
    expect(buildMessages('FORMAL')).toBe(MSGS);
    expect(buildMessages()).toBe(MSGS);
    expect(buildMessages('INFORMAL')).not.toBe(MSGS);
  });

  describe.each(ESTILOS)('estilo %s', (estilo) => {
    const pool = buildMessages(estilo) as unknown as Record<
      string,
      (...a: unknown[]) => unknown
    >;
    const nombres = Object.keys(pool);

    it('todas las entradas son funciones constructoras', () => {
      for (const n of nombres) expect(typeof pool[n]).toBe('function');
    });

    it.each(nombres)('%s — contrato de redacción', (nombre) => {
      const fn = pool[nombre];
      // El `pick` interno elige una variante al azar; se recorren varias
      // vueltas para que ninguna quede sin visitar por suerte del sorteo.
      const salidas = Array.from({ length: 25 }, () => String(invocar(fn)));

      for (const s of salidas) {
        // 1. Texto de verdad, no vacío.
        expect(s.trim().length).toBeGreaterThan(0);
        // 2. 🚨 Nada de fugas técnicas hacia el WhatsApp del paciente.
        expect(s).not.toMatch(/undefined/);
        expect(s).not.toMatch(/\bnull\b/);
        expect(s).not.toContain('[object Object]');
        expect(s).not.toContain('NaN');
      }

      // 3. Todo parámetro declarado se usa: si uno nunca aparece, o sobra en
      //    la firma o falta en la plantilla — que es el defecto que deja un
      //    "su cita de undefined" en el mensaje.
      if (fn.length === 0) return;
      const params = nombresDeParametros(fn);
      const todas = salidas.join('\n');
      // `p` (objeto de resumen) no se interpola literalmente: se leen sus
      // campos, así que basta con ver alguno de ellos en el texto.
      const usaCampos =
        todas.includes('ANA') ||
        todas.includes('1234567') ||
        todas.includes('Medicina General');

      for (let i = 0; i < fn.length; i++) {
        if (params[i]?.startsWith('_')) continue; // sin usar a propósito
        expect(todas.includes(`«v${i}»`) || usaCampos).toBe(true);
      }
    });
  });

  describe('variantes: el bot no repite siempre la misma frase', () => {
    const conRandom = <T>(valor: number, fn: () => T): T => {
      const spy = jest.spyOn(Math, 'random').mockReturnValue(valor);
      try {
        return fn();
      } finally {
        spy.mockRestore();
      }
    };

    it('la primera y la última variante son textos distintos', () => {
      const primera = conRandom(0, () =>
        MSGS.bienvenida('Clínica Demo', 'A) General'),
      );
      const ultima = conRandom(0.999, () =>
        MSGS.bienvenida('Clínica Demo', 'A) General'),
      );
      expect(primera).not.toBe(ultima);
    });

    it('random en el borde superior no se sale del arreglo', () => {
      const texto = conRandom(0.9999999, () =>
        MSGS.bienvenida('Clínica Demo', 'A) General'),
      );
      expect(texto).toEqual(expect.any(String));
      expect(texto).not.toContain('undefined');
    });

    it('todas las variantes nombran la clínica y el servicio que se le pasan', () => {
      for (const r of [0, 0.4, 0.8]) {
        const texto = conRandom(r, () =>
          MSGS.bienvenida('Hospital San Vicente', 'A) Medicina General'),
        );
        expect(texto).toContain('Hospital San Vicente');
        expect(texto).toContain('A) Medicina General');
      }
    });
  });

  describe('aviso de tratamiento de datos (Ley 1581)', () => {
    it.each([
      ['formal', CONSENT_1581_FORMAL],
      ['informal', CONSENT_1581_INFORMAL],
    ])('%s cita la ley y ancla el consentimiento en el SÍ', (_e, fn) => {
      const texto = fn();
      expect(texto).toContain('Ley 1581');
      expect(texto).toMatch(/\*SÍ\*/);
      expect(texto).toContain('datos');
    });

    it('con política publicada, enlaza; sin ella, el aviso legal se mantiene igual', () => {
      const conUrl = CONSENT_1581_FORMAL('https://clinica.co/privacidad');
      expect(conUrl).toContain('https://clinica.co/privacidad');

      const sinUrl = CONSENT_1581_FORMAL();
      expect(sinUrl).not.toContain('http');
      expect(sinUrl).toContain('Ley 1581');
    });

    it('el tratamiento del paciente cambia con el estilo (usted vs. tú)', () => {
      expect(CONSENT_1581_FORMAL()).toContain('confirma su asistencia');
      expect(CONSENT_1581_INFORMAL()).toContain('confirmas tu asistencia');
    });
  });

  describe('tono: los dos pools no son el mismo texto', () => {
    it('el estilo cambia de verdad la redacción de la bienvenida', () => {
      const spy = jest.spyOn(Math, 'random').mockReturnValue(0);
      const formal = buildMessages('FORMAL').bienvenida('C', 'S');
      const informal = buildMessages('INFORMAL').bienvenida('C', 'S');
      spy.mockRestore();

      expect(formal).not.toBe(informal);
    });
  });

  // 2026-10-30: lo nuevo de la lista de espera y del aviso del hospital.
  describe('lista de espera y aviso del hospital (2026-10-30)', () => {
    it.each(['FORMAL', 'INFORMAL'] as const)(
      '%s: sin otro horario, ofrece la lista; con el plazo, dice hasta cuándo y desde cuándo',
      (estilo) => {
        const M = buildMessages(estilo);
        const sinPlazo = M.sinOtrosCuposListaEspera();
        expect(sinPlazo).toContain('*lista de espera*');
        expect(sinPlazo).not.toContain('hasta el');
        const conPlazo = M.sinOtrosCuposListaEspera(
          'lunes 2 de noviembre',
          'martes 3 de noviembre',
        );
        expect(conPlazo).toContain('hasta el *lunes 2 de noviembre*');
        expect(conPlazo).toContain('desde el *martes 3 de noviembre*');
        expect(conPlazo).toContain('*lista de espera*');
      },
    );

    it.each(['FORMAL', 'INFORMAL'] as const)(
      '%s: el cupo de la lista que ya no está no pide «otra letra» y dice que conserva el puesto',
      (estilo) => {
        const t = buildMessages(estilo).cupoDeListaNoDisponible();
        expect(t).toContain('*lista de espera*');
        expect(t).toContain('mismo puesto');
        expect(t).not.toMatch(/letra|otro de la lista/i);
      },
    );

    it.each(['FORMAL', 'INFORMAL'] as const)(
      '%s: la corrección dice que la cita sigue en pie, con su fecha y médico',
      (estilo) => {
        const t = buildMessages(estilo).citaSigueEnPie({
          nombre: 'Luis',
          clinica: 'Hospital',
          servicio: 'Consulta ambulatoria de medicina general',
          fecha: 'jueves, 29 de octubre a las 4:30 p m',
          medico: 'Dr(a). Adrián',
          contacto: 'el hospital al *606 853 8860*',
        });
        expect(t).toMatch(/sigue en pie/);
        expect(t).toContain('jueves, 29 de octubre a las 4:30 p m');
        expect(t).toContain('Dr(a). Adrián');
        expect(t).toContain('Luis');
      },
    );
  });
});
