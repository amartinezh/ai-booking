jest.mock('next/headers', () => ({
    cookies: jest.fn(),
}));
jest.mock('jose', () => ({
    jwtVerify: jest.fn(),
}));
jest.mock('./prisma', () => ({ prisma: { user: { findUnique: jest.fn() } } }));

import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
import { getSession } from './session';
import { prisma } from './prisma';

const mockCuenta = prisma.user.findUnique as jest.Mock;

const mockCookies = cookies as jest.Mock;
const mockJwtVerify = jwtVerify as jest.Mock;

describe('getSession', () => {
    const ORIGINAL_SECRET = process.env.JWT_SECRET;

    beforeEach(() => {
        process.env.JWT_SECRET = 'clave-de-prueba';
        jest.clearAllMocks();
        mockCuenta.mockResolvedValue({
            role: 'ORG_ADMIN',
            organizationId: 'org-1',
            sessionsRevokedAt: null,
            organization: { isActive: true },
        });
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

describe('getSession — la cuenta tiene que seguir vigente en la base (2026-10-27)', () => {
    const ORIGINAL_SECRET = process.env.JWT_SECRET;
    const payload = { userId: 'u1', email: 'a@b.com', role: 'ORG_ADMIN', organizationId: 'org-1', iat: 1_800_000_000 };

    beforeEach(() => {
        process.env.JWT_SECRET = 'clave-de-prueba';
        jest.clearAllMocks();
        mockCookies.mockResolvedValue({ get: () => ({ value: 'token-valido' }) });
        mockJwtVerify.mockResolvedValue({ payload });
    });
    afterAll(() => {
        process.env.JWT_SECRET = ORIGINAL_SECRET;
    });

    const cuenta = (c: Record<string, unknown> = {}) => ({
        role: 'ORG_ADMIN',
        organizationId: 'org-1',
        sessionsRevokedAt: null,
        organization: { isActive: true },
        ...c,
    });

    it('vigente: devuelve la sesión y busca la cuenta por su id', async () => {
        mockCuenta.mockResolvedValue(cuenta());
        expect(await getSession()).toEqual(payload);
        expect(mockCuenta.mock.calls[0][0].where).toEqual({ id: 'u1' });
    });

    it.each([
        ['la cuenta fue borrada', null],
        ['le cambiaron el rol', cuenta({ role: 'BOOKING_AGENT' })],
        ['su clínica está suspendida', cuenta({ organization: { isActive: false } })],
        ['le cerraron las sesiones después de entrar', cuenta({ sessionsRevokedAt: new Date(1_800_000_100_000) })],
    ])('%s: ya no hay sesión', async (_c, c) => {
        mockCuenta.mockResolvedValue(c);
        expect(await getSession()).toBeNull();
    });

    it('si la base no responde, no hay sesión (falla cerrado)', async () => {
        mockCuenta.mockRejectedValue(new Error('conexión caída'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(await getSession()).toBeNull();
    });
});
