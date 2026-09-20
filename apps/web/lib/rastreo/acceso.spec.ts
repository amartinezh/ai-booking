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
      verPersonal: true,
      aplicaScopeAgente: false,
      hisEnVivo: true,
    });
  });

  // La consulta en vivo lee la base PRODUCTIVA del hospital: es de quien ya ve el
  // estado del espejo y atiende reclamos, no de quien solo revisa a sus pacientes.
  it('🏥 la consulta en vivo al HIS: ORG_ADMIN, BOOKING_AGENT y SUPER_ADMIN; nadie más', () => {
    expect(permisosDeRol('ORG_ADMIN').hisEnVivo).toBe(true);
    expect(permisosDeRol('BOOKING_AGENT').hisEnVivo).toBe(true);
    expect(permisosDeRol('SUPER_ADMIN').hisEnVivo).toBe(true);
    expect(permisosDeRol('DOCTOR').hisEnVivo).toBe(false);
    expect(permisosDeRol('PATIENT').hisEnVivo).toBe(false);
    expect(permisosDeRol('GENERAL_OBSERVER').hisEnVivo).toBe(false);
    expect(permisosDeRol('ROL_FUTURO' as never).hisEnVivo).toBe(false);
    expect(permisosDeRol(null).hisEnVivo).toBe(false);
  });

  it('quien puede consultar el HIS en vivo puede buscar y ve el estado del espejo (nunca al revés)', () => {
    for (const rol of ['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR', 'SUPER_ADMIN', 'PATIENT', 'GENERAL_OBSERVER'] as const) {
      const p = permisosDeRol(rol);
      if (p.hisEnVivo) {
        expect(p.buscar).toBe(true);
        expect(p.verSync).toBe(true);
      }
    }
  });

  it('👤 solo quien revisa casos (ORG_ADMIN, SUPER_ADMIN) ve QUIÉN del personal hizo algo; los demás, solo el rol', () => {
    expect(permisosDeRol('ORG_ADMIN').verPersonal).toBe(true);
    expect(permisosDeRol('SUPER_ADMIN').verPersonal).toBe(true);
    expect(permisosDeRol('BOOKING_AGENT').verPersonal).toBe(false);
    expect(permisosDeRol('DOCTOR').verPersonal).toBe(false);
    expect(permisosDeRol('PATIENT').verPersonal).toBe(false);
    expect(permisosDeRol('GENERAL_OBSERVER').verPersonal).toBe(false);
    expect(permisosDeRol('ROL_FUTURO' as never).verPersonal).toBe(false);
  });

  it('quien ve la bitácora (donde aparecen los correos del personal) es exactamente quien ve al personal', () => {
    for (const rol of ['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR', 'SUPER_ADMIN', 'PATIENT', 'GENERAL_OBSERVER'] as const) {
      expect(permisosDeRol(rol).verPersonal).toBe(permisosDeRol(rol).verConsultas);
    }
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
