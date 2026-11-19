import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({
    setMySaturdayRuralSharePercent: jest.fn(),
    getMySabadoRuralEstado: jest.fn(),
}));

import SabadoRuralSetting from './SabadoRuralSetting';
import { getMySabadoRuralEstado, setMySaturdayRuralSharePercent } from '@/app/actions/settings';

const mockSet = setMySaturdayRuralSharePercent as jest.Mock;
const mockEstado = getMySabadoRuralEstado as jest.Mock;

const ESTADO = {
    porcentaje: 50,
    conEspejo: true,
    lista: { total: 27729, recibidaEn: '2026-11-20T12:00:00.000Z' },
    bloqueoSabado: null,
    ultimoCambio: {
        detalle: '«Sábados por el asistente» cambió de «Sin regla especial» a «Solo zona rural, hasta el 50 % de cada médico» desde Configuración por admin@clinica.co.',
        en: '2026-11-20T12:00:00.000Z',
    },
} as const;

describe('SabadoRuralSetting', () => {
    beforeEach(() => jest.clearAllMocks());

    it('sin regla especial (lo de fábrica): el sábado es un día más', () => {
        render(<SabadoRuralSetting initialPorcentaje={null} />);
        expect(screen.getByRole('combobox')).toHaveValue('');
        expect(screen.getByRole('status')).toHaveTextContent('el sábado es un día más');
    });

    it('con 50 %: solo zona rural, hasta el 50 % de cada médico', () => {
        render(<SabadoRuralSetting initialPorcentaje={50} />);
        expect(screen.getByRole('combobox')).toHaveValue('50');
        expect(screen.getByRole('status')).toHaveTextContent(
            'Los sábados, el asistente agenda solo a pacientes de zona rural, hasta el 50 % de cada médico; el 50 % queda para el hospital',
        );
    });

    it('muestra la lista recibida y el último cambio', () => {
        render(<SabadoRuralSetting initialPorcentaje={50} estadoInicial={{ ...ESTADO }} />);
        expect(within(screen.getByRole('list', { name: 'Estado de los sábados' })).getByText(/27\.729 pacientes de zona rural/)).toBeInTheDocument();
        expect(screen.getByText(/Último cambio:/)).toHaveTextContent('admin@clinica.co');
    });

    it('encendida y sin la lista: avisa que espera la lista y que mientras tanto no ofrece sábados', () => {
        render(<SabadoRuralSetting initialPorcentaje={50} estadoInicial={{ ...ESTADO, lista: null }} />);
        expect(screen.getByText(/Esperando la lista de pacientes de zona rural/)).toBeInTheDocument();
        expect(screen.getByText(/no ofrece sábados/)).toBeInTheDocument();
    });

    it('encendida con los sábados todavía en «Días sin citas»: dice que quite ese bloqueo', () => {
        render(<SabadoRuralSetting initialPorcentaje={50} estadoInicial={{ ...ESTADO, bloqueoSabado: 'COMPLETO' }} />);
        expect(screen.getByText(/Cuando quiera abrirlos a la zona rural, quite ese bloqueo/)).toBeInTheDocument();
    });

    it('al elegir guarda al instante y vuelve a leer el estado', async () => {
        mockSet.mockResolvedValue({ success: true, saturdayRuralSharePercent: 50 });
        mockEstado.mockResolvedValue({ success: true, estado: { ...ESTADO, lista: null } });
        render(<SabadoRuralSetting initialPorcentaje={null} />);
        await userEvent.selectOptions(screen.getByRole('combobox'), '50');
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('✓ Guardado'));
        expect(mockSet).toHaveBeenCalledWith(50);
        expect(screen.getByText(/Esperando la lista/)).toBeInTheDocument();
    });

    it('si falla, vuelve a lo que de verdad quedó', async () => {
        mockSet.mockResolvedValue({ success: false, error: 'Acceso denegado' });
        render(<SabadoRuralSetting initialPorcentaje={null} />);
        await userEvent.selectOptions(screen.getByRole('combobox'), '50');
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Acceso denegado'));
        expect(screen.getByRole('combobox')).toHaveValue('');
        expect(mockEstado).not.toHaveBeenCalled();
    });
});
