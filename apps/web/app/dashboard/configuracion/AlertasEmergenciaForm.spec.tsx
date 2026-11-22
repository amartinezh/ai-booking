import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/alertas-emergencia', () => ({
    guardarAlertasEmergenciaAction: jest.fn(),
    probarAlertaEmergenciaAction: jest.fn(),
}));

import AlertasEmergenciaForm from './AlertasEmergenciaForm';
import { guardarAlertasEmergenciaAction, probarAlertaEmergenciaAction } from '@/app/actions/alertas-emergencia';

const guardar = guardarAlertasEmergenciaAction as jest.Mock;
const probar = probarAlertaEmergenciaAction as jest.Mock;

const ANA = {
    id: 'a',
    label: 'Jefe de Urgencias',
    phone: '573001112233',
    telefono: '+57 300 111 2233',
    isActive: true,
    estado: { tono: 'ok' as const, texto: 'Entregado · sáb, 22 nov, 09:00 a m' },
};
const PLANTILLA = { name: 'alerta_posible_emergencia', language: 'es_CO', isActive: true };

describe('AlertasEmergenciaForm', () => {
    beforeEach(() => jest.clearAllMocks());

    it('vacía y con un fijo de soporte: dice que no le llegan a nadie, y cómo crear la plantilla', () => {
        render(<AlertasEmergenciaForm personas={[]} plantilla={null} telefonoSoporte="+57 606 853 8860" />);
        expect(screen.getByText(/no le llegan a nadie: el teléfono de soporte \(\+57 606 853 8860\) no es un celular/)).toBeInTheDocument();
        expect(screen.getByText('Falta la plantilla de Meta.')).toBeInTheDocument();
        expect(screen.getByText('alerta_posible_emergencia')).toBeInTheDocument();
        expect(screen.getByText(/Teléfono del paciente: \{\{2\}\}/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Canales › Plantillas' })).toHaveAttribute('href', '/dashboard/configuracion/canales#plantillas');
    });

    it('agregar a alguien y guardar manda la lista entera', async () => {
        guardar.mockResolvedValue({ success: true, data: { activas: 1 } });
        render(<AlertasEmergenciaForm personas={[]} plantilla={PLANTILLA} telefonoSoporte={null} />);
        await userEvent.click(screen.getByRole('button', { name: '+ Agregar persona' }));
        await userEvent.type(screen.getByLabelText('Nombre o cargo'), 'Coordinación médica');
        await userEvent.type(screen.getByLabelText('Celular con WhatsApp'), '3146793010');
        expect(screen.getByText('Hay cambios sin guardar')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Guardar la lista' }));
        expect(guardar).toHaveBeenCalledWith([{ id: null, label: 'Coordinación médica', telefono: '3146793010', isActive: true }]);
        await waitFor(() => expect(screen.getByText('✓ Guardado')).toBeInTheDocument());
    });

    it('un fijo en la lista: lo dice al escribirlo', async () => {
        render(<AlertasEmergenciaForm personas={[]} plantilla={PLANTILLA} telefonoSoporte={null} />);
        await userEvent.click(screen.getByRole('button', { name: '+ Agregar persona' }));
        await userEvent.type(screen.getByLabelText('Celular con WhatsApp'), '6068538860');
        expect(screen.getByText(/Un fijo no recibe WhatsApp/)).toBeInTheDocument();
    });

    it('cada persona dice cómo le fue con su último envío, y se le puede mandar una prueba', async () => {
        probar.mockResolvedValue({ success: true, data: null });
        render(<AlertasEmergenciaForm personas={[ANA]} plantilla={PLANTILLA} telefonoSoporte={null} />);
        expect(screen.getByText('✓ Plantilla registrada:', { exact: false })).toBeInTheDocument();
        expect(screen.getByText(/^Entregado/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Enviar prueba' }));
        expect(probar).toHaveBeenCalledWith('a');
        expect(await screen.findByRole('status')).toHaveTextContent('Meta la aceptó');
    });

    it('sin la plantilla, la prueba no se puede mandar', () => {
        render(<AlertasEmergenciaForm personas={[ANA]} plantilla={null} telefonoSoporte={null} />);
        expect(screen.getByRole('button', { name: 'Enviar prueba' })).toBeDisabled();
    });

    it('si el servidor rechaza la lista, lo dice', async () => {
        guardar.mockResolvedValue({ success: false, error: 'Ese celular ya está en la lista.' });
        render(<AlertasEmergenciaForm personas={[ANA]} plantilla={PLANTILLA} telefonoSoporte={null} />);
        await userEvent.click(screen.getByRole('checkbox', { name: 'Recibe las alertas' }));
        await userEvent.click(screen.getByRole('button', { name: 'Guardar la lista' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Ese celular ya está en la lista.');
    });
});
