import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AnsermaMapping,
  MappingIncompletoError,
  fechaCitaLocal,
  fechaLiteralSql,
  diaSiguienteLiteralSql,
  desenlaceDeAtencion,
  feHoraCitAIso,
  formatFeHoraCit,
  mapSexo,
  resolveConvenio,
  resolveEspecialidad,
  cuposDelTurno,
  duracionDeServicio,
  partirNombre,
  partirNombreDado,
} from './mapping';

const MAPPING: AnsermaMapping = {
  lugarAtencion: '01',
  centroCostos: '007',
  marcaOrigen: 'ASIGNADA POR WHATSAPP',
  motivoAnulacion: 'WB',
  sexo: { M: 1, F: 0 }, // confirmado contra ESEHSVP (mapping.ts, 2026-09-01)
  // NIT REALES: 900156264 = Nueva EPS, 800088702 = EPS Suramericana.
  // Estuvieron cruzados hasta el 2026-09-02, aquí y en la tabla Eps de
  // AgenIA a la vez, así que el convenio salía bien por accidente.
  convenios: {
    '900156264|SUBSIDIADO': 283, // Nueva EPS subsidiado
    '900156264|SUBSIDIADO|PYP': 489, // …y su PyP, que sí tiene convenio propio
    '900156264|CONTRIBUTIVO': 473, // Nueva EPS contributivo → el genérico
    '800088702|SUBSIDIADO': 467, // Sura subsidiado
    '800088702|CONTRIBUTIVO': 473, // Sura contributivo
  },
  convenioParticular: 26,
  serviciosPyp: ['I890301AG'],
  especialidadPorServicio: { 'S39141-1': '000', SCITOD: '461' },
  especialidadPorDefecto: '000',
  duracionMinutos: 20,
};

// ══════════════════════════════════════════════════════════════════════════
// FE_HORA_CIT es PARTE DE LA CLAVE PRIMARIA de CITAS_MEDICAS. Un formato
// distinto no da error: crea una cita que la aplicación del hospital no
// encuentra. La prueba de inserción de Fase 0 usó guiones y pasó todos los
// constraints — por eso esto se prueba carácter a carácter.
// ══════════════════════════════════════════════════════════════════════════
describe('formatFeHoraCit', () => {
  const BOGOTA = 'America/Bogota';

  it('usa BARRAS, nunca guiones', () => {
    const out = formatFeHoraCit('2026-09-03T12:20:00.000Z', BOGOTA);
    expect(out).toBe('2026/09/03 07:20');
    expect(out).not.toContain('-');
  });

  it('mide exactamente 16 caracteres', () => {
    expect(formatFeHoraCit('2026-09-03T12:20:00.000Z', BOGOTA)).toHaveLength(16);
    expect(formatFeHoraCit('2026-01-05T14:05:00.000Z', BOGOTA)).toHaveLength(16);
  });

  it('convierte de UTC a la hora del hospital', () => {
    // 12:20 UTC son las 07:20 en Bogotá — la hora que el paciente vio por
    // WhatsApp. Escribir la UTC dejaría la cita cinco horas corrida.
    expect(formatFeHoraCit('2026-09-03T12:20:00.000Z', BOGOTA)).toBe(
      '2026/09/03 07:20',
    );
  });

  it('rellena con ceros a la izquierda', () => {
    expect(formatFeHoraCit('2026-01-05T14:05:00.000Z', BOGOTA)).toBe(
      '2026/01/05 09:05',
    );
  });

  it('usa 24 horas, no am/pm', () => {
    expect(formatFeHoraCit('2026-09-03T20:30:00.000Z', BOGOTA)).toBe(
      '2026/09/03 15:30',
    );
  });

  it('la medianoche local es 00, no 24', () => {
    // 05:00 UTC son las 00:00 en Bogotá. `en-CA` con hour12:false devuelve
    // '24' en algunos entornos: eso rompería el formato y la PK.
    expect(formatFeHoraCit('2026-09-04T05:00:00.000Z', BOGOTA)).toBe(
      '2026/09/04 00:00',
    );
  });

  it('cruza bien el cambio de día hacia atrás', () => {
    // 02:00 UTC del día 4 son las 21:00 del día 3 en Bogotá.
    expect(formatFeHoraCit('2026-09-04T02:00:00.000Z', BOGOTA)).toBe(
      '2026/09/03 21:00',
    );
  });
});

describe('fechaCitaLocal', () => {
  it('devuelve el día del hospital, no el UTC', () => {
    expect(fechaCitaLocal('2026-09-04T02:00:00.000Z', 'America/Bogota')).toBe(
      '2026-09-03',
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// El convenio decide a quién se le factura la cita. Fijarlo constante habría
// facturado TODA cita de WhatsApp al contrato contributivo de Sura.
// ══════════════════════════════════════════════════════════════════════════
describe('resolveConvenio', () => {
  it('sin EPS es pago directo', () => {
    expect(resolveConvenio(MAPPING, {})).toBe(26);
  });

  it('la MISMA EPS da convenios distintos según el régimen', () => {
    const sura = '800088702';
    expect(
      resolveConvenio(MAPPING, { epsNit: sura, patientRegime: 'SUBSIDIADO' }),
    ).toBe(467);
    expect(
      resolveConvenio(MAPPING, { epsNit: sura, patientRegime: 'CONTRIBUTIVO' }),
    ).toBe(473);
  });

  it('un servicio de PyP usa el convenio propio de PyP de SU régimen', () => {
    expect(
      resolveConvenio(MAPPING, {
        epsNit: '900156264', // Nueva EPS
        patientRegime: 'SUBSIDIADO',
        serviceExternalKey: 'I890301AG',
      }),
    ).toBe(489);
  });

  it('🚨 el PyP NO se lleva al otro régimen de la misma EPS', () => {
    // El defecto que tenía la clave vieja `${nit}|PYP`: un contributivo de
    // Nueva EPS con un servicio de PyP se facturaba al 489 PYPSUBS, que es un
    // contrato SUBSIDIADO. Los datos del hospital dicen 473 (65,6% de 390
    // citas en 90 días).
    expect(
      resolveConvenio(MAPPING, {
        epsNit: '900156264', // Nueva EPS
        patientRegime: 'CONTRIBUTIVO',
        serviceExternalKey: 'I890301AG',
      }),
    ).toBe(473);
  });

  it('si esa combinación no tiene convenio de PyP, cae al del régimen', () => {
    // Es lo que hace el hospital con Sura: su PyP va al convenio normal
    // (467, 94,3% de 2.566 citas), no a uno propio.
    expect(
      resolveConvenio(MAPPING, {
        epsNit: '800088702', // Sura
        patientRegime: 'SUBSIDIADO',
        serviceExternalKey: 'I890301AG',
      }),
    ).toBe(467);
  });

  it('con EPS pero sin régimen NO adivina: falla explícito', () => {
    expect(() =>
      resolveConvenio(MAPPING, { epsNit: '800088702' }),
    ).toThrow(MappingIncompletoError);
  });

  it('tampoco adivina cuando falta el régimen y el servicio es de PyP', () => {
    // Antes la rama de PyP resolvía ANTES de exigir el régimen, así que este
    // caso devolvía un convenio en vez de fallar.
    expect(() =>
      resolveConvenio(MAPPING, {
        epsNit: '900156264',
        serviceExternalKey: 'I890301AG',
      }),
    ).toThrow(MappingIncompletoError);
  });

  it('una EPS sin homologar falla nombrándola', () => {
    expect(() =>
      resolveConvenio(MAPPING, {
        epsNit: '999999999',
        patientRegime: 'CONTRIBUTIVO',
      }),
    ).toThrow(/999999999/);
  });

  it('el mensaje del fallo dice dónde arreglarlo', () => {
    expect(() =>
      resolveConvenio(MAPPING, {
        epsNit: '999999999',
        patientRegime: 'CONTRIBUTIVO',
      }),
    ).toThrow(/mappingJson/);
  });
});

describe('mapSexo', () => {
  it('traduce las dos letras que guarda AgenIA', () => {
    // Confirmado contra ESEHSVP (mapping.ts): 1=Masculino, 0=Femenino.
    expect(mapSexo(MAPPING, 'M')).toBe(1);
    expect(mapSexo(MAPPING, 'F')).toBe(0);
  });

  it('acepta minúsculas', () => {
    expect(mapSexo(MAPPING, 'f')).toBe(0);
  });

  it('sin sexo NO inventa un valor: PACIENTES lo exige NOT NULL', () => {
    expect(() => mapSexo(MAPPING, undefined)).toThrow(MappingIncompletoError);
    expect(() => mapSexo(MAPPING, 'Other')).toThrow(MappingIncompletoError);
  });
});

describe('resolveEspecialidad', () => {
  it('sale del servicio, no del médico', () => {
    expect(resolveEspecialidad(MAPPING, 'S39141-1')).toBe('000');
    expect(resolveEspecialidad(MAPPING, 'SCITOD')).toBe('461');
  });

  it('con default declarado, un servicio sin mapear cae en él', () => {
    expect(resolveEspecialidad(MAPPING, 'DESCONOCIDO')).toBe('000');
    expect(resolveEspecialidad(MAPPING, undefined)).toBe('000');
  });

  // ── El caso que de verdad importa ────────────────────────────────────────
  // Sin default, un servicio sin homologar LANZA. Antes devolvía '000'
  // (MEDICINA GENERAL) y la cita entraba al HIS mal etiquetada sin ruido: una
  // consulta de dermatología facturada como medicina general no falla, no deja
  // rastro y se descubre cuando la EPS glosa. Es la misma política que ya
  // tenían `mapConvenio` y `mapSexo` — el hueco se grita, no se rellena.
  describe('sin especialidadPorDefecto (lo que usa Anserma)', () => {
    const SIN_DEFAULT: AnsermaMapping = {
      ...MAPPING,
      especialidadPorDefecto: undefined,
    };

    it('los servicios homologados siguen resolviendo igual', () => {
      expect(resolveEspecialidad(SIN_DEFAULT, 'S39141-1')).toBe('000');
      expect(resolveEspecialidad(SIN_DEFAULT, 'SCITOD')).toBe('461');
    });

    it('🚨 un servicio sin homologar LANZA en vez de adivinar', () => {
      expect(() => resolveEspecialidad(SIN_DEFAULT, '890350SUR')).toThrow(
        MappingIncompletoError,
      );
    });

    it('el error dice QUÉ servicio falta y DÓNDE se arregla', () => {
      expect(() => resolveEspecialidad(SIN_DEFAULT, '890350SUR')).toThrow(
        /890350SUR.*especialidadPorServicio/s,
      );
    });

    it('sin servicio tampoco se inventa nada', () => {
      expect(() => resolveEspecialidad(SIN_DEFAULT, undefined)).toThrow(
        MappingIncompletoError,
      );
    });
  });
});

// La ida y la vuelta tienen que ser exactas: un desfase de una hora aquí
// mueve la cita del paciente sin que nadie se entere.
describe('feHoraCitAIso — de la hora del hospital a UTC', () => {
  const BOGOTA = 'America/Bogota';

  it('convierte la hora local a UTC', () => {
    expect(feHoraCitAIso('2026/09/03 07:00', BOGOTA)).toBe(
      '2026-09-03T12:00:00.000Z',
    );
  });

  it('es el inverso exacto de formatFeHoraCit', () => {
    for (const iso of [
      '2026-09-03T12:20:00.000Z',
      '2026-01-05T14:05:00.000Z',
      '2026-09-04T02:00:00.000Z', // cruza el día hacia atrás
      '2026-09-04T05:00:00.000Z', // medianoche local
    ]) {
      const ida = formatFeHoraCit(iso, BOGOTA);
      expect(feHoraCitAIso(ida, BOGOTA)).toBe(iso);
    }
  });

  it('rechaza un formato que no es el del HIS', () => {
    // Data legada sucia: el mapeo documenta longitudes 12/13 e incluso '31'.
    // El LECTOR tiene que ser tolerante, pero no puede inventarse una hora.
    expect(() => feHoraCitAIso('2026-09-03 07:00', BOGOTA)).toThrow(
      MappingIncompletoError,
    );
    expect(() => feHoraCitAIso('31', BOGOTA)).toThrow(MappingIncompletoError);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Fase 2. El hospital no guarda cupos: guarda BLOQUES de turno y su aplicación
// los divide. Si esta división no coincide con la suya, AgenIA ofrece horas
// que en el hospital no existen — que es exactamente lo que pasaba con la
// agenda hecha a mano.
// ══════════════════════════════════════════════════════════════════════════
describe('cuposDelTurno', () => {
  const TZ = 'America/Bogota';
  const turno = {
    fechaLocal: '2026-09-03',
    horaInicio: '07:00',
    horaFin: '12:00',
  };

  it('divide el bloque en cupos de la duración pedida', () => {
    const cupos = cuposDelTurno(turno, 20, TZ);

    expect(cupos).toHaveLength(15); // 5 horas / 20 min
    expect(cupos[0].feHoraCit).toBe('2026/09/03 07:00');
    expect(cupos[14].feHoraCit).toBe('2026/09/03 11:40');
  });

  it('cada cupo sale en UTC, que es como viaja el protocolo', () => {
    const [primero] = cuposDelTurno(turno, 20, TZ);

    // 07:00 en Bogotá son las 12:00 UTC.
    expect(primero.startTimeIso).toBe('2026-09-03T12:00:00.000Z');
    expect(primero.endTimeIso).toBe('2026-09-03T12:20:00.000Z');
  });

  it('un resto que no alcanza para una cita completa se descarta', () => {
    // 07:00–08:10 con citas de 30 min: caben dos, y sobran 10 minutos que no
    // son un cupo. Ofrecerlos haría llegar al paciente cuando el médico ya se
    // fue.
    const cupos = cuposDelTurno(
      { ...turno, horaFin: '08:10' },
      30,
      TZ,
    );

    expect(cupos.map((c) => c.feHoraCit)).toEqual([
      '2026/09/03 07:00',
      '2026/09/03 07:30',
    ]);
  });

  it('un bloque más corto que la duración no produce ningún cupo', () => {
    expect(cuposDelTurno({ ...turno, horaFin: '07:15' }, 20, TZ)).toEqual([]);
  });

  it('el turno de la tarde también se parte bien', () => {
    const cupos = cuposDelTurno(
      { fechaLocal: '2026-09-04', horaInicio: '14:00', horaFin: '18:00' },
      20,
      TZ,
    );

    expect(cupos).toHaveLength(12);
    expect(cupos[11].feHoraCit).toBe('2026/09/04 17:40');
    // 17:40 en Bogotá son las 22:40 UTC del mismo día.
    expect(cupos[11].startTimeIso).toBe('2026-09-04T22:40:00.000Z');
  });

  it('una hora con formato raro falla en vez de inventar cupos', () => {
    expect(() => cuposDelTurno({ ...turno, horaInicio: '7 am' }, 20, TZ)).toThrow(
      /formato inesperado/,
    );
  });

  it('una fecha con formato raro también', () => {
    expect(() =>
      cuposDelTurno({ ...turno, fechaLocal: '03/09/2026' }, 20, TZ),
    ).toThrow(/formato inesperado/);
  });

  it('una duración de cero no genera un bucle infinito: falla', () => {
    expect(() => cuposDelTurno(turno, 0, TZ)).toThrow(/Duración/);
  });
});

describe('duracionDeServicio', () => {
  const base = { duracionMinutos: 20 } as never;

  it('sin override, todo dura lo mismo', () => {
    expect(duracionDeServicio(base, 'SCITOD')).toBe(20);
  });

  it('un servicio puede durar distinto sin tocar código', () => {
    const conOverride = {
      duracionMinutos: 20,
      duracionPorServicio: { SCITOD: 30 },
    } as never;

    expect(duracionDeServicio(conOverride, 'SCITOD')).toBe(30);
    expect(duracionDeServicio(conOverride, 'S39141-1')).toBe(20);
  });

  it('sin servicio, la duración general', () => {
    expect(duracionDeServicio(base)).toBe(20);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🚨 Esto rompía producción y no se veía. El driver escribía el nombre
// COMPLETO en `NO_NOMB_PAC`, que en el hospital es varchar(20) y solo guarda
// el PRIMER NOMBRE: cualquier nombre de más de 20 caracteres —o sea, casi
// todos— habría reventado el INSERT con el error 8152 de SQL Server, y el
// paciente no se habría podido dar de alta. No falló localmente porque el mock
// declaraba varchar(60). El mapeo de Fase 0 ya decía "(primer nombre)".
// ══════════════════════════════════════════════════════════════════════════
describe('partirNombre', () => {
  it('cuatro palabras: dos nombres y dos apellidos', () => {
    expect(partirNombre('JORGE ANDRES TABORDA RUIZ')).toEqual({
      primerNombre: 'JORGE',
      segundoNombre: 'ANDRES',
      primerApellido: 'TABORDA',
      segundoApellido: 'RUIZ',
    });
  });

  it('tres palabras: un nombre y los DOS apellidos', () => {
    // Ambiguo de verdad ("JUAN CARLOS PEREZ" también existe), pero en Colombia
    // los dos apellidos son el identificador legal: quien acorta suelta el
    // segundo nombre, no un apellido.
    expect(partirNombre('CARLOS ROMERO RENDON')).toEqual({
      primerNombre: 'CARLOS',
      segundoNombre: null,
      primerApellido: 'ROMERO',
      segundoApellido: 'RENDON',
    });
  });

  it('dos palabras: nombre y primer apellido', () => {
    expect(partirNombre('CARLOS ROMERO')).toEqual({
      primerNombre: 'CARLOS',
      segundoNombre: null,
      primerApellido: 'ROMERO',
      segundoApellido: null,
    });
  });

  it('una sola palabra: es el 98% de las historias viejas del hospital', () => {
    expect(partirNombre('CARLOS')).toEqual({
      primerNombre: 'CARLOS',
      segundoNombre: null,
      primerApellido: null,
      segundoApellido: null,
    });
  });

  it('lo que sobra se pega al segundo apellido', () => {
    // Los apellidos compuestos ("DE LA CRUZ") son más frecuentes que los
    // nombres de tres palabras.
    expect(partirNombre('ANA MARIA DE LA CRUZ')).toEqual({
      primerNombre: 'ANA',
      segundoNombre: 'MARIA',
      primerApellido: 'DE',
      segundoApellido: 'LA CRUZ',
    });
  });

  it('cada parte se recorta al ancho REAL de su columna', () => {
    // Es lo que evita el error 8152: la base rechaza, no trunca.
    const r = partirNombre(`${'N'.repeat(40)} ${'A'.repeat(40)}`);

    expect(r.primerNombre).toHaveLength(20); // NO_NOMB_PAC varchar(20)
    expect(r.primerApellido).toHaveLength(30); // DE_PRAP_PAC varchar(30)
  });

  it('tolera espacios de más, que es como llega de WhatsApp', () => {
    expect(partirNombre('  JORGE   ANDRES  TABORDA RUIZ ').segundoNombre).toBe(
      'ANDRES',
    );
  });

  it('sin nombre NO inventa uno: NO_NOMB_PAC es NOT NULL', () => {
    expect(() => partirNombre(undefined)).toThrow(MappingIncompletoError);
    expect(() => partirNombre('   ')).toThrow(MappingIncompletoError);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// El camino bueno: el chatbot pregunta nombres y apellidos en dos pasos, así
// que la frontera —lo único imposible de deducir— la pone el paciente.
// `partirNombre` (la heurística) queda solo para los pacientes anteriores al
// cambio y para los que no entran por WhatsApp.
// ══════════════════════════════════════════════════════════════════════════
describe('partirNombreDado', () => {
  it('reparte sin adivinar lo que el paciente ya separó', () => {
    expect(partirNombreDado('JUAN CARLOS', 'PEREZ GOMEZ')).toEqual({
      primerNombre: 'JUAN',
      segundoNombre: 'CARLOS',
      primerApellido: 'PEREZ',
      segundoApellido: 'GOMEZ',
    });
  });

  it('resuelve el caso que la heurística no podía', () => {
    // "JUAN CARLOS PEREZ" en una sola cadena es ambiguo. Partido, no lo es.
    expect(partirNombreDado('JUAN CARLOS', 'PEREZ')).toEqual({
      primerNombre: 'JUAN',
      segundoNombre: 'CARLOS',
      primerApellido: 'PEREZ',
      segundoApellido: null,
    });
    expect(partirNombreDado('JUAN', 'PEREZ GOMEZ')).toEqual({
      primerNombre: 'JUAN',
      segundoNombre: null,
      primerApellido: 'PEREZ',
      segundoApellido: 'GOMEZ',
    });
  });

  it('un solo nombre y un solo apellido', () => {
    expect(partirNombreDado('ANA', 'RIOS')).toEqual({
      primerNombre: 'ANA',
      segundoNombre: null,
      primerApellido: 'RIOS',
      segundoApellido: null,
    });
  });

  it('un apellido compuesto no se pierde', () => {
    expect(partirNombreDado('ANA', 'DE LA CRUZ').segundoApellido).toBe(
      'LA CRUZ',
    );
  });

  it('un tercer nombre tampoco se tira', () => {
    expect(partirNombreDado('MARIA DEL CARMEN', 'GOMEZ').segundoNombre).toBe(
      'DEL CARMEN',
    );
  });

  it('sin apellidos sigue siendo válido: hay pacientes así', () => {
    expect(partirNombreDado('CARLOS', undefined)).toEqual({
      primerNombre: 'CARLOS',
      segundoNombre: null,
      primerApellido: null,
      segundoApellido: null,
    });
  });

  it('recorta a los anchos reales de cada columna', () => {
    const r = partirNombreDado('N'.repeat(40), 'A'.repeat(40));

    expect(r.primerNombre).toHaveLength(20);
    expect(r.primerApellido).toHaveLength(30);
  });

  it('sin nombres NO inventa: NO_NOMB_PAC es NOT NULL', () => {
    expect(() => partirNombreDado('', 'PEREZ')).toThrow(MappingIncompletoError);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// `FE_FECH_CIT` es una fecha SIN ZONA. Un `Date` de JS es un instante, y
// `mssql` lo serializa en UTC: mandar uno le pegaba cinco horas a la fecha
// del hospital, y el resultado dependía de la zona del PROCESO — el mismo
// código escribía distinto en la VM que en un contenedor sin TZ.
// ══════════════════════════════════════════════════════════════════════════
describe('fechaLiteralSql', () => {
  it('devuelve el literal YYYYMMDD que SQL Server lee igual siempre', () => {
    expect(fechaLiteralSql('2026-09-02')).toBe('20260902');
  });

  it('el resultado NO depende de la zona del proceso', () => {
    // La prueba de que el defecto quedó cerrado: es una transformación de
    // texto, así que no hay reloj ni zona de por medio.
    const tz = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Tokyo';
      const enTokio = fechaLiteralSql('2026-09-02');
      process.env.TZ = 'UTC';
      const enUtc = fechaLiteralSql('2026-09-02');
      expect(enTokio).toBe('20260902');
      expect(enUtc).toBe('20260902');
    } finally {
      process.env.TZ = tz;
    }
  });

  it('una fecha con formato inesperado falla en vez de escribir basura', () => {
    expect(() => fechaLiteralSql('02/09/2026')).toThrow(MappingIncompletoError);
    expect(() => fechaLiteralSql('')).toThrow(MappingIncompletoError);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// El protocolo canónico viaja en el vocabulario de AgenIA, igual que las horas
// viajan en UTC. El driver mandaba `String(fila.e)` — el código crudo del
// hospital — contra un enum de Prisma que solo entiende PENDING/ATTENDED/
// NO_SHOW. Ni siquiera llegaba a escribirse: el evento moría antes.
// ══════════════════════════════════════════════════════════════════════════
describe('desenlaceDeAtencion', () => {
  it('el estado 1 es una cita atendida', () => {
    expect(desenlaceDeAtencion(1)).toBe('ATTENDED');
  });

  it('el estado 0 no es un desenlace: la cita sigue vigente', () => {
    expect(desenlaceDeAtencion(0)).toBeNull();
  });

  it('el estado 2 NO se adivina: nadie confirmó qué lo dispara', () => {
    // Escribirle mal la asistencia a un paciente es peor que no escribirla.
    expect(desenlaceDeAtencion(2)).toBeNull();
  });

  it('nunca devuelve NO_SHOW: ese camino es una cancelación con motivo NA', () => {
    // El no-show del hospital no es un estado distinto — es DELETE de
    // CITAS_MEDICAS + archivo en CITAS_ANULADAS (MAPEO_HIS.md §2.2).
    for (const estado of [0, 1, 2, 3, 9]) {
      expect(desenlaceDeAtencion(estado)).not.toBe('NO_SHOW');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// El borde superior exclusivo. Existe para poder filtrar SIN envolver la
// columna en CONVERT — envolverla impedía usar el índice que el hospital tiene
// sobre FE_FECH_CIT, sobre una tabla de 1.084.093 filas / 855 MB.
// ══════════════════════════════════════════════════════════════════════════
describe('diaSiguienteLiteralSql', () => {
  it('devuelve el día siguiente como literal YYYYMMDD', () => {
    expect(diaSiguienteLiteralSql('2026-09-02')).toBe('20260903');
  });

  it('cruza el fin de mes', () => {
    expect(diaSiguienteLiteralSql('2026-09-30')).toBe('20261001');
  });

  it('cruza el fin de año', () => {
    expect(diaSiguienteLiteralSql('2026-12-31')).toBe('20270101');
  });

  it('respeta los años bisiestos', () => {
    expect(diaSiguienteLiteralSql('2028-02-28')).toBe('20280229');
    expect(diaSiguienteLiteralSql('2028-02-29')).toBe('20280301');
    expect(diaSiguienteLiteralSql('2027-02-28')).toBe('20270301');
  });

  it('no depende de la zona del proceso', () => {
    // La suma se hace en UTC a propósito: aquí una fecha es un día del
    // calendario, no un instante.
    const tz = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Tokyo';
      expect(diaSiguienteLiteralSql('2026-09-30')).toBe('20261001');
      process.env.TZ = 'Pacific/Honolulu';
      expect(diaSiguienteLiteralSql('2026-09-30')).toBe('20261001');
    } finally {
      process.env.TZ = tz;
    }
  });

  it('una fecha mal formada falla en vez de producir un borde silencioso', () => {
    expect(() => diaSiguienteLiteralSql('30/09/2026')).toThrow(
      MappingIncompletoError,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LA TABLA DE FACTURACIÓN REAL, no una copia de laboratorio.
//
// Este bloque no usa el `MAPPING` de arriba: carga el `mapping.json` que se
// aplica de verdad a `HospitalMirrorConfig.mappingJson`. Si alguien lo edita
// mal, falla aquí y no en la factura del hospital.
//
// Y fija el resultado por NOMBRE DE EPS, no por NIT, a propósito. El NIT es
// una representación y ya estuvo mal una vez: hasta el 2026-09-02, AgenIA
// tenía Nueva EPS con el NIT de Sura y viceversa, y este archivo repetía el
// mismo cruce — los dos errores se cancelaban y el convenio salía correcto
// por accidente. Un test escrito sobre NITs no habría notado nada, ni al
// estar mal ni al arreglarse. Uno escrito sobre "qué se le factura a un
// paciente de Nueva EPS subsidiado" sí.
//
// Cuotas medidas en 90 días de citas reales del hospital (sección D de
// sql/PENDIENTE_CORRER_EN_HOSPITAL.sql, 2026-09-02).
// ══════════════════════════════════════════════════════════════════════════
describe('convenios — la tabla que se aplica en producción', () => {
  const REAL = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../docs/drivers/cnt-sanvicente-anserma/mapping.json',
      ),
      'utf8',
    ),
  ) as AnsermaMapping;

  /** NIT reales: los del hospital, que son los públicos. */
  const NIT = { 'Nueva EPS': '900156264', Sura: '800088702' } as const;
  const SERVICIO_PYP = 'I890301AG';
  const SERVICIO_NORMAL = 'S39141-1';

  it.each([
    ['Nueva EPS', 'SUBSIDIADO', SERVICIO_NORMAL, 283, 'NUEVASUBSID', '89,6%'],
    ['Nueva EPS', 'SUBSIDIADO', SERVICIO_PYP, 489, 'PYPSUBS', '94,4%'],
    ['Nueva EPS', 'CONTRIBUTIVO', SERVICIO_NORMAL, 473, 'CONTRIBUTIVO', '73,4%'],
    ['Nueva EPS', 'CONTRIBUTIVO', SERVICIO_PYP, 473, 'CONTRIBUTIVO', '65,6%'],
    ['Sura', 'SUBSIDIADO', SERVICIO_NORMAL, 467, 'SUBS', '84,5%'],
    ['Sura', 'SUBSIDIADO', SERVICIO_PYP, 467, 'SUBS', '94,3%'],
    ['Sura', 'CONTRIBUTIVO', SERVICIO_NORMAL, 473, 'CONTRIBUTIVO', '84,8%'],
    ['Sura', 'CONTRIBUTIVO', SERVICIO_PYP, 473, 'CONTRIBUTIVO', '88,0%'],
  ])(
    '%s · %s · %s → convenio %i (%s, %s de las citas reales)',
    (eps, regimen, servicio, esperado) => {
      expect(
        resolveConvenio(REAL, {
          epsNit: NIT[eps as keyof typeof NIT],
          patientRegime: regimen as string,
          serviceExternalKey: servicio as string,
        }),
      ).toBe(esperado);
    },
  );

  it('sin EPS se factura como particular (26 PARTICULARES)', () => {
    expect(resolveConvenio(REAL, {})).toBe(26);
  });

  it('🔒 la clave de PyP lleva el régimen: la vieja se lo saltaba', () => {
    const claves = Object.keys(REAL.convenios);
    expect(claves).toContain('900156264|SUBSIDIADO|PYP');
    expect(
      claves.some((k) => k.endsWith('|PYP') && k.split('|').length === 2),
    ).toBe(false);
  });

  it('🚨 ningún régimen de Nueva EPS se factura a un contrato de Sura, ni al revés', () => {
    // 283/489 son de Nueva EPS; 467 es de Sura. El 473 es el genérico de
    // contributivo que el hospital usa para las dos.
    const DE_NUEVA = [283, 489];
    const DE_SURA = [467];

    for (const regimen of ['SUBSIDIADO', 'CONTRIBUTIVO']) {
      for (const servicio of [SERVICIO_NORMAL, SERVICIO_PYP]) {
        const nueva = resolveConvenio(REAL, {
          epsNit: NIT['Nueva EPS'],
          patientRegime: regimen,
          serviceExternalKey: servicio,
        });
        const sura = resolveConvenio(REAL, {
          epsNit: NIT.Sura,
          patientRegime: regimen,
          serviceExternalKey: servicio,
        });
        expect(DE_SURA).not.toContain(nueva);
        expect(DE_NUEVA).not.toContain(sura);
      }
    }
  });

  it('una EPS que no esté en la tabla falla cerrado, nunca factura al azar', () => {
    expect(() =>
      resolveConvenio(REAL, {
        epsNit: '999999999',
        patientRegime: 'SUBSIDIADO',
      }),
    ).toThrow(MappingIncompletoError);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LAS ESPECIALIDADES DEL mapping.json REAL — invariantes, no valores sueltos.
//
// Fijar servicio por servicio no habría servido de nada: el hueco que apareció
// el 2026-09-03 eran cinco servicios que NADIE había escrito, y un test que
// enumera lo que hay no puede echar en falta lo que no está. Lo que sí lo
// detecta es una invariante sobre la FORMA del mapa.
//
// La invariante sale de la codificación CUPS nacional: `8902xx` es la consulta
// de primera vez y `8903xx` la de control DEL MISMO procedimiento. Cambia el
// momento, no la especialidad. Igual el sufijo local ESP/SUR. Así que si un
// código está mapeado, su pareja tiene que estarlo y con el mismo valor.
// ══════════════════════════════════════════════════════════════════════════
describe('especialidades — el mapa que se aplica en producción', () => {
  const REAL = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../docs/drivers/cnt-sanvicente-anserma/mapping.json',
      ),
      'utf8',
    ),
  ) as AnsermaMapping & { _especialidades: Record<string, string> };

  const ESP = REAL.especialidadPorServicio;

  /** `890266ESP` → `{ raiz: '89066', momento: '2', resto: 'ESP' }`. */
  const partirCups = (codigo: string) => {
    const m = /^(890)([23])(\d{2})(.*)$/.exec(codigo);
    return m
      ? { raiz: `${m[1]}${m[3]}`, momento: m[2], resto: m[4] }
      : null;
  };

  it('🚨 no se declara especialidadPorDefecto: un hueco tiene que gritar', () => {
    // Con default, un servicio sin homologar entra al HIS como '000' MEDICINA
    // GENERAL y nadie se entera. Ver la nota en AnsermaMapping.
    expect(REAL.especialidadPorDefecto).toBeUndefined();
    expect(() => resolveEspecialidad(REAL, '890350SUR-QUE-NO-EXISTE')).toThrow(
      MappingIncompletoError,
    );
  });

  it('🔒 primera vez y control comparten especialidad (par CUPS 8902xx/8903xx)', () => {
    const desparejados: string[] = [];

    for (const [codigo, especialidad] of Object.entries(ESP)) {
      const p = partirCups(codigo);
      if (!p) continue;

      const otro = p.momento === '2' ? '3' : '2';
      const pareja = `890${otro}${p.raiz.slice(3)}${p.resto}`;
      if (!(pareja in ESP)) continue; // la mitad que no existe no es un fallo

      if (ESP[pareja] !== especialidad) {
        desparejados.push(
          `${codigo}=${especialidad} vs ${pareja}=${ESP[pareja]}`,
        );
      }
    }

    expect(desparejados).toEqual([]);
  });

  it('🔒 el sufijo ESP/SUR tampoco cambia la especialidad', () => {
    const desparejados: string[] = [];

    for (const [codigo, especialidad] of Object.entries(ESP)) {
      if (!/(ESP|SUR)$/.test(codigo)) continue;
      const hermano = codigo.endsWith('ESP')
        ? `${codigo.slice(0, -3)}SUR`
        : `${codigo.slice(0, -3)}ESP`;
      if (!(hermano in ESP)) continue;

      if (ESP[hermano] !== especialidad) {
        desparejados.push(
          `${codigo}=${especialidad} vs ${hermano}=${ESP[hermano]}`,
        );
      }
    }

    expect(desparejados).toEqual([]);
  });

  // Las dos invariantes de arriba comparan valores, así que solo ven un par
  // MAL emparejado — no un par al que le falta una mitad, que es exactamente
  // lo que pasó con 890350SUR. Esta lo cubre: si un código CUPS está mapeado y
  // su pareja no, hay que decirlo aquí y explicar por qué. Un hueco nuevo
  // rompe el test en vez de esperar a la primera cita.
  it('🔒 un CUPS sin su pareja tiene que estar declarado, no ser un olvido', () => {
    // Los cinco de PyDT no tienen mitad de control con el MISMO sufijo: el
    // hospital la codifica con prefijo `I` (I890301AG, I890301G, I890301RN).
    const SINGLETONES_CONOCIDOS = new Set([
      '890201-CI', // PyDT crecimiento infantil
      '890201AD', // PyDT adulto
      '890201AV', // PyDT adulto y vejez
      '890201PI', // PyDT primera infancia
      '890208Ges', // PyDT gestante (psicología)
    ]);

    const huerfanos: string[] = [];
    for (const codigo of Object.keys(ESP)) {
      const p = partirCups(codigo);
      if (!p || SINGLETONES_CONOCIDOS.has(codigo)) continue;

      const otro = p.momento === '2' ? '3' : '2';
      const pareja = `890${otro}${p.raiz.slice(3)}${p.resto}`;
      if (!(pareja in ESP)) huerfanos.push(`${codigo} → falta ${pareja}`);
    }

    expect(huerfanos).toEqual([]);
  });

  it('los cinco que faltaban están, y con la especialidad de su pareja', () => {
    // Los destapó la sección G: tienen citas reales pero quedaron fuera de la
    // generación del bloque 31d, que filtraba a médicos con turnos futuros.
    expect(resolveEspecialidad(REAL, '890242ESP')).toBe('200'); // dermatología
    expect(resolveEspecialidad(REAL, '890342ESP')).toBe('200'); // …su control
    expect(resolveEspecialidad(REAL, '890342SUR')).toBe('200');
    expect(resolveEspecialidad(REAL, '890350ESP')).toBe('341'); // ginecología
    expect(resolveEspecialidad(REAL, '890350SUR')).toBe('341');
  });

  it('🔒 todo servicio de PyP tiene especialidad: es el que decide el convenio', () => {
    // Un servicio de PyP sin especialidad es doblemente malo — factura al
    // convenio de PyP y se etiqueta con la especialidad equivocada.
    const sinEspecialidad = REAL.serviciosPyp.filter((s) => !(s in ESP));
    expect(sinEspecialidad).toEqual([]);
  });

  it('🔒 ninguna especialidad apunta a un código que no existe en el catálogo', () => {
    const desconocidas = [...new Set(Object.values(ESP))].filter(
      (codigo) => !(codigo in REAL._especialidades),
    );
    expect(desconocidas).toEqual([]);
  });
});
