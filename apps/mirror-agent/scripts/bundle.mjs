// Compila el agente en un solo archivo (dist/agent.bundle.js) y le deja adentro con
// qué se compiló: commit, si había cambios sin commit y la fecha. Al final imprime la
// HUELLA (sha256) del archivo: es la que el agente reporta en cada latido y la que
// muestra el Espejo para confirmar que la actualización quedó instalada.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: raiz,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null; // Fuera del repositorio: se compila igual, sin commit.
  }
}

const commit = git('rev-parse', '--short=7', 'HEAD');
const cambios = git('status', '--porcelain');
const compilacion = {
  commit,
  dirty: commit !== null && cambios !== null && cambios !== '',
  builtAtIso: new Date().toISOString(),
};

const outfile = resolve(raiz, 'dist/agent.bundle.js');
await build({
  entryPoints: [resolve(raiz, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile,
  define: {
    __AGENIA_AGENT_BUILD__: JSON.stringify(JSON.stringify(compilacion)),
  },
  logLevel: 'info',
});

const huella = createHash('sha256').update(readFileSync(outfile)).digest('hex');
const desde = commit
  ? `${commit}${compilacion.dirty ? ' con cambios sin commit' : ''}`
  : 'sin commit';
console.log(`\nHuella (sha256): ${huella}`);
console.log(`El Espejo mostrará: ${huella.slice(0, 12)} · ${desde}`);
