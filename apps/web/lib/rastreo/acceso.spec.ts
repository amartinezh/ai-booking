import { permisosDeRol, resolverActor, SIN_PERMISOS } from './acceso';
import type { SessionPayload } from '../session';

const sesion = (over: Partial<SessionPayload> = {}): SessionPayload => ({
  userId: 'u1',
  email: 'x@y.co',
  role: 'ORG_ADMIN',
  organizationId: 'org-1',
  ...over,
});

const mockDb = () => ({
  organization: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => (where.id === 'org-9' ? { id: 'org-9' } : null)) },
  agentProfile: { findUnique: jest.fn(async () => null as { epsId: string | null; doctorId: string | null } | null) },
  doctorProfile: { findUnique: jest.fn(async () => ({ id: 'doc-7' }) as { id: string } | null) },
});

describe('permisosDeRol — la matriz de §5', () => {
  it('ORG_ADMIN: todo', () => {
    expect(permisosDeRol('ORG_ADMIN')).toEqual({
      buscar: true,
      soloConRelacionTerapeutica: false,
      conversacion: 'TEXTO',
      verSync: true,
      verInternos: true,
      modoB: true,
      verConsultas: true,
      aplicaScopeAgente: false,
    });
  });

  it('BOOKING_AGENT ve el TEXTO de las conversaciones (decisión 2) pero no los internos ni la bitácora', () => {
    const p = permisosDeRol('BOOKING_AGENT');
    expect(p.conversacion).toBe('TEXTO');
    expect(p.verSync).toBe(true);
    expect(p.verInternos).toBe(false);
    expect(p.verConsultas).toBe(false);
    expect(p.aplicaScopeAgente).toBe(true);
  });

  it('DOCTOR: solo pacientes con relación terapéutica; ni conversación, ni sync, ni escenario B', () => {
    const p = permisosDeRol('DOCTOR');
    expect(p.buscar).toBe(true);
    expect(p.soloConRelacionTerapeutica).toBe(true);
    expect(p.conversacion).toBe('NINGUNA');
    expect(p.verSync).toBe(false);
    expect(p.modoB).toBe(false);
  });

  it('SUPER_ADMIN: hechos de la conversación sí, texto no', () => {
    const p = permisosDeRol('SUPER_ADMIN');
    expect(p.conversacion).toBe('RESUMEN');
    expect(p.verConsultas).toBe(true);
    expect(p.verInternos).toBe(false);
  });

  it.each(['GENERAL_OBSERVER', 'PATIENT'] as const)('%s queda FUERA', (rol) => {
    expect(permisosDeRol(rol).buscar).toBe(false);
  });

  it('un rol desconocido o ausente falla cerrado', () => {
    expect(permisosDeRol('ROL_FUTURO' as never).buscar).toBe(false);
    expect(permisosDeRol(null).buscar).toBe(false);
    expect(permisosDeRol(undefined).buscar).toBe(false);
  });

  it('el escenario B exige poder ver el sync: no hay B sin verSync', () => {
    for (const rol of ['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR', 'SUPER_ADMIN'] as const) {
      const p = permisosDeRol(rol);
      if (p.modoB) expect(p.verSync).toBe(true);
    }
  });
});

describe('resolverActor', () => {
  it('sin sesión → sin permisos', async () => {
    expect(await resolverActor(mockDb() as never, null)).toEqual({ ok: false, error: SIN_PERMISOS });
  });

  it.each(['GENERAL_OBSERVER', 'PATIENT'] as const)('%s → sin permisos', async (role) => {
    expect(await resolverActor(mockDb() as never, sesion({ role }))).toEqual({ ok: false, error: SIN_PERMISOS });
  });

  it('ORG_ADMIN sin organización en el token → sin permisos', async () => {
    expect(await resolverActor(mockDb() as never, sesion({ organizationId: null }))).toEqual({
      ok: false,
      error: SIN_PERMISOS,
    });
  });

  it('🏢 el tenant sale del TOKEN: una organización que manda el cliente se IGNORA', async () => {
    const r = await resolverActor(mockDb() as never, sesion({ organizationId: 'org-1' }), 'org-OTRA');
    expect(r).toMatchObject({ ok: true, actor: { organizationId: 'org-1' } });
  });

  it('ORG_ADMIN resuelto: sin scope', async () => {
    const r = await resolverActor(mockDb() as never, sesion());
    expect(r).toMatchObject({ ok: true, actor: { role: 'ORG_ADMIN', scopeEpsId: null, scopeDoctorId: null } });
  });

  describe('SUPER_ADMIN', () => {
    const superAdmin = sesion({ role: 'SUPER_ADMIN', organizationId: null });

    it('sin organización elegida → pide elegirla (no hay búsqueda global)', async () => {
      const r = await resolverActor(mockDb() as never, superAdmin);
      expect(r).toEqual({ ok: false, error: 'Elige una organización para consultar.' });
    });

    it('una organización que no existe → error', async () => {
      const r = await resolverActor(mockDb() as never, superAdmin, 'org-inexistente');
      expect(r).toEqual({ ok: false, error: 'Organización no encontrada.' });
    });

    it('la organización elegida se valida contra la base y se usa', async () => {
      const db = mockDb();
      const r = await resolverActor(db as never, superAdmin, 'org-9');
      expect(db.organization.findUnique).toHaveBeenCalledWith({ where: { id: 'org-9' }, select: { id: true } });
      expect(r).toMatchObject({ ok: true, actor: { role: 'SUPER_ADMIN', organizationId: 'org-9' } });
    });
  });

  describe('BOOKING_AGENT', () => {
    it('toma su alcance de EPS y médico del perfil de agente', async () => {
      const db = mockDb();
      db.agentProfile.findUnique.mockResolvedValue({ epsId: 'eps-1', doctorId: 'doc-1' });

      const r = await resolverActor(db as never, sesion({ role: 'BOOKING_AGENT', userId: 'ag-1' }));

      expect(db.agentProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'ag-1' }, select: { epsId: true, doctorId: true } });
      expect(r).toMatchObject({ ok: true, actor: { scopeEpsId: 'eps-1', scopeDoctorId: 'doc-1' } });
    });

    it('sin perfil de agente no hay alcance que aplicar (igual que la pantalla de agendamiento)', async () => {
      const r = await resolverActor(mockDb() as never, sesion({ role: 'BOOKING_AGENT' }));
      expect(r).toMatchObject({ ok: true, actor: { scopeEpsId: null, scopeDoctorId: null } });
    });

    it('un agente solo con EPS asignada no tiene alcance por médico', async () => {
      const db = mockDb();
      db.agentProfile.findUnique.mockResolvedValue({ epsId: 'eps-1', doctorId: null });
      const r = await resolverActor(db as never, sesion({ role: 'BOOKING_AGENT' }));
      expect(r).toMatchObject({ ok: true, actor: { scopeEpsId: 'eps-1', scopeDoctorId: null } });
    });
  });

  describe('DOCTOR', () => {
    it('su alcance es él mismo', async () => {
      const r = await resolverActor(mockDb() as never, sesion({ role: 'DOCTOR', userId: 'u-doc' }));
      expect(r).toMatchObject({ ok: true, actor: { role: 'DOCTOR', scopeDoctorId: 'doc-7' } });
    });

    it('sin perfil de médico se rechaza', async () => {
      const db = mockDb();
      db.doctorProfile.findUnique.mockResolvedValue(null);
      expect(await resolverActor(db as never, sesion({ role: 'DOCTOR' }))).toEqual({
        ok: false,
        error: 'Perfil de médico no encontrado.',
      });
    });
  });
});
