import { getJwtSecretKey } from './jwt-secret';

describe('getJwtSecretKey', () => {
    const ORIGINAL_ENV = process.env.JWT_SECRET;

    afterEach(() => {
        process.env.JWT_SECRET = ORIGINAL_ENV;
    });

    it('lanza si JWT_SECRET no está configurado (nunca degrada a un secreto público)', () => {
        delete process.env.JWT_SECRET;
        expect(() => getJwtSecretKey()).toThrow(/JWT_SECRET no está configurado/);
    });

    it('lanza si JWT_SECRET está vacío', () => {
        process.env.JWT_SECRET = '';
        expect(() => getJwtSecretKey()).toThrow(/JWT_SECRET no está configurado/);
    });

    it('codifica el secreto como bytes UTF-8 (round-trip con TextDecoder)', () => {
        process.env.JWT_SECRET = 'clave-de-prueba';
        const key = getJwtSecretKey();
        // No se usa `toBeInstanceOf(Uint8Array)`: en jsdom, TextEncoder (polyfill
        // de Node) y el `Uint8Array` global pertenecen a realms distintos.
        expect(ArrayBuffer.isView(key)).toBe(true);
        expect(new TextDecoder().decode(key)).toBe('clave-de-prueba');
    });
});
