import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
    redirect: (ruta: string) => {
        throw new Error(`redirect:${ruta}`);
    },
}));
const mockSession = jest.fn();
jest.mock('@/lib/session', () => ({ getSession: () => mockSession() }));
jest.mock('@/lib/prisma', () => ({ prisma: { organization: { findMany: jest.fn(async () => []) } } }));
const mockConfig = jest.fn();
const mockCifras = jest.fn();
const mockPreguntas = jest.fn();
jest.mock('@/app/actions/support-bot', () => ({
    getConfigAsistente: () => mockConfig(),
    getCifrasAsistente: (d: number) => mockCifras(d),
    getPreguntasSinCubrir: (d: number) => mockPreguntas(d),
}));
jest.mock('./SoporteBotClient', () => ({ __esModule: true, default: () => <p>configuración</p> }));
jest.mock('./CifrasAsistente', () => ({
    CifrasDelAsistente: () => <p>cifras</p>,
    PreguntasSinCubrir: () => <p>preguntas</p>,
}));

import SoporteBotPage from './page';

/** La página del asistente: configuración arriba y, si el asistente existe, cómo va (Fase 5). */
describe('/super-admin/soporte-bot', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSession.mockResolvedValue({ userId: 'sa', role: 'SUPER_ADMIN' });
        mockConfig.mockResolvedValue({ ok: true, config: {} });
        mockCifras.mockResolvedValue({ ok: true, data: {} });
        mockPreguntas.mockResolvedValue({ ok: true, data: [] });
    });

    it('con el asistente en el servidor: cifras y preguntas del periodo de la URL', async () => {
        render(await SoporteBotPage({ searchParams: Promise.resolve({ dias: '30' }) }));
        expect(mockCifras).toHaveBeenCalledWith(30);
        expect(mockPreguntas).toHaveBeenCalledWith(30);
        for (const t of ['configuración', 'cifras', 'preguntas']) expect(screen.getByText(t)).toBeInTheDocument();
    });

    it('sin el asistente en el servidor (SUPPORT_BOT_ENABLED), no pide cifras', async () => {
        mockConfig.mockResolvedValue({ ok: false, apagado: true, error: 'x' });
        render(await SoporteBotPage({ searchParams: Promise.resolve({}) }));
        expect(mockCifras).not.toHaveBeenCalled();
        expect(screen.queryByText('cifras')).not.toBeInTheDocument();
    });

    it('si las cifras fallan, lo dice y el resto sigue', async () => {
        mockCifras.mockResolvedValue({ ok: false, error: 'Redis' });
        mockPreguntas.mockResolvedValue({ ok: false, error: 'x' });
        render(await SoporteBotPage({ searchParams: Promise.resolve({}) }));
        expect(mockCifras).toHaveBeenCalledWith(7);
        expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar las cifras: Redis');
        expect(screen.getByText('configuración')).toBeInTheDocument();
        expect(screen.queryByText('preguntas')).not.toBeInTheDocument();
    });

    it('🔒 sin sesión válida, a /sesion-cerrada (borra la cookie y lleva al ingreso)', async () => {
        mockSession.mockResolvedValue(null);
        await expect(SoporteBotPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/sesion-cerrada');
    });

    it('🔒 sin ser super admin, fuera', async () => {
        mockSession.mockResolvedValue({ role: 'ORG_ADMIN', userId: 'u1', email: 'a@b.co', organizationId: 'org-1' });
        await expect(SoporteBotPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/dashboard');
    });
});
