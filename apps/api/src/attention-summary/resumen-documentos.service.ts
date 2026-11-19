import {
  GoneException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  DEFAULT_TIMEZONE,
  documentoSinCerosIniciales,
  leerConfigDocumentos,
  normalizeDocumento,
} from '@agenia/shared';
import type { ResumenAtencionHis } from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { SystemLogService } from '../system-log/system-log.service';
import { GeneradorDocumentos, type Archivo } from './documentos/generador';

/**
 * La clave de los PDF que recibe el paciente (2026-11-19, a pedido del
 * administrador): su número de documento (cédula, tarjeta de identidad o
 * registro civil, el que tenga el HIS), sin puntos ni ceros a la izquierda. La
 * misma del correo (plan §3.4). Las imágenes no llevan clave: no se puede.
 * `undefined` si el HIS no trae documento (el PDF sale sin clave).
 */
export function claveDelPaciente(
  resumen: ResumenAtencionHis,
): string | undefined {
  return (
    documentoSinCerosIniciales(
      normalizeDocumento(resumen.paciente.documento),
    ) || undefined
  );
}

export type FormatoDocumento = 'pdf' | 'png';

/** Documento pedido: uno de la lista o `todo` (un PDF con todos). */
export const TODO = 'todo';

export interface DocumentoListado {
  id: string;
  titulo: string;
  hojas: number;
  nombreArchivo: string;
}

/**
 * 📄 Documentos del resumen de la atención (plan §3.9, Fase 2). Descifra el
 * resumen guardado y genera al momento el PDF o la imagen de cada documento;
 * nada de eso se guarda (D11).
 *
 * Lo usan el personal (vista previa para compararla con el papel del HIS) y la
 * página del paciente (`ResumenEnlacesService`).
 */
@Injectable()
export class ResumenDocumentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Optional() private readonly bitacora?: SystemLogService,
  ) {}

  /** El resumen descifrado. 404 si no es de la clínica; 410 si ya se borró (30 días). */
  async cargar(
    organizationId: string,
    id: string,
  ): Promise<{ hisKey: string; version: number; resumen: ResumenAtencionHis }> {
    const fila = await this.prisma.attentionSummary.findFirst({
      where: { id, organizationId },
      select: { hisKey: true, version: true, content: true },
    });
    if (!fila) throw new NotFoundException('El resumen no existe.');
    if (!fila.content) {
      throw new GoneException(
        'El contenido de este resumen ya se borró (se guarda 30 días).',
      );
    }
    return {
      hisKey: fila.hisKey,
      version: fila.version,
      resumen: JSON.parse(
        this.crypto.decrypt(fila.content),
      ) as ResumenAtencionHis,
    };
  }

  /** El generador con el encabezado, la zona horaria y la fecha de hoy de la clínica. */
  async generador(
    organizationId: string,
    resumen: ResumenAtencionHis,
  ): Promise<GeneradorDocumentos> {
    const [org, espejo] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, timezone: true },
      }),
      this.prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId },
        select: { resumenAtencion: true },
      }),
    ]);
    return new GeneradorDocumentos(resumen, {
      documentos: leerConfigDocumentos(espejo?.resumenAtencion),
      nombreClinica: org?.name ?? 'Hospital',
      ahora: new Date(),
      timeZone: org?.timezone || DEFAULT_TIMEZONE,
    });
  }

  listar(g: GeneradorDocumentos): DocumentoListado[] {
    return g.listar().map((d) => ({
      id: d.id,
      titulo: d.titulo,
      hojas: d.hojas,
      nombreArchivo: d.nombreArchivo,
    }));
  }

  /**
   * PDF de un documento (o de todos), o PNG de una hoja; `null` si no existe.
   * Con `clave`, el PDF va cifrado (lo que se descarga desde la página del
   * paciente); la vista previa del personal va sin clave.
   */
  archivo(
    g: GeneradorDocumentos,
    documento: string,
    formato: FormatoDocumento,
    hoja: number,
    clave?: string,
  ): Promise<Archivo | null> {
    if (formato === 'png') return g.png(documento, hoja);
    return documento === TODO
      ? g.pdfCompleto({ clave })
      : g.pdf(documento, { clave });
  }

  // ─── Vista previa del personal ──────────────────────────────────────────

  async listarParaPersonal(
    organizationId: string,
    id: string,
  ): Promise<{ documentos: DocumentoListado[] }> {
    const { resumen } = await this.cargar(organizationId, id);
    return {
      documentos: this.listar(await this.generador(organizationId, resumen)),
    };
  }

  async archivoParaPersonal(
    organizationId: string,
    id: string,
    pedido: { documento: string; formato: FormatoDocumento; hoja: number },
    quien: { userId: string; email: string },
  ): Promise<Archivo> {
    const { resumen, hisKey } = await this.cargar(organizationId, id);
    const g = await this.generador(organizationId, resumen);
    const a = await this.archivo(
      g,
      pedido.documento,
      pedido.formato,
      pedido.hoja,
    );
    if (!a) throw new NotFoundException('Ese documento no existe.');
    await this.bitacora?.event({
      action: 'ATTENTION_SUMMARY_DOCUMENT_VIEWED',
      // El número de la historia y del documento, nunca el contenido.
      message: `${quien.email} abrió ${a.nombreArchivo} (historia ${hisKey}).`,
      userId: quien.userId,
      organizationId,
      metadata: {
        summaryId: id,
        hisKey,
        documento: pedido.documento,
        formato: pedido.formato,
      },
    });
    return a;
  }
}
