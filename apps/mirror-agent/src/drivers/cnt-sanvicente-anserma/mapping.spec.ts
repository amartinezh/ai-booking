import {
  AnsermaMapping,
  MappingIncompletoError,
  fechaCitaLocal,
  feHoraCitAIso,
  formatFeHoraCit,
  mapSexo,
  resolveConvenio,
  resolveEspecialidad,
} from './mapping';

const MAPPING: AnsermaMapping = {
  lugarAtencion: '01',
  centroCostos: '007',
  marcaOrigen: 'ASIGNADA POR WHATSAPP',
  motivoAnulacion: 'WB',
  sexo: { M: 0, F: 1 },
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
    expect(mapSexo(MAPPING, 'M')).toBe(0);
    expect(mapSexo(MAPPING, 'F')).toBe(1);
  });

  it('acepta minúsculas', () => {
    expect(mapSexo(MAPPING, 'f')).toBe(1);
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
