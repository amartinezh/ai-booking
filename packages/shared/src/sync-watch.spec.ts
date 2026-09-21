import {
  ESTADOS_ACTIVOS,
  ORDEN_SEVERIDAD_EXCEPCION,
  TIPOS_CON_AVISO,
  UMBRALES_VIGILANTE,
  claveExcepcion,
  eventoCulpable,
  evaluarRetencion,
  parametrosPlantillaAviso,
  requiereAviso,
  resumenRetencion,
  severidadPorCercania,
  transicionExcepcion,
  type AccionExcepcion,
  type EstadoExcepcion,
} from './sync-watch';
import type { FilaOutbox } from './sync-state';

// ══════════════════════════════════════════════════════════════════════════
// El vigilante de la sincronización (docs/PLAN_RASTREO_PACIENTE.md §10 #2 y #3).
// Es lógica PURA compartida por la API (que vigila) y la web (que muestra la
// bandeja): tienen que clasificar igual.
// ══════════════════════════════════════════════════════════════════════════

const AHORA = '2026-09-22T15:00:00.000Z';
const MIN = 60_000;
const HORA = 60 * MIN;
const desdeAhora = (ms: number) => new Date(Date.parse(AHORA) + ms).toISOString();
const haceMin = (min: number) => new Date(Date.parse(AHORA) - min * MIN);

const evento = (over: Partial<FilaOutbox> = {}): FilaOutbox => ({
  seq: BigInt(1),
  op: 'INSERT',
  createdAt: haceMin(30),
  deliveredAt: null,
  attempts: 0,
  deadLettered: false,
  nextAttemptAt: null,
  lastError: null,
  ...over,
});

const cita = (over: Record<string, string> = {}) => ({
  inicioIso: desdeAhora(3 * 24 * HORA),
  estado: 'SCHEDULED',
  origen: 'WHATSAPP',
  ...over,
});

const evaluar = (eventos: FilaOutbox[], over: Record<string, string> = {}, umbralMin?: number) =>
  evaluarRetencion({ cita: cita(over), eventos, ahoraIso: AHORA, umbralMin });

// ─────────────────────────────────────────────────────────────
describe('evaluarRetencion — ¿una cita de AgenIA está retenida antes de llegar al hospital?', () => {
  describe('lo que NO se vigila', () => {
    it.each([
      ['una cita cancelada', { estado: 'CANCELLED' }],
      ['una cita completada', { estado: 'COMPLETED' }],
      ['una cita nacida en el HIS (no tiene envío pendiente hacia allá)', { origen: 'MIRROR' }],
    ])('%s', (_n, over) => {
      expect(evaluar([evento({ attempts: 10, deadLettered: true })], over)).toBeNull();
    });

    it('🕐 una cita que YA empezó: la alerta es para ANTES de la hora', () => {
      expect(evaluar([evento({ attempts: 10, deadLettered: true })], { inicioIso: desdeAhora(-5 * MIN) })).toBeNull();
      expect(evaluar([evento({ attempts: 10, deadLettered: true })], { inicioIso: AHORA })).toBeNull();
    });

    it('una cita sin ningún evento (creada con el espejo apagado): no hay envío que vigilar', () => {
      expect(evaluar([])).toBeNull();
    });

    it('una cita ya entregada al hospital', () => {
      expect(evaluar([evento({ deliveredAt: haceMin(20) })])).toBeNull();
    });

    it('una fecha ilegible no lanza: simplemente no se evalúa', () => {
      expect(evaluar([evento({ attempts: 10, deadLettered: true })], { inicioIso: 'mañana' })).toBeNull();
    });
  });

  describe('el umbral: unos minutos en cola son normales', () => {
    it('el umbral por defecto es el mismo que usa la pantalla del rastreo', () => {
      expect(UMBRALES_VIGILANTE.retencionMin).toBe(10);
    });

    it.each([
      ['pendiente hace 5 min', [evento({ createdAt: haceMin(5) })]],
      ['pendiente hace 9 min', [evento({ createdAt: haceMin(9) })]],
      ['en reintento hace 9 min', [evento({ createdAt: haceMin(9), attempts: 2, lastError: 'x' })]],
    ])('%s → todavía no', (_n, eventos) => {
      expect(evaluar(eventos)).toBeNull();
    });

    it('pendiente hace 10 min → EN_COLA', () => {
      expect(evaluar([evento({ createdAt: haceMin(10) })])).toMatchObject({ motivo: 'EN_COLA', minutosRetenida: 10 });
    });

    it('en reintento hace 12 min → REINTENTANDO, con el intento y el motivo', () => {
      expect(evaluar([evento({ createdAt: haceMin(12), attempts: 3, lastError: 'Failed to connect' })])).toMatchObject({
        motivo: 'REINTENTANDO',
        attempts: 3,
        lastError: 'Failed to connect',
        minutosRetenida: 12,
      });
    });

    it('☠️ un dead-letter NO espera al umbral: ya no se va a entregar solo', () => {
      expect(evaluar([evento({ createdAt: haceMin(1), attempts: 10, deadLettered: true, lastError: 'cupo ya vendido' })])).toMatchObject({
        motivo: 'RENDIDA',
        lastError: 'cupo ya vendido',
      });
    });

    it('el umbral se puede ajustar', () => {
      expect(evaluar([evento({ createdAt: haceMin(5) })], {}, 3)).toMatchObject({ motivo: 'EN_COLA' });
      expect(evaluar([evento({ createdAt: haceMin(5) })], {}, 30)).toBeNull();
    });

    it('el retraso se mide desde el evento MÁS VIEJO sin entregar, no desde el último', () => {
      const r = evaluar([evento({ seq: BigInt(1), createdAt: haceMin(40) }), evento({ seq: BigInt(2), createdAt: haceMin(2) })]);
      expect(r).toMatchObject({ motivo: 'EN_COLA', minutosRetenida: 40 });
    });
  });

  describe('la gravedad sube con la cercanía de la cita', () => {
    const conCita = (desdeMs: number, eventos: FilaOutbox[]) => evaluar(eventos, { inicioIso: desdeAhora(desdeMs) });
    const enCola = [evento({ createdAt: haceMin(30) })];
    const rendida = [evento({ attempts: 10, deadLettered: true })];

    it.each([
      ['en 3 días', 3 * 24 * HORA, 'MEDIA', 'ALTA'],
      ['en 23 horas', 23 * HORA, 'ALTA', 'ALTA'],
      ['en 3 horas', 3 * HORA, 'CRITICA', 'CRITICA'],
      ['en 30 minutos', 30 * MIN, 'CRITICA', 'CRITICA'],
    ])('la cita es %s: en cola=%s, rendida=%s', (_n, ms, colaEsperada, rendidaEsperada) => {
      expect(conCita(ms, enCola)?.severidad).toBe(colaEsperada);
      expect(conCita(ms, rendida)?.severidad).toBe(rendidaEsperada);
    });

    it('lo dice: cuántos minutos faltan para la cita', () => {
      expect(conCita(90 * MIN, enCola)?.minutosParaLaCita).toBe(90);
    });

    it('los umbrales de urgencia son 24 h (alta) y 4 h (crítica)', () => {
      expect(UMBRALES_VIGILANTE.urgenciaAltaHoras).toBe(24);
      expect(UMBRALES_VIGILANTE.urgenciaCriticaHoras).toBe(4);
    });
  });

  describe('varios eventos de una misma cita: manda el peor', () => {
    it('🚨 un alta entregada con un cambio rendido es RENDIDA', () => {
      const r = evaluar([
        evento({ seq: BigInt(1), op: 'INSERT', deliveredAt: haceMin(50) }),
        evento({ seq: BigInt(2), op: 'UPDATE', createdAt: haceMin(20), attempts: 10, deadLettered: true }),
      ]);
      expect(r).toMatchObject({ motivo: 'RENDIDA', seq: '2' });
    });

    it('el evento culpable de una cita en cola es el más viejo', () => {
      const r = evaluar([evento({ seq: BigInt(7), createdAt: haceMin(30) }), evento({ seq: BigInt(9), createdAt: haceMin(15) })]);
      expect(r?.seq).toBe('7');
    });

    it('el seq sale como texto aunque el evento lo traiga como bigint', () => {
      expect(evaluar([evento({ seq: BigInt(123456789012), attempts: 10, deadLettered: true })])?.seq).toBe('123456789012');
    });
  });

  it('las citas creadas por el personal (MANUAL) también se vigilan', () => {
    expect(evaluar([evento({ attempts: 10, deadLettered: true })], { origen: 'MANUAL' })).toMatchObject({ motivo: 'RENDIDA' });
  });

  describe('lenguaje', () => {
    it('el resumen describe el envío, nunca acusa a nadie', () => {
      const textos = [
        evaluar([evento({ createdAt: haceMin(30) })])?.resumen,
        evaluar([evento({ createdAt: haceMin(30), attempts: 3 })])?.resumen,
        evaluar([evento({ attempts: 10, deadLettered: true })])?.resumen,
      ];
      for (const t of textos) {
        expect(t).toBeTruthy();
        expect(t).not.toMatch(/culpa|mientr|falso|fraude|engañ|paciente (no|se)/i);
      }
    });

    it('el resumen dice cuánto lleva y qué pasó', () => {
      expect(evaluar([evento({ createdAt: haceMin(25) })])?.resumen).toMatch(/25 min/);
      expect(evaluar([evento({ attempts: 10, deadLettered: true })])?.resumen).toMatch(/10 intentos/);
    });
  });
});

describe('resumenRetencion', () => {
  it('es la misma frase que trae la retención, para que la web la reconstruya desde `meta`', () => {
    const r = evaluar([evento({ createdAt: haceMin(25) })]);
    expect(resumenRetencion('EN_COLA', 25, 0)).toBe(r?.resumen);
    const rend = evaluar([evento({ attempts: 10, deadLettered: true })]);
    expect(resumenRetencion('RENDIDA', rend?.minutosRetenida ?? 0, 10)).toBe(rend?.resumen);
  });

  it('cada motivo tiene su frase, sin datos técnicos', () => {
    expect(resumenRetencion('REINTENTANDO', 12, 3)).toMatch(/intento 3 de 10.*12 min/);
    expect(resumenRetencion('EN_COLA', 25, 0)).toMatch(/25 min en la cola/);
    expect(resumenRetencion('RENDIDA', 0, 10)).toMatch(/10 intentos/);
  });
});

describe('eventoCulpable', () => {
  it('sin eventos pendientes: ninguno', () => {
    expect(eventoCulpable([])).toBeNull();
    expect(eventoCulpable([evento({ deliveredAt: haceMin(1) })])).toBeNull();
  });

  it('el rendido gana sobre el que reintenta, y este sobre el simple pendiente', () => {
    const pend = evento({ seq: BigInt(1) });
    const reint = evento({ seq: BigInt(2), attempts: 2 });
    const rend = evento({ seq: BigInt(3), attempts: 10, deadLettered: true });
    expect(eventoCulpable([pend, reint, rend])?.seq).toBe(BigInt(3));
    expect(eventoCulpable([pend, reint])?.seq).toBe(BigInt(2));
    expect(eventoCulpable([pend])?.seq).toBe(BigInt(1));
  });

  it('☠️ el RENDIDO manda aunque otro evento lleve MÁS intentos (no se decide por el contador)', () => {
    // Un dead-letter puede traer pocos intentos (se rindió por otra vía) mientras otro
    // evento reintenta con más: lo que explica que la cita no llegó es el rendido.
    const rendido = evento({ seq: BigInt(5), attempts: 1, deadLettered: true });
    const reintentando = evento({ seq: BigInt(6), attempts: 8 });
    expect(eventoCulpable([reintentando, rendido])?.seq).toBe(BigInt(5));
    // …y coincide con lo que dice el estado que ve la pantalla.
    expect(evaluar([reintentando, rendido])).toMatchObject({ motivo: 'RENDIDA', seq: '5' });
  });

  it('entre varios reintentando, el de más intentos', () => {
    expect(eventoCulpable([evento({ seq: BigInt(1), attempts: 2 }), evento({ seq: BigInt(2), attempts: 6 })])?.seq).toBe(BigInt(2));
  });
});

describe('severidadPorCercania', () => {
  it('sube la base cuando la cita se acerca, nunca la baja', () => {
    expect(severidadPorCercania('MEDIA', 5 * 24 * 60)).toBe('MEDIA');
    expect(severidadPorCercania('MEDIA', 10 * 60)).toBe('ALTA');
    expect(severidadPorCercania('MEDIA', 60)).toBe('CRITICA');
    expect(severidadPorCercania('ALTA', 5 * 24 * 60)).toBe('ALTA');
    expect(severidadPorCercania('CRITICA', 5 * 24 * 60)).toBe('CRITICA');
    expect(severidadPorCercania('BAJA', 10 * 60)).toBe('ALTA');
  });

  it('🔼 nunca la baja: una CRÍTICA sigue siendo crítica aunque la cita esté a 10 horas', () => {
    // Dentro de la ventana de 24 h la regla es «al menos ALTA», no «ALTA».
    expect(severidadPorCercania('CRITICA', 10 * 60)).toBe('CRITICA');
    expect(severidadPorCercania('ALTA', 10 * 60)).toBe('ALTA');
  });

  it('el orden de las gravedades es total', () => {
    expect(ORDEN_SEVERIDAD_EXCEPCION.BAJA).toBeLessThan(ORDEN_SEVERIDAD_EXCEPCION.MEDIA);
    expect(ORDEN_SEVERIDAD_EXCEPCION.MEDIA).toBeLessThan(ORDEN_SEVERIDAD_EXCEPCION.ALTA);
    expect(ORDEN_SEVERIDAD_EXCEPCION.ALTA).toBeLessThan(ORDEN_SEVERIDAD_EXCEPCION.CRITICA);
  });
});

// ─────────────────────────────────────────────────────────────
describe('claveExcepcion — identifica el PROBLEMA, no la fila', () => {
  it('cita: por cita Y por el evento culpable (un problema nuevo de la misma cita es otro)', () => {
    expect(claveExcepcion.citaNoEntregada('apt-1', BigInt(7))).toBe('cita:apt-1:7');
    expect(claveExcepcion.citaNoEntregada('apt-1', '7')).toBe('cita:apt-1:7');
    expect(claveExcepcion.citaNoEntregada('apt-1', 8)).not.toBe(claveExcepcion.citaNoEntregada('apt-1', 7));
  });

  it('evento rendido y deriva', () => {
    expect(claveExcepcion.eventoRendido(BigInt(42))).toBe('evento:42');
    expect(claveExcepcion.derivaEnHis('apt-1')).toBe('deriva:apt-1');
  });

  it('auditoría: el mismo problema repetido cae en la MISMA clave (no una excepción por fila)', () => {
    const a = { direction: 'INBOUND', entityType: 'APPOINTMENT', entityId: null, cupo: '76|2026-09-24T12:00:00.000Z', outcome: 'CONFLICT' };
    expect(claveExcepcion.auditoria(a)).toBe(claveExcepcion.auditoria({ ...a }));
    expect(claveExcepcion.auditoria(a)).not.toBe(claveExcepcion.auditoria({ ...a, outcome: 'ERROR' }));
    expect(claveExcepcion.auditoria(a)).not.toBe(claveExcepcion.auditoria({ ...a, cupo: '76|2026-09-25T12:00:00.000Z' }));
  });

  it('auditoría sin entidad ni cupo: una sola clave por tipo de problema', () => {
    const a = { direction: 'HIS_TO_AGENIA', entityType: 'SLOT', entityId: null, cupo: null, outcome: 'ERROR' };
    expect(claveExcepcion.auditoria(a)).toBe('auditoria:HIS_TO_AGENIA:SLOT:-:ERROR');
  });

  it('las claves de tipos distintos nunca chocan', () => {
    const claves = [
      claveExcepcion.citaNoEntregada('x', 1),
      claveExcepcion.eventoRendido(1),
      claveExcepcion.derivaEnHis('x'),
      claveExcepcion.auditoria({ direction: 'a', entityType: 'b', entityId: 'x', cupo: null, outcome: 'c' }),
    ];
    expect(new Set(claves).size).toBe(claves.length);
  });
});

// ─────────────────────────────────────────────────────────────
describe('requiereAviso — ¿corresponde avisarle al agendador?', () => {
  const exc = (over: Record<string, unknown> = {}) => ({
    kind: 'CITA_NO_ENTREGADA' as const,
    severity: 'MEDIA' as const,
    status: 'ABIERTA' as const,
    notifiedSeverity: null as string | null,
    appointmentStartIso: desdeAhora(2 * 24 * HORA) as string | null,
    ...over,
  });
  const avisar = (over: Record<string, unknown> = {}) => requiereAviso(exc(over) as never, AHORA);

  it('una excepción nueva de una cita retenida: sí', () => {
    expect(avisar()).toBe(true);
  });

  it('la deriva contra el hospital también', () => {
    expect(avisar({ kind: 'DERIVA_EN_HIS', severity: 'ALTA' })).toBe(true);
  });

  it.each(['EVENTO_RENDIDO', 'CONFLICTO_SYNC', 'ERROR_SYNC'])('%s es técnica: solo bandeja, sin aviso', (kind) => {
    expect(avisar({ kind })).toBe(false);
    expect(TIPOS_CON_AVISO).not.toContain(kind);
  });

  it('no repite: ya avisada con esa gravedad', () => {
    expect(avisar({ notifiedSeverity: 'MEDIA' })).toBe(false);
  });

  it('vuelve a avisar SOLO si la gravedad SUBE (la cita se acercó)', () => {
    expect(avisar({ severity: 'ALTA', notifiedSeverity: 'MEDIA' })).toBe(true);
    expect(avisar({ severity: 'CRITICA', notifiedSeverity: 'ALTA' })).toBe(true);
    expect(avisar({ severity: 'MEDIA', notifiedSeverity: 'ALTA' })).toBe(false);
  });

  it.each(['EN_REVISION', 'RESUELTA', 'DESCARTADA', 'AUTO_RESUELTA'])('👤 si está %s: alguien ya se ocupa (o ya no importa), no se molesta', (status) => {
    expect(avisar({ status })).toBe(false);
  });

  it('🕐 una cita que ya empezó no se avisa: el aviso es para ANTES de la hora', () => {
    expect(avisar({ appointmentStartIso: desdeAhora(-MIN) })).toBe(false);
    expect(avisar({ appointmentStartIso: AHORA })).toBe(false);
  });

  it('una excepción sin hora de cita (no aplica el "antes") no queda bloqueada por ello', () => {
    expect(avisar({ appointmentStartIso: null, kind: 'DERIVA_EN_HIS' })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('transicionExcepcion — la máquina de estados de la bandeja', () => {
  const t = (
    estado: EstadoExcepcion,
    accion: AccionExcepcion,
    ctx: Partial<{ esDuenio: boolean; esAdmin: boolean; hayDuenio: boolean; nota: string }> = {},
  ) => transicionExcepcion(estado, accion, { esDuenio: false, esAdmin: false, hayDuenio: false, ...ctx });

  it('los estados activos son los que aún requieren trabajo', () => {
    expect(ESTADOS_ACTIVOS).toEqual(['ABIERTA', 'EN_REVISION']);
  });

  describe('TOMAR', () => {
    it('una abierta se toma', () => {
      expect(t('ABIERTA', 'TOMAR')).toEqual({ ok: true, estado: 'EN_REVISION' });
    });

    it('no se toma la que ya es tuya', () => {
      expect(t('EN_REVISION', 'TOMAR', { esDuenio: true, hayDuenio: true })).toMatchObject({ ok: false });
    });

    it('👤 no se le quita a otro… salvo el administrador', () => {
      expect(t('EN_REVISION', 'TOMAR', { hayDuenio: true })).toMatchObject({ ok: false, motivo: expect.stringMatching(/ya la tiene/) });
      expect(t('EN_REVISION', 'TOMAR', { hayDuenio: true, esAdmin: true })).toEqual({ ok: true, estado: 'EN_REVISION' });
    });

    it.each(['RESUELTA', 'DESCARTADA', 'AUTO_RESUELTA'] as const)('una %s no se toma: primero se reabre', (e) => {
      expect(t(e, 'TOMAR')).toMatchObject({ ok: false });
    });
  });

  describe('SOLTAR', () => {
    it('el dueño la suelta y vuelve a abierta', () => {
      expect(t('EN_REVISION', 'SOLTAR', { esDuenio: true, hayDuenio: true })).toEqual({ ok: true, estado: 'ABIERTA' });
    });

    it('el administrador también', () => {
      expect(t('EN_REVISION', 'SOLTAR', { esAdmin: true, hayDuenio: true })).toEqual({ ok: true, estado: 'ABIERTA' });
    });

    it('otro usuario no puede soltar la de un compañero', () => {
      expect(t('EN_REVISION', 'SOLTAR', { hayDuenio: true })).toMatchObject({ ok: false });
    });

    it('una abierta no se suelta (no es de nadie)', () => {
      expect(t('ABIERTA', 'SOLTAR')).toMatchObject({ ok: false });
    });
  });

  describe.each([
    ['RESOLVER', 'RESUELTA'],
    ['DESCARTAR', 'DESCARTADA'],
  ] as const)('%s → %s', (accion, final) => {
    const nota = 'Ya se registró la cita en ventanilla';

    it('una abierta se cierra con una nota', () => {
      expect(t('ABIERTA', accion, { nota })).toEqual({ ok: true, estado: final });
    });

    it('la nota es OBLIGATORIA (queda como constancia de qué se hizo)', () => {
      expect(t('ABIERTA', accion)).toMatchObject({ ok: false, motivo: expect.stringMatching(/nota/) });
      expect(t('ABIERTA', accion, { nota: '   ' })).toMatchObject({ ok: false });
      expect(t('ABIERTA', accion, { nota: 'ok' })).toMatchObject({ ok: false });
    });

    it('la del dueño la cierra el dueño', () => {
      expect(t('EN_REVISION', accion, { esDuenio: true, hayDuenio: true, nota })).toEqual({ ok: true, estado: final });
    });

    it('👤 la que tiene otro NO la cierra un tercero… salvo el administrador', () => {
      expect(t('EN_REVISION', accion, { hayDuenio: true, nota })).toMatchObject({ ok: false });
      expect(t('EN_REVISION', accion, { hayDuenio: true, esAdmin: true, nota })).toEqual({ ok: true, estado: final });
    });

    it.each(['RESUELTA', 'DESCARTADA', 'AUTO_RESUELTA'] as const)('una %s ya está cerrada', (e) => {
      expect(t(e, accion, { nota })).toMatchObject({ ok: false });
    });
  });

  describe('REABRIR', () => {
    it.each(['RESUELTA', 'DESCARTADA', 'AUTO_RESUELTA'] as const)('una %s vuelve a abierta', (e) => {
      expect(t(e, 'REABRIR')).toEqual({ ok: true, estado: 'ABIERTA' });
    });

    it.each(['ABIERTA', 'EN_REVISION'] as const)('una %s no se reabre (ya está activa)', (e) => {
      expect(t(e, 'REABRIR')).toMatchObject({ ok: false });
    });
  });

  it('una acción desconocida se rechaza', () => {
    expect(t('ABIERTA', 'BORRAR' as never)).toMatchObject({ ok: false });
  });

  // EN_REVISION sin dueño no puede pasar (el dueño existe si y solo si está en revisión),
  // pero si un dato llegara así no debe quedar trabado para todos menos el administrador.
  describe('🧟 EN_REVISION sin dueño (dato inconsistente): no queda trabada', () => {
    const nota = 'Ya se registró la cita en ventanilla';

    it('cualquiera con permiso de trabajar puede tomarla, soltarla o cerrarla', () => {
      expect(t('EN_REVISION', 'TOMAR', { hayDuenio: false })).toEqual({ ok: true, estado: 'EN_REVISION' });
      expect(t('EN_REVISION', 'SOLTAR', { hayDuenio: false })).toEqual({ ok: true, estado: 'ABIERTA' });
      expect(t('EN_REVISION', 'RESOLVER', { hayDuenio: false, nota })).toEqual({ ok: true, estado: 'RESUELTA' });
      expect(t('EN_REVISION', 'DESCARTAR', { hayDuenio: false, nota })).toEqual({ ok: true, estado: 'DESCARTADA' });
    });

    it('…pero cerrarla sigue exigiendo la nota', () => {
      expect(t('EN_REVISION', 'RESOLVER', { hayDuenio: false })).toMatchObject({ ok: false, motivo: expect.stringMatching(/nota/) });
    });

    it('con dueño, en cambio, sigue siendo de su dueño (la excepción no abre la puerta)', () => {
      expect(t('EN_REVISION', 'TOMAR', { hayDuenio: true })).toMatchObject({ ok: false });
      expect(t('EN_REVISION', 'SOLTAR', { hayDuenio: true })).toMatchObject({ ok: false });
      expect(t('EN_REVISION', 'RESOLVER', { hayDuenio: true, nota })).toMatchObject({ ok: false });
    });

    it('y no afecta a las abiertas ni a las cerradas', () => {
      expect(t('ABIERTA', 'SOLTAR', { hayDuenio: false })).toMatchObject({ ok: false });
      expect(t('RESUELTA', 'TOMAR', { hayDuenio: false })).toMatchObject({ ok: false });
    });
  });
});

// ─────────────────────────────────────────────────────────────
describe('parametrosPlantillaAviso — el texto que va a la plantilla de WhatsApp', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    doctor: 'Dr(a). Ana Ruiz',
    inicioIso: '2026-09-23T15:00:00.000Z',
    kind: 'CITA_NO_ENTREGADA' as const,
    severity: 'MEDIA' as const,
    ...over,
  });
  const ctx = { agenteSinSenal: false, hisAlcanzable: true as boolean | null, timeZone: 'America/Bogota' };

  it('son SIEMPRE tres variables, en orden: cantidad, la más próxima y la causa probable', () => {
    const p = parametrosPlantillaAviso([item()], ctx);
    expect(p).toHaveLength(3);
    expect(p[0]).toMatch(/1 cita/);
    expect(p[1]).toMatch(/Ana Ruiz/);
  });

  it('la hora de la más próxima va en la zona de la clínica, no en UTC', () => {
    const [, proxima] = parametrosPlantillaAviso([item({ inicioIso: '2026-09-23T15:00:00.000Z' })], ctx);
    // 15:00 UTC = 10:00 en Bogotá.
    expect(proxima).toMatch(/10:00/);
    expect(proxima).not.toMatch(/15:00/);
  });

  it('con varias, la cantidad va en plural y se nombra la MÁS PRÓXIMA', () => {
    const p = parametrosPlantillaAviso(
      [item({ doctor: 'Lejana', inicioIso: '2026-09-30T15:00:00.000Z' }), item({ doctor: 'Cercana', inicioIso: '2026-09-23T15:00:00.000Z' }), item({ doctor: 'Media', inicioIso: '2026-09-25T15:00:00.000Z' })],
      ctx,
    );
    expect(p[0]).toMatch(/3 citas/);
    expect(p[1]).toMatch(/Cercana/);
    expect(p[1]).not.toMatch(/Lejana/);
  });

  it.each([
    ['el agente no da señales', { agenteSinSenal: true, hisAlcanzable: true }, /no da señales/],
    ['el agente no alcanza el HIS', { agenteSinSenal: false, hisAlcanzable: false }, /no puede comunicarse/],
    ['el agente vive y el HIS responde', { agenteSinSenal: false, hisAlcanzable: true }, /fallando|rechaz|revis/i],
  ])('la causa probable cuando %s', (_n, extra, patron) => {
    expect(parametrosPlantillaAviso([item()], { ...ctx, ...extra })[2]).toMatch(patron);
  });

  it('la deriva contra el hospital se dice como tal', () => {
    const p = parametrosPlantillaAviso([item({ kind: 'DERIVA_EN_HIS', severity: 'ALTA' })], ctx);
    expect(p[2]).toMatch(/comparación|reconcili|no tiene/i);
  });

  it('🔒 nada de datos del paciente: ni nombre, ni documento, ni teléfono', () => {
    const todo = parametrosPlantillaAviso([item(), item({ kind: 'DERIVA_EN_HIS' })], ctx).join(' ');
    expect(todo).not.toMatch(/\d{6,}/); // ningún número largo (documento o teléfono)
    expect(todo).not.toMatch(/paciente/i);
  });

  it('cumple lo que Meta exige de una variable: una línea, sin saltos ni tabulaciones, y acotada', () => {
    const largo = 'x'.repeat(500);
    const p = parametrosPlantillaAviso([item({ doctor: `Dr\n${largo}\t` })], ctx);
    for (const v of p) {
      expect(v).not.toMatch(/[\n\r\t]/);
      expect(v).not.toMatch(/ {4,}/);
      expect(v.length).toBeLessThanOrEqual(200);
      expect(v.trim()).not.toBe('');
    }
  });

  it('🕐 un nombre de médico larguísimo se recorta y la HORA no se pierde', () => {
    const [, proxima] = parametrosPlantillaAviso([item({ doctor: `Dr(a). ${'Apellido '.repeat(80)}` })], ctx);
    expect(proxima.length).toBeLessThanOrEqual(200);
    // Lo que importa del aviso es cuándo: si el nombre se comiera la hora, no serviría.
    expect(proxima).toMatch(/10:00/);
    expect(proxima).toMatch(/…/);
  });

  it('sin elementos: no hay nada que decir (quien llama no debe enviar)', () => {
    expect(parametrosPlantillaAviso([], ctx)).toEqual([]);
  });
});
