import {
  AnsermaMapping,
  MappingIncompletoError,
  fechaCitaLocal,
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
  convenios: {
    '800088702|SUBSIDIADO': 283, // Nueva EPS subsidiado
    '800088702|PYP': 489, // Nueva EPS, promoción y prevención
    '900156264|SUBSIDIADO': 467, // Sura subsidiado
    '900156264|CONTRIBUTIVO': 473, // Sura contributivo
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
    const sura = '900156264';
    expect(
      resolveConvenio(MAPPING, { epsNit: sura, patientRegime: 'SUBSIDIADO' }),
    ).toBe(467);
    expect(
      resolveConvenio(MAPPING, { epsNit: sura, patientRegime: 'CONTRIBUTIVO' }),
    ).toBe(473);
  });

  it('un servicio de PyP usa el convenio propio de PyP', () => {
    expect(
      resolveConvenio(MAPPING, {
        epsNit: '800088702',
        patientRegime: 'SUBSIDIADO',
        serviceExternalKey: 'I890301AG',
      }),
    ).toBe(489);
  });

  it('si la EPS no tiene convenio de PyP, cae al del régimen', () => {
    // Mejor facturar al contrato general que no facturar.
    expect(
      resolveConvenio(MAPPING, {
        epsNit: '900156264',
        patientRegime: 'SUBSIDIADO',
        serviceExternalKey: 'I890301AG',
      }),
    ).toBe(467);
  });

  it('con EPS pero sin régimen NO adivina: falla explícito', () => {
    expect(() =>
      resolveConvenio(MAPPING, { epsNit: '900156264' }),
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

  it('un servicio sin mapear cae al valor por defecto', () => {
    expect(resolveEspecialidad(MAPPING, 'DESCONOCIDO')).toBe('000');
    expect(resolveEspecialidad(MAPPING, undefined)).toBe('000');
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
