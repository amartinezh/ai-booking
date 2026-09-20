import {
  MOTIVOS_CONSULTA,
  clasificarBusqueda,
  enmascararDocumento,
  enmascararIdentificadorWhatsapp,
  enmascararNombre,
  escaparLike,
  esMotivoConsulta,
  variantesDeTelefono,
} from './patient-search';

describe('clasificarBusqueda', () => {
  describe('documento y/o teléfono', () => {
    it('una cédula con puntos se normaliza a dígitos', () => {
      const r = clasificarBusqueda('1.088.123.456');
      expect(r).toMatchObject({
        tipo: 'DOCUMENTO_O_TELEFONO',
        digitos: '1088123456',
      });
    });

    it('prueba el documento exacto y, si difiere, sin ceros a la izquierda', () => {
      const r = clasificarBusqueda('0012345');
      expect(r).toMatchObject({
        tipo: 'DOCUMENTO_O_TELEFONO',
        documentos: ['0012345', '12345'],
      });
    });

    it('un documento sin ceros no repite la variante', () => {
      const r = clasificarBusqueda('12345678');
      expect(r).toMatchObject({ documentos: ['12345678'] });
    });

    it('un celular de 10 dígitos también se busca con el 57 delante (así lo guarda Meta)', () => {
      const r = clasificarBusqueda('300 111 2233');
      expect(r).toMatchObject({
        tipo: 'DOCUMENTO_O_TELEFONO',
        telefonos: ['3001112233', '573001112233'],
      });
    });

    it('un teléfono con indicativo y "+" también se busca sin el 57', () => {
      const r = clasificarBusqueda('+57 (300) 111-2233');
      expect(r).toMatchObject({
        digitos: '573001112233',
        telefonos: ['573001112233', '3001112233'],
      });
    });

    it('una cédula corta NO se busca como teléfono: devolvería basura', () => {
      const r = clasificarBusqueda('1234567');
      expect(r).toMatchObject({ documentos: ['1234567'], telefonos: [] });
    });

    it.each(['0000', '000000000', '123', '1234567890123456'])(
      'rechaza %s (ni cédula ni teléfono válidos)',
      (texto) => {
        expect(clasificarBusqueda(texto).tipo).toBe('INVALIDA');
      },
    );
  });

  describe('BSUID', () => {
    it('reconoce el formato de Meta', () => {
      expect(clasificarBusqueda('CO.13491208655302741918')).toEqual({
        tipo: 'BSUID',
        valor: 'CO.13491208655302741918',
      });
    });

    it('acepta el Parent BSUID (no lo adoptamos, pero tampoco se rechaza)', () => {
      expect(clasificarBusqueda('CO.ENT.13491208655302741918').tipo).toBe(
        'BSUID',
      );
    });

    it('no confunde un nombre con punto con un BSUID', () => {
      expect(clasificarBusqueda('Ana.Perez').tipo).toBe('INVALIDA');
    });

    it('un segmento corto no basta para ser BSUID', () => {
      expect(clasificarBusqueda('CO.1234').tipo).toBe('INVALIDA');
    });
  });

  describe('nombre', () => {
    it('exige al menos dos palabras', () => {
      expect(clasificarBusqueda('María')).toMatchObject({
        tipo: 'INVALIDA',
        motivo: expect.stringContaining('al menos dos palabras'),
      });
    });

    it('dos palabras bastan, con tildes y apóstrofos', () => {
      expect(clasificarBusqueda("  María   D'Angelo ")).toEqual({
        tipo: 'NOMBRE',
        palabras: ['María', "D'Angelo"],
      });
    });

    it('una inicial suelta no cuenta como palabra: "Maria L" sigue siendo una sola', () => {
      expect(clasificarBusqueda('Maria L').tipo).toBe('INVALIDA');
    });

    it('rechaza símbolos: evita colar comodines por el nombre', () => {
      expect(clasificarBusqueda('maria % lopez').tipo).toBe('INVALIDA');
      expect(clasificarBusqueda('maria_lopez perez').tipo).toBe('INVALIDA');
    });

    it('mezclar letras y números no es un nombre ni un documento', () => {
      expect(clasificarBusqueda('maria 1234').tipo).toBe('INVALIDA');
    });
  });

  it.each([null, undefined, '', '   '])('vacío (%p) → pide escribir algo', (v) => {
    expect(clasificarBusqueda(v as never)).toMatchObject({
      tipo: 'INVALIDA',
      motivo: 'Escribe algo para buscar.',
    });
  });
});

describe('variantesDeTelefono', () => {
  it('10 dígitos → con y sin 57', () => {
    expect(variantesDeTelefono('3001112233')).toEqual([
      '3001112233',
      '573001112233',
    ]);
  });
  it('12 dígitos con 57 → con y sin él', () => {
    expect(variantesDeTelefono('573001112233')).toEqual([
      '573001112233',
      '3001112233',
    ]);
  });
  it('13 a 15 dígitos se aceptan tal cual (otros países)', () => {
    expect(variantesDeTelefono('5215512345678')).toEqual(['5215512345678']);
  });
  it.each(['123456789', '1234567890123456', 'abc', ''])(
    '%p no es teléfono',
    (v) => {
      expect(variantesDeTelefono(v)).toEqual([]);
    },
  );
});

describe('enmascarado', () => {
  it('documento: deja los últimos 4', () => {
    expect(enmascararDocumento('1088123456')).toBe('•••3456');
    expect(enmascararDocumento('1.088.123.456')).toBe('•••3456');
  });
  it('documento corto: se tapa entero, no queda nada que enseñar', () => {
    expect(enmascararDocumento('1234')).toBe('••••');
    expect(enmascararDocumento('12')).toBe('••');
  });
  it('documento vacío → null', () => {
    expect(enmascararDocumento('')).toBeNull();
    expect(enmascararDocumento(null)).toBeNull();
  });

  it('teléfono de WhatsApp: últimos 4', () => {
    expect(enmascararIdentificadorWhatsapp('573001112233')).toBe('•••2233');
  });
  it('BSUID: conserva el país y los últimos 4', () => {
    expect(enmascararIdentificadorWhatsapp('CO.13491208655302741918')).toBe(
      'CO.•••1918',
    );
  });
  it('identificador vacío → null', () => {
    expect(enmascararIdentificadorWhatsapp(' ')).toBeNull();
  });

  it('nombre: el primero entero, del resto la inicial', () => {
    expect(enmascararNombre('María López Núñez')).toBe('María L••• N•••');
  });
  it('nombre de una palabra queda igual; vacío queda vacío', () => {
    expect(enmascararNombre('Zoraida')).toBe('Zoraida');
    expect(enmascararNombre('  ')).toBe('');
    expect(enmascararNombre(null)).toBe('');
  });
  it('🔒 lo enmascarado nunca contiene el dato completo', () => {
    expect(enmascararDocumento('1088123456')).not.toContain('1088');
    expect(enmascararNombre('María López')).not.toContain('López');
  });
});

describe('escaparLike', () => {
  it('escapa los comodines: buscar "%" no devuelve a todos los pacientes', () => {
    expect(escaparLike('100%')).toBe('100\\%');
    expect(escaparLike('a_b')).toBe('a\\_b');
    expect(escaparLike('a\\b')).toBe('a\\\\b');
  });
  it('un texto normal queda igual', () => {
    expect(escaparLike('maría lópez')).toBe('maría lópez');
  });
});

describe('motivos de consulta', () => {
  it('la lista cerrada tiene los cuatro motivos del plan', () => {
    expect(MOTIVOS_CONSULTA.map((m) => m.codigo)).toEqual([
      'PACIENTE_EN_VENTANILLA',
      'RECLAMO_PQRS',
      'SOPORTE_TECNICO',
      'OTRO',
    ]);
  });
  it('esMotivoConsulta valida contra la lista', () => {
    expect(esMotivoConsulta('RECLAMO_PQRS')).toBe(true);
    expect(esMotivoConsulta('CURIOSEAR')).toBe(false);
    expect(esMotivoConsulta(undefined)).toBe(false);
  });
});
