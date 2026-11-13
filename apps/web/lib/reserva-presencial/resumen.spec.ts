/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        organizationSettings: { findUnique: jest.fn() },
        organization: { findUnique: jest.fn() },
        syncAudit: { findFirst: jest.fn() },
        $queryRaw: jest.fn(),
    },
}));

import { prisma } from '@/lib/prisma';
import { cargarResumenDeLaReserva, medicoDiasEnElTopeDelPanel, resumirPorDia } from './resumen';

const mockSettings = prisma.organizationSettings.findUnique as jest.Mock;
const mockOrg = prisma.organization.findUnique as jest.Mock;
const mockAudit = prisma.syncAudit.findFirst as jest.Mock;
const mockQuery = prisma.$queryRaw as jest.Mock;

const fila = (doctorId: string, dia: string, capacidad: number, chat: number, otras: number) => ({
    doctorId,
    dia,
    capacidad,
    chat,
    otras,
    libres: capacidad - chat - otras,
});

describe('resumen de la reserva para la atención presencial', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('resumirPorDia', () => {
        const filas = [
            fila('a', '2026-11-17', 20, 16, 2),
            fila('b', '2026-11-17', 7, 1, 4),
            fila('a', '2026-11-18', 10, 0, 10),
            fila('c', '2026-11-18', 0, 0, 0),
        ];

        it('con 80 %: suma por día, el tope es la suma de los topes de cada médico y cuenta los que ya llegaron', () => {
            expect(resumirPorDia(filas, 80)).toEqual([
                {
                    dia: '2026-11-17',
                    medicos: 2,
                    capacidad: 27,
                    tope: 16 + 5,
                    chat: 17,
                    otras: 6,
                    libres: 4,
                    medicosEnElTope: 1,
                },
                {
                    dia: '2026-11-18',
                    medicos: 1,
                    capacidad: 10,
                    tope: 8,
                    chat: 0,
                    otras: 10,
                    libres: 0,
                    medicosEnElTope: 0,
                },
            ]);
        });

        it('sin reserva: el tope es toda la capacidad y nadie está en el tope', () => {
            const [d] = resumirPorDia(filas, null);
            expect(d.tope).toBe(27);
            expect(d.medicosEnElTope).toBe(0);
        });

        it('un médico sin capacidad ese día no cuenta', () => {
            expect(resumirPorDia([fila('c', '2026-11-18', 0, 0, 0)], 80)).toEqual([]);
        });
    });

    it('cargarResumenDeLaReserva: el porcentaje guardado, hoy en la clínica, los días y el último cambio', async () => {
        mockSettings.mockResolvedValue({ botAgendaSharePercent: 80 });
        mockOrg.mockResolvedValue({ timezone: 'America/Bogota' });
        mockAudit.mockResolvedValue({ detail: 'cambió', createdAt: new Date('2026-11-13T15:00:00Z') });
        mockQuery.mockResolvedValue([fila('a', '2026-11-13', 20, 16, 2)]);
        // 13-nov, 11:00 p. m. en Bogotá (ya es 14 en UTC).
        const r = await cargarResumenDeLaReserva('org-1', new Date('2026-11-14T04:00:00Z'));
        expect(r.porcentaje).toBe(80);
        expect(r.hoy).toBe('2026-11-13');
        expect(r.dias).toHaveLength(1);
        expect(r.dias[0]).toMatchObject({ dia: '2026-11-13', tope: 16, chat: 16, medicosEnElTope: 1 });
        expect(r.ultimoCambio).toEqual({ detalle: 'cambió', en: '2026-11-13T15:00:00.000Z' });
    });

    it('cargarResumenDeLaReserva: sin fila de settings no hay reserva y los días se muestran igual', async () => {
        mockSettings.mockResolvedValue(null);
        mockOrg.mockResolvedValue(null);
        mockAudit.mockResolvedValue(null);
        mockQuery.mockResolvedValue([fila('a', '2026-11-13', 20, 16, 2)]);
        const r = await cargarResumenDeLaReserva('org-1', new Date('2026-11-13T15:00:00Z'));
        expect(r.porcentaje).toBeNull();
        expect(r.dias[0]).toMatchObject({ tope: 20, medicosEnElTope: 0 });
        expect(r.ultimoCambio).toBeNull();
    });

    describe('medicoDiasEnElTopeDelPanel (para el resumen del plazo)', () => {
        const desde = new Date('2026-11-13T15:00:00Z');
        const hasta = new Date('2026-11-17T15:00:00Z');

        it('sin reserva no consulta nada', async () => {
            const r = await medicoDiasEnElTopeDelPanel('org-1', null, desde, hasta, 'America/Bogota');
            expect(r.size).toBe(0);
            expect(mockQuery).not.toHaveBeenCalled();
        });

        it('con reserva devuelve las llaves médico|día que ya llegaron', async () => {
            mockQuery.mockResolvedValue([fila('a', '2026-11-17', 20, 16, 2), fila('b', '2026-11-17', 20, 3, 2)]);
            const r = await medicoDiasEnElTopeDelPanel('org-1', 80, desde, hasta, 'America/Bogota');
            expect([...r]).toEqual(['a|2026-11-17']);
        });
    });
});
