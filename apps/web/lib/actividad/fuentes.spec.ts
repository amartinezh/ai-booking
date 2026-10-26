/** @jest-environment node */
import type { PrismaClient } from '@agenia/database';
import {
    FUENTES,
    autorEnElTexto,
    fuenteBitacora,
    fuenteCajaNegra,
    fuenteConfiguracion,
    fuenteRastreo,
    fuentesParaConsulta,
    type ConsultaDeFuente,
} from './fuentes';

const ORG = '3f1c2b9a-1111-4a2b-9c3d-123456789abc';

function consulta(c: Partial<ConsultaDeFuente> = {}): ConsultaDeFuente {
    return {
        clinica: { tipo: 'TODAS' },
        usuario: null,
        categoria: null,
        desdeUtc: null,
        hastaUtc: null,
        cursor: null,
        limite: 10,
        ...c,
    };
}

describe('fuentesParaConsulta', () => {
    it('sin filtros, todas', () => {
        expect(fuentesParaConsulta(consulta())).toHaveLength(FUENTES.length);
    });

    it('por categoría, solo las que la producen', () => {
        const claves = fuentesParaConsulta(consulta({ categoria: 'PACIENTES' })).map((f) => f.clave);
        expect(claves).toEqual(['log', 'rastreo']);
    });

    it('en «Plataforma», solo las que tienen filas sin clínica', () => {
        const claves = fuentesParaConsulta(consulta({ clinica: { tipo: 'PLATAFORMA' } })).map((f) => f.clave);
        expect(claves.sort()).toEqual(['global', 'log']);
    });
});

describe('fuenteBitacora', () => {
    const findMany = jest.fn();
    const db = { systemLog: { findMany } } as unknown as PrismaClient;
    beforeEach(() => findMany.mockReset());

    it('excluye errores técnicos, filtra clínica, usuario, categoría y cursor', async () => {
        findMany.mockResolvedValue([]);
        await fuenteBitacora.buscar(
            db,
            consulta({
                clinica: { tipo: 'CLINICA', id: ORG },
                usuario: { id: 'u1', email: 'a@b.co' },
                categoria: 'INGRESOS',
                cursor: { at: '2026-10-26T10:00:00.000Z', clave: 'log:x' },
            }),
        );
        const { where, take } = findMany.mock.calls[0][0];
        expect(where.level).toEqual({ in: ['EVENT', 'WARNING'] });
        expect(where.createdAt).toEqual({ lte: new Date('2026-10-26T10:00:00.000Z') });
        expect(where.AND).toEqual(
            expect.arrayContaining([
                { organizationId: ORG },
                { userId: 'u1' },
                { action: { in: expect.arrayContaining(['USER_LOGIN', 'USER_LOGOUT']) } },
            ]),
        );
        expect(take).toBeGreaterThan(10);
    });

    it('un ingreso fallido sin cuenta no tiene actor: el correo intentado va en el detalle', async () => {
        findMany.mockResolvedValue([
            {
                id: 'l1',
                level: 'WARNING',
                action: 'LOGIN_FAILED',
                message: 'Intento de ingreso fallido (USUARIO_NO_EXISTE)',
                userId: null,
                organizationId: null,
                createdAt: new Date('2026-10-26T15:00:00.000Z'),
                metadata: {
                    email: 'intruso@x.com',
                    motivo: 'USUARIO_NO_EXISTE',
                    ip: '200.1.2.3',
                    userAgent: 'curl/8.4.0',
                },
            },
        ]);
        const [e] = await fuenteBitacora.buscar(db, consulta());
        expect(e).toMatchObject({
            clave: 'log:l1',
            categoria: 'SEGURIDAD',
            titulo: 'Intento de ingreso fallido',
            detalle: 'Con el correo intruso@x.com (el correo no tiene cuenta)',
            aviso: true,
            actor: { userId: null, email: null },
            ip: '200.1.2.3',
            navegador: 'Programa (no es un navegador)',
        });
    });

    it('un ingreso con usuario muestra su correo, rol y navegador', async () => {
        findMany.mockResolvedValue([
            {
                id: 'l2',
                level: 'EVENT',
                action: 'USER_LOGIN',
                message: 'Ingreso de usuario (BOOKING_AGENT)',
                userId: 'u9',
                organizationId: ORG,
                createdAt: new Date('2026-10-26T15:00:00.000Z'),
                metadata: { role: 'BOOKING_AGENT', email: 'agenda@clinica.co', ip: '1.1.1.1' },
            },
        ]);
        const [e] = await fuenteBitacora.buscar(db, consulta());
        expect(e.actor).toEqual({ userId: 'u9', email: 'agenda@clinica.co', role: 'BOOKING_AGENT' });
        expect(e.titulo).toBe('Ingresó al panel');
        expect(e.aviso).toBe(false);
    });
});

describe('fuentes de clínica', () => {
    it('en «Plataforma» no consultan la base', async () => {
        const findMany = jest.fn();
        const db = { patientLookupLog: { findMany } } as unknown as PrismaClient;
        expect(await fuenteRastreo.buscar(db, consulta({ clinica: { tipo: 'PLATAFORMA' } }))).toEqual([]);
        expect(findMany).not.toHaveBeenCalled();
    });

    it('rastreo: cada búsqueda con su motivo, sin el dato completo', async () => {
        const findMany = jest.fn().mockResolvedValue([
            {
                id: 'r1',
                organizationId: ORG,
                actorUserId: 'u1',
                actorRole: 'BOOKING_AGENT',
                mode: 'A',
                queryKind: 'CEDULA',
                queryMasked: '10••••45',
                reason: 'PACIENTE_EN_VENTANILLA',
                reasonNote: null,
                openedPatientId: null,
                liveHisRequested: false,
                createdAt: new Date('2026-10-26T15:00:00.000Z'),
            },
        ]);
        const db = { patientLookupLog: { findMany } } as unknown as PrismaClient;
        const [e] = await fuenteRastreo.buscar(db, consulta({ clinica: { tipo: 'CLINICA', id: ORG } }));
        expect(findMany.mock.calls[0][0].where.organizationId).toBe(ORG);
        expect(e.titulo).toBe('Buscó un paciente por cédula');
        expect(e.detalle).toContain('«10••••45»');
        expect(e.detalle).toContain('Paciente en ventanilla');
    });

    it('configuración: un usuario borrado (sin correo) no trae toda la tabla', async () => {
        const findMany = jest.fn().mockResolvedValue([]);
        const db = { syncAudit: { findMany } } as unknown as PrismaClient;
        await fuenteConfiguracion.buscar(db, consulta({ usuario: { id: 'u1', email: '' } }));
        const y = findMany.mock.calls[0][0].where.AND;
        expect(JSON.stringify(y)).not.toContain('"contains":""');
    });

    it('Caja Negra: enmascara al remitente', async () => {
        const findMany = jest.fn().mockResolvedValue([
            {
                id: 'c1',
                organizationId: ORG,
                contactedAt: new Date('2026-10-26T15:00:00.000Z'),
                contactedBy: 'agenda@clinica.co',
                contactNotes: 'Se le agendó por teléfono',
                failureReason: 'NO_AGENDA',
                whatsappId: '573001234567',
            },
        ]);
        const db = { interactionLog: { findMany } } as unknown as PrismaClient;
        const [e] = await fuenteCajaNegra.buscar(db, consulta());
        expect(e.detalle).toContain('••••4567');
        expect(e.detalle).not.toContain('573001234567');
        expect(e.actor.email).toBe('agenda@clinica.co');
    });
});

describe('autorEnElTexto (auditoría del espejo)', () => {
    it('saca el correo de quien hizo el cambio', () => {
        expect(autorEnElTexto('«Agendar citas» APAGADO desde Configuración por ana@clinica.co: las citas…')).toBe(
            'ana@clinica.co',
        );
        expect(autorEnElTexto('«Plazo» cambió de «3» a «5» desde Configuración por ana@clinica.co.')).toBe('ana@clinica.co');
        expect(autorEnElTexto('«Odontología» INACTIVADO por jefe.citas@hsv.gov.co: AgenIA…')).toBe('jefe.citas@hsv.gov.co');
    });

    it('sin correo, no inventa', () => {
        expect(autorEnElTexto('Avisos al agendador: activos (cambiado desde el panel por ORG_ADMIN).')).toBeNull();
        expect(autorEnElTexto(null)).toBeNull();
    });
});
