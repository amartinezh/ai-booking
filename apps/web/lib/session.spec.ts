jest.mock('next/headers', () => ({
    cookies: jest.fn(),
}));
jest.mock('jose', () => ({
    jwtVerify: jest.fn(),
}));

import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
import { getSession } from './session';

const mockCookies = cookies as jest.Mock;
const mockJwtVerify = jwtVerify as jest.Mock;

describe('getSession', () => {
    const ORIGINAL_SECRET = process.env.JWT_SECRET;

    beforeEach(() => {
        process.env.JWT_SECRET = 'clave-de-prueba';
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env.JWT_SECRET = ORIGINAL_SECRET;
    });

    it('devuelve null si no hay cookie auth_token', async () => {
        mockCookies.mockResolvedValue({ get: () => undefined });

        const session = await getSession();

        expect(session).toBeNull();
        expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    it('devuelve el payload cuando el token es válido', async () => {
        const payload = { userId: 'u1', email: 'a@b.com', role: 'ORG_ADMIN', organizationId: 'org-1' };
        mockCookies.mockResolvedValue({ get: () => ({ value: 'token-valido' }) });
        mockJwtVerify.mockResolvedValue({ payload });

        const session = await getSession();

        expect(session).toEqual(payload);
    });

    it('devuelve null si la verificación del token falla (firma inválida/expirado)', async () => {
        mockCookies.mockResolvedValue({ get: () => ({ value: 'token-invalido' }) });
        mockJwtVerify.mockRejectedValue(new Error('signature verification failed'));

        const session = await getSession();

        expect(session).toBeNull();
    });

    it('propaga el error de configuración si JWT_SECRET falta (no degrada a "sesión inválida")', async () => {
        delete process.env.JWT_SECRET;
        mockCookies.mockResolvedValue({ get: () => ({ value: 'algun-token' }) });

        await expect(getSession()).rejects.toThrow(/JWT_SECRET no está configurado/);
    });
});
