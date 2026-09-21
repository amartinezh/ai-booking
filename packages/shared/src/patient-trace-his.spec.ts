import {
  VEREDICTO,
  clasificarRastreoA,
  clasificarRastreoB,
  construirLineaDeVida,
  presenciaEnHis,
  type CitaRastreo,
  type EstadoSync,
  type EvidenciaRastreoA,
  type EvidenciaRastreoB,
  type ResultadoRastreo,
  type SaludEspejo,
} from './patient-trace';
import type { CitaHisVista, EvidenciaHis } from './his-lookup';

// Lunes 21-sep-2026 10:00 en Bogotá.
const AHORA = '2026-09-21T15:00:00.000Z';
const MIN = 60_000;
const DIA = 86_400_000;
const hace = (ms: number) => new Date(Date.parse(AHORA) - ms).toISOString();
const dentroDe = (ms: number) => new Date(Date.parse(AHORA) + ms).toISOString();
const INICIO = dentroDe(2 * DIA);

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

const espejo: SaludEspejo = {
  enabled: true,
  pushEnabled: true,
  pullEnabled: true,
  lastHeartbeatIso: hace(MIN),
  hisReachable: true,
  hisDetail: null,
};

const cita = (over: Partial<CitaRastreo> = {}): CitaRastreo => ({
  id: 'apt-1',
  status: 'SCHEDULED',
  attendance: 'PENDING',
  origin: 'WHATSAPP',
  createdAtIso: hace(30 * MIN),
  startIso: INICIO,
  doctor: 'Dr(a). Ana Ruiz',
  doctorExternalKey: '76',
  service: 'Medicina General',
  eps: 'Sura',
  cancelacion: null,
  sync: sync(),
  confirmacion: { status: 'DELIVERED', enviadoIso: hace(30 * MIN), estadoIso: hace(29 * MIN), errorDetalle: null },
  confirmadaEnConversacion: true,
  coincideConCaptura: null,
  ...over,
});

const filaHis = (over: Partial<CitaHisVista> = {}): CitaHisVista => ({
  doctorExternalKey: '76',
  startIso: INICIO,
  serviceExternalKey: null,
  status: 'SCHEDULED',
  titular: 'PACIENTE',
  documentoTercero: null,
  ...over,
});

/** Un cupo consultado con las filas que el HIS tenga ahí. */
const cupoHis = (
  filas: Partial<CitaHisVista>[],
  key = '76',
  startIso = INICIO,
  incompleto = false,
) => ({
  doctorExternalKey: key,
  startIso,
  filas: filas.map((f) => filaHis({ doctorExternalKey: key, startIso, ...f })),
  incompleto,
});

const his = (over: Partial<EvidenciaHis> = {}): EvidenciaHis => ({
  consultadoIso: AHORA,
  porDocumento: null,
  cupos: [],
  ...over,
});

const evA = (over: Partial<EvidenciaRastreoA> = {}): EvidenciaRastreoA => ({
  ahoraIso: AHORA,
  pacienteEncontrado: true,
  citas: [cita()],
  citasOcultas: 0,
  espera: [],
  conversacion: null,
  espejo,
  capturaIndicada: false,
  ...over,
});

/** Las formas que acusan a alguien. "Mientras tanto" NO: por eso `mient` va acotado. */
const ACUSA = /\bmient(e|es|en)\b|mentir|mentiros|falso|fraude|engañ|culpa|inventó/i;

const texto = (r: ResultadoRastreo) =>
  JSON.stringify(r.veredictos.map((v) => [v.titulo, v.resumen, v.evidencia, v.noSabemos, v.accion])) + JSON.stringify(r.notas);

// ═══════════════════════════════════════════════════════════════════════════
// ESCENARIO A con la consulta en vivo
// ═══════════════════════════════════════════════════════════════════════════

describe('clasificarRastreoA + consulta en vivo', () => {
  describe('PRESENTE: el HIS la tiene a nombre del paciente', () => {
    it('CONFIRMADA_EN_EL_HIS (ok), con la fuente de los dos sistemas', () => {
      const r = clasificarRastreoA(evA({ his: his({ cupos: [cupoHis([{}])] }) }));

      expect(r.principal.codigo).toBe(VEREDICTO.CONFIRMADA_EN_EL_HIS);
      expect(r.principal.severidad).toBe('ok');
      expect(r.principal.fuente).toBe('AGENIA_Y_HIS');
      expect(r.principal.evidencia.join(' ')).toContain('Consulta en vivo al HIS');
      expect(r.principal.evidencia.join(' ')).toContain('a nombre del paciente, vigente');
      expect(r.principal.accion).toContain('comparar cómo la buscan');
    });

    it('🚨 gana sobre un dead-letter: si el HIS la tiene, "no llegó" es falso; y dice el estado del evento', () => {
      const dead = sync({ estado: 'DEAD_LETTER', attempts: 10, lastError: 'boom', deliveredAtIso: null });
      const r = clasificarRastreoA(evA({ citas: [cita({ sync: dead })], his: his({ cupos: [cupoHis([{}])] }) }));

      expect(r.principal.codigo).toBe(VEREDICTO.CONFIRMADA_EN_EL_HIS);
      expect(r.principal.evidencia.join(' ')).toContain('AgenIA todavía muestra el evento de envío como rendido tras 10 intento(s), pero el hospital ya la tiene');
    });

    it('una cita ya atendida en el HIS también cuenta como presente', () => {
      const r = clasificarRastreoA(evA({ his: his({ cupos: [cupoHis([{ status: 'ATTENDED' }])] }) }));
      expect(r.principal.evidencia.join(' ')).toContain('ya atendida');
    });
  });

  describe('OTRA_PERSONA: el HIS tiene esa hora a nombre de otro documento', () => {
    it('OTRA_IDENTIDAD (warn) con el documento ENMASCARADO', () => {
      const r = clasificarRastreoA(
        evA({ his: his({ cupos: [cupoHis([{ titular: 'OTRO', documentoTercero: '•••3456' }])] }) }),
      );

      expect(r.principal.codigo).toBe(VEREDICTO.OTRA_IDENTIDAD);
      expect(r.principal.severidad).toBe('warn');
      expect(r.principal.fuente).toBe('AGENIA_Y_HIS');
      expect(r.principal.evidencia.join(' ')).toContain('otro documento (•••3456)');
      expect(r.principal.noSabemos.join(' ')).toContain('no puede saber a quién pertenece');
    });

    it('el mismo número con ceros distintos lo dice y sugiere corregir la cadena', () => {
      const r = clasificarRastreoA(
        evA({ his: his({ cupos: [cupoHis([{ titular: 'MISMO_CON_CEROS', documentoTercero: '•••3456' }])] }) }),
      );

      expect(r.principal.codigo).toBe(VEREDICTO.OTRA_IDENTIDAD);
      expect(r.principal.resumen).toContain('ceros a la izquierda distintos');
      expect(r.principal.accion).toContain('sin ceros de más');
    });

    it('sin documento en la fila del HIS: no deja un paréntesis vacío', () => {
      const r = clasificarRastreoA(evA({ his: his({ cupos: [cupoHis([{ titular: 'SIN_DOCUMENTO' }])] }) }));
      expect(r.principal.evidencia.join(' ')).not.toContain('()');
    });
  });

  // Escenario A: la cita SÍ existe en AgenIA y se entregó. Si la respuesta del HIS
  // sobre ese cupo no se pudo leer, no hay deriva demostrada: hay algo sin verificar.
  describe('🚨 escenario A con la respuesta del HIS incompleta', () => {
    const incompleto = () => his({ cupos: [cupoHis([], '76', INICIO, true)] });

    it('NO se acusa una deriva entre los dos sistemas', () => {
      const r = clasificarRastreoA(evA({ his: incompleto() }));

      expect(r.veredictos.map((v) => v.codigo)).not.toContain(VEREDICTO.ENTREGADA_PERO_AUSENTE);
      expect(r.principal.codigo).toBe(VEREDICTO.ENTREGADA_SIN_VERIFICAR);
    });

    it('y se dice POR QUÉ no se pudo verificar', () => {
      const r = clasificarRastreoA(evA({ his: incompleto() }));
      expect(r.principal.evidencia.join(' ')).toContain('llegó incompleta');
    });

  });

  describe('AUSENTE: el HIS no tiene nada en ese cupo', () => {
    it('🎯 ENTREGADA_PERO_AUSENTE (bad) cuando AgenIA sí la entregó', () => {
      const r = clasificarRastreoA(evA({ his: his({ cupos: [cupoHis([])] }) }));

      expect(r.principal.codigo).toBe(VEREDICTO.ENTREGADA_PERO_AUSENTE);
      expect(r.principal.severidad).toBe('bad');
      expect(r.principal.fuente).toBe('AGENIA_Y_HIS');
      expect(r.principal.evidencia.join(' ')).toContain('no hay ninguna cita en ese médico y esa hora');
      expect(r.principal.accion).toContain('deriva');
    });

    it('trae pistas: el HIS SÍ tiene al paciente con ese médico en otra hora del mismo día', () => {
      const otraHora = new Date(Date.parse(INICIO) + 60 * MIN).toISOString();
      const r = clasificarRastreoA(
        evA({
          his: his({
            cupos: [cupoHis([])],
            porDocumento: { desdeIso: hace(30 * DIA), hastaIso: dentroDe(90 * DIA), truncado: false, citas: [filaHis({ startIso: otraHora })] },
          }),
        }),
      );
      expect(r.principal.evidencia.join(' ')).toContain('El HIS sí tiene al paciente con ese médico el');
    });

    it('no da pistas de citas con OTRO médico ni de otro día', () => {
      const r = clasificarRastreoA(
        evA({
          his: his({
            cupos: [cupoHis([])],
            porDocumento: {
              desdeIso: hace(30 * DIA), hastaIso: dentroDe(90 * DIA), truncado: false,
              citas: [filaHis({ doctorExternalKey: '91', startIso: INICIO }), filaHis({ startIso: dentroDe(9 * DIA) })],
            },
          }),
        }),
      );
      expect(r.principal.evidencia.join(' ')).not.toContain('El HIS sí tiene al paciente');
    });

    it('con el evento sin entregar, sigue siendo CONFIRMADA_NO_LLEGO — ahora CONFIRMADA por el HIS, con su causa', () => {
      const dead = sync({ estado: 'DEAD_LETTER', attempts: 10, lastError: 'cupo ya vendido', deliveredAtIso: null });
      const r = clasificarRastreoA(evA({ citas: [cita({ sync: dead })], his: his({ cupos: [cupoHis([])] }) }));

      expect(r.principal.codigo).toBe(VEREDICTO.CONFIRMADA_NO_LLEGO);
      expect(r.principal.causa).toBe('DEAD_LETTER');
      expect(r.principal.fuente).toBe('AGENIA_Y_HIS');
      expect(r.principal.evidencia.join(' ')).toContain('cupo ya vendido');
      expect(r.principal.evidencia.join(' ')).toContain('Consulta en vivo al HIS');
    });

    it('recién creada y en camino: EN_CAMINO_AL_HIS, con la comprobación en vivo', () => {
      const pend = sync({ estado: 'PENDING', creadoIso: hace(MIN), oldestPendingIso: hace(MIN), deliveredAtIso: null });
      const r = clasificarRastreoA(evA({ citas: [cita({ createdAtIso: hace(MIN), sync: pend })], his: his({ cupos: [cupoHis([])] }) }));

      expect(r.principal.codigo).toBe(VEREDICTO.EN_CAMINO_AL_HIS);
      expect(r.principal.evidencia.join(' ')).toContain('no hay ninguna cita en ese médico y esa hora');
    });
  });

  describe('cuando NO se puede afirmar nada, no se afirma', () => {
    it('un cupo que no se preguntó: el veredicto es el de siempre', () => {
      const r = clasificarRastreoA(evA({ his: his({ cupos: [cupoHis([], '91')] }) }));
      expect(r.principal.codigo).toBe(VEREDICTO.ENTREGADA_SIN_VERIFICAR);
      expect(r.principal.fuente).toBe('AGENIA');
    });

    it('un médico sin homologar (sin clave del HIS): no hay con qué buscar el cupo', () => {
      const r = clasificarRastreoA(evA({ citas: [cita({ doctorExternalKey: null })], his: his({ cupos: [cupoHis([])] }) }));
      expect(r.principal.codigo).toBe(VEREDICTO.ENTREGADA_SIN_VERIFICAR);
    });

    it('una cita cancelada en AgenIA no se contrasta con el HIS', () => {
      const cancelada = cita({ status: 'CANCELLED', cancelacion: { por: 'PACIENTE_WHATSAPP', atIso: hace(DIA), motivo: null } });
      const r = clasificarRastreoA(evA({ citas: [cancelada], his: his({ cupos: [cupoHis([{}])] }) }));
      expect(r.principal.codigo).toBe(VEREDICTO.CANCELADA);
    });

    it('una cita ya atendida tampoco', () => {
      const atendida = cita({ status: 'COMPLETED', attendance: 'ATTENDED', startIso: hace(3 * DIA) });
      const r = clasificarRastreoA(evA({ citas: [{ ...atendida, coincideConCaptura: true }], capturaIndicada: true, his: his({ cupos: [cupoHis([], '76', atendida.startIso)] }) }));
      expect(r.principal.codigo).toBe(VEREDICTO.CITA_VIGENTE);
    });

    it('sin la evidencia en vivo, nada cambia', () => {
      expect(clasificarRastreoA(evA()).principal.codigo).toBe(VEREDICTO.ENTREGADA_SIN_VERIFICAR);
      expect(clasificarRastreoA(evA({ his: null })).principal.codigo).toBe(VEREDICTO.ENTREGADA_SIN_VERIFICAR);
    });
  });

  describe('notas con lo que el HIS tiene del paciente', () => {
    const porDoc = (citas: CitaHisVista[], truncado = false) => ({ desdeIso: hace(30 * DIA), hastaIso: dentroDe(90 * DIA), truncado, citas });

    it('las citas del HIS que AgenIA no conoce (típico de ventanilla), sin acusar', () => {
      const ventanilla = filaHis({ doctorExternalKey: '91', startIso: dentroDe(5 * DIA) });
      const r = clasificarRastreoA(evA({ his: his({ cupos: [cupoHis([{}])], porDocumento: porDoc([filaHis(), ventanilla]) }) }));

      expect(r.notas.join(' ')).toContain('El HIS tiene 1 cita(s) de este paciente que AgenIA no tiene registradas');
      expect(r.notas.join(' ')).toContain('agendadas en ventanilla');
    });

    it('una cita del HIS que AgenIA sí conoce no se lista como desconocida', () => {
      const r = clasificarRastreoA(evA({ his: his({ cupos: [cupoHis([{}])], porDocumento: porDoc([filaHis()]) }) }));
      expect(r.notas.join(' ')).not.toContain('que AgenIA no tiene registradas');
    });

    it('🐛 la cita de AgenIA con segundos SÍ se reconoce en el HIS (que guarda al minuto): no es "desconocida"', () => {
      const conSegundos = cita({ startIso: '2026-09-23T15:00:37.412Z', doctorExternalKey: '76' });
      const delHis = filaHis({ startIso: '2026-09-23T15:00:00.000Z' });
      const r = clasificarRastreoA(evA({ citas: [conSegundos], his: his({ porDocumento: porDoc([delHis]) }) }));
      expect(r.notas.join(' ')).not.toContain('que AgenIA no tiene registradas');
    });

    it('🚨 cancelada en AgenIA pero vigente en el HIS: la cancelación no llegó', () => {
      const cancelada = cita({ status: 'CANCELLED', cancelacion: { por: 'PERSONAL', atIso: hace(DIA), motivo: null } });
      const r = clasificarRastreoA(evA({ citas: [cancelada], his: his({ porDocumento: porDoc([filaHis()]) }) }));
      expect(r.notas.join(' ')).toContain('figura cancelada en AgenIA, pero el HIS la conserva vigente');
    });

    it('una lista recortada lo dice: nunca en silencio', () => {
      const r = clasificarRastreoA(evA({ his: his({ cupos: [cupoHis([{}])], porDocumento: porDoc([filaHis()], true) }) }));
      expect(r.notas.join(' ')).toContain('se recortó al máximo');
    });

    it('más de tres desconocidas: lista tres y dice que hay otras', () => {
      const varias = [1, 2, 3, 4].map((i) => filaHis({ doctorExternalKey: '9' + i, startIso: dentroDe((3 + i) * DIA) }));
      const r = clasificarRastreoA(evA({ his: his({ porDocumento: porDoc(varias) }) }));
      expect(r.notas.join(' ')).toContain('4 cita(s)');
      expect(r.notas.join(' ')).toContain('y otras');
    });

    it('las citas de OTRO documento en la ventana no se atribuyen al paciente', () => {
      const ajena = filaHis({ doctorExternalKey: '91', startIso: dentroDe(5 * DIA), titular: 'OTRO', documentoTercero: '•••1' });
      const r = clasificarRastreoA(evA({ his: his({ porDocumento: porDoc([ajena]) }) }));
      expect(r.notas.join(' ')).not.toContain('que AgenIA no tiene registradas');
    });
  });

  it('lenguaje neutro: ningún texto de la consulta en vivo acusa a nadie', () => {
    const casos = [
      clasificarRastreoA(evA({ his: his({ cupos: [cupoHis([{}])] }) })),
      clasificarRastreoA(evA({ his: his({ cupos: [cupoHis([{ titular: 'OTRO', documentoTercero: '•••3456' }])] }) })),
      clasificarRastreoA(evA({ his: his({ cupos: [cupoHis([])] }) })),
    ];
    for (const r of casos) expect(texto(r)).not.toMatch(ACUSA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Línea de vida
// ═══════════════════════════════════════════════════════════════════════════

describe('construirLineaDeVida + consulta en vivo', () => {
  const ultimo = (c: CitaRastreo, h?: EvidenciaHis | null) =>
    construirLineaDeVida(c, { espejo, his: h }).find((p) => p.clave === 'presente_en_el_his')!;

  it('sin consulta: "sin verificar", como antes', () => {
    expect(ultimo(cita())).toMatchObject({ estado: 'unknown', detalle: expect.stringContaining('requiere la consulta en vivo') });
  });

  it('PRESENTE → ✓ con la hora de la consulta', () => {
    expect(ultimo(cita(), his({ cupos: [cupoHis([{}])] }))).toMatchObject({ estado: 'ok', atIso: AHORA });
  });

  it('AUSENTE → ✗', () => {
    expect(ultimo(cita(), his({ cupos: [cupoHis([])] }))).toMatchObject({ estado: 'fail', detalle: expect.stringContaining('no tiene esa cita') });
  });

  it('🚨 respuesta INCOMPLETA → "?" y no ✗: no se sabe, que es distinto de no estar', () => {
    const p = ultimo(cita(), his({ cupos: [cupoHis([], '76', INICIO, true)] }));
    expect(p.estado).toBe('unknown');
    expect(p.detalle).toContain('no se pudo leer entera');
  });

  it('OTRA_PERSONA → ✗ con el documento enmascarado', () => {
    const p = ultimo(cita(), his({ cupos: [cupoHis([{ titular: 'OTRO', documentoTercero: '•••3456' }])] }));
    expect(p.estado).toBe('fail');
    expect(p.detalle).toContain('otro documento (•••3456)');
  });

  it('se consultó pero ese cupo no se pudo buscar (médico sin homologar): "?" y dice por qué', () => {
    const p = ultimo(cita({ doctorExternalKey: null }), his({ cupos: [cupoHis([])] }));
    expect(p.estado).toBe('unknown');
    expect(p.detalle).toContain('no está homologado');
  });

  it('una cita nacida en el HIS no aplica, consulten o no', () => {
    expect(ultimo(cita({ origin: 'MIRROR' }), his({ cupos: [cupoHis([{}])] })).estado).toBe('na');
  });
});

describe('presenciaEnHis', () => {
  it('compara instantes: una hora escrita con otro desfase es el mismo cupo', () => {
    const otroFormato = new Date(INICIO).toISOString().replace('Z', '+00:00');
    expect(presenciaEnHis({ doctorExternalKey: '76', startIso: INICIO }, his({ cupos: [cupoHis([{}], '76', otroFormato)] }))?.tipo).toBe('PRESENTE');
  });
  it('sin evidencia o sin clave de médico: null', () => {
    expect(presenciaEnHis({ doctorExternalKey: '76', startIso: INICIO }, null)).toBeNull();
    expect(presenciaEnHis({ doctorExternalKey: null, startIso: INICIO }, his({ cupos: [cupoHis([{}])] }))).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ESCENARIO B con la consulta en vivo
// ═══════════════════════════════════════════════════════════════════════════

const evB = (
  over: Partial<Omit<EvidenciaRastreoB, 'cupoEnAgenIA' | 'paciente'>> & {
    cupoEnAgenIA?: Partial<EvidenciaRastreoB['cupoEnAgenIA']>;
    paciente?: Partial<EvidenciaRastreoB['paciente']>;
  } = {},
): EvidenciaRastreoB => ({
  ahoraIso: AHORA,
  cupoDescripcion: 'Cupo del HIS: MEDICO HTA, mar 22 sep, 10:00 a m',
  cupo: { doctorExternalKey: '76', startIso: INICIO },
  espejo,
  ...over,
  paciente: { perfilEncontrado: true, coincidencia: 'EXACTA', perfilesConVariante: 0, conWhatsapp: true, ...over.paciente },
  cupoEnAgenIA: { medicoHomologado: true, cupoExiste: true, auditorias: [], citaDelPacienteEnAgenIA: false, ...over.cupoEnAgenIA },
});

const auditoriaSinAppointment = {
  resultado: 'OK' as const,
  op: 'INSERT',
  nota: 'cita del HIS con paciente sin homologar: solo se ocupó el cupo, no se creó Appointment',
  atIso: hace(3 * 60 * MIN),
};

describe('clasificarRastreoB + consulta en vivo', () => {
  it('🎯 NADIE: NO_ESTA_EN_EL_HIS, y la ausencia de evento deja de ser un hallazgo aparte', () => {
    const r = clasificarRastreoB(evB({ his: his({ cupos: [cupoHis([])] }) }));

    expect(r.principal.codigo).toBe(VEREDICTO.NO_ESTA_EN_EL_HIS);
    expect(r.principal.fuente).toBe('HIS_EN_VIVO');
    expect(r.principal.evidencia.join(' ')).toContain('no hay ninguna cita en ese cupo');
    expect(r.veredictos.map((v) => v.codigo)).not.toContain(VEREDICTO.SIN_EVENTO_DEL_HIS);
  });

  // ══════════════════════════════════════════════════════════════════════
  // El hospital guarda parte de las horas en un formato que no se puede leer
  // (MAPEO_HIS.md §2.1: 5,7 % de las citas; la medición del 2026-09-20 se topó
  // con una). La consulta por cupo compara la hora EXACTA, así que esas filas no
  // coinciden y el cupo llega vacío. Decir entonces «el HIS no tiene nada» es un
  // falso negativo: justo el diagnóstico que esta pantalla existe para evitar.
  // ══════════════════════════════════════════════════════════════════════
  describe('🚨 la respuesta del HIS llegó incompleta', () => {
    const incompleto = () => his({ cupos: [cupoHis([], '76', INICIO, true)] });

    it('NO se afirma que la cita no esté: se dice que no se pudo leer', () => {
      const r = clasificarRastreoB(evB({ his: incompleto() }));

      expect(r.principal.codigo).toBe(VEREDICTO.HORA_ILEGIBLE_EN_EL_HIS);
      expect(r.veredictos.map((v) => v.codigo)).not.toContain(VEREDICTO.NO_ESTA_EN_EL_HIS);
      expect(r.principal.fuente).toBe('HIS_EN_VIVO');
      expect(r.principal.noSabemos.join(' ')).toContain('Si hay o no una cita en ese cupo');
    });

    it('manda al funcionario a mirarlo en el sistema del hospital', () => {
      const r = clasificarRastreoB(evB({ his: incompleto() }));
      expect(r.principal.accion).toContain('aplicación del hospital');
    });

    it('sigue sin acusar a nadie', () => {
      expect(texto(clasificarRastreoB(evB({ his: incompleto() })))).not.toMatch(ACUSA);
    });

    it('con la respuesta COMPLETA, el veredicto de ausencia no cambia', () => {
      const r = clasificarRastreoB(evB({ his: his({ cupos: [cupoHis([], '76', INICIO, false)] }) }));
      expect(r.principal.codigo).toBe(VEREDICTO.NO_ESTA_EN_EL_HIS);
    });

    it('si el cupo SÍ trae filas legibles, el recorte no borra al ocupante', () => {
      const r = clasificarRastreoB(evB({ his: his({ cupos: [cupoHis([{}], '76', INICIO, true)] }) }));
      expect(r.veredictos.map((v) => v.codigo)).not.toContain(VEREDICTO.HORA_ILEGIBLE_EN_EL_HIS);
    });
  });

  it('NADIE con pistas: el HIS sí tiene al paciente con ese médico en otra hora', () => {
    const otra = new Date(Date.parse(INICIO) + 40 * MIN).toISOString();
    const r = clasificarRastreoB(
      evB({ his: his({ cupos: [cupoHis([])], porDocumento: { desdeIso: hace(DIA), hastaIso: dentroDe(30 * DIA), truncado: false, citas: [filaHis({ startIso: otra })] } }) }),
    );
    expect(r.principal.evidencia.join(' ')).toContain('El HIS sí tiene al paciente con ese médico el');
  });

  it('OTRA_PERSONA: OTRA_IDENTIDAD va PRIMERO y el resto de veredictos se conserva', () => {
    const r = clasificarRastreoB(
      evB({
        cupoEnAgenIA: { auditorias: [auditoriaSinAppointment] },
        his: his({ cupos: [cupoHis([{ titular: 'OTRO', documentoTercero: '•••3456' }])] }),
      }),
    );

    expect(r.principal.codigo).toBe(VEREDICTO.OTRA_IDENTIDAD);
    expect(r.principal.evidencia.join(' ')).toContain('otro documento (•••3456)');
    expect(r.veredictos.map((v) => v.codigo)).toContain(VEREDICTO.CITA_DEL_HIS_NO_ESPEJADA);
  });

  it('OTRA_PERSONA con ceros: lo dice', () => {
    const r = clasificarRastreoB(evB({ his: his({ cupos: [cupoHis([{ titular: 'MISMO_CON_CEROS', documentoTercero: '•••3456' }])] }) }));
    expect(r.principal.resumen).toContain('ceros a la izquierda distintos');
  });

  describe('PRESENTE: el HIS la tiene a nombre del paciente', () => {
    const conHis = his({ cupos: [cupoHis([{}])] });

    it('CITA_DEL_HIS_NO_ESPEJADA se confirma con el HIS y deja de decir "no sé a nombre de quién"', () => {
      const r = clasificarRastreoB(evB({ cupoEnAgenIA: { auditorias: [auditoriaSinAppointment] }, his: conHis }));

      expect(r.principal.codigo).toBe(VEREDICTO.CITA_DEL_HIS_NO_ESPEJADA);
      expect(r.principal.fuente).toBe('AGENIA_Y_HIS');
      expect(r.principal.evidencia.join(' ')).toContain('el cupo figura a nombre del paciente, vigente');
      expect(r.principal.noSabemos.join(' ')).not.toContain('A nombre de quién');
    });

    it('sin ningún evento en AgenIA: SIN_EVENTO_DEL_HIS pasa a decir que el HIS sí la tiene y a escalar', () => {
      const r = clasificarRastreoB(evB({ his: conHis }));

      expect(r.principal.codigo).toBe(VEREDICTO.SIN_EVENTO_DEL_HIS);
      expect(r.principal.resumen).toContain('El HIS sí tiene la cita a nombre del paciente');
      expect(r.principal.noSabemos).toEqual([]);
      expect(r.principal.accion).toContain('Escalar');
    });

    it('AgenIA también la tiene → CONFIRMADA_EN_EL_HIS (ok): los dos sistemas coinciden', () => {
      const r = clasificarRastreoB(evB({ cupoEnAgenIA: { citaDelPacienteEnAgenIA: true }, his: conHis }));

      expect(r.principal.codigo).toBe(VEREDICTO.CONFIRMADA_EN_EL_HIS);
      expect(r.principal.severidad).toBe('ok');
    });

    it('MEDICO_NO_ESPEJADO se enriquece: la cita del hospital existe a nombre del paciente', () => {
      const r = clasificarRastreoB(evB({ cupoEnAgenIA: { medicoHomologado: false, cupoExiste: false, auditorias: [{ resultado: 'SKIPPED', op: 'INSERT', nota: 'médico no espejado', atIso: hace(DIA) }] }, his: conHis }));

      expect(r.principal.codigo).toBe(VEREDICTO.MEDICO_NO_ESPEJADO);
      expect(r.principal.evidencia.join(' ')).toContain('el cupo figura a nombre del paciente');
    });
  });

  describe('cuando no se puede ubicar el cupo, no se afirma', () => {
    it('la respuesta no trae ese cupo: el veredicto es el de AgenIA', () => {
      const r = clasificarRastreoB(evB({ his: his({ cupos: [cupoHis([], '91')] }) }));
      expect(r.principal.codigo).toBe(VEREDICTO.SIN_EVENTO_DEL_HIS);
      expect(r.principal.fuente).toBe('AGENIA');
    });

    it('la evidencia no dice qué cupo era: nada cambia', () => {
      const r = clasificarRastreoB(evB({ cupo: null, his: his({ cupos: [cupoHis([])] }) }));
      expect(r.principal.codigo).toBe(VEREDICTO.SIN_EVENTO_DEL_HIS);
    });

    it('sin consulta en vivo: igual que antes', () => {
      expect(clasificarRastreoB(evB()).principal.codigo).toBe(VEREDICTO.SIN_EVENTO_DEL_HIS);
    });
  });

  it('lenguaje neutro en B', () => {
    for (const cupos of [[cupoHis([])], [cupoHis([{ titular: 'OTRO', documentoTercero: '•••3456' }])], [cupoHis([{}])]]) {
      expect(texto(clasificarRastreoB(evB({ his: his({ cupos }) })))).not.toMatch(ACUSA);
    }
  });
});
