import { render, screen } from '@testing-library/react';

jest.mock('./actions', () => ({ deletePatientAction: jest.fn() }));
jest.mock('./PatientModal', () => () => null);

import PatientClientView from './PatientClientView';

const paciente = (id: string, fullName: string) =>
    ({
        id,
        fullName,
        cedula: id,
        whatsappId: null,
        telegramChatId: null,
        telegramBlockedAt: null,
        user: { email: null },
    }) as never;

describe('PatientClientView — autorización de datos', () => {
    it('muestra si autorizó, si la retiró, o «—»', () => {
        render(
            <PatientClientView
                patients={[paciente('p1', 'Ana'), paciente('p2', 'Beto'), paciente('p3', 'Carla')]}
                autorizaciones={{
                    p1: { estado: 'AUTORIZO', fecha: '2026-11-20T15:00:00.000Z', canal: 'WHATSAPP', version: '1' },
                    p2: { estado: 'RETIRO', fecha: '2026-11-21T15:00:00.000Z', canal: 'TELEGRAM', version: '1' },
                }}
            />,
        );
        expect(screen.getByRole('columnheader', { name: 'Autorización de datos' })).toBeInTheDocument();
        expect(screen.getByText(/✓ Autorizó/).closest('tr')).toHaveTextContent('Ana');
        expect(screen.getByText(/✓ Autorizó/)).toHaveAttribute('title', 'Autorizó por WhatsApp, versión 1 de la política');
        expect(screen.getByText(/Retiró/).closest('tr')).toHaveTextContent('Beto');
        expect(screen.getByText('Carla').closest('tr')).toHaveTextContent('—');
    });

    it('sin autorizaciones (o si no cargaron), la tabla sale igual', () => {
        render(<PatientClientView patients={[paciente('p1', 'Ana')]} />);
        expect(screen.getByText('Ana').closest('tr')).toHaveTextContent('—');
    });
});
