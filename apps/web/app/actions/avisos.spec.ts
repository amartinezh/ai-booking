jest.mock('@/lib/prisma', () => ({
    prisma: {
        hospitalMirrorConfig: { findUnique: jest.fn(), update: jest.fn() },
        massNoticeBatch: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        massNoticeRecipient: {
            findMany: jest.fn(),
            createMany: jest.fn(),
            deleteMany: jest.fn(),
            updateMany: jest.fn(),
        },
        patientProfile: { findMany: jest.fn() },
        mirrorCatalogEntry: { findMany: jest.fn() },
        $transaction: jest.fn(),
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { cookies } from 'next/headers';
import {
    validateAvisosFileAction,
    loadAvisosFileAction,
    toggleRecipientSelectionAction,
    updateBatchNotaAdicionalAction,
    sendBatchAction,
    getDoctorCatalogAction,
    requestNoticeRosterAction,
    getNoticeRequestStatusAction,
    getBatchAction,
} from './avisos';

const mockGetSession = getSession as jest.Mock;
const mockMirrorFindUnique = prisma.hospitalMirrorConfig.findUnique as jest.Mock;
const mockBatchFindFirst = prisma.massNoticeBatch.findFirst as jest.Mock;
const mockBatchCreate = prisma.massNoticeBatch.create as jest.Mock;
const mockBatchUpdate = prisma.massNoticeBatch.update as jest.Mock;
const mockRecipientFindMany = prisma.massNoticeRecipient.findMany as jest.Mock;
const mockPatientFindMany = prisma.patientProfile.findMany as jest.Mock;
const mockCatalogFindMany = prisma.mirrorCatalogEntry.findMany as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;
const mockRecipientUpdateMany = prisma.massNoticeRecipient.updateMany as jest.Mock;
const mockBatchUpdateMany = prisma.massNoticeBatch.updateMany as jest.Mock;
const mockCookies = cookies as jest.Mock;

const CNT_SANVICENTE_CONFIG = {
    driverKey: 'cnt-sanvicente-anserma',
    enabled: true,
    avisosMasivos: { enabled: true, maxDestinatariosPorLote: 300 },
};

const CNT_SANVICENTE_CONFIG_ESPEJO = {
    ...CNT_SANVICENTE_CONFIG,
    avisosMasivos: { enabled: true, fuente: 'ESPEJO', maxDestinatariosPorLote: 300 },
};

const HEADER = 'documento,nombre,telefono,fecha_hora_cita';
const VALID_CSV = [HEADER, '12345678,Ana Pérez,3001234567,2026-09-24 07:00'].join('\n');

function asOrgAdmin(session: Record<string, unknown> = {}) {
    mockGetSession.mockResolvedValue({
        role: 'ORG_ADMIN',
        organizationId: 'org-1',
        userId: 'user-1',
        ...session,
    });
}

describe('avisos.ts — las tres llaves', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rechaza sin sesión', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await validateAvisosFileAction(VALID_CSV);
        expect(res).toEqual({ success: false, error: 'Acceso denegado.' });
        expect(mockMirrorFindUnique).not.toHaveBeenCalled();
    });

    it('rechaza un rol sin acceso (PATIENT)', async () => {
        mockGetSession.mockResolvedValue({ role: 'PATIENT', organizationId: 'org-1', userId: 'u1' });
        const res = await validateAvisosFileAction(VALID_CSV);
        expect(res.success).toBe(false);
    });

    it('permite BOOKING_AGENT operar (no solo ORG_ADMIN) — §1.3', async () => {
        asOrgAdmin({ role: 'BOOKING_AGENT' });
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockRecipientFindMany.mockResolvedValue([]);

        const res = await validateAvisosFileAction(VALID_CSV);
        expect(res.success).toBe(true);
    });

    it('rechaza un tenant SIN espejo (HospitalMirrorConfig no existe)', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(null);
        const res = await validateAvisosFileAction(VALID_CSV);
        expect(res).toEqual({ success: false, error: 'Acceso denegado.' });
    });

    it('rechaza un tenant con OTRO driver', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue({ ...CNT_SANVICENTE_CONFIG, driverKey: 'otro-driver' });
        const res = await validateAvisosFileAction(VALID_CSV);
        expect(res).toEqual({ success: false, error: 'Acceso denegado.' });
    });

    it('rechaza cuando el espejo está apagado (enabled=false)', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue({ ...CNT_SANVICENTE_CONFIG, enabled: false });
        const res = await validateAvisosFileAction(VALID_CSV);
        expect(res).toEqual({ success: false, error: 'Acceso denegado.' });
    });

    it('rechaza cuando avisosMasivos es null (la Llave 3 nunca se prendió)', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue({ ...CNT_SANVICENTE_CONFIG, avisosMasivos: null });
        const res = await validateAvisosFileAction(VALID_CSV);
        expect(res).toEqual({ success: false, error: 'Acceso denegado.' });
    });

    it('rechaza cuando avisosMasivos.enabled es false', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue({
            ...CNT_SANVICENTE_CONFIG,
            avisosMasivos: { enabled: false },
        });
        const res = await validateAvisosFileAction(VALID_CSV);
        expect(res).toEqual({ success: false, error: 'Acceso denegado.' });
    });
});

describe('validateAvisosFileAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('valida y cuenta cuántas filas ya tienen aviso previo', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockRecipientFindMany.mockResolvedValue([
            {
                patientDocument: '12345678',
                appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
                sentAt: new Date('2026-09-10T00:00:00.000Z'),
                batchId: 'batch-old',
            },
        ]);

        const res = await validateAvisosFileAction(VALID_CSV);

        expect(res.success).toBe(true);
        if (res.success) {
            expect(res.report.ok).toBe(true);
            expect(res.report.validCount).toBe(1);
            expect(res.report.yaAvisadasPrevio).toBe(1);
        }
    });

    it('no consulta avisos previos si el archivo tiene errores', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);

        const res = await validateAvisosFileAction('documento,telefono\n,3001234567');

        expect(res.success).toBe(true);
        if (res.success) expect(res.report.ok).toBe(false);
        expect(mockRecipientFindMany).not.toHaveBeenCalled();
    });
});

describe('loadAvisosFileAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rechaza sin médico/motivo', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);

        const res = await loadAvisosFileAction({ doctorLabel: '  ', csvText: VALID_CSV });

        expect(res.success).toBe(false);
        expect(res.error).toContain('médico');
    });

    it('rechaza si el archivo tiene errores — no crea nada', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);

        const res = await loadAvisosFileAction({
            doctorLabel: 'Dr. Serna',
            csvText: 'documento,telefono\n,3001234567',
        });

        expect(res.success).toBe(false);
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('rechaza si supera maxDestinatariosPorLote', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue({
            ...CNT_SANVICENTE_CONFIG,
            avisosMasivos: { enabled: true, maxDestinatariosPorLote: 1 },
        });
        const twoRows = [
            HEADER,
            '12345678,Ana,3001234567,2026-09-24 07:00',
            '87654321,Beto,3007654321,2026-09-24 07:20',
        ].join('\n');

        const res = await loadAvisosFileAction({ doctorLabel: 'Dr. Serna', csvText: twoRows });

        expect(res.success).toBe(false);
        expect(res.error).toContain('máximo de 1');
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('crea un lote nuevo cuando no viene batchId, resolviendo agenIAPatientId y aviso previo', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockPatientFindMany.mockResolvedValue([{ id: 'patient-1', cedula: '12345678' }]);
        mockRecipientFindMany.mockResolvedValue([]); // sin avisos previos

        const tx = {
            massNoticeBatch: {
                create: jest.fn().mockResolvedValue({ id: 'batch-nuevo' }),
                update: jest.fn().mockResolvedValue({}),
            },
            massNoticeRecipient: { createMany: jest.fn().mockResolvedValue({}) },
        };
        mockTransaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

        const res = await loadAvisosFileAction({ doctorLabel: 'Dr. Serna', csvText: VALID_CSV });

        expect(res.success).toBe(true);
        expect(res.batchId).toBe('batch-nuevo');
        expect(res.candidates).toBe(1);
        expect(res.yaAvisadasPrevio).toBe(0);
        expect(tx.massNoticeBatch.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    organizationId: 'org-1',
                    source: 'CSV',
                    status: 'BORRADOR',
                    doctorLabel: 'Dr. Serna',
                }),
            }),
        );
        expect(tx.massNoticeRecipient.createMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: [
                    expect.objectContaining({
                        batchId: 'batch-nuevo',
                        patientDocument: '12345678',
                        agenIAPatientId: 'patient-1',
                        selected: true,
                        previousSentAt: null,
                    }),
                ],
            }),
        );
    });

    it('no preselecciona a quien ya tiene un aviso ENVIADO previo (§6.1)', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockPatientFindMany.mockResolvedValue([]);
        mockRecipientFindMany.mockResolvedValue([
            {
                patientDocument: '12345678',
                appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
                sentAt: new Date('2026-09-10T00:00:00.000Z'),
                batchId: 'batch-old',
            },
        ]);
        const tx = {
            massNoticeBatch: {
                create: jest.fn().mockResolvedValue({ id: 'batch-nuevo' }),
                update: jest.fn().mockResolvedValue({}),
            },
            massNoticeRecipient: { createMany: jest.fn().mockResolvedValue({}) },
        };
        mockTransaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

        const res = await loadAvisosFileAction({ doctorLabel: 'Dr. Serna', csvText: VALID_CSV });

        expect(res.yaAvisadasPrevio).toBe(1);
        expect(tx.massNoticeRecipient.createMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: [
                    expect.objectContaining({
                        selected: false,
                        previousSentAt: new Date('2026-09-10T00:00:00.000Z'),
                        previousSentBatchId: 'batch-old',
                    }),
                ],
            }),
        );
    });

    it('rechaza repoblar un lote que ya no está en BORRADOR', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockBatchFindFirst.mockResolvedValue({ id: 'batch-1', status: 'ENVIADO' });

        const res = await loadAvisosFileAction({
            batchId: 'batch-1',
            doctorLabel: 'Dr. Serna',
            csvText: VALID_CSV,
        });

        expect(res.success).toBe(false);
        expect(res.error).toContain('ENVIADO');
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('repoblar reemplaza solo las filas PENDIENTE del lote existente', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockBatchFindFirst.mockResolvedValue({ id: 'batch-1', status: 'BORRADOR' });
        mockPatientFindMany.mockResolvedValue([]);
        mockRecipientFindMany.mockResolvedValue([]);

        const tx = {
            massNoticeRecipient: {
                deleteMany: jest.fn().mockResolvedValue({}),
                createMany: jest.fn().mockResolvedValue({}),
            },
            massNoticeBatch: { update: jest.fn().mockResolvedValue({}) },
        };
        mockTransaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

        const res = await loadAvisosFileAction({
            batchId: 'batch-1',
            doctorLabel: 'Dr. Serna',
            csvText: VALID_CSV,
        });

        expect(res.success).toBe(true);
        expect(res.batchId).toBe('batch-1');
        expect(tx.massNoticeRecipient.deleteMany).toHaveBeenCalledWith({
            where: { batchId: 'batch-1', outcome: 'PENDIENTE' },
        });
    });
});

describe('toggleRecipientSelectionAction / updateBatchNotaAdicionalAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('toggle: solo afecta filas del propio tenant y en BORRADOR', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockRecipientUpdateMany.mockResolvedValue({ count: 1 });

        const res = await toggleRecipientSelectionAction('rec-1', false);

        expect(res.success).toBe(true);
        expect(mockRecipientUpdateMany).toHaveBeenCalledWith({
            where: { id: 'rec-1', batch: { organizationId: 'org-1', status: 'BORRADOR' } },
            data: { selected: false },
        });
    });

    it('toggle: reporta error si no tocó ninguna fila (otro tenant, o lote ya no en borrador)', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockRecipientUpdateMany.mockResolvedValue({ count: 0 });

        const res = await toggleRecipientSelectionAction('rec-de-otro-tenant', true);

        expect(res.success).toBe(false);
    });

    it('nota adicional: rechaza más de 150 caracteres', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);

        const res = await updateBatchNotaAdicionalAction('batch-1', 'x'.repeat(151));

        expect(res.success).toBe(false);
        expect(mockBatchUpdateMany).not.toHaveBeenCalled();
    });

    it('nota adicional: una cadena vacía se guarda como null (cae a la frase por defecto en el envío)', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockBatchUpdateMany.mockResolvedValue({ count: 1 });

        const res = await updateBatchNotaAdicionalAction('batch-1', '   ');

        expect(res.success).toBe(true);
        expect(mockBatchUpdateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: { notaAdicional: null } }),
        );
    });
});

describe('sendBatchAction', () => {
    const realFetch = global.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCookies.mockResolvedValue({ get: jest.fn(() => ({ value: 'jwt-token' })) });
    });
    afterEach(() => {
        global.fetch = realFetch;
    });

    it('reenvía la cookie de sesión al backend y devuelve los contadores', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'ENVIADO', sent: 12, failed: 0, skipped: 2 }),
        }) as unknown as typeof fetch;

        const res = await sendBatchAction('batch-1');

        expect(res).toEqual({ success: true, status: 'ENVIADO', sent: 12, failed: 0, skipped: 2 });
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/mass-notice/batch-1/send'),
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Cookie: 'auth_token=jwt-token' }),
            }),
        );
    });

    it('propaga el error de negocio del backend (ej. sin plantilla aprobada) sin marcarlo success', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'BORRADOR', error: 'No hay plantilla configurada.' }),
        }) as unknown as typeof fetch;

        const res = await sendBatchAction('batch-1');

        expect(res.success).toBe(false);
        expect(res.error).toContain('plantilla');
    });

    it('maneja un backend caído sin lanzar', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        global.fetch = jest.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch;

        const res = await sendBatchAction('batch-1');

        expect(res.success).toBe(false);
        expect(res.error).toContain('connection refused');
    });
});

// ── Fase 2: fuente espejo — "Traer del hospital" ──────────────────────────

describe('getBatchAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rechaza sin acceso', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await getBatchAction('batch-1');
        expect(res).toEqual({ success: false, error: 'Acceso denegado.' });
    });

    it('rechaza si el lote no existe (o es de otro tenant)', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockBatchFindFirst.mockResolvedValue(null);

        const res = await getBatchAction('batch-ajeno');

        expect(res).toEqual({ success: false, error: 'Lote no encontrado.' });
    });

    it('marca phoneIsCompanion en cada destinatario (§3.4/J.5 — nunca en silencio)', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockBatchFindFirst.mockResolvedValue({
            id: 'batch-1',
            kind: 'CANCELACION',
            source: 'ESPEJO',
            status: 'BORRADOR',
            doctorLabel: 'Dr. Serna',
            serviceLabel: null,
            dateFrom: new Date('2026-09-24T12:00:00.000Z'),
            dateTo: new Date('2026-09-24T12:00:00.000Z'),
            notaAdicional: null,
            candidates: 1,
            selected: 1,
            sent: 0,
            failed: 0,
            skipped: 0,
            createdAt: new Date('2026-09-13T00:00:00.000Z'),
            sentAt: null,
            recipients: [
                {
                    id: 'rec-1',
                    patientDocument: '1037456123',
                    patientName: 'Luz Elena',
                    phoneE164: '+573009876543',
                    phoneIsCompanion: true,
                    appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
                    selected: true,
                    outcome: 'PENDIENTE',
                    previousSentAt: null,
                },
            ],
        });

        const res = await getBatchAction('batch-1');

        expect(res.success).toBe(true);
        if (res.success) {
            expect(res.batch.recipients[0]).toEqual(
                expect.objectContaining({ phoneIsCompanion: true, hasValidPhone: true }),
            );
        }
    });
});

describe('getDoctorCatalogAction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rechaza sin acceso', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await getDoctorCatalogAction();
        expect(res).toEqual({ success: false, error: 'Acceso denegado.' });
    });

    it('lista los médicos del catálogo del HIS para este tenant', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG);
        mockCatalogFindMany.mockResolvedValue([
            { externalKey: '76', label: 'Carlos Andrés Serna Granada' },
        ]);

        const res = await getDoctorCatalogAction();

        expect(res).toEqual({
            success: true,
            doctors: [{ externalKey: '76', label: 'Carlos Andrés Serna Granada' }],
        });
        expect(mockCatalogFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { organizationId: 'org-1', entityType: 'DOCTOR' },
            }),
        );
    });
});

describe('requestNoticeRosterAction', () => {
    const INPUT = {
        doctorExternalKey: '76',
        doctorLabel: 'Dr. Serna',
        fromIso: '2026-09-24T05:00:00.000Z',
        toIso: '2026-09-25T05:00:00.000Z',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockCookies.mockResolvedValue({ get: jest.fn(() => ({ value: 'jwt-token' })) });
    });

    it('rechaza si la clínica no tiene la fuente ESPEJO habilitada (fuente CSV o sin configurar)', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG); // sin fuente: 'ESPEJO'

        const res = await requestNoticeRosterAction(INPUT);

        expect(res.success).toBe(false);
        expect(res.error).toContain('fuente espejo');
        expect(mockBatchCreate).not.toHaveBeenCalled();
    });

    it('rechaza sin médico o sin rango de fechas', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG_ESPEJO);

        const res = await requestNoticeRosterAction({ ...INPUT, doctorExternalKey: '' });

        expect(res.success).toBe(false);
        expect(mockBatchCreate).not.toHaveBeenCalled();
    });

    it('crea el lote ESPEJO y pide la petición al backend, devolviendo batchId y requestId', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG_ESPEJO);
        mockBatchCreate.mockResolvedValue({ id: 'batch-espejo-1' });
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ requestId: 'req-1' }),
        }) as unknown as typeof fetch;

        const res = await requestNoticeRosterAction(INPUT);

        expect(res).toEqual({ success: true, batchId: 'batch-espejo-1', requestId: 'req-1' });
        expect(mockBatchCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    organizationId: 'org-1',
                    source: 'ESPEJO',
                    status: 'BORRADOR',
                    doctorExternalKey: '76',
                    doctorLabel: 'Dr. Serna',
                }),
            }),
        );
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/mass-notice/batch-espejo-1/notice-request'),
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Cookie: 'auth_token=jwt-token' }),
                body: JSON.stringify({
                    doctorExternalKey: '76',
                    fromIso: INPUT.fromIso,
                    toIso: INPUT.toIso,
                }),
            }),
        );
    });

    it('propaga el error del backend sin lanzar (el lote ya se creó, pero se reporta)', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG_ESPEJO);
        mockBatchCreate.mockResolvedValue({ id: 'batch-espejo-1' });
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 403,
            text: async () => 'sin espejo',
        }) as unknown as typeof fetch;

        const res = await requestNoticeRosterAction(INPUT);

        expect(res.success).toBe(false);
        expect(res.error).toContain('403');
    });

    it('con batchId: repuebla el lote existente en vez de crear uno nuevo (§3.3.4 — "no es de un solo uso")', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG_ESPEJO);
        mockBatchFindFirst.mockResolvedValue({ id: 'batch-espejo-1', status: 'BORRADOR', source: 'ESPEJO' });
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ requestId: 'req-2' }),
        }) as unknown as typeof fetch;

        const res = await requestNoticeRosterAction({ ...INPUT, batchId: 'batch-espejo-1' });

        expect(res).toEqual({ success: true, batchId: 'batch-espejo-1', requestId: 'req-2' });
        expect(mockBatchCreate).not.toHaveBeenCalled();
        expect(mockBatchUpdate).toHaveBeenCalledWith({
            where: { id: 'batch-espejo-1' },
            data: expect.objectContaining({ doctorExternalKey: '76', doctorLabel: 'Dr. Serna' }),
        });
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/mass-notice/batch-espejo-1/notice-request'),
            expect.anything(),
        );
    });

    it('con batchId de un lote que no existe (o de otro tenant): rechaza', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG_ESPEJO);
        mockBatchFindFirst.mockResolvedValue(null);

        const res = await requestNoticeRosterAction({ ...INPUT, batchId: 'batch-ajeno' });

        expect(res).toEqual({ success: false, error: 'Lote no encontrado.' });
        expect(mockBatchUpdate).not.toHaveBeenCalled();
    });

    it('con batchId de un lote que ya no está en BORRADOR: rechaza', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG_ESPEJO);
        mockBatchFindFirst.mockResolvedValue({ id: 'batch-espejo-1', status: 'ENVIADO', source: 'ESPEJO' });

        const res = await requestNoticeRosterAction({ ...INPUT, batchId: 'batch-espejo-1' });

        expect(res.success).toBe(false);
        expect(res.error).toContain('ENVIADO');
        expect(mockBatchUpdate).not.toHaveBeenCalled();
    });
});

describe('getNoticeRequestStatusAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCookies.mockResolvedValue({ get: jest.fn(() => ({ value: 'jwt-token' })) });
    });

    it('rechaza sin acceso', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await getNoticeRequestStatusAction('req-1');
        expect(res).toEqual({ success: false, error: 'Acceso denegado.' });
    });

    it('devuelve el estado reportado por el backend', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG_ESPEJO);
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'RESUELTA', error: null, truncated: false }),
        }) as unknown as typeof fetch;

        const res = await getNoticeRequestStatusAction('req-1');

        expect(res).toEqual({ success: true, status: 'RESUELTA', requestError: null, truncated: false });
    });

    it('propaga truncated: true — nunca se recorta en silencio (§5)', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG_ESPEJO);
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'RESUELTA', error: null, truncated: true }),
        }) as unknown as typeof fetch;

        const res = await getNoticeRequestStatusAction('req-1');

        expect(res).toEqual({ success: true, status: 'RESUELTA', requestError: null, truncated: true });
    });

    it('maneja un backend caído sin lanzar', async () => {
        asOrgAdmin();
        mockMirrorFindUnique.mockResolvedValue(CNT_SANVICENTE_CONFIG_ESPEJO);
        global.fetch = jest.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch;

        const res = await getNoticeRequestStatusAction('req-1');

        expect(res.success).toBe(false);
        expect(res.error).toContain('connection refused');
    });
});
