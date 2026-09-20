import {
  LIMITES_CONSULTA_HIS,
  aCitaHisVista,
  clasificarTitular,
  combinarEvidenciaHis,
  leerResultadoGuardado,
  mismoInstante,
  ocupanteDelCupo,
  parametrosADto,
  resolverRespuestaHis,
  validarConsultaHis,
  type CitaHisVista,
} from './his-lookup';
import type { HisLookupRequestDto } from './mirror-protocol';

const DESDE = '2026-09-01T05:00:00.000Z';
const HASTA = '2026-12-01T05:00:00.000Z';

const porDocumento = (over: Partial<HisLookupRequestDto> = {}): HisLookupRequestDto => ({
  requestId: 'r-1',
  kind: 'BY_DOCUMENT',
  patientDocuments: ['1088123456'],
  fromIso: DESDE,
  toIso: HASTA,
  ...over,
});
const porCupo = (over: Partial<HisLookupRequestDto> = {}): HisLookupRequestDto => ({
  requestId: 'r-2',
  kind: 'BY_SLOT',
  slots: [{ doctorExternalKey: '76', startTimeIso: '2026-09-22T15:00:00.000Z' }],
  ...over,
});

describe('validarConsultaHis', () => {
  it('una consulta por documento y una por cupo bien formadas son válidas', () => {
    expect(validarConsultaHis(porDocumento())).toBeNull();
    expect(validarConsultaHis(porCupo())).toBeNull();
  });

  it('acepta las dos variantes del documento (con y sin ceros)', () => {
    expect(validarConsultaHis(porDocumento({ patientDocuments: ['0012345', '12345'] }))).toBeNull();
  });

  it.each([
    ['sin requestId', porDocumento({ requestId: '' })],
    ['un tipo desconocido', { ...porDocumento(), kind: 'BY_NAME' } as never],
  ])('rechaza %s', (_n, q) => {
    expect(validarConsultaHis(q)).not.toBeNull();
  });

  describe('por documento', () => {
    it.each([
      ['sin documentos', { patientDocuments: [] }],
      ['más de dos', { patientDocuments: ['1234', '5678', '9012'] }],
      ['un documento con letras', { patientDocuments: ['12AB34'] }],
      ['un documento demasiado corto', { patientDocuments: ['123'] }],
      ['un documento demasiado largo', { patientDocuments: ['1234567890123456'] }],
      ['una inyección SQL', { patientDocuments: ["1'; DROP TABLE x;--"] }],
      ['sin ventana', { fromIso: undefined, toIso: undefined }],
      ['una ventana invertida', { fromIso: HASTA, toIso: DESDE }],
      ['una ventana vacía', { fromIso: DESDE, toIso: DESDE }],
      ['fechas ilegibles', { fromIso: 'ayer', toIso: 'mañana' }],
    ])('rechaza %s', (_n, over) => {
      expect(validarConsultaHis(porDocumento(over as never))).not.toBeNull();
    });

    it(`rechaza una ventana de más de ${LIMITES_CONSULTA_HIS.ventanaDiasMax} días y acepta justo el máximo`, () => {
      const dias = (n: number) => new Date(Date.parse(DESDE) + n * 86_400_000).toISOString();
      expect(validarConsultaHis(porDocumento({ toIso: dias(LIMITES_CONSULTA_HIS.ventanaDiasMax + 1) }))).toMatch(/máximo/);
      expect(validarConsultaHis(porDocumento({ toIso: dias(LIMITES_CONSULTA_HIS.ventanaDiasMax) }))).toBeNull();
    });
  });

  describe('por cupo', () => {
    const cupo = (i: number) => ({ doctorExternalKey: String(i), startTimeIso: DESDE });

    it.each([
      ['sin cupos', { slots: [] }],
      ['sin la lista', { slots: undefined }],
      ['un médico vacío', { slots: [{ doctorExternalKey: '  ', startTimeIso: DESDE }] }],
      ['un médico absurdamente largo', { slots: [{ doctorExternalKey: 'x'.repeat(33), startTimeIso: DESDE }] }],
      ['una hora ilegible', { slots: [{ doctorExternalKey: '76', startTimeIso: 'xx' }] }],
      ['un cupo nulo', { slots: [null] }],
    ])('rechaza %s', (_n, over) => {
      expect(validarConsultaHis(porCupo(over as never))).not.toBeNull();
    });

    it(`acepta hasta ${LIMITES_CONSULTA_HIS.maxCupos} cupos y rechaza uno más`, () => {
      const cupos = (n: number) => Array.from({ length: n }, (_, i) => cupo(i + 1));
      expect(validarConsultaHis(porCupo({ slots: cupos(LIMITES_CONSULTA_HIS.maxCupos) }))).toBeNull();
      expect(validarConsultaHis(porCupo({ slots: cupos(LIMITES_CONSULTA_HIS.maxCupos + 1) }))).not.toBeNull();
    });
  });
});

describe('clasificarTitular', () => {
  const PROPIOS = ['1088123456'];

  it.each([
    ['el mismo documento', '1088123456', 'PACIENTE'],
    ['con espacios alrededor', ' 1088123456 ', 'PACIENTE'],
    ['otro documento', '52123456', 'OTRO'],
    ['el mismo número con ceros a la izquierda', '01088123456', 'MISMO_CON_CEROS'],
    ['sin documento', null, 'SIN_DOCUMENTO'],
    ['vacío', '', 'SIN_DOCUMENTO'],
    ['en blanco', '   ', 'SIN_DOCUMENTO'],
  ] as const)('%s → %s', (_n, doc, esperado) => {
    expect(clasificarTitular(doc, PROPIOS)).toBe(esperado);
  });

  it('el paciente escribió con ceros y el HIS lo tiene sin ellos → MISMO_CON_CEROS', () => {
    expect(clasificarTitular('12345', ['0012345'])).toBe('MISMO_CON_CEROS');
  });

  it('cualquiera de las variantes del paciente cuenta como suya', () => {
    expect(clasificarTitular('12345', ['0012345', '12345'])).toBe('PACIENTE');
  });

  it('🚨 un documento con letras solo casa por igualdad EXACTA: quitarle las letras lo confundiría con otra persona', () => {
    expect(clasificarTitular('AB1088123456', ['1088123456'])).toBe('OTRO');
    expect(clasificarTitular('AB123456', ['AB123456'])).toBe('PACIENTE');
  });

  it('un documento de puros ceros no colapsa a "cualquiera"', () => {
    expect(clasificarTitular('0000', ['1088123456'])).toBe('OTRO');
  });
});

describe('aCitaHisVista — el documento de un tercero nunca sale completo', () => {
  const fila = (patientDocument: string | null) => ({
    doctorExternalKey: '76',
    startTimeIso: '2026-09-22T10:00:00-05:00',
    serviceExternalKey: '890201',
    patientDocument,
    status: 'SCHEDULED' as const,
  });

  it('del paciente: sin documento guardado', () => {
    expect(aCitaHisVista(fila('1088123456'), ['1088123456'])).toEqual({
      doctorExternalKey: '76',
      startIso: '2026-09-22T15:00:00.000Z',
      serviceExternalKey: '890201',
      status: 'SCHEDULED',
      titular: 'PACIENTE',
      documentoTercero: null,
    });
  });

  it('de otra persona: solo el documento ENMASCARADO', () => {
    const v = aCitaHisVista(fila('52123456'), ['1088123456']);
    expect(v.titular).toBe('OTRO');
    expect(v.documentoTercero).toBe('•••3456');
    expect(JSON.stringify(v)).not.toContain('52123456');
  });

  it('el mismo número con ceros: también enmascarado, y lo dice', () => {
    const v = aCitaHisVista(fila('01088123456'), ['1088123456']);
    expect(v.titular).toBe('MISMO_CON_CEROS');
    expect(v.documentoTercero).toBe('•••3456');
    expect(JSON.stringify(v)).not.toContain('01088123456');
  });

  it('sin documento en el HIS: no hay nada que enmascarar', () => {
    expect(aCitaHisVista(fila(null), ['1088123456'])).toMatchObject({ titular: 'SIN_DOCUMENTO', documentoTercero: null });
  });

  it('normaliza la hora a UTC ISO y un servicio ausente a null', () => {
    const v = aCitaHisVista({ ...fila('1088123456'), serviceExternalKey: undefined }, ['1088123456']);
    expect(v.serviceExternalKey).toBeNull();
    expect(v.startIso).toBe('2026-09-22T15:00:00.000Z');
  });
});

describe('ocupanteDelCupo', () => {
  const v = (over: Partial<CitaHisVista> = {}): CitaHisVista => ({
    doctorExternalKey: '76',
    startIso: '2026-09-22T15:00:00.000Z',
    serviceExternalKey: null,
    status: 'SCHEDULED',
    titular: 'PACIENTE',
    documentoTercero: null,
    ...over,
  });

  it('sin filas: nadie', () => {
    expect(ocupanteDelCupo([])).toEqual({ tipo: 'NADIE' });
  });

  it('una vigente del paciente', () => {
    expect(ocupanteDelCupo([v()])).toEqual({ tipo: 'PACIENTE', estado: 'SCHEDULED' });
  });

  it('una vigente de otra persona: trae su documento enmascarado', () => {
    expect(ocupanteDelCupo([v({ titular: 'OTRO', documentoTercero: '•••3456' })])).toEqual({
      tipo: 'OTRA_PERSONA',
      estado: 'SCHEDULED',
      documentoTercero: '•••3456',
      mismoConCeros: false,
    });
  });

  it('el mismo número con ceros se marca', () => {
    expect(ocupanteDelCupo([v({ titular: 'MISMO_CON_CEROS', documentoTercero: '•••3456' })])).toMatchObject({
      tipo: 'OTRA_PERSONA',
      mismoConCeros: true,
    });
  });

  it('una fila sin documento es "otra persona" sin documento que mostrar', () => {
    expect(ocupanteDelCupo([v({ titular: 'SIN_DOCUMENTO' })])).toMatchObject({
      tipo: 'OTRA_PERSONA',
      documentoTercero: null,
    });
  });

  it('🚨 la fila VIGENTE manda sobre una atendida: la PK del HIS permite las dos para la misma hora', () => {
    const r = ocupanteDelCupo([
      v({ status: 'ATTENDED', titular: 'PACIENTE' }),
      v({ status: 'SCHEDULED', titular: 'OTRO', documentoTercero: '•••9999' }),
    ]);
    expect(r).toMatchObject({ tipo: 'OTRA_PERSONA', estado: 'SCHEDULED' });
  });

  it('sin vigente, una atendida o una inasistencia cuenta (la cita existió)', () => {
    expect(ocupanteDelCupo([v({ status: 'ATTENDED' })])).toEqual({ tipo: 'PACIENTE', estado: 'ATTENDED' });
    expect(ocupanteDelCupo([v({ status: 'NO_SHOW' })])).toEqual({ tipo: 'PACIENTE', estado: 'NO_SHOW' });
  });

  it('un estado desconocido NO cuenta: no se afirma que alguien ocupe el cupo', () => {
    expect(ocupanteDelCupo([v({ status: 'OTHER' })])).toEqual({ tipo: 'NADIE' });
  });

  it('si el paciente está entre varias vigentes, gana el paciente', () => {
    const r = ocupanteDelCupo([v({ titular: 'OTRO', documentoTercero: '•••1111' }), v({ titular: 'PACIENTE' })]);
    expect(r).toEqual({ tipo: 'PACIENTE', estado: 'SCHEDULED' });
  });
});

describe('mismoInstante', () => {
  it('compara instantes, no cadenas', () => {
    expect(mismoInstante('2026-09-22T15:00:00.000Z', '2026-09-22T10:00:00-05:00')).toBe(true);
    expect(mismoInstante('2026-09-22T15:00:00.000Z', '2026-09-22T15:01:00.000Z')).toBe(false);
  });
  it('una fecha ilegible nunca es igual (ni a sí misma)', () => {
    expect(mismoInstante('basura', 'basura')).toBe(false);
  });

  // 🐛 Lo encontró la prueba de punta a punta con datos de verdad: el HIS guarda la
  // hora AL MINUTO ('YYYY/MM/DD HH:mm'), pero un cupo de AgenIA puede traer segundos
  // y milisegundos. Comparados exactos, la fila del HIS no casaba con su propio cupo
  // y el resultado era un falso "el HIS no la tiene".
  it('el HIS guarda al minuto: segundos y milisegundos dentro del mismo minuto son el MISMO cupo', () => {
    expect(mismoInstante('2026-09-22T15:00:37.412Z', '2026-09-22T15:00:00.000Z')).toBe(true);
    expect(mismoInstante('2026-09-22T15:00:59.999Z', '2026-09-22T15:00:00.000Z')).toBe(true);
    expect(mismoInstante('2026-09-22T10:00:37-05:00', '2026-09-22T15:00:00.000Z')).toBe(true);
  });

  it('pero un minuto distinto NO lo es (ni siquiera por un milisegundo de diferencia entre minutos)', () => {
    expect(mismoInstante('2026-09-22T15:00:59.999Z', '2026-09-22T15:01:00.000Z')).toBe(false);
    expect(mismoInstante('2026-09-22T15:00:00.000Z', '2026-09-22T15:20:00.000Z')).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Lo que la web pide, lo que el servidor guarda y lo que se lee después
// ═══════════════════════════════════════════════════════════════════════════

const INI = '2026-09-22T15:00:00.000Z';
const filaCruda = (over: Record<string, unknown> = {}) => ({
  doctorExternalKey: '76',
  startTimeIso: INI,
  serviceExternalKey: '890201',
  patientDocument: '1088123456',
  status: 'SCHEDULED',
  ...over,
});

describe('parametrosADto', () => {
  it('por documento: lo guardado pasa tal cual al agente', () => {
    expect(parametrosADto('r-1', 'BY_DOCUMENT', { patientDocuments: ['1088123456'], fromIso: DESDE, toIso: HASTA })).toEqual({
      requestId: 'r-1',
      kind: 'BY_DOCUMENT',
      patientDocuments: ['1088123456'],
      fromIso: DESDE,
      toIso: HASTA,
    });
  });

  it('🔒 por cupo: el documento con el que se compara NO viaja al agente', () => {
    const dto = parametrosADto('r-2', 'BY_SLOT', {
      slots: [{ doctorExternalKey: '76', startTimeIso: INI }],
      compareDocuments: ['1088123456'],
    });
    expect(dto).toEqual({ requestId: 'r-2', kind: 'BY_SLOT', slots: [{ doctorExternalKey: '76', startTimeIso: INI }] });
    expect(JSON.stringify(dto)).not.toContain('1088123456');
  });

  it.each([
    ['params nulos', 'BY_DOCUMENT', null],
    ['params que no son un objeto', 'BY_DOCUMENT', 'texto'],
    ['un arreglo', 'BY_DOCUMENT', []],
    ['un tipo desconocido', 'BY_NAME', {}],
    ['una ventana inválida', 'BY_DOCUMENT', { patientDocuments: ['1088123456'], fromIso: HASTA, toIso: DESDE }],
    ['un documento inválido', 'BY_DOCUMENT', { patientDocuments: ['12'], fromIso: DESDE, toIso: HASTA }],
    ['cupos vacíos', 'BY_SLOT', { slots: [], compareDocuments: [] }],
  ])('rechaza %s', (_n, kind, params) => {
    expect(parametrosADto('r', kind, params)).toBeNull();
  });
});

describe('resolverRespuestaHis', () => {
  const porDocumento = { patientDocuments: ['1088123456'], fromIso: DESDE, toIso: HASTA };
  const porCupo = { slots: [{ doctorExternalKey: '76', startTimeIso: INI }], compareDocuments: ['1088123456'] };

  describe('por documento', () => {
    it('guarda las citas del paciente, ordenadas, sin su documento', () => {
      const r = resolverRespuestaHis('BY_DOCUMENT', porDocumento, [
        filaCruda({ startTimeIso: '2026-10-05T15:00:00.000Z' }),
        filaCruda({ startTimeIso: INI }),
      ]);

      expect(r).toMatchObject({ kind: 'BY_DOCUMENT', truncado: false });
      if (r?.kind !== 'BY_DOCUMENT') throw new Error('tipo');
      expect(r.citas.map((c) => c.startIso)).toEqual([INI, '2026-10-05T15:00:00.000Z']);
      expect(r.citas.every((c) => c.titular === 'PACIENTE' && c.documentoTercero === null)).toBe(true);
    });

    it('🚨 una fila de OTRO documento se DESCARTA (defecto del agente): un tercero no se guarda', () => {
      const r = resolverRespuestaHis('BY_DOCUMENT', porDocumento, [filaCruda(), filaCruda({ patientDocument: '52123456' })]);
      if (r?.kind !== 'BY_DOCUMENT') throw new Error('tipo');
      expect(r.citas).toHaveLength(1);
      expect(JSON.stringify(r)).not.toContain('52123456');
    });

    it('recorta al tope y lo DECLARA (nunca en silencio)', () => {
      const muchas = Array.from({ length: LIMITES_CONSULTA_HIS.maxFilas + 5 }, (_, i) =>
        filaCruda({ startTimeIso: new Date(Date.parse(INI) + i * 60_000).toISOString() }),
      );
      const r = resolverRespuestaHis('BY_DOCUMENT', porDocumento, muchas);
      if (r?.kind !== 'BY_DOCUMENT') throw new Error('tipo');
      expect(r.citas).toHaveLength(LIMITES_CONSULTA_HIS.maxFilas);
      expect(r.truncado).toBe(true);
    });

    it('si el agente ya dijo que recortó, se conserva la marca', () => {
      const r = resolverRespuestaHis('BY_DOCUMENT', porDocumento, [filaCruda()], true);
      expect(r).toMatchObject({ truncado: true });
    });

    it('sin filas: una lista vacía es una respuesta válida ("no tiene citas")', () => {
      expect(resolverRespuestaHis('BY_DOCUMENT', porDocumento, [])).toMatchObject({ citas: [], truncado: false });
    });
  });

  describe('por cupo', () => {
    it('cupo ocupado por el paciente', () => {
      const r = resolverRespuestaHis('BY_SLOT', porCupo, [filaCruda()]);
      expect(r).toEqual({
        kind: 'BY_SLOT',
        cupos: [{ doctorExternalKey: '76', startIso: INI, filas: [expect.objectContaining({ titular: 'PACIENTE', documentoTercero: null })] }],
      });
    });

    it('🔒 cupo ocupado por OTRA persona: el documento sale ENMASCARADO y nunca completo', () => {
      const r = resolverRespuestaHis('BY_SLOT', porCupo, [filaCruda({ patientDocument: '52123456' })]);
      expect(JSON.stringify(r)).not.toContain('52123456');
      expect(JSON.stringify(r)).toContain('•••3456');
      if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
      expect(r.cupos[0].filas[0]).toMatchObject({ titular: 'OTRO', documentoTercero: '•••3456' });
    });

    it('cupo libre: sin filas', () => {
      const r = resolverRespuestaHis('BY_SLOT', porCupo, []);
      if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
      expect(r.cupos[0].filas).toEqual([]);
    });

    it('🚨 filas de cupos que NADIE pidió se descartan (un agente que devuelve de más no filtra datos)', () => {
      const r = resolverRespuestaHis('BY_SLOT', porCupo, [
        filaCruda(),
        filaCruda({ doctorExternalKey: '91', patientDocument: '99999999' }),
        filaCruda({ startTimeIso: '2026-09-23T15:00:00.000Z', patientDocument: '88888888' }),
      ]);
      if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
      expect(r.cupos).toHaveLength(1);
      expect(r.cupos[0].filas).toHaveLength(1);
      expect(JSON.stringify(r)).not.toMatch(/99999999|88888888/);
    });

    it('la hora se compara como instante, no como cadena', () => {
      const r = resolverRespuestaHis('BY_SLOT', porCupo, [filaCruda({ startTimeIso: '2026-09-22T10:00:00-05:00' })]);
      if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
      expect(r.cupos[0].filas).toHaveLength(1);
    });

    it('un cupo por cada uno de los pedidos, cada uno con lo suyo', () => {
      const params = {
        slots: [{ doctorExternalKey: '76', startTimeIso: INI }, { doctorExternalKey: '91', startTimeIso: INI }],
        compareDocuments: ['1088123456'],
      };
      const r = resolverRespuestaHis('BY_SLOT', params, [filaCruda(), filaCruda({ doctorExternalKey: '91', patientDocument: '52123456' })]);
      if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
      expect(r.cupos.map((c) => [c.doctorExternalKey, c.filas.map((f) => f.titular)])).toEqual([
        ['76', ['PACIENTE']],
        ['91', ['OTRO']],
      ]);
    });

    it('conserva pocas filas por cupo: la PK del HIS no admite más', () => {
      const r = resolverRespuestaHis('BY_SLOT', porCupo, Array.from({ length: 9 }, () => filaCruda()));
      if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
      expect(r.cupos[0].filas).toHaveLength(5);
    });
  });

  describe('un cupo con segundos frente a una hora del HIS al minuto', () => {
    it('🐛 la fila del HIS (10:00:00) casa con su cupo (10:00:37.412): no se descarta ni se declara "libre"', () => {
      const params = { slots: [{ doctorExternalKey: '76', startTimeIso: '2026-09-22T15:00:37.412Z' }], compareDocuments: ['1088123456'] };

      const r = resolverRespuestaHis('BY_SLOT', params, [filaCruda({ startTimeIso: '2026-09-22T15:00:00.000Z' })]);

      if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
      expect(r.cupos[0].filas).toHaveLength(1);
      expect(r.cupos[0].filas[0].titular).toBe('PACIENTE');
    });

    it('sigue descartando la fila de OTRO minuto', () => {
      const params = { slots: [{ doctorExternalKey: '76', startTimeIso: '2026-09-22T15:00:37.412Z' }], compareDocuments: ['1088123456'] };

      const r = resolverRespuestaHis('BY_SLOT', params, [filaCruda({ startTimeIso: '2026-09-22T15:20:00.000Z' })]);

      if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
      expect(r.cupos[0].filas).toEqual([]);
    });
  });

  describe('tolera una respuesta mal formada', () => {
    it.each([
      ['no es un arreglo', 'basura'],
      ['trae nulos', [null, 1, 'x']],
      ['filas sin médico', [filaCruda({ doctorExternalKey: '' })]],
      ['filas con hora ilegible', [filaCruda({ startTimeIso: 'xx' })]],
    ])('%s → sin filas, sin lanzar', (_n, respuesta) => {
      const r = resolverRespuestaHis('BY_SLOT', porCupo, respuesta);
      if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
      expect(r.cupos[0].filas).toEqual([]);
    });

    it('un estado desconocido pasa a OTHER en vez de inventarse otro', () => {
      const r = resolverRespuestaHis('BY_SLOT', porCupo, [filaCruda({ status: 'ANULADA' })]);
      if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
      expect(r.cupos[0].filas[0].status).toBe('OTHER');
    });

    it('params inválidos → null', () => {
      expect(resolverRespuestaHis('BY_SLOT', { slots: [] }, [])).toBeNull();
      expect(resolverRespuestaHis('BY_NAME', {}, [])).toBeNull();
      expect(resolverRespuestaHis('BY_SLOT', null, [])).toBeNull();
    });
  });
});

describe('leerResultadoGuardado', () => {
  const guardado = () =>
    resolverRespuestaHis(
      'BY_SLOT',
      { slots: [{ doctorExternalKey: '76', startTimeIso: INI }], compareDocuments: ['1088123456'] },
      [filaCruda({ patientDocument: '52123456' })],
    );

  it('lee lo que escribe resolverRespuestaHis (ida y vuelta), incluso pasando por JSON', () => {
    const original = guardado();
    expect(leerResultadoGuardado(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it('por documento también', () => {
    const r = resolverRespuestaHis('BY_DOCUMENT', { patientDocuments: ['1088123456'], fromIso: DESDE, toIso: HASTA }, [filaCruda()]);
    expect(leerResultadoGuardado(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it.each([null, undefined, 'x', 3, [], {}, { kind: 'BY_NAME' }, { kind: 'BY_DOCUMENT' }, { kind: 'BY_SLOT', cupos: 'no' }])(
    'un result que no tiene la forma (%p) → null',
    (json) => {
      expect(leerResultadoGuardado(json)).toBeNull();
    },
  );

  it('descarta las filas mal formadas en vez de romper', () => {
    const r = leerResultadoGuardado({
      kind: 'BY_SLOT',
      cupos: [{ doctorExternalKey: '76', startIso: INI, filas: [{ x: 1 }, null, { doctorExternalKey: '76', startIso: INI, status: 'SCHEDULED', titular: 'PACIENTE' }] }],
    });
    if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
    expect(r.cupos[0].filas).toHaveLength(1);
  });

  it('un titular o un estado desconocidos invalidan la fila (no se inventan)', () => {
    const r = leerResultadoGuardado({
      kind: 'BY_SLOT',
      cupos: [{ doctorExternalKey: '76', startIso: INI, filas: [{ doctorExternalKey: '76', startIso: INI, status: 'SCHEDULED', titular: 'ALGUIEN' }] }],
    });
    if (r?.kind !== 'BY_SLOT') throw new Error('tipo');
    expect(r.cupos[0].filas).toEqual([]);
  });
});

describe('combinarEvidenciaHis', () => {
  const doc = resolverRespuestaHis('BY_DOCUMENT', { patientDocuments: ['1088123456'], fromIso: DESDE, toIso: HASTA }, [filaCruda()])!;
  const cupo = resolverRespuestaHis('BY_SLOT', { slots: [{ doctorExternalKey: '76', startTimeIso: INI }], compareDocuments: ['1088123456'] }, [filaCruda()])!;

  it('junta la búsqueda por documento y la de cupos', () => {
    const ev = combinarEvidenciaHis([doc, cupo], '2026-09-21T15:00:00.000Z');
    expect(ev.consultadoIso).toBe('2026-09-21T15:00:00.000Z');
    expect(ev.porDocumento?.citas).toHaveLength(1);
    expect(ev.cupos).toHaveLength(1);
  });

  it('sin búsqueda por documento: porDocumento es null (no se preguntó), no una lista vacía', () => {
    expect(combinarEvidenciaHis([cupo], 'x').porDocumento).toBeNull();
  });

  it('sin búsqueda por cupos: cupos vacío', () => {
    expect(combinarEvidenciaHis([doc], 'x').cupos).toEqual([]);
  });

  it('varias búsquedas por cupo se concatenan', () => {
    expect(combinarEvidenciaHis([cupo, cupo], 'x').cupos).toHaveLength(2);
  });
});
