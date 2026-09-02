#!/usr/bin/env node
/**
 * Contrasta el mock local del HIS contra el esquema REAL del hospital.
 *
 * ═══ Por qué existe ═══
 * `PACIENTES` parecía documentada y no lo estaba: solo teníamos su lista de
 * NOT NULL, el mock se construyó con eso, y la diferencia escondió un defecto
 * que habría roto producción — el driver escribía el nombre completo del
 * paciente en `NO_NOMB_PAC`, que en el hospital es `varchar(20)` y solo guarda
 * el primer nombre. Localmente pasaba sin ruido porque el mock la declaraba
 * `varchar(60)`; en el hospital habría fallado con el error 8152 para casi
 * cualquier paciente.
 *
 * Cuando el mock es más permisivo que el HIS, no simplifica: miente. Esto lo
 * detecta antes de que lo detecte un paciente.
 *
 * La verdad está en docs/drivers/cnt-sanvicente-anserma/esquema-real.tsv,
 * volcada del catálogo vivo con el bloque 28 de FASE0_DESCUBRIMIENTO_HIS.sql.
 *
 * Uso:  node scripts/verificar-esquema-mock.mjs
 * Sale con código 1 si hay divergencias que puedan romper el driver.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const RAIZ = path.resolve(import.meta.dirname, '..');
const FIXTURE = path.join(
  RAIZ,
  'docs/drivers/cnt-sanvicente-anserma/esquema-real.tsv',
);

// Las cuatro tablas que el driver toca de verdad. Una divergencia en las que
// ESCRIBE es un error 8152 en cara del paciente; en las que lee, una consulta
// que revienta. En el resto (catálogos homologados por mappingJson) la
// divergencia es ruido documental, no un fallo.
const ESCRIBE = new Set(['CITAS_MEDICAS', 'CITAS_ANULADAS', 'PACIENTES']);
const LEE = new Set(['CITAS_MEDICAS', 'PACIENTES', 'TURNOS_MEDICOS']);
const CRITICAS = new Set([...ESCRIBE, ...LEE]);

const c = {
  mal: (s) => `\x1b[31m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  aviso: (s) => `\x1b[33m${s}\x1b[0m`,
  tenue: (s) => `\x1b[2m${s}\x1b[0m`,
};

function leerEnv(archivo) {
  const out = {};
  for (const linea of fs.readFileSync(path.join(RAIZ, archivo), 'utf8').split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(linea);
    if (m) out[m[1]] = (m[2] ?? '').replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function leerFixture() {
  const lineas = fs
    .readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'));
  return lineas.slice(1).map((l) => {
    const [tabla, columna, tipo, ancho, nulos] = l.split('\t');
    return {
      tabla,
      columna,
      tipo: tipo.toLowerCase(),
      ancho: ancho === 'NULL' ? null : Number(ancho),
      aceptaNulos: nulos === 'SI',
    };
  });
}

const env = leerEnv('.env');
const require_ = createRequire(path.join(RAIZ, 'apps/mirror-agent/package.json'));
const mssql = require_('mssql');

const pool = await new mssql.ConnectionPool({
  server: 'localhost',
  port: 1433,
  database: 'PRUEBAS',
  user: 'sa',
  password: env.MIRROR_HIS_MOCK_SA_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
}).connect();

const { recordset } = await pool.request().query(`
  SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE ty,
         CHARACTER_MAXIMUM_LENGTH w, IS_NULLABLE n
    FROM INFORMATION_SCHEMA.COLUMNS`);
await pool.close();

const mock = new Map(
  recordset.map((f) => [
    `${f.t}|${f.c}`,
    {
      tipo: f.ty.toLowerCase(),
      ancho: f.w === -1 ? null : f.w,
      aceptaNulos: f.n === 'YES',
    },
  ]),
);
const tablasMock = new Set(recordset.map((f) => f.t));

const real = leerFixture();
const tablasReales = new Set(real.map(r => r.tabla));
const clavesReales = new Set(real.map((r) => `${r.tabla}|${r.columna}`));

const criticos = [];
const menores = [];
const anota = (t, ...resto) => (CRITICAS.has(t) ? criticos : menores).push([t, ...resto]);

for (const r of real) {
  if (!tablasMock.has(r.tabla)) continue; // tabla que el mock no reproduce
  const m = mock.get(`${r.tabla}|${r.columna}`);
  if (!m) {
    anota(r.tabla, r.columna, 'no existe en el mock', `real ${r.tipo}${r.ancho ? `(${r.ancho})` : ''}`);
    continue;
  }
  if (m.tipo !== r.tipo) anota(r.tabla, r.columna, 'tipo distinto', `mock ${m.tipo} · real ${r.tipo}`);
  else if (r.ancho !== null && m.ancho !== r.ancho)
    anota(r.tabla, r.columna, 'ancho distinto', `mock ${m.ancho} · real ${r.ancho}`);
  if (m.aceptaNulos !== r.aceptaNulos)
    anota(r.tabla, r.columna, 'nulos distintos',
      `mock ${m.aceptaNulos ? 'acepta' : 'NOT NULL'} · real ${r.aceptaNulos ? 'acepta' : 'NOT NULL'}`);
}

for (const f of recordset) {
  if (!tablasReales.has(f.t)) continue;
  if (!clavesReales.has(`${f.t}|${f.c}`))
    anota(f.t, f.c, 'el mock la inventó', 'no existe en el hospital');
}

const sinVerificar = [...tablasMock].filter((t) => !tablasReales.has(t)).sort();

const pinta = (lista) => {
  for (const [t, col, que, detalle] of lista)
    console.log(`  ${t.padEnd(16)} ${col.padEnd(24)} ${que.padEnd(22)} ${c.tenue(detalle)}`);
};

console.log(`\nMock contrastado contra ${real.length} columnas reales de ${tablasReales.size} tablas.\n`);

if (criticos.length > 0) {
  console.log(c.mal(`✗ ${criticos.length} divergencia(s) en tablas que el driver TOCA:\n`));
  pinta(criticos);
  console.log(c.tenue('\n  Una divergencia aquí no se ve en pruebas locales y sí en el hospital.'));
} else {
  console.log(c.ok('✓ Las tablas que el driver toca coinciden con el hospital.'));
}

if (menores.length > 0) {
  console.log(c.aviso(`\n⚠ ${menores.length} divergencia(s) en catálogos que el driver NO consulta:\n`));
  pinta(menores);
  console.log(c.tenue('\n  El driver los homologa por mappingJson, así que esto no rompe nada,\n  pero el mock está describiendo mal el hospital.'));
}

if (sinVerificar.length > 0) {
  console.log(c.tenue(`\nSin verificar (el mock las tiene, el volcado real no): ${sinVerificar.join(', ')}`));
}

console.log('');
process.exit(criticos.length > 0 ? 1 : 0);
