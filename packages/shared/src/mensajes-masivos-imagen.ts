/**
 * ══════════════════════════════════════════════════════════════════════════
 * 📢 MENSAJES MASIVOS — la imagen del encabezado (docs/PLAN_MENSAJES_MASIVOS.md §7)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * La imagen viaja como encabezado de una plantilla de WhatsApp. Lo que Meta
 * exige: JPEG o PNG, máximo 5 MB (WebP es formato de sticker; GIF no se acepta).
 * Lo que conviene: proporción 1,91:1 (horizontal, por ejemplo 1200 × 628), al
 * menos 800 px de ancho, menos de 1 MB para que cargue con mala señal, sin
 * transparencias (se ven negras o blancas según el tema del teléfono) y con el
 * texto importante en el centro, que es lo que queda visible si se recorta.
 *
 * El navegador mide la imagen (`apps/web/lib/mensajes-masivos/imagen-navegador.ts`:
 * ancho, alto, peso, formato real por sus primeros bytes, transparencia, brillo y
 * nitidez) y aquí se decide qué decirle a la persona. La API vuelve a comprobar
 * formato y peso antes de subirla a Meta (`problemaDuroDeImagen`).
 *
 * Puro: sin base de datos ni APIs del navegador.
 */

export type FormatoImagen = 'JPEG' | 'PNG' | 'WEBP' | 'GIF' | 'HEIC' | 'BMP' | 'SVG' | 'DESCONOCIDO';

export interface MedidasImagen {
  formato: FormatoImagen;
  bytes: number;
  ancho: number;
  alto: number;
  /** Tiene píxeles transparentes (solo PNG/WebP/GIF). */
  transparencia?: boolean;
  /** GIF animado. */
  animada?: boolean;
  /** Brillo medio, 0 (negro) a 255 (blanco). */
  brillo?: number;
  /** Varianza del laplaciano sobre la imagen reducida: baja = borrosa. */
  nitidez?: number;
}

export type NivelImagen = 'ERROR' | 'AVISO' | 'SUGERENCIA' | 'BIEN';

export interface ObservacionImagen {
  id: string;
  nivel: NivelImagen;
  mensaje: string;
  /** `true` si «Optimizar» lo arregla (convertir, reducir, rellenar el fondo). */
  loArreglaOptimizar?: boolean;
  /** `true` si «Recortar a 1,91:1» lo arregla. */
  loArreglaRecortar?: boolean;
}

export interface EvaluacionImagen {
  observaciones: ObservacionImagen[];
  /** Sin ningún ERROR: Meta la acepta tal cual. */
  cumpleMeta: boolean;
  /** 0 a 100, para la pantalla. */
  puntaje: number;
  proporcion: number;
  /** Cómo se llama esa proporción («1,91:1 horizontal», «cuadrada», «vertical»). */
  forma: string;
}

export const REGLAS_IMAGEN = {
  maxBytesMeta: 5 * 1024 * 1024,
  bytesRecomendados: 1024 * 1024,
  anchoMinimo: 600,
  anchoRecomendado: 800,
  anchoMaximoUtil: 1600,
  proporcionIdeal: 1.91,
  /** Fuera de este rango la imagen se ve recortada o muy pequeña en el chat. */
  proporcionMin: 1.5,
  proporcionMax: 2.1,
  brilloMin: 45,
  brilloMax: 235,
  nitidezMin: 60,
} as const;

/** El formato real de un archivo por sus primeros bytes (no por la extensión, que puede mentir). */
export function formatoPorFirma(bytes: Uint8Array): FormatoImagen {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'JPEG';
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'PNG';
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return 'GIF';
  if (b(0) === 0x42 && b(1) === 0x4d) return 'BMP';
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45) return 'WEBP';
  const ftyp = String.fromCharCode(b(4), b(5), b(6), b(7));
  const marca = String.fromCharCode(b(8), b(9), b(10), b(11));
  if (ftyp === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heim|heis|avif)$/.test(marca)) return 'HEIC';
  const inicio = String.fromCharCode(...Array.from(bytes.slice(0, 64))).trimStart();
  if (inicio.startsWith('<svg') || inicio.startsWith('<?xml')) return 'SVG';
  return 'DESCONOCIDO';
}

export const MIME_DE_FORMATO: Partial<Record<FormatoImagen, 'image/jpeg' | 'image/png'>> = {
  JPEG: 'image/jpeg',
  PNG: 'image/png',
};

/** Lo que impide enviarla tal cual: formato o peso. `null` si Meta la acepta. */
export function problemaDuroDeImagen(formato: FormatoImagen, bytes: number): string | null {
  if (formato !== 'JPEG' && formato !== 'PNG') {
    return `WhatsApp solo acepta imágenes JPEG o PNG en el encabezado; esta es ${nombreDeFormato(formato)}.`;
  }
  if (bytes > REGLAS_IMAGEN.maxBytesMeta) {
    return `Pesa ${pesoLegible(bytes)}; WhatsApp acepta hasta 5 MB.`;
  }
  return null;
}

export function nombreDeFormato(f: FormatoImagen): string {
  const nombres: Record<FormatoImagen, string> = {
    JPEG: 'JPEG',
    PNG: 'PNG',
    WEBP: 'WebP',
    GIF: 'GIF',
    HEIC: 'HEIC (fotos de iPhone)',
    BMP: 'BMP',
    SVG: 'SVG',
    DESCONOCIDO: 'de un formato desconocido',
  };
  return nombres[f];
}

export function pesoLegible(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function nombreDeForma(proporcion: number): string {
  if (Math.abs(proporcion - REGLAS_IMAGEN.proporcionIdeal) <= 0.08) return '1,91:1 horizontal (la ideal)';
  if (Math.abs(proporcion - 16 / 9) <= 0.05) return '16:9 horizontal';
  if (Math.abs(proporcion - 1) <= 0.05) return 'cuadrada';
  if (proporcion > 1) return `horizontal (${proporcion.toFixed(2).replace('.', ',')}:1)`;
  return `vertical (1:${(1 / proporcion).toFixed(2).replace('.', ',')})`;
}

/** Qué decirle a la persona de su imagen, de lo más grave a lo que está bien. */
export function evaluarImagen(m: MedidasImagen): EvaluacionImagen {
  const obs: ObservacionImagen[] = [];
  const proporcion = m.alto > 0 ? m.ancho / m.alto : 0;
  const R = REGLAS_IMAGEN;

  if (m.formato !== 'JPEG' && m.formato !== 'PNG') {
    obs.push({
      id: 'FORMATO',
      nivel: 'ERROR',
      mensaje: `Es ${nombreDeFormato(m.formato)}: WhatsApp solo acepta JPEG o PNG. «Optimizar» la convierte a JPEG.`,
      loArreglaOptimizar: m.formato !== 'SVG' && m.formato !== 'DESCONOCIDO',
    });
  } else {
    obs.push({ id: 'FORMATO_OK', nivel: 'BIEN', mensaje: `Formato ${m.formato}: WhatsApp lo acepta.` });
  }
  if (m.animada) {
    obs.push({ id: 'ANIMADA', nivel: 'AVISO', mensaje: 'Es animada: en el encabezado solo se envía una imagen fija (el primer cuadro).', loArreglaOptimizar: true });
  }

  if (m.bytes > R.maxBytesMeta) {
    obs.push({ id: 'PESO_MAXIMO', nivel: 'ERROR', mensaje: `Pesa ${pesoLegible(m.bytes)}: WhatsApp acepta hasta 5 MB.`, loArreglaOptimizar: true });
  } else if (m.bytes > R.bytesRecomendados) {
    obs.push({
      id: 'PESO',
      nivel: 'AVISO',
      mensaje: `Pesa ${pesoLegible(m.bytes)}. Con menos de 1 MB carga rápido aunque la señal sea mala, y gasta menos datos del paciente.`,
      loArreglaOptimizar: true,
    });
  } else {
    obs.push({ id: 'PESO_OK', nivel: 'BIEN', mensaje: `Pesa ${pesoLegible(m.bytes)}: carga rápido.` });
  }

  if (m.ancho > 0 && m.ancho < R.anchoMinimo) {
    obs.push({
      id: 'RESOLUCION',
      nivel: 'AVISO',
      mensaje: `Mide ${m.ancho} × ${m.alto} px: se verá borrosa o pixelada. Use una de al menos ${R.anchoRecomendado} px de ancho (ideal 1200 × 628).`,
    });
  } else if (m.ancho > 0 && m.ancho < R.anchoRecomendado) {
    obs.push({ id: 'RESOLUCION_JUSTA', nivel: 'SUGERENCIA', mensaje: `Mide ${m.ancho} × ${m.alto} px. Sirve, pero con ${R.anchoRecomendado} px o más de ancho se ve más nítida.` });
  } else if (m.ancho > R.anchoMaximoUtil) {
    obs.push({
      id: 'RESOLUCION_DE_MAS',
      nivel: 'SUGERENCIA',
      mensaje: `Mide ${m.ancho} × ${m.alto} px, más de lo que muestra un celular. «Optimizar» la deja en ${R.anchoMaximoUtil} px de ancho y pesa menos.`,
      loArreglaOptimizar: true,
    });
  } else if (m.ancho > 0) {
    obs.push({ id: 'RESOLUCION_OK', nivel: 'BIEN', mensaje: `Mide ${m.ancho} × ${m.alto} px: buena resolución.` });
  }

  if (proporcion > 0 && (proporcion < R.proporcionMin || proporcion > R.proporcionMax)) {
    obs.push({
      id: 'PROPORCION',
      nivel: 'AVISO',
      mensaje:
        proporcion < 1
          ? `Es ${nombreDeForma(proporcion)}. En la conversación WhatsApp muestra el encabezado horizontal: se verá solo la franja del centro y lo de arriba y abajo (títulos, logos, fechas) puede quedar fuera hasta que la persona toque la imagen. Lo ideal es 1,91:1 (por ejemplo 1200 × 628).`
          : `Es ${nombreDeForma(proporcion)}. Lo ideal es 1,91:1 (por ejemplo 1200 × 628): así se ve completa en la conversación, sin recortes.`,
      loArreglaRecortar: true,
    });
  } else if (proporcion > 0) {
    obs.push({ id: 'PROPORCION_OK', nivel: 'BIEN', mensaje: `Proporción ${nombreDeForma(proporcion)}: se ve completa en la conversación.` });
  }

  if (m.transparencia) {
    obs.push({
      id: 'TRANSPARENCIA',
      nivel: 'AVISO',
      mensaje: 'Tiene partes transparentes: en el celular se ven negras o blancas según el tema, y un logo oscuro sobre fondo oscuro desaparece. «Optimizar» les pone fondo blanco.',
      loArreglaOptimizar: true,
    });
  }
  if (m.brillo !== undefined && m.brillo < R.brilloMin) {
    obs.push({ id: 'OSCURA', nivel: 'AVISO', mensaje: 'Es muy oscura: en un celular con poco brillo no se distingue. Use una versión más clara.' });
  } else if (m.brillo !== undefined && m.brillo > R.brilloMax) {
    obs.push({ id: 'CLARA', nivel: 'SUGERENCIA', mensaje: 'Es casi blanca: el texto claro o los colores suaves pueden perderse.' });
  }
  if (m.nitidez !== undefined && m.nitidez < R.nitidezMin && m.ancho >= R.anchoMinimo) {
    obs.push({ id: 'BORROSA', nivel: 'AVISO', mensaje: 'Parece desenfocada o con poco detalle. Si tiene texto, revise que se pueda leer en la vista previa.' });
  }

  const orden: Record<NivelImagen, number> = { ERROR: 0, AVISO: 1, SUGERENCIA: 2, BIEN: 3 };
  obs.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
  const errores = obs.filter((o) => o.nivel === 'ERROR').length;
  const avisos = obs.filter((o) => o.nivel === 'AVISO').length;
  const sugerencias = obs.filter((o) => o.nivel === 'SUGERENCIA').length;
  return {
    observaciones: obs,
    cumpleMeta: errores === 0,
    puntaje: Math.max(0, 100 - errores * 40 - avisos * 12 - sugerencias * 3),
    proporcion,
    forma: proporcion > 0 ? nombreDeForma(proporcion) : 'desconocida',
  };
}

/**
 * El recorte centrado a 1,91:1: el rectángulo más grande con esa proporción
 * dentro de la imagen.
 */
export function recorteIdeal(ancho: number, alto: number): { x: number; y: number; ancho: number; alto: number } {
  const ideal = REGLAS_IMAGEN.proporcionIdeal;
  if (ancho / alto > ideal) {
    const a = Math.round(alto * ideal);
    return { x: Math.round((ancho - a) / 2), y: 0, ancho: a, alto };
  }
  const h = Math.round(ancho / ideal);
  return { x: 0, y: Math.round((alto - h) / 2), ancho, alto: h };
}

/** El tamaño al optimizar: como mucho `anchoMaximoUtil` de ancho, sin agrandar. */
export function tamanoOptimizado(ancho: number, alto: number): { ancho: number; alto: number } {
  const max = REGLAS_IMAGEN.anchoMaximoUtil;
  if (ancho <= max) return { ancho, alto };
  return { ancho: max, alto: Math.round((alto * max) / ancho) };
}
