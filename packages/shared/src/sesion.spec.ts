import { DURACION_SESION_SEG, emisionDelToken, motivoSesionInvalida, type CuentaDeLaSesion } from './sesion';

const cuenta = (c: Partial<CuentaDeLaSesion> = {}): CuentaDeLaSesion => ({
  role: 'BOOKING_AGENT',
  organizationId: 'org-1',
  sessionsRevokedAt: null,
  clinicaActiva: true,
  ...c,
});
const token = { role: 'BOOKING_AGENT', organizationId: 'org-1', iat: 1_800_000_000 };

describe('motivoSesionInvalida', () => {
  it('una cuenta igual, activa y sin cierre: vigente', () => {
    expect(motivoSesionInvalida(token, cuenta())).toBeNull();
  });

  it('cuenta borrada, rol o clínica cambiados', () => {
    expect(motivoSesionInvalida(token, null)).toBe('CUENTA_NO_EXISTE');
    expect(motivoSesionInvalida(token, cuenta({ role: 'ORG_ADMIN' }))).toBe('ROL_CAMBIO');
    expect(motivoSesionInvalida(token, cuenta({ organizationId: 'org-2' }))).toBe('CLINICA_CAMBIO');
  });

  it('clínica suspendida saca al personal, no al super administrador', () => {
    expect(motivoSesionInvalida(token, cuenta({ clinicaActiva: false }))).toBe('CLINICA_SUSPENDIDA');
    const sa = { role: 'SUPER_ADMIN', organizationId: null, iat: 1_800_000_000 };
    expect(motivoSesionInvalida(sa, cuenta({ role: 'SUPER_ADMIN', organizationId: null, clinicaActiva: null }))).toBeNull();
  });

  it('«cerrar sesiones» saca los tokens anteriores, no los del mismo segundo ni los posteriores', () => {
    const cierre = new Date(1_800_000_000 * 1000 + 400);
    expect(motivoSesionInvalida({ ...token, iat: 1_799_999_999 }, cuenta({ sessionsRevokedAt: cierre }))).toBe(
      'SESIONES_CERRADAS',
    );
    expect(motivoSesionInvalida(token, cuenta({ sessionsRevokedAt: cierre }))).toBeNull();
    expect(motivoSesionInvalida({ ...token, iat: 1_800_000_060 }, cuenta({ sessionsRevokedAt: cierre }))).toBeNull();
  });

  it('un token viejo sin iat se fecha por su vencimiento; sin ninguno de los dos, cae con el cierre', () => {
    const cierre = new Date(1_800_000_000 * 1000);
    const viejo = { role: 'BOOKING_AGENT', organizationId: 'org-1', exp: 1_800_000_000 + 60 };
    expect(emisionDelToken(viejo)).toBe(1_800_000_060 - DURACION_SESION_SEG);
    expect(motivoSesionInvalida(viejo, cuenta({ sessionsRevokedAt: cierre }))).toBe('SESIONES_CERRADAS');
    expect(motivoSesionInvalida({ role: 'BOOKING_AGENT', organizationId: 'org-1' }, cuenta({ sessionsRevokedAt: cierre }))).toBe(
      'SESIONES_CERRADAS',
    );
    expect(motivoSesionInvalida({ role: 'BOOKING_AGENT', organizationId: 'org-1' }, cuenta())).toBeNull();
  });

  it('organizationId ausente y null son lo mismo', () => {
    expect(
      motivoSesionInvalida({ role: 'SUPER_ADMIN', iat: 1 }, cuenta({ role: 'SUPER_ADMIN', organizationId: null, clinicaActiva: null })),
    ).toBeNull();
  });
});
