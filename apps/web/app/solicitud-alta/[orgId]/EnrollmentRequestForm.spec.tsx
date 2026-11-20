import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/enrollment-request', () => ({ submitEnrollmentRequest: jest.fn(async () => ({ success: true })) }));

import EnrollmentRequestForm from './EnrollmentRequestForm';
import { submitEnrollmentRequest } from '@/app/actions/enrollment-request';

describe('EnrollmentRequestForm — casilla de autorización de datos', () => {
    it('la casilla es obligatoria, enlaza la política y viaja con la solicitud', async () => {
        render(
            <EnrollmentRequestForm
                orgId="org-1"
                clinicName="Hospital San Vicente"
                epsNames={['Sura']}
                urlPolitica="https://h.gov.co/datos"
            />,
        );
        const casilla = screen.getByRole('checkbox');
        expect(casilla).toBeRequired();
        expect(screen.getByText(/Autorizo a Hospital San Vicente a tratar mis datos personales/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /política de tratamiento de datos/ })).toHaveAttribute(
            'href',
            'https://h.gov.co/datos',
        );

        await userEvent.type(screen.getByPlaceholderText('Número de documento *'), '1088123456');
        await userEvent.type(screen.getByPlaceholderText('Nombre completo *'), 'Juan Pérez');
        await userEvent.type(screen.getByPlaceholderText(/Cuéntanos tu caso/), 'Estoy afiliado desde enero.');
        await userEvent.click(casilla);
        await userEvent.click(screen.getByRole('button', { name: /Enviar solicitud/ }));
        expect(submitEnrollmentRequest).toHaveBeenCalledWith('org-1', expect.objectContaining({ autorizaDatos: true }));
    });

    it('sin enlace configurado, la casilla va sin el enlace', () => {
        render(<EnrollmentRequestForm orgId="org-1" clinicName="Clínica" epsNames={[]} />);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});
