import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CatalogInput, CatalogResult } from '@agenia/shared';

/**
 * Guarda el catálogo del HIS que sube el agente: qué médicos y qué servicios
 * tiene el hospital, ANTES de que nadie decida a quién corresponden en AgenIA.
 *
 * ═══ Por qué existe ═══
 * `MirrorEntityMap` —la tabla de equivalencias— no tenía quien la escribiera:
 * cinco piezas del motor la leen y ninguna la produce. Y no se puede resolver
 * desde aquí porque la API no alcanza el HIS por diseño (plan §4.1): solo el
 * agente lo ve. Así que el catálogo viaja como viaja la agenda.
 *
 * ═══ Candidato ≠ equivalencia ═══
 * Esto NO escribe `MirrorEntityMap`. Un médico del hospital sin emparejar no es
 * una homologación a medias: es una fila de catálogo esperando que alguien la
 * mire. Decidir a quién corresponde es de una persona — escribir en la agenda
 * de un hospital merece que alguien vea la lista.
 */
@Injectable()
export class MirrorCatalogService {
  private readonly logger = new Logger(MirrorCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upload(
    organizationId: string,
    input: CatalogInput,
  ): Promise<CatalogResult> {
    const { kind, entries } = input;
    const ahora = new Date();

    const previas = await this.prisma.mirrorCatalogEntry.findMany({
      where: { organizationId, entityType: kind },
      select: { externalKey: true },
    });
    const yaConocidas = new Set(previas.map((p) => p.externalKey));

    let created = 0;
    let updated = 0;

    for (const entrada of entries) {
      const clave = entrada.externalKey?.trim();
      if (!clave) continue; // una entrada sin clave no se puede homologar

      await this.prisma.mirrorCatalogEntry.upsert({
        where: {
          organizationId_entityType_externalKey: {
            organizationId,
            entityType: kind,
            externalKey: clave,
          },
        },
        create: {
          organizationId,
          entityType: kind,
          externalKey: clave,
          label: entrada.label ?? clave,
          extra: entrada.extra ?? {},
          lastSeenAt: ahora,
        },
        update: {
          label: entrada.label ?? clave,
          extra: entrada.extra ?? {},
          lastSeenAt: ahora,
        },
      });

      if (yaConocidas.has(clave)) updated++;
      else created++;
    }

    // Lo que el HIS ya no reporta NO se borra.
    //
    // El conjunto de médicos con turnos futuros se mueve día a día — 30 en una
    // corrida y 25 al siguiente (bloques 30 y 32) — así que borrar por una
    // pasada perdería el rastro de alguien que vuelve la semana que viene. Se
    // queda con su `lastSeenAt` viejo, que es la señal honesta: "esto existía,
    // hoy no está".
    const vistas = new Set(
      entries.map((e) => e.externalKey?.trim()).filter(Boolean),
    );
    const vanished = [...yaConocidas].filter((k) => !vistas.has(k)).length;

    const homologated = await this.prisma.mirrorEntityMap.count({
      where: {
        organizationId,
        entityType: kind,
        externalKey: { in: [...vistas] },
      },
    });

    this.logger.log(
      `Catálogo ${kind} de la org ${organizationId}: ${created} nueva(s), ` +
        `${updated} refrescada(s), ${vanished} que el HIS ya no reporta, ` +
        `${homologated} de ${vistas.size} ya homologada(s).`,
    );

    return { kind, created, updated, vanished, homologated };
  }
}
