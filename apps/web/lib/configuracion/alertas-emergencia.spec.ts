import { cargarAlertasEmergencia, guardarListaEmergencia, validarListaEmergencia } from './alertas-emergencia';

const ORG = 'org-1';

describe('validarListaEmergencia', () => {
    it('normaliza el celular con el 57 y limpia el nombre', () => {
        expect(validarListaEmergencia([{ label: ' Jefe  de Urgencias ', telefono: '314 679 3010', isActive: true }])).toEqual({
            ok: true,
            filas: [{ id: null, label: 'Jefe de Urgencias', phone: '573146793010', isActive: true }],
        });
    });

    it('un fijo no entra: no recibe WhatsApp', () => {
        const v = validarListaEmergencia([{ label: 'Conmutador', telefono: '606 853 8860', isActive: true }]);
        expect(v).toEqual({ ok: false, error: expect.stringMatching(/^Conmutador: .*fijo no recibe WhatsApp/) });
    });

    it('el mismo celular dos veces, no', () => {
        const v = validarListaEmergencia([
            { label: 'Ana', telefono: '3001112233', isActive: true },
            { label: 'Luis', telefono: '+57 300 111 2233', isActive: true },
        ]);
        expect(v).toEqual({ ok: false, error: 'El celular +57 300 111 2233 está dos veces.' });
    });

    it('como mucho 5 activas; en pausa no cuentan', () => {
        const persona = (i: number, isActive = true) => ({ label: `P${i}`, telefono: `30011122${10 + i}`, isActive });
        expect(validarListaEmergencia([1, 2, 3, 4, 5, 6].map((i) => persona(i))).ok).toBe(false);
        expect(validarListaEmergencia([1, 2, 3, 4, 5].map((i) => persona(i)).concat(persona(6, false))).ok).toBe(true);
    });

    it('sin nombre, no', () => {
        expect(validarListaEmergencia([{ label: '', telefono: '3001112233', isActive: true }]).ok).toBe(false);
    });

    it('lo que no es una lista, no', () => {
        expect(validarListaEmergencia('hola')).toEqual({ ok: false, error: 'Falta la lista.' });
    });
});

function base(antes: { id: string; label: string; phone: string; isActive: boolean }[]) {
    const tx = {
        emergencyAlertRecipient: {
            findMany: jest.fn(async () => antes),
            deleteMany: jest.fn(async () => ({ count: 1 })),
            create: jest.fn(async () => ({})),
            updateMany: jest.fn(async () => ({ count: 1 })),
        },
    };
    const db = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { db: db as any, tx };
}

describe('guardarListaEmergencia', () => {
    it('crea las nuevas, cambia las que siguen y borra las que se quitaron, todo dentro de la clínica', async () => {
        const { db, tx } = base([
            { id: 'a', label: 'Ana', phone: '573001112233', isActive: true },
            { id: 'b', label: 'Luis', phone: '573004445566', isActive: true },
        ]);
        const r = await guardarListaEmergencia(
            db,
            ORG,
            [
                { id: 'a', label: 'Ana', phone: '573001112233', isActive: false },
                { id: null, label: 'Urgencias', phone: '573146793010', isActive: true },
            ],
            'u-1',
        );
        expect(tx.emergencyAlertRecipient.deleteMany).toHaveBeenCalledWith({ where: { organizationId: ORG, id: { in: ['b'] } } });
        expect(tx.emergencyAlertRecipient.updateMany).toHaveBeenCalledWith({
            where: { id: 'a', organizationId: ORG },
            data: { label: 'Ana', phone: '573001112233', isActive: false },
        });
        expect(tx.emergencyAlertRecipient.create).toHaveBeenCalledWith({
            data: { organizationId: ORG, label: 'Urgencias', phone: '573146793010', isActive: true, createdByUserId: 'u-1' },
        });
        expect(r).toEqual({
            activas: 1,
            cambios: ['quitó a Luis (···5566)', 'pausó a Ana (···2233)', 'agregó a Urgencias (···3010)'],
        });
        // 🔒 Nunca el celular entero en lo que va a la Actividad.
        expect(r.cambios.join(' ')).not.toMatch(/3001112233|3146793010/);
    });

    it('un id de otra clínica no existe aquí: se crea como nueva, nunca se toca la ajena', async () => {
        const { db, tx } = base([]);
        await guardarListaEmergencia(db, ORG, [{ id: 'de-otra', label: 'X', phone: '573001112233', isActive: true }], null);
        expect(tx.emergencyAlertRecipient.updateMany).not.toHaveBeenCalled();
        expect(tx.emergencyAlertRecipient.create).toHaveBeenCalled();
    });

    it('otro celular para la misma persona: se borra la salud del anterior', async () => {
        const { db, tx } = base([{ id: 'a', label: 'Ana', phone: '573001112233', isActive: true }]);
        await guardarListaEmergencia(db, ORG, [{ id: 'a', label: 'Ana', phone: '573009998877', isActive: true }], null);
        expect(tx.emergencyAlertRecipient.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ phone: '573009998877', lastWamid: null, lastError: null }) }),
        );
    });

    it('sin cambios no escribe nada', async () => {
        const { db, tx } = base([{ id: 'a', label: 'Ana', phone: '573001112233', isActive: true }]);
        const r = await guardarListaEmergencia(db, ORG, [{ id: 'a', label: 'Ana', phone: '573001112233', isActive: true }], null);
        expect(r.cambios).toEqual([]);
        expect(tx.emergencyAlertRecipient.updateMany).not.toHaveBeenCalled();
    });
});

describe('cargarAlertasEmergencia', () => {
    it('cada persona con su último envío según Meta, y la plantilla registrada', async () => {
        const db = {
            emergencyAlertRecipient: {
                findMany: jest.fn(async () => [
                    {
                        id: 'a',
                        label: 'Ana',
                        phone: '573001112233',
                        isActive: true,
                        lastSentAt: new Date('2026-11-22T14:00:00Z'),
                        lastWamid: 'w1',
                        lastError: null,
                        lastErrorAt: null,
                    },
                    { id: 'b', label: 'Luis', phone: '573004445566', isActive: false, lastSentAt: null, lastWamid: null, lastError: null, lastErrorAt: null },
                ]),
            },
            whatsappTemplate: { findFirst: jest.fn(async () => ({ name: 'alerta_posible_emergencia', language: 'es_CO', isActive: true })) },
            whatsappMessageLog: {
                findMany: jest.fn(async () => [{ wamid: 'w1', status: 'DELIVERED', statusAt: new Date('2026-11-22T14:00:05Z'), errorDetail: null }]),
            },
        };
        const r = await cargarAlertasEmergencia(db as any, ORG);
        expect(db.whatsappTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: ORG, kind: 'EMERGENCY_ALERT' } }));
        expect(db.whatsappMessageLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: ORG, wamid: { in: ['w1'] } } }));
        expect(r.plantilla?.name).toBe('alerta_posible_emergencia');
        expect(r.personas.map((p) => [p.telefono, p.estado.tono, p.estado.texto.split(' ·')[0]])).toEqual([
            ['+57 300 111 2233', 'ok', 'Entregado'],
            ['+57 300 444 5566', 'nunca', 'Sin envíos todavía'],
        ]);
    });
});
