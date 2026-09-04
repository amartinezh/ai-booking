/**
 * Deja la tabla `Eps` de una organización exactamente como pide el arranque
 * del piloto: las aseguradoras acordadas encendidas, el resto apagadas.
 *
 * ═══ Por qué existe ═══
 * El hospital de Anserma decidió (correo del 2026-09-04) arrancar con DOS
 * aseguradoras: **Salud Total y Sura**. Nueva EPS no entra al primer corte.
 * Eso son tres operaciones sobre `Eps` —crear una, comprobar otra, apagar la
 * tercera— y las tres tienen que salir bien EN PRODUCCIÓN, un domingo, en la
 * ventana de mantenimiento. Hacerlas a mano es justo como se cruzaron los NIT
 * de Nueva EPS y Sura en su día: dos errores que se cancelaban y nadie vio,
 * hasta que se midió contra la tabla `EPS` del hospital.
 *
 * ═══ La invariante que impone ═══
 * El NIT **no se escribe aquí**: se lee de `mapping.json`, que es el archivo
 * que el hospital confirmó. Así no hay dos fuentes que puedan discrepar — si
 * el NIT de la fila `Eps` y el de la clave del convenio no coinciden,
 * `resolveConvenio` no encuentra el convenio y la cita muere en dead-letter
 * DESPUÉS de que el paciente recibió su confirmación.
 *
 * Y **se niega a encender** una EPS a la que le falte el convenio de alguno de
 * los dos regímenes. Es el agujero por el que se coló `Nueva EPS
 * CONTRIBUTIVO`: el NIT estaba en el mapeo (por su clave de subsidiado), así
 * que cualquier chequeo por NIT lo daba por bueno.
 *
 * ═══ Lo que NO hace ═══
 * Cargar el padrón. Lo reporta —una EPS encendida con el padrón vacío no deja
 * agendar a NADIE, porque `rejectIfNotEnrolledInEps` exige la cédula— pero
 * cargarlo es un CSV del hospital, no trabajo de este script.
 *
 * Uso:
 *   pnpm --filter @agenia/database exec tsx scripts/provision-eps-piloto.ts <organizationId>
 *   # por defecto NO escribe: muestra el plan y sale. --aplicar lo ejecuta.
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

/**
 * Las aseguradoras del primer corte, por NOMBRE.
 *
 * El nombre es lo que ve el paciente en WhatsApp y lo que el chatbot empareja
 * cuando escribe "salud total" o "sura". El NIT sale del mapeo, no de aquí.
 */
const PILOTO = [
  { nombre: 'Salud Total', nit: '800130907' },
  { nombre: 'Sura', nit: '800088702' },
];

/** Se deja siempre encendida: no tiene convenio, paga el paciente. */
const PARTICULAR = 'Particular';

const REGIMENES = ['SUBSIDIADO', 'CONTRIBUTIVO'];

async function main() {
  const prisma = new PrismaClient();
  const aplicar = process.argv.includes('--aplicar');
  const orgId = process.argv.slice(2).find((a) => !a.startsWith('--'));

  if (!orgId) {
    const orgs = await prisma.organization.findMany({
      select: { id: true, name: true },
    });
    console.log('Organizaciones disponibles:\n');
    for (const o of orgs) console.log(`   ${o.id}  ${o.name}`);
    console.log('\nVuelve a correr pasando una de ellas como argumento.');
    await prisma.$disconnect();
    return;
  }

  // ── El mapeo manda sobre los NIT ─────────────────────────────────────────
  const mapeo = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../docs/drivers/cnt-sanvicente-anserma/mapping.json',
      ),
      'utf8',
    ),
  ) as { convenios: Record<string, number> };

  console.log(`\n🏥 Organización: ${orgId}`);
  console.log(`📄 NIT y convenios: docs/drivers/cnt-sanvicente-anserma/mapping.json\n`);

  // ── Comprobación previa: ¿tienen convenio los dos regímenes? ─────────────
  const sinConvenio: string[] = [];
  for (const eps of PILOTO) {
    for (const regimen of REGIMENES) {
      if (mapeo.convenios[`${eps.nit}|${regimen}`] === undefined) {
        sinConvenio.push(`${eps.nombre} (${eps.nit}) · ${regimen}`);
      }
    }
  }
  if (sinConvenio.length > 0) {
    console.error(
      `❌ No se puede encender el piloto. Falta convenio para:\n` +
        sinConvenio.map((s) => `     · ${s}`).join('\n') +
        `\n\n   Un paciente de esa combinación agendaría por WhatsApp, recibiría\n` +
        `   la confirmación, y su cita moriría en dead-letter al escribirse en\n` +
        `   el HIS. Añade el convenio al mapping.json antes de encender.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }
  for (const eps of PILOTO) {
    const conv = REGIMENES.map(
      (r) => `${r[0]}${mapeo.convenios[`${eps.nit}|${r}`]}`,
    ).join(' · ');
    console.log(`   ✅ ${eps.nombre.padEnd(14)} ${eps.nit}   convenios ${conv}`);
  }

  // ── El plan ───────────────────────────────────────────────────────────────
  const existentes = await prisma.eps.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      nit: true,
      isActive: true,
      _count: { select: { enrolledPatients: true } },
    },
    orderBy: { name: 'asc' },
  });

  const enPiloto = (nombre: string) =>
    PILOTO.some((p) => p.nombre.toLowerCase() === nombre.toLowerCase()) ||
    nombre.toLowerCase() === PARTICULAR.toLowerCase();

  type Accion = { texto: string; ejecutar: () => Promise<unknown> };
  const acciones: Accion[] = [];

  for (const eps of PILOTO) {
    const fila = existentes.find(
      (e) => e.name.toLowerCase() === eps.nombre.toLowerCase(),
    );
    if (!fila) {
      acciones.push({
        texto: `CREAR    ${eps.nombre} (${eps.nit}) — activa`,
        ejecutar: () =>
          prisma.eps.create({
            data: {
              name: eps.nombre,
              nit: eps.nit,
              isActive: true,
              organizationId: orgId,
            },
          }),
      });
      continue;
    }
    const cambios: string[] = [];
    if (fila.nit !== eps.nit) cambios.push(`nit ${fila.nit ?? '∅'} → ${eps.nit}`);
    if (!fila.isActive) cambios.push('isActive false → true');
    if (cambios.length > 0) {
      acciones.push({
        texto: `AJUSTAR  ${eps.nombre}: ${cambios.join(', ')}`,
        ejecutar: () =>
          prisma.eps.update({
            where: { id: fila.id },
            data: { nit: eps.nit, isActive: true },
          }),
      });
    }
  }

  // Todo lo que no es del piloto se apaga. No se borra: sus citas históricas
  // la referencian, y volverá a encenderse cuando el hospital lo decida.
  for (const fila of existentes) {
    if (enPiloto(fila.name) || !fila.isActive) continue;
    acciones.push({
      texto: `APAGAR   ${fila.name} (${fila.nit ?? 'sin NIT'}) — fuera del primer corte`,
      ejecutar: () =>
        prisma.eps.update({
          where: { id: fila.id },
          data: { isActive: false },
        }),
    });
  }

  console.log('\n── Plan ──────────────────────────────────────────────────');
  if (acciones.length === 0) {
    console.log('   (nada que hacer: la tabla ya está como pide el piloto)');
  } else {
    for (const a of acciones) console.log(`   ${a.texto}`);
  }

  if (!aplicar) {
    console.log(
      '\n(sin --aplicar no se escribió nada: este plan es para que alguien lo mire)',
    );
    await prisma.$disconnect();
    return;
  }

  for (const a of acciones) await a.ejecutar();
  console.log(`\n✅ Aplicado (${acciones.length} cambios).`);

  // ── El padrón, que es lo que de verdad deja agendar ──────────────────────
  const finales = await prisma.eps.findMany({
    where: { organizationId: orgId, isActive: true },
    select: {
      name: true,
      nit: true,
      _count: { select: { enrolledPatients: true } },
    },
    orderBy: { name: 'asc' },
  });

  console.log('\n── EPS activas y su padrón ───────────────────────────────');
  const vacias: string[] = [];
  for (const e of finales) {
    const n = e._count.enrolledPatients;
    console.log(`   ${e.name.padEnd(14)} ${(e.nit ?? '—').padEnd(11)} ${n} afiliados`);
    if (n === 0 && e.name.toLowerCase() !== PARTICULAR.toLowerCase()) {
      vacias.push(e.name);
    }
  }
  if (vacias.length > 0) {
    console.warn(
      `\n⚠️  Padrón VACÍO en: ${vacias.join(', ')}.\n` +
        `   Ningún paciente de esas EPS puede agendar todavía:\n` +
        `   rejectIfNotEnrolledInEps le responderá que su documento no figura\n` +
        `   dado de alta. Hace falta cargar el CSV que entrega el hospital.`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
