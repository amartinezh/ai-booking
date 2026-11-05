/**
 * 📢 MENSAJES MASIVOS — medir y optimizar la imagen en el navegador
 * (docs/PLAN_MENSAJES_MASIVOS.md §7).
 *
 * `medirImagen` saca lo que `evaluarImagen` (@agenia/shared) necesita para dar
 * las recomendaciones: el formato REAL por los primeros bytes (la extensión puede
 * mentir), el peso, el tamaño, si tiene transparencias, el brillo medio y la
 * nitidez (varianza del laplaciano sobre una copia de 256 px: baja = borrosa).
 *
 * `optimizarImagen` la deja como la quiere WhatsApp: JPEG sin transparencias
 * (fondo blanco), como mucho 1600 px de ancho y, si se puede, por debajo de 1 MB;
 * con `recortar`, además, centrada en la proporción 1,91:1.
 *
 * Usa `createImageBitmap` y `<canvas>`: solo corre en el navegador.
 */
import {
    REGLAS_IMAGEN,
    formatoPorFirma,
    recorteIdeal,
    tamanoOptimizado,
    type MedidasImagen,
} from '@agenia/shared';

/** ¿Un GIF tiene más de un cuadro? (cuenta las extensiones de control gráfico). */
function esGifAnimado(bytes: Uint8Array): boolean {
    let cuadros = 0;
    for (let i = 0; i < bytes.length - 3; i++) {
        if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && ++cuadros > 1) return true;
    }
    return false;
}

export async function medirImagen(blob: Blob): Promise<MedidasImagen> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const formato = formatoPorFirma(bytes.subarray(0, 64));
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(blob);
    } catch {
        // El navegador no la puede abrir (HEIC en Chrome, un archivo dañado).
        return { formato, bytes: blob.size, ancho: 0, alto: 0 };
    }
    const { width, height } = bitmap;
    const escala = Math.min(1, 256 / Math.max(width, height));
    const w = Math.max(3, Math.round(width * escala));
    const h = Math.max(3, Math.round(height * escala));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        bitmap.close();
        return { formato, bytes: blob.size, ancho: width, alto: height };
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, w, h);
    const gris = new Float32Array(w * h);
    let suma = 0;
    let transparente = false;
    for (let i = 0; i < w * h; i++) {
        const [r, g, b, a] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
        if (a < 250) transparente = true;
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        gris[i] = y;
        suma += y;
    }
    // Varianza del laplaciano (Welford), sin los bordes.
    let n = 0;
    let media = 0;
    let m2 = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const c = y * w + x;
            const lap = 4 * gris[c] - gris[c - 1] - gris[c + 1] - gris[c - w] - gris[c + w];
            n++;
            const d = lap - media;
            media += d / n;
            m2 += d * (lap - media);
        }
    }
    return {
        formato,
        bytes: blob.size,
        ancho: width,
        alto: height,
        transparencia: formato !== 'JPEG' && transparente,
        animada: formato === 'GIF' && esGifAnimado(bytes),
        brillo: Math.round(suma / (w * h)),
        nitidez: n > 1 ? Math.round(m2 / (n - 1)) : undefined,
    };
}

function aBlob(canvas: HTMLCanvasElement, calidad: number): Promise<Blob> {
    return new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo convertir la imagen.'))), 'image/jpeg', calidad),
    );
}

export async function optimizarImagen(blob: Blob, opciones: { recortar?: boolean } = {}): Promise<Blob> {
    const bitmap = await createImageBitmap(blob);
    const area = opciones.recortar
        ? recorteIdeal(bitmap.width, bitmap.height)
        : { x: 0, y: 0, ancho: bitmap.width, alto: bitmap.height };
    const destino = tamanoOptimizado(area.ancho, area.alto);
    const canvas = document.createElement('canvas');
    canvas.width = destino.ancho;
    canvas.height = destino.alto;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no permite editar la imagen.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, destino.ancho, destino.alto);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, area.x, area.y, area.ancho, area.alto, 0, 0, destino.ancho, destino.alto);
    bitmap.close();
    let ultimo: Blob | null = null;
    for (const calidad of [0.86, 0.78, 0.7, 0.6]) {
        ultimo = await aBlob(canvas, calidad);
        if (ultimo.size <= REGLAS_IMAGEN.bytesRecomendados) return ultimo;
    }
    return ultimo as Blob;
}
