'use server';

// ─────────────────────────────────────────────────────────────
// PADRÓN EPS — server actions de la pantalla de importación CSV.
//
// Flujo de dos pasos exigido por el negocio:
//   1) validatePadronCsvAction → valida A FONDO el archivo (sin escribir nada).
//   2) importPadronCsvAction   → RE-valida (regla de oro: nunca confiar en el
//      paso anterior) y hace upsert por (organizationId, cedula) en transacción.
//
// La lógica de parsing/validación vive en @agenia/shared (pura y testeada);
// aquí solo se orquesta sesión, catálogo de EPS y persistencia.
// ─────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@agenia/database';
import { validatePadronCsv, type PadronCsvError, type PadronCsvRow } from '@agenia/shared';

// Límites defensivos: el CSV viaja como texto en el body de la action.
// Medido contra los padrones reales del Hospital San Vicente de Paúl (Anserma):
// Salud Total 10-08-2026 son 3,3 MB / ~9.100 filas y Sura 19-08-2026 1,9 MB /
// ~10.500 filas. Ambos caben con holgura; el tope de arriba NO es el que
// estorba (ver UPSERT_CHUNK_ROWS, que sí lo era).
const MAX_CSV_CHARS = 6_000_000; // ~6 MB
const MAX_ERRORS_RETURNED = 100; // la UI no necesita más para corregir el archivo

// Postgres habla el protocolo extendido con un int16 para el número de
// parámetros: 32.767 es techo del PROTOCOLO, no una preferencia. Con 13
// columnas por fila, un único `createMany` del padrón real pediría ~118.000
// parámetros y falla SIEMPRE —no «cuando el archivo es grande»—, con
// `too many bind variables in prepared statement`. De ahí el troceado: cada
// lote es un solo INSERT multi-fila de 13.000 parámetros, holgadamente por
// debajo del techo, y los ~11 lotes van dentro de UNA transacción.
const UPSERT_CHUNK_ROWS = 1_000;
const LOOKUP_CHUNK_ROWS = 5_000;

// ~11 lotes de un INSERT cada uno terminan en segundos; el tope generoso está
// para que una base lenta no aborte un corte completo a medio escribir.
const IMPORT_TIMEOUT_MS = 120_000;

export interface PadronValidationSummary {
    ok: boolean;
    totalDataRows: number;
    validCount: number;
    errorCount: number;
    /** Muestra de errores (máx. MAX_ERRORS_RETURNED) para corregir el archivo. */
    errors: PadronCsvError[];
    /** Conteo de filas válidas por EPS, para previsualizar el impacto. */
    rowsPerEps: Array<{ epsName: string; count: number }>;
}

export interface PadronImportResult {
    success: boolean;
    error?: string;
    created?: number;
    updated?: number;
}

async function requireOrgAdmin(): Promise<{ organizationId: string } | null> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) return null;
    return { organizationId: session.organizationId };
}

async function getActiveEpsMap(organizationId: string): Promise<Map<string, string>> {
    const epsList = await prisma.eps.findMany({
        where: { organizationId, isActive: true },
        select: { id: true, name: true },
    });
    return new Map(epsList.map((eps) => [eps.name, eps.id]));
}

/** Paso 1 — valida el archivo contra el catálogo de EPS de la clínica. */
export async function validatePadronCsvAction(
    csvText: string,
): Promise<{ success: true; report: PadronValidationSummary } | { success: false; error: string }> {
    const auth = await requireOrgAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado' };

    if (typeof csvText !== 'string' || csvText.length > MAX_CSV_CHARS) {
        return { success: false, error: 'El archivo supera el tamaño máximo permitido (6 MB).' };
    }

    const epsMap = await getActiveEpsMap(auth.organizationId);
    if (epsMap.size === 0) {
        return {
            success: false,
            error: 'La clínica no tiene EPS activas. Cree las EPS en "Aseguradoras (EPS)" antes de importar el padrón.',
        };
    }

    const report = validatePadronCsv(csvText, [...epsMap.keys()]);

    const rowsPerEps = new Map<string, number>();
    for (const row of report.validRows) {
        rowsPerEps.set(row.epsName, (rowsPerEps.get(row.epsName) ?? 0) + 1);
    }

    return {
        success: true,
        report: {
            ok: report.ok,
            totalDataRows: report.totalDataRows,
            validCount: report.validRows.length,
            errorCount: report.errors.length,
            errors: report.errors.slice(0, MAX_ERRORS_RETURNED),
            rowsPerEps: [...rowsPerEps.entries()]
                .map(([epsName, count]) => ({ epsName, count }))
                .sort((a, b) => b.count - a.count),
        },
    };
}

/**
 * Reporte de errores COMPLETO (sin el tope de MAX_ERRORS_RETURNED) para
 * descargar como CSV cuando el archivo tiene demasiados errores para leerlos
 * cómodamente en pantalla. Re-valida desde cero, igual que el paso de
 * importación — nunca confía en un reporte previo del cliente.
 */
export async function getPadronFullErrorReportAction(
    csvText: string,
): Promise<{ success: true; csv: string } | { success: false; error: string }> {
    const auth = await requireOrgAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado' };

    if (typeof csvText !== 'string' || csvText.length > MAX_CSV_CHARS) {
        return { success: false, error: 'El archivo supera el tamaño máximo permitido (6 MB).' };
    }

    const epsMap = await getActiveEpsMap(auth.organizationId);
    const report = validatePadronCsv(csvText, [...epsMap.keys()]);

    const escapeCsvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = ['linea,columna,mensaje'];
    for (const err of report.errors) {
        lines.push(
            [String(err.line), escapeCsvCell(err.column ?? ''), escapeCsvCell(err.message)].join(','),
        );
    }

    return { success: true, csv: lines.join('\n') };
}

/**
 * Cédulas del lote que YA están en el padrón de la clínica. Troceada por la
 * misma razón que el upsert: un `IN` de 10.500 cédulas es un `IN` de 10.500
 * parámetros, y sirve sólo para poder informar «creados» vs «actualizados».
 */
async function findExistingCedulas(
    organizationId: string,
    cedulas: string[],
): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < cedulas.length; i += LOOKUP_CHUNK_ROWS) {
        const rows = await prisma.epsEnrolledPatient.findMany({
            where: { organizationId, cedula: { in: cedulas.slice(i, i + LOOKUP_CHUNK_ROWS) } },
            select: { cedula: true },
        });
        for (const row of rows) found.add(row.cedula);
    }
    return found;
}

/**
 * Un único `INSERT ... ON CONFLICT` por lote. Reemplaza el `createMany` + N
 * `update` de la versión anterior, que con el padrón real reventaba dos veces:
 * el `createMany` por el techo de parámetros, y los `update` porque eran
 * ~10.500 ida-y-vueltas dentro de un mismo BEGIN.
 *
 * `createdAt` queda deliberadamente fuera del DO UPDATE: un paciente que
 * reaparece en el corte del mes siguiente conserva la fecha en que entró.
 *
 * Cada parámetro va con cast explícito. No es adorno: en un VALUES multi-fila,
 * si el primer valor de una columna es NULL (`telefono` vacío en la fila 1),
 * Postgres no puede inferir el tipo y responde
 * `could not determine data type of parameter`.
 */
async function upsertPadronChunk(
    tx: Prisma.TransactionClient,
    rows: PadronCsvRow[],
    ctx: { organizationId: string; epsMap: Map<string, string>; importedAt: Date },
): Promise<void> {
    const values = rows.map(
        (row) => Prisma.sql`(
            ${randomUUID()}::text,
            ${row.cedula}::text,
            ${row.fullName}::text,
            ${row.phone}::text,
            ${row.email}::text,
            ${row.dateOfBirth}::timestamp(3),
            ${row.gender}::text,
            ${row.address}::text,
            true,
            ${ctx.epsMap.get(row.epsName)!}::text,
            ${ctx.organizationId}::text,
            ${ctx.importedAt}::timestamp(3),
            ${ctx.importedAt}::timestamp(3)
        )`,
    );

    await tx.$executeRaw`
        INSERT INTO "EpsEnrolledPatient" (
            "id", "cedula", "fullName", "phone", "email", "dateOfBirth",
            "gender", "address", "isActive", "epsId", "organizationId",
            "createdAt", "updatedAt"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("organizationId", "cedula") DO UPDATE SET
            "fullName"    = EXCLUDED."fullName",
            "phone"       = EXCLUDED."phone",
            "email"       = EXCLUDED."email",
            "dateOfBirth" = EXCLUDED."dateOfBirth",
            "gender"      = EXCLUDED."gender",
            "address"     = EXCLUDED."address",
            "isActive"    = EXCLUDED."isActive",
            "epsId"       = EXCLUDED."epsId",
            "updatedAt"   = EXCLUDED."updatedAt"
    `;
}

/** Paso 2 — re-valida e importa (upsert por cédula dentro del tenant). */
export async function importPadronCsvAction(csvText: string): Promise<PadronImportResult> {
    const auth = await requireOrgAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado' };
    const { organizationId } = auth;

    if (typeof csvText !== 'string' || csvText.length > MAX_CSV_CHARS) {
        return { success: false, error: 'El archivo supera el tamaño máximo permitido (6 MB).' };
    }

    try {
        const epsMap = await getActiveEpsMap(organizationId);
        const report = validatePadronCsv(csvText, [...epsMap.keys()]);
        if (!report.ok) {
            return {
                success: false,
                error: 'El archivo tiene errores de validación. Vuelva a ejecutar "Validar" y corríjalos antes de importar.',
            };
        }

        const existingCedulas = await findExistingCedulas(
            organizationId,
            report.validRows.map((row) => row.cedula),
        );

        // Un solo sello para todo el corte: dos filas del mismo archivo no
        // deben quedar con `updatedAt` distinto por lo que tardó el troceado.
        const importedAt = new Date();
        const ctx = { organizationId, epsMap, importedAt };

        await prisma.$transaction(
            async (tx) => {
                for (let i = 0; i < report.validRows.length; i += UPSERT_CHUNK_ROWS) {
                    await upsertPadronChunk(
                        tx,
                        report.validRows.slice(i, i + UPSERT_CHUNK_ROWS),
                        ctx,
                    );
                }
            },
            { maxWait: 10_000, timeout: IMPORT_TIMEOUT_MS },
        );

        const updated = report.validRows.filter((row) => existingCedulas.has(row.cedula)).length;

        revalidatePath('/dashboard/padron');
        return { success: true, created: report.validRows.length - updated, updated };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Error al importar el padrón';
        return { success: false, error: message };
    }
}
