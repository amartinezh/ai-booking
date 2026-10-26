/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
    prisma: { systemLog: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) } },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/headers', () => ({ headers: jest.fn(async () => ({ get: () => null })) }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { registrarDescarga, registrarPantalla } from './pantallas';

const mockLog = prisma.systemLog.create as jest.Mock;
const mockCount = prisma.systemLog.count as jest.Mock;
const AGENTE = { role: 'BOOKING_AGENT', organizationId: 'org-1', userId: 'u-ag', email: 'agenda@clinica.co' };

describe('registrarPantalla', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (getSession as jest.Mock).mockResolvedValue(AGENTE);
    });

    it('anota la pantalla con su nombre y la ruta sin consulta', async () => {
        await registrarPantalla('/dashboard/auditoria?caso=1053123456');
        const d = mockLog.mock.calls[0][0].data;
        expect(d).toMatchObject({ action: 'SCREEN_VIEWED', userId: 'u-ag', organizationId: 'org-1' });
        expect(d.metadata).toMatchObject({ detalle: 'Caja Negra (Auditoría)', ruta: '/dashboard/auditoria' });
        expect(JSON.stringify(d)).not.toContain('1053123456');
        // Busca si ya la anotó en los últimos 30 minutos, por persona y ruta.
        const where = mockCount.mock.calls[0][0].where;
        expect(where).toMatchObject({ userId: 'u-ag', action: 'SCREEN_VIEWED', metadata: { path: ['ruta'], equals: '/dashboard/auditoria' } });
    });

    it('la misma pantalla en menos de 30 minutos no se repite', async () => {
        mockCount.mockResolvedValueOnce(1);
        await registrarPantalla('/dashboard/auditoria');
        expect(mockLog).not.toHaveBeenCalled();
    });

    it('sin sesión o con una ruta desconocida, nada', async () => {
        await registrarPantalla('/dashboard/no-existe');
        (getSession as jest.Mock).mockResolvedValue(null);
        await registrarPantalla('/dashboard/auditoria');
        expect(mockLog).not.toHaveBeenCalled();
    });

    it('nunca lanza (no rompe la navegación)', async () => {
        mockCount.mockRejectedValueOnce(new Error('base caída'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        await expect(registrarPantalla('/dashboard/auditoria')).resolves.toBeUndefined();
    });
});

describe('registrarDescarga', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (getSession as jest.Mock).mockResolvedValue(AGENTE);
    });

    it('anota la descarga como aviso, con cuántas filas', async () => {
        await registrarDescarga('AVISOS_SIN_CELULAR', { filas: 12, lote: 'lote-1' });
        const d = mockLog.mock.calls[0][0].data;
        expect(d).toMatchObject({ action: 'DATA_EXPORTED', level: 'WARNING', userId: 'u-ag' });
        expect(d.metadata.detalle).toBe('Pacientes sin celular de un lote de avisos masivos · 12 fila(s)');
    });

    it('un tipo inventado no se anota', async () => {
        await registrarDescarga('LO_QUE_SEA');
        expect(mockLog).not.toHaveBeenCalled();
    });
});
