import {
  Injectable,
  Logger,
  forwardRef,
  Inject,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  diaLocal,
  formatAppointmentLong,
  HORARIO_LABORAL_POR_DEFECTO,
  inicioMinimoParaOfrecer,
  isTelegramSender,
  minutoLocal,
  puedeAvisarAhora,
  type HorarioAvisos,
} from '@agenia/shared';
import { Prisma } from '@agenia/database';
import { cupoBloqueadoParaElAsistente } from '../appointments/bloqueos-agenda';
import { fueraDelPlazoParaElAsistente } from '../appointments/plazo-agendar';
import { cupoReservadoParaElHospital } from '../appointments/reserva-presencial';
import { ConfigService } from '@nestjs/config';
import { ChatbotService } from '../chatbot/chatbot.service';
import { cupoApartadoKey } from '../chatbot/chatbot.constants';
import { RedisService } from '../redis/redis.service';
import { getErrorMessage } from '../common/error-message.util';
import { AppointmentsService } from '../appointments/appointments.service';

/**
 * Lo que `notifyWaitlist` guarda en `WaitlistEntry.metadata` (columna `Json`)
 * al ofrecerle el cupo a un candidato. Se lee de vuelta en
 * `confirmFromWaitlist` y `expireStaleNotifications` para saber qué cupo
 * confirmar o a quién ofrecérselo después.
 */
interface WaitlistNotificationMetadata {
  pendingSlotId?: string;
  doctorName?: string;
  /** ISO 8601 — se reconstruye con `new Date(...)` al leerlo. */
  slotDate?: string;
  /**
   * La EPS del CUPO (null = cupo para cualquier EPS). Al reofrecerlo tras un NO o
   * un vencimiento se busca con esta, no con la del paciente que lo rechazó.
   */
  epsDelCupo?: string | null;
  /**
   * Cupos que dijo que NO o que no se pudieron tomar: no se le vuelven a ofrecer
   * (2026-10-31). Se conservan mientras sigue en la lista.
   */
  rechazados?: string[];
  /**
   * Días (`YYYY-MM-DD`, hora de la clínica) de los cupos a los que dijo que NO: ese
   * día no le sirve y no se le ofrece otro cupo del mismo día.
   */
  diasRechazados?: string[];
  /**
   * Ofertas seguidas que dejó vencer sin contestar (2026-11-03). Con
   * `OFERTAS_SIN_RESPUESTA_PARA_SALIR` sale de la lista; si contesta algo, vuelve a 0.
   */
  sinRespuesta?: number;
  /** La última oferta que dejó vencer: para atender su respuesta tardía. */
  ultimaOferta?: OfertaVencida;
  /** Por qué salió de la lista sin tomar un cupo de ella (`YA_TIENE_CITA`). */
  motivo?: string;
  /** La cita que consiguió por otro camino. */
  appointmentId?: string;
}

/** La oferta que venció sin respuesta (`WaitlistEntry.metadata.ultimaOferta`). */
interface OfertaVencida {
  slotId: string;
  /** ISO 8601. */
  slotDate: string;
  doctorName: string;
  epsDelCupo: string | null;
  /** ISO 8601: cuándo venció. */
  vencioIso: string;
}

/** `WaitlistEntry.metadata` es `Prisma.JsonValue`; esto valida la forma antes de usarla. */
function readWaitlistMetadata(metadata: unknown): WaitlistNotificationMetadata {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as WaitlistNotificationMetadata)
    : {};
}

/**
 * Quién de la lista puede recibir un cupo de esta EPS (2026-10-26).
 *
 *   · Cupo para cualquier EPS (`null`): cualquiera de la lista. Antes solo los que
 *     entraron sin EPS, y el asistente siempre anota la EPS: en Anserma, donde todos
 *     los cupos son para cualquier EPS, la lista de espera nunca le avisó a nadie.
 *   · Cupo de una EPS: los de esa EPS y los particulares, como siempre.
 */
function quienesPuedenTomarElCupo(
  epsDelCupo: string | null,
): Prisma.WaitlistEntryWhereInput {
  return epsDelCupo ? { OR: [{ epsId: null }, { epsId: epsDelCupo }] } : {};
}

/**
 * Lo que la entrada conserva mientras sigue esperando: los cupos y los días que ya
 * rechazó, y cuántas ofertas seguidas dejó vencer. Sin nada, la columna queda vacía
 * (como antes).
 */
function loQueConserva(
  m: WaitlistNotificationMetadata,
): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  const rechazados = m.rechazados ?? [];
  const diasRechazados = m.diasRechazados ?? [];
  const sinRespuesta = m.sinRespuesta ?? 0;
  if (
    rechazados.length === 0 &&
    diasRechazados.length === 0 &&
    sinRespuesta === 0
  ) {
    return Prisma.DbNull;
  }
  return {
    ...(rechazados.length > 0 ? { rechazados } : {}),
    ...(diasRechazados.length > 0 ? { diasRechazados } : {}),
    ...(sinRespuesta > 0 ? { sinRespuesta } : {}),
  };
}

/** `loQueConserva` como objeto, para sumarle campos (vacío si no hay nada). */
function conservadoComoObjeto(
  m: WaitlistNotificationMetadata,
): Prisma.InputJsonObject {
  const c = loQueConserva(m);
  return c === Prisma.DbNull ? {} : (c as Prisma.InputJsonObject);
}

/**
 * ⏳ Cuánto tiene para contestar una oferta (2026-11-03): 30 minutos si el cupo es
 * en menos de 12 horas (hay que moverlo rápido), 2 horas si es en 12 horas o más.
 * Del 28 de octubre al 2 de noviembre, 21 de 33 ofertas eran para cupos a 10-76
 * horas y 7 personas leyeron la oferta después de los 30 minutos; dos de ellas
 * contestaron «Sí» a los 76 y 93 minutos y ya no lo tuvieron. La plantilla de Meta
 * dice «30 minutos»: con un cupo lejano solo tiene más tiempo del prometido.
 *
 * 🏥 Con el mostrador del hospital trabajando, siempre 30 minutos (2026-11-10,
 * `HORARIO_DEL_MOSTRADOR`). El cupo apartado no aparece en el menú del chat, pero el
 * mostrador no lo ve apartado y lo agenda: el 10 de noviembre el hospital abrió la
 * agenda del miércoles de MD09 a las 7:52, la lista recibió 21 cupos apartados por 2
 * horas, y el mostrador agendó 16 entre las 7:55 y las 8:59 (la mitad en menos de
 * 30 minutos); la lista tomó 5 y el chat no vio ninguno. Las 2 horas quedan para
 * las ofertas de la noche, el domingo y los festivos, cuando nadie compite.
 */
export const PLAZO_PARA_CONTESTAR = {
  cercanoMin: 30,
  lejanoMin: 120,
  horasCupoLejano: 12,
} as const;

/**
 * 🏥 El horario del mostrador del hospital (2026-11-10): de lunes a sábado, de 7:00
 * a 17:00, hora de la clínica, sin domingos ni festivos de Colombia. El mismo
 * horario laboral de los avisos de la Bandeja (`HORARIO_LABORAL_POR_DEFECTO`).
 */
export const HORARIO_DEL_MOSTRADOR: HorarioAvisos = {
  aCualquierHora: false,
  ...HORARIO_LABORAL_POR_DEFECTO,
};

export function minutosParaContestar(
  slotDate: Date,
  ahora: Date,
  timeZone?: string,
): number {
  if (puedeAvisarAhora(ahora, HORARIO_DEL_MOSTRADOR, timeZone)) {
    return PLAZO_PARA_CONTESTAR.cercanoMin;
  }
  return slotDate.getTime() - ahora.getTime() >=
    PLAZO_PARA_CONTESTAR.horasCupoLejano * 3_600_000
    ? PLAZO_PARA_CONTESTAR.lejanoMin
    : PLAZO_PARA_CONTESTAR.cercanoMin;
}

/**
 * 🙋 Ofertas seguidas sin contestar para salir de la lista (2026-11-03): la primera
 * vez conserva su puesto; la segunda, sale. Así nadie pierde el puesto por no ver un
 * mensaje a tiempo, y la lista no se traba con quien nunca contesta.
 */
export const OFERTAS_SIN_RESPUESTA_PARA_SALIR = 2;

/**
 * ⏳ Cuánto se espera antes de ofrecer un cupo que liberó una anulación del hospital
 * (2026-11-03). El 3 de noviembre el hospital anuló las citas del miércoles de un
 * médico y quitó su turno; los cupos quedaron libres unos minutos y la lista de
 * espera los ofreció antes de que la agenda los cerrara: seis «Sí» terminaron en
 * «ese cupo ya no está» y cuatro citas las rechazó el hospital. Mientras espera, el
 * cupo queda apartado (el chat tampoco lo muestra). También cubre cuando el
 * hospital anula y vuelve a crear la misma cita en un par de minutos.
 */
export const ESPERA_CUPO_LIBERADO_POR_HOSPITAL_MS = 10 * 60_000;

/**
 * ⏳ Un cupo que acaba de aparecer en la agenda espera esto antes de ofrecerse a la
 * lista (2026-11-04): dos lecturas de la agenda del hospital (cada 5 minutos). El
 * hospital abrió la tarde del viernes de MD08 a las 13:39 y la quitó a las 13:44; a
 * las 13:40 el barrido ya había ofrecido 12 de esos cupos y 10 desaparecieron antes
 * de que las personas contestaran. Igual que los cupos que libera una anulación del
 * hospital (`ESPERA_CUPO_LIBERADO_POR_HOSPITAL_MS`). Vale para el barrido
 * (`CuposLibresListaService`) y, desde el 2026-11-05, para el cupo que se ofrece en
 * lugar de uno que ya no estaba o tras una respuesta tardía (`ofrecerOtroCupoLibre`:
 * ese día a una persona se le ofreció uno de 5 minutos).
 */
export const ESPERA_CUPO_NUEVO_MS = 10 * 60_000;

/** El dueño del apartado mientras espera un cupo liberado por el hospital. */
const APARTADO_HOSPITAL = 'HOSPITAL';

/** Hasta cuántas horas después de vencer una oferta se atiende su respuesta tardía. */
export const HORAS_RESPUESTA_TARDIA = 24;

/**
 * Lo que pasó con una respuesta tardía (contestó después de vencer su oferta):
 *  - TOMAR: el cupo sigue libre y es suyo (el chat lo reserva como un SÍ a tiempo).
 *  - OFRECIDO: ese ya no, pero se le ofreció otro cupo libre (el mensaje ya salió).
 *  - SIN_CUPO: ni ese ni otro; sigue en la lista en su puesto.
 *  - RECHAZADO: contestó NO; sigue en la lista sin ese cupo ni ese día.
 */
export type RespuestaTardia =
  | { tipo: 'TOMAR'; slotId: string; patientId: string; epsId: string | null }
  | { tipo: 'OFRECIDO' }
  | { tipo: 'SIN_CUPO'; slotDate: Date }
  | { tipo: 'RECHAZADO' };

/** `lista` con `valor` al final, sin repetir. */
const conUnoMas = (lista: string[] | undefined, valor: string): string[] =>
  lista?.includes(valor) ? lista : [...(lista ?? []), valor];

/**
 * Un cupo que se ofreció desde la lista y no se pudo tomar (lo tomó otro, el
 * hospital lo rechazó…) no se le vuelve a ofrecer a nadie de la lista por un rato:
 * si sigue «libre» en AgenIA pero no se puede agendar, cada oferta terminaría igual.
 */
const cupoFallidoKey = (organizationId: string, slotId: string) =>
  `lista_cupo_fallido:${organizationId}:${slotId}`;
const CUPO_FALLIDO_SEG = 6 * 60 * 60;

/** Cuántos de la lista se miran por cupo antes de dejarlo en la agenda. */
const MAX_CANDIDATOS = 20;

/**
 * Por dónde se le ofrece el cupo: TEXTO a quien escribió en las últimas 24 h (o
 * usa Telegram); PLANTILLA («Oferta de cupo», aprobada en Meta) a quien no.
 */
export type ViaOfertaCupo = 'TEXTO' | 'PLANTILLA';

/**
 * La plantilla solo de 7:00 a 19:00, hora de la clínica (2026-10-26). Quien no ha
 * escrito en 24 h recibe la oferta sin esperarla y tiene 30 minutos para responder:
 * de noche no alcanzaría, perdería el turno y el cupo saltaría al siguiente, también
 * de noche. Fuera de ese horario el cupo se le ofrece solo a quien escribió hace
 * poco; los demás conservan su lugar.
 */
export const HORARIO_OFERTA_CON_PLANTILLA = {
  desdeHora: 7,
  hastaHora: 19,
} as const;

/** La EPS del cupo guardada al ofrecerlo; las ofertas de antes no la tienen. */
const epsDelCupoGuardada = (
  metadata: WaitlistNotificationMetadata,
  epsDelPaciente: string | null,
): string | null =>
  metadata.epsDelCupo !== undefined ? metadata.epsDelCupo : epsDelPaciente;

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @Inject(forwardRef(() => ChatbotService))
    private chatbotService: ChatbotService,
    // Para apartar el cupo ofrecido (el mismo apartado del chat). Sin Redis se
    // ofrece igual, sin apartarlo (como antes del 2026-10-31).
    @Optional() private readonly redis?: RedisService,
    // Para buscarle otro cupo libre a quien contesta tarde (2026-11-03).
    @Optional() private readonly appointments?: AppointmentsService,
  ) {}

  // ════════════════════════════════════════════════════════════
  // 1. UNIRSE A LA LISTA DE ESPERA
  // ════════════════════════════════════════════════════════════
  async joinWaitlist(params: {
    patientId: string;
    serviceId: string;
    epsId: string | null;
    whatsappId: string;
    organizationId: string;
    preferredDoctorId?: string | null;
  }): Promise<{ success: boolean; position: number; id: string }> {
    const {
      patientId,
      serviceId,
      epsId,
      whatsappId,
      organizationId,
      preferredDoctorId = null,
    } = params;

    // Evitar duplicados: si ya está esperando lo mismo, devolver su posición actual
    const existing = await this.prisma.waitlistEntry.findFirst({
      where: { patientId, serviceId, organizationId, status: 'WAITING' },
    });

    if (existing) {
      const position = await this.getPosition(
        existing.id,
        serviceId,
        organizationId,
      );
      return { success: true, position, id: existing.id };
    }

    const entry = await this.prisma.waitlistEntry.create({
      data: {
        patientId,
        serviceId,
        epsId,
        whatsappId,
        organizationId,
        preferredDoctorId,
      },
    });

    const position = await this.getPosition(
      entry.id,
      serviceId,
      organizationId,
    );
    this.logger.log(`Paciente ${patientId} en waitlist posición ${position}`);
    return { success: true, position, id: entry.id };
  }

  // ════════════════════════════════════════════════════════════
  // 2. OFRECER UN CUPO LIBRE (se liberó, o el hospital abrió agenda)
  // ════════════════════════════════════════════════════════════
  /**
   * Le ofrece el cupo al primero de la lista que puede tomarlo. true si se le
   * ofreció a alguien. Lo llaman la cancelación (del chat y del hospital), el NO y
   * el vencimiento de una oferta, y el barrido de cupos libres
   * (`CuposLibresListaService`, 2026-10-31).
   */
  async notifyWaitlist(params: {
    slotId: string;
    serviceId: string;
    epsId: string | null;
    organizationId: string;
    doctorName: string;
    slotDate: Date;
  }): Promise<boolean> {
    const { slotId, serviceId, epsId, organizationId, slotDate } = params;

    const motivo = await this.motivoParaNoOfrecer(
      organizationId,
      slotId,
      slotDate,
    );
    if (motivo === 'OCUPADO') {
      this.logger.debug(
        `El cupo ${slotId} ya está ofrecido o apartado: no se ofrece otra vez a la lista de espera`,
      );
      return false;
    }
    if (motivo) {
      this.logger.log(motivo);
      return false;
    }

    // El primero de la cola (FIFO) que puede tomar el cupo y a quien se le puede
    // escribir ahora: con texto si escribió en las últimas 24 h (o usa Telegram),
    // con la plantilla «Oferta de cupo» si no. Al que no se le puede escribir no
    // se le gasta el turno: sigue esperando. Si el mensaje no sale, tampoco.
    const saltados: string[] = [];
    // La plantilla se mira una sola vez por cupo, y solo si hace falta.
    let plantilla: boolean | null = null;
    for (let i = 0; i < MAX_CANDIDATOS; i++) {
      const candidate = await this.prisma.waitlistEntry.findFirst({
        where: {
          serviceId,
          organizationId,
          status: 'WAITING',
          ...quienesPuedenTomarElCupo(epsId),
          ...(saltados.length > 0 ? { id: { notIn: saltados } } : {}),
        },
        include: { patient: true, service: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!candidate) break;

      // 🙅 Ya dijo que no a este cupo o a otro de ese día: se sigue con el que va
      // detrás, y ella conserva su puesto para otro día.
      if (
        await this.yaLoRechazo(candidate.metadata, slotId, slotDate, () =>
          this.zonaDeLaClinica(organizationId),
        )
      ) {
        saltados.push(candidate.id);
        continue;
      }
      // 📅 Ya consiguió cita por otro camino (el chat, el hospital): sale de la lista.
      if (await this.cerrarSiYaTieneCita(candidate)) {
        saltados.push(candidate.id);
        continue;
      }

      let via: ViaOfertaCupo | null = null;
      if (
        await this.puedeEscribirleTexto(organizationId, candidate.whatsappId)
      ) {
        via = 'TEXTO';
      } else {
        if (plantilla === null) {
          plantilla = await this.plantillaDisponible(
            organizationId,
            new Date(),
          );
        }
        if (plantilla) via = 'PLANTILLA';
      }
      if (via && (await this.ofrecerCupo(candidate, via, params))) return true;
      saltados.push(candidate.id);
    }

    this.logger.log(
      saltados.length > 0
        ? `A ninguno de los ${saltados.length} en la lista de espera de ${serviceId} se le pudo ofrecer: el cupo ${slotId} queda en la agenda`
        : `No hay candidatos en waitlist para servicio ${serviceId}`,
    );
    return false;
  }

  /**
   * Por qué este cupo NO se le puede ofrecer a la lista ahora (texto para el log), o
   * 'OCUPADO' si ya está ofrecido o apartado; null si se puede. Las mismas reglas
   * para un cupo que se libera, para el barrido y para la respuesta tardía.
   */
  private async motivoParaNoOfrecer(
    organizationId: string,
    slotId: string,
    slotDate: Date,
  ): Promise<string | null> {
    // 🔒 Con las operaciones del bot apagadas (/dashboard/configuracion) no se
    // ofrece el cupo: el «SÍ» del paciente sería una cita agendada por el bot.
    // La cola queda intacta (nadie pasa a NOTIFIED) y se retoma al encenderlo.
    const settings = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { bookingEnabled: true },
    });
    if (settings?.bookingEnabled === false) {
      return `Operaciones del bot apagadas en ${organizationId}: no se ofrece el cupo ${slotId} a la lista de espera`;
    }

    // 👨‍⚕️ Solo cupos que el asistente puede agendar: con el médico del cupo en
    // WhatsApp apagado, al «SÍ» la reserva se rechaza (DOCTOR_NOT_BOOKABLE). El
    // 2026-10-30: 8 de 14 ofertas en dos semanas fueron del médico comodín del
    // hospital, con WhatsApp apagado; ninguna terminó en cita. La regla es la misma
    // de `AppointmentsService.bookAppointment`.
    const cupo = await this.prisma.scheduleSlot.findFirst({
      where: { id: slotId, organizationId },
      select: {
        isAvailable: true,
        doctorId: true,
        startTime: true,
        doctor: { select: { whatsappBookingEnabled: true } },
      },
    });
    if (!cupo?.doctor?.whatsappBookingEnabled) {
      return `El cupo ${slotId} es de un médico que no agenda por el asistente: no se ofrece a la lista de espera`;
    }

    // 🔒 Que siga libre (2026-11-02): al vencer una oferta o tras un NO, el cupo se
    // le ofrecía al siguiente sin mirar si alguien ya lo había tomado o si el
    // hospital lo había cerrado. El 31 de octubre un cupo cerrado por la agenda del
    // hospital se ofreció cuatro veces seguidas, y una persona dijo SÍ dos veces y
    // las dos recibió «ese cupo ya no está».
    if (cupo.isAvailable === false) {
      return `El cupo ${slotId} ya no está libre: no se ofrece a la lista de espera`;
    }

    // ⏱️ Un cupo que empieza antes de la anticipación mínima no se ofrece: el
    // paciente no alcanzaría a llegar, y al reservar se rechazaría igual.
    if (slotDate < inicioMinimoParaOfrecer(new Date())) {
      return `El cupo ${slotId} empieza antes de la anticipación mínima: no se ofrece a la lista de espera`;
    }

    // 📅 Un cupo de un día u hora sin citas por el asistente no se ofrece.
    if (
      await cupoBloqueadoParaElAsistente(this.prisma, organizationId, slotDate)
    ) {
      return `El cupo ${slotId} cae en un día u hora sin citas por el asistente: no se ofrece a la lista de espera`;
    }

    // 🗓️ Ni un cupo más allá del plazo máximo para agendar: la cola espera a
    // que se libere uno dentro del plazo.
    if (
      await fueraDelPlazoParaElAsistente(this.prisma, organizationId, slotDate)
    ) {
      return `El cupo ${slotId} queda más allá del plazo máximo para agendar: no se ofrece a la lista de espera`;
    }

    // 🏥 Ni un cupo de un médico-día donde el asistente ya tomó su parte de la
    // agenda (reserva para la atención presencial, 2026-11-13): al «SÍ» la
    // reserva se rechazaría. La cola espera; si el cupo se liberó porque el chat
    // canceló, el chat bajó de su tope y sí se ofrece. Cuenta lo ya ofrecido a
    // otros de la lista. Sin reserva no consulta nada; si el conteo falla, se
    // ofrece como siempre (la reserva de la cita lo revalida).
    const reservado =
      cupo.doctorId && cupo.startTime
        ? await cupoReservadoParaElHospital(this.prisma, organizationId, {
            id: slotId,
            doctorId: cupo.doctorId,
            startTime: cupo.startTime,
          }).catch((error: unknown) => {
            this.logger.error(
              `Reserva presencial: no se pudo contar la agenda del cupo ${slotId}: ${getErrorMessage(error)}`,
            );
            return false;
          })
        : false;
    if (reservado) {
      return `El cupo ${slotId} es de un médico-día donde el asistente ya tomó su parte de la agenda (reserva para la atención presencial): no se ofrece a la lista de espera`;
    }

    // 🔁 Ya se le ofreció a alguien que aún no responde, lo tiene apartado un
    // paciente del chat mientras termina, o hace poco no se pudo tomar desde la
    // lista: no se ofrece otra vez.
    if (await this.cupoOcupado(organizationId, slotId)) {
      return 'OCUPADO';
    }

    return null;
  }

  /**
   * Le ofrece el cupo: lo marca NOTIFIED (antes de escribirle, para que un SÍ
   * rápido lo encuentre), se lo aparta mientras responde (el chat no lo muestra,
   * 2026-10-31) y le escribe. Si el mensaje no sale, vuelve a WAITING con su turno
   * y el cupo queda libre: false, y el cupo pasa al siguiente.
   */
  private async ofrecerCupo(
    candidate: {
      id: string;
      whatsappId: string;
      metadata?: Prisma.JsonValue;
      patient: { fullName: string };
      service: { name: string };
    },
    via: ViaOfertaCupo,
    cupo: {
      slotId: string;
      epsId: string | null;
      organizationId: string;
      doctorName: string;
      slotDate: Date;
    },
    /** Texto antes de la oferta (solo por texto): «ese cupo ya no está, pero…». */
    intro?: string,
  ): Promise<boolean> {
    const ahora = new Date();
    const expiresAt = new Date(
      ahora.getTime() +
        minutosParaContestar(
          cupo.slotDate,
          ahora,
          await this.zonaDeLaClinica(cupo.organizationId),
        ) *
          60_000,
    );

    const antes = readWaitlistMetadata(candidate.metadata);
    const conservado = loQueConserva(antes);
    await this.prisma.waitlistEntry.update({
      where: { id: candidate.id },
      data: {
        status: 'NOTIFIED',
        notifiedAt: new Date(),
        expiresAt,
        metadata: {
          ...(conservado === Prisma.DbNull
            ? {}
            : (conservado as Prisma.InputJsonObject)),
          pendingSlotId: cupo.slotId,
          doctorName: cupo.doctorName,
          slotDate: cupo.slotDate.toISOString(),
          epsDelCupo: cupo.epsId,
        },
      },
    });
    await this.apartarCupo(
      cupo.organizationId,
      cupo.slotId,
      candidate.whatsappId,
      expiresAt,
    );

    // Delegar el envío del mensaje al ChatbotService (mantiene consistencia de tono)
    const enviado = await this.chatbotService.notifyWaitlistCandidate({
      whatsappId: candidate.whatsappId,
      organizationId: cupo.organizationId,
      nombre: candidate.patient.fullName,
      especialidad: candidate.service.name,
      doctor: cupo.doctorName,
      slotDate: cupo.slotDate,
      slotId: cupo.slotId,
      via,
      hasta: expiresAt,
      ...(intro ? { intro } : {}),
    });

    if (!enviado) {
      await this.prisma.waitlistEntry.update({
        where: { id: candidate.id },
        data: {
          status: 'WAITING',
          notifiedAt: null,
          expiresAt: null,
          metadata: conservado,
        },
      });
      await this.soltarCupo(
        cupo.organizationId,
        cupo.slotId,
        candidate.whatsappId,
      );
      this.logger.warn(
        `La oferta del cupo ${cupo.slotId} no le salió a ${candidate.patient.fullName} (${via}): sigue esperando con su turno`,
      );
      return false;
    }

    this.logger.log(
      `Notificación enviada a ${candidate.patient.fullName} (${via})`,
    );
    return true;
  }

  // ════════════════════════════════════════════════════════════
  // 3. CONFIRMAR O RECHAZAR DESDE EL CHATBOT
  // ════════════════════════════════════════════════════════════
  async confirmFromWaitlist(params: {
    whatsappId: string;
    organizationId: string;
    confirmed: boolean;
  }): Promise<{
    slotId: string | null;
    patientId: string | null;
    /**
     * La EPS con la que el paciente ENTRÓ a la lista (null = particular). La cita se
     * reserva con esta, no con la de su ficha: quien está en el padrón de una EPS
     * puede pedir una cita particular, y la ficha solo guarda su EPS de siempre.
     */
    epsId: string | null;
    /** No tenía una oferta por contestar (2026-11-03: puede ser una respuesta tardía). */
    sinOferta?: true;
  }> {
    const { whatsappId, organizationId, confirmed } = params;

    const entry = await this.prisma.waitlistEntry.findFirst({
      where: { whatsappId, organizationId, status: 'NOTIFIED' },
      include: { patient: true },
    });

    if (!entry) {
      return { slotId: null, patientId: null, epsId: null, sinOferta: true };
    }

    const metadata = readWaitlistMetadata(entry.metadata);
    const slotId = metadata.pendingSlotId ?? null;

    if (confirmed) {
      await this.prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: 'CONFIRMED' },
      });
      // Lo reserva ahora mismo: el apartado ya no hace falta (la reserva revisa que
      // siga libre), y si la cita se cancelara, el cupo debe poder volver a la lista.
      if (slotId) await this.soltarCupo(organizationId, slotId, whatsappId);
      return { slotId, patientId: entry.patientId, epsId: entry.epsId };
    }

    // Dijo que NO: sigue en la lista, en su mismo puesto (`createdAt` no se toca),
    // como le dice el mensaje («usted sigue en la lista»). Antes salía de ella
    // (CANCELLED) aunque el mensaje dijera lo contrario (2026-10-31). Ese cupo y los
    // de ese día no se le vuelven a ofrecer; el cupo pasa al siguiente.
    await this.prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: {
        status: 'WAITING',
        notifiedAt: null,
        expiresAt: null,
        metadata: slotId
          ? loQueConserva({
              rechazados: conUnoMas(metadata.rechazados, slotId),
              diasRechazados: metadata.slotDate
                ? conUnoMas(
                    metadata.diasRechazados,
                    diaLocal(
                      new Date(metadata.slotDate),
                      await this.zonaDeLaClinica(organizationId),
                    ),
                  )
                : metadata.diasRechazados,
            })
          : loQueConserva(metadata),
      },
    });

    if (slotId) {
      await this.soltarCupo(organizationId, slotId, whatsappId);
      await this.notifyWaitlist({
        slotId,
        serviceId: entry.serviceId,
        epsId: epsDelCupoGuardada(metadata, entry.epsId),
        organizationId,
        doctorName: metadata.doctorName ?? '',
        slotDate: metadata.slotDate ? new Date(metadata.slotDate) : new Date(),
      });
    }

    return { slotId: null, patientId: null, epsId: null };
  }

  /**
   * 🔔 La oferta que esta persona tiene por responder, si sigue vigente: para
   * repetírsela si saluda en vez de contestar SÍ o NO (2026-11-02). null si no tiene
   * una o ya venció.
   */
  async ofertaPendiente(params: {
    whatsappId: string;
    organizationId: string;
  }): Promise<{
    nombre: string;
    servicio: string;
    doctorName: string;
    slotDate: Date;
    expiresAt: Date;
  } | null> {
    const entry = await this.prisma.waitlistEntry.findFirst({
      where: {
        whatsappId: params.whatsappId,
        organizationId: params.organizationId,
        status: 'NOTIFIED',
      },
      include: { patient: true, service: true },
    });
    if (!entry?.expiresAt || entry.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    const m = readWaitlistMetadata(entry.metadata);
    if (!m.slotDate) return null;
    return {
      nombre: entry.patient.fullName,
      servicio: entry.service.name,
      doctorName: m.doctorName ?? '',
      slotDate: new Date(m.slotDate),
      expiresAt: entry.expiresAt,
    };
  }

  /**
   * 🔁 Dijo SÍ al cupo ofrecido, pero ya no se pudo tomar (otro lo tomó, el médico
   * no agenda por el asistente o el hospital no lo registró): vuelve a la lista en
   * su mismo puesto (2026-10-30: quedaba CONFIRMED y, al anotarse otra vez, pasaba
   * del primero al noveno). El puesto lo da `createdAt`, que no se toca. Solo la
   * entrada de ESE cupo. `true` si volvió.
   */
  async volverAEsperar(params: {
    whatsappId: string;
    organizationId: string;
    slotId: string;
  }): Promise<boolean> {
    const { whatsappId, organizationId, slotId } = params;
    // Ese cupo no se pudo tomar desde la lista: no se le vuelve a ofrecer a nadie
    // de ella por un rato (si sigue «libre» en AgenIA, la siguiente oferta
    // terminaría igual).
    await this.marcarCupoFallido(organizationId, slotId);
    await this.soltarCupo(organizationId, slotId, whatsappId);
    const entrada = await this.prisma.waitlistEntry.findFirst({
      where: {
        whatsappId,
        organizationId,
        status: 'CONFIRMED',
        metadata: { path: ['pendingSlotId'], equals: slotId },
      },
      select: { id: true, metadata: true },
    });
    if (!entrada) return false;
    const antes = readWaitlistMetadata(entrada.metadata);
    await this.prisma.waitlistEntry.update({
      where: { id: entrada.id },
      data: {
        status: 'WAITING',
        notifiedAt: null,
        expiresAt: null,
        // Lo que ya había rechazado se conserva, y este cupo tampoco se le ofrece.
        metadata: loQueConserva({
          ...antes,
          rechazados: conUnoMas(antes.rechazados, slotId),
          // Contestó: la cuenta de ofertas sin respuesta vuelve a empezar.
          sinRespuesta: 0,
        }),
      },
    });
    this.logger.log(
      `El cupo ${slotId} de la lista de espera no se pudo tomar: ${whatsappId} vuelve a esperar con su turno`,
    );
    return true;
  }

  // ════════════════════════════════════════════════════════════
  // 4. CRON: EXPIRAR ENTRADAS SIN CONFIRMACIÓN (cada 5 min)
  // ════════════════════════════════════════════════════════════
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireStaleNotifications(): Promise<void> {
    const expired = await this.prisma.waitlistEntry.findMany({
      where: {
        status: 'NOTIFIED',
        expiresAt: { lt: new Date() },
      },
      include: { patient: true },
    });

    for (const entry of expired) {
      const metadata = readWaitlistMetadata(entry.metadata);

      // 📅 No contestó la oferta porque ya consiguió cita por otro camino (2026-11-02:
      // Carol tomó el cupo desde el menú del chat y media hora después recibió «el
      // tiempo para confirmar el cupo expiró»): sale de la lista sin aviso.
      const yaTieneCita = await this.cerrarSiYaTieneCita(entry);

      // 🙋 No contestó (2026-11-03): la primera vez conserva su puesto (WAITING,
      // `createdAt` intacto); a la segunda seguida, sale de la lista. Antes salía a
      // la primera: 6 de 33 ofertas se contestaron tarde y esas personas se volvían
      // a anotar al final. Se guarda la oferta vencida para atender su respuesta
      // tardía, y ese cupo no se le vuelve a ofrecer a ella.
      const sinRespuesta = (metadata.sinRespuesta ?? 0) + 1;
      const sale = sinRespuesta >= OFERTAS_SIN_RESPUESTA_PARA_SALIR;
      if (!yaTieneCita) {
        const ultimaOferta: OfertaVencida | null =
          metadata.pendingSlotId && metadata.slotDate
            ? {
                slotId: metadata.pendingSlotId,
                slotDate: metadata.slotDate,
                doctorName: metadata.doctorName ?? '',
                epsDelCupo: epsDelCupoGuardada(metadata, entry.epsId),
                vencioIso: new Date().toISOString(),
              }
            : null;
        this.logger.log(
          sale
            ? `${entry.patient.fullName} no contestó ${sinRespuesta} ofertas seguidas: sale de la lista de espera`
            : `${entry.patient.fullName} no contestó la oferta: conserva su puesto en la lista de espera`,
        );
        await this.prisma.waitlistEntry.update({
          where: { id: entry.id },
          data: {
            status: sale ? 'EXPIRED' : 'WAITING',
            notifiedAt: null,
            expiresAt: null,
            metadata: {
              ...conservadoComoObjeto({
                ...metadata,
                rechazados: metadata.pendingSlotId
                  ? conUnoMas(metadata.rechazados, metadata.pendingSlotId)
                  : metadata.rechazados,
                sinRespuesta,
              }),
              ...(ultimaOferta ? { ultimaOferta: { ...ultimaOferta } } : {}),
            },
          },
        });
      }
      if (metadata.pendingSlotId) {
        await this.soltarCupo(
          entry.organizationId,
          metadata.pendingSlotId,
          entry.whatsappId,
        );
      }

      // Avisar al paciente qué pasó — por la línea de SU clínica (antes dependía del
      // caché origin_org, que podía apuntar a otra org). Solo si el texto le llega: a
      // quien se le ofreció con la plantilla y no respondió, WhatsApp no deja
      // escribirle (sería un envío rechazado).
      if (yaTieneCita) {
        this.logger.log(
          `La oferta a ${entry.whatsappId} venció, pero ya tiene cita: sale de la lista sin aviso`,
        );
      } else if (
        await this.puedeEscribirleTexto(entry.organizationId, entry.whatsappId)
      ) {
        try {
          const fecha = metadata.slotDate
            ? formatAppointmentLong(new Date(metadata.slotDate), {
                timeZone: await this.zonaDeLaClinica(entry.organizationId),
              })
            : null;
          await this.chatbotService.sendOutboundMessage(
            entry.whatsappId,
            sale
              ? `No alcanzamos a recibir su respuesta a dos ofertas seguidas, así que salió de la *lista de espera*. ⏰\n\nSi todavía necesita la cita, escríbame *"Hola"* y le anoto de nuevo.`
              : `No alcanzamos a recibir su respuesta, así que el cupo${fecha ? ` del *${fecha}*` : ''} pasó a la siguiente persona. ⏰\n\nUsted sigue en la *lista de espera*, en su mismo puesto, y le aviso por aquí apenas haya otro cupo.`,
            entry.organizationId,
          );
        } catch {
          this.logger.warn(
            `No se pudo notificar expiración a ${entry.whatsappId}`,
          );
        }
      } else {
        this.logger.log(
          `No se le avisa a ${entry.whatsappId} que la oferta venció: no ha escrito en las últimas 24 h`,
        );
      }

      // Ofrecer el slot al siguiente candidato
      if (metadata.pendingSlotId) {
        await this.notifyWaitlist({
          slotId: metadata.pendingSlotId,
          serviceId: entry.serviceId,
          epsId: epsDelCupoGuardada(metadata, entry.epsId),
          organizationId: entry.organizationId,
          doctorName: metadata.doctorName ?? '',
          slotDate: metadata.slotDate
            ? new Date(metadata.slotDate)
            : new Date(),
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 5. RESPUESTA TARDÍA (contestó después de vencer su oferta)
  // ════════════════════════════════════════════════════════════
  /**
   * ⏰ Contestó SÍ o NO después de vencer su oferta (2026-11-03: del 28 de octubre
   * al 2 de noviembre, cuatro personas contestaron «Sí» entre 76 minutos y 5 horas
   * después; recibieron el menú de agendar, «agenda completa» y se volvieron a
   * anotar al final). Hasta `HORAS_RESPUESTA_TARDIA` horas después de vencer:
   *
   *  - SÍ y el cupo sigue libre (nadie lo tiene ofrecido ni apartado): es suyo.
   *  - SÍ y ya no: se le ofrece el primer otro cupo libre que el chat le daría.
   *  - SÍ y no hay ninguno: sigue en la lista en su puesto, y se le dice.
   *  - NO: sigue en la lista, sin ese cupo ni ese día.
   *
   * Contestar cuenta como respuesta: vuelve a la lista si había salido y la cuenta
   * de ofertas sin contestar vuelve a 0. null si no tiene una oferta vencida reciente.
   */
  async respuestaTardia(params: {
    whatsappId: string;
    organizationId: string;
    acepta: boolean;
  }): Promise<RespuestaTardia | null> {
    const { whatsappId, organizationId, acepta } = params;
    const desde = Date.now() - HORAS_RESPUESTA_TARDIA * 3_600_000;
    const recientes = await this.prisma.waitlistEntry.findMany({
      where: {
        whatsappId,
        organizationId,
        status: { in: ['WAITING', 'EXPIRED'] },
        updatedAt: { gte: new Date(desde) },
      },
      include: { patient: true, service: true },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
    const entry = recientes.find((e) => {
      const u = readWaitlistMetadata(e.metadata).ultimaOferta;
      return !!u && new Date(u.vencioIso).getTime() >= desde;
    });
    if (!entry) return null;
    // Ya consiguió cita por otro camino: sale de la lista y su «Sí» sigue el camino
    // de siempre (no se le agenda una segunda cita).
    if (await this.cerrarSiYaTieneCita(entry)) return null;
    const m = readWaitlistMetadata(entry.metadata);
    const u = m.ultimaOferta!;
    const slotDate = new Date(u.slotDate);

    // Contestó: sigue (o vuelve) en la lista, en su puesto, sin la oferta vencida.
    const base: WaitlistNotificationMetadata = {
      rechazados: m.rechazados,
      diasRechazados: m.diasRechazados,
      sinRespuesta: 0,
    };

    if (!acepta) {
      await this.prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: {
          status: 'WAITING',
          metadata: loQueConserva({
            ...base,
            rechazados: conUnoMas(m.rechazados, u.slotId),
            diasRechazados: conUnoMas(
              m.diasRechazados,
              diaLocal(slotDate, await this.zonaDeLaClinica(organizationId)),
            ),
          }),
        },
      });
      return { tipo: 'RECHAZADO' };
    }

    // ¿El mismo cupo sigue libre? Las mismas reglas de una oferta.
    if (
      (await this.motivoParaNoOfrecer(organizationId, u.slotId, slotDate)) ===
      null
    ) {
      await this.prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: {
          status: 'CONFIRMED',
          notifiedAt: new Date(),
          metadata: {
            ...conservadoComoObjeto(base),
            pendingSlotId: u.slotId,
            doctorName: u.doctorName,
            slotDate: u.slotDate,
            epsDelCupo: u.epsDelCupo,
          },
        },
      });
      this.logger.log(
        `Respuesta tardía de ${whatsappId}: el cupo ${u.slotId} seguía libre y es suyo`,
      );
      return {
        tipo: 'TOMAR',
        slotId: u.slotId,
        patientId: entry.patientId,
        epsId: entry.epsId,
      };
    }

    // Ese ya no: sigue en la lista y, si hay otro cupo libre, se le ofrece ya.
    const metadataEnEspera = loQueConserva({
      ...base,
      rechazados: conUnoMas(m.rechazados, u.slotId),
    });
    await this.prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: { status: 'WAITING', metadata: metadataEnEspera },
    });
    const ofrecido = await this.ofrecerOtroCupoLibre({
      ...entry,
      metadata:
        metadataEnEspera === Prisma.DbNull
          ? null
          : (metadataEnEspera as Prisma.JsonValue),
    });
    return ofrecido ? { tipo: 'OFRECIDO' } : { tipo: 'SIN_CUPO', slotDate };
  }

  /**
   * El primer cupo libre que el chat le daría a esta persona (sin los que rechazó ni
   * los días que no le sirven), ofrecido como una oferta más. false si no hay.
   */
  private async ofrecerOtroCupoLibre(
    entry: {
      id: string;
      whatsappId: string;
      organizationId: string;
      serviceId: string;
      epsId: string | null;
      metadata: Prisma.JsonValue;
      patient: { fullName: string };
      service: { name: string };
    },
    intro?: string,
  ): Promise<boolean> {
    if (!this.appointments) return false;
    const m = readWaitlistMetadata(entry.metadata);
    const cupos = await this.appointments.getAvailableSlots(
      entry.service.name,
      entry.epsId,
      entry.organizationId,
      null,
      { todos: true },
    );
    if (cupos.length === 0) return false;
    const filas = await this.prisma.scheduleSlot.findMany({
      where: {
        id: { in: cupos.map((c) => c.slotId) },
        organizationId: entry.organizationId,
        serviceId: entry.serviceId,
        isAvailable: true,
        // Recién aparecido: todavía no (2026-11-05), como en el barrido.
        createdAt: { lte: new Date(Date.now() - ESPERA_CUPO_NUEVO_MS) },
      },
      include: { doctor: true },
      orderBy: { startTime: 'asc' },
    });
    const zona = await this.zonaDeLaClinica(entry.organizationId);
    for (const cupo of filas) {
      if (m.rechazados?.includes(cupo.id)) continue;
      if (m.diasRechazados?.includes(diaLocal(cupo.startTime, zona))) continue;
      if (
        await this.motivoParaNoOfrecer(
          entry.organizationId,
          cupo.id,
          cupo.startTime,
        )
      ) {
        continue;
      }
      return this.ofrecerCupo(
        entry,
        'TEXTO',
        {
          slotId: cupo.id,
          epsId: cupo.allowedEpsId,
          organizationId: entry.organizationId,
          doctorName: cupo.doctor.fullName,
          slotDate: cupo.startTime,
        },
        intro,
      );
    }
    return false;
  }

  /**
   * 🔁 Dijo SÍ y el cupo ya no estaba (2026-11-03: 17 «Sí» así en una mañana): ya
   * volvió a la lista en su puesto (`volverAEsperar`); si hay otro cupo libre que
   * el chat le daría, se le ofrece enseguida, con `intro` antes de la oferta. true
   * si se le ofreció. Si algo falla, false: se le dice que sigue en la lista.
   */
  async ofrecerOtroCupo(params: {
    whatsappId: string;
    organizationId: string;
    intro?: string;
  }): Promise<boolean> {
    try {
      const entry = await this.prisma.waitlistEntry.findFirst({
        where: {
          whatsappId: params.whatsappId,
          organizationId: params.organizationId,
          status: 'WAITING',
        },
        include: { patient: true, service: true },
        orderBy: { updatedAt: 'desc' },
      });
      if (!entry) return false;
      return await this.ofrecerOtroCupoLibre(entry, params.intro);
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo ofrecer otro cupo de la lista de espera a ${params.whatsappId}: ${getErrorMessage(error)}`,
      );
      return false;
    }
  }

  /**
   * ⏳ El hospital anuló una cita y su cupo quedó libre (2026-11-03): se aparta
   * `ESPERA_CUPO_LIBERADO_POR_HOSPITAL_MS` (ni el chat ni la lista lo ofrecen) y
   * después, si sigue libre, se le ofrece a la lista. Si en ese rato el hospital
   * quitó el día del médico o volvió a crear la cita, la agenda lo cerró y no se
   * ofrece. Nunca lanza.
   */
  async cupoLiberadoPorElHospital(params: {
    organizationId: string;
    slotId: string;
  }): Promise<void> {
    const { organizationId, slotId } = params;
    const marca = `${APARTADO_HOSPITAL}:${Date.now()}`;
    let apartado = false;
    if (this.redis) {
      try {
        apartado =
          (await this.redis.set(
            cupoApartadoKey(organizationId, slotId),
            marca,
            'EX',
            Math.ceil(ESPERA_CUPO_LIBERADO_POR_HOSPITAL_MS / 1000) + 60,
            'NX',
          )) === 'OK';
      } catch (error: unknown) {
        this.logger.warn(
          `No se pudo apartar el cupo ${slotId} liberado por el hospital: ${getErrorMessage(error)}`,
        );
      }
    }
    this.programar(() => {
      void this.ofrecerCupoLiberadoPorElHospital(
        organizationId,
        slotId,
        apartado ? marca : null,
      );
    }, ESPERA_CUPO_LIBERADO_POR_HOSPITAL_MS);
  }

  /** Pasada la espera: suelta el apartado y, si el cupo sigue libre, lo ofrece. */
  async ofrecerCupoLiberadoPorElHospital(
    organizationId: string,
    slotId: string,
    marca: string | null,
  ): Promise<boolean> {
    try {
      if (marca && this.redis) {
        const key = cupoApartadoKey(organizationId, slotId);
        if ((await this.redis.get(key)) === marca) await this.redis.del(key);
      }
      const cupo = await this.prisma.scheduleSlot.findFirst({
        where: { id: slotId, organizationId },
        include: { doctor: true },
      });
      if (!cupo || !cupo.isAvailable) {
        this.logger.log(
          `El cupo ${slotId} que liberó el hospital ya no está libre: no se ofrece a la lista de espera`,
        );
        return false;
      }
      return await this.notifyWaitlist({
        slotId: cupo.id,
        serviceId: cupo.serviceId,
        epsId: cupo.allowedEpsId,
        organizationId,
        doctorName: cupo.doctor.fullName,
        slotDate: cupo.startTime,
      });
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo ofrecer a la lista de espera el cupo ${slotId} que liberó el hospital: ${getErrorMessage(error)}`,
      );
      return false;
    }
  }

  /** Programa algo para más tarde, sin retener el proceso (aparte para las pruebas). */
  protected programar(fn: () => void, ms: number): void {
    const t = setTimeout(fn, ms);
    t.unref?.();
  }

  // ════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════

  /**
   * 📅 Saca de la lista a quien ya consiguió cita de ese servicio por otro camino
   * después de anotarse (por el chat, en el panel o en el hospital): ya no espera
   * (2026-10-31: 5 de los 20 de la lista tenían cita y seguían «esperando»). Para
   * el barrido de cupos libres; la oferta de un cupo lo revisa además en cada
   * candidato. Devuelve cuántos salieron.
   */
  async cerrarLosQueYaTienenCita(
    organizationId: string,
    serviceId: string,
  ): Promise<number> {
    const esperando = await this.prisma.waitlistEntry.findMany({
      where: { organizationId, serviceId, status: 'WAITING' },
      select: {
        id: true,
        patientId: true,
        serviceId: true,
        organizationId: true,
        createdAt: true,
      },
    });
    let cerrados = 0;
    for (const e of esperando) {
      if (await this.cerrarSiYaTieneCita(e)) cerrados++;
    }
    return cerrados;
  }

  /**
   * ¿Ya tiene una cita (no cancelada) de ese servicio creada después de anotarse?
   * Entonces sale de la lista (CANCELLED, con el motivo y la cita). Si la consulta
   * falla, sigue en la lista.
   */
  private async cerrarSiYaTieneCita(entrada: {
    id: string;
    patientId: string;
    serviceId: string;
    organizationId: string;
    createdAt: Date;
  }): Promise<boolean> {
    try {
      const cita = await this.prisma.appointment.findFirst({
        where: {
          organizationId: entrada.organizationId,
          patientId: entrada.patientId,
          status: { not: 'CANCELLED' },
          createdAt: { gt: entrada.createdAt },
          scheduleSlot: { serviceId: entrada.serviceId },
        },
        select: { id: true },
      });
      if (!cita) return false;
      await this.prisma.waitlistEntry.update({
        where: { id: entrada.id },
        data: {
          status: 'CANCELLED',
          metadata: { motivo: 'YA_TIENE_CITA', appointmentId: cita.id },
        },
      });
      this.logger.log(
        `La entrada ${entrada.id} de la lista de espera sale: ya tiene la cita ${cita.id}`,
      );
      return true;
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo revisar si la entrada ${entrada.id} ya tiene cita: ${getErrorMessage(error)}`,
      );
      return false;
    }
  }

  /** ¿Ya dijo que no a este cupo, o a otro del mismo día? */
  private async yaLoRechazo(
    metadata: Prisma.JsonValue | undefined,
    slotId: string,
    slotDate: Date,
    zona: () => Promise<string | undefined>,
  ): Promise<boolean> {
    const m = readWaitlistMetadata(metadata);
    if (m.rechazados?.includes(slotId)) return true;
    if (!m.diasRechazados?.length) return false;
    return m.diasRechazados.includes(diaLocal(slotDate, await zona()));
  }

  /** La zona horaria de la clínica (null → la de Colombia). */
  private async zonaDeLaClinica(
    organizationId: string,
  ): Promise<string | undefined> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    return org?.timezone || undefined;
  }

  /**
   * ¿El cupo ya está ofrecido a alguien de la lista que no ha respondido, apartado
   * por un paciente del chat, o hace poco no se pudo tomar desde la lista?
   */
  private async cupoOcupado(
    organizationId: string,
    slotId: string,
  ): Promise<boolean> {
    const ofrecido = await this.prisma.waitlistEntry.count({
      where: {
        organizationId,
        status: 'NOTIFIED',
        metadata: { path: ['pendingSlotId'], equals: slotId },
      },
    });
    if (ofrecido > 0) return true;
    if (!this.redis) return false;
    try {
      const [apartado, fallido] = await Promise.all([
        this.redis.get(cupoApartadoKey(organizationId, slotId)),
        this.redis.get(cupoFallidoKey(organizationId, slotId)),
      ]);
      return apartado !== null || fallido !== null;
    } catch {
      // Sin Redis se ofrece igual, como antes del apartado.
      return false;
    }
  }

  /**
   * Aparta el cupo para quien lo recibe mientras responde: el mismo apartado del
   * chat, así el menú no se lo muestra a otro paciente (2026-10-31). Vence un par de
   * minutos después de su plazo para responder.
   */
  private async apartarCupo(
    organizationId: string,
    slotId: string,
    whatsappId: string,
    expiresAt: Date,
  ): Promise<void> {
    if (!this.redis) return;
    const segundos = Math.max(
      60,
      Math.ceil((expiresAt.getTime() - Date.now()) / 1000) + 120,
    );
    try {
      await this.redis.set(
        cupoApartadoKey(organizationId, slotId),
        whatsappId,
        'EX',
        segundos,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo apartar el cupo ${slotId} ofrecido a la lista de espera: ${getErrorMessage(error)}`,
      );
    }
  }

  /** Suelta el cupo si lo tiene apartado esta persona. */
  private async soltarCupo(
    organizationId: string,
    slotId: string,
    whatsappId: string,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      const key = cupoApartadoKey(organizationId, slotId);
      if ((await this.redis.get(key)) === whatsappId) await this.redis.del(key);
    } catch {
      // Vence solo.
    }
  }

  private async marcarCupoFallido(
    organizationId: string,
    slotId: string,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        cupoFallidoKey(organizationId, slotId),
        '1',
        'EX',
        CUPO_FALLIDO_SEG,
      );
    } catch {
      // Sin la marca, a lo sumo se ofrece otra vez.
    }
  }

  /**
   * ¿Le llega un texto libre? Telegram no tiene ventana; WhatsApp solo acepta
   * texto libre hasta 24 h después del último mensaje del paciente.
   */
  private async puedeEscribirleTexto(
    organizationId: string,
    whatsappId: string,
  ): Promise<boolean> {
    if (isTelegramSender(whatsappId)) return true;
    return this.chatbotService.isWithinServiceWindow(
      organizationId,
      whatsappId,
    );
  }

  /**
   * ¿Se puede ofrecer el cupo con la plantilla «Oferta de cupo»? Si la clínica la
   * tiene registrada y activa, y es de día en la clínica
   * (`HORARIO_OFERTA_CON_PLANTILLA`).
   */
  private async plantillaDisponible(
    organizationId: string,
    ahora: Date,
  ): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const minuto = minutoLocal(ahora, org?.timezone || undefined);
    if (
      minuto < HORARIO_OFERTA_CON_PLANTILLA.desdeHora * 60 ||
      minuto >= HORARIO_OFERTA_CON_PLANTILLA.hastaHora * 60
    ) {
      return false;
    }
    return this.chatbotService.ofertaDeCupoConPlantilla(organizationId);
  }

  /**
   * Cuántos esperan delante: los del mismo servicio que entraron antes. Con la
   * EPS no se filtra: un cupo para cualquier EPS (los de Anserma) se le ofrece
   * al primero de la cola, sea cual sea la suya.
   */
  private async getPosition(
    entryId: string,
    serviceId: string,
    organizationId: string,
  ): Promise<number> {
    const entry = await this.prisma.waitlistEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry) return 1;

    const ahead = await this.prisma.waitlistEntry.count({
      where: {
        serviceId,
        organizationId,
        status: 'WAITING',
        id: { not: entryId },
        createdAt: { lt: entry.createdAt },
      },
    });
    return ahead + 1;
  }
}
