import type {
  CanonicalChangeEvent,
  HandshakeInput,
  OutboxEventDto,
} from '@agenia/shared';
import type { MirrorApiClient } from './mirror-api-client';
import type { HisDriver } from './driver.interface';
import type { AgentStateStore } from './agent-state-store';

/**
 * Por qué un evento no se pudo aplicar. Se devuelve en vez de loguearse aquí
 * dentro: `core/` no decide cómo se reporta un error (consola, archivo,
 * heartbeat) — eso es del proceso que lo envuelve, y así los tests pueden
 * afirmar sobre el motivo sin espiar la consola.
 */
export interface EventFailure {
  seq: string;
  eventId: string;
  message: string;
  /** true si el driver lanzó una excepción en vez de devolver {success:false}. */
  threw?: boolean;
}

/**
 * Motor genérico del agente — el mismo para cualquier driver. Orquesta las
 * dos direcciones del espejo llamando SIEMPRE a través del contrato
 * `HisDriver` y del `MirrorApiClient`; nunca conoce el esquema de un HIS
 * específico. Ver docs/PLAN_ESPEJO_HOSPITAL.md §5.1d/§5.2.
 *
 * Los métodos están deliberadamente separados (en vez de un único `run()`
 * monolítico) para poder probar cada dirección del espejo sin red real ni
 * temporizadores — `run()` es solo el wiring que los llama en bucle.
 */
export class MirrorEngine {
  constructor(
    private readonly api: MirrorApiClient,
    private readonly driver: HisDriver,
    private readonly state: AgentStateStore,
    private readonly driverVersion: string,
  ) {}

  async handshake(): Promise<void> {
    const input: HandshakeInput = {
      driverVersion: this.driverVersion,
      agentClockIso: new Date().toISOString(),
    };
    const result = await this.api.handshake(input);
    await this.driver.connect(result.driverConfig as Record<string, unknown>);
  }

  /**
   * AgenIA → HIS: trae eventos pendientes del outbox, los traduce y se los
   * pasa al driver. Idempotente por partida doble: el `event_id` ya visto
   * localmente NO se reintenta (aunque el servidor lo reenvíe), y cada
   * resultado se reporta explícitamente (ack o failedSeq) — nunca se deja
   * un evento en el limbo. Ver plan §6.
   */
  async pullAndApplyOutboxEvents(limit?: number): Promise<{
    applied: number;
    skippedIdempotent: number;
    failed: number;
    failures: EventFailure[];
  }> {
    const cursor = await this.state.getOutboxCursor();
    const events = await this.api.getPendingEvents(cursor, limit);
    if (events.length === 0) {
      return { applied: 0, skippedIdempotent: 0, failed: 0, failures: [] };
    }

    const acked: string[] = [];
    const failed: string[] = [];
    const failures: EventFailure[] = [];
    let applied = 0;
    let skippedIdempotent = 0;

    for (const dto of events) {
      // ⚠️ TODO el cuerpo va dentro del try. Un driver puede LANZAR en vez de
      // devolver {success:false} — es exactamente lo que hace hoy el único
      // driver real con sus métodos de escritura aún sin implementar. Sin
      // este catch la excepción salía de este método entero y se llevaba por
      // delante el `api.ack()` de más abajo: ningún seq se reportaba, el
      // contador de intentos del servidor no subía NUNCA, y el evento se
      // reintentaba para siempre sin llegar jamás a dead-letter ni a una
      // alerta. Es la capa 3 del plan §6: un evento que falla bloquea solo su
      // entidad, nunca la cola completa.
      try {
        if (await this.state.hasAppliedLocally(dto.eventId)) {
          skippedIdempotent++;
          acked.push(dto.seq);
          continue;
        }

        const result = await this.applyOutboxEvent(dto);
        if (result.success) {
          await this.state.markAppliedLocally(dto.eventId);
          acked.push(dto.seq);
          applied++;
        } else {
          // No se marca aplicado ni se hace ack — el evento sigue pendiente
          // en el servidor y se reintentará en el próximo pull. El servidor
          // lleva la cuenta de intentos vía failedSeqs (plan §6, capa 4).
          failed.push(dto.seq);
          failures.push({
            seq: dto.seq,
            eventId: dto.eventId,
            message: result.message ?? 'rechazado por el driver, sin detalle',
          });
        }
      } catch (error) {
        failed.push(dto.seq);
        failures.push({
          seq: dto.seq,
          eventId: dto.eventId,
          message:
            error instanceof Error ? error.message : String(error),
          threw: true,
        });
      }
    }

    if (acked.length > 0 || failed.length > 0) {
      await this.api.ack({ seqs: acked, failedSeqs: failed });
    }

    const maxSeq = events[events.length - 1].seq;
    await this.state.setOutboxCursor(maxSeq);

    return { applied, skippedIdempotent, failed: failed.length, failures };
  }

  private async applyOutboxEvent(
    dto: OutboxEventDto,
  ): Promise<{ success: boolean; message?: string }> {
    // 🛑 Homologación incompleta: se rechaza ANTES de llamar al driver.
    //
    // Sin esto, un evento cuyo médico no está homologado llegaría al driver
    // con `doctorExternalKey` vacío y produciría una cita a medias en el HIS
    // — sin médico, o con una cadena vacía donde va su código. Es el riesgo
    // número uno de la tabla del plan (§12): una fila "cruda" que la
    // aplicación del hospital no sabe mostrar. Un fallo explícito, que sube
    // el contador de intentos y acaba en dead-letter con su motivo, es
    // infinitamente preferible a una cita rota en la agenda de un médico.
    //
    // La comprobación vive aquí, en el motor genérico, y no en el driver: es
    // el mismo criterio para cualquier HIS.
    const missing = dto.context?.missingMappings;
    if (missing && missing.length > 0) {
      return {
        success: false,
        message:
          `homologación incompleta, no se toca el HIS: falta ${missing.join(', ')}. ` +
          `Revisa MirrorEntityMap para esta organización.`,
      };
    }

    if (dto.entityType !== 'APPOINTMENT') {
      // 🚧 Fase 2+: espejar SLOT/DOCTOR/PATIENT/SERVICE/EPS hacia el HIS
      // depende del modelo de disponibilidad de cada driver (ver plan
      // §5.3/§5.4) — no se adivina aquí. La cita SÍ se implementa porque es
      // el flujo central que valida el motor de punta a punta en Fase 1.
      return {
        success: false,
        message: `${dto.entityType} aún no soportado (Fase 2+)`,
      };
    }

    const canonical = translateOutboxAppointment(dto);

    switch (dto.op) {
      case 'INSERT':
        return this.driver.createAppointment(canonical);
      case 'DELETE':
        return this.driver.cancelAppointment(canonical);
      case 'UPDATE':
        return this.driver.updateAttendance(canonical);
      default:
        return { success: false, message: `op desconocida: ${String(dto.op)}` };
    }
  }

  /**
   * HIS → AgenIA: le pregunta al driver qué cambió desde el último cursor
   * (CT, CDC o polling — decisión interna del driver) y sube el lote
   * canonicalizado. El driver ya tradujo TODO antes de este punto — el
   * motor no interpreta nada específico del HIS.
   */
  async detectAndPushChanges(): Promise<{ pushed: number }> {
    const cursor = await this.state.getDriverCursor();
    const { events, nextCursor } = await this.driver.detectChanges(cursor);

    if (events.length > 0) {
      await this.api.pushChanges({ events });
    }

    await this.state.setDriverCursor(nextCursor);
    return { pushed: events.length };
  }

  async sendHeartbeat(recentErrors: number): Promise<void> {
    await this.api.heartbeat({ recentErrors });
  }
}

/**
 * Traduce la fila cruda de Postgres (serializada por el trigger, ver
 * fn_sync_outbox en la migración) al formato canónico que usa el contrato
 * HisDriver — igual para cualquier driver, por eso vive en core/ y no en un
 * driver específico.
 */
export function translateOutboxAppointment(
  dto: OutboxEventDto,
): CanonicalChangeEvent {
  const row = (dto.payload ?? {}) as Record<string, unknown>;
  // `context` lo resuelve el servidor al entregar el evento (joins con el cupo,
  // el paciente y la EPS, más la homologación de médico y servicio). La fila
  // cruda del trigger NO tiene hora, médico ni servicio: sin esto el driver
  // recibía cuatro UUIDs de AgenIA y nada con qué escribir en el HIS.
  const ctx = dto.context ?? {};
  return {
    eventId: dto.eventId,
    entityType: 'APPOINTMENT',
    op: dto.op,
    occurredAtIso: dto.createdAt,
    payload: {
      agenIAAppointmentId: typeof row.id === 'string' ? row.id : dto.entityId,
      agenIAPatientId:
        typeof row.patientId === 'string' ? row.patientId : undefined,
      agenIAScheduleSlotId:
        typeof row.scheduleSlotId === 'string' ? row.scheduleSlotId : undefined,
      attendanceStatus:
        typeof row.attendanceStatus === 'string'
          ? row.attendanceStatus
          : undefined,
      // Todo lo que el driver necesita para construir la escritura.
      startTimeIso: ctx.startTimeIso,
      endTimeIso: ctx.endTimeIso,
      patientDocument: ctx.patientDocument,
      patientFullName: ctx.patientFullName,
      patientBirthDateIso: ctx.patientBirthDateIso,
      patientGender: ctx.patientGender,
      epsNit: ctx.epsNit,
      epsName: ctx.epsName,
      doctorExternalKey: ctx.doctorExternalKey,
      serviceExternalKey: ctx.serviceExternalKey,
    },
  };
}
