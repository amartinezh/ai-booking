import { ROLES_KEY } from '../common/roles.decorator';
import { SyncAlertsController } from './sync-alerts.controller';

describe('SyncAlertsController — «Probar» de la lista de avisos', () => {
  const crear = (r: unknown = { success: true }) => {
    const servicio = { probar: jest.fn(async () => r) };
    return {
      c: new SyncAlertsController(servicio as never),
      servicio,
    };
  };
  const admin = { userId: 'u1', email: 'admin@hsvp.gov.co', role: 'ORG_ADMIN' };

  it('la clínica y quién la pidió salen del token', async () => {
    const { c, servicio } = crear();
    await expect(c.probar('org-1', admin as never, ' r-1 ')).resolves.toEqual({
      success: true,
    });
    expect(servicio.probar).toHaveBeenCalledWith(
      'org-1',
      'r-1',
      'admin@hsvp.gov.co',
    );
  });

  it('sin persona no llama al servicio', async () => {
    const { c, servicio } = crear();
    await expect(c.probar('org-1', admin as never, '  ')).resolves.toEqual({
      success: false,
      error: 'Falta la persona.',
    });
    expect(servicio.probar).not.toHaveBeenCalled();
  });

  it('un rechazo vuelve con su motivo', async () => {
    const { c } = crear({ success: false, error: 'No salió: x.' });
    await expect(c.probar('org-1', admin as never, 'r-1')).resolves.toEqual({
      success: false,
      error: 'No salió: x.',
    });
  });

  it('🔒 solo el administrador de la clínica', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      SyncAlertsController.prototype.probar,
    ) as string[];
    expect(roles).toEqual(['ORG_ADMIN']);
  });
});
