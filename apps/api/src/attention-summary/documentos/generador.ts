import { documentosDelResumen } from '@agenia/shared';
import type { DocumentoDelResumen, ResumenAtencionHis } from '@agenia/shared';
import type { Hoja, Medidor } from './plano';
import { armarHojas, type ContextoDocumentos } from './plantillas';
import { crearMedidor, hojaAPng, hojasAPdf } from './render';

/**
 * 📄 Genera los documentos de un resumen al momento (plan §3.9): no se guardan;
 * lo que se guarda es el contenido cifrado (D11). Un generador por petición.
 */
export interface Archivo {
  nombreArchivo: string;
  tipo: 'application/pdf' | 'image/png';
  datos: Buffer;
}

export class GeneradorDocumentos {
  private readonly medidor: Medidor = crearMedidor();
  private readonly docs: DocumentoDelResumen[];
  private readonly cache = new Map<string, Hoja[] | null>();

  constructor(
    private readonly resumen: ResumenAtencionHis,
    private readonly ctx: ContextoDocumentos,
  ) {
    this.docs = documentosDelResumen(resumen, { timeZone: ctx.timeZone });
  }

  private hojas(doc: DocumentoDelResumen): Hoja[] | null {
    if (!this.cache.has(doc.id)) {
      this.cache.set(
        doc.id,
        armarHojas(this.medidor, this.resumen, doc, this.ctx),
      );
    }
    return this.cache.get(doc.id) ?? null;
  }

  /** Los documentos con cuántas hojas tiene cada uno. */
  listar(): (DocumentoDelResumen & { hojas: number })[] {
    return this.docs.flatMap((d) => {
      const h = this.hojas(d);
      return h ? [{ ...d, hojas: h.length }] : [];
    });
  }

  private buscar(
    id: string,
  ): { doc: DocumentoDelResumen; hojas: Hoja[] } | null {
    const doc = this.docs.find((d) => d.id === id);
    const hojas = doc ? this.hojas(doc) : null;
    return doc && hojas ? { doc, hojas } : null;
  }

  async pdf(id: string, o: { clave?: string } = {}): Promise<Archivo | null> {
    const d = this.buscar(id);
    if (!d) return null;
    return {
      nombreArchivo: `${d.doc.nombreArchivo}.pdf`,
      tipo: 'application/pdf',
      datos: await hojasAPdf(d.hojas, {
        titulo: d.doc.titulo,
        autor: this.ctx.documentos.encabezado.nombre ?? this.ctx.nombreClinica,
        clave: o.clave,
      }),
    };
  }

  /** La hoja `hoja` (desde 1) de un documento, en PNG. */
  async png(id: string, hoja: number): Promise<Archivo | null> {
    const d = this.buscar(id);
    if (!d || !Number.isInteger(hoja) || hoja < 1 || hoja > d.hojas.length)
      return null;
    return {
      nombreArchivo: `${d.doc.nombreArchivo}_hoja-${hoja}-de-${d.hojas.length}.png`,
      tipo: 'image/png',
      datos: await hojaAPng(d.hojas[hoja - 1]),
    };
  }

  /** Todos los documentos en un solo PDF, cada uno desde una hoja nueva (el del correo lleva clave). */
  async pdfCompleto(o: { clave?: string } = {}): Promise<Archivo> {
    const hojas = this.docs.flatMap((d) => this.hojas(d) ?? []);
    const base = this.docs[0].nombreArchivo.replace(/^Resumen_/, 'Documentos_');
    return {
      nombreArchivo: `${base}.pdf`,
      tipo: 'application/pdf',
      datos: await hojasAPdf(hojas, {
        titulo: 'Documentos de la atención',
        autor: this.ctx.documentos.encabezado.nombre ?? this.ctx.nombreClinica,
        clave: o.clave,
      }),
    };
  }
}
