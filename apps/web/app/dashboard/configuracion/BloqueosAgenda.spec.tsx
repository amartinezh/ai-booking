import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/bloqueos-agenda', () => ({
    crearBloqueoAgenda: jest.fn(),
    quitarBloqueoAgenda: jest.fn(),
}));

import BloqueosAgenda from './BloqueosAgenda';
import { crearBloqueoAgenda, quitarBloqueoAgenda } from '@/app/actions/bloqueos-agenda';

const mockCrear = crearBloqueoAgenda as jest.Mock;
const mockQuitar = quitarBloqueoAgenda as jest.Mock;

const HOY = '2026-10-22'; // jueves
const SABADOS = {
    id: 'b-1',
    date: '2026-10-24',
    repeatWeekly: true,
    startMinute: null,
    endMinute: null,
    note: 'Sábados',
    createdByEmail: null,
};

const dia = (prefijo: string) => screen.getByRole('button', { name: new RegExp(`^${prefijo}`) });

describe('BloqueosAgenda — Configuración › Días sin citas', () => {
    beforeEach(() => jest.clearAllMocks());

    it('sin día elegido invita a elegir uno; sin bloqueos lo dice', () => {
        render(<BloqueosAgenda inicial={{ hoy: HOY, bloqueos: [] }} />);
        expect(screen.getByText('Octubre 2026')).toBeInTheDocument();
        expect(screen.getByText('Elija un día en el calendario')).toBeInTheDocument();
        expect(screen.getByText(/No hay días ni horas bloqueados/)).toBeInTheDocument();
    });

    it('los días que ya pasaron no se pueden elegir', () => {
        render(<BloqueosAgenda inicial={{ hoy: HOY, bloqueos: [] }} />);
        expect(dia('miércoles 21 de octubre de 2026')).toBeDisabled();
        expect(dia('jueves 22 de octubre de 2026 \\(hoy\\)')).toBeEnabled();
    });

    it('🧾 el caso del hospital: «todos los sábados, todo el día»', async () => {
        mockCrear.mockResolvedValue({ success: true, hoy: HOY, bloqueos: [SABADOS] });
        render(<BloqueosAgenda inicial={{ hoy: HOY, bloqueos: [] }} />);

        await userEvent.click(dia('sábado 24 de octubre de 2026'));
        expect(screen.getByRole('heading', { name: 'Sábado 24 de octubre de 2026' })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('checkbox', { name: /Repetir todos los sábados/ }));
        expect(screen.getByTestId('resumen-bloqueo')).toHaveTextContent(
            'El asistente no ofrecerá citas todos los sábados, todo el día, a partir del sábado 24 de octubre de 2026.',
        );

        await userEvent.type(screen.getByRole('textbox', { name: /Motivo/ }), 'Sábados');
        await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));

        expect(mockCrear).toHaveBeenCalledWith({
            date: '2026-10-24',
            repeatWeekly: true,
            startMinute: null,
            endMinute: null,
            note: 'Sábados',
        });
        expect(await screen.findByRole('status')).toHaveTextContent('ya no ofrecerá esas citas');
        // La lista y el calendario ya lo muestran: también el sábado 31.
        const lista = screen.getByRole('region', { name: 'Bloqueos activos' });
        expect(within(lista).getByText(/Todos los sábados/)).toBeInTheDocument();
        expect(within(lista).getByText(/Próximos: 24 oct\., 31 oct\., 7 nov\./)).toBeInTheDocument();
        expect(dia('sábado 31 de octubre de 2026')).toHaveAccessibleName(/sin citas todo el día/);
    });

    it('🕗 unas horas de un viernes: de 8 a 10 a. m.', async () => {
        mockCrear.mockResolvedValue({ success: true, hoy: HOY, bloqueos: [] });
        render(<BloqueosAgenda inicial={{ hoy: HOY, bloqueos: [] }} />);

        await userEvent.click(dia('viernes 23 de octubre de 2026'));
        await userEvent.click(screen.getByRole('radio', { name: /Unas horas/ }));
        expect(screen.getByText(/empiecen desde las 8:00 a\. m\. y antes de las 10:00 a\. m\./)).toBeInTheDocument();
        expect(screen.getByTestId('resumen-bloqueo')).toHaveTextContent(
            'el viernes 23 de octubre de 2026, de 8:00 a. m. a 10:00 a. m.',
        );

        await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
        expect(mockCrear).toHaveBeenCalledWith({
            date: '2026-10-23',
            repeatWeekly: false,
            startMinute: 480,
            endMinute: 600,
            note: null,
        });
    });

    it('unas horas al revés: avisa y no deja guardar', async () => {
        render(<BloqueosAgenda inicial={{ hoy: HOY, bloqueos: [] }} />);
        await userEvent.click(dia('viernes 23 de octubre de 2026'));
        await userEvent.click(screen.getByRole('radio', { name: /Unas horas/ }));
        const hasta = screen.getByLabelText('Hasta');
        await userEvent.clear(hasta);
        await userEvent.type(hasta, '07:00');

        expect(screen.getByText('La hora final debe ser después de la hora inicial.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Bloquear' })).toBeDisabled();
    });

    it('si el servidor lo rechaza, muestra el motivo', async () => {
        mockCrear.mockResolvedValue({ success: false, error: 'Ese bloqueo ya existe.' });
        render(<BloqueosAgenda inicial={{ hoy: HOY, bloqueos: [SABADOS] }} />);
        await userEvent.click(dia('sábado 24 de octubre de 2026'));
        // El día ya bloqueado lo dice antes de agregar otro.
        expect(screen.getByText('Este día ya tiene:')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Ese bloqueo ya existe.');
    });

    it('quitar pide confirmación y luego quita', async () => {
        mockQuitar.mockResolvedValue({ success: true, hoy: HOY, bloqueos: [] });
        const confirmar = jest.spyOn(window, 'confirm');
        render(<BloqueosAgenda inicial={{ hoy: HOY, bloqueos: [SABADOS] }} />);
        const boton = screen.getByRole('button', { name: /Quitar Todos los sábados/ });

        confirmar.mockReturnValueOnce(false);
        await userEvent.click(boton);
        expect(mockQuitar).not.toHaveBeenCalled();

        confirmar.mockReturnValueOnce(true);
        await userEvent.click(boton);
        expect(mockQuitar).toHaveBeenCalledWith('b-1');
        expect(await screen.findByText(/No hay días ni horas bloqueados/)).toBeInTheDocument();
        confirmar.mockRestore();
    });
});
