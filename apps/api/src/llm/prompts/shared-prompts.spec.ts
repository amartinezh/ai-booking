import {
  CLINICAL_RECORD_PROMPT,
  SCHEDULING_EXTRACTION_PROMPT,
  buildCatalogMappingPrompt,
  buildVocabularyAnchor,
  parseCatalogMappingResponse,
} from './shared-prompts';

/**
 * Los prompts son compartidos por los tres proveedores a propósito: la salida
 * estructurada tiene que ser la MISMA con Gemini, OpenAI o Claude, porque el
 * chatbot hace failover entre ellos a mitad de conversación.
 *
 * Lo que se prueba aquí no es "qué tan bien responde el modelo" —eso no es
 * determinista— sino lo que sí lo es: que el prompt contenga el catálogo real
 * del tenant, y que el parseo de la respuesta no se rompa con las envolturas
 * que los modelos añaden por su cuenta (```json, texto sobrante).
 */

describe('buildCatalogMappingPrompt', () => {
  const opciones = [
    { id: 'svc-1', name: 'Medicina General' },
    { id: 'svc-2', name: 'Odontología' },
  ];

  it('mete el catálogo REAL del tenant, id y nombre, uno por línea', () => {
    const p = buildCatalogMappingPrompt('servicios', opciones);

    expect(p).toContain('svc-1 | Medicina General');
    expect(p).toContain('svc-2 | Odontología');
  });

  it('nombra el tipo de entidad que se está mapeando', () => {
    expect(buildCatalogMappingPrompt('EPS', opciones)).toContain('EPS');
  });

  it('exige JSON limpio y prohíbe adivinar (la regla de oro contra falsos positivos)', () => {
    const p = buildCatalogMappingPrompt('servicios', opciones);
    expect(p).toContain('{"id": null}');
    expect(p).toContain('REGLA DE ORO');
    expect(p).toMatch(/sin texto adicional/i);
  });

  it('con catálogo vacío sigue siendo un prompt válido', () => {
    const p = buildCatalogMappingPrompt('servicios', []);
    expect(p).toContain('REGLA DE ORO');
    expect(p).not.toContain('undefined');
  });
});

describe('parseCatalogMappingResponse — tolerancia a lo que devuelve un LLM', () => {
  it('JSON limpio', () => {
    expect(parseCatalogMappingResponse('{"id":"svc-1"}')).toEqual({
      id: 'svc-1',
    });
  });

  it.each([
    ['bloque markdown', '```json\n{"id":"svc-1"}\n```'],
    ['bloque sin lenguaje', '```\n{"id":"svc-1"}\n```'],
    ['con espacios alrededor', '   {"id":"svc-1"}   '],
    ['JSON con el id espaciado', '{"id":"  svc-1  "}'],
  ])('%s se limpia y devuelve el id', (_e, raw) => {
    expect(parseCatalogMappingResponse(raw)).toEqual({ id: 'svc-1' });
  });

  it.each([
    ['no coincidió nada', '{"id":null}'],
    ['id vacío', '{"id":""}'],
    ['id en blanco', '{"id":"   "}'],
    ['id numérico (tipo equivocado)', '{"id":42}'],
    ['sin campo id', '{"otro":"x"}'],
    ['texto que no es JSON', 'lo siento, no puedo ayudarte con eso'],
    ['cadena vacía', ''],
    ['JSON truncado', '{"id":"svc-1"'],
  ])('%s → id null, nunca una excepción', (_e, raw) => {
    expect(parseCatalogMappingResponse(raw)).toEqual({ id: null });
  });

  it('entrada nula tampoco revienta', () => {
    expect(parseCatalogMappingResponse(null as unknown as string)).toEqual({
      id: null,
    });
  });
});

describe('buildVocabularyAnchor — anclaje al catálogo del tenant', () => {
  it('sin vocabulario devuelve vacío: no contamina el prompt', () => {
    expect(buildVocabularyAnchor()).toBe('');
    expect(buildVocabularyAnchor({})).toBe('');
    expect(
      buildVocabularyAnchor({ eps: [], services: [], letterOptions: [] }),
    ).toBe('');
  });

  it('los valores en blanco no cuentan como vocabulario', () => {
    expect(buildVocabularyAnchor({ eps: ['', '  '] })).toBe('');
  });

  it('las EPS y los servicios entran como listas al bloque de anclaje fonético', () => {
    const a = buildVocabularyAnchor({
      eps: ['Sura', 'Nueva EPS'],
      services: ['Medicina General'],
    });

    expect(a).toContain('Sura, Nueva EPS');
    expect(a).toContain('Medicina General');
    expect(a).toContain('anclaje fonético');
  });

  it('recorta espacios de cada término', () => {
    expect(buildVocabularyAnchor({ eps: ['  Sura  '] })).toContain(
      'EPS / aseguradoras válidas: Sura.',
    );
  });

  it('las letras del menú activan el modo de selección, en mayúsculas', () => {
    const a = buildVocabularyAnchor({ letterOptions: ['a', 'b', ' c '] });

    expect(a).toContain('MODO SELECCIÓN POR LETRA');
    expect(a).toContain('A, B, C');
  });

  it('el modo letra le prohíbe explícitamente marcar ininteligible un audio corto', () => {
    // Es el defecto que este bloque existe para arreglar: un "A" de un
    // segundo se marcaba ininteligible y el paciente se quedaba atascado.
    const a = buildVocabularyAnchor({ letterOptions: ['A'] });
    expect(a).toContain('ininteligible');
    expect(a).toMatch(/MUY CORTO/);
  });

  it('letras y catálogo conviven en dos bloques separados', () => {
    const a = buildVocabularyAnchor({
      letterOptions: ['A'],
      eps: ['Sura'],
      services: ['Odontología'],
    });

    expect(a).toContain('MODO SELECCIÓN POR LETRA');
    expect(a).toContain('VOCABULARIO DE LA CLÍNICA');
    expect(a.split('\n\n').length).toBeGreaterThan(1);
  });

  it('solo EPS, sin servicios: no aparece la línea de servicios vacía', () => {
    const a = buildVocabularyAnchor({ eps: ['Sura'] });
    expect(a).toContain('EPS / aseguradoras');
    expect(a).not.toContain('Servicios / especialidades');
  });

  it('insiste en que el transcript sea literal y el mapeo sea del catálogo', () => {
    const a = buildVocabularyAnchor({ eps: ['Sura'] });
    expect(a).toContain('transcripción literal');
    expect(a).toContain('NO inventes');
  });
});

describe('prompts fijos', () => {
  it('el de historia clínica exige JSON estricto y prohíbe inventar datos', () => {
    expect(CLINICAL_RECORD_PROMPT).toContain('ESTRICTAMENTE un JSON');
    expect(CLINICAL_RECORD_PROMPT).toContain('No inventes datos');
  });

  it('el de historia clínica declara las unidades de los signos vitales', () => {
    // Un número sin unidad en una historia clínica es un dato peligroso.
    for (const campo of [
      'bloodPressure',
      'heartRate',
      'temperature',
      'oxygenSat',
      'weight',
      'height',
    ]) {
      expect(CLINICAL_RECORD_PROMPT).toContain(campo);
    }
    expect(CLINICAL_RECORD_PROMPT).toContain('°C');
    expect(CLINICAL_RECORD_PROMPT).toContain('kg');
  });

  it('el de agendamiento pide los campos que el flujo de citas necesita', () => {
    for (const campo of ['cedula', 'nombre', 'eps', 'especialidad', 'intent']) {
      expect(SCHEDULING_EXTRACTION_PROMPT).toContain(campo);
    }
  });
});
