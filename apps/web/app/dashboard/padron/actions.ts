'use server';

// ─────────────────────────────────────────────────────────────
// PADRÓN EPS — server actions de la pantalla de importación CSV.
//
// Flujo de tres pasos:
//   1) validatePadronCsvAction → valida A FONDO el archivo contra la EPS
//      elegida en pantalla (sin escribir nada), y mide cuánta gente quedaría
//      desactivada si se aplica tal cual.
//   2) importPadronCsvAction   → RE-valida (regla de oro: nunca confiar en el
//      paso anterior) y aplica el corte: reemplazo idempotente por EPS.
//
// La EPS del archivo se elige en la pantalla, no se lee de una columna: así
// es imposible mezclar afiliados de dos EPS por un valor de columna mal
// escrito, y el CSV se reduce al mínimo (cedula obligatoria; regimen y
// telefono opcionales — ver @agenia/shared/padron-csv.ts).
//
// SEMÁNTICA DE CARGA — confirmada por el hospital (2026-09-10): el archivo
// que envía cada EPS es siempre completo, pero puede llegar parcial por
// error, y debe poderse recargar cuantas veces haga falta. Por eso cada
// importación REEMPLAZA por completo el padrón activo de esa EPS: se hace
// upsert de todo lo que trae el archivo (reactivando a quien estaba inactivo)
// y se desactiva a quien tenía alta activa por esa EPS y no vino en este
// corte. Recargar el mismo archivo es idempotente. Si el corte desactivaría
// más del 10% del padrón activo de la EPS, la pantalla exige una confirmación
// explícita antes de aplicarlo — la baranda contra el "parcial por error".
//
// La lógica de parsing/validación vive en @agenia/shared (pura y testeada);
// aquí solo se orquesta sesión, EPS, persistencia y el log de auditoría del
// corte (PadronImport / PadronImportRow).
// ─────────────────────────────────────────────────────────────

import { randomUUID, createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@agenia/database';
import { validatePadronCsv, type PadronCsvError, type PadronCsvRow } from '@agenia/shared';

// Límites defensivos: el CSV viaja como texto en el body de la action.
// Medido contra los padrones reales del Hospital San Vicente de Paúl (Anserma):
// Salud Total 10-08-2026 son 3,3 MB / ~9.100 filas y Sura 19-08-2026 1,9 MB /
// ~10.500 filas. Ambos caben con holgura.
const MAX_CSV_CHARS = 6_000_000; // ~6 MB
const MAX_ERRORS_RETURNED = 100; // la UI no necesita más para corregir el archivo

// Postgres habla el protocolo extendido con un int16 para el número de
// parámetros: 32.767 es techo del PROTOCOLO, no una preferencia. Con el
// padrón real (~10.500 filas) un único `createMany`/INSERT multi-fila sin
// trocear pide decenas de miles de parámetros y falla SIEMPRE —no «cuando el
// archivo es grande»—, con `too many bind variables in prepared statement`.
// De ahí el troceado: cada lote es un solo INSERT/createMany por debajo del
// techo, y todos los lotes van dentro de UNA transacción.
const UPSERT_CHUNK_ROWS = 1_000;
const LOOKUP_CHUNK_ROWS = 5_000;

// ~11 lotes de un INSERT cada uno terminan en segundos; el tope generoso está
// para que una base lenta no aborte un corte completo a medio escribir.
const IMPORT_TIMEOUT_MS = 120_000;

// Umbral de la guarda de desactivación masiva: por encima de esto, la
// pantalla exige confirmación explícita antes de aplicar el corte. El
// hospital confirmó que "puede llegar parcial por algún error" — un archivo
// parcial cargado por accidente desactivaría a casi todo el padrón, y esta
// cifra lo delata antes de hacer daño.
const DEACTIVATION_CONFIRM_THRESHOLD = 0.1; // 10%

export interface EpsOption {
    id: string;
    name: string;
}

export interface PadronValidationSummary {
    ok: boolean;
    totalDataRows: number;
    validCount: number;
    errorCount: number;
    /** Muestra de errores (máx. MAX_ERRORS_RETURNED) para corregir el archivo. */
    errors: PadronCsvError[];
    epsId: string;
    epsName: string;
    /** Afiliados actualmente activos de esta EPS, antes de aplicar el corte. */
    activeForEps: number;
    /** Cuántos de esos quedarían desactivados si se importa este archivo tal cual. */
    wouldDeactivate: number;
    /** true si wouldDeactivate supera el umbral — la pantalla debe pedir confirmación. */
    needsDeactivationConfirmation: boolean;
    /** Líneas de "basura" antes del encabezado real que el analizador ignoró. */
    ignoredPreambleLines: number;
}

export interface PadronImportResult {
    success: boolean;
    error?: string;
    /** Presente solo si `needsDeactivationConfirmation` causó el rechazo. */
    needsDeactivationConfirmation?: boolean;
    importId?: string;
    created?: number;
    updated?: number;
    reactivated?: number;
    deactivated?: number;
}

async function requireOrgAdmin(): Promise<{ organizationId: string; userId: string } | null> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) return null;
    return { organizationId: session.organizationId, userId: session.userId };
}

async function requireActiveEps(
    organizationId: string,
    epsId: string,
): Promise<{ id: string; name: string } | null> {
    return prisma.eps.findFirst({
        where: { id: epsId, organizationId, isActive: true },
        select: { id: true, name: true },
    });
}

/** Para poblar el selector de EPS de la pantalla de carga. */
export async function getActiveEpsOptionsAction(): Promise<
    { success: true; eps: EpsOption[] } | { success: false; error: string }
> {
    const auth = await requireOrgAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado' };

    const eps = await prisma.eps.findMany({
        where: { organizationId: auth.organizationId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });
    return { success: true, eps };
}

/**
 * Mide el impacto de la baja: cuántos afiliados activos de esta EPS NO
 * vienen en el archivo (candidatos a quedar desactivados). Troceado por la
 * misma razón que el resto: un `IN` de 10.500 cédulas es un `IN` de 10.500
 * parámetros.
 */
async function measureDeactivationImpact(
    organizationId: string,
    epsId: string,
    validCedulas: string[],
): Promise<{ activeForEps: number; wouldDeactivate: number }> {
    const activeForEps = await prisma.epsEnrolledPatient.count({
        where: { organizationId, epsId, isActive: true },
    });
    if (validCedulas.length === 0) {
        return { activeForEps, wouldDeactivate: activeForEps };
    }
    let stillActive = 0;
    for (let i = 0; i < validCedulas.length; i += LOOKUP_CHUNK_ROWS) {
        stillActive += await prisma.epsEnrolledPatient.count({
            where: {
                organizationId,
                epsId,
                isActive: true,
                cedula: { in: validCedulas.slice(i, i + LOOKUP_CHUNK_ROWS) },
            },
        });
    }
    return { activeForEps, wouldDeactivate: Math.max(0, activeForEps - stillActive) };
}

/** Paso 1 — valida el archivo y mide el impacto contra la EPS elegida. */
export async function validatePadronCsvAction(
    csvText: string,
    epsId: string,
): Promise<{ success: true; report: PadronValidationSummary } | { success: false; error: string }> {
    const auth = await requireOrgAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado' };

    if (typeof csvText !== 'string' || csvText.length > MAX_CSV_CHARS) {
        return { success: false, error: 'El archivo supera el tamaño máximo permitido (6 MB).' };
    }
    if (typeof epsId !== 'string' || !epsId) {
        return { success: false, error: 'Seleccione la EPS de este archivo antes de validar.' };
    }

    const eps = await requireActiveEps(auth.organizationId, epsId);
    if (!eps) {
        return { success: false, error: 'La EPS seleccionada no existe o no está activa en la clínica.' };
    }

    const report = validatePadronCsv(csvText);

    const { activeForEps, wouldDeactivate } = await measureDeactivationImpact(
        auth.organizationId,
        eps.id,
        report.validRows.map((row) => row.cedula),
    );

    return {
        success: true,
        report: {
            ok: report.ok,
            totalDataRows: report.totalDataRows,
            validCount: report.validRows.length,
            errorCount: report.errors.length,
            errors: report.errors.slice(0, MAX_ERRORS_RETURNED),
            epsId: eps.id,
            epsName: eps.name,
            activeForEps,
            wouldDeactivate,
            needsDeactivationConfirmation:
                activeForEps > 0 && wouldDeactivate / activeForEps > DEACTIVATION_CONFIRM_THRESHOLD,
            ignoredPreambleLines: report.ignoredPreambleLines,
        },
    };
}

/**
 * Reporte de errores COMPLETO (sin el tope de MAX_ERRORS_RETURNED) para
 * descargar como CSV cuando el archivo tiene demasiados errores para leerlos
 * cómodamente en pantalla. Re-valida desde cero, igual que el paso de
 * importación — nunca confía en un reporte previo del cliente. Ya no depende
 * de la EPS: la validación por fila no la usa.
 */
export async function getPadronFullErrorReportAction(
    csvText: string,
): Promise<{ success: true; csv: string } | { success: false; error: string }> {
    const auth = await requireOrgAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado' };

    if (typeof csvText !== 'string' || csvText.length > MAX_CSV_CHARS) {
        return { success: false, error: 'El archivo supera el tamaño máximo permitido (6 MB).' };
    }

    const report = validatePadronCsv(csvText);

    const escapeCsvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = ['linea,columna,mensaje'];
    for (const err of report.errors) {
        lines.push(
            [String(err.line), escapeCsvCell(err.column ?? ''), escapeCsvCell(err.message)].join(','),
        );
    }

    return { success: true, csv: lines.join('\n') };
}

type EstadoPrevio = { isActive: boolean };

/** Estado (org, eps, cédula) ANTES del corte — decide CREADO/ACTUALIZADO/REACTIVADO. */
async function findEstadoPrevio(
    organizationId: string,
    epsId: string,
    cedulas: string[],
): Promise<Map<string, EstadoPrevio>> {
    const found = new Map<string, EstadoPrevio>();
    for (let i = 0; i < cedulas.length; i += LOOKUP_CHUNK_ROWS) {
        const rows = await prisma.epsEnrolledPatient.findMany({
            where: { organizationId, epsId, cedula: { in: cedulas.slice(i, i + LOOKUP_CHUNK_ROWS) } },
            select: { cedula: true, isActive: true },
        });
        for (const row of rows) found.set(row.cedula, { isActive: row.isActive });
    }
    return found;
}

/**
 * Un único `INSERT ... ON CONFLICT` por lote sobre la llave
 * (organizationId, epsId, cedula). Da de alta lo nuevo y REACTIVA
 * (isActive=true) a quien ya existía, sin importar su estado previo — la
 * baja de quien no vino en el archivo la hace `deactivateAbsent` después,
 * en un único UPDATE.
 *
 * `phone`/`regime` usan COALESCE: un valor nuevo no-nulo del archivo
 * reemplaza al anterior, pero una celda vacía en ESTE corte NUNCA borra un
 * valor bueno que ya existía (p. ej. un teléfono cargado en un corte previo
 * y ausente en este). `fullName`/`email`/`dateOfBirth`/`gender`/`address`
 * quedan intactas: el formato mínimo del padrón no las toca, y solo se
 * inicializan a NULL en el INSERT de una fila nueva.
 *
 * Cada parámetro va con cast explícito. No es adorno: en un VALUES
 * multi-fila, si el primer valor de una columna es NULL (`phone` vacío en la
 * fila 1), Postgres no puede inferir el tipo y responde
 * `could not determine data type of parameter`.
 */
async function upsertPadronChunk(
    tx: Prisma.TransactionClient,
    rows: PadronCsvRow[],
    ctx: { organizationId: string; epsId: string; importId: string; importedAt: Date },
): Promise<void> {
    const values = rows.map(
        (row) => Prisma.sql`(
            ${randomUUID()}::text,
            ${row.cedula}::text,
            ${row.phone}::text,
            ${row.regime}::text,
            true,
            ${ctx.epsId}::text,
            ${ctx.organizationId}::text,
            ${ctx.importId}::text,
            ${ctx.importedAt}::timestamp(3),
            ${ctx.importedAt}::timestamp(3)
        )`,
    );

    await tx.$executeRaw`
        INSERT INTO "EpsEnrolledPatient" (
            "id", "cedula", "phone", "regime", "isActive", "epsId", "organizationId",
            "importId", "createdAt", "updatedAt"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("organizationId", "epsId", "cedula") DO UPDATE SET
            "phone"     = COALESCE(EXCLUDED."phone", "EpsEnrolledPatient"."phone"),
            "regime"    = COALESCE(EXCLUDED."regime", "EpsEnrolledPatient"."regime"),
            "isActive"  = true,
            "importId"  = EXCLUDED."importId",
            "updatedAt" = EXCLUDED."updatedAt"
    `;
}

/**
 * La baja del reemplazo: un único UPDATE, sin recorrer filas. Desactiva a
 * quien tenía alta ACTIVA por esta EPS y no quedó tocado por el corte que
 * se acaba de aplicar (`importId` distinto del nuevo).
 *
 * `IS DISTINCT FROM` y no `<>`: en SQL, `columna <> valor` da NULL (ni
 * verdadero ni falso) cuando `columna` es NULL, así que excluiría en
 * silencio a las filas de alta manual o anteriores a este campo
 * (`importId IS NULL`) — exactamente la gente que SÍ debe poder darse de
 * baja si no vino en el corte. `IS DISTINCT FROM` trata NULL como un valor
 * comparable más.
 */
async function deactivateAbsent(
    tx: Prisma.TransactionClient,
    ctx: { organizationId: string; epsId: string; importId: string },
): Promise<number> {
    const result = await tx.$executeRaw`
        UPDATE "EpsEnrolledPatient"
        SET "isActive" = false, "updatedAt" = NOW()
        WHERE "organizationId" = ${ctx.organizationId}
          AND "epsId" = ${ctx.epsId}
          AND "isActive" = true
          AND "importId" IS DISTINCT FROM ${ctx.importId}
    `;
    return result;
}

/**
 * Filas ACEPTADAS del log del corte — solo cédula y resultado. NUNCA la fila
 * cruda: el padrón original del hospital piloto traía columnas con datos
 * sensibles (oncología, salud mental, IVE, violencia) que se decidió no
 * custodiar, y ese criterio se sostiene aquí aunque el formato actual ya no
 * las traiga.
 */
async function writeAcceptedRows(
    tx: Prisma.TransactionClient,
    importId: string,
    rows: PadronCsvRow[],
    estadoPrevio: Map<string, EstadoPrevio>,
): Promise<void> {
    const data = rows.map((row) => {
        const prev = estadoPrevio.get(row.cedula);
        const resultado = !prev ? 'CREADO' : prev.isActive ? 'ACTUALIZADO' : 'REACTIVADO';
        return {
            id: randomUUID(),
            importId,
            line: row.line,
            cedulaCruda: row.cedula,
            cedulaNormalizada: row.cedula,
            resultado,
        };
    });
    for (let i = 0; i < data.length; i += UPSERT_CHUNK_ROWS) {
        await tx.padronImportRow.createMany({ data: data.slice(i, i + UPSERT_CHUNK_ROWS) });
    }
}

/** Filas RECHAZADAS del log — cédula cruda (cuando el parser la alcanzó a leer) + el error. */
async function writeRejectedRows(
    tx: Prisma.TransactionClient,
    importId: string,
    errors: PadronCsvError[],
): Promise<void> {
    const data = errors.map((err) => ({
        id: randomUUID(),
        importId,
        line: err.line,
        cedulaCruda: err.rawCedula ?? '',
        cedulaNormalizada: null,
        resultado: 'RECHAZADO',
        errorColumn: err.column ?? null,
        errorMessage: err.message,
    }));
    for (let i = 0; i < data.length; i += UPSERT_CHUNK_ROWS) {
        await tx.padronImportRow.createMany({ data: data.slice(i, i + UPSERT_CHUNK_ROWS) });
    }
}

/** Paso 2 — re-valida, mide de nuevo el impacto, y aplica el reemplazo por EPS. */
export async function importPadronCsvAction(
    csvText: string,
    epsId: string,
    fileName: string,
    confirmDeactivation: boolean,
): Promise<PadronImportResult> {
    const auth = await requireOrgAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado' };
    const { organizationId, userId } = auth;

    if (typeof csvText !== 'string' || csvText.length > MAX_CSV_CHARS) {
        return { success: false, error: 'El archivo supera el tamaño máximo permitido (6 MB).' };
    }
    if (typeof epsId !== 'string' || !epsId) {
        return { success: false, error: 'Seleccione la EPS de este archivo antes de importar.' };
    }

    const eps = await requireActiveEps(organizationId, epsId);
    if (!eps) {
        return { success: false, error: 'La EPS seleccionada no existe o no está activa en la clínica.' };
    }

    try {
        const report = validatePadronCsv(csvText);
        if (!report.ok) {
            return {
                success: false,
                error: 'El archivo tiene errores de validación. Vuelva a ejecutar "Validar" y corríjalos antes de importar.',
            };
        }

        const validCedulas = report.validRows.map((row) => row.cedula);

        // Regla de oro también para la guarda: nunca confiar en la cifra que
        // vio la pantalla en el paso de validación — puede haber cambiado.
        const { activeForEps, wouldDeactivate } = await measureDeactivationImpact(
            organizationId,
            eps.id,
            validCedulas,
        );
        const needsConfirmation =
            activeForEps > 0 && wouldDeactivate / activeForEps > DEACTIVATION_CONFIRM_THRESHOLD;
        if (needsConfirmation && !confirmDeactivation) {
            return {
                success: false,
                needsDeactivationConfirmation: true,
                error:
                    `Este corte desactivaría ${wouldDeactivate} de ${activeForEps} afiliado(s) activo(s) de ` +
                    `${eps.name} (más del 10%). Si el archivo es correcto, confirme la importación de nuevo.`,
            };
        }

        const estadoPrevio = await findEstadoPrevio(organizationId, eps.id, validCedulas);

        const fileHash = createHash('sha256').update(csvText).digest('hex');
        const importId = randomUUID();
        // Un solo sello para todo el corte: dos filas del mismo archivo no
        // deben quedar con `updatedAt` distinto por lo que tardó el troceado.
        const importedAt = new Date();

        let created = 0;
        let updated = 0;
        let reactivated = 0;
        for (const row of report.validRows) {
            const prev = estadoPrevio.get(row.cedula);
            if (!prev) created++;
            else if (prev.isActive) updated++;
            else reactivated++;
        }

        const deactivated = await prisma.$transaction(
            async (tx) => {
                for (let i = 0; i < report.validRows.length; i += UPSERT_CHUNK_ROWS) {
                    await upsertPadronChunk(tx, report.validRows.slice(i, i + UPSERT_CHUNK_ROWS), {
                        organizationId,
                        epsId: eps.id,
                        importId,
                        importedAt,
                    });
                }

                const deactivatedCount = await deactivateAbsent(tx, {
                    organizationId,
                    epsId: eps.id,
                    importId,
                });

                await tx.padronImport.create({
                    data: {
                        id: importId,
                        epsId: eps.id,
                        organizationId,
                        fileName: fileName?.trim() || 'padron.csv',
                        fileHash,
                        totalDataRows: report.totalDataRows,
                        validRows: report.validRows.length,
                        errorRows: report.errors.length,
                        created,
                        updated,
                        reactivated,
                        deactivated: deactivatedCount,
                        deactivationWasConfirmed: needsConfirmation ? true : null,
                        createdByUserId: userId,
                        createdAt: importedAt,
                    },
                });

                await writeAcceptedRows(tx, importId, report.validRows, estadoPrevio);
                if (report.errors.length > 0) {
                    await writeRejectedRows(tx, importId, report.errors);
                }

                return deactivatedCount;
            },
            { maxWait: 10_000, timeout: IMPORT_TIMEOUT_MS },
        );

        revalidatePath('/dashboard/padron');
        revalidatePath('/dashboard/padron/historial');
        return { success: true, importId, created, updated, reactivated, deactivated };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Error al importar el padrón';
        return { success: false, error: message };
    }
}
