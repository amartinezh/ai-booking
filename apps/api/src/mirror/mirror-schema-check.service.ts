import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Verifica al arrancar que el DDL del espejo existe de verdad en la base.
 *
 * POR QUE EXISTE
 * El trigger `fn_sync_outbox()` y sus tres triggers son SQL manual dentro de
 * una migracion de Prisma, y este repo construye sus bases con `prisma db
 * push`, que NUNCA ejecuta el SQL de migrations/. El instalador ademas sella
 * todas las migraciones como aplicadas sin correrlas. Resultado comprobado el
 * 2026-08-31 sobre la base de desarrollo: no existia ninguno de los tres
 * triggers, `SyncOutbox` estaba vacio, y el espejo con el HIS llevaba
 * semanas muerto sin que nada lo delatara.
 *
 * `db:apply-sql` cierra la causa. Esto cierra el SILENCIO: si por cualquier
 * motivo el DDL no llego a aplicarse, la API lo dice al arrancar en vez de
 * fingir que todo va bien.
 *
 * NO tumba el arranque a proposito. Una clinica sin espejo funciona
 * perfectamente sin estos triggers, y dejar la API caida por un modulo
 * opcional seria peor que el problema. Solo grita cuando hay al menos una
 * organizacion con el espejo ENCENDIDO, que es cuando importa.
 */
@Injectable()
export class MirrorSchemaCheckService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MirrorSchemaCheckService.name);

  /** Objetos que non-prisma-ddl.sql debe dejar creados. */
  private static readonly TRIGGERS = [
    'trg_sync_outbox_schedule_slot',
    'trg_sync_outbox_doctor_profile',
    'trg_sync_outbox_appointment',
  ];

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.verify();
    } catch (error) {
      // Un fallo del propio chequeo (base caida al arrancar, permisos) no
      // puede impedir que la API levante.
      this.logger.warn(
        `No se pudo verificar el DDL del espejo: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Expuesto aparte del hook para poder probarlo sin arrancar Nest entero. */
  async verify(): Promise<{ ok: boolean; missing: string[] }> {
    const orgsConEspejo = await this.prisma.hospitalMirrorConfig.count({
      where: { enabled: true },
    });

    if (orgsConEspejo === 0) {
      return { ok: true, missing: [] };
    }

    const missing = await this.findMissingObjects();

    if (missing.length === 0) {
      this.logger.log(
        `Espejo activo en ${orgsConEspejo} organizacion(es); captura hacia SyncOutbox verificada.`,
      );
      return { ok: true, missing: [] };
    }

    this.logger.error(
      `🚨 ESPEJO ROTO: ${orgsConEspejo} organizacion(es) tienen el espejo con su HIS ENCENDIDO, ` +
        `pero falta en la base: ${missing.join(', ')}. ` +
        `Ninguna cita, cupo ni medico se esta capturando en SyncOutbox — el agente ` +
        `no recibira nada y el hospital NO vera las citas de WhatsApp. ` +
        `Se arregla con: pnpm --filter @agenia/database db:apply-sql`,
    );
    return { ok: false, missing };
  }

  private async findMissingObjects(): Promise<string[]> {
    const missing: string[] = [];

    const [fn] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_proc WHERE proname = 'fn_sync_outbox'`;
    if (Number(fn.n) === 0) missing.push('funcion fn_sync_outbox()');

    const presentes = await this.prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`;
    const nombres = new Set(presentes.map((t) => t.tgname));
    for (const t of MirrorSchemaCheckService.TRIGGERS) {
      if (!nombres.has(t)) missing.push(`trigger ${t}`);
    }

    return missing;
  }
}
