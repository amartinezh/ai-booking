import { cargarConocimiento } from './cargar-conocimiento';
import { buscar, crearIndice, distancia, extracto, normalizar, raiz, resaltar, sugerir } from './buscador';

const { temas: TEMAS, glosario: GLOSARIO } = cargarConocimiento();
const indice = crearIndice(TEMAS, GLOSARIO);
const primero = (consulta: string) => buscar(indice, consulta).resultados[0]?.fragmento;

describe('normalizar y raiz', () => {
    it('quita tildes, eñes, mayúsculas y signos', () => {
        expect(normalizar('¿Cómo CAMBIO la Contraseña?')).toBe('como cambio la contrasena');
    });

    it.each([
        ['cupos', 'cupo'],
        ['doctores', 'doctor'],
        ['pacientes', 'paciente'],
        ['agendar', 'agenda'],
        ['agendamiento', 'agendada'],
        ['cancelación', 'cancelar'],
        ['recordatorios', 'recordar'],
        ['llegaron', 'llegó'],
        ['especialidades', 'especialidad'],
    ])('«%s» y «%s» comparten raíz', (a, b) => {
        expect(raiz(normalizar(a))).toBe(raiz(normalizar(b)));
    });

    it('no toca las siglas cortas', () => {
        expect(raiz('eps')).toBe('eps');
        expect(raiz('his')).toBe('his');
    });
});

describe('distancia de edición', () => {
    it('cuenta una transposición como un solo error', () => {
        expect(distancia('padorn', 'padron', 2)).toBe(1);
    });

    it('corta en cuanto supera el tope', () => {
        expect(distancia('agenda', 'telegram', 2)).toBe(3);
    });
});

describe('buscar', () => {
    it('lleva una tarea a su guía paso a paso', () => {
        expect(primero('abrir cupos')).toMatchObject({ temaId: 'agenda', tipo: 'guia' });
        expect(primero('cambiar contraseña')?.tipo).toBe('guia');
        expect(['medicos', 'usuarios']).toContain(primero('cambiar contraseña')?.temaId);
    });

    it('no le importan las tildes ni las mayúsculas', () => {
        expect(primero('CONTRASENA')?.titulo).toMatch(/contraseña/i);
        expect(primero('padron')?.temaId).toBe(primero('Padrón')?.temaId);
    });

    it('tolera errores de tipeo', () => {
        expect(primero('padorn')?.temaId).toMatch(/padron|glosario/);
        expect(buscar(indice, 'recordatrio').resultados.slice(0, 4).map((r) => r.fragmento.titulo).join(' ')).toMatch(/ecordatorio/);
    });

    it('entiende sinónimos del oficio', () => {
        expect(primero('turnos')?.temaId).toBe('agenda');
        expect(primero('doctor')?.temaId).toBe('medicos');
        expect(primero('aseguradora')?.temaId).toBe('eps');
    });

    it('encuentra mientras se escribe (prefijo)', () => {
        expect(buscar(indice, 'homolo').resultados.map((r) => r.fragmento.titulo).join(' ')).toMatch(/Homologar/);
    });

    it('el nombre de una opción del menú lleva a su guía', () => {
        for (const t of TEMAS.filter((tema) => tema.href)) {
            expect(primero(t.titulo)).toMatchObject({ temaId: t.id, tipo: 'resumen' });
        }
    });

    it('describir un problema lleva a su solución', () => {
        expect(primero('el bot no responde')).toMatchObject({ temaId: 'configuracion', tipo: 'problema' });
        expect(primero('la cita no llegó al hospital')?.temaId).toBe('bandeja');
        expect(primero('paciente dice que agendó')?.temaId).toBe('rastreo');
    });

    it('también busca en el glosario', () => {
        expect(primero('qué es BSUID')).toMatchObject({ temaId: 'glosario', titulo: 'BSUID' });
    });

    it('sin palabras con significado, o sin coincidencias, no devuelve nada', () => {
        expect(buscar(indice, '').resultados).toEqual([]);
        expect(buscar(indice, 'de la por').resultados).toEqual([]);
        expect(buscar(indice, 'xyzq').resultados).toEqual([]);
    });

    it('devuelve las raíces que coincidieron, para resaltar el tema al abrirlo', () => {
        expect(buscar(indice, 'abrir cupos').terminos).toEqual(expect.arrayContaining([raiz('abrir'), raiz('cupos')]));
    });

    it('responde mientras se escribe: menos de 50 ms por búsqueda, aun con errores de tipeo', () => {
        // Sola tarda 1–4 ms; el margen es para que no falle cuando Jest corre
        // muchas suites en paralelo. Lo que vigila es una regresión grave
        // (por ejemplo, comparar cada palabra contra todos los fragmentos).
        const inicio = Date.now();
        for (let i = 0; i < 40; i++) buscar(indice, i % 2 ? 'cita no llego al hospital' : 'recordatrio');
        expect(Date.now() - inicio).toBeLessThan(40 * 50);
    });
});

describe('sugerir', () => {
    it('corrige la palabra mal escrita y conserva la tilde de la ayuda', () => {
        expect(sugerir(indice, 'padorn')).toBe('padrón');
    });

    it('no sugiere nada si todo está bien escrito', () => {
        expect(sugerir(indice, 'abrir cupos')).toBeNull();
    });
});

describe('resaltar y extracto', () => {
    it('marca la palabra original (con tilde) cuando su raíz coincide', () => {
        const segmentos = resaltar('Cancelación de la cita', new Set([raiz('cancelar')]));
        expect(segmentos.filter((s) => s.marcado).map((s) => s.texto)).toEqual(['Cancelación']);
        expect(segmentos.map((s) => s.texto).join('')).toBe('Cancelación de la cita');
    });

    it('recorta un texto largo alrededor de la coincidencia', () => {
        const largo = `${'uno dos tres cuatro cinco seis siete ocho nueve diez '.repeat(6)}padrón ${'once doce trece '.repeat(6)}`;
        const segmentos = extracto(largo, new Set([raiz('padron')]));
        const texto = segmentos.map((s) => s.texto).join('');
        expect(texto.startsWith('… ')).toBe(true);
        expect(segmentos.some((s) => s.marcado && s.texto === 'padrón')).toBe(true);
        expect(texto.length).toBeLessThan(largo.length);
    });
});
