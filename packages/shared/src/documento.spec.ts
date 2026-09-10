import {
  normalizeDocumento,
  documentoSinCerosIniciales,
  esDocumentoValido,
} from './documento';

describe('normalizeDocumento', () => {
  it('quita puntos y espacios', () => {
    expect(normalizeDocumento('1.234.567')).toBe('1234567');
    expect(normalizeDocumento(' 1234567 ')).toBe('1234567');
  });

  it('quita cualquier caracter no numérico', () => {
    expect(normalizeDocumento('CC-1234567')).toBe('1234567');
  });

  it('NO quita ceros a la izquierda', () => {
    expect(normalizeDocumento('0012345')).toBe('0012345');
  });

  it('null/undefined/vacío dan cadena vacía', () => {
    expect(normalizeDocumento(null)).toBe('');
    expect(normalizeDocumento(undefined)).toBe('');
    expect(normalizeDocumento('')).toBe('');
  });
});

describe('documentoSinCerosIniciales', () => {
  it('quita los ceros a la izquierda', () => {
    expect(documentoSinCerosIniciales('0012345')).toBe('12345');
  });

  it('sin ceros a la izquierda, no cambia', () => {
    expect(documentoSinCerosIniciales('12345')).toBe('12345');
  });

  it('todo ceros se queda en "0", nunca en cadena vacía', () => {
    expect(documentoSinCerosIniciales('0000')).toBe('0');
    expect(documentoSinCerosIniciales('0')).toBe('0');
  });
});

describe('esDocumentoValido', () => {
  it('acepta documentos de 4 a 15 dígitos con al menos un dígito no-cero', () => {
    expect(esDocumentoValido('1234')).toBe(true);
    expect(esDocumentoValido('123456789012345')).toBe(true);
    expect(esDocumentoValido('0012345')).toBe(true); // el 0 inicial no invalida
  });

  it('rechaza fuera del rango de longitud', () => {
    expect(esDocumentoValido('123')).toBe(false); // 3 dígitos
    expect(esDocumentoValido('1234567890123456')).toBe(false); // 16 dígitos
  });

  it('rechaza todo-ceros — el defecto real que tenía el regex anterior', () => {
    // `^\d{4,15}$` a secas aceptaba estos: son historias reales del HIS del
    // hospital piloto que no son el documento de nadie.
    expect(esDocumentoValido('0000')).toBe(false);
    expect(esDocumentoValido('0000000001'.replace(/1/g, '0'))).toBe(false);
    expect(esDocumentoValido('000000000000000')).toBe(false);
  });

  it('rechaza vacío', () => {
    expect(esDocumentoValido('')).toBe(false);
  });
});
