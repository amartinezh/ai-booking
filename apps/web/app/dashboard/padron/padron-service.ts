// ─────────────────────────────────────────────────────────────
// PADRÓN EPS — lógica de las tres operaciones que cargan el CSV completo
// (validar / reporte de errores / importar).
//
// 🔴 A PROPÓSITO NO ES UNA SERVER ACTION ('use server'). El CSV del padrón
// viaja como texto y el corte real del hospital piloto pesa varios MB —
// mucho más de 1.000.000 de caracteres. Una Server Action de Next.js
// codifica sus argumentos con el "reply encoder" de React Flight
// (react-server-dom-turbopack), que cuenta cada CARÁCTER de un string dentro
// del arreglo de argumentos como un "slot" contra un límite interno de
// 1.000.000 (`_arraySizeLimit`, ver bumpArrayCount en
// react-server-dom-turbopack-server.*.js). Un csvText de varios MB revienta
// ese límite SIEMPRE, sin importar el contenido del archivo — y lo hace AL
// DECODIFICAR LOS ARGUMENTOS, antes de que el cuerpo de la función llegue a
// ejecutarse, así que ningún try/catch de aquí adentro puede atraparlo.
// Sucedió en producción con el archivo real de Sura del hospital piloto:
// "Error: Maximum array nesting exceeded" — un 500 enmascarado, siempre con
// el mismo digest, y con "at ignore-listed frames" en el log del servidor
// porque el fallo ocurre en código interno de React, no en el nuestro.
//
// `next.config.ts` sube `serverActions.bodySizeLimit` a 8mb, pero eso solo
// controla el tamaño del CUERPO HTTP — no evita el límite de "slots" del
// decodificador de Flight, que es interno y no configurable desde afuera.
//
// La solución real: sacar estas tres operaciones del mecanismo de Server
// Actions y exponerlas como Route Handlers normales
// (app/api/padron/{validate,import,error-report}/route.ts), que leen el
// cuerpo con `request.json()` — el parser JSON estándar de Node, sin el
// codificador de Flight de por medio. Este archivo es la lógica PURA que
// esas tres rutas llaman; no importa nada de `next/headers` fuera de
// `getSession()` (que sí funciona igual en Route Handlers).
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// PADRÓN EPS — lógica de importación del CSV del padrón.
//
// Flujo de tres pasos:
//   1) runValidatePadronCsv → valida A FONDO el archivo contra la EPS
//      elegida en pantalla (sin escribir nada), y mide cuánta gente quedaría
//      desactivada si se aplica tal cual.
//   2) runImportPadronCsv   → RE-valida (regla de oro: nunca confiar en el
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

// Límites defensivos: el CSV viaja como texto en el body de la petición.
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
    /** Cédulas duplicadas u otras inconsistencias que NO bloquean el archivo. */
    warningCount: number;
    /** Muestra de warnings (máx. MAX_ERRORS_RETURNED) — se ignoran al importar, no hace falta corregirlas. */
    warnings: PadronCsvError[];
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
    /** Filas con cédula duplicada dentro del archivo, ignoradas (solo entró la primera aparición). */
    duplicatesIgnored?: number;
}

/** 'ALL' = todo el padrón de la EPS; 'ACTIVE'/'INACTIVE' filtran por `isActive`. */
export type PadronEstadoFiltro = 'ALL' | 'ACTIVE' | 'INACTIVE';
const ESTADOS_FILTRO: readonly PadronEstadoFiltro[] = ['ALL', 'ACTIVE', 'INACTIVE'];

export interface PadronClearPreview {
    epsId: string;
    epsName: string;
    estado: PadronEstadoFiltro;
    /** Cuántos registros coinciden con el filtro hoy — puede cambiar si alguien más toca el padrón antes de confirmar. */
    count: number;
}

export interface PadronClearResult {
    success: boolean;
    error?: string;
    deletedCount?: number;
}

export async function requireOrgAdmin(): Promise<{ organizationId: string; userId: string } | null> {
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
export async function runValidatePadronCsv(
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

    try {
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
                warningCount: report.warnings.length,
                warnings: report.warnings.slice(0, MAX_ERRORS_RETURNED),
                epsId: eps.id,
                epsName: eps.name,
                activeForEps,
                wouldDeactivate,
                needsDeactivationConfirmation:
                    activeForEps > 0 && wouldDeactivate / activeForEps > DEACTIVATION_CONFIRM_THRESHOLD,
                ignoredPreambleLines: report.ignoredPreambleLines,
            },
        };
    } catch (e: unknown) {
        console.error('[padron] runValidatePadronCsv:', e);
        const message = e instanceof Error ? e.message : 'Error al validar el archivo';
        return { success: false, error: `Error inesperado al validar: ${message}` };
    }
}

/**
 * Reporte de errores COMPLETO (sin el tope de MAX_ERRORS_RETURNED) para
 * descargar como CSV cuando el archivo tiene demasiados errores para leerlos
 * cómodamente en pantalla. Re-valida desde cero, igual que el paso de
 * importación — nunca confía en un reporte previo del cliente. Ya no depende
 * de la EPS: la validación por fila no la usa.
 */
export async function runGetPadronFullErrorReport(
    csvText: string,
): Promise<{ success: true; csv: string } | { success: false; error: string }> {
    const auth = await requireOrgAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado' };

    if (typeof csvText !== 'string' || csvText.length > MAX_CSV_CHARS) {
        return { success: false, error: 'El archivo supera el tamaño máximo permitido (6 MB).' };
    }

    try {
        const report = validatePadronCsv(csvText);

        const escapeCsvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
        const lines = ['tipo,linea,columna,mensaje'];
        for (const err of report.errors) {
            lines.push(
                ['ERROR', String(err.line), escapeCsvCell(err.column ?? ''), escapeCsvCell(err.message)].join(','),
            );
        }
        for (const warn of report.warnings) {
            lines.push(
                ['ADVERTENCIA', String(warn.line), escapeCsvCell(warn.column ?? ''), escapeCsvCell(warn.message)].join(
                    ',',
                ),
            );
        }

        return { success: true, csv: lines.join('\n') };
    } catch (e: unknown) {
        console.error('[padron] runGetPadronFullErrorReport:', e);
        const message = e instanceof Error ? e.message : 'Error al generar el reporte';
        return { success: false, error: `Error inesperado al generar el reporte: ${message}` };
    }
}

function estadoFiltroWhere(estado: PadronEstadoFiltro): { isActive?: boolean } {
    if (estado === 'ACTIVE') return { isActive: true };
    if (estado === 'INACTIVE') return { isActive: false };
    return {};
}

/**
 * Paso 1 de "vaciar padrón" — cuenta cuántos registros coinciden con la EPS y
 * el filtro de estado elegidos, SIN borrar nada. Es lo contrario de
 * `runValidatePadronCsv`: aquí no hay archivo, solo un conteo para que la
 * pantalla muestre el impacto antes de pedir la confirmación final.
 */
export async function runPreviewClearPadronEps(
    epsId: string,
    estado: PadronEstadoFiltro,
): Promise<{ success: true; preview: PadronClearPreview } | { success: false; error: string }> {
    const auth = await requireOrgAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado' };

    if (typeof epsId !== 'string' || !epsId) {
        return { success: false, error: 'Seleccione la EPS que quiere vaciar.' };
    }
    if (!ESTADOS_FILTRO.includes(estado)) {
        return { success: false, error: 'Seleccione qué registros quiere borrar.' };
    }

    const eps = await requireActiveEps(auth.organizationId, epsId);
    if (!eps) {
        return { success: false, error: 'La EPS seleccionada no existe o no está activa en la clínica.' };
    }

    const count = await prisma.epsEnrolledPatient.count({
        where: { organizationId: auth.organizationId, epsId: eps.id, ...estadoFiltroWhere(estado) },
    });

    return { success: true, preview: { epsId: eps.id, epsName: eps.name, estado, count } };
}

/**
 * Paso 2 de "vaciar padrón" — BORRA definitivamente (DELETE, no baja lógica)
 * los registros de `EpsEnrolledPatient` que coincidan con la EPS y el filtro
 * elegidos. Lo contrario real de importar (que solo crea/actualiza/desactiva):
 * aquí las filas desaparecen y no hay CSV que recargar para revertirlo.
 *
 * `EpsEnrolledPatient` es una tabla hoja (nada más la referencia por FK), así
 * que el DELETE no arrastra nada más. Tampoco necesita troceo como el
 * importador: un `deleteMany` con un WHERE sobre columnas indexadas usa un
 * puñado de parámetros sin importar cuántas filas borre, muy distinto del
 * `VALUES` multi-fila del upsert que sí revienta el límite de Postgres.
 *
 * Exige escribir el nombre EXACTO de la EPS como confirmación — un checkbox
 * no alcanza aquí: a diferencia de la guarda del 10% al importar (que se
 * puede deshacer recargando el CSV correcto), este borrado no tiene vuelta
 * atrás.
 */
export async function runClearPadronEps(
    epsId: string,
    estado: PadronEstadoFiltro,
    confirmEpsName: string,
): Promise<PadronClearResult> {
    const auth = await requireOrgAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado' };

    if (typeof epsId !== 'string' || !epsId) {
        return { success: false, error: 'Seleccione la EPS que quiere vaciar.' };
    }
    if (!ESTADOS_FILTRO.includes(estado)) {
        return { success: false, error: 'Seleccione qué registros quiere borrar.' };
    }

    const eps = await requireActiveEps(auth.organizationId, epsId);
    if (!eps) {
        return { success: false, error: 'La EPS seleccionada no existe o no está activa en la clínica.' };
    }

    if (typeof confirmEpsName !== 'string' || confirmEpsName.trim() !== eps.name) {
        return { success: false, error: `Escriba "${eps.name}" exactamente para confirmar la eliminación.` };
    }

    try {
        const result = await prisma.epsEnrolledPatient.deleteMany({
            where: { organizationId: auth.organizationId, epsId: eps.id, ...estadoFiltroWhere(estado) },
        });

        console.warn(
            `[padron] runClearPadronEps: usuario ${auth.userId} eliminó ${result.count} registro(s) de ` +
                `"${eps.name}" (org ${auth.organizationId}, filtro ${estado}).`,
        );

        revalidatePath('/dashboard/padron');
        return { success: true, deletedCount: result.count };
    } catch (e: unknown) {
        console.error('[padron] runClearPadronEps:', e);
        const message = e instanceof Error ? e.message : 'Error al limpiar el padrón';
        return { success: false, error: `Error inesperado al limpiar: ${message}` };
    }
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

/**
 * Filas que NO entraron a `EpsEnrolledPatient`, con su motivo — cédula cruda
 * (cuando el parser la alcanzó a leer) + el mensaje. Sirve tanto para
 * `RECHAZADO` (error real, bloqueaba el archivo) como para `DUPLICADO`
 * (warning: la fila se ignoró pero el archivo se importó igual).
 */
async function writeSkippedRows(
    tx: Prisma.TransactionClient,
    importId: string,
    items: PadronCsvError[],
    resultado: 'RECHAZADO' | 'DUPLICADO',
): Promise<void> {
    const data = items.map((item) => ({
        id: randomUUID(),
        importId,
        line: item.line,
        cedulaCruda: item.rawCedula ?? '',
        // Para DUPLICADO, rawCedula YA es la cédula normalizada (ver
        // padron-csv.ts): la fila pasó la validación de forma, solo se
        // ignoró por repetida. Para RECHAZADO no hay garantía de eso.
        cedulaNormalizada: resultado === 'DUPLICADO' ? (item.rawCedula ?? null) : null,
        resultado,
        errorColumn: item.column ?? null,
        errorMessage: item.message,
    }));
    for (let i = 0; i < data.length; i += UPSERT_CHUNK_ROWS) {
        await tx.padronImportRow.createMany({ data: data.slice(i, i + UPSERT_CHUNK_ROWS) });
    }
}

/** Paso 2 — re-valida, mide de nuevo el impacto, y aplica el reemplazo por EPS. */
export async function runImportPadronCsv(
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
                    await writeSkippedRows(tx, importId, report.errors, 'RECHAZADO');
                }
                if (report.warnings.length > 0) {
                    await writeSkippedRows(tx, importId, report.warnings, 'DUPLICADO');
                }

                return deactivatedCount;
            },
            { maxWait: 10_000, timeout: IMPORT_TIMEOUT_MS },
        );

        revalidatePath('/dashboard/padron');
        revalidatePath('/dashboard/padron/historial');
        return {
            success: true,
            importId,
            created,
            updated,
            reactivated,
            deactivated,
            duplicatesIgnored: report.warnings.length,
        };
    } catch (e: unknown) {
        console.error('[padron] runImportPadronCsv:', e);
        const message = e instanceof Error ? e.message : 'Error al importar el padrón';
        return { success: false, error: message };
    }
}
