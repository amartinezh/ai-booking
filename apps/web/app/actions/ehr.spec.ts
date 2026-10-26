/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        systemLog: { create: jest.fn(async () => ({})) },
        appointment: { findFirst: jest.fn() },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({
    cookies: jest.fn(async () => ({ get: () => ({ value: 'token' }) })),
    headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-forwarded-for' ? '181.49.3.3' : null) })),
}));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { createClinicalRecord, fetchClinicalRecordByAppointment, signClinicalRecordAction } from './ehr';

const mockLog = prisma.systemLog.create as jest.Mock;
const registros = () => mockLog.mock.calls.map((c) => c[0].data);
const MEDICO = { role: 'DOCTOR', organizationId: 'org-1', userId: 'u-doc', email: 'dra@clinica.co' };
const CITA = {
    id: 'apt-1',
    organizationId: 'org-1',
    patient: { cedula: '1053123456' },
    clinicalRecord: { id: 'hc-1', recordNumber: 77 },
    scheduleSlot: {
        startTime: new Date('2026-10-28T13:20:00Z'),
        doctor: { fullName: 'Dra. Pérez' },
        service: { name: 'Medicina general' },
    },
};
const fetchOriginal = global.fetch;

beforeEach(() => {
    jest.clearAllMocks();
    (getSession as jest.Mock).mockResolvedValue(MEDICO);
    (prisma.appointment.findFirst as jest.Mock).mockResolvedValue(CITA);
});
afterAll(() => {
    global.fetch = fetchOriginal;
});

describe('historia clínica en la Actividad de usuarios (2026-10-27)', () => {
    it('abrir una historia que existe queda (quién, qué cita); si no hay historia, no', async () => {
        global.fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ id: 'hc-1' }) })) as unknown as typeof fetch;
        await fetchClinicalRecordByAppointment('apt-1');
        global.fetch = jest.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
        await fetchClinicalRecordByAppointment('apt-2');
        expect(registros()).toHaveLength(1);
        const [d] = registros();
        expect(d).toMatchObject({ action: 'CLINICAL_RECORD_VIEWED', userId: 'u-doc', organizationId: 'org-1' });
        expect(d.metadata.detalle).toMatch(/^Historia #77 · Medicina general · Dra\. Pérez · 28\/10\/2026 08:20/);
        expect(d.metadata.detalle).toContain('paciente ••••3456');
    });

    it('escribirla no copia su contenido clínico', async () => {
        global.fetch = jest.fn(async () => ({ ok: true })) as unknown as typeof fetch;
        await createClinicalRecord({
            appointmentId: 'apt-1',
            doctorId: 'doc-1',
            chiefComplaint: 'DOLOR TORÁCICO INTENSO',
            currentIllness: 'tres días de evolución',
        });
        const [d] = registros();
        expect(d.action).toBe('CLINICAL_RECORD_CREATED');
        expect(JSON.stringify(d)).not.toMatch(/DOLOR TORÁCICO|evolución|1053123456/);
    });

    it('la firma lleva la IP real de quien firma (antes «Vía Web») y queda como aviso', async () => {
        const fetchMock = jest.fn(async () => ({ ok: true }));
        global.fetch = fetchMock as unknown as typeof fetch;
        await signClinicalRecordAction('hc-1', 'u-doc');
        const cuerpo = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
        expect(cuerpo.ipAddress).toBe('181.49.3.3');
        expect(registros()[0]).toMatchObject({ action: 'CLINICAL_RECORD_SIGNED', level: 'WARNING' });
    });

    it('si la API la rechaza, no queda nada', async () => {
        global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;
        await signClinicalRecordAction('hc-1', 'u-doc');
        expect(mockLog).not.toHaveBeenCalled();
    });
});
