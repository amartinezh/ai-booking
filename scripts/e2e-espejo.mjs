#!/usr/bin/env node
/**
 * Prueba de punta a punta del espejo con el HIS, contra el sistema REAL:
 * WhatsApp → API → Postgres → outbox → agente en la VM → SQL Server.
 *
 * No mockea nada. Habla con el webhook por HTTP (firmado, como Meta), lee las
 * respuestas del bot de `InteractionLog`, y verifica la cita en las DOS bases.
 *
 * Uso:
 *   node scripts/e2e-espejo.mjs --decir "Hola" --decir "A"     # turnos sueltos
 *   node scripts/e2e-espejo.mjs --estado                        # foto de ambos sistemas
 *   node scripts/e2e-espejo.mjs --restaurar-secreto             # si un run murió a mitad
 *
 * ⚠️ FIRMA DEL WEBHOOK: el endpoint exige la firma de Meta y el App Secret de
 * la clínica está cifrado en la base — no lo conocemos en claro. Para poder
 * firmar, el script instala TEMPORALMENTE un secreto de prueba, guarda el
 * cifrado original en .local/run/appsecret.bak y lo restaura al terminar
 * (incluso si falla). Es la única forma de ejercitar el camino real de firma
 * sin desactivarlo.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';

const RAIZ = path.resolve(import.meta.dirname, '..');
const BACKUP = path.join(RAIZ, '.local/run/appsecret.bak');
const API = process.env.API_URL ?? 'http://localhost:3001';
const TELEFONO = process.env.WA_FROM ?? '573999007777';

// ── utilidades ────────────────────────────────────────────────────────────
const c = {
  t: (s) => `\x1b[36m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  mal: (s) => `\x1b[31m${s}\x1b[0m`,
  tenue: (s) => `\x1b[2m${s}\x1b[0m`,
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function envDe(archivo) {
  const out = {};
  for (const linea of fs.readFileSync(path.join(RAIZ, archivo), 'utf8').split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(linea);
    if (m) out[m[1]] = (m[2] ?? '').replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const ENV = envDe('.env');
const API_ENV = envDe('apps/api/.env');

// `execFileSync` mete el comando completo en el mensaje de error, y ahí van
// las contraseñas. Se envuelve para que un fallo diga qué falló sin publicar
// las credenciales en la consola ni en un log de CI.
function correr(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch (e) {
    const salida = (e.stderr || e.stdout || '').toString().trim().split('\n').slice(0, 3).join(' ');
    throw new Error(`${cmd} falló: ${salida || e.message.split('\n')[0]}`);
  }
}

const pg = (sql) =>
  correr('docker', [
    'exec', 'agenia_db', 'psql', '-U', ENV.POSTGRES_USER, '-d', ENV.POSTGRES_DB,
    '-tAF|', '-c', sql,
  ]);

// El HIS se consulta por TCP desde el host, NO con `docker exec sqlcmd`.
//
// La imagen de SQL Server solo existe para amd64 y en Apple Silicon corre
// emulada; esa emulación se cae cada tanto y entonces `docker exec` de
// cualquier binario del contenedor falla con "exec format error" aunque el
// motor siga atendiendo conexiones tan campante. Hablarle por el puerto —
// que es lo que hace el agente— no depende de la emulación para nada.
const require_ = createRequire(path.join(RAIZ, 'apps/mirror-agent/package.json'));
const mssql = require_('mssql');
let poolHis = null;

async function his(sql) {
  poolHis ??= await new mssql.ConnectionPool({
    server: 'localhost',
    port: 1433,
    database: 'PRUEBAS',
    user: 'sa',
    password: ENV.MIRROR_HIS_MOCK_SA_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  }).connect();
  const r = await poolHis.request().query(sql);
  return r.recordset ?? [];
}

const tabla = (filas) =>
  filas.length === 0
    ? '(sin filas)'
    : filas.map((f) => Object.values(f).map((v) => (v instanceof Date ? v.toISOString() : v)).join(' | ')).join('\n');

// ── firma del webhook ─────────────────────────────────────────────────────
function llaveCifrado() {
  const raw = (API_ENV.ENCRYPTION_KEY ?? '').trim();
  const fuente = raw || '12345678901234567890123456789012';
  return /^[0-9a-fA-F]{64}$/.test(fuente)
    ? Buffer.from(fuente, 'hex')
    : Buffer.from(fuente, 'utf8');
}

function cifrar(texto) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', llaveCifrado(), iv);
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

const SECRETO_PRUEBA = 'e2e-espejo-app-secret';

function instalarSecretoDePrueba() {
  const [id, actual] = pg(
    `SELECT id, coalesce("encryptedAppSecret",'') FROM "WhatsappAccountConfig" LIMIT 1;`,
  ).split('|');
  if (!id) throw new Error('No hay WhatsappAccountConfig: ¿está configurada la org?');
  if (!fs.existsSync(BACKUP)) {
    fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
    fs.writeFileSync(BACKUP, JSON.stringify({ id, encryptedAppSecret: actual }));
  }
  pg(`UPDATE "WhatsappAccountConfig" SET "encryptedAppSecret"='${cifrar(SECRETO_PRUEBA)}' WHERE id='${id}';`);
}

function restaurarSecreto() {
  if (!fs.existsSync(BACKUP)) return;
  const { id, encryptedAppSecret } = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  const valor = encryptedAppSecret ? `'${encryptedAppSecret}'` : 'NULL';
  pg(`UPDATE "WhatsappAccountConfig" SET "encryptedAppSecret"=${valor} WHERE id='${id}';`);
  fs.unlinkSync(BACKUP);
}

// ── conversación ──────────────────────────────────────────────────────────
let contador = 0;

async function decir(texto) {
  const phoneNumberId = pg(`SELECT "phoneNumberId" FROM "WhatsappAccountConfig" LIMIT 1;`);
  const cuerpo = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: phoneNumberId },
          messages: [{
            id: `wamid.E2E${Date.now()}${contador++}`,
            from: TELEFONO,
            type: 'text',
            text: { body: texto },
          }],
        },
      }],
    }],
  });
  const firma = 'sha256=' +
    crypto.createHmac('sha256', SECRETO_PRUEBA).update(cuerpo).digest('hex');

  const antes = pg(
    `SELECT coalesce(max("createdAt")::text,'1970-01-01') FROM "InteractionLog" WHERE "whatsappId"='${TELEFONO}';`,
  );

  const res = await fetch(`${API}/chatbot/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma },
    body: cuerpo,
  });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${await res.text()}`);

  // La cola de entrada procesa en background: se espera a que aparezca la
  // respuesta del bot, no a que el webhook devuelva 200.
  for (let i = 0; i < 60; i++) {
    await dormir(500);
    const r = pg(
      `SELECT replace(coalesce("botReply",''), E'\\n', ' ⏎ ') FROM "InteractionLog" ` +
      `WHERE "whatsappId"='${TELEFONO}' AND "createdAt" > '${antes}' ORDER BY "createdAt" DESC LIMIT 1;`,
    );
    if (r) return r;
  }
  throw new Error(`sin respuesta del bot tras decir "${texto}"`);
}

// ── fotos del estado ──────────────────────────────────────────────────────
async function estado() {
  console.log(c.t('\n── AgenIA (Postgres) ──'));
  console.log(pg(`SELECT a.status, s."startTime", p."fullName", p.cedula
     FROM "Appointment" a
     JOIN "ScheduleSlot" s ON s.id=a."scheduleSlotId"
     JOIN "PatientProfile" p ON p.id=a."patientId"
     ORDER BY s."startTime";`) || '(sin citas)');
  console.log(c.t('\n── Hospital (SQL Server / CITAS_MEDICAS) ──'));
  console.log(tabla(await his(`SELECT CD_CODI_MED_CIT AS medico, FE_HORA_CIT AS hora, NU_HIST_PAC_CIT AS documento,
            NU_ESTA_CIT AS estado, NU_NUME_CONV_CIT AS convenio, CD_CODI_SER_CIT AS servicio,
            DE_DESC_CIT AS origen
     FROM CITAS_MEDICAS ORDER BY FE_HORA_CIT`)));
  console.log(c.t('\n── Outbox ──'));
  console.log(pg(`SELECT seq, "entityType", op, attempts, "deadLettered",
     ("deliveredAt" IS NOT NULL) AS entregado FROM "SyncOutbox" ORDER BY seq DESC LIMIT 8;`));
}

// ── main ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--restaurar-secreto')) {
  restaurarSecreto();
  console.log(c.ok('App Secret original restaurado.'));
  process.exit(0);
}

const mensajes = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--decir') mensajes.push(args[++i]);
}

(async () => {
  // Escotillas para inspeccionar cualquiera de los dos sistemas sin abrir un
  // cliente aparte — y sin pasar por `docker exec`, que en este host se cae
  // cada tanto por la emulación.
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--his') {
      console.log(tabla(await his(args[++i])));
      await poolHis?.close();
      return;
    }
    if (args[i] === '--pg') {
      console.log(pg(args[++i]));
      return;
    }
  }

  if (args.includes('--estado') && mensajes.length === 0) {
    await estado();
    return;
  }
  instalarSecretoDePrueba();
  try {
    for (const m of mensajes) {
      console.log(c.t(`\n👤 ${m}`));
      const r = await decir(m);
      console.log(`🤖 ${r.slice(0, 700)}`);
    }
    if (args.includes('--estado')) await estado();
  } finally {
    restaurarSecreto();
    await poolHis?.close();
  }
})().catch(async (e) => {
  restaurarSecreto();
  await poolHis?.close().catch(() => {});
  console.error(c.mal(`\n✗ ${e.message}`));
  process.exitCode = 1;
});
