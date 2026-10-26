import {
    ACCIONES_DE_LA_BITACORA,
    ACCIONES_SIN_USUARIO,
    CATEGORIAS,
    ETIQUETA_CATEGORIA,
    accionesDeCategorias,
    describirNavegador,
    enmascarar,
    esCategoria,
    etiquetaRol,
    leerAccionDeLaBitacora,
    recortar,
} from './catalogo';

describe('catálogo de actividad', () => {
    it('cada categoría tiene etiqueta e ícono', () => {
        for (const c of CATEGORIAS) expect(ETIQUETA_CATEGORIA[c].etiqueta).toBeTruthy();
    });

    it('las acciones sin usuario están en el catálogo (si no, saldrían como «Otras acciones»)', () => {
        for (const a of ACCIONES_SIN_USUARIO) expect(ACCIONES_DE_LA_BITACORA[a]).toBeDefined();
    });

    it('lee una acción conocida y una desconocida', () => {
        expect(leerAccionDeLaBitacora('USER_LOGIN', 'Ingreso de usuario (ORG_ADMIN)')).toEqual({
            categoria: 'INGRESOS',
            titulo: 'Ingresó al panel',
            aviso: false,
            detalle: null,
        });
        expect(leerAccionDeLaBitacora('LOGIN_FAILED', 'x').aviso).toBe(true);
        // El mensaje descriptivo sale como detalle solo donde se marcó.
        expect(leerAccionDeLaBitacora('MASS_NOTICE_SENT', 'Lote 1: 3 enviados').detalle).toBe('Lote 1: 3 enviados');
        expect(leerAccionDeLaBitacora('ALGO_NUEVO', 'Hizo algo')).toEqual({
            categoria: 'OTROS',
            titulo: 'Hizo algo',
            aviso: false,
            detalle: null,
        });
    });

    it('acciones de una categoría', () => {
        const ingresos = accionesDeCategorias(new Set(['INGRESOS'] as const));
        expect(ingresos.sort()).toEqual(['USER_LOGIN', 'USER_LOGOUT']);
        expect(accionesDeCategorias(new Set(['SEGURIDAD'] as const))).toContain('LOGIN_FAILED');
    });

    it('esCategoria', () => {
        expect(esCategoria('INGRESOS')).toBe(true);
        expect(esCategoria('ingresos')).toBe(false);
        expect(esCategoria(undefined)).toBe(false);
    });

    it('enmascara documentos y teléfonos', () => {
        expect(enmascarar('1053812345')).toBe('••••2345');
        expect(enmascarar('123')).toBe('••••');
        expect(enmascarar(null)).toBe('');
    });

    it('recorta textos largos', () => {
        expect(recortar('  hola   mundo ')).toBe('hola mundo');
        expect(recortar('x'.repeat(300), 10)).toHaveLength(10);
    });

    it('describe el navegador', () => {
        expect(
            describirNavegador(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            ),
        ).toBe('Chrome en Windows');
        expect(
            describirNavegador(
                'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            ),
        ).toBe('Safari en iPhone');
        expect(describirNavegador('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130')).toBe(
            'Edge en Windows',
        );
        expect(describirNavegador('curl/8.4.0')).toBe('Programa (no es un navegador)');
        expect(describirNavegador(null)).toBe('');
    });

    it('etiqueta de rol', () => {
        expect(etiquetaRol('BOOKING_AGENT')).toBe('Agente de reservas');
        expect(etiquetaRol('RARO')).toBe('RARO');
        expect(etiquetaRol(null)).toBe('');
    });
});
