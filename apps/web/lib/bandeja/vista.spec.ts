import { permisosBandeja } from './acceso';
import {
  MSG_NO_REABRIR_AUTO,
  accionesDisponibles,
  evaluarAccion,
  esEstadoActivo,
  etiquetaPersona,
  mapearExcepcion,
  mapearHistorial,
  resumenPublico,
  type ContextoVista,
  type FilaExcepcion,
} from './vista';

const MIN = 60_000;
const AHORA = new Date('2026-09-22T15:00:00.000Z');
const haceMin = (n: number) => new Date(AHORA.getTime() - n * MIN);

const admin = permisosBandeja('ORG_ADMIN');
const agente = permisosBandeja('BOOKING_AGENT');

const fila = (over: Partial<FilaExcepcion> = {}): FilaExcepcion => ({
  id: 'ex-1',
  kind: 'CITA_NO_ENTREGADA',
  severity: 'ALTA',
  status: 'ABIERTA',
  title: 'Cita que el hospital aún no tiene',
  detail: 'Lleva 25 min. Último error del agente: ECONNREFUSED 10.20.30.40:1433 (servidor-his-01)',
  appointmentId: 'cita-1',
  patientId: 'pac-1',
  epsId: 'eps-1',
  doctorId: 'doc-1',
  appointmentStartAt: new Date('2026-09-22T20:00:00.000Z'),
  meta: { motivo: 'EN_COLA', desdeIso: haceMin(25).toISOString(), minutosRetenida: 10, intentos: 0, op: 'INSERT' },
  firstSeenAt: haceMin(30),
  lastSeenAt: haceMin(2),
  occurrences: 3,
  assignedToUserId: null,
  resolvedAt: null,
  resolvedByUserId: null,
  resolutionNote: null,
  notifiedAt: null,
  ...over,
});

const ctx = (over: Partial<ContextoVista> = {}): ContextoVista => ({
  actor: { userId: 'u-yo', permisos: admin },
  ahora: AHORA,
  medicos: new Map([['doc-1', { fullName: 'Ana Ruiz', isFunctionalAgenda: false }]]),
  pacientes: new Map([['pac-1', { fullName: 'María López Núñez', cedula: '1053123456' }]]),
  citas: new Map([['cita-1', { servicio: 'Medicina general' }]]),
  usuarios: new Map([
    ['u-yo', { email: 'yo@clinica.co', role: 'ORG_ADMIN' }],
    ['u-otro', { email: 'otro@clinica.co', role: 'BOOKING_AGENT' }],
  ]),
  ...over,
});

describe('accionesDisponibles — lo que se pinta como botón', () => {
  const sinDuenio = { esDuenio: false, hayDuenio: false };

  it('ABIERTA: tomar, resolver y descartar (no soltar ni reabrir)', () => {
    expect(accionesDisponibles('ABIERTA', { ...sinDuenio, permisos: agente })).toEqual(['TOMAR', 'RESOLVER', 'DESCARTAR']);
  });

  it('EN_REVISION siendo el dueño: soltar, resolver y descartar (no se toma lo que ya se tiene)', () => {
    expect(accionesDisponibles('EN_REVISION', { esDuenio: true, hayDuenio: true, permisos: agente })).toEqual(['SOLTAR', 'RESOLVER', 'DESCARTAR']);
  });

  it('🔒 EN_REVISION de OTRO y sin ser administrador: nada (no se le quita ni se le cierra a un compañero)', () => {
    expect(accionesDisponibles('EN_REVISION', { esDuenio: false, hayDuenio: true, permisos: agente })).toEqual([]);
  });

  it('EN_REVISION de otro siendo administrador: puede reasignársela, soltarla y cerrarla', () => {
    expect(accionesDisponibles('EN_REVISION', { esDuenio: false, hayDuenio: true, permisos: admin })).toEqual(['TOMAR', 'SOLTAR', 'RESOLVER', 'DESCARTAR']);
  });

  it('🧟 EN_REVISION sin dueño (dato inconsistente): cualquiera puede trabajarla, no queda trabada', () => {
    expect(accionesDisponibles('EN_REVISION', { esDuenio: false, hayDuenio: false, permisos: agente })).toEqual(['TOMAR', 'SOLTAR', 'RESOLVER', 'DESCARTAR']);
  });

  it('RESUELTA y DESCARTADA (a mano): solo reabrir', () => {
    expect(accionesDisponibles('RESUELTA', { ...sinDuenio, permisos: agente })).toEqual(['REABRIR']);
    expect(accionesDisponibles('DESCARTADA', { ...sinDuenio, permisos: agente })).toEqual(['REABRIR']);
  });

  it('🤖 AUTO_RESUELTA: nada. El sistema la cerró porque el problema dejó de cumplirse y la reabre sola si vuelve', () => {
    expect(accionesDisponibles('AUTO_RESUELTA', { ...sinDuenio, permisos: admin })).toEqual([]);
  });

  it('⌛ VENCIDA (§12 #15): se puede reabrir. El sistema NO la reabre solo, así que si hace falta la reabre una persona', () => {
    expect(accionesDisponibles('VENCIDA', { ...sinDuenio, permisos: agente })).toEqual(['REABRIR']);
  });

  it('sin permiso de trabajar no hay ningún botón, en ningún estado', () => {
    const solo = { trabajar: false, administrar: true };
    for (const estado of ['ABIERTA', 'EN_REVISION', 'RESUELTA', 'DESCARTADA', 'AUTO_RESUELTA', 'VENCIDA']) {
      expect(accionesDisponibles(estado, { esDuenio: true, hayDuenio: true, permisos: solo })).toEqual([]);
    }
  });

  it('un estado desconocido no ofrece nada', () => {
    expect(accionesDisponibles('QUIEN_SABE', { ...sinDuenio, permisos: admin })).toEqual([]);
  });
});

describe('evaluarAccion — la misma regla que valida el servidor', () => {
  const base = { esDuenio: false, hayDuenio: false, permisos: agente };

  it('cerrar exige una nota de verdad (≥ 5 caracteres), no espacios', () => {
    expect(evaluarAccion('ABIERTA', 'RESOLVER', { ...base, nota: '  ab  ' }).ok).toBe(false);
    expect(evaluarAccion('ABIERTA', 'RESOLVER', { ...base, nota: 'Se agendó en ventanilla' })).toEqual({ ok: true, estado: 'RESUELTA' });
    expect(evaluarAccion('ABIERTA', 'DESCARTAR', { ...base, nota: 'Era una cita de prueba' })).toEqual({ ok: true, estado: 'DESCARTADA' });
  });

  it('reabrir lo que cerró el sistema se rechaza con la razón', () => {
    expect(evaluarAccion('AUTO_RESUELTA', 'REABRIR', base)).toEqual({ ok: false, motivo: MSG_NO_REABRIR_AUTO });
  });

  it('sin permiso de trabajar: «Sin permisos.»', () => {
    expect(evaluarAccion('ABIERTA', 'TOMAR', { ...base, permisos: { trabajar: false, administrar: false } })).toEqual({ ok: false, motivo: 'Sin permisos.' });
  });

  it('el motivo de la máquina de estados llega tal cual', () => {
    const r = evaluarAccion('EN_REVISION', 'TOMAR', { esDuenio: false, hayDuenio: true, permisos: agente });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toMatch(/otra persona/);
  });
});

describe('resumenPublico — una frase neutra desde meta, nunca desde el detalle técnico', () => {
  const ref = AHORA.getTime();
  const r = (kind: string, meta: unknown, occurrences = 1) =>
    resumenPublico({ kind, title: 'Título', meta, occurrences }, ref);

  it('cita en cola: los minutos se cuentan desde `desdeIso` hasta AHORA (no el número guardado)', () => {
    expect(r('CITA_NO_ENTREGADA', { motivo: 'EN_COLA', desdeIso: haceMin(25).toISOString(), minutosRetenida: 10 })).toBe(
      'Lleva 25 min en la cola sin que el agente del hospital la tome.',
    );
    // Tres horas después el mismo dato dice 205, no 25.
    expect(
      resumenPublico({ kind: 'CITA_NO_ENTREGADA', title: '', occurrences: 1, meta: { motivo: 'EN_COLA', desdeIso: haceMin(25).toISOString() } }, ref + 180 * MIN),
    ).toContain('205 min');
  });

  it('los minutos se cuentan ENTEROS hacia abajo: a los 25 min y medio todavía son 25', () => {
    expect(r('CITA_NO_ENTREGADA', { motivo: 'EN_COLA', desdeIso: new Date(ref - 25.5 * MIN).toISOString() })).toContain('Lleva 25 min');
    expect(r('CITA_NO_ENTREGADA', { motivo: 'EN_COLA', desdeIso: new Date(ref - 25.99 * MIN).toISOString() })).toContain('Lleva 25 min');
  });

  it('sin `desdeIso` (dato viejo) cae al minuto guardado', () => {
    expect(r('CITA_NO_ENTREGADA', { motivo: 'EN_COLA', minutosRetenida: 40 })).toContain('40 min');
  });

  it('un `desdeIso` futuro no da minutos negativos', () => {
    expect(r('CITA_NO_ENTREGADA', { motivo: 'EN_COLA', desdeIso: new Date(ref + 5 * MIN).toISOString() })).toContain('0 min');
  });

  it('reintentando y rendida dicen los intentos', () => {
    expect(r('CITA_NO_ENTREGADA', { motivo: 'REINTENTANDO', desdeIso: haceMin(12).toISOString(), intentos: 3 })).toMatch(/fallando \(intento 3 de \d+\) desde hace 12 min/);
    expect(r('CITA_NO_ENTREGADA', { motivo: 'RENDIDA', intentos: 8 })).toMatch(/se rindió tras 8 intentos/);
  });

  it('un motivo desconocido se trata como «en cola» (no inventa)', () => {
    expect(r('CITA_NO_ENTREGADA', { motivo: 'OTRA_COSA', desdeIso: haceMin(11).toISOString() })).toContain('en la cola');
  });

  it('evento rendido', () => {
    expect(r('EVENTO_RENDIDO', { intentos: 5 })).toMatch(/se rindió tras 5 intentos/);
  });

  it('conflicto y error de sincronización: cuentan las veces solo si fueron varias', () => {
    expect(r('CONFLICTO_SYNC', {}, 1)).toBe('Un cambio que llegó del hospital chocó con lo que AgenIA tiene.');
    expect(r('CONFLICTO_SYNC', {}, 4)).toBe('Un cambio que llegó del hospital chocó con lo que AgenIA tiene (4 veces).');
    expect(r('ERROR_SYNC', {}, 2)).toBe('Un cambio que llegó del hospital no se pudo aplicar en AgenIA (2 veces).');
  });

  it('deriva: dice que la comparación no lo sabe', () => {
    expect(r('DERIVA_EN_HIS', { clave: 'doc|2026-09-22T15:00' })).toMatch(/no encontró esta cita.*no haberse registrado nunca/);
    // …y no filtra la clave técnica.
    expect(r('DERIVA_EN_HIS', { clave: 'doc|2026-09-22T15:00' })).not.toContain('doc|');
  });

  it('un tipo desconocido cae al título', () => {
    expect(r('TIPO_NUEVO', {})).toBe('Título');
  });

  it('un `meta` roto (null, arreglo, texto) no revienta', () => {
    for (const meta of [null, undefined, [], 'texto', 42]) {
      expect(() => r('CITA_NO_ENTREGADA', meta)).not.toThrow();
      expect(r('CITA_NO_ENTREGADA', meta)).toContain('0 min');
    }
  });
});

describe('mapearExcepcion', () => {
  it('🔒 el paciente sale ENMASCARADO: nunca el nombre ni la cédula completos', () => {
    const v = mapearExcepcion(fila(), ctx());
    expect(v.cita?.paciente).toBe('María L••• N•••');
    expect(v.cita?.documento).toBe('•••3456');
    expect(JSON.stringify(v)).not.toContain('López');
    expect(JSON.stringify(v)).not.toContain('1053123456');
  });

  it('el título sale del TIPO (el texto oficial), no de lo que la fila guardó; un tipo desconocido usa el de la fila', () => {
    expect(mapearExcepcion(fila({ title: 'Texto viejo guardado' }), ctx()).titulo).toBe('Cita que el hospital aún no tiene');
    expect(mapearExcepcion(fila({ kind: 'TIPO_NUEVO', title: 'Título propio' }), ctx()).titulo).toBe('Título propio');
  });

  it('con solo la hora de la cita (sin id de cita ni de paciente) igual hay cita que mostrar', () => {
    const v = mapearExcepcion(fila({ appointmentId: null, patientId: null, doctorId: null }), ctx());
    expect(v.cita).toEqual({ inicioIso: '2026-09-22T20:00:00.000Z', medico: null, servicio: null, paciente: null, documento: null, pacienteId: null });
  });

  it('la cita: hora, médico, servicio y el id opaco del paciente (para saltar al rastreo)', () => {
    const v = mapearExcepcion(fila(), ctx());
    expect(v.cita).toEqual({
      inicioIso: '2026-09-22T20:00:00.000Z',
      medico: 'Dr(a). Ana Ruiz',
      servicio: 'Medicina general',
      paciente: 'María L••• N•••',
      documento: '•••3456',
      pacienteId: 'pac-1',
    });
  });

  it('una agenda funcional del HIS no lleva «Dr(a).»', () => {
    const v = mapearExcepcion(fila(), ctx({ medicos: new Map([['doc-1', { fullName: 'MEDICO ATENCIÓN HTA 2', isFunctionalAgenda: true }]]) }));
    expect(v.cita?.medico).toBe('MEDICO ATENCIÓN HTA 2');
  });

  it('🕵️ el detalle técnico (último error del agente) es SOLO de quien ve internos', () => {
    const conInternos = mapearExcepcion(fila(), ctx());
    expect(conInternos.detalleTecnico).toContain('ECONNREFUSED');

    const sinInternos = mapearExcepcion(fila(), ctx({ actor: { userId: 'u-yo', permisos: agente } }));
    expect(sinInternos.detalleTecnico).toBeNull();
    // Ni el detalle ni el servidor del hospital aparecen en NADA de lo que recibe.
    expect(JSON.stringify(sinInternos)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(sinInternos)).not.toContain('servidor-his-01');
  });

  it('una excepción sin cita (un error de la auditoría) no inventa una', () => {
    const v = mapearExcepcion(fila({ appointmentId: null, patientId: null, appointmentStartAt: null, doctorId: null }), ctx());
    expect(v.cita).toBeNull();
  });

  it('si no se encuentran el paciente, el médico o el servicio, salen nulos (no revienta)', () => {
    const v = mapearExcepcion(fila(), ctx({ medicos: new Map(), pacientes: new Map(), citas: new Map() }));
    expect(v.cita).toMatchObject({ medico: null, servicio: null, paciente: null, documento: null, pacienteId: 'pac-1' });
  });

  it('activa: los minutos corren hasta AHORA', () => {
    expect(mapearExcepcion(fila(), ctx()).resumen).toContain('25 min');
  });

  it('⏸️ cerrada: los minutos se congelan en la última vez que se vio (no «lleva 3 días» de algo resuelto)', () => {
    const cerrada = fila({
      status: 'RESUELTA',
      resolvedAt: haceMin(2),
      resolvedByUserId: 'u-otro',
      resolutionNote: 'Se agendó en ventanilla',
      lastSeenAt: haceMin(5),
    });
    const v = mapearExcepcion(cerrada, ctx({ ahora: new Date(AHORA.getTime() + 3 * 86_400_000) }));
    expect(v.resumen).toContain('20 min'); // desde hace 25 hasta hace 5
  });

  it('dueño: «Tú» si es el actor; el rol (y el correo solo si ve internos) si es otro', () => {
    const mia = mapearExcepcion(fila({ status: 'EN_REVISION', assignedToUserId: 'u-yo' }), ctx());
    expect(mia.dueno).toEqual({ esMio: true, etiqueta: 'Tú' });

    const deOtro = mapearExcepcion(fila({ status: 'EN_REVISION', assignedToUserId: 'u-otro' }), ctx());
    expect(deOtro.dueno).toEqual({ esMio: false, etiqueta: 'agente de reservas · otro@clinica.co' });

    const deOtroVistaAgente = mapearExcepcion(
      fila({ status: 'EN_REVISION', assignedToUserId: 'u-otro' }),
      ctx({ actor: { userId: 'u-yo', permisos: agente } }),
    );
    expect(deOtroVistaAgente.dueno).toEqual({ esMio: false, etiqueta: 'agente de reservas' });
    expect(JSON.stringify(deOtroVistaAgente)).not.toContain('otro@clinica.co');
  });

  it('una excepción cerrada no muestra dueño', () => {
    const v = mapearExcepcion(fila({ status: 'RESUELTA', assignedToUserId: 'u-otro', resolvedAt: haceMin(1) }), ctx());
    expect(v.dueno).toBeNull();
  });

  it('cierre: quién, cuándo y la nota; «El sistema» si se cerró sola', () => {
    const manual = mapearExcepcion(
      fila({ status: 'DESCARTADA', resolvedAt: haceMin(3), resolvedByUserId: 'u-otro', resolutionNote: 'Era una prueba' }),
      ctx(),
    );
    expect(manual.cierre).toEqual({ atIso: haceMin(3).toISOString(), por: 'agente de reservas · otro@clinica.co', nota: 'Era una prueba' });

    const sola = mapearExcepcion(
      fila({ status: 'AUTO_RESUELTA', resolvedAt: haceMin(3), resolvedByUserId: null, resolutionNote: 'El envío ya llegó al hospital.' }),
      ctx(),
    );
    expect(sola.cierre).toEqual({ atIso: haceMin(3).toISOString(), por: 'El sistema', nota: 'El envío ya llegó al hospital.' });
    expect(sola.acciones).toEqual([]);
  });

  it('una activa no tiene cierre', () => {
    expect(mapearExcepcion(fila(), ctx()).cierre).toBeNull();
  });

  it('las acciones ya vienen filtradas para ESTE actor', () => {
    expect(mapearExcepcion(fila(), ctx()).acciones).toEqual(['TOMAR', 'RESOLVER', 'DESCARTAR']);
    const deOtro = fila({ status: 'EN_REVISION', assignedToUserId: 'u-otro' });
    expect(mapearExcepcion(deOtro, ctx({ actor: { userId: 'u-yo', permisos: agente } })).acciones).toEqual([]);
    expect(mapearExcepcion(deOtro, ctx()).acciones).toEqual(['TOMAR', 'SOLTAR', 'RESOLVER', 'DESCARTAR']);
  });

  it('fechas como ISO, título del tipo y aviso', () => {
    const v = mapearExcepcion(fila({ notifiedAt: haceMin(1) }), ctx());
    expect(v).toMatchObject({
      id: 'ex-1',
      tipo: 'CITA_NO_ENTREGADA',
      titulo: 'Cita que el hospital aún no tiene',
      gravedad: 'ALTA',
      estado: 'ABIERTA',
      ocurrencias: 3,
      primeraVezIso: haceMin(30).toISOString(),
      ultimaVezIso: haceMin(2).toISOString(),
      avisadaIso: haceMin(1).toISOString(),
    });
    expect(mapearExcepcion(fila(), ctx()).avisadaIso).toBeNull();
  });

  it('no filtra campos internos: ni outboxSeq (bigint), ni meta, ni epsId', () => {
    const v = mapearExcepcion({ ...fila(), outboxSeq: BigInt(99) } as FilaExcepcion, ctx());
    const texto = JSON.stringify(v);
    expect(texto).not.toContain('outboxSeq');
    expect(texto).not.toContain('epsId');
    expect(texto).not.toContain('"meta"');
  });
});

describe('etiquetaPersona', () => {
  it('«Tú», rol con correo (internos), rol solo, y «personal» si el usuario ya no existe', () => {
    const c = ctx();
    expect(etiquetaPersona('u-yo', c)).toBe('Tú');
    expect(etiquetaPersona('u-otro', c)).toBe('agente de reservas · otro@clinica.co');
    expect(etiquetaPersona('u-otro', { ...c, actor: { userId: 'u-yo', permisos: agente } })).toBe('agente de reservas');
    expect(etiquetaPersona('u-borrado', c)).toBe('personal');
    // El historial guardó el rol: se usa si el usuario ya no está.
    expect(etiquetaPersona('u-borrado', c, 'BOOKING_AGENT')).toBe('agente de reservas');
  });
});

describe('mapearHistorial', () => {
  it('traduce la acción, dice quién (o «El sistema») y conserva la nota', () => {
    const c = ctx();
    const h = mapearHistorial(
      [
        { action: 'CREADA', actorUserId: null, actorRole: null, note: 'Cita que el hospital aún no tiene', createdAt: haceMin(30) },
        { action: 'AVISADA', actorUserId: null, actorRole: null, note: 'Aviso por WhatsApp al agendador.', createdAt: haceMin(20) },
        { action: 'TOMADA', actorUserId: 'u-otro', actorRole: 'BOOKING_AGENT', note: null, createdAt: haceMin(10) },
        { action: 'RESUELTA', actorUserId: 'u-yo', actorRole: 'ORG_ADMIN', note: 'Se agendó en ventanilla', createdAt: haceMin(1) },
        { action: 'ACCION_NUEVA', actorUserId: null, actorRole: null, note: null, createdAt: haceMin(0) },
      ],
      c,
    );
    expect(h.map((e) => [e.accion, e.por, e.nota])).toEqual([
      ['Detectada', 'El sistema', 'Cita que el hospital aún no tiene'],
      ['Se avisó al agendador', 'El sistema', 'Aviso por WhatsApp al agendador.'],
      ['La tomó', 'agente de reservas · otro@clinica.co', null],
      ['La resolvió', 'Tú', 'Se agendó en ventanilla'],
      ['ACCION_NUEVA', 'El sistema', null],
    ]);
    expect(h[0].atIso).toBe(haceMin(30).toISOString());
  });

  it('el recordatorio y el vencimiento (§12 #14 y #15) se dicen en palabras, como obra del sistema', () => {
    const h = mapearHistorial(
      [
        { action: 'RECORDADA', actorUserId: null, actorRole: null, note: 'Recordatorio 1 de 2 por WhatsApp al agendador y al respaldo: nadie la había tomado.', createdAt: haceMin(5) },
        { action: 'VENCIDA', actorUserId: null, actorRole: null, note: 'Venció sin resolución: …', createdAt: haceMin(1) },
      ],
      ctx(),
    );
    expect(h.map((e) => [e.accion, e.por])).toEqual([
      ['Se le recordó al agendador (nadie la había tomado)', 'El sistema'],
      ['Venció sin resolución', 'El sistema'],
    ]);
  });
});

describe('esEstadoActivo', () => {
  it('ABIERTA y EN_REVISION son activas; lo demás (y lo desconocido) no', () => {
    expect(esEstadoActivo('ABIERTA')).toBe(true);
    expect(esEstadoActivo('EN_REVISION')).toBe(true);
    for (const e of ['RESUELTA', 'DESCARTADA', 'AUTO_RESUELTA', 'VENCIDA', 'X']) expect(esEstadoActivo(e)).toBe(false);
  });
});
