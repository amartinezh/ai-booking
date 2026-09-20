jest.mock('@/lib/prisma', () => ({
    prisma: {
        appointment: { update: jest.fn(), findFirst: jest.fn() },
        scheduleSlot: { update: jest.fn() },
        // Forma de arreglo: recibe las operaciones ya lanzadas y las espera todas.
        $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { cancelAppointmentAndFreeSlot, updateAttendance } from './dashboard';

const mockGetSession = getSession as jest.Mock;
const mockUpdate = prisma.appointment.update as jest.Mock;
const mockFindFirst = prisma.appointment.findFirst as jest.Mock;
const mockSlotUpdate = prisma.scheduleSlot.update as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;

describe('updateAttendance — scoping por tenant', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rechaza a un rol sin permiso (PATIENT)', async () => {
        mockGetSession.mockResolvedValue({ role: 'PATIENT', organizationId: 'org-1' });

        const res = await updateAttendance('apt-1', 'ATTENDED');

        expect(res.success).toBe(false);
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('un ORG_ADMIN solo puede actualizar dentro de su propia organización', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpdate.mockResolvedValue({});

        await updateAttendance('apt-1', 'ATTENDED');

        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'apt-1', organizationId: 'org-1' } }),
        );
    });

    it('un SUPER_ADMIN puede actualizar sin quedar limitado a un organizationId', async () => {
        mockGetSession.mockResolvedValue({ role: 'SUPER_ADMIN', organizationId: null });
        mockUpdate.mockResolvedValue({});

        await updateAttendance('apt-1', 'ATTENDED');

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'apt-1' } }));
    });

    it('devuelve error genérico si Prisma falla, sin filtrar detalles internos', async () => {
        mockGetSession.mockResolvedValue({ role: 'ORG_ADMIN', organizationId: 'org-1' });
        mockUpdate.mockRejectedValue(new Error('connection refused'));

        const res = await updateAttendance('apt-1', 'ATTENDED');

        expect(res).toEqual({ success: false, error: 'Error actualizando asistencia' });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// cancelAppointmentAndFreeSlot — quién y cuándo canceló
//
// Antes esta acción solo cambiaba el estado: `Appointment` no tiene `updatedAt`,
// así que una cancelación del personal no dejaba NINGÚN rastro y, ante un "yo no
// cancelé esa cita", no había forma de saber quién ni cuándo. Ahora deja la
// constancia en `metaLog` (ver @agenia/shared `appointment-cancel`).
// ═══════════════════════════════════════════════════════════════════════════
describe('cancelAppointmentAndFreeSlot', () => {
    const AHORA = new Date('2026-09-21T15:30:00.000Z');
    const AGENTE = { userId: 'u-agente', email: 'agente@clinica.co', role: 'BOOKING_AGENT', organizationId: 'org-1' };
    const CITA = { id: 'apt-1', scheduleSlotId: 'slot-1', status: 'SCHEDULED', metaLog: null };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers({ now: AHORA });
        mockGetSession.mockResolvedValue(AGENTE);
        mockFindFirst.mockResolvedValue({ ...CITA });
        mockUpdate.mockResolvedValue({});
        mockSlotUpdate.mockResolvedValue({});
    });
    afterEach(() => jest.useRealTimers());

    const datosDelUpdate = () => (mockUpdate.mock.calls[0][0] as { data: { status: string; metaLog?: Record<string, unknown> } }).data;

    it('rechaza sin sesión y a un rol sin permiso (PATIENT) sin tocar la base', async () => {
        mockGetSession.mockResolvedValue(null);
        expect((await cancelAppointmentAndFreeSlot('apt-1', 'slot-1')).success).toBe(false);

        mockGetSession.mockResolvedValue({ ...AGENTE, role: 'PATIENT' });
        expect((await cancelAppointmentAndFreeSlot('apt-1', 'slot-1')).success).toBe(false);

        expect(mockFindFirst).not.toHaveBeenCalled();
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('🏢 busca la cita DENTRO de la clínica de la sesión', async () => {
        await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');
        expect(mockFindFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'apt-1', organizationId: 'org-1' } }),
        );
    });

    it('🔎 deja la constancia: quién (id y rol) y cuándo (ISO) canceló', async () => {
        const res = await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

        expect(res).toEqual({ success: true });
        expect(datosDelUpdate()).toEqual({
            status: 'CANCELLED',
            metaLog: {
                cancelledBy: 'STAFF',
                cancelledByUserId: 'u-agente',
                cancelledByRole: 'BOOKING_AGENT',
                cancelledAt: '2026-09-21T15:30:00.000Z',
            },
        });
    });

    it('🔒 la constancia guarda el id de quien canceló, NUNCA su correo', async () => {
        await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');
        expect(JSON.stringify(datosDelUpdate())).not.toContain('agente@clinica.co');
    });

    it('cancela y libera el cupo en UNA transacción, como antes', async () => {
        await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect((mockTransaction.mock.calls[0][0] as unknown[]).length).toBe(2);
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'apt-1' } }));
        expect(mockSlotUpdate).toHaveBeenCalledWith({ where: { id: 'slot-1' }, data: { isAvailable: true } });
        expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    it('conserva lo que la cita ya tuviera en metaLog', async () => {
        mockFindFirst.mockResolvedValue({ ...CITA, metaLog: { nota: 'algo previo' } });
        await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');
        expect(datosDelUpdate().metaLog).toMatchObject({ nota: 'algo previo', cancelledBy: 'STAFF' });
    });

    it.each(['ORG_ADMIN', 'DOCTOR', 'SUPER_ADMIN'])('%s también deja constancia, con SU rol', async (role) => {
        mockGetSession.mockResolvedValue({ ...AGENTE, role, userId: `u-${role}` });
        await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');
        expect(datosDelUpdate().metaLog).toMatchObject({ cancelledByRole: role, cancelledByUserId: `u-${role}` });
    });

    it('un SUPER_ADMIN (sin clínica) busca la cita sin acotar por organización', async () => {
        mockGetSession.mockResolvedValue({ ...AGENTE, role: 'SUPER_ADMIN', organizationId: null });
        await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');
        expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'apt-1' } }));
    });

    it('🛡️ una cita YA cancelada NO pisa la constancia original (doble clic, página vieja)', async () => {
        const original = { cancelledBy: 'MIRROR', reason: 'PACIENTE LLAMA A CANCELAR' };
        mockFindFirst.mockResolvedValue({ ...CITA, status: 'CANCELLED', metaLog: original });

        const res = await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

        expect(res).toEqual({ success: true });
        // No se escribe metaLog: lo que ya constaba sigue siendo lo que consta.
        expect(datosDelUpdate().metaLog).toBeUndefined();
        expect(datosDelUpdate().status).toBe('CANCELLED');
    });

    it('una cita que no es de la clínica → error, y no cancela ni libera nada', async () => {
        mockFindFirst.mockResolvedValue(null);

        const res = await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

        expect(res).toEqual({ success: false, error: 'Cita no encontrada en su organización.' });
        expect(mockTransaction).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('un cupo que no corresponde a la cita se rechaza (no se libera un cupo ajeno)', async () => {
        const res = await cancelAppointmentAndFreeSlot('apt-1', 'slot-AJENO');

        expect(res).toEqual({ success: false, error: 'El cupo indicado no corresponde a la cita.' });
        expect(mockSlotUpdate).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('si la base falla, error genérico sin filtrar detalles internos', async () => {
        mockTransaction.mockRejectedValueOnce(new Error('connection refused'));
        const espia = jest.spyOn(console, 'error').mockImplementation(() => {});

        const res = await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

        expect(res).toEqual({ success: false, error: 'Hubo un error crítico al cancelar y liberar el cupo.' });
        espia.mockRestore();
    });
});
