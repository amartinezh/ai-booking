/** @jest-environment node */
import { accesoValido, firmarAcceso } from './acceso';
import { esIdDeClinica, validarClaveEstadisticas } from './clave';

const ORG = '97f18182-d0d9-4a3b-9eb6-4fbc031b917c';
const OTRA = '11111111-2222-4333-8444-555555555555';
const HASH = '$2b$10$abcdefghijklmnopqrstuuJ2sY0QbS1pL7mE3gk2yT4h8xZr6wq5e';
const AHORA = new Date('2026-10-26T15:00:00Z');

describe('estadísticas — la cookie de acceso', () => {
    const antes = process.env.JWT_SECRET;
    beforeAll(() => {
        process.env.JWT_SECRET = 'secreto-de-prueba';
    });
    afterAll(() => {
        process.env.JWT_SECRET = antes;
    });

    it('vale para la clínica y la clave con que se firmó', () => {
        const c = firmarAcceso(ORG, HASH, AHORA);
        expect(accesoValido(c, ORG, HASH, AHORA)).toBe(true);
    });

    it('no sirve en otra clínica', () => {
        expect(accesoValido(firmarAcceso(ORG, HASH, AHORA), OTRA, HASH, AHORA)).toBe(false);
    });

    it('cambiar la clave saca a quien había entrado con la anterior', () => {
        const c = firmarAcceso(ORG, HASH, AHORA);
        expect(accesoValido(c, ORG, `${HASH}x`, AHORA)).toBe(false);
    });

    it('vence a los 30 días', () => {
        const c = firmarAcceso(ORG, HASH, AHORA);
        expect(accesoValido(c, ORG, HASH, new Date('2026-11-24T14:59:00Z'))).toBe(true);
        expect(accesoValido(c, ORG, HASH, new Date('2026-11-25T15:00:01Z'))).toBe(false);
    });

    it('una cookie alterada, vacía o de otro secreto no entra', () => {
        const c = firmarAcceso(ORG, HASH, AHORA);
        const [vence, firma] = c.split('.');
        expect(accesoValido(`${Number(vence) + 3600}.${firma}`, ORG, HASH, AHORA)).toBe(false);
        expect(accesoValido(undefined, ORG, HASH, AHORA)).toBe(false);
        expect(accesoValido('basura', ORG, HASH, AHORA)).toBe(false);
        process.env.JWT_SECRET = 'otro-secreto';
        expect(accesoValido(c, ORG, HASH, AHORA)).toBe(false);
        process.env.JWT_SECRET = 'secreto-de-prueba';
    });

    it('no es un JWT: nunca puede pasar por la sesión del panel', () => {
        expect(firmarAcceso(ORG, HASH, AHORA).split('.')).toHaveLength(2);
    });
});

describe('estadísticas — la clave', () => {
    it('pide al menos 6 caracteres, sin espacios a los lados y que quepa en bcrypt', () => {
        expect(validarClaveEstadisticas('')).toBe('Escriba la clave.');
        expect(validarClaveEstadisticas('abc12')).toMatch(/al menos 6/);
        expect(validarClaveEstadisticas(' abc123')).toMatch(/espacios/);
        expect(validarClaveEstadisticas('ñ'.repeat(37))).toMatch(/demasiado larga/);
        expect(validarClaveEstadisticas('Anserma2026')).toBeNull();
        expect(validarClaveEstadisticas(123456 as unknown as string)).toBe('Escriba la clave.');
    });

    it('el id de la clínica en el enlace es un UUID', () => {
        expect(esIdDeClinica(ORG)).toBe(true);
        expect(esIdDeClinica('../dashboard')).toBe(false);
    });
});
