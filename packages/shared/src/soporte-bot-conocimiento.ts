/**
 * Qué parte de docs/conocimiento/AGENIA.md lee el asistente de soporte, y cómo se
 * le dice quién pregunta (docs/PLAN_BOT_SOPORTE.md §3.2, S6 y S7).
 *
 *   · La Parte 1 (el Centro de ayuda) entera. El asistente sabe qué opciones del
 *     menú tiene quien pregunta: lo de otro rol no lo explica paso a paso, dice
 *     quién lo hace.
 *   · La Parte 2 (cómo funciona por dentro) por secciones, con una lista explícita:
 *     una sección nueva que nadie clasificó hace fallar las pruebas, para que lo
 *     que lee el asistente sea siempre una decisión y no un accidente.
 *   · La Parte 3 (bitácora), no: está escrita para quien mantiene el sistema.
 *
 * El manual va en dos piezas: `comun` es igual para todos (va primero en el prompt,
 * así la caché del proveedor lo reutiliza) y `delUsuario` cambia con el rol.
 *
 * Lógica pura: quien llama lee el archivo y le pasa el texto.
 */
import { MARCA_FIN, MARCA_INICIO } from './conocimiento';
import { GLOSARIO_ID } from './conocimiento-buscador';
import type { ContenidoAyuda } from './conocimiento-tipos';
import type { MenuItem, UserRole } from './menus';
import { ROL_LEGIBLE } from './soporte-caso';

/**
 * Las secciones de la Parte 2, por título (sin el número): `true` las lee el
 * asistente, `false` no.
 */
export const PARTE2_PARA_EL_ASISTENTE: Readonly<Record<string, boolean>> = {
  'Qué es AgenIA': true,
  'Roles y qué ve cada uno': true,
  'El asistente virtual': true,
  Recordatorios: true,
  'Conexión con el hospital (espejo)': true,
  'Otras pantallas y páginas públicas': true,
  'Procesos automáticos': true,
  'Monitoreo y alertas técnicas': true,
  'Datos, privacidad y seguridad': true,
  // Piezas internas (servicios, despliegue, CI): no le sirven al personal.
  'Arquitectura técnica': false,
  'Configuración por clínica': true,
  // Nombra a otras clínicas: cada clínica solo sabe de sí misma.
  'Clínicas en producción': false,
  'Limitaciones conocidas y pendientes': true,
  // Rutas de documentos del repositorio: nada que el personal pueda abrir.
  'Documentación detallada': false,
  // El asistente sabe cómo funciona él mismo: el código, la conversación, qué hace.
  'Asistente de soporte para el personal': true,
};

export interface SeccionParte2 {
  numero: number;
  titulo: string;
  /** La sección completa en Markdown, con su encabezado. */
  texto: string;
}

const RE_PARTE = /^# Parte (\d+)\b/;
const RE_SECCION = /^## (\d+)\.\s+(.+?)\s*$/;

/** Las secciones `## N. Título` de la Parte 2, en orden. */
export function seccionesDeLaParte2(markdown: string): SeccionParte2[] {
  const lineas = markdown.split(/\r?\n/);
  const secciones: SeccionParte2[] = [];
  let enParte2 = false;
  let actual: { numero: number; titulo: string; lineas: string[] } | null =
    null;
  const cerrar = () => {
    if (actual) {
      secciones.push({
        numero: actual.numero,
        titulo: actual.titulo,
        texto: actual.lineas
          .join('\n')
          .replace(/\n+(---\s*)?$/, '')
          .trimEnd(),
      });
    }
    actual = null;
  };
  for (const linea of lineas) {
    const parte = RE_PARTE.exec(linea);
    if (parte) {
      cerrar();
      enParte2 = parte[1] === '2';
      continue;
    }
    if (!enParte2) continue;
    const seccion = RE_SECCION.exec(linea);
    if (seccion) {
      cerrar();
      actual = {
        numero: Number(seccion[1]),
        titulo: seccion[2],
        lineas: [linea],
      };
    } else if (actual) {
      actual.lineas.push(linea);
    }
  }
  cerrar();
  return secciones;
}

/** Títulos de la Parte 2 que no están en `PARTE2_PARA_EL_ASISTENTE`. */
export function seccionesSinClasificar(markdown: string): string[] {
  return seccionesDeLaParte2(markdown)
    .map((s) => s.titulo)
    .filter((t) => !(t in PARTE2_PARA_EL_ASISTENTE));
}

/** El texto de la Parte 1 tal cual (lo que va entre las dos marcas). */
export function parte1EnBruto(markdown: string): string {
  const ini = markdown.indexOf(MARCA_INICIO);
  const fin = markdown.indexOf(MARCA_FIN);
  if (ini === -1 || fin === -1 || fin < ini) return '';
  return markdown.slice(ini + MARCA_INICIO.length, fin).trim();
}

/**
 * ¿Una cita de la IA apunta a algo del manual? Vale el id de un tema
 * («agenda»), un ancla dentro de él («agenda--guia-1») y el glosario.
 */
export function esCitaValida(
  cita: string,
  temasValidos: ReadonlySet<string>,
): boolean {
  const id = cita.trim().split('--')[0];
  return id.length > 0 && temasValidos.has(id);
}

export interface ManualDelAsistente {
  /** Partes 1 y 2 (las secciones permitidas). Igual para todos: va primero en el prompt. */
  comun: string;
  /** Quién pregunta: su rol, sus opciones y qué temas le tocan. */
  delUsuario: string;
  /** Temas que el usuario puede seguir paso a paso (los de su menú y los generales). */
  temasDelUsuario: string[];
  /** Temas de opciones que su rol no tiene: el asistente dice quién lo hace. */
  temasDeOtroRol: string[];
  /** Opciones de su menú que el manual no explica (p. ej. «Mi Agenda» del médico). */
  opcionesSinTema: string[];
  /** Todo lo que la IA puede citar: los ids de los temas y el glosario. */
  temasValidos: Set<string>;
}

export function armarManualDelAsistente(p: {
  markdown: string;
  contenido: ContenidoAyuda;
  rol: UserRole;
  /** El menú de quien pregunta (`getMenusForRole` con las opciones de su clínica). */
  menus: MenuItem[];
}): ManualDelAsistente {
  const { contenido, menus } = p;
  const delMenu = (href: string, titulo: string) =>
    menus.some((m) => m.href === href && m.label === titulo);

  const temasDelUsuario: string[] = [];
  const temasDeOtroRol: string[] = [];
  for (const t of contenido.temas) {
    if (!t.href || delMenu(t.href, t.titulo)) temasDelUsuario.push(t.id);
    else temasDeOtroRol.push(t.id);
  }
  const opcionesSinTema = menus
    .filter(
      (m) =>
        !contenido.temas.some((t) => t.href === m.href && t.titulo === m.label),
    )
    .map((m) => m.label);

  const parte2 = seccionesDeLaParte2(p.markdown)
    .filter((s) => PARTE2_PARA_EL_ASISTENTE[s.titulo] === true)
    .map((s) => s.texto);

  const comun = [
    '# Manual de AgenIA',
    '',
    '## Parte 1 · Centro de ayuda (lo que ve el personal en el panel)',
    '',
    parte1EnBruto(p.markdown),
    '',
    '## Parte 2 · Cómo funciona AgenIA por dentro',
    '',
    parte2.join('\n\n'),
  ].join('\n');

  const lista = (xs: string[]) => (xs.length > 0 ? xs.join(', ') : 'ninguna');
  const delUsuario = [
    '## Quién pregunta',
    '',
    `- Rol: ${ROL_LEGIBLE[p.rol]}.`,
    `- Opciones de su menú: ${lista(menus.map((m) => m.label))}.`,
    `- Temas del manual que puede seguir paso a paso: ${lista(temasDelUsuario)}.`,
    `- Temas de opciones que su rol NO tiene (no des el paso a paso; di quién lo hace): ${lista(temasDeOtroRol)}.`,
    `- Opciones de su menú que el manual no explica en detalle: ${lista(opcionesSinTema)}.`,
  ].join('\n');

  return {
    comun,
    delUsuario,
    temasDelUsuario,
    temasDeOtroRol,
    opcionesSinTema,
    temasValidos: new Set([...contenido.temas.map((t) => t.id), GLOSARIO_ID]),
  };
}
