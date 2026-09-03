/**
 * Aplica la tabla de valores de un driver al `mappingJson` de su
 * HospitalMirrorConfig.
 *
 * ═══ Por qué existe ═══
 * `mappingJson` decide la especialidad, el convenio de facturación y el sexo
 * que se escriben en el HIS. Vive en la base y no en el código a propósito
 * —validarlo con el hospital debe ser configuración, no despliegue— pero hasta
 * ahora vivía SOLO ahí, metido a mano con un UPDATE. Sin original revisable
 * nadie podía ver qué decía, ni por qué, ni desde cuándo.
 *
 * Eso dejó dos valores mal sin que nadie lo notara:
 *   · `I890301AG` figuraba con especialidad '000' cuando las citas reales usan
 *     '328' en 453 de 455 (bloque 31d).
 *   · `serviciosPyp` tenía UN servicio de los catorce de la familia PyDT, así
 *     que los otros trece se facturaban al convenio equivocado.
 *
 * Uso:
 *   pnpm --filter @agenia/database exec tsx scripts/aplicar-mapping.ts <organizationId>
 *   # sin organización, lista las disponibles y sale
 *   # con --dry-run, muestra el diff y no escribe
 */
import * as path from 'path';
import * as fs from 'fs';

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = (m[2] ?? '').replace(/^['"]|['"]$/g, '');
  }
}
loadEnvFile(path.resolve(__dirname, '../../../apps/api/.env'));

import { PrismaClient } from '@prisma/client';

const ARCHIVO = path.resolve(
  __dirname,
  '../../../docs/drivers/cnt-sanvicente-anserma/mapping.json',
);

/**
 * Comprobaciones que no cuestan nada y evitan escribir una tabla incoherente
 * en la configuración de un hospital.
 */
function revisar(mapping: Record<string, any>): string[] {
  const problemas: string[] = [];
  const esp: Record<string, string> = mapping.especialidadPorServicio ?? {};
  const nombres: Record<string, string> = mapping._especialidades ?? {};
  const pyp: string[] = mapping.serviciosPyp ?? [];

  // Toda especialidad usada debe existir en el catálogo que trae el archivo.
  for (const [servicio, codigo] of Object.entries(esp)) {
    if (!nombres[codigo]) {
      problemas.push(`${servicio} apunta a la especialidad ${codigo}, que no está en el catálogo.`);
    }
  }

  // `serviciosPyp` se derivó de la familia PyDT: si un servicio marcado como
  // PyP tiene una especialidad que no lo es, uno de los dos está mal — y el
  // que decide el convenio de facturación es este.
  const familiaPyp = new Set(
    Object.entries(nombres)
      .filter(([, nombre]) => /PYDT|PYP/i.test(nombre))
      .map(([codigo]) => codigo),
  );
  for (const servicio of pyp) {
    const codigo = esp[servicio];
    if (!codigo) {
      problemas.push(`${servicio} está en serviciosPyp pero no tiene especialidad asignada.`);
    } else if (!familiaPyp.has(codigo)) {
      problemas.push(
        `${servicio} está en serviciosPyp pero su especialidad ${codigo} (${nombres[codigo]}) no es de la familia PyDT.`,
      );
    }
  }
  // Y al revés: un servicio de especialidad PyDT que NO esté marcado se
  // facturaría al convenio general.
  for (const [servicio, codigo] of Object.entries(esp)) {
    if (familiaPyp.has(codigo) && !pyp.includes(servicio)) {
      problemas.push(
        `${servicio} tiene especialidad PyDT (${codigo}) pero NO está en serviciosPyp: se facturaría al convenio general.`,
      );
    }
  }
  // ── El par CUPS 8902xx (primera vez) / 8903xx (control) ──────────────────
  // Es el mismo procedimiento: cambia el momento, no la especialidad. Ni el
  // dígito 2/3 ni el sufijo local ESP/SUR la cambian. Este chequeo existe
  // porque `especialidadPorServicio` se generó filtrando a médicos con turnos
  // futuros y ese filtro dejó fuera cinco servicios con citas reales — entre
  // ellos la mitad «control» de ginecología (890350ESP/SUR).
  const SINGLETONES_CONOCIDOS = new Set([
    '890201-CI',
    '890201AD',
    '890201AV',
    '890201PI',
    '890208Ges',
  ]);
  for (const [servicio, codigo] of Object.entries(esp)) {
    const m = /^(890)([23])(\d{2})(.*)$/.exec(servicio);
    if (!m) continue;
    const pareja = `890${m[2] === '2' ? '3' : '2'}${m[3]}${m[4]}`;

    if (!(pareja in esp)) {
      if (!SINGLETONES_CONOCIDOS.has(servicio)) {
        problemas.push(
          `${servicio} está mapeado pero su pareja CUPS ${pareja} no. Si el hospital no usa ese código, decláralo como singletón conocido; si lo usa, mapéalo — sin él la cita de ${m[2] === '2' ? 'control' : 'primera vez'} no se puede agendar.`,
        );
      }
    } else if (esp[pareja] !== codigo) {
      problemas.push(
        `${servicio} (${codigo}) y su pareja CUPS ${pareja} (${esp[pareja]}) tienen especialidades distintas. Primera vez y control son el mismo procedimiento.`,
      );
    }
  }

  // El sufijo local ESP/SUR tampoco cambia la especialidad.
  for (const [servicio, codigo] of Object.entries(esp)) {
    if (!/(ESP|SUR)$/.test(servicio)) continue;
    const hermano = servicio.endsWith('ESP')
      ? `${servicio.slice(0, -3)}SUR`
      : `${servicio.slice(0, -3)}ESP`;
    if (hermano in esp && esp[hermano] !== codigo) {
      problemas.push(
        `${servicio} (${codigo}) y ${hermano} (${esp[hermano]}) tienen especialidades distintas: el sufijo ESP/SUR no cambia la especialidad.`,
      );
    }
  }

  // `especialidadPorDefecto` tapa huecos en silencio: un servicio sin mapear
  // entra al HIS con esa especialidad y nadie se entera. Ver la nota en
  // AnsermaMapping. No es un error, pero tiene que ser una decisión.
  if (mapping.especialidadPorDefecto !== undefined) {
    console.warn(
      `⚠️  El mapeo declara especialidadPorDefecto="${mapping.especialidadPorDefecto}": ` +
        `cualquier servicio fuera de especialidadPorServicio entrará al HIS con esa ` +
        `especialidad SIN avisar. Anserma la quitó a propósito el 2026-09-03.`,
    );
  }

  return problemas;
}

async function main() {
  const prisma = new PrismaClient();
  const dryRun = process.argv.includes('--dry-run');
  const orgId = process.argv.slice(2).find((a) => !a.startsWith('--'));

  const crudo = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')) as Record<string, any>;
  const problemas = revisar(crudo);
  if (problemas.length > 0) {
    console.error('❌ El archivo de mapeo es incoherente:\n');
    for (const p of problemas) console.error(`   · ${p}`);
    process.exit(1);
  }
  console.log('✓ Mapeo coherente:');
  console.log(`   ${Object.keys(crudo.especialidadPorServicio).length} servicios con especialidad`);
  console.log(`   ${crudo.serviciosPyp.length} servicios de PyP`);
  // Derivados de 90 días de citas reales del hospital y contrastados contra
  // la cota superior de uso de cada convenio (sección D de
  // docs/drivers/cnt-sanvicente-anserma/sql/PENDIENTE_CORRER_EN_HOSPITAL.sql).
  console.log(
    `   ${Object.keys(crudo.convenios).length} convenios (derivados de las citas reales del hospital)`,
  );

  // Las claves con guion bajo son procedencia y notas: no viajan al agente.
  const mapping = Object.fromEntries(
    Object.entries(crudo).filter(([k]) => !k.startsWith('_')),
  );

  if (!orgId) {
    const orgs = await prisma.hospitalMirrorConfig.findMany({
      select: { organizationId: true, driverKey: true, enabled: true },
    });
    console.log('\nOrganizaciones con espejo configurado:');
    for (const o of orgs) {
      console.log(`   ${o.organizationId}  ${o.driverKey}  enabled=${o.enabled}`);
    }
    console.log('\nVuelve a correr pasando una de ellas como argumento.');
    await prisma.$disconnect();
    return;
  }

  const actual = await prisma.hospitalMirrorConfig.findUnique({
    where: { organizationId: orgId },
    select: { mappingJson: true },
  });
  if (!actual) {
    console.error(`\n❌ No hay HospitalMirrorConfig para la organización ${orgId}.`);
    process.exit(1);
  }

  const antes = (actual.mappingJson ?? {}) as Record<string, any>;
  const espAntes = Object.keys(antes.especialidadPorServicio ?? {}).length;
  const pypAntes = (antes.serviciosPyp ?? []).length;
  console.log(
    `\nEn la base ahora: ${espAntes} servicio(s) con especialidad, ${pypAntes} de PyP.`,
  );

  if (dryRun) {
    console.log('\n(--dry-run: no se escribió nada)');
    await prisma.$disconnect();
    return;
  }

  await prisma.hospitalMirrorConfig.update({
    where: { organizationId: orgId },
    data: { mappingJson: mapping },
  });
  console.log('\n✓ mappingJson actualizado. El agente lo recoge en su próximo handshake.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
