import { autorizacionesDePacientes } from './pacientes';

describe('autorizacionesDePacientes', () => {
    const t = (iso: string) => new Date(iso);

    it('cada paciente con su autorización más reciente, y el retiro posterior del mismo chat', () => {
        const r = autorizacionesDePacientes(
            [
                { patientIds: ['p1', 'p2'], senderKey: 'a', channel: 'WHATSAPP', policyVersion: '1', answeredAt: t('2026-11-01T10:00:00Z') },
                { patientIds: ['p1'], senderKey: 'b', channel: 'TELEGRAM', policyVersion: '2', answeredAt: t('2026-11-05T10:00:00Z') },
                { patientIds: ['p3'], senderKey: 'c', channel: 'WHATSAPP', policyVersion: '1', answeredAt: t('2026-11-02T10:00:00Z') },
                { patientIds: ['p4'], senderKey: 'd', channel: 'WHATSAPP', policyVersion: '1', answeredAt: null },
            ],
            [
                { senderKey: 'a', answeredAt: t('2026-11-03T10:00:00Z') },
                // Un retiro anterior a la autorización no la anula.
                { senderKey: 'c', answeredAt: t('2026-11-01T10:00:00Z') },
                { senderKey: 'c', answeredAt: null },
            ],
        );
        expect(r).toEqual({
            p1: { estado: 'AUTORIZO', fecha: '2026-11-05T10:00:00.000Z', canal: 'TELEGRAM', version: '2' },
            p2: { estado: 'RETIRO', fecha: '2026-11-03T10:00:00.000Z', canal: 'WHATSAPP', version: '1' },
            p3: { estado: 'AUTORIZO', fecha: '2026-11-02T10:00:00.000Z', canal: 'WHATSAPP', version: '1' },
        });
    });

    it('sin autorizaciones, nada', () => {
        expect(autorizacionesDePacientes([], [])).toEqual({});
    });
});
