import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@agenia/database';
import {
  LIMITES_CONSULTA_HIS,
  parametrosADto,
  resolverRespuestaHis,
} from '@agenia/shared';
import type {
  HisLookupRequestDto,
  HisLookupResultInput,
  HisLookupResultOutput,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Consulta en vivo al HIS (rastreo de paciente, Fase 2) — el lado del agente.
 * Ver docs/PLAN_RASTREO_PACIENTE.md §7.
 *
 * ═══ Por qué vive en `mirror/` ═══
 * `GET /mirror/lookup-requests` y `POST /mirror/lookup-result` son protocolo del
 * agente (`MirrorAgentGuard`, token de agente): el mismo canal que los avisos
 * masivos. Quien CREA la petición es el personal desde la web, que escribe la
 * fila directamente (la web ya lee y escribe la base con Prisma); aquí solo se
 * atiende lo que el agente pregunta y responde.
 *
 * ═══ Qué se le manda al agente y qué se guarda de lo que responde ═══
 * · Al agente le llega solo lo necesario para consultar (`parametrosADto`): una
 *   consulta por cupo NO lleva el documento del paciente.
 * · De lo que el agente responde no se guarda nada tal cual: `resolverRespuestaHis`
 *   enmascara el documento de terceros y descarta lo que nadie pidió. Se hace
 *   AQUÍ y no en el agente a propósito: el servidor no se fía de que el agente
 *   hizo bien su parte.
 * · `params` y `result` se borran a los `LIMITES_CONSULTA_HIS.purgaMs`.
 */

/** Tope de peticiones que se entregan al agente en una vuelta. */
const MAX_POR_VUELTA = 5;
/** Lo que se conserva del texto de error del agente. */
const MAX_ERROR = 300;

@Injectable()
export class MirrorLookupService {
  private readonly logger = new Logger(MirrorLookupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /mirror/lookup-requests — lo que el agente pregunta en su lazo.
   *
   * Con el interruptor apagado devuelve `[]` y NO un 403 a propósito: el agente
   * pregunta cada pocos segundos y el interruptor está apagado por defecto, así
   * que un error aquí sería ruido permanente en sus contadores de fallos.
   */
  async getPendingRequests(
    organizationId: string,
  ): Promise<HisLookupRequestDto[]> {
    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: { lookupEnabled: true },
    });
    if (!config?.lookupEnabled) return [];

    // Una petición más vieja que `expiraMs` ya no la espera nadie: no se le
    // entrega al agente (un HIS lento no debe trabajar para una pantalla que se
    // rindió). El cron la marca EXPIRADA.
    const desde = new Date(Date.now() - LIMITES_CONSULTA_HIS.expiraMs);
    const pendientes = await this.prisma.hisLookupRequest.findMany({
      where: {
        organizationId,
        status: 'PENDIENTE',
        createdAt: { gte: desde },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_POR_VUELTA,
    });

    const salida: HisLookupRequestDto[] = [];
    for (const r of pendientes) {
      const dto = parametrosADto(r.id, r.kind, r.params);
      if (dto) {
        salida.push(dto);
        continue;
      }
      // `params` que no pasa la validación (fila corrupta, o escrita por una
      // versión que este servidor no entiende): NO se manda al agente, y se cierra
      // para que la pantalla no espere una respuesta que nunca llegará.
      this.logger.warn(
        `Petición de consulta ${r.id} (org ${organizationId}) con params inválidos: se cierra con error.`,
      );
      await this.cerrar(r.id, organizationId, 'ERROR', 'Petición inválida.');
    }
    return salida;
  }

  /**
   * POST /mirror/lookup-result — el agente responde una petición.
   *
   * Idempotente y de una sola vez: solo una petición `PENDIENTE` acepta
   * respuesta, y el cambio de estado es un compare-and-set. Un reintento del
   * agente por una respuesta HTTP perdida, o dos respuestas simultáneas, no
   * pisan lo ya guardado.
   */
  async applyResult(
    organizationId: string,
    input: HisLookupResultInput,
  ): Promise<HisLookupResultOutput> {
    // El tenant es parte de la búsqueda: el agente de una clínica no puede
    // responder (ni siquiera saber que existe) una petición de otra.
    const request = await this.prisma.hisLookupRequest.findFirst({
      where: { id: input.requestId, organizationId },
    });
    if (!request) {
      throw new NotFoundException('Petición de consulta no encontrada.');
    }
    const no = { requestId: request.id, stored: false };
    if (request.status !== 'PENDIENTE') return no;

    // Una respuesta tardía se descarta aunque el cron aún no haya pasado: la
    // pantalla ya se rindió, y guardarla dejaría datos de un paciente en la base
    // sin que nadie los vaya a leer.
    if (
      Date.now() - request.createdAt.getTime() >
      LIMITES_CONSULTA_HIS.expiraMs
    ) {
      await this.cerrar(request.id, organizationId, 'EXPIRADA', null);
      return no;
    }

    if (input.unsupported === true) {
      await this.cerrar(
        request.id,
        organizationId,
        'ERROR',
        'El driver de este hospital no implementa la consulta en vivo.',
      );
      return { requestId: request.id, stored: true };
    }
    if (typeof input.error === 'string' && input.error.trim() !== '') {
      const cerrada = await this.cerrar(
        request.id,
        organizationId,
        'ERROR',
        input.error,
      );
      return { requestId: request.id, stored: cerrada };
    }

    // 🚨 Sin arreglo NO es "el HIS no tiene nada": es una respuesta mal formada.
    // Tratarla como lista vacía diría "esa cita no está en el HIS" sin haberlo
    // comprobado — justo el diagnóstico equivocado que esta pantalla existe para
    // evitar.
    if (!Array.isArray(input.appointments)) {
      const cerrada = await this.cerrar(
        request.id,
        organizationId,
        'ERROR',
        'La respuesta del agente no tiene la forma esperada.',
      );
      return { requestId: request.id, stored: cerrada };
    }

    const resultado = resolverRespuestaHis(
      request.kind,
      request.params,
      input.appointments,
      input.truncated === true,
      // Lo valida y lo normaliza `resolverRespuestaHis`: viene de la red.
      input.unreadableSlots,
    );
    if (!resultado) {
      const cerrada = await this.cerrar(
        request.id,
        organizationId,
        'ERROR',
        'Petición inválida.',
      );
      return { requestId: request.id, stored: cerrada };
    }

    const { count } = await this.prisma.hisLookupRequest.updateMany({
      where: { id: request.id, organizationId, status: 'PENDIENTE' },
      data: {
        status: 'RESUELTA',
        result: resultado as unknown as Prisma.InputJsonValue,
        truncated:
          resultado.kind === 'BY_DOCUMENT'
            ? resultado.truncado
            : input.truncated === true,
        resolvedAt: new Date(),
      },
    });
    return { requestId: request.id, stored: count === 1 };
  }

  /**
   * Cada minuto: expira lo que nadie contestó y BORRA lo que ya cumplió su
   * tiempo (`params` lleva un documento; `result`, lo que respondió el HIS).
   * Quedan los metadatos de la petición y `PatientLookupLog`.
   *
   * Sin dependencia de que haya un solo proceso: las dos operaciones son
   * `updateMany` idempotentes, así que dos réplicas corriéndolo a la vez no se
   * estorban.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async mantenimiento(): Promise<void> {
    try {
      const ahora = new Date();
      const expiradas = await this.prisma.hisLookupRequest.updateMany({
        where: {
          status: 'PENDIENTE',
          createdAt: {
            lt: new Date(ahora.getTime() - LIMITES_CONSULTA_HIS.expiraMs),
          },
        },
        data: { status: 'EXPIRADA', resolvedAt: ahora },
      });
      const purgadas = await this.prisma.hisLookupRequest.updateMany({
        where: { purgedAt: null, purgeAt: { lt: ahora } },
        data: { params: {}, result: Prisma.DbNull, purgedAt: ahora },
      });
      if (expiradas.count > 0 || purgadas.count > 0) {
        this.logger.log(
          `Consultas en vivo: ${expiradas.count} expirada(s), ${purgadas.count} purgada(s).`,
        );
      }
    } catch (error: unknown) {
      // Un fallo del mantenimiento no debe tumbar el proceso; el siguiente
      // minuto reintenta.
      this.logger.error(
        `Mantenimiento de consultas en vivo falló: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Cierra una petición SOLO si sigue pendiente. `true` si esta llamada fue la que la cerró. */
  private async cerrar(
    id: string,
    organizationId: string,
    status: 'ERROR' | 'EXPIRADA',
    error: string | null,
  ): Promise<boolean> {
    const { count } = await this.prisma.hisLookupRequest.updateMany({
      where: { id, organizationId, status: 'PENDIENTE' },
      data: {
        status,
        error: error ? error.slice(0, MAX_ERROR) : null,
        resolvedAt: new Date(),
      },
    });
    return count === 1;
  }
}
