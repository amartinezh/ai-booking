/**
 * 📢 MENSAJES MASIVOS — leer en el navegador el archivo de contactos
 * (docs/PLAN_MENSAJES_MASIVOS.md §4).
 *
 * Acepta lo que la clínica tenga: Excel (.xlsx, .xls, .ods: la primera hoja con
 * datos, convertida a CSV con `xlsxToCsv`), CSV o TXT (en UTF-8 o en la
 * codificación de Excel en Windows, que deja «Ã©» o «�» si se lee como UTF-8) y
 * vCard (.vcf) del celular. Lo que sale es TEXTO: lo interpreta
 * `analizarArchivoDeContactos` de @agenia/shared.
 */
import { sniffBinarySignature, xlsxToCsv } from '../spreadsheet-upload';

export const MAX_BYTES_ARCHIVO_CONTACTOS = 15 * 1024 * 1024;

export type LecturaDeArchivo = { ok: true; texto: string } | { ok: false; error: string };

/** Lee los bytes como UTF-8 y, si quedan caracteres rotos, como Windows-1252. */
export function decodificarTexto(buffer: ArrayBuffer): string {
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    const rotos = (utf8.match(/�/g) ?? []).length;
    if (rotos === 0) return utf8;
    return new TextDecoder('windows-1252').decode(buffer);
}

export async function leerArchivoDeContactos(file: File): Promise<LecturaDeArchivo> {
    if (file.size > MAX_BYTES_ARCHIVO_CONTACTOS) {
        return { ok: false, error: 'El archivo pesa más de 15 MB. Divida la lista o guarde solo las columnas de contacto.' };
    }
    try {
        const firma = await sniffBinarySignature(file);
        if (firma?.kind === 'pdf') {
            return {
                ok: false,
                error: 'Un PDF no se puede leer como lista. Ábralo, copie la tabla y péguela en «Pegar texto», o expórtelo a Excel.',
            };
        }
        if (firma?.kind === 'zip' || firma?.kind === 'ole' || /\.(xlsx|xls|ods)$/i.test(file.name)) {
            const csv = await xlsxToCsv(await file.arrayBuffer());
            return csv
                ? { ok: true, texto: csv }
                : { ok: false, error: 'El archivo no tiene ninguna hoja con datos (o no es un Excel). Guárdelo como Excel o CSV.' };
        }
        return { ok: true, texto: decodificarTexto(await file.arrayBuffer()) };
    } catch {
        return {
            ok: false,
            error: 'No se pudo leer el archivo. Guárdelo como Excel o CSV, o copie las filas y péguelas en «Pegar texto».',
        };
    }
}
