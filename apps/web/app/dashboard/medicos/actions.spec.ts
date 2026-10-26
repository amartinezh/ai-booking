jest.mock('../../../lib/prisma', () => ({
    prisma: {
        doctorProfile: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
        user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), delete: jest.fn() },
        medicalService: { findFirst: jest.fn() },
        systemLog: { create: jest.fn(async () => ({})) },
    },
}));
jest.mock('../../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hash') }));

import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { deleteDoctorAction, saveDoctorAction } from './actions';

const mockSession = getSession as jest.Mock;
const mockLog = prisma.systemLog.create as jest.Mock;
const ADMIN = { userId: 'admin-1', email: 'admin@clinica.co', role: 'ORG_ADMIN', organizationId: 'org-1' };
const CLAVE = 'Consultorio2026';

function form(campos: Record<string, string>) {
    const fd = new FormData();
    const base: Record<string, string> = {
        email: 'dra.perez@clinica.co',
        fullName: 'Dra. Pérez',
        cedula: '24123456',
        serviceId: 'srv-1',
        medicalLicense: 'TP-1',
        phone: '3001234567',
        isActive: 'true',
        whatsappBookingEnabled: 'true',
        ...campos,
    };
    for (const [k, v] of Object.entries(base)) fd.set(k, v);
    return fd;
}

const MEDICO = {
    id: 'doc-1',
    userId: 'u-doc',
    fullName: 'Dra. Pérez',
    cedula: '24123456',
    serviceId: 'srv-1',
    medicalLicense: 'TP-1',
    phone: '3001234567',
    isActive: true,
    whatsappBookingEnabled: false,
    user: { email: 'dra.perez@clinica.co' },
};

describe('Médicos — solo el administrador, clave segura y huella (2026-10-27)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.medicalService.findFirst as jest.Mock).mockResolvedValue({ name: 'Medicina general' });
    });

    it.each(['BOOKING_AGENT', 'DOCTOR', 'PATIENT', 'GENERAL_OBSERVER'])(
        'un %s no crea, edita ni borra médicos (ni le cambia la clave a uno)',
        async (role) => {
            mockSession.mockResolvedValue({ ...ADMIN, role });
            expect((await saveDoctorAction(form({ password: CLAVE }))).success).toBe(false);
            expect((await saveDoctorAction(form({ id: 'doc-1', password: CLAVE }))).success).toBe(false);
            expect((await deleteDoctorAction('doc-1')).success).toBe(false);
            expect(prisma.user.create).not.toHaveBeenCalled();
            expect(prisma.user.update).not.toHaveBeenCalled();
            expect(prisma.user.delete).not.toHaveBeenCalled();
        },
    );

    it('crear exige una clave segura (antes, vacía, quedaba temporal123)', async () => {
        mockSession.mockResolvedValue(ADMIN);
        expect((await saveDoctorAction(form({ password: '' }))).success).toBe(false);
        expect((await saveDoctorAction(form({ password: 'temporal123' }))).success).toBe(false);
        expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('crear deja quién, el servicio, el WhatsApp y la cédula enmascarada', async () => {
        mockSession.mockResolvedValue(ADMIN);
        (prisma.doctorProfile.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'u-doc' });
        (prisma.doctorProfile.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });

        expect((await saveDoctorAction(form({ password: CLAVE }))).success).toBe(true);
        const d = mockLog.mock.calls[0][0].data;
        expect(d).toMatchObject({ action: 'DOCTOR_CREATED', userId: 'admin-1', organizationId: 'org-1' });
        expect(d.metadata.detalle).toBe(
            'Dra. Pérez · cédula ••••3456 · Medicina general · WhatsApp ON · cuenta dra.perez@clinica.co',
        );
        expect(JSON.stringify(d)).not.toContain(CLAVE);
    });

    it('editar: encender su WhatsApp y ponerle clave es un aviso con lo que cambió', async () => {
        mockSession.mockResolvedValue(ADMIN);
        (prisma.doctorProfile.findFirst as jest.Mock).mockResolvedValueOnce(MEDICO);
        const r = await saveDoctorAction(form({ id: 'doc-1', password: CLAVE, phone: '3109999999' }));
        expect(r.success).toBe(true);
        const d = mockLog.mock.calls[0][0].data;
        expect(d).toMatchObject({ action: 'DOCTOR_UPDATED', level: 'WARNING' });
        expect(d.metadata.detalle).toBe(
            'Dra. Pérez: teléfono cambió · WhatsApp: no → sí · le puso una clave nueva y se cerraron sus sesiones',
        );
        expect((prisma.user.update as jest.Mock).mock.calls[0][0].data.sessionsRevokedAt).toBeInstanceOf(Date);
        expect(JSON.stringify(d)).not.toContain('3109999999');
    });

    it('editar sin cambios sensibles queda como evento', async () => {
        mockSession.mockResolvedValue(ADMIN);
        (prisma.doctorProfile.findFirst as jest.Mock).mockResolvedValueOnce({ ...MEDICO, whatsappBookingEnabled: true });
        await saveDoctorAction(form({ id: 'doc-1', medicalLicense: 'TP-2' }));
        const d = mockLog.mock.calls[0][0].data;
        expect(d.level).toBe('EVENT');
        expect(d.metadata.detalle).toBe('Dra. Pérez: tarjeta profesional: TP-1 → TP-2');
    });

    it('borrar deja aviso con el nombre y la cédula enmascarada', async () => {
        mockSession.mockResolvedValue(ADMIN);
        (prisma.doctorProfile.findFirst as jest.Mock).mockResolvedValue(MEDICO);
        expect((await deleteDoctorAction('doc-1')).success).toBe(true);
        expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u-doc' } });
        const d = mockLog.mock.calls[0][0].data;
        expect(d).toMatchObject({ action: 'DOCTOR_DELETED', level: 'WARNING' });
        expect(d.metadata.detalle).toBe('Dra. Pérez · cédula ••••3456');
    });
});
