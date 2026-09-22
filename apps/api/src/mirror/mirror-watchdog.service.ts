import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  SYNC_AUDIT_DIRECTION,
  TITULO_EXCEPCION,
  UMBRALES_VIGILANTE,
  claveExcepcion,
  debeVencer,
  evaluarRetencion,
  severidadPorCercania,
  type FilaOutbox,
  type SeveridadExcepcion,
  type TipoExcepcion,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  MirrorAlertService,
  type ResultadoAviso,
} from './mirror-alert.service';
import { MirrorExceptionsService } from './mirror-exceptions.service';

/**
 * El vigilante de la sincronización (docs/PLAN_RASTREO_PACIENTE.md §10 #2 y #3,
 * Fase 3). Cada dos minutos revisa, por clínica con el espejo encendido:
 *
 *   1. el OUTBOX: eventos que no llegan al hospital. Una cita de AgenIA retenida o
 *      rendida ANTES de su hora abre una excepción `CITA_NO_ENTREGADA`; un cambio que
 *      se rindió y no es de una cita, `EVENTO_RENDIDO`;
 *   2. la AUDITORÍA: conflictos y errores al aplicar lo que llega del hospital;
 *   3. y, cuando termina la reconciliación, la DERIVA (`registrarDeriva`): citas que
 *      AgenIA da por hechas y el hospital no tiene.
 *
 * Después cierra solas las que ya no se cumplen, da por VENCIDAS las de citas que
 * pasaron hace días sin que nadie las cerrara (§12 #15) y avisa al agendador.
 *
 * ═══ Reglas que importan ═══
 *  · La clasificación es la de `@agenia/shared` (`evaluarRetencion`, `derivarSync`):
 *    la MISMA que ve el rastreo de paciente. Aquí no se decide qué es retenido.
 *  · Solo se cierra sola una excepción cuando lo que la abrió DEJÓ de cumplirse de
 *    verdad (llegó, se canceló, se reprocesó) — nunca porque falten datos: un escaneo
 *    truncado o con el envío pausado no prueba que algo llegó.
 *  · Una cita cuya hora YA pasó no se cierra sola en el momento: seguir sin llegar es
 *    justo lo que hay que revisar. La cierra una persona, que por fin llegue, o —si
 *    pasan `vencimientoDias` sin que nadie la toque— el vencimiento, que la marca
 *    `VENCIDA` (no `AUTO_RESUELTA`: el problema no se resolvió).
 *  · Las excepciones de citas llevan la EPS y el médico: con eso un agente acotado a
 *    una EPS o a un médico ve SOLO lo suyo (lo mismo que se arregló en la acción de
 *    cancelar, §12 #9).
 *  · Dos réplicas de la API pueden correr a la vez: todo es idempotente y los cambios
 *    de estado son compare-and-set (`MirrorExceptionsService`).
 *  · Un fallo con UNA clínica no impide vigilar las demás, ni un fallo del aviso
 *    impide que las excepciones queden abiertas.
 */

/** Tope de eventos por clínica y vuelta. Si se llega, no se cierra nada solo. */
const MAX_EVENTOS = 1000;
const MAX_AUDITORIA = 500;
/** Tope de excepciones de deriva por reconciliación: una falla sistémica no debe inundar la bandeja. */
const MAX_DERIVA = 200;
const CHUNK = 500;
const MS_DIA = 86_400_000;

/** Lo que el vigilante necesita saber de una cita. */
interface CitaVigilada {
  id: string;
  status: string;
  origin: string;
  patientId: string | null;
  epsId: string | null;
  startTime: Date;
  doctorId: string;
}

export interface DerivaItem {
  appointmentId: string;
  patientId: string | null;
  epsId: string | null;
  doctorId: string | null;
  startTime: Date;
  /** `<médico del HIS>|<hora UTC>`, la llave con la que la reconciliación compara. */
  clave: string;
}

export interface ResumenVigilancia {
  organizationId: string;
  abiertas: number;
  actualizadas: number;
  reabiertas: number;
  autoResueltas: number;
  vencidas: number;
  aviso: ResultadoAviso | null;
  /** El escaneo del outbox no se hizo o quedó incompleto: por eso no se cerró nada solo. */
  outboxIncompleto: boolean;
}

const parseCupo = (detail: string | null): string | null =>
  /^cupo=([^\s;]+)/.exec(detail ?? '')?.[1] ?? null;

@Injectable()
export class MirrorWatchdogService {
  private readonly logger = new Logger(MirrorWatchdogService.name);
  /** Una vuelta lenta no debe montarse sobre la siguiente. */
  private enCurso = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly exceptions: MirrorExceptionsService,
    private readonly alert: MirrorAlertService,
  ) {}

  /** Cada dos minutos: detecta una cita retenida a los ~10-12 min, sin martillar la base. */
  @Cron('0 */2 * * * *')
  async vigilarTodas(): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      const clinicas = await this.prisma.hospitalMirrorConfig.findMany({
        where: { enabled: true },
        select: { organizationId: true },
      });
      for (const { organizationId } of clinicas) {
        try {
          await this.vigilarOrganizacion(organizationId);
        } catch (error: unknown) {
          this.logger.error(
            `El vigilante falló con la org ${organizationId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        `El vigilante no pudo listar las clínicas: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.enCurso = false;
    }
  }

  async vigilarOrganizacion(
    organizationId: string,
    ahora: Date = new Date(),
  ): Promise<ResumenVigilancia> {
    const resumen: ResumenVigilancia = {
      organizationId,
      abiertas: 0,
      actualizadas: 0,
      reabiertas: 0,
      autoResueltas: 0,
      vencidas: 0,
      aviso: null,
      outboxIncompleto: true,
    };

    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: { enabled: true, pushEnabled: true },
    });
    if (!config?.enabled) return resumen;

    // Con el envío hacia el hospital PAUSADO a propósito (el interruptor de
    // emergencia) los eventos se acumulan por decisión, no por falla: no se vigila.
    if (config.pushEnabled) {
      resumen.outboxIncompleto = !(await this.vigilarOutbox(
        organizationId,
        ahora,
        resumen,
      ));
    }
    await this.vigilarAuditoria(organizationId, ahora, resumen);
    resumen.vencidas = await this.vencerLasOlvidadas(organizationId, ahora);

    try {
      resumen.aviso = await this.alert.avisar(organizationId, ahora);
    } catch (error: unknown) {
      // Que el aviso falle no debe deshacer nada: las excepciones ya están abiertas.
      this.logger.error(
        `El aviso al agendador falló (org ${organizationId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return resumen;
  }

  // ─────────────────────────────────────────────────────────────
  // 1. Outbox
  // ─────────────────────────────────────────────────────────────

  /** `true` si el escaneo quedó COMPLETO (solo entonces se puede cerrar algo solo). */
  private async vigilarOutbox(
    organizationId: string,
    ahora: Date,
    resumen: ResumenVigilancia,
  ): Promise<boolean> {
    const desde = new Date(
      ahora.getTime() - UMBRALES_VIGILANTE.eventosVentanaDias * MS_DIA,
    );
    const filas = await this.prisma.syncOutbox.findMany({
      where: {
        organizationId,
        origin: 'LOCAL',
        deliveredAt: null,
        createdAt: { gte: desde },
      },
      orderBy: { seq: 'asc' },
      // Uno de más: es la forma de saber si se cortó.
      take: MAX_EVENTOS + 1,
      select: {
        seq: true,
        entityType: true,
        entityId: true,
        op: true,
        createdAt: true,
        deliveredAt: true,
        attempts: true,
        deadLettered: true,
        nextAttemptAt: true,
        lastError: true,
      },
    });
    const completo = filas.length <= MAX_EVENTOS;
    if (!completo) {
      this.logger.warn(
        `Vigilante (org ${organizationId}): más de ${MAX_EVENTOS} eventos sin entregar; ` +
          `se vigilan los ${MAX_EVENTOS} más viejos y no se cierra nada solo en esta vuelta.`,
      );
    }
    const eventos = completo ? filas : filas.slice(0, MAX_EVENTOS);

    const porCita = new Map<string, typeof eventos>();
    for (const e of eventos) {
      if (e.entityType !== 'APPOINTMENT') continue;
      const lista = porCita.get(e.entityId);
      if (lista) lista.push(e);
      else porCita.set(e.entityId, [e]);
    }
    const citas = await this.cargarCitas(organizationId, [...porCita.keys()]);

    const vigentes = new Set<string>();
    /** Eventos que ya explica una excepción de cita: no se repiten como `EVENTO_RENDIDO`. */
    const explicados = new Set<string>();

    for (const [citaId, lista] of porCita) {
      const cita = citas.get(citaId);
      if (!cita) continue;
      const r = evaluarRetencion({
        cita: {
          inicioIso: cita.startTime.toISOString(),
          estado: cita.status,
          origen: cita.origin,
        },
        eventos: lista as FilaOutbox[],
        ahoraIso: ahora.toISOString(),
      });
      if (!r) continue;

      const dedupeKey = claveExcepcion.citaNoEntregada(citaId, r.seq);
      vigentes.add(dedupeKey);
      explicados.add(r.seq);
      const culpable = lista.find((e) => String(e.seq) === r.seq);
      this.contar(
        resumen,
        await this.exceptions.registrar(
          organizationId,
          {
            kind: 'CITA_NO_ENTREGADA',
            dedupeKey,
            severity: r.severidad,
            title: TITULO_EXCEPCION.CITA_NO_ENTREGADA,
            detail: [
              r.resumen,
              r.lastError ? `Último error del agente: ${r.lastError}` : null,
            ]
              .filter(Boolean)
              .join(' ')
              .slice(0, 1000),
            appointmentId: citaId,
            patientId: cita.patientId,
            entityType: 'APPOINTMENT',
            entityId: citaId,
            outboxSeq: BigInt(r.seq),
            epsId: cita.epsId,
            doctorId: cita.doctorId,
            appointmentStartAt: cita.startTime,
            meta: {
              motivo: r.motivo,
              // Desde cuándo: la web calcula los minutos AL MOSTRAR (un «lleva 25 min»
              // guardado hoy sería mentira dentro de tres horas).
              desdeIso: r.sync.oldestPendingIso,
              minutosRetenida: r.minutosRetenida,
              minutosParaLaCita: r.minutosParaLaCita,
              intentos: r.attempts,
              op: culpable?.op ?? null,
            },
          },
          ahora,
        ),
      );
    }

    // Lo rendido que NO es una cita retenida (un cupo, un médico, o una cita que ya
    // no está vigente) sigue siendo algo que alguien debe ver.
    for (const e of eventos) {
      if (!e.deadLettered || explicados.has(String(e.seq))) continue;
      const cita =
        e.entityType === 'APPOINTMENT' ? citas.get(e.entityId) : undefined;
      const dedupeKey = claveExcepcion.eventoRendido(e.seq);
      vigentes.add(dedupeKey);
      this.contar(
        resumen,
        await this.exceptions.registrar(
          organizationId,
          {
            kind: 'EVENTO_RENDIDO',
            dedupeKey,
            severity: 'MEDIA',
            title: TITULO_EXCEPCION.EVENTO_RENDIDO,
            detail: [
              `Cambio ${e.op} de ${e.entityType} rendido tras ${e.attempts} intentos.`,
              e.lastError ? `Último error del agente: ${e.lastError}` : null,
            ]
              .filter(Boolean)
              .join(' ')
              .slice(0, 1000),
            appointmentId: cita?.id ?? null,
            patientId: cita?.patientId ?? null,
            entityType: e.entityType,
            entityId: e.entityId,
            outboxSeq: BigInt(e.seq),
            epsId: cita?.epsId ?? null,
            doctorId: cita?.doctorId ?? null,
            appointmentStartAt: cita?.startTime ?? null,
            meta: { op: e.op, intentos: e.attempts },
          },
          ahora,
        ),
      );
    }

    if (completo) {
      resumen.autoResueltas += await this.cerrarLoQueYaNoSeCumple(
        organizationId,
        vigentes,
        ahora,
      );
    }
    return completo;
  }

  /**
   * Cierra solas las excepciones de envío que YA NO están en lo vigente, pero solo
   * después de comprobar POR QUÉ: que llegó, que se canceló, o que el envío volvió a
   * la normalidad. Una cita cuya hora ya pasó sin llegar se queda abierta.
   */
  private async cerrarLoQueYaNoSeCumple(
    organizationId: string,
    vigentes: Set<string>,
    ahora: Date,
  ): Promise<number> {
    const activas = await this.prisma.syncException.findMany({
      where: {
        organizationId,
        status: { in: ['ABIERTA', 'EN_REVISION'] },
        kind: { in: ['CITA_NO_ENTREGADA', 'EVENTO_RENDIDO'] },
      },
      select: {
        id: true,
        kind: true,
        dedupeKey: true,
        outboxSeq: true,
        appointmentId: true,
      },
    });
    const candidatas = activas.filter((a) => !vigentes.has(a.dedupeKey));
    if (candidatas.length === 0) return 0;

    const seqs = candidatas
      .map((a) => a.outboxSeq)
      .filter((s): s is bigint => s !== null);
    const eventos = seqs.length
      ? await this.prisma.syncOutbox.findMany({
          where: { organizationId, seq: { in: seqs } },
          select: { seq: true, deliveredAt: true, deadLettered: true },
        })
      : [];
    const evento = new Map(eventos.map((e) => [String(e.seq), e]));
    const citas = await this.cargarCitas(
      organizationId,
      candidatas
        .map((a) => a.appointmentId)
        .filter((id): id is string => id !== null),
    );

    let cerradas = 0;
    for (const a of candidatas) {
      const ev =
        a.outboxSeq === null ? undefined : evento.get(String(a.outboxSeq));
      let nota: string | null = null;

      if (a.kind === 'EVENTO_RENDIDO') {
        if (!ev || ev.deliveredAt || !ev.deadLettered) {
          nota = 'El cambio ya se entregó al hospital o se reprocesó.';
        }
      } else if (!ev || ev.deliveredAt) {
        nota = 'El envío ya llegó al hospital.';
      } else {
        const cita = a.appointmentId ? citas.get(a.appointmentId) : undefined;
        if (!cita || cita.status !== 'SCHEDULED') {
          nota = 'La cita se canceló o ya se atendió.';
        } else if (cita.startTime.getTime() > ahora.getTime()) {
          // Aún es futura y ya no cumple: el envío volvió a la normalidad (por
          // ejemplo, se reprocesó). Si la hora YA pasó, se queda: no llegó a tiempo.
          nota = 'El envío volvió a la normalidad.';
        }
      }
      if (
        nota &&
        (await this.exceptions.autoResolver(organizationId, a.id, nota, ahora))
      ) {
        cerradas++;
      }
    }
    return cerradas;
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Auditoría
  // ─────────────────────────────────────────────────────────────

  private async vigilarAuditoria(
    organizationId: string,
    ahora: Date,
    resumen: ResumenVigilancia,
  ): Promise<void> {
    const desde = new Date(
      ahora.getTime() - UMBRALES_VIGILANTE.auditoriaVentanaHoras * 3_600_000,
    );
    const filas = await this.prisma.syncAudit.findMany({
      where: {
        organizationId,
        outcome: { in: ['ERROR', 'CONFLICT'] },
        // AGENIA_TO_HIS no: los fallos de entrega ya los cubre el outbox y saldrían
        // duplicados. RECONCILE tampoco: su deriva se persiste por cita. CONFIG no es un problema.
        direction: {
          in: [
            SYNC_AUDIT_DIRECTION.INBOUND,
            SYNC_AUDIT_DIRECTION.HIS_TO_AGENIA,
          ],
        },
        createdAt: { gte: desde },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_AUDITORIA,
      select: {
        direction: true,
        entityType: true,
        entityId: true,
        op: true,
        outcome: true,
        detail: true,
        createdAt: true,
      },
    });

    // El mismo problema repetido es UNA excepción con su cuenta, no una por fila.
    const grupos = new Map<
      string,
      { fila: (typeof filas)[number]; cuenta: number; ultima: Date }
    >();
    for (const f of filas) {
      const clave = claveExcepcion.auditoria({
        direction: f.direction,
        entityType: f.entityType,
        entityId: f.entityId,
        cupo: parseCupo(f.detail),
        outcome: f.outcome,
      });
      const g = grupos.get(clave);
      if (g) {
        g.cuenta++;
        if (f.createdAt > g.ultima) g.ultima = f.createdAt;
      } else {
        grupos.set(clave, { fila: f, cuenta: 1, ultima: f.createdAt });
      }
    }

    const idsCitas = [...grupos.values()]
      .map((g) => g.fila)
      .filter((f) => f.entityType === 'APPOINTMENT' && f.entityId)
      .map((f) => f.entityId as string);
    const citas = await this.cargarCitas(organizationId, idsCitas);

    for (const [dedupeKey, g] of grupos) {
      const { fila } = g;
      const cita =
        fila.entityType === 'APPOINTMENT' && fila.entityId
          ? citas.get(fila.entityId)
          : undefined;
      const kind: TipoExcepcion =
        fila.outcome === 'CONFLICT' ? 'CONFLICTO_SYNC' : 'ERROR_SYNC';
      this.contar(
        resumen,
        await this.exceptions.registrar(
          organizationId,
          {
            kind,
            dedupeKey,
            severity: 'MEDIA',
            title: TITULO_EXCEPCION[kind],
            detail: `${fila.direction} · ${fila.op} · ${fila.entityType}${
              fila.detail ? `: ${fila.detail}` : ''
            }`.slice(0, 1000),
            appointmentId: cita?.id ?? null,
            patientId: cita?.patientId ?? null,
            entityType: fila.entityType,
            entityId: fila.entityId,
            epsId: cita?.epsId ?? null,
            doctorId: cita?.doctorId ?? null,
            appointmentStartAt: cita?.startTime ?? null,
            meta: {
              direction: fila.direction,
              op: fila.op,
              outcome: fila.outcome,
            },
            occurrences: g.cuenta,
            lastSeenAt: g.ultima,
          },
          ahora,
        ),
      );
    }

    // Sin nuevas ocurrencias en unos días: se da por superado.
    const limite = new Date(
      ahora.getTime() - UMBRALES_VIGILANTE.auditoriaSinRecurrenciaDias * MS_DIA,
    );
    const viejas = await this.prisma.syncException.findMany({
      where: {
        organizationId,
        kind: { in: ['CONFLICTO_SYNC', 'ERROR_SYNC'] },
        status: { in: ['ABIERTA', 'EN_REVISION'] },
        lastSeenAt: { lt: limite },
      },
      select: { id: true },
    });
    for (const v of viejas) {
      if (
        await this.exceptions.autoResolver(
          organizationId,
          v.id,
          `Sin nuevas ocurrencias en ${UMBRALES_VIGILANTE.auditoriaSinRecurrenciaDias} días.`,
          ahora,
        )
      ) {
        resumen.autoResueltas++;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Vencimiento (§12 #15)
  // ─────────────────────────────────────────────────────────────

  /**
   * Cierra como `VENCIDA` lo activo de citas cuya hora pasó hace más de
   * `vencimientoDias` y que nadie movió en ese tiempo (`debeVencer`). La consulta ya
   * filtra por fechas —usa el índice por `appointmentStartAt`— y `debeVencer` decide:
   * la regla vive en un solo sitio. No depende del outbox: vence igual con el envío
   * pausado, porque lo que vence es el tiempo, no el estado del envío.
   */
  private async vencerLasOlvidadas(
    organizationId: string,
    ahora: Date,
  ): Promise<number> {
    const limite = new Date(
      ahora.getTime() - UMBRALES_VIGILANTE.vencimientoDias * MS_DIA,
    );
    const candidatas = await this.prisma.syncException.findMany({
      where: {
        organizationId,
        status: { in: ['ABIERTA', 'EN_REVISION'] },
        appointmentStartAt: { lt: limite },
        updatedAt: { lt: limite },
      },
      select: {
        id: true,
        status: true,
        appointmentStartAt: true,
        updatedAt: true,
      },
      take: MAX_DERIVA,
    });
    let vencidas = 0;
    for (const c of candidatas) {
      if (
        !debeVencer(
          {
            status: c.status,
            appointmentStartIso: c.appointmentStartAt?.toISOString() ?? null,
            updatedAtIso: c.updatedAt.toISOString(),
          },
          ahora.toISOString(),
        )
      ) {
        continue;
      }
      if (
        await this.exceptions.vencer(
          organizationId,
          { id: c.id, updatedAt: c.updatedAt },
          ahora,
        )
      ) {
        vencidas++;
      }
    }
    return vencidas;
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Deriva de la reconciliación
  // ─────────────────────────────────────────────────────────────

  /**
   * Lo llama la reconciliación con lo que encontró: citas que AgenIA da por hechas y
   * el hospital NO tiene. La reconciliación no las repara —repararlas sería escribir
   * en la base del hospital desde una comparación, y eso lo decide una persona—: aquí
   * se le dan a esa persona, con la cita, el alcance y la gravedad por cercanía.
   *
   * `inHis === 0` (una foto vacía del hospital) NO se persiste: en un hospital vivo no
   * es un dato, es un fallo de la lectura, y «faltan todas» inundaría la bandeja.
   */
  async registrarDeriva(
    organizationId: string,
    ventana: { from: Date; to: Date },
    items: DerivaItem[],
    inHis: number,
    ahora: Date = new Date(),
  ): Promise<void> {
    if (inHis === 0) {
      this.logger.warn(
        `Deriva NO persistida (org ${organizationId}): la foto del hospital llegó vacía; ` +
          `no se le atribuye a esas ${items.length} cita(s).`,
      );
      return;
    }
    const truncada = items.length > MAX_DERIVA;
    if (truncada) {
      this.logger.warn(
        `Deriva (org ${organizationId}): ${items.length} citas faltan en el hospital; ` +
          `se abren ${MAX_DERIVA} y no se cierra nada solo.`,
      );
    }
    const vigentes = new Set<string>();
    const resumen = {
      abiertas: 0,
      actualizadas: 0,
      reabiertas: 0,
      autoResueltas: 0,
    } as ResumenVigilancia;

    for (const item of truncada ? items.slice(0, MAX_DERIVA) : items) {
      const dedupeKey = claveExcepcion.derivaEnHis(item.appointmentId);
      vigentes.add(dedupeKey);
      const minutos = Math.floor(
        (item.startTime.getTime() - ahora.getTime()) / 60_000,
      );
      const severity: SeveridadExcepcion =
        minutos > 0 ? severidadPorCercania('ALTA', minutos) : 'ALTA';
      this.contar(
        resumen,
        await this.exceptions.registrar(
          organizationId,
          {
            kind: 'DERIVA_EN_HIS',
            dedupeKey,
            severity,
            title: TITULO_EXCEPCION.DERIVA_EN_HIS,
            detail:
              `La reconciliación con el hospital no encontró la cita ${item.clave}. ` +
              'Puede haberse cancelado allá, agendado en otro cupo o no haberse registrado nunca: ' +
              'la comparación no dice cuál.',
            appointmentId: item.appointmentId,
            patientId: item.patientId,
            entityType: 'APPOINTMENT',
            entityId: item.appointmentId,
            epsId: item.epsId,
            doctorId: item.doctorId,
            appointmentStartAt: item.startTime,
            meta: { clave: item.clave },
          },
          ahora,
        ),
      );
    }
    if (truncada) return;

    // Las que ya no faltan (llegaron, o la cita se canceló) se cierran solas.
    const activas = await this.prisma.syncException.findMany({
      where: {
        organizationId,
        kind: 'DERIVA_EN_HIS',
        status: { in: ['ABIERTA', 'EN_REVISION'] },
        appointmentStartAt: { gte: ventana.from, lt: ventana.to },
      },
      select: { id: true, dedupeKey: true },
    });
    for (const a of activas) {
      if (vigentes.has(a.dedupeKey)) continue;
      await this.exceptions.autoResolver(
        organizationId,
        a.id,
        'La última reconciliación ya no la echa en falta en el hospital.',
        ahora,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Ayudas
  // ─────────────────────────────────────────────────────────────

  private contar(resumen: ResumenVigilancia, r: string): void {
    if (r === 'CREADA') resumen.abiertas++;
    else if (r === 'REABIERTA') resumen.reabiertas++;
    else if (r === 'ACTUALIZADA' || r === 'ESCALADA') resumen.actualizadas++;
  }

  private async cargarCitas(
    organizationId: string,
    ids: string[],
  ): Promise<Map<string, CitaVigilada>> {
    const salida = new Map<string, CitaVigilada>();
    const unicos = [...new Set(ids)];
    for (let i = 0; i < unicos.length; i += CHUNK) {
      const filas = await this.prisma.appointment.findMany({
        where: { organizationId, id: { in: unicos.slice(i, i + CHUNK) } },
        select: {
          id: true,
          status: true,
          origin: true,
          patientId: true,
          epsId: true,
          scheduleSlot: { select: { startTime: true, doctorId: true } },
        },
      });
      for (const f of filas) {
        salida.set(f.id, {
          id: f.id,
          status: f.status,
          origin: f.origin,
          patientId: f.patientId,
          epsId: f.epsId,
          startTime: f.scheduleSlot.startTime,
          doctorId: f.scheduleSlot.doctorId,
        });
      }
    }
    return salida;
  }
}
