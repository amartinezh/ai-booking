/**
 * Levanta el mock local del HIS (contenedor `mirror-his-mock` de
 * docker-compose.yml) desde cero: recrea la BD `PRUEBAS` con
 * schema-and-seed.sql y corre el AGENIA_SYNC_SETUP.sql REAL y SIN MODIFICAR
 * (docs/drivers/cnt-sanvicente-anserma/sql/) para validar que ese script
 * funciona antes de correrlo contra el hospital de verdad.
 *
 * Uso:
 *   docker compose up -d mirror-his-mock
 *   AGENIA_SYNC_PASSWORD='...' npx tsx apps/mirror-agent/local-his-mock/setup.ts
 *
 * Reintentable: recrea PRUEBAS y AGENIA_SYNC desde cero cada vez que corre —
 * es un sandbox desechable, no un ambiente a preservar entre corridas.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as sql from 'mssql';

const SA_PASSWORD = process.env.MIRROR_HIS_MOCK_SA_PASSWORD ?? 'AgenIA_Local_2026!'; // ver docker-compose.yml
const AGENIA_SYNC_PASSWORD = process.env.AGENIA_SYNC_PASSWORD;

const SCHEMA_SEED_PATH = path.resolve(__dirname, 'schema-and-seed.sql');
const REAL_SETUP_SCRIPT_PATH = path.resolve(
  __dirname,
  '../../../docs/drivers/cnt-sanvicente-anserma/sql/AGENIA_SYNC_SETUP.sql',
);

function splitBatches(scriptSql: string): string[] {
  return scriptSql
    .split(/^\s*GO\s*$/im)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

async function connectWithRetry(config: sql.config, attempts = 20): Promise<sql.ConnectionPool> {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await new sql.ConnectionPool(config).connect();
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`[local-his-mock] esperando a que el motor arranque (intento ${i}/${attempts})...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('unreachable');
}

async function runBatches(pool: sql.ConnectionPool, batches: string[]) {
  for (const batch of batches) {
    await pool.request().batch(batch);
  }
}

async function main() {
  if (!AGENIA_SYNC_PASSWORD) {
    throw new Error(
      'Falta AGENIA_SYNC_PASSWORD (la misma contraseña usada en packages/database/scripts/provision-mirror-config.ts).',
    );
  }

  console.log('[local-his-mock] conectando como sa a localhost:1433...');
  const masterPool = await connectWithRetry({
    server: 'localhost',
    port: 1433,
    user: 'sa',
    password: SA_PASSWORD,
    database: 'master',
    options: { trustServerCertificate: true, encrypt: false },
  });

  console.log('[local-his-mock] limpiando estado previo (AGENIA_SYNC, login agenia_sync)...');
  await masterPool.request().batch(`
    IF DB_ID('AGENIA_SYNC') IS NOT NULL
    BEGIN
      ALTER DATABASE AGENIA_SYNC SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE AGENIA_SYNC;
    END
  `);
  await masterPool.request().batch(`
    IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'agenia_sync')
      DROP LOGIN agenia_sync;
  `);

  console.log('[local-his-mock] creando esquema + siembra de PRUEBAS...');
  const schemaSeedSql = fs.readFileSync(SCHEMA_SEED_PATH, 'utf8');
  await runBatches(masterPool, splitBatches(schemaSeedSql));

  console.log('[local-his-mock] corriendo AGENIA_SYNC_SETUP.sql (real, sin modificar salvo el password)...');
  const realSetupSql = fs
    .readFileSync(REAL_SETUP_SCRIPT_PATH, 'utf8')
    .replace('<<REEMPLAZAR_PASSWORD_FUERTE>>', AGENIA_SYNC_PASSWORD);
  await runBatches(masterPool, splitBatches(realSetupSql));

  await masterPool.close();

  console.log('\n[local-his-mock] listo. PRUEBAS + AGENIA_SYNC + login agenia_sync creados localmente.');
  console.log('Ahora el driverConfig del HospitalMirrorConfig de dev puede apuntar a:');
  console.log('  server=localhost port=1433 catalog=PRUEBAS user=agenia_sync password=<la misma de AGENIA_SYNC_PASSWORD>\n');
}

main().catch((err) => {
  console.error('[local-his-mock] error:', err);
  process.exitCode = 1;
});
