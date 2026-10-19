import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/tech-alerts', () => ({
    connectTechAlertBot: jest.fn(),
    disconnectTechAlertBot: jest.fn(),
    findTechAlertLink: jest.fn(),
    listTechAlerts: jest.fn(async () => ({ rows: [], total: 0 })),
    muteTechAlerts: jest.fn(),
    sendTechAlertTest: jest.fn(),
    startTechAlertLink: jest.fn(),
    unmuteTechAlerts: jest.fn(),
    updateTechAlertSettings: jest.fn(),
}));

import AlertasClient, { envioDeFila } from './AlertasClient';
import {
    connectTechAlertBot,
    findTechAlertLink,
    sendTechAlertTest,
    startTechAlertLink,
    updateTechAlertSettings,
} from '@/app/actions/tech-alerts';
import type { PublicTechAlertConfig, TechAlertRow } from '@/app/actions/tech-alerts.types';

/**
 * 🚨 La página de alertas técnicas (docs/PLAN_ALERTAS_TECNICAS.md §3.8): el
 * encabezado dice si las alertas están saliendo, y los tres pasos llevan de
 * «sin configurar» a «activas» sin escribir un id a mano.
 */
const sinNada: PublicTechAlertConfig = {
    connected: false,
    botUsername: null,
    botLink: null,
    botTokenLast4: null,
    chatLinked: false,
    chatTitle: null,
    linkPending: null,
    enabled: false,
    mutedUntil: null,
    categories: {},
    reminderMinutes: 60,
    maxReminders: 3,
    quietHoursEnabled: true,
    quietFromHour: 22,
    quietToHour: 6,
    dailySummaryEnabled: true,
    panelBaseUrl: null,
    panelBaseEffective: 'https://app.hsvpanserma.agenia.co',
    lastOkAt: null,
    lastError: null,
    lastErrorAt: null,
    updatedAt: null,
    updatedByEmail: null,
};
const conBot: PublicTechAlertConfig = {
    ...sinNada,
    connected: true,
    botUsername: 'AgeniaTecnicoBot',
    botLink: 'https://t.me/AgeniaTecnicoBot',
    botTokenLast4: '2345',
    updatedAt: '2026-10-19T15:00:00.000Z',
};
const activo: PublicTechAlertConfig = {
    ...conBot,
    chatLinked: true,
    chatTitle: 'AgenIA · Técnico',
    enabled: true,
    lastOkAt: '2026-10-19T15:38:00.000Z',
    updatedAt: '2026-10-19T15:38:00.000Z',
};
const vacia = { rows: [], total: 0 };

const montar = (config: PublicTechAlertConfig | null, loadError: string | null = null) =>
    render(<AlertasClient initialConfig={config} loadError={loadError} initialAlerts={vacia} />);

describe('AlertasClient', () => {
    beforeEach(() => jest.clearAllMocks());

    it('si la configuración no carga, lo dice', () => {
        montar(null, 'El servidor respondió 500.');
        expect(screen.getByText(/No se pudo cargar la configuración: El servidor respondió 500/)).toBeInTheDocument();
    });

    it('sin configurar: lo advierte, enseña BotFather y no deja vincular todavía', () => {
        montar(sinNada);
        expect(screen.getByTestId('estado-canal')).toHaveTextContent(/Sin configurar/);
        expect(screen.getByRole('link', { name: '@BotFather' })).toHaveAttribute('href', 'https://t.me/BotFather');
        expect(screen.getByRole('button', { name: 'Conectar bot' })).toBeDisabled();
        expect(screen.getByText('Primero conecte el bot.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Enviar mensaje de prueba/ })).toBeDisabled();
    });

    it('conectar: manda el token, lo borra del campo y pide vincular el grupo', async () => {
        (connectTechAlertBot as jest.Mock).mockResolvedValue({ success: true, data: conBot });
        montar(sinNada);
        const campo = screen.getByLabelText('Token del bot');
        await userEvent.type(campo, '555000111:AAHsecreto');
        await userEvent.click(screen.getByRole('button', { name: 'Conectar bot' }));
        await waitFor(() => expect(connectTechAlertBot).toHaveBeenCalledWith('555000111:AAHsecreto'));
        expect(await screen.findByText(/Ahora vincule el grupo/)).toBeInTheDocument();
        expect(campo).toHaveValue('');
        expect(screen.getByText('@AgeniaTecnicoBot')).toBeInTheDocument();
    });

    it('vincular: genera el código, muestra el comando y busca el grupo', async () => {
        (startTechAlertLink as jest.Mock).mockResolvedValue({
            success: true,
            data: {
                ...conBot,
                linkPending: {
                    code: '4F7K2Q',
                    command: '/vincular@AgeniaTecnicoBot 4F7K2Q',
                    expiresAt: '2026-10-19T15:53:00.000Z',
                },
            },
        });
        (findTechAlertLink as jest.Mock)
            .mockResolvedValueOnce({
                success: true,
                data: { found: false, reason: 'NO_LLEGO', message: 'Todavía no llega el código.' },
            })
            .mockResolvedValueOnce({ success: true, data: { found: true, config: activo } });

        montar(conBot);
        await userEvent.click(screen.getByRole('button', { name: 'Generar código de vinculación' }));
        expect(await screen.findByText('/vincular@AgeniaTecnicoBot 4F7K2Q')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /Buscar el grupo/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Todavía no llega el código.');

        await userEvent.click(screen.getByRole('button', { name: /Buscar el grupo/ }));
        expect(await screen.findByRole('status')).toHaveTextContent(/Grupo «AgenIA · Técnico» listo/);
        expect(screen.getByTestId('estado-canal')).toHaveTextContent(/Activas en «AgenIA · Técnico»/);
    });

    it('si el último envío falló, el encabezado lo grita', () => {
        montar({
            ...activo,
            lastError: 'El bot ya no puede escribir en el grupo (¿lo sacaron?)',
            lastErrorAt: '2026-10-19T16:00:00.000Z',
        });
        expect(screen.getByTestId('estado-canal')).toHaveTextContent(/NO están saliendo.*lo sacaron/);
    });

    it('apagadas y en silencio también se distinguen', () => {
        const { unmount } = montar({ ...activo, enabled: false });
        expect(screen.getByTestId('estado-canal')).toHaveTextContent(/Apagadas/);
        unmount();
        montar({ ...activo, mutedUntil: '2999-01-01T12:00:00.000Z' });
        expect(screen.getByTestId('estado-canal')).toHaveTextContent(/En silencio hasta/);
        expect(screen.getByRole('button', { name: 'Quitar el silencio' })).toBeInTheDocument();
    });

    it('la prueba: aviso si salió, error si Telegram no la aceptó', async () => {
        (sendTechAlertTest as jest.Mock)
            .mockResolvedValueOnce({ success: true, data: { ok: true } })
            .mockResolvedValueOnce({ success: true, data: { ok: false, error: 'Forbidden' } });
        montar(activo);
        await userEvent.click(screen.getByRole('button', { name: /Enviar mensaje de prueba/ }));
        expect(await screen.findByRole('status')).toHaveTextContent(/Mensaje de prueba enviado/);
        await userEvent.click(screen.getByRole('button', { name: /Enviar mensaje de prueba/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/no aceptó el mensaje: Forbidden/);
    });

    it('guardar ajustes manda las categorías y el antirruido', async () => {
        (updateTechAlertSettings as jest.Mock).mockResolvedValue({ success: true, data: activo });
        montar(activo);
        await userEvent.click(screen.getByRole('checkbox', { name: /Errores de la API/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Guardar ajustes' }));
        await waitFor(() =>
            expect(updateTechAlertSettings).toHaveBeenCalledWith(
                expect.objectContaining({
                    categories: { ERRORES: false },
                    reminderMinutes: 60,
                    maxReminders: 3,
                    quietFromHour: 22,
                    quietToHour: 6,
                    dailySummaryEnabled: true,
                    panelBaseUrl: '',
                }),
            ),
        );
        expect(await screen.findByRole('status')).toHaveTextContent('Ajustes guardados.');
    });

    describe('la bitácora dice qué pasó con cada aviso', () => {
        const fila = (over: Partial<TechAlertRow> = {}): TechAlertRow => ({
            id: 'a1',
            kind: 'SERVICIO_CAIDO',
            category: 'ESPEJO',
            severity: 'CRITICA',
            status: 'ABIERTA',
            title: 'Espejo con el HIS',
            detail: null,
            organizationName: null,
            occurrences: 1,
            firstSeenAt: '2026-10-19T15:38:00.000Z',
            lastSeenAt: '2026-10-19T15:38:00.000Z',
            resolvedAt: null,
            notifiedAt: null,
            resolutionNotifiedAt: null,
            reminderCount: 0,
            sendAttempts: 0,
            lastSendError: null,
            meta: null,
            ...over,
        });

        it.each([
            [{ meta: { suprimida: 'TOPE' } }, /y N alertas más/],
            [{ meta: { suprimida: 'INTERMITENTE' } }, /Intermitente/],
            [{ notifiedAt: '2026-10-19T15:38:05.000Z' }, /^Enviada /],
            [
                { notifiedAt: '2026-10-19T15:38:05.000Z', resolutionNotifiedAt: '2026-10-19T15:44:00.000Z' },
                /«resuelto» enviado/,
            ],
            [{ lastSendError: 'fetch failed' }, /Falló: fetch failed/],
            [{}, /Sin enviar/],
        ])('%o', (over, esperado) => {
            expect(envioDeFila(fila(over as Partial<TechAlertRow>))).toMatch(esperado);
        });

        it('muestra la fila con su tipo, la clínica y las repeticiones', () => {
            render(
                <AlertasClient
                    initialConfig={activo}
                    loadError={null}
                    initialAlerts={{
                        rows: [fila({ organizationName: 'E.S.E. San Vicente', occurrences: 3 })],
                        total: 1,
                    }}
                />,
            );
            expect(screen.getByText(/Servicio caído/)).toBeInTheDocument();
            expect(screen.getByText(/E.S.E. San Vicente/)).toBeInTheDocument();
            expect(screen.getByText(/×3/)).toBeInTheDocument();
        });
    });
});
