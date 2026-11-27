import { leerMetadataDeLaEntrada, resumenDeLaEntrada } from './resumen';

describe('leerMetadataDeLaEntrada', () => {
    it.each([
        [null, { diasRechazados: 0, preguntaPendiente: false }],
        [[], { diasRechazados: 0, preguntaPendiente: false }],
        [{ diasRechazados: ['a', 'b', 'c'] }, { diasRechazados: 3, preguntaPendiente: false }],
        [{ diasRechazados: 'x', preguntaSigueDesde: '2026-11-26T13:00:00Z' }, { diasRechazados: 0, preguntaPendiente: true }],
    ])('%j → %j', (metadata, esperado) => {
        expect(leerMetadataDeLaEntrada(metadata)).toEqual(esperado);
    });
});

describe('resumenDeLaEntrada', () => {
    const ENTRADA = {
        organizationId: 'org-1',
        whatsappId: '573104155715',
        createdAt: new Date('2026-11-20T13:21:29Z'),
        metadata: { diasRechazados: ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30'] },
    };

    it('cuenta las ofertas y trae el último rechazo desde que se anotó, de esa clínica y ese número', async () => {
        const db = {
            interactionLog: {
                count: jest.fn(async () => 7),
                findFirst: jest.fn(async () => ({ userMessage: '  Ya no lo\n necesito muchas gracias ' })),
            },
        };
        await expect(resumenDeLaEntrada(db as never, ENTRADA)).resolves.toEqual({
            ofertas: 7,
            diasRechazados: 4,
            preguntaPendiente: false,
            ultimoRechazo: 'Ya no lo necesito muchas gracias',
        });
        const desde = { organizationId: 'org-1', whatsappId: '573104155715', createdAt: { gte: ENTRADA.createdAt } };
        expect(db.interactionLog.count).toHaveBeenCalledWith({ where: { ...desde, status: 'WAITLIST_NOTIFIED' } });
        expect(db.interactionLog.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    ...desde,
                    OR: [
                        { metadata: { path: ['event'], equals: 'WAITLIST_OFFER_REJECTED' } },
                        { metadata: { path: ['step'], equals: 'WAITLIST_TARDIA_NO' } },
                    ],
                },
                orderBy: { createdAt: 'desc' },
            }),
        );
    });

    it('un rechazo largo se recorta', async () => {
        const db = {
            interactionLog: {
                count: jest.fn(async () => 1),
                findFirst: jest.fn(async () => ({ userMessage: 'no '.repeat(100) })),
            },
        };
        const r = await resumenDeLaEntrada(db as never, ENTRADA);
        expect(r.ultimoRechazo?.length).toBe(120);
        expect(r.ultimoRechazo?.endsWith('…')).toBe(true);
    });

    it('si la bitácora falla, la fila sale sin esos datos (no rompe la lista)', async () => {
        const db = {
            interactionLog: {
                count: jest.fn(async () => {
                    throw new Error('bd');
                }),
                findFirst: jest.fn(async () => null),
            },
        };
        await expect(resumenDeLaEntrada(db as never, ENTRADA)).resolves.toEqual({
            ofertas: 0,
            diasRechazados: 4,
            preguntaPendiente: false,
            ultimoRechazo: null,
        });
    });
});
