import { render, screen } from '@testing-library/react';

jest.mock('@/app/actions/support', () => ({
    createTicket: jest.fn(),
}));
jest.mock('@/app/actions/support-bot', () => ({
    generarCodigoAsistente: jest.fn(),
    cerrarConversacionAsistente: jest.fn(),
}));

import SupportClient from './SupportClient';

/** El botón al centro de ayuda: por ahora solo para el administrador. */
describe('SupportClient', () => {
    it('con mostrarAyuda, enlaza al centro de ayuda', () => {
        render(<SupportClient tickets={[]} mostrarAyuda />);
        expect(screen.getByRole('link', { name: /Ayuda/ })).toHaveAttribute('href', '/dashboard/soporte/ayuda');
    });

    it('sin mostrarAyuda, no hay botón de ayuda', () => {
        render(<SupportClient tickets={[]} />);
        expect(screen.queryByRole('link', { name: /Ayuda/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Reportar Falla/ })).toBeInTheDocument();
    });
});
