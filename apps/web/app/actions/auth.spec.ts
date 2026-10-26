/** @jest-environment node */
jest.mock('../../lib/prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn() },
        systemLog: { create: jest.fn(), count: jest.fn() },
    },
}));
jest.mock('../../lib/session', () => ({ getSession: jest.fn() }));
const cookieSet = jest.fn();
const cookieDelete = jest.fn();
let cabeceras: Record<string, string> = {};
jest.mock('next/headers', () => ({
    cookies: async () => ({ set: cookieSet, delete: cookieDelete, get: () => undefined }),
    headers: async () => ({ get: (k: string) => cabeceras[k.toLowerCase()] ?? null }),
}));
// jose es ESM puro (Jest no lo transforma): un doble que firma un token cualquiera.
jest.mock('jose', () => ({
    SignJWT: class {
        setProtectedHeader() {
            return this;
        }
        setExpirationTime() {
            return this;
        }
        async sign() {
            return 'token-de-prueba';
        }
    },
}));
jest.mock('../../lib/jwt-secret', () => ({
    getJwtSecretKey: () => new TextEncoder().encode('secreto-de-prueba-de-32-caracteres!!'),
}));

import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { getSession } from '../../lib/session';
import { loginUser, logoutUser } from './auth';
import { INTENTOS_INGRESO } from '../../lib/actividad/ingreso';

const findUnique = prisma.user.findUnique as jest.Mock;
const userCreate = prisma.user.create as jest.Mock;
const userCount = prisma.user.count as jest.Mock;
const logCreate = prisma.systemLog.create as jest.Mock;
const logCount = prisma.systemLog.count as jest.Mock;
const mockSession = getSession as jest.Mock;

const CLAVE = 'ClaveBuena2026';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

function form(email: string, password: string) {
    const fd = new FormData();
    fd.set('email', email);
    fd.set('password', password);
    return fd;
}

function usuario(extra: Record<string, unknown> = {}) {
    return {
        id: 'u-1',
        email: 'Agenda@Clinica.co',
        password: bcrypt.hashSync(CLAVE, 4),
        role: 'BOOKING_AGENT',
        organizationId: 'org-1',
        organization: { isActive: true },
        ...extra,
    };
}

/** Lo que se escribió en la bitácora, por acción. */
function registros(action: string) {
    return logCreate.mock.calls.map((c) => c[0].data).filter((d) => d.action === action);
}

describe('loginUser — huella de cada ingreso', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cabeceras = { 'x-forwarded-for': '190.25.1.2, 10.0.0.1', 'user-agent': UA };
        logCreate.mockResolvedValue({});
        logCount.mockResolvedValue(0);
        userCount.mockResolvedValue(0);
    });

    it('un ingreso correcto queda con usuario, clínica, rol, IP real y navegador', async () => {
        findUnique.mockResolvedValue(usuario());
        const r = await loginUser(form('Agenda@Clinica.co', CLAVE));

        expect(r).toEqual({ success: true, role: 'BOOKING_AGENT' });
        expect(cookieSet).toHaveBeenCalledWith('auth_token', expect.any(String), expect.objectContaining({ httpOnly: true }));
        const [d] = registros('USER_LOGIN');
        expect(d).toMatchObject({ level: 'EVENT', userId: 'u-1', organizationId: 'org-1' });
        expect(d.metadata).toMatchObject({
            role: 'BOOKING_AGENT', // «Logueos por rol» de Estadísticas Globales lo lee así
            email: 'Agenda@Clinica.co',
            ip: '190.25.1.2',
            userAgent: UA,
        });
    });

    it('ya no crea un super administrador con admin123 cuando no hay ninguno', async () => {
        findUnique.mockResolvedValue(null);
        await loginUser(form('superadmin@sanvicente.com', 'admin123'));
        expect(userCreate).not.toHaveBeenCalled();
    });

    it('clave equivocada: aviso con el usuario y el motivo, sin la clave', async () => {
        findUnique.mockResolvedValue(usuario());
        const r = await loginUser(form('Agenda@Clinica.co', 'otraClave1'));

        expect(r).toEqual({ error: 'Credenciales incorrectas' });
        expect(cookieSet).not.toHaveBeenCalled();
        const [d] = registros('LOGIN_FAILED');
        expect(d).toMatchObject({ level: 'WARNING', userId: 'u-1', organizationId: 'org-1' });
        expect(d.metadata).toMatchObject({ email: 'agenda@clinica.co', motivo: 'CLAVE_INCORRECTA', ip: '190.25.1.2' });
        expect(JSON.stringify(d)).not.toContain('otraClave1');
    });

    it('correo sin cuenta: queda el correo intentado, sin usuario ni clínica', async () => {
        findUnique.mockResolvedValue(null);
        const r = await loginUser(form('intruso@x.com', 'loquesea1'));

        expect(r).toEqual({ error: 'Credenciales incorrectas' });
        const [d] = registros('LOGIN_FAILED');
        expect(d).toMatchObject({ userId: null, organizationId: null });
        expect(d.metadata).toMatchObject({ email: 'intruso@x.com', motivo: 'USUARIO_NO_EXISTE' });
    });

    it('clínica suspendida: no entra y queda el motivo', async () => {
        findUnique.mockResolvedValue(usuario({ organization: { isActive: false } }));
        const r = await loginUser(form('Agenda@Clinica.co', CLAVE));

        expect(r.error).toMatch(/no se encuentra activa/);
        expect(cookieSet).not.toHaveBeenCalled();
        expect(registros('LOGIN_FAILED')[0].metadata.motivo).toBe('CLINICA_INACTIVA');
    });

    it(`tras ${INTENTOS_INGRESO.MAX} fallidos del mismo correo desde la misma IP, frena sin mirar la clave`, async () => {
        logCount.mockResolvedValueOnce(INTENTOS_INGRESO.MAX).mockResolvedValueOnce(0);
        findUnique.mockResolvedValue(usuario());
        const r = await loginUser(form(' AGENDA@clinica.co ', CLAVE));

        expect(r.error).toMatch(/Demasiados intentos/);
        expect(findUnique).not.toHaveBeenCalled();
        expect(cookieSet).not.toHaveBeenCalled();
        // Cuenta por correo normalizado e IP.
        const where = logCount.mock.calls[0][0].where;
        expect(where.action).toBe('LOGIN_FAILED');
        expect(where.AND).toEqual([
            { metadata: { path: ['email'], equals: 'agenda@clinica.co' } },
            { metadata: { path: ['ip'], equals: '190.25.1.2' } },
        ]);
        expect(registros('LOGIN_BLOCKED')).toHaveLength(1);
        // El frenado no se cuenta como otro fallido (no alarga el castigo solo).
        expect(registros('LOGIN_FAILED')).toHaveLength(0);
    });

    it('si ya quedó constancia del frenado en esta ventana, no escribe otra', async () => {
        logCount.mockResolvedValueOnce(INTENTOS_INGRESO.MAX + 7).mockResolvedValueOnce(1);
        const r = await loginUser(form('agenda@clinica.co', CLAVE));
        expect(r.error).toMatch(/Demasiados intentos/);
        expect(logCount.mock.calls[1][0].where.action).toBe('LOGIN_BLOCKED');
        expect(logCreate).not.toHaveBeenCalled();
    });

    it('sin IP conocida, cuenta igual con «desconocida»', async () => {
        cabeceras = {};
        findUnique.mockResolvedValue(null);
        await loginUser(form('a@b.co', 'x1234567890'));
        expect(logCount.mock.calls[0][0].where.AND[1]).toEqual({ metadata: { path: ['ip'], equals: 'desconocida' } });
        expect(registros('LOGIN_FAILED')[0].metadata.ip).toBe('desconocida');
    });

    it('si la bitácora falla, el ingreso sigue', async () => {
        findUnique.mockResolvedValue(usuario());
        logCreate.mockRejectedValue(new Error('base caída'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const r = await loginUser(form('Agenda@Clinica.co', CLAVE));
        expect(r).toEqual({ success: true, role: 'BOOKING_AGENT' });
    });

    it('sin correo o clave no consulta nada', async () => {
        expect(await loginUser(form('', ''))).toEqual({ error: 'Por favor ingrese correo y contraseña' });
        expect(findUnique).not.toHaveBeenCalled();
    });
});

describe('logoutUser', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cabeceras = { 'x-forwarded-for': '190.25.1.2' };
        logCreate.mockResolvedValue({});
    });

    it('deja constancia del cierre de sesión y borra la cookie', async () => {
        mockSession.mockResolvedValue({ userId: 'u-1', email: 'a@b.co', role: 'ORG_ADMIN', organizationId: 'org-1' });
        await logoutUser();
        expect(registros('USER_LOGOUT')[0]).toMatchObject({ userId: 'u-1', organizationId: 'org-1' });
        expect(cookieDelete).toHaveBeenCalledWith('auth_token');
    });

    it('sin sesión solo borra la cookie', async () => {
        mockSession.mockResolvedValue(null);
        await logoutUser();
        expect(logCreate).not.toHaveBeenCalled();
        expect(cookieDelete).toHaveBeenCalledWith('auth_token');
    });
});
