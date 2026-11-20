jest.mock('@/lib/prisma', () => ({
    prisma: {
        organizationSettings: { findUnique: jest.fn() },
        dataConsent: { findMany: jest.fn() },
    },
}));

import { prisma } from '@/lib/prisma';
import { cargarAutorizaciones, periodoAutorizacion } from './cifras';

const mockSettings = prisma.organizationSettings.findUnique as jest.Mock;
const mockFilas = prisma.dataConsent.findMany as jest.Mock;

describe('cifras de la autorización de datos', () => {
    beforeEach(() => jest.clearAllMocks());

    it('periodoAutorizacion: 7, 30 o 90 días; lo demás, 30', () => {
        expect(periodoAutorizacion('7')).toBe(7);
        expect(periodoAutorizacion(['90'])).toBe(90);
        expect(periodoAutorizacion('15')).toBe(30);
        expect(periodoAutorizacion(undefined)).toBe(30);
    });

    it('lee el período en la zona de la clínica y cuenta por persona', async () => {
        mockSettings.mockResolvedValue({
            dataConsentEnabled: true,
            dataPolicyVersion: '2',
            organization: { timezone: 'America/Bogota' },
        });
        const ahora = new Date('2026-11-20T20:00:00Z');
        mockFilas.mockResolvedValue([
            { status: 'ACCEPTED', senderKey: 'a', channel: 'WHATSAPP', askedAt: new Date('2026-11-20T15:00:00Z'), answeredAt: new Date('2026-11-20T15:01:00Z') },
            { status: 'REJECTED', senderKey: 'b', channel: 'TELEGRAM', askedAt: new Date('2026-11-19T15:00:00Z'), answeredAt: new Date('2026-11-19T15:01:00Z') },
        ]);
        const r = await cargarAutorizaciones('org-1', 7, ahora);
        expect(r).toMatchObject({ encendida: true, version: '2', dias: 7, desde: '2026-11-14' });
        expect(r.cifras).toMatchObject({ preguntadas: 2, aceptaron: 1, noAceptaron: 1, porcentajeAceptacion: 50 });
        const { where } = mockFilas.mock.calls[0][0];
        // Medianoche del 14 en Bogotá = 5:00 UTC.
        expect(where.OR[0].askedAt.gte.toISOString()).toBe('2026-11-14T05:00:00.000Z');
        expect(where.organizationId).toBe('org-1');
    });

    it('sin ajustes: apagada, versión 1', async () => {
        mockSettings.mockResolvedValue(null);
        mockFilas.mockResolvedValue([]);
        const r = await cargarAutorizaciones('org-1', 30);
        expect(r).toMatchObject({ encendida: false, version: '1', dias: 30 });
        expect(r.cifras.preguntadas).toBe(0);
    });
});
