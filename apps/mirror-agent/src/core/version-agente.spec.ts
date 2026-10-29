import { createHash } from 'crypto';
import { describirVersionDelAgente, versionDelAgente } from './version-agente';

/**
 * 🏷️ La versión del agente (2026-10-29): la huella es el sha256 del archivo que
 * corre, igual a la que imprime el compilador; el commit y la fecha los deja adentro
 * esbuild.
 */
const CONTENIDO = Buffer.from('console.log("agente");');
const HUELLA = createHash('sha256').update(CONTENIDO).digest('hex');
const COMPILACION = JSON.stringify({
  commit: 'eed01b9',
  dirty: true,
  builtAtIso: '2026-10-29T16:05:00.000Z',
});

describe('versionDelAgente', () => {
  it('la huella es el sha256 del archivo que corre (12 caracteres) y trae la compilación', () => {
    const leer = jest.fn().mockReturnValue(CONTENIDO);
    expect(
      versionDelAgente({
        archivo: 'C:/agenia/agent.bundle.js',
        compilacion: COMPILACION,
        leer,
      }),
    ).toEqual({
      sha256: HUELLA.slice(0, 12),
      commit: 'eed01b9',
      dirty: true,
      builtAtIso: '2026-10-29T16:05:00.000Z',
    });
    expect(leer).toHaveBeenCalledWith('C:/agenia/agent.bundle.js');
  });

  it('sin compilación embebida (pruebas, ts-node): solo la huella', () => {
    expect(
      versionDelAgente({
        archivo: 'x.js',
        compilacion: undefined,
        leer: () => CONTENIDO,
      }),
    ).toEqual({
      sha256: HUELLA.slice(0, 12),
      commit: null,
      dirty: false,
      builtAtIso: null,
    });
  });

  it('una compilación ilegible no impide reportar la huella', () => {
    expect(
      versionDelAgente({
        archivo: 'x.js',
        compilacion: '{roto',
        leer: () => CONTENIDO,
      })?.sha256,
    ).toBe(HUELLA.slice(0, 12));
  });

  it('si no puede leer su archivo, arranca igual sin versión', () => {
    expect(
      versionDelAgente({
        archivo: 'no-existe.js',
        leer: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toBeUndefined();
    expect(versionDelAgente({ archivo: undefined })).toBeUndefined();
  });

  it('por defecto lee el archivo con que se arrancó node (este, en las pruebas)', () => {
    const v = versionDelAgente();
    expect(v?.sha256).toMatch(/^[0-9a-f]{12}$/);
    // Sin esbuild no hay compilación embebida.
    expect(v?.commit).toBeNull();
  });
});

describe('describirVersionDelAgente', () => {
  it('lo que sale en el log de arranque', () => {
    expect(
      describirVersionDelAgente({
        sha256: 'b1142c02c319',
        commit: 'eed01b9',
        dirty: true,
        builtAtIso: '2026-10-29T16:05:00.000Z',
      }),
    ).toBe(
      'huella b1142c02c319 · eed01b9 con cambios · compilado 2026-10-29T16:05:00.000Z',
    );
    expect(describirVersionDelAgente({ sha256: 'b1142c02c319' })).toBe(
      'huella b1142c02c319',
    );
    expect(describirVersionDelAgente(undefined)).toMatch(/sin versión/);
  });
});
