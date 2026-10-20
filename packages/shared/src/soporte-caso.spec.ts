import { DATO_OCULTO } from './alertas-tecnicas';
import { leerCategorias } from './alertas-tecnicas';
import { HORARIO_EQUIPO_POR_DEFECTO } from './soporte-horario';
import {
  AVISO_CASO_AL_GRUPO,
  LIMITES_CASO,
  MAX_TITULO_EN_AVISO,
  ROL_LEGIBLE,
  TEXTO_SIN_AVISO_CASO,
  estadoDelAvisoAlGrupo,
  gravedadDelAvisoDeCaso,
  motivoEsperaAvisoCaso,
  pasoDelAvisoAlGrupo,
  tocaRecordarSinTomar,
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

// Lunes 19 de octubre de 2026, hora de Colombia.
const co = (hora: string, dia = '2026-10-19') =>
  new Date(`${dia}T${hora}:00-05:00`);
const MIN = 60_000;

describe('el aviso al grupo: cuándo sale (§3.5)', () => {
  const canal = {
    enabled: true,
    categories: leerCategorias(null),
    mutedUntilIso: null,
  };

  it('qué dicen las alertas técnicas: sin grupo, apagadas, categoría apagada o en silencio', () => {
    const ahora = co('10:00');
    expect(motivoEsperaAvisoCaso(null, ahora)).toBe('SIN_CANAL');
    expect(motivoEsperaAvisoCaso(canal, ahora)).toBeNull();
    expect(motivoEsperaAvisoCaso({ ...canal, enabled: false }, ahora)).toBe(
      'APAGADO',
    );
    expect(
      motivoEsperaAvisoCaso(
        { ...canal, categories: leerCategorias({ CASOS_SOPORTE: false }) },
        ahora,
      ),
    ).toBe('CATEGORIA_APAGADA');
    // Apagar otra categoría no lo frena.
    expect(
      motivoEsperaAvisoCaso(
        { ...canal, categories: leerCategorias({ ERRORES: false }) },
        ahora,
      ),
    ).toBeNull();
    expect(
      motivoEsperaAvisoCaso(
        {
          ...canal,
          mutedUntilIso: new Date(ahora.getTime() + MIN).toISOString(),
        },
        ahora,
      ),
    ).toBe('SILENCIADO');
  });

  const caso = (
    cambios: Partial<{
      status: string;
      groupNoticeAttempts: number;
      updatedAt: Date;
    }> = {},
  ) => ({
    status: 'OPEN',
    groupNoticeAttempts: 0,
    updatedAt: co('10:00'),
    ...cambios,
  });

  it('un caso abierto y el canal listo: sale', () => {
    expect(pasoDelAvisoAlGrupo(caso(), null, co('10:00'))).toEqual({
      tipo: 'ENVIAR',
    });
  });

  it('si el canal no puede, espera (y lo dice)', () => {
    expect(pasoDelAvisoAlGrupo(caso(), 'SIN_CANAL', co('10:05'))).toEqual({
      tipo: 'ESPERAR',
      motivo: 'SIN_CANAL',
    });
  });

  it('entre intentos fallidos espera 1 min, 2 min… hasta 15', () => {
    const fallo = (n: number, min: number) =>
      pasoDelAvisoAlGrupo(
        caso({ groupNoticeAttempts: n }),
        null,
        new Date(co('10:00').getTime() + min * MIN),
      ).tipo;
    expect(fallo(1, 0.5)).toBe('ESPERAR');
    expect(fallo(1, 1)).toBe('ENVIAR');
    expect(fallo(3, 2)).toBe('ESPERAR');
    expect(fallo(3, 3)).toBe('ENVIAR');
    expect(fallo(19, 14)).toBe('ESPERAR');
    expect(fallo(19, 15)).toBe('ENVIAR');
  });

  it('no sale nunca: ya lo tomaron, pasaron 24 h quieto o falló demasiadas veces', () => {
    expect(
      pasoDelAvisoAlGrupo(caso({ status: 'IN_PROGRESS' }), null, co('10:00')),
    ).toEqual({ tipo: 'OMITIR', motivo: 'YA_TOMADO' });
    expect(
      pasoDelAvisoAlGrupo(caso(), 'SIN_CANAL', co('10:01', '2026-10-20')),
    ).toEqual({ tipo: 'OMITIR', motivo: 'VENCIDO' });
    expect(
      pasoDelAvisoAlGrupo(
        caso({ groupNoticeAttempts: AVISO_CASO_AL_GRUPO.maxIntentos }),
        null,
        co('11:00'),
      ),
    ).toEqual({ tipo: 'OMITIR', motivo: 'FALLIDO' });
  });

  it('cada motivo tiene su texto para la Mesa de Ayuda', () => {
    for (const t of Object.values(TEXTO_SIN_AVISO_CASO)) {
      expect(t.endsWith('.')).toBe(true);
    }
  });
});

describe('«lleva 2 h sin que nadie lo tome»', () => {
  const caso = (cambios: Record<string, unknown> = {}) => ({
    status: 'OPEN',
    groupNotice: 'SENT',
    groupNotifiedAt: co('09:00'),
    unattendedRemindedAt: null,
    ...cambios,
  });

  it('a las 2 h del horario del equipo, una sola vez', () => {
    expect(tocaRecordarSinTomar(caso(), co('10:59'))).toBe(false);
    expect(tocaRecordarSinTomar(caso(), co('11:00'))).toBe(true);
    expect(
      tocaRecordarSinTomar(
        caso({ unattendedRemindedAt: co('11:00') }),
        co('12:00'),
      ),
    ).toBe(false);
  });

  it('las horas de la noche no cuentan: un caso de las 16:30 se recuerda al otro día', () => {
    const tarde = caso({ groupNotifiedAt: co('16:30') });
    expect(tocaRecordarSinTomar(tarde, co('07:00', '2026-10-20'))).toBe(false);
    expect(
      tocaRecordarSinTomar(
        tarde,
        co('09:30', '2026-10-20'),
        HORARIO_EQUIPO_POR_DEFECTO,
      ),
    ).toBe(true);
  });

  it('ni tomado, ni sin aviso al grupo, ni sin fecha del aviso', () => {
    const tarde = co('15:00');
    expect(tocaRecordarSinTomar(caso({ status: 'IN_PROGRESS' }), tarde)).toBe(
      false,
    );
    expect(tocaRecordarSinTomar(caso({ groupNotice: 'PENDING' }), tarde)).toBe(
      false,
    );
    expect(tocaRecordarSinTomar(caso({ groupNotifiedAt: null }), tarde)).toBe(
      false,
    );
  });
});

describe('el estado del aviso en la Mesa de Ayuda', () => {
  const base = {
    groupNotice: 'PENDING',
    groupNotifiedAt: null,
    groupNoticeError: null,
    unattendedRemindedAt: null,
  };

  it('enviado (y si se recordó), pendiente con su motivo, sin aviso con su motivo', () => {
    expect(
      estadoDelAvisoAlGrupo({
        ...base,
        groupNotice: 'SENT',
        groupNotifiedAt: '2026-10-19T15:00:00.000Z',
        unattendedRemindedAt: '2026-10-19T17:00:00.000Z',
      }),
    ).toEqual({
      tipo: 'ENVIADO',
      cuando: new Date('2026-10-19T15:00:00.000Z'),
      recordado: new Date('2026-10-19T17:00:00.000Z'),
    });
    expect(estadoDelAvisoAlGrupo(base)).toEqual({
      tipo: 'PENDIENTE',
      motivo: null,
    });
    expect(
      estadoDelAvisoAlGrupo({
        ...base,
        groupNotice: 'SKIPPED',
        groupNoticeError: TEXTO_SIN_AVISO_CASO.VENCIDO,
      }),
    ).toEqual({ tipo: 'SIN_AVISO', motivo: TEXTO_SIN_AVISO_CASO.VENCIDO });
  });

  it('un caso de antes del asistente (omitido sin motivo) no muestra nada', () => {
    expect(
      estadoDelAvisoAlGrupo({ ...base, groupNotice: 'SKIPPED' }),
    ).toBeNull();
  });
});
