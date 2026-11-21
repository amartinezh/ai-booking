jest.mock('@/lib/prisma', () => ({
    prisma: {
        organization: { findUnique: jest.fn(), update: jest.fn() },
        systemLog: { create: jest.fn(async () => ({})) },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { setMyTelefonoSoporte } from './datos-clinica';

const sesion = getSession as jest.Mock;
const leer = prisma.organization.findUnique as jest.Mock;
const escribir = prisma.organization.update as jest.Mock;
const log = prisma.systemLog.create as jest.Mock;
const ADMIN = { role: 'ORG_ADMIN', organizationId: 'org-1', userId: 'u-1', email: 'admin@clinica.co' };

describe('setMyTelefonoSoporte', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sesion.mockResolvedValue(ADMIN);
        leer.mockResolvedValue({ supportPhone: '(606) 859 1010' });
        escribir.mockResolvedValue({});
    });

    it.each(['BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER', 'SUPER_ADMIN'])('%s no lo cambia', async (role) => {
        sesion.mockResolvedValue({ ...ADMIN, role });
        expect(await setMyTelefonoSoporte('3001234567')).toEqual({ success: false, error: 'Acceso denegado' });
        expect(escribir).not.toHaveBeenCalled();
    });

    it('guarda el celular con indicativo, en la clínica de la sesión, y refresca Configuración', async () => {
        expect(await setMyTelefonoSoporte('300 123 4567')).toEqual({
            success: true,
            telefono: '+57 300 123 4567',
            alertasPorWhatsapp: true,
        });
        expect(escribir).toHaveBeenCalledWith({ where: { id: 'org-1' }, data: { supportPhone: '+57 300 123 4567' } });
        expect(revalidatePath).toHaveBeenCalledWith('/dashboard/configuracion', 'layout');
    });

    it('deja huella con los últimos cuatro dígitos, nunca el número completo', async () => {
        await setMyTelefonoSoporte('3001234567');
        const dato = log.mock.calls[0][0].data;
        expect(dato.action).toBe('SUPPORT_PHONE_CHANGED');
        expect(dato.metadata.detalle).toBe('Teléfono de soporte: ···1010 → ···4567');
        expect(JSON.stringify(dato)).not.toContain('3001234567');
    });

    it('guardar lo mismo no escribe ni anota', async () => {
        leer.mockResolvedValue({ supportPhone: '+57 300 123 4567' });
        expect(await setMyTelefonoSoporte('3001234567')).toMatchObject({ success: true });
        expect(escribir).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
    });

    it('no deja vaciarlo', async () => {
        expect(await setMyTelefonoSoporte('   ')).toMatchObject({ success: false });
        expect(escribir).not.toHaveBeenCalled();
    });

    it('si la base falla, lo dice', async () => {
        escribir.mockRejectedValue(new Error('sin conexión'));
        expect(await setMyTelefonoSoporte('3001234567')).toEqual({ success: false, error: 'sin conexión' });
    });
});
