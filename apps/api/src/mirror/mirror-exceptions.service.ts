import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import {
  ORDEN_SEVERIDAD_EXCEPCION,
  type SeveridadExcepcion,
  type TipoExcepcion,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * El ciclo de vida de las excepciones de sincronización en la base
 * (docs/PLAN_RASTREO_PACIENTE.md §10 #3, Fase 3).
 *
 * Aquí NO se decide qué es una excepción —eso es del vigilante, con la lógica pura
 * de `@agenia/shared`— sino qué pasa con la fila cuando el problema se vuelve a
 * encontrar, cambia o desaparece:
 *
 *   · un problema nuevo abre una fila; el mismo problema en la vuelta siguiente
 *     ACTUALIZA la misma (la identidad es `dedupeKey`, no la fila);
 *   · la gravedad solo SUBE: si la cita se acerca, escala; nunca baja sola;
 *   · una decisión HUMANA es firme: lo que alguien resolvió o descartó a mano no se
 *     reabre porque el problema de fondo siga ahí (el evento sigue sin entregarse
 *     aunque la cita ya se agendó en ventanilla);
 *   · lo que el sistema cerró solo (`AUTO_RESUELTA`) SÍ se reabre si el problema
 *     vuelve, y vuelve a avisar;
 *   · dos réplicas de la API pueden correr el cron a la vez: todo cambio de estado
 *     es un compare-and-set, y un choque de creación se resuelve como actualización.
 */

export interface EntradaExcepcion {
  kind: TipoExcepcion;
  dedupeKey: string;
  severity: SeveridadExcepcion;
  /** Sin datos personales. */
  title: string;
  /** Técnico: solo lo ve quien puede ver internos. */
  detail?: string | null;
  appointmentId?: string | null;
  patientId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  outboxSeq?: bigint | null;
  /** El alcance: con esto un agente acotado ve solo lo suyo. */
  epsId?: string | null;
  doctorId?: string | null;
  appointmentStartAt?: Date | null;
  meta?: Record<string, unknown> | null;
  /** Solo la auditoría lo fija (cuántas veces se repitió); si no, no se toca. */
  occurrences?: number;
  /** Cuándo pasó por última vez (auditoría); por defecto, ahora. */
  lastSeenAt?: Date;
}

export type ResultadoRegistro =
  | 'CREADA'
  | 'ACTUALIZADA'
  | 'ESCALADA'
  | 'REABIERTA'
  | 'SIN_CAMBIOS'
  | 'IGNORADA';

/** No se reescribe una fila sin cambios más seguido que esto: el vigilante corre cada pocos minutos. */
const REFRESCO_MS = 15 * 60_000;

const esP2002 = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === 'P2002';

@Injectable()
export class MirrorExceptionsService {
  private readonly logger = new Logger(MirrorExceptionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Abre la excepción, o actualiza la que ya existe para ese problema.
   * `IGNORADA` = alguien la cerró a mano y eso es firme.
   */
  async registrar(
    organizationId: string,
    e: EntradaExcepcion,
    ahora: Date = new Date(),
    reintentando = false,
  ): Promise<ResultadoRegistro> {
    const existente = await this.prisma.syncException.findUnique({
      where: {
        organizationId_dedupeKey: { organizationId, dedupeKey: e.dedupeKey },
      },
    });

    if (!existente) {
      try {
        const creada = await this.prisma.syncException.create({
          data: {
            organizationId,
            ...this.datos(e),
            status: 'ABIERTA',
            firstSeenAt: ahora,
            lastSeenAt: e.lastSeenAt ?? ahora,
            occurrences: e.occurrences ?? 1,
          },
        });
        await this.anotar(creada.id, 'CREADA', null, null, e.title);
        return 'CREADA';
      } catch (error) {
        // Otra réplica la abrió en este mismo instante: ya existe, se actualiza.
        if (esP2002(error) && !reintentando) {
          return this.registrar(organizationId, e, ahora, true);
        }
        throw error;
      }
    }

    // Una decisión humana es firme.
    if (existente.status === 'RESUELTA' || existente.status === 'DESCARTADA') {
      return 'IGNORADA';
    }

    // El sistema la había cerrado y el problema volvió: se reabre y vuelve a avisar.
    if (existente.status === 'AUTO_RESUELTA') {
      const { count } = await this.prisma.syncException.updateMany({
        where: { id: existente.id, status: 'AUTO_RESUELTA' },
        data: {
          ...this.datos(e),
          status: 'ABIERTA',
          assignedToUserId: null,
          assignedAt: null,
          resolvedAt: null,
          resolvedByUserId: null,
          resolutionNote: null,
          notifiedAt: null,
          notifiedSeverity: null,
          lastSeenAt: e.lastSeenAt ?? ahora,
          occurrences: e.occurrences ?? existente.occurrences,
        },
      });
      if (count === 1) {
        await this.anotar(
          existente.id,
          'REAPARECIDA',
          null,
          null,
          'El problema volvió a aparecer.',
        );
        return 'REABIERTA';
      }
      return 'SIN_CAMBIOS';
    }

    // Activa (ABIERTA o EN_REVISION): se refresca lo que cambió.
    const sube =
      ORDEN_SEVERIDAD_EXCEPCION[e.severity] >
      (ORDEN_SEVERIDAD_EXCEPCION[existente.severity as SeveridadExcepcion] ??
        -1);
    const detalleCambio = (e.detail ?? null) !== existente.detail;
    const ocurrenciasCambian =
      e.occurrences !== undefined && e.occurrences !== existente.occurrences;
    const vista = (e.lastSeenAt ?? ahora).getTime();
    const refrescoVencido =
      vista - existente.lastSeenAt.getTime() >= REFRESCO_MS;

    if (!sube && !detalleCambio && !ocurrenciasCambian && !refrescoVencido) {
      return 'SIN_CAMBIOS';
    }

    await this.prisma.syncException.update({
      where: { id: existente.id },
      data: {
        ...this.datos(e),
        // La gravedad solo sube.
        severity: sube ? e.severity : existente.severity,
        lastSeenAt: e.lastSeenAt ?? ahora,
        ...(e.occurrences !== undefined ? { occurrences: e.occurrences } : {}),
      },
    });
    if (sube) {
      await this.anotar(
        existente.id,
        'ESCALADA',
        null,
        null,
        `${existente.severity} → ${e.severity}`,
      );
      return 'ESCALADA';
    }
    return 'ACTUALIZADA';
  }

  /**
   * El sistema la cierra porque la condición dejó de cumplirse. Compare-and-set: si
   * alguien la cerró a mano mientras tanto, no se pisa.
   */
  async autoResolver(
    organizationId: string,
    exceptionId: string,
    nota: string,
    ahora: Date = new Date(),
  ): Promise<boolean> {
    const { count } = await this.prisma.syncException.updateMany({
      where: {
        id: exceptionId,
        organizationId,
        status: { in: ['ABIERTA', 'EN_REVISION'] },
      },
      data: {
        status: 'AUTO_RESUELTA',
        // El dueño es de una excepción EN_REVISION: al cerrarse ya no lo tiene (quién
        // la tomó queda en el historial).
        assignedToUserId: null,
        assignedAt: null,
        resolvedAt: ahora,
        resolvedByUserId: null,
        resolutionNote: nota.slice(0, 500),
      },
    });
    if (count === 1) {
      await this.anotar(exceptionId, 'AUTO_RESUELTA', null, null, nota);
    }
    return count === 1;
  }

  /**
   * Reclama el derecho a AVISAR de esta excepción. Solo una llamada gana: es lo que
   * impide que dos réplicas manden el mismo aviso, y que se avise dos veces de lo
   * mismo. Devuelve `true` si esta llamada la reclamó.
   */
  async reclamarAviso(
    exception: {
      id: string;
      severity: string;
      notifiedSeverity: string | null;
    },
    ahora: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.syncException.updateMany({
      where: {
        id: exception.id,
        status: 'ABIERTA',
        notifiedSeverity: exception.notifiedSeverity,
      },
      data: { notifiedAt: ahora, notifiedSeverity: exception.severity },
    });
    return count === 1;
  }

  /** El aviso no salió: se devuelve la reclamación para que la próxima vuelta reintente. */
  async devolverAviso(
    exception: {
      id: string;
      notifiedAt: Date | null;
      notifiedSeverity: string | null;
    },
    reclamadaEn: Date,
  ): Promise<void> {
    await this.prisma.syncException.updateMany({
      where: { id: exception.id, notifiedAt: reclamadaEn },
      data: {
        notifiedAt: exception.notifiedAt,
        notifiedSeverity: exception.notifiedSeverity,
      },
    });
  }

  /** Deja constancia en el historial. Nunca lanza: perder una línea no debe tumbar al vigilante. */
  async anotar(
    exceptionId: string,
    action: string,
    actorUserId: string | null,
    actorRole: string | null,
    note: string | null,
  ): Promise<void> {
    try {
      await this.prisma.syncExceptionLog.create({
        data: {
          exceptionId,
          action,
          actorUserId,
          actorRole,
          note: note ? note.slice(0, 500) : null,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo anotar "${action}" de la excepción ${exceptionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Los campos descriptivos de una entrada, sin los de ciclo de vida. */
  private datos(e: EntradaExcepcion) {
    return {
      kind: e.kind,
      dedupeKey: e.dedupeKey,
      severity: e.severity,
      title: e.title,
      detail: e.detail ?? null,
      appointmentId: e.appointmentId ?? null,
      patientId: e.patientId ?? null,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      outboxSeq: e.outboxSeq ?? null,
      epsId: e.epsId ?? null,
      doctorId: e.doctorId ?? null,
      appointmentStartAt: e.appointmentStartAt ?? null,
      meta: e.meta ? (e.meta as Prisma.InputJsonValue) : Prisma.DbNull,
    };
  }
}
