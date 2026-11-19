/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        organizationSettings: { findUnique: jest.fn() },
        hospitalMirrorConfig: { findUnique: jest.fn() },
        bookingBlock: { findMany: jest.fn() },
        syncAudit: { findFirst: jest.fn() },
    },
}));

import { prisma } from '@/lib/prisma';
import { bloqueoDeLosSabados, cargarEstadoSabadoRural } from './estado';

const regla = (date: string, startMinute: number | null = null, endMinute: number | null = null) => ({
    date,
    repeatWeekly: true,
    startMinute,
    endMinute,
});

describe('estado de los sábados por el asistente', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('bloqueoDeLosSabados', () => {
        it('un sábado de todas las semanas, todo el día: completo (el de hoy en el hospital)', () => {
            expect(bloqueoDeLosSabados([regla('2026-10-24')])).toBe('COMPLETO');
            expect(bloqueoDeLosSabados([regla('2026-10-24', 0, 1440)])).toBe('COMPLETO');
        });

        it('unas horas del sábado: parcial', () => {
            expect(bloqueoDeLosSabados([regla('2026-10-24', 7 * 60, 10 * 60)])).toBe('PARCIAL');
        });

        it('otro día de la semana, o un sábado suelto: nada', () => {
            expect(bloqueoDeLosSabados([regla('2026-10-26')])).toBeNull();
            expect(bloqueoDeLosSabados([{ ...regla('2026-10-24'), repeatWeekly: false }])).toBeNull();
            expect(bloqueoDeLosSabados([])).toBeNull();
        });
    });

    it('con la regla, la lista recibida y el bloqueo del hospital', async () => {
        (prisma.organizationSettings.findUnique as jest.Mock).mockResolvedValue({ saturdayRuralSharePercent: 50 });
        (prisma.hospitalMirrorConfig.findUnique as jest.Mock).mockResolvedValue({
            ruralListCount: 27729,
            ruralListSyncedAt: new Date('2026-11-20T07:00:00Z'),
        });
        (prisma.bookingBlock.findMany as jest.Mock).mockResolvedValue([regla('2026-10-24')]);
        (prisma.syncAudit.findFirst as jest.Mock).mockResolvedValue(null);
        expect(await cargarEstadoSabadoRural('org-1')).toEqual({
            porcentaje: 50,
            conEspejo: true,
            lista: { total: 27729, recibidaEn: '2026-11-20T07:00:00.000Z' },
            bloqueoSabado: 'COMPLETO',
            ultimoCambio: null,
        });
    });

    it('sin la lista todavía, y sin espejo', async () => {
        (prisma.organizationSettings.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.hospitalMirrorConfig.findUnique as jest.Mock).mockResolvedValue({
            ruralListCount: null,
            ruralListSyncedAt: null,
        });
        (prisma.bookingBlock.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.syncAudit.findFirst as jest.Mock).mockResolvedValue(null);
        expect(await cargarEstadoSabadoRural('org-1')).toMatchObject({
            porcentaje: null,
            conEspejo: true,
            lista: null,
            bloqueoSabado: null,
        });
        (prisma.hospitalMirrorConfig.findUnique as jest.Mock).mockResolvedValue(null);
        expect((await cargarEstadoSabadoRural('org-1')).conEspejo).toBe(false);
    });
});
