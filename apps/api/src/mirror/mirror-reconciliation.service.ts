import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reconciliación entre AgenIA y el HIS — la capa 5 de las seis defensas del
 * plan (§6), y la única que detecta DERIVA SILENCIOSA.
 *
 * Las capas 1-4 (outbox transaccional, entrega al-menos-una-vez, orden por
 * entidad, dead-letter con alerta) protegen cada evento por separado. Ninguna
 * detecta el caso en que todo pareció ir bien y aun así los dos sistemas no
 * coinciden: un evento que se perdió antes de existir, una fila que alguien
 * tocó a mano en el HIS, un trigger que no estaba puesto.
 *
 * ⚠️ Este servicio compara AgenIA contra lo que el AGENTE le reporta. No abre
 * una conexión al HIS: el hospital no es alcanzable desde la nube por diseño
 * (plan §4.1, solo HTTPS saliente desde el agente). El agente sube su
 * instantánea por `POST /mirror/reconcile` y aquí se contrasta.
 */

/** Una cita del HIS, tal como la ve el agente. */
export interface HisAppointmentSnapshot {
  doctorExternalKey: string;
  startTimeIso: string;
  patientDocument?: string;
}

export interface ReconciliationReport {
  organizationId: string;
  window: { fromIso: string; toIso: string };
  /** Citas vigentes en AgenIA dentro de la ventana. */
  inAgenIA: number;
  /** Citas que el agente reportó desde el HIS. */
  inHis: number;
  /** Están en AgenIA y NO en el HIS: el paciente cree que tiene cita y no la tiene. */
  missingInHis: string[];
  /**
   * Citas del HIS cuyo cupo en AgenIA no existe o sigue disponible: AgenIA
   * podría vender esa misma hora otra vez.
   */
  missingInAgenIA: string[];
  /**
   * Cupos que se cerraron automáticamente porque el hospital ya los tenía
   * vendidos. Subconjunto de `missingInAgenIA`.
   */
  repaired: string[];
  /** true si los dos sistemas coinciden exactamente. */
  inSync: boolean;
}

@Injectable()
export class MirrorReconciliationService {
  private readonly logger = new Logger(MirrorReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Contrasta la instantánea del HIS contra las citas vigentes de AgenIA.
   *
   * La clave de comparación es `${códigoMédicoHIS}|${horaISO}` — la misma
   * identidad de cupo que usa el resto del espejo. El documento del paciente
   * se compara aparte porque una discrepancia ahí es un problema distinto
   * (misma hora, paciente distinto) y más grave que una ausencia.
   */
  async reconcile(
    organizationId: string,
    hisSnapshot: HisAppointmentSnapshot[],
    window: { from: Date; to: Date },
  ): Promise<ReconciliationReport> {
    const citas = await this.prisma.appointment.findMany({
      where: {
        organizationId,
        status: 'SCHEDULED',
        scheduleSlot: { startTime: { gte: window.from, lt: window.to } },
      },
      select: {
        id: true,
        scheduleSlot: { select: { startTime: true, doctorId: true } },
      },
    });

    // Homologación de médicos, en una sola consulta.
    const mapas = await this.prisma.mirrorEntityMap.findMany({
      where: { organizationId, entityType: 'DOCTOR' },
      select: { agenIAId: true, externalKey: true },
    });
    const claveHis = new Map(mapas.map((m) => [m.agenIAId, m.externalKey]));

    const enAgenIA = new Set<string>();
    for (const cita of citas) {
      const medico = claveHis.get(cita.scheduleSlot.doctorId);
      // Un médico sin homologar no puede compararse: su cita nunca llegó al
      // HIS y contarla como "falta" sería ruido. Ya lo reporta el dispatcher.
      if (!medico) continue;
      enAgenIA.add(`${medico}|${cita.scheduleSlot.startTime.toISOString()}`);
    }

    const enHis = new Set(
      hisSnapshot.map(
        (c) =>
          `${c.doctorExternalKey}|${new Date(c.startTimeIso).toISOString()}`,
      ),
    );

    const missingInHis = [...enAgenIA].filter((k) => !enHis.has(k)).sort();

    // ⚠️ La otra dirección NO se mide con la tabla `Appointment`.
    //
    // Una cita nacida en el HIS (agendada en ventanilla) no crea un
    // `Appointment` en AgenIA — el alta en caliente del paciente es Fase 2+.
    // Lo que AgenIA sí hace, y es lo que importa, es OCUPAR el cupo para dejar
    // de venderlo por WhatsApp. Comparar contra `Appointment` marcaba como
    // deriva cada cita de ventanilla del hospital: cinco en la prueba, cientos
    // en producción. Una alerta que siempre está en rojo deja de mirarse, y la
    // deriva de verdad se pierde entre el ruido.
    //
    // El criterio correcto es el operativo: ¿podría AgenIA vender otra vez esa
    // hora? Si el cupo no existe o sigue libre, eso sí es deriva.
    const cupos = await this.prisma.scheduleSlot.findMany({
      where: {
        organizationId,
        startTime: { gte: window.from, lt: window.to },
        doctorId: { in: [...claveHis.keys()] },
      },
      select: { id: true, doctorId: true, startTime: true, isAvailable: true },
    });
    const ocupacion = new Map<string, { id: string; isAvailable: boolean }>();
    for (const cupo of cupos) {
      const medico = claveHis.get(cupo.doctorId);
      if (!medico) continue;
      ocupacion.set(`${medico}|${cupo.startTime.toISOString()}`, {
        id: cupo.id,
        isAvailable: cupo.isAvailable,
      });
    }

    const missingInAgenIA = [...enHis]
      .filter((k) => {
        // Una cita que AgenIA tiene como propia está, por definición, conocida.
        if (enAgenIA.has(k)) return false;
        const cupo = ocupacion.get(k);
        // Sin cupo equivalente, o con el cupo todavía a la venta.
        return cupo === undefined || cupo.isAvailable;
      })
      .sort();

    // ─── Reparación ─────────────────────────────────────────────────────
    // Detectar no basta. Cada clave de `missingInAgenIA` es una hora que el
    // hospital YA vendió y que AgenIA sigue ofreciendo por WhatsApp: dejarla
    // así es esperar a que dos pacientes se presenten a la misma cita.
    //
    // Solo se repara ESTA dirección, y solo cerrando cupos. Es la única
    // corrección que no puede hacer daño: como mucho se deja de ofrecer una
    // hora que el hospital tiene ocupada. La dirección contraria (una cita que
    // AgenIA tiene y el hospital no) NO se toca sola — repararla significaría
    // escribir o borrar en la base del hospital a partir de una comparación, y
    // eso lo decide una persona.
    const reparados: string[] = [];
    for (const clave of missingInAgenIA) {
      const cupo = ocupacion.get(clave);
      if (!cupo || !cupo.isAvailable) continue;
      await this.prisma.$transaction(async (tx) => {
        // Marca de anti-eco: este cambio nace del HIS, no debe volver al HIS.
        await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);
        await tx.scheduleSlot.update({
          where: { id: cupo.id },
          data: { isAvailable: false },
        });
      });
      reparados.push(clave);
    }

    if (reparados.length > 0) {
      this.logger.warn(
        `Reconciliación (org ${organizationId}): ${reparados.length} cupo(s) que el ` +
          `hospital ya tenía vendidos y AgenIA seguía ofreciendo se cerraron ` +
          `automáticamente: ${reparados.slice(0, 5).join(', ')}.`,
      );
    }

    const report: ReconciliationReport = {
      organizationId,
      window: {
        fromIso: window.from.toISOString(),
        toIso: window.to.toISOString(),
      },
      inAgenIA: enAgenIA.size,
      inHis: enHis.size,
      missingInHis,
      missingInAgenIA,
      repaired: reparados,
      inSync: missingInHis.length === 0 && missingInAgenIA.length === 0,
    };

    await this.registrar(organizationId, report);
    return report;
  }

  /**
   * Deja el resultado en `SyncAudit`, coincida o no.
   *
   * También cuando coincide: sin el registro del día bueno no hay forma de
   * distinguir "reconcilió sin diferencias" de "la reconciliación no corrió".
   */
  private async registrar(
    organizationId: string,
    report: ReconciliationReport,
  ): Promise<void> {
    if (report.inSync) {
      this.logger.log(
        `Reconciliación OK (org ${organizationId}): ${report.inAgenIA} cita(s), sin diferencias.`,
      );
    } else {
      // Las dos direcciones de la deriva duelen distinto y conviene decirlo:
      // una deja al paciente sin cita, la otra revende un cupo.
      this.logger.error(
        `🚨 DERIVA entre AgenIA y el HIS (org ${organizationId}): ` +
          `${report.missingInHis.length} cita(s) que el hospital NO tiene ` +
          `(el paciente cree que sí) y ${report.missingInAgenIA.length} que AgenIA ` +
          `desconoce (podría revender ese cupo). ` +
          `Faltan en el HIS: ${report.missingInHis.slice(0, 5).join(', ') || '—'}. ` +
          `Faltan en AgenIA: ${report.missingInAgenIA.slice(0, 5).join(', ') || '—'}.`,
      );
    }

    await this.prisma.syncAudit.create({
      data: {
        organizationId,
        direction: 'RECONCILE',
        entityType: 'APPOINTMENT',
        op: 'COMPARE',
        outcome: report.inSync ? 'OK' : 'CONFLICT',
        detail: JSON.stringify({
          window: report.window,
          inAgenIA: report.inAgenIA,
          inHis: report.inHis,
          missingInHis: report.missingInHis,
          missingInAgenIA: report.missingInAgenIA,
          repaired: report.repaired,
        }).slice(0, 4000),
      },
    });
  }
}
