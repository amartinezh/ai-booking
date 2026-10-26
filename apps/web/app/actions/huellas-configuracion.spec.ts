/** @jest-environment node */
/**
 * 👣 Actividad de usuarios: configuración, integraciones y acciones del super
 * administrador (2026-10-27). Que cada cambio quede con quién lo hizo, que guardar
 * lo mismo no cuente y, sobre todo, que NUNCA quede una llave, un token o un secreto.
 */
jest.mock('@/lib/prisma', () => ({
    prisma: {
        systemLog: { create: jest.fn(async () => ({})) },
        organization: { findUnique: jest.fn(), update: jest.fn() },
        supportTicket: { findUnique: jest.fn(), update: jest.fn() },
    },
}));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));
jest.mock('../../lib/session', () => ({ getSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/headers', () => ({
    cookies: jest.fn(async () => ({ get: () => ({ value: 'token' }) })),
    headers: jest.fn(async () => ({ get: (k: string) => (k === 'x-forwarded-for' ? '190.1.2.3' : null) })),
}));

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getSession as getSessionRelativa } from '../../lib/session';
import { updateMyAiConfig } from './ai-config';
import { updateMyWhatsappConfig } from './whatsapp-config';
import { connectMyTelegram, disconnectMyTelegram } from './telegram-config';
import { deleteMyWhatsappTemplate, saveMyWhatsappTemplate } from './whatsapp-templates';
import { updateMyKnowledgeBase } from './knowledge-base';
import { updateOrganizationBilling } from './billing';
import { resolveTicket, startTicketAttention } from './support';

const mockLog = prisma.systemLog.create as jest.Mock;
const registros = () => mockLog.mock.calls.map((c) => c[0].data);
const ADMIN = { role: 'ORG_ADMIN', organizationId: 'org-1', userId: 'admin-1', email: 'admin@clinica.co' };
const SUPER = { role: 'SUPER_ADMIN', organizationId: null, userId: 'sa-1', email: 'superadmin@agenia.co' };
const fetchOriginal = global.fetch;

function respuesta(body: unknown) {
    const texto = JSON.stringify(body);
    return { ok: true, status: 200, json: async () => body, text: async () => texto };
}

beforeEach(() => {
    jest.clearAllMocks();
    (getSession as jest.Mock).mockResolvedValue(ADMIN);
    (getSessionRelativa as jest.Mock).mockResolvedValue(ADMIN);
    global.fetch = jest.fn(async () => respuesta({})) as unknown as typeof fetch;
});
afterAll(() => {
    global.fetch = fetchOriginal;
});

describe('integraciones: qué cambió, nunca el secreto', () => {
    it('IA: proveedor, modelo y «llave nueva», sin la llave', async () => {
        const r = await updateMyAiConfig({ activeProvider: 'GEMINI', model: 'gemini-2.5-flash', apiKey: 'AIzaSyLLAVE-SECRETA-123' } as never);
        expect(r.success).toBe(true);
        const [d] = registros();
        expect(d).toMatchObject({ action: 'AI_CONFIG_CHANGED', userId: 'admin-1', organizationId: 'org-1' });
        expect(d.metadata.detalle).toBe('Proveedor GEMINI · modelo gemini-2.5-flash · llave nueva');
        expect(JSON.stringify(d)).not.toContain('LLAVE-SECRETA');
    });

    it('WhatsApp: el número y qué tokens se cambiaron, sin los tokens', async () => {
        await updateMyWhatsappConfig({
            displayPhoneNumber: '+57 300 123 4567',
            accessToken: 'EAAG-TOKEN-SECRETO',
            appSecret: 'secreto-de-la-app',
            isActive: true,
        });
        const [d] = registros();
        expect(d.action).toBe('WHATSAPP_CONFIG_CHANGED');
        expect(d.metadata.detalle).toBe('Número +57 300 123 4567 · token de acceso nuevo · secreto de la app nuevo · canal ACTIVO');
        expect(JSON.stringify(d)).not.toMatch(/TOKEN-SECRETO|secreto-de-la-app/);
    });

    it('Telegram: conectar y desconectar, sin el token del bot', async () => {
        global.fetch = jest.fn(async () => respuesta({ botUsername: 'hsv_bot' })) as unknown as typeof fetch;
        await connectMyTelegram('123456:ABC-TOKEN-DEL-BOT');
        await disconnectMyTelegram();
        const [conectar, desconectar] = registros();
        expect(conectar).toMatchObject({ action: 'TELEGRAM_CONNECTED' });
        expect(conectar.metadata.detalle).toBe('@hsv_bot');
        expect(desconectar).toMatchObject({ action: 'TELEGRAM_DISCONNECTED' });
        expect(JSON.stringify(registros())).not.toContain('TOKEN-DEL-BOT');
    });

    it('plantillas de WhatsApp: registrar y quitar', async () => {
        await saveMyWhatsappTemplate({ kind: 'RECORDATORIO' as never, name: 'recordatorio_cita', language: 'es' });
        await deleteMyWhatsappTemplate('RECORDATORIO' as never);
        expect(registros().map((d) => d.action)).toEqual(['WHATSAPP_TEMPLATE_SAVED', 'WHATSAPP_TEMPLATE_DELETED']);
        expect(registros()[0].metadata.detalle).toBe('RECORDATORIO → «recordatorio_cita» (es)');
    });

    it('si la API rechaza el cambio, no queda nada', async () => {
        global.fetch = jest.fn(async () => ({ ok: false, status: 400, text: async () => 'mal' })) as unknown as typeof fetch;
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const r = await updateMyAiConfig({ activeProvider: 'GEMINI' } as never);
        expect(r.success).toBe(false);
        expect(mockLog).not.toHaveBeenCalled();
    });
});

describe('base de conocimiento', () => {
    it('dice cuánto texto quedó; guardar lo mismo no cuenta', async () => {
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({ knowledgeBase: 'Horario: 7 a 5' });
        await updateMyKnowledgeBase('Horario: 7 a 5');
        expect(mockLog).not.toHaveBeenCalled();
        await updateMyKnowledgeBase('Horario: 7 a 5. Sábados no.');
        expect(registros()[0]).toMatchObject({ action: 'KNOWLEDGE_BASE_CHANGED' });
        expect(registros()[0].metadata.detalle).toBe('14 → 27 caracteres');
    });
});

describe('acciones del super administrador', () => {
    beforeEach(() => {
        (getSession as jest.Mock).mockResolvedValue(SUPER);
    });

    it('facturación: queda en la clínica, con el super administrador como actor', async () => {
        await updateOrganizationBilling('org-9', { monthlyFee: '500000', autoSuspend: true });
        expect(registros()[0]).toMatchObject({ action: 'BILLING_UPDATED', userId: 'sa-1', organizationId: 'org-9' });
        expect(registros()[0].metadata.detalle).toBe('cuota mensual 500000 · suspensión automática sí');
    });

    it('tickets: atenderlo y solucionarlo quedan en la clínica del ticket', async () => {
        const ticket = { id: 't1', number: 42, organizationId: 'org-3', status: 'OPEN', startedAt: null };
        (prisma.supportTicket.findUnique as jest.Mock).mockResolvedValue(ticket);
        await startTicketAttention('t1');
        const fd = new FormData();
        fd.set('resolutionNote', 'Se reinició la conexión de WhatsApp y quedó funcionando.');
        await resolveTicket('t1', undefined, fd);
        expect(registros().map((d) => [d.action, d.organizationId, d.metadata.detalle])).toEqual([
            ['SUPPORT_TICKET_UPDATED', 'org-3', '#42 · empezó a atenderlo'],
            ['SUPPORT_TICKET_UPDATED', 'org-3', '#42 · lo marcó como solucionado'],
        ]);
    });
});
