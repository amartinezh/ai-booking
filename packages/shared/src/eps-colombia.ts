/**
 * Las EPS (y regímenes especiales) que un paciente colombiano puede nombrar.
 *
 * Sirve para UNA cosa: distinguir «me nombró una EPS de verdad que esta clínica no
 * atiende» de «escribió algo que no entendí». En el primer caso el bot le dice que esa
 * EPS no está disponible y le ofrece una cita particular, en vez de repetirle el menú
 * hasta agotar los reintentos (una interacción que no vale la pena). En el segundo,
 * sigue repreguntando como siempre.
 *
 * También evita un error peor: sin este catálogo, «Coomeva» caía al mapeo semántico
 * (LLM), que podía «acercarla» a otra EPS del menú y agendar con el convenio
 * equivocado. Una EPS reconocida por su nombre se resuelve SOLO contra sí misma.
 *
 * Los alias van normalizados (minúsculas, sin tildes, sin puntuación) y se comparan
 * como palabras completas. Los que son también palabras comunes del español
 * («compensar», «comparta», «convida», «sos») solo cuentan acompañados de «eps».
 */
const CATALOGO: ReadonlyArray<{ nombre: string; alias: string[] }> = [
  { nombre: 'Nueva EPS', alias: ['nueva eps', 'nueva e p s', 'nuevaeps'] },
  { nombre: 'Sura', alias: ['sura', 'eps sura', 'suramericana'] },
  { nombre: 'Sanitas', alias: ['sanitas', 'eps sanitas'] },
  { nombre: 'Salud Total', alias: ['salud total', 'saludtotal'] },
  { nombre: 'Compensar', alias: ['eps compensar', 'compensar eps'] },
  { nombre: 'Famisanar', alias: ['famisanar'] },
  { nombre: 'Coomeva', alias: ['coomeva'] },
  {
    nombre: 'S.O.S. (Servicio Occidental de Salud)',
    alias: ['eps sos', 's o s', 'servicio occidental de salud'],
  },
  { nombre: 'Coosalud', alias: ['coosalud', 'coo salud'] },
  { nombre: 'Mutual Ser', alias: ['mutual ser', 'mutualser'] },
  { nombre: 'Emssanar', alias: ['emssanar', 'emsanar'] },
  { nombre: 'Asmet Salud', alias: ['asmet', 'asmet salud', 'asmetsalud'] },
  { nombre: 'Savia Salud', alias: ['savia salud', 'saviasalud'] },
  { nombre: 'Capresoca', alias: ['capresoca'] },
  { nombre: 'Comfenalco', alias: ['comfenalco'] },
  { nombre: 'Aliansalud', alias: ['aliansalud', 'alian salud'] },
  { nombre: 'Cajacopi', alias: ['cajacopi'] },
  { nombre: 'Capital Salud', alias: ['capital salud'] },
  { nombre: 'Pijaos Salud', alias: ['pijaos', 'pijaos salud'] },
  { nombre: 'Anas Wayuu', alias: ['anas wayuu'] },
  { nombre: 'Dusakawi', alias: ['dusakawi'] },
  { nombre: 'Mallamas', alias: ['mallamas'] },
  { nombre: 'Salud Mía', alias: ['salud mia'] },
  { nombre: 'Comfachocó', alias: ['comfachoco'] },
  { nombre: 'Comfaoriente', alias: ['comfaoriente'] },
  { nombre: 'Comfamiliar', alias: ['comfamiliar'] },
  { nombre: 'Ecoopsos', alias: ['ecoopsos'] },
  { nombre: 'Comparta', alias: ['eps comparta'] },
  { nombre: 'Convida', alias: ['eps convida'] },
  { nombre: 'Medimás', alias: ['medimas'] },
  { nombre: 'Cafesalud', alias: ['cafesalud'] },
  { nombre: 'Saludvida', alias: ['saludvida'] },
  { nombre: 'Ambuq', alias: ['ambuq'] },
  { nombre: 'Cruz Blanca', alias: ['cruz blanca'] },
  { nombre: 'Magisterio (FOMAG)', alias: ['magisterio', 'fomag'] },
  {
    nombre: 'Sanidad Militar',
    alias: ['sanidad militar', 'fuerzas militares', 'dispensario militar'],
  },
  {
    nombre: 'Sanidad de la Policía',
    alias: ['sanidad policia', 'sanidad de la policia', 'policia nacional'],
  },
  { nombre: 'Ecopetrol', alias: ['ecopetrol'] },
  { nombre: 'Colsanitas', alias: ['colsanitas'] },
  { nombre: 'Colmédica', alias: ['colmedica'] },
];

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// El alias más largo primero: «nueva eps» antes que cualquier alias contenido en él.
const ALIAS_ORDENADOS = CATALOGO.flatMap(({ nombre, alias }) =>
  alias.map((a) => ({ nombre, alias: normalizar(a) })),
).sort((a, b) => b.alias.length - a.alias.length);

/**
 * El nombre canónico de la EPS que el texto nombra, o null si no nombra ninguna del
 * catálogo. Sirve igual para lo que escribe el paciente y para los nombres de las EPS
 * de una clínica: dos textos que dan el mismo nombre canónico son la misma EPS.
 */
export function reconocerEps(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = ` ${normalizar(texto)} `;
  for (const { nombre, alias } of ALIAS_ORDENADOS) {
    if (t.includes(` ${alias} `)) return nombre;
  }
  return null;
}
