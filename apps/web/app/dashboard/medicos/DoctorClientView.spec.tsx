import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./DoctorModal', () => () => null);
jest.mock('./actions', () => ({ deleteDoctorAction: jest.fn() }));

import DoctorClientView from './DoctorClientView';

const medico = (id: string, over: Record<string, unknown> = {}) =>
    ({
        id,
        fullName: 'YULIETH ANDREA RIOS AGUIRRE',
        cedula: '1002900070',
        medicalLicense: null,
        phone: null,
        isActive: true,
        whatsappBookingEnabled: false,
        serviceId: 'srv-mg',
        service: { id: 'srv-mg', name: 'Consulta ambulatoria de medicina general' },
        user: { email: `${id}@hsvp.gov.co` },
        ...over,
    }) as never;

const MEDICOS = [
    medico('yulieth'),
    medico('adrian', { fullName: 'ADRIAN CAMILO SALAZAR SANCHEZ', cedula: '1193031152', whatsappBookingEnabled: true }),
    medico('hta', {
        fullName: 'Programa de Hipertensión',
        cedula: '77123456789-077',
        whatsappBookingEnabled: true,
        service: { id: 'srv-hta', name: 'Consulta ambularoria control hipertensos' },
    }),
];

const pintar = () =>
    render(<DoctorClientView doctors={MEDICOS} services={[]} codigosHis={{ yulieth: 'RU69', adrian: 'MD09' }} />);
const nombresVisibles = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);
const buscador = () => screen.getByRole('searchbox', { name: 'Buscar médicos' });

describe('Médicos — buscar por lo que sea', () => {
    it('sin filtros muestra todos, con el conteo', () => {
        pintar();
        expect(nombresVisibles()).toHaveLength(3);
        expect(screen.getByRole('status')).toHaveTextContent('Mostrando 3 de 3 médicos');
    });

    it('🧾 por el código del hospital (RU69) encuentra a la Dra. Yulieth, y la tarjeta lo muestra', async () => {
        pintar();
        await userEvent.type(buscador(), 'ru69');
        expect(nombresVisibles()).toEqual(['YULIETH ANDREA RIOS AGUIRRE']);
        expect(screen.getByRole('status')).toHaveTextContent('Mostrando 1 de 3 médicos');
        expect(screen.getByText('Código en el hospital').nextSibling).toHaveTextContent('RU69');
    });

    it('sin tildes y por partes del nombre', async () => {
        pintar();
        await userEvent.type(buscador(), 'hipertension');
        expect(nombresVisibles()).toEqual(['Programa de Hipertensión']);
    });

    it('WhatsApp OFF, con cuántos hay en cada botón', async () => {
        pintar();
        const grupo = screen.getByRole('group', { name: 'WhatsApp' });
        expect(within(grupo).getByRole('button', { name: /ON/ })).toHaveTextContent('ON (2)');
        await userEvent.click(within(grupo).getByRole('button', { name: /OFF/ }));
        expect(nombresVisibles()).toEqual(['YULIETH ANDREA RIOS AGUIRRE']);
        expect(within(grupo).getByRole('button', { name: /OFF/ })).toHaveAttribute('aria-pressed', 'true');
    });

    it('sin resultados lo dice, y «Limpiar filtros» vuelve a mostrar todos', async () => {
        pintar();
        await userEvent.type(buscador(), 'no existe');
        expect(screen.getByText('Ningún médico coincide con la búsqueda')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
        expect(nombresVisibles()).toHaveLength(3);
        expect(buscador()).toHaveValue('');
    });
});
