import { randomBytes } from 'crypto';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas';
import { HOJA, TAM, type Hoja, type Medidor } from './plano';

/**
 * Los dos motores que dibujan un plano (plano.ts): PDF con texto real
 * (pdfkit) e imagen PNG de cada hoja (@napi-rs/canvas). Usan la MISMA letra
 * (Noto Sans, licencia OFL, en ./fuentes) y el medidor sale de ella, así que
 * los renglones caben igual en los dos.
 */

const FUENTES = {
  normal: join(__dirname, 'fuentes', 'NotoSans-Regular.ttf'),
  negrita: join(__dirname, 'fuentes', 'NotoSans-Bold.ttf'),
};
const FAMILIA = {
  normal: 'AgenIA Noto Sans',
  negrita: 'AgenIA Noto Sans Bold',
};

/** 200 ppp: una hoja carta da 1.700 × 2.200 píxeles (plan §3.9). */
export const PPP_IMAGEN = 200;
const ESCALA = PPP_IMAGEN / 72;

const GRIS_MARCA = '#d6d6d6';
const ANGULO_MARCA = -35;

let fuentesEnCanvas = false;
function registrarFuentesEnCanvas(): void {
  if (fuentesEnCanvas) return;
  GlobalFonts.registerFromPath(FUENTES.normal, FAMILIA.normal);
  GlobalFonts.registerFromPath(FUENTES.negrita, FAMILIA.negrita);
  fuentesEnCanvas = true;
}

/** Mide con pdfkit, que lee la misma letra que dibuja; guarda lo ya medido. */
export function crearMedidor(): Medidor {
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.registerFont('normal', FUENTES.normal);
  doc.registerFont('negrita', FUENTES.negrita);
  const memo = new Map<string, number>();
  return {
    ancho(texto, tam, negrita) {
      const clave = `${negrita ? 1 : 0}|${tam}|${texto}`;
      let w = memo.get(clave);
      if (w === undefined) {
        w = doc
          .font(negrita ? 'negrita' : 'normal')
          .fontSize(tam)
          .widthOfString(texto);
        memo.set(clave, w);
      }
      return w;
    },
  };
}

export interface OpcionesPdf {
  titulo: string;
  autor: string;
  /** Con clave, el PDF se cifra (AES-256): para el correo (plan §3.4). */
  clave?: string;
  /** Solo para pruebas: sin comprimir, el texto se puede buscar en los bytes. */
  sinComprimir?: boolean;
}

/** Varias hojas (de uno o más documentos) en un solo PDF. */
export function hojasAPdf(hojas: Hoja[], o: OpcionesPdf): Promise<Buffer> {
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: 'LETTER',
    margin: 0,
    compress: !o.sinComprimir,
    info: { Title: o.titulo, Author: o.autor, Creator: 'AgenIA' },
    ...(o.clave
      ? {
          userPassword: o.clave,
          // El dueño: una clave al azar que nadie conoce; el paciente puede imprimir y copiar.
          ownerPassword: randomBytes(24).toString('hex'),
          pdfVersion: '1.7ext3' as const,
          permissions: {
            printing: 'highResolution' as const,
            copying: true,
            modifying: false,
          },
        }
      : {}),
  });
  doc.registerFont('normal', FUENTES.normal);
  doc.registerFont('negrita', FUENTES.negrita);

  const partes: Buffer[] = [];
  const listo = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
  });

  for (const hoja of hojas) {
    doc.addPage({ size: 'LETTER', margin: 0 });
    for (const e of hoja) {
      switch (e.tipo) {
        case 'marca': {
          const ancho = doc
            .font('negrita')
            .fontSize(TAM.marca)
            .widthOfString(e.texto);
          const cx = HOJA.ancho / 2;
          const cy = HOJA.alto / 2;
          doc.save();
          doc.rotate(ANGULO_MARCA, { origin: [cx, cy] });
          doc
            .fillColor(GRIS_MARCA)
            .text(e.texto, cx - ancho / 2, cy + TAM.marca * 0.35, {
              lineBreak: false,
              baseline: 'alphabetic',
            });
          doc.restore();
          doc.fillColor('#000000');
          break;
        }
        case 'texto':
          doc
            .font(e.negrita ? 'negrita' : 'normal')
            .fontSize(e.tam)
            .fillColor('#000000')
            .text(e.texto, e.x, e.base, {
              lineBreak: false,
              baseline: 'alphabetic',
            });
          break;
        case 'linea':
          doc
            .moveTo(e.x1, e.y1)
            .lineTo(e.x2, e.y2)
            .lineWidth(e.grosor)
            .strokeColor('#000000')
            .stroke();
          break;
        case 'imagen':
          doc.image(e.datos, e.x, e.y, { width: e.ancho, height: e.alto });
          break;
      }
    }
  }
  doc.end();
  return listo;
}

/** Una hoja como PNG a 200 ppp, fondo blanco. */
export async function hojaAPng(hoja: Hoja): Promise<Buffer> {
  registrarFuentesEnCanvas();
  const canvas = createCanvas(
    Math.round(HOJA.ancho * ESCALA),
    Math.round(HOJA.alto * ESCALA),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'alphabetic';

  for (const e of hoja) {
    switch (e.tipo) {
      case 'marca': {
        ctx.save();
        ctx.translate((HOJA.ancho / 2) * ESCALA, (HOJA.alto / 2) * ESCALA);
        ctx.rotate((ANGULO_MARCA * Math.PI) / 180);
        ctx.font = `${TAM.marca * ESCALA}px "${FAMILIA.negrita}"`;
        ctx.fillStyle = GRIS_MARCA;
        const ancho = ctx.measureText(e.texto).width;
        ctx.fillText(e.texto, -ancho / 2, TAM.marca * 0.35 * ESCALA);
        ctx.restore();
        break;
      }
      case 'texto':
        ctx.font = `${e.tam * ESCALA}px "${e.negrita ? FAMILIA.negrita : FAMILIA.normal}"`;
        ctx.fillStyle = '#000000';
        ctx.fillText(e.texto, e.x * ESCALA, e.base * ESCALA);
        break;
      case 'linea':
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = e.grosor * ESCALA;
        ctx.beginPath();
        ctx.moveTo(e.x1 * ESCALA, e.y1 * ESCALA);
        ctx.lineTo(e.x2 * ESCALA, e.y2 * ESCALA);
        ctx.stroke();
        break;
      case 'imagen': {
        const img = await loadImage(e.datos);
        ctx.drawImage(
          img,
          e.x * ESCALA,
          e.y * ESCALA,
          e.ancho * ESCALA,
          e.alto * ESCALA,
        );
        break;
      }
    }
  }
  return canvas.encode('png');
}

/** Ancho y alto de un PNG o JPEG, leídos de su cabecera (para encajar el logo igual en los dos motores). */
export function dimensionesImagen(
  datos: Buffer,
): { ancho: number; alto: number } | null {
  if (datos.length > 24 && datos.readUInt32BE(0) === 0x89504e47) {
    return { ancho: datos.readUInt32BE(16), alto: datos.readUInt32BE(20) };
  }
  if (datos.length > 4 && datos[0] === 0xff && datos[1] === 0xd8) {
    let i = 2;
    while (i + 9 < datos.length) {
      if (datos[i] !== 0xff) return null;
      const marca = datos[i + 1];
      const largo = datos.readUInt16BE(i + 2);
      // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
      if (
        marca >= 0xc0 &&
        marca <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marca)
      ) {
        return {
          alto: datos.readUInt16BE(i + 5),
          ancho: datos.readUInt16BE(i + 7),
        };
      }
      i += 2 + largo;
    }
  }
  return null;
}
