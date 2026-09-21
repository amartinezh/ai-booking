/* eslint-disable @typescript-eslint/no-unused-vars -- los dobles de Prisma declaran `...args` para poder leer `mock.calls[n][0]` con tipos */
import { permisosBandeja, resolverActorBandeja, SIN_PERMISOS } from './acceso';
import type { SessionPayload } from '../session';

const sesion = (over: Partial<SessionPayload> = {}): SessionPayload => ({
  userId: 'u1',
  email: 'x@y.co',
  role: 'ORG_ADMIN',
  organizationId: 'org-1',
  ...over,
});

const mockDb = (perfil: { epsId: string | null; doctorId: string | null } | null = null) => ({
  agentProfile: { findUnique: jest.fn(async (..._a: unknown[]) => perfil) },
});

describe('permisosBandeja — quién puede qué', () => {
  it('ORG_ADMIN: todo', () => {
    expect(permisosBandeja('ORG_ADMIN')).toEqual({
      ver: true,
      trabajar: true,
      verInternos: true,
      administrar: true,
      configurarAvisos: true,
      aplicaScopeAgente: false,
    });
  });

  it('BOOKING_AGENT: ve y trabaja, con su alcance; sin internos, sin administrar, sin configurar avisos', () => {
    expect(permisosBandeja('BOOKING_AGENT')).toEqual({
      ver: true,
      trabajar: true,
      verInternos: false,
      administrar: false,
      configurarAvisos: false,
      aplicaScopeAgente: true,
    });
  });

  it('🔒 nadie más entra: ni SUPER_ADMIN (soporte de plataforma), ni DOCTOR, ni PATIENT, ni un rol futuro, ni sin rol', () => {
    for (const rol of ['SUPER_ADMIN', 'DOCTOR', 'PATIENT', 'GENERAL_OBSERVER', 'ROL_FUTURO', null, undefined] as never[]) {
      const p = permisosBandeja(rol);
      expect(Object.values(p).every((v) => v === false)).toBe(true);
    }
  });

  it('quien no puede ver tampoco puede trabajar (nunca al revés)', () => {
    for (const rol of ['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR', 'SUPER_ADMIN'] as const) {
      const p = permisosBandeja(rol);
      if (p.trabajar) expect(p.ver).toBe(true);
    }
  });
});

describe('resolverActorBandeja', () => {
  it('sin sesión, o con un rol sin acceso, o sin clínica en el token: sin permisos', async () => {
    const db = mockDb();
    await expect(resolverActorBandeja(db as never, null)).resolves.toEqual({ ok: false, error: SIN_PERMISOS });
    await expect(resolverActorBandeja(db as never, sesion({ role: 'DOCTOR' }))).resolves.toEqual({ ok: false, error: SIN_PERMISOS });
    await expect(resolverActorBandeja(db as never, sesion({ role: 'SUPER_ADMIN' }))).resolves.toEqual({ ok: false, error: SIN_PERMISOS });
    await expect(resolverActorBandeja(db as never, sesion({ organizationId: undefined as never }))).resolves.toEqual({ ok: false, error: SIN_PERMISOS });
    await expect(resolverActorBandeja(db as never, sesion({ organizationId: '' as never }))).resolves.toEqual({ ok: false, error: SIN_PERMISOS });
  });

  it('🏢 la clínica sale del TOKEN', async () => {
    const r = await resolverActorBandeja(mockDb() as never, sesion({ organizationId: 'org-7' }));
    expect(r).toMatchObject({ ok: true, actor: { organizationId: 'org-7', userId: 'u1', role: 'ORG_ADMIN' } });
  });

  it('el actor lleva el rol y los permisos de SU sesión (no los de otro)', async () => {
    const r = await resolverActorBandeja(mockDb() as never, sesion({ role: 'BOOKING_AGENT', userId: 'u-agente' }));
    expect(r).toMatchObject({ ok: true, actor: { role: 'BOOKING_AGENT', userId: 'u-agente', permisos: permisosBandeja('BOOKING_AGENT') } });
  });

  it('ORG_ADMIN no consulta el perfil de agente y no queda acotado', async () => {
    const db = mockDb({ epsId: 'eps-1', doctorId: 'doc-1' });
    const r = await resolverActorBandeja(db as never, sesion());
    expect(db.agentProfile.findUnique).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, actor: { scopeEpsId: null, scopeDoctorId: null } });
  });

  it('🎯 BOOKING_AGENT con EPS y médico: queda acotado a los dos', async () => {
    const db = mockDb({ epsId: 'eps-1', doctorId: 'doc-1' });
    const r = await resolverActorBandeja(db as never, sesion({ role: 'BOOKING_AGENT' }));
    expect(db.agentProfile.findUnique.mock.calls[0][0]).toMatchObject({ where: { userId: 'u1' } });
    expect(r).toMatchObject({ ok: true, actor: { scopeEpsId: 'eps-1', scopeDoctorId: 'doc-1' } });
  });

  it('BOOKING_AGENT sin perfil, o con campos vacíos: global (como en su lista de citas)', async () => {
    const sinPerfil = await resolverActorBandeja(mockDb(null) as never, sesion({ role: 'BOOKING_AGENT' }));
    expect(sinPerfil).toMatchObject({ ok: true, actor: { scopeEpsId: null, scopeDoctorId: null } });
    const vacio = await resolverActorBandeja(mockDb({ epsId: '', doctorId: '' }) as never, sesion({ role: 'BOOKING_AGENT' }));
    expect(vacio).toMatchObject({ ok: true, actor: { scopeEpsId: null, scopeDoctorId: null } });
  });
});
