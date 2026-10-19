import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma, TechAlert } from '@agenia/database';
import {
  ORDEN_GRAVEDAD_ALERTA,
  UMBRALES_ALERTAS,
  cupoDeEnvio,
  decidirIntermitencia,
  enlacePanel,
  motivoParaNoEnviar,
  siguienteAccion,
  sinSonido,
  textoAviso,
  textoAvisoAgrupado,
  textoExcedente,
  textoIntermitente,
  textoRecordatorio,
  textoResolucion,
  textoResumenDiario,
  tocaResumenDiario,
  ventanaResumenDiario,
  type AccionAlerta,
  type AlertaVista,
  type CategoriaAlerta,
  type DatosMensajeAlerta,
  type EstadoAlerta,
  type GravedadAlerta,
  type TipoAlerta,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { getErrorMessage } from '../common/error-message.util';
import { TechAlertConfigService } from './tech-alert-config.service';
import type { TechAlertChannel } from './tech-alerts.types';

const MS_MIN = 60_000;
/** Tope de filas que se miran por vuelta. */
const MAX_FILAS = 200;
/** Una reclamación más vieja que esto es de una réplica que murió a mitad de envío. */
const RECLAMO_VENCE_MS = 2 * MS_MIN;

/** Por qué una fila no se anuncia más: ni recordatorios ni «resuelto». */
type Supresion = 'INTERMITENTE' | 'TOPE';

interface MetaAlerta {
  fuente?: string;
  suprimida?: Supresion;
  intermitenteAt?: string;
}

interface FilaDelEnvio {
  fila: TechAlert;
  accion: AccionAlerta;
  /** Se mezcla en `meta` si el envío sale. */
  meta?: MetaAlerta;
}

/** Un mensaje a Telegram y las filas que da por avisadas. */
interface Envio {
  texto: string;
  severidad: GravedadAlerta;
  filas: FilaDelEnvio[];
}

export interface ResumenVuelta {
  enviados: number;
  fallidos: number;
  suprimidos: number;
  resumenDiario: boolean;
}

const VACIA: ResumenVuelta = {
  enviados: 0,
  fallidos: 0,
  suprimidos: 0,
  resumenDiario: false,
};

const metaDe = (f: Pick<TechAlert, 'meta'>): MetaAlerta =>
  f.meta && typeof f.meta === 'object' && !Array.isArray(f.meta)
    ? (f.meta as MetaAlerta)
    : {};

const peorDe = (gravedades: GravedadAlerta[]): GravedadAlerta =>
  gravedades.reduce<GravedadAlerta>(
    (acc, g) =>
      ORDEN_GRAVEDAD_ALERTA[g] > ORDEN_GRAVEDAD_ALERTA[acc] ? g : acc,
    'INFO',
  );

/**
 * El despachador de las alertas técnicas (docs/PLAN_ALERTAS_TECNICAS.md §3.3 y §3.5).
 *
 * Cada minuto —y unos segundos después de cada `avisar`, para no esperar al
 * minuto— mira lo pendiente y decide qué mandar con las reglas de @agenia/shared:
 * el aviso (o el de nuevo, si empeoró), el recordatorio, el «resuelto».
 *
 * ═══ Cómo se cuida al equipo del ruido ═══
 *  · Los avisos de una misma vuelta van en UN mensaje.
 *  · Una clave que se abre y se cierra sin parar manda un «intermitente» y calla.
 *  · Tope general (`cupoDeEnvio`): lo que no cabe va en un «y N alertas más».
 *  · Lo apagado, lo de una categoría apagada y lo silenciado no sale, pero queda.
 *
 * ═══ Dos réplicas ═══
 * Cada fila se RECLAMA con un compare-and-set antes de enviar: solo una réplica la
 * manda. Si el envío falla, la reclamación se suelta y la vuelta siguiente reintenta.
 */
@Injectable()
export class TechAlertDispatcher {
  private readonly logger = new Logger(TechAlertDispatcher.name);
  private enCurso = false;
  /** Alguien pidió una vuelta mientras corría otra: se hace al terminar. */
  private otraVuelta = false;
  /** Mensajes que esta réplica mandó en los últimos minutos (para el tope). */
  private enviosRecientes: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TechAlertConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cadaMinuto(): Promise<void> {
    await this.vuelta();
  }

  /**
   * Retención de la bitácora: lo resuelto y los eventos de más de
   * `retencionDias` se borran. Lo ABIERTO nunca: sigue siendo un problema.
   * Nunca lanza.
   */
  @Cron('0 15 3 * * *', { timeZone: 'America/Bogota' })
  async limpiezaDiaria(): Promise<void> {
    await this.limpiar();
  }

  async limpiar(ahora: Date = new Date()): Promise<number> {
    try {
      const r = await this.prisma.techAlert.deleteMany({
        where: {
          status: { in: ['RESUELTA', 'EVENTO'] },
          lastSeenAt: {
            lt: new Date(
              ahora.getTime() -
                UMBRALES_ALERTAS.retencionDias * 24 * 60 * MS_MIN,
            ),
          },
        },
      });
      if (r.count > 0) {
        this.logger.log(
          `🧹 Bitácora de alertas: ${r.count} fila(s) vieja(s) borrada(s).`,
        );
      }
      return r.count;
    } catch (error: unknown) {
      this.logger.error(
        `La limpieza de la bitácora de alertas falló: ${getErrorMessage(error)}`,
      );
      return 0;
    }
  }

  /** Nunca lanza. */
  async vuelta(ahora: Date = new Date()): Promise<ResumenVuelta> {
    if (this.enCurso) {
      this.otraVuelta = true;
      return { ...VACIA };
    }
    this.enCurso = true;
    try {
      return await this.unaVuelta(ahora);
    } catch (error: unknown) {
      this.logger.error(
        `La vuelta de alertas técnicas falló: ${getErrorMessage(error)}`,
      );
      return { ...VACIA };
    } finally {
      this.enCurso = false;
      if (this.otraVuelta) {
        this.otraVuelta = false;
        setImmediate(() => void this.vuelta());
      }
    }
  }

  private async unaVuelta(ahora: Date): Promise<ResumenVuelta> {
    const canal = await this.config.canal({ fresco: true });
    if (!canal) return { ...VACIA };
    const resumen: ResumenVuelta = { ...VACIA };
    const ahoraIso = ahora.toISOString();

    resumen.resumenDiario = await this.resumenDiario(canal, ahora);

    const filas = await this.prisma.techAlert.findMany({
      where: {
        OR: [
          { status: 'ABIERTA' },
          {
            status: 'EVENTO',
            notifiedAt: null,
            firstSeenAt: {
              gt: new Date(
                ahora.getTime() - UMBRALES_ALERTAS.evento.ventanaMin * MS_MIN,
              ),
            },
          },
          {
            status: 'RESUELTA',
            notifiedAt: { not: null },
            resolutionNotifiedAt: null,
          },
        ],
      },
      orderBy: { firstSeenAt: 'asc' },
      take: MAX_FILAS,
    });

    const avisos: TechAlert[] = [];
    const envios: Envio[] = [];
    const filtro = {
      enabled: canal.enabled,
      categories: canal.antirruido.categories,
      mutedUntilIso: canal.mutedUntilIso,
    };

    for (const fila of filas) {
      const accion = siguienteAccion(
        this.vista(fila),
        canal.antirruido,
        ahoraIso,
      );
      if (!accion) continue;
      if (
        motivoParaNoEnviar(fila.category as CategoriaAlerta, filtro, ahoraIso)
      ) {
        continue;
      }

      const suprimida = metaDe(fila).suprimida;
      if (suprimida && accion !== 'AVISO') {
        // Intermitente o fuera del tope: su «resuelto» se da por hecho en silencio.
        if (accion === 'RESOLUCION' && (await this.reclamar(fila.id, ahora))) {
          await this.aplicar({ fila, accion }, ahora);
          resumen.suprimidos++;
        }
        continue;
      }

      if (!(await this.reclamar(fila.id, ahora))) continue;

      if (accion === 'AVISO' && fila.status === 'ABIERTA' && !fila.notifiedAt) {
        const decision = await this.intermitencia(fila, ahoraIso);
        if (decision === 'SUPRIMIR') {
          await this.aplicar(
            { fila, accion, meta: { suprimida: 'INTERMITENTE' } },
            ahora,
          );
          resumen.suprimidos++;
          continue;
        }
        if (decision === 'AVISAR') {
          const aperturas = await this.aperturasRecientes(fila, ahora);
          envios.push({
            texto: textoIntermitente(this.datos(fila, canal), aperturas.length),
            severidad: fila.severity as GravedadAlerta,
            filas: [
              {
                fila,
                accion,
                meta: { suprimida: 'INTERMITENTE', intermitenteAt: ahoraIso },
              },
            ],
          });
          continue;
        }
      }

      if (accion === 'AVISO') avisos.push(fila);
      else envios.push(this.individual(fila, accion, canal, ahoraIso));
    }

    if (avisos.length === 1) {
      envios.unshift(this.individual(avisos[0], 'AVISO', canal, ahoraIso));
    } else if (avisos.length > 1) {
      envios.unshift({
        texto: textoAvisoAgrupado(
          avisos.map((f) => this.datos(f, canal)),
          enlacePanel(canal.panelBase, '/super-admin/alertas'),
        ),
        severidad: peorDe(avisos.map((f) => f.severity as GravedadAlerta)),
        filas: avisos.map((fila) => ({ fila, accion: 'AVISO' as const })),
      });
    }

    // Tope general: lo que no cabe va en UN «y N alertas más».
    this.enviosRecientes = this.enviosRecientes.filter(
      (iso) =>
        Date.parse(iso) >
        ahora.getTime() - UMBRALES_ALERTAS.tope.ventanaMin * MS_MIN,
    );
    const cupo = cupoDeEnvio(this.enviosRecientes, ahoraIso);
    let aEnviar = envios;
    let sobrantes: Envio[] = [];
    if (envios.length > cupo) {
      aEnviar = cupo > 0 ? envios.slice(0, cupo - 1) : [];
      sobrantes = envios.slice(aEnviar.length);
    }

    for (const envio of aEnviar) {
      await this.enviar(envio, canal, ahora, resumen);
    }

    if (sobrantes.length > 0) {
      const filasSobrantes = sobrantes.flatMap((s) => s.filas);
      if (cupo > 0) {
        await this.enviar(
          {
            texto: textoExcedente(
              filasSobrantes.length,
              enlacePanel(canal.panelBase, '/super-admin/alertas'),
            ),
            severidad: peorDe(sobrantes.map((s) => s.severidad)),
            filas: filasSobrantes.map((f) => ({
              ...f,
              meta: { ...f.meta, suprimida: 'TOPE' as const },
            })),
          },
          canal,
          ahora,
          resumen,
        );
      } else {
        // Ni el «y N más» cabe: quedan pendientes para la vuelta siguiente.
        await Promise.all(filasSobrantes.map((f) => this.soltar(f.fila.id)));
      }
    }

    return resumen;
  }

  // ── El resumen diario (A13) ─────────────────────────────────────────────

  /**
   * A las 07:00, una vez: es el latido del canal. Se reclama en la base (dos
   * réplicas) y, si el envío falla, se devuelve la reclamación para reintentar.
   */
  private async resumenDiario(
    canal: TechAlertChannel,
    ahora: Date,
  ): Promise<boolean> {
    if (!canal.enabled || !canal.dailySummaryEnabled) return false;
    if (!tocaResumenDiario(canal.lastDailySummaryIso, ahora)) return false;
    const { toca, desde, hasta } = ventanaResumenDiario(ahora);

    const reclamo = await this.prisma.techAlertConfig.updateMany({
      where: {
        id: 'global',
        OR: [
          { lastDailySummaryAt: null },
          { lastDailySummaryAt: { lt: toca } },
        ],
      },
      data: { lastDailySummaryAt: ahora },
    });
    if (reclamo.count !== 1) return false;

    const [delDia, resueltos, abiertas] = await Promise.all([
      this.prisma.techAlert.findMany({
        where: {
          firstSeenAt: { gte: desde, lt: hasta },
          severity: { not: 'INFO' },
        },
        select: { severity: true },
      }),
      this.prisma.techAlert.count({
        where: { resolvedAt: { gte: desde, lt: hasta } },
      }),
      this.prisma.techAlert.findMany({
        where: { status: 'ABIERTA' },
        orderBy: { firstSeenAt: 'asc' },
        take: 50,
      }),
    ]);

    const texto = textoResumenDiario({
      diaIso: desde.toISOString(),
      nuevos: delDia.length,
      criticos: delDia.filter((f) => f.severity === 'CRITICA').length,
      resueltos,
      abiertos: abiertas.map((f) => this.datos(f, canal)),
      enlace: enlacePanel(canal.panelBase, '/super-admin/alertas'),
    });
    const r = await this.config.enviar(texto, { silent: true, canal });
    if (r.ok) {
      this.enviosRecientes.push(ahora.toISOString());
      return true;
    }
    await this.prisma.techAlertConfig.updateMany({
      where: { id: 'global', lastDailySummaryAt: ahora },
      data: {
        lastDailySummaryAt: canal.lastDailySummaryIso
          ? new Date(canal.lastDailySummaryIso)
          : null,
      },
    });
    return false;
  }

  // ── Envío y efectos ─────────────────────────────────────────────────────

  private async enviar(
    envio: Envio,
    canal: TechAlertChannel,
    ahora: Date,
    resumen: ResumenVuelta,
  ): Promise<void> {
    const r = await this.config.enviar(envio.texto, {
      silent: sinSonido(envio.severidad, ahora, canal.antirruido),
      canal,
    });
    if (r.ok) {
      this.enviosRecientes.push(ahora.toISOString());
      resumen.enviados++;
      for (const f of envio.filas) await this.aplicar(f, ahora);
      return;
    }
    resumen.fallidos++;
    for (const f of envio.filas) await this.fallo(f.fila, ahora, r.error);
  }

  /** Lo que el envío deja en la fila. También suelta la reclamación. */
  private async aplicar(f: FilaDelEnvio, ahora: Date): Promise<void> {
    const comun = {
      claimedAt: null,
      sendAttempts: { increment: 1 },
      lastSendAttemptAt: ahora,
      lastSendError: null,
      ...(f.meta
        ? {
            meta: { ...metaDe(f.fila), ...f.meta } as Prisma.InputJsonValue,
          }
        : {}),
    };
    const efecto =
      f.accion === 'AVISO'
        ? {
            notifiedAt: ahora,
            notifiedSeverity: f.fila.severity,
            reminderCount: 0,
            lastReminderAt: null,
          }
        : f.accion === 'RECORDATORIO'
          ? { reminderCount: { increment: 1 }, lastReminderAt: ahora }
          : { resolutionNotifiedAt: ahora };
    await this.prisma.techAlert.update({
      where: { id: f.fila.id },
      data: { ...comun, ...efecto },
    });
  }

  private async fallo(
    fila: TechAlert,
    ahora: Date,
    error: string,
  ): Promise<void> {
    await this.prisma.techAlert.update({
      where: { id: fila.id },
      data: {
        claimedAt: null,
        sendAttempts: { increment: 1 },
        lastSendAttemptAt: ahora,
        lastSendError: error.slice(0, 300),
      },
    });
  }

  /** Compare-and-set: solo una réplica se queda con la fila. */
  private async reclamar(id: string, ahora: Date): Promise<boolean> {
    const r = await this.prisma.techAlert.updateMany({
      where: {
        id,
        OR: [
          { claimedAt: null },
          { claimedAt: { lt: new Date(ahora.getTime() - RECLAMO_VENCE_MS) } },
        ],
      },
      data: { claimedAt: ahora },
    });
    return r.count === 1;
  }

  private async soltar(id: string): Promise<void> {
    await this.prisma.techAlert.updateMany({
      where: { id },
      data: { claimedAt: null },
    });
  }

  // ── Intermitencia ───────────────────────────────────────────────────────

  private aperturasRecientes(fila: TechAlert, ahora: Date) {
    return this.prisma.techAlert.findMany({
      where: {
        dedupeKey: fila.dedupeKey,
        status: { not: 'EVENTO' },
        firstSeenAt: {
          gt: new Date(
            ahora.getTime() -
              UMBRALES_ALERTAS.intermitencia.ventanaMin * MS_MIN,
          ),
        },
      },
      select: { firstSeenAt: true, meta: true },
    });
  }

  private async intermitencia(
    fila: TechAlert,
    ahoraIso: string,
  ): Promise<'NORMAL' | 'AVISAR' | 'SUPRIMIR'> {
    const recientes = await this.aperturasRecientes(fila, new Date(ahoraIso));
    const ultimoAviso =
      recientes
        .map((r) => metaDe(r).intermitenteAt)
        .filter((iso): iso is string => typeof iso === 'string')
        .sort()
        .pop() ?? null;
    return decidirIntermitencia(
      recientes.map((r) => r.firstSeenAt.toISOString()),
      ultimoAviso,
      ahoraIso,
    );
  }

  // ── Textos ──────────────────────────────────────────────────────────────

  private individual(
    fila: TechAlert,
    accion: AccionAlerta,
    canal: TechAlertChannel,
    ahoraIso: string,
  ): Envio {
    const datos = this.datos(fila, canal);
    const texto =
      accion === 'AVISO'
        ? textoAviso(datos, { empeoro: Boolean(fila.notifiedSeverity) })
        : accion === 'RECORDATORIO'
          ? textoRecordatorio(datos, {
              numero: fila.reminderCount + 1,
              de: canal.antirruido.maxReminders,
              ahoraIso,
            })
          : textoResolucion(
              datos,
              (fila.resolvedAt ?? new Date(ahoraIso)).toISOString(),
            );
    return {
      texto,
      severidad: fila.severity as GravedadAlerta,
      filas: [{ fila, accion }],
    };
  }

  private datos(fila: TechAlert, canal: TechAlertChannel): DatosMensajeAlerta {
    const kind = fila.kind as TipoAlerta;
    return {
      kind,
      severity: fila.severity as GravedadAlerta,
      title: fila.title,
      detail: fila.detail,
      organizationName: fila.organizationName,
      firstSeenIso: fila.firstSeenAt.toISOString(),
      occurrences: fila.occurrences,
      fuente: metaDe(fila).fuente ?? null,
      enlace: enlacePanel(
        canal.panelBase,
        kind === 'SERVICIO_CAIDO' || kind === 'SERVICIO_DEGRADADO'
          ? '/super-admin/monitor'
          : '/super-admin/alertas',
      ),
    };
  }

  private vista(fila: TechAlert): AlertaVista {
    return {
      kind: fila.kind as TipoAlerta,
      severity: fila.severity as GravedadAlerta,
      status: fila.status as EstadoAlerta,
      notifiedAtIso: fila.notifiedAt?.toISOString() ?? null,
      notifiedSeverity: fila.notifiedSeverity,
      resolvedAtIso: fila.resolvedAt?.toISOString() ?? null,
      resolutionNotifiedAtIso: fila.resolutionNotifiedAt?.toISOString() ?? null,
      reminderCount: fila.reminderCount,
      lastReminderAtIso: fila.lastReminderAt?.toISOString() ?? null,
    };
  }
}
