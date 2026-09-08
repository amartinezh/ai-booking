/**
 * Crea la Organization de un hospital nuevo y le engancha a los usuarios
 * SUPER_ADMIN que todavía no pertenecen a ninguna organización.
 *
 * ═══ Por qué existe ═══
 * No había ningún script para esto. El único `organization.create()` de todo
 * el repo es `prisma/seed.ts`, un script de migración de una época
 * single-tenant→multi-tenant: crea una organización con nombre genérico
 * ("Hospital San Vicente") y migra filas HUÉRFANAS (organizationId=null) de
 * ocho tablas de negocio. Correrlo contra una base de producción recién
 * instalada —sin ninguna fila huérfana que migrar— sería usar la herramienta
 * equivocada para el trabajo: el nombre no sería el legal real del hospital,
 * y arrastra lógica de migración que aquí no aplica.
 *
 * `OrganizationSettings`/`OrganizationAudioConfig` NO se crean aquí a
 * propósito: son 1:1 opcionales y todo el código que los lee ya cae a
 * defaults sensatos cuando la fila no existe (ver
 * `organization-settings.service.ts`). Crearlos vacíos no añade nada.
 *
 * Uso:
 *   pnpm --filter @agenia/database exec tsx scripts/provision-organization.ts "<nombre legal>"
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

const prisma = new PrismaClient();

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const nombre = process.argv.find(
    (a, i) => i >= 2 && !a.startsWith('--'),
  );

  if (!nombre) {
    console.error(
      '\nFalta el nombre legal de la organización.\n' +
        'Uso: pnpm --filter @agenia/database exec tsx scripts/provision-organization.ts "<nombre>" [--aplicar]\n',
    );
    process.exit(2);
  }

  const yaExiste = await prisma.organization.findUnique({ where: { name: nombre } });
  if (yaExiste) {
    console.log(`\nYa existe la organización "${nombre}" (${yaExiste.id}). Nada que hacer.\n`);
    await prisma.$disconnect();
    return;
  }

  const huerfanos = await prisma.user.findMany({
    where: { organizationId: null, role: 'SUPER_ADMIN' },
    select: { id: true, email: true },
  });

  console.log(`\nPlan:`);
  console.log(`  · Crear Organization "${nombre}" (isActive=true)`);
  if (huerfanos.length > 0) {
    console.log(`  · Enlazar ${huerfanos.length} usuario(s) SUPER_ADMIN sin organización:`);
    for (const u of huerfanos) console.log(`      - ${u.email}`);
  } else {
    console.log(`  · No hay usuarios SUPER_ADMIN sin organización que enlazar.`);
  }

  if (!aplicar) {
    console.log('\n(sin --aplicar: no se escribió nada)\n');
    await prisma.$disconnect();
    return;
  }

  const org = await prisma.$transaction(async (tx) => {
    const creada = await tx.organization.create({
      data: { name: nombre, isActive: true },
    });
    if (huerfanos.length > 0) {
      await tx.user.updateMany({
        where: { id: { in: huerfanos.map((u) => u.id) } },
        data: { organizationId: creada.id },
      });
    }
    return creada;
  });

  console.log(`\n✓ Organization creada: ${org.id}  ("${org.name}")`);
  if (huerfanos.length > 0) {
    console.log(`✓ ${huerfanos.length} usuario(s) SUPER_ADMIN enlazados.`);
  }
  console.log(`\nSiguiente paso — provisionar el HospitalMirrorConfig:`);
  console.log(
    `  AGENIA_SYNC_PASSWORD='...' ORGANIZATION_ID='${org.id}' MIRROR_HIS_TARGET=hospital \\\n` +
      `    pnpm --filter @agenia/database exec tsx scripts/provision-mirror-config.ts\n`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
