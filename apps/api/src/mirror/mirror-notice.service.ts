import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  esDocumentoValido,
  normalizeDocumento,
  normalizePhoneToE164Co,
} from '@agenia/shared';
import type {
  HisNoticeCandidate,
  NoticeRequestDto,
  NoticeRosterInput,
  NoticeRosterResult,
} from '@agenia/shared';

/**
 * Avisos masivos, Fase 2 (fuente espejo) — EXCLUSIVO del driver
 * cnt-sanvicente-anserma. Ver
 * docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md §5.
 *
 * ═══ Por qué vive en `mirror/` y no en `mass-notice/` ═══
 * Los dos endpoints que este servicio atiende (`GET /mirror/notice-requests`,
 * `POST /mirror/notice-roster`) son parte del protocolo autenticado por
 * `MirrorAgentGuard` (token de agente, no JWT de staff) — exactamente el
 * mismo canal que `/mirror/catalog` o `/mirror/availability`. Separarlos en
 * otro módulo habría obligado a duplicar esa autenticación. La exclusividad
 * NO vive en el módulo (que sigue siendo genérico: cualquier driver futuro
 * podría, en teoría, implementarla) sino en `assertEnabled()`, que compara
 * `driverKey` como una cadena opaca — el mismo tipo de comprobación que ya
 * usa `blockedEpsRegimeCombos` en otros lados del motor genérico.
 *
 * ═══ Por qué NO comparte código literal con `apps/web/app/actions/avisos.ts` ═══
 * El plan (§3.3.4) describe "una sola función interna" de poblar lote. Eso
 * era cierto mientras Fase 1 vivía en un solo runtime (Next.js). Ahora que
 * Fase 2 corre en OTRO proceso (NestJS, con su propio PrismaService), no hay
 * forma de compartir una función a través de esa frontera sin inventar un
 * patrón nuevo en el repo (`packages/database` hoy es solo esquema/cliente,
 * nunca lógica de negocio compartida en runtime). Se opta por dos
 * implementaciones independientes con la MISMA regla observable —dedup por
 * (documento, hora de cita), mismo cálculo de `previousSentAt`, mismo
 * reemplazo idempotente de filas PENDIENTE— en vez de forzar el acoplamiento.
 */

interface AvisosMasivosConfig {
  enabled?: boolean;
  fuente?: 'CSV' | 'ESPEJO';
  maxDestinatariosPorLote?: number;
  ventanaDiasMax?: number;
}

const LOOKUP_CHUNK = 500;
const DEFAULT_MAX_POR_LOTE = 300;
const DEFAULT_VENTANA_DIAS_MAX = 30;

@Injectable()
export class MirrorNoticeService {
  private readonly logger = new Logger(MirrorNoticeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Llave 2 (driver exacto) + Llave 3 (`avisosMasivos.enabled` y
   * `fuente === 'ESPEJO'`), del lado del servidor — defensa en profundidad
   * incluso con un token de agente válido (§5: "si `avisosMasivos.enabled`
   * es falso o `fuente !== 'ESPEJO'`, el endpoint responde 403 aunque el
   * token del agente sea válido").
   */
  private async assertEnabled(
    organizationId: string,
    driverKey: string,
  ): Promise<AvisosMasivosConfig> {
    if (driverKey !== 'cnt-sanvicente-anserma') {
      throw new ForbiddenException(
        'Los avisos masivos no están disponibles para este driver.',
      );
    }
    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: { avisosMasivos: true },
    });
    const avisos = (config?.avisosMasivos ??
      null) as AvisosMasivosConfig | null;
    if (!avisos?.enabled || avisos.fuente !== 'ESPEJO') {
      throw new ForbiddenException(
        'Los avisos masivos por espejo no están habilitados para esta clínica.',
      );
    }
    return avisos;
  }

  /**
   * GET /mirror/notice-requests — lo que el agente pregunta en su lazo cada
   * ~30 s. Un tope bajo (5) a propósito: esto no es una cola de trabajo
   * general, son peticiones puntuales que un humano acaba de crear desde la
   * pantalla — si hay más de 5 pendientes, algo raro está pasando (o el
   * agente lleva rato caído) y no vale la pena que una sola vuelta intente
   * resolverlas todas.
   */
  async getPendingRequests(
    organizationId: string,
    driverKey: string,
  ): Promise<NoticeRequestDto[]> {
    await this.assertEnabled(organizationId, driverKey);

    const pending = await this.prisma.noticeRosterRequest.findMany({
      where: { organizationId, status: 'PENDIENTE' },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });

    return pending.map((r) => ({
      requestId: r.id,
      doctorExternalKey: r.doctorExternalKey,
      fromIso: r.fromIso.toISOString(),
      toIso: r.toIso.toISOString(),
    }));
  }

  /**
   * POST /mirror/notice-roster — el driver responde con lo que encontró.
   * Puebla `MassNoticeRecipient` con la MISMA semántica que el CSV/Excel de
   * Fase 1 (§3.3.4): reemplaza por completo las filas PENDIENTE del lote,
   * nunca las ya `ENVIADO`/`FALLIDO` (no debería haberlas mientras el lote
   * siga en BORRADOR, pero es defensivo).
   *
   * Idempotente por `requestId`: una petición ya `RESUELTA` no se vuelve a
   * aplicar — si el agente reintenta por una respuesta HTTP perdida, no
   * duplica destinatarios ni pisa una selección que el operador ya hizo.
   */
  async applyRoster(
    organizationId: string,
    driverKey: string,
    input: NoticeRosterInput,
  ): Promise<NoticeRosterResult> {
    const avisos = await this.assertEnabled(organizationId, driverKey);

    const request = await this.prisma.noticeRosterRequest.findFirst({
      where: { id: input.requestId, organizationId },
    });
    if (!request) {
      throw new NotFoundException('Petición de avisos no encontrada.');
    }
    if (request.status !== 'PENDIENTE') {
      // Ya resuelta (reintento del agente) o marcada con error — idempotente.
      return { requestId: request.id, applied: 0, truncated: false };
    }

    const maxPorLote = avisos.maxDestinatariosPorLote ?? DEFAULT_MAX_POR_LOTE;
    const truncated = input.candidates.length > maxPorLote;
    const candidatos = truncated
      ? input.candidates.slice(0, maxPorLote)
      : input.candidates;

    try {
      const rows = await this.buildRecipientRows(organizationId, candidatos);

      await this.prisma.$transaction(async (tx) => {
        await tx.massNoticeRecipient.deleteMany({
          where: { batchId: request.batchId, outcome: 'PENDIENTE' },
        });
        if (rows.length > 0) {
          await tx.massNoticeRecipient.createMany({
            data: rows.map((r) => ({ ...r, batchId: request.batchId })),
          });
        }
        const selectedCount = rows.filter((r) => r.selected).length;
        await tx.massNoticeBatch.update({
          where: { id: request.batchId },
          data: { candidates: rows.length, selected: selectedCount },
        });
        await tx.noticeRosterRequest.update({
          where: { id: request.id },
          data: { status: 'RESUELTA', resolvedAt: new Date(), truncated },
        });
      });

      this.logger.log(
        `Roster aplicado — org ${organizationId}, lote ${request.batchId}: ` +
          `${rows.length} candidato(s)${truncated ? ' (truncado)' : ''}.`,
      );

      return { requestId: request.id, applied: rows.length, truncated };
    } catch (error: unknown) {
      // A diferencia de `sendOne` (que absorbe fallos por destinatario), un
      // fallo AQUÍ es de la petición completa — se deja constancia en la
      // propia fila para que la pantalla, que hace polling, no se quede
      // esperando para siempre una respuesta que nunca llegará marcada RESUELTA.
      await this.prisma.noticeRosterRequest
        .update({
          where: { id: request.id },
          data: {
            status: 'ERROR',
            error: error instanceof Error ? error.message : String(error),
            resolvedAt: new Date(),
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /**
   * Normaliza los candidatos del HIS a filas de `MassNoticeRecipient`, con
   * el mismo cálculo de `previousSentAt`/`agenIAPatientId` que
   * `loadAvisosFileAction` (apps/web/app/actions/avisos.ts) hace para el
   * CSV/Excel — ver el docblock de la clase.
   */
  private async buildRecipientRows(
    organizationId: string,
    candidates: HisNoticeCandidate[],
  ): Promise<
    Array<{
      organizationId: string;
      patientDocument: string;
      patientName: string | null;
      phoneE164: string | null;
      phoneIsCompanion: boolean;
      appointmentAtUtc: Date;
      doctorExternalKey: string;
      serviceExternalKey: string | null;
      agenIAPatientId: string | null;
      previousSentAt: Date | null;
      previousSentBatchId: string | null;
      selected: boolean;
    }>
  > {
    // ── Normalizar + deduplicar por (documento, hora) — la misma llave que
    // usa el CSV. Una fila del HIS con documento inválido o sin fecha
    // interpretable se descarta: no hay a quién avisarle sin eso.
    const normalizadas = new Map<
      string,
      {
        candidate: HisNoticeCandidate;
        documento: string;
        appointmentAtUtc: Date;
      }
    >();
    for (const c of candidates) {
      const documento = normalizeDocumento(c.patientDocument);
      if (!esDocumentoValido(documento)) continue;
      const appointmentAtUtc = new Date(c.startTimeIso);
      if (Number.isNaN(appointmentAtUtc.getTime())) continue;
      const key = `${documento}|${appointmentAtUtc.toISOString()}`;
      // Si el HIS reporta la misma persona+hora dos veces, se queda la primera.
      if (!normalizadas.has(key)) {
        normalizadas.set(key, { candidate: c, documento, appointmentAtUtc });
      }
    }

    const documentos = [
      ...new Set([...normalizadas.values()].map((v) => v.documento)),
    ];

    const [pacientesAgenIA, previos] = await Promise.all([
      this.findPatientsByDocumento(organizationId, documentos),
      this.findPreviousSends(organizationId, [...normalizadas.values()]),
    ]);

    return [...normalizadas.values()].map(
      ({ candidate, documento, appointmentAtUtc }) => {
        const previo = previos.get(
          `${documento}|${appointmentAtUtc.toISOString()}`,
        );
        // §3.4/J.5, §5: sin celular propio, se rescata con el del acompañante
        // — SIEMPRE marcado en `phoneIsCompanion` para que la pantalla lo
        // etiquete, nunca en silencio (§3.5).
        let phoneE164 = candidate.patientPhone
          ? normalizePhoneToE164Co(candidate.patientPhone)
          : null;
        let phoneIsCompanion = false;
        if (!phoneE164 && candidate.companionPhone) {
          const companion = normalizePhoneToE164Co(candidate.companionPhone);
          if (companion) {
            phoneE164 = companion;
            phoneIsCompanion = true;
          }
        }
        return {
          organizationId,
          patientDocument: documento,
          patientName: candidate.patientFullName?.trim() || null,
          phoneE164,
          phoneIsCompanion,
          appointmentAtUtc,
          doctorExternalKey: candidate.doctorExternalKey,
          serviceExternalKey: candidate.serviceExternalKey ?? null,
          agenIAPatientId: pacientesAgenIA.get(documento) ?? null,
          previousSentAt: previo?.sentAt ?? null,
          previousSentBatchId: previo?.batchId ?? null,
          selected: !previo,
        };
      },
    );
  }

  private async findPatientsByDocumento(
    organizationId: string,
    documentos: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (let i = 0; i < documentos.length; i += LOOKUP_CHUNK) {
      const chunk = documentos.slice(i, i + LOOKUP_CHUNK);
      const found = await this.prisma.patientProfile.findMany({
        where: { organizationId, cedula: { in: chunk } },
        select: { id: true, cedula: true },
      });
      for (const p of found) result.set(p.cedula, p.id);
    }
    return result;
  }

  private async findPreviousSends(
    organizationId: string,
    rows: { documento: string; appointmentAtUtc: Date }[],
  ): Promise<Map<string, { sentAt: Date; batchId: string }>> {
    const result = new Map<string, { sentAt: Date; batchId: string }>();
    const documentos = [...new Set(rows.map((r) => r.documento))];
    if (documentos.length === 0) return result;

    for (let i = 0; i < documentos.length; i += LOOKUP_CHUNK) {
      const chunk = documentos.slice(i, i + LOOKUP_CHUNK);
      const previos = await this.prisma.massNoticeRecipient.findMany({
        where: {
          organizationId,
          outcome: 'ENVIADO',
          patientDocument: { in: chunk },
        },
        select: {
          patientDocument: true,
          appointmentAtUtc: true,
          sentAt: true,
          batchId: true,
        },
      });
      for (const p of previos) {
        if (!p.sentAt) continue;
        const key = `${p.patientDocument}|${p.appointmentAtUtc.toISOString()}`;
        const existing = result.get(key);
        if (!existing || p.sentAt > existing.sentAt) {
          result.set(key, { sentAt: p.sentAt, batchId: p.batchId });
        }
      }
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════
  // El lado de la pantalla: crear la petición.
  // ════════════════════════════════════════════════════════════════

  /**
   * Crea la petición que el agente resolverá — llamado desde
   * `apps/web/app/actions/avisos.ts` (NestJS lo expone como el resto del
   * CRUD de avisos, vía un endpoint propio, no `/mirror/*`: quien pide esto
   * es STAFF con JWT, no el agente con su token).
   *
   * `ventanaDiasMax` se comprueba aquí y no en la pantalla porque es una
   * baranda de negocio, no de formulario: "nadie cancela un año de agenda"
   * (§5) tiene que valer también si algún día hay un segundo cliente para
   * esta pantalla.
   */
  async createRequest(
    organizationId: string,
    input: {
      batchId: string;
      doctorExternalKey: string;
      fromIso: string;
      toIso: string;
    },
  ): Promise<{ requestId: string }> {
    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: { driverKey: true, enabled: true, avisosMasivos: true },
    });
    const avisos = (config?.avisosMasivos ??
      null) as AvisosMasivosConfig | null;
    if (
      !config?.enabled ||
      config.driverKey !== 'cnt-sanvicente-anserma' ||
      !avisos?.enabled ||
      avisos.fuente !== 'ESPEJO'
    ) {
      throw new ForbiddenException(
        'Los avisos masivos por espejo no están habilitados para esta clínica.',
      );
    }

    const from = new Date(input.fromIso);
    const to = new Date(input.toIso);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from >= to
    ) {
      throw new ForbiddenException('Rango de fechas inválido.');
    }
    const ventanaDiasMax = avisos.ventanaDiasMax ?? DEFAULT_VENTANA_DIAS_MAX;
    const dias = (to.getTime() - from.getTime()) / 86_400_000;
    if (dias > ventanaDiasMax) {
      throw new ForbiddenException(
        `El rango pedido (${Math.ceil(dias)} días) supera el máximo de ${ventanaDiasMax} — nadie cancela un año de agenda de una vez.`,
      );
    }

    const batch = await this.prisma.massNoticeBatch.findFirst({
      where: { id: input.batchId, organizationId },
      select: { id: true },
    });
    if (!batch) throw new NotFoundException('Lote no encontrado.');

    const created = await this.prisma.noticeRosterRequest.create({
      data: {
        organizationId,
        batchId: input.batchId,
        doctorExternalKey: input.doctorExternalKey,
        fromIso: from,
        toIso: to,
      },
    });

    return { requestId: created.id };
  }

  /** Para que la pantalla, con polling, sepa si ya llegó respuesta. */
  async getRequestStatus(
    organizationId: string,
    requestId: string,
  ): Promise<{
    status: string;
    error: string | null;
    truncated: boolean;
  } | null> {
    const request = await this.prisma.noticeRosterRequest.findFirst({
      where: { id: requestId, organizationId },
      select: { status: true, error: true, truncated: true },
    });
    return request ?? null;
  }
}
