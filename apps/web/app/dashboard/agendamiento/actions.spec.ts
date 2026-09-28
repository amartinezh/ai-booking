/**
 * Las acciones de la pantalla de agendamiento comprobaban SOLO que hubiera sesión con
 * clínica: ni el rol ni el alcance (§12 #12 del plan del rastreo). Una acción de
 * servidor es un endpoint público —basta el id de la acción, que está en el bundle del
 * cliente—, así que cualquier sesión de la clínica podía crear y mover citas ajenas.
 *
 * Estas pruebas fijan las tres barreras, en orden: rol de agenda, clínica del token y
 * el alcance con el que la pantalla lista las citas. Y comprueban lo que de verdad
 * importa: que cuando se rechaza, NO se escribe nada.
 */
jest.mock('../../../lib/prisma', () => {
    const prisma = {
        appointment: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
        patientProfile: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        scheduleSlot: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        user: { create: jest.fn() },
        agentProfile: { findUnique: jest.fn() },
        doctorProfile: { findUnique: jest.fn() },
        hospitalMirrorConfig: { findUnique: jest.fn() },
        eps: { findFirst: jest.fn() },
        epsEnrolledPatient: { findMany: jest.fn(async () => []) },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
    return { prisma };
});
jest.mock('../../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('../../../lib/eps-enrollment', () => ({ findEpsEnrollmentIssue: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn(async () => ({ get: () => ({ value: 't' }) })) }));

import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { findEpsEnrollmentIssue } from '../../../lib/eps-enrollment';
import {
    createManualAppointmentAction,
    sendManualWhatsappAction,
    updateManualAppointmentAction,
} from './actions';

const mockGetSession = getSession as jest.Mock;
const mockFindFirst = prisma.appointment.findFirst as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;
const mockAgentProfile = prisma.agentProfile.findUnique as jest.Mock;
const mockDoctorProfile = prisma.doctorProfile.findUnique as jest.Mock;
const mockEnrollment = findEpsEnrollmentIssue as jest.Mock;

/** La cita que el doble devuelve: EPS «eps-1», médico «doc-1». */
const CITA = { id: 'apt-1', epsId: 'eps-1', patientId: 'pac-1', scheduleSlotId: 'slot-1', patient: { bsuid: 'CO.123', whatsappId: null }, scheduleSlot: { doctorId: 'doc-1' } };

const sesion = (over: Record<string, unknown> = {}) => ({ userId: 'u-1', email: 'x@y.co', role: 'ORG_ADMIN', organizationId: 'org-1', ...over });

/** Formulario válido: misma EPS y mismo médico que CITA. */
const form = (over: Record<string, string> = {}) => {
    const fd = new FormData();
    const campos: Record<string, string> = {
        cedula: '1053123456',
        fullName: 'María López',
        epsId: 'eps-1',
        serviceId: 'srv-1',
        doctorId: 'doc-1',
        startDate: '2026-10-01T15:00:00.000Z',
        ...over,
    };
    for (const [k, v] of Object.entries(campos)) fd.set(k, v);
    return fd;
};

const noSeEscribioNada = () => {
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(prisma.patientProfile.create).not.toHaveBeenCalled();
    expect(prisma.patientProfile.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.scheduleSlot.create).not.toHaveBeenCalled();
    expect(prisma.scheduleSlot.update).not.toHaveBeenCalled();
};

beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(sesion());
    mockFindFirst.mockResolvedValue({ ...CITA });
    mockAgentProfile.mockResolvedValue(null);
    mockDoctorProfile.mockResolvedValue({ id: 'doc-1' });
    mockEnrollment.mockResolvedValue(null);
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) })) as never;
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. El rol
// ═════════════════════════════════════════════════════════════════════════════

describe('🔐 solo los roles que operan la agenda', () => {
    const PROHIBIDOS = ['PATIENT', 'GENERAL_OBSERVER', 'SUPER_ADMIN', 'ROL_FUTURO'];

    it.each(PROHIBIDOS)('%s no puede CREAR una cita, y no se escribe nada', async (role) => {
        mockGetSession.mockResolvedValue(sesion({ role }));

        const res = await createManualAppointmentAction(form());

        expect(res).toEqual({ success: false, error: 'No tiene permisos para operar la agenda.' });
        noSeEscribioNada();
        // Ni siquiera se consulta el padrón: se corta antes de tocar la base.
        expect(mockEnrollment).not.toHaveBeenCalled();
    });

    it.each(PROHIBIDOS)('%s no puede MODIFICAR una cita, y no se escribe nada', async (role) => {
        mockGetSession.mockResolvedValue(sesion({ role }));

        const res = await updateManualAppointmentAction('apt-1', form());

        expect(res.success).toBe(false);
        noSeEscribioNada();
    });

    it.each(PROHIBIDOS)('%s no puede mandar un WhatsApp al paciente', async (role) => {
        mockGetSession.mockResolvedValue(sesion({ role }));

        const res = await sendManualWhatsappAction('apt-1', 'hola');

        expect(res.success).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
        // Tampoco se lee la cita: no sirve como oráculo de existencia.
        expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it.each(['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR'])('%s sí pasa la barrera del rol', async (role) => {
        mockGetSession.mockResolvedValue(sesion({ role }));

        await createManualAppointmentAction(form());

        // Pasó del rol y del alcance: llegó a comprobar el padrón.
        expect(mockEnrollment).toHaveBeenCalled();
    });

    it('sin sesión, o con sesión sin clínica, tampoco', async () => {
        for (const s of [null, sesion({ organizationId: null })]) {
            mockGetSession.mockResolvedValue(s);
            expect((await createManualAppointmentAction(form())).success).toBe(false);
            expect((await updateManualAppointmentAction('apt-1', form())).success).toBe(false);
            expect((await sendManualWhatsappAction('apt-1', 'hola')).success).toBe(false);
        }
        noSeEscribioNada();
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. El alcance
// ═════════════════════════════════════════════════════════════════════════════

describe('🎯 el alcance del agente y del médico', () => {
    const agenteDeOtraEps = () => {
        mockGetSession.mockResolvedValue(sesion({ role: 'BOOKING_AGENT' }));
        mockAgentProfile.mockResolvedValue({ epsId: 'eps-9', doctorId: null });
    };

    it('un agente acotado a otra EPS no crea la cita', async () => {
        agenteDeOtraEps();

        const res = await createManualAppointmentAction(form({ epsId: 'eps-1' }));

        expect(res).toEqual({ success: false, error: 'Esta cita está fuera de su alcance (EPS o médico asignados).' });
        noSeEscribioNada();
    });

    it('un agente acotado a otro médico no crea la cita', async () => {
        mockGetSession.mockResolvedValue(sesion({ role: 'BOOKING_AGENT' }));
        mockAgentProfile.mockResolvedValue({ epsId: null, doctorId: 'doc-9' });

        const res = await createManualAppointmentAction(form({ doctorId: 'doc-1' }));

        expect(res.success).toBe(false);
        noSeEscribioNada();
    });

    it('un agente global (sin perfil) sí crea', async () => {
        mockGetSession.mockResolvedValue(sesion({ role: 'BOOKING_AGENT' }));
        mockAgentProfile.mockResolvedValue(null);

        await createManualAppointmentAction(form());

        expect(mockEnrollment).toHaveBeenCalled();
    });

    it('un DOCTOR no crea citas en la agenda de un colega', async () => {
        mockGetSession.mockResolvedValue(sesion({ role: 'DOCTOR' }));
        mockDoctorProfile.mockResolvedValue({ id: 'doc-9' });

        const res = await createManualAppointmentAction(form({ doctorId: 'doc-1' }));

        expect(res.success).toBe(false);
        noSeEscribioNada();
    });

    it('un DOCTOR sí crea en la suya', async () => {
        mockGetSession.mockResolvedValue(sesion({ role: 'DOCTOR' }));
        mockDoctorProfile.mockResolvedValue({ id: 'doc-1' });

        await createManualAppointmentAction(form({ doctorId: 'doc-1' }));

        expect(mockEnrollment).toHaveBeenCalled();
    });

    it('un agente acotado no manda WhatsApp al paciente de otro médico', async () => {
        mockGetSession.mockResolvedValue(sesion({ role: 'BOOKING_AGENT' }));
        mockAgentProfile.mockResolvedValue({ epsId: null, doctorId: 'doc-9' });

        const res = await sendManualWhatsappAction('apt-1', 'hola');

        expect(res.success).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('si no se puede leer el perfil, no se actúa (falla cerrado)', async () => {
        mockGetSession.mockResolvedValue(sesion({ role: 'BOOKING_AGENT' }));
        mockAgentProfile.mockRejectedValue(new Error('db caída'));

        expect((await createManualAppointmentAction(form())).success).toBe(false);
        expect((await sendManualWhatsappAction('apt-1', 'hola')).success).toBe(false);
        noSeEscribioNada();
    });

    // ══════════════════════════════════════════════════════════════════════
    // Al MODIFICAR hay dos citas en juego: la que es hoy y la que va a quedar.
    // Con una sola comprobación, un agente acotado podría sacar una cita suya
    // hacia otro médico, o traerse la de un compañero hacia el suyo.
    // ══════════════════════════════════════════════════════════════════════
    describe('modificar: se comprueba el ANTES y el DESPUÉS', () => {
        it('no puede llevarse una cita suya a la agenda de otro médico', async () => {
            mockGetSession.mockResolvedValue(sesion({ role: 'BOOKING_AGENT' }));
            mockAgentProfile.mockResolvedValue({ epsId: null, doctorId: 'doc-1' });
            mockFindFirst.mockResolvedValue({ ...CITA, scheduleSlot: { doctorId: 'doc-1' } });

            const res = await updateManualAppointmentAction('apt-1', form({ doctorId: 'doc-9' }));

            expect(res.success).toBe(false);
            noSeEscribioNada();
        });

        it('no puede traerse la cita de un compañero a la suya', async () => {
            mockGetSession.mockResolvedValue(sesion({ role: 'BOOKING_AGENT' }));
            mockAgentProfile.mockResolvedValue({ epsId: null, doctorId: 'doc-1' });
            mockFindFirst.mockResolvedValue({ ...CITA, scheduleSlot: { doctorId: 'doc-9' } });

            const res = await updateManualAppointmentAction('apt-1', form({ doctorId: 'doc-1' }));

            expect(res.success).toBe(false);
            noSeEscribioNada();
        });

        it('dentro de su alcance en los dos extremos, sí modifica', async () => {
            mockGetSession.mockResolvedValue(sesion({ role: 'BOOKING_AGENT' }));
            mockAgentProfile.mockResolvedValue({ epsId: null, doctorId: 'doc-1' });
            mockFindFirst.mockResolvedValue({ ...CITA, scheduleSlot: { doctorId: 'doc-1' } });

            await updateManualAppointmentAction('apt-1', form({ doctorId: 'doc-1' }));

            expect(mockEnrollment).toHaveBeenCalled();
        });

        it('una cita de otra clínica responde «no encontrada» y no se escribe', async () => {
            mockGetSession.mockResolvedValue(sesion({ role: 'BOOKING_AGENT' }));
            mockAgentProfile.mockResolvedValue({ epsId: 'eps-1', doctorId: null });
            mockFindFirst.mockResolvedValue(null);

            const res = await updateManualAppointmentAction('apt-1', form());

            expect(res).toEqual({ success: false, error: 'Cita original no encontrada.' });
            noSeEscribioNada();
        });

        it('🏢 la cita original se busca SIEMPRE con la clínica del token', async () => {
            mockGetSession.mockResolvedValue(sesion({ role: 'BOOKING_AGENT' }));
            mockAgentProfile.mockResolvedValue({ epsId: 'eps-1', doctorId: null });

            await updateManualAppointmentAction('apt-1', form());

            expect(mockFindFirst).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'apt-1', organizationId: 'org-1' } }),
            );
        });
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 🧾 El régimen que el hospital necesita para elegir el convenio
// ═════════════════════════════════════════════════════════════════════════════
//
// Caso real del 2026-09-26: una cita de Salud Total sin régimen llegó al agente, que
// la rechazó diez veces y se rindió; el hospital nunca la tuvo. El panel escribe la
// cita por su cuenta (no pasa por la reserva de la API), así que necesita su propia
// barrera, con la MISMA regla.
describe('🧾 régimen del paciente con espejo activo', () => {
    const mockEspejo = prisma.hospitalMirrorConfig.findUnique as jest.Mock;
    const mockEps = prisma.eps.findFirst as jest.Mock;
    const mockFicha = prisma.patientProfile.findFirst as jest.Mock;

    beforeEach(() => {
        mockEspejo.mockResolvedValue({ enabled: true });
        mockEps.mockResolvedValue({ nit: '800130907' });
        mockFicha.mockResolvedValue({ id: 'pac-1', regime: null });
        (prisma.epsEnrolledPatient.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.scheduleSlot.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.scheduleSlot.create as jest.Mock).mockResolvedValue({ id: 'slot-n' });
        (prisma.patientProfile.update as jest.Mock).mockImplementation(async ({ data }) => ({ id: 'pac-1', ...data }));
    });

    it('🚨 crear: EPS con NIT, ficha sin régimen y formulario sin régimen → no se escribe nada', async () => {
        const res = await createManualAppointmentAction(form());

        expect(res).toEqual({ success: false, error: expect.stringMatching(/régimen/) });
        noSeEscribioNada();
    });

    it('crear: con el régimen en el formulario, agenda y lo guarda en la ficha', async () => {
        const res = await createManualAppointmentAction(form({ regime: 'SUBSIDIADO' }));

        expect(res.success).toBe(true);
        expect(prisma.patientProfile.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { regime: 'SUBSIDIADO' } }),
        );
    });

    it('crear: paciente nuevo con régimen en el formulario nace con él', async () => {
        mockFicha.mockResolvedValue(null);
        (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'u-n' });
        (prisma.patientProfile.create as jest.Mock).mockResolvedValue({ id: 'pac-n' });

        await createManualAppointmentAction(form({ regime: 'CONTRIBUTIVO' }));

        expect(prisma.patientProfile.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ regime: 'CONTRIBUTIVO' }) }),
        );
    });

    it('crear: si la ficha ya tiene régimen, el formulario puede quedar vacío', async () => {
        mockFicha.mockResolvedValue({ id: 'pac-1', regime: 'CONTRIBUTIVO' });

        const res = await createManualAppointmentAction(form());

        expect(res.success).toBe(true);
    });

    it('crear: formulario y ficha sin régimen, pero el padrón de ESA EPS lo da sin duda → agenda y lo guarda', async () => {
        (prisma.epsEnrolledPatient.findMany as jest.Mock).mockResolvedValue([{ epsId: 'eps-1', regime: 'CONTRIBUTIVO' }]);

        const res = await createManualAppointmentAction(form());

        expect(res.success).toBe(true);
        expect(prisma.patientProfile.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { regime: 'CONTRIBUTIVO' } }),
        );
    });

    it('crear: el padrón es de OTRA EPS → no lo usa y frena', async () => {
        (prisma.epsEnrolledPatient.findMany as jest.Mock).mockResolvedValue([{ epsId: 'eps-9', regime: 'CONTRIBUTIVO' }]);

        const res = await createManualAppointmentAction(form());

        expect(res).toEqual({ success: false, error: expect.stringMatching(/régimen/) });
        noSeEscribioNada();
    });

    it('modificar: la ficha sin régimen se completa desde el padrón', async () => {
        mockFindFirst.mockResolvedValue({ ...CITA, patient: { regime: null, cedula: '1053123456' } });
        (prisma.epsEnrolledPatient.findMany as jest.Mock).mockResolvedValue([{ epsId: 'eps-1', regime: 'SUBSIDIADO' }]);

        const res = await updateManualAppointmentAction('apt-1', form());

        expect(res.success).toBe(true);
        expect(prisma.patientProfile.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ regime: 'SUBSIDIADO' }) }),
        );
    });

    it('sin espejo activo no se exige', async () => {
        mockEspejo.mockResolvedValue({ enabled: false });

        const res = await createManualAppointmentAction(form());

        expect(res).toEqual({ success: true });
    });

    it('una EPS sin NIT (particular) no lo exige', async () => {
        mockEps.mockResolvedValue({ nit: null });

        const res = await createManualAppointmentAction(form());

        expect(res.success).toBe(true);
    });

    it('🚨 modificar: la cita reagendada tampoco sale sin régimen', async () => {
        mockFindFirst.mockResolvedValue({ ...CITA, patient: { regime: null } });

        const res = await updateManualAppointmentAction('apt-1', form());

        expect(res).toEqual({ success: false, error: expect.stringMatching(/régimen/) });
        noSeEscribioNada();
    });

    it('modificar: con régimen en el formulario, lo guarda en la ficha', async () => {
        mockFindFirst.mockResolvedValue({ ...CITA, patient: { regime: null } });

        const res = await updateManualAppointmentAction('apt-1', form({ regime: 'SUBSIDIADO' }));

        expect(res.success).toBe(true);
        expect(prisma.patientProfile.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ regime: 'SUBSIDIADO' }) }),
        );
    });
});
