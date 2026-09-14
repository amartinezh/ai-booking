/**
 * Avisos masivos — Fase 3 (§10, "exportar los sin celular"). Ver
 * docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md.
 *
 * Quien no tiene un celular válido no se cuela entre los enviados
 * (RecipientsTable.tsx ya los separa) — pero alguien tiene que llamarlos.
 * Este archivo arma esa lista como CSV para que quien la reciba (una
 * secretaría, un call center) pueda trabajarla sin volver a entrar a la
 * pantalla. Puramente de formato: no toca la base ni hace un roundtrip al
 * servidor, porque `batch.recipients` ya está cargado en el cliente.
 */

import { formatAppointmentCompact } from '@/lib/date';

export interface SinCelularRow {
    patientDocument: string;
    patientName: string | null;
    appointmentAtUtc: Date;
}

const HEADER = 'documento,nombre,fecha_hora_cita';

/** Escapa una celda para CSV: comillas dobles si trae coma, comilla o salto de línea. */
function escapeCsvCell(value: string): string {
    if (/[",\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/**
 * Arma el CSV de "sin celular válido" de un lote. Determinista y puro —
 * sin esto sería imposible probarlo sin un DOM.
 */
export function buildSinCelularCsv(rows: SinCelularRow[]): string {
    const lines = rows.map((r) =>
        [
            escapeCsvCell(r.patientDocument),
            escapeCsvCell(r.patientName ?? ''),
            escapeCsvCell(formatAppointmentCompact(r.appointmentAtUtc)),
        ].join(','),
    );
    return [HEADER, ...lines].join('\n');
}

/** Nombre de archivo determinista — incluye el id del lote para no confundir descargas de dos avisos distintos. */
export function sinCelularFileName(batchId: string): string {
    return `sin-celular_${batchId}.csv`;
}
