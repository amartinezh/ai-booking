import {
  ALFABETO_CODIGO_VINCULACION,
  CATALOGO_ALERTAS,
  CATEGORIAS_ALERTA,
  DATO_OCULTO,
  GRAVEDADES_ALERTA,
  ORDEN_GRAVEDAD_ALERTA,
  TEXTO_CATEGORIA_ALERTA,
  TIPOS_ALERTA,
  UMBRALES_ALERTAS,
  alertaDeIncidente,
  arranqueEnBucle,
  baseDelPanel,
  categoriaDeServicio,
  claveAlerta,
  codigoVinculacion,
  codigoVinculacionVigente,
  cupoDeEnvio,
  decidirIntermitencia,
  duracionLegible,
  enlacePanel,
  esIntermitente,
  estaSilenciado,
  eventoRepetido,
  extraerCodigoVinculacion,
  finDelSilencio,
  gravedadDeAlerta,
  gravedadDeRafaga5xx,
  incidenteDebeAvisar,
  leerCategorias,
  loteDeRecordatoriosCaido,
  motivoParaNoEnviar,
  normalizarConfigAlertas,
  normalizarRuta,
  OPCIONES_SILENCIO,
  proximaHoraLocal,
  sanitizarTextoAlerta,
  siguienteAccion,
  sinSonido,
  textoAviso,
  textoAvisoAgrupado,
  textoExcedente,
  textoIntermitente,
  textoPrueba,
  textoRecordatorio,
  textoResolucion,
  textoResumenDiario,
  textoVinculado,
  TEXTO_OPCION_SILENCIO,
  tocaResumenDiario,
  ventanaResumenDiario,
  type AlertaVista,
  type DatosMensajeAlerta,
} from './alertas-tecnicas';
import {
  formatAppointmentCompact,
  formatDateShort,
  formatTimeOnly,
} from './date-format';

// ══════════════════════════════════════════════════════════════════════════
// Alertas técnicas por Telegram (docs/PLAN_ALERTAS_TECNICAS.md, Fase 0).
// Lógica PURA: la API la usa para decidir y armar cada mensaje, la web para
// configurar y mostrar. Lo que más importa probar: que ningún dato de pacientes
// llega a Telegram y que el grupo no recibe ruido.
// ══════════════════════════════════════════════════════════════════════════

/** Lunes 19-oct-2026, 10:38 en Bogotá (UTC-5). Con segundos: las horas redondas esconden defectos. */
const AHORA = '2026-10-19T15:38:41.512Z';
const MIN = 60_000;
const hace = (min: number) =>
  new Date(Date.parse(AHORA) - min * MIN).toISOString();
const en = (min: number) =>
  new Date(Date.parse(AHORA) + min * MIN).toISOString();

const ORG = '97f18182-d0d9-4a3b-9eb6-4fbc031b917c';
const CEDULA = '1088123456';
const TELEFONO = '+57 300 111 2233';
const CORREO = 'ana.perez@gmail.com';
const BSUID = 'CO.13491208655302741918';
const TOKEN_BOT = '7234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

describe('vocabulario y catálogo', () => {
  it('cada tipo tiene su definición, con una categoría y una gravedad que existen', () => {
    for (const tipo of TIPOS_ALERTA) {
      const def = CATALOGO_ALERTAS[tipo];
      expect(CATEGORIAS_ALERTA).toContain(def.categoria);
      expect(GRAVEDADES_ALERTA).toContain(def.gravedad);
      expect(def.titulo.length).toBeGreaterThan(0);
      expect(def.titulo.length).toBeLessThanOrEqual(UMBRALES_ALERTAS.maxTitulo);
    }
    expect(Object.keys(CATALOGO_ALERTAS).sort()).toEqual(
      [...TIPOS_ALERTA].sort(),
    );
  });

  it('cada categoría tiene su texto para el panel', () => {
    for (const c of CATEGORIAS_ALERTA) {
      expect(TEXTO_CATEGORIA_ALERTA[c].titulo).toBeTruthy();
      expect(TEXTO_CATEGORIA_ALERTA[c].descripcion).toBeTruthy();
    }
  });

  it('la gravedad crece INFO < ADVERTENCIA < CRITICA', () => {
    expect(ORDEN_GRAVEDAD_ALERTA.INFO).toBeLessThan(
      ORDEN_GRAVEDAD_ALERTA.ADVERTENCIA,
    );
    expect(ORDEN_GRAVEDAD_ALERTA.ADVERTENCIA).toBeLessThan(
      ORDEN_GRAVEDAD_ALERTA.CRITICA,
    );
  });

  it('los eventos sueltos son los que no tienen «resuelto»', () => {
    const eventos = TIPOS_ALERTA.filter(
      (t) => CATALOGO_ALERTAS[t].evento,
    ).sort();
    expect(eventos).toEqual(
      [
        'API_ARRANCO',
        'ERROR_5XX',
        'ESQUEMA_ESPEJO',
        'PROCESO_EXCEPCION',
        'REINICIOS_EN_BUCLE',
        'SOPORTE_CODIGOS_FALLIDOS',
        'SOPORTE_TOPE_IA',
      ].sort(),
    );
  });
});

describe('sanitizarTextoAlerta — nada de pacientes hacia Telegram', () => {
  it.each([
    [
      'cédula',
      `Paciente ${CEDULA} sin régimen`,
      `Paciente ${DATO_OCULTO} sin régimen`,
    ],
    [
      'cédula con puntos',
      'doc 1.088.123.456 rechazado',
      `doc ${DATO_OCULTO} rechazado`,
    ],
    [
      'teléfono con espacios',
      `envío a ${TELEFONO} falló`,
      `envío a ${DATO_OCULTO} falló`,
    ],
    ['teléfono con guiones', 'tel 300-111-2233', `tel ${DATO_OCULTO}`],
    ['BSUID', `remitente ${BSUID}`, `remitente CO.${DATO_OCULTO}`],
    [
      'chat de Telegram',
      'chat tg:123456789 bloqueó',
      `chat tg:${DATO_OCULTO} bloqueó`,
    ],
    ['correo', `aviso a ${CORREO} rebotó`, `aviso a ${DATO_OCULTO} rebotó`],
    [
      'token de bot',
      `token ${TOKEN_BOT}`,
      `token ${DATO_OCULTO}:${DATO_OCULTO}`,
    ],
    [
      'JWT',
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2Nzg5',
      `Bearer ${DATO_OCULTO}.${DATO_OCULTO}.${DATO_OCULTO}`,
    ],
    [
      'un número largo con una fecha adentro',
      'ref 12025-10-19 inválida',
      `ref ${DATO_OCULTO} inválida`,
    ],
  ])('tapa %s', (_caso, entrada, esperado) => {
    expect(sanitizarTextoAlerta(entrada)).toBe(esperado);
  });

  it('respeta lo que el equipo necesita: UUID, fechas ISO, horas y cifras cortas', () => {
    const real = `Sin heartbeat del agente hace 34 min (org ${ORG}).`;
    expect(sanitizarTextoAlerta(real)).toBe(real);
    expect(
      sanitizarTextoAlerta('Latencia 3598ms supera el umbral de 3000ms.'),
    ).toBe('Latencia 3598ms supera el umbral de 3000ms.');
    expect(
      sanitizarTextoAlerta(
        'desde 2026-10-19T15:38:00.000Z y 2026-10-18 a las 10:38',
      ),
    ).toBe('desde 2026-10-19T15:38:00.000Z y 2026-10-18 a las 10:38');
    expect(
      sanitizarTextoAlerta(
        'HTTP 500 en trg_sync_outbox_schedule_slot_appointment',
      ),
    ).toBe('HTTP 500 en trg_sync_outbox_schedule_slot_appointment');
  });

  it('respeta las IP privadas y de loopback (servidores nuestros), con su puerto', () => {
    for (const ip of [
      '127.0.0.1:6379',
      '10.0.0.5:1433',
      '192.168.40.2',
      '172.18.0.3:5432',
    ]) {
      expect(sanitizarTextoAlerta(`connect ECONNREFUSED ${ip}`)).toBe(
        `connect ECONNREFUSED ${ip}`,
      );
    }
  });

  it('pero no las públicas, ni un documento que parezca una IP', () => {
    expect(sanitizarTextoAlerta('desde 186.87.28.46')).toBe(
      `desde ${DATO_OCULTO}`,
    );
    expect(sanitizarTextoAlerta('doc 1.100.200.100')).toBe(
      `doc ${DATO_OCULTO}`,
    );
    expect(sanitizarTextoAlerta('172.15.0.3')).toBe(DATO_OCULTO);
  });

  it('devuelve cada UUID y cada fecha a su sitio, aunque haya varios', () => {
    const otra = '0b8e2c55-1f3a-4c1e-9d7a-2a6b5c4d3e2f';
    const texto = `org ${ORG} y ${otra}, ${CEDULA}, el 2026-10-18 y el 2026-10-19`;
    expect(sanitizarTextoAlerta(texto)).toBe(
      `org ${ORG} y ${otra}, ${DATO_OCULTO}, el 2026-10-18 y el 2026-10-19`,
    );
  });

  it('normaliza espacios, saltos y caracteres de control', () => {
    expect(sanitizarTextoAlerta('\tUno   dos\r\n\n\n\n tres ')).toBe(
      'Uno dos\n\ntres',
    );
    // Un marcador falsificado no puede colarse: los caracteres de control se quitan antes.
    expect(sanitizarTextoAlerta('a\u0000\u0001\u0000b')).toBe('ab');
  });

  it('recorta con «…» al máximo pedido', () => {
    const largo = sanitizarTextoAlerta('x '.repeat(500));
    expect(largo.length).toBe(UMBRALES_ALERTAS.maxDetalle);
    expect(largo.endsWith('…')).toBe(true);
    expect(sanitizarTextoAlerta('abcdefghij', 5)).toBe('abcd…');
  });

  it('nada entra, nada sale', () => {
    expect(sanitizarTextoAlerta(null)).toBe('');
    expect(sanitizarTextoAlerta(undefined)).toBe('');
    expect(sanitizarTextoAlerta('')).toBe('');
  });
});

describe('normalizarRuta y claveAlerta — una firma por problema, no por cita', () => {
  it.each([
    [`/appointments/${ORG}/cancel?motivo=x#y`, '/appointments/:id/cancel'],
    [`/patients/${CEDULA}`, '/patients/:id'],
    [`/patients/${BSUID}`, '/patients/:id'],
    ['/eps/123', '/eps/:id'],
    ['/users/ana@x.co', '/users/:id'],
    ['/users/ana%40x.co', '/users/:id'],
    ['/blobs/deadbeefcafebabe', '/blobs/:id'],
    ['/telegram/webhook/Ab3_dEf-ghIjkLmNoPqRsT', '/telegram/webhook/:id'],
    ['/api/v1/chatbot/webhook', '/api/v1/chatbot/webhook'],
    ['', '/'],
    ['?a=1', '/'],
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizarRuta(entrada)).toBe(esperado);
  });

  it('una ruta enorme no pasa de 120 caracteres', () => {
    const r = normalizarRuta(`/${'segmento/'.repeat(30)}`);
    expect(r.length).toBe(120);
    expect(r.endsWith('…')).toBe(true);
  });

  it('cada clave dice qué problema es, sin datos', () => {
    expect(claveAlerta.servicio('mirror')).toBe('servicio:mirror');
    expect(claveAlerta.cron('retencion')).toBe('cron:retencion');
    expect(claveAlerta.recordatorios()).toBe('cron:recordatorios:lote');
    expect(claveAlerta.avisoAgendador(ORG)).toBe(
      `espejo:aviso-agendador:${ORG}`,
    );
    expect(claveAlerta.redis()).toBe('servicio:redis');
    expect(
      claveAlerta.error5xx(
        500,
        'get',
        `/appointments/${ORG}?x=1`,
        'PrismaClientKnownRequestError',
      ),
    ).toBe('5xx:500:GET:/appointments/:id:PrismaClientKnownRequestError');
    expect(claveAlerta.proceso('unhandledRejection', 'TypeError')).toBe(
      'proceso:unhandledRejection:TypeError',
    );
    expect(claveAlerta.arranque()).toBe('api:arranque');
    expect(claveAlerta.reiniciosEnBucle()).toBe('api:reinicios');
    expect(claveAlerta.esquemaEspejo()).toBe('espejo:esquema');
    expect(claveAlerta.soporteSinIa('org-1')).toBe('soporte:sin-ia:org-1');
    expect(claveAlerta.soporteTopeIa('org-1', '2026-10-20')).toBe(
      'soporte:tope-ia:org-1:2026-10-20',
    );
    expect(claveAlerta.soporteCodigosFallidos(2_934_000)).toBe(
      'soporte:codigos-fallidos:2934000',
    );
  });

  it('dos citas distintas con el mismo error dan la MISMA firma', () => {
    const a = claveAlerta.error5xx(
      500,
      'POST',
      `/appointments/${ORG}/cancel`,
      'Error',
    );
    const b = claveAlerta.error5xx(
      500,
      'POST',
      '/appointments/0b8e2c55-1f3a-4c1e-9d7a-2a6b5c4d3e2f/cancel',
      'Error',
    );
    expect(a).toBe(b);
  });
});

describe('del monitor a una alerta', () => {
  it('el espejo tiene categoría propia', () => {
    expect(categoriaDeServicio('mirror')).toBe('ESPEJO');
    expect(categoriaDeServicio('gemini')).toBe('SERVICIOS');
    expect(categoriaDeServicio('telegram')).toBe('SERVICIOS');
    expect(categoriaDeServicio('soporte')).toBe('ASISTENTE_SOPORTE');
  });

  it('una caída avisa al primer chequeo; la latencia alta, solo si se repite (12-oct)', () => {
    expect(
      incidenteDebeAvisar({ status: 'DOWN', errorCode: 'TIMEOUT' }, 1),
    ).toBe(true);
    expect(
      incidenteDebeAvisar({ status: 'DEGRADED', errorCode: 'HIGH_LATENCY' }, 1),
    ).toBe(false);
    expect(
      incidenteDebeAvisar({ status: 'DEGRADED', errorCode: 'HIGH_LATENCY' }, 2),
    ).toBe(true);
    expect(
      incidenteDebeAvisar(
        { status: 'DEGRADED', errorCode: 'MIRROR_UNHEALTHY' },
        1,
      ),
    ).toBe(true);
    expect(incidenteDebeAvisar({ status: 'DEGRADED' }, 1)).toBe(true);
  });

  it('un espejo caído es una alerta crítica del espejo, con el detalle sanitizado', () => {
    expect(
      alertaDeIncidente({
        serviceKey: 'mirror',
        displayName: 'Espejo con el HIS',
        status: 'DOWN',
        errorMessage: `Sin heartbeat del agente hace 34 min (org ${ORG}). Paciente ${CEDULA}`,
      }),
    ).toEqual({
      kind: 'SERVICIO_CAIDO',
      category: 'ESPEJO',
      severity: 'CRITICA',
      dedupeKey: 'servicio:mirror',
      title: 'Espejo con el HIS',
      detail: `Sin heartbeat del agente hace 34 min (org ${ORG}). Paciente ${DATO_OCULTO}`,
    });
  });

  it('caído y degradado del mismo servicio son el MISMO problema (misma clave)', () => {
    const degradado = alertaDeIncidente({
      serviceKey: 'gemini',
      displayName: 'Gemini AI',
      status: 'DEGRADED',
      errorMessage: null,
    });
    expect(degradado).toMatchObject({
      kind: 'SERVICIO_DEGRADADO',
      category: 'SERVICIOS',
      severity: 'ADVERTENCIA',
      detail: '',
    });
    const caido = alertaDeIncidente({
      serviceKey: 'gemini',
      displayName: 'Gemini AI',
      status: 'DOWN',
    });
    expect(caido.dedupeKey).toBe(degradado.dedupeKey);
  });

  it('una tarea que falla tres veces seguidas se vuelve crítica', () => {
    expect(gravedadDeAlerta('CRON_FALLO', 1)).toBe('ADVERTENCIA');
    expect(gravedadDeAlerta('CRON_FALLO', 2)).toBe('ADVERTENCIA');
    expect(gravedadDeAlerta('CRON_FALLO', 3)).toBe('CRITICA');
    // Con la hora de apertura: además, 10 minutos fallando.
    expect(
      gravedadDeAlerta('CRON_FALLO', 73, {
        desdeIso: hace(9),
        ahoraIso: AHORA,
      }),
    ).toBe('ADVERTENCIA');
    expect(
      gravedadDeAlerta('CRON_FALLO', 3, {
        desdeIso: hace(10),
        ahoraIso: AHORA,
      }),
    ).toBe('CRITICA');
    expect(
      gravedadDeAlerta('CRON_FALLO', 2, {
        desdeIso: hace(600),
        ahoraIso: AHORA,
      }),
    ).toBe('ADVERTENCIA');
    expect(gravedadDeAlerta('SERVICIO_CAIDO', 1)).toBe('CRITICA');
    expect(gravedadDeAlerta('API_ARRANCO', 9)).toBe('INFO');
  });

  it('un lote de recordatorios cuenta como caída solo si no salió ninguno y fallaron varios', () => {
    expect(loteDeRecordatoriosCaido({ sent: 0, failed: 3 })).toBe(true);
    expect(loteDeRecordatoriosCaido({ sent: 0, failed: 2 })).toBe(false);
    expect(loteDeRecordatoriosCaido({ sent: 1, failed: 30 })).toBe(false);
    expect(loteDeRecordatoriosCaido({ sent: 0, failed: 0 })).toBe(false);
  });

  it('una ráfaga de 5xx es crítica', () => {
    expect(gravedadDeRafaga5xx(1)).toBe('ADVERTENCIA');
    expect(gravedadDeRafaga5xx(19)).toBe('ADVERTENCIA');
    expect(gravedadDeRafaga5xx(20)).toBe('CRITICA');
  });

  it('dos arranques en 10 minutos son un bucle de reinicios', () => {
    expect(arranqueEnBucle([], AHORA)).toBe(false);
    expect(arranqueEnBucle([hace(9)], AHORA)).toBe(true);
    expect(arranqueEnBucle([hace(11)], AHORA)).toBe(false);
    expect(arranqueEnBucle(['no es fecha', en(1)], AHORA)).toBe(false);
  });
});

describe('configuración', () => {
  it('una categoría que no aparece, o que no es booleana, está encendida (A6)', () => {
    const todas = Object.fromEntries(CATEGORIAS_ALERTA.map((c) => [c, true]));
    expect(leerCategorias(null)).toEqual(todas);
    expect(leerCategorias(['ERRORES'])).toEqual(todas);
    expect(leerCategorias({ ERRORES: 'no' })).toEqual(todas);
    expect(leerCategorias({ ERRORES: false, OTRA: false })).toEqual({
      ...todas,
      ERRORES: false,
    });
  });

  it('sin nada, los valores de por defecto (A7)', () => {
    expect(normalizarConfigAlertas({})).toEqual({
      reminderMinutes: 60,
      maxReminders: 3,
      quietHoursEnabled: true,
      quietFromHour: 22,
      quietToHour: 6,
      categories: leerCategorias(null),
    });
  });

  it('lo imposible cae dentro de los límites, nunca rompe', () => {
    expect(
      normalizarConfigAlertas({
        reminderMinutes: 5,
        maxReminders: -1,
        quietHoursEnabled: false,
        quietFromHour: 25,
        quietToHour: 6.6,
      }),
    ).toMatchObject({
      reminderMinutes: 15,
      maxReminders: 0,
      quietHoursEnabled: false,
      quietFromHour: 23,
      quietToHour: 7,
    });
    expect(
      normalizarConfigAlertas({ reminderMinutes: 5000, maxReminders: 99 }),
    ).toMatchObject({
      reminderMinutes: 1440,
      maxReminders: 10,
    });
    expect(
      normalizarConfigAlertas({ reminderMinutes: '30', maxReminders: 'abc' }),
    ).toMatchObject({
      reminderMinutes: 30,
      maxReminders: 3,
    });
  });

  it('dice por qué no se envía: apagado, categoría apagada o silencio', () => {
    const base = {
      enabled: true,
      categories: leerCategorias(null),
      mutedUntilIso: null,
    };
    expect(motivoParaNoEnviar('ESPEJO', base, AHORA)).toBeNull();
    expect(
      motivoParaNoEnviar('ESPEJO', { ...base, enabled: false }, AHORA),
    ).toBe('APAGADO');
    expect(
      motivoParaNoEnviar(
        'ESPEJO',
        { ...base, categories: leerCategorias({ ESPEJO: false }) },
        AHORA,
      ),
    ).toBe('CATEGORIA_APAGADA');
    expect(
      motivoParaNoEnviar('ESPEJO', { ...base, mutedUntilIso: en(60) }, AHORA),
    ).toBe('SILENCIADO');
    expect(
      motivoParaNoEnviar('ESPEJO', { ...base, mutedUntilIso: hace(1) }, AHORA),
    ).toBeNull();
  });

  it('el silencio vale solo hasta su hora', () => {
    expect(estaSilenciado(null, AHORA)).toBe(false);
    expect(estaSilenciado('mañana', AHORA)).toBe(false);
    expect(estaSilenciado(en(1), AHORA)).toBe(true);
    expect(estaSilenciado(AHORA, AHORA)).toBe(false);
  });
});

describe('siguienteAccion — un mensaje por problema', () => {
  const cfg = { reminderMinutes: 60, maxReminders: 3 };
  const abierta = (extra: Partial<AlertaVista> = {}): AlertaVista => ({
    kind: 'SERVICIO_CAIDO',
    severity: 'CRITICA',
    status: 'ABIERTA',
    notifiedAtIso: null,
    notifiedSeverity: null,
    resolvedAtIso: null,
    resolutionNotifiedAtIso: null,
    reminderCount: 0,
    lastReminderAtIso: null,
    ...extra,
  });

  it('un problema nuevo se avisa', () => {
    expect(siguienteAccion(abierta(), cfg, AHORA)).toBe('AVISO');
  });

  it('ya avisado y con la misma gravedad, no se repite antes del recordatorio', () => {
    const a = abierta({ notifiedAtIso: hace(59), notifiedSeverity: 'CRITICA' });
    expect(siguienteAccion(a, cfg, AHORA)).toBeNull();
  });

  it('si empeora (sube la gravedad), se avisa de nuevo', () => {
    const a = abierta({
      notifiedAtIso: hace(5),
      notifiedSeverity: 'ADVERTENCIA',
    });
    expect(siguienteAccion(a, cfg, AHORA)).toBe('AVISO');
    // Una gravedad guardada que no se reconoce cuenta como nunca avisada.
    expect(
      siguienteAccion(
        abierta({ notifiedAtIso: hace(5), notifiedSeverity: 'X' }),
        cfg,
        AHORA,
      ),
    ).toBe('AVISO');
  });

  it('si baja la gravedad, no se avisa (no es una novedad que despierte a nadie)', () => {
    const a = abierta({
      severity: 'ADVERTENCIA',
      notifiedAtIso: hace(5),
      notifiedSeverity: 'CRITICA',
    });
    expect(siguienteAccion(a, cfg, AHORA)).toBeNull();
  });

  it('se recuerda cada reminderMinutes, contando desde el último recordatorio', () => {
    expect(
      siguienteAccion(
        abierta({ notifiedAtIso: hace(60), notifiedSeverity: 'CRITICA' }),
        cfg,
        AHORA,
      ),
    ).toBe('RECORDATORIO');
    expect(
      siguienteAccion(
        abierta({
          notifiedAtIso: hace(200),
          notifiedSeverity: 'CRITICA',
          reminderCount: 1,
          lastReminderAtIso: hace(30),
        }),
        cfg,
        AHORA,
      ),
    ).toBeNull();
  });

  it('hasta maxReminders, y nunca de una INFO', () => {
    expect(
      siguienteAccion(
        abierta({
          notifiedAtIso: hace(500),
          notifiedSeverity: 'CRITICA',
          reminderCount: 3,
        }),
        cfg,
        AHORA,
      ),
    ).toBeNull();
    expect(
      siguienteAccion(
        abierta({
          severity: 'INFO',
          notifiedAtIso: hace(500),
          notifiedSeverity: 'INFO',
        }),
        cfg,
        AHORA,
      ),
    ).toBeNull();
  });

  it('una fecha de aviso ilegible no dispara recordatorios', () => {
    expect(
      siguienteAccion(
        abierta({ notifiedAtIso: 'ayer', notifiedSeverity: 'CRITICA' }),
        cfg,
        AHORA,
      ),
    ).toBeNull();
  });

  it('un evento suelto se avisa una sola vez', () => {
    expect(
      siguienteAccion(
        abierta({ kind: 'ERROR_5XX', status: 'EVENTO' }),
        cfg,
        AHORA,
      ),
    ).toBe('AVISO');
    expect(
      siguienteAccion(
        abierta({
          kind: 'ERROR_5XX',
          status: 'EVENTO',
          notifiedAtIso: hace(1),
        }),
        cfg,
        AHORA,
      ),
    ).toBeNull();
  });

  it('el «resuelto» sale solo si antes se avisó, y una vez', () => {
    const resuelta = abierta({ status: 'RESUELTA', resolvedAtIso: hace(1) });
    expect(
      siguienteAccion({ ...resuelta, notifiedAtIso: hace(10) }, cfg, AHORA),
    ).toBe('RESOLUCION');
    // Se resolvió antes de avisar (parpadeo, silencio, Telegram caído): no se anuncia.
    expect(siguienteAccion(resuelta, cfg, AHORA)).toBeNull();
    expect(
      siguienteAccion(
        {
          ...resuelta,
          notifiedAtIso: hace(10),
          resolutionNotifiedAtIso: hace(1),
        },
        cfg,
        AHORA,
      ),
    ).toBeNull();
  });
});

describe('antirruido', () => {
  it('intermitente: más de 3 aperturas en 30 minutos', () => {
    expect(esIntermitente([hace(1), hace(5), hace(10), hace(29)], AHORA)).toBe(
      true,
    );
    expect(esIntermitente([hace(1), hace(5), hace(10)], AHORA)).toBe(false);
    expect(esIntermitente([hace(1), hace(5), hace(10), hace(31)], AHORA)).toBe(
      false,
    );
  });

  it('tope general: 20 mensajes cada 10 minutos', () => {
    expect(cupoDeEnvio([], AHORA)).toBe(20);
    expect(
      cupoDeEnvio(
        Array.from({ length: 5 }, (_, i) => hace(i)),
        AHORA,
      ),
    ).toBe(15);
    expect(
      cupoDeEnvio(
        Array.from({ length: 25 }, () => hace(1)),
        AHORA,
      ),
    ).toBe(0);
    expect(cupoDeEnvio([hace(11), hace(30)], AHORA)).toBe(20);
  });

  it('la misma firma de un evento se avisa una vez por hora', () => {
    expect(eventoRepetido(null, AHORA)).toBe(false);
    expect(eventoRepetido(hace(30), AHORA)).toBe(true);
    expect(eventoRepetido(hace(61), AHORA)).toBe(false);
  });

  describe('sinSonido (A7)', () => {
    const noche = {
      quietHoursEnabled: true,
      quietFromHour: 22,
      quietToHour: 6,
    };
    // En Bogotá: 23:00 = 04:00Z del día siguiente; 05:59 = 10:59Z; 06:00 = 11:00Z.
    it.each([
      ['INFO a mediodía', 'INFO', '2026-10-19T17:00:00Z', true],
      ['CRÍTICA de noche', 'CRITICA', '2026-10-20T04:00:00Z', false],
      ['ADVERTENCIA a las 23:00', 'ADVERTENCIA', '2026-10-20T04:00:00Z', true],
      ['ADVERTENCIA a las 05:59', 'ADVERTENCIA', '2026-10-19T10:59:00Z', true],
      ['ADVERTENCIA a las 06:00', 'ADVERTENCIA', '2026-10-19T11:00:00Z', false],
      ['ADVERTENCIA a mediodía', 'ADVERTENCIA', '2026-10-19T17:00:00Z', false],
    ] as const)('%s', (_caso, gravedad, iso, esperado) => {
      expect(sinSonido(gravedad, iso, noche)).toBe(esperado);
    });

    it('con el horario apagado, o vacío, la advertencia suena', () => {
      const tarde = '2026-10-20T04:00:00Z';
      expect(
        sinSonido('ADVERTENCIA', tarde, { ...noche, quietHoursEnabled: false }),
      ).toBe(false);
      expect(
        sinSonido('ADVERTENCIA', tarde, {
          ...noche,
          quietFromHour: 6,
          quietToHour: 6,
        }),
      ).toBe(false);
    });

    it('un horario que no cruza la medianoche, y la hora en la zona pedida', () => {
      const madrugada = {
        quietHoursEnabled: true,
        quietFromHour: 1,
        quietToHour: 5,
      };
      expect(
        sinSonido('ADVERTENCIA', new Date('2026-10-19T08:00:00Z'), madrugada),
      ).toBe(true);
      expect(
        sinSonido('ADVERTENCIA', new Date('2026-10-19T11:00:00Z'), madrugada),
      ).toBe(false);
      // Las 08:00Z son las 3 de la madrugada en Bogotá, pero las 8 en UTC.
      expect(
        sinSonido('ADVERTENCIA', '2026-10-19T08:00:00Z', madrugada, 'UTC'),
      ).toBe(false);
    });
  });
});

describe('vinculación del grupo', () => {
  it('el código sale del alfabeto sin caracteres que se confunden', () => {
    expect(codigoVinculacion(Uint8Array.from([0, 1, 2, 3, 4, 5]))).toBe(
      '234567',
    );
    const n = ALFABETO_CODIGO_VINCULACION.length;
    const codigo = codigoVinculacion(
      Uint8Array.from([n, 255, 200, 17, 99, 7, 8, 9]),
    );
    expect(codigo).toHaveLength(UMBRALES_ALERTAS.codigoVinculacion.largo);
    expect(codigo[0]).toBe('2');
    expect(
      [...codigo].every((c) => ALFABETO_CODIGO_VINCULACION.includes(c)),
    ).toBe(true);
    expect(ALFABETO_CODIGO_VINCULACION).not.toMatch(/[01OIL]/);
  });

  it('sin bytes suficientes no inventa un código', () => {
    expect(() => codigoVinculacion(Uint8Array.from([1, 2]))).toThrow();
  });

  it.each([
    ['/vincular 4f7k2q', '4F7K2Q'],
    ['/vincular@AgeniaTecnicoBot 4F7K2Q', '4F7K2Q'],
    ['  /VINCULAR abcd  ', 'ABCD'],
    ['hola', null],
    ['/vincular', null],
    ['/vincular 4F7K2Q y algo más', null],
    [null, null],
  ])('«%s» → %s', (texto, esperado) => {
    expect(extraerCodigoVinculacion(texto)).toBe(esperado);
  });

  it('el código vence', () => {
    expect(codigoVinculacionVigente(null, AHORA)).toBe(false);
    expect(codigoVinculacionVigente('pronto', AHORA)).toBe(false);
    expect(codigoVinculacionVigente(en(15), AHORA)).toBe(true);
    expect(codigoVinculacionVigente(hace(1), AHORA)).toBe(false);
  });
});

describe('enlaces al panel', () => {
  it('usa la URL del panel, o la pública de la API sin /api', () => {
    expect(baseDelPanel('https://panel.agenia.co/', null)).toBe(
      'https://panel.agenia.co',
    );
    expect(baseDelPanel(null, 'https://app.hsvpanserma.agenia.co/api')).toBe(
      'https://app.hsvpanserma.agenia.co',
    );
    expect(baseDelPanel('no es url', 'https://app.x.co/api/')).toBe(
      'https://app.x.co',
    );
    expect(baseDelPanel('  ', 'ftp://x.co')).toBeNull();
    expect(baseDelPanel(undefined, undefined)).toBeNull();
  });

  it('sin base no hay enlace (el mensaje sale igual)', () => {
    expect(enlacePanel('https://x.co', '/super-admin/monitor')).toBe(
      'https://x.co/super-admin/monitor',
    );
    expect(enlacePanel('https://x.co', 'super-admin/alertas')).toBe(
      'https://x.co/super-admin/alertas',
    );
    expect(enlacePanel(null, '/super-admin/monitor')).toBeNull();
  });
});

describe('textos', () => {
  const ENLACE = 'https://app.hsvpanserma.agenia.co/super-admin/monitor';
  const espejo: DatosMensajeAlerta = {
    kind: 'SERVICIO_CAIDO',
    severity: 'CRITICA',
    title: 'Espejo con el HIS',
    detail: `Sin heartbeat del agente hace 7 min (org ${ORG}).`,
    organizationName: 'E.S.E. Hospital San Vicente de Paúl',
    firstSeenIso: AHORA,
    fuente: 'centinela del monitor',
    enlace: ENLACE,
  };

  it.each([
    [0, 'menos de 1 min'],
    [-5 * MIN, 'menos de 1 min'],
    [6 * MIN + 59_000, '6 min'],
    [60 * MIN, '1 h'],
    [80 * MIN, '1 h 20 min'],
    [24 * 60 * MIN, '1 d'],
    [51 * 60 * MIN, '2 d 3 h'],
  ])('duracionLegible(%d) → %s', (ms, esperado) => {
    expect(duracionLegible(ms)).toBe(esperado);
  });

  it('el aviso dice qué, dónde, desde cuándo, quién lo vio y el enlace', () => {
    expect(textoAviso(espejo).split('\n')).toEqual([
      '🔴 CRÍTICA · Servicio caído',
      'Espejo con el HIS',
      'Clínica: E.S.E. Hospital San Vicente de Paúl',
      `Qué pasa: Sin heartbeat del agente hace 7 min (org ${ORG}).`,
      `Desde: ${formatAppointmentCompact(AHORA)} (hora Colombia)`,
      'Detectado por: centinela del monitor',
      `Ver: ${ENLACE}`,
    ]);
  });

  it('la hora es la de Bogotá, no la del contenedor', () => {
    expect(textoAviso(espejo)).toContain('10:38');
  });

  it('empeoró, repeticiones, otra zona y lo que falta no se inventa', () => {
    const texto = textoAviso(
      {
        kind: 'CRON_FALLO',
        severity: 'CRITICA',
        title: 'Recordatorios',
        firstSeenIso: AHORA,
        occurrences: 3,
        organizationName: '  ',
      },
      { empeoro: true, timeZone: 'Europe/Madrid' },
    );
    expect(texto.split('\n')).toEqual([
      '🔴 CRÍTICA · Una tarea programada falló (empeoró)',
      'Recordatorios',
      `Desde: ${formatAppointmentCompact(AHORA, { timeZone: 'Europe/Madrid' })} (Europe/Madrid)`,
      'Repeticiones: 3',
    ]);
    expect(textoAviso({ ...espejo, occurrences: 1 })).not.toContain(
      'Repeticiones',
    );
  });

  it('el recordatorio dice cuál es y cuánto lleva', () => {
    const texto = textoRecordatorio(
      { ...espejo, firstSeenIso: hace(65) },
      { numero: 1, de: 3, ahoraIso: AHORA },
    );
    expect(texto.split('\n')[0]).toBe(
      '⏰ RECORDATORIO 1 de 3 · 🔴 CRÍTICA · Servicio caído',
    );
    expect(texto).toContain('Sigue sin resolverse desde hace 1 h 5 min.');
    expect(texto).toContain(`Ver: ${ENLACE}`);
  });

  it('el «resuelto» dice cuánto duró, con horas si fue el mismo día', () => {
    const resuelto = en(6);
    expect(textoResolucion(espejo, resuelto).split('\n')).toEqual([
      '✅ RESUELTO · Servicio caído',
      'Espejo con el HIS',
      'Clínica: E.S.E. Hospital San Vicente de Paúl',
      `Duró 6 min (${formatTimeOnly(AHORA)} → ${formatTimeOnly(resuelto)}, hora Colombia).`,
    ]);
  });

  it('si cruzó la medianoche EN BOGOTÁ, lleva las dos fechas (aunque en UTC sea el mismo día)', () => {
    const desde = '2026-10-19T04:30:00Z'; // 23:30 del 18-oct en Bogotá
    const hasta = '2026-10-19T05:30:00Z'; // 00:30 del 19-oct
    expect(formatDateShort(desde)).not.toBe(formatDateShort(hasta));
    const texto = textoResolucion(
      {
        kind: 'REDIS_ERROR',
        title: '',
        organizationName: null,
        firstSeenIso: desde,
      },
      hasta,
    );
    expect(texto.split('\n')).toEqual([
      '✅ RESUELTO · Redis no responde',
      `Duró 1 h (${formatAppointmentCompact(desde)} → ${formatAppointmentCompact(hasta)}, hora Colombia).`,
    ]);
  });

  it('varios problemas de la misma vuelta van en UN mensaje, encabezado por el peor', () => {
    const gemini: DatosMensajeAlerta = {
      kind: 'SERVICIO_DEGRADADO',
      severity: 'ADVERTENCIA',
      title: 'Gemini AI',
      detail: 'Latencia 4096ms supera el umbral de 3000ms.',
      firstSeenIso: AHORA,
    };
    const meta: DatosMensajeAlerta = {
      ...gemini,
      title: 'Meta WhatsApp Cloud API',
      detail: null,
    };
    expect(textoAvisoAgrupado([gemini, meta]).split('\n')).toEqual([
      '🟠 2 alertas nuevas',
      '• 🟠 Servicio degradado · Gemini AI: Latencia 4096ms supera el umbral de 3000ms.',
      '• 🟠 Servicio degradado · Meta WhatsApp Cloud API',
    ]);
    const conCaida = textoAvisoAgrupado([gemini, espejo], ENLACE).split('\n');
    expect(conCaida[0]).toBe('🔴 2 alertas nuevas');
    expect(conCaida[2]).toBe(
      `• 🔴 Servicio caído · Espejo con el HIS — E.S.E. Hospital San Vicente de Paúl: Sin heartbeat del agente hace 7 min (org ${ORG}).`,
    );
    expect(conCaida[3]).toBe(`Ver: ${ENLACE}`);
    expect(textoAvisoAgrupado([])).toBe('');
  });

  it('un mensaje nunca pasa el tope de Telegram', () => {
    const muchos = Array.from({ length: 80 }, () => ({
      ...espejo,
      detail: 'x'.repeat(500),
    }));
    const texto = textoAvisoAgrupado(muchos);
    expect(texto.length).toBe(UMBRALES_ALERTAS.maxMensaje);
    expect(texto.endsWith('…')).toBe(true);
  });

  it('intermitente: un aviso y silencio', () => {
    const texto = textoIntermitente(espejo, 4);
    expect(texto.split('\n')).toEqual([
      '⚠️ INTERMITENTE · Servicio caído',
      'Espejo con el HIS',
      'Clínica: E.S.E. Hospital San Vicente de Paúl',
      'Se abrió y se cerró 4 veces en 30 min. No se avisa de nuevo en 30 min; el detalle sigue en el panel.',
      `Ver: ${ENLACE}`,
    ]);
    expect(
      textoIntermitente(
        {
          kind: 'REDIS_ERROR',
          title: '',
          organizationName: null,
          enlace: null,
        },
        5,
      ).split('\n'),
    ).toHaveLength(2);
  });

  it('lo que no cupo en el tope va en un solo mensaje', () => {
    expect(textoExcedente(1, null)).toBe(
      '🔕 Y 1 alerta más en los últimos 10 min, sin enviar para no inundar el grupo.\nEstán todas en el panel.',
    );
    expect(textoExcedente(14, ENLACE)).toBe(
      `🔕 Y 14 alertas más en los últimos 10 min, sin enviar para no inundar el grupo.\nEstán todas en el panel: ${ENLACE}`,
    );
  });

  it('la prueba y la vinculación', () => {
    expect(textoPrueba(AHORA)).toBe(
      `✅ Mensaje de prueba de AgenIA\nSi lo leen, las alertas técnicas llegan a este grupo.\nEnviado: ${formatAppointmentCompact(AHORA)} (hora Colombia)`,
    );
    expect(textoPrueba(AHORA, 'UTC')).toContain('(UTC)');
    expect(textoVinculado()).toContain('Cada día a las 7:00 llega un resumen');
    expect(textoVinculado()).toContain('sin datos de pacientes');
  });

  describe('resumen diario (A13)', () => {
    const AYER = '2026-10-18T17:00:00Z';

    it('sin novedades lo dice, y llega igual: es el latido del canal', () => {
      expect(
        textoResumenDiario({
          diaIso: AYER,
          nuevos: 0,
          criticos: 0,
          resueltos: 0,
          abiertos: [],
        }),
      ).toBe(
        `☀️ Resumen técnico de AgenIA · ${formatDateShort(AYER)}\nSin novedades. No hay problemas abiertos.`,
      );
    });

    it('con problemas: cuántos, cuántos críticos y los abiertos', () => {
      const texto = textoResumenDiario({
        diaIso: AYER,
        nuevos: 2,
        criticos: 1,
        resueltos: 2,
        abiertos: [espejo],
        enlace: ENLACE,
      });
      expect(texto.split('\n')).toEqual([
        `☀️ Resumen técnico de AgenIA · ${formatDateShort(AYER)}`,
        'Ese día: 2 problemas (1 crítico), 2 resueltos.',
        'Abiertos ahora: 1',
        `• 🔴 Servicio caído · Espejo con el HIS — E.S.E. Hospital San Vicente de Paúl, desde ${formatAppointmentCompact(AHORA)}`,
        `Ver: ${ENLACE}`,
      ]);
    });

    it('en singular y plural, y sin pasar de 10 abiertos en la lista', () => {
      const once = Array.from({ length: 12 }, () => ({
        ...espejo,
        title: '',
        organizationName: null,
      }));
      const texto = textoResumenDiario({
        diaIso: AYER,
        nuevos: 1,
        criticos: 0,
        resueltos: 1,
        abiertos: once,
      });
      expect(texto).toContain('Ese día: 1 problema, 1 resuelto.');
      expect(texto).toContain('• … y 2 más');
      expect(
        texto.split('\n').filter((l) => l.startsWith('• 🔴')),
      ).toHaveLength(10);
      expect(
        textoResumenDiario({
          diaIso: AYER,
          nuevos: 3,
          criticos: 3,
          resueltos: 0,
          abiertos: [],
        }),
      ).toContain('Ese día: 3 problemas (3 críticos), 0 resueltos.');
    });
  });

  it('🔒 ningún texto deja salir un documento, un teléfono, un correo, un BSUID ni un token', () => {
    const sucio = `${CEDULA} ${TELEFONO} ${CORREO} ${BSUID} ${TOKEN_BOT}`;
    const datos: DatosMensajeAlerta = {
      ...espejo,
      title: `Cita de ${CEDULA}`,
      detail: sucio,
      fuente: `cron ${TELEFONO}`,
    };
    const textos = [
      textoAviso(datos),
      textoRecordatorio(datos, { numero: 2, de: 3, ahoraIso: en(120) }),
      textoResolucion(datos, en(5)),
      textoAvisoAgrupado([datos, datos], ENLACE),
      textoIntermitente(datos, 4),
      textoResumenDiario({
        diaIso: AHORA,
        nuevos: 1,
        criticos: 1,
        resueltos: 0,
        abiertos: [datos],
      }),
    ];
    const prohibidos = [
      CEDULA,
      '300 111 2233',
      '3001112233',
      CORREO,
      '13491208655302741918',
      TOKEN_BOT,
      'AAHdqTcv',
    ];
    for (const texto of textos) {
      for (const p of prohibidos) expect(texto).not.toContain(p);
    }
  });
});

describe('intermitencia, silencio y resumen diario', () => {
  it('una clave intermitente: un aviso, y silencio durante 30 minutos', () => {
    const cuatro = [hace(1), hace(5), hace(10), hace(20)];
    expect(decidirIntermitencia(cuatro, null, AHORA)).toBe('AVISAR');
    expect(decidirIntermitencia(cuatro, hace(29), AHORA)).toBe('SUPRIMIR');
    expect(decidirIntermitencia(cuatro, hace(31), AHORA)).toBe('AVISAR');
    expect(decidirIntermitencia([hace(1), hace(5)], hace(31), AHORA)).toBe(
      'NORMAL',
    );
  });

  it('la próxima hora de reloj en Bogotá: hoy si aún no llega, si no mañana', () => {
    // 10:38 en Bogotá → las 07:00 ya pasaron: mañana 20-oct a las 07:00 (12:00Z).
    expect(proximaHoraLocal(7, new Date(AHORA)).toISOString()).toBe(
      '2026-10-20T12:00:00.000Z',
    );
    // 02:00 en Bogotá → hoy a las 07:00.
    expect(
      proximaHoraLocal(7, new Date('2026-10-19T07:00:00Z')).toISOString(),
    ).toBe('2026-10-19T12:00:00.000Z');
    // Justo a las 07:00 → la siguiente es mañana.
    expect(
      proximaHoraLocal(7, new Date('2026-10-19T12:00:00Z')).toISOString(),
    ).toBe('2026-10-20T12:00:00.000Z');
    // Fin de mes.
    expect(
      proximaHoraLocal(7, new Date('2026-10-31T20:00:00Z')).toISOString(),
    ).toBe('2026-11-01T12:00:00.000Z');
  });

  it('silenciar: 1 hora, 4 horas o hasta mañana a la hora del resumen', () => {
    const ahora = new Date(AHORA);
    expect(finDelSilencio('UNA_HORA', ahora).toISOString()).toBe(en(60));
    expect(finDelSilencio('CUATRO_HORAS', ahora).toISOString()).toBe(en(240));
    expect(finDelSilencio('HASTA_MANANA', ahora).toISOString()).toBe(
      '2026-10-20T12:00:00.000Z',
    );
    for (const o of OPCIONES_SILENCIO)
      expect(TEXTO_OPCION_SILENCIO[o]).toBeTruthy();
  });

  it('el resumen de hoy toca a las 07:00 y resume ayer, de medianoche a medianoche en Bogotá', () => {
    expect(ventanaResumenDiario(new Date(AHORA))).toEqual({
      toca: new Date('2026-10-19T12:00:00Z'),
      desde: new Date('2026-10-18T05:00:00Z'),
      hasta: new Date('2026-10-19T05:00:00Z'),
    });
    // 23:30 del 19 en Bogotá ya es el 20 en UTC: el «hoy» sigue siendo el 19.
    expect(ventanaResumenDiario(new Date('2026-10-20T04:30:00Z')).toca).toEqual(
      new Date('2026-10-19T12:00:00Z'),
    );
    // Primero de mes: ayer es el 31.
    expect(
      ventanaResumenDiario(new Date('2026-11-01T15:00:00Z')).desde,
    ).toEqual(new Date('2026-10-31T05:00:00Z'));
  });

  it('el resumen sale una vez al día, desde las 07:00', () => {
    const antes = new Date('2026-10-19T11:59:00Z'); // 06:59
    const despues = new Date(AHORA); // 10:38
    expect(tocaResumenDiario(null, antes)).toBe(false);
    expect(tocaResumenDiario(null, despues)).toBe(true);
    expect(tocaResumenDiario('2026-10-18T12:00:30Z', despues)).toBe(true);
    expect(tocaResumenDiario('2026-10-19T12:00:30Z', despues)).toBe(false);
    expect(tocaResumenDiario('ilegible', despues)).toBe(true);
  });
});
