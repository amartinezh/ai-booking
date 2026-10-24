import { MedicosNuevosController } from './medicos-nuevos.controller';

describe('MedicosNuevosController — el botón «Crear y homologar»', () => {
  const crear = (r: unknown = { ok: true, accion: 'CREAR', doctorId: 'd1', nombre: 'MICHILLE' }) => {
    const servicio = { homologar: jest.fn(async () => r) };
    return { c: new MedicosNuevosController(servicio as any), servicio };
  };
  const admin = { userId: 'u1', email: 'admin@hsvp.gov.co', role: 'ORG_ADMIN' };

  it('la clínica y quién lo hizo salen del token; WhatsApp solo con un true explícito', async () => {
    const { c, servicio } = crear();
    expect(await c.onboard('org-1', admin, { externalKey: ' RU68 ', whatsappOn: 'true' })).toEqual({ success: true, accion: 'CREAR', nombre: 'MICHILLE' });
    expect(servicio.homologar).toHaveBeenCalledWith('org-1', 'RU68', { whatsappOn: false, actor: 'admin@hsvp.gov.co', via: 'BANDEJA' });
    await c.onboard('org-1', admin, { externalKey: 'RU68', whatsappOn: true });
    expect(servicio.homologar.mock.calls[1][2].whatsappOn).toBe(true);
  });

  it('sin código no llama al servicio', async () => {
    const { c, servicio } = crear();
    expect(await c.onboard('org-1', admin, {})).toEqual({ success: false, error: expect.stringContaining('Falta el código') });
    expect(servicio.homologar).not.toHaveBeenCalled();
  });

  it('un rechazo del servicio vuelve con su motivo', async () => {
    const { c } = crear({ ok: false, codigo: 'BLOQUEADO', motivo: 'Su cédula la tienen 3 médicos.' });
    expect(await c.onboard('org-1', admin, { externalKey: '77' })).toEqual({ success: false, error: 'Su cédula la tienen 3 médicos.' });
  });
});
