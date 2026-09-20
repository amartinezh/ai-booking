import {
  AGENTE_SIN_SENAL_MIN,
  COLA_ATASCADA_MIN,
  VEREDICTO,
  TEXTO_VEREDICTO,
  clasificarRastreoA,
  clasificarRastreoB,
  construirLineaDeVida,
  type CitaRastreo,
  type EstadoSync,
  type EvidenciaRastreoA,
  type EvidenciaRastreoB,
  type ResultadoRastreo,
  type SaludEspejo,
} from './patient-trace';

// Lunes 21-sep-2026 10:00 en Bogotá.
const AHORA = '2026-09-21T15:00:00.000Z';
const MIN = 60_000;
const DIA = 86_400_000;
const hace = (ms: number) => new Date(Date.parse(AHORA) - ms).toISOString();
const dentroDe = (ms: number) => new Date(Date.parse(AHORA) + ms).toISOString();

// ── Fábricas ────────────────────────────────────────────────────────────────

const sync = (over: Partial<EstadoSync> = {}): EstadoSync => ({
  estado: 'DELIVERED',
  attempts: 0,
  lastError: null,
  creadoIso: hace(30 * MIN),
  oldestPendingIso: null,
  nextAttemptIso: null,
  deliveredAtIso: hace(29 * MIN),
  seq: null,
  ...over,
});

const espejoSano = (over: Partial<SaludEspejo> = {}): SaludEspejo => ({
  enabled: true,
  pushEnabled: true,
  pullEnabled: true,
  lastHeartbeatIso: hace(1 * MIN),
  hisReachable: true,
  hisDetail: null,
  ...over,
});

const cita = (over: Partial<CitaRastreo> = {}): CitaRastreo => ({
  id: 'apt-1',
  status: 'SCHEDULED',
  attendance: 'PENDING',
  origin: 'WHATSAPP',
  createdAtIso: hace(30 * MIN),
  startIso: dentroDe(2 * DIA),
  doctor: 'Dr(a). Ana Ruiz',
  service: 'Medicina General',
  eps: 'Sura',
  cancelacion: null,
  sync: sync(),
  confirmacion: {
    status: 'DELIVERED',
    enviadoIso: hace(30 * MIN),
    estadoIso: hace(29 * MIN),
    errorDetalle: null,
  },
  confirmadaEnConversacion: true,
  coincideConCaptura: null,
  ...over,
});

const evA = (over: Partial<EvidenciaRastreoA> = {}): EvidenciaRastreoA => ({
  ahoraIso: AHORA,
  pacienteEncontrado: true,
  citas: [],
  citasOcultas: 0,
  espera: [],
  conversacion: null,
  espejo: espejoSano(),
  capturaIndicada: false,
  ...over,
});

const conversacion = (
  over: Partial<NonNullable<EvidenciaRastreoA['conversacion']>> = {},
): NonNullable<EvidenciaRastreoA['conversacion']> => ({
  mensajes: 8,
  primerMensajeIso: hace(2 * DIA),
  ultimoMensajeIso: hace(2 * DIA - 10 * MIN),
  fallos: [],
  ultimoResultado: 'OTRO',
  ...over,
});

const texto = (r: ResultadoRastreo) =>
  JSON.stringify(r.veredictos.map((v) => [v.titulo, v.resumen, v.evidencia, v.noSabemos, v.accion]));

// ═══════════════════════════════════════════════════════════════════════════
// ESCENARIO A
// ═══════════════════════════════════════════════════════════════════════════

describe('clasificarRastreoA — sin citas relevantes', () => {
  it('NUNCA_CONFIRMO: hubo conversación y un fallo, pero ninguna cita', () => {
    const r = clasificarRastreoA(
      evA({
        conversacion: conversacion({
          fallos: [{ motivo: 'SLOT_TAKEN', atIso: hace(2 * DIA - 5 * MIN) }],
        }),
      }),
    );

    expect(r.principal.codigo).toBe(VEREDICTO.NUNCA_CONFIRMO);
    expect(r.principal.fuente).toBe('AGENIA');
    expect(r.principal.evidencia.join(' ')).toContain('8 mensaje(s)');
    expect(r.principal.evidencia.join(' ')).toContain(
      'el horario ya lo había tomado otro paciente',
    );
    expect(r.principal.accion).toContain('captura');
  });

  it('NUNCA_CONFIRMO con un fallo de motivo desconocido lo cita tal cual', () => {
    const r = clasificarRastreoA(
      evA({
        conversacion: conversacion({
          fallos: [{ motivo: 'ALGO_NUEVO', atIso: hace(1 * DIA) }],
        }),
      }),
    );
    expect(r.principal.evidencia.join(' ')).toContain('ALGO_NUEVO');
  });

  it('EN_LISTA_DE_ESPERA: WAITING', () => {
    const r = clasificarRastreoA(
      evA({
        espera: [
          { status: 'WAITING', servicio: 'Cardiología', desdeIso: hace(3 * DIA), avisadoIso: null },
        ],
        conversacion: conversacion(),
      }),
    );

    expect(r.principal.codigo).toBe(VEREDICTO.EN_LISTA_DE_ESPERA);
    expect(r.principal.evidencia.join(' ')).toContain('Cardiología');
    expect(r.principal.accion).toContain('no es una cita');
  });

  it('EN_LISTA_DE_ESPERA: NOTIFIED le dice que responda SÍ', () => {
    const r = clasificarRastreoA(
      evA({
        espera: [
          { status: 'NOTIFIED', servicio: 'Cardiología', desdeIso: hace(3 * DIA), avisadoIso: hace(20 * MIN) },
        ],
      }),
    );

    expect(r.principal.codigo).toBe(VEREDICTO.EN_LISTA_DE_ESPERA);
    expect(r.principal.accion).toContain('SÍ');
  });

  it('una lista de espera ya vencida o cancelada NO cuenta', () => {
    const r = clasificarRastreoA(
      evA({
        espera: [
          { status: 'EXPIRED', servicio: 'Cardiología', desdeIso: hace(9 * DIA), avisadoIso: hace(9 * DIA) },
          { status: 'CANCELLED', servicio: 'Cardiología', desdeIso: hace(9 * DIA), avisadoIso: null },
        ],
      }),
    );
    expect(r.principal.codigo).toBe(VEREDICTO.SIN_RASTRO);
  });

  it('FUERA_DE_ALCANCE: el scope esconde las citas: NO se puede concluir que no agendó', () => {
    const r = clasificarRastreoA(evA({ citasOcultas: 2, conversacion: conversacion() }));

    expect(r.principal.codigo).toBe(VEREDICTO.FUERA_DE_ALCANCE);
    expect(r.principal.severidad).toBe('warn');
    expect(r.principal.accion).toContain('administrador');
  });

  it('FUERA_DE_ALCANCE gana sobre NUNCA_CONFIRMO y SIN_RASTRO: sería una conclusión falsa', () => {
    const r = clasificarRastreoA(evA({ citasOcultas: 1, conversacion: null }));
    expect(r.principal.codigo).toBe(VEREDICTO.FUERA_DE_ALCANCE);
  });

  it('SIN_RASTRO: nada por ningún lado, y lo dice sin acusar', () => {
    const r = clasificarRastreoA(evA({ conversacion: conversacion({ mensajes: 0 }) }));

    expect(r.principal.codigo).toBe(VEREDICTO.SIN_RASTRO);
    expect(r.principal.noSabemos.join(' ')).toContain('Esto no prueba que no haya agendado');
    expect(r.principal.accion).toContain('número de WhatsApp');
    // "AgenIA no tiene registro" NO es "no agendó".
    expect(texto(r)).not.toMatch(/no agendó/i);
  });

  it('SIN_RASTRO sin perfil dice que no hay un perfil con ese dato', () => {
    const r = clasificarRastreoA(
      evA({ pacienteEncontrado: false, conversacion: conversacion({ mensajes: 0 }) }),
    );
    expect(r.principal.evidencia.join(' ')).toContain('No hay un perfil con ese dato');
  });

  it('SIN_RASTRO con la conversación oculta lo avisa: no confundir "no existe" con "no la puedo ver"', () => {
    const r = clasificarRastreoA(evA({ conversacion: null }));
    expect(r.principal.codigo).toBe(VEREDICTO.SIN_RASTRO);
    expect(r.principal.noSabemos.join(' ')).toContain('no muestra la conversación');
  });

  it('una cita agendada hace 45 días queda fuera de la ventana: es historia, no un veredicto', () => {
    const r = clasificarRastreoA(
      evA({ citas: [cita({ startIso: hace(45 * DIA) })], conversacion: conversacion({ mensajes: 0 }) }),
    );
    expect(r.principal.codigo).toBe(VEREDICTO.SIN_RASTRO);
  });

  it('una cita ya ATENDIDA no genera veredicto (salvo que coincida con la captura)', () => {
    const atendida = cita({ status: 'COMPLETED', attendance: 'ATTENDED', startIso: hace(3 * DIA) });
    expect(clasificarRastreoA(evA({ citas: [atendida] })).principal.codigo).toBe(
      VEREDICTO.SIN_RASTRO,
    );
    const conCaptura = clasificarRastreoA(
      evA({ citas: [{ ...atendida, coincideConCaptura: true }], capturaIndicada: true }),
    );
    expect(conCaptura.principal.codigo).toBe(VEREDICTO.CITA_VIGENTE);
    // Atendida: no se discute su envío al HIS, y el desenlace queda dicho.
    expect(conCaptura.principal.evidencia.join(' ')).toContain('asistió');
    expect(texto(conCaptura)).not.toMatch(/agente|en cola|hacia el hospital|al HIS/i);
  });

  it('una inasistencia registrada se dice tal cual (es lo que se discute en un reclamo)', () => {
    const noVino = cita({ status: 'COMPLETED', attendance: 'NO_SHOW', startIso: hace(3 * DIA), coincideConCaptura: true });
    const r = clasificarRastreoA(evA({ citas: [noVino], capturaIndicada: true }));

    expect(r.principal.codigo).toBe(VEREDICTO.CITA_VIGENTE);
    expect(r.principal.resumen).toContain('inasistencia');
    expect(r.principal.evidencia.join(' ')).toContain('no asistió');
  });

  it('una cita SCHEDULED con desenlace ya registrado tampoco se analiza como pendiente de envío', () => {
    const r = clasificarRastreoA(
      evA({ citas: [cita({ attendance: 'ATTENDED', startIso: hace(2 * DIA), sync: sync({ estado: 'DEAD_LETTER', attempts: 10, deliveredAtIso: null }) })] }),
    );
    expect(r.principal.codigo).toBe(VEREDICTO.CITA_VIGENTE);
  });
});

describe('clasificarRastreoA — CANCELADA', () => {
  it('por el paciente desde WhatsApp', () => {
    const r = clasificarRastreoA(
      evA({
        citas: [
          cita({
            status: 'CANCELLED',
            cancelacion: { por: 'PACIENTE_WHATSAPP', atIso: hace(1 * DIA), motivo: null },
          }),
        ],
      }),
    );
    expect(r.principal.codigo).toBe(VEREDICTO.CANCELADA);
    expect(r.principal.evidencia.join(' ')).toContain('La canceló el paciente por WhatsApp');
    expect(r.principal.noSabemos).toEqual([]);
  });

  it('por el hospital, con su motivo', () => {
    const r = clasificarRastreoA(
      evA({
        citas: [
          cita({
            status: 'CANCELLED',
            cancelacion: { por: 'HIS', atIso: hace(2 * DIA), motivo: 'PACIENTE LLAMA A CANCELAR' },
          }),
        ],
      }),
    );
    expect(r.principal.evidencia.join(' ')).toContain('La canceló el hospital');
    expect(r.principal.evidencia.join(' ')).toContain('PACIENTE LLAMA A CANCELAR');
  });

  it('sin rastro de quién: lo dice y explica por qué (el panel no deja constancia)', () => {
    const r = clasificarRastreoA(
      evA({
        citas: [cita({ status: 'CANCELLED', cancelacion: { por: 'DESCONOCIDO', atIso: null, motivo: null } })],
      }),
    );
    expect(r.principal.evidencia.join(' ')).toContain('no tiene registro de quién la canceló');
    expect(r.principal.noSabemos.join(' ')).toContain('panel del personal');
  });
});

describe('clasificarRastreoA — CONFIRMADA_NO_LLEGO: cada causa', () => {
  const caso = (
    nombre: string,
    s: Partial<EstadoSync>,
    e: Partial<SaludEspejo>,
    causa: string,
    fragmento: string,
  ) => [nombre, s, e, causa, fragmento] as const;

  it.each([
    caso(
      'dead-letter con motivo',
      { estado: 'DEAD_LETTER', attempts: 10, lastError: 'violación de PK: cupo ya vendido', deliveredAtIso: null },
      {},
      'DEAD_LETTER',
      'violación de PK: cupo ya vendido',
    ),
    caso(
      'dead-letter SIN motivo (evento anterior a que se guardaran)',
      { estado: 'DEAD_LETTER', attempts: 10, lastError: null, deliveredAtIso: null },
      {},
      'DEAD_LETTER',
      'anterior a que se guardaran los motivos',
    ),
    caso(
      'en reintento',
      { estado: 'RETRYING', attempts: 3, lastError: 'Failed to connect', nextAttemptIso: dentroDe(2 * MIN), deliveredAtIso: null },
      {},
      'RETRYING',
      'intento 3 de 10',
    ),
    caso(
      'espejo apagado',
      { estado: 'PENDING', oldestPendingIso: hace(3 * MIN), deliveredAtIso: null },
      { enabled: false },
      'MIRROR_OFF',
      'espejo con el HIS está apagado',
    ),
    caso(
      'envío apagado (interruptor de emergencia)',
      { estado: 'PENDING', oldestPendingIso: hace(3 * MIN), deliveredAtIso: null },
      { pushEnabled: false },
      'PUSH_OFF',
      'interruptor de emergencia',
    ),
    caso(
      'agente que nunca dio señales',
      { estado: 'PENDING', oldestPendingIso: hace(3 * MIN), deliveredAtIso: null },
      { lastHeartbeatIso: null },
      'AGENT_SILENT',
      'nunca ha dado señales',
    ),
    caso(
      'agente sin latido hace más de 5 min',
      { estado: 'PENDING', oldestPendingIso: hace(3 * MIN), deliveredAtIso: null },
      { lastHeartbeatIso: hace((AGENTE_SIN_SENAL_MIN + 20) * MIN) },
      'AGENT_SILENT',
      'no da señales desde hace',
    ),
    caso(
      'agente vivo pero sin alcanzar el HIS',
      { estado: 'PENDING', oldestPendingIso: hace(3 * MIN), deliveredAtIso: null },
      { hisReachable: false, hisDetail: 'Failed to connect to 10.0.0.5' },
      'HIS_UNREACHABLE',
      'Failed to connect to 10.0.0.5',
    ),
    caso(
      'cola atascada con el agente sano',
      { estado: 'PENDING', oldestPendingIso: hace((COLA_ATASCADA_MIN + 5) * MIN), deliveredAtIso: null },
      {},
      'PENDING_STALE',
      'sin que el agente lo tome',
    ),
    caso(
      'sin evento de envío',
      { estado: 'NO_EVENT', creadoIso: null, deliveredAtIso: null },
      {},
      'NO_EVENT',
      'ningún evento de envío',
    ),
  ])('%s', (_nombre, s, e, causa, fragmento) => {
    const r = clasificarRastreoA(
      evA({ citas: [cita({ sync: sync(s) })], espejo: espejoSano(e) }),
    );

    expect(r.principal.codigo).toBe(VEREDICTO.CONFIRMADA_NO_LLEGO);
    expect(r.principal.severidad).toBe('bad');
    expect(r.principal.causa).toBe(causa);
    expect(r.principal.evidencia.join(' ')).toContain(fragmento);
    expect(r.principal.accion.length).toBeGreaterThan(20);
    // La versión del paciente es coherente con lo registrado: se dice.
    expect(r.principal.resumen).toContain('coherente');
  });

  it('un dead-letter con el agente caído dice las DOS cosas', () => {
    const r = clasificarRastreoA(
      evA({
        citas: [cita({ sync: sync({ estado: 'DEAD_LETTER', attempts: 10, lastError: 'boom', deliveredAtIso: null }) })],
        espejo: espejoSano({ lastHeartbeatIso: hace(2 * 60 * MIN) }),
      }),
    );
    expect(r.principal.causa).toBe('DEAD_LETTER');
    expect(r.principal.evidencia.join(' ')).toContain('boom');
    expect(r.principal.evidencia.join(' ')).toContain('no da señales desde hace');
  });

  it('NO_EVENT advierte que puede ser una cita anterior a la activación del espejo', () => {
    const r = clasificarRastreoA(
      evA({ citas: [cita({ sync: sync({ estado: 'NO_EVENT', creadoIso: null, deliveredAtIso: null }) })] }),
    );
    expect(r.principal.noSabemos.join(' ')).toContain('anterior a la activación del espejo');
  });

  it('una entrega que ya ocurrió gana sobre un espejo apagado HOY', () => {
    const r = clasificarRastreoA(
      evA({ citas: [cita({ sync: sync({ estado: 'DELIVERED' }) })], espejo: espejoSano({ enabled: false }) }),
    );
    expect(r.principal.codigo).toBe(VEREDICTO.ENTREGADA_SIN_VERIFICAR);
  });
});

describe('clasificarRastreoA — en camino, entregada y vigente', () => {
  it('EN_CAMINO_AL_HIS: recién creada, agente al día', () => {
    const r = clasificarRastreoA(
      evA({
        citas: [cita({ createdAtIso: hace(1 * MIN), sync: sync({ estado: 'PENDING', creadoIso: hace(1 * MIN), oldestPendingIso: hace(1 * MIN), deliveredAtIso: null }) })],
      }),
    );
    expect(r.principal.codigo).toBe(VEREDICTO.EN_CAMINO_AL_HIS);
    expect(r.principal.severidad).toBe('info');
    expect(r.principal.accion).toContain('Esperar');
  });

  it('ENTREGADA_SIN_VERIFICAR: dice que AgenIA no puede ver el HIS', () => {
    const r = clasificarRastreoA(evA({ citas: [cita()] }));

    expect(r.principal.codigo).toBe(VEREDICTO.ENTREGADA_SIN_VERIFICAR);
    expect(r.principal.fuente).toBe('AGENIA');
    expect(r.principal.noSabemos.join(' ')).toContain('no puede ver el HIS');
    expect(r.principal.accion).toContain('a nombre de otro documento');
  });

  it('CITA_VIGENTE: clínica sin espejo', () => {
    const r = clasificarRastreoA(evA({ espejo: null, citas: [cita({ sync: null })] }));

    expect(r.principal.codigo).toBe(VEREDICTO.CITA_VIGENTE);
    expect(r.principal.severidad).toBe('ok');
  });

  it('CITA_VIGENTE: la cita nació en el HIS (no se "envía" de vuelta)', () => {
    const r = clasificarRastreoA(evA({ citas: [cita({ origin: 'MIRROR' })] }));

    expect(r.principal.codigo).toBe(VEREDICTO.CITA_VIGENTE);
    expect(r.principal.resumen).toContain('nació en el HIS');
  });

  it('CITA_VIGENTE: el rol no ve el estado de sync (sync=null) → no se especula con él', () => {
    const r = clasificarRastreoA(evA({ espejo: null, citas: [cita({ sync: null })] }));
    expect(r.principal.codigo).toBe(VEREDICTO.CITA_VIGENTE);
    expect(texto(r)).not.toMatch(/agente|espejo|cola/i);
  });
});

describe('clasificarRastreoA — el mensaje de confirmación', () => {
  const evidenciaDe = (confirmacion: CitaRastreo['confirmacion']) =>
    clasificarRastreoA(evA({ citas: [cita({ confirmacion })] })).principal;

  it('LEÍDA', () => {
    const v = evidenciaDe({ status: 'READ', enviadoIso: hace(30 * MIN), estadoIso: hace(25 * MIN), errorDetalle: null });
    expect(v.evidencia.join(' ')).toContain('LEÍDA');
  });

  it('ENTREGADA', () => {
    expect(evidenciaDe(cita().confirmacion).evidencia.join(' ')).toContain('ENTREGADA');
  });

  it('🚨 FALLIDA: el paciente no pudo recibirla; se dice con el detalle de Meta', () => {
    const v = evidenciaDe({ status: 'FAILED', enviadoIso: hace(30 * MIN), estadoIso: hace(30 * MIN), errorDetalle: 'Han pasado más de 24 horas' });
    expect(v.evidencia.join(' ')).toContain('NO se entregó');
    expect(v.evidencia.join(' ')).toContain('Han pasado más de 24 horas');
  });

  it('solo aceptada por Meta: no afirma entrega', () => {
    const v = evidenciaDe({ status: 'SENT', enviadoIso: hace(30 * MIN), estadoIso: hace(30 * MIN), errorDetalle: null });
    expect(v.evidencia.join(' ')).toContain('no ha reportado su entrega');
  });

  it('sin registro en el libro (WhatsApp): lo dice en lo que NO se sabe', () => {
    const v = evidenciaDe(null);
    expect(v.noSabemos.join(' ')).toContain('No hay registro de la confirmación');
  });

  it('sin registro y cita manual: no inventa una carencia', () => {
    const v = clasificarRastreoA(evA({ citas: [cita({ origin: 'MANUAL', confirmacion: null })] })).principal;
    expect(v.noSabemos.join(' ')).not.toContain('libro de mensajes');
  });

  it('la conversación no tiene el BOOKING_CONFIRMED de esa cita', () => {
    const v = clasificarRastreoA(evA({ citas: [cita({ confirmadaEnConversacion: false })] })).principal;
    expect(v.noSabemos.join(' ')).toContain('no tiene el registro de confirmación');
  });
});

describe('clasificarRastreoA — varias citas, prioridad y captura', () => {
  const noLlego = () =>
    cita({
      id: 'apt-mala',
      startIso: dentroDe(5 * DIA),
      sync: sync({ estado: 'DEAD_LETTER', attempts: 10, lastError: 'x', deliveredAtIso: null }),
    });
  const cancelada = () =>
    cita({ id: 'apt-cancelada', status: 'CANCELLED', startIso: dentroDe(1 * DIA), cancelacion: { por: 'HIS', atIso: hace(1 * DIA), motivo: null } });
  const vigente = () => cita({ id: 'apt-ok', startIso: dentroDe(3 * DIA), sync: null });

  it('un veredicto por cita, y el principal es el más accionable', () => {
    const r = clasificarRastreoA(evA({ citas: [vigente(), cancelada(), noLlego()] }));

    expect(r.veredictos).toHaveLength(3);
    expect(r.principal.codigo).toBe(VEREDICTO.CONFIRMADA_NO_LLEGO);
    expect(r.principal.citaId).toBe('apt-mala');
    expect(r.veredictos.map((v) => v.codigo)).toEqual([
      VEREDICTO.CONFIRMADA_NO_LLEGO,
      VEREDICTO.CANCELADA,
      VEREDICTO.CITA_VIGENTE,
    ]);
  });

  it('la cita que coincide con la captura es el principal aunque otra sea más grave', () => {
    const r = clasificarRastreoA(
      evA({
        capturaIndicada: true,
        citas: [{ ...vigente(), coincideConCaptura: true }, { ...noLlego(), coincideConCaptura: false }],
      }),
    );

    expect(r.principal.citaId).toBe('apt-ok');
    expect(r.notas.join(' ')).toContain('La captura coincide con la cita');
  });

  it('captura indicada y ninguna cita coincide: queda dicho como nota, sin acusar', () => {
    const r = clasificarRastreoA(
      evA({ capturaIndicada: true, citas: [{ ...vigente(), coincideConCaptura: false }] }),
    );

    expect(r.notas.join(' ')).toContain('Ninguna cita registrada del paciente coincide');
    expect(r.notas.join(' ')).not.toMatch(/mient|falsa|inventad/i);
  });

  it('con citas visibles y otras ocultas: el veredicto es de las visibles y hay una nota', () => {
    const r = clasificarRastreoA(evA({ citas: [noLlego()], citasOcultas: 3 }));

    expect(r.principal.codigo).toBe(VEREDICTO.CONFIRMADA_NO_LLEGO);
    expect(r.notas.join(' ')).toContain('3 cita(s)');
    expect(r.notas.join(' ')).toContain('fuera de tu alcance');
  });

  it('las próximas citas van antes que las pasadas en la lista', () => {
    const pasada = cita({ id: 'p', startIso: hace(3 * DIA), sync: null });
    const futura = cita({ id: 'f', startIso: dentroDe(3 * DIA), sync: null });
    const r = clasificarRastreoA(evA({ espejo: null, citas: [pasada, futura] }));

    expect(r.veredictos.map((v) => v.citaId)).toEqual(['f', 'p']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Lenguaje (§3.3): el sistema nunca acusa
// ═══════════════════════════════════════════════════════════════════════════

describe('lenguaje neutro', () => {
  it('ningún texto de ningún veredicto acusa al paciente ni lo llama mentiroso', () => {
    const corpus: ResultadoRastreo[] = [
      clasificarRastreoA(evA({ conversacion: conversacion({ fallos: [{ motivo: 'SLOT_TAKEN', atIso: hace(DIA) }] }) })),
      clasificarRastreoA(evA()),
      clasificarRastreoA(evA({ citasOcultas: 1 })),
      clasificarRastreoA(evA({ espera: [{ status: 'WAITING', servicio: 'X', desdeIso: hace(DIA), avisadoIso: null }] })),
      clasificarRastreoA(evA({ citas: [cita()] })),
      clasificarRastreoA(evA({ citas: [cita({ sync: sync({ estado: 'DEAD_LETTER', attempts: 10, deliveredAtIso: null }) })] })),
      clasificarRastreoA(evA({ citas: [cita({ status: 'CANCELLED', cancelacion: null })] })),
      clasificarRastreoA(evA({ capturaIndicada: true, citas: [{ ...cita(), coincideConCaptura: false }] })),
    ];
    for (const r of corpus) {
      expect(texto(r) + JSON.stringify(r.notas)).not.toMatch(
        /mient|mentir|mentiros|falso|fraude|engañ|inventó|no agendó/i,
      );
    }
  });

  it('todo veredicto declara lo que NO sabe cuando afirma algo sobre el HIS', () => {
    const r = clasificarRastreoA(evA({ citas: [cita()] }));
    expect(r.principal.noSabemos.length).toBeGreaterThan(0);
  });

  it('cada código de la lista cerrada tiene título y severidad', () => {
    for (const codigo of Object.values(VEREDICTO)) {
      expect(TEXTO_VEREDICTO[codigo].titulo.length).toBeGreaterThan(5);
      expect(['ok', 'info', 'warn', 'bad']).toContain(TEXTO_VEREDICTO[codigo].severidad);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ESCENARIO B
// ═══════════════════════════════════════════════════════════════════════════

const evB = (
  over: Partial<Omit<EvidenciaRastreoB, 'cupoEnAgenIA' | 'paciente'>> & {
    cupoEnAgenIA?: Partial<EvidenciaRastreoB['cupoEnAgenIA']>;
    paciente?: Partial<EvidenciaRastreoB['paciente']>;
  } = {},
): EvidenciaRastreoB => ({
  ahoraIso: AHORA,
  cupoDescripcion: 'Cupo del HIS: mar 22 sep, 10:00 a. m. con MEDICO HTA',
  espejo: espejoSano(),
  ...over,
  paciente: {
    perfilEncontrado: true,
    coincidencia: 'EXACTA',
    perfilesConVariante: 0,
    conWhatsapp: true,
    ...over.paciente,
  },
  cupoEnAgenIA: {
    medicoHomologado: true,
    cupoExiste: true,
    auditorias: [],
    citaDelPacienteEnAgenIA: false,
    ...over.cupoEnAgenIA,
  },
});

const auditoria = (
  resultado: 'OK' | 'SKIPPED' | 'ERROR' | 'CONFLICT',
  nota: string,
  op = 'INSERT',
) => ({ resultado, op, nota, atIso: hace(2 * 60 * MIN) });

describe('clasificarRastreoB', () => {
  it('CITA_VIGENTE: AgenIA sí tiene la cita del paciente en ese cupo', () => {
    const r = clasificarRastreoB(evB({ cupoEnAgenIA: { citaDelPacienteEnAgenIA: true } }));

    expect(r.principal.codigo).toBe(VEREDICTO.CITA_VIGENTE);
    expect(r.principal.accion).toContain('cancelar o reprogramar');
  });

  it('MEDICO_NO_ESPEJADO: es por diseño y la cita del hospital es válida', () => {
    const r = clasificarRastreoB(
      evB({
        cupoEnAgenIA: {
          medicoHomologado: false,
          cupoExiste: false,
          auditorias: [auditoria('SKIPPED', 'médico no espejado: el hospital agendó con un médico que AgenIA no homologa')],
        },
      }),
    );

    expect(r.principal.codigo).toBe(VEREDICTO.MEDICO_NO_ESPEJADO);
    expect(r.principal.severidad).toBe('info');
    expect(r.principal.accion).toContain('por diseño');
    expect(r.principal.evidencia.join(' ')).toContain('médico no espejado');
  });

  it('SIN_CUPO: médico homologado pero AgenIA no generó ese cupo', () => {
    const r = clasificarRastreoB(
      evB({
        cupoEnAgenIA: {
          cupoExiste: false,
          auditorias: [auditoria('ERROR', 'Cita entrante del HIS sin cupo equivalente en AgenIA. El médico está homologado pero falta generar el cupo.')],
        },
      }),
    );

    expect(r.principal.codigo).toBe(VEREDICTO.SIN_CUPO);
    expect(r.principal.severidad).toBe('warn');
    expect(r.principal.accion).toContain('Escalar');
    expect(r.principal.evidencia.join(' ')).toContain('falta generar el cupo');
  });

  it('CITA_DEL_HIS_NO_ESPEJADA: el evento llegó y AgenIA solo ocupó el cupo', () => {
    const r = clasificarRastreoB(
      evB({
        cupoEnAgenIA: {
          auditorias: [auditoria('OK', 'cita del HIS con paciente sin homologar: solo se ocupó el cupo, no se creó Appointment')],
        },
      }),
    );

    expect(r.principal.codigo).toBe(VEREDICTO.CITA_DEL_HIS_NO_ESPEJADA);
    expect(r.principal.resumen).toContain('el bot no se la muestra');
    // Sin la consulta en vivo, no sabe a nombre de quién está.
    expect(r.principal.noSabemos.join(' ')).toContain('A nombre de quién');
    expect(r.principal.accion).toContain('enviarle la confirmación por WhatsApp');
  });

  it('CITA_DEL_HIS_NO_ESPEJADA también cuando hay un evento OK sin la nota exacta', () => {
    const r = clasificarRastreoB(
      evB({ cupoEnAgenIA: { auditorias: [auditoria('OK', 'el cupo ya estaba ocupado; nada que hacer')] } }),
    );
    expect(r.principal.codigo).toBe(VEREDICTO.CITA_DEL_HIS_NO_ESPEJADA);
  });

  it('EVENTO_DEL_HIS_NO_APLICADO: error al aplicarlo', () => {
    const r = clasificarRastreoB(
      evB({ cupoEnAgenIA: { auditorias: [auditoria('ERROR', 'Error aplicando el evento: boom')] } }),
    );

    expect(r.principal.codigo).toBe(VEREDICTO.EVENTO_DEL_HIS_NO_APLICADO);
    expect(r.principal.resumen).toContain('falló al aplicarlo');
  });

  it('EVENTO_DEL_HIS_NO_APLICADO: conflicto de cupo = doble agenda, el hospital gana', () => {
    const r = clasificarRastreoB(
      evB({ cupoEnAgenIA: { auditorias: [auditoria('CONFLICT', 'el cupo ya estaba ocupado en AgenIA')] } }),
    );

    expect(r.principal.codigo).toBe(VEREDICTO.EVENTO_DEL_HIS_NO_APLICADO);
    expect(r.principal.resumen).toContain('doble agenda');
    expect(r.principal.accion).toContain('El hospital gana');
  });

  it('SIN_EVENTO_DEL_HIS: ni un solo evento; dice qué puede explicarlo y qué no sabe', () => {
    const r = clasificarRastreoB(evB());

    expect(r.principal.codigo).toBe(VEREDICTO.SIN_EVENTO_DEL_HIS);
    expect(r.principal.noSabemos.join(' ')).toContain('Si la cita existe en el HIS');
    expect(r.principal.accion).toContain('ventanilla');
  });

  it('SIN_EVENTO_DEL_HIS suma el contexto del agente: apagado, sin recibir del HIS, sin latido', () => {
    const apagado = clasificarRastreoB(evB({ espejo: espejoSano({ enabled: false }) }));
    expect(apagado.principal.evidencia.join(' ')).toContain('espejo está apagado');

    const sinPull = clasificarRastreoB(evB({ espejo: espejoSano({ pullEnabled: false }) }));
    expect(sinPull.principal.evidencia.join(' ')).toContain('recepción de eventos del HIS');

    const mudo = clasificarRastreoB(evB({ espejo: espejoSano({ lastHeartbeatIso: null }) }));
    expect(mudo.principal.evidencia.join(' ')).toContain('nunca ha dado señales');
  });

  it('IDENTIDAD_NO_COINCIDE: hay otro perfil que solo difiere por ceros; va detrás del veredicto del cupo', () => {
    const r = clasificarRastreoB(
      evB({
        paciente: { perfilesConVariante: 1 },
        cupoEnAgenIA: { auditorias: [auditoria('OK', 'no se creó Appointment')] },
      }),
    );

    expect(r.principal.codigo).toBe(VEREDICTO.CITA_DEL_HIS_NO_ESPEJADA);
    const identidad = r.veredictos.find((v) => v.codigo === VEREDICTO.IDENTIDAD_NO_COINCIDE);
    expect(identidad?.evidencia.join(' ')).toContain('ceros a la izquierda');
  });

  it('IDENTIDAD_NO_COINCIDE: el perfil solo se halló quitando ceros', () => {
    const r = clasificarRastreoB(evB({ paciente: { coincidencia: 'SIN_CEROS' } }));
    const identidad = r.veredictos.find((v) => v.codigo === VEREDICTO.IDENTIDAD_NO_COINCIDE);
    expect(identidad?.evidencia.join(' ')).toContain('solo al quitar los ceros');
  });

  it('un paciente sin perfil NO es un veredicto (es lo normal de quien nunca escribió al bot): es una nota', () => {
    const r = clasificarRastreoB(evB({ paciente: { perfilEncontrado: false, coincidencia: null, conWhatsapp: false } }));

    expect(r.veredictos.map((v) => v.codigo)).not.toContain(VEREDICTO.IDENTIDAD_NO_COINCIDE);
    expect(r.notas.join(' ')).toContain('nunca escribió al bot');
  });

  it('un perfil sin WhatsApp asociado se avisa como nota', () => {
    const r = clasificarRastreoB(evB({ paciente: { conWhatsapp: false } }));
    expect(r.notas.join(' ')).toContain('no tiene un WhatsApp asociado');
  });

  it('ningún texto de B acusa a nadie', () => {
    const r = clasificarRastreoB(evB());
    expect(texto(r)).not.toMatch(/mient|mentir|falso|fraude/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Línea de vida
// ═══════════════════════════════════════════════════════════════════════════

describe('construirLineaDeVida', () => {
  const estados = (c: CitaRastreo, espejo: SaludEspejo | null = espejoSano()) =>
    Object.fromEntries(construirLineaDeVida(c, { espejo }).map((p) => [p.clave, p.estado]));

  it('siempre son los siete pasos, en orden', () => {
    const pasos = construirLineaDeVida(cita(), { espejo: espejoSano() });
    expect(pasos.map((p) => p.clave)).toEqual([
      'conversacion',
      'confirmacion_enviada',
      'confirmacion_entregada',
      'cita_creada',
      'evento_en_cola',
      'entregado_al_agente',
      'presente_en_el_his',
    ]);
  });

  it('cita de WhatsApp entregada: todo ✓ y el HIS queda SIN VERIFICAR (hasta la consulta en vivo)', () => {
    expect(estados(cita())).toEqual({
      conversacion: 'ok',
      confirmacion_enviada: 'ok',
      confirmacion_entregada: 'ok',
      cita_creada: 'ok',
      evento_en_cola: 'ok',
      entregado_al_agente: 'ok',
      presente_en_el_his: 'unknown',
    });
  });

  it('dead-letter: el paso del agente falla y lleva el motivo', () => {
    const c = cita({ sync: sync({ estado: 'DEAD_LETTER', attempts: 10, lastError: 'cupo ya vendido', deliveredAtIso: null }) });
    const pasos = construirLineaDeVida(c, { espejo: espejoSano() });
    const agente = pasos.find((p) => p.clave === 'entregado_al_agente')!;

    expect(agente.estado).toBe('fail');
    expect(agente.detalle).toContain('cupo ya vendido');
  });

  it('en reintento: pendiente, con el intento', () => {
    const c = cita({ sync: sync({ estado: 'RETRYING', attempts: 4, lastError: 'x', deliveredAtIso: null, nextAttemptIso: dentroDe(MIN) }) });
    const agente = construirLineaDeVida(c, { espejo: espejoSano() }).find((p) => p.clave === 'entregado_al_agente')!;

    expect(agente.estado).toBe('pending');
    expect(agente.detalle).toContain('Intento 4 de 10');
  });

  it('en cola: pendiente', () => {
    const c = cita({ sync: sync({ estado: 'PENDING', deliveredAtIso: null }) });
    expect(estados(c).entregado_al_agente).toBe('pending');
  });

  it('sin evento: el paso de la cola falla', () => {
    const c = cita({ sync: sync({ estado: 'NO_EVENT', creadoIso: null, deliveredAtIso: null }) });
    expect(estados(c).evento_en_cola).toBe('fail');
  });

  it('confirmación FALLIDA: el paso de entrega falla con el detalle de Meta', () => {
    const c = cita({ confirmacion: { status: 'FAILED', enviadoIso: hace(MIN), estadoIso: hace(MIN), errorDetalle: 'sin ventana' } });
    const paso = construirLineaDeVida(c, { espejo: espejoSano() }).find((p) => p.clave === 'confirmacion_entregada')!;

    expect(paso.estado).toBe('fail');
    expect(paso.detalle).toBe('sin ventana');
  });

  it('confirmación solo aceptada: enviada ✓, entrega pendiente', () => {
    const c = cita({ confirmacion: { status: 'SENT', enviadoIso: hace(MIN), estadoIso: hace(MIN), errorDetalle: null } });
    const e = estados(c);
    expect(e.confirmacion_enviada).toBe('ok');
    expect(e.confirmacion_entregada).toBe('pending');
  });

  it('sin registro del mensaje: "?" en los dos pasos, no un ✗', () => {
    const e = estados(cita({ confirmacion: null }));
    expect(e.confirmacion_enviada).toBe('unknown');
    expect(e.confirmacion_entregada).toBe('unknown');
  });

  it('clínica sin espejo: los tres pasos hacia el HIS no aplican', () => {
    const e = estados(cita({ sync: null }), null);
    expect(e.evento_en_cola).toBe('na');
    expect(e.entregado_al_agente).toBe('na');
    expect(e.presente_en_el_his).toBe('na');
  });

  it('cita nacida en el HIS: ni conversación ni envío aplican', () => {
    const e = estados(cita({ origin: 'MIRROR', confirmacion: null }));
    expect(e.conversacion).toBe('na');
    expect(e.evento_en_cola).toBe('na');
  });

  it('cita manual: la conversación no aplica', () => {
    expect(estados(cita({ origin: 'MANUAL' })).conversacion).toBe('na');
  });

  it('rol que no ve la conversación ni el sync: pasos "na", no se especula', () => {
    const e = estados(cita({ confirmadaEnConversacion: null, sync: null }));
    expect(e.conversacion).toBe('na');
    expect(e.evento_en_cola).toBe('na');
  });

  it('cita de WhatsApp sin BOOKING_CONFIRMED en la conversación: "?" en el primer paso', () => {
    expect(estados(cita({ confirmadaEnConversacion: false })).conversacion).toBe('unknown');
  });
});
