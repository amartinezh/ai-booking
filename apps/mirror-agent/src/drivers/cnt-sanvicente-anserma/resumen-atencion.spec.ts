import {
  CAMPOS_RESUMEN_POR_DEFECTO,
  detectarAtencionesTerminadas,
  isoDesdeHoraLocal,
  leerResumenesDeAtencion,
} from './resumen-atencion';
import { CntSanVicenteAnsermaDriver } from './index';
import { isAttentionSummaryCapable } from '../../core/driver.interface';

// ══════════════════════════════════════════════════════════════════════════
// Resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md). Es SQL que corre contra
// la base PRODUCTIVA del hospital, así que se prueba lo que sale hacia allá:
//
//   · solo lectura y con parámetros: ningún valor entra al texto SQL;
//   · nunca se lee el texto de dosis que arma el HIS (D19) ni el caso clínico;
//   · se quitan solo los medicamentos anulados;
//   · el cursor se detiene en la primera historia sin la calma cumplida, así que
//     ninguna se salta;
//   · la hora del hospital se pasa a UTC (Bogotá, UTC-5).
//
// Lo que estas pruebas NO dicen: cuánto pesa la consulta sobre los millones de
// filas reales. Eso lo mide P-6 en PRUEBAS antes de encender la lectura.
// ══════════════════════════════════════════════════════════════════════════

const TZ = 'America/Bogota';

interface Consulta {
  etiqueta: string;
  texto: string;
  params: Record<string, unknown>;
}

/** Pool falso: contesta según la etiqueta `/* resumen:xxx *\/` de cada consulta. */
function conPool(respuestas: Record<string, unknown[]> = {}) {
  const consultas: Consulta[] = [];
  const pool: any = {
    request() {
      const params: Record<string, unknown> = {};
      const req: any = {
        input(nombre: string, _tipo: unknown, valor: unknown) {
          params[nombre] = valor;
          return req;
        },
        async query(texto: string) {
          const etiqueta = /\/\* resumen:(\w+) \*\//.exec(texto)?.[1] ?? '?';
          consultas.push({ etiqueta, texto, params });
          return { recordset: respuestas[etiqueta] ?? [] };
        },
      };
      return req;
    },
  };
  return { pool, consultas };
}

describe('isoDesdeHoraLocal', () => {
  it('la hora del hospital (estilo 121) pasa a UTC', () => {
    expect(isoDesdeHoraLocal('2026-11-01 09:12:33.457', TZ)).toBe(
      '2026-11-01T14:12:00.000Z',
    );
    expect(isoDesdeHoraLocal(null, TZ)).toBeNull();
    expect(isoDesdeHoraLocal('ayer', TZ)).toBeNull();
  });
});

describe('detectarAtencionesTerminadas', () => {
  const HASTA = new Date('2026-11-01T15:00:00.000Z'); // 10:00 en el hospital
  const INICIO = new Date('2026-11-01T11:00:00.000Z'); // 06:00 en el hospital
  const base = {
    desde: '2441000',
    hasta: HASTA,
    inicio: INICIO,
    servicios: ['S39141', 'S39141-1'],
    limite: 50,
  };
  const fila = (
    n: number,
    hora: string,
    tipo = 'CON',
    ser = 'S39141',
    reg: number | null = 0,
  ) => ({
    n,
    fecha: `2026-11-01 ${hora}:00.000`,
    tipo,
    reg,
    ser,
  });

  it('solo las consultas ambulatorias de los servicios de la matriz; el cursor pasa también las demás filas', async () => {
    const { pool, consultas } = conPool({
      detectar: [
        fila(2441001, '08:00'),
        fila(2441002, '08:05', 'NEN', ''),
        fila(2441003, '08:10', 'CON', 'S39141', 3330),
        fila(2441004, '08:15', 'CON', 'S39145'),
        fila(2441005, '08:20', 'CON', 'S39141-1', null),
      ],
    });
    const r = await detectarAtencionesTerminadas(pool, TZ, base);
    expect(r).toEqual({ numeros: ['2441001', '2441005'], cursor: '2441005' });
    expect(consultas.map((c) => c.etiqueta)).toEqual(['detectar']);
    expect(consultas[0].params).toEqual({ desde: 2441000, filas: 2000 });
  });

  it('se detiene en la primera historia sin la calma cumplida: lo de después espera a la vuelta siguiente', async () => {
    const { pool } = conPool({
      detectar: [
        fila(2441001, '09:50'),
        fila(2441002, '10:00'),
        fila(2441003, '09:55'),
      ],
    });
    const r = await detectarAtencionesTerminadas(pool, TZ, base);
    expect(r).toEqual({ numeros: ['2441001'], cursor: '2441001' });
  });

  it('con el tope de atenciones, el cursor queda en la última que se tomó', async () => {
    const { pool } = conPool({
      detectar: [fila(1, '08:00'), fila(2, '08:01'), fila(3, '08:02')],
    });
    const r = await detectarAtencionesTerminadas(pool, TZ, {
      ...base,
      limite: 2,
    });
    expect(r).toEqual({ numeros: ['1', '2'], cursor: '2' });
  });

  it('sin filas, o con la primera aún sin calma, el cursor no se mueve', async () => {
    expect(
      await detectarAtencionesTerminadas(
        conPool({ detectar: [] }).pool,
        TZ,
        base,
      ),
    ).toEqual({ numeros: [], cursor: null });
    expect(
      await detectarAtencionesTerminadas(
        conPool({ detectar: [fila(1, '10:30')] }).pool,
        TZ,
        base,
      ),
    ).toEqual({
      numeros: [],
      cursor: null,
    });
  });

  it('la primera vez arranca en la primera historia guardada desde `inicio` (hora del hospital, ISO con T)', async () => {
    const { pool, consultas } = conPool({
      inicio: [{ n: 2440900 }],
      detectar: [fila(2440900, '06:30')],
    });
    const r = await detectarAtencionesTerminadas(pool, TZ, {
      ...base,
      desde: null,
    });
    expect(consultas.map((c) => c.etiqueta)).toEqual(['inicio', 'detectar']);
    expect(consultas[0].params).toEqual({ inicio: '2026-11-01T06:00:00' });
    expect(consultas[1].params.desde).toBe(2440899);
    expect(r.numeros).toEqual(['2440900']);
  });

  it('la primera vez sin historias desde `inicio` no mira nada más', async () => {
    const { pool, consultas } = conPool({ inicio: [] });
    expect(
      await detectarAtencionesTerminadas(pool, TZ, { ...base, desde: null }),
    ).toEqual({ numeros: [], cursor: null });
    expect(consultas).toHaveLength(1);
  });

  it('sin servicios en la matriz no le pregunta nada al HIS', async () => {
    const { pool, consultas } = conPool();
    expect(
      await detectarAtencionesTerminadas(pool, TZ, { ...base, servicios: [] }),
    ).toEqual({ numeros: [], cursor: null });
    expect(consultas).toHaveLength(0);
  });

  it('el texto SQL no lleva valores: solo nombres de parámetro, y solo lee', async () => {
    const { pool, consultas } = conPool({ inicio: [{ n: 5 }] });
    await detectarAtencionesTerminadas(pool, TZ, { ...base, desde: null });
    for (const c of consultas) {
      expect(c.texto).not.toMatch(/2026|2441|S391/);
      expect(c.texto).toMatch(/^\s*\/\*[^*]*\*\/\s*SELECT/);
      expect(c.texto).not.toMatch(/\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    }
  });
});

describe('leerResumenesDeAtencion', () => {
  const respuestas = () => ({
    cabecera: [
      {
        n: 2441058,
        fecha: '2026-11-01 09:12:33.457',
        ser: 'S39141',
        nombreSer: 'CONSULTA MEDICINA GENERAL',
        labo: 600001,
        dapl: 950001,
        plhi: 870,
        codPl: 'HISOO1',
        nomPl: 'CONSULTA EXTERNA',
        esp: 'MEDICINA GENERAL',
        edad: 46,
        doc: '900000001',
        tipoDoc: 'CC',
        n1: 'ADULTO',
        n2: '',
        a1: 'PRUEBA',
        a2: 'SISTEMAS',
        nac: '1980-03-22',
        cel: '3001234567',
        correo: 'pacienteshospital@gmail.com',
        celAcom: null,
        correoAcom: null,
        med: '95',
        nomMed: 'MEDICO DE PRUEBA',
        docMed: '24340699',
        regMed: 'MED SSO',
        conv: 'SUBS',
        adm: 'EPS SURAMERICANA S.A',
        tius: 'Subsidiado',
      },
      // Sin documento: no se puede resumir.
      { n: 2441059, fecha: '2026-11-01 09:20:00.000', doc: null },
    ],
    diagnosticos: [
      {
        labo: 600001,
        cie: 'E790',
        des: 'HIPERURICEMIA',
        tipo: 'IMPRESION DIAGNOSTICA',
      },
      {
        labo: 600001,
        cie: 'I10X',
        des: 'HIPERTENSION ESENCIAL',
        tipo: 'CONFIRMADO',
      },
    ],
    ordenes: [
      {
        n: 2441058,
        orden: 124140,
        tipo: 5,
        tiap: 'AI',
        escrita: '2026-11-01 09:14:00.000',
        desde: null,
        serie: null,
        vigencia: 'Vigente por 72 Horas',
      },
      {
        n: 2441058,
        orden: 124142,
        tipo: 5,
        tiap: 'AI',
        escrita: '2026-11-01 09:14:00.000',
        desde: '2026-12-01 00:00:00.000',
        serie: 124140,
        vigencia: 'Vigente por 72 Horas',
      },
      // Solo tenía un medicamento anulado: no es una hoja.
      {
        n: 2441058,
        orden: 124143,
        tipo: 5,
        tiap: 'AE',
        escrita: '2026-11-01 09:15:00.000',
        desde: null,
        serie: null,
        vigencia: null,
      },
      {
        n: 2441058,
        orden: 124141,
        tipo: 2,
        tiap: null,
        escrita: '2026-11-01 09:16:00.000',
        desde: null,
        serie: null,
        vigencia: null,
      },
    ],
    medicamentos: [
      {
        orden: 124140,
        cod: 'A001',
        nom: 'LOSARTAN 50 MG TABLETA',
        cum: '19937128-01',
        invima: 'M-002520',
        medida: 'TABLETA',
        ctra: '50 mg',
        forma: 'TABLETA',
        via: 'ORAL',
        cant: 60,
        dura: '90',
        ind: '1 TAB VO CADA 12 HORAS',
        cada: 12,
        unidadFrec: 'Horas',
        estado: 1,
      },
      {
        orden: 124142,
        cod: 'A001',
        nom: 'LOSARTAN 50 MG TABLETA',
        cum: null,
        invima: null,
        medida: 'TABLETA',
        ctra: '50 mg',
        forma: 'TABLETA',
        via: 'ORAL',
        cant: 60,
        dura: '90',
        ind: null,
        cada: null,
        unidadFrec: null,
        estado: 2,
      },
    ],
    examenes: [
      { orden: 124141, cod: '902210', nom: null, cant: 1, ind: 'EN AYUNAS' },
    ],
    remisiones: [
      {
        n: 2441058,
        num: 263853,
        fecha: '2026-11-01 09:17:00.000',
        remiteA: 'HSVP ANSERMA',
        servicio: 'SS VALORACION POR MEDICINA INTERNA',
        cups: '890266',
        prio: '3',
        motivo: '1',
        obs: 'SS VAL',
        caso: 6125,
      },
    ],
    incapacidades: [
      {
        n: 2441058,
        num: 9,
        desde: '2026-11-01 00:00:00.000',
        dias: 3,
        prorroga: 0,
        tipo: '1',
        origen: '1',
        obs: 'REPOSO',
      },
    ],
    interconsultas: [],
    indicaciones: [
      { n: 2441058, texto: 'CONTROL EN 3 MESES CON RESULTADOS' },
      { n: 2441058, texto: '   ' },
    ],
    campos: [
      {
        dapl: 950001,
        plhi: 870,
        grupo: 'MOTIVO DE CONSULTA',
        campo: 'MC:',
        clase: 'TEXT',
        valor: 'CONTROL DE PRESION',
      },
      {
        dapl: 950001,
        plhi: 870,
        grupo: 'CONDUCTA',
        campo: 'Anotaciones',
        clase: 'MEMO',
        valor: 'SE INDICA FORMULA MEDICA',
      },
      {
        dapl: 950001,
        plhi: 844,
        grupo: 'EDUCACIÓN',
        campo: 'Dieta hiposódica',
        clase: 'NUME',
        valor: '1',
      },
      {
        dapl: 950001,
        plhi: 844,
        grupo: 'EDUCACIÓN',
        campo: 'Aumento del ejercicio',
        clase: 'NUME',
        valor: '0',
      },
      // De otra plantilla: no está en la lista para la 870.
      {
        dapl: 950001,
        plhi: 870,
        grupo: 'OTRO',
        campo: 'Conducta',
        clase: 'TEXT',
        valor: 'no va',
      },
    ],
  });

  it('arma el resumen completo, con las horas en UTC', async () => {
    const { pool } = conPool(respuestas());
    const [r, ...resto] = await leerResumenesDeAtencion(
      pool,
      TZ,
      ['2441058', '2441059'],
      null,
    );
    expect(resto).toHaveLength(0);

    expect(r.version).toBe(1);
    expect(r.historia).toEqual({
      numero: '2441058',
      guardadaIso: '2026-11-01T14:12:00.000Z',
      servicio: 'S39141',
      nombreServicio: 'CONSULTA MEDICINA GENERAL',
      plantilla: 870,
      codigoPlantilla: 'HISOO1',
      nombrePlantilla: 'CONSULTA EXTERNA',
      especialidad: 'MEDICINA GENERAL',
      edad: 46,
    });
    expect(r.paciente).toMatchObject({
      documento: '900000001',
      tipoDocumento: 'CC',
      nombre: 'ADULTO PRUEBA SISTEMAS',
      fechaNacimientoIso: '1980-03-22',
    });
    expect(r.afiliacion).toEqual({
      convenio: 'SUBS',
      administradora: 'EPS SURAMERICANA S.A',
      tipoUsuario: 'Subsidiado',
    });
    expect(r.diagnosticos).toEqual([
      {
        cie10: 'E790',
        descripcion: 'HIPERURICEMIA',
        tipo: 'IMPRESION DIAGNOSTICA',
        principal: true,
      },
      {
        cie10: 'I10X',
        descripcion: 'HIPERTENSION ESENCIAL',
        tipo: 'CONFIRMADO',
        principal: false,
      },
    ]);
  });

  it('una hoja por orden, sin las que quedaron sin renglones; la posfechada con su fecha y su serie', async () => {
    const { pool } = conPool(respuestas());
    const [r] = await leerResumenesDeAtencion(pool, TZ, ['2441058'], null);
    expect(r.ordenes.map((o) => [o.numero, o.tipo, o.farmacia])).toEqual([
      ['124140', 'MEDICAMENTOS', 'AI'],
      ['124142', 'MEDICAMENTOS', 'AI'],
      ['124141', 'LABORATORIO', null],
    ]);
    const [hoy, posfechada, lab] = r.ordenes;
    expect(hoy.medicamentos[0]).toEqual({
      codigo: 'A001',
      nombre: 'LOSARTAN 50 MG TABLETA',
      cum: '19937128-01',
      invima: 'M-002520',
      medida: 'TABLETA',
      concentracion: '50 mg',
      forma: 'TABLETA',
      via: 'ORAL',
      cantidad: 60,
      duracionDias: 90,
      indicacion: '1 TAB VO CADA 12 HORAS',
      frecuencia: 'cada 12 horas',
      entregado: false,
    });
    expect(hoy.vigencia).toBe('Vigente por 72 Horas');
    expect(posfechada.desdeIso).toBe('2026-12-01T05:00:00.000Z');
    expect(posfechada.serie).toBe('124140');
    expect(posfechada.medicamentos[0].entregado).toBe(true);
    expect(lab.examenes).toEqual([
      {
        codigo: '902210',
        nombre: '902210',
        cantidad: 1,
        indicacion: 'EN AYUNAS',
      },
    ]);
  });

  it('remisión sin el caso clínico (solo su largo), incapacidad, indicaciones y campos de la lista', async () => {
    const { pool } = conPool(respuestas());
    const [r] = await leerResumenesDeAtencion(pool, TZ, ['2441058'], null);
    expect(r.remisiones).toEqual([
      {
        numero: '263853',
        fechaIso: '2026-11-01T14:17:00.000Z',
        remiteA: 'HSVP ANSERMA',
        servicioPedido: 'SS VALORACION POR MEDICINA INTERNA',
        cups: '890266',
        prioridad: '3',
        motivo: '1',
        observaciones: 'SS VAL',
        casoClinicoCaracteres: 6125,
      },
    ]);
    expect(r.incapacidades[0]).toMatchObject({
      numero: '9',
      dias: 3,
      prorroga: false,
      observacion: 'REPOSO',
    });
    expect(r.indicaciones).toEqual(['CONTROL EN 3 MESES CON RESULTADOS']);
    expect(r.campos).toEqual([
      {
        seccion: 'Motivo',
        grupo: 'MOTIVO DE CONSULTA',
        campo: 'MC:',
        valor: 'CONTROL DE PRESION',
      },
      {
        seccion: 'Plan',
        grupo: 'CONDUCTA',
        campo: 'Anotaciones',
        valor: 'SE INDICA FORMULA MEDICA',
      },
      {
        seccion: 'Educación',
        grupo: 'EDUCACIÓN',
        campo: 'Dieta hiposódica',
        valor: 'Sí',
      },
    ]);
  });

  it('🛡️ nunca lee el texto de dosis del HIS ni el caso clínico, y solo quita los anulados', async () => {
    const { pool, consultas } = conPool(respuestas());
    await leerResumenesDeAtencion(pool, TZ, ['2441058'], null);
    const todo = consultas.map((c) => c.texto).join('\n');
    expect(todo).not.toMatch(/DE_DOSIS_HMED/);
    expect(todo).not.toMatch(/NU_AUTO_UNVE_HMED/);
    expect(todo).not.toMatch(/(?<!DATALENGTH\(r\.)TX_CASO_HREM/);
    const meds = consultas.find((c) => c.etiqueta === 'medicamentos')!;
    expect(meds.texto).toMatch(/ISNULL\(m\.NU_ESTA_HMED, 0\) <> 0/);
  });

  it('todo va con parámetros y solo lee; los campos de la plantilla se filtran en el HIS por la lista', async () => {
    const { pool, consultas } = conPool(respuestas());
    await leerResumenesDeAtencion(pool, TZ, ['2441058'], null);
    for (const c of consultas) {
      expect(c.texto).not.toMatch(/2441058|900000001|950001|600001/);
      expect(c.texto).not.toMatch(/\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    }
    const campos = consultas.find((c) => c.etiqueta === 'campos')!;
    const conceptos = Object.entries(campos.params)
      .filter(([k]) => /^c\d+$/.test(k))
      .map(([, v]) => v);
    expect(conceptos).toEqual([
      ...new Set(CAMPOS_RESUMEN_POR_DEFECTO.map((k) => k.campo)),
    ]);
  });

  it('con campos configurados por la clínica, usa esos y no los de por defecto', async () => {
    const { pool, consultas } = conPool(respuestas());
    const [r] = await leerResumenesDeAtencion(
      pool,
      TZ,
      ['2441058'],
      [
        {
          plantilla: 870,
          grupo: null,
          campo: 'MC:',
          seccion: 'Motivo de consulta',
        },
      ],
    );
    const campos = consultas.find((c) => c.etiqueta === 'campos')!;
    expect(
      Object.entries(campos.params)
        .filter(([k]) => /^c\d+$/.test(k))
        .map(([, v]) => v),
    ).toEqual(['MC:']);
    expect(r.campos).toEqual([
      {
        seccion: 'Motivo de consulta',
        grupo: 'MOTIVO DE CONSULTA',
        campo: 'MC:',
        valor: 'CONTROL DE PRESION',
      },
    ]);
  });

  it('números inválidos o vacíos no le preguntan nada al HIS', async () => {
    const { pool, consultas } = conPool(respuestas());
    expect(await leerResumenesDeAtencion(pool, TZ, ['abc', ''], null)).toEqual(
      [],
    );
    expect(consultas).toHaveLength(0);
  });
});

describe('el driver de Anserma tiene la capacidad', () => {
  it('es reconocible por la guarda de tipo', () => {
    expect(isAttentionSummaryCapable(new CntSanVicenteAnsermaDriver())).toBe(
      true,
    );
  });
});
