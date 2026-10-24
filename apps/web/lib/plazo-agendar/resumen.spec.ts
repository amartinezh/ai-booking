/**
 * @jest-environment node
 */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        organizationSettings: { findUnique: jest.fn() },
        organization: { findUnique: jest.fn() },
        hospitalMirrorConfig: { findUnique: jest.fn() },
        bookingBlock: { findMany: jest.fn() },
        syncAudit: { findFirst: jest.fn() },
        mirrorEntityMap: { findMany: jest.fn() },
        scheduleSlot: { findMany: jest.fn() },
    },
}));

import { prisma } from '@/lib/prisma';
import { cargarResumenDelPlazo } from './resumen';

const m = prisma as unknown as Record<string, Record<string, jest.Mock>>;
// Viernes 23 de octubre, 3:27 p. m. en Bogotá.
const AHORA = new Date('2026-10-23T20:27:00Z');
const bogota = (iso: string) => new Date(`${iso}-05:00`);

const preparar = (p: { dias: number | null; espejo: boolean }) => {
    m.organizationSettings.findUnique.mockResolvedValue({ bookingMaxDaysAhead: p.dias });
    m.organization.findUnique.mockResolvedValue({ timezone: 'America/Bogota' });
    m.hospitalMirrorConfig.findUnique.mockResolvedValue({ enabled: p.espejo });
    m.bookingBlock.findMany.mockResolvedValue([
        { date: '2026-10-24', repeatWeekly: true, startMinute: null, endMinute: null },
    ]);
    m.syncAudit.findFirst.mockResolvedValue({
        detail: '«Plazo máximo para agendar» cambió de «Sin límite» a «2 días (hoy y mañana)» desde Configuración por admin@hsvp.gov.co.',
        createdAt: new Date('2026-10-23T20:27:50Z'),
    });
    m.mirrorEntityMap.findMany.mockResolvedValue([{ agenIAId: 'doc-1' }, { agenIAId: 'doc-2' }]);
    m.scheduleSlot.findMany.mockResolvedValue([
        { startTime: bogota('2026-10-24T08:00:00') }, // sábado: bloqueado
        { startTime: bogota('2026-10-26T08:20:00') },
        { startTime: bogota('2026-10-26T12:00:00') },
    ]);
};

describe('cargarResumenDelPlazo — los cupos que el asistente puede ofrecer hoy', () => {
    beforeEach(() => jest.clearAllMocks());

    it('cuenta como el asistente: libres, servicio activo, médico «WhatsApp ON» y, con espejo, homologado', async () => {
        preparar({ dias: 2, espejo: true });
        await cargarResumenDelPlazo('org-1', AHORA);
        expect(m.scheduleSlot.findMany.mock.calls[0][0].where).toMatchObject({
            organizationId: 'org-1',
            isAvailable: true,
            service: { isActive: true },
            doctor: { whatsappBookingEnabled: true, id: { in: ['doc-1', 'doc-2'] } },
        });
    });

    it('sin espejo no exige homologación', async () => {
        preparar({ dias: 2, espejo: false });
        await cargarResumenDelPlazo('org-1', AHORA);
        expect(m.mirrorEntityMap.findMany).not.toHaveBeenCalled();
        expect(m.scheduleSlot.findMany.mock.calls[0][0].where.doctor).toEqual({ whatsappBookingEnabled: true });
    });

    it('con 2 días un viernes: ninguno hoy, desde el domingo, y el último cambio', async () => {
        preparar({ dias: 2, espejo: true });
        expect(await cargarResumenDelPlazo('org-1', AHORA)).toEqual({
            enElPlazo: 0,
            total: 2,
            primerDia: '2026-10-26',
            ultimoDia: '2026-10-24',
            desde: '2026-10-25',
            plazoMinimo: 4,
            hoy: '2026-10-23',
            dias: 2,
            ultimoCambio: {
                detalle: expect.stringContaining('por admin@hsvp.gov.co'),
                en: '2026-10-23T20:27:50.000Z',
            },
        });
    });

    it('sin cambios registrados, `ultimoCambio` es null', async () => {
        preparar({ dias: null, espejo: true });
        m.syncAudit.findFirst.mockResolvedValue(null);
        const r = await cargarResumenDelPlazo('org-1', AHORA);
        expect(r.ultimoCambio).toBeNull();
        expect(r.enElPlazo).toBe(2);
    });
});
