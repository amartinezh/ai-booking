import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SYNC_AUDIT_DIRECTION,
  documentoSinCerosIniciales,
  normalizeDocumento,
} from '@agenia/shared';
import {
  MirrorWatchdogService,
  type DerivaItem,
} from './mirror-watchdog.service';

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
  /** Servicio de la cita en el HIS. Un agente anterior no lo manda. */
  serviceExternalKey?: string;
}

/**
 * Tope de citas que se le piden al agente en una reconciliación. La primera,
 * tras homologar médicos, puede traer cientos; el resto llega en la siguiente
 * (las más cercanas primero, que son las que tienen recordatorio).
 */
export const MAX_CITAS_A_TRAER = 1000;

/** Documento para comparar (sin ceros a la izquierda); '' si no hay. */
const documento = (raw: string | null | undefined): string => {
  const normalizado = normalizeDocumento(raw);
  return normalizado ? documentoSinCerosIniciales(normalizado) : '';
};

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
  /**
   * 🩺 Cupos con cita cuyo servicio se corrigió al de la cita del hospital (ver
   * `MirrorApplyService.alinearServicioDelCupo`).
   */
  serviceFixed: number;
  /**
   * 🩺 Citas del hospital que AgenIA quiere y no tiene: médico homologado,
   * servicio activo y sin cita vigente en su cupo. El agente las trae como altas.
   */
  toImport: { doctorExternalKey: string; startTimeIso: string }[];
  /**
   * 🩺 El radar: citas de servicios activos con médicos que AgenIA NO tiene
   * homologados, por código de médico del HIS. Para trabajar con el 100 % de un
   * servicio hay que crear y homologar a esos médicos (homologar.ts).
   */
  activeServiceUnmapped: Record<string, number>;
  /**
   * 🩺 El otro lado del radar: citas de servicios activos con médicos que SÍ
   * están homologados pero tienen WhatsApp OFF. AgenIA las tiene y no trabaja con
   * ellas; para cubrir el 100 % del servicio hay que encenderlos en Médicos.
   */
  activeServiceWhatsappOff: Record<string, number>;
  /** true si los dos sistemas coinciden exactamente. */
  inSync: boolean;
}

@Injectable()
export class MirrorReconciliationService {
  private readonly logger = new Logger(MirrorReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly watchdog: MirrorWatchdogService,
  ) {}

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
        patientId: true,
        epsId: true,
        scheduleSlot: {
          select: {
            id: true,
            startTime: true,
            doctorId: true,
            serviceId: true,
          },
        },
      },
    });

    // Homologación de médicos, en una sola consulta.
    const mapas = await this.prisma.mirrorEntityMap.findMany({
      where: { organizationId, entityType: 'DOCTOR' },
      select: { agenIAId: true, externalKey: true },
    });
    const claveHis = new Map(mapas.map((m) => [m.agenIAId, m.externalKey]));

    const enAgenIA = new Set<string>();
    // La cita detrás de cada llave, para poder decir CUÁL falta (la bandeja de
    // excepciones necesita la cita, no solo `médico|hora`).
    const citaPorClave = new Map<string, DerivaItem>();
    // El cupo de cada cita, para corregirle el servicio.
    const cupoPorClave = new Map<string, { id: string; serviceId?: string }>();
    for (const cita of citas) {
      const medico = claveHis.get(cita.scheduleSlot.doctorId);
      // Un médico sin homologar no puede compararse: su cita nunca llegó al
      // HIS y contarla como "falta" sería ruido. Ya lo reporta el dispatcher.
      if (!medico) continue;
      const clave = `${medico}|${cita.scheduleSlot.startTime.toISOString()}`;
      enAgenIA.add(clave);
      citaPorClave.set(clave, {
        appointmentId: cita.id,
        patientId: cita.patientId ?? null,
        epsId: cita.epsId ?? null,
        doctorId: cita.scheduleSlot.doctorId,
        startTime: cita.scheduleSlot.startTime,
        clave,
      });
      cupoPorClave.set(clave, {
        id: cita.scheduleSlot.id,
        serviceId: cita.scheduleSlot.serviceId,
      });
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

    const {
      serviceFixed,
      toImport,
      activeServiceUnmapped,
      activeServiceWhatsappOff,
    } = await this.serviciosYCitasATraer(
      organizationId,
      hisSnapshot,
      window,
      claveHis,
      enAgenIA,
      cupoPorClave,
    );

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
      serviceFixed,
      toImport,
      activeServiceUnmapped,
      activeServiceWhatsappOff,
      inSync: missingInHis.length === 0 && missingInAgenIA.length === 0,
    };

    await this.registrar(organizationId, report);

    // La deriva HACIA el hospital no se repara sola (escribir o borrar en su base a
    // partir de una comparación lo decide una persona): pasa a la bandeja de
    // excepciones, con la cita y su alcance, para que esa persona la vea y la cierre.
    // Nunca debe romper la reconciliación: el informe ya quedó en `SyncAudit`.
    try {
      await this.watchdog.registrarDeriva(
        organizationId,
        window,
        missingInHis.flatMap((clave) => {
          const cita = citaPorClave.get(clave);
          return cita ? [cita] : [];
        }),
        enHis.size,
      );
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo pasar la deriva a la bandeja (org ${organizationId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return report;
  }

  /**
   * 🩺 AgenIA trabaja con las citas de los servicios ACTIVOS (en Anserma, solo
   * medicina general), y el servicio de una cita es el de su cupo. Dos cosas, con
   * el servicio que el agente manda de cada cita del hospital:
   *
   *   1. Corrige el servicio de los cupos con cita. El barrido de agenda crea los
   *      cupos con el servicio del médico, y hasta el 2026-10-15 una cita del
   *      hospital que caía en uno de ellos no se lo cambiaba: el mismo médico
   *      atiende medicina general, hipertensos y lectura de exámenes, y una cita
   *      de hipertensos quedaba como de medicina general. Ahora el alta lo
   *      alinea; esto arregla las de antes y cualquier cambio que no se vio.
   *   2. Dice qué citas del hospital hay que traer: médico homologado, servicio
   *      activo, con documento y sin cita vigente en AgenIA. La detección de
   *      cambios solo ve las altas NUEVAS, así que las que el hospital agendó
   *      antes de homologar a su médico no entrarían nunca.
   *
   * No trae una cita que AgenIA canceló para ese mismo paciente y el hospital
   * todavía tiene (la cancelación va en camino, o el hospital no la aplicó):
   * traerla deshacería la cancelación. Eso lo mira una persona (Bandeja).
   *
   * Sin el servicio (un agente anterior) no hace ninguna de las dos.
   */
  private async serviciosYCitasATraer(
    organizationId: string,
    hisSnapshot: HisAppointmentSnapshot[],
    window: { from: Date; to: Date },
    claveHis: Map<string, string>,
    enAgenIA: Set<string>,
    cupoPorClave: Map<string, { id: string; serviceId?: string }>,
  ): Promise<{
    serviceFixed: number;
    toImport: { doctorExternalKey: string; startTimeIso: string }[];
    activeServiceUnmapped: Record<string, number>;
    activeServiceWhatsappOff: Record<string, number>;
  }> {
    const conServicio = hisSnapshot.filter((c) => !!c.serviceExternalKey);
    if (conServicio.length === 0) {
      return {
        serviceFixed: 0,
        toImport: [],
        activeServiceUnmapped: {},
        activeServiceWhatsappOff: {},
      };
    }

    const [mapasServicio, activos, canceladas, apagados] = await Promise.all([
      this.prisma.mirrorEntityMap.findMany({
        where: { organizationId, entityType: 'SERVICE' },
        select: { agenIAId: true, externalKey: true },
      }),
      this.prisma.medicalService.findMany({
        where: { organizationId, isActive: true },
        select: { id: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          organizationId,
          status: 'CANCELLED',
          scheduleSlot: { startTime: { gte: window.from, lt: window.to } },
        },
        select: {
          scheduleSlot: { select: { startTime: true, doctorId: true } },
          patient: { select: { cedula: true } },
        },
      }),
      this.prisma.doctorProfile.findMany({
        where: {
          organizationId,
          id: { in: [...claveHis.keys()] },
          whatsappBookingEnabled: false,
        },
        select: { id: true },
      }),
    ]);
    const servicioDe = new Map(
      mapasServicio.map((m) => [m.externalKey, m.agenIAId]),
    );
    const activo = new Set(activos.map((a) => a.id));
    const canceladaPara = new Set(
      canceladas.flatMap((c) => {
        const medico = claveHis.get(c.scheduleSlot.doctorId);
        const doc = documento(c.patient?.cedula);
        return medico && doc
          ? [`${medico}|${c.scheduleSlot.startTime.toISOString()}|${doc}`]
          : [];
      }),
    );
    const homologados = new Set(claveHis.values());
    const enOff = new Set(
      apagados.flatMap((d) => {
        const clave = claveHis.get(d.id);
        return clave ? [clave] : [];
      }),
    );

    const aCorregir = new Map<string, string[]>();
    const aTraer: { doctorExternalKey: string; startTimeIso: string }[] = [];
    const sinHomologar: Record<string, number> = {};
    const conWhatsappOff: Record<string, number> = {};
    for (const c of conServicio) {
      const startTimeIso = new Date(c.startTimeIso).toISOString();
      const clave = `${c.doctorExternalKey}|${startTimeIso}`;
      const servicio = servicioDe.get(c.serviceExternalKey as string);

      if (enOff.has(c.doctorExternalKey) && servicio && activo.has(servicio)) {
        conWhatsappOff[c.doctorExternalKey] =
          (conWhatsappOff[c.doctorExternalKey] ?? 0) + 1;
      }

      const cupo = cupoPorClave.get(clave);
      if (cupo) {
        if (servicio && servicio !== cupo.serviceId) {
          aCorregir.set(servicio, [
            ...(aCorregir.get(servicio) ?? []),
            cupo.id,
          ]);
        }
        continue;
      }

      if (
        !homologados.has(c.doctorExternalKey) &&
        servicio &&
        activo.has(servicio)
      ) {
        sinHomologar[c.doctorExternalKey] =
          (sinHomologar[c.doctorExternalKey] ?? 0) + 1;
        continue;
      }

      if (
        homologados.has(c.doctorExternalKey) &&
        !enAgenIA.has(clave) &&
        servicio &&
        activo.has(servicio) &&
        documento(c.patientDocument) &&
        !canceladaPara.has(`${clave}|${documento(c.patientDocument)}`)
      ) {
        aTraer.push({ doctorExternalKey: c.doctorExternalKey, startTimeIso });
      }
    }

    let serviceFixed = 0;
    if (aCorregir.size > 0) {
      await this.prisma.$transaction(async (tx) => {
        // Nace del HIS: no vuelve a él.
        await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);
        for (const [serviceId, ids] of aCorregir) {
          const { count } = await tx.scheduleSlot.updateMany({
            where: { organizationId, id: { in: ids } },
            data: { serviceId },
          });
          serviceFixed += count;
        }
      });
      this.logger.warn(
        `Reconciliación (org ${organizationId}): ${serviceFixed} cupo(s) con cita ` +
          `tenían un servicio distinto al de su cita en el hospital; se corrigieron.`,
      );
    }

    if (Object.keys(sinHomologar).length > 0) {
      this.logger.warn(
        `Reconciliación (org ${organizationId}): citas de servicios activos con ` +
          `médicos sin homologar (AgenIA no las tiene): ` +
          Object.entries(sinHomologar)
            .map(([m, n]) => `${m}=${n}`)
            .join(', ') +
          '.',
      );
    }

    if (Object.keys(conWhatsappOff).length > 0) {
      this.logger.warn(
        `Reconciliación (org ${organizationId}): citas de servicios activos con ` +
          `médicos en WhatsApp OFF (AgenIA no trabaja con ellas): ` +
          Object.entries(conWhatsappOff)
            .map(([m, n]) => `${m}=${n}`)
            .join(', ') +
          '.',
      );
    }

    aTraer.sort((a, b) => a.startTimeIso.localeCompare(b.startTimeIso));
    return {
      serviceFixed,
      toImport: aTraer.slice(0, MAX_CITAS_A_TRAER),
      activeServiceUnmapped: sinHomologar,
      activeServiceWhatsappOff: conWhatsappOff,
    };
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
        direction: SYNC_AUDIT_DIRECTION.RECONCILE,
        entityType: 'APPOINTMENT',
        op: 'COMPARE',
        outcome: report.inSync ? 'OK' : 'CONFLICT',
        detail: JSON.stringify({
          window: report.window,
          inAgenIA: report.inAgenIA,
          inHis: report.inHis,
          // Antes de las listas: el detalle se recorta a 4000 caracteres.
          serviceFixed: report.serviceFixed,
          toImport: report.toImport.length,
          activeServiceUnmapped: report.activeServiceUnmapped,
          activeServiceWhatsappOff: report.activeServiceWhatsappOff,
          missingInHis: report.missingInHis,
          missingInAgenIA: report.missingInAgenIA,
          repaired: report.repaired,
        }).slice(0, 4000),
      },
    });
  }
}
