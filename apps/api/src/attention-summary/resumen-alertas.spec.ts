import { fallaDePlantilla, haceCuanto } from './resumen-alertas';
import { TEXTOS_RESUMEN, conArticulo } from './resumen-textos';

describe('fallaDePlantilla: los errores que dicen que la plantilla no se puede usar', () => {
  it('reconoce la plantilla sin registrar, sin las 2 variables y los códigos de plantilla de Meta', () => {
    expect(fallaDePlantilla('template-not-configured')).toBe(
      'no está registrada en Configuración › Canales e IA',
    );
    expect(fallaDePlantilla('body-params-mismatch')).toContain('2 variables');
    expect(
      fallaDePlantilla(
        '{"error":{"message":"(#132015) Template is paused","code":132015}}',
      ),
    ).toBe('Meta pausó la plantilla por baja calidad (código 132015)');
    expect(fallaDePlantilla('{"error":{"code": 132016}}')).toContain(
      'deshabilitó',
    );
    expect(fallaDePlantilla('{"error":{"code":132001}}')).toContain(
      'no encuentra la plantilla',
    );
    expect(fallaDePlantilla('{"error":{"code":132000}}')).toContain('botones');
  });

  it('lo que no es de la plantilla no cuenta: un número sin WhatsApp, una caída de Meta', () => {
    expect(fallaDePlantilla('{"error":{"code":131026}}')).toBeNull();
    expect(fallaDePlantilla('timeout of 10000ms exceeded')).toBeNull();
    expect(fallaDePlantilla(undefined)).toBeNull();
  });
});

describe('haceCuanto', () => {
  const ahora = new Date('2026-11-19T15:00:00.000Z');
  it('minutos, y horas con minutos', () => {
    expect(haceCuanto(new Date('2026-11-19T14:15:00.000Z'), ahora)).toBe(
      'hace 45 min',
    );
    expect(haceCuanto(new Date('2026-11-19T11:40:00.000Z'), ahora)).toBe(
      'hace 3 h 20 min',
    );
    expect(haceCuanto(new Date('2026-11-19T13:00:00.000Z'), ahora)).toBe(
      'hace 2 h',
    );
  });
});

describe('el aviso dentro de la ventana es el de la plantilla aprobada (B6)', () => {
  it('con el artículo del nombre de la clínica', () => {
    expect(conArticulo('Hospital San Vicente de Paúl')).toBe(
      'el Hospital San Vicente de Paúl',
    );
    expect(conArticulo('Clínica del Café')).toBe('la Clínica del Café');
    expect(conArticulo('E.S.E. Hospital San Vicente de Paúl')).toBe(
      'la E.S.E. Hospital San Vicente de Paúl',
    );
    expect(conArticulo('AgenIA')).toBe('AgenIA');
    expect(conArticulo('  ')).toBe('el hospital');
  });

  it('el texto de Meta, con el botón que corresponde', () => {
    expect(
      TEXTOS_RESUMEN.avisoEnVentana(
        'Ana',
        'lunes, 10 de noviembre',
        'Hospital San Vicente de Paúl',
        'Recibir mis documentos',
      ),
    ).toBe(
      'Hola Ana. Los documentos de su consulta del lunes, 10 de noviembre en el Hospital San Vicente de Paúl ya están listos: el resumen de la atención y, si se los ordenaron, la fórmula, las órdenes de exámenes, la remisión o la incapacidad. Toque «Recibir mis documentos» para recibirlos en este chat.',
    );
  });
});
