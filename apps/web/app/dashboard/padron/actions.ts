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

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { validatePadronCsv, type PadronCsvError } from '@agenia/shared';

// Límites defensivos: el CSV viaja como texto en el body de la action.
const MAX_CSV_CHARS = 6_000_000; // ~6 MB
const MAX_ERRORS_RETURNED = 100; // la UI no necesita más para corregir el archivo

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

        const cedulas = report.validRows.map((row) => row.cedula);
        const existing = await prisma.epsEnrolledPatient.findMany({
            where: { organizationId, cedula: { in: cedulas } },
            select: { id: true, cedula: true },
        });
        const existingByCedula = new Map(existing.map((p) => [p.cedula, p.id]));

        const toData = (row: (typeof report.validRows)[number]) => ({
            fullName: row.fullName,
            epsId: epsMap.get(row.epsName)!,
            phone: row.phone,
            email: row.email,
            dateOfBirth: row.dateOfBirth ? new Date(`${row.dateOfBirth}T00:00:00.000Z`) : null,
            gender: row.gender,
            address: row.address,
            isActive: true,
        });

        const toCreate = report.validRows.filter((row) => !existingByCedula.has(row.cedula));
        const toUpdate = report.validRows.filter((row) => existingByCedula.has(row.cedula));

        await prisma.$transaction([
            ...(toCreate.length > 0
                ? [
                      prisma.epsEnrolledPatient.createMany({
                          data: toCreate.map((row) => ({
                              ...toData(row),
                              cedula: row.cedula,
                              organizationId,
                          })),
                      }),
                  ]
                : []),
            ...toUpdate.map((row) =>
                prisma.epsEnrolledPatient.update({
                    where: { id: existingByCedula.get(row.cedula)! },
                    data: toData(row),
                }),
            ),
        ]);

        revalidatePath('/dashboard/padron');
        return { success: true, created: toCreate.length, updated: toUpdate.length };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Error al importar el padrón';
        return { success: false, error: message };
    }
}
