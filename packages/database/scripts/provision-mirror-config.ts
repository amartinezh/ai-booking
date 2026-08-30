/**
 * Provisioning de un HospitalMirrorConfig — crea (o reemplaza) la fila que
 * autentica al agente de un driver para una organización, generando el
 * token de agente (se imprime UNA sola vez) y cifrando driverConfig con el
 * mismo esquema AES-256-GCM que CryptoService (apps/api/src/common/crypto),
 * para que MirrorAgentGuard pueda descifrarlo en runtime.
 *
 * Uso: npx tsx packages/database/scripts/provision-mirror-config.ts
 * Ajustar las constantes de abajo antes de correrlo.
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

// ---- Ajustar por corrida ----
const ORGANIZATION_ID = 'ad8c391d-bed5-4d96-936e-0ff065e62117'; // "Hospital San Vicente" (dev)
const DRIVER_KEY = 'cnt-sanvicente-anserma';
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

async function main() {
  if (!DRIVER_CONFIG.password) {
    throw new Error(
      'Falta la contraseña de agenia_sync. Pasarla por env: AGENIA_SYNC_PASSWORD=... npx tsx ...',
    );
  }

  const org = await prisma.organization.findUnique({ where: { id: ORGANIZATION_ID } });
  if (!org) {
    throw new Error(`No existe Organization ${ORGANIZATION_ID}`);
  }

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
