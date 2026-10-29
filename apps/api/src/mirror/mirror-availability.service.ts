import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  SYNC_AUDIT_DIRECTION,
  TITULO_EXCEPCION,
  claveExcepcion,
  severidadPorCercania,
} from '@agenia/shared';
import type { AvailabilityInput, AvailabilityResult } from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MirrorExceptionsService } from './mirror-exceptions.service';
import { getErrorMessage } from '../common/error-message.util';

/**
 * 🗓️ Una cita vigente que quedó fuera de la agenda del hospital (2026-10-29).
 *   · `HORA_QUITADA`  — el médico atiende ese día, pero ya no a esa hora.
 *   · `DIA_SIN_TURNO` — el médico ya no tiene ningún turno en la ventana.
 */
type MotivoAgendaQuitada = 'HORA_QUITADA' | 'DIA_SIN_TURNO';

interface CitaEnAgendaQuitada {
  citaId: string;
  patientId: string;
  epsId: string | null;
  origen: string;
  doctorId: string;
  slotId: string;
  inicio: Date;
  motivo: MotivoAgendaQuitada;
}

const ESTADOS_ACTIVOS_CASO = ['ABIERTA', 'EN_REVISION'];

/**
 * Fase 2 — la agenda de AgenIA pasa a ser la del hospital.
 *
 * ═══ El problema que resuelve ═══
 * Hasta aquí los `ScheduleSlot` de AgenIA se creaban a mano y no tenían por
 * qué parecerse a la agenda real: se podía vender por WhatsApp una hora en la
 * que el médico no atiende, y una jornada que el hospital cancelaba seguía
 * ofreciéndose. El espejo de CITAS estaba bien; el de AGENDA no existía.
 *
 * ═══ Cómo ═══
 * El agente sube la rejilla ya calculada (el HIS guarda bloques de turno, no
 * cupos) sub-ventana por sub-ventana — normalmente un día. Cada envío es la
 * foto COMPLETA de esa sub-ventana, así que aquí se puede crear lo que falta,
 * actualizar la ocupación y borrar lo que el hospital ya no tiene, sin
 * guardar estado a medio camino.
 *
 * ═══ Lo que NUNCA hace ═══
 * Tocar un cupo con una cita viva. Si el hospital quitó de su agenda una hora
 * en la que un paciente ya tiene cita, eso no es un cupo sobrante: es un
 * problema para una persona, y se reporta.
 */
@Injectable()
export class MirrorAvailabilityService {
  private readonly logger = new Logger(MirrorAvailabilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    // 🗓️ Un caso por cita fuera de la agenda (2026-10-29). Opcional: sin él
    // (pruebas antiguas) la lectura de la agenda funciona igual, sin casos.
    @Optional() private readonly exceptions?: MirrorExceptionsService,
  ) {}

  async apply(
    organizationId: string,
    input: AvailabilityInput,
  ): Promise<AvailabilityResult> {
    const config = await this.prisma.hospitalMirrorConfig.findUniqueOrThrow({
      where: { organizationId },
      select: { availabilityMode: true },
    });
    const mode = config.availabilityMode as AvailabilityResult['mode'];

    if (mode === 'OFF') {
      return {
        mode,
        created: 0,
        updated: 0,
        removed: 0,
        retired: 0,
        skipped: [],
        conflicts: [],
      };
    }

    const from = new Date(input.fromIso);
    const to = new Date(input.toIso);

    // Homologación de médicos + su servicio. `ScheduleSlot.serviceId` es
    // obligatorio en AgenIA y `TURNOS_MEDICOS` no lleva servicio: el turno es
    // del médico, y el servicio se elige al agendar. Así que el servicio del
    // cupo sale del médico. Un médico sin servicio no puede generar cupos, y
    // eso se reporta en vez de inventarlo.
    const mapas = await this.prisma.mirrorEntityMap.findMany({
      where: { organizationId, entityType: 'DOCTOR' },
      select: { agenIAId: true, externalKey: true },
    });
    const doctores = await this.prisma.doctorProfile.findMany({
      where: { id: { in: mapas.map((m) => m.agenIAId) } },
      select: { id: true, serviceId: true },
    });
    const servicioDe = new Map(doctores.map((d) => [d.id, d.serviceId]));
    const agenIAIdDe = new Map(mapas.map((m) => [m.externalKey, m.agenIAId]));

    const skipped: string[] = [];
    const deseados = new Map<
      string,
      {
        doctorId: string;
        serviceId: string;
        start: Date;
        end: Date;
        occupied: boolean;
      }
    >();

    let fueraDeVentana = 0;
    for (const s of input.slots) {
      // 🛡️ Un cupo de fuera de la ventana declarada se ignora.
      //
      // El servidor borra, DENTRO de esa ventana, todo lo que no venga en el
      // envío. Aceptar uno de fuera crearía un cupo que la pasada siguiente
      // borraría, y así en cada vuelta. Pasó de verdad: el driver filtraba los
      // turnos por instante UTC contra una columna de fecha local del HIS y se
      // desplazaba un día entero. Que el servidor no dependa de que el driver
      // acierte es barato y evita corromper la agenda.
      const inicio = new Date(s.startTimeIso);
      if (inicio < from || inicio >= to) {
        fueraDeVentana++;
        skipped.push(`${s.doctorExternalKey}|${s.startTimeIso}`);
        continue;
      }

      const doctorId = agenIAIdDe.get(s.doctorExternalKey);
      const serviceId = doctorId ? servicioDe.get(doctorId) : null;
      if (!doctorId || !serviceId) {
        skipped.push(`${s.doctorExternalKey}|${s.startTimeIso}`);
        continue;
      }
      deseados.set(`${doctorId}|${new Date(s.startTimeIso).toISOString()}`, {
        doctorId,
        serviceId,
        start: new Date(s.startTimeIso),
        end: new Date(s.endTimeIso),
        occupied: s.occupied,
      });
    }

    const existentes = await this.prisma.scheduleSlot.findMany({
      where: {
        organizationId,
        doctorId: { in: [...agenIAIdDe.values()] },
        startTime: { gte: from, lt: to },
      },
      select: {
        id: true,
        doctorId: true,
        startTime: true,
        endTime: true,
        isAvailable: true,
        // Dos preguntas distintas sobre el mismo cupo:
        //  · ¿tiene una cita VIVA? → no se puede liberar ni borrar: hay un
        //    paciente contando con esa hora.
        //  · ¿tiene CUALQUIER cita, aunque esté cancelada? → no se puede
        //    BORRAR: la fila cancelada es historia clínica y la llave foránea
        //    la sostiene. Se puede cerrar, pero no eliminar.
        appointments: {
          select: {
            id: true,
            status: true,
            origin: true,
            patientId: true,
            epsId: true,
          },
        },
      },
    });
    const existentePorClave = new Map(
      existentes.map((e) => [`${e.doctorId}|${e.startTime.toISOString()}`, e]),
    );

    // 🏥 Intervalos ocupados por citas VIVAS, por médico. Una cita del hospital
    // puede no coincidir con la rejilla (otra duración, otro desfase: AgenIA le
    // crea un cupo a la medida), y entonces tapa a los cupos vecinos que se
    // cruzan con ella. Sin esto, cada pasada volvía a liberar esos vecinos —el
    // HIS no tiene cita a ESA hora exacta— y el bot podía vender 14:50 encima
    // de una cita de 15:00 a 15:30.
    const ocupadosPorMedico = new Map<
      string,
      { clave: string; inicio: number; fin: number }[]
    >();
    for (const e of existentes) {
      if (!e.appointments.some((a) => a.status !== 'CANCELLED')) continue;
      const lista = ocupadosPorMedico.get(e.doctorId) ?? [];
      lista.push({
        clave: `${e.doctorId}|${e.startTime.toISOString()}`,
        inicio: e.startTime.getTime(),
        fin: e.endTime.getTime(),
      });
      ocupadosPorMedico.set(e.doctorId, lista);
    }
    const tapadoPorOtraCita = (
      clave: string,
      c: { doctorId: string; start: Date; end: Date },
    ) =>
      (ocupadosPorMedico.get(c.doctorId) ?? []).some(
        (o) =>
          o.clave !== clave &&
          o.inicio < c.end.getTime() &&
          c.start.getTime() < o.fin,
      );

    const aCrear: typeof deseados extends Map<string, infer V> ? V[] : never =
      [];
    const aOcupar: string[] = [];
    const aLiberar: string[] = [];
    const aBorrar: string[] = [];
    const aRetirar: string[] = [];
    // Cupos cuya hora de FIN quedó vieja (ver más abajo): id → fin correcto.
    const aReajustar: { id: string; end: Date }[] = [];
    const conflicts: string[] = [];

    for (const [clave, cupo] of deseados) {
      if (!cupo.occupied && tapadoPorOtraCita(clave, cupo))
        cupo.occupied = true;
      const actual = existentePorClave.get(clave);
      if (!actual) {
        aCrear.push(cupo);
        continue;
      }
      // Un cupo con cita viva en AgenIA jamás se marca disponible, diga lo que
      // diga el HIS: liberarlo sería revender una hora ya vendida.
      const tieneCitaViva = actual.appointments.some(
        (a) => a.status !== 'CANCELLED',
      );
      const deberiaEstarLibre = !cupo.occupied && !tieneCitaViva;
      if (deberiaEstarLibre && !actual.isAvailable) aLiberar.push(actual.id);
      if (!deberiaEstarLibre && actual.isAvailable) aOcupar.push(actual.id);

      // 🕒 El cupo se empareja por hora de INICIO, así que su FIN nunca se
      // revisaba: cuando una agenda cambió de duración (91-1, 91-2, PS06, PS08
      // pasaron de 20 a 30 min; HO02-04 a 40 el 2026-10-06), los cupos cuyo
      // inicio coincidía en las dos rejillas se quedaron con 20 min —cerca de la
      // mitad de los futuros de esos médicos—. Con el envío al hospital
      // encendido, una cita del panel en uno de ellos habría viajado al HIS
      // con 20 min y la revisión de cruces habría medido corto. Se corrige con
      // el fin que da el hospital. Solo sin cita viva: la duración de una cita
      // ya agendada es la de esa cita, no la de la rejilla.
      if (!tieneCitaViva && actual.endTime.getTime() !== cupo.end.getTime()) {
        aReajustar.push({ id: actual.id, end: cupo.end });
      }
    }

    // 🗓️ Médicos con algún cupo del hospital en esta ventana (2026-10-29). El
    // agente manda TODOS los cupos de cada turno, libres u ocupados: un médico sin
    // ninguno es un médico sin turno en la ventana (un día). El 30-oct el hospital
    // borró el turno de dos médicos con 20 citas vivas.
    const medicosConTurno = new Set(
      [...deseados.values()].map((c) => c.doctorId),
    );
    const ahora = new Date();
    const afectadas: CitaEnAgendaQuitada[] = [];
    const anotar = (
      cupo: (typeof existentes)[number],
      vivas: (typeof existentes)[number]['appointments'],
      motivo: MotivoAgendaQuitada,
    ) => {
      // Solo las que todavía no pasan: a esas el paciente aún puede ir.
      if (cupo.startTime.getTime() <= ahora.getTime()) return;
      for (const a of vivas) {
        afectadas.push({
          citaId: a.id,
          patientId: a.patientId,
          epsId: a.epsId,
          origen: a.origin,
          doctorId: cupo.doctorId,
          slotId: cupo.id,
          inicio: cupo.startTime,
          motivo,
        });
      }
    };

    for (const [clave, actual] of existentePorClave) {
      if (deseados.has(clave)) continue;

      // El hospital ya no tiene esa hora en su agenda.
      const vivas = actual.appointments.filter((a) => a.status !== 'CANCELLED');
      const sinTurno = !medicosConTurno.has(actual.doctorId);

      // 🏥 Cupo de una cita DEL HOSPITAL fuera de la rejilla de turnos: no es un
      // sobrante ni un conflicto — el hospital tiene esa cita y la maneja él (si la
      // cancela, llega como cancelación). Se deja tal cual y sin caso, aunque el
      // médico no tenga turno ese día (2026-10-29): el hospital borra el turno de un
      // día ya lleno para cerrar la agenda, y guarda cupos con citas «temporales»
      // fuera de los turnos. AgenIA responde por las citas que ella agendó.
      if (vivas.length > 0 && vivas.every((a) => a.origin === 'MIRROR')) {
        continue;
      }

      if (vivas.length > 0) {
        // Hay un paciente con cita a una hora en la que su médico ya no
        // atiende. No es un cupo sobrante: es un problema para una persona.
        conflicts.push(clave);
        anotar(actual, vivas, sinTurno ? 'DIA_SIN_TURNO' : 'HORA_QUITADA');
        continue;
      }

      // 🚨 Un cupo con citas CANCELADAS no se puede borrar: la fila cancelada
      // es historia clínica y `Appointment_scheduleSlotId_fkey` la sostiene.
      // Intentarlo reventaba la transacción entera con un error de llave
      // foránea — y como el error subía, se llevaba por delante el resto del
      // barrido: los otros 399 días no se sincronizaban. La agenda se quedó
      // desalineada casi media hora sin que nada lo dijera.
      //
      // Cerrarlo consigue lo que importa —que AgenIA no ofrezca una hora que
      // el hospital no tiene— sin tocar la historia.
      if (actual.appointments.length > 0) {
        if (actual.isAvailable) aRetirar.push(actual.id);
        continue;
      }

      aBorrar.push(actual.id);
    }

    const resumen: AvailabilityResult = {
      mode,
      created: aCrear.length,
      updated: aOcupar.length + aLiberar.length,
      removed: aBorrar.length,
      retired: aRetirar.length,
      resized: aReajustar.length,
      skipped,
      conflicts,
    };

    if (mode === 'SHADOW') {
      this.logger.log(
        `Agenda (modo sombra, org ${organizationId}, ${input.fromIso.slice(0, 10)}): ` +
          `crearía ${resumen.created}, actualizaría ${resumen.updated}, ` +
          `borraría ${resumen.removed}, corregiría la hora de fin de ` +
          `${aReajustar.length}. Sin escribir nada.`,
      );
      await this.registrar(organizationId, input, resumen);
      return resumen;
    }

    await this.prisma.$transaction(async (tx) => {
      // Anti-eco: estos cambios nacen del HIS y no deben volver a él.
      await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);

      if (aCrear.length > 0) {
        await tx.scheduleSlot.createMany({
          data: aCrear.map((c) => ({
            organizationId,
            doctorId: c.doctorId,
            serviceId: c.serviceId,
            startTime: c.start,
            endTime: c.end,
            isAvailable: !c.occupied,
          })),
          skipDuplicates: true,
        });
      }
      if (aOcupar.length > 0) {
        await tx.scheduleSlot.updateMany({
          where: { id: { in: aOcupar } },
          data: { isAvailable: false },
        });
      }
      if (aLiberar.length > 0) {
        await tx.scheduleSlot.updateMany({
          where: { id: { in: aLiberar } },
          data: { isAvailable: true },
        });
      }
      if (aRetirar.length > 0) {
        await tx.scheduleSlot.updateMany({
          where: { id: { in: aRetirar } },
          data: { isAvailable: false },
        });
      }
      if (aBorrar.length > 0) {
        await tx.scheduleSlot.deleteMany({ where: { id: { in: aBorrar } } });
      }
      // Uno por uno: cada cupo tiene su propio fin. Solo el primer barrido
      // completo después de un cambio de duración tiene trabajo aquí (~10 por
      // día); los demás no hacen ninguna consulta de más.
      for (const { id, end } of aReajustar) {
        await tx.scheduleSlot.update({
          where: { id },
          data: { endTime: end },
        });
      }
    });

    if (conflicts.length > 0) {
      this.logger.error(
        `🚨 Agenda (org ${organizationId}): ${conflicts.length} cita(s) de AgenIA ` +
          `están en horas que el hospital ya NO tiene en su agenda. No se tocaron. ` +
          `${conflicts.slice(0, 5).join(', ')}.`,
      );
    }
    if (skipped.length > 0) {
      this.logger.warn(
        `Agenda (org ${organizationId}): ${skipped.length} cupo(s) del HIS ignorados ` +
          `(${fueraDeVentana} fuera de la ventana declarada, el resto por médico ` +
          `sin homologar o sin servicio asignado).`,
      );
    }

    await this.casosDeAgendaQuitada(organizationId, from, to, afectadas, ahora);

    await this.registrar(organizationId, input, resumen);
    return resumen;
  }

  /**
   * 🗓️ Un caso en la Bandeja por cada cita vigente fuera de la agenda del
   * hospital (2026-10-29), con el paciente, la hora y por qué. Antes quedaba solo
   * un caso general sin nombres. Los de esta ventana que ya no aparecen —la hora
   * volvió a la agenda, o la cita se anuló o se movió— se cierran solos. Mientras
   * uno esté abierto, la base no deja volver a abrir el cupo de esa cita
   * (`fn_cupo_en_agenda_quitada`): si la cita se anula, ese cupo no se ofrece.
   *
   * Nunca lanza: la agenda ya se aplicó, y un caso que falte se abre en la
   * siguiente lectura.
   */
  private async casosDeAgendaQuitada(
    organizationId: string,
    from: Date,
    to: Date,
    afectadas: CitaEnAgendaQuitada[],
    ahora: Date,
  ): Promise<void> {
    if (!this.exceptions) return;
    try {
      const vigentes = new Set<string>();
      for (const a of afectadas) {
        const dedupeKey = claveExcepcion.agendaQuitada(a.citaId);
        vigentes.add(dedupeKey);
        const minutos = Math.floor(
          (a.inicio.getTime() - ahora.getTime()) / 60_000,
        );
        await this.exceptions.registrar(
          organizationId,
          {
            kind: 'CITA_EN_AGENDA_QUITADA',
            dedupeKey,
            severity: severidadPorCercania('ALTA', minutos),
            title: TITULO_EXCEPCION.CITA_EN_AGENDA_QUITADA,
            detail:
              a.motivo === 'DIA_SIN_TURNO'
                ? `El médico no tiene turno ese día en el hospital (cupo ${a.slotId}).`
                : `Esa hora ya no está en el turno del médico (cupo ${a.slotId}).`,
            appointmentId: a.citaId,
            patientId: a.patientId,
            entityType: 'APPOINTMENT',
            entityId: a.citaId,
            epsId: a.epsId,
            doctorId: a.doctorId,
            appointmentStartAt: a.inicio,
            meta: { motivo: a.motivo, origen: a.origen },
          },
          ahora,
        );
      }

      const activas = await this.prisma.syncException.findMany({
        where: {
          organizationId,
          kind: 'CITA_EN_AGENDA_QUITADA',
          status: { in: ESTADOS_ACTIVOS_CASO },
          appointmentStartAt: { gte: from, lt: to },
        },
        select: { id: true, dedupeKey: true, meta: true },
      });
      for (const c of activas) {
        if (vigentes.has(c.dedupeKey)) continue;
        const delHospital =
          !!c.meta &&
          typeof c.meta === 'object' &&
          (c.meta as Record<string, unknown>).origen === 'MIRROR';
        await this.exceptions.autoResolver(
          organizationId,
          c.id,
          delHospital
            ? 'Cita agendada en el hospital: AgenIA ya no abre casos por los cambios de agenda en las citas del hospital (las maneja el hospital).'
            : 'La hora volvió a la agenda del hospital, o la cita ya no está vigente.',
          ahora,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        `Agenda (org ${organizationId}): no se pudieron abrir o cerrar los casos de citas fuera de la agenda: ${getErrorMessage(error)}`,
      );
    }
  }

  /** Deja rastro de cada pasada, coincida o no: sin él no hay forma de saber si corrió. */
  private async registrar(
    organizationId: string,
    input: AvailabilityInput,
    resumen: AvailabilityResult,
  ): Promise<void> {
    await this.prisma.syncAudit.create({
      data: {
        organizationId,
        direction: SYNC_AUDIT_DIRECTION.HIS_TO_AGENIA,
        entityType: 'SLOT',
        op: 'AVAILABILITY',
        outcome: resumen.conflicts.length > 0 ? 'CONFLICT' : 'OK',
        detail: JSON.stringify({
          window: { fromIso: input.fromIso, toIso: input.toIso },
          ...resumen,
          skipped: resumen.skipped.slice(0, 20),
          conflicts: resumen.conflicts.slice(0, 20),
        }).slice(0, 4000),
      },
    });
  }
}
