import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/settings', () => ({
    setMyAutoHomologacion: jest.fn(async () => ({ success: true })),
    setMyAutoHomologacionWhatsapp: jest.fn(async () => ({ success: true })),
}));

import HomologacionAutomatica from './HomologacionAutomatica';
import { setMyAutoHomologacion, setMyAutoHomologacionWhatsapp } from '@/app/actions/settings';

describe('HomologacionAutomatica — médicos nuevos del hospital', () => {
    beforeEach(() => jest.clearAllMocks());

    it('apagado de fábrica lo dice: queda en la Bandeja con su botón', () => {
        render(<HomologacionAutomatica auto={false} whatsappOn={false} />);
        expect(screen.getByText('Agregar solos los médicos nuevos del hospital')).toBeInTheDocument();
        expect(screen.getByText(/el administrador lo crea con el botón «Crear y homologar»/)).toBeInTheDocument();
        expect(screen.getByText(/Recomendado: el hospital decide médico por médico/)).toBeInTheDocument();
    });

    it('cada interruptor guarda lo suyo', async () => {
        render(<HomologacionAutomatica auto={false} whatsappOn={false} />);
        const [auto, whatsapp] = screen.getAllByRole('switch');
        await userEvent.click(auto);
        await waitFor(() => expect(setMyAutoHomologacion).toHaveBeenCalledWith(true));
        await userEvent.click(whatsapp);
        await waitFor(() => expect(setMyAutoHomologacionWhatsapp).toHaveBeenCalledWith(true));
    });
});
