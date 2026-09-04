import { getErrorMessage } from './error';

describe('getErrorMessage', () => {
    it('devuelve el mensaje cuando el error es una instancia de Error', () => {
        expect(getErrorMessage(new Error('algo falló'))).toBe('algo falló');
    });

    it('devuelve el string tal cual cuando se lanzó un string', () => {
        expect(getErrorMessage('texto plano')).toBe('texto plano');
    });

    it('serializa a JSON cuando el error es un objeto sin forma de Error', () => {
        expect(getErrorMessage({ code: 'P2002', meta: { target: ['email'] } })).toBe(
            JSON.stringify({ code: 'P2002', meta: { target: ['email'] } }),
        );
    });

    it('no falla con undefined ni null', () => {
        expect(getErrorMessage(undefined)).toBe('undefined');
        expect(getErrorMessage(null)).toBe('null');
    });

    it('cae a String(error) si JSON.stringify no puede serializar (referencia circular)', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(getErrorMessage(circular)).toBe(String(circular));
    });
});
