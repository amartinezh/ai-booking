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

const cita = (id: string, origin: string, attendanceStatus: string) =>
    ({
        id,
        status: 'SCHEDULED',
        attendanceStatus,
        origin,
        reminderSentAt: null,
        epsId: null,
        eps: null,
        clinicalRecord: null,
        scheduleSlotId: `s-${id}`,
        patient: {
            id: `p-${id}`,
            fullName: `Paciente ${id}`,
            cedula: id,
            whatsappId: '573001112233',
            bsuid: null,
            telegramChatId: null,
            telegramBlockedAt: null,
            user: { email: `${id}@x` },
        },
        scheduleSlot: {
            id: `s-${id}`,
            startTime: new Date('2026-10-05T14:00:00.000Z'),
            endTime: new Date('2026-10-05T14:20:00.000Z'),
            doctor: { fullName: 'Dr. Ruiz' },
            service: { name: 'Medicina General' },
        },
    }) as never;

const fila = (nombre: string) => screen.getByText(nombre).closest('tr') as HTMLElement;
const pintar = (appointments: never[], role = 'ORG_ADMIN') =>
    render(<DashboardClient role={role} epsList={[]} doctorsList={[]} appointments={appointments} />);

/**
 * La asistencia que marca el HOSPITAL llega por el espejo. El personal tiene que
 * ver que la cita ya se atendió y que lo registró el hospital, y no poder
 * cambiarla desde AgenIA (es el registro clínico del HIS).
 */
describe('DashboardClient — asistencia registrada por el hospital', () => {
    it('una cita del hospital ya atendida se ve como ATENDIDA, con la constancia y sin selector', () => {
        pintar([cita('h1', 'MIRROR', 'ATTENDED')]);
        const f = fila('Paciente h1');

        expect(f).toHaveTextContent('ATENDIDA');
        expect(f).toHaveTextContent('✅ Atendida');
        expect(f).toHaveTextContent('Asistencia registrada por el hospital');
        expect(f).toHaveTextContent('🏥 Hospital');
        expect(f.querySelector('select')).toBeNull();
    });

    it('una cita del hospital pendiente dice que la asistencia la registra el hospital, sin selector', () => {
        pintar([cita('h2', 'MIRROR', 'PENDING')]);
        const f = fila('Paciente h2');

        expect(f).toHaveTextContent('En espera');
        expect(f).toHaveTextContent('La registra el hospital');
        expect(f.querySelector('select')).toBeNull();
    });

    it('una inasistencia del hospital se ve como NO ASISTIÓ', () => {
        pintar([cita('h3', 'MIRROR', 'NO_SHOW')]);

        expect(fila('Paciente h3')).toHaveTextContent('NO ASISTIÓ');
    });

    it('una cita agendada en AgenIA conserva el selector editable', () => {
        pintar([cita('w1', 'WHATSAPP', 'PENDING')]);
        const f = fila('Paciente w1');

        expect(f.querySelector('select')).not.toBeNull();
        expect(f).not.toHaveTextContent('🏥 Hospital');
    });

    it('una cita de AgenIA atendida también muestra ATENDIDA como estado', () => {
        pintar([cita('w2', 'WHATSAPP', 'ATTENDED')]);

        expect(fila('Paciente w2')).toHaveTextContent('ATENDIDA');
    });
});
