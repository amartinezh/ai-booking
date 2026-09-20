/* eslint-disable @typescript-eslint/no-explicit-any -- dobles de Prisma: llevan solo lo que cada prueba lee, y se inspeccionan con `mock.calls[n][0]` */
import { LIMITES_CONSULTA_HIS, resolverRespuestaHis } from '@agenia/shared';
import {
  cargarEvidenciaHis,
  crearPeticiones,
  disponibilidadHis,
  documentosDelPaciente,
  etiquetasDeMedicosHis,
  idsValidos,
  planDeConsultaA,
  planDeConsultaB,
  progresoConsulta,
  vistaDeConsulta,
  ventanaPorDocumento,
  type CitaParaConsulta,
  type ConfigHis,
} from './consulta-his';

// ══════════════════════════════════════════════════════════════════════════
// Consulta en vivo al HIS desde el rastreo (Fase 2). Lo que se protege aquí:
//   · el hospital: la ventana por documento y el número de cupos están acotados;
//   · el paciente: nadie lee una consulta que no pidió, ni de otro documento;
//   · quien atiende: si el agente no puede contestar, se le dice ANTES de esperar.
// ══════════════════════════════════════════════════════════════════════════

const AHORA = new Date('2026-09-20T15:00:00.000Z');
const MS_DIA = 86_400_000;
const enDias = (n: number) => new Date(AHORA.getTime() + n * MS_DIA).toISOString();
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000);

describe('disponibilidadHis — falla rápido, con el motivo', () => {
  const OK: ConfigHis = {
    enabled: true,
    lookupEnabled: true,
    lastLookupCapable: true,
    lastHeartbeatAt: hace(1),
    lastHisReachable: true,
  };

  it('agente vivo, con la capacidad, con el interruptor encendido: se puede', () => {
    expect(disponibilidadHis(OK, AHORA)).toEqual({ puede: true, razon: null });
  });

  it.each([
    ['sin espejo', null, /no tiene espejo/],
    ['espejo deshabilitado', { ...OK, enabled: false }, /deshabilitado/],
    // El interruptor apagado es el estado por defecto: es la razón que se da.
    ['interruptor apagado (por defecto)', { ...OK, lookupEnabled: false }, /no está habilitada/],
    ['agente que nunca latió', { ...OK, lastHeartbeatAt: null }, /no ha dado señales/],
    ['agente con el último latido viejo', { ...OK, lastHeartbeatAt: hace(4) }, /no da señales desde hace 4 min/],
    ['el agente no alcanza el HIS', { ...OK, lastHisReachable: false }, /no puede comunicarse/],
    ['agente que dice no tener la capacidad', { ...OK, lastLookupCapable: false }, /no admite la consulta en vivo/],
    ['agente anterior que no lo dice (null)', { ...OK, lastLookupCapable: null }, /no admite la consulta en vivo/],
  ] as [string, ConfigHis | null, RegExp][])('%s → no', (_n, config, razon) => {
    const r = disponibilidadHis(config, AHORA);
    expect(r.puede).toBe(false);
    expect(r.razon).toMatch(razon);
  });

  it('el límite del latido es el compartido: hasta 3 min sí, 4 min no', () => {
    expect(LIMITES_CONSULTA_HIS.latidoMaxMin).toBe(3);
    expect(disponibilidadHis({ ...OK, lastHeartbeatAt: hace(3) }, AHORA).puede).toBe(true);
    expect(disponibilidadHis({ ...OK, lastHeartbeatAt: hace(4) }, AHORA).puede).toBe(false);
  });

  it('un HIS con salud DESCONOCIDA (null) no bloquea: solo un "no alcanzo" explícito lo hace', () => {
    expect(disponibilidadHis({ ...OK, lastHisReachable: null }, AHORA).puede).toBe(true);
  });

  it('con varios problemas, dice el que se arregla primero (interruptor antes que agente caído)', () => {
    const r = disponibilidadHis({ ...OK, lookupEnabled: false, lastHeartbeatAt: null }, AHORA);
    expect(r.razon).toMatch(/no está habilitada/);
  });

  it('las razones no exponen nada interno (sin IPs, servidores ni códigos)', () => {
    const casos: (ConfigHis | null)[] = [
      null,
      { ...OK, enabled: false },
      { ...OK, lookupEnabled: false },
      { ...OK, lastHeartbeatAt: null },
      { ...OK, lastHeartbeatAt: hace(10) },
      { ...OK, lastHisReachable: false },
      { ...OK, lastLookupCapable: false },
    ];
    for (const c of casos) {
      expect(disponibilidadHis(c, AHORA).razon).not.toMatch(/\d+\.\d+\.\d+|1433|sql|login|token/i);
    }
  });
});

describe('documentosDelPaciente', () => {
  it('un documento sin ceros a la izquierda: uno solo', () => {
    expect(documentosDelPaciente('1088123456')).toEqual(['1088123456']);
  });

  it('con ceros a la izquierda: el escrito y la variante sin ceros (Excel se los come)', () => {
    expect(documentosDelPaciente('0012345')).toEqual(['0012345', '12345']);
  });

  it('recorta espacios y descarta lo vacío', () => {
    expect(documentosDelPaciente(' 1088123456 ')).toEqual(['1088123456']);
    expect(documentosDelPaciente('   ')).toEqual([]);
  });
});

describe('ventanaPorDocumento — acotada: cada día de más son miles de filas del hospital', () => {
  it('sin citas: de la última semana a los próximos dos meses', () => {
    const { desde, hasta } = ventanaPorDocumento([], AHORA);
    expect(desde.toISOString()).toBe(enDias(-7));
    expect(hasta.toISOString()).toBe(enDias(60));
  });

  it('una cita más allá de la ventana la ESTIRA, con un día de margen', () => {
    const { hasta } = ventanaPorDocumento([enDias(100)], AHORA);
    expect(hasta.toISOString()).toBe(enDias(101));
  });

  it('una cita reciente hacia atrás también la estira', () => {
    const { desde } = ventanaPorDocumento([enDias(-20)], AHORA);
    expect(desde.toISOString()).toBe(enDias(-21));
  });

  it('nunca pasa del máximo que el HIS tolera', () => {
    const { desde, hasta } = ventanaPorDocumento([enDias(-25), enDias(400)], AHORA);
    expect((hasta.getTime() - desde.getTime()) / MS_DIA).toBeLessThanOrEqual(
      LIMITES_CONSULTA_HIS.ventanaDiasMax,
    );
    // Se recorta por el lado lejano, no por el que se empezó a mirar.
    expect(desde.toISOString()).toBe(enDias(-26));
  });

  it('ignora fechas ilegibles', () => {
    const { desde, hasta } = ventanaPorDocumento(['xx'], AHORA);
    expect(desde.toISOString()).toBe(enDias(-7));
    expect(hasta.toISOString()).toBe(enDias(60));
  });
});

describe('planDeConsultaA', () => {
  const cita = (over: Partial<CitaParaConsulta> = {}): CitaParaConsulta => ({
    startIso: enDias(2),
    status: 'SCHEDULED',
    origin: 'WHATSAPP',
    doctorExternalKey: '76',
    ...over,
  });
  const plan = (citas: CitaParaConsulta[], over: Partial<Parameters<typeof planDeConsultaA>[0]> = {}) =>
    planDeConsultaA({ citas, documentos: ['1088123456'], ahora: AHORA, incluirPorDocumento: true, ...over });
  const cupos = (peticiones: ReturnType<typeof plan>) => {
    const p = peticiones.find((x) => x.kind === 'BY_SLOT');
    return p ? (p.params as { slots: { doctorExternalKey: string; startTimeIso: string }[] }).slots : [];
  };

  it('una cita vigente con médico homologado: pregunta por su cupo Y por las citas del paciente', () => {
    const p = plan([cita()]);
    expect(p.map((x) => x.kind)).toEqual(['BY_DOCUMENT', 'BY_SLOT']);
  });

  it('el cupo lleva médico del HIS y hora en UTC; el documento va aparte, solo para comparar', () => {
    const [, porCupo] = plan([cita()]);
    expect(porCupo.params).toEqual({
      slots: [{ doctorExternalKey: '76', startTimeIso: enDias(2) }],
      compareDocuments: ['1088123456'],
    });
  });

  it.each([
    ['cancelada', cita({ status: 'CANCELLED' })],
    ['completada', cita({ status: 'COMPLETED' })],
    ['nacida en el HIS (ya viene de allá)', cita({ origin: 'MIRROR' })],
    ['con un médico sin homologar (no hay clave con la que buscar)', cita({ doctorExternalKey: null })],
    ['de hace más de 30 días (es historia)', cita({ startIso: enDias(-31) })],
  ])('una cita %s NO genera consulta de cupo', (_n, c) => {
    expect(cupos(plan([c]))).toEqual([]);
  });

  it('las de la agenda de ventanilla y las de WhatsApp sí (solo se excluyen las nacidas en el HIS)', () => {
    expect(cupos(plan([cita({ origin: 'MANUAL' })]))).toHaveLength(1);
    expect(cupos(plan([cita({ origin: 'WHATSAPP' })]))).toHaveLength(1);
  });

  it('elige las MÁS CERCANAS a hoy y respeta el tope de cupos', () => {
    const muchas = Array.from({ length: LIMITES_CONSULTA_HIS.maxCupos + 5 }, (_, i) =>
      cita({ startIso: enDias(i + 1), doctorExternalKey: String(i + 1) }),
    );

    const elegidos = cupos(plan(muchas));

    expect(elegidos).toHaveLength(LIMITES_CONSULTA_HIS.maxCupos);
    expect(elegidos[0].doctorExternalKey).toBe('1');
    expect(elegidos.at(-1)?.doctorExternalKey).toBe(String(LIMITES_CONSULTA_HIS.maxCupos));
  });

  it('no repite el mismo cupo', () => {
    expect(cupos(plan([cita(), cita()]))).toHaveLength(1);
  });

  it('la ventana por documento cubre las citas relevantes', () => {
    const [porDoc] = plan([cita({ startIso: enDias(100) })]);
    const w = porDoc.params as { fromIso: string; toIso: string };
    expect(Date.parse(w.toIso)).toBeGreaterThan(Date.parse(enDias(100)));
  });

  it('🔒 un rol con alcance acotado NO pide la lista del paciente en el HIS (mostraría lo que su alcance oculta)', () => {
    const p = plan([cita()], { incluirPorDocumento: false });
    expect(p.map((x) => x.kind)).toEqual(['BY_SLOT']);
  });

  it('un documento con letras (pasaporte) no se busca por documento, pero sí se compara en los cupos', () => {
    const p = plan([cita()], { documentos: ['AB123456'] });
    expect(p.map((x) => x.kind)).toEqual(['BY_SLOT']);
    expect((p[0].params as { compareDocuments: string[] }).compareDocuments).toEqual(['AB123456']);
  });

  it('sin citas que buscar: solo por documento (el HIS puede tener algo que AgenIA no)', () => {
    expect(plan([]).map((x) => x.kind)).toEqual(['BY_DOCUMENT']);
  });

  it('sin nada que preguntar: lista vacía (quien llama lo dice)', () => {
    expect(plan([], { incluirPorDocumento: false })).toEqual([]);
    expect(plan([cita({ doctorExternalKey: null })], { incluirPorDocumento: false })).toEqual([]);
  });

  it('una clave de médico demasiado larga para el protocolo no genera una consulta inválida', () => {
    const p = plan([cita({ doctorExternalKey: 'x'.repeat(40) })], { incluirPorDocumento: false });
    expect(p).toEqual([]);
  });
});

describe('planDeConsultaB', () => {
  const inicio = new Date('2026-09-22T15:00:00.000Z');
  const plan = (over: Partial<Parameters<typeof planDeConsultaB>[0]> = {}) =>
    planDeConsultaB({ medicoClave: '76', inicio, documentos: ['1088123456'], incluirPorDocumento: true, ...over });

  it('el cupo exacto y las citas del documento en la semana alrededor', () => {
    const p = plan();
    expect(p.map((x) => x.kind)).toEqual(['BY_DOCUMENT', 'BY_SLOT']);
    expect(p[1].params).toEqual({
      slots: [{ doctorExternalKey: '76', startTimeIso: inicio.toISOString() }],
      compareDocuments: ['1088123456'],
    });
    const w = p[0].params as { fromIso: string; toIso: string };
    expect(Date.parse(w.toIso) - Date.parse(w.fromIso)).toBe(14 * MS_DIA);
  });

  it('las dos variantes del documento (con y sin ceros) viajan a las dos consultas', () => {
    const p = plan({ documentos: ['0012345', '12345'] });
    expect((p[0].params as { patientDocuments: string[] }).patientDocuments).toEqual(['0012345', '12345']);
    expect((p[1].params as { compareDocuments: string[] }).compareDocuments).toEqual(['0012345', '12345']);
  });

  it('🔒 rol acotado: solo el cupo', () => {
    expect(plan({ incluirPorDocumento: false }).map((x) => x.kind)).toEqual(['BY_SLOT']);
  });
});

describe('idsValidos', () => {
  it.each([
    [['a'], ['a']],
    [['a', 'b', 'a'], ['a', 'b']],
  ])('%p → %p', (entrada, esperado) => {
    expect(idsValidos(entrada)).toEqual(esperado);
  });

  it.each([
    ['no es un arreglo', 'abc'],
    ['vacío', []],
    ['demasiados', ['1', '2', '3', '4', '5']],
    ['con un no-texto', ['a', 5]],
    ['con un id vacío', ['']],
    ['con un id enorme', ['x'.repeat(65)]],
    ['nulo', null],
    ['indefinido', undefined],
  ])('%s → null', (_n, entrada) => {
    expect(idsValidos(entrada)).toBeNull();
  });
});

// ── Con la base ──────────────────────────────────────────────

describe('crearPeticiones', () => {
  it('guarda cada petición con su organización, quien la pide, el paciente y cuándo se purga', async () => {
    const creadas: any[] = [];
    const db: any = {
      hisLookupRequest: {
        create: jest.fn((arg: any) => {
          creadas.push(arg);
          return { id: `id-${creadas.length}` };
        }),
      },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    const peticiones = planDeConsultaA({
      citas: [{ startIso: enDias(2), status: 'SCHEDULED', origin: 'WHATSAPP', doctorExternalKey: '76' }],
      documentos: ['1088123456'],
      ahora: AHORA,
      incluirPorDocumento: true,
    });

    const ids = await crearPeticiones(db, {
      organizationId: 'org-1',
      userId: 'u-1',
      patientId: 'p-1',
      peticiones,
      ahora: AHORA,
    });

    expect(ids).toEqual(['id-1', 'id-2']);
    expect(creadas.map((c) => c.data.kind)).toEqual(['BY_DOCUMENT', 'BY_SLOT']);
    for (const c of creadas) {
      expect(c.data).toMatchObject({ organizationId: 'org-1', requestedByUserId: 'u-1', patientId: 'p-1' });
      expect(c.data.purgeAt).toEqual(new Date(AHORA.getTime() + LIMITES_CONSULTA_HIS.purgaMs));
    }
    // Las dos en UNA transacción: o quedan las dos o ninguna.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('progresoConsulta', () => {
  const fila = (kind: string, status: string, over: Record<string, unknown> = {}) => ({
    kind,
    status,
    error: null,
    createdAt: hace(0),
    ...over,
  });
  const con = (filas: unknown[]) => {
    const db: any = { hisLookupRequest: { findMany: jest.fn(async () => filas) } };
    return db;
  };
  const entrada = (ids: string[], over: Record<string, unknown> = {}) => ({
    organizationId: 'org-1',
    userId: 'u-1',
    ids,
    ahora: AHORA,
    verDetalleTecnico: false,
    ...over,
  });

  it('🔒 solo lee las peticiones de SU clínica y que ÉL pidió', async () => {
    const db = con([fila('BY_SLOT', 'PENDIENTE')]);

    await progresoConsulta(db, entrada(['a']));

    expect(db.hisLookupRequest.findMany.mock.calls[0][0].where).toMatchObject({
      id: { in: ['a'] },
      organizationId: 'org-1',
      requestedByUserId: 'u-1',
    });
  });

  it('un id que no es suyo (o no existe) responde igual: "no se encontró"', async () => {
    const r = await progresoConsulta(con([]), entrada(['a']));
    expect(r).toEqual({ estado: 'FALLIDA', detalle: 'No se encontró la consulta.' });
  });

  it('mientras alguna siga pendiente: en curso', async () => {
    const r = await progresoConsulta(
      con([fila('BY_SLOT', 'RESUELTA'), fila('BY_DOCUMENT', 'PENDIENTE')]),
      entrada(['a', 'b']),
    );
    expect(r).toEqual({ estado: 'EN_CURSO', detalle: null });
  });

  it('todas resueltas: lista, sin advertencia', async () => {
    const r = await progresoConsulta(
      con([fila('BY_SLOT', 'RESUELTA'), fila('BY_DOCUMENT', 'RESUELTA')]),
      entrada(['a', 'b']),
    );
    expect(r).toEqual({ estado: 'LISTA', detalle: null });
  });

  it('⏱ una pendiente que ya pasó el tiempo se da por vencida aunque el cron no haya corrido', async () => {
    const r = await progresoConsulta(
      con([fila('BY_SLOT', 'PENDIENTE', { createdAt: hace(2) })]),
      entrada(['a']),
    );
    expect(r).toEqual({ estado: 'FALLIDA', detalle: 'El agente del hospital no contestó a tiempo.' });
  });

  it('una que falló y ninguna resuelta: fallida, con una frase genérica', async () => {
    const r = await progresoConsulta(
      con([fila('BY_SLOT', 'ERROR', { error: 'Failed to connect to 192.168.1.16:1433' })]),
      entrada(['a']),
    );
    expect(r.estado).toBe('FALLIDA');
    expect(r.detalle).toBe('El hospital no respondió a la consulta.');
    // El texto del agente puede llevar nombres de servidores del hospital.
    expect(r.detalle).not.toContain('192.168');
  });

  it('quien ve internos (ORG_ADMIN) sí recibe el texto del agente', async () => {
    const r = await progresoConsulta(
      con([fila('BY_SLOT', 'ERROR', { error: 'Login failed for user agenia_sync' })]),
      entrada(['a'], { verDetalleTecnico: true }),
    );
    expect(r.detalle).toBe('Login failed for user agenia_sync');
  });

  it('⚠️ una resuelta y otra fallida: LISTA pero PARCIAL, y dice cuál faltó', async () => {
    const r = await progresoConsulta(
      con([fila('BY_SLOT', 'RESUELTA'), fila('BY_DOCUMENT', 'ERROR')]),
      entrada(['a', 'b']),
    );
    expect(r.estado).toBe('LISTA');
    expect(r.detalle).toMatch(/la búsqueda de las citas del paciente/);
    expect(r.detalle).toMatch(/parcial/);
  });

  it('una pendiente y otra fallida: sigue en curso (todavía puede llegar la otra)', async () => {
    const r = await progresoConsulta(
      con([fila('BY_SLOT', 'PENDIENTE'), fila('BY_DOCUMENT', 'ERROR')]),
      entrada(['a', 'b']),
    );
    expect(r.estado).toBe('EN_CURSO');
  });
});

describe('cargarEvidenciaHis', () => {
  const INI = '2026-09-22T15:00:00.000Z';
  const DOCS = ['1088123456'];

  const paramsCupo = { slots: [{ doctorExternalKey: '76', startTimeIso: INI }], compareDocuments: DOCS };
  const paramsDoc = { patientDocuments: DOCS, fromIso: enDias(-7), toIso: enDias(60) };
  const filaHis = (over: Record<string, unknown> = {}) => ({
    doctorExternalKey: '76',
    startTimeIso: INI,
    patientDocument: '1088123456',
    status: 'SCHEDULED',
    ...over,
  });
  const guardada = (kind: 'BY_SLOT' | 'BY_DOCUMENT', filas: unknown[], resolvedAt = AHORA) => {
    const params = kind === 'BY_SLOT' ? paramsCupo : paramsDoc;
    return { params, result: resolverRespuestaHis(kind, params, filas), resolvedAt };
  };
  const con = (filas: unknown[]) => {
    const db: any = { hisLookupRequest: { findMany: jest.fn(async () => filas) } };
    return db;
  };
  const cargar = (db: any, over: Record<string, unknown> = {}) =>
    cargarEvidenciaHis(db, { organizationId: 'org-1', userId: 'u-1', ids: ['a', 'b'], documentos: DOCS, ...over });

  it('ids que no son válidos: null, sin ir a la base', async () => {
    const db = con([]);
    await expect(cargar(db, { ids: 'x' })).resolves.toBeNull();
    await expect(cargar(db, { ids: [] })).resolves.toBeNull();
    expect(db.hisLookupRequest.findMany).not.toHaveBeenCalled();
  });

  it('🔒 lee solo lo RESUELTO, de esta clínica, pedido por este usuario y NO purgado', async () => {
    const db = con([]);

    await cargar(db);

    expect(db.hisLookupRequest.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['a', 'b'] },
      organizationId: 'org-1',
      requestedByUserId: 'u-1',
      status: 'RESUELTA',
      purgedAt: null,
    });
  });

  it('junta la búsqueda por cupo y la de documento en una sola evidencia', async () => {
    const db = con([guardada('BY_SLOT', [filaHis()]), guardada('BY_DOCUMENT', [filaHis()])]);

    const ev = await cargar(db);

    expect(ev?.cupos).toHaveLength(1);
    expect(ev?.cupos[0].filas[0]).toMatchObject({ titular: 'PACIENTE', status: 'SCHEDULED' });
    expect(ev?.porDocumento?.citas).toHaveLength(1);
  });

  it('la constancia es la del dato MÁS VIEJO del conjunto', async () => {
    const db = con([
      guardada('BY_SLOT', [], new Date('2026-09-20T15:00:05.000Z')),
      guardada('BY_DOCUMENT', [], new Date('2026-09-20T15:00:02.000Z')),
    ]);

    const ev = await cargar(db);

    expect(ev?.consultadoIso).toBe('2026-09-20T15:00:02.000Z');
  });

  it('🔒 una consulta hecha sobre OTRO documento se ignora (no se mezcla con este paciente)', async () => {
    const ajena = { ...guardada('BY_SLOT', [filaHis()]), params: { ...paramsCupo, compareDocuments: ['52123456'] } };
    const db = con([ajena]);

    await expect(cargar(db)).resolves.toBeNull();
  });

  it('solo las que coinciden con el documento cuentan; las demás se descartan', async () => {
    const ajena = { ...guardada('BY_SLOT', [filaHis()]), params: { ...paramsCupo, compareDocuments: ['52123456'] } };
    const db = con([ajena, guardada('BY_DOCUMENT', [filaHis()])]);

    const ev = await cargar(db);

    expect(ev?.cupos).toEqual([]);
    expect(ev?.porDocumento?.citas).toHaveLength(1);
  });

  it('la comparación no depende del orden ni de espacios en los documentos', async () => {
    const db = con([guardada('BY_SLOT', [filaHis()])]);

    const ev = await cargar(db, { documentos: [' 1088123456 '] });

    expect(ev?.cupos).toHaveLength(1);
  });

  it('un resultado que no tiene la forma esperada se ignora en vez de romper', async () => {
    const db = con([{ params: paramsCupo, result: { kind: 'BY_NAME' }, resolvedAt: AHORA }]);
    await expect(cargar(db)).resolves.toBeNull();

    const db2 = con([{ params: paramsCupo, result: null, resolvedAt: AHORA }]);
    await expect(cargar(db2)).resolves.toBeNull();
  });

  it('sin nada resuelto: null (no hay evidencia, y no se inventa una "vacía")', async () => {
    await expect(cargar(con([]))).resolves.toBeNull();
  });

  it('un cupo libre es evidencia (significa "el HIS no tiene nada ahí"), no ausencia de evidencia', async () => {
    const ev = await cargar(con([guardada('BY_SLOT', [])]));

    expect(ev).not.toBeNull();
    expect(ev?.cupos[0].filas).toEqual([]);
  });
});

describe('vistaDeConsulta — lo que se le muestra a quien atiende', () => {
  const evidencia = {
    consultadoIso: AHORA.toISOString(),
    porDocumento: {
      desdeIso: enDias(-7),
      hastaIso: enDias(60),
      citas: [
        {
          doctorExternalKey: '76',
          startIso: enDias(2),
          serviceExternalKey: '890201',
          status: 'SCHEDULED' as const,
          titular: 'PACIENTE' as const,
          documentoTercero: null,
        },
      ],
      truncado: true,
    },
    cupos: [{ doctorExternalKey: '76', startIso: enDias(2), filas: [] }],
  };

  it('el médico va por su nombre, no por su clave; conserva el recorte', () => {
    const v = vistaDeConsulta(evidencia, (c) => `Dra. ${c}`);

    expect(v.porDocumento?.citas).toEqual([{ startIso: enDias(2), medico: 'Dra. 76', estado: 'SCHEDULED' }]);
    expect(v.porDocumento?.truncado).toBe(true);
    expect(v.cuposConsultados).toBe(1);
  });

  it('🔒 nunca lleva un documento', () => {
    const v = vistaDeConsulta(evidencia, (c) => c);
    // Ni el número ni un campo que lo pueda llevar (la propiedad `porDocumento` es
    // el nombre de la búsqueda, no un dato).
    expect(JSON.stringify(v)).not.toMatch(/1088123456|documentoTercero|patientDocument|"documento"/);
  });

  it('sin búsqueda por documento: porDocumento es null (distinto de "sin citas")', () => {
    expect(vistaDeConsulta({ ...evidencia, porDocumento: null }, (c) => c).porDocumento).toBeNull();
  });
});

describe('etiquetasDeMedicosHis', () => {
  const build = (over: { mapas?: unknown[]; catalogo?: unknown[]; perfiles?: unknown[] } = {}) => {
    const db: any = {
      mirrorEntityMap: { findMany: jest.fn(async () => over.mapas ?? []) },
      mirrorCatalogEntry: { findMany: jest.fn(async () => over.catalogo ?? []) },
      doctorProfile: { findMany: jest.fn(async () => over.perfiles ?? []) },
    };
    return db;
  };
  const etiquetaPerfil = (p: { fullName: string }) => `Dr(a). ${p.fullName}`;

  it('sin claves no consulta nada', async () => {
    const db = build();
    const e = await etiquetasDeMedicosHis(db, 'org-1', [], etiquetaPerfil);

    expect(e('76')).toBe('76');
    expect(db.mirrorEntityMap.findMany).not.toHaveBeenCalled();
  });

  it('el nombre del médico de AgenIA (homologado) manda sobre el del catálogo', async () => {
    const db = build({
      mapas: [{ agenIAId: 'd1', externalKey: '76', externalLabel: 'RUIZ' }],
      catalogo: [{ externalKey: '76', label: 'RUIZ ANA' }],
      perfiles: [{ id: 'd1', fullName: 'Ana Ruiz', isFunctionalAgenda: false }],
    });

    const e = await etiquetasDeMedicosHis(db, 'org-1', ['76'], etiquetaPerfil);

    expect(e('76')).toBe('Dr(a). Ana Ruiz');
  });

  it('sin perfil, la etiqueta del mapeo; sin mapeo, la del catálogo; sin nada, la clave', async () => {
    const db = build({
      mapas: [{ agenIAId: 'd9', externalKey: '80', externalLabel: 'PEREZ' }],
      catalogo: [{ externalKey: '91', label: 'GOMEZ LUZ' }],
    });

    const e = await etiquetasDeMedicosHis(db, 'org-1', ['80', '91', '55'], etiquetaPerfil);

    expect(e('80')).toBe('PEREZ');
    expect(e('91')).toBe('GOMEZ LUZ');
    expect(e('55')).toBe('Médico 55 del HIS');
  });

  it('🔒 todas las lecturas van acotadas a la organización', async () => {
    const db = build();

    await etiquetasDeMedicosHis(db, 'org-1', ['76'], etiquetaPerfil);

    expect(db.mirrorEntityMap.findMany.mock.calls[0][0].where.organizationId).toBe('org-1');
    expect(db.mirrorCatalogEntry.findMany.mock.calls[0][0].where.organizationId).toBe('org-1');
    expect(db.doctorProfile.findMany.mock.calls[0][0].where.organizationId).toBe('org-1');
  });
});
