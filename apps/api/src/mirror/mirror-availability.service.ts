import { Injectable, Logger } from '@nestjs/common';
import type { AvailabilityInput, AvailabilityResult } from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';

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

  constructor(private readonly prisma: PrismaService) {}

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
        isAvailable: true,
        // Dos preguntas distintas sobre el mismo cupo:
        //  · ¿tiene una cita VIVA? → no se puede liberar ni borrar: hay un
        //    paciente contando con esa hora.
        //  · ¿tiene CUALQUIER cita, aunque esté cancelada? → no se puede
        //    BORRAR: la fila cancelada es historia clínica y la llave foránea
        //    la sostiene. Se puede cerrar, pero no eliminar.
        appointments: { select: { id: true, status: true } },
      },
    });
    const existentePorClave = new Map(
      existentes.map((e) => [`${e.doctorId}|${e.startTime.toISOString()}`, e]),
    );

    const aCrear: typeof deseados extends Map<string, infer V> ? V[] : never =
      [];
    const aOcupar: string[] = [];
    const aLiberar: string[] = [];
    const aBorrar: string[] = [];
    const aRetirar: string[] = [];
    const conflicts: string[] = [];

    for (const [clave, cupo] of deseados) {
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
    }

    for (const [clave, actual] of existentePorClave) {
      if (deseados.has(clave)) continue;

      // El hospital ya no tiene esa hora en su agenda.
      if (actual.appointments.some((a) => a.status !== 'CANCELLED')) {
        // Hay un paciente con cita a una hora en la que su médico ya no
        // atiende. No es un cupo sobrante: es un problema para una persona.
        conflicts.push(clave);
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
      skipped,
      conflicts,
    };

    if (mode === 'SHADOW') {
      this.logger.log(
        `Agenda (modo sombra, org ${organizationId}, ${input.fromIso.slice(0, 10)}): ` +
          `crearía ${resumen.created}, actualizaría ${resumen.updated}, ` +
          `borraría ${resumen.removed}. Sin escribir nada.`,
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

    await this.registrar(organizationId, input, resumen);
    return resumen;
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
        direction: 'HIS_TO_AGENIA',
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
