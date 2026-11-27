import { quitarDeLaListaDeEspera, MOTIVO_QUITADO_POR_PERSONAL } from './quitar';

/**
 * «Quitar de la lista» del panel (2026-11-26): antes el personal no podía sacar a
 * nadie de la lista de espera, ni al médico director que lo pedía por el chat.
 */
describe('quitarDeLaListaDeEspera', () => {
    const AHORA = new Date('2026-11-26T21:00:00Z');
    const entrada = (over: Record<string, unknown> = {}) => ({
        id: 'w1',
        organizationId: 'org-1',
        status: 'WAITING',
        metadata: { diasRechazados: ['2026-11-25', '2026-11-26'], preguntaSigueDesde: '2026-11-26T13:00:00Z' },
        patient: { cedula: '10272333' },
        service: { name: 'Medicina general' },
        ...over,
    });
    const crearDb = (fila: unknown, count = 1) => ({
        waitlistEntry: {
            findFirst: jest.fn(async () => fila),
            updateMany: jest.fn(async () => ({ count })),
        },
    });
    const quitar = (db: ReturnType<typeof crearDb>, nota?: string) =>
        quitarDeLaListaDeEspera(db as never, { organizationId: 'org-1', entryId: 'w1', quien: 'agenda@hospital.co', nota, ahora: AHORA });

    it('quien espera queda CANCELLED con el motivo, quién, cuándo y la nota; la pregunta pendiente se borra', async () => {
        const db = crearDb(entrada());
        await expect(quitar(db, '  Ya lo atendieron por urgencias  ')).resolves.toEqual({
            ok: true,
            servicio: 'Medicina general',
            cedula: '10272333',
        });
        expect(db.waitlistEntry.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'w1', organizationId: 'org-1' } }),
        );
        expect(db.waitlistEntry.updateMany).toHaveBeenCalledWith({
            where: { id: 'w1', organizationId: 'org-1', status: 'WAITING' },
            data: {
                status: 'CANCELLED',
                metadata: {
                    diasRechazados: ['2026-11-25', '2026-11-26'],
                    motivo: MOTIVO_QUITADO_POR_PERSONAL,
                    quitadoPor: 'agenda@hospital.co',
                    salioEn: '2026-11-26T21:00:00.000Z',
                    nota: 'Ya lo atendieron por urgencias',
                },
            },
        });
    });

    it('sin nota no guarda el campo', async () => {
        const db = crearDb(entrada({ metadata: null }));
        await quitar(db, '   ');
        const data = (db.waitlistEntry.updateMany.mock.calls[0] as unknown as [{ data: { metadata: object } }])[0].data;
        expect(data.metadata).not.toHaveProperty('nota');
    });

    it('de otra clínica (o que no existe): no toca nada', async () => {
        const db = crearDb(null);
        await expect(quitar(db)).resolves.toEqual({ ok: false, error: expect.stringContaining('ya no está') });
        expect(db.waitlistEntry.updateMany).not.toHaveBeenCalled();
    });

    it('con una oferta por contestar no se quita (el asistente tiene el cupo apartado)', async () => {
        const db = crearDb(entrada({ status: 'NOTIFIED' }));
        await expect(quitar(db)).resolves.toEqual({ ok: false, error: expect.stringContaining('oferta de cupo por contestar') });
        expect(db.waitlistEntry.updateMany).not.toHaveBeenCalled();
    });

    it('si ya salió de la lista no se toca', async () => {
        const db = crearDb(entrada({ status: 'CONFIRMED' }));
        await expect(quitar(db)).resolves.toMatchObject({ ok: false });
        expect(db.waitlistEntry.updateMany).not.toHaveBeenCalled();
    });

    it('si en medio le llegó una oferta (la actualización no encuentra la fila esperando), lo dice', async () => {
        const db = crearDb(entrada(), 0);
        await expect(quitar(db)).resolves.toEqual({ ok: false, error: expect.stringContaining('Actualice la lista') });
    });
});
