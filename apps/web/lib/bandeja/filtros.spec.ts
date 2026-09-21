import { RUTA_BANDEJA, hrefBandeja, leerFiltros } from './filtros';

describe('leerFiltros — lo que llega en la URL lo escribe cualquiera', () => {
  it('sin nada: activas, página 1, sin filtros', () => {
    expect(leerFiltros({})).toEqual({ estado: 'ACTIVAS', tipo: undefined, gravedad: undefined, pagina: 1 });
  });

  it('lee estado, tipo, gravedad y página válidos', () => {
    expect(leerFiltros({ estado: 'MIAS', tipo: 'ERROR_SYNC', gravedad: 'CRITICA', pagina: '3' })).toEqual({
      estado: 'MIAS',
      tipo: 'ERROR_SYNC',
      gravedad: 'CRITICA',
      pagina: 3,
    });
    for (const estado of ['ACTIVAS', 'SIN_DUENO', 'MIAS', 'CERRADAS']) {
      expect(leerFiltros({ estado }).estado).toBe(estado);
    }
  });

  it('un valor repetido en la URL (?estado=a&estado=b) cuenta el primero', () => {
    expect(leerFiltros({ estado: ['CERRADAS', 'MIAS'], pagina: ['2', '9'] })).toMatchObject({ estado: 'CERRADAS', pagina: 2 });
  });

  it('🧹 valores inventados o rotos se ignoran (no llegan al servicio)', () => {
    expect(leerFiltros({ estado: 'TODO', tipo: 'X', gravedad: 'GRAVISIMA', pagina: 'abc' })).toEqual({
      estado: 'ACTIVAS',
      tipo: undefined,
      gravedad: undefined,
      pagina: 1,
    });
    expect(leerFiltros({ estado: '__proto__', tipo: 'constructor' })).toMatchObject({ estado: 'ACTIVAS', tipo: undefined });
  });

  it('la página tiene que ser un entero mayor que 1', () => {
    for (const pagina of ['0', '-3', '1.5', 'NaN', '', '1']) {
      expect(leerFiltros({ pagina }).pagina).toBe(1);
    }
    expect(leerFiltros({ pagina: '2' }).pagina).toBe(2);
  });
});

describe('hrefBandeja', () => {
  it('sin filtros (o con los de por defecto) es la ruta sola', () => {
    expect(hrefBandeja()).toBe(RUTA_BANDEJA);
    expect(hrefBandeja({ estado: 'ACTIVAS', pagina: 1 })).toBe(RUTA_BANDEJA);
  });

  it('escribe solo lo que se salga de lo normal', () => {
    expect(hrefBandeja({ estado: 'MIAS' })).toBe(`${RUTA_BANDEJA}?estado=MIAS`);
    expect(hrefBandeja({ tipo: 'ERROR_SYNC', gravedad: 'ALTA', pagina: 2 })).toBe(`${RUTA_BANDEJA}?tipo=ERROR_SYNC&gravedad=ALTA&pagina=2`);
  });

  it('lo que escribe se lee igual (ida y vuelta)', () => {
    const filtros = { estado: 'CERRADAS', tipo: 'DERIVA_EN_HIS', gravedad: 'BAJA', pagina: 4 } as const;
    const url = new URL(hrefBandeja(filtros), 'http://x');
    expect(leerFiltros(Object.fromEntries(url.searchParams))).toEqual(filtros);
  });
});
