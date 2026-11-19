import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@agenia/database';
import {
  CATALOGO_ALERTAS,
  UMBRALES_ALERTAS,
  claveAlerta,
  entregaBajaDeAvisos,
  lecturaDetenida,
  leerConfigResumenAtencion,
  puedeLeerDelHospital,
  resumirMediciones,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TechAlertService } from '../tech-alerts/tech-alert.service';
import { haceCuanto } from './resumen-alertas';

const MS_HORA = 3_600_000;
const FUENTE = 'vigía de los documentos de la consulta';

/** Desde cuándo esta API ve «Leer del hospital» encendido (para el agente que nunca subió una vuelta). */
export const llaveLeerVisto = (organizationId: string) =>
  `resumen_leer_visto:${organizationId}`;

interface FilaClinica {
  organizationId: string;
  resumenAtencion: Prisma.JsonValue;
  resumenAtencionMedicion: Prisma.JsonValue;
  resumenAtencionError: string | null;
  lastHeartbeatAt: Date | null;
  organization: { name: string; isActive: boolean };
}

/**
 * 🚨 Vigía de los documentos de la consulta (docs/PLAN_RESUMEN_ATENCION.md
 * §8.11). Cada 5 minutos, por clínica:
 *  - **la lectura**: con «Leer del hospital» encendido, el agente sube una
 *    vuelta cada 5 minutos aunque no haya nada nuevo. 30 minutos sin ninguna =
 *    la lectura se detuvo (agente caído, sin permiso en el HIS, error en su
 *    bucle). Lleva el último error que el agente reportó en su latido;
 *  - **la entrega**: de los avisos de WhatsApp a pacientes de las últimas 24
 *    horas que ya tuvieron una hora para entregarse, si se entregó menos del
 *    70 % (con 10 o más). Suele ser un número de la clínica con problemas en
 *    Meta, o celulares del hospital desactualizados.
 * Los avisos que no salen y la plantilla que falla se avisan desde el envío
 * mismo (`ResumenEnvioService`).
 */
@Injectable()
export class ResumenVigiaService {
  private readonly logger = new Logger(ResumenVigiaService.name);
  private enCurso = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional() private readonly alertas?: TechAlertService,
  ) {}

  @Cron('40 */5 * * * *')
  async vigilarCron(): Promise<void> {
    if (this.enCurso || !this.alertas) return;
    this.enCurso = true;
    try {
      await this.vigilar();
      await this.alertas.cronBien('vigia-resumen-atencion');
    } catch (error: unknown) {
      this.logger.error(
        `El vigía del resumen de la atención falló: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.alertas.cronFallo(
        'vigia-resumen-atencion',
        'El vigía de los documentos de la consulta falló',
        error,
      );
    } finally {
      this.enCurso = false;
    }
  }

  async vigilar(ahora: Date = new Date()): Promise<void> {
    const filas: FilaClinica[] =
      await this.prisma.hospitalMirrorConfig.findMany({
        where: { resumenAtencion: { not: Prisma.DbNull } },
        select: {
          organizationId: true,
          resumenAtencion: true,
          resumenAtencionMedicion: true,
          resumenAtencionError: true,
          lastHeartbeatAt: true,
          organization: { select: { name: true, isActive: true } },
        },
      });
    for (const f of filas) {
      await this.lectura(f, ahora);
      await this.entrega(f, ahora);
    }
  }

  private async lectura(f: FilaClinica, ahora: Date): Promise<void> {
    const clave = claveAlerta.resumenLectura(f.organizationId);
    const leer =
      f.organization.isActive &&
      puedeLeerDelHospital(leerConfigResumenAtencion(f.resumenAtencion));
    const llave = llaveLeerVisto(f.organizationId);
    let vistoDesde: string | null = null;
    try {
      if (leer) {
        await this.redis.set(llave, ahora.toISOString(), 'NX');
        vistoDesde = await this.redis.get(llave);
      } else {
        await this.redis.del(llave);
      }
    } catch {
      // Sin Redis solo se pierde el caso del agente que nunca subió una vuelta.
    }
    const detenida = lecturaDetenida({
      leer,
      ultimaVueltaIso:
        resumirMediciones(f.resumenAtencionMedicion, ahora)?.ultimaIso ?? null,
      leerVistoDesdeIso: vistoDesde,
      ahora,
    });
    if (!detenida) {
      await this.alertas!.resolver(clave);
      return;
    }
    const partes = [
      detenida.nuncaLeyo
        ? `«Leer del hospital» está encendido hace ${detenida.minutos} min y el agente no ha subido ninguna vuelta de lectura.`
        : `El agente no sube una vuelta de lectura hace ${detenida.minutos} min (sube una cada 5, aunque no haya historias nuevas).`,
      f.lastHeartbeatAt
        ? `Último latido del agente: ${haceCuanto(f.lastHeartbeatAt, ahora)}.`
        : 'El agente no ha latido nunca.',
      f.resumenAtencionError
        ? `Error que reporta el agente: ${f.resumenAtencionError}`
        : 'El agente no reporta un error (uno anterior al 19-nov solo lo muestra en su consola, en la máquina del hospital).',
      'Mientras tanto no se leen historias ni salen documentos.',
    ];
    await this.alertas!.avisar({
      kind: 'RESUMEN_LECTURA_DETENIDA',
      dedupeKey: clave,
      title: CATALOGO_ALERTAS.RESUMEN_LECTURA_DETENIDA.titulo,
      detail: partes.join(' '),
      organizationId: f.organizationId,
      organizationName: f.organization.name,
      fuente: FUENTE,
    });
  }

  private async entrega(f: FilaClinica, ahora: Date): Promise<void> {
    const clave = claveAlerta.resumenEntrega(f.organizationId);
    const u = UMBRALES_ALERTAS.resumenAtencion.entrega;
    const desde = new Date(ahora.getTime() - u.horas * MS_HORA);
    const hasta = new Date(ahora.getTime() - u.esperaMin * 60_000);
    const [cifras] = await this.prisma.$queryRaw<
      { avisos: number; entregados: number; fallidos: number }[]
    >(Prisma.sql`
      SELECT count(*)::int AS avisos,
             count(*) FILTER (WHERE l."deliveredAt" IS NOT NULL OR l."readAt" IS NOT NULL
                                 OR l.status::text IN ('DELIVERED', 'READ'))::int AS entregados,
             count(*) FILTER (WHERE l.status::text = 'FAILED')::int AS fallidos
        FROM "WhatsappMessageLog" l
        JOIN "AttentionSummaryDelivery" d ON d.id = l."attentionSummaryDeliveryId"
       WHERE l."organizationId" = ${f.organizationId}
         AND d.purpose = 'PACIENTE'
         AND l."messageType"::text IN ('TEMPLATE', 'INTERACTIVE')
         AND l."createdAt" >= ${desde} AND l."createdAt" < ${hasta}`);
    const baja = entregaBajaDeAvisos({
      avisos: cifras?.avisos ?? 0,
      entregados: cifras?.entregados ?? 0,
    });
    if (!baja) {
      await this.alertas!.resolver(clave);
      return;
    }
    const errores = await this.prisma.$queryRaw<
      { codigo: string | null; n: number }[]
    >(Prisma.sql`
      SELECT l."errorCode" AS codigo, count(*)::int AS n
        FROM "WhatsappMessageLog" l
        JOIN "AttentionSummaryDelivery" d ON d.id = l."attentionSummaryDeliveryId"
       WHERE l."organizationId" = ${f.organizationId}
         AND d.purpose = 'PACIENTE'
         AND l."messageType"::text IN ('TEMPLATE', 'INTERACTIVE')
         AND l.status::text = 'FAILED'
         AND l."createdAt" >= ${desde} AND l."createdAt" < ${hasta}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 3`);
    const codigos = errores
      .map((e) => `${e.codigo ?? 'sin código'} (${e.n})`)
      .join(', ');
    await this.alertas!.avisar({
      kind: 'RESUMEN_NO_ENTREGADOS',
      dedupeKey: clave,
      title: CATALOGO_ALERTAS.RESUMEN_NO_ENTREGADOS.titulo,
      detail:
        `De ${cifras.avisos} avisos de WhatsApp a pacientes en las últimas ${u.horas} h, Meta confirmó la entrega de ${cifras.entregados} (${baja.porcentaje} %); ${cifras.fallidos} fallaron` +
        (codigos ? ` (errores de Meta: ${codigos})` : '') +
        '. Revisar la calidad del número en Meta y, en «Envíos de documentos», la lista «Solo a quienes no les llegó».',
      organizationId: f.organizationId,
      organizationName: f.organization.name,
      fuente: FUENTE,
    });
  }
}
