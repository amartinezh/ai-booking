import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  LIMITES_RESUMEN_ATENCION,
  contenidoDelResumen,
  fechaHoraDocumento,
  leerConfigDocumentos,
  PIE_RESUMEN_POR_DEFECTO,
} from '@agenia/shared';
import type { ResumenAtencionHis, SeccionDelResumen } from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { SystemLogService } from '../system-log/system-log.service';
import type { Archivo } from './documentos/generador';
import {
  ResumenDocumentosService,
  type DocumentoListado,
  type FormatoDocumento,
} from './resumen-documentos.service';

const MS_DIA = 86_400_000;
/** D4: cinco fechas equivocadas bloquean el enlace una hora. */
export const INTENTOS_FECHA = 5;
const BLOQUEO_MS = 3_600_000;
/** Lo que dura la entrada tras verificar la fecha: lo justo para ver y descargar. */
const ACCESO_MS = 30 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface OrigenDeLaVisita {
  ip: string | null;
  navegador: string | null;
}

export type EstadoEnlace =
  | { estado: 'PIDE_FECHA'; hospital: string }
  | { estado: 'BLOQUEADO'; hospital: string; hastaIso: string }
  /** El HIS no tiene la fecha de nacimiento: no hay cómo verificar en línea. */
  | { estado: 'SIN_FECHA'; hospital: string }
  /** No existe, venció, se revocó o el contenido ya se borró. No se dice cuál. */
  | { estado: 'NO_DISPONIBLE' };

export type ResultadoVerificacion =
  | { ok: true; acceso: string; expiraIso: string }
  | { ok: false; estado: 'FECHA_INCORRECTA'; intentosRestantes: number }
  | { ok: false; estado: 'BLOQUEADO'; hastaIso: string }
  | { ok: false; estado: 'NO_DISPONIBLE' | 'SIN_FECHA' };

export interface ContenidoParaElPaciente {
  hospital: string;
  paciente: string;
  fechaConsulta: string;
  medico: string | null;
  /** El médico corrigió la historia después (D10). */
  actualizado: boolean;
  secciones: SeccionDelResumen[];
  pie: string;
  documentos: DocumentoListado[];
}

const hashDelToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * 🔗 La página del resumen (`/resumen/<token>`, plan §3.5).
 *
 * El enlace es un token de 128 bits; en la base solo queda su SHA-256. Para ver
 * el contenido hay que escribir la fecha de nacimiento del paciente (D4): con 5
 * equivocadas, el enlace se bloquea una hora. Verificada, la página recibe un
 * «acceso» firmado de 30 minutos (HMAC con una llave derivada de JWT_SECRET,
 * distinta de la de las sesiones) y lo presenta en cada petición.
 *
 * Cada apertura, verificación y descarga queda en `AttentionSummaryAccess` con
 * la IP y el navegador (la ley exige saber quién accedió a una historia).
 *
 * Fase 2: solo enlaces de PRUEBA, que crea el administrador desde el panel.
 */
@Injectable()
export class ResumenEnlacesService {
  private readonly logger = new Logger(ResumenEnlacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly documentos: ResumenDocumentosService,
    @Optional() private readonly bitacora?: SystemLogService,
  ) {}

  // ─── Enlace de prueba (panel, ORG_ADMIN) ────────────────────────────────

  async crearEnlaceDePrueba(
    organizationId: string,
    attentionSummaryId: string,
    quien: { userId: string; email: string },
  ): Promise<{ token: string; expiraIso: string }> {
    const fila = await this.prisma.attentionSummary.findFirst({
      where: { id: attentionSummaryId, organizationId, purgedAt: null },
      select: { id: true, hisKey: true, contentExpiresAt: true },
    });
    if (!fila)
      throw new NotFoundException(
        'El resumen no existe o su contenido ya se borró.',
      );

    const token = randomBytes(16).toString('base64url');
    // 30 días, sin pasar del día en que se borra el contenido.
    const expiresAt = new Date(
      Math.min(
        Date.now() + LIMITES_RESUMEN_ATENCION.retencionContenidoDias * MS_DIA,
        fila.contentExpiresAt.getTime(),
      ),
    );
    await this.prisma.attentionSummaryLink.create({
      data: {
        attentionSummaryId: fila.id,
        tokenHash: hashDelToken(token),
        purpose: 'PRUEBA',
        createdByUserId: quien.userId,
        expiresAt,
      },
    });
    await this.bitacora?.event({
      action: 'ATTENTION_SUMMARY_TEST_LINK_CREATED',
      message: `${quien.email} generó un enlace de prueba al resumen de la historia ${fila.hisKey}.`,
      userId: quien.userId,
      organizationId,
      metadata: {
        summaryId: fila.id,
        hisKey: fila.hisKey,
        expira: expiresAt.toISOString(),
      },
    });
    return { token, expiraIso: expiresAt.toISOString() };
  }

  // ─── Página pública ─────────────────────────────────────────────────────

  private async enlace(token: unknown) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const link = await this.prisma.attentionSummaryLink.findUnique({
      where: { tokenHash: hashDelToken(token) },
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        failedAttempts: true,
        lockedUntil: true,
        attentionSummary: {
          select: {
            id: true,
            organizationId: true,
            version: true,
            content: true,
            organization: { select: { name: true } },
          },
        },
      },
    });
    const ahora = Date.now();
    if (
      !link ||
      link.revokedAt ||
      link.expiresAt.getTime() <= ahora ||
      !link.attentionSummary.content
    )
      return null;
    return link;
  }

  private resumenDe(content: string): ResumenAtencionHis {
    return JSON.parse(this.crypto.decrypt(content)) as ResumenAtencionHis;
  }

  private async hospital(
    organizationId: string,
    respaldo: string,
  ): Promise<string> {
    const espejo = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: { resumenAtencion: true },
    });
    return (
      leerConfigDocumentos(espejo?.resumenAtencion).encabezado.nombre ??
      respaldo
    );
  }

  private async anotar(
    attentionSummaryId: string,
    linkId: string | null,
    kind:
      | 'ABRIR'
      | 'VERIFICAR_OK'
      | 'VERIFICAR_FALLO'
      | 'BLOQUEADO'
      | 'VER'
      | 'DOCUMENTO',
    origen: OrigenDeLaVisita,
    documentId: string | null = null,
  ): Promise<void> {
    try {
      await this.prisma.attentionSummaryAccess.create({
        data: {
          attentionSummaryId,
          linkId,
          kind,
          documentId,
          ip: origen.ip?.slice(0, 64) ?? null,
          userAgent: origen.navegador?.slice(0, 300) ?? null,
        },
      });
    } catch (error: unknown) {
      // La bitácora no puede tumbar la página; el motivo, nunca el contenido.
      this.logger.error(
        `No se anotó el acceso (${kind}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async abrir(token: unknown, origen: OrigenDeLaVisita): Promise<EstadoEnlace> {
    const link = await this.enlace(token);
    if (!link) return { estado: 'NO_DISPONIBLE' };
    const s = link.attentionSummary;
    const hospital = await this.hospital(s.organizationId, s.organization.name);
    await this.anotar(s.id, link.id, 'ABRIR', origen);
    if (link.lockedUntil && link.lockedUntil.getTime() > Date.now()) {
      return {
        estado: 'BLOQUEADO',
        hospital,
        hastaIso: link.lockedUntil.toISOString(),
      };
    }
    if (!fechaValida(this.resumenDe(s.content!).paciente.fechaNacimientoIso)) {
      return { estado: 'SIN_FECHA', hospital };
    }
    return { estado: 'PIDE_FECHA', hospital };
  }

  async verificar(
    token: unknown,
    fechaNacimiento: unknown,
    origen: OrigenDeLaVisita,
  ): Promise<ResultadoVerificacion> {
    const link = await this.enlace(token);
    if (!link) return { ok: false, estado: 'NO_DISPONIBLE' };
    const s = link.attentionSummary;
    const ahora = Date.now();

    if (link.lockedUntil && link.lockedUntil.getTime() > ahora) {
      await this.anotar(s.id, link.id, 'BLOQUEADO', origen);
      return {
        ok: false,
        estado: 'BLOQUEADO',
        hastaIso: link.lockedUntil.toISOString(),
      };
    }
    const real = this.resumenDe(s.content!).paciente.fechaNacimientoIso;
    if (!fechaValida(real)) return { ok: false, estado: 'SIN_FECHA' };

    if (
      typeof fechaNacimiento === 'string' &&
      fechaValida(fechaNacimiento) &&
      fechaNacimiento === real!.slice(0, 10)
    ) {
      await this.prisma.attentionSummaryLink.update({
        where: { id: link.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      await this.anotar(s.id, link.id, 'VERIFICAR_OK', origen);
      const expira = ahora + ACCESO_MS;
      return {
        ok: true,
        acceso: this.firmar(link.id, expira),
        expiraIso: new Date(expira).toISOString(),
      };
    }

    // Equivocada: suma un intento (atómico, por si llegan dos a la vez).
    const tras = await this.prisma.attentionSummaryLink.update({
      where: { id: link.id },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    await this.anotar(s.id, link.id, 'VERIFICAR_FALLO', origen);
    if (tras.failedAttempts >= INTENTOS_FECHA) {
      const hasta = new Date(ahora + BLOQUEO_MS);
      await this.prisma.attentionSummaryLink.update({
        where: { id: link.id },
        data: { failedAttempts: 0, lockedUntil: hasta },
      });
      return { ok: false, estado: 'BLOQUEADO', hastaIso: hasta.toISOString() };
    }
    return {
      ok: false,
      estado: 'FECHA_INCORRECTA',
      intentosRestantes: INTENTOS_FECHA - tras.failedAttempts,
    };
  }

  /** El enlace y su resumen, si el acceso firmado es de ese enlace y no venció. */
  private async conAcceso(token: unknown, acceso: unknown) {
    const link = await this.enlace(token);
    if (!link || !this.accesoValido(acceso, link.id)) return null;
    return link;
  }

  async contenido(
    token: unknown,
    acceso: unknown,
    origen: OrigenDeLaVisita,
  ): Promise<ContenidoParaElPaciente | null> {
    const link = await this.conAcceso(token, acceso);
    if (!link) return null;
    const s = link.attentionSummary;
    const resumen = this.resumenDe(s.content!);
    const g = await this.documentos.generador(s.organizationId, resumen);
    const [espejo, org] = await Promise.all([
      this.prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: s.organizationId },
        select: { resumenAtencion: true },
      }),
      this.prisma.organization.findUnique({
        where: { id: s.organizationId },
        select: { timezone: true },
      }),
    ]);
    const config = leerConfigDocumentos(espejo?.resumenAtencion);
    const timeZone = org?.timezone || undefined;
    await this.anotar(s.id, link.id, 'VER', origen);
    return {
      hospital: config.encabezado.nombre ?? s.organization.name,
      paciente: resumen.paciente.nombre,
      fechaConsulta: fechaHoraDocumento(resumen.historia.guardadaIso, timeZone),
      medico: resumen.medico.nombre,
      actualizado: s.version > 1,
      secciones: contenidoDelResumen(resumen, { timeZone }),
      pie: config.pie ?? PIE_RESUMEN_POR_DEFECTO,
      documentos: this.documentos.listar(g),
    };
  }

  async archivo(
    token: unknown,
    acceso: unknown,
    pedido: { documento: string; formato: FormatoDocumento; hoja: number },
    origen: OrigenDeLaVisita,
  ): Promise<Archivo | null> {
    const link = await this.conAcceso(token, acceso);
    if (!link) return null;
    const s = link.attentionSummary;
    const g = await this.documentos.generador(
      s.organizationId,
      this.resumenDe(s.content!),
    );
    const a = await this.documentos.archivo(
      g,
      pedido.documento,
      pedido.formato,
      pedido.hoja,
    );
    if (a) {
      await this.anotar(
        s.id,
        link.id,
        'DOCUMENTO',
        origen,
        `${pedido.documento}:${pedido.formato}${pedido.formato === 'png' ? `:${pedido.hoja}` : ''}`.slice(
          0,
          80,
        ),
      );
    }
    return a;
  }

  // ─── El acceso firmado ──────────────────────────────────────────────────

  private llave(): Buffer {
    const secreto = process.env.JWT_SECRET;
    if (!secreto) {
      throw new ServiceUnavailableException(
        'La página del resumen no está disponible.',
      );
    }
    // Derivada: un acceso no sirve como sesión del panel ni al revés.
    return createHash('sha256')
      .update(`resumen-atencion-acceso:${secreto}`)
      .digest();
  }

  private firmar(linkId: string, expira: number): string {
    const cuerpo = `${linkId}.${expira}`;
    const firma = createHmac('sha256', this.llave())
      .update(cuerpo)
      .digest('base64url');
    return `${cuerpo}.${firma}`;
  }

  private accesoValido(acceso: unknown, linkId: string): boolean {
    if (typeof acceso !== 'string' || acceso.length > 200) return false;
    const partes = acceso.split('.');
    if (partes.length !== 3) return false;
    const [id, expira, firma] = partes;
    if (
      id !== linkId ||
      !/^\d{13}$/.test(expira) ||
      Number(expira) <= Date.now()
    )
      return false;
    const esperada = createHmac('sha256', this.llave())
      .update(`${id}.${expira}`)
      .digest();
    let recibida: Buffer;
    try {
      recibida = Buffer.from(firma, 'base64url');
    } catch {
      return false;
    }
    return (
      recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
    );
  }
}

/** «AAAA-MM-DD» de una fecha que existe (no el 31 de febrero). */
export function fechaValida(x: string | null | undefined): boolean {
  const m = x ? FECHA.exec(x.slice(0, 10)) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}
