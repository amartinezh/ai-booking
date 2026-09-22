/* eslint-disable @typescript-eslint/no-unused-vars -- los dobles de Prisma declaran `...args` para poder leer `mock.calls[n][0]` con tipos */
import type { ActorRastreo, RolRastreo } from './acceso';
import { SIN_PERMISOS, permisosDeRol, puedeConfirmar } from './acceso';
import {
  MSG_CONFIRMACION_API,
  MSG_CONFIRMACION_DATOS,
  MSG_CONFIRMACION_VERIFICACION,
  enviarConfirmacionHis,
} from './confirmacion';
import { MSG_NO_REGISTRADA, MSG_PACIENTE_NO_ENCONTRADO } from './servicio';

/**
 * «Enviar confirmación por WhatsApp» (§12 #7), lado web. La web no envía: decide quién
 * puede pedirlo, deja constancia con motivo y delega en la API. Lo que se fija:
 *  · solo ORG_ADMIN y BOOKING_AGENT (los que investigan cupos y atienden);
 *  · primero la bitácora; si no se pudo registrar, NO se envía;
 *  · el paciente se busca dentro de la clínica del actor;
 *  · lo que diga la API (incluido un error claro) llega tal cual a la pantalla.
 */
const ORG = 'org-1';
const actor = (role: RolRastreo, over: Partial<ActorRastreo> = {}): ActorRastreo => ({
  userId: 'u-1',
  role,
  organizationId: ORG,
  permisos: permisosDeRol(role),
  scopeEpsId: null,
  scopeDoctorId: null,
  ...over,
});

const build = (paciente: unknown = { id: 'pac-1', cedula: '1088123456' }) => {
  const db = {
    patientProfile: { findFirst: jest.fn(async (..._a: unknown[]) => paciente) },
    patientLookupLog: { create: jest.fn(async (..._a: unknown[]) => ({})) },
  };
  const api = jest.fn(async (..._a: unknown[]) => ({ success: true, via: 'TEXTO' as const }));
  return { db, api };
};

const entrada = (over: Record<string, unknown> = {}) => ({
  pacienteId: 'pac-1',
  slotId: 'slot-1',
  verificacion: 'HIS_EN_VIVO',
  motivo: 'PACIENTE_EN_VENTANILLA',
  ...over,
});

const enviar = (b: ReturnType<typeof build>, a: ActorRastreo, over: Record<string, unknown> = {}) =>
  enviarConfirmacionHis(b.db as never, a, entrada(over), b.api);

describe('puedeConfirmar', () => {
  it('ORG_ADMIN y BOOKING_AGENT sí; DOCTOR, SUPER_ADMIN y PATIENT no', () => {
    expect(puedeConfirmar(actor('ORG_ADMIN'))).toBe(true);
    expect(puedeConfirmar(actor('BOOKING_AGENT'))).toBe(true);
    for (const r of ['DOCTOR', 'SUPER_ADMIN', 'PATIENT'] as RolRastreo[]) {
      expect(puedeConfirmar(actor(r))).toBe(false);
    }
  });
});

describe('enviarConfirmacionHis', () => {
  it('✅ registra primero (quién, a quién y por qué) y después pide el envío a la API', async () => {
    const b = build();
    const orden: string[] = [];
    b.db.patientLookupLog.create.mockImplementation(async () => {
      orden.push('bitacora');
      return {};
    });
    b.api.mockImplementation(async () => {
      orden.push('api');
      return { success: true, via: 'TEXTO' as const };
    });

    await expect(enviar(b, actor('ORG_ADMIN'))).resolves.toEqual({ success: true, data: { via: 'TEXTO' } });

    expect(orden).toEqual(['bitacora', 'api']);
    expect(b.db.patientLookupLog.create.mock.calls[0][0]).toMatchObject({
      data: {
        organizationId: ORG,
        actorUserId: 'u-1',
        actorRole: 'ORG_ADMIN',
        mode: 'B',
        queryKind: 'CONFIRM',
        // El documento nunca completo en la bitácora.
        queryMasked: '•••3456',
        reason: 'PACIENTE_EN_VENTANILLA',
        openedPatientId: 'pac-1',
        verdicts: [{ codigo: 'CONFIRMACION_HIS_EN_VIVO', citaId: null }],
      },
    });
    expect(b.api).toHaveBeenCalledWith({ scheduleSlotId: 'slot-1', patientId: 'pac-1', verificacion: 'HIS_EN_VIVO' });
  });

  it('🔒 si la bitácora falla, NO se envía', async () => {
    const b = build();
    b.db.patientLookupLog.create.mockRejectedValueOnce(new Error('sin espacio'));
    const consola = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(enviar(b, actor('ORG_ADMIN'))).resolves.toEqual({ success: false, error: MSG_NO_REGISTRADA });
    expect(b.api).not.toHaveBeenCalled();
    consola.mockRestore();
  });

  it.each(['DOCTOR', 'SUPER_ADMIN', 'PATIENT'] as RolRastreo[])('🔒 %s: «Sin permisos.», sin tocar la base', async (rol) => {
    const b = build();
    await expect(enviar(b, actor(rol))).resolves.toEqual({ success: false, error: SIN_PERMISOS });
    expect(b.db.patientProfile.findFirst).not.toHaveBeenCalled();
    expect(b.api).not.toHaveBeenCalled();
  });

  it('🏢 el paciente se busca dentro de la clínica del actor; si no está, no se envía', async () => {
    const b = build(null);
    await expect(enviar(b, actor('BOOKING_AGENT'))).resolves.toEqual({ success: false, error: MSG_PACIENTE_NO_ENCONTRADO });
    expect(b.db.patientProfile.findFirst.mock.calls[0][0]).toMatchObject({ where: { id: 'pac-1', organizationId: ORG } });
    expect(b.db.patientLookupLog.create).not.toHaveBeenCalled();
    expect(b.api).not.toHaveBeenCalled();
  });

  it.each([
    [{ motivo: undefined }, /motivo/],
    [{ slotId: '' }, new RegExp(MSG_CONFIRMACION_DATOS)],
    [{ pacienteId: 7 }, new RegExp(MSG_CONFIRMACION_DATOS)],
    [{ verificacion: 'ME_LO_DIJO' }, new RegExp(MSG_CONFIRMACION_VERIFICACION)],
  ])('entrada inválida %j: no se registra ni se envía', async (over, patron) => {
    const b = build();
    const r = await enviar(b, actor('ORG_ADMIN'), over);
    expect(r.success).toBe(false);
    expect(!r.success && r.error).toMatch(patron);
    expect(b.api).not.toHaveBeenCalled();
  });

  it('el error de la API (p. ej. falta la plantilla) llega tal cual a la pantalla', async () => {
    const b = build();
    b.api.mockResolvedValueOnce({ success: false, error: 'falta registrar la plantilla' } as never);
    await expect(enviar(b, actor('ORG_ADMIN'))).resolves.toEqual({ success: false, error: 'falta registrar la plantilla' });
  });

  it('si la API no responde, un mensaje claro (y la constancia del intento queda)', async () => {
    const b = build();
    b.api.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const consola = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(enviar(b, actor('ORG_ADMIN'))).resolves.toEqual({ success: false, error: MSG_CONFIRMACION_API });
    expect(b.db.patientLookupLog.create).toHaveBeenCalledTimes(1);
    consola.mockRestore();
  });
});
