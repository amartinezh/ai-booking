import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/support-bot', () => ({
    codigoDePruebaAsistente: jest.fn(),
    conectarAsistente: jest.fn(),
    desconectarAsistente: jest.fn(),
    guardarAjustesAsistente: jest.fn(),
}));

import SoporteBotClient, { ajustesDe } from './SoporteBotClient';
import {
    codigoDePruebaAsistente,
    conectarAsistente,
    desconectarAsistente,
    guardarAjustesAsistente,
} from '@/app/actions/support-bot';
import type { ConfigAsistente } from '@/app/actions/support-bot.types';

const sinBot: ConfigAsistente = {
    conectado: false,
    botUsername: null,
    enabled: false,
    webhook: null,
    horario: { dias: [1, 2, 3, 4, 5], desdeHora: 8, hastaHora: 17, zona: 'America/Bogota' },
    conversacionMinutos: 30,
    limites: { mensajesPorHora: 40, caracteresPorMensaje: 2000, turnosIaPorClinicaAlDia: 300 },
    ultimoError: null,
    ultimoErrorEn: null,
    actualizadoPor: null,
    actualizadoEn: null,
};
const conBot: ConfigAsistente = {
    ...sinBot,
    conectado: true,
    botUsername: 'AgeniaSoporteBot',
    webhook: { ok: true, pendientes: 0, ultimoError: null },
};
const CLINICAS = [
    { id: 'org-1', name: 'Hospital de Prueba' },
    { id: 'org-2', name: 'Otra' },
];

/** La página del super admin: conectar, encender, ajustar y probar. */
describe('SoporteBotClient', () => {
    beforeEach(() => jest.clearAllMocks());

    it('sin SUPPORT_BOT_ENABLED en el servidor, lo explica y no ofrece nada', () => {
        render(<SoporteBotClient inicial={{ ok: false, apagado: true, error: 'x' }} clinicas={CLINICAS} />);
        expect(screen.getByText(/SUPPORT_BOT_ENABLED=true/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Token del bot')).not.toBeInTheDocument();
    });

    it('un error al cargar se muestra', () => {
        render(<SoporteBotClient inicial={{ ok: false, apagado: false, error: 'API caída' }} clinicas={CLINICAS} />);
        expect(screen.getByRole('alert')).toHaveTextContent('API caída');
    });

    it('sin bot: pide el token y lo conecta', async () => {
        (conectarAsistente as jest.Mock).mockResolvedValue({ ok: true, config: conBot });
        render(<SoporteBotClient inicial={{ ok: true, config: sinBot }} clinicas={CLINICAS} />);
        expect(screen.queryByRole('button', { name: 'Encender' })).not.toBeInTheDocument();
        await userEvent.type(screen.getByLabelText('Token del bot'), ' 123:abc ');
        await userEvent.click(screen.getByRole('button', { name: 'Conectar bot' }));
        expect(conectarAsistente).toHaveBeenCalledWith('123:abc');
        expect(await screen.findByText('@AgeniaSoporteBot')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Bot conectado');
        expect(screen.getByTestId('estado-webhook')).toHaveTextContent('Telegram entrega los mensajes');
    });

    it('un error al conectar se muestra', async () => {
        (conectarAsistente as jest.Mock).mockResolvedValue({ ok: false, apagado: false, error: 'Este bot es el de las alertas técnicas.' });
        render(<SoporteBotClient inicial={{ ok: true, config: sinBot }} clinicas={CLINICAS} />);
        await userEvent.type(screen.getByLabelText('Token del bot'), '123:abc');
        await userEvent.click(screen.getByRole('button', { name: 'Conectar bot' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('alertas técnicas');
    });

    it('el webhook con problemas y el último envío fallido se ven', () => {
        render(
            <SoporteBotClient
                inicial={{
                    ok: true,
                    config: {
                        ...conBot,
                        webhook: { ok: false, pendientes: 12, ultimoError: 'Wrong response from the webhook: 404' },
                        ultimoError: 'Forbidden: bot was blocked by the user',
                        ultimoErrorEn: '2026-10-19T15:00:00Z',
                    },
                }}
                clinicas={CLINICAS}
            />,
        );
        expect(screen.getByTestId('estado-webhook')).toHaveTextContent('no está entregando');
        expect(screen.getByTestId('estado-webhook')).toHaveTextContent('404');
        expect(screen.getByText(/Último envío fallido: Forbidden/)).toBeInTheDocument();
    });

    it('enciende y apaga', async () => {
        (guardarAjustesAsistente as jest.Mock).mockResolvedValue({ ok: true, config: { ...conBot, enabled: true } });
        render(<SoporteBotClient inicial={{ ok: true, config: conBot }} clinicas={CLINICAS} />);
        await userEvent.click(screen.getByRole('button', { name: 'Encender' }));
        expect(guardarAjustesAsistente).toHaveBeenCalledWith({ enabled: true });
        expect(await screen.findByRole('heading', { name: 'El asistente atiende' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Apagar' })).toBeInTheDocument();
    });

    it('guarda el horario y los límites', async () => {
        (guardarAjustesAsistente as jest.Mock).mockImplementation(async (a) => ({ ok: true, config: conBot, a }));
        render(<SoporteBotClient inicial={{ ok: true, config: conBot }} clinicas={CLINICAS} />);
        await userEvent.click(screen.getByLabelText('S'));
        await userEvent.click(screen.getByLabelText('V'));
        await userEvent.selectOptions(screen.getByLabelText('Hora de inicio'), '7');
        await userEvent.selectOptions(screen.getByLabelText('Hora de fin'), '16');
        const minutos = screen.getByLabelText(/Minutos sin mensajes/);
        await userEvent.clear(minutos);
        await userEvent.type(minutos, '45');
        await userEvent.click(screen.getByRole('button', { name: 'Guardar ajustes' }));
        expect(guardarAjustesAsistente).toHaveBeenCalledWith({
            ...ajustesDe(conBot),
            teamDays: [1, 2, 3, 4, 6],
            teamFromHour: 7,
            teamToHour: 16,
            conversationIdleMinutes: 45,
        });
    });

    it('desconectar pide confirmación', async () => {
        const confirmar = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        (desconectarAsistente as jest.Mock).mockResolvedValue({ ok: true, config: sinBot });
        render(<SoporteBotClient inicial={{ ok: true, config: conBot }} clinicas={CLINICAS} />);
        await userEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
        expect(desconectarAsistente).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
        await waitFor(() => expect(desconectarAsistente).toHaveBeenCalled());
        expect(await screen.findByRole('button', { name: 'Conectar bot' })).toBeInTheDocument();
        confirmar.mockRestore();
    });

    it('el código de prueba exige el asistente encendido y usa la clínica elegida', async () => {
        const { rerender } = render(<SoporteBotClient inicial={{ ok: true, config: conBot }} clinicas={CLINICAS} />);
        expect(screen.getByRole('button', { name: 'Generar código de prueba' })).toBeDisabled();
        expect(screen.getByText(/Encienda el asistente para poder probarlo/)).toBeInTheDocument();

        (codigoDePruebaAsistente as jest.Mock).mockResolvedValue({
            ok: true,
            data: { codigo: '111222', enlace: 'https://t.me/AgeniaSoporteBot?start=z', botUsername: 'AgeniaSoporteBot', venceEn: new Date(Date.now() + 600_000).toISOString() },
        });
        rerender(<SoporteBotClient key="encendido" inicial={{ ok: true, config: { ...conBot, enabled: true } }} clinicas={CLINICAS} />);
        await userEvent.selectOptions(screen.getByLabelText('Clínica de prueba'), 'org-2');
        await userEvent.click(screen.getByRole('button', { name: 'Generar código de prueba' }));
        expect(codigoDePruebaAsistente).toHaveBeenCalledWith('org-2');
        expect(await screen.findByText('111 222')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'ábralo en Telegram' })).toHaveAttribute('href', 'https://t.me/AgeniaSoporteBot?start=z');
    });

    it('un error del código de prueba se muestra', async () => {
        (codigoDePruebaAsistente as jest.Mock).mockResolvedValue({ ok: false, error: 'Esa clínica no existe o está suspendida.' });
        render(<SoporteBotClient inicial={{ ok: true, config: { ...conBot, enabled: true } }} clinicas={CLINICAS} />);
        await userEvent.click(screen.getByRole('button', { name: 'Generar código de prueba' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('suspendida');
    });
});
