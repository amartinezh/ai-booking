import { Injectable } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import { PrismaService } from '../prisma/prisma.service';
import {
  SOLICITUD_CITAS,
  documentoSinCerosIniciales,
  evaluarLimiteCitas,
  limitesDeLaClinica,
  normalizeDocumento,
  periodoDelLimite,
  type LimiteSuperado,
} from '@agenia/shared';

/** Lo que el servicio lee. Sirve el cliente normal o el de una transacción. */
type Db = Pick<
  Prisma.TransactionClient,
  | 'organizationSettings'
  | 'organization'
  | 'patientProfile'
  | 'appointment'
  | 'appointmentLimitRequest'
>;

/** El límite superado y de quién (para el mensaje y la solicitud de revisión). */
export interface LimiteDelPaciente extends LimiteSuperado {
  paciente: { id: string; cedula: string; fullName: string };
}

/** Qué le puede ofrecer el bot al paciente que llegó al límite. */
export type SolicitudPreparada =
  /** Enlace para radicar la revisión (`/solicitud-citas/{solicitudId}`). */
  | { estado: 'ENLACE'; solicitudId: string }
  /** Ya radicó una para este periodo y está en revisión: no se manda otra. */
  | { estado: 'EN_REVISION' }
  /** Ya radicó el máximo para este periodo: solo el teléfono del hospital. */
  | { estado: 'SIN_ENLACE' };

/**
 * 🚦 LÍMITE DE CITAS POR PACIENTE (ver @agenia/shared limite-citas.ts).
 *
 * `evaluar` responde si el bot puede asignarle a esa cédula una cita en esa
 * fecha; lo llaman el chatbot (para frenar temprano, antes de pedir datos) y
 * `AppointmentsService.bookAppointment` dentro de su transacción (la palabra
 * final, que cubre también la lista de espera). `prepararSolicitud` deja lista
 * la solicitud de revisión cuyo enlace manda el bot.
 */
@Injectable()
export class LimiteCitasService {
  constructor(private prisma: PrismaService) {}

  /**
   * `null` = se puede. Si no, cuál límite y cuántas citas tiene ya.
   *
   * Cuentan las citas vigentes (no canceladas) de esa cédula en la clínica,
   * de cualquier origen, cuya hora cae en el mismo día o mes (de la clínica)
   * que `fecha`. `excluirCitaId` es la cita que se está cambiando de fecha: no
   * cuenta contra sí misma. Un paciente sin ficha no tiene citas: se puede.
   */
  async evaluar(
    p: {
      organizationId: string;
      cedula: string;
      fecha: Date;
      excluirCitaId?: string | null;
    },
    db: Db = this.prisma,
  ): Promise<LimiteDelPaciente | null> {
    const { organizationId, fecha, excluirCitaId } = p;
    const cedula = normalizeDocumento(p.cedula);
    if (!cedula) return null;

    const [settings, org] = await Promise.all([
      db.organizationSettings.findUnique({
        where: { organizationId },
        select: {
          dailyAppointmentLimitEnabled: true,
          maxAppointmentsPerDay: true,
          monthlyAppointmentLimitEnabled: true,
          maxAppointmentsPerMonth: true,
        },
      }),
      db.organization.findUnique({
        where: { id: organizationId },
        select: { timezone: true },
      }),
    ]);
    const limites = limitesDeLaClinica(settings);
    if (!limites.diaActivo && !limites.mesActivo) return null;

    // La ficha se busca en las DOS direcciones de los ceros a la izquierda: la
    // del paciente puede estar guardada con ellos («0012345678», del HIS o de
    // otro canal) y el paciente escribirlos o no. `endsWith` trae los
    // candidatos y el filtro deja solo los que son el mismo documento.
    const candidatos = documentosCandidatos(p.cedula);
    const sinCeros = documentoSinCerosIniciales(cedula);
    const pacientes = (
      await db.patientProfile.findMany({
        where: {
          organizationId,
          OR: [
            { cedula: { in: candidatos } },
            { cedula: { endsWith: sinCeros } },
          ],
        },
        select: { id: true, cedula: true, fullName: true },
        take: 20,
      })
    ).filter(
      (x) =>
        documentoSinCerosIniciales(normalizeDocumento(x.cedula)) === sinCeros,
    );
    if (pacientes.length === 0) return null;

    const timeZone = org?.timezone ?? undefined;
    const dia = periodoDelLimite('DAILY', fecha, timeZone);
    const mes = periodoDelLimite('MONTHLY', fecha, timeZone);
    const ids = pacientes.map((x) => x.id);

    const contar = (periodo: { desde: Date; hasta: Date }) =>
      db.appointment.count({
        where: {
          organizationId,
          patientId: { in: ids },
          status: { not: 'CANCELLED' },
          scheduleSlot: {
            startTime: { gte: periodo.desde, lt: periodo.hasta },
          },
          ...(excluirCitaId ? { id: { not: excluirCitaId } } : {}),
        },
      });

    const [citasDia, citasMes, aprobadas] = await Promise.all([
      limites.diaActivo ? contar(dia) : Promise.resolve(0),
      limites.mesActivo ? contar(mes) : Promise.resolve(0),
      db.appointmentLimitRequest.findMany({
        where: {
          organizationId,
          cedula: { in: candidatos },
          status: 'APPROVED',
          OR: [
            { kind: 'DAILY', periodKey: dia.clave },
            { kind: 'MONTHLY', periodKey: mes.clave },
          ],
        },
        select: { kind: true, extraGranted: true },
      }),
    ]);

    const adicionales = (kind: 'DAILY' | 'MONTHLY') =>
      aprobadas
        .filter((a) => a.kind === kind)
        .reduce((total, a) => total + Math.max(0, a.extraGranted ?? 0), 0);

    const superado = evaluarLimiteCitas({
      limites,
      dia: { periodo: dia, citas: citasDia, adicionales: adicionales('DAILY') },
      mes: {
        periodo: mes,
        citas: citasMes,
        adicionales: adicionales('MONTHLY'),
      },
    });
    if (!superado) return null;

    const paciente = pacientes[0];
    return {
      ...superado,
      paciente: {
        id: paciente.id,
        // Sin ceros a la izquierda: así se guarda en la solicitud y así la
        // encuentran siempre las búsquedas de adicionales aprobadas.
        cedula: sinCeros,
        fullName: paciente.fullName,
      },
    };
  }

  /**
   * Deja lista la solicitud de revisión para el paciente que llegó al límite.
   *
   * · Si ya radicó una para ese periodo y está PENDIENTE, no se abre otra.
   * · Si ya radicó `MAX_POR_PERIODO`, no se manda enlace (abuso del formulario).
   * · Si el bot ya le mandó un enlace vigente sin usar, se reutiliza (con el
   *   contexto actualizado): escribirle al bot diez veces no deja diez filas.
   * · Si no, se crea una fila INVITED que vence en `VIGENCIA_ENLACE_DIAS`.
   */
  async prepararSolicitud(p: {
    organizationId: string;
    limite: LimiteDelPaciente;
    canal: 'WHATSAPP' | 'TELEGRAM';
    telefono?: string | null;
    operacion: 'BOOKING' | 'RESCHEDULE';
    fechaSolicitada: Date;
    servicio?: string | null;
    ahora?: Date;
  }): Promise<SolicitudPreparada> {
    const { organizationId, limite } = p;
    const ahora = p.ahora ?? new Date();
    const base = {
      organizationId,
      cedula: { in: documentosCandidatos(limite.paciente.cedula) },
      kind: limite.tipo,
      periodKey: limite.periodo.clave,
    };

    const [enRevision, radicadas, invitacion] = await Promise.all([
      this.prisma.appointmentLimitRequest.count({
        where: { ...base, status: 'PENDING' },
      }),
      this.prisma.appointmentLimitRequest.count({
        where: { ...base, submittedAt: { not: null } },
      }),
      this.prisma.appointmentLimitRequest.findFirst({
        where: { ...base, status: 'INVITED', expiresAt: { gt: ahora } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    ]);

    if (enRevision > 0) return { estado: 'EN_REVISION' };
    if (radicadas >= SOLICITUD_CITAS.MAX_POR_PERIODO) {
      return { estado: 'SIN_ENLACE' };
    }

    const contexto = {
      requestedSlotAt: p.fechaSolicitada,
      serviceName: p.servicio?.slice(0, 120) || null,
      limitAtRequest: limite.limite,
      countAtRequest: limite.citas,
      operation: p.operacion,
      fullName: limite.paciente.fullName.slice(0, 120),
      ...(p.telefono ? { phone: p.telefono.slice(0, 20) } : {}),
    };

    if (invitacion) {
      await this.prisma.appointmentLimitRequest.update({
        where: { id: invitacion.id },
        data: contexto,
      });
      return { estado: 'ENLACE', solicitudId: invitacion.id };
    }

    const creada = await this.prisma.appointmentLimitRequest.create({
      data: {
        ...contexto,
        organizationId,
        cedula: limite.paciente.cedula,
        kind: limite.tipo,
        periodKey: limite.periodo.clave,
        channel: p.canal,
        expiresAt: new Date(
          ahora.getTime() +
            SOLICITUD_CITAS.VIGENCIA_ENLACE_DIAS * 24 * 60 * 60 * 1000,
        ),
      },
      select: { id: true },
    });
    return { estado: 'ENLACE', solicitudId: creada.id };
  }
}

/** El documento tal cual, solo dígitos y sin ceros a la izquierda. */
function documentosCandidatos(raw: string): string[] {
  const normalizado = normalizeDocumento(raw);
  return [
    ...new Set(
      [raw.trim(), normalizado, documentoSinCerosIniciales(normalizado)].filter(
        Boolean,
      ),
    ),
  ];
}
