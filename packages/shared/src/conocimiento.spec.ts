import {
  ErrorDeConocimiento,
  MARCA_FIN,
  MARCA_INICIO,
  parsearConocimiento,
  temaDeRuta,
  validarConocimiento,
} from './conocimiento';
import { MD_MINIMO } from './conocimiento.fixture';

/** Reemplaza un trozo del archivo mínimo (debe estar exactamente una vez). */
function con(viejo: string, nuevo: string): string {
  expect(MD_MINIMO.split(viejo)).toHaveLength(2);
  return MD_MINIMO.replace(viejo, nuevo);
}

function errorDe(md: string): ErrorDeConocimiento {
  try {
    parsearConocimiento(md);
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorDeConocimiento);
    return e as ErrorDeConocimiento;
  }
  throw new Error('se esperaba un error y el archivo se leyó bien');
}

const lineaDe = (md: string, texto: string) =>
  md.split('\n').findIndex((l) => l.includes(texto)) + 1;

describe('parsearConocimiento', () => {
  const c = parsearConocimiento(MD_MINIMO);

  it('lee la portada', () => {
    expect(c.portada).toEqual({
      presentacion: 'Ayuda de prueba para la clínica.',
      busquedasFrecuentes: ['Abrir la agenda', 'Ver turnos'],
      glosarioDestacado: ['Turno'],
    });
  });

  it('lee las categorías con su descripción', () => {
    expect(c.categorias).toEqual([
      {
        id: 'inicio',
        titulo: 'Para empezar',
        descripcion: 'Lo primero que hay que hacer.',
      },
      {
        id: 'catalogos',
        titulo: 'Agenda y catálogos',
        descripcion: 'Lo que el asistente necesita.',
      },
    ]);
  });

  it('lee un tema completo: ficha, secciones, guías con nota, elementos, preguntas y problemas', () => {
    expect(c.temas[1]).toEqual({
      id: 'agenda',
      href: '/dashboard/agenda',
      titulo: 'Agenda',
      icono: '📅',
      categoria: 'catalogos',
      resumen: 'Los turnos de cada médico, para que el asistente los ofrezca.',
      paraQueSirve:
        'Un turno es un espacio de tiempo de un médico en el que se puede agendar una cita.',
      disponibilidad: 'Siempre.',
      guias: [{ titulo: 'Abrir turnos', pasos: ['Elige el médico.'] }],
      elementos: [
        { nombre: 'Azul', explicacion: 'Turno libre.' },
        { nombre: 'Rojo', explicacion: 'Turno ocupado.' },
      ],
      preguntas: [
        { pregunta: '¿Cómo borro un turno?', respuesta: 'No se puede.' },
      ],
      problemas: [
        {
          sintoma: 'Sale «Médico inválido».',
          solucion: 'Asígnale un servicio.',
        },
      ],
      relacionados: ['primeros-pasos'],
      palabrasClave: ['turnos', 'cupos'],
    });
  });

  it('une las líneas de un párrafo y de un paso con sangría; quita el 💡 de la nota', () => {
    const t = c.temas[0];
    expect(t.paraQueSirve).toBe(
      'Explica el orden en que se configura la clínica de prueba y por qué ese orden importa.',
    );
    expect(t.guias[0]).toEqual({
      titulo: 'Configurar la clínica',
      pasos: ['Abre la agenda.', 'Crea los turnos de la semana.'],
      nota: 'Se puede volver después.',
    });
  });

  it('un tema sin ruta no tiene href, y sin secciones opcionales quedan vacías', () => {
    const t = c.temas[0];
    expect('href' in t).toBe(false);
    expect('disponibilidad' in t).toBe(false);
    expect(t.elementos).toEqual([]);
    expect(t.problemas).toEqual([]);
    expect(t.relacionados).toEqual(['agenda', 'glosario']);
  });

  it('lee el glosario con sinónimos y tema', () => {
    expect(c.glosario).toEqual([
      {
        termino: 'Turno',
        definicion: 'Espacio de tiempo de un médico.',
        sinonimos: ['cupo', 'slot'],
        temaId: 'agenda',
      },
      { termino: 'EPS', definicion: 'La aseguradora.' },
    ]);
  });

  it('ignora lo que hay fuera de las marcas y los comentarios', () => {
    expect(JSON.stringify(c)).not.toMatch(
      /Parte 2|Cualquier cosa|Nota para quien mantiene|Texto antes/,
    );
  });

  it('acepta finales de línea de Windows', () => {
    expect(parsearConocimiento(MD_MINIMO.replace(/\n/g, '\r\n'))).toEqual(c);
  });
});

describe('parsearConocimiento: errores con la línea donde está el problema', () => {
  it('sin las marcas', () => {
    expect(errorDe(MD_MINIMO.replace(MARCA_INICIO, '')).message).toMatch(
      /AYUDA:INICIO/,
    );
    expect(errorDe(MD_MINIMO.replace(MARCA_FIN, '')).message).toMatch(
      /AYUDA:FIN/,
    );
  });

  it('una sección que no existe', () => {
    const md = con('#### Qué ves en la pantalla', '#### Qué se ve');
    const e = errorDe(md);
    expect(e.linea).toBe(lineaDe(md, '#### Qué se ve'));
    expect(e.message).toMatch(
      /sección «Qué se ve» desconocida.*Para qué sirve/,
    );
  });

  it('un tema sin id', () => {
    const md = con('### 📅 Agenda {#agenda}', '### 📅 Agenda');
    expect(errorDe(md).linea).toBe(lineaDe(md, '### 📅 Agenda'));
  });

  it('un id repetido', () => {
    const md = con(
      '### 📅 Agenda {#agenda}',
      '### 📅 Agenda {#primeros-pasos}',
    );
    expect(errorDe(md).message).toMatch(/«primeros-pasos» está repetido/);
  });

  it('un dato desconocido en la ficha', () => {
    const md = con('- **Disponibilidad:** Siempre.', '- **Horario:** Siempre.');
    const e = errorDe(md);
    expect(e.linea).toBe(lineaDe(md, '**Horario:**'));
    expect(e.message).toMatch(/«Horario» no es un dato de la ficha/);
  });

  it('relacionados sin el formato de enlace', () => {
    const md = con(
      '- **Relacionados:** [Primeros pasos](#primeros-pasos)',
      '- **Relacionados:** primeros-pasos',
    );
    expect(errorDe(md).message).toMatch(/Relacionados: usa enlaces/);
  });

  it('un párrafo suelto dentro de una guía', () => {
    const md = con(
      '1. Elige el médico.',
      '1. Elige el médico.\n\nTexto suelto.',
    );
    const e = errorDe(md);
    expect(e.linea).toBe(lineaDe(md, 'Texto suelto.'));
    expect(e.message).toMatch(/pasos numerados/);
  });

  it('una guía sin pasos', () => {
    expect(errorDe(con('1. Elige el médico.\n', '')).message).toMatch(
      /«Abrir turnos».*no tiene pasos/,
    );
  });

  it('un tema sin resumen o sin «Para qué sirve»', () => {
    expect(
      errorDe(
        con(
          '- **Resumen:** Los turnos de cada médico, para que el asistente los ofrezca.\n',
          '',
        ),
      ).message,
    ).toMatch(/«Agenda» no tiene «\*\*Resumen:\*\*»/);
    expect(
      errorDe(
        con(
          '#### Para qué sirve\n\nUn turno es un espacio de tiempo de un médico en el que se puede agendar una cita.\n\n',
          '',
        ),
      ).message,
    ).toMatch(/no tiene la sección «#### Para qué sirve»/);
  });

  it('una pregunta sin respuesta', () => {
    expect(errorDe(con('No se puede.\n', '')).message).toMatch(
      /«¿Cómo borro un turno\?».*no tiene respuesta/,
    );
  });

  it('un título de nivel 2 desconocido', () => {
    expect(
      errorDe(con('## Glosario {#glosario}', '## Términos')).message,
    ).toMatch(/«## Términos» desconocido/);
  });

  it('una portada incompleta', () => {
    expect(
      errorDe(con('- **Glosario destacado:** Turno\n', '')).message,
    ).toMatch(/portada necesita/);
  });

  it('un campo vacío', () => {
    expect(
      errorDe(con('- **Rojo:** Turno ocupado.', '- **Rojo:**')).message,
    ).toMatch(/«Rojo» está vacío/);
  });
});

describe('validarConocimiento', () => {
  it('un archivo coherente no tiene problemas', () => {
    expect(validarConocimiento(parsearConocimiento(MD_MINIMO))).toEqual([]);
  });

  it('señala enlaces a temas que no existen y destacados que no están en el glosario', () => {
    const md = MD_MINIMO.replace(
      '[Primeros pasos](#primeros-pasos)',
      '[Otro](#no-existe)',
    )
      .replace(
        '[Agenda](#agenda)\n- **EPS:**',
        '[Agenda](#tampoco)\n- **EPS:**',
      )
      .replace(
        '- **Glosario destacado:** Turno',
        '- **Glosario destacado:** Turno, Padrón',
      );
    expect(validarConocimiento(parsearConocimiento(md))).toEqual([
      '«Agenda»: el relacionado #no-existe no existe.',
      'glosario «Turno»: el tema #tampoco no existe.',
      '«Glosario destacado» nombra «Padrón», que no está en el glosario.',
    ]);
  });
});

describe('temaDeRuta', () => {
  it('encuentra el tema de una ruta del menú', () => {
    const { temas } = parsearConocimiento(MD_MINIMO);
    expect(temaDeRuta(temas, '/dashboard/agenda')?.id).toBe('agenda');
    expect(temaDeRuta(temas, '/dashboard/otra')).toBeUndefined();
  });
});
