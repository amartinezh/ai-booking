import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { doctorLabel } from '../common/doctor-label.util';
import {
  LimiteCitasService,
  type LimiteDelPaciente,
} from './limite-citas.service';
import { Prisma, AttendanceStatus } from '@agenia/database';
import {
  CUPOS_OFRECIDOS,
  cupoBloqueado,
  diaLocal,
  primerDiaParaVerElCupo,
  ultimoDiaParaAgendar,
  cumpleAnticipacionAlReservar,
  intervalosBloqueados,
  documentoSinCerosIniciales,
  inicioMinimoParaOfrecer,
  faltaRegimenParaElEspejo,
  regimenSeguroDelPadron,
  type Regimen,
  normalizarCuposOfrecidos,
  seleccionarCuposManianaTarde,
} from '@agenia/shared';
import {
  bloqueosDeLaClinica,
  cupoBloqueadoParaElAsistente,
} from './bloqueos-agenda';
import {
  finDelPlazoDelAsistente,
  fueraDelPlazoParaElAsistente,
  plazoDeLaClinica,
} from './plazo-agendar';

/**
 * Hasta cuándo se convierten los días sin citas en tramos para la consulta
 * cuando no hay ventana de fecha. Más allá, el filtro de después los cubre.
 */
const HORIZONTE_BLOQUEOS_MS = 180 * 24 * 60 * 60 * 1000;

/** Forma reducida de un cupo que `getAvailableSlots` le entrega al chatbot. */
export interface AvailableSlot {
  slotId: string;
  fecha: Date;
  doctor: string;
  servicio: string;
}

/**
 * Una combinación EPS+régimen sin convenio de facturación en el HIS — ver el
 * comentario de `HospitalMirrorConfig.blockedEpsRegimeCombos` en el schema.
 * Por NOMBRE de EPS, no por NIT (los NIT de este mapeo estuvieron cruzados
 * una vez, MAPEO_HIS.md §2.3).
 */
interface BlockedEpsRegimeCombo {
  epsName: string;
  regime: string;
}

/** Lo lanza la transacción de la reserva para devolver el detalle del límite. */
class LimiteCitasSuperadoError extends Error {
  constructor(readonly limite: LimiteDelPaciente) {
    super('PATIENT_LIMIT_REACHED');
  }
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private prisma: PrismaService,
    // 🚦 Límite de citas por paciente (solo reservas del bot). Opcional: sin él
    // (pruebas que arman el servicio a mano) la reserva no lo aplica.
    @Optional() private readonly limiteCitas?: LimiteCitasService,
  ) {}

  // 1. LÓGICA DE BÚSQUEDA H.I.S
  // `organizationId` es OBLIGATORIO: con el parámetro opcional, un caller que
  // lo omitiera generaba `where: { organizationId: undefined }`, que Prisma
  // interpreta como "sin filtro" y devolvía cupos de TODAS las clínicas.
  async getAvailableSlots(
    serviceName: string,
    epsId: string | null,
    organizationId: string,
    // Ventana de fecha preferida por el paciente ("mañana", "el lunes"...).
    // Opcional: sin ella, la consulta es idéntica a la histórica (próximos cupos).
    dateWindow?: { desde: Date; hasta: Date } | null,
    // `todos`: devuelve la bolsa completa de próximos cupos, sin recortar a
    // los que se ofrecen. Solo para casar una hora dicha por voz ("mañana a
    // las 3"): esa hora puede no estar entre los ofrecidos y aun así existir.
    // `ignorarPlazo`: sin el plazo máximo para agendar. Solo para decirle al
    // paciente desde cuándo verá un cupo (`cupoMasAllaDelPlazo`); nunca para
    // ofrecerlo.
    opts: { todos?: boolean; ignorarPlazo?: boolean } = {},
  ): Promise<AvailableSlot[]> {
    // ⏱️ Nada que empiece antes de la anticipación mínima (60 min, 2026-10-21):
    // antes se ofrecían los más próximos, y a las 06:00 salía el de las 06:30.
    // Con ventana ("hoy", "mañana"), acotamos a [max(desde, mínimo) .. hasta].
    const ahora = new Date();
    const minimo = inicioMinimoParaOfrecer(ahora);
    const startTimeFilter: { gte: Date; lte?: Date; lt?: Date } = dateWindow
      ? {
          gte: dateWindow.desde > minimo ? dateWindow.desde : minimo,
          lte: dateWindow.hasta,
        }
      : { gte: minimo };

    // 🗓️ Plazo máximo para agendar (Configuración › Asistente Virtual,
    // 2026-10-23): con 3 días, solo citas de hoy, mañana y pasado mañana. Sin
    // límite (lo de siempre), la consulta no cambia. Una fecha pedida más allá
    // del plazo no trae cupos y el chatbot ofrece los más próximos.
    const finDelPlazo = opts.ignorarPlazo
      ? null
      : await finDelPlazoDelAsistente(this.prisma, organizationId, ahora);
    if (finDelPlazo) startTimeFilter.lt = finDelPlazo;

    // 🚦 ACTIVACIÓN POR MÉDICO. `whatsappBookingEnabled` existía en el schema
    // desde la Fase 1 del espejo pero NO SE LEÍA EN NINGÚN SITIO: era una
    // columna muerta, y la activación gradual médico por médico que el
    // hospital pidió (plan §5.4) simplemente no existía — todo médico en la
    // base era reservable desde el momento en que se creaba. El default sigue
    // siendo `true`, así que para una clínica sin espejo esto no cambia nada.
    const doctorFilter = await this.buildDoctorFilter(organizationId);

    // 📅 Días y horas sin citas (Configuración › Días sin citas, 2026-10-22): el
    // asistente no ofrece citas que empiecen en ellos. Se quitan en la consulta
    // misma —si no, un sábado lleno se comería la bolsa de cupos— y otra vez
    // abajo, por si alguno queda fuera del horizonte.
    const bloqueos = await bloqueosDeLaClinica(this.prisma, organizationId);
    const tramos = intervalosBloqueados(
      bloqueos.reglas,
      startTimeFilter.gte,
      startTimeFilter.lte ??
        finDelPlazo ??
        new Date(startTimeFilter.gte.getTime() + HORIZONTE_BLOQUEOS_MS),
      bloqueos.timeZone,
    );

    const [rawSlots, org] = await Promise.all([
      this.prisma.scheduleSlot.findMany({
        where: {
          organizationId: organizationId, // 🏢 AISLAMIENTO DE TENANT
          isAvailable: true,
          startTime: startTimeFilter,
          service: {
            name: { contains: serviceName, mode: 'insensitive' },
          },
          doctor: doctorFilter,
          // Filtro clave: El slot debe ser universal (null) o ser exclusivo para la EPS del paciente
          OR: [{ allowedEpsId: null }, { allowedEpsId: epsId }],
          ...(tramos.length > 0
            ? {
                NOT: tramos.map((t) => ({
                  startTime: { gte: t.gte, lt: t.lt },
                })),
              }
            : {}),
        },
        include: { doctor: true, service: true },
        orderBy: { startTime: 'asc' },
        // Una bolsa amplia de próximos cupos para poder elegir entre mañana y
        // tarde: los 10 primeros de una agenda llena caían todos en la misma
        // mañana. Lo que se ofrece se recorta abajo.
        take: CUPOS_OFRECIDOS.POOL,
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          timezone: true,
          settings: { select: { slotsOfferedCount: true } },
        },
      }),
    ]);

    // Mapeamos para que Gemini lo pueda entender fácil
    const slots = rawSlots
      .filter(
        (slot) =>
          !cupoBloqueado(slot.startTime, bloqueos.reglas, bloqueos.timeZone),
      )
      .map((slot) => ({
        slotId: slot.id,
        fecha: slot.startTime,
        // Ya formateado para el paciente: el honorífico depende de si el
        // perfil es una persona o una agenda funcional del hospital.
        doctor: doctorLabel(slot.doctor),
        servicio: slot.service.name,
      }));
    if (opts.todos) return slots;

    // Cuántos ofrece lo decide la clínica (OrganizationSettings), repartidos
    // mitad mañana y mitad tarde en SU zona horaria.
    return seleccionarCuposManianaTarde(
      slots,
      normalizarCuposOfrecidos(org?.settings?.slotsOfferedCount),
      { timeZone: org?.timezone ?? undefined },
    );
  }

  /**
   * 🗓️ No hay cupos dentro del plazo máximo para agendar, pero sí más adelante
   * (2026-10-23: con 2 días un viernes, el asistente le decía «la agenda está
   * completa por estos días» a quien tenía 19 cupos el lunes). Hasta qué día se
   * agenda, el día del primer cupo libre y desde qué día lo verá el paciente
   * ('YYYY-MM-DD', en la zona de la clínica). null sin plazo, o si tampoco hay
   * cupos más adelante: entonces la agenda sí está llena.
   */
  async cupoMasAllaDelPlazo(
    serviceName: string,
    epsId: string | null,
    organizationId: string,
  ): Promise<{ ultimoDia: string; primerDia: string; desde: string } | null> {
    const plazo = await plazoDeLaClinica(this.prisma, organizationId);
    if (!plazo) return null;
    const [primero] = await this.getAvailableSlots(
      serviceName,
      epsId,
      organizationId,
      null,
      { todos: true, ignorarPlazo: true },
    );
    if (!primero) return null;
    const ahora = new Date();
    const hoy = diaLocal(ahora, plazo.timeZone);
    const ultimoDia = ultimoDiaParaAgendar(hoy, plazo.dias);
    const primerDia = diaLocal(primero.fecha, plazo.timeZone);
    if (!ultimoDia || primerDia <= ultimoDia) return null;
    return {
      ultimoDia,
      primerDia,
      desde: primerDiaParaVerElCupo(primerDia, plazo.dias),
    };
  }

  /**
   * Qué médicos pueden recibir reservas por WhatsApp en esta organización.
   *
   * Dos condiciones, y la segunda solo aplica con espejo:
   *
   * 1. **`whatsappBookingEnabled`** — el interruptor comercial. El hospital
   *    activa médico por médico al ritmo que decida su piloto, y puede
   *    apagarlos sin tocar la agenda.
   *
   * 2. **Homologado con el HIS** — el interruptor técnico. Si la organización
   *    tiene espejo activo y el médico no está en `MirrorEntityMap`, su cita
   *    NUNCA podrá escribirse en el HIS: se quedaría rebotando hasta
   *    dead-letter y el hospital no la vería jamás. Ofrecer ese cupo es
   *    prometerle al paciente una cita que no va a existir, así que no se
   *    ofrece. Es la misma sobreventa que encontró la prueba de punta a
   *    punta, vista desde el otro lado.
   *
   * Sin espejo la condición 2 no se evalúa y la consulta queda igual que
   * siempre — una clínica normal no sabe qué es una homologación.
   */
  private async buildDoctorFilter(
    organizationId: string,
  ): Promise<Prisma.DoctorProfileWhereInput> {
    const base: Prisma.DoctorProfileWhereInput = {
      whatsappBookingEnabled: true,
    };

    const espejo = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: { enabled: true },
    });
    if (!espejo?.enabled) return base;

    const homologados = await this.prisma.mirrorEntityMap.findMany({
      where: { organizationId, entityType: 'DOCTOR' },
      select: { agenIAId: true },
    });

    return { ...base, id: { in: homologados.map((m) => m.agenIAId) } };
  }

  /**
   * El régimen del padrón para agendar a este documento con `epsId`, solo si no hay
   * NINGUNA duda (`regimenSeguroDelPadron`): una sola EPS en el padrón, la misma de
   * la cita, y un solo régimen. Si no, null: el bot se lo pregunta al paciente.
   *
   * Se busca por el documento tal cual y sin ceros a la izquierda, como el resto del
   * padrón. `db` permite leerlo dentro de la transacción de la reserva.
   */
  async regimenDelPadron(
    organizationId: string,
    cedula: string,
    epsId: string | null,
    db: Pick<Prisma.TransactionClient, 'epsEnrolledPatient'> = this.prisma,
  ): Promise<Regimen | null> {
    if (!epsId || !cedula) return null;
    const filas = await db.epsEnrolledPatient.findMany({
      where: {
        organizationId,
        isActive: true,
        cedula: {
          in: [...new Set([cedula, documentoSinCerosIniciales(cedula)])],
        },
      },
      select: { epsId: true, regime: true },
      take: 10,
    });
    return regimenSeguroDelPadron(filas, epsId);
  }

  // 2. LÓGICA DE TRANSACCIÓN
  // `organizationId` es OBLIGATORIO: el chequeo de tenant del slot ya no es
  // condicional — sin él, un slotId de otra clínica se podía reservar.
  async bookAppointment(
    patientId: string,
    scheduleSlotId: string,
    epsId: string | null,
    // TELEGRAM se trata igual que WHATSAPP: solo MIRROR se salta el
    // interruptor del médico y el chequeo de convenio (docs/PLAN_TELEGRAM.md).
    origin: 'WHATSAPP' | 'MANUAL' | 'MIRROR' | 'TELEGRAM',
    organizationId: string,
    /**
     * Solo MIRROR: el cupo ya lo cerró el barrido de agenda o la reconciliación
     * por ESTA misma cita del HIS, que llega segundos después. Se acepta cerrado;
     * la llave única parcial `uq_appointment_cupo_vigente` sigue impidiendo dos
     * citas vigentes en el mismo cupo.
     */
    opts: { cupoCerradoPorElHis?: boolean } = {},
  ): Promise<{
    success: boolean;
    message?: string;
    appointmentId?: string;
    /**
     * Motivo del fallo, para que el llamador elija el mensaje al paciente.
     * El texto vive en el pool de MSGS (que tiene estilos de comunicación por
     * clínica), no aquí: este servicio no debería estar redactando WhatsApp.
     */
    reason?:
      | 'SLOT_TAKEN'
      | 'DOCTOR_NOT_BOOKABLE'
      | 'EPS_REGIME_NOT_BILLABLE'
      | 'PATIENT_REGIME_MISSING'
      | 'PATIENT_LIMIT_REACHED';
    /** Solo con `PATIENT_LIMIT_REACHED`: qué límite y cuántas citas tenía. */
    limite?: LimiteDelPaciente;
  }> {
    try {
      let appointmentId: string | undefined;
      await this.prisma.$transaction(async (tx) => {
        // 🪞 ANTI-ECO ESPEJO: cuando esta cita la origina el módulo mirror
        // (una cita creada/reflejada desde el HIS de un hospital), marcamos
        // la transacción para que el trigger fn_sync_outbox() registre el
        // evento con origin='MIRROR' — el dispatcher del mirror no lo
        // reenvía de vuelta al HIS que lo originó. Ver PLAN_ESPEJO_HOSPITAL.md
        // §5.1b. `SET LOCAL` solo dura mientras dure esta transacción.
        if (origin === 'MIRROR') {
          await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);
        }

        const slot = await tx.scheduleSlot.findUnique({
          where: { id: scheduleSlotId },
          include: { doctor: { select: { whatsappBookingEnabled: true } } },
        });

        // `!slot.doctor` no deberia pasar nunca: `doctorId` es NOT NULL con FK
        // y la consulta lo incluye. Si aun asi falta, el cupo esta corrupto y
        // se trata como invalido — fallar cerrado, no reservar a ciegas.
        const aceptaCerrado =
          origin === 'MIRROR' && opts.cupoCerradoPorElHis === true;
        if (
          !slot ||
          !slot.doctor ||
          (!slot.isAvailable && !aceptaCerrado) ||
          slot.organizationId !== organizationId
        ) {
          throw new Error('SLOT_TAKEN_OR_INVALID');
        }

        // 🚦 Revalidación del interruptor del médico, aquí y no solo al
        // ofrecer el cupo. Entre que el paciente ve el menú y responde "SÍ"
        // pasan minutos: al hospital le basta con apagar a un médico en ese
        // rato para que la reserva ya no deba entrar. Sin esto, el filtro de
        // `getAvailableSlots` era una sugerencia, no una regla.
        //
        // Las citas de origen MIRROR se saltan el chequeo a propósito: vienen
        // del HIS, que es la fuente de verdad de este hospital. Rechazar algo
        // que el hospital ya agendó dejaría los dos sistemas divergiendo, que
        // es exactamente lo que el espejo existe para evitar.
        if (origin !== 'MIRROR' && !slot.doctor.whatsappBookingEnabled) {
          throw new Error('DOCTOR_NOT_BOOKABLE');
        }
        // ⏱️ Anticipación mínima, también al reservar: entre la oferta y el «sí»
        // pudo pasar el tiempo. Solo el bot: el personal y el hospital agendan a
        // cualquier hora. Para el paciente es un cupo que ya no está: se le
        // ofrecen otros.
        if (
          (origin === 'WHATSAPP' || origin === 'TELEGRAM') &&
          !cumpleAnticipacionAlReservar(slot.startTime, new Date())
        ) {
          throw new Error('SLOT_TAKEN_OR_INVALID');
        }
        // 📅 Día u hora sin citas por el asistente: entre la oferta y el «sí»
        // el administrador pudo bloquearlo. Para el paciente es un cupo que ya
        // no está: se le ofrecen otros. Solo el bot.
        if (
          (origin === 'WHATSAPP' || origin === 'TELEGRAM') &&
          (await cupoBloqueadoParaElAsistente(
            tx,
            organizationId,
            slot.startTime,
          ))
        ) {
          throw new Error('SLOT_TAKEN_OR_INVALID');
        }
        // 🗓️ Ni más allá del plazo máximo para agendar: el administrador pudo
        // acortarlo entre la oferta y el «sí». Solo el bot.
        if (
          (origin === 'WHATSAPP' || origin === 'TELEGRAM') &&
          (await fueraDelPlazoParaElAsistente(
            tx,
            organizationId,
            slot.startTime,
          ))
        ) {
          throw new Error('SLOT_TAKEN_OR_INVALID');
        }

        // 🚦 LÍMITE DE CITAS POR PACIENTE: el bot no le asigna a un paciente
        // más citas de las que la clínica permite el mismo día o el mismo mes
        // (/dashboard/limites-citas). El chatbot ya lo revisa antes de pedir
        // datos; esta es la palabra final, dentro de la transacción, y cubre
        // también el cupo que ofrece la lista de espera. Solo el bot: MANUAL
        // (el personal) y MIRROR (el hospital) no tienen límite. Va antes de
        // las reglas de EPS para no preguntarle el régimen a quien de todos
        // modos no va a poder agendar.
        if (
          (origin === 'WHATSAPP' || origin === 'TELEGRAM') &&
          this.limiteCitas
        ) {
          const paciente = await tx.patientProfile.findUnique({
            where: { id: patientId },
            select: { cedula: true },
          });
          const superado = paciente
            ? await this.limiteCitas.evaluar(
                {
                  organizationId,
                  cedula: paciente.cedula,
                  fecha: slot.startTime,
                },
                tx,
              )
            : null;
          if (superado) throw new LimiteCitasSuperadoError(superado);
        }

        // 🧾 EPS+régimen sin convenio de facturación en el HIS. Antes esto
        // solo lo detectaba `resolveConvenio` en el mirror-agent, AL ESCRIBIR
        // la cita — es decir, después de que WhatsApp ya le dijo "confirmada"
        // al paciente. La cita moría en dead-letter y nadie se enteraba hasta
        // revisar la cola (caso real: Nueva EPS contributivo, ver ESTADO.md
        // del driver cnt-sanvicente-anserma). Se repite aquí, ANTES de
        // reservar el cupo, para poder decir que no en vez de mentir.
        //
        // Las citas MIRROR se saltan el chequeo por la misma razón que el
        // interruptor del médico: vienen del HIS, que ya las facturó.
        // Sin EPS (particular) tampoco aplica: no hay convenio que buscar.
        if (origin !== 'MIRROR' && epsId) {
          const [eps, patient, mirrorConfig] = await Promise.all([
            tx.eps.findUnique({
              where: { id: epsId },
              select: { name: true, nit: true },
            }),
            tx.patientProfile.findUnique({
              where: { id: patientId },
              select: { regime: true, cedula: true },
            }),
            tx.hospitalMirrorConfig.findUnique({
              where: { organizationId },
              select: { enabled: true, blockedEpsRegimeCombos: true },
            }),
          ]);

          // 🧾 Sin régimen no hay convenio, y sin convenio el agente rechaza la
          // cita diez veces y se rinde: el hospital nunca la tiene mientras el
          // paciente cree tenerla (caso real del 2026-09-26, un paciente que ya
          // existía sin régimen). Se frena ANTES de reservar, con la misma regla
          // del driver, para que quien llama pida el dato en vez de confirmar.
          if (
            faltaRegimenParaElEspejo({
              espejoActivo: !!mirrorConfig?.enabled,
              epsNit: eps?.nit,
              regimen: patient?.regime,
            })
          ) {
            // Última oportunidad antes de frenar: si el padrón de ESA EPS lo dice
            // sin ninguna duda, se completa la ficha y la reserva sigue. Cubre todo
            // camino que llegue aquí (lista de espera incluida) sin preguntar lo que
            // ya se sabe. Con cualquier duda, se frena y quien llama pregunta.
            const delPadron = patient
              ? await this.regimenDelPadron(
                  organizationId,
                  patient.cedula,
                  epsId,
                  tx,
                )
              : null;
            if (!delPadron) throw new Error('PATIENT_REGIME_MISSING');
            await tx.patientProfile.update({
              where: { id: patientId },
              data: { regime: delPadron },
            });
            // Para el chequeo de combinaciones bloqueadas de abajo.
            patient!.regime = delPadron;
          }

          const bloqueadas =
            (mirrorConfig?.blockedEpsRegimeCombos as
              | BlockedEpsRegimeCombo[]
              | null) ?? [];

          if (
            eps &&
            patient?.regime &&
            bloqueadas.some(
              (b) => b.epsName === eps.name && b.regime === patient.regime,
            )
          ) {
            throw new Error('EPS_REGIME_NOT_BILLABLE');
          }
        }

        // 2. Marcar slot como Ocupado
        await tx.scheduleSlot.update({
          where: { id: scheduleSlotId },
          data: { isAvailable: false },
        });

        // 3. Crear el record de Cita conectado al Slot
        const appointment = await tx.appointment.create({
          data: {
            scheduleSlotId,
            patientId,
            epsId,
            origin,
            organizationId, // 🏢 TENANT ISOLATION (ya validado contra el slot)
          },
        });
        appointmentId = appointment.id;
      });

      return { success: true, appointmentId };
    } catch (error: unknown) {
      // El catch atrapa la colisión de cupo, sea cual sea su forma:
      //   - 'SLOT_TAKEN_OR_INVALID': lo lanzamos arriba cuando el slot ya no está
      //     disponible / no existe / es de otro tenant (caso MÁS común: el paciente
      //     confirma segundos después de que otro ganó el cupo).
      //   - 'SLOT_TAKEN': alias histórico conservado por compatibilidad.
      //   - P2002: choque del @unique de scheduleSlotId (dos reservas simultáneas).
      // Sin incluir 'SLOT_TAKEN_OR_INVALID' aquí, el error se relanzaba, el paciente
      // no recibía respuesta y quedaba atascado en AWAITING_CONFIRMATION.
      // El médico dejó de aceptar reservas por WhatsApp mientras el paciente
      // decidía. No es una colisión de cupo: el horario sigue libre, pero ya
      // no por este canal. Merece su propio mensaje, no el de "se lo llevó
      // otro paciente", que sería mentira.
      const message = error instanceof Error ? error.message : undefined;

      if (error instanceof LimiteCitasSuperadoError) {
        this.logger.warn(
          `Reserva frenada: el paciente ${patientId} ya tiene ${error.limite.citas} ` +
            `cita(s) en ${error.limite.periodo.clave} (límite ${error.limite.limite}).`,
        );
        return {
          success: false,
          reason: 'PATIENT_LIMIT_REACHED',
          limite: error.limite,
          message:
            'El paciente ya tiene el máximo de citas permitido para ese periodo.',
        };
      }

      if (message === 'DOCTOR_NOT_BOOKABLE') {
        this.logger.warn(
          `Reserva rechazada: el médico del cupo ${scheduleSlotId} ya no acepta reservas por WhatsApp.`,
        );
        return {
          success: false,
          reason: 'DOCTOR_NOT_BOOKABLE',
          message:
            'Ese horario dejó de estar disponible para agendamiento por este medio.',
        };
      }

      if (message === 'EPS_REGIME_NOT_BILLABLE') {
        this.logger.warn(
          `Reserva rechazada: EPS ${epsId} del paciente ${patientId} no tiene ` +
            `convenio de facturación para su régimen en esta organización.`,
        );
        return {
          success: false,
          reason: 'EPS_REGIME_NOT_BILLABLE',
          message:
            'Esa EPS no tiene convenio vigente para agendar por este medio con tu régimen.',
        };
      }

      if (message === 'PATIENT_REGIME_MISSING') {
        this.logger.warn(
          `Reserva frenada: el paciente ${patientId} declara EPS ${epsId} pero ` +
            `no tiene régimen, y sin él el espejo no puede elegir el convenio.`,
        );
        return {
          success: false,
          reason: 'PATIENT_REGIME_MISSING',
          message:
            'Falta el régimen del paciente para poder agendar con su EPS.',
        };
      }

      if (
        message === 'SLOT_TAKEN_OR_INVALID' ||
        message === 'SLOT_TAKEN' ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002')
      ) {
        this.logger.warn(
          `Colisión detectada: El slot ${scheduleSlotId} acaba de ser tomado.`,
        );
        return {
          success: false,
          reason: 'SLOT_TAKEN',
          message:
            'Lo sentimos, el horario acaba de ser reservado por otro paciente.',
        };
      }
      this.logger.error('Error crítico al guardar la cita', error);
      throw error;
    }
  }

  // 3. CONTROL DE ASISTENCIA
  // `organizationId` obligatorio: el controller solo admite roles clínicos,
  // que siempre traen tenant en el token.
  //
  // `opts.origen = 'MIRROR'`: la asistencia la marcó el HOSPITAL y llega por el
  // espejo. La escritura va en una transacción con `agenia.sync_origin =
  // 'MIRROR'` para que el disparador del outbox la registre como nacida en el
  // HIS (nace entregada) y no como un cambio de AgenIA que volvería al hospital
  // (anti-eco). Sin esto cada «atendida» del hospital dejaba un evento LOCAL en
  // la cola hacia el HIS (visto en producción el 2026-10-05).
  async updateAttendance(
    appointmentId: string,
    status: AttendanceStatus,
    organizationId: string,
    opts: { origen?: 'MIRROR' } = {},
  ) {
    // Verificamos antes para evitar NotFoundExceptions por isolation o seguridad
    const apt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
    });
    if (!apt)
      throw new Error('Cita no encontrada o no pertenece a tu Organización.');

    const actualizar = (db: Pick<PrismaService, 'appointment'>) =>
      db.appointment.update({
        where: { id: appointmentId },
        data: { attendanceStatus: status },
        include: {
          patient: true,
          scheduleSlot: { include: { doctor: true, service: true } },
        },
      });

    const updated =
      opts.origen === 'MIRROR'
        ? await this.prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              `SET LOCAL agenia.sync_origin = 'MIRROR'`,
            );
            return actualizar(tx);
          })
        : await actualizar(this.prisma);

    return {
      success: true,
      data: updated,
    };
  }
}
