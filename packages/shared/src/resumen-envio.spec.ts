import {
  CORREOS_DE_RELLENO_POR_DEFECTO,
  EXCLUSIONES_POR_DEFECTO,
  correoDeDestino,
  correoUtilizable,
  leerCorreosDeRelleno,
  aplicarCambioDeEnvio,
  candidatosDeDestino,
  celularParaWhatsapp,
  dentroDelHorario,
  enmascararDestino,
  entregaDelPayload,
  intencionDeResumenes,
  leerExclusiones,
  motivoDeExclusion,
  payloadDeEntrega,
  pideSusDocumentos,
} from './resumen-envio';
import { leerConfigResumenAtencion, type ResumenAtencionHis } from './resumen-atencion';

// Envío del resumen (Fase 4). Lo que se fija: lo sensible no sale (D7), el
// número de WhatsApp sale en el orden del plan (D5, D6), el horario, y que el
// panel solo enciende «Enviar» en modo prueba mientras no se apruebe el piloto.

function resumen(c: Partial<ResumenAtencionHis> = {}, edad = 46): ResumenAtencionHis {
  return {
    version: 1,
    historia: { numero: '1', guardadaIso: '2026-11-01T14:00:00.000Z', servicio: 'S39141', nombreServicio: 'CONSULTA MEDICINA GENERAL', plantilla: null, codigoPlantilla: null, nombrePlantilla: null, especialidad: 'MEDICINA GENERAL', edad },
    paciente: { documento: '900000001', tipoDocumento: 'CC', nombre: 'ADULTO PRUEBA', fechaNacimientoIso: '1980-05-17', celular: '300 123 4567', correo: null, celularAcompanante: '3109876543', correoAcompanante: null },
    medico: { codigo: null, nombre: null, documento: null, registro: null },
    afiliacion: { convenio: null, administradora: null, tipoUsuario: null },
    diagnosticos: [{ cie10: 'I10X', descripcion: 'HTA', tipo: null, principal: true }],
    ordenes: [], remisiones: [], incapacidades: [], interconsultas: [], indicaciones: [], campos: [],
    ...c,
  };
}

describe('botón y «mis documentos»', () => {
  it('el código del botón lleva el envío y solo se acepta si es de un resumen', () => {
    const id = '6f9619ff-8b86-d011-b42d-00cf4fc964ff';
    expect(entregaDelPayload(payloadDeEntrega(id))).toBe(id);
    expect(entregaDelPayload('resumen:../x')).toBeNull();
    expect(entregaDelPayload('Recibir mis documentos')).toBeNull();
    expect(entregaDelPayload(undefined)).toBeNull();
  });

  it.each([
    ['mis documentos', true],
    ['Mis Documentos', true],
    ['documentos', true],
    ['quiero mis documentos', true],
    ['envíame los documentos', true],
    ['necesito una cita para mis documentos de la EPS', false],
    ['hola', false],
  ])('«%s» → %s', (t, esperado) => expect(pideSusDocumentos(t)).toBe(esperado));
});

describe('exclusiones (D7)', () => {
  const ex = EXCLUSIONES_POR_DEFECTO;
  it('salud mental, VIH, ITS, violencia: no se envían; el motivo dice el código, no el diagnóstico', () => {
    expect(motivoDeExclusion(resumen({ diagnosticos: [{ cie10: 'F412', descripcion: 'ANSIEDAD', tipo: null, principal: false }] }), ex)).toBe(
      'Diagnóstico excluido (F)',
    );
    expect(motivoDeExclusion(resumen({ diagnosticos: [{ cie10: 'B24X', descripcion: null, tipo: null, principal: true }] }), ex)).toBe(
      'Diagnóstico excluido (B24)',
    );
    expect(motivoDeExclusion(resumen({ diagnosticos: [{ cie10: 'Z04.4', descripcion: null, tipo: null, principal: true }] }), ex)).toBe(
      'Diagnóstico excluido (Z044)',
    );
    expect(motivoDeExclusion(resumen({ diagnosticos: [{ cie10: 'A630', descripcion: null, tipo: null, principal: true }] }), ex)).toBe(
      'Diagnóstico excluido (A63)',
    );
  });

  it('una remisión a psiquiatría o una consulta de psicología tampoco', () => {
    const remision = { numero: '1', fechaIso: null, remiteA: null, servicioPedido: null, cups: '890284', prioridad: null, motivo: null, observaciones: null, casoClinicoCaracteres: 0 };
    expect(motivoDeExclusion(resumen({ remisiones: [remision] }), ex)).toBe('Remisión excluida (890284)');
    const r = resumen();
    r.historia.especialidad = 'Psicología';
    expect(motivoDeExclusion(r, ex)).toBe('Especialidad excluida (PSICOLOG)');
  });

  it('hipertensión en medicina general: se envía', () => {
    expect(motivoDeExclusion(resumen(), ex)).toBeNull();
  });

  it('la lista se configura; sin configurar, la del plan', () => {
    expect(leerExclusiones(null)).toEqual(EXCLUSIONES_POR_DEFECTO);
    expect(leerExclusiones({ exclusiones: { cie10: ['f41.2'] } })).toEqual({ ...EXCLUSIONES_POR_DEFECTO, cie10: ['F412'] });
  });
});

describe('a qué número (D5, D6)', () => {
  it('celular colombiano con el 57; un fijo no sirve', () => {
    expect(celularParaWhatsapp('300 123 4567')).toBe('573001234567');
    expect(celularParaWhatsapp('+57 300-123-4567')).toBe('573001234567');
    expect(celularParaWhatsapp('6068533000')).toBeNull();
    expect(celularParaWhatsapp(null)).toBeNull();
  });

  it('adulto: primero el que AgenIA tiene, luego el del HIS; no el del acompañante', () => {
    expect(candidatosDeDestino({ whatsappId: '573005550000', bsuid: null }, resumen())).toEqual([
      { destino: '573005550000', origen: 'PERFIL' },
      { destino: '573001234567', origen: 'HIS' },
    ]);
  });

  it('menor de edad: el acompañante antes que el celular del HIS', () => {
    expect(candidatosDeDestino(null, resumen({}, 9))).toEqual([
      { destino: '573109876543', origen: 'ACOMPANANTE' },
      { destino: '573001234567', origen: 'HIS' },
    ]);
  });

  it('enmascara teléfono y BSUID', () => {
    expect(enmascararDestino('573001234567')).toBe('•••4567');
    expect(enmascararDestino('CO.13491208655302741918')).toBe('CO.•••1918');
  });
});

describe('horario (§3.8)', () => {
  it('de 7:00 a 20:00 en Bogotá', () => {
    const h = { desdeHora: 7, hastaHora: 20 };
    expect(dentroDelHorario(new Date('2026-11-01T11:59:00.000Z'), h, 'America/Bogota')).toBe(false); // 6:59
    expect(dentroDelHorario(new Date('2026-11-01T12:00:00.000Z'), h, 'America/Bogota')).toBe(true); // 7:00
    expect(dentroDelHorario(new Date('2026-11-02T00:59:00.000Z'), h, 'America/Bogota')).toBe(true); // 19:59
    expect(dentroDelHorario(new Date('2026-11-02T01:00:00.000Z'), h, 'America/Bogota')).toBe(false); // 20:00
  });
});

describe('aplicarCambioDeEnvio', () => {
  const leyendo = { leerDelHospital: true, servicios: { S39141: { WHATSAPP: false, TELEGRAM: false, EMAIL: false }, S39145: {} } };

  it('«Enviar» sin números del equipo no se enciende (modo prueba obligatorio)', () => {
    expect(aplicarCambioDeEnvio(leyendo, { enviar: true })).toEqual({
      ok: false,
      error: 'Mientras no se apruebe el piloto, «Enviar» solo funciona en modo prueba: agregue al menos un número del equipo.',
    });
  });

  it('con números del equipo: enciende, normaliza y dice qué cambió; no toca Telegram ni correo', () => {
    const r = aplicarCambioDeEnvio(leyendo, {
      enviar: true,
      whatsapp: true,
      serviciosWhatsapp: ['S39141'],
      destinosPrueba: ['300 123 4567', '+57 3001234567'],
    });
    if (!r.ok) throw new Error(r.error);
    const c = leerConfigResumenAtencion(r.config)!;
    expect(c.enviar).toBe(true);
    expect(c.canales).toEqual({ WHATSAPP: true, TELEGRAM: false, EMAIL: false });
    expect(c.servicios).toEqual({
      S39141: { WHATSAPP: true, TELEGRAM: false, EMAIL: false },
      S39145: { WHATSAPP: false, TELEGRAM: false, EMAIL: false },
    });
    expect(c.modoPrueba.destinos).toEqual(['573001234567']);
    expect(r.cambios).toEqual([
      'Números del modo prueba: ninguno → •••4567',
      'Canal WhatsApp: apagado → encendido',
      'WhatsApp en S39141: apagado → encendido',
      'Enviar a pacientes: apagado → encendido',
    ]);
  });

  it('quitar todos los números con «Enviar» encendido no se permite; un servicio que no se lee tampoco', () => {
    const encendido = { ...leyendo, enviar: true, modoPrueba: { destinos: ['573001234567'] } };
    expect(aplicarCambioDeEnvio(encendido, { destinosPrueba: [] }).ok).toBe(false);
    expect(aplicarCambioDeEnvio(leyendo, { serviciosWhatsapp: ['S00000'] })).toEqual({
      ok: false,
      error: 'Primero marque «Se lee» en: S00000.',
    });
    expect(aplicarCambioDeEnvio(leyendo, { destinosPrueba: ['123'] }).ok).toBe(false);
  });

  it('sin la función habilitada no hay nada que cambiar', () => {
    expect(aplicarCambioDeEnvio(null, { whatsapp: true }).ok).toBe(false);
  });
});

describe('Telegram y la baja escrita', () => {
  const leyendo = { leerDelHospital: true, servicios: { S39141: { WHATSAPP: true }, S39145: {} } };

  it('enciende Telegram por canal y por servicio sin tocar WhatsApp; acepta chats «tg:» en el modo prueba', () => {
    const r = aplicarCambioDeEnvio(leyendo, { telegram: true, serviciosTelegram: ['S39141'], destinosPrueba: ['tg:123456789', '3001234567'] });
    if (!r.ok) throw new Error(r.error);
    const c = leerConfigResumenAtencion(r.config)!;
    expect(c.canales.TELEGRAM).toBe(true);
    expect(c.servicios.S39141).toEqual({ WHATSAPP: true, TELEGRAM: true, EMAIL: false });
    expect(c.servicios.S39145).toEqual({ WHATSAPP: false, TELEGRAM: false, EMAIL: false });
    expect(c.modoPrueba.destinos).toEqual(['tg:123456789', '573001234567']);
    expect(r.cambios).toContain('Telegram en S39141: apagado → encendido');
  });

  it.each([
    ['no quiero resúmenes', 'BAJA'],
    ['No quiero recibir más los documentos', 'BAJA'],
    ['baja de resumenes', 'BAJA'],
    ['dejen de enviarme los documentos', 'BAJA'],
    ['activar resúmenes', 'ALTA'],
    ['quiero recibir los resúmenes', 'ALTA'],
    ['quiero mis documentos', null],
    ['mis documentos', null],
    ['no quiero recordatorios', null],
  ])('«%s» → %s', (t, esperado) => expect(intencionDeResumenes(t)).toBe(esperado));
});

describe('correo (§3.4, D17)', () => {
  const relleno = CORREOS_DE_RELLENO_POR_DEFECTO;

  it.each([
    ['Paciente.Real@Gmail.com', 'paciente.real@gmail.com'],
    ['pacienteshospital@gmail.com', null],
    ['notiene@gmail.com', null],
    ['no@hotmail.com', null],
    ['xxx@xxx.com', null],
    ['sin arroba', null],
    ['', null],
  ])('«%s» → %s', (c, esperado) => expect(correoUtilizable(c, relleno)).toBe(esperado));

  it('adulto: el suyo; menor: el del acompañante primero; sin ninguno, null', () => {
    const base = resumen();
    const adulto = { ...base, paciente: { ...base.paciente, correo: 'yo@gmail.com', correoAcompanante: 'mama@gmail.com' } };
    expect(correoDeDestino(adulto, relleno)).toEqual({ destino: 'yo@gmail.com', origen: 'HIS' });
    const menor = { ...adulto, historia: { ...adulto.historia, edad: 9 } };
    expect(correoDeDestino(menor, relleno)).toEqual({ destino: 'mama@gmail.com', origen: 'ACOMPANANTE' });
    const relleno97 = { ...base, paciente: { ...base.paciente, correo: 'pacienteshospital@gmail.com' } };
    expect(correoDeDestino(relleno97, relleno)).toBeNull();
  });

  it('el panel enciende el correo, acepta correos en el modo prueba y la lista de relleno', () => {
    const r = aplicarCambioDeEnvio(
      { leerDelHospital: true, servicios: { S39141: {} } },
      { correo: true, serviciosCorreo: ['S39141'], destinosPrueba: ['Equipo@Hospital.co'], correosDeRelleno: ['otro@relleno.com'] },
    );
    if (!r.ok) throw new Error(r.error);
    const c = leerConfigResumenAtencion(r.config)!;
    expect(c.canales.EMAIL).toBe(true);
    expect(c.servicios.S39141.EMAIL).toBe(true);
    expect(c.modoPrueba.destinos).toEqual(['equipo@hospital.co']);
    expect(leerCorreosDeRelleno(r.config)).toEqual(['otro@relleno.com']);
    expect(enmascararDestino('equipo@hospital.co')).toBe('e•••@hospital.co');
    expect(aplicarCambioDeEnvio({}, { correosDeRelleno: ['malo'] }).ok).toBe(false);
  });
});
