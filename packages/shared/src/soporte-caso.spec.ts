import { DATO_OCULTO } from './alertas-tecnicas';
import {
  LIMITES_CASO,
  MAX_TITULO_EN_AVISO,
  ROL_LEGIBLE,
  gravedadDelAvisoDeCaso,
  numeroDeCaso,
  textoAvisoCasoNuevo,
  textoCasoReabierto,
  textoCasoSinTomar,
  type DatosAvisoCaso,
} from './soporte-caso';

const base: DatosAvisoCaso = {
  numero: 58,
  prioridad: 'HIGH',
  clinica: 'Hospital de Prueba',
  rol: 'BOOKING_AGENT',
  correo: 'ana@clinica.co',
  canal: 'TELEGRAM',
  titulo: 'No salen los recordatorios de hoy',
  enlace: 'https://panel.ejemplo.co/super-admin/support',
};

describe('LIMITES_CASO', () => {
  it('son los mismos que pide el formulario del panel', () => {
    expect(LIMITES_CASO).toEqual({
      tituloMin: 5,
      tituloMax: 140,
      detalleMin: 15,
    });
  });
});

describe('numeroDeCaso y ROL_LEGIBLE', () => {
  it('nombra el caso con su número', () => {
    expect(numeroDeCaso(58)).toBe('#58');
  });

  it('tiene un nombre legible para cada rol', () => {
    expect(ROL_LEGIBLE.BOOKING_AGENT).toBe('Agente de Reservas');
    expect(Object.keys(ROL_LEGIBLE).sort()).toEqual([
      'BOOKING_AGENT',
      'DOCTOR',
      'GENERAL_OBSERVER',
      'ORG_ADMIN',
      'PATIENT',
      'SUPER_ADMIN',
    ]);
  });
});

describe('gravedadDelAvisoDeCaso', () => {
  it('la prioridad alta suena siempre (CRÍTICA); la normal puede ir sin sonido de noche', () => {
    expect(gravedadDelAvisoDeCaso('HIGH')).toBe('CRITICA');
    expect(gravedadDelAvisoDeCaso('NORMAL')).toBe('ADVERTENCIA');
  });
});

describe('textoAvisoCasoNuevo', () => {
  it('dice número, prioridad, clínica, quién, por dónde, el título y el enlace', () => {
    expect(textoAvisoCasoNuevo(base)).toBe(
      [
        '🛟 Caso nuevo #58 · Prioridad ALTA',
        'Clínica: Hospital de Prueba',
        'Reporta: Agente de Reservas · ana@clinica.co · por Telegram',
        '«No salen los recordatorios de hoy»',
        'Abrir: https://panel.ejemplo.co/super-admin/support',
      ].join('\n'),
    );
  });

  it('la prioridad normal no se anuncia y el canal del panel se nombra', () => {
    const t = textoAvisoCasoNuevo({
      ...base,
      prioridad: 'NORMAL',
      canal: 'PANEL',
      rol: 'DOCTOR',
    });
    expect(t.split('\n')[0]).toBe('🛟 Caso nuevo #58');
    expect(t).toContain('Reporta: Médico · ana@clinica.co · por el panel');
  });

  it('🔒 tapa documentos, teléfonos y correos que alguien escribió en el título', () => {
    const t = textoAvisoCasoNuevo({
      ...base,
      titulo:
        'Paciente CC 1.088.123.456 tel 3001234567 escribe a pepe@correo.com',
    });
    expect(t).not.toMatch(/1\.088|3001234567|pepe@correo/);
    expect(t).toContain(DATO_OCULTO);
    // El correo de quien reporta (personal) sí va: es a quién llamar.
    expect(t).toContain('ana@clinica.co');
  });

  it('recorta un título largo y lo deja en una sola línea', () => {
    const largo = `Falla\n${'x'.repeat(300)}`;
    const linea = textoAvisoCasoNuevo({ ...base, titulo: largo }).split(
      '\n',
    )[3];
    expect(linea.startsWith('«Falla x')).toBe(true);
    expect(linea.length).toBeLessThanOrEqual(MAX_TITULO_EN_AVISO + 2);
    expect(linea.endsWith('…»')).toBe(true);
  });
});

describe('textoCasoSinTomar y textoCasoReabierto', () => {
  it('recuerda un caso sin tomar con sus horas', () => {
    const t = textoCasoSinTomar({ ...base, prioridad: 'NORMAL' }, 2);
    expect(t.split('\n')[0]).toBe(
      '⏰ El caso #58 lleva 2 h sin que nadie lo tome',
    );
    expect(t).toContain('Clínica: Hospital de Prueba');
    expect(textoCasoSinTomar(base, 1).split('\n')[0]).toBe(
      '⏰ El caso #58 lleva 1 h sin que nadie lo tome',
    );
  });

  it('anuncia un caso reabierto', () => {
    expect(textoCasoReabierto(base).split('\n')[0]).toBe(
      '🔁 Caso reabierto #58 · Prioridad ALTA',
    );
  });
});
