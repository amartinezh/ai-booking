jest.mock('@/lib/prisma', () => ({
    prisma: {
        organization: { findUnique: jest.fn() },
        epsEnrollmentRequest: { count: jest.fn(), create: jest.fn() },
    },
}));

import { prisma } from '@/lib/prisma';
import { submitEnrollmentRequest } from './enrollment-request';

const mockOrg = prisma.organization.findUnique as jest.Mock;
const mockCreate = prisma.epsEnrollmentRequest.create as jest.Mock;
const ORG = '11111111-1111-4111-8111-111111111111';
const BASE = { cedula: '1088123456', fullName: 'Juan Pérez', message: 'Estoy afiliado desde enero a Sura.' };

describe('submitEnrollmentRequest — autorización de datos', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockOrg.mockResolvedValue({ id: ORG, isActive: true, settings: { dataPolicyVersion: '3' } });
        (prisma.epsEnrollmentRequest.count as jest.Mock).mockResolvedValue(0);
        mockCreate.mockResolvedValue({});
    });

    it('sin la casilla marcada no se guarda nada', async () => {
        const r = await submitEnrollmentRequest(ORG, BASE);
        expect(r).toMatchObject({ success: false, error: expect.stringMatching(/casilla de autorización/) });
        expect(await submitEnrollmentRequest(ORG, { ...BASE, autorizaDatos: false })).toMatchObject({ success: false });
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('con la casilla, guarda cuándo la marcó y con qué versión de la política', async () => {
        expect(await submitEnrollmentRequest(ORG, { ...BASE, autorizaDatos: true })).toEqual({ success: true });
        const { data } = mockCreate.mock.calls[0][0];
        expect(data.dataConsentAt).toBeInstanceOf(Date);
        expect(data.dataConsentPolicyVersion).toBe('3');
    });

    it('sin ajustes de la clínica, versión 1', async () => {
        mockOrg.mockResolvedValue({ id: ORG, isActive: true, settings: null });
        await submitEnrollmentRequest(ORG, { ...BASE, autorizaDatos: true });
        expect(mockCreate.mock.calls[0][0].data.dataConsentPolicyVersion).toBe('1');
    });
});
