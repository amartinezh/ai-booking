/**
 * Levanta el mock local del HIS (contenedor `mirror-his-mock` de
 * docker-compose.yml) desde cero: recrea la BD `PRUEBAS` con
 * schema-and-seed.sql y corre el AGENIA_SYNC_SETUP.sql REAL y SIN MODIFICAR
 * (docs/drivers/cnt-sanvicente-anserma/sql/) para validar que ese script
 * funciona antes de correrlo contra el hospital de verdad. Después agrega la
 * historia clínica (historia-clinica.sql) y le da a agenia_sync, columna por
 * columna, lo que pide el bloque P-7 para el resumen de la atención.
 *
 * Uso:
 *   docker compose up -d mirror-his-mock
 *   AGENIA_SYNC_PASSWORD='...' pnpm --filter @agenia/mirror-agent exec tsx local-his-mock/setup.ts
 *
 * Reintentable: recrea PRUEBAS y AGENIA_SYNC desde cero cada vez que corre —
 * es un sandbox desechable, no un ambiente a preservar entre corridas.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as sql from 'mssql';

/**
 * Lee una variable del `.env` de la raíz del repo. Este script se corre suelto
 * con `npx tsx`, así que no hereda el entorno que docker compose sí carga solo.
 * La clave NO tiene valor por defecto a propósito: un fallback hardcodeado es
 * una credencial en git, que es justo lo que este archivo dejó de tener.
 */
function readRootEnv(key: string): string | undefined {
  const envPath = path.resolve(__dirname, '../../../.env');
  if (!fs.existsSync(envPath)) return undefined;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] === key) return match[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const SA_PASSWORD = process.env.MIRROR_HIS_MOCK_SA_PASSWORD ?? readRootEnv('MIRROR_HIS_MOCK_SA_PASSWORD');
if (!SA_PASSWORD) {
  console.error(
    'Falta MIRROR_HIS_MOCK_SA_PASSWORD.\n' +
      'Genera el .env de la raíz con:  ./scripts/secrets-init.sh\n' +
      'o pásala en la invocación:      MIRROR_HIS_MOCK_SA_PASSWORD=... npx tsx ...',
  );
  process.exit(1);
}
const AGENIA_SYNC_PASSWORD = process.env.AGENIA_SYNC_PASSWORD;
// El mismo puerto que publica docker-compose.yml (HIS_MOCK_PORT, 1433 por defecto).
const PORT = Number(process.env.HIS_MOCK_PORT ?? readRootEnv('HIS_MOCK_PORT') ?? 1433);

const SCHEMA_SEED_PATH = path.resolve(__dirname, 'schema-and-seed.sql');
const REAL_SETUP_SCRIPT_PATH = path.resolve(
  __dirname,
  '../../../docs/drivers/cnt-sanvicente-anserma/sql/AGENIA_SYNC_SETUP.sql',
);
const HISTORIA_CLINICA_PATH = path.resolve(__dirname, 'historia-clinica.sql');
const P7_SCRIPT_PATH = path.resolve(
  __dirname,
  '../../../docs/drivers/cnt-sanvicente-anserma/sql/HISTORIA_CLINICA_PRUEBAS_SOLO_LECTURA.sql',
);

/**
 * Las columnas que pide el bloque P-7 (su `INSERT #cols VALUES`), por tabla.
 * Una sola fuente: lo que el mock le da a agenia_sync es exactamente el texto
 * que se le pedirá a TI. Si el agente lee una columna fuera de la lista, el
 * mock lo rechaza igual que el hospital.
 */
function permisosDeP7(scriptSql: string): Map<string, string[]> {
  const bloque = /INSERT #cols VALUES([\s\S]*?\));/.exec(scriptSql)?.[1];
  if (!bloque) throw new Error(`No encontré la lista de columnas de P-7 en ${P7_SCRIPT_PATH}`);
  const porTabla = new Map<string, string[]>();
  for (const [, tabla, columna] of bloque.matchAll(/\('([A-Z0-9_]+)',\s*'([A-Z0-9_]+)'\)/g)) {
    const columnas = porTabla.get(tabla) ?? [];
    if (!columnas.includes(columna)) columnas.push(columna);
    porTabla.set(tabla, columnas);
  }
  return porTabla;
}

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

  console.log(`[local-his-mock] conectando como sa a localhost:${PORT}...`);
  const masterPool = await connectWithRetry({
    server: 'localhost',
    port: PORT,
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
  // AGENIA_SYNC_SETUP.sql también da los permisos en ESEHSVP (su sección
  // 4-ESEHSVP, el catálogo vivo). Aquí es una copia de PRUEBAS, solo para que
  // el script real corra entero sin editarlo; el agente de dev lee PRUEBAS.
  console.log('[local-his-mock] creando ESEHSVP (copia de PRUEBAS para la sección 4-ESEHSVP)...');
  await runBatches(masterPool, splitBatches(schemaSeedSql.replace(/\bPRUEBAS\b/g, 'ESEHSVP')));

  console.log('[local-his-mock] corriendo AGENIA_SYNC_SETUP.sql (real, sin modificar salvo el password)...');
  const realSetupSql = fs
    .readFileSync(REAL_SETUP_SCRIPT_PATH, 'utf8')
    .replace('<<REEMPLAZAR_PASSWORD_FUERTE>>', AGENIA_SYNC_PASSWORD);
  await runBatches(masterPool, splitBatches(realSetupSql));

  console.log('[local-his-mock] agregando la historia clínica (resumen de la atención)...');
  await runBatches(masterPool, splitBatches(fs.readFileSync(HISTORIA_CLINICA_PATH, 'utf8')));

  const permisos = permisosDeP7(fs.readFileSync(P7_SCRIPT_PATH, 'utf8'));
  let columnas = 0;
  for (const [tabla, cols] of permisos) {
    try {
      await masterPool
        .request()
        .batch(`USE PRUEBAS; GRANT SELECT (${cols.join(', ')}) ON dbo.${tabla} TO agenia_sync;`);
    } catch (err) {
      throw new Error(
        `P-7 pide dbo.${tabla} (${cols.join(', ')}) y el mock no la tiene así: ` +
          `agrégala a historia-clinica.sql. ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    columnas += cols.length;
  }
  console.log(`[local-his-mock] agenia_sync lee ${columnas} columnas de ${permisos.size} tablas (bloque P-7).`);

  await masterPool.close();

  console.log('\n[local-his-mock] listo. PRUEBAS + AGENIA_SYNC + login agenia_sync creados localmente.');
  console.log('Para probar el lector del resumen de la atención: local-his-mock/probar-resumen.ts');
  console.log('Ahora el driverConfig del HospitalMirrorConfig de dev puede apuntar a:');
  console.log(`  server=localhost port=${PORT} catalog=PRUEBAS user=agenia_sync password=<la misma de AGENIA_SYNC_PASSWORD>\n`);
}

main().catch((err) => {
  console.error('[local-his-mock] error:', err);
  process.exitCode = 1;
});
