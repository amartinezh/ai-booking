jest.mock('../../../lib/prisma', () => ({
    prisma: {
        patientProfile: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
        user: { update: jest.fn(), create: jest.fn(), delete: jest.fn() },
        systemLog: { create: jest.fn(async () => ({})) },
    },
}));
jest.mock('../../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hash') }));

import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { deletePatientAction, savePatientAction } from './actions';

const mockSession = getSession as jest.Mock;
const mockLog = prisma.systemLog.create as jest.Mock;
const ADMIN = { userId: 'admin-1', email: 'admin@clinica.co', role: 'ORG_ADMIN', organizationId: 'org-1' };
const CLAVE = 'Pacientes2026';

function form(campos: Record<string, string>) {
    const fd = new FormData();
    const base: Record<string, string> = {
        email: '1053123456@paciente.temporal.com',
        fullName: 'María López',
        cedula: '1053123456',
        whatsappId: '573001234567',
        address: 'Calle 1',
        dateOfBirth: '1990-05-01',
        ...campos,
    };
    for (const [k, v] of Object.entries(base)) fd.set(k, v);
    return fd;
}

const FICHA = {
    id: 'pac-1',
    userId: 'u-pac',
    fullName: 'María López',
    cedula: '1053123456',
    whatsappId: '573001234567',
    address: 'Calle 1',
    dateOfBirth: new Date('1990-05-01'),
    user: { email: '1053123456@paciente.temporal.com' },
};

describe('Pacientes — solo el administrador y huella sin datos personales (2026-10-27)', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each(['BOOKING_AGENT', 'DOCTOR', 'PATIENT'])('un %s no crea, edita ni borra fichas', async (role) => {
        mockSession.mockResolvedValue({ ...ADMIN, role });
        expect((await savePatientAction(form({ password: CLAVE }))).success).toBe(false);
        expect((await savePatientAction(form({ id: 'pac-1', password: CLAVE }))).success).toBe(false);
        expect((await deletePatientAction('pac-1')).success).toBe(false);
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('crear exige una clave segura', async () => {
        mockSession.mockResolvedValue(ADMIN);
        expect((await savePatientAction(form({ password: '' }))).success).toBe(false);
        expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('editar dice QUÉ campos cambiaron, sin copiar sus valores', async () => {
        mockSession.mockResolvedValue(ADMIN);
        (prisma.patientProfile.findFirst as jest.Mock).mockResolvedValue(FICHA);
        const r = await savePatientAction(form({ id: 'pac-1', whatsappId: '573109999999', address: 'Carrera 9' }));
        expect(r.success).toBe(true);
        const d = mockLog.mock.calls[0][0].data;
        expect(d).toMatchObject({ action: 'PATIENT_UPDATED', level: 'EVENT', userId: 'admin-1' });
        expect(d.metadata.detalle).toBe('Paciente ••••3456: WhatsApp cambió · dirección cambió');
        expect(JSON.stringify(d)).not.toMatch(/573109999999|Carrera 9|1053123456/);
    });

    it('cambiarle la clave a un paciente es un aviso', async () => {
        mockSession.mockResolvedValue(ADMIN);
        (prisma.patientProfile.findFirst as jest.Mock).mockResolvedValue(FICHA);
        await savePatientAction(form({ id: 'pac-1', password: CLAVE }));
        const d = mockLog.mock.calls[0][0].data;
        expect(d.level).toBe('WARNING');
        expect(d.metadata.detalle).toBe('Paciente ••••3456: le puso una clave nueva y se cerraron sus sesiones');
        // La clave nueva saca a quien tuviera la vieja con una sesión abierta.
        expect((prisma.user.update as jest.Mock).mock.calls[0][0].data.sessionsRevokedAt).toBeInstanceOf(Date);
    });

    it('crear y borrar quedan registrados con la cédula enmascarada', async () => {
        mockSession.mockResolvedValue(ADMIN);
        (prisma.patientProfile.findFirst as jest.Mock).mockResolvedValueOnce(null);
        (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'u-pac' });
        (prisma.patientProfile.create as jest.Mock).mockResolvedValue({ id: 'pac-1' });
        expect((await savePatientAction(form({ password: CLAVE }))).success).toBe(true);

        (prisma.patientProfile.findFirst as jest.Mock).mockResolvedValueOnce(FICHA);
        expect((await deletePatientAction('pac-1')).success).toBe(true);

        const [creada, borrada] = mockLog.mock.calls.map((c) => c[0].data);
        expect(creada).toMatchObject({ action: 'PATIENT_CREATED' });
        expect(creada.metadata.detalle).toBe('Paciente ••••3456 · con WhatsApp');
        expect(borrada).toMatchObject({ action: 'PATIENT_DELETED', level: 'WARNING' });
    });
});
