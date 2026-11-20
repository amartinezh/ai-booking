jest.mock('@/lib/prisma', () => ({
    prisma: {
        appointmentLimitRequest: { findUnique: jest.fn(), updateMany: jest.fn() },
    },
}));

import { prisma } from '@/lib/prisma';
import { submitLimitRequest } from './limit-request';

const mockFind = prisma.appointmentLimitRequest.findUnique as jest.Mock;
const mockUpdate = prisma.appointmentLimitRequest.updateMany as jest.Mock;
const ID = '22222222-2222-4222-8222-222222222222';
const BASE = {
    motivo: 'TRATAMIENTO',
    argumento: 'Tengo terapia dos veces por semana por orden médica.',
    adicionales: 1,
};

describe('submitLimitRequest — autorización de datos', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFind.mockResolvedValue({ organization: { settings: { dataPolicyVersion: '2' } } });
        mockUpdate.mockResolvedValue({ count: 1 });
    });

    it('sin la casilla marcada no se radica', async () => {
        expect(await submitLimitRequest(ID, BASE)).toMatchObject({
            success: false,
            error: expect.stringMatching(/casilla de autorización/),
        });
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('con la casilla, guarda cuándo la marcó y la versión de la política', async () => {
        expect(await submitLimitRequest(ID, { ...BASE, autorizaDatos: true })).toEqual({ success: true });
        const { data } = mockUpdate.mock.calls[0][0];
        expect(data.dataConsentAt).toBeInstanceOf(Date);
        expect(data.dataConsentPolicyVersion).toBe('2');
    });
});
