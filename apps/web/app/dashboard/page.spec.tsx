/**
 * La Visión General (/dashboard) es la página a la que llega el personal al
 * ingresar. Traía todas las citas de la clínica con sus relaciones completas
 * (2026-10-22: 12,5 MB). Estas pruebas cuidan la consulta: desde hoy, solo los
 * campos de la pantalla y con tope.
 */
import type { ReactElement, ReactNode } from 'react';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        appointment: { findMany: jest.fn() },
        agentProfile: { findUnique: jest.fn() },
        patientProfile: { findUnique: jest.fn() },
        doctorProfile: { findUnique: jest.fn(), findMany: jest.fn() },
        eps: { findMany: jest.fn() },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('@/lib/mirror-flags', () => ({
    getTenantMirrorFlags: jest.fn(async () => ({ conEspejo: true, conAvisos: false, conAvisosDriver: false })),
}));
jest.mock('@/lib/bandeja/pendientes', () => ({ pendientesParaMenu: jest.fn(async () => 0) }));
jest.mock('@/lib/limite-citas/acceso', () => ({ solicitudesCitasPendientes: jest.fn(async () => 0) }));
jest.mock('next/navigation', () => ({
    redirect: jest.fn(() => {
        throw new Error('NEXT_REDIRECT');
    }),
}));
jest.mock('./components/DashboardClient', () => jest.fn(() => null));
jest.mock('./components/PageSkeleton', () => () => null);
jest.mock('./components/QuickAccessGrid', () => () => null);

import DashboardPage from './page';
import DashboardClient from './components/DashboardClient';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { SELECT_CITA_INICIO, TOPE_CITAS_INICIO } from '@/lib/dashboard/citas-inicio';

const findMany = prisma.appointment.findMany as jest.Mock;
const mockSession = getSession as jest.Mock;

/** Las props con que la página pinta la tabla. */
function propsDeLaTabla(nodo: ReactNode): Record<string, unknown> {
    const buscar = (n: ReactNode): Record<string, unknown> | null => {
        if (!n || typeof n !== 'object') return null;
        if (Array.isArray(n)) {
            for (const h of n) {
                const r = buscar(h);
                if (r) return r;
            }
            return null;
        }
        const el = n as ReactElement<{ children?: ReactNode }>;
        if (el.type === DashboardClient) return el.props as Record<string, unknown>;
        return buscar(el.props?.children);
    };
    const r = buscar(nodo);
    if (!r) throw new Error('La página no pinta DashboardClient');
    return r;
}

const abrir = (params: Record<string, string> = {}) =>
    DashboardPage({ searchParams: Promise.resolve(params) } as never);

describe('Visión General — la consulta de citas', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers().setSystemTime(new Date('2026-10-22T11:30:00.000Z')); // 06:30 en Bogotá
        mockSession.mockResolvedValue({
            userId: 'u-agendadora',
            email: 'agendadora.prueba@ejemplo.com',
            role: 'BOOKING_AGENT',
            organizationId: 'org-1',
        });
        (prisma.agentProfile.findUnique as jest.Mock).mockResolvedValue({ epsId: null, doctorId: null });
        (prisma.eps.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.doctorProfile.findMany as jest.Mock).mockResolvedValue([]);
        findMany.mockResolvedValue([]);
    });
    afterEach(() => jest.useRealTimers());

    it('sin filtros: desde hoy, solo los campos de la pantalla, con tope', async () => {
        const pagina = await abrir();
        const args = findMany.mock.calls[0][0];

        expect(args.select).toBe(SELECT_CITA_INICIO);
        expect(args).not.toHaveProperty('include');
        expect(args.take).toBe(TOPE_CITAS_INICIO + 1);
        expect(args.where.organizationId).toBe('org-1');
        expect(args.where.scheduleSlot.startTime.gte.toISOString()).toBe('2026-10-22T05:00:00.000Z');
        expect(args.where.scheduleSlot.startTime).not.toHaveProperty('lte');
        expect(propsDeLaTabla(pagina)).toMatchObject({ desdeHoy: true, hayMas: false, tope: TOPE_CITAS_INICIO });
    });

    it('con fecha inicial: mira atrás desde ese día', async () => {
        const pagina = await abrir({ startDate: '2026-10-01', endDate: '2026-10-05' });
        const { startTime } = findMany.mock.calls[0][0].where.scheduleSlot;

        expect(startTime.gte.toISOString()).toBe('2026-10-01T05:00:00.000Z');
        expect(startTime.lte.toISOString()).toBe('2026-10-06T04:59:59.999Z');
        expect(propsDeLaTabla(pagina)).toMatchObject({ desdeHoy: false });
    });

    it('si hay más citas que el tope, pinta solo el tope y avisa', async () => {
        findMany.mockResolvedValue(Array.from({ length: TOPE_CITAS_INICIO + 1 }, (_, i) => ({ id: `c${i}` })));
        const props = propsDeLaTabla(await abrir());

        expect(props.hayMas).toBe(true);
        expect((props.appointments as unknown[]).length).toBe(TOPE_CITAS_INICIO);
    });

    it('el agendador acotado a un médico sigue viendo solo ese médico', async () => {
        (prisma.agentProfile.findUnique as jest.Mock).mockResolvedValue({ epsId: null, doctorId: 'doc-7' });
        await abrir();
        const { scheduleSlot } = findMany.mock.calls[0][0].where;

        expect(scheduleSlot.doctorId).toBe('doc-7');
        expect(scheduleSlot.startTime.gte.toISOString()).toBe('2026-10-22T05:00:00.000Z');
    });

    it('una fecha que no se entiende no rompe la página', async () => {
        await expect(abrir({ startDate: 'xx', endDate: '2026-99-99' })).resolves.toBeTruthy();
        expect(findMany.mock.calls[0][0].where.scheduleSlot.startTime.gte.toISOString()).toBe(
            '2026-10-22T05:00:00.000Z',
        );
    });
});
