import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/datos-clinica', () => ({ setMyTelefonoSoporte: jest.fn() }));

import TelefonoSoporteForm from './TelefonoSoporteForm';
import { setMyTelefonoSoporte } from '@/app/actions/datos-clinica';

const guardar = setMyTelefonoSoporte as jest.Mock;
const campo = () => screen.getByLabelText('Teléfono');
const boton = () => screen.getByRole('button', { name: 'Guardar teléfono' });

describe('TelefonoSoporteForm (docs/PLAN_NAVEGACION.md, N9)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('un celular: dice cómo se guarda y que le llegan las alertas', async () => {
        render(<TelefonoSoporteForm inicial={null} />);
        expect(boton()).toBeDisabled();
        await userEvent.type(campo(), '3001234567');
        expect(screen.getByText(/Se guarda como \+57 300 123 4567/)).toBeInTheDocument();
        expect(screen.getByText('Hay cambios sin guardar')).toBeInTheDocument();
        expect(boton()).toBeEnabled();
    });

    it('un fijo: se puede guardar, pero avisa que las alertas de emergencia no llegan', async () => {
        render(<TelefonoSoporteForm inicial={null} />);
        await userEvent.type(campo(), '(606) 859 1010');
        expect(screen.getByText(/las alertas de posible emergencia no llegan por WhatsApp/)).toBeInTheDocument();
        expect(boton()).toBeEnabled();
    });

    it('guarda y muestra lo que quedó', async () => {
        guardar.mockResolvedValue({ success: true, telefono: '+57 300 123 4567', alertasPorWhatsapp: true });
        render(<TelefonoSoporteForm inicial="(606) 859 1010" />);
        await userEvent.clear(campo());
        await userEvent.type(campo(), '3001234567');
        await userEvent.click(boton());
        expect(guardar).toHaveBeenCalledWith('3001234567');
        await waitFor(() => expect(campo()).toHaveValue('+57 300 123 4567'));
        expect(screen.queryByText('Hay cambios sin guardar')).not.toBeInTheDocument();
    });

    it('un celular guardado sin indicativo se puede corregir sin reescribirlo', () => {
        render(<TelefonoSoporteForm inicial="3001234567" />);
        expect(boton()).toBeEnabled();
    });

    it('si el servidor lo rechaza, lo dice y conserva lo escrito', async () => {
        guardar.mockResolvedValue({ success: false, error: 'Acceso denegado' });
        render(<TelefonoSoporteForm inicial="(606) 859 1010" />);
        await userEvent.clear(campo());
        await userEvent.type(campo(), '3001234567');
        await userEvent.click(boton());
        expect(await screen.findByRole('alert')).toHaveTextContent('Acceso denegado');
        expect(campo()).toHaveValue('3001234567');
    });
});
