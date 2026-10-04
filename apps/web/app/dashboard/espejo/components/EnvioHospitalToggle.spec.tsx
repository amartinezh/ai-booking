import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/espejo', () => ({
    cambiarEnvioAlHospital: jest.fn(),
}));

import EnvioHospitalToggle from './EnvioHospitalToggle';
import { cambiarEnvioAlHospital } from '@/app/actions/espejo';

const mockCambiar = cambiarEnvioAlHospital as jest.Mock;

/** Interruptor del envío de AgenIA hacia el hospital: pide confirmación y guarda al instante. */
describe('EnvioHospitalToggle', () => {
    let confirmSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    });
    afterEach(() => confirmSpy.mockRestore());

    it('apagado lo dice claro', () => {
        render(<EnvioHospitalToggle initialEnabled={false} enCola={0} />);
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByText('Apagado: no se escribe nada en el hospital')).toBeInTheDocument();
    });

    it('apagar pide confirmación y guarda', async () => {
        mockCambiar.mockResolvedValue({ success: true });
        render(<EnvioHospitalToggle initialEnabled enCola={0} />);

        await userEvent.click(screen.getByRole('switch'));

        expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('¿Apagar el envío al hospital?'));
        expect(mockCambiar).toHaveBeenCalledWith(false);
        await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
    });

    it('al encender avisa cuántos eventos en cola van a salir hacia el hospital', async () => {
        mockCambiar.mockResolvedValue({ success: true });
        render(<EnvioHospitalToggle initialEnabled={false} enCola={4} />);

        await userEvent.click(screen.getByRole('switch'));

        expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Hay 4 evento(s) en cola'));
        expect(mockCambiar).toHaveBeenCalledWith(true);
    });

    it('si se cancela la confirmación no guarda nada', async () => {
        confirmSpy.mockReturnValue(false);
        render(<EnvioHospitalToggle initialEnabled={false} enCola={4} />);

        await userEvent.click(screen.getByRole('switch'));

        expect(mockCambiar).not.toHaveBeenCalled();
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    });
});
