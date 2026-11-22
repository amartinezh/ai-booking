import {
  CUERPO_PLANTILLA_EMERGENCIA,
  EJEMPLOS_PLANTILLA_EMERGENCIA,
  MAX_MENSAJE_EN_ALERTA,
  celularLegible,
  parametrosAlertaEmergencia,
  parametrosPruebaAlertaEmergencia,
  remitenteParaAlerta,
  textoLibreAlertaEmergencia,
  validarCelularEmergencia,
  validarNombreEmergencia,
  variableDePlantilla,
} from './alertas-emergencia';
import { variablesEsperadas } from './whatsapp-template-contracts';

/** 21-nov-2026 23:22 en Bogotá. */
const CUANDO = new Date('2026-11-22T04:22:10Z');

describe('el celular de quien recibe la alerta', () => {
  it.each([
    ['314 679 3010', '573146793010'],
    ['+57 314 679 3010', '573146793010'],
    ['573146793010', '573146793010'],
    ['(314) 679-3010', '573146793010'],
  ])('«%s» se guarda como %s', (entrada, phone) => {
    expect(validarCelularEmergencia(entrada)).toEqual({ ok: true, phone });
  });

  it('un fijo no sirve: no tiene WhatsApp (el caso del 606 853 8860)', () => {
    const v = validarCelularEmergencia('+57 606 853 8860');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/fijo no recibe WhatsApp/);
  });

  it.each(['', '   ', 'llamar a Ana', '300 123', '+1 305 555 0100'])('rechaza «%s»', (entrada) => {
    expect(validarCelularEmergencia(entrada).ok).toBe(false);
  });

  it('se muestra con indicativo y espacios', () => {
    expect(celularLegible('573146793010')).toBe('+57 314 679 3010');
  });
});

describe('quién es', () => {
  it('nombre o cargo, sin espacios de más', () => {
    expect(validarNombreEmergencia('  Jefe de   Urgencias ')).toEqual({ ok: true, label: 'Jefe de Urgencias' });
  });
  it.each(['', 'A', 'x'.repeat(61)])('rechaza «%s»', (entrada) => {
    expect(validarNombreEmergencia(entrada).ok).toBe(false);
  });
});

describe('la plantilla EMERGENCY_ALERT', () => {
  it('el cuerpo para Meta declara las 3 variables del contrato, en orden, y no empieza ni termina con una', () => {
    expect(CUERPO_PLANTILLA_EMERGENCIA.match(/\{\{\d\}\}/g)).toEqual(['{{1}}', '{{2}}', '{{3}}']);
    expect(variablesEsperadas('EMERGENCY_ALERT')).toBe(3);
    expect(EJEMPLOS_PLANTILLA_EMERGENCIA).toHaveLength(3);
    expect(CUERPO_PLANTILLA_EMERGENCIA.trimStart().startsWith('{{')).toBe(false);
    expect(CUERPO_PLANTILLA_EMERGENCIA.trimEnd().endsWith('}}')).toBe(false);
    expect(CUERPO_PLANTILLA_EMERGENCIA.length).toBeLessThan(1024);
  });

  it('las variables: cuándo (hora de Bogotá), el teléfono para llamar y lo que escribió', () => {
    const [cuando, telefono, mensaje] = parametrosAlertaEmergencia({
      senderId: '573104445512',
      mensaje: 'Tuve q ir por urgencias,\nse agravó el cuadro q padecía',
      cuando: CUANDO,
    });
    expect(cuando).toMatch(/sábado, 21 de noviembre a las 11:22 p\.? ?m/);
    expect(telefono).toBe('+57 310 444 5512');
    expect(mensaje).toBe('«Tuve q ir por urgencias, se agravó el cuadro q padecía»');
  });

  it('Meta rechaza saltos de línea, tabuladores y espacios seguidos en una variable', () => {
    const [, , mensaje] = parametrosAlertaEmergencia({
      senderId: '573104445512',
      mensaje: 'me duele\n\n\tel    pecho',
      cuando: CUANDO,
    });
    expect(mensaje).not.toMatch(/[\n\t]| {2,}/);
  });

  it('un mensaje largo se recorta a lo justo', () => {
    const [, , mensaje] = parametrosAlertaEmergencia({ senderId: '573104445512', mensaje: 'a'.repeat(900), cuando: CUANDO });
    expect(mensaje.length).toBeLessThanOrEqual(MAX_MENSAJE_EN_ALERTA);
    expect(mensaje.endsWith('…')).toBe(true);
  });

  it('una nota de voz sin transcripción no deja la variable vacía', () => {
    const [, , mensaje] = parametrosAlertaEmergencia({ senderId: '573104445512', mensaje: '', cuando: CUANDO });
    expect(mensaje).toMatch(/nota de voz/);
  });

  it('sin número visible (WhatsApp con usuario o Telegram) remite a la Caja Negra', () => {
    expect(remitenteParaAlerta('CO.13491208655302741918')).toMatch(/Caja Negra/);
    expect(remitenteParaAlerta('tg:123456789')).toMatch(/Telegram.*Caja Negra/);
    expect(remitenteParaAlerta('13055550100')).toBe('+13055550100');
  });

  it('la prueba se nota que es una prueba', () => {
    const p = parametrosPruebaAlertaEmergencia(CUANDO);
    expect(p).toHaveLength(3);
    expect(p[0]).toMatch(/^PRUEBA, no es un caso real/);
    expect(p.every((v) => !/[\n\t]/.test(v) && v.trim() !== '')).toBe(true);
  });

  it('el texto libre de respaldo es el mismo cuerpo con los datos', () => {
    const texto = textoLibreAlertaEmergencia(['ayer', '+57 300 000 0000', '«hola»']);
    expect(texto).toContain('Cuándo: ayer');
    expect(texto).toContain('Teléfono del paciente: +57 300 000 0000');
    expect(texto).not.toMatch(/\{\{/);
  });

  it('variableDePlantilla nunca devuelve vacío', () => {
    expect(variableDePlantilla('   \n ', 10)).toBe('-');
  });
});
