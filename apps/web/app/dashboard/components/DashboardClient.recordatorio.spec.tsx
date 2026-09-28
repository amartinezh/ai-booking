import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), refresh: jest.fn(), push: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
jest.mock('sonner', () => ({
    toast: { loading: jest.fn(() => 'toast-1'), success: jest.fn(), error: jest.fn() },
}));
jest.mock('@/app/actions/dashboard', () => ({
    cancelAppointmentAndFreeSlot: jest.fn(),
    updateAttendance: jest.fn(),
    sendManualReminder: jest.fn(async () => ({ success: true, reminderSentAt: null })),
}));
jest.mock('./ClinicalRecordDrawer', () => () => null);

import DashboardClient from './DashboardClient';
import { toast } from 'sonner';

/**
 * El botón de recordatorio le dice al personal por DÓNDE saldrá
 * (docs/PLAN_TELEGRAM.md, T4): WhatsApp como siempre, Telegram para una cita
 * de Telegram, y WhatsApp si el paciente bloqueó al bot.
 */
const cita = (id: string, origin: string, patient: Record<string, unknown>) =>
    ({
        id,
        status: 'SCHEDULED',
        attendanceStatus: 'PENDING',
        origin,
        reminderSentAt: null,
        epsId: null,
        eps: null,
        clinicalRecord: null,
        patient: {
            id: `p-${id}`,
            fullName: `Paciente ${id}`,
            cedula: id,
            whatsappId: '573001112233',
            bsuid: null,
            telegramChatId: null,
            telegramBlockedAt: null,
            user: { email: `${id}@x` },
            ...patient,
        },
        scheduleSlot: {
            id: `s-${id}`,
            startTime: new Date('2026-10-01T14:00:00.000Z'),
            endTime: new Date('2026-10-01T14:30:00.000Z'),
            doctor: { fullName: 'Dr. Ruiz' },
            service: { name: 'Medicina General' },
        },
    }) as never;

const fila = (nombre: string) => screen.getByText(nombre).closest('tr') as HTMLElement;

describe('DashboardClient — botón de recordatorio', () => {
    beforeEach(() => {
        render(
            <DashboardClient
                role="ORG_ADMIN"
                epsList={[]}
                doctorsList={[]}
                appointments={[
                    cita('wa', 'WHATSAPP', {}),
                    cita('tg', 'TELEGRAM', { telegramChatId: '777' }),
                    cita('bloq', 'TELEGRAM', { telegramChatId: '888', telegramBlockedAt: new Date() }),
                ]}
            />,
        );
    });

    it('cita de WhatsApp: el texto de siempre', () => {
        const boton = within(fila('Paciente wa')).getByRole('button', { name: /Recordar por/ });
        expect(boton).toHaveTextContent('Recordar por WhatsApp');
        expect(boton).toHaveAttribute('title', 'Enviar recordatorio manual por WhatsApp');
    });

    it('cita de Telegram: dice Telegram', () => {
        const boton = within(fila('Paciente tg')).getByRole('button', { name: /Recordar por/ });
        expect(boton).toHaveTextContent('Recordar por Telegram');
        expect(boton).toHaveAttribute('title', 'Enviar recordatorio manual por Telegram');
    });

    it('cita de Telegram de quien bloqueó al bot: dice WhatsApp (por ahí saldrá)', () => {
        const boton = within(fila('Paciente bloq')).getByRole('button', { name: /Recordar por/ });
        expect(boton).toHaveTextContent('Recordar por WhatsApp');
    });

    it('el aviso de «Enviando…» nombra el mismo canal que el botón', async () => {
        await userEvent.click(within(fila('Paciente tg')).getByRole('button', { name: /Recordar por/ }));
        expect(toast.loading).toHaveBeenLastCalledWith('Enviando recordatorio por Telegram...');
        await userEvent.click(within(fila('Paciente wa')).getByRole('button', { name: /Recordar por/ }));
        expect(toast.loading).toHaveBeenLastCalledWith('Enviando recordatorio por WhatsApp...');
    });
});
