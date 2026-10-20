import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), refresh: jest.fn(), push: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
jest.mock('sonner', () => ({ toast: { loading: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('@/app/actions/dashboard', () => ({
    cancelAppointmentAndFreeSlot: jest.fn(),
    updateAttendance: jest.fn(),
    sendManualReminder: jest.fn(),
}));
jest.mock('./ClinicalRecordDrawer', () => () => null);

import DashboardClient from './DashboardClient';

/** Los avisos de la Visión General: desde cuándo se ve y si se cortó por el tope. */
describe('DashboardClient — avisos de la ventana de citas', () => {
    const pintar = (props: { desdeHoy?: boolean; hayMas?: boolean; tope?: number }) =>
        render(<DashboardClient appointments={[]} epsList={[]} doctorsList={[]} role="BOOKING_AGENT" {...props} />);

    it('sin fecha inicial, dice que se ven desde hoy y cómo ver las anteriores', () => {
        pintar({ desdeHoy: true });
        expect(screen.getByText(/Se muestran las citas desde hoy/)).toHaveTextContent('elija una fecha inicial');
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('si se cortó por el tope, lo dice con la cifra y cómo acotar', () => {
        pintar({ hayMas: true, tope: 500 });
        expect(screen.getByRole('status')).toHaveTextContent(
            'Se muestran las primeras 500 citas. Para ver las demás, acote con las fechas, el médico o la EPS.',
        );
    });

    it('con un rango elegido y sin corte, no hay avisos', () => {
        pintar({ desdeHoy: false, hayMas: false });
        expect(screen.queryByText(/Se muestran/)).toBeNull();
    });
});
