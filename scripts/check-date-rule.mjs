#!/usr/bin/env node
/**
 * Verifica la convención de fechas de CLAUDE.md: ningún `.toLocale*` puede
 * usarse sin `timeZone` explícito en las opciones.
 *
 * La regla ya existe como `no-restricted-syntax` en los eslint.config.mjs de
 * api y web, pero ahí es un WARNING y vive entre otros 1.400 problemas de
 * lint: nadie la ve. Este script la extrae y le da salida propia con código
 * de error, para que CI pueda bloquear por ella sola sin tener que esperar a
 * que el resto de la deuda de lint baje.
 *
 * Por qué importa: los contenedores corren en UTC. Un `.toLocaleString`
 * sin timeZone le muestra al paciente su cita cinco horas movida.
 *
 * Uso:  node scripts/check-date-rule.mjs        (todo)
 *       node scripts/check-date-rule.mjs api    (solo una app)
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULE = 'no-restricted-syntax';
const APPS = [
  { name: 'api', dir: 'apps/api', args: ['src'] },
  { name: 'web', dir: 'apps/web', args: ['.'] },
];

const only = process.argv[2];
const targets = only ? APPS.filter((a) => a.name === only) : APPS;
if (targets.length === 0) {
  console.error(`App desconocida: ${only}. Opciones: ${APPS.map((a) => a.name).join(', ')}`);
  process.exit(2);
}

let total = 0;

for (const app of targets) {
  const cwd = path.join(REPO, app.dir);
  let out;
  try {
    out = execFileSync('npx', ['eslint', '--format', 'json', ...app.args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // eslint sale != 0 cuando encuentra errores (que aquí es lo normal, hay
    // deuda de lint de sobra): el JSON igual viene por stdout. Solo es un
    // fallo real si no hubo salida que parsear.
    out = err.stdout;
    if (!out) {
      console.error(`✗ No se pudo ejecutar eslint en ${app.dir}:\n${err.stderr || err.message}`);
      process.exit(2);
    }
  }

  const files = JSON.parse(out.slice(out.indexOf('[')));
  const hits = files.flatMap((f) =>
    f.messages
      .filter((m) => m.ruleId === RULE)
      .map((m) => `${path.relative(REPO, f.filePath)}:${m.line}:${m.column} ${m.message}`),
  );

  total += hits.length;
  console.log(`${app.name}: ${hits.length} violación(es) de la regla de fechas`);
  for (const h of hits) console.log(`   ${h}`);
}

if (total > 0) {
  console.error(
    '\n✗ Usa los helpers canónicos en vez de .toLocale* directo:\n' +
      "    API  →  import { formatAppointmentLong, ... } from '@agenia/shared'\n" +
      "    WEB  →  import { ... } from '@/lib/date'\n" +
      '  Para formato técnico legítimo, pasa timeZone explícito.\n' +
      '  Ver CLAUDE.md → "Fechas y zona horaria".',
  );
  process.exit(1);
}

console.log('\n✓ Sin violaciones de la regla de fechas.');
