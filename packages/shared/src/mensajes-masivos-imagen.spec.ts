import {
  evaluarImagen,
  formatoPorFirma,
  pesoLegible,
  problemaDuroDeImagen,
  recorteIdeal,
  tamanoOptimizado,
  type MedidasImagen,
} from './mensajes-masivos-imagen';

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const ideal: MedidasImagen = { formato: 'JPEG', bytes: 300 * 1024, ancho: 1200, alto: 628, brillo: 130, nitidez: 400 };
const ids = (m: MedidasImagen) => evaluarImagen(m).observaciones.filter((o) => o.nivel !== 'BIEN').map((o) => o.id);

describe('formatoPorFirma', () => {
  it('reconoce el formato real por sus primeros bytes', () => {
    expect(formatoPorFirma(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('JPEG');
    expect(formatoPorFirma(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('PNG');
    expect(formatoPorFirma(bytes(0x47, 0x49, 0x46, 0x38))).toBe('GIF');
    expect(formatoPorFirma(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('WEBP');
    const heic = new Uint8Array([0, 0, 0, 0x18, ...Array.from('ftypheic').map((c) => c.charCodeAt(0)), 0, 0]);
    expect(formatoPorFirma(heic)).toBe('HEIC');
    expect(formatoPorFirma(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe('SVG');
    expect(formatoPorFirma(bytes(1, 2, 3))).toBe('DESCONOCIDO');
  });
});

describe('problemaDuroDeImagen (lo que revisa la API antes de subirla)', () => {
  it('solo JPEG o PNG de hasta 5 MB', () => {
    expect(problemaDuroDeImagen('JPEG', 1024)).toBeNull();
    expect(problemaDuroDeImagen('WEBP', 1024)).toContain('JPEG o PNG');
    expect(problemaDuroDeImagen('PNG', 6 * 1024 * 1024)).toContain('5 MB');
  });
});

describe('evaluarImagen', () => {
  it('una imagen de 1200 × 628 en JPEG liviano está bien en todo', () => {
    const e = evaluarImagen(ideal);
    expect(ids(ideal)).toEqual([]);
    expect(e.cumpleMeta).toBe(true);
    expect(e.puntaje).toBe(100);
    expect(e.forma).toContain('ideal');
  });

  it('WebP o HEIC no cumplen, pero «Optimizar» los convierte', () => {
    const e = evaluarImagen({ ...ideal, formato: 'HEIC' });
    expect(e.cumpleMeta).toBe(false);
    expect(e.observaciones[0]).toMatchObject({ id: 'FORMATO', nivel: 'ERROR', loArreglaOptimizar: true });
  });

  it('más de 5 MB es error; más de 1 MB es aviso', () => {
    expect(evaluarImagen({ ...ideal, bytes: 6 * 1024 * 1024 }).cumpleMeta).toBe(false);
    expect(ids({ ...ideal, bytes: 2 * 1024 * 1024 })).toEqual(['PESO']);
  });

  it('una foto vertical del celular se verá recortada', () => {
    const e = evaluarImagen({ ...ideal, ancho: 1080, alto: 1920 });
    const p = e.observaciones.find((o) => o.id === 'PROPORCION');
    expect(p?.mensaje).toContain('franja del centro');
    expect(p?.loArreglaRecortar).toBe(true);
    expect(e.forma).toContain('vertical');
  });

  it('pequeña, transparente, oscura y borrosa', () => {
    expect(ids({ ...ideal, formato: 'PNG', ancho: 400, alto: 210, transparencia: true, brillo: 20, nitidez: 10 })).toEqual(
      expect.arrayContaining(['RESOLUCION', 'TRANSPARENCIA', 'OSCURA']),
    );
    expect(ids({ ...ideal, nitidez: 10 })).toContain('BORROSA');
  });

  it('una imagen enorme sugiere reducirla', () => {
    expect(ids({ ...ideal, ancho: 4000, alto: 2094 })).toEqual(['RESOLUCION_DE_MAS']);
  });
});

describe('recorteIdeal y tamanoOptimizado', () => {
  it('el recorte centrado a 1,91:1', () => {
    expect(recorteIdeal(1080, 1920)).toEqual({ x: 0, y: 678, ancho: 1080, alto: 565 });
    expect(recorteIdeal(3000, 1000)).toEqual({ x: 545, y: 0, ancho: 1910, alto: 1000 });
  });
  it('reduce a 1600 de ancho como mucho, sin agrandar', () => {
    expect(tamanoOptimizado(4000, 2000)).toEqual({ ancho: 1600, alto: 800 });
    expect(tamanoOptimizado(800, 418)).toEqual({ ancho: 800, alto: 418 });
  });
});

describe('pesoLegible', () => {
  it('KB y MB con coma decimal', () => {
    expect(pesoLegible(300 * 1024)).toBe('300 KB');
    expect(pesoLegible(2.5 * 1024 * 1024)).toBe('2,5 MB');
  });
});
