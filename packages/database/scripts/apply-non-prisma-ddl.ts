/**
 * Aplica prisma/sql/non-prisma-ddl.sql — el DDL que Prisma no gestiona
 * (triggers, funciones, indices parciales).
 *
 * Se corre SIEMPRE despues de `prisma db push` y despues de
 * `prisma migrate deploy`, en los cuatro caminos que construyen una base:
 * scripts/up.sh, deploy/install-vps.sh, deploy/agenia.sh y el contenedor
 * `migrator` de docker-compose.deploy.yml. Sin esto el trigger del espejo no
 * existe y SyncOutbox se queda vacio para siempre, en silencio.
 *
 *   pnpm --filter @agenia/database db:apply-sql
 *
 * Es idempotente: correrlo de nuevo no rompe nada ni duplica objetos.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const SQL_PATH = path.resolve(__dirname, '../prisma/sql/non-prisma-ddl.sql');

/**
 * Parte un script SQL en sentencias individuales respetando el dollar-quoting
 * de Postgres (`$$ ... $$`, `$tag$ ... $tag$`), las cadenas entre comillas y
 * los comentarios `--`. Partir por `;` a secas romperia el cuerpo de
 * fn_sync_outbox(), que tiene varios `;` dentro de sus `$$`.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  let dollarTag: string | null = null;
  let inSingle = false;
  let inLineComment = false;

  while (i < sql.length) {
    const ch = sql[i];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      buf += ch;
      i++;
      continue;
    }

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (inSingle) {
      buf += ch;
      i++;
      if (ch === "'") inSingle = false;
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      inLineComment = true;
      buf += ch;
      i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      buf += ch;
      i++;
      continue;
    }

    if (ch === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        buf += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    if (ch === ';') {
      const stmt = buf.trim();
      if (stripComments(stmt)) out.push(stmt);
      buf = '';
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  const last = buf.trim();
  if (stripComments(last)) out.push(last);
  return out;
}

/** ¿Queda algo ejecutable si se le quitan los comentarios? */
function stripComments(stmt: string): boolean {
  return stmt
    .split('\n')
    .map((l) => l.replace(/--.*$/, '').trim())
    .join('')
    .length > 0;
}

/**
 * Objetos que el archivo DEBE dejar creados. Se verifican despues de aplicar:
 * un `psql` que devuelve exit 0 no prueba que el trigger exista, y ese
 * silencio fue exactamente el defecto que este script viene a cerrar.
 */
const OBJETOS_ESPERADOS = {
  funciones: ['fn_sync_outbox'],
  triggers: [
    'trg_sync_outbox_schedule_slot',
    'trg_sync_outbox_doctor_profile',
    'trg_sync_outbox_appointment',
  ],
  indices: ['idx_outbox_pending'],
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const sql = fs.readFileSync(SQL_PATH, 'utf8');

    // Prisma manda cada comando como prepared statement, y esos NO aceptan
    // varias sentencias a la vez ("cannot insert multiple commands into a
    // prepared statement"). Hay que partir el archivo — pero NO por `;` a
    // secas: el cuerpo de fn_sync_outbox() esta entre `$$ ... $$` y tiene
    // puntos y coma dentro. `splitStatements` respeta el dollar-quoting,
    // los comentarios de linea y las cadenas.
    const statements = splitStatements(sql);
    for (const stmt of statements) {
      await prisma.$executeRawUnsafe(stmt);
    }
    console.log(
      `[db:apply-sql] aplicado ${path.relative(process.cwd(), SQL_PATH)} ` +
        `(${statements.length} sentencias)`,
    );

    const faltantes: string[] = [];

    for (const nombre of OBJETOS_ESPERADOS.funciones) {
      const r = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_proc WHERE proname = ${nombre}`;
      if (Number(r[0].n) === 0) faltantes.push(`funcion ${nombre}`);
    }

    for (const nombre of OBJETOS_ESPERADOS.triggers) {
      const r = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_trigger
        WHERE tgname = ${nombre} AND NOT tgisinternal`;
      if (Number(r[0].n) === 0) faltantes.push(`trigger ${nombre}`);
    }

    for (const nombre of OBJETOS_ESPERADOS.indices) {
      const r = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_indexes WHERE indexname = ${nombre}`;
      if (Number(r[0].n) === 0) faltantes.push(`indice ${nombre}`);
    }

    if (faltantes.length > 0) {
      console.error(
        `\n[db:apply-sql] El SQL corrio pero faltan objetos:\n  - ${faltantes.join('\n  - ')}\n`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `[db:apply-sql] verificado: ${OBJETOS_ESPERADOS.funciones.length} funcion(es), ` +
        `${OBJETOS_ESPERADOS.triggers.length} trigger(s), ` +
        `${OBJETOS_ESPERADOS.indices.length} indice(s) parcial(es).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[db:apply-sql] error:', err);
  process.exitCode = 1;
});
