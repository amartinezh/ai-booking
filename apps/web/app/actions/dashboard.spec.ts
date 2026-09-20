jest.mock('@/lib/prisma', () => {
    const prisma = {
        appointment: { update: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
        scheduleSlot: { update: jest.fn() },
        $transaction: jest.fn(),
    };
    // Transacción interactiva: el callback recibe el mismo doble como `tx`.
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
    return { prisma };
});
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
const mockUpdateMany = prisma.appointment.updateMany as jest.Mock;
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
    const CITA = { id: 'apt-1', scheduleSlotId: 'slot-1', metaLog: null };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers({ now: AHORA });
        mockGetSession.mockResolvedValue(AGENTE);
        mockFindFirst.mockResolvedValue({ ...CITA });
        mockUpdateMany.mockResolvedValue({ count: 1 });
        mockSlotUpdate.mockResolvedValue({});
    });
    afterEach(() => jest.useRealTimers());

    const argsDelCambio = () => mockUpdateMany.mock.calls[0][0] as { where: unknown; data: { status: string; metaLog?: Record<string, unknown> } };

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
        expect(argsDelCambio().data).toEqual({
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
        expect(JSON.stringify(argsDelCambio().data)).not.toContain('agente@clinica.co');
    });

    it('conserva lo que la cita ya tuviera en metaLog', async () => {
        mockFindFirst.mockResolvedValue({ ...CITA, metaLog: { nota: 'algo previo' } });
        await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');
        expect(argsDelCambio().data.metaLog).toMatchObject({ nota: 'algo previo', cancelledBy: 'STAFF' });
    });

    it.each(['ORG_ADMIN', 'DOCTOR', 'SUPER_ADMIN'])('%s también deja constancia, con SU rol', async (role) => {
        mockGetSession.mockResolvedValue({ ...AGENTE, role, userId: `u-${role}` });
        await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');
        expect(argsDelCambio().data.metaLog).toMatchObject({ cancelledByRole: role, cancelledByUserId: `u-${role}` });
    });

    it('un SUPER_ADMIN (sin clínica) busca la cita sin acotar por organización', async () => {
        mockGetSession.mockResolvedValue({ ...AGENTE, role: 'SUPER_ADMIN', organizationId: null });
        await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');
        expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'apt-1' } }));
    });

    it('cancela y libera el cupo en UNA transacción, en ese orden', async () => {
        const res = await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

        expect(res).toEqual({ success: true });
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(mockSlotUpdate).toHaveBeenCalledWith({ where: { id: 'slot-1' }, data: { isAvailable: true } });
        expect(mockUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(mockSlotUpdate.mock.invocationCallOrder[0]);
        expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    // ══════════════════════════════════════════════════════════════════════
    // Solo libera el cupo QUIEN REALMENTE CANCELA. Antes, volver a cancelar una
    // cita ya cancelada (doble clic, página vieja) liberaba el cupo de nuevo
    // aunque otra cita ya lo hubiera tomado, y dejaba un evento redundante hacia
    // el HIS. Reproducido contra Postgres real antes de corregirlo.
    // ══════════════════════════════════════════════════════════════════════
    describe('una cita que ya estaba cancelada', () => {
        it('🎯 el cambio va CONDICIONADO a que la cita no esté ya cancelada (comparar y cambiar)', async () => {
            await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');
            expect(argsDelCambio().where).toEqual({ id: 'apt-1', status: { not: 'CANCELLED' } });
        });

        it('🎯 si no cambió ninguna fila (ya estaba cancelada), NO libera el cupo: otra cita pudo haberlo tomado', async () => {
            mockUpdateMany.mockResolvedValue({ count: 0 });

            await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

            expect(mockSlotUpdate).not.toHaveBeenCalled();
        });

        it('sigue respondiendo success (idempotente) y refresca la página vieja para que muestre CANCELADA', async () => {
            mockUpdateMany.mockResolvedValue({ count: 0 });

            const res = await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

            expect(res).toEqual({ success: true });
            expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
        });

        it('🛡️ la constancia original no se pisa: el filtro deja fuera a las canceladas, así que no se escribe sobre ellas', async () => {
            mockUpdateMany.mockResolvedValue({ count: 0 });

            await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

            // Toda la escritura de esta acción pasa por ese único updateMany filtrado.
            expect(mockUpdate).not.toHaveBeenCalled();
            expect(argsDelCambio().where).toMatchObject({ status: { not: 'CANCELLED' } });
        });

        it('⚡ dos cancelaciones simultáneas (doble clic): el cupo se libera UNA sola vez', async () => {
            // Postgres reevalúa el filtro: la primera encuentra la cita sin cancelar, la segunda ya no.
            mockUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

            const [a, b] = await Promise.all([
                cancelAppointmentAndFreeSlot('apt-1', 'slot-1'),
                cancelAppointmentAndFreeSlot('apt-1', 'slot-1'),
            ]);

            expect(a).toEqual({ success: true });
            expect(b).toEqual({ success: true });
            expect(mockSlotUpdate).toHaveBeenCalledTimes(1);
        });
    });

    it('una cita que no es de la clínica → error, y no cancela ni libera nada', async () => {
        mockFindFirst.mockResolvedValue(null);

        const res = await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

        expect(res).toEqual({ success: false, error: 'Cita no encontrada en su organización.' });
        expect(mockTransaction).not.toHaveBeenCalled();
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('un cupo que no corresponde a la cita se rechaza (no se libera un cupo ajeno)', async () => {
        const res = await cancelAppointmentAndFreeSlot('apt-1', 'slot-AJENO');

        expect(res).toEqual({ success: false, error: 'El cupo indicado no corresponde a la cita.' });
        expect(mockSlotUpdate).not.toHaveBeenCalled();
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('si la base falla, error genérico sin filtrar detalles internos', async () => {
        mockTransaction.mockRejectedValueOnce(new Error('connection refused'));
        const espia = jest.spyOn(console, 'error').mockImplementation(() => {});

        const res = await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

        expect(res).toEqual({ success: false, error: 'Hubo un error crítico al cancelar y liberar el cupo.' });
        espia.mockRestore();
    });

    it('si liberar el cupo falla dentro de la transacción, la acción responde con el error genérico', async () => {
        mockSlotUpdate.mockRejectedValueOnce(new Error('slot bloqueado'));
        const espia = jest.spyOn(console, 'error').mockImplementation(() => {});

        const res = await cancelAppointmentAndFreeSlot('apt-1', 'slot-1');

        expect(res.success).toBe(false);
        espia.mockRestore();
    });
});
