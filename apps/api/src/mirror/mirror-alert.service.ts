import { Injectable, Logger } from '@nestjs/common';
import type { SyncException } from '@agenia/database';
import {
  AGENTE_SIN_SENAL_MIN,
  DEFAULT_TIMEZONE,
  PRUEBA_AVISO_CADA_MIN,
  SYNC_AUDIT_DIRECTION,
  TIPOS_CON_AVISO,
  TIPOS_CON_AVISO_PACIENTE,
  UMBRALES_VIGILANTE,
  alcanceDeDestinatario,
  destinatariosDelLote,
  enmascararIdentificadorWhatsapp,
  explicarFalloDeEnvio,
  hayQuienRecibaElAviso,
  nombreDeDestinatario,
  nombresParaHistorial,
  parametrosPlantillaAviso,
  parametrosPlantillaAvisoPaciente,
  parametrosPruebaAviso,
  repartirLote,
  requiereAviso,
  requiereRecordatorio,
  type ClaseAviso,
  type DestinatarioAviso,
  type EstadoExcepcion,
  type GrupoAviso,
  type ItemAviso,
  type SeveridadExcepcion,
  type TipoExcepcion,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { doctorLabel } from '../common/doctor-label.util';
import { WhatsappTemplateService } from '../whatsapp-config/whatsapp-template.service';
import { MirrorExceptionsService } from './mirror-exceptions.service';
import { getErrorMessage } from '../common/error-message.util';

/**
 * El aviso PROACTIVO al agendador (docs/PLAN_RASTREO_PACIENTE.md §10 #2, Fase 3):
 * «una cita confirmada por WhatsApp no llegó al hospital». Avisa ANTES de que el
 * paciente llegue, en vez de esperar a que alguien abra la bandeja.
 *
 * ═══ Cómo se cuida al agendador ═══
 *  · UN solo mensaje por vuelta, clínica y clase (aviso o recordatorio), con el
 *    resumen (cuántas y la más próxima), no uno por cita: veinte WhatsApp seguidos
 *    se silencian y el aviso deja de servir.
 *  · Una vez por gravedad (`requiereAviso`): vuelve a avisar solo si la cita se acercó.
 *  · Solo de lo que nadie ha tomado: si alguien ya se ocupa, avisar es ruido.
 *
 * ═══ A quién (2026-11-02, docs/PLAN_AVISOS_AGENDADORES.md) ═══
 * A una LISTA (`SyncAlertRecipient`), no a un número: usuarios de la clínica o números
 * sueltos, cada uno con su modo, los avisos que marcó y su alcance. Quién recibe qué
 * lo deciden las reglas de `@agenia/shared` (`destinatariosDelLote`, `repartirLote`).
 * Cada persona recibe UN mensaje por lote con SU resumen: un agendador acotado a una
 * EPS cuenta solo las suyas.
 *
 * ═══ Si nadie lo atiende (§12 #14) ═══
 * Si tras el aviso nadie toma la excepción en `recordatorioMin`, se RECUERDA, hasta
 * `maxRecordatorios` veces (`requiereRecordatorio`). El recordatorio va a quienes
 * recibieron el aviso Y a los de «Solo recordatorios» (el respaldo de antes): es el
 * escalamiento a otras personas. «Nadie la tomó» es la señal, no el «leído» de Meta.
 *
 * ═══ Cómo se cuida al paciente ═══
 *  · El mensaje sale hacia teléfonos personales del personal y pasa por Meta: dice
 *    QUÉ pasa y cuándo, SIN datos del paciente. El detalle está en la bandeja, tras la
 *    sesión (`parametrosPlantillaAviso` lo garantiza y lo prueba).
 *
 * ═══ Por qué una plantilla y no texto libre ═══
 * El agendador casi nunca le ha escrito al número de la clínica: fuera de la
 * ventana de 24 h de Meta un mensaje libre no sale. Sin la plantilla aprobada el
 * aviso NO sale y la excepción queda solo en la bandeja — nada se pierde, pero nadie
 * se entera hasta que la abre. Por eso la bandeja lo dice. El recordatorio usa la
 * MISMA plantilla: no hay que aprobar otra.
 *
 * ═══ Dos réplicas de la API ═══
 * Cada excepción se RECLAMA con un compare-and-set antes de enviar (`reclamarAviso`):
 * solo una réplica gana. Una excepción que le llegó a AL MENOS una persona queda
 * avisada; si no le llegó a nadie, la reclamación se devuelve para que la vuelta
 * siguiente reintente. A quien le falló queda anotado en su fila (`lastError`) y en
 * el historial, y el vigilante abre una alerta técnica por esa persona.
 *
 * El correo (`agendadorEmail`) NO se usa, por decisión (§12 #13): el aviso es solo por
 * WhatsApp.
 *
 * ═══ Dos avisos, dos plantillas (2026-10-27) ═══
 * Lo de la sincronización (`TIPOS_CON_AVISO`) va con `SYNC_EXCEPTION_ALERT`, apenas
 * aparece. Lo que pidió un paciente y nadie atendió (`TIPOS_CON_AVISO_PACIENTE`:
 * pidió cancelar y no confirmó, avisó que no irá) va con `PATIENT_REQUEST_ALERT` y
 * solo con la cita a 24 h o menos: el texto aprobado de la primera dice que las citas
 * no llegaron al hospital, y estas sí llegaron. Misma lista, mismas reglas.
 */

/** Qué se avisa con cada plantilla y cómo se arman sus variables. */
interface GrupoDeAviso {
  plantilla: 'SYNC_EXCEPTION_ALERT' | 'PATIENT_REQUEST_ALERT';
  /** La casilla de la lista que lo recibe (`syncAlerts` / `patientRequestAlerts`). */
  grupo: GrupoAviso;
  tipos: readonly TipoExcepcion[];
  parametros: (
    items: ItemAviso[],
    ctx: {
      agenteSinSenal: boolean;
      hisAlcanzable: boolean | null;
      timeZone: string;
      recordatorio?: number;
    },
  ) => string[];
  /** Para el registro: «aviso al agendador» o «aviso de pedidos de pacientes». */
  nombre: string;
}

const SINCRONIZACION: GrupoDeAviso = {
  plantilla: 'SYNC_EXCEPTION_ALERT',
  grupo: 'SINCRONIZACION',
  tipos: TIPOS_CON_AVISO,
  parametros: parametrosPlantillaAviso,
  nombre: 'Aviso al agendador',
};

const PEDIDOS_DE_PACIENTES: GrupoDeAviso = {
  plantilla: 'PATIENT_REQUEST_ALERT',
  grupo: 'PEDIDOS_PACIENTES',
  tipos: TIPOS_CON_AVISO_PACIENTE,
  parametros: (items, ctx) =>
    parametrosPlantillaAvisoPaciente(items, {
      timeZone: ctx.timeZone,
      recordatorio: ctx.recordatorio,
    }),
  nombre: 'Aviso de pedidos de pacientes',
};

/** Cómo le fue a cada persona en esta vuelta: el vigilante abre o cierra su alerta técnica. */
export interface ResultadoDestinatario {
  id: string;
  nombre: string;
  phone: string;
  ok: boolean;
  /** El motivo, ya explicado (`explicarFalloDeEnvio`). */
  error?: string;
}

export type ResultadoAviso =
  | {
      enviado: true;
      citas: number;
      recordatorios: number;
      destinatarios: ResultadoDestinatario[];
    }
  | {
      enviado: false;
      motivo:
        | 'NADA_QUE_AVISAR'
        | 'APAGADO'
        | 'SIN_DESTINO'
        | 'SIN_PLANTILLA'
        | 'YA_RECLAMADO'
        | 'ENVIO_FALLIDO';
      detalle?: string;
      destinatarios?: ResultadoDestinatario[];
    };

type ResultadoLote =
  | {
      estado: 'ENVIADO';
      cuantas: number;
      destinatarios: ResultadoDestinatario[];
    }
  | { estado: 'YA_RECLAMADO' }
  | {
      estado: 'FALLIDO';
      detalle?: string;
      destinatarios: ResultadoDestinatario[];
    };

interface ContextoEnvio {
  destinatarios: DestinatarioAviso[];
  lastHeartbeatAt: Date | null;
  lastHisReachable: boolean | null;
}

/** Tope de excepciones que se consideran por vuelta. */
const MAX_CANDIDATAS = 200;

/** Lo que guarda la fila de cada persona de su último rechazo. */
const MAX_ERROR = 300;

@Injectable()
export class MirrorAlertService {
  private readonly logger = new Logger(MirrorAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exceptions: MirrorExceptionsService,
    private readonly templates: WhatsappTemplateService,
  ) {}

  /** Lo de la sincronización: `SYNC_EXCEPTION_ALERT`. */
  async avisar(
    organizationId: string,
    ahora: Date = new Date(),
  ): Promise<ResultadoAviso> {
    return this.avisarGrupo(organizationId, ahora, SINCRONIZACION);
  }

  /** 🙋 Lo que pidió un paciente con la cita cerca: `PATIENT_REQUEST_ALERT` (2026-10-27). */
  async avisarPedidosDePacientes(
    organizationId: string,
    ahora: Date = new Date(),
  ): Promise<ResultadoAviso> {
    return this.avisarGrupo(organizationId, ahora, PEDIDOS_DE_PACIENTES);
  }

  /**
   * La lista de avisos de una clínica, activos, como la usan las reglas: con el
   * nombre que se muestra y el alcance de cada uno (N3).
   */
  async leerDestinatarios(
    organizationId: string,
  ): Promise<DestinatarioAviso[]> {
    const filas = await this.prisma.syncAlertRecipient.findMany({
      where: { organizationId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        label: true,
        phone: true,
        mode: true,
        syncAlerts: true,
        patientRequestAlerts: true,
        isActive: true,
        user: {
          select: {
            email: true,
            role: true,
            agentProfile: {
              select: { fullName: true, epsId: true, doctorId: true },
            },
          },
        },
      },
    });
    return filas.map((f) => ({
      id: f.id,
      nombre: nombreDeDestinatario(f),
      phone: f.phone,
      mode: f.mode,
      syncAlerts: f.syncAlerts,
      patientRequestAlerts: f.patientRequestAlerts,
      isActive: f.isActive,
      alcance: alcanceDeDestinatario(f.user),
    }));
  }

  private async avisarGrupo(
    organizationId: string,
    ahora: Date,
    grupo: GrupoDeAviso,
  ): Promise<ResultadoAviso> {
    const candidatas = await this.prisma.syncException.findMany({
      where: {
        organizationId,
        status: 'ABIERTA',
        kind: { in: [...grupo.tipos] },
      },
      orderBy: { appointmentStartAt: 'asc' },
      take: MAX_CANDIDATAS,
    });
    const ahoraIso = ahora.toISOString();
    const vista = (e: SyncException) => ({
      kind: e.kind as TipoExcepcion,
      severity: e.severity as SeveridadExcepcion,
      status: e.status as EstadoExcepcion,
      notifiedSeverity: e.notifiedSeverity,
      notifiedAtIso: e.notifiedAt?.toISOString() ?? null,
      reminderCount: e.reminderCount,
      appointmentStartIso: e.appointmentStartAt?.toISOString() ?? null,
    });
    const nuevas = candidatas.filter((e) => requiereAviso(vista(e), ahoraIso));
    const recordar = candidatas.filter((e) =>
      requiereRecordatorio(vista(e), ahoraIso),
    );
    if (nuevas.length === 0 && recordar.length === 0)
      return { enviado: false, motivo: 'NADA_QUE_AVISAR' };

    // Antes de reclamar nada: si el aviso no puede salir, no se toca ninguna fila
    // (reclamar y devolver en cada vuelta sería puro ruido de escritura).
    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: {
        enabled: true,
        conflictAlertsEnabled: true,
        lastHeartbeatAt: true,
        lastHisReachable: true,
      },
    });
    if (!config?.enabled || !config.conflictAlertsEnabled) {
      return { enviado: false, motivo: 'APAGADO' };
    }
    // Sin nadie que reciba el PRIMER aviso de este grupo no sale nada: los de «Solo
    // recordatorios» se enteran después de un aviso, nunca en su lugar.
    const destinatarios = await this.leerDestinatarios(organizationId);
    if (!hayQuienRecibaElAviso(destinatarios, grupo.grupo))
      return { enviado: false, motivo: 'SIN_DESTINO' };
    const plantilla = await this.templates.findTemplate(
      organizationId,
      grupo.plantilla,
    );
    if (!plantilla) return { enviado: false, motivo: 'SIN_PLANTILLA' };

    const ctx: ContextoEnvio = {
      destinatarios,
      lastHeartbeatAt: config.lastHeartbeatAt,
      lastHisReachable: config.lastHisReachable,
    };
    const avisos = nuevas.length
      ? await this.enviarLote(
          organizationId,
          nuevas,
          'AVISO',
          ctx,
          ahora,
          grupo,
        )
      : null;
    const recordatorios = recordar.length
      ? await this.enviarLote(
          organizationId,
          recordar,
          'RECORDATORIO',
          ctx,
          ahora,
          grupo,
        )
      : null;

    const porPersona = juntarResultados([avisos, recordatorios]);
    const enviadas = (r: ResultadoLote | null) =>
      r?.estado === 'ENVIADO' ? r.cuantas : 0;
    if (enviadas(avisos) + enviadas(recordatorios) > 0) {
      return {
        enviado: true,
        citas: enviadas(avisos),
        recordatorios: enviadas(recordatorios),
        destinatarios: porPersona,
      };
    }
    const fallido = [avisos, recordatorios].find(
      (r): r is Extract<ResultadoLote, { estado: 'FALLIDO' }> =>
        r?.estado === 'FALLIDO',
    );
    if (fallido) {
      return {
        enviado: false,
        motivo: 'ENVIO_FALLIDO',
        detalle: fallido.detalle,
        destinatarios: porPersona,
      };
    }
    return { enviado: false, motivo: 'YA_RECLAMADO' };
  }

  /**
   * Reclama, envía y deja constancia de UN lote (todos avisos o todos recordatorios).
   * Cada persona recibe un mensaje con lo que le toca; una excepción que no le llegó
   * a nadie se devuelve.
   */
  private async enviarLote(
    organizationId: string,
    lote: SyncException[],
    clase: ClaseAviso,
    ctx: ContextoEnvio,
    ahora: Date,
    grupo: GrupoDeAviso,
  ): Promise<ResultadoLote> {
    // Reclamar: solo lo que esta réplica ganó se envía.
    const reclamadas: SyncException[] = [];
    for (const e of lote) {
      if (
        await this.exceptions.reclamarAviso(
          {
            id: e.id,
            severity: e.severity,
            notifiedSeverity: e.notifiedSeverity,
            notifiedAt: e.notifiedAt,
            reminderCount: e.reminderCount,
          },
          ahora,
          clase,
        )
      ) {
        reclamadas.push(e);
      }
    }
    if (reclamadas.length === 0) return { estado: 'YA_RECLAMADO' };

    const [medicos, org] = await Promise.all([
      this.prisma.doctorProfile.findMany({
        where: {
          organizationId,
          id: {
            in: [
              ...new Set(
                reclamadas
                  .map((e) => e.doctorId)
                  .filter((d): d is string => !!d),
              ),
            ],
          },
        },
        select: { id: true, fullName: true, isFunctionalAgenda: true },
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { timezone: true },
      }),
    ]);
    const nombreDe = new Map(medicos.map((m) => [m.id, doctorLabel(m)]));
    const casos = reclamadas.map((e) => ({
      excepcion: e,
      epsId: e.epsId,
      doctorId: e.doctorId,
      item: {
        doctor:
          (e.doctorId && nombreDe.get(e.doctorId)) || 'Agenda del hospital',
        inicioIso: (e.appointmentStartAt ?? ahora).toISOString(),
        kind: e.kind as TipoExcepcion,
        severity: e.severity as SeveridadExcepcion,
      } satisfies ItemAviso,
    }));
    const sinSenal =
      !ctx.lastHeartbeatAt ||
      ahora.getTime() - ctx.lastHeartbeatAt.getTime() >
        AGENTE_SIN_SENAL_MIN * 60_000;
    const timeZone = org?.timezone || DEFAULT_TIMEZONE;

    const quienes = destinatariosDelLote(ctx.destinatarios, grupo.grupo, clase);
    const llegoA = new Map<string, string[]>();
    const noLlegoA = new Map<string, string[]>();
    const resultados: ResultadoDestinatario[] = [];
    for (const { destinatario, items } of repartirLote(quienes, casos)) {
      const bodyParams = grupo.parametros(
        items.map((c) => c.item),
        {
          agenteSinSenal: sinSenal,
          hisAlcanzable: ctx.lastHisReachable,
          timeZone,
          // El número del recordatorio: el más alto de lo suyo (lo que más lleva sin atender).
          recordatorio:
            clase === 'RECORDATORIO'
              ? Math.max(...items.map((c) => c.excepcion.reminderCount + 1))
              : undefined,
        },
      );
      const r = await this.templates.sendTemplate({
        organizationId,
        recipientId: destinatario.phone,
        kind: grupo.plantilla,
        bodyParams,
      });
      const error = r.success ? undefined : explicarFalloDeEnvio(r.error);
      await this.anotarSalud(destinatario.id, r, ahora);
      resultados.push({
        id: destinatario.id,
        nombre: destinatario.nombre,
        phone: destinatario.phone,
        ok: r.success,
        ...(error ? { error } : {}),
      });
      if (!r.success) {
        this.logger.warn(
          `${grupo.nombre}: ${clase === 'AVISO' ? 'aviso' : 'recordatorio'} a ${enmascararIdentificadorWhatsapp(destinatario.phone)} NO enviado (org ${organizationId}): ${r.error ?? 'sin detalle'}.`,
        );
      }
      const destino = r.success ? llegoA : noLlegoA;
      for (const c of items) {
        destino.set(c.excepcion.id, [
          ...(destino.get(c.excepcion.id) ?? []),
          destinatario.nombre,
        ]);
      }
    }

    const entregadas = reclamadas.filter((e) => llegoA.has(e.id));
    // No le llegó a nadie: se devuelve lo reclamado para que la próxima vuelta reintente.
    for (const e of reclamadas.filter((x) => !llegoA.has(x.id))) {
      await this.exceptions.devolverAviso(
        {
          id: e.id,
          notifiedAt: e.notifiedAt,
          notifiedSeverity: e.notifiedSeverity,
          reminderCount: e.reminderCount,
        },
        ahora,
      );
    }
    for (const e of entregadas) {
      const a = nombresParaHistorial(llegoA.get(e.id) ?? []);
      const fallaron = noLlegoA.get(e.id) ?? [];
      const nota = fallaron.length
        ? ` No le salió a ${nombresParaHistorial(fallaron)}.`
        : '';
      await this.exceptions.anotar(
        e.id,
        clase === 'AVISO' ? 'AVISADA' : 'RECORDADA',
        null,
        null,
        clase === 'AVISO'
          ? `Aviso por WhatsApp a ${a}.${nota}`
          : `Recordatorio ${e.reminderCount + 1} de ${UMBRALES_VIGILANTE.maxRecordatorios} por WhatsApp a ${a}: nadie la había tomado.${nota}`,
      );
    }

    if (entregadas.length === 0) {
      const detalle = resultados.find((x) => !x.ok)?.error;
      this.logger.warn(
        `${grupo.nombre}: ${clase === 'AVISO' ? 'aviso' : 'recordatorio'} NO le llegó a nadie (org ${organizationId}): ${detalle ?? 'sin detalle'}.`,
      );
      return { estado: 'FALLIDO', detalle, destinatarios: resultados };
    }
    this.logger.log(
      `${grupo.nombre}: ${clase === 'AVISO' ? 'aviso' : 'recordatorio'} enviado (org ${organizationId}): ${entregadas.length} excepción(es) a ${resultados.filter((x) => x.ok).length} persona(s).`,
    );
    return {
      estado: 'ENVIADO',
      cuantas: entregadas.length,
      destinatarios: resultados,
    };
  }

  /**
   * N9: «Probar» desde la pantalla. Manda a esa persona la plantilla del aviso con el
   * texto de prueba, como mucho una vez cada `PRUEBA_AVISO_CADA_MIN` (compare-and-set
   * sobre `lastTestAt`: dos clics no mandan dos), y deja constancia en la bitácora.
   * Sale aunque los avisos estén apagados: sirve para comprobar antes de encenderlos.
   */
  async probar(
    organizationId: string,
    recipientId: string,
    quien: string,
    ahora: Date = new Date(),
  ): Promise<{ success: true } | { success: false; error: string }> {
    const fila = await this.prisma.syncAlertRecipient.findFirst({
      where: { id: recipientId, organizationId },
      select: {
        id: true,
        label: true,
        phone: true,
        user: {
          select: { email: true, agentProfile: { select: { fullName: true } } },
        },
      },
    });
    if (!fila) {
      return {
        success: false,
        error:
          'Esa persona ya no está en la lista de avisos. Recarga la página.',
      };
    }
    const desde = new Date(ahora.getTime() - PRUEBA_AVISO_CADA_MIN * 60_000);
    const { count } = await this.prisma.syncAlertRecipient.updateMany({
      where: {
        id: fila.id,
        organizationId,
        OR: [{ lastTestAt: null }, { lastTestAt: { lt: desde } }],
      },
      data: { lastTestAt: ahora },
    });
    if (count === 0) {
      return {
        success: false,
        error: `Ya se le mandó una prueba hace poco: espera ${PRUEBA_AVISO_CADA_MIN} minutos.`,
      };
    }

    const r = await this.templates.sendTemplate({
      organizationId,
      recipientId: fila.phone,
      kind: 'SYNC_EXCEPTION_ALERT',
      bodyParams: parametrosPruebaAviso(),
    });
    await this.anotarSalud(fila.id, r, ahora);
    const nombre = nombreDeDestinatario(fila);
    const motivo = r.success ? null : explicarFalloDeEnvio(r.error);
    await this.prisma.syncAudit
      .create({
        data: {
          organizationId,
          direction: SYNC_AUDIT_DIRECTION.CONFIG,
          entityType: 'SyncAlertRecipient',
          entityId: fila.id,
          op: 'ALERT_TEST',
          outcome: r.success ? 'OK' : 'ERROR',
          detail: `Prueba del aviso a ${nombre} (${enmascararIdentificadorWhatsapp(fila.phone)}), pedida por ${quien}: ${
            r.success ? 'Meta la aceptó' : `no salió: ${motivo}`
          }.`,
        },
      })
      .catch((e: unknown) =>
        this.logger.warn(
          `No quedó la constancia de la prueba del aviso (org ${organizationId}): ${getErrorMessage(e)}`,
        ),
      );
    return r.success
      ? { success: true }
      : { success: false, error: `No salió: ${motivo}.` };
  }

  /**
   * La salud de cada persona en su fila: el último envío que Meta aceptó (con su
   * wamid, para leer después si se entregó) o el último rechazo. Nunca lanza: no
   * anotarlo no debe deshacer un aviso que ya salió.
   */
  private async anotarSalud(
    recipientId: string,
    r: { success: boolean; error?: string; wamid?: string | null },
    ahora: Date,
  ): Promise<void> {
    await this.prisma.syncAlertRecipient
      .updateMany({
        where: { id: recipientId },
        data: r.success
          ? { lastSentAt: ahora, lastWamid: r.wamid ?? null }
          : {
              lastError: explicarFalloDeEnvio(r.error).slice(0, MAX_ERROR),
              lastErrorAt: ahora,
            },
      })
      .catch((e: unknown) =>
        this.logger.warn(
          `No se pudo anotar el último envío del destinatario ${recipientId}: ${getErrorMessage(e)}`,
        ),
      );
  }
}

/**
 * Cómo le fue a cada persona en la vuelta (aviso y recordatorio juntos): basta un
 * fallo para que su alerta técnica siga abierta.
 */
function juntarResultados(
  lotes: (ResultadoLote | null)[],
): ResultadoDestinatario[] {
  const porId = new Map<string, ResultadoDestinatario>();
  for (const lote of lotes) {
    if (!lote || lote.estado === 'YA_RECLAMADO') continue;
    for (const r of lote.destinatarios) {
      const previo = porId.get(r.id);
      porId.set(r.id, previo && !previo.ok ? previo : r);
    }
  }
  return [...porId.values()];
}
