import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { hostname } from 'os';
import type { Prisma, TechAlert } from '@agenia/database';
import {
  CATALOGO_ALERTAS,
  ESTADOS_ALERTA,
  UMBRALES_ALERTAS,
  arranqueEnBucle,
  claveAlerta,
  enlacePanel,
  gravedadDeAlerta,
  motivoParaNoEnviar,
  sanitizarTextoAlerta,
  sinSonido,
  textoAviso,
  type EstadoAlerta,
  type GravedadAlerta,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { getErrorMessage } from '../common/error-message.util';
import { TechAlertConfigService } from './tech-alert-config.service';
import { TechAlertDispatcher } from './tech-alert.dispatcher';
import type { TechAlertInput } from './tech-alerts.types';

const MS_MIN = 60_000;
/**
 * Lo que se abre en la misma vuelta de un chequeo va en UN mensaje: se espera
 * este rato antes de despachar, en vez de mandar uno por cada `avisar`.
 */
const AGRUPAR_MS = 3_000;
/** Tope de claves que se recuerdan en memoria cuando la base no responde. */
const MAX_SIN_BASE = 200;

const esP2002 = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === 'P2002';

export interface TechAlertListResult {
  rows: TechAlert[];
  total: number;
}

/**
 * La puerta de entrada de las alertas técnicas (docs/PLAN_ALERTAS_TECNICAS.md
 * §3.5). Los chequeos llaman `avisar` cuando algo falla y `resolver` cuando se
 * recupera; aquí se registra el problema y el despachador decide qué mandar.
 *
 * ═══ Reglas que importan ═══
 *  · NUNCA lanza: quien avisa es un cron o un filtro de errores, y una alerta que
 *    falla no puede tumbar lo que la disparó.
 *  · Un problema ABIERTO por clave (índice único parcial): el mismo fallo suma
 *    ocurrencias en la misma fila. Un evento suelto (un 5xx) se cuenta en la fila
 *    de la última hora en vez de abrir otra.
 *  · Si la base no responde, se avisa DIRECTO con la configuración en memoria y una
 *    antirrepetición pequeña en memoria: la base caída es justo lo más grave.
 *  · 🔒 Título, detalle y fuente se sanitizan antes de guardarse.
 */
@Injectable()
export class TechAlertService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TechAlertService.name);
  private vueltaProgramada: NodeJS.Timeout | null = null;
  /** Clave → última vez que se avisó sin base. */
  private readonly sinBase = new Map<string, number>();
  /** Crones que esta réplica vio fallar y aún no vio salir bien. */
  private readonly cronesFallando = new Set<string>();
  /** Crones que ya pasaron por `cronBien` al menos una vez desde el arranque. */
  private readonly cronesVistos = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TechAlertConfigService,
    private readonly dispatcher: TechAlertDispatcher,
  ) {}

  onModuleDestroy(): void {
    if (this.vueltaProgramada) clearTimeout(this.vueltaProgramada);
    this.vueltaProgramada = null;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.registrarArranque();
  }

  /**
   * Cada arranque es un aviso sin sonido (sirve de aviso de despliegue), y dos en
   * diez minutos son un bucle de reinicios: Docker la levanta (`unless-stopped`) y
   * nadie se entera de que se está cayendo. Nunca lanza.
   */
  async registrarArranque(ahora: Date = new Date()): Promise<void> {
    try {
      const previo = await this.prisma.techAlert.findFirst({
        where: { kind: 'API_ARRANCO' },
        orderBy: { lastSeenAt: 'desc' },
        select: { lastSeenAt: true },
      });
      if (
        previo &&
        arranqueEnBucle([previo.lastSeenAt.toISOString()], ahora.toISOString())
      ) {
        await this.avisar({
          kind: 'REINICIOS_EN_BUCLE',
          dedupeKey: claveAlerta.reiniciosEnBucle(),
          title: 'API',
          detail: `Arrancó otra vez a los ${Math.max(
            1,
            Math.round(
              (ahora.getTime() - previo.lastSeenAt.getTime()) / MS_MIN,
            ),
          )} min del arranque anterior. Revise los logs del contenedor (agenia logs api).`,
          fuente: 'arranque de la API',
        });
      }
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo revisar el arranque anterior: ${getErrorMessage(error)}`,
      );
    }
    await this.avisar({
      kind: 'API_ARRANCO',
      dedupeKey: claveAlerta.arranque(),
      title: 'API',
      detail: `Proceso ${process.pid} en ${hostname()}. Versión: ${
        process.env.AGENIA_VERSION?.trim() || 'sin registrar'
      }.`,
      fuente: 'arranque de la API',
    });
  }

  /**
   * Un cron falló: problema `cron:<nombre>`, que sube a crítico a la tercera
   * seguida (`gravedadDeAlerta`). El detalle es el mensaje del error, sanitizado.
   * Nunca lanza.
   */
  async cronFallo(
    nombre: string,
    titulo: string,
    error: unknown,
  ): Promise<void> {
    this.cronesFallando.add(nombre);
    await this.avisar({
      kind: 'CRON_FALLO',
      dedupeKey: claveAlerta.cron(nombre),
      title: titulo,
      detail: getErrorMessage(error).slice(0, 300),
      fuente: `cron «${nombre}»`,
    });
  }

  /**
   * El cron salió bien. Solo toca la base al cambiar de estado (fallaba y ya no)
   * y la primera vez tras el arranque, para cerrar lo que otro proceso dejó
   * abierto: un cron de cada 5 segundos no puede escribir en la base cada 5
   * segundos solo para decir que está bien. Nunca lanza.
   */
  async cronBien(nombre: string): Promise<void> {
    if (this.cronesVistos.has(nombre) && !this.cronesFallando.has(nombre)) {
      return;
    }
    this.cronesVistos.add(nombre);
    this.cronesFallando.delete(nombre);
    await this.resolver(claveAlerta.cron(nombre));
  }

  /** Registra el problema (o el evento) y pide una vuelta. Nunca lanza. */
  async avisar(input: TechAlertInput): Promise<void> {
    try {
      await this.registrar(input);
      this.programarVuelta();
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo registrar la alerta ${input.dedupeKey} (${getErrorMessage(error)}): se avisa sin la base.`,
      );
      await this.avisarSinBase(input).catch((e: unknown) =>
        this.logger.error(
          `Tampoco se pudo avisar sin base: ${getErrorMessage(e)}`,
        ),
      );
    }
  }

  /** El problema dejó de cumplirse. Nunca lanza. */
  async resolver(dedupeKey: string): Promise<void> {
    this.sinBase.delete(dedupeKey);
    try {
      const r = await this.prisma.techAlert.updateMany({
        where: { dedupeKey, status: 'ABIERTA' },
        data: { status: 'RESUELTA', resolvedAt: new Date() },
      });
      if (r.count > 0) this.programarVuelta();
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo resolver la alerta ${dedupeKey}: ${getErrorMessage(error)}`,
      );
    }
  }

  /** La bitácora del panel, lo más reciente primero. */
  async listar(filtro: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<TechAlertListResult> {
    const where: Prisma.TechAlertWhereInput = ESTADOS_ALERTA.includes(
      filtro.status as EstadoAlerta,
    )
      ? { status: filtro.status }
      : {};
    const take = Math.min(Math.max(filtro.limit ?? 50, 1), 200);
    const skip = Math.max(filtro.offset ?? 0, 0);
    const [rows, total] = await Promise.all([
      this.prisma.techAlert.findMany({
        where,
        orderBy: { firstSeenAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.techAlert.count({ where }),
    ]);
    return { rows, total };
  }

  // ── internos ────────────────────────────────────────────────────────────

  private async registrar(input: TechAlertInput): Promise<void> {
    const def = CATALOGO_ALERTAS[input.kind];
    const ahora = new Date();
    const comun = {
      kind: input.kind,
      category: input.category ?? def.categoria,
      title:
        sanitizarTextoAlerta(input.title, UMBRALES_ALERTAS.maxTitulo) ||
        def.titulo,
      detail: sanitizarTextoAlerta(input.detail) || null,
      organizationId: input.organizationId ?? null,
      organizationName: input.organizationName?.trim() || null,
      serviceIncidentId: input.serviceIncidentId ?? null,
    };
    const fuente = sanitizarTextoAlerta(input.fuente, 80);
    const meta = fuente ? ({ fuente } as Prisma.InputJsonValue) : undefined;

    if (def.evento) {
      const previo = await this.prisma.techAlert.findFirst({
        where: {
          dedupeKey: input.dedupeKey,
          status: 'EVENTO',
          firstSeenAt: {
            gt: new Date(
              ahora.getTime() - UMBRALES_ALERTAS.evento.ventanaMin * MS_MIN,
            ),
          },
        },
        orderBy: { firstSeenAt: 'desc' },
        select: { id: true },
      });
      if (previo) {
        await this.prisma.techAlert.update({
          where: { id: previo.id },
          // El detalle, el último: un arranque repetido dice qué proceso es ahora.
          data: {
            occurrences: { increment: 1 },
            lastSeenAt: ahora,
            ...(comun.detail ? { detail: comun.detail } : {}),
          },
        });
        return;
      }
      await this.prisma.techAlert.create({
        data: {
          ...comun,
          dedupeKey: input.dedupeKey,
          status: 'EVENTO',
          severity: input.severity ?? def.gravedad,
          meta,
        },
      });
      return;
    }

    const abierta = await this.buscarAbierta(input.dedupeKey);
    if (abierta) return this.actualizarAbierta(abierta, input, comun, ahora);
    try {
      await this.prisma.techAlert.create({
        data: {
          ...comun,
          dedupeKey: input.dedupeKey,
          status: 'ABIERTA',
          severity: input.severity ?? gravedadDeAlerta(input.kind, 1),
          meta,
        },
      });
    } catch (error: unknown) {
      // Otra réplica la abrió en el mismo instante: se suma a la suya.
      if (!esP2002(error)) throw error;
      const ya = await this.buscarAbierta(input.dedupeKey);
      if (ya) await this.actualizarAbierta(ya, input, comun, ahora);
    }
  }

  private buscarAbierta(dedupeKey: string) {
    return this.prisma.techAlert.findFirst({
      where: { dedupeKey, status: 'ABIERTA' },
      select: { id: true, occurrences: true, firstSeenAt: true },
    });
  }

  /**
   * El mismo problema otra vez: suma una ocurrencia y deja el estado ACTUAL (un
   * servicio degradado que se cae pasa a «caído» y crítico). Si la gravedad subió
   * por encima de la avisada, el despachador avisa de nuevo («empeoró»).
   */
  private async actualizarAbierta(
    abierta: { id: string; occurrences: number; firstSeenAt: Date },
    input: TechAlertInput,
    comun: {
      kind: string;
      category: string;
      title: string;
      detail: string | null;
    },
    ahora: Date,
  ): Promise<void> {
    const ocurrencias = abierta.occurrences + 1;
    await this.prisma.techAlert.update({
      where: { id: abierta.id },
      data: {
        kind: comun.kind,
        category: comun.category,
        title: comun.title,
        ...(comun.detail ? { detail: comun.detail } : {}),
        severity:
          input.severity ??
          gravedadDeAlerta(input.kind, ocurrencias, {
            desdeIso: abierta.firstSeenAt.toISOString(),
            ahoraIso: ahora.toISOString(),
          }),
        occurrences: { increment: 1 },
        lastSeenAt: ahora,
      },
    });
  }

  /** Unos segundos y una vuelta: lo de la misma vuelta del chequeo sale junto. */
  private programarVuelta(): void {
    if (this.vueltaProgramada) return;
    this.vueltaProgramada = setTimeout(() => {
      this.vueltaProgramada = null;
      void this.dispatcher.vuelta();
    }, AGRUPAR_MS);
    this.vueltaProgramada.unref?.();
  }

  /**
   * La base no respondió: se avisa con la copia en memoria. Un problema, una vez
   * hasta que se resuelva o pase el tiempo del recordatorio; un evento, una vez por
   * hora. No queda en la bitácora, y el mensaje lo dice.
   */
  private async avisarSinBase(input: TechAlertInput): Promise<void> {
    const canal = await this.config.canal();
    if (!canal) return;
    const def = CATALOGO_ALERTAS[input.kind];
    const ahora = new Date();
    const ahoraIso = ahora.toISOString();
    if (
      motivoParaNoEnviar(
        input.category ?? def.categoria,
        {
          enabled: canal.enabled,
          categories: canal.antirruido.categories,
          mutedUntilIso: canal.mutedUntilIso,
        },
        ahoraIso,
      )
    ) {
      return;
    }

    const ventanaMin = def.evento
      ? UMBRALES_ALERTAS.evento.ventanaMin
      : canal.antirruido.reminderMinutes;
    const ultimo = this.sinBase.get(input.dedupeKey);
    if (
      ultimo !== undefined &&
      ahora.getTime() - ultimo < ventanaMin * MS_MIN
    ) {
      return;
    }
    this.sinBase.set(input.dedupeKey, ahora.getTime());
    if (this.sinBase.size > MAX_SIN_BASE) {
      // Un Map recorre en orden de inserción: la primera es la más vieja.
      const [masVieja] = this.sinBase.keys();
      this.sinBase.delete(masVieja);
    }

    const severity: GravedadAlerta = input.severity ?? def.gravedad;
    const aviso = textoAviso({
      kind: input.kind,
      severity,
      title: input.title,
      detail: input.detail,
      organizationName: input.organizationName,
      firstSeenIso: ahoraIso,
      fuente: input.fuente,
      enlace: enlacePanel(canal.panelBase, '/super-admin/alertas'),
    });
    await this.config.enviar(
      `${aviso}\n(La base de datos no respondió: esta alerta no quedó en la bitácora.)`,
      {
        silent: sinSonido(severity, ahora, canal.antirruido),
        canal,
      },
    );
  }
}
