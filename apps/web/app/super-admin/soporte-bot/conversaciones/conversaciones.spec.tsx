import { render, screen } from '@testing-library/react';
import type { DetalleConversacion, FilaConversacion } from '@agenia/shared';

const mockRedirect = jest.fn((ruta: string) => {
    throw new Error(`redirect:${ruta}`);
});
jest.mock('next/navigation', () => ({ redirect: (ruta: string) => mockRedirect(ruta) }));
const mockSession = jest.fn();
jest.mock('@/lib/session', () => ({ getSession: () => mockSession() }));
jest.mock('@/lib/prisma', () => ({
    prisma: { organization: { findMany: jest.fn(async () => [{ id: 'org-1', name: 'Hospital Uno' }]) } },
}));
const mockLista = jest.fn();
const mockDetalle = jest.fn();
jest.mock('@/app/actions/support-bot', () => ({
    getConversacionesAsistente: (f: unknown) => mockLista(f),
    getConversacionAsistente: (id: string) => mockDetalle(id),
}));

import ConversacionesPage from './page';
import ConversacionPage from './[id]/page';

const FILA: FilaConversacion = {
    id: 'c1',
    inicio: '2026-10-20T14:00:00.000Z',
    ultimoMensaje: '2026-10-20T14:10:00.000Z',
    cierre: '2026-10-20T14:40:00.000Z',
    motivoCierre: 'INACTIVIDAD',
    clinica: 'Hospital Uno',
    correo: 'ana@clinica.co',
    rol: 'BOOKING_AGENT',
    prueba: false,
    mensajes: 6,
    feedback: 'NO_UTIL',
    sinCubrir: true,
    casos: [58],
};

/** Las conversaciones del asistente: solo lectura y solo del super admin (Fase 5). */
describe('las conversaciones del asistente', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSession.mockResolvedValue({ userId: 'sa', role: 'SUPER_ADMIN' });
        mockLista.mockResolvedValue({ ok: true, data: { filas: [FILA], siguiente: 'c1' } });
    });

    it('🔒 sin ser super admin, fuera', async () => {
        mockSession.mockResolvedValue({ userId: 'u', role: 'ORG_ADMIN' });
        await expect(ConversacionesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/dashboard');
        await expect(ConversacionPage({ params: Promise.resolve({ id: 'c1' }) })).rejects.toThrow('redirect:/dashboard');
        expect(mockLista).not.toHaveBeenCalled();
        expect(mockDetalle).not.toHaveBeenCalled();
    });

    it('la lista: los filtros de la URL limpios, cada fila con su resultado y la página siguiente', async () => {
        render(
            await ConversacionesPage({
                searchParams: Promise.resolve({ dias: '30', clinica: 'org-1', filtro: 'NO_UTIL' }),
            }),
        );
        expect(mockLista).toHaveBeenCalledWith({ dias: 30, clinica: 'org-1', filtro: 'NO_UTIL', cursor: null });
        expect(screen.getByText('Hospital Uno · ana@clinica.co')).toBeInTheDocument();
        expect(screen.getByText(/Agente de Reservas · .* · 6 mensajes · Se cerró sola/)).toBeInTheDocument();
        for (const t of ['Caso #58', 'No le sirvió', 'Sin cubrir']) expect(screen.getByText(t)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Hospital Uno · ana@clinica\.co/ })).toHaveAttribute(
            'href',
            '/super-admin/soporte-bot/conversaciones/c1',
        );
        expect(screen.getByRole('link', { name: 'Ver las siguientes' })).toHaveAttribute(
            'href',
            '/super-admin/soporte-bot/conversaciones?dias=30&filtro=NO_UTIL&cursor=c1&clinica=org-1',
        );
    });

    it('lo que no se entiende de la URL vuelve a lo de siempre; sin filas, lo dice', async () => {
        mockLista.mockResolvedValue({ ok: true, data: { filas: [], siguiente: null } });
        render(await ConversacionesPage({ searchParams: Promise.resolve({ dias: '999', filtro: 'x' }) }));
        expect(mockLista).toHaveBeenCalledWith({ dias: 7, clinica: null, filtro: 'TODAS', cursor: null });
        expect(screen.getByText('No hay conversaciones con esos filtros.')).toBeInTheDocument();
    });

    it('si la API no responde, lo dice', async () => {
        mockLista.mockResolvedValue({ ok: false, error: 'El asistente no está habilitado' });
        render(await ConversacionesPage({ searchParams: Promise.resolve({}) }));
        expect(screen.getByRole('alert')).toHaveTextContent('El asistente no está habilitado');
    });

    it('una conversación: los mensajes de cada lado, con fuente, temas, tiempo y tokens; los casos; el aviso de los datos', async () => {
        const detalle: DetalleConversacion = {
            ...FILA,
            prueba: true,
            telegramName: 'Ana',
            casosDetalle: [{ numero: 58, titulo: 'No salen', estado: 'IN_PROGRESS' }],
            mensajesDetalle: [
                {
                    id: 'm1',
                    fecha: '2026-10-20T14:00:00.000Z',
                    direccion: 'ENTRADA',
                    texto: 'la paciente 1053789456 no recibe',
                    fuente: null,
                    tipo: null,
                    temas: [],
                    sinCubrir: false,
                    proveedor: null,
                    tokensEntrada: null,
                    tokensSalida: null,
                    latenciaMs: null,
                },
                {
                    id: 'm2',
                    fecha: '2026-10-20T14:00:05.000Z',
                    direccion: 'SALIDA',
                    texto: 'Eso no lo tengo en el manual.',
                    fuente: 'IA',
                    tipo: 'respuesta',
                    temas: ['recordatorios'],
                    sinCubrir: true,
                    proveedor: 'GEMINI',
                    tokensEntrada: 30000,
                    tokensSalida: 90,
                    latenciaMs: 2100,
                },
            ],
        };
        mockDetalle.mockResolvedValue({ ok: true, data: detalle });
        render(await ConversacionPage({ params: Promise.resolve({ id: 'c1' }) }));
        expect(mockDetalle).toHaveBeenCalledWith('c1');
        expect(screen.getByText('la paciente 1053789456 no recibe')).toBeInTheDocument();
        expect(
            screen.getByText(/Asistente · .* · Con IA · respuesta · el manual no lo cubre · temas: recordatorios · GEMINI · 2,1 s · 30\.000 \/ 90 tokens/),
        ).toBeInTheDocument();
        expect(screen.getByText(/No salen · En atención/)).toBeInTheDocument();
        expect(screen.getByText(/en Telegram, Ana/)).toBeInTheDocument();
        expect(screen.getByText(/Se cerró sola/)).toBeInTheDocument();
        expect(screen.getByText('Prueba')).toBeInTheDocument();
        expect(screen.getByText(/quedó en la bitácora del sistema/)).toBeInTheDocument();
    });

    it('una conversación que ya no existe: lo dice, con el camino de vuelta', async () => {
        mockDetalle.mockResolvedValue({ ok: false, error: 'La conversación no existe o ya se borró.' });
        render(await ConversacionPage({ params: Promise.resolve({ id: 'x' }) }));
        expect(screen.getByRole('alert')).toHaveTextContent('ya se borró');
        expect(screen.getByRole('link', { name: '← Conversaciones' })).toBeInTheDocument();
    });

    it('una abierta dice «abierta»', async () => {
        mockDetalle.mockResolvedValue({
            ok: true,
            data: { ...FILA, cierre: null, motivoCierre: null, telegramName: null, casosDetalle: [], mensajesDetalle: [] },
        });
        render(await ConversacionPage({ params: Promise.resolve({ id: 'c1' }) }));
        expect(screen.getByText(/ · abierta$/)).toBeInTheDocument();
    });
});
