import { crearYHomologarMedico } from './medico-nuevo';
import { permisosBandeja, type ActorBandeja } from './acceso';

const actor = (rol: 'ORG_ADMIN' | 'BOOKING_AGENT' = 'ORG_ADMIN'): ActorBandeja =>
    ({ userId: 'u1', role: rol, organizationId: 'org-1', permisos: permisosBandeja(rol), scopeEpsId: null, scopeDoctorId: null }) as ActorBandeja;

const prisma = (caso: unknown) => ({ syncException: { findFirst: jest.fn(async () => caso) } });
const CASO = { kind: 'MEDICO_SIN_HOMOLOGAR', status: 'ABIERTA', meta: { externalKey: 'RU68' } };

describe('crearYHomologarMedico — el botón de la Bandeja', () => {
    it('el administrador: busca el caso en SU clínica y le pide a la API ese código, con WhatsApp solo si es true', async () => {
        const p = prisma(CASO);
        const api = jest.fn(async () => ({ success: true as const, accion: 'CREAR' as const, nombre: 'MICHILLE' }));
        expect(await crearYHomologarMedico(p as never, actor(), { id: 'ex-1', whatsappOn: 'true' }, api)).toEqual({
            success: true,
            data: { nombre: 'MICHILLE', accion: 'CREAR' },
        });
        expect(p.syncException.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ex-1', organizationId: 'org-1' } }));
        expect(api).toHaveBeenCalledWith({ externalKey: 'RU68', whatsappOn: false });
        await crearYHomologarMedico(p as never, actor(), { id: 'ex-1', whatsappOn: true }, api);
        expect(api).toHaveBeenLastCalledWith({ externalKey: 'RU68', whatsappOn: true });
    });

    it('un agendador no', async () => {
        const api = jest.fn();
        expect(await crearYHomologarMedico(prisma(CASO) as never, actor('BOOKING_AGENT'), { id: 'ex-1' }, api)).toMatchObject({ success: false, error: expect.stringContaining('Solo el administrador') });
        expect(api).not.toHaveBeenCalled();
    });

    it.each([
        ['otra clínica o no existe', null],
        ['otro tipo de caso', { ...CASO, kind: 'AVISO_INASISTENCIA' }],
        ['ya cerrado', { ...CASO, status: 'AUTO_RESUELTA' }],
        ['sin código', { ...CASO, meta: {} }],
    ])('%s → no llama a la API', async (_c, caso) => {
        const api = jest.fn();
        expect((await crearYHomologarMedico(prisma(caso) as never, actor(), { id: 'ex-1' }, api)).success).toBe(false);
        expect(api).not.toHaveBeenCalled();
    });

    it('el rechazo de la API vuelve con su motivo', async () => {
        const api = jest.fn(async () => ({ success: false as const, error: 'Su cédula la tienen 3 médicos.' }));
        expect(await crearYHomologarMedico(prisma(CASO) as never, actor(), { id: 'ex-1' }, api)).toEqual({ success: false, error: 'Su cédula la tienen 3 médicos.' });
    });
});
