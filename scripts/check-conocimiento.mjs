#!/usr/bin/env node
/**
 * Vigila docs/conocimiento/AGENIA.md, la base de conocimiento del sistema y la
 * fuente única del Centro de ayuda del panel (ver docs/conocimiento/README.md).
 *
 * Dos cosas:
 *
 *   1. Que el archivo esté bien: la Parte 1 se lee con el MISMO lector que usa
 *      la página (apps/web/lib/ayuda/conocimiento.ts), los enlaces apuntan a
 *      temas que existen y cada opción del menú del administrador
 *      (apps/web/lib/menus.ts) tiene su tema con el mismo título.
 *
 *   2. Que se mantenga al día: un commit que toca código del producto debe
 *      tocar también AGENIA.md, salvo que su mensaje diga explícitamente
 *      «Conocimiento: no aplica — <por qué>».
 *
 * Uso:
 *   node scripts/check-conocimiento.mjs                         solo (1)
 *   node scripts/check-conocimiento.mjs --staged [--msg-file F] (1) sobre lo preparado + (2) para el commit en curso (gancho commit-msg)
 *   node scripts/check-conocimiento.mjs --range A..B            (1) + (2) para cada commit del rango (CI)
 *
 * Lee TypeScript con el «type stripping» de Node 22; si esta versión de Node
 * lo trae apagado, se vuelve a lanzar a sí mismo con la bandera.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.features?.typescript && !process.env.__CONOCIMIENTO_REEJECUTADO) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, __CONOCIMIENTO_REEJECUTADO: '1' },
  });
  process.exit(r.status ?? 1);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVO = 'docs/conocimiento/AGENIA.md';
const EXENCION = /^Conocimiento:\s*no aplica\b/im;

/** Lo que cuenta como «código del producto»: si cambia, el conocimiento también. */
const PRODUCTO = [
  /^apps\/(api|mirror-agent)\/src\//,
  /^apps\/web\/(app|lib|components|hooks)\//,
  /^apps\/web\/middleware\.ts$/,
  /^packages\/[^/]+\/src\//,
  /^packages\/database\/prisma\//,
  /^deploy\//,
];
/** Pruebas y utilería de pruebas: no cambian lo que hace el sistema. */
const NO_CUENTA = [/\.(spec|test)\.[a-z]+$/, /(^|\/)__tests__\//, /(^|\/)__mocks__\//, /\.fixture\.[a-z]+$/];

const esProducto = (f) => PRODUCTO.some((r) => r.test(f)) && !NO_CUENTA.some((r) => r.test(f));

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const rojo = (s) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const verde = (s) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s);

// ── 1. El archivo está bien ─────────────────────────────────

async function validarArchivo(markdown, origen) {
  const lector = await import(pathToFileURL(path.join(REPO, 'apps/web/lib/ayuda/conocimiento.ts')).href);
  const { getMenusForRole } = await import(pathToFileURL(path.join(REPO, 'apps/web/lib/menus.ts')).href);

  let contenido;
  try {
    contenido = lector.parsearConocimiento(markdown);
  } catch (e) {
    return [`${ARCHIVO} (${origen}), ${e.message}`];
  }

  const problemas = lector.validarConocimiento(contenido).map((p) => `${ARCHIVO}: ${p}`);
  const menu = getMenusForRole('ORG_ADMIN', { conEspejo: true, conAvisos: true });
  for (const m of menu) {
    const tema = lector.temaDeRuta(contenido.temas, m.href);
    if (!tema) problemas.push(`${ARCHIVO}: la opción del menú «${m.label}» (${m.href}) no tiene su tema en la Parte 1.`);
    else if (tema.titulo !== m.label) problemas.push(`${ARCHIVO}: el tema de ${m.href} se llama «${tema.titulo}» y en el menú «${m.label}».`);
  }
  const rutas = new Set(menu.map((m) => m.href));
  for (const t of contenido.temas) {
    if (t.href && !rutas.has(t.href)) problemas.push(`${ARCHIVO}: el tema «${t.titulo}» apunta a ${t.href}, que no está en el menú del administrador.`);
  }
  if (!/^\*\*Última actualización:\*\* \d{4}-\d{2}-\d{2}$/m.test(markdown)) problemas.push(`${ARCHIVO}: falta la línea «**Última actualización:** AAAA-MM-DD».`);
  if (!/^# Parte 3 · Bitácora de cambios$/m.test(markdown)) problemas.push(`${ARCHIVO}: falta la «# Parte 3 · Bitácora de cambios».`);
  return problemas;
}

// ── 2. Se mantiene al día ───────────────────────────────────

function faltaElConocimiento(archivos, mensaje) {
  const producto = archivos.filter(esProducto);
  if (producto.length === 0 || archivos.includes(ARCHIVO) || EXENCION.test(mensaje)) return null;
  return producto;
}

function explicar(producto) {
  const lista = producto.slice(0, 8).map((f) => `      ${f}`).join('\n');
  const mas = producto.length > 8 ? `\n      … y ${producto.length - 8} más` : '';
  return `toca código del producto y no actualiza ${ARCHIVO}:\n${lista}${mas}`;
}

const AYUDA = `
  Actualiza ${ARCHIVO} en el mismo commit: lo que cambió (Parte 1 si se ve en el
  panel, Parte 2 si es comportamiento), una línea en la bitácora (Parte 3) y la
  fecha de «Última actualización». Si de verdad no cambia nada para quien usa o
  mantiene el sistema, agrega al mensaje del commit la línea:

      Conocimiento: no aplica — <por qué>

  Reglas y formato: docs/conocimiento/README.md`;

// ── Principal ───────────────────────────────────────────────

const args = process.argv.slice(2);
const valor = (bandera) => {
  const i = args.indexOf(bandera);
  return i === -1 ? null : args[i + 1];
};

const errores = [];
let markdown;
let origen = 'en disco';

if (args.includes('--staged')) {
  // Lo que va a entrar al commit, no lo que hay en disco.
  const preparados = git('diff', '--cached', '--name-only', '--diff-filter=ACMRD').split('\n').filter(Boolean);
  const archivoMsg = valor('--msg-file');
  const mensaje = archivoMsg && existsSync(archivoMsg) ? readFileSync(archivoMsg, 'utf8').replace(/^#.*$/gm, '') : '';
  const enMerge = existsSync(path.join(REPO, git('rev-parse', '--git-dir').trim(), 'MERGE_HEAD'));
  if (!enMerge) {
    const falta = faltaElConocimiento(preparados, mensaje);
    if (falta) errores.push(`Este commit ${explicar(falta)}`);
  }
  try {
    markdown = git('show', `:${ARCHIVO}`);
    origen = 'preparado para el commit';
  } catch {
    markdown = null;
  }
} else if (valor('--range')) {
  const rango = valor('--range');
  const [desde, hasta] = rango.split('..');
  let commits;
  try {
    git('cat-file', '-e', `${desde}^{commit}`);
    commits = git('rev-list', '--no-merges', '--reverse', rango).split('\n').filter(Boolean);
  } catch {
    // Rama nueva o historia reescrita: solo se puede juzgar el último commit.
    commits = [hasta || 'HEAD'];
  }
  for (const sha of commits) {
    const archivos = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha).split('\n').filter(Boolean);
    const mensaje = git('log', '-1', '--format=%B', sha);
    const falta = faltaElConocimiento(archivos, mensaje);
    if (falta) errores.push(`El commit ${sha.slice(0, 9)} «${mensaje.split('\n')[0].slice(0, 90)}» ${explicar(falta)}`);
  }
}

if (markdown === undefined) markdown = existsSync(path.join(REPO, ARCHIVO)) ? readFileSync(path.join(REPO, ARCHIVO), 'utf8') : null;
if (markdown === null) errores.push(`No existe ${ARCHIVO}.`);
else errores.push(...(await validarArchivo(markdown, origen)));

if (errores.length > 0) {
  console.error(rojo(`✗ Conocimiento del sistema (${ARCHIVO}):`));
  for (const e of errores) console.error(`  · ${e}`);
  if (errores.some((e) => e.includes('no actualiza'))) console.error(AYUDA);
  process.exit(1);
}
console.log(verde(`✓ ${ARCHIVO}: bien formado, cubre el menú del administrador y está al día.`));
