jest.mock('../../../lib/prisma', () => ({
    prisma: {
        user: { findFirst: jest.fn(), delete: jest.fn() },
        systemLog: { create: jest.fn().mockResolvedValue({}) },
        $transaction: jest.fn(),
    },
}));
jest.mock('../../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));
jest.mock('../../../lib/sesion-token', () => ({ abrirSesion: jest.fn() }));

import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { deleteUserAction, saveUserAction } from './actions';

const mockGetSession = getSession as jest.Mock;
const mockFindFirst = prisma.user.findFirst as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;
const mockDelete = prisma.user.delete as jest.Mock;
const mockLog = prisma.systemLog.create as jest.Mock;

const ADMIN = { userId: 'admin-1', email: 'admin@clinica.co', role: 'ORG_ADMIN', organizationId: 'org-1' };
const CLAVE = 'Ventanilla2026';

function formData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
}

// Doble de `tx` dentro de `$transaction`: solo lo que `saveUserAction` usa.
function fakeTx() {
    return {
        user: { update: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({ id: 'new-user-1' }) },
        agentProfile: {
            upsert: jest.fn().mockResolvedValue({}),
            create: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({}),
        },
    };
}

describe('saveUserAction — organizationId en AgentProfile (aislamiento multi-tenant)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('modo edición: crear un AgentProfile nuevo (upsert.create) para un usuario existente incluye organizationId', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindFirst.mockResolvedValue({ id: 'user-1', email: 'a@b.com', role: 'BOOKING_AGENT' });
        const tx = fakeTx();
        mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

        const res = await saveUserAction(
            formData({ id: 'user-1', email: 'a@b.com', role: 'BOOKING_AGENT', agentFullName: 'Ana' }),
        );

        expect(res.success).toBe(true);
        expect(tx.agentProfile.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
            }),
        );
    });

    it('modo creación: el AgentProfile del usuario nuevo incluye organizationId', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        const tx = fakeTx();
        mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

        const res = await saveUserAction(
            formData({ email: 'nuevo@b.com', role: 'BOOKING_AGENT', agentFullName: 'Nuevo Agente', password: CLAVE }),
        );

        expect(res.success).toBe(true);
        expect(tx.agentProfile.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ organizationId: 'org-1', userId: 'new-user-1' }),
            }),
        );
    });

    it('rechaza sin organizationId en sesión, sin abrir transacción', async () => {
        mockGetSession.mockResolvedValue(null);

        const res = await saveUserAction(formData({ email: 'a@b.com', role: 'PATIENT' }));

        expect(res).toEqual({ success: false, error: 'Contexto de Clínica no encontrado' });
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('modo edición: rechaza si el usuario no existe en el tenant de la sesión', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindFirst.mockResolvedValue(null);

        const res = await saveUserAction(formData({ id: 'user-ajeno', email: 'a@b.com', role: 'PATIENT' }));

        expect(res.success).toBe(false);
        expect(mockTransaction).not.toHaveBeenCalled();
    });
});

describe('saveUserAction / deleteUserAction — quién puede y qué rol (2026-10-26)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(fakeTx()));
    });

    it.each(['DOCTOR', 'BOOKING_AGENT', 'PATIENT', 'GENERAL_OBSERVER'])(
        'un %s de la clínica no puede crear cuentas',
        async (role) => {
            mockGetSession.mockResolvedValue({ ...ADMIN, role });
            const res = await saveUserAction(formData({ email: 'x@b.com', role: 'ORG_ADMIN', password: CLAVE }));
            expect(res.success).toBe(false);
            expect(mockTransaction).not.toHaveBeenCalled();
        },
    );

    it.each(['SUPER_ADMIN', 'ADMIN', ''])('nadie asigna el rol «%s» desde la clínica', async (role) => {
        mockGetSession.mockResolvedValue(ADMIN);
        const res = await saveUserAction(formData({ email: 'x@b.com', role, password: CLAVE }));
        expect(res).toEqual({ success: false, error: 'Elija un rol válido.' });
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('editar tampoco puede subir a nadie a SUPER_ADMIN', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindFirst.mockResolvedValue({ id: 'user-1', email: 'a@b.com', role: 'DOCTOR' });
        const res = await saveUserAction(formData({ id: 'user-1', email: 'a@b.com', role: 'SUPER_ADMIN' }));
        expect(res.success).toBe(false);
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('crear exige una clave segura (antes, vacía, quedaba temporal123)', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        expect((await saveUserAction(formData({ email: 'x@b.com', role: 'DOCTOR' }))).success).toBe(false);
        expect((await saveUserAction(formData({ email: 'x@b.com', role: 'DOCTOR', password: 'temporal123' }))).success).toBe(
            false,
        );
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('el administrador crea un Administrador (antes la opción mandaba ADMIN y fallaba) y queda en la bitácora', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        const res = await saveUserAction(formData({ email: 'otro@b.com', role: 'ORG_ADMIN', password: CLAVE }));
        expect(res.success).toBe(true);
        const d = mockLog.mock.calls[0][0].data;
        expect(d).toMatchObject({ action: 'USER_CREATED', userId: 'admin-1', organizationId: 'org-1' });
        expect(d.metadata.objetivo).toEqual({ userId: 'new-user-1', email: 'otro@b.com', role: 'ORG_ADMIN' });
        expect(JSON.stringify(d)).not.toContain(CLAVE);
    });

    it('un cambio de rol o de clave queda como aviso, con el antes y el después', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindFirst.mockResolvedValue({ id: 'user-1', email: 'a@b.com', role: 'DOCTOR' });
        const res = await saveUserAction(formData({ id: 'user-1', email: 'a@b.com', role: 'BOOKING_AGENT', password: CLAVE }));
        expect(res.success).toBe(true);
        const d = mockLog.mock.calls[0][0].data;
        expect(d).toMatchObject({ action: 'USER_UPDATED', level: 'WARNING' });
        expect(d.metadata.detalle).toContain('rol Médico → Agente de reservas');
        expect(d.metadata.detalle).toContain('clave nueva y se cerraron sus sesiones');
        expect(JSON.stringify(d)).not.toContain(CLAVE);
    });

    it('la clave nueva cierra las sesiones de esa cuenta; si es la propia, le da un token nuevo', async () => {
        const { abrirSesion } = jest.requireMock('../../../lib/sesion-token') as { abrirSesion: jest.Mock };
        const tx = fakeTx();
        mockTransaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));
        mockGetSession.mockResolvedValue(ADMIN);

        mockFindFirst.mockResolvedValue({ id: 'user-1', email: 'a@b.com', role: 'DOCTOR' });
        await saveUserAction(formData({ id: 'user-1', email: 'a@b.com', role: 'DOCTOR', password: CLAVE }));
        expect(tx.user.update.mock.calls[0][0].data.sessionsRevokedAt).toBeInstanceOf(Date);
        expect(abrirSesion).not.toHaveBeenCalled();

        mockFindFirst.mockResolvedValue({ id: 'admin-1', email: 'admin@clinica.co', role: 'ORG_ADMIN' });
        await saveUserAction(formData({ id: 'admin-1', email: 'admin@clinica.co', role: 'ORG_ADMIN', password: CLAVE }));
        expect(abrirSesion).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1', role: 'ORG_ADMIN' }));
    });

    it('no puede cambiar su propio rol', async () => {
        mockGetSession.mockResolvedValue(ADMIN);
        mockFindFirst.mockResolvedValue({ id: 'admin-1', email: 'admin@clinica.co', role: 'ORG_ADMIN' });
        const res = await saveUserAction(formData({ id: 'admin-1', email: 'admin@clinica.co', role: 'DOCTOR' }));
        expect(res.success).toBe(false);
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('borrar: solo el administrador, nunca a sí mismo, y queda en la bitácora', async () => {
        mockGetSession.mockResolvedValue({ ...ADMIN, role: 'BOOKING_AGENT' });
        expect((await deleteUserAction('user-1')).success).toBe(false);
        mockGetSession.mockResolvedValue(ADMIN);
        expect((await deleteUserAction('admin-1')).success).toBe(false);
        expect(mockDelete).not.toHaveBeenCalled();

        mockDelete.mockResolvedValue({ id: 'user-1', email: 'a@b.com', role: 'DOCTOR' });
        expect((await deleteUserAction('user-1')).success).toBe(true);
        expect(mockDelete.mock.calls[0][0].where).toEqual({ id: 'user-1', organizationId: 'org-1', role: { not: 'SUPER_ADMIN' } });
        expect(mockLog.mock.calls[0][0].data).toMatchObject({ action: 'USER_DELETED', level: 'WARNING' });
    });
});
