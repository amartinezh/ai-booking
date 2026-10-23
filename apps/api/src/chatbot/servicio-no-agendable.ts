/**
 * 🦷 Servicios que no se agendan por el asistente (2026-10-23).
 *
 * El primer día de agendar abierto, 3 de 8 personas pidieron odontología o
 * ecografías, que el hospital no agenda por este medio (el menú solo trae
 * medicina general). El bot les respondía tres veces «no logré interpretar su
 * respuesta» y terminaba en «demasiados intentos», sin decirles a dónde llamar.
 *
 * Aquí se reconoce que el paciente nombró un servicio conocido, para decirle con
 * claridad que por aquí no se agenda y con quién comunicarse. Solo si ese
 * servicio NO está en el menú de la clínica: en una clínica que sí ofrece
 * odontología por el asistente, «odontología» sigue el camino de siempre.
 *
 * Puro: sin base de datos.
 */

const normalizar = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** En orden: «ecografía obstétrica» es una ecografía, no ginecología. */
const SERVICIOS: ReadonlyArray<{ etiqueta: string; patron: RegExp }> = [
  {
    etiqueta: 'odontología',
    patron:
      /\b(odonto\w*|dental\w*|dentista\w*|muelas?|endodonc\w*|exodonc\w*|ortodonc\w*|salud oral|higiene oral)\b/,
  },
  {
    etiqueta: 'ecografías',
    patron: /\b(ecogra\w*|eco grafia\w*|doppler|ultrasonido\w*)\b/,
  },
  { etiqueta: 'rayos X', patron: /\b(rayos? x|radiograf\w*)\b/ },
  {
    etiqueta: 'laboratorio',
    patron:
      /\b(laboratorio\w*|examen(es)? de (sangre|orina)|toma de muestras?)\b/,
  },
  { etiqueta: 'citología', patron: /\bcitolog\w*/ },
  { etiqueta: 'mamografía', patron: /\bmamograf\w*/ },
  { etiqueta: 'vacunación', patron: /\bvacun\w*/ },
  { etiqueta: 'psicología', patron: /\bpsicolog\w*/ },
  { etiqueta: 'psiquiatría', patron: /\bpsiquiatr\w*/ },
  { etiqueta: 'nutrición', patron: /\bnutricio\w*/ },
  { etiqueta: 'fisioterapia', patron: /\b(fisioterap\w*|terapia fisica)\b/ },
  { etiqueta: 'ginecología', patron: /\b(ginecolog\w*|ginecobstetr\w*)\b/ },
  { etiqueta: 'pediatría', patron: /\bpediatr\w*/ },
  { etiqueta: 'dermatología', patron: /\bdermatolog\w*/ },
  { etiqueta: 'medicina interna', patron: /\b(internista|medicina interna)\b/ },
  { etiqueta: 'optometría', patron: /\b(optometr\w*|oftalmolog\w*)\b/ },
  { etiqueta: 'planificación familiar', patron: /\bplanificacion\b/ },
  { etiqueta: 'control prenatal', patron: /\b(prenatal|gestante)\b/ },
  { etiqueta: 'especialistas', patron: /\bespecialista\w*/ },
];

/**
 * El servicio conocido que nombra el texto y que la clínica NO ofrece por el
 * asistente («odontología», «ecografías»…), o null. `serviciosDelMenu` son los
 * nombres de los servicios activos de la clínica.
 */
export function servicioQueNoSeAgenda(
  texto: string | null | undefined,
  serviciosDelMenu: readonly string[],
): string | null {
  if (!texto) return null;
  const t = normalizar(texto);
  if (!t) return null;
  const menu = serviciosDelMenu.map(normalizar);
  for (const { etiqueta, patron } of SERVICIOS) {
    if (!patron.test(t)) continue;
    // Está en el menú: se agenda por aquí, no es este caso.
    if (menu.some((nombre) => patron.test(nombre))) return null;
    return etiqueta;
  }
  return null;
}
