import {
  agregarMedicion,
  aplicarCambioDeLectura,
  configResumenAtencionApagada,
  leerConfigResumenAtencion,
  LIMITES_RESUMEN_ATENCION,
  normalizarDestino,
  puedeEnviarPorCanal,
  puedeLeerDelHospital,
  resumirMediciones,
  serviciosALeer,
  validarMedicion,
  validarResumenAtencion,
  validarRevision,
  type ResumenAtencionHis,
} from './resumen-atencion';

// La regla del usuario (2026-11-01): todo nace apagado y un dato roto nunca
// enciende un envío. Estas pruebas la fijan, interruptor por interruptor.

describe('leerConfigResumenAtencion', () => {
  it('sin configuración, la función no existe', () => {
    expect(leerConfigResumenAtencion(null)).toBeNull();
    expect(leerConfigResumenAtencion(undefined)).toBeNull();
    expect(leerConfigResumenAtencion('encendido')).toBeNull();
    expect(leerConfigResumenAtencion([true])).toBeNull();
  });

  it('un objeto vacío nace con todo apagado y los valores por defecto', () => {
    const c = leerConfigResumenAtencion({});
    expect(c).toEqual({
      leerDelHospital: false,
      enviar: false,
      canales: { WHATSAPP: false, TELEGRAM: false, EMAIL: false },
      servicios: {},
      modoPrueba: { destinos: [] },
      piloto: { aprobado: false, desdeIso: null },
      calmaMinutos: 120,
      horario: { desdeHora: 7, hastaHora: 20 },
      camposPlantilla: null,
    });
    expect(configResumenAtencionApagada()).toEqual(c);
  });

  it('solo `true` enciende: "true", 1 o "sí" se leen apagados', () => {
    const c = leerConfigResumenAtencion({
      leerDelHospital: 'true',
      enviar: 1,
      canales: { WHATSAPP: 'sí', TELEGRAM: true, EMAIL: null },
      servicios: { S39141: { WHATSAPP: 1, TELEGRAM: true } },
    })!;
    expect(c.leerDelHospital).toBe(false);
    expect(c.enviar).toBe(false);
    expect(c.canales).toEqual({ WHATSAPP: false, TELEGRAM: true, EMAIL: false });
    expect(c.servicios).toEqual({ S39141: { WHATSAPP: false, TELEGRAM: true, EMAIL: false } });
  });

  it('limpia códigos de servicio y destinos, y descarta los vacíos', () => {
    const c = leerConfigResumenAtencion({
      servicios: { ' S39141-1 ': {}, '  ': { WHATSAPP: true } },
      modoPrueba: { destinos: [' 573001234567 ', '', 7, 'equipo@hospital.co'] },
    })!;
    expect(Object.keys(c.servicios)).toEqual(['S39141-1']);
    expect(c.modoPrueba.destinos).toEqual(['573001234567', 'equipo@hospital.co']);
  });

  it('calma y horario fuera de rango vuelven a los valores por defecto', () => {
    const L = LIMITES_RESUMEN_ATENCION;
    expect(leerConfigResumenAtencion({ calmaMinutos: 5 })!.calmaMinutos).toBe(L.calmaMinutosPorDefecto);
    expect(leerConfigResumenAtencion({ calmaMinutos: 90.5 })!.calmaMinutos).toBe(L.calmaMinutosPorDefecto);
    expect(leerConfigResumenAtencion({ calmaMinutos: 180 })!.calmaMinutos).toBe(180);
    expect(leerConfigResumenAtencion({ horario: { desdeHora: 20, hastaHora: 7 } })!.horario).toEqual(L.horarioPorDefecto);
    expect(leerConfigResumenAtencion({ horario: { desdeHora: 6, hastaHora: 21 } })!.horario).toEqual({ desdeHora: 6, hastaHora: 21 });
  });

  it('los campos de plantilla inválidos se descartan uno a uno', () => {
    const c = leerConfigResumenAtencion({
      camposPlantilla: [
        { plantilla: 870, grupo: 'CONDUCTA', campo: 'Anotaciones', seccion: 'Plan' },
        { plantilla: 844, grupo: '', campo: 'Conducta', seccion: 'Plan' },
        { plantilla: 'x', campo: 'MC:', seccion: 'Motivo' },
        { plantilla: 870, campo: '', seccion: 'Motivo' },
      ],
    })!;
    expect(c.camposPlantilla).toEqual([
      { plantilla: 870, grupo: 'CONDUCTA', campo: 'Anotaciones', seccion: 'Plan' },
      { plantilla: 844, grupo: null, campo: 'Conducta', seccion: 'Plan' },
    ]);
  });
});

describe('lectura', () => {
  it('solo lee con la función habilitada y «Leer del hospital» encendido', () => {
    expect(puedeLeerDelHospital(null)).toBe(false);
    expect(puedeLeerDelHospital(leerConfigResumenAtencion({}))).toBe(false);
    expect(puedeLeerDelHospital(leerConfigResumenAtencion({ leerDelHospital: true }))).toBe(true);
  });

  it('lee los servicios de la matriz, aunque tengan todos sus canales apagados', () => {
    const c = leerConfigResumenAtencion({ servicios: { 'S39141-1': {}, S39141: { WHATSAPP: true } } });
    expect(serviciosALeer(c)).toEqual(['S39141', 'S39141-1']);
    expect(serviciosALeer(null)).toEqual([]);
  });
});

describe('puedeEnviarPorCanal', () => {
  const encendida = {
    enviar: true,
    canales: { WHATSAPP: true, TELEGRAM: true, EMAIL: false },
    servicios: { S39141: { WHATSAPP: true, TELEGRAM: true }, S39145: {} },
    piloto: { aprobado: true, desdeIso: '2026-11-11T15:00:00.000Z' },
  };
  const envio = { canal: 'WHATSAPP' as const, servicio: 'S39141', destino: '573001234567' };

  it('con todo encendido para ese servicio y canal, sale', () => {
    expect(puedeEnviarPorCanal(leerConfigResumenAtencion(encendida), envio)).toEqual({ ok: true });
  });

  it('🛡️ sin números del equipo y sin el piloto aprobado no sale nada, aunque todo esté encendido', () => {
    const { piloto: _p, ...sinPiloto } = encendida;
    expect(puedeEnviarPorCanal(leerConfigResumenAtencion(sinPiloto), envio)).toEqual({ ok: false, motivo: 'PILOTO_SIN_APROBAR' });
    // Un dato roto («true» en texto) se lee sin aprobar.
    expect(puedeEnviarPorCanal(leerConfigResumenAtencion({ ...sinPiloto, piloto: { aprobado: 'true' } }), envio)).toEqual({
      ok: false,
      motivo: 'PILOTO_SIN_APROBAR',
    });
    // Con la lista del equipo manda el modo prueba, haya piloto o no.
    expect(puedeEnviarPorCanal(leerConfigResumenAtencion({ ...sinPiloto, modoPrueba: { destinos: ['573001234567'] } }), envio)).toEqual({
      ok: true,
    });
  });

  it('lee la fecha de aprobación del piloto solo si está aprobado', () => {
    expect(leerConfigResumenAtencion(encendida)?.piloto).toEqual({ aprobado: true, desdeIso: '2026-11-11T15:00:00.000Z' });
    expect(leerConfigResumenAtencion({ piloto: { aprobado: false, desdeIso: 'x' } })?.piloto).toEqual({ aprobado: false, desdeIso: null });
  });

  it('cada interruptor apagado frena con su motivo, en orden', () => {
    expect(puedeEnviarPorCanal(null, envio)).toEqual({ ok: false, motivo: 'FUNCION_INEXISTENTE' });
    expect(puedeEnviarPorCanal(leerConfigResumenAtencion({}), envio)).toEqual({ ok: false, motivo: 'ENVIO_APAGADO' });
    expect(puedeEnviarPorCanal(leerConfigResumenAtencion({ ...encendida, enviar: false }), envio)).toEqual({ ok: false, motivo: 'ENVIO_APAGADO' });
    expect(puedeEnviarPorCanal(leerConfigResumenAtencion(encendida), { ...envio, canal: 'EMAIL', destino: 'a@b.co' })).toEqual({
      ok: false,
      motivo: 'CANAL_APAGADO',
    });
  });

  it('urgencias en la matriz con sus canales apagados no envía; un servicio fuera de la matriz tampoco', () => {
    const c = leerConfigResumenAtencion(encendida);
    expect(puedeEnviarPorCanal(c, { ...envio, servicio: 'S39145' })).toEqual({ ok: false, motivo: 'SERVICIO_APAGADO' });
    expect(puedeEnviarPorCanal(c, { ...envio, servicio: 'S39150' })).toEqual({ ok: false, motivo: 'SERVICIO_APAGADO' });
    expect(puedeEnviarPorCanal(c, { ...envio, servicio: null })).toEqual({ ok: false, motivo: 'SERVICIO_APAGADO' });
  });

  it('los canales de un servicio son independientes', () => {
    const c = leerConfigResumenAtencion({ ...encendida, servicios: { S39141: { TELEGRAM: true } } });
    expect(puedeEnviarPorCanal(c, envio)).toEqual({ ok: false, motivo: 'SERVICIO_APAGADO' });
    expect(puedeEnviarPorCanal(c, { ...envio, canal: 'TELEGRAM', destino: '123' })).toEqual({ ok: true });
  });

  it('el modo prueba solo deja salir a los destinos de su lista', () => {
    const c = leerConfigResumenAtencion({ ...encendida, modoPrueba: { destinos: ['+57 300 123 4567', '987'] } });
    expect(puedeEnviarPorCanal(c, envio)).toEqual({ ok: true });
    expect(puedeEnviarPorCanal(c, { ...envio, destino: '573009999999' })).toEqual({ ok: false, motivo: 'FUERA_DE_MODO_PRUEBA' });
    expect(puedeEnviarPorCanal(c, { ...envio, canal: 'TELEGRAM', destino: '987' })).toEqual({ ok: true });
    expect(puedeEnviarPorCanal(c, { ...envio, destino: '' })).toEqual({ ok: false, motivo: 'FUERA_DE_MODO_PRUEBA' });
  });
});

describe('normalizarDestino', () => {
  it('teléfono a dígitos, correo a minúsculas, chat tal cual', () => {
    expect(normalizarDestino('WHATSAPP', '+57 (300) 123-4567')).toBe('573001234567');
    expect(normalizarDestino('EMAIL', ' Equipo@Hospital.CO ')).toBe('equipo@hospital.co');
    expect(normalizarDestino('TELEGRAM', ' 12345 ')).toBe('12345');
  });
});

describe('validarResumenAtencion', () => {
  const valido = (): ResumenAtencionHis => ({
    version: 1,
    historia: {
      numero: '2441058',
      guardadaIso: '2026-11-01T14:00:00.000Z',
      servicio: 'S39141',
      nombreServicio: null,
      plantilla: 870,
      codigoPlantilla: 'HISOO1',
      nombrePlantilla: 'CONSULTA EXTERNA',
      especialidad: null,
      edad: 46,
    },
    paciente: {
      documento: '900000001',
      tipoDocumento: 'CC',
      nombre: 'ADULTO PRUEBA',
      fechaNacimientoIso: null,
      celular: null,
      correo: null,
      celularAcompanante: null,
      correoAcompanante: null,
    },
    medico: { codigo: '95', nombre: null, documento: null, registro: null },
    afiliacion: { convenio: null, administradora: null, tipoUsuario: null },
    diagnosticos: [],
    ordenes: [],
    remisiones: [],
    incapacidades: [],
    interconsultas: [],
    indicaciones: [],
    campos: [],
  });

  it('acepta un resumen bien formado', () => {
    expect(validarResumenAtencion(valido())).toBeNull();
  });

  it('rechaza lo que la API necesita y no viene', () => {
    expect(validarResumenAtencion(null)).toBe('no es un objeto');
    expect(validarResumenAtencion({ ...valido(), version: 2 })).toBe('versión desconocida');
    expect(validarResumenAtencion({ ...valido(), historia: { ...valido().historia, numero: '12a' } })).toBe('número de historia inválido');
    expect(validarResumenAtencion({ ...valido(), historia: { ...valido().historia, guardadaIso: 'ayer' } })).toBe('fecha de la historia inválida');
    expect(validarResumenAtencion({ ...valido(), paciente: { ...valido().paciente, documento: ' ' } })).toBe('documento del paciente inválido');
    expect(validarResumenAtencion({ ...valido(), ordenes: 'ninguna' })).toBe('ordenes no es una lista');
  });

  it('rechaza lo desmedido', () => {
    const grande = valido();
    grande.indicaciones = ['x'.repeat(LIMITES_RESUMEN_ATENCION.maxCaracteresContenido)];
    expect(validarResumenAtencion(grande)).toBe('resumen demasiado grande');
    const larga = valido();
    larga.indicaciones = Array.from({ length: 301 }, () => 'x');
    expect(validarResumenAtencion(larga)).toBe('indicaciones demasiado larga');
  });
});

describe('aplicarCambioDeLectura (lo que el panel cambia en la Fase 1)', () => {
  it('enciende la lectura y agrega servicios con todos sus canales apagados', () => {
    const r = aplicarCambioDeLectura(null, { leerDelHospital: true, serviciosALeer: [' S39141 ', 'S39141-1', 'S39141'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config).toEqual({
      leerDelHospital: true,
      servicios: {
        S39141: { WHATSAPP: false, TELEGRAM: false, EMAIL: false },
        'S39141-1': { WHATSAPP: false, TELEGRAM: false, EMAIL: false },
      },
    });
    expect(r.cambios).toEqual(['Leer del hospital: apagado → encendido', 'Servicios que se leen: ninguno → S39141, S39141-1']);
  });

  it('nunca enciende «Enviar» ni un canal, y conserva el resto de la configuración', () => {
    const guardada = {
      enviar: false,
      canales: { WHATSAPP: false },
      servicios: { S39141: { WHATSAPP: true, TELEGRAM: false, EMAIL: false }, S39145: { WHATSAPP: false } },
      modoPrueba: { destinos: ['573001234567'] },
      camposPlantilla: [{ plantilla: 870, campo: 'MC:', seccion: 'Motivo' }],
    };
    const r = aplicarCambioDeLectura(guardada, { serviciosALeer: ['S39141', 'S39141-1'], ...({ enviar: true } as object) });
    if (!r.ok) throw new Error(r.error);
    expect(r.config.enviar).toBe(false);
    expect(r.config.canales).toEqual({ WHATSAPP: false });
    expect(r.config.modoPrueba).toEqual({ destinos: ['573001234567'] });
    expect(r.config.camposPlantilla).toEqual(guardada.camposPlantilla);
    // El que sigue conserva sus canales; el que sale se va; el nuevo entra apagado.
    expect(r.config.servicios).toEqual({
      S39141: { WHATSAPP: true, TELEGRAM: false, EMAIL: false },
      'S39141-1': { WHATSAPP: false, TELEGRAM: false, EMAIL: false },
    });
  });

  it('la calma fuera de rango no se guarda', () => {
    expect(aplicarCambioDeLectura({}, { calmaMinutos: 10 })).toEqual({ ok: false, error: 'La calma va de 30 a 1440 minutos.' });
    const r = aplicarCambioDeLectura({}, { calmaMinutos: 150 });
    expect(r).toEqual({ ok: true, config: { calmaMinutos: 150 }, cambios: ['Calma: 120 → 150 minutos'] });
  });

  it('sin cambios reales no reporta nada', () => {
    const r = aplicarCambioDeLectura({ leerDelHospital: true, servicios: { S39141: {} } }, { leerDelHospital: true, serviciosALeer: ['S39141'] });
    expect(r.ok && r.cambios).toEqual([]);
  });

  it('rechaza listas o códigos inválidos', () => {
    expect(aplicarCambioDeLectura({}, { serviciosALeer: 'S39141' as unknown as string[] }).ok).toBe(false);
    expect(aplicarCambioDeLectura({}, { serviciosALeer: ['X'.repeat(21)] }).ok).toBe(false);
  });
});

describe('medición de la lectura', () => {
  const AHORA = new Date('2026-11-01T15:00:00.000Z');
  const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000);

  it('valida lo que manda el agente y redondea', () => {
    expect(validarMedicion({ detectarMs: 120.6, leerMs: 0, historias: 0 })).toEqual({ detectarMs: 121, leerMs: 0, historias: 0 });
    expect(validarMedicion({ detectarMs: -1, leerMs: 0, historias: 0 })).toBeNull();
    expect(validarMedicion({ detectarMs: 10, leerMs: Number.NaN, historias: 0 })).toBeNull();
    expect(validarMedicion({ detectarMs: 10, leerMs: 5, historias: 51 })).toBeNull();
    expect(validarMedicion({ detectarMs: 3_600_001, leerMs: 5, historias: 1 })).toBeNull();
    expect(validarMedicion(null)).toBeNull();
  });

  it('se queda con las últimas vueltas y descarta lo guardado que no se entiende', () => {
    let json: unknown = { vueltas: [{ iso: 'ayer', detectarMs: 1, leerMs: 1, historias: 1 }, 'basura'] };
    for (let i = 0; i < LIMITES_RESUMEN_ATENCION.medicionesGuardadas + 5; i++) {
      json = agregarMedicion(json, { detectarMs: i, leerMs: 0, historias: 0 }, hace(0));
    }
    const vueltas = (json as { vueltas: { detectarMs: number }[] }).vueltas;
    expect(vueltas).toHaveLength(LIMITES_RESUMEN_ATENCION.medicionesGuardadas);
    expect(vueltas[vueltas.length - 1].detectarMs).toBe(LIMITES_RESUMEN_ATENCION.medicionesGuardadas + 4);
  });

  it('resume el último día: mediana y máximo; la lectura solo de las vueltas que leyeron', () => {
    let json: unknown = null;
    json = agregarMedicion(json, { detectarMs: 5000, leerMs: 9000, historias: 3 }, hace(25 * 60)); // fuera del día
    json = agregarMedicion(json, { detectarMs: 100, leerMs: 0, historias: 0 }, hace(20));
    json = agregarMedicion(json, { detectarMs: 300, leerMs: 800, historias: 4 }, hace(15));
    json = agregarMedicion(json, { detectarMs: 200, leerMs: 300, historias: 1 }, hace(10));
    expect(resumirMediciones(json, AHORA)).toEqual({
      vueltas: 3,
      historias: 5,
      detectar: { medianaMs: 200, maxMs: 300 },
      leer: { medianaMs: 550, maxMs: 800, medianaPorHistoriaMs: 250 },
      ultimaIso: hace(10).toISOString(),
    });
  });

  it('sin vueltas en el día no hay resumen; sin lecturas, la lectura va vacía', () => {
    expect(resumirMediciones(null, AHORA)).toBeNull();
    const json = agregarMedicion(null, { detectarMs: 80, leerMs: 0, historias: 0 }, hace(5));
    expect(resumirMediciones(json, AHORA)?.leer).toBeNull();
  });
});

describe('validarRevision', () => {
  it('«Correcto» no exige nota; «Con error» sí', () => {
    expect(validarRevision({ resultado: 'CORRECTO' })).toEqual({ ok: true, resultado: 'CORRECTO', nota: null });
    expect(validarRevision({ resultado: 'CON_ERROR', nota: '  ' })).toEqual({
      ok: false,
      error: 'Escriba qué está mal: con eso se corrige la lectura.',
    });
    expect(validarRevision({ resultado: 'CON_ERROR', nota: ' Falta la amoxicilina ' })).toEqual({
      ok: true,
      resultado: 'CON_ERROR',
      nota: 'Falta la amoxicilina',
    });
  });

  it('rechaza un resultado desconocido o una nota desmedida', () => {
    expect(validarRevision({ resultado: 'TAL_VEZ' }).ok).toBe(false);
    expect(validarRevision(null).ok).toBe(false);
    expect(validarRevision({ resultado: 'CORRECTO', nota: 'x'.repeat(501) }).ok).toBe(false);
  });
});
