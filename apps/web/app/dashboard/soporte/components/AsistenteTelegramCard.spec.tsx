import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/support-bot', () => ({
    generarCodigoAsistente: jest.fn(),
    cerrarConversacionAsistente: jest.fn(),
    cambiarAvisosAsistente: jest.fn(),
}));
jest.mock('@/app/actions/support', () => ({ createTicket: jest.fn() }));

import AsistenteTelegramCard, { codigoLegible, segundosRestantes } from './AsistenteTelegramCard';
import SupportClient from './SupportClient';
import {
    cambiarAvisosAsistente,
    cerrarConversacionAsistente,
    generarCodigoAsistente,
} from '@/app/actions/support-bot';
import type { EstadoAsistente } from '@/app/actions/support-bot.types';

const mockGenerar = generarCodigoAsistente as jest.Mock;
const mockCerrar = cerrarConversacionAsistente as jest.Mock;
const mockAvisos = cambiarAvisosAsistente as jest.Mock;

const base: EstadoAsistente = {
    disponible: true,
    botUsername: 'AgeniaSoporteBot',
    conversacionMinutos: 30,
    conversacion: null,
    avisos: { activos: true, destino: null },
};

/**
 * La tarjeta «Asistente de soporte en Telegram» (docs/PLAN_BOT_SOPORTE.md §3.1):
 * el código se genera al pedirlo, se lee fácil, vence y no se queda a la vista.
 */
describe('AsistenteTelegramCard', () => {
    beforeEach(() => jest.clearAllMocks());

    it('helpers: el código en dos grupos y los segundos que quedan', () => {
        expect(codigoLegible('482913')).toBe('482 913');
        expect(codigoLegible('abc')).toBe('abc');
        expect(segundosRestantes('2026-10-19T15:10:00Z', Date.parse('2026-10-19T15:00:00Z'))).toBe(600);
        expect(segundosRestantes('2026-10-19T15:00:00Z', Date.parse('2026-10-19T15:00:05Z'))).toBe(0);
    });

    it('sin pedirlo no muestra ningún código', () => {
        render(<AsistenteTelegramCard estadoInicial={base} />);
        expect(screen.getByRole('heading', { name: /Asistente de soporte en Telegram/ })).toBeInTheDocument();
        expect(screen.queryByText(/Tu código/)).not.toBeInTheDocument();
    });

    it('genera el código: grande, con QR, enlace, cuenta regresiva y la advertencia', async () => {
        mockGenerar.mockResolvedValue({
            ok: true,
            data: {
                codigo: '482913',
                enlace: 'https://t.me/AgeniaSoporteBot?start=abc',
                botUsername: 'AgeniaSoporteBot',
                venceEn: new Date(Date.now() + 10 * 60_000).toISOString(),
            },
        });
        render(<AsistenteTelegramCard estadoInicial={base} />);
        await userEvent.click(screen.getByRole('button', { name: 'Generar código' }));

        expect(await screen.findByText('482 913')).toBeInTheDocument();
        expect(screen.getByTitle(/Código QR para abrir @AgeniaSoporteBot/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Abrir en Telegram' })).toHaveAttribute(
            'href',
            'https://t.me/AgeniaSoporteBot?start=abc',
        );
        expect(screen.getByText(/Vence en/)).toHaveTextContent(/(10:00|9:5\d)/);
        expect(screen.getByText(/Nunca compartas este código/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Generar otro código' })).toBeInTheDocument();
    });

    it('un código vencido desaparece', async () => {
        jest.useFakeTimers();
        try {
            mockGenerar.mockResolvedValue({
                ok: true,
                data: { codigo: '482913', enlace: 'https://t.me/b?start=x', botUsername: 'b', venceEn: new Date(Date.now() + 2000).toISOString() },
            });
            render(<AsistenteTelegramCard estadoInicial={base} />);
            await act(async () => {
                screen.getByRole('button', { name: 'Generar código' }).click();
            });
            expect(screen.getByText('482 913')).toBeInTheDocument();
            await act(async () => {
                jest.advanceTimersByTime(3000);
            });
            expect(screen.queryByText('482 913')).not.toBeInTheDocument();
            expect(screen.getByText(/El código venció/)).toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it('un error de la API se muestra', async () => {
        mockGenerar.mockResolvedValue({ ok: false, error: 'El asistente de soporte no está disponible.' });
        render(<AsistenteTelegramCard estadoInicial={base} />);
        await userEvent.click(screen.getByRole('button', { name: 'Generar código' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('no está disponible');
    });

    it('la conversación abierta se ve y se puede cerrar', async () => {
        mockCerrar.mockResolvedValue({ ok: true, data: base });
        render(
            <AsistenteTelegramCard
                estadoInicial={{
                    ...base,
                    conversacion: { telegramName: 'Ana', desde: '2026-10-19T15:32:00Z', ultimoMensaje: '2026-10-19T15:40:00Z' },
                }}
            />,
        );
        expect(screen.getByText(/Conversación abierta con Ana desde las 10:32 a/)).toHaveTextContent('30 minutos');
        await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
        await waitFor(() => expect(screen.queryByText(/Conversación abierta/)).not.toBeInTheDocument());
    });

    it('si cerrar falla, lo dice y la conversación sigue', async () => {
        mockCerrar.mockResolvedValue({ ok: false, error: 'No se pudo contactar al servidor.' });
        render(
            <AsistenteTelegramCard
                estadoInicial={{ ...base, conversacion: { telegramName: null, desde: '2026-10-19T15:32:00Z', ultimoMensaje: '2026-10-19T15:32:00Z' } }}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo contactar');
        expect(screen.getByText(/Conversación abierta desde las/)).toBeInTheDocument();
    });
});

describe('SupportClient con el asistente', () => {
    it('muestra la tarjeta solo si el asistente está disponible', () => {
        const { rerender } = render(<SupportClient tickets={[]} asistente={base} />);
        expect(screen.getByRole('heading', { name: /Asistente de soporte en Telegram/ })).toBeInTheDocument();
        rerender(<SupportClient tickets={[]} asistente={{ ...base, disponible: false }} />);
        expect(screen.queryByRole('heading', { name: /Asistente de soporte en Telegram/ })).not.toBeInTheDocument();
        rerender(<SupportClient tickets={[]} />);
        expect(screen.queryByRole('heading', { name: /Asistente de soporte en Telegram/ })).not.toBeInTheDocument();
    });

    describe('los avisos de sus casos (Fase 4)', () => {
        it('dice a qué cuenta llegan y los apaga', async () => {
            mockAvisos.mockResolvedValue({ ok: true, data: { ...base, avisos: { activos: false, destino: 'Ana' } } });
            render(<AsistenteTelegramCard estadoInicial={{ ...base, avisos: { activos: true, destino: 'Ana' } }} />);
            expect(screen.getByText(/te aviso por Telegram a Ana\./)).toBeInTheDocument();
            await userEvent.click(screen.getByRole('button', { name: 'Dejar de recibir avisos' }));
            expect(mockAvisos).toHaveBeenCalledWith(false);
            expect(await screen.findByText('No recibes avisos de tus casos por Telegram.')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Recibir avisos' })).toBeInTheDocument();
        });

        it('sin conversaciones todavía, explica cuándo empiezan', () => {
            render(<AsistenteTelegramCard estadoInicial={base} />);
            expect(screen.getByText(/Cuando converses con el asistente, te avisará/)).toBeInTheDocument();
        });

        it('si no se puede cambiar, lo dice', async () => {
            mockAvisos.mockResolvedValue({ ok: false, error: 'No se pudo guardar' });
            render(<AsistenteTelegramCard estadoInicial={base} />);
            await userEvent.click(screen.getByRole('button', { name: 'Dejar de recibir avisos' }));
            expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar');
        });
    });
});
