import {
  MAX_DESTINATARIOS_AVISO,
  alcanceDeDestinatario,
  coberturaAvisos,
  destinatariosDelLote,
  explicarFalloDeEnvio,
  hayQuienRecibaElAviso,
  nombreDeDestinatario,
  nombresParaHistorial,
  parametrosPruebaAviso,
  problemaDeCobertura,
  repartirLote,
  type DestinatarioAviso,
} from './avisos-destinatarios';

/**
 * A quién le llegan los avisos de la Bandeja (docs/PLAN_AVISOS_AGENDADORES.md). Lo
 * que se fija: el modo (N5), qué avisos (N6), el alcance (N3), lo que no le cabe a
 * nadie (N4) y que nunca salga un número en el historial.
 */
const d = (over: Partial<DestinatarioAviso> = {}): DestinatarioAviso => ({
  id: 'r-1',
  nombre: 'Karen Muñoz',
  phone: '573105550101',
  mode: 'AVISOS',
  syncAlerts: true,
  patientRequestAlerts: true,
  isActive: true,
  alcance: null,
  ...over,
});

describe('destinatariosDelLote — quién recibe este lote', () => {
  const karen = d();
  const jeisson = d({
    id: 'r-2',
    nombre: 'Jeisson Rojas',
    phone: '573105550104',
    mode: 'SOLO_RECORDATORIOS',
  });
  const ana = d({
    id: 'r-3',
    nombre: 'Ana García',
    phone: '573105550103',
    patientRequestAlerts: false,
  });
  const pausada = d({ id: 'r-4', phone: '573105550199', isActive: false });

  it('el primer aviso, solo a «Avisos y recordatorios»', () => {
    expect(
      destinatariosDelLote([karen, jeisson, ana], 'SINCRONIZACION', 'AVISO').map((x) => x.id),
    ).toEqual(['r-1', 'r-3']);
  });

  it('los recordatorios, también a «Solo recordatorios» (el respaldo de antes)', () => {
    expect(
      destinatariosDelLote([karen, jeisson, ana], 'SINCRONIZACION', 'RECORDATORIO').map((x) => x.id),
    ).toEqual(['r-1', 'r-2', 'r-3']);
  });

  it('cada quien recibe solo los avisos que marcó', () => {
    expect(
      destinatariosDelLote([karen, jeisson, ana], 'PEDIDOS_PACIENTES', 'AVISO').map((x) => x.id),
    ).toEqual(['r-1']);
  });

  it('una persona en pausa no recibe nada', () => {
    expect(destinatariosDelLote([pausada], 'SINCRONIZACION', 'AVISO')).toEqual([]);
    expect(destinatariosDelLote([pausada], 'SINCRONIZACION', 'RECORDATORIO')).toEqual([]);
  });

  it('un mismo número no recibe dos veces', () => {
    const repetido = d({ id: 'r-9', nombre: 'Otra fila' });
    expect(destinatariosDelLote([karen, repetido], 'SINCRONIZACION', 'AVISO')).toHaveLength(1);
  });
});

describe('hayQuienRecibaElAviso — sin primer aviso no sale nada', () => {
  it('con alguien en «Avisos y recordatorios» de ese grupo, sí', () => {
    expect(hayQuienRecibaElAviso([d()], 'SINCRONIZACION')).toBe(true);
  });

  it('solo «Solo recordatorios», en pausa o de otro grupo: no', () => {
    expect(hayQuienRecibaElAviso([d({ mode: 'SOLO_RECORDATORIOS' })], 'SINCRONIZACION')).toBe(false);
    expect(hayQuienRecibaElAviso([d({ isActive: false })], 'SINCRONIZACION')).toBe(false);
    expect(hayQuienRecibaElAviso([d({ syncAlerts: false })], 'SINCRONIZACION')).toBe(false);
    expect(hayQuienRecibaElAviso([], 'PEDIDOS_PACIENTES')).toBe(false);
  });
});

describe('repartirLote — el alcance (N3) y lo que no le cabe a nadie (N4)', () => {
  const caso = (id: string, epsId: string | null, doctorId: string | null) => ({ id, epsId, doctorId });
  const todo = d({ id: 'admin', alcance: null });
  const sura = d({ id: 'sura', alcance: { epsId: 'eps-sura', doctorId: null } });
  const ruiz = d({ id: 'ruiz', alcance: { epsId: null, doctorId: 'doc-ruiz' } });

  const ids = (r: { destinatario: DestinatarioAviso; items: { id: string }[] }[]) =>
    Object.fromEntries(r.map((p) => [p.destinatario.id, p.items.map((i) => i.id)]));

  it('sin acotar recibe todo; acotado, solo lo de su EPS o su médico', () => {
    const r = repartirLote([todo, sura, ruiz], [
      caso('a', 'eps-sura', 'doc-otro'),
      caso('b', 'eps-salud', 'doc-ruiz'),
      caso('c', 'eps-salud', 'doc-otro'),
    ]);
    expect(ids(r)).toEqual({ admin: ['a', 'b', 'c'], sura: ['a'], ruiz: ['b'] });
  });

  it('🔒 falla cerrado como la bandeja: sin EPS conocida, el acotado a una EPS no lo recibe', () => {
    const r = repartirLote([todo, sura], [caso('a', null, 'doc-1')]);
    expect(ids(r)).toEqual({ admin: ['a'] });
  });

  it('N4: si por alcance no le cabe a nadie, les llega a todos los del lote', () => {
    const r = repartirLote([sura, ruiz], [caso('a', 'eps-salud', 'doc-otro'), caso('b', 'eps-sura', null)]);
    expect(ids(r)).toEqual({ sura: ['a', 'b'], ruiz: ['a'] });
  });

  it('solo devuelve a quien le toca algo', () => {
    const r = repartirLote([todo, sura], [caso('a', 'eps-salud', null)]);
    expect(ids(r)).toEqual({ admin: ['a'] });
  });

  it('sin destinatarios o sin casos, nada', () => {
    expect(repartirLote([], [caso('a', null, null)])).toEqual([]);
    expect(repartirLote([todo], [])).toEqual([]);
  });
});

describe('nombresParaHistorial — nombres, nunca números', () => {
  it.each([
    [[], ''],
    [['Karen Muñoz'], 'Karen Muñoz'],
    [['Karen Muñoz', 'Ana García'], 'Karen Muñoz y Ana García'],
    [['A', 'B', 'C'], 'A, B y C'],
    [['A', 'B', 'C', 'D', 'E'], 'A, B, C y 2 más'],
  ])('%j → «%s»', (nombres, esperado) => {
    expect(nombresParaHistorial(nombres)).toBe(esperado);
  });
});

describe('coberturaAvisos — lo que dice la pantalla arriba', () => {
  it('cuenta personas activas y, por aviso, quién recibe el primero y quién los recordatorios', () => {
    const c = coberturaAvisos([
      d(),
      d({ id: 'r-2', mode: 'SOLO_RECORDATORIOS', patientRequestAlerts: false }),
      d({ id: 'r-3', syncAlerts: false }),
      d({ id: 'r-4', isActive: false }),
    ]);
    expect(c.personas).toBe(3);
    expect(c.porGrupo.SINCRONIZACION).toEqual({ avisos: 1, recordatorios: 2, todosAcotados: false });
    expect(c.porGrupo.PEDIDOS_PACIENTES).toEqual({ avisos: 2, recordatorios: 2, todosAcotados: false });
  });

  it('avisa cuando TODOS los que reciben el aviso están acotados', () => {
    const c = coberturaAvisos([d({ alcance: { epsId: 'eps-sura', doctorId: null } })]);
    expect(c.porGrupo.SINCRONIZACION.todosAcotados).toBe(true);
    expect(coberturaAvisos([]).porGrupo.SINCRONIZACION.todosAcotados).toBe(false);
  });
});

describe('problemaDeCobertura — lo que impide guardar', () => {
  it('«Solo recordatorios» sin nadie que reciba el primer aviso de ese grupo', () => {
    expect(problemaDeCobertura([d({ mode: 'SOLO_RECORDATORIOS' })])).toMatch(
      /Nadie recibe el primer aviso de «Citas que no llegan al hospital»/,
    );
    expect(
      problemaDeCobertura([d({ syncAlerts: false }), d({ id: 'r-2', mode: 'SOLO_RECORDATORIOS', patientRequestAlerts: false })]),
    ).toMatch(/Citas que no llegan/);
    expect(
      problemaDeCobertura([d({ patientRequestAlerts: false }), d({ id: 'r-2', mode: 'SOLO_RECORDATORIOS', syncAlerts: false })]),
    ).toMatch(/Pedidos de pacientes/);
  });

  it('bien: con primer aviso, sin nadie, o con el de «solo recordatorios» en pausa', () => {
    expect(problemaDeCobertura([d(), d({ id: 'r-2', mode: 'SOLO_RECORDATORIOS' })])).toBeNull();
    expect(problemaDeCobertura([])).toBeNull();
    expect(problemaDeCobertura([d({ mode: 'SOLO_RECORDATORIOS', isActive: false })])).toBeNull();
  });
});

describe('alcanceDeDestinatario y nombreDeDestinatario', () => {
  it('solo un agendador con EPS o médico está acotado', () => {
    expect(alcanceDeDestinatario({ role: 'BOOKING_AGENT', agentProfile: { epsId: 'e', doctorId: null } })).toEqual({ epsId: 'e', doctorId: null });
    expect(alcanceDeDestinatario({ role: 'BOOKING_AGENT', agentProfile: { epsId: null, doctorId: '' } })).toBeNull();
    expect(alcanceDeDestinatario({ role: 'BOOKING_AGENT', agentProfile: null })).toBeNull();
    expect(alcanceDeDestinatario({ role: 'ORG_ADMIN', agentProfile: { epsId: 'e', doctorId: 'd' } })).toBeNull();
    expect(alcanceDeDestinatario(null)).toBeNull();
  });

  it('el nombre: el del perfil, si no el correo, si no la etiqueta', () => {
    expect(nombreDeDestinatario({ label: 'X', user: { email: 'k@h.co', agentProfile: { fullName: ' Karen ' } } })).toBe('Karen');
    expect(nombreDeDestinatario({ label: 'X', user: { email: 'k@h.co', agentProfile: null } })).toBe('k@h.co');
    expect(nombreDeDestinatario({ label: 'Coordinación', user: null })).toBe('Coordinación');
    expect(nombreDeDestinatario({ label: null, user: null })).toBe('Sin nombre');
  });
});

describe('parametrosPruebaAviso — la prueba usa la plantilla del aviso', () => {
  it('tres variables de una línea, que dicen que es una prueba', () => {
    const p = parametrosPruebaAviso();
    expect(p).toHaveLength(3);
    expect(p[0]).toBe('0');
    expect(p.join(' ')).toMatch(/prueba/i);
    for (const v of p) expect(v).not.toMatch(/[\n\r\t]| {4,}/);
  });

  it('el tope de destinatarios es el aprobado (N7)', () => {
    expect(MAX_DESTINATARIOS_AVISO).toBe(15);
  });
});

describe('explicarFalloDeEnvio — el motivo, sin el JSON de Meta', () => {
  it('los fallos propios de AgenIA, en palabras', () => {
    expect(explicarFalloDeEnvio('template-not-configured')).toMatch(/plantilla/);
    expect(explicarFalloDeEnvio('whatsapp-inactive')).toMatch(/apagado/);
  });

  it('de Meta: el detalle y el código', () => {
    const meta = JSON.stringify({
      error: { message: '(#131030) Recipient phone number not in allowed list', code: 131030, error_data: { details: 'Recipient phone number not in allowed list' } },
    });
    expect(explicarFalloDeEnvio(meta)).toBe('Recipient phone number not in allowed list (código 131030)');
    expect(explicarFalloDeEnvio(JSON.stringify({ error: { message: 'Invalid parameter' } }))).toBe('Invalid parameter');
  });

  it('sin motivo, o un texto cualquiera largo: acotado y en una línea', () => {
    expect(explicarFalloDeEnvio(null)).toMatch(/no se sabe/);
    const r = explicarFalloDeEnvio(`timeout\n${'x'.repeat(400)}`);
    expect(r.length).toBeLessThanOrEqual(200);
    expect(r).not.toMatch(/\n/);
  });
});
