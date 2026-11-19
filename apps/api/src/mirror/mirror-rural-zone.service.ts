import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import {
  LIMITES_ZONA_RURAL,
  normalizarSabadoRural,
  type ZonaRuralEstado,
  type ZonaRuralLoteInput,
  type ZonaRuralLoteResult,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { documentoParaLaListaRural } from '../appointments/sabado-rural';

/**
 * Un instante como valor de columna `timestamp` (UTC sin zona, como guarda
 * Prisma). Un `Date` suelto en SQL crudo viaja como `timestamptz` y Postgres lo
 * pasa a la hora de la SESIÓN: en producción la base corre con
 * `TimeZone = America/Bogota` y quedaba (o se comparaba) 5 horas corrido
 * (2026-11-19: la lista rural se guardó con 15:07 en vez de 20:07 y el cierre
 * del envío no la encontró). Mismo criterio que `comoColumna` en la web.
 */
const comoColumna = (instante: Date) =>
  Prisma.sql`(${instante.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * 🌾 La lista de pacientes de zona rural que manda el agente (sábados solo para
 * la zona rural, 2026-11-19).
 *
 * El agente pregunta primero (`estado`): solo la manda si la clínica encendió
 * «Sábados: solo zona rural», y como mucho una vez al día. Con la regla apagada
 * no se guarda nada: un documento solo sale del hospital si hace falta.
 *
 * Cada envío completo REEMPLAZA la lista: todos sus lotes llevan el mismo
 * `inicioIso`; cada documento recibido queda con `seenAt = inicio`, y al llegar
 * el último lote se borran los que no vinieron (`seenAt < inicio`). Si el envío
 * se corta a la mitad, la lista anterior sigue en pie (lo nuevo ya marcado, lo
 * demás intacto) hasta el siguiente envío completo. Un envío que termina sin
 * ningún documento no borra nada: eso huele a una lectura rota del HIS, no a un
 * hospital sin pacientes del campo.
 */
@Injectable()
export class MirrorRuralZoneService {
  private readonly logger = new Logger(MirrorRuralZoneService.name);

  constructor(private readonly prisma: PrismaService) {}

  async estado(organizationId: string): Promise<ZonaRuralEstado> {
    const [settings, espejo] = await Promise.all([
      this.prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: { saturdayRuralSharePercent: true },
      }),
      this.prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId },
        select: { ruralListSyncedAt: true },
      }),
    ]);
    return {
      pedir:
        normalizarSabadoRural(settings?.saturdayRuralSharePercent) !== null,
      ultimaIso: espejo?.ruralListSyncedAt?.toISOString() ?? null,
    };
  }

  async recibirLote(
    organizationId: string,
    input: ZonaRuralLoteInput,
    ahora: Date = new Date(),
  ): Promise<ZonaRuralLoteResult> {
    const inicio = this.validar(input, ahora);

    // Con la regla apagada no se guarda nada (el agente no debería mandarla).
    if (!(await this.estado(organizationId)).pedir) {
      return { aceptados: 0, ignorado: true };
    }

    const documentos = [
      ...new Set(
        input.documentos
          .map((d) => documentoParaLaListaRural(String(d ?? '')))
          .filter((d): d is string => d !== null),
      ),
    ];

    if (documentos.length > 0) {
      // Uno solo por documento y clínica; si ya estaba, queda marcado como visto
      // en este envío (sin retroceder si llega tarde un lote de un envío viejo).
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO "RuralPatient" ("id", "organizationId", "document", "seenAt")
        SELECT gen_random_uuid()::text, ${organizationId}, d, ${comoColumna(inicio)}
          FROM unnest(${documentos}::text[]) AS d
        ON CONFLICT ("organizationId", "document")
        DO UPDATE SET "seenAt" = GREATEST("RuralPatient"."seenAt", EXCLUDED."seenAt")
      `);
    }

    if (!input.ultimo) return { aceptados: documentos.length };

    const total = await this.prisma.ruralPatient.count({
      where: { organizationId, seenAt: { gte: inicio } },
    });
    if (total === 0) {
      this.logger.warn(
        `Lista de zona rural de ${organizationId}: el envío terminó sin ningún documento; se conserva la anterior.`,
      );
      return { aceptados: 0, total: 0, conservada: true };
    }
    const borrados = await this.prisma.ruralPatient.deleteMany({
      where: { organizationId, seenAt: { lt: inicio } },
    });
    await this.prisma.hospitalMirrorConfig.update({
      where: { organizationId },
      data: { ruralListSyncedAt: ahora, ruralListCount: total },
    });
    this.logger.log(
      `Lista de zona rural de ${organizationId}: ${total} documento(s)` +
        (borrados.count > 0 ? `, ${borrados.count} que ya no vinieron` : '') +
        '.',
    );
    return { aceptados: documentos.length, total };
  }

  /** El inicio del envío, o 400 si el lote no se puede aceptar. */
  private validar(input: ZonaRuralLoteInput, ahora: Date): Date {
    if (!input || !Array.isArray(input.documentos)) {
      throw new BadRequestException('documentos debe ser un arreglo.');
    }
    if (input.documentos.length > LIMITES_ZONA_RURAL.MAX_LOTE) {
      throw new BadRequestException(
        `Como mucho ${LIMITES_ZONA_RURAL.MAX_LOTE} documentos por lote.`,
      );
    }
    if (typeof input.ultimo !== 'boolean') {
      throw new BadRequestException('ultimo debe ser true o false.');
    }
    const inicio = new Date(input.inicioIso);
    if (Number.isNaN(inicio.getTime())) {
      throw new BadRequestException('inicioIso debe ser una fecha válida.');
    }
    // El reloj del agente puede ir un poco adelantado, no una hora.
    if (inicio.getTime() > ahora.getTime() + 60 * 60 * 1000) {
      throw new BadRequestException('inicioIso no puede estar en el futuro.');
    }
    if (
      ahora.getTime() - inicio.getTime() >
      LIMITES_ZONA_RURAL.MAX_DURACION_ENVIO_MS
    ) {
      throw new BadRequestException(
        'Ese envío es demasiado viejo: empiece uno nuevo.',
      );
    }
    return inicio;
  }
}
