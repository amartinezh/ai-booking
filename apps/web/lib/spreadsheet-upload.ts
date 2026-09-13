/**
 * Utilidades de carga de hoja electrónica (CSV o Excel), compartidas por
 * cualquier pantalla que suba un archivo para validar-y-cargar: hoy el
 * padrón (`/dashboard/padron`) y los avisos masivos
 * (`/dashboard/espejo/avisos` — ver
 * docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md §3.3.2).
 *
 * EXTRAÍDO de `PadronUploader.tsx` sin cambiar su comportamiento: antes cada
 * pantalla habría tenido que reimplementar la detección de binarios, el
 * progreso de lectura y la conversión de Excel a CSV. Vive en `apps/web/lib`
 * (no en `@agenia/shared`) porque usa APIs del navegador (`FileReader`,
 * `File`) que no existen en Node — `@agenia/shared` es código que también
 * corre en el servidor/agente y tiene que seguir siendo puro para eso.
 */

/**
 * Firmas binarias (primeros bytes del archivo), revisadas sobre los bytes
 * CRUDOS antes de decodificar nada. `zip` es la firma de un .xlsx real (es un
 * contenedor ZIP) — se acepta cuando la extensión del archivo es .xlsx. `ole`
 * (.xls antiguo) y `pdf` no se soportan en ningún caso.
 */
const BINARY_SIGNATURES: Array<{ bytes: number[]; label: string; kind: 'zip' | 'ole' | 'pdf' }> = [
    { bytes: [0x50, 0x4b, 0x03, 0x04], label: 'un archivo Excel (.xlsx) o ZIP', kind: 'zip' },
    { bytes: [0x50, 0x4b, 0x05, 0x06], label: 'un archivo Excel (.xlsx) o ZIP vacío', kind: 'zip' },
    { bytes: [0xd0, 0xcf, 0x11, 0xe0], label: 'un archivo Excel antiguo (.xls)', kind: 'ole' },
    { bytes: [0x25, 0x50, 0x44, 0x46], label: 'un archivo PDF', kind: 'pdf' },
];

export async function sniffBinarySignature(
    file: File,
): Promise<{ label: string; kind: 'zip' | 'ole' | 'pdf' } | null> {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    for (const { bytes, label, kind } of BINARY_SIGNATURES) {
        if (bytes.every((b, i) => head[i] === b)) return { label, kind };
    }
    return null;
}

/** Lee un archivo con progreso REAL (bytes leídos / total) vía FileReader. */
export function readFileWithProgress(
    file: File,
    mode: 'text' | 'arraybuffer',
    onProgress: (percent: number) => void,
): Promise<string | ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo.'));
        reader.onload = () => resolve(reader.result as string | ArrayBuffer);
        if (mode === 'text') reader.readAsText(file);
        else reader.readAsArrayBuffer(file);
    });
}

/** Convierte un workbook de Excel a CSV: usa la primera hoja que tenga datos. */
export async function xlsxToCsv(buffer: ArrayBuffer): Promise<string | null> {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'array' });
    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.split(/\r?\n/).some((l) => l.trim())) return csv;
    }
    return null;
}

export type UploadProgress = { label: string; percent: number } | null;
