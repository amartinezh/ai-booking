import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@agenia/database';
import {
  LIMITES_RESUMEN_ATENCION,
  documentoSinCerosIniciales,
  leerConfigResumenAtencion,
  puedeLeerDelHospital,
  serviciosALeer,
  validarResumenAtencion,
} from '@agenia/shared';
import type {
  EstadoResumenesAgente,
  ResumenAtencionHis,
  ResumenesAtencionInput,
  ResumenesAtencionResult,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';

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
 */
@Injectable()
export class MirrorAttentionSummaryService {
  private readonly logger = new Logger(MirrorAttentionSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
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
      select: { resumenAtencion: true, resumenAtencionCursor: true },
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

    await this.avanzarCursor(
      organizationId,
      fila?.resumenAtencionCursor ?? null,
      body.nextCursor,
    );
    return resultado;
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

  /** El cursor solo avanza: un lote atrasado no hace releer lo ya leído. */
  private async avanzarCursor(
    organizationId: string,
    actual: string | null,
    siguiente: string,
  ): Promise<void> {
    if (
      actual !== null &&
      /^\d+$/.test(actual) &&
      BigInt(siguiente) <= BigInt(actual)
    )
      return;
    await this.prisma.hospitalMirrorConfig.update({
      where: { organizationId },
      data: { resumenAtencionCursor: siguiente },
    });
  }
}

function numeroDe(x: unknown): string | null {
  if (typeof x !== 'object' || x === null) return null;
  const h = (x as { historia?: { numero?: unknown } }).historia;
  return typeof h?.numero === 'string' ? h.numero : null;
}
