jest.mock('../../lib/prisma', () => ({
    prisma: {
        organization: { findUnique: jest.fn() },
        bookingBlock: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
        systemLog: { create: jest.fn() },
    },
}));
jest.mock('../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '../../lib/prisma';
import { getSession } from '../../lib/session';
import { crearBloqueoAgenda, obtenerBloqueosAgenda, quitarBloqueoAgenda } from './bloqueos-agenda';

const mockSession = getSession as jest.Mock;
const bb = prisma.bookingBlock as unknown as Record<'findMany' | 'create' | 'findFirst' | 'delete', jest.Mock>;
const logCreate = prisma.systemLog.create as jest.Mock;

const ADMIN = { userId: 'u-admin', email: 'admin@clinica.co', role: 'ORG_ADMIN', organizationId: 'org-1' };
const SABADOS = { date: '2026-10-24', repeatWeekly: true, startMinute: null, endMinute: null };

describe('Días sin citas — acciones del servidor', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Jueves 22 de octubre de 2026, 10:00 en Bogotá.
        jest.useFakeTimers().setSystemTime(new Date('2026-10-22T15:00:00Z'));
        mockSession.mockResolvedValue(ADMIN);
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({ timezone: 'America/Bogota' });
        bb.findMany.mockResolvedValue([]);
        bb.create.mockResolvedValue({ id: 'b-1' });
        logCreate.mockResolvedValue({});
    });
    afterEach(() => jest.useRealTimers());

    it.each(['BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER', 'SUPER_ADMIN'])(
        '%s no puede ver, crear ni quitar',
        async (role) => {
            mockSession.mockResolvedValue({ ...ADMIN, role });
            expect(await obtenerBloqueosAgenda()).toEqual({ success: false, error: 'Acceso denegado' });
            expect(await crearBloqueoAgenda({ ...SABADOS })).toEqual({ success: false, error: 'Acceso denegado' });
            expect(await quitarBloqueoAgenda('b-1')).toEqual({ success: false, error: 'Acceso denegado' });
            expect(bb.create).not.toHaveBeenCalled();
            expect(bb.delete).not.toHaveBeenCalled();
        },
    );

    it('la lista trae «hoy» en la zona de la clínica y deja fuera los días que ya pasaron', async () => {
        bb.findMany.mockResolvedValue([
            { id: 'a', ...SABADOS, note: null, createdByEmail: null },
            { id: 'b', date: '2026-10-20', repeatWeekly: false, startMinute: null, endMinute: null, note: null, createdByEmail: null },
            { id: 'c', date: '2026-10-23', repeatWeekly: false, startMinute: 480, endMinute: 600, note: null, createdByEmail: null },
        ]);
        const r = await obtenerBloqueosAgenda();
        expect(r.success && r.hoy).toBe('2026-10-22');
        expect(r.success && r.bloqueos.map((b) => b.id)).toEqual(['a', 'c']);
        expect(bb.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1' });
    });

    it('crea «todos los sábados» en SU clínica, con quién lo creó, y deja constancia', async () => {
        const r = await crearBloqueoAgenda({ ...SABADOS, note: ' Sábados ' });
        expect(r.success).toBe(true);
        expect(bb.create.mock.calls[0][0].data).toEqual({
            organizationId: 'org-1',
            date: '2026-10-24',
            repeatWeekly: true,
            startMinute: null,
            endMinute: null,
            note: 'Sábados',
            createdById: 'u-admin',
            createdByEmail: 'admin@clinica.co',
        });
        expect(logCreate.mock.calls[0][0].data).toMatchObject({
            action: 'BOOKING_BLOCK_CREATED',
            organizationId: 'org-1',
            userId: 'u-admin',
        });
    });

    it('lo que llega se valida en el servidor: un día pasado o unas horas al revés no se guardan', async () => {
        expect(await crearBloqueoAgenda({ ...SABADOS, date: '2026-10-21' })).toMatchObject({
            success: false,
            error: expect.stringContaining('ya pasó'),
        });
        expect(
            await crearBloqueoAgenda({ date: '2026-10-23', repeatWeekly: false, startMinute: 600, endMinute: 480 }),
        ).toMatchObject({ success: false, error: expect.stringContaining('después de la hora inicial') });
        expect(bb.create).not.toHaveBeenCalled();
    });

    it('el mismo bloqueo dos veces no se duplica', async () => {
        bb.findMany.mockResolvedValueOnce([{ ...SABADOS }]);
        expect(await crearBloqueoAgenda({ ...SABADOS })).toEqual({ success: false, error: 'Ese bloqueo ya existe.' });
        expect(bb.create).not.toHaveBeenCalled();
    });

    it('quitar busca el bloqueo SOLO en la clínica de quien quita', async () => {
        bb.findFirst.mockResolvedValue(null); // es de otra clínica
        expect(await quitarBloqueoAgenda('b-otra')).toEqual({ success: false, error: 'Bloqueo no encontrado.' });
        expect(bb.findFirst.mock.calls[0][0].where).toEqual({ id: 'b-otra', organizationId: 'org-1' });
        expect(bb.delete).not.toHaveBeenCalled();
    });

    it('quitar uno propio lo borra y deja constancia', async () => {
        bb.findFirst.mockResolvedValue({ id: 'b-1', ...SABADOS, note: null });
        const r = await quitarBloqueoAgenda('b-1');
        expect(r.success).toBe(true);
        expect(bb.delete).toHaveBeenCalledWith({ where: { id: 'b-1' } });
        expect(logCreate.mock.calls[0][0].data).toMatchObject({ action: 'BOOKING_BLOCK_DELETED' });
    });
});
