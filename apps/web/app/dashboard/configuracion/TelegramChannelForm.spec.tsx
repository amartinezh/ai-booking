import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/telegram-config', () => ({
    connectMyTelegram: jest.fn(),
    verifyMyTelegram: jest.fn(),
    disconnectMyTelegram: jest.fn(),
}));

import TelegramChannelForm from './TelegramChannelForm';
import {
    connectMyTelegram,
    verifyMyTelegram,
} from '@/app/actions/telegram-config';
import type { PublicTelegramConfig } from '@/app/actions/telegram-config.types';

/**
 * Tarjeta «Canal de Telegram» (docs/PLAN_TELEGRAM.md §4.4): sus tres estados,
 * el flujo de conectar y el QR para la sede.
 */
const conectado = (over: Partial<PublicTelegramConfig> = {}): PublicTelegramConfig => ({
    connected: true,
    isActive: true,
    botUsername: 'ClinicaBot',
    botLink: 'https://t.me/ClinicaBot',
    botTokenLast4: 'x9Z1',
    lastWebhookSetAt: '2026-09-28T15:41:00.000Z',
    lastError: null,
    updatedAt: '2026-09-28T15:41:00.000Z',
    ...over,
});
const sinBot: PublicTelegramConfig = {
    connected: false,
    isActive: false,
    botUsername: null,
    botLink: null,
    botTokenLast4: null,
    lastWebhookSetAt: null,
    lastError: null,
    updatedAt: null,
};

describe('TelegramChannelForm', () => {
    beforeEach(() => jest.clearAllMocks());

    it('con Telegram apagado en el servidor lo explica, sin formulario', () => {
        render(<TelegramChannelForm initial={{ enabled: false }} />);
        expect(screen.getByText(/no está habilitado en este servidor/)).toBeInTheDocument();
        expect(screen.queryByPlaceholderText(/123456789:AAH/)).not.toBeInTheDocument();
    });

    it('sin bot: muestra los pasos de BotFather y no hay QR', () => {
        render(<TelegramChannelForm initial={{ enabled: true, config: sinBot }} />);
        expect(screen.getByRole('link', { name: '@BotFather' })).toHaveAttribute('href', 'https://t.me/BotFather');
        expect(screen.queryByTitle(/Código QR/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Conectar bot de Telegram/ })).toBeDisabled();
    });

    it('conectar: manda el token, lo borra del campo y muestra el bot conectado con su QR', async () => {
        (connectMyTelegram as jest.Mock).mockResolvedValue({ success: true, data: conectado() });
        render(<TelegramChannelForm initial={{ enabled: true, config: sinBot }} />);

        await userEvent.type(screen.getByPlaceholderText(/123456789:AAH/), '123456789:AAHtoken');
        await userEvent.click(screen.getByRole('button', { name: /Conectar bot de Telegram/ }));

        await waitFor(() => expect(screen.getByText(/Bot conectado/)).toBeInTheDocument());
        expect(connectMyTelegram).toHaveBeenCalledWith('123456789:AAHtoken');
        expect(screen.getByText('https://t.me/ClinicaBot')).toBeInTheDocument();
        expect(screen.getByTitle('Código QR para abrir @ClinicaBot en Telegram')).toBeInTheDocument();
        // El token nunca queda visible después de conectar.
        expect(screen.queryByDisplayValue('123456789:AAHtoken')).not.toBeInTheDocument();
    });

    it('un error de la API se muestra tal cual a la clínica', async () => {
        (connectMyTelegram as jest.Mock).mockResolvedValue({
            success: false,
            error: 'Telegram rechazó el token. Cópielo de nuevo desde @BotFather.',
        });
        render(<TelegramChannelForm initial={{ enabled: true, config: sinBot }} />);
        await userEvent.type(screen.getByPlaceholderText(/123456789:AAH/), '1:x');
        await userEvent.click(screen.getByRole('button', { name: /Conectar bot de Telegram/ }));
        await waitFor(() =>
            expect(screen.getByText(/Telegram rechazó el token/)).toBeInTheDocument(),
        );
    });

    describe('conectado', () => {
        it('muestra el QR del enlace t.me, negro sobre blanco', () => {
            render(<TelegramChannelForm initial={{ enabled: true, config: conectado() }} />);
            const svg = screen.getByTitle('Código QR para abrir @ClinicaBot en Telegram').closest('svg')!;
            // Fondo blanco y módulos negros: un QR invertido no lo leen muchas cámaras.
            const paths = svg.querySelectorAll('path');
            expect(paths[0].getAttribute('fill')).toBe('#ffffff');
            expect(paths[1].getAttribute('fill')).toBe('#000000');
        });

        it('«Descargar QR» baja un PNG de alta resolución con el nombre del bot', async () => {
            const toDataURL = jest
                .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
                .mockReturnValue('data:image/png;base64,QR');
            const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
            render(<TelegramChannelForm initial={{ enabled: true, config: conectado() }} />);

            await userEvent.click(screen.getByRole('button', { name: /Descargar QR/ }));

            expect(toDataURL).toHaveBeenCalledWith('image/png');
            const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
            expect(anchor.download).toBe('qr-telegram-ClinicaBot.png');
            expect(anchor.href).toBe('data:image/png;base64,QR');
            toDataURL.mockRestore();
            click.mockRestore();
        });

        it('sin canal activo no se ofrece enlace ni QR (el bot no contestaría)', () => {
            render(
                <TelegramChannelForm
                    initial={{
                        enabled: true,
                        config: conectado({ isActive: false, lastError: 'Telegram rechazó el token (¿se revocó en @BotFather?).' }),
                    }}
                />,
            );
            expect(screen.getByText('Desconectado')).toBeInTheDocument();
            expect(screen.getByText(/se revocó en @BotFather/)).toBeInTheDocument();
            expect(screen.queryByTitle(/Código QR/)).not.toBeInTheDocument();
        });

        it('«Verificar conexión» muestra si el webhook apunta a AgenIA', async () => {
            (verifyMyTelegram as jest.Mock).mockResolvedValue({
                success: true,
                data: { ...conectado(), webhookOk: false, pendingUpdateCount: 3, telegramLastError: 'Connection timed out' },
            });
            render(<TelegramChannelForm initial={{ enabled: true, config: conectado() }} />);
            await userEvent.click(screen.getByRole('button', { name: /Verificar conexión/ }));
            await waitFor(() => expect(screen.getByText(/NO apunta a AgenIA/)).toBeInTheDocument());
            expect(screen.getByText(/Mensajes esperando entrega: 3/)).toBeInTheDocument();
            expect(screen.getByText(/Connection timed out/)).toBeInTheDocument();
        });
    });
});
