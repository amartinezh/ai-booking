/**
 * Provisioning de un HospitalMirrorConfig — crea (o reemplaza) la fila que
 * autentica al agente de un driver para una organización, generando el
 * token de agente (se imprime UNA sola vez) y cifrando driverConfig con el
 * mismo esquema AES-256-GCM que CryptoService (apps/api/src/common/crypto),
 * para que MirrorAgentGuard pueda descifrarlo en runtime.
 *
 * Uso:
 *   AGENIA_SYNC_PASSWORD='...' ORGANIZATION_ID='<uuid>' \
 *     pnpm --filter @agenia/database exec tsx scripts/provision-mirror-config.ts
 *
 *   # o pasando la organización como argumento:
 *   AGENIA_SYNC_PASSWORD='...' pnpm --filter @agenia/database exec tsx scripts/... <organizationId>
 *
 *   # sin organización, lista las disponibles y sale:
 *   pnpm --filter @agenia/database exec tsx scripts/provision-mirror-config.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

// Carga manual del .env de apps/api (evita depender de `dotenv`, que no es
// dependencia directa de packages/database) — solo ENCRYPTION_KEY/DATABASE_URL,
// sin pisar variables ya presentes en el entorno.
function loadEnvFile(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = (rawValue ?? '').replace(/^['"]|['"]$/g, '');
  }
}
loadEnvFile(path.resolve(__dirname, '../../../apps/api/.env'));

import { PrismaClient } from '@prisma/client';

// ---- Configuración por corrida ----
// El organizationId salía quemado aquí y quedó obsoleto en cuanto la base se
// recreó con otro nombre: el script fallaba con "No existe Organization" y
// había que editarlo para cada entorno. Ahora entra por variable de entorno
// o argumento, y si falta, `resolveOrganizationId` lista las que sí existen.
const DRIVER_KEY = process.env.MIRROR_DRIVER_KEY ?? 'cnt-sanvicente-anserma';
// MIRROR_HIS_TARGET=local (default) → mock local en Docker (localhost:1433).
// MIRROR_HIS_TARGET=hospital        → red real del hospital (VM + PRUEBAS remoto).
// Cambiar de uno a otro es SOLO este bloque — nada más del sistema cambia
// (ver apps/mirror-agent/local-his-mock/README.md, "Cutover a producción").
const DRIVER_CONFIG =
  process.env.MIRROR_HIS_TARGET === 'hospital'
    ? {
        server: '192.168.1.16',
        port: 1433,
        catalog: 'PRUEBAS', // cambiar a ESEHSVP cuando el driver pase a producción real
        user: 'agenia_sync',
        password: process.env.AGENIA_SYNC_PASSWORD ?? '',
      }
    : {
        server: 'localhost',
        port: 1433,
        catalog: 'PRUEBAS',
        user: 'agenia_sync',
        password: process.env.AGENIA_SYNC_PASSWORD ?? '',
      };
// ------------------------------

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;

function getKey(): Buffer {
  const raw = (process.env.ENCRYPTION_KEY ?? '').trim().replace(/^['"]|['"]$/g, '');
  const source = raw || '12345678901234567890123456789012';
  const buf = /^[0-9a-fA-F]{64}$/.test(source) ? Buffer.from(source, 'hex') : Buffer.from(source, 'utf8');
  if (buf.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY debe medir 32 bytes (o 64 hex). Recibido: ${buf.length} bytes.`);
  }
  return buf;
}

function encryptJson(obj: unknown): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function generateAgentToken(organizationId: string): string {
  const secret = crypto.randomBytes(32).toString('hex');
  return `mirror_${organizationId}_${secret}`;
}

function hashAgentToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

const prisma = new PrismaClient();

/**
 * Resuelve la organización objetivo desde el argumento o el entorno. Cuando no
 * se puede, imprime las organizaciones que SÍ existen en la base: es la
 * información que uno necesita justo en ese momento y evita ir a buscarla a
 * psql.
 */
async function resolveOrganizationId(): Promise<string> {
  const candidato = process.argv[2] ?? process.env.ORGANIZATION_ID;

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  if (candidato) {
    const org = orgs.find((o) => o.id === candidato);
    if (org) return org.id;
    console.error(`\nNo existe ninguna Organization con id ${candidato}.`);
  } else {
    console.error('\nFalta la organización objetivo.');
  }

  if (orgs.length === 0) {
    console.error('La base no tiene ninguna organización. ¿Corriste el seed?\n');
  } else {
    console.error('\nOrganizaciones disponibles:');
    for (const o of orgs) console.error(`  ${o.id}  ${o.name}`);
    console.error(
      `\nReintenta con:\n  AGENIA_SYNC_PASSWORD='...' ORGANIZATION_ID='${orgs[0].id}' \\\n    pnpm --filter @agenia/database exec tsx scripts/provision-mirror-config.ts\n`,
    );
  }
  process.exit(2);
}

async function main() {
  if (!DRIVER_CONFIG.password) {
    throw new Error(
      'Falta la contraseña de agenia_sync. Pasarla por env: AGENIA_SYNC_PASSWORD=... pnpm --filter @agenia/database exec tsx scripts/provision-mirror-config.ts',
    );
  }

  const ORGANIZATION_ID = await resolveOrganizationId();
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: ORGANIZATION_ID },
  });

  const token = generateAgentToken(ORGANIZATION_ID);
  const agentTokenHash = hashAgentToken(token);
  const driverConfigCiphertext = encryptJson(DRIVER_CONFIG);

  const config = await prisma.hospitalMirrorConfig.upsert({
    where: { organizationId: ORGANIZATION_ID },
    create: {
      organizationId: ORGANIZATION_ID,
      enabled: false, // se activa manualmente tras validar conectividad (ver deploy/README.md)
      driverKey: DRIVER_KEY,
      agentTokenHash,
      driverConfig: driverConfigCiphertext,
      pushEnabled: true,
      pullEnabled: true,
      conflictAlertsEnabled: true,
    },
    update: {
      driverKey: DRIVER_KEY,
      agentTokenHash,
      driverConfig: driverConfigCiphertext,
    },
  });

  console.log(`\nHospitalMirrorConfig ${config.id} listo para org "${org.name}" (${ORGANIZATION_ID}).`);
  console.log(`enabled=${config.enabled} — activarlo manualmente tras la primera verificación de conectividad.\n`);
  console.log('Token del agente (se muestra UNA sola vez, no queda en ningún lado más — pegar en agent.env):');
  console.log(token);
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
