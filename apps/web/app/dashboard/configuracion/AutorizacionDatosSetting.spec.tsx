import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({ setMyAutorizacionDatos: jest.fn() }));

import AutorizacionDatosSetting from './AutorizacionDatosSetting';
import { setMyAutorizacionDatos } from '@/app/actions/settings';

const mockSet = setMyAutorizacionDatos as jest.Mock;
const APAGADA = { encendida: false, urlPolitica: '', version: '1', ultimoCambio: null };
const props = { nombreAsistente: 'Vicente', nombreClinica: 'Hospital San Vicente', estilo: 'FORMAL' as const };

describe('AutorizacionDatosSetting', () => {
    beforeEach(() => jest.clearAllMocks());

    it('nace apagada y sin cambios no deja guardar', () => {
        render(<AutorizacionDatosSetting inicial={APAGADA} {...props} />);
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('status')).toHaveTextContent('Apagada');
        expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    });

    it('encenderla con el enlace guarda los tres datos y muestra lo guardado', async () => {
        mockSet.mockResolvedValue({
            success: true,
            autorizacionDatos: {
                encendida: true,
                urlPolitica: 'https://h.gov.co/datos',
                version: '1',
                ultimoCambio: { en: '2026-11-20T15:00:00.000Z', por: 'admin@clinica.co' },
            },
        });
        render(<AutorizacionDatosSetting inicial={APAGADA} {...props} />);
        await userEvent.click(screen.getByRole('switch'));
        await userEvent.type(screen.getByLabelText(/Enlace de la política/), 'https://h.gov.co/datos');
        await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(mockSet).toHaveBeenCalledWith({ encendida: true, urlPolitica: 'https://h.gov.co/datos', version: '1' });
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Encendida'));
        expect(screen.getByText(/Último cambio:/)).toHaveTextContent('admin@clinica.co');
    });

    it('si no se pudo guardar, lo dice', async () => {
        mockSet.mockResolvedValue({ success: false, error: 'Para encenderla, escriba el enlace' });
        render(<AutorizacionDatosSetting inicial={APAGADA} {...props} />);
        await userEvent.click(screen.getByRole('switch'));
        await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('escriba el enlace');
    });

    it('encendida, cambiar la versión advierte que a todos se les vuelve a preguntar', async () => {
        render(
            <AutorizacionDatosSetting
                inicial={{ encendida: true, urlPolitica: 'https://h.gov.co/datos', version: '1', ultimoCambio: null }}
                {...props}
            />,
        );
        expect(screen.queryByRole('note')).not.toBeInTheDocument();
        const version = screen.getByLabelText(/Versión de la política/);
        await userEvent.clear(version);
        await userEvent.type(version, '2');
        expect(screen.getByRole('note')).toHaveTextContent('le volverá a pedir la autorización a todos');
    });

    it('muestra el mensaje exacto que recibe el paciente', async () => {
        render(
            <AutorizacionDatosSetting
                inicial={{ encendida: true, urlPolitica: 'https://h.gov.co/datos', version: '1', ultimoCambio: null }}
                {...props}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Ver el mensaje/ }));
        const aviso = screen.getByLabelText('Mensaje de autorización');
        expect(aviso).toHaveTextContent('Le saluda *Vicente*, asistente virtual de *Hospital San Vicente*');
        expect(aviso).toHaveTextContent('Ley 1581 de 2012');
        expect(aviso).toHaveTextContent('https://h.gov.co/datos');
    });
});
