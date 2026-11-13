import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({
    setMyBotAgendaSharePercent: jest.fn(),
    getMyReservaPresencialResumen: jest.fn(),
}));

import ReservaPresencialSetting from './ReservaPresencialSetting';
import { getMyReservaPresencialResumen, setMyBotAgendaSharePercent } from '@/app/actions/settings';

const mockSet = setMyBotAgendaSharePercent as jest.Mock;
const mockResumen = getMyReservaPresencialResumen as jest.Mock;

const dia = (d: string, medicosEnElTope: number) => ({
    dia: d,
    medicos: 2,
    capacidad: 27,
    tope: 21,
    chat: 17,
    otras: 6,
    libres: 4,
    medicosEnElTope,
});
const RESUMEN = {
    porcentaje: 80,
    hoy: '2026-11-13',
    dias: [dia('2026-11-13', 0), dia('2026-11-14', 1), dia('2026-11-17', 2)],
    ultimoCambio: {
        detalle: '«Parte de la agenda para el asistente» cambió de «Sin reserva» a «80 % para el asistente, 20 % para el hospital» desde Configuración por admin@clinica.co.',
        en: '2026-11-13T15:00:00.000Z',
    },
};

/** Parte de la agenda para el asistente: guarda al instante y muestra cómo van los próximos días. */
describe('ReservaPresencialSetting', () => {
    beforeEach(() => jest.clearAllMocks());

    it('sin reserva (lo de fábrica) lo dice así', () => {
        render(<ReservaPresencialSetting initialPorcentaje={null} />);
        expect(screen.getByRole('combobox')).toHaveValue('');
        expect(screen.getByRole('status')).toHaveTextContent('Sin reserva: el asistente puede tomar cualquier cupo libre');
        expect(screen.getByText(/el sistema del hospital no cambia/)).toBeInTheDocument();
    });

    it('con 80 % explica las dos partes', () => {
        render(<ReservaPresencialSetting initialPorcentaje={80} />);
        expect(screen.getByRole('combobox')).toHaveValue('80');
        expect(screen.getByRole('status')).toHaveTextContent(
            'El asistente agenda como mucho el 80 % de cada día de cada médico; el 20 % queda para el hospital',
        );
    });

    it('un porcentaje guardado que no está entre las opciones se muestra igual', () => {
        render(<ReservaPresencialSetting initialPorcentaje={65} />);
        expect(screen.getByRole('combobox')).toHaveValue('65');
    });

    it('la tabla de los próximos días: lleva / tope, hospital, libres y el estado', () => {
        render(<ReservaPresencialSetting initialPorcentaje={80} resumenInicial={RESUMEN} />);
        const filas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
        expect(filas.map((f) => f.textContent)).toEqual([
            'Hoy2717 / 2164El asistente puede agendar',
            'Mañana2717 / 21641 de 2 médicos en su tope',
            'mar 172717 / 2164El asistente ya tomó su parte',
        ]);
        expect(screen.getByText(/Último cambio:/)).toHaveTextContent('admin@clinica.co');
    });

    it('sin reserva la tabla no muestra tope ni estado', () => {
        render(<ReservaPresencialSetting initialPorcentaje={null} resumenInicial={{ ...RESUMEN, porcentaje: null }} />);
        expect(screen.queryByRole('columnheader', { name: 'Estado' })).toBeNull();
        expect(within(screen.getByRole('table')).getAllByRole('row')[1].textContent).toBe('Hoy271764');
    });

    it('sin agenda cargada lo dice', () => {
        render(<ReservaPresencialSetting initialPorcentaje={80} resumenInicial={{ ...RESUMEN, dias: [] }} />);
        expect(screen.getByRole('note')).toHaveTextContent('No hay agenda cargada');
    });

    it('al elegir guarda al instante y vuelve a leer los próximos días', async () => {
        mockSet.mockResolvedValue({ success: true, botAgendaSharePercent: 80 });
        mockResumen.mockResolvedValue({ success: true, resumen: RESUMEN });
        render(<ReservaPresencialSetting initialPorcentaje={null} />);
        await userEvent.selectOptions(screen.getByRole('combobox'), '80');
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('✓ Guardado'));
        expect(mockSet).toHaveBeenCalledWith(80);
        expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('«Sin reserva» manda null', async () => {
        mockSet.mockResolvedValue({ success: true, botAgendaSharePercent: null });
        mockResumen.mockResolvedValue({ success: false, error: 'x' });
        render(<ReservaPresencialSetting initialPorcentaje={80} resumenInicial={RESUMEN} />);
        await userEvent.selectOptions(screen.getByRole('combobox'), '');
        await waitFor(() => expect(mockSet).toHaveBeenCalledWith(null));
        // El resumen no se pudo leer: la tabla anterior ya no vale.
        await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
    });

    it('si falla, vuelve a lo que de verdad quedó y muestra el error', async () => {
        mockSet.mockResolvedValue({ success: false, error: 'Acceso denegado' });
        render(<ReservaPresencialSetting initialPorcentaje={null} />);
        await userEvent.selectOptions(screen.getByRole('combobox'), '80');
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Acceso denegado'));
        expect(screen.getByRole('combobox')).toHaveValue('');
        expect(mockResumen).not.toHaveBeenCalled();
    });
});
