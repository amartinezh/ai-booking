import {
  describirCompilacion,
  detalleVersionAgente,
  leerVersionAgente,
  normalizarVersionAgente,
} from './version-agente';

/**
 * 🏷️ La versión del agente (2026-10-29): llega por la red en cada latido, se guarda
 * en la bitácora del espejo cuando cambia y el Espejo la muestra.
 */
const HUELLA =
  'b1142c02c31947ff735063b1c1048a60427945eb666d147dc326e7611336596d';

describe('normalizarVersionAgente', () => {
  it('guarda la huella corta (12), el commit, si había cambios y la fecha en ISO', () => {
    expect(
      normalizarVersionAgente({
        sha256: HUELLA,
        commit: 'EED01B9',
        dirty: true,
        builtAtIso: '2026-10-29T16:05:00Z',
      }),
    ).toEqual({
      sha256: 'b1142c02c319',
      commit: 'eed01b9',
      dirty: true,
      builtAtIso: '2026-10-29T16:05:00.000Z',
    });
  });

  it('sin huella válida no hay versión', () => {
    expect(normalizarVersionAgente(undefined)).toBeNull();
    expect(normalizarVersionAgente('b1142c02c319')).toBeNull();
    expect(normalizarVersionAgente([])).toBeNull();
    expect(normalizarVersionAgente({ sha256: 'corta' })).toBeNull();
    expect(normalizarVersionAgente({ sha256: 'zz42c02c3194' })).toBeNull();
  });

  it('un commit o una fecha raros se descartan, la huella se conserva', () => {
    expect(
      normalizarVersionAgente({
        sha256: HUELLA,
        commit: '<script>',
        dirty: 'sí',
        builtAtIso: 'ayer',
      }),
    ).toEqual({
      sha256: 'b1142c02c319',
      commit: null,
      dirty: false,
      builtAtIso: null,
    });
  });
});

describe('detalleVersionAgente / leerVersionAgente', () => {
  it('ida y vuelta: lo que se guarda se lee igual, con la anterior', () => {
    const v = normalizarVersionAgente({
      sha256: HUELLA,
      commit: 'eed01b9',
      builtAtIso: '2026-10-29T16:05:00.000Z',
    })!;
    expect(leerVersionAgente(detalleVersionAgente(v, 'a1b2c3d4e5f6'))).toEqual({
      ...v,
      anterior: 'a1b2c3d4e5f6',
    });
    expect(leerVersionAgente(detalleVersionAgente(v, null))?.anterior).toBeNull();
  });

  it('un renglón vacío, dañado o de otra cosa no se lee como versión', () => {
    expect(leerVersionAgente(null)).toBeNull();
    expect(leerVersionAgente('')).toBeNull();
    expect(leerVersionAgente('cupo=RU70|2026-10-30T11:30:00Z')).toBeNull();
    expect(leerVersionAgente('{"window":{}}')).toBeNull();
  });
});

describe('describirCompilacion', () => {
  it('dice el commit y si había cambios sin commit', () => {
    expect(describirCompilacion({ commit: 'eed01b9', dirty: false })).toBe(
      'eed01b9',
    );
    expect(describirCompilacion({ commit: 'eed01b9', dirty: true })).toBe(
      'eed01b9 con cambios sin commit',
    );
    expect(describirCompilacion({ commit: null, dirty: true })).toBeNull();
  });
});
