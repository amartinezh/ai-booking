import {
  aplicarCambioDeDocumentos,
  cantidadConLetras,
  cantidadEnLetras,
  comoTomarlo,
  contenidoDelResumen,
  documentosDelResumen,
  fuenteDelDocumento,
  hastaDeIncapacidad,
  leerConfigDocumentos,
  MARCA_DE_AGUA_POR_DEFECTO,
  SIN_INDICACION,
} from './resumen-documentos';
import type { OrdenResumen, RenglonMedicamentoResumen, ResumenAtencionHis } from './resumen-atencion';

// Documentos del resumen (plan §3.9, Fase 2). Lo que se fija: qué documentos
// salen (D20, una fórmula por orden: D25), la cantidad en letras en español, el
// contenido del resumen sin repetir medicamentos y la configuración del
// encabezado, con la marca de agua que no se puede quitar desde el panel (D21).

const med = (cambios: Partial<RenglonMedicamentoResumen> = {}): RenglonMedicamentoResumen => ({
  codigo: 'M1',
  nombre: 'LOSARTAN 50 MG TABLETA',
  cum: null,
  invima: null,
  medida: null,
  concentracion: '50 MG',
  forma: 'TABLETA',
  via: 'ORAL',
  cantidad: 30,
  duracionDias: 30,
  indicacion: '1 TAB VO EN LA NOCHE',
  frecuencia: null,
  entregado: false,
  ...cambios,
});

const orden = (cambios: Partial<OrdenResumen> = {}): OrdenResumen => ({
  numero: '77',
  tipo: 'MEDICAMENTOS',
  farmacia: 'AI',
  escritaIso: '2026-11-01T14:07:00.000Z',
  desdeIso: null,
  serie: null,
  vigencia: 'Vigente por 72 Horas',
  medicamentos: [med()],
  examenes: [],
  ...cambios,
});

function resumen(cambios: Partial<ResumenAtencionHis> = {}): ResumenAtencionHis {
  return {
    version: 1,
    historia: {
      numero: '2441058',
      // 9:07 a. m. en Bogotá.
      guardadaIso: '2026-11-01T14:07:31.000Z',
      servicio: 'S39141',
      nombreServicio: 'CONSULTA MEDICINA GENERAL',
      plantilla: 870,
      codigoPlantilla: null,
      nombrePlantilla: null,
      especialidad: 'MEDICINA GENERAL',
      edad: 46,
    },
    paciente: {
      documento: '900000001',
      tipoDocumento: 'CC',
      nombre: 'ADULTO PRUEBA',
      fechaNacimientoIso: '1980-05-17',
      celular: null,
      correo: null,
      celularAcompanante: null,
      correoAcompanante: null,
    },
    medico: { codigo: '95', nombre: 'MEDICO DE PRUEBA', documento: '1', registro: 'R-1' },
    afiliacion: { convenio: 'SUBS', administradora: 'EPS SURA', tipoUsuario: 'Subsidiado' },
    diagnosticos: [
      { cie10: 'E119', descripcion: 'DIABETES MELLITUS', tipo: null, principal: false },
      { cie10: 'I10X', descripcion: 'HIPERTENSION ESENCIAL', tipo: null, principal: true },
    ],
    ordenes: [],
    remisiones: [],
    incapacidades: [],
    interconsultas: [],
    indicaciones: [],
    campos: [],
    ...cambios,
  };
}

describe('documentosDelResumen', () => {
  it('el resumen siempre; una fórmula por orden; órdenes, remisiones e incapacidades; sin documento vacío', () => {
    const r = resumen({
      ordenes: [
        orden(),
        orden({ numero: '81', desdeIso: '2026-12-01T05:00:00.000Z' }),
        orden({ numero: '78', tipo: 'LABORATORIO', medicamentos: [], examenes: [{ codigo: '903841', nombre: 'GLUCOSA', cantidad: 1, indicacion: null }] }),
        orden({ numero: '79', tipo: 'PROCEDIMIENTO', medicamentos: [], examenes: [] }),
      ],
      remisiones: [
        { numero: '12', fechaIso: null, remiteA: 'HSVPA', servicioPedido: 'MEDICINA INTERNA', cups: '890266', prioridad: '1', motivo: null, observaciones: null, casoClinicoCaracteres: 0 },
      ],
      incapacidades: [{ numero: '5', desdeIso: '2026-11-01T05:00:00.000Z', dias: 3, prorroga: false, tipo: null, origen: null, observacion: null }],
    });
    expect(documentosDelResumen(r).map((d) => [d.id, d.titulo, d.nombreArchivo])).toEqual([
      ['resumen', 'Resumen de la atención', 'Resumen_01-11-2026'],
      ['formula-77', 'Fórmula médica N.º 77', 'Formula_01-11-2026_N77'],
      ['formula-81', 'Fórmula médica N.º 81', 'Formula_01-11-2026_N81'],
      ['orden-78', 'Orden de laboratorio N.º 78', 'Laboratorio_01-11-2026_N78'],
      ['remision-12', 'Remisión N.º 12', 'Remision_01-11-2026_N12'],
      ['incapacidad-5', 'Incapacidad N.º 5', 'Incapacidad_01-11-2026_N5'],
    ]);
  });

  it('ids seguros para una URL y sin repetirse', () => {
    const r = resumen({ ordenes: [orden({ numero: '7/7' }), orden({ numero: '77' })] });
    expect(documentosDelResumen(r).map((d) => d.id)).toEqual(['resumen', 'formula-77', 'formula-77-2']);
  });

  it('cada documento encuentra su orden, remisión o incapacidad', () => {
    const r = resumen({
      ordenes: [orden(), orden({ numero: '77', tipo: 'LABORATORIO', medicamentos: [], examenes: [{ codigo: 'X', nombre: 'X', cantidad: 1, indicacion: null }] })],
    });
    const [, formula, lab] = documentosDelResumen(r);
    expect(fuenteDelDocumento(r, formula)).toMatchObject({ tipo: 'FORMULA', orden: { tipo: 'MEDICAMENTOS' } });
    expect(fuenteDelDocumento(r, lab)).toMatchObject({ tipo: 'ORDEN', orden: { tipo: 'LABORATORIO' } });
    expect(fuenteDelDocumento(r, { ...lab, numero: '999' })).toBeNull();
  });
});

describe('cantidad en letras', () => {
  it.each([
    [0, 'cero'],
    [1, 'uno'],
    [16, 'dieciséis'],
    [21, 'veintiuno'],
    [30, 'treinta'],
    [45, 'cuarenta y cinco'],
    [100, 'cien'],
    [120, 'ciento veinte'],
    [500, 'quinientos'],
    [1000, 'mil'],
    [2500, 'dos mil quinientos'],
    [21000, 'veintiún mil'],
    [2.5, 'dos coma cinco'],
    [0.25, 'cero coma veinticinco'],
    [1.05, 'uno coma cero cinco'],
  ])('%s → %s', (n, letras) => expect(cantidadEnLetras(n)).toBe(letras));

  it('número y letras, con coma decimal', () => {
    expect(cantidadConLetras(30)).toBe('30 (treinta)');
    expect(cantidadConLetras(2.5)).toBe('2,5 (dos coma cinco)');
  });
});

describe('contenidoDelResumen', () => {
  it('diagnóstico principal primero; cada medicamento una vez con sus entregas posfechadas', () => {
    const r = resumen({
      campos: [
        { seccion: 'Motivo', grupo: null, campo: 'MC:', valor: 'CONTROL' },
        { seccion: 'Plan', grupo: null, campo: 'Anotaciones', valor: 'SEGUIR IGUAL' },
      ],
      indicaciones: ['CONTROL EN 3 MESES'],
      ordenes: [
        orden({ medicamentos: [med(), med({ codigo: 'M2', nombre: 'METFORMINA 850', indicacion: null, cantidad: 60, duracionDias: null })] }),
        orden({ numero: '81', desdeIso: '2026-12-01T05:00:00.000Z' }),
      ],
    });
    const s = contenidoDelResumen(r);
    expect(s.map((x) => x.titulo)).toEqual(['Diagnósticos', 'Motivo', 'Plan', 'Indicaciones del médico', 'Medicamentos']);
    expect(s[0].renglones).toEqual(['HIPERTENSION ESENCIAL (I10X) — principal', 'DIABETES MELLITUS (E119)']);
    expect(s[4].renglones).toEqual([
      'LOSARTAN 50 MG TABLETA: 1 TAB VO EN LA NOCHE (cantidad 30, 30 días). Entregas: el 01/11/2026 y desde el 01/12/2026.',
      `METFORMINA 850: ${SIN_INDICACION} (cantidad 60)`,
    ]);
  });

  it('exámenes, remisión, incapacidad con su último día e interconsulta; sin secciones vacías', () => {
    const r = resumen({
      diagnosticos: [],
      ordenes: [orden({ numero: '78', tipo: 'LABORATORIO', medicamentos: [], examenes: [{ codigo: '903841', nombre: 'GLUCOSA', cantidad: 2, indicacion: 'EN AYUNAS' }] })],
      remisiones: [
        { numero: '12', fechaIso: null, remiteA: 'HSVPA', servicioPedido: 'MEDICINA INTERNA', cups: '890266', prioridad: null, motivo: 'HTA DE DIFICIL CONTROL', observaciones: null, casoClinicoCaracteres: 0 },
      ],
      incapacidades: [{ numero: '5', desdeIso: '2026-11-01T05:00:00.000Z', dias: 3, prorroga: false, tipo: null, origen: null, observacion: null }],
      interconsultas: [{ especialidad: 'NUTRICION', observacion: null }],
    });
    expect(contenidoDelResumen(r)).toEqual([
      { titulo: 'Exámenes y procedimientos', renglones: ['GLUCOSA (903841) × 2: EN AYUNAS'] },
      { titulo: 'Remisiones', renglones: ['MEDICINA INTERNA (890266) — HTA DE DIFICIL CONTROL'] },
      { titulo: 'Incapacidad', renglones: ['3 días desde el 01/11/2026 hasta el 03/11/2026'] },
      { titulo: 'Interconsultas', renglones: ['NUTRICION'] },
    ]);
  });

  it('el último día de la incapacidad', () => {
    expect(hastaDeIncapacidad('2026-11-01T05:00:00.000Z', 1)).toBe('01/11/2026');
    expect(hastaDeIncapacidad('2026-11-30T05:00:00.000Z', 2)).toBe('01/12/2026');
    expect(hastaDeIncapacidad(null, 3)).toBeNull();
    expect(hastaDeIncapacidad('2026-11-01T05:00:00.000Z', 0)).toBeNull();
  });
});

describe('configuración de los documentos', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('sin configurar: encabezado vacío, sin logo y con la marca de agua', () => {
    expect(leerConfigDocumentos(null)).toEqual({
      encabezado: { nombre: null, nit: null, direccion: null, telefono: null },
      logo: null,
      marcaDeAgua: MARCA_DE_AGUA_POR_DEFECTO,
      pie: null,
      frecuenciaDelHis: false,
    });
    // Una marca vacía guardada a mano no la quita.
    expect(leerConfigDocumentos({ documentos: { marcaDeAgua: '  ' } }).marcaDeAgua).toBe(MARCA_DE_AGUA_POR_DEFECTO);
  });

  it('guarda el encabezado, el logo y el pie sin tocar lo demás, y dice qué cambió', () => {
    const guardado = { leerDelHospital: true, servicios: { S39141: {} } };
    const r = aplicarCambioDeDocumentos(guardado, { nombre: ' E.S.E. Hospital San Vicente de Paúl ', nit: '890.801.099-1', logo: PNG });
    if (!r.ok) throw new Error(r.error);
    expect(r.config.leerDelHospital).toBe(true);
    expect(r.config.servicios).toEqual({ S39141: {} });
    const leido = leerConfigDocumentos(r.config);
    expect(leido.encabezado).toEqual({ nombre: 'E.S.E. Hospital San Vicente de Paúl', nit: '890.801.099-1', direccion: null, telefono: null });
    expect(leido.logo).toBe(PNG);
    expect(r.cambios).toEqual([
      'Nombre del hospital: «» → «E.S.E. Hospital San Vicente de Paúl»',
      'NIT: «» → «890.801.099-1»',
      'Logo cambiado',
    ]);
  });

  it('el logo debe ser PNG o JPEG y no desmedido; vacío lo quita; la marca de agua no se cambia aquí', () => {
    expect(aplicarCambioDeDocumentos({}, { logo: 'R0lGODlh' }).ok).toBe(false);
    expect(aplicarCambioDeDocumentos({}, { logo: `iVBORw0KGgo${'A'.repeat(200_000)}` }).ok).toBe(false);
    const quitado = aplicarCambioDeDocumentos({ documentos: { logo: PNG } }, { logo: '' });
    expect(quitado.ok && leerConfigDocumentos(quitado.config).logo).toBeNull();
    const r = aplicarCambioDeDocumentos({}, { ...({ marcaDeAgua: '' } as object) });
    expect(r.ok && leerConfigDocumentos(r.config).marcaDeAgua).toBe(MARCA_DE_AGUA_POR_DEFECTO);
    expect(aplicarCambioDeDocumentos({}, { nombre: 'x'.repeat(121) }).ok).toBe(false);
  });
});

describe('comoTomarlo (D19)', () => {
  // El agente manda la frecuencia ya armada: «cada 24 horas». Antes salía «cada cada 24 horas».
  const sinIndicacion = { indicacion: null, frecuencia: 'cada 24 horas' };

  it('la indicación del médico tal cual, siempre primero', () => {
    expect(comoTomarlo({ indicacion: ' 1 TAB VO EN LA NOCHE ', frecuencia: 'cada 24 horas' }, true)).toBe('1 TAB VO EN LA NOCHE');
  });

  it('sin indicación y sin aprobar la frecuencia del HIS: «como se lo explicaron»', () => {
    expect(comoTomarlo(sinIndicacion, false)).toBe(SIN_INDICACION);
  });

  it('con la frecuencia aprobada: una sola vez «cada»', () => {
    expect(comoTomarlo(sinIndicacion, true)).toBe('cada 24 horas');
    expect(comoTomarlo({ indicacion: null, frecuencia: '8 horas' }, true)).toBe('cada 8 horas');
    expect(comoTomarlo({ indicacion: '', frecuencia: null }, true)).toBe(SIN_INDICACION);
  });

  it('en el resumen: sin «cada cada», y la frecuencia solo si se aprobó', () => {
    const r = resumen({ ordenes: [orden({ medicamentos: [med({ indicacion: null, frecuencia: 'cada 24 horas' })] })] });
    expect(contenidoDelResumen(r)[1].renglones[0]).toBe(`LOSARTAN 50 MG TABLETA: ${SIN_INDICACION} (cantidad 30, 30 días)`);
    const aprobada = contenidoDelResumen(r, { frecuenciaDelHis: true })[1].renglones[0];
    expect(aprobada).toBe('LOSARTAN 50 MG TABLETA: cada 24 horas (cantidad 30, 30 días)');
    expect(aprobada).not.toContain('cada cada');
  });

  it('el panel enciende y apaga la frecuencia del HIS, y lo dice', () => {
    const r = aplicarCambioDeDocumentos({}, { frecuenciaDelHis: true });
    if (!r.ok) throw new Error(r.error);
    expect(leerConfigDocumentos(r.config).frecuenciaDelHis).toBe(true);
    expect(r.cambios).toEqual(['Frecuencia del HIS cuando no hay indicación: no → sí']);
  });
});
