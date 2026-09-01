/**
 * Reconstruye los eventos de SyncOutbox que se perdieron mientras el trigger
 * de captura no existia en la base.
 *
 * POR QUE HACE FALTA
 * `fn_sync_outbox()` y sus triggers son SQL manual dentro de una migracion, y
 * este repo construye sus bases con `prisma db push`, que no ejecuta ese SQL.
 * Toda cita, cupo o medico creado mientras el trigger faltaba NO dejo evento:
 * son invisibles para el agente y para el hospital, para siempre, porque el
 * trigger solo dispara sobre escrituras NUEVAS. Comprobado el 2026-08-31: una
 * cita confirmada por WhatsApp con el espejo encendido y cero eventos.
 *
 * Que hace: busca filas de las tablas espejadas que no tengan ningun evento en
 * SyncOutbox y emite uno `INSERT` con `origin='BACKFILL'`, con el mismo formato
 * que produce el trigger (`to_jsonb` de la fila completa).
 *
 * Que NO hace: no inventa el historial. Una cita que se creo y se cancelo
 * mientras el trigger faltaba ya no esta en la tabla, asi que no se puede
 * reconstruir. Esto recupera el ESTADO ACTUAL, no la secuencia de cambios.
 *
 * Uso:
 *   # ver que haria, sin escribir nada (por defecto)
 *   pnpm --filter @agenia/database exec tsx scripts/backfill-sync-outbox.ts
 *
 *   # escribir de verdad, acotado a una organizacion
 *   pnpm --filter @agenia/database exec tsx scripts/backfill-sync-outbox.ts --apply \
 *     --org=<uuid> --since=2026-08-01
 *
 * Es idempotente: una fila que ya tiene evento nunca genera otro.
 */
import { PrismaClient } from '@prisma/client';

/** Tablas espejadas y su entityType, en el mismo orden que el trigger. */
const TABLAS = [
  { tabla: 'DoctorProfile', entityType: 'DOCTOR' },
  { tabla: 'ScheduleSlot', entityType: 'SLOT' },
  { tabla: 'Appointment', entityType: 'APPOINTMENT' },
] as const;

interface Opciones {
  apply: boolean;
  org?: string;
  since?: string;
}

function parseArgs(argv: string[]): Opciones {
  const opts: Opciones = { apply: false };
  for (const a of argv.slice(2)) {
    // pnpm reenvia un `--` suelto al delegar argumentos; no es un error.
    if (a === '--') continue;
    else if (a === '--apply') opts.apply = true;
    else if (a.startsWith('--org=')) opts.org = a.slice(6);
    else if (a.startsWith('--since=')) opts.since = a.slice(8);
    else if (a === '--help' || a === '-h') {
      console.log(
        'Uso: backfill-sync-outbox.ts [--apply] [--org=<uuid>] [--since=YYYY-MM-DD]',
      );
      process.exit(0);
    } else {
      console.error(`Opcion desconocida: ${a}`);
      process.exit(2);
    }
  }
  if (opts.since && Number.isNaN(Date.parse(opts.since))) {
    console.error(`--since no es una fecha valida: ${opts.since}`);
    process.exit(2);
  }
  return opts;
}

const prisma = new PrismaClient();

async function main() {
  const opts = parseArgs(process.argv);

  // Solo tiene sentido para organizaciones con el espejo encendido: el trigger
  // tampoco habria capturado nada para las demas, asi que no falta nada.
  const configs = await prisma.hospitalMirrorConfig.findMany({
    where: { enabled: true, ...(opts.org ? { organizationId: opts.org } : {}) },
    select: { organizationId: true },
  });

  if (configs.length === 0) {
    console.log(
      'Ninguna organizacion con el espejo encendido' +
        (opts.org ? ` que coincida con --org=${opts.org}.` : '.') +
        ' No hay nada que recuperar.',
    );
    return;
  }

  console.log(
    `${opts.apply ? 'APLICANDO' : 'SIMULACRO (usa --apply para escribir)'} · ` +
      `${configs.length} organizacion(es) con espejo activo` +
      (opts.since ? ` · desde ${opts.since}` : '') +
      '\n',
  );

  let totalPendientes = 0;
  let totalEmitidos = 0;

  for (const { organizationId } of configs) {
    for (const { tabla, entityType } of TABLAS) {
      // `createdAt` existe en las tres tablas espejadas. El filtro por fecha es
      // opcional pero muy recomendable: sin el, una base grande genera un
      // evento por cada fila historica y el agente se pasa horas espejando
      // citas de 2024 que al hospital no le sirven de nada.
      const filtroFecha = opts.since
        ? `AND t."createdAt" >= '${opts.since}'::timestamp`
        : '';

      const pendientes = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n
           FROM "${tabla}" t
          WHERE t."organizationId" = $1
            ${filtroFecha}
            AND NOT EXISTS (
              SELECT 1 FROM "SyncOutbox" o
               WHERE o."entityType" = $2 AND o."entityId" = t.id
            )`,
        organizationId,
        entityType,
      );

      const n = Number(pendientes[0].n);
      totalPendientes += n;
      if (n === 0) continue;

      console.log(`  ${entityType.padEnd(12)} ${n} fila(s) sin evento`);

      if (!opts.apply) continue;

      // Mismo formato que produce el trigger: la fila completa serializada.
      // origin='BACKFILL' (no 'LOCAL') para que quede rastro en la auditoria
      // de que este evento se reconstruyo, no se capturo en su momento.
      const insertados = await prisma.$executeRawUnsafe(
        `INSERT INTO "SyncOutbox"("organizationId","entityType","entityId","op","payload","origin")
         SELECT t."organizationId", $2, t.id, 'INSERT', to_jsonb(t), 'BACKFILL'
           FROM "${tabla}" t
          WHERE t."organizationId" = $1
            ${filtroFecha}
            AND NOT EXISTS (
              SELECT 1 FROM "SyncOutbox" o
               WHERE o."entityType" = $2 AND o."entityId" = t.id
            )`,
        organizationId,
        entityType,
      );
      totalEmitidos += insertados;
      console.log(`  ${' '.repeat(12)} -> ${insertados} evento(s) emitidos`);
    }
  }

  console.log('');
  if (totalPendientes === 0) {
    console.log('Nada que recuperar: todas las filas tienen su evento.');
  } else if (opts.apply) {
    console.log(
      `Listo: ${totalEmitidos} evento(s) emitidos con origin='BACKFILL'. ` +
        `El agente los recogera en su proximo ciclo.`,
    );
  } else {
    console.log(
      `${totalPendientes} fila(s) sin evento. Vuelve a correrlo con --apply para emitirlos.\n` +
        `Recomendado acotar con --since para no espejar historial antiguo.`,
    );
  }
}

main()
  .catch((err) => {
    console.error('[backfill] error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
