import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@agenia/database';
import {
  LIMITES_RESUMEN_ATENCION,
  agregarMedicion,
  documentoSinCerosIniciales,
  leerConfigResumenAtencion,
  puedeLeerDelHospital,
  serviciosALeer,
  validarMedicion,
  validarResumenAtencion,
} from '@agenia/shared';
import type {
  EstadoResumenesAgente,
  MedicionLecturaResumen,
  ResumenAtencionHis,
  ResumenesAtencionInput,
  ResumenesAtencionResult,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { SystemLogService } from '../system-log/system-log.service';

const MS_DIA = 86_400_000;
/** Si el documento casa con más de un paciente (con y sin ceros), no se elige ninguno. */
const MAX_CANDIDATOS = 2;

/**
 * Resúmenes de la atención que sube el agente del hospital
 * (docs/PLAN_RESUMEN_ATENCION.md, Fase 1: lectura en sombra).
 *
 * ═══ Dos frenos ═══
 * El agente pregunta en cada vuelta si debe leer (`estadoParaElAgente`). Con
 * «Leer del hospital» apagado le dice que no, y el agente no toca el HIS. Si
 * aun así llega un lote (un agente viejo, un interruptor que se apagó en medio
 * de la vuelta), se rechaza: nada clínico entra con el interruptor apagado.
 *
 * ═══ Qué se guarda ═══
 * El resumen completo, CIFRADO, con fecha de borrado a los 30 días (D11). La
 * llave es la historia del HIS: el mismo resumen dos veces no se duplica; uno
 * distinto (el médico agregó una orden, farmacia entregó) sube la versión (D10).
 * Un resumen que ya caducó no revive aunque el agente lo vuelva a mandar.
 * Nada del contenido va a los registros (logs).
 *
 * ═══ Revisión (cierre de la Fase 1) ═══
 * El administrador abre un resumen para compararlo con el HIS
 * (`abrirParaRevisar`). Se descifra solo aquí, porque la llave vive en la API,
 * y cada vez que alguien lo abre queda en la bitácora del sistema.
 */
@Injectable()
export class MirrorAttentionSummaryService {
  private readonly logger = new Logger(MirrorAttentionSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Optional() private readonly bitacora?: SystemLogService,
  ) {}

  /** GET /mirror/attention-summaries/state */
  async estadoParaElAgente(
    organizationId: string,
  ): Promise<EstadoResumenesAgente> {
    const fila = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: { resumenAtencion: true, resumenAtencionCursor: true },
    });
    const config = leerConfigResumenAtencion(fila?.resumenAtencion);
    const leer = puedeLeerDelHospital(config);
    return {
      leer,
      cursor: fila?.resumenAtencionCursor ?? null,
      calmaMinutos:
        config?.calmaMinutos ?? LIMITES_RESUMEN_ATENCION.calmaMinutosPorDefecto,
      maxPorLote: LIMITES_RESUMEN_ATENCION.maxPorLote,
      servicios: leer ? serviciosALeer(config) : [],
      camposPlantilla: leer ? (config?.camposPlantilla ?? null) : null,
    };
  }

  /** POST /mirror/attention-summaries */
  async recibirLote(
    organizationId: string,
    body: ResumenesAtencionInput,
  ): Promise<ResumenesAtencionResult> {
    if (!Array.isArray(body?.resumenes))
      throw new BadRequestException('resumenes debe ser un arreglo.');
    if (body.resumenes.length > LIMITES_RESUMEN_ATENCION.maxPorLote) {
      throw new BadRequestException(
        `Máximo ${LIMITES_RESUMEN_ATENCION.maxPorLote} resúmenes por lote.`,
      );
    }
    if (
      typeof body.nextCursor !== 'string' ||
      !/^\d{1,18}$/.test(body.nextCursor)
    ) {
      throw new BadRequestException(
        'nextCursor debe ser el número de una historia.',
      );
    }

    const fila = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: {
        resumenAtencion: true,
        resumenAtencionCursor: true,
        resumenAtencionMedicion: true,
      },
    });
    const config = leerConfigResumenAtencion(fila?.resumenAtencion);
    if (!puedeLeerDelHospital(config)) {
      throw new ForbiddenException(
        'La lectura de resúmenes de la atención está apagada para esta clínica.',
      );
    }
    const servicios = new Set(serviciosALeer(config));

    const resultado: ResumenesAtencionResult = {
      recibidos: body.resumenes.length,
      nuevos: 0,
      actualizados: 0,
      sinCambios: 0,
      rechazados: [],
    };

    for (const crudo of body.resumenes) {
      const numero = numeroDe(crudo);
      const invalido = validarResumenAtencion(crudo);
      if (invalido) {
        resultado.rechazados.push({ numero, motivo: invalido });
        continue;
      }
      const resumen = crudo;
      const servicio = resumen.historia.servicio?.trim() ?? '';
      // Mínimo necesario: solo entran los servicios de la matriz, aunque el
      // agente haya leído otro (la matriz pudo cambiar en medio de la vuelta).
      if (!servicios.has(servicio)) {
        resultado.rechazados.push({
          numero,
          motivo: 'servicio fuera de la matriz',
        });
        continue;
      }
      try {
        const efecto = await this.guardar(organizationId, resumen, servicio);
        resultado[efecto]++;
      } catch (error: unknown) {
        // El motivo, nunca el contenido.
        const motivo = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `No se guardó el resumen de la historia ${numero}: ${motivo}`,
        );
        resultado.rechazados.push({ numero, motivo: 'error al guardar' });
      }
    }

    await this.anotarVuelta(organizationId, {
      cursorActual: fila?.resumenAtencionCursor ?? null,
      siguiente: body.nextCursor,
      medicionGuardada: fila?.resumenAtencionMedicion ?? null,
      // Una medición rota no frena el lote: solo no se guarda.
      medicion: validarMedicion(body.medicion),
    });
    return resultado;
  }

  /**
   * GET /attention-summaries/:id (panel, solo ORG_ADMIN): el resumen descifrado
   * para compararlo con el HIS. Deja constancia de quién lo abrió.
   */
  async abrirParaRevisar(
    organizationId: string,
    id: string,
    quien: { userId: string; email: string },
  ): Promise<{
    resumen: ResumenAtencionHis;
    hisKey: string;
    version: number;
    attendedAt: string;
  }> {
    const fila = await this.prisma.attentionSummary.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        hisKey: true,
        version: true,
        attendedAt: true,
        content: true,
      },
    });
    if (!fila) throw new NotFoundException('El resumen no existe.');
    if (!fila.content) {
      throw new GoneException(
        'El contenido de este resumen ya se borró (se guarda 30 días).',
      );
    }
    const resumen = JSON.parse(
      this.crypto.decrypt(fila.content),
    ) as ResumenAtencionHis;

    await this.bitacora?.event({
      action: 'ATTENTION_SUMMARY_VIEWED',
      // El número de la historia, nunca el contenido.
      message: `${quien.email} abrió el resumen de la atención de la historia ${fila.hisKey} para revisarlo.`,
      userId: quien.userId,
      organizationId,
      metadata: { summaryId: fila.id, hisKey: fila.hisKey },
    });

    return {
      resumen,
      hisKey: fila.hisKey,
      version: fila.version,
      attendedAt: fila.attendedAt.toISOString(),
    };
  }

  private async guardar(
    organizationId: string,
    resumen: ResumenAtencionHis,
    servicio: string,
  ): Promise<'nuevos' | 'actualizados' | 'sinCambios'> {
    const hisKey = resumen.historia.numero;
    const json = JSON.stringify(resumen);
    const contentHash = createHash('sha256').update(json).digest('hex');

    const existente = await this.prisma.attentionSummary.findUnique({
      where: { organizationId_hisKey: { organizationId, hisKey } },
      select: { id: true, contentHash: true, purgedAt: true },
    });

    if (existente) {
      // Caducado: no revive. Igual: nada que hacer.
      if (existente.purgedAt || existente.contentHash === contentHash)
        return 'sinCambios';
      await this.prisma.attentionSummary.update({
        where: { id: existente.id },
        data: {
          content: this.crypto.encrypt(json),
          contentHash,
          version: { increment: 1 },
          serviceCode: servicio,
        },
      });
      return 'actualizados';
    }

    const ahora = new Date();
    const patientProfileId = await this.pacienteDelDocumento(
      organizationId,
      resumen.paciente.documento,
    );
    try {
      await this.prisma.attentionSummary.create({
        data: {
          organizationId,
          hisKey,
          patientProfileId,
          serviceCode: servicio,
          attendedAt: new Date(resumen.historia.guardadaIso),
          content: this.crypto.encrypt(json),
          contentHash,
          contentExpiresAt: new Date(
            ahora.getTime() +
              LIMITES_RESUMEN_ATENCION.retencionContenidoDias * MS_DIA,
          ),
        },
      });
      return 'nuevos';
    } catch (error: unknown) {
      // Dos lotes con la misma historia a la vez: el otro ya lo guardó.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return 'sinCambios';
      throw error;
    }
  }

  /** El paciente de AgenIA con ese documento (sin ceros a la izquierda); null si no hay uno solo. */
  private async pacienteDelDocumento(
    organizationId: string,
    documento: string,
  ): Promise<string | null> {
    const sinCeros = documentoSinCerosIniciales(documento.trim());
    if (!sinCeros) return null;
    const filas = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "PatientProfile"
       WHERE "organizationId" = ${organizationId}
         AND regexp_replace("cedula", '^0+', '') = ${sinCeros}
       LIMIT ${MAX_CANDIDATOS}`);
    return filas.length === 1 ? filas[0].id : null;
  }

  /**
   * El cursor solo avanza: un lote atrasado no hace releer lo ya leído. La
   * medición de la vuelta se suma a la del último día. Las dos columnas solo
   * las escribe el agente, así que la lectura previa no pisa al panel.
   */
  private async anotarVuelta(
    organizationId: string,
    v: {
      cursorActual: string | null;
      siguiente: string;
      medicionGuardada: unknown;
      medicion: MedicionLecturaResumen | null;
    },
  ): Promise<void> {
    const avanza =
      v.cursorActual === null ||
      !/^\d+$/.test(v.cursorActual) ||
      BigInt(v.siguiente) > BigInt(v.cursorActual);
    const data: Prisma.HospitalMirrorConfigUpdateInput = {};
    if (avanza) data.resumenAtencionCursor = v.siguiente;
    if (v.medicion) {
      data.resumenAtencionMedicion = agregarMedicion(
        v.medicionGuardada,
        v.medicion,
        new Date(),
      ) as unknown as Prisma.InputJsonValue;
    }
    if (Object.keys(data).length === 0) return;
    await this.prisma.hospitalMirrorConfig.update({
      where: { organizationId },
      data,
    });
  }
}

function numeroDe(x: unknown): string | null {
  if (typeof x !== 'object' || x === null) return null;
  const h = (x as { historia?: { numero?: unknown } }).historia;
  return typeof h?.numero === 'string' ? h.numero : null;
}
