import { Injectable } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import {
  LIMITES_CONSULTA_BOT,
  LIMITES_CONSULTA_HIS,
  citasHisNuevas,
  documentosDelPaciente,
  esDocumentoValido,
  estadoConexionHis,
  leerResultadoGuardado,
  validarConsultaHis,
  ventanaConsultaBot,
  type CitaHisVista,
  type ConexionHis,
  type ConfigConexionHis,
  type ParamsConsultaPorDocumento,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { doctorLabel } from '../common/doctor-label.util';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * EL BOT LE PREGUNTA AL HIS ("¿qué citas tengo?") — docs/PLAN_CONSULTA_CITAS.md, Fase B
 * ══════════════════════════════════════════════════════════════════════════
 *
 * La parte de datos; los mensajes los arma ChatbotService. Reutiliza la consulta
 * en vivo del rastreo (`HisLookupRequest`, `kind = 'BY_DOCUMENT'`) con
 * `origin = 'BOT'`: para el agente y su driver es una petición más.
 *
 * Decisiones (§0 del plan): interruptor propio `botLookupMode` (D4); el turno NO
 * espera al HIS, el resultado llega en un segundo mensaje (D5); sin novedades,
 * silencio (D6); las citas que solo están en el HIS son de solo lectura (D7).
 *
 * El remitente (a quién escribirle después) NO se guarda en la base: vive en
 * Redis lo que dura el seguimiento.
 */

/** `requestedByUserId` de las peticiones del bot (la columna es NOT NULL y sin FK). */
export const SOLICITANTE_BOT = 'chatbot';

export type ModoConsultaBot = 'OFF' | 'SHADOW' | 'ON';

/** Lo que el bot lee de `HospitalMirrorConfig`. */
export type ConfigHisBot = Omit<ConfigConexionHis, 'lookupEnabled'> & {
  lookupEnabled?: boolean;
  botLookupMode: ModoConsultaBot;
};

/** Una cita del HIS lista para el mensaje: nombres, no claves. */
export interface CitaHisParaMostrar {
  startIso: string;
  /** '' si el médico no está homologado ni tiene etiqueta. */
  medico: string;
  /** '' si el servicio no está homologado ni tiene etiqueta. */
  servicio: string;
}

export type PlanHisBot =
  /** No se consulta: modo OFF, conexión no VIVA o sin documento válido. */
  | { accion: 'SIN_CONSULTA' }
  /** Ya hubo una consulta reciente de este paciente (o el bot llegó a su tope). */
  | { accion: 'LIMITADA' }
  /** Petición encolada: el resultado llega por `reclamarSeguimientos`. */
  | { accion: 'CONSULTANDO'; requestId: string }
  /** Resultado reciente reutilizado: ya se sabe qué tiene el HIS. */
  | { accion: 'REUTILIZADA'; nuevas: CitaHisParaMostrar[] };

/** Un resultado del bot que ya le toca atender (segundo mensaje o silencio). */
export interface SeguimientoHis {
  requestId: string;
  organizationId: string;
  senderId: string;
  patientId: string;
  status: 'RESUELTA' | 'ERROR' | 'EXPIRADA';
  /** Solo si RESUELTA: lo que el HIS tiene y AgenIA no, con nombres. */
  nuevas: CitaHisParaMostrar[];
  /** Cuántas citas del paciente devolvió el HIS (para la medición de D8). */
  citasHis: number;
}

const claveRemitente = (requestId: string) => `bot_his_req:${requestId}`;
const MS_MIN = 60_000;

@Injectable()
export class ConsultaHisBotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * El modo y el estado de la conexión PARA EL BOT: la misma regla genérica que
   * usa el rastreo, con el interruptor del bot en lugar del del personal.
   */
  conexionDelBot(
    config: ConfigHisBot | null,
    ahora: Date,
  ): { modo: ModoConsultaBot; conexion: ConexionHis } {
    const modo = config?.botLookupMode ?? 'OFF';
    const conexion = estadoConexionHis(
      config ? { ...config, lookupEnabled: modo !== 'OFF' } : null,
      ahora,
    );
    return { modo, conexion };
  }

  /**
   * Decide qué hacer con el HIS en esta consulta. Solo se llama cuando quien
   * escribe ya probó ser el paciente: a un tercero no se le carga trabajo al
   * hospital (§2 del plan).
   */
  async planificar(p: {
    organizationId: string;
    senderId: string;
    patient: { id: string; cedula: string };
    modo: ModoConsultaBot;
    conexion: ConexionHis;
    ahora: Date;
    timeZone?: string;
  }): Promise<PlanHisBot> {
    const { organizationId, patient, ahora } = p;
    if (p.modo === 'OFF' || p.conexion.estado !== 'VIVA') {
      return { accion: 'SIN_CONSULTA' };
    }

    // Una por paciente cada `porPacienteMin`; si la anterior es muy reciente y
    // ya respondió, se reutiliza su resultado.
    const reciente = await this.prisma.hisLookupRequest.findFirst({
      where: {
        organizationId,
        origin: 'BOT',
        patientId: patient.id,
        createdAt: {
          gte: new Date(
            ahora.getTime() - LIMITES_CONSULTA_BOT.porPacienteMin * MS_MIN,
          ),
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { status: true, result: true, createdAt: true, purgedAt: true },
    });
    if (reciente) {
      const reutilizable =
        reciente.status === 'RESUELTA' &&
        reciente.purgedAt === null &&
        ahora.getTime() - reciente.createdAt.getTime() <=
          LIMITES_CONSULTA_BOT.reutilizarMin * MS_MIN;
      const resultado = reutilizable
        ? leerResultadoGuardado(reciente.result)
        : null;
      if (resultado?.kind === 'BY_DOCUMENT') {
        const nuevas = await this.nuevasParaMostrar({
          organizationId,
          patientId: patient.id,
          citasHis: resultado.citas,
          ahora,
          timeZone: p.timeZone,
        });
        return { accion: 'REUTILIZADA', nuevas };
      }
      return { accion: 'LIMITADA' };
    }

    const enCurso = await this.prisma.hisLookupRequest.count({
      where: {
        organizationId,
        origin: 'BOT',
        status: 'PENDIENTE',
        createdAt: {
          gte: new Date(ahora.getTime() - LIMITES_CONSULTA_HIS.expiraMs),
        },
      },
    });
    if (enCurso >= LIMITES_CONSULTA_BOT.pendientesPorClinica) {
      return { accion: 'LIMITADA' };
    }

    const { desde, hasta } = ventanaConsultaBot(ahora, p.timeZone);
    const params: ParamsConsultaPorDocumento = {
      patientDocuments: documentosDelPaciente(patient.cedula).filter(
        esDocumentoValido,
      ),
      fromIso: desde.toISOString(),
      toIso: hasta.toISOString(),
    };
    // Lo que se guarda tiene que pasar la misma validación que aplicará el agente.
    if (
      params.patientDocuments.length === 0 ||
      validarConsultaHis({ requestId: 'plan', kind: 'BY_DOCUMENT', ...params })
    ) {
      return { accion: 'SIN_CONSULTA' };
    }

    const fila = await this.prisma.hisLookupRequest.create({
      data: {
        organizationId,
        requestedByUserId: SOLICITANTE_BOT,
        origin: 'BOT',
        kind: 'BY_DOCUMENT',
        params: params as unknown as Prisma.InputJsonValue,
        patientId: patient.id,
        purgeAt: new Date(ahora.getTime() + LIMITES_CONSULTA_HIS.purgaMs),
      },
      select: { id: true },
    });
    await this.redis.set(
      claveRemitente(fila.id),
      p.senderId,
      'EX',
      LIMITES_CONSULTA_BOT.seguimientoMaxMin * 60,
    );
    return { accion: 'CONSULTANDO', requestId: fila.id };
  }

  /**
   * Los resultados del bot que ya cerraron (respondidos, con error o vencidos) y
   * nadie atendió. Cada uno se RECLAMA con un compare-and-set sobre
   * `botFollowupAt`: con varias réplicas, solo una le escribe al paciente.
   */
  async reclamarSeguimientos(
    ahora: Date,
    timeZoneDe: (organizationId: string) => Promise<string | undefined>,
  ): Promise<SeguimientoHis[]> {
    const filas = await this.prisma.hisLookupRequest.findMany({
      where: {
        origin: 'BOT',
        botFollowupAt: null,
        status: { in: ['RESUELTA', 'ERROR', 'EXPIRADA'] },
        createdAt: {
          gte: new Date(
            ahora.getTime() - LIMITES_CONSULTA_BOT.seguimientoMaxMin * MS_MIN,
          ),
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: {
        id: true,
        organizationId: true,
        patientId: true,
        status: true,
        result: true,
      },
    });

    const salida: SeguimientoHis[] = [];
    for (const f of filas) {
      const { count } = await this.prisma.hisLookupRequest.updateMany({
        where: { id: f.id, botFollowupAt: null },
        data: { botFollowupAt: ahora },
      });
      if (count !== 1) continue; // otra réplica ya la tomó

      const senderId = await this.redis.get(claveRemitente(f.id));
      await this.redis.del(claveRemitente(f.id));
      if (!senderId || !f.patientId) continue;

      const status = f.status as SeguimientoHis['status'];
      const resultado =
        status === 'RESUELTA' ? leerResultadoGuardado(f.result) : null;
      // Una RESUELTA que no se puede leer es un error, no "el HIS no tiene nada".
      if (status === 'RESUELTA' && resultado?.kind !== 'BY_DOCUMENT') {
        salida.push({
          requestId: f.id,
          organizationId: f.organizationId,
          senderId,
          patientId: f.patientId,
          status: 'ERROR',
          nuevas: [],
          citasHis: 0,
        });
        continue;
      }
      const citasHis = resultado?.kind === 'BY_DOCUMENT' ? resultado.citas : [];
      salida.push({
        requestId: f.id,
        organizationId: f.organizationId,
        senderId,
        patientId: f.patientId,
        status,
        nuevas:
          status === 'RESUELTA'
            ? await this.nuevasParaMostrar({
                organizationId: f.organizationId,
                patientId: f.patientId,
                citasHis,
                ahora,
                timeZone: await timeZoneDe(f.organizationId),
              })
            : [],
        citasHis: citasHis.filter(
          (c) => c.titular === 'PACIENTE' || c.titular === 'MISMO_CON_CEROS',
        ).length,
      });
    }
    return salida;
  }

  /**
   * Lo que el HIS tiene y AgenIA no (`citasHisNuevas`), con nombres. Se compara
   * contra las citas de AgenIA de AHORA, no las del primer mensaje: si entre
   * medias llegó la cita por el alta en caliente, ya no es "nueva".
   */
  async nuevasParaMostrar(p: {
    organizationId: string;
    patientId: string;
    citasHis: CitaHisVista[];
    ahora: Date;
    timeZone?: string;
  }): Promise<CitaHisParaMostrar[]> {
    const { organizationId } = p;
    if (p.citasHis.length === 0) return [];
    const { desde } = ventanaConsultaBot(p.ahora, p.timeZone);

    const agenia = await this.prisma.appointment.findMany({
      where: {
        patientId: p.patientId,
        status: 'SCHEDULED',
        scheduleSlot: { startTime: { gte: desde } },
      },
      select: { scheduleSlot: { select: { startTime: true, doctorId: true } } },
    });
    const doctorIds = [...new Set(agenia.map((a) => a.scheduleSlot.doctorId))];
    const mapasAgenia = doctorIds.length
      ? await this.prisma.mirrorEntityMap.findMany({
          where: {
            organizationId,
            entityType: 'DOCTOR',
            agenIAId: { in: doctorIds },
          },
          select: { agenIAId: true, externalKey: true },
        })
      : [];
    const claveDe = new Map(
      mapasAgenia.map((m) => [m.agenIAId, m.externalKey]),
    );
    const nuevas = citasHisNuevas(
      p.citasHis,
      agenia.map((a) => ({
        startIso: a.scheduleSlot.startTime.toISOString(),
        doctorExternalKey: claveDe.get(a.scheduleSlot.doctorId) ?? null,
      })),
      desde,
    );
    if (nuevas.length === 0) return [];

    const [medico, servicio] = await Promise.all([
      this.etiquetas(
        organizationId,
        'DOCTOR',
        nuevas.map((c) => c.doctorExternalKey),
      ),
      this.etiquetas(
        organizationId,
        'SERVICE',
        nuevas.map((c) => c.serviceExternalKey),
      ),
    ]);
    return nuevas.map((c) => ({
      startIso: c.startIso,
      medico: medico.get(c.doctorExternalKey) ?? '',
      servicio: c.serviceExternalKey
        ? (servicio.get(c.serviceExternalKey) ?? '')
        : '',
    }));
  }

  /**
   * Clave del HIS → nombre para el paciente: el de AgenIA si está homologado;
   * si no, la etiqueta del mapeo. Nunca la clave cruda (no le dice nada).
   */
  private async etiquetas(
    organizationId: string,
    entityType: 'DOCTOR' | 'SERVICE',
    claves: (string | null)[],
  ): Promise<Map<string, string>> {
    const unicas = [...new Set(claves.filter((c): c is string => !!c))];
    if (unicas.length === 0) return new Map();
    const mapas = await this.prisma.mirrorEntityMap.findMany({
      where: { organizationId, entityType, externalKey: { in: unicas } },
      select: { agenIAId: true, externalKey: true, externalLabel: true },
    });
    const ids = mapas.map((m) => m.agenIAId);
    const nombrePorId = new Map<string, string>();
    if (ids.length > 0 && entityType === 'DOCTOR') {
      const perfiles = await this.prisma.doctorProfile.findMany({
        where: { id: { in: ids }, organizationId },
        select: { id: true, fullName: true, isFunctionalAgenda: true },
      });
      for (const d of perfiles) nombrePorId.set(d.id, doctorLabel(d));
    } else if (ids.length > 0) {
      const servicios = await this.prisma.medicalService.findMany({
        where: { id: { in: ids }, organizationId },
        select: { id: true, name: true },
      });
      for (const s of servicios) nombrePorId.set(s.id, s.name);
    }
    const salida = new Map<string, string>();
    for (const m of mapas) {
      const nombre =
        nombrePorId.get(m.agenIAId) || m.externalLabel?.trim() || '';
      if (nombre) salida.set(m.externalKey, nombre);
    }
    return salida;
  }
}
