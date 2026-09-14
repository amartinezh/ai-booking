jest.mock('@/lib/prisma', () => ({
    prisma: {
        syncAudit: { count: jest.fn(), findMany: jest.fn() },
        syncOutbox: { count: jest.fn(), findMany: jest.fn() },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import {
    listSyncAudit,
    listSyncOutbox,
    getSyncAuditFacets,
    getSyncOutboxFacets,
} from './sync-audit';

const mockGetSession = getSession as jest.Mock;
const mockAuditCount = prisma.syncAudit.count as jest.Mock;
const mockAuditFindMany = prisma.syncAudit.findMany as jest.Mock;
const mockOutboxCount = prisma.syncOutbox.count as jest.Mock;
const mockOutboxFindMany = prisma.syncOutbox.findMany as jest.Mock;

const ORG_ADMIN_SESSION = { role: 'ORG_ADMIN', organizationId: 'org-1' };

beforeEach(() => {
    jest.clearAllMocks();
    mockAuditCount.mockResolvedValue(0);
    mockAuditFindMany.mockResolvedValue([]);
    mockOutboxCount.mockResolvedValue(0);
    mockOutboxFindMany.mockResolvedValue([]);
});

describe('sync-audit actions — aislamiento por tenant', () => {
    it('listSyncAudit rechaza sin sesión de ORG_ADMIN', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await listSyncAudit({});
        expect(res).toEqual({ success: false, error: 'Sin permisos.' });
        expect(mockAuditFindMany).not.toHaveBeenCalled();
    });

    it('listSyncAudit rechaza otros roles (BOOKING_AGENT)', async () => {
        mockGetSession.mockResolvedValue({ role: 'BOOKING_AGENT', organizationId: 'org-1' });
        const res = await listSyncAudit({});
        expect(res.success).toBe(false);
    });

    it('listSyncOutbox rechaza sin sesión', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await listSyncOutbox({});
        expect(res).toEqual({ success: false, error: 'Sin permisos.' });
        expect(mockOutboxFindMany).not.toHaveBeenCalled();
    });

    it('listSyncAudit siempre filtra por el organizationId de la sesión, nunca uno externo', async () => {
        mockGetSession.mockResolvedValue(ORG_ADMIN_SESSION);
        await listSyncAudit({});
        expect(mockAuditFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }) }),
        );
        expect(mockAuditCount).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }) }),
        );
    });
});

describe('listSyncAudit — filtros', () => {
    beforeEach(() => mockGetSession.mockResolvedValue(ORG_ADMIN_SESSION));

    it('aplica direction/entityType/outcome/op como igualdad exacta', async () => {
        await listSyncAudit({ direction: 'INBOUND', entityType: 'APPOINTMENT', outcome: 'CONFLICT', op: 'INSERT' });
        const { where } = mockAuditFindMany.mock.calls[0][0];
        expect(where).toMatchObject({
            organizationId: 'org-1',
            direction: 'INBOUND',
            entityType: 'APPOINTMENT',
            outcome: 'CONFLICT',
            op: 'INSERT',
        });
    });

    it('busca por entityId, eventId y detail con OR insensible a mayúsculas', async () => {
        await listSyncAudit({ search: '  Cita-123  ' });
        const { where } = mockAuditFindMany.mock.calls[0][0];
        expect(where.OR).toEqual([
            { entityId: { contains: 'Cita-123', mode: 'insensitive' } },
            { eventId: { contains: 'Cita-123', mode: 'insensitive' } },
            { detail: { contains: 'Cita-123', mode: 'insensitive' } },
        ]);
    });

    it('no agrega OR si la búsqueda está vacía', async () => {
        await listSyncAudit({ search: '   ' });
        const { where } = mockAuditFindMany.mock.calls[0][0];
        expect(where.OR).toBeUndefined();
    });

    it('convierte el rango de fechas a límites de día en America/Bogota (offset fijo -05:00)', async () => {
        await listSyncAudit({ from: '2026-09-01', to: '2026-09-03' });
        const { where } = mockAuditFindMany.mock.calls[0][0];
        expect(where.createdAt.gte.toISOString()).toBe('2026-09-01T05:00:00.000Z');
        expect(where.createdAt.lte.toISOString()).toBe('2026-09-04T04:59:59.999Z');
    });

    it('ordena por createdAt descendente (lo más reciente primero)', async () => {
        await listSyncAudit({});
        expect(mockAuditFindMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
    });

    it('pagina con defaults sensatos y respeta el tope de 100', async () => {
        await listSyncAudit({});
        expect(mockAuditFindMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 25 });

        await listSyncAudit({ page: 3, pageSize: 500 });
        expect(mockAuditFindMany.mock.calls[1][0]).toMatchObject({ skip: 200, take: 100 });

        await listSyncAudit({ page: 0, pageSize: 1 });
        expect(mockAuditFindMany.mock.calls[2][0]).toMatchObject({ skip: 0, take: 5 });
    });

    it('serializa fechas a ISO string y calcula totalPages', async () => {
        mockAuditCount.mockResolvedValue(51);
        mockAuditFindMany.mockResolvedValue([
            {
                id: 'a1',
                direction: 'INBOUND',
                entityType: 'APPOINTMENT',
                entityId: 'apt-1',
                op: 'INSERT',
                outcome: 'OK',
                detail: null,
                eventId: 'evt-1',
                createdAt: new Date('2026-09-01T12:00:00Z'),
            },
        ]);
        const res = await listSyncAudit({ pageSize: 25 });
        expect(res.success).toBe(true);
        if (!res.success) throw new Error('expected success');
        expect(res.data.total).toBe(51);
        expect(res.data.totalPages).toBe(3);
        expect(res.data.rows[0].createdAt).toBe('2026-09-01T12:00:00.000Z');
    });
});

describe('listSyncOutbox — estado derivado de deliveredAt/deadLettered', () => {
    beforeEach(() => mockGetSession.mockResolvedValue(ORG_ADMIN_SESSION));

    it('estado=PENDIENTE filtra deliveredAt null y deadLettered false', async () => {
        await listSyncOutbox({ estado: 'PENDIENTE' });
        const { where } = mockOutboxFindMany.mock.calls[0][0];
        expect(where).toMatchObject({ deliveredAt: null, deadLettered: false });
    });

    it('estado=ENTREGADO filtra deliveredAt not null', async () => {
        await listSyncOutbox({ estado: 'ENTREGADO' });
        const { where } = mockOutboxFindMany.mock.calls[0][0];
        expect(where.deliveredAt).toEqual({ not: null });
    });

    it('estado=DEAD_LETTER filtra deadLettered true', async () => {
        await listSyncOutbox({ estado: 'DEAD_LETTER' });
        const { where } = mockOutboxFindMany.mock.calls[0][0];
        expect(where.deadLettered).toBe(true);
    });

    it('sin estado no restringe por deliveredAt/deadLettered', async () => {
        await listSyncOutbox({});
        const { where } = mockOutboxFindMany.mock.calls[0][0];
        expect(where.deliveredAt).toBeUndefined();
        expect(where.deadLettered).toBeUndefined();
    });

    it('ordena por seq descendente y serializa BigInt a string', async () => {
        mockOutboxFindMany.mockResolvedValue([
            {
                seq: BigInt('9007199254740993'),
                eventId: 'evt-1',
                entityType: 'APPOINTMENT',
                entityId: 'apt-1',
                op: 'INSERT',
                payload: { foo: 'bar' },
                origin: 'LOCAL',
                createdAt: new Date('2026-09-01T00:00:00Z'),
                deliveredAt: null,
                attempts: 0,
                deadLettered: false,
                nextAttemptAt: null,
            },
        ]);
        const res = await listSyncOutbox({});
        expect(mockOutboxFindMany.mock.calls[0][0].orderBy).toEqual({ seq: 'desc' });
        expect(res.success).toBe(true);
        if (!res.success) throw new Error('expected success');
        expect(res.data.rows[0].seq).toBe('9007199254740993');
        expect(res.data.rows[0].estado).toBe('PENDIENTE');
    });

    it('busca solo por entityId/eventId (no abre el payload a búsqueda de texto)', async () => {
        await listSyncOutbox({ search: 'abc' });
        const { where } = mockOutboxFindMany.mock.calls[0][0];
        expect(where.OR).toEqual([
            { entityId: { contains: 'abc', mode: 'insensitive' } },
            { eventId: { contains: 'abc', mode: 'insensitive' } },
        ]);
    });
});

describe('facets — valores distintos por organización, no listas fijas', () => {
    it('getSyncAuditFacets rechaza sin permisos', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await getSyncAuditFacets();
        expect(res).toEqual({ success: false, error: 'Sin permisos.' });
    });

    it('getSyncAuditFacets consulta distinct scoped al tenant y aplana el resultado', async () => {
        mockGetSession.mockResolvedValue(ORG_ADMIN_SESSION);
        mockAuditFindMany
            .mockResolvedValueOnce([{ direction: 'INBOUND' }, { direction: 'RECONCILE' }])
            .mockResolvedValueOnce([{ entityType: 'APPOINTMENT' }])
            .mockResolvedValueOnce([{ outcome: 'OK' }, { outcome: 'CONFLICT' }])
            .mockResolvedValueOnce([{ op: 'INSERT' }]);

        const res = await getSyncAuditFacets();
        expect(res).toEqual({
            success: true,
            data: {
                directions: ['INBOUND', 'RECONCILE'],
                entityTypes: ['APPOINTMENT'],
                outcomes: ['OK', 'CONFLICT'],
                ops: ['INSERT'],
            },
        });
        for (const call of mockAuditFindMany.mock.calls) {
            expect(call[0].where).toEqual({ organizationId: 'org-1' });
        }
    });

    it('getSyncOutboxFacets rechaza sin permisos', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await getSyncOutboxFacets();
        expect(res).toEqual({ success: false, error: 'Sin permisos.' });
    });
});
