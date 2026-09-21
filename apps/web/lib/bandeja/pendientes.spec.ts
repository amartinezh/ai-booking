/* eslint-disable @typescript-eslint/no-unused-vars -- los dobles de Prisma declaran `...args` para poder leer `mock.calls[n][0]` con tipos */
import { pendientesParaMenu } from './pendientes';
import type { SessionPayload } from '../session';

const sesion = (over: Partial<SessionPayload> = {}): SessionPayload => ({
  userId: 'u1',
  email: 'x@y.co',
  role: 'ORG_ADMIN',
  organizationId: 'org-1',
  ...over,
});

const mockDb = (over: { abiertas?: number; perfil?: { epsId: string | null; doctorId: string | null } | null; falla?: boolean } = {}) => ({
  agentProfile: { findUnique: jest.fn(async (..._a: unknown[]) => over.perfil ?? null) },
  syncException: {
    count: jest.fn(async (..._a: unknown[]) => {
      if (over.falla) throw new Error('base caída');
      return over.abiertas ?? 0;
    }),
  },
});

describe('pendientesParaMenu — la cifra del menú no puede tumbar el dashboard', () => {
  it('sin espejo: 0 y ni toca la base', async () => {
    const db = mockDb({ abiertas: 5 });
    await expect(pendientesParaMenu(db as never, sesion(), false)).resolves.toBe(0);
    expect(db.syncException.count).not.toHaveBeenCalled();
  });

  it('cuenta las abiertas de la clínica del token', async () => {
    const db = mockDb({ abiertas: 4 });
    await expect(pendientesParaMenu(db as never, sesion(), true)).resolves.toBe(4);
    expect((db.syncException.count.mock.calls[0][0] as { where: unknown }).where).toEqual({ organizationId: 'org-1', status: 'ABIERTA' });
  });

  it('🎯 un agente acotado cuenta solo lo de su EPS', async () => {
    const db = mockDb({ abiertas: 2, perfil: { epsId: 'eps-1', doctorId: null } });
    await expect(pendientesParaMenu(db as never, sesion({ role: 'BOOKING_AGENT' }), true)).resolves.toBe(2);
    expect((db.syncException.count.mock.calls[0][0] as { where: unknown }).where).toEqual({ organizationId: 'org-1', epsId: 'eps-1', status: 'ABIERTA' });
  });

  it('sin sesión o con un rol sin acceso: 0, sin consultar', async () => {
    const db = mockDb({ abiertas: 5 });
    await expect(pendientesParaMenu(db as never, null, true)).resolves.toBe(0);
    await expect(pendientesParaMenu(db as never, sesion({ role: 'DOCTOR' }), true)).resolves.toBe(0);
    await expect(pendientesParaMenu(db as never, sesion({ role: 'SUPER_ADMIN' }), true)).resolves.toBe(0);
    expect(db.syncException.count).not.toHaveBeenCalled();
  });

  it('💥 si la base falla, responde 0 (el dashboard sigue) y deja el rastro', async () => {
    const consola = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = mockDb({ falla: true });
    await expect(pendientesParaMenu(db as never, sesion(), true)).resolves.toBe(0);
    expect(consola).toHaveBeenCalledWith(expect.stringContaining('[bandeja]'), expect.objectContaining({ error: 'base caída' }));
    consola.mockRestore();
  });
});
