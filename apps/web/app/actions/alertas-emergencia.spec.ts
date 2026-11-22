jest.mock('@/lib/prisma', () => ({
    prisma: {
        $transaction: jest.fn(),
        systemLog: { create: jest.fn(async () => ({})) },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn(async () => ({ get: () => ({ value: 'tok' }) })) }));

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { guardarAlertasEmergenciaAction, probarAlertaEmergenciaAction } from './alertas-emergencia';

const sesion = getSession as jest.Mock;
const transaccion = prisma.$transaction as jest.Mock;
const log = prisma.systemLog.create as jest.Mock;
const ADMIN = { role: 'ORG_ADMIN', organizationId: 'org-1', userId: 'u-1', email: 'admin@clinica.co' };

const tx = {
    emergencyAlertRecipient: {
        findMany: jest.fn(async () => []),
        deleteMany: jest.fn(),
        create: jest.fn(async () => ({})),
        updateMany: jest.fn(),
    },
};

describe('guardarAlertasEmergenciaAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sesion.mockResolvedValue(ADMIN);
        transaccion.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    });

    it.each(['BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER', 'SUPER_ADMIN'])('%s no la cambia', async (role) => {
        sesion.mockResolvedValue({ ...ADMIN, role });
        expect(await guardarAlertasEmergenciaAction([])).toEqual({ success: false, error: 'Acceso denegado' });
        expect(transaccion).not.toHaveBeenCalled();
    });

    it('guarda en la clínica de la sesión, deja huella sin el celular entero y refresca Configuración', async () => {
        const r = await guardarAlertasEmergenciaAction([{ label: 'Urgencias', telefono: '314 679 3010', isActive: true }]);
        expect(r).toEqual({ success: true, data: { activas: 1 } });
        expect(tx.emergencyAlertRecipient.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ organizationId: 'org-1', phone: '573146793010' }),
        });
        const dato = log.mock.calls[0][0].data;
        expect(dato.action).toBe('EMERGENCY_ALERT_RECIPIENTS_CHANGED');
        expect(dato.message).toBe('Alertas de posible emergencia: agregó a Urgencias (···3010)');
        expect(JSON.stringify(dato)).not.toContain('3146793010');
        expect(revalidatePath).toHaveBeenCalledWith('/dashboard/configuracion', 'layout');
    });

    it('un fijo no se guarda', async () => {
        const r = await guardarAlertasEmergenciaAction([{ label: 'Conmutador', telefono: '606 853 8860', isActive: true }]);
        expect(r.success).toBe(false);
        expect(transaccion).not.toHaveBeenCalled();
    });
});

describe('probarAlertaEmergenciaAction', () => {
    const fetchOriginal = global.fetch;
    afterEach(() => {
        global.fetch = fetchOriginal;
    });
    beforeEach(() => {
        jest.clearAllMocks();
        sesion.mockResolvedValue(ADMIN);
    });

    it('la pide a la API con la sesión de quien pulsa', async () => {
        global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) })) as any;
        expect(await probarAlertaEmergenciaAction('r1')).toEqual({ success: true, data: null });
        const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
        expect(url).toMatch(/\/emergency-alerts\/recipients\/r1\/test$/);
        expect(init.headers.Cookie).toBe('auth_token=tok');
        expect(log.mock.calls[0][0].data.action).toBe('EMERGENCY_ALERT_TESTED');
    });

    it('lo que diga la API, tal cual', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({ success: false, error: 'No salió: falta registrar la plantilla en Configuración.' }),
        })) as any;
        expect(await probarAlertaEmergenciaAction('r1')).toEqual({
            success: false,
            error: 'No salió: falta registrar la plantilla en Configuración.',
        });
    });

    it('un agendador no la manda', async () => {
        sesion.mockResolvedValue({ ...ADMIN, role: 'BOOKING_AGENT' });
        global.fetch = jest.fn() as any;
        expect(await probarAlertaEmergenciaAction('r1')).toEqual({ success: false, error: 'Acceso denegado' });
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
