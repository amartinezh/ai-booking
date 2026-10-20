import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/cuenta', () => ({ cambiarMiClave: jest.fn() }));

import CambiarClaveForm from './CambiarClaveForm';
import { cambiarMiClave } from '@/app/actions/cuenta';

const mockCambiar = cambiarMiClave as jest.Mock;

const llenar = async () => {
    await userEvent.type(screen.getByLabelText('Clave actual'), 'Inicial-Ab12-Cd34');
    await userEvent.type(screen.getByLabelText('Clave nueva'), 'MiClaveNueva2026');
    await userEvent.type(screen.getByLabelText('Confirme la clave nueva'), 'MiClaveNueva2026');
};

describe('CambiarClaveForm', () => {
    beforeEach(() => jest.clearAllMocks());

    it('las claves no se ven mientras se escriben', () => {
        render(<CambiarClaveForm />);
        expect(screen.getByLabelText('Clave actual')).toHaveAttribute('type', 'password');
        expect(screen.getByLabelText('Clave nueva')).toHaveAttribute('type', 'password');
    });

    it('envía las tres, confirma el cambio y borra los campos', async () => {
        mockCambiar.mockResolvedValue({ success: true });
        render(<CambiarClaveForm />);
        await llenar();
        await userEvent.click(screen.getByRole('button', { name: 'Cambiar mi clave' }));

        expect(mockCambiar).toHaveBeenCalledWith({
            actual: 'Inicial-Ab12-Cd34',
            nueva: 'MiClaveNueva2026',
            confirmacion: 'MiClaveNueva2026',
        });
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Su clave quedó cambiada'));
        expect(screen.getByLabelText('Clave actual')).toHaveValue('');
        expect(screen.getByLabelText('Clave nueva')).toHaveValue('');
    });

    it('muestra el motivo si el servidor la rechaza', async () => {
        mockCambiar.mockResolvedValue({ success: false, error: 'La clave actual no es correcta.' });
        render(<CambiarClaveForm />);
        await llenar();
        await userEvent.click(screen.getByRole('button', { name: 'Cambiar mi clave' }));

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('La clave actual no es correcta.'));
        expect(screen.queryByRole('status')).toBeNull();
    });
});
