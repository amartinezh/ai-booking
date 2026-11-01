import {
  aplicarCambioDeLectura,
  configResumenAtencionApagada,
  leerConfigResumenAtencion,
  LIMITES_RESUMEN_ATENCION,
  normalizarDestino,
  puedeEnviarPorCanal,
  puedeLeerDelHospital,
  serviciosALeer,
  validarResumenAtencion,
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
  };
  const envio = { canal: 'WHATSAPP' as const, servicio: 'S39141', destino: '573001234567' };

  it('con todo encendido para ese servicio y canal, sale', () => {
    expect(puedeEnviarPorCanal(leerConfigResumenAtencion(encendida), envio)).toEqual({ ok: true });
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
