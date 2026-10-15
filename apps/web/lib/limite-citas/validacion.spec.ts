import { esIdDeSolicitud, validarDecision, validarLimites, validarRadicacion } from './validacion';
import { puedeGestionarLimiteCitas, solicitudesCitasPendientes } from './acceso';
import type { SessionPayload } from '../session';

const sesion = (role: SessionPayload['role'], organizationId: string | null = 'org-1'): SessionPayload => ({
    userId: 'u1',
    email: 'quien@clinica.co',
    role,
    organizationId,
});

describe('puedeGestionarLimiteCitas', () => {
    it.each(['ORG_ADMIN', 'BOOKING_AGENT'] as const)('%s con clínica, sí', (rol) => {
        expect(puedeGestionarLimiteCitas(sesion(rol))).toBe(true);
    });

    it.each(['DOCTOR', 'PATIENT', 'GENERAL_OBSERVER', 'SUPER_ADMIN'] as const)('%s, no', (rol) => {
        expect(puedeGestionarLimiteCitas(sesion(rol))).toBe(false);
    });

    it('sin clínica en el token, nadie (aislamiento multi-tenant)', () => {
        expect(puedeGestionarLimiteCitas(sesion('ORG_ADMIN', null))).toBe(false);
        expect(puedeGestionarLimiteCitas(null)).toBe(false);
    });
});

describe('solicitudesCitasPendientes (cifra del menú)', () => {
    it('cuenta solo las PENDIENTES de la clínica de quien mira', async () => {
        const count = jest.fn(async () => 4);
        expect(await solicitudesCitasPendientes({ appointmentLimitRequest: { count } } as never, sesion('BOOKING_AGENT'))).toBe(4);
        expect(count).toHaveBeenCalledWith({ where: { organizationId: 'org-1', status: 'PENDING' } });
    });

    it('un rol sin acceso no consulta', async () => {
        const count = jest.fn();
        expect(await solicitudesCitasPendientes({ appointmentLimitRequest: { count } } as never, sesion('DOCTOR'))).toBe(0);
        expect(count).not.toHaveBeenCalled();
    });

    it('un error no tumba el menú: sin cifra', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const count = jest.fn(async () => {
            throw new Error('BD caída');
        });
        expect(await solicitudesCitasPendientes({ appointmentLimitRequest: { count } } as never, sesion('ORG_ADMIN'))).toBe(0);
        spy.mockRestore();
    });
});

describe('validarLimites', () => {
    it('acota los números y solo `true` enciende', () => {
        expect(validarLimites({ diaActivo: true, maxDia: 2, mesActivo: 'true', maxMes: 500 })).toEqual({
            diaActivo: true,
            maxDia: 2,
            mesActivo: false,
            maxMes: 31,
        });
    });

    it('basura en los números cae a los valores por defecto (1 y 3)', () => {
        expect(validarLimites({ diaActivo: true, maxDia: 'x', mesActivo: true, maxMes: -1 })).toEqual({
            diaActivo: true,
            maxDia: 1,
            mesActivo: true,
            maxMes: 3,
        });
    });
});

describe('validarRadicacion (formulario público)', () => {
    const valida = {
        motivo: 'TRATAMIENTO',
        argumento: 'Estoy en terapia física dos veces por semana por orden del médico.',
        adicionales: 2,
        telefono: '300 111 2233',
    };

    it('acepta una solicitud completa', () => {
        expect(validarRadicacion(valida)).toEqual({
            ok: true,
            datos: { motivo: 'TRATAMIENTO', argumento: valida.argumento, adicionales: 2, telefono: '300 111 2233' },
        });
    });

    it('el teléfono es opcional', () => {
        const r = validarRadicacion({ ...valida, telefono: '  ' });
        expect(r.ok && r.datos.telefono).toBeNull();
    });

    it.each([
        ['motivo inventado', { motivo: 'HACKEO' }],
        ['argumento muy corto', { argumento: 'porque sí' }],
        ['argumento enorme', { argumento: 'x'.repeat(2001) }],
        ['cero adicionales', { adicionales: 0 }],
        ['demasiadas adicionales', { adicionales: 6 }],
        ['adicionales no enteras', { adicionales: 1.5 }],
        ['teléfono con letras', { telefono: 'llámame' }],
    ])('rechaza: %s', (_caso, cambio) => {
        expect(validarRadicacion({ ...valida, ...cambio }).ok).toBe(false);
    });
});

describe('validarDecision (revisión del personal)', () => {
    it('aprobar concede de 1 a 5 citas; la nota es opcional', () => {
        expect(validarDecision({ decision: 'APPROVED', adicionales: '2', nota: '' })).toEqual({
            ok: true,
            datos: { decision: 'APPROVED', adicionales: 2, nota: null },
        });
        expect(validarDecision({ decision: 'APPROVED', adicionales: 0 }).ok).toBe(false);
        expect(validarDecision({ decision: 'APPROVED', adicionales: 9 }).ok).toBe(false);
    });

    it('rechazar exige el motivo', () => {
        expect(validarDecision({ decision: 'REJECTED', nota: '' }).ok).toBe(false);
        expect(validarDecision({ decision: 'REJECTED', nota: 'No hay orden médica' })).toEqual({
            ok: true,
            datos: { decision: 'REJECTED', nota: 'No hay orden médica' },
        });
    });

    it('cualquier otra decisión, no', () => {
        expect(validarDecision({ decision: 'PENDING' }).ok).toBe(false);
    });
});

describe('esIdDeSolicitud', () => {
    it('solo UUID', () => {
        expect(esIdDeSolicitud('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
        expect(esIdDeSolicitud("' OR 1=1 --")).toBe(false);
        expect(esIdDeSolicitud(undefined)).toBe(false);
    });
});
