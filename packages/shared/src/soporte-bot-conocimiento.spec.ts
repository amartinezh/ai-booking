import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MARCA_FIN, MARCA_INICIO, parsearConocimiento } from './conocimiento';
import { MD_MINIMO } from './conocimiento.fixture';
import { getMenusForRole } from './menus';
import {
  PARTE2_PARA_EL_ASISTENTE,
  armarManualDelAsistente,
  esCitaValida,
  parte1EnBruto,
  seccionesDeLaParte2,
  seccionesSinClasificar,
} from './soporte-bot-conocimiento';

// El archivo real: lo que de verdad va a leer el asistente.
const AGENIA_MD = readFileSync(
  path.resolve(__dirname, '../../../docs/conocimiento/AGENIA.md'),
  'utf8',
);
const CONTENIDO = parsearConocimiento(AGENIA_MD);

const PARTE2_MINIMA = `# Doc

Intro.

# Parte 2 · Cómo funciona

Texto de la parte, antes de las secciones: no es de ninguna.

## 1. Qué es AgenIA

Una plataforma.

### 1.1 Detalle

Más texto.

## 2. Clínicas en producción

La clínica X.

---

# Parte 3 · Bitácora de cambios

- **2026-10-19** — algo.

## 9. Esto no es de la Parte 2

Nada.
`;

describe('seccionesDeLaParte2', () => {
  it('parte la Parte 2 en sus secciones, con subtítulos y sin la línea de cierre', () => {
    const s = seccionesDeLaParte2(PARTE2_MINIMA);
    expect(s.map((x) => [x.numero, x.titulo])).toEqual([
      [1, 'Qué es AgenIA'],
      [2, 'Clínicas en producción'],
    ]);
    expect(s[0].texto).toBe(
      '## 1. Qué es AgenIA\n\nUna plataforma.\n\n### 1.1 Detalle\n\nMás texto.',
    );
    expect(s[1].texto).toBe('## 2. Clínicas en producción\n\nLa clínica X.');
  });

  it('sin Parte 2, nada', () => {
    expect(seccionesDeLaParte2('# Parte 1\n\n## 1. Algo\n')).toEqual([]);
  });

  it('lee las 15 secciones del archivo real', () => {
    expect(seccionesDeLaParte2(AGENIA_MD).map((s) => s.numero)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
  });
});

describe('PARTE2_PARA_EL_ASISTENTE', () => {
  it('🔒 cada sección de la Parte 2 del archivo real está clasificada (una nueva es una decisión, no un accidente)', () => {
    expect(seccionesSinClasificar(AGENIA_MD)).toEqual([]);
  });

  it('detecta una sección nueva sin clasificar', () => {
    expect(
      seccionesSinClasificar(
        `# Parte 2 · X\n\n## 1. Qué es AgenIA\n\n## 2. Algo nuevo\n\n# Parte 3 · Y\n`,
      ),
    ).toEqual(['Algo nuevo']);
  });

  it('deja fuera arquitectura, clínicas en producción y documentación detallada (S7)', () => {
    const fuera = Object.entries(PARTE2_PARA_EL_ASISTENTE)
      .filter(([, lee]) => !lee)
      .map(([t]) => t);
    expect(fuera.sort()).toEqual([
      'Arquitectura técnica',
      'Clínicas en producción',
      'Documentación detallada',
    ]);
  });
});

describe('parte1EnBruto', () => {
  it('devuelve lo que va entre las marcas', () => {
    const t = parte1EnBruto(MD_MINIMO);
    expect(t.startsWith('## Portada')).toBe(true);
    expect(t).not.toContain(MARCA_INICIO);
    expect(t).not.toContain(MARCA_FIN);
    expect(t).not.toContain('Texto antes de la ayuda');
  });

  it('vacío si faltan las marcas o están al revés', () => {
    expect(parte1EnBruto('sin marcas')).toBe('');
    expect(parte1EnBruto(`${MARCA_FIN}\nx\n${MARCA_INICIO}`)).toBe('');
  });
});

describe('esCitaValida', () => {
  const validos = new Set(['agenda', 'glosario']);
  it.each([
    ['agenda', true],
    ['agenda--guia-1', true],
    [' agenda ', true],
    ['glosario', true],
    ['inventado', false],
    ['inventado--guia-1', false],
    ['', false],
    ['--guia-1', false],
  ])('«%s» → %p', (cita, esperado) => {
    expect(esCitaValida(cita, validos)).toBe(esperado);
  });
});

describe('armarManualDelAsistente con el archivo real', () => {
  const agente = armarManualDelAsistente({
    markdown: AGENIA_MD,
    contenido: CONTENIDO,
    rol: 'BOOKING_AGENT',
    menus: getMenusForRole('BOOKING_AGENT', { conEspejo: true }),
  });

  it('la parte común trae la Parte 1 y las secciones permitidas de la Parte 2', () => {
    expect(agente.comun).toContain('## Categoría: Para empezar {#inicio}');
    expect(agente.comun).toContain('## 3. El asistente virtual');
    expect(agente.comun).toContain(
      '## 13. Limitaciones conocidas y pendientes',
    );
  });

  it('🔒 nunca trae arquitectura, otras clínicas, documentación interna ni la bitácora', () => {
    expect(agente.comun).not.toContain('## 10. Arquitectura técnica');
    expect(agente.comun).not.toContain('## 12. Clínicas en producción');
    expect(agente.comun).not.toContain('## 14. Documentación detallada');
    expect(agente.comun).not.toContain('# Parte 3');
    expect(agente.comun).not.toContain('Bitácora de cambios');
    expect(agente.comun).not.toContain('San Vicente');
  });

  it('la parte común es la misma para cualquier rol (prefijo estable para la caché)', () => {
    const admin = armarManualDelAsistente({
      markdown: AGENIA_MD,
      contenido: CONTENIDO,
      rol: 'ORG_ADMIN',
      menus: getMenusForRole('ORG_ADMIN'),
    });
    expect(admin.comun).toBe(agente.comun);
    expect(admin.delUsuario).not.toBe(agente.delUsuario);
  });

  it('el agente sigue paso a paso sus opciones y los temas generales; lo del administrador, no', () => {
    expect(agente.temasDelUsuario).toEqual(
      expect.arrayContaining([
        'vision-general',
        'auditoria',
        'rastreo',
        'soporte',
        'primeros-pasos',
      ]),
    );
    expect(agente.temasDeOtroRol).toEqual(
      expect.arrayContaining(['agenda', 'servicios', 'medicos']),
    );
    expect(agente.temasDeOtroRol).not.toContain('auditoria');
    expect(agente.delUsuario).toContain('- Rol: Agente de Reservas.');
    expect(agente.delUsuario).toContain('Bandeja de sincronización');
  });

  it('el médico: «Mi Agenda» comparte ruta con «Visión General» pero no es esa pantalla', () => {
    const medico = armarManualDelAsistente({
      markdown: AGENIA_MD,
      contenido: CONTENIDO,
      rol: 'DOCTOR',
      menus: getMenusForRole('DOCTOR'),
    });
    expect(medico.opcionesSinTema).toEqual(['Mi Agenda']);
    expect(medico.temasDeOtroRol).toContain('vision-general');
    expect(medico.temasDelUsuario).toEqual(
      expect.arrayContaining(['rastreo', 'soporte']),
    );
  });

  it('el administrador tiene todas las opciones con tema', () => {
    const admin = armarManualDelAsistente({
      markdown: AGENIA_MD,
      contenido: CONTENIDO,
      rol: 'ORG_ADMIN',
      menus: getMenusForRole('ORG_ADMIN', { conEspejo: true, conAvisos: true }),
    });
    expect(admin.opcionesSinTema).toEqual([]);
    expect(admin.temasDeOtroRol).toEqual([]);
    expect(admin.delUsuario).toContain(
      'que el manual no explica en detalle: ninguna.',
    );
  });

  it('se puede citar cualquier tema y el glosario', () => {
    expect(agente.temasValidos.has('agenda')).toBe(true);
    expect(agente.temasValidos.has('glosario')).toBe(true);
    expect(agente.temasValidos.size).toBe(CONTENIDO.temas.length + 1);
  });

  it('un rol sin menú dice «ninguna»', () => {
    const nadie = armarManualDelAsistente({
      markdown: MD_MINIMO,
      contenido: parsearConocimiento(MD_MINIMO),
      rol: 'SUPER_ADMIN',
      menus: [],
    });
    expect(nadie.delUsuario).toContain('- Opciones de su menú: ninguna.');
    expect(nadie.comun).toContain(
      '## Parte 2 · Cómo funciona AgenIA por dentro',
    );
  });
});
