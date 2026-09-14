'use server';

// ─────────────────────────────────────────────────────────────
// AVISOS MASIVOS — server actions de /dashboard/espejo/avisos.
//
// EXCLUSIVO del driver cnt-sanvicente-anserma — ver
// docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md.
//
// Las tres llaves (§1 del plan) se comprueban en CADA acción, nunca solo al
// cargar la pantalla: 1) rol ORG_ADMIN o BOOKING_AGENT (configurar es solo
// ORG_ADMIN — §1.3); 2) `HospitalMirrorConfig.enabled` + `driverKey`
// correcto; 3) `avisosMasivos.enabled`.
//
// Todo lo de aquí es CRUD directo contra Prisma (igual que el padrón) salvo
// `sendBatchAction`, que llama a la API NestJS porque ahí viven las
// credenciales de WhatsApp — mismo patrón que `sendManualReminder` en
// dashboard.ts.
// ─────────────────────────────────────────────────────────────

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSession, type SessionPayload } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import { validateAvisosCsv, type AvisosCsvError } from '@agenia/shared';

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

const OPERATE_ROLES: SessionPayload['role'][] = ['ORG_ADMIN', 'BOOKING_AGENT'];
const MAX_CSV_CHARS = 2_000_000; // ~2 MB — mucho más que lo que pide un día de agenda real (J.6)
const LOOKUP_CHUNK = 500;

// ════════════════════════════════════════════════════════════════
// LAS TRES LLAVES
// ════════════════════════════════════════════════════════════════

interface AvisosMasivosConfig {
    enabled?: boolean;
    fuente?: 'CSV' | 'ESPEJO';
    maxDestinatariosPorLote?: number;
    ventanaDiasMax?: number;
    ritmoMensajesPorMinuto?: number;
    retencionDiasDatosPersonales?: number;
    medicosHabilitados?: string[];
}

interface AvisosAccess {
    organizationId: string;
    userId: string;
    role: SessionPayload['role'];
    config: AvisosMasivosConfig;
}

/**
 * Llave 1 (rol) + Llave 2 (driver) + Llave 3 (bandera). Devuelve `null` ante
 * CUALQUIER combinación que no cumpla las tres — nunca dice cuál falló, para
 * no delatarle a quien no tiene acceso si el problema es el driver o la
 * bandera (mismo criterio que `MirrorAgentGuard`).
 */
async function requireAvisosAccess(opts?: {
    rolesAllowed?: SessionPayload['role'][];
}): Promise<AvisosAccess | null> {
    const session = await getSession();
    const rolesAllowed = opts?.rolesAllowed ?? OPERATE_ROLES;
    if (!session || !session.organizationId || !rolesAllowed.includes(session.role)) {
        return null;
    }

    const mirrorConfig = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: session.organizationId },
        select: { driverKey: true, enabled: true, avisosMasivos: true },
    });

    const config = (mirrorConfig?.avisosMasivos ?? null) as AvisosMasivosConfig | null;

    if (
        !mirrorConfig ||
        !mirrorConfig.enabled ||
        mirrorConfig.driverKey !== 'cnt-sanvicente-anserma' ||
        !config?.enabled
    ) {
        return null;
    }

    return { organizationId: session.organizationId, userId: session.userId, role: session.role, config };
}

/** Para el panel de configuración: SOLO ORG_ADMIN (§1.3) — y no exige que la Llave 3 ya esté encendida, o nunca se podría prender por primera vez. */
async function requireAvisosAdmin(): Promise<{ organizationId: string } | null> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) return null;

    const mirrorConfig = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: session.organizationId },
        select: { driverKey: true, enabled: true },
    });
    if (!mirrorConfig || !mirrorConfig.enabled || mirrorConfig.driverKey !== 'cnt-sanvicente-anserma') {
        return null;
    }
    return { organizationId: session.organizationId };
}

// ════════════════════════════════════════════════════════════════
// CONFIGURACIÓN (§1.2, §1.3 — solo ORG_ADMIN)
// ════════════════════════════════════════════════════════════════

export async function getAvisosConfigAction(): Promise<
    { success: true; config: AvisosMasivosConfig | null } | { success: false; error: string }
> {
    const auth = await requireAvisosAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    const mirrorConfig = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: auth.organizationId },
        select: { avisosMasivos: true },
    });
    return { success: true, config: (mirrorConfig?.avisosMasivos ?? null) as AvisosMasivosConfig | null };
}

export async function updateAvisosConfigAction(
    partial: AvisosMasivosConfig,
): Promise<{ success: true } | { success: false; error: string }> {
    const auth = await requireAvisosAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    const current = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: auth.organizationId },
        select: { avisosMasivos: true },
    });
    const merged: AvisosMasivosConfig = {
        ...((current?.avisosMasivos as AvisosMasivosConfig | null) ?? {}),
        ...partial,
    };

    await prisma.hospitalMirrorConfig.update({
        where: { organizationId: auth.organizationId },
        data: { avisosMasivos: merged as object },
    });

    revalidatePath('/dashboard/espejo/avisos');
    revalidatePath('/dashboard');
    return { success: true };
}

// ════════════════════════════════════════════════════════════════
// PASO 1 — VALIDAR → CARGAR (§3.3.3)
// ════════════════════════════════════════════════════════════════

export interface AvisosValidationSummary {
    ok: boolean;
    totalDataRows: number;
    validCount: number;
    errorCount: number;
    errors: AvisosCsvError[];
    /** Cuántas de las filas válidas ya tienen un aviso ENVIADO previo (§6.1) — se adelanta aquí, antes de cargar. */
    yaAvisadasPrevio: number;
}

const MAX_ERRORS_RETURNED = 100;

/** Paso 1a — valida el archivo (CSV o el texto que salió de xlsxToCsv). No toca la base de datos. */
export async function validateAvisosFileAction(
    csvText: string,
): Promise<{ success: true; report: AvisosValidationSummary } | { success: false; error: string }> {
    const auth = await requireAvisosAccess();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    if (typeof csvText !== 'string' || csvText.length > MAX_CSV_CHARS) {
        return { success: false, error: 'El archivo supera el tamaño máximo permitido.' };
    }

    const report = validateAvisosCsv(csvText);
    const yaAvisadasPrevio = report.ok
        ? await countPreviouslyNotified(auth.organizationId, report.validRows)
        : 0;

    return {
        success: true,
        report: {
            ok: report.ok,
            totalDataRows: report.totalDataRows,
            validCount: report.validRows.length,
            errorCount: report.errors.length,
            errors: report.errors.slice(0, MAX_ERRORS_RETURNED),
            yaAvisadasPrevio,
        },
    };
}

/** ¿Cuántas filas válidas ya tienen un aviso ENVIADO previo (cualquier lote)? Solo para el resumen del Paso 1 — el detalle fila a fila se calcula al cargar. */
async function countPreviouslyNotified(
    organizationId: string,
    rows: { documento: string; appointmentAtUtc: Date }[],
): Promise<number> {
    const previo = await findPreviousSends(organizationId, rows);
    return rows.filter((r) => previo.has(previousSendKey(r.documento, r.appointmentAtUtc))).length;
}

function previousSendKey(documento: string, appointmentAtUtc: Date): string {
    return `${documento}|${appointmentAtUtc.toISOString()}`;
}

/** Mapa (documento|fechaISO) → { sentAt, batchId } de envíos ENVIADO previos, para TODAS las filas dadas — una sola consulta troceada por documento. */
async function findPreviousSends(
    organizationId: string,
    rows: { documento: string; appointmentAtUtc: Date }[],
): Promise<Map<string, { sentAt: Date; batchId: string }>> {
    const result = new Map<string, { sentAt: Date; batchId: string }>();
    const documentos = [...new Set(rows.map((r) => r.documento))];
    if (documentos.length === 0) return result;

    for (let i = 0; i < documentos.length; i += LOOKUP_CHUNK) {
        const chunk = documentos.slice(i, i + LOOKUP_CHUNK);
        const previos = await prisma.massNoticeRecipient.findMany({
            where: { organizationId, outcome: 'ENVIADO', patientDocument: { in: chunk } },
            select: { patientDocument: true, appointmentAtUtc: true, sentAt: true, batchId: true },
        });
        for (const p of previos) {
            if (!p.sentAt) continue;
            const key = previousSendKey(p.patientDocument, p.appointmentAtUtc);
            const existing = result.get(key);
            // Si hay más de un envío previo (reenvío deliberado en su momento),
            // se queda el más reciente.
            if (!existing || p.sentAt > existing.sentAt) {
                result.set(key, { sentAt: p.sentAt, batchId: p.batchId });
            }
        }
    }
    return result;
}

export interface CargarAvisosResult {
    success: boolean;
    error?: string;
    batchId?: string;
    candidates?: number;
    yaAvisadasPrevio?: number;
}

/**
 * Paso 1b — "2. Cargar información". RE-valida desde cero (regla de oro:
 * nunca confiar en el paso anterior) y, solo si `report.ok`, puebla el lote.
 *
 * Crea el lote si `batchId` no viene (primera carga) o repuebla uno
 * existente en BORRADOR (§3.3.4: se puede repetir cuantas veces haga
 * falta) — reemplaza por completo sus destinatarios PENDIENTE.
 */
export async function loadAvisosFileAction(input: {
    batchId?: string;
    doctorLabel: string;
    serviceLabel?: string;
    csvText: string;
    /** Fase 3 (§10): 'CANCELACION' (default, histórico de Fase 1) | 'RECORDATORIO'. */
    kind?: 'CANCELACION' | 'RECORDATORIO';
}): Promise<CargarAvisosResult> {
    const auth = await requireAvisosAccess();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    if (typeof input.csvText !== 'string' || input.csvText.length > MAX_CSV_CHARS) {
        return { success: false, error: 'El archivo supera el tamaño máximo permitido.' };
    }
    if (!input.doctorLabel?.trim()) {
        return { success: false, error: 'Escriba el médico o el motivo del aviso antes de cargar.' };
    }

    const report = validateAvisosCsv(input.csvText);
    if (!report.ok) {
        return {
            success: false,
            error: `El archivo tiene ${report.errors.length} error(es) — valídelo de nuevo antes de cargar.`,
        };
    }

    const maxPorLote = auth.config.maxDestinatariosPorLote ?? 300;
    if (report.validRows.length > maxPorLote) {
        return {
            success: false,
            error: `El archivo trae ${report.validRows.length} pacientes — supera el máximo de ${maxPorLote} por lote. Divídalo en varios avisos.`,
        };
    }

    let batchId = input.batchId;
    if (batchId) {
        const existing = await prisma.massNoticeBatch.findFirst({
            where: { id: batchId, organizationId: auth.organizationId },
            select: { id: true, status: true },
        });
        if (!existing) return { success: false, error: 'Lote no encontrado.' };
        if (existing.status !== 'BORRADOR') {
            return {
                success: false,
                error: `Este lote está en estado ${existing.status} — no se puede recargar (solo un lote en borrador admite repoblarse).`,
            };
        }
    }

    const dateFrom = report.validRows.reduce(
        (min, r) => (r.appointmentAtUtc < min ? r.appointmentAtUtc : min),
        report.validRows[0].appointmentAtUtc,
    );
    const dateTo = report.validRows.reduce(
        (max, r) => (r.appointmentAtUtc > max ? r.appointmentAtUtc : max),
        report.validRows[0].appointmentAtUtc,
    );

    // ── Resolver contra AgenIA: paciente homologado (BSUID) y aviso previo ──
    const documentos = [...new Set(report.validRows.map((r) => r.documento))];
    const [pacientesAgenIA, previos] = await Promise.all([
        findPatientsByDocumento(auth.organizationId, documentos),
        findPreviousSends(auth.organizationId, report.validRows),
    ]);

    const recipientsData = report.validRows.map((row) => {
        const previo = previos.get(previousSendKey(row.documento, row.appointmentAtUtc));
        return {
            organizationId: auth.organizationId,
            patientDocument: row.documento,
            patientName: row.nombre,
            phoneE164: row.phoneE164,
            appointmentAtUtc: row.appointmentAtUtc,
            agenIAPatientId: pacientesAgenIA.get(row.documento) ?? null,
            previousSentAt: previo?.sentAt ?? null,
            previousSentBatchId: previo?.batchId ?? null,
            // Sin aviso previo: seleccionado por defecto. Con aviso previo: el
            // operador tiene que decidirlo a propósito, viendo el badge (§6.1).
            selected: !previo,
        };
    });

    const kind = input.kind === 'RECORDATORIO' ? 'RECORDATORIO' : 'CANCELACION';

    await prisma.$transaction(async (tx) => {
        if (!batchId) {
            const created = await tx.massNoticeBatch.create({
                data: {
                    organizationId: auth.organizationId,
                    kind,
                    source: 'CSV',
                    status: 'BORRADOR',
                    doctorLabel: input.doctorLabel.trim(),
                    serviceLabel: input.serviceLabel?.trim() || null,
                    dateFrom,
                    dateTo,
                    createdByUserId: auth.userId,
                },
            });
            batchId = created.id;
        } else {
            // Repoblar: reemplaza por completo el conjunto de candidatos
            // (§3.3.4) — solo toca PENDIENTE, nunca una fila ya ENVIADO/FALLIDO
            // (no debería haberlas en BORRADOR, pero es defensivo). `kind` se
            // deja fijo en el valor con el que se creó el lote — no viene de
            // `input.kind` de nuevo, para que un reintento sin ese campo no lo
            // resetee sin querer a 'CANCELACION' a mitad de una repoblación.
            await tx.massNoticeRecipient.deleteMany({ where: { batchId, outcome: 'PENDIENTE' } });
            await tx.massNoticeBatch.update({
                where: { id: batchId },
                data: {
                    doctorLabel: input.doctorLabel.trim(),
                    serviceLabel: input.serviceLabel?.trim() || null,
                    dateFrom,
                    dateTo,
                },
            });
        }

        for (let i = 0; i < recipientsData.length; i += LOOKUP_CHUNK) {
            await tx.massNoticeRecipient.createMany({
                data: recipientsData
                    .slice(i, i + LOOKUP_CHUNK)
                    .map((r) => ({ ...r, batchId: batchId as string })),
            });
        }

        const selectedCount = recipientsData.filter((r) => r.selected).length;
        await tx.massNoticeBatch.update({
            where: { id: batchId },
            data: { candidates: recipientsData.length, selected: selectedCount },
        });
    });

    revalidatePath('/dashboard/espejo/avisos');
    return {
        success: true,
        batchId,
        candidates: recipientsData.length,
        yaAvisadasPrevio: recipientsData.filter((r) => r.previousSentAt).length,
    };
}

async function findPatientsByDocumento(
    organizationId: string,
    documentos: string[],
): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (let i = 0; i < documentos.length; i += LOOKUP_CHUNK) {
        const chunk = documentos.slice(i, i + LOOKUP_CHUNK);
        const found = await prisma.patientProfile.findMany({
            where: { organizationId, cedula: { in: chunk } },
            select: { id: true, cedula: true },
        });
        for (const p of found) result.set(p.cedula, p.id);
    }
    return result;
}

// ════════════════════════════════════════════════════════════════
// PASO 2 — ESCOGER Y REVISAR
// ════════════════════════════════════════════════════════════════

export interface AvisosRecipientView {
    id: string;
    patientDocument: string;
    patientName: string | null;
    phoneMasked: string;
    /** §3.4/J.5 — el celular mostrado es del acompañante, no del paciente. Se
     * etiqueta siempre en pantalla (RecipientsTable), nunca en silencio. */
    phoneIsCompanion: boolean;
    appointmentAtUtc: Date;
    selected: boolean;
    outcome: string;
    previousSentAt: Date | null;
    hasValidPhone: boolean;
}

export interface AvisosBatchView {
    id: string;
    kind: string;
    source: string;
    status: string;
    doctorLabel: string | null;
    serviceLabel: string | null;
    dateFrom: Date;
    dateTo: Date;
    notaAdicional: string | null;
    candidates: number;
    selected: number;
    sent: number;
    failed: number;
    skipped: number;
    createdAt: Date;
    sentAt: Date | null;
    recipients: AvisosRecipientView[];
}

function maskPhone(phone: string | null): string {
    if (!phone) return '— sin teléfono —';
    const digits = phone.replace(/\D/g, '');
    return `•••• ${digits.slice(-4)}`;
}

export async function getBatchAction(
    batchId: string,
): Promise<{ success: true; batch: AvisosBatchView } | { success: false; error: string }> {
    const auth = await requireAvisosAccess();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    const batch = await prisma.massNoticeBatch.findFirst({
        where: { id: batchId, organizationId: auth.organizationId },
        include: { recipients: { orderBy: { appointmentAtUtc: 'asc' } } },
    });
    if (!batch) return { success: false, error: 'Lote no encontrado.' };

    return {
        success: true,
        batch: {
            id: batch.id,
            kind: batch.kind,
            source: batch.source,
            status: batch.status,
            doctorLabel: batch.doctorLabel,
            serviceLabel: batch.serviceLabel,
            dateFrom: batch.dateFrom,
            dateTo: batch.dateTo,
            notaAdicional: batch.notaAdicional,
            candidates: batch.candidates,
            selected: batch.selected,
            sent: batch.sent,
            failed: batch.failed,
            skipped: batch.skipped,
            createdAt: batch.createdAt,
            sentAt: batch.sentAt,
            recipients: batch.recipients.map((r) => ({
                id: r.id,
                patientDocument: r.patientDocument,
                patientName: r.patientName,
                phoneMasked: maskPhone(r.phoneE164),
                phoneIsCompanion: r.phoneIsCompanion,
                appointmentAtUtc: r.appointmentAtUtc,
                selected: r.selected,
                outcome: r.outcome,
                previousSentAt: r.previousSentAt,
                hasValidPhone: !!r.phoneE164,
            })),
        },
    };
}

export async function listBatchesAction(): Promise<
    { success: true; batches: AvisosBatchView[] } | { success: false; error: string }
> {
    const auth = await requireAvisosAccess();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    // Sin `include`: solo la cabecera del lote, que es todo lo que necesita
    // el historial — la lista de destinatarios se pide aparte con
    // `getBatchAction` cuando se abre un lote puntual.
    const batches = await prisma.massNoticeBatch.findMany({
        where: { organizationId: auth.organizationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
    });

    return {
        success: true,
        batches: batches.map((b) => ({
            id: b.id,
            kind: b.kind,
            source: b.source,
            status: b.status,
            doctorLabel: b.doctorLabel,
            serviceLabel: b.serviceLabel,
            dateFrom: b.dateFrom,
            dateTo: b.dateTo,
            notaAdicional: b.notaAdicional,
            candidates: b.candidates,
            selected: b.selected,
            sent: b.sent,
            failed: b.failed,
            skipped: b.skipped,
            createdAt: b.createdAt,
            sentAt: b.sentAt,
            recipients: [],
        })),
    };
}

export async function toggleRecipientSelectionAction(
    recipientId: string,
    selected: boolean,
): Promise<{ success: boolean; error?: string }> {
    const auth = await requireAvisosAccess();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    // El `updateMany` con `batch.organizationId` en el where es lo que impide
    // que una clínica toque una fila de otra — un `update` por id a secas no
    // lo garantizaría.
    const result = await prisma.massNoticeRecipient.updateMany({
        where: { id: recipientId, batch: { organizationId: auth.organizationId, status: 'BORRADOR' } },
        data: { selected },
    });
    if (result.count === 0) {
        return { success: false, error: 'No se pudo actualizar (¿el lote ya no está en borrador?).' };
    }

    revalidatePath('/dashboard/espejo/avisos');
    return { success: true };
}

const MAX_NOTA_ADICIONAL_CHARS = 150;

export async function updateBatchNotaAdicionalAction(
    batchId: string,
    nota: string,
): Promise<{ success: boolean; error?: string }> {
    const auth = await requireAvisosAccess();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    if (nota.length > MAX_NOTA_ADICIONAL_CHARS) {
        return {
            success: false,
            error: `La nota no puede superar los ${MAX_NOTA_ADICIONAL_CHARS} caracteres — tiene que leerse como una frase dentro del mensaje.`,
        };
    }

    const result = await prisma.massNoticeBatch.updateMany({
        where: { id: batchId, organizationId: auth.organizationId, status: 'BORRADOR' },
        data: { notaAdicional: nota.trim() || null },
    });
    if (result.count === 0) {
        return { success: false, error: 'No se pudo actualizar (¿el lote ya no está en borrador?).' };
    }

    revalidatePath('/dashboard/espejo/avisos');
    return { success: true };
}

// ════════════════════════════════════════════════════════════════
// PASO 3 — ENVIAR (llama a la API: ahí viven las credenciales de WhatsApp)
// ════════════════════════════════════════════════════════════════

export interface EnviarAvisosResult {
    success: boolean;
    error?: string;
    status?: string;
    sent?: number;
    failed?: number;
    skipped?: number;
}

export async function sendBatchAction(batchId: string): Promise<EnviarAvisosResult> {
    const auth = await requireAvisosAccess();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        const res = await fetch(`${INTERNAL_API_URL}/mass-notice/${batchId}/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Cookie: `auth_token=${token}` } : {}),
            },
            cache: 'no-store',
        });

        if (!res.ok) {
            const errText = await res.text();
            return { success: false, error: `Backend ${res.status}: ${errText}` };
        }

        const data = await res.json();
        revalidatePath('/dashboard/espejo/avisos');

        if (data?.error) {
            return { success: false, error: data.error, status: data.status };
        }
        return { success: true, status: data.status, sent: data.sent, failed: data.failed, skipped: data.skipped };
    } catch (e) {
        console.error('Error enviando lote de avisos masivos:', e);
        return { success: false, error: getErrorMessage(e) };
    }
}

// ════════════════════════════════════════════════════════════════
// PASO 1, FUENTE ESPEJO (Fase 2) — "Traer del hospital".
//
// Bajo demanda, no réplica continua (§5): esto solo se ejecuta cuando un
// humano pide explícitamente "las citas del Dr. X entre tal y tal fecha".
// Crear el lote es CRUD directo (como el resto); pedirle la lista al agente
// va por la API porque el canal /mirror/* vive ahí, autenticado con el
// token del agente — el web nunca le habla al agente directamente.
// ════════════════════════════════════════════════════════════════

export interface DoctorCatalogOption {
    externalKey: string;
    label: string;
}

/** Médicos del catálogo del HIS, para el selector de "Traer del hospital". Los sube el agente (§ catálogo) — no es un catálogo propio de esta pantalla. */
export async function getDoctorCatalogAction(): Promise<
    { success: true; doctors: DoctorCatalogOption[] } | { success: false; error: string }
> {
    const auth = await requireAvisosAccess();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    const entries = await prisma.mirrorCatalogEntry.findMany({
        where: { organizationId: auth.organizationId, entityType: 'DOCTOR' },
        orderBy: { label: 'asc' },
        select: { externalKey: true, label: true },
    });

    return { success: true, doctors: entries };
}

export interface PedirRosterResult {
    success: boolean;
    error?: string;
    batchId?: string;
    requestId?: string;
}

/**
 * Crea (o repuebla — §3.3.4/§5: "el botón no es de un solo uso") el lote
 * `source='ESPEJO'` y la petición que el agente resolverá en su siguiente
 * vuelta (~30 s). La pantalla, con el `requestId`, hace polling con
 * `getNoticeRequestStatusAction` hasta ver RESUELTA (o ERROR).
 *
 * Con `batchId`: reusa el lote existente (mismo criterio que
 * `loadAvisosFileAction` con el CSV — solo un lote en BORRADOR admite
 * repoblarse) y actualiza médico/servicio/rango; `applyRoster`, del lado del
 * agente, reemplaza los candidatos PENDIENTE cuando responda. Sin `batchId`:
 * primera pedida, crea el lote.
 */
export async function requestNoticeRosterAction(input: {
    batchId?: string;
    doctorExternalKey: string;
    doctorLabel: string;
    serviceLabel?: string;
    fromIso: string;
    toIso: string;
    /** Fase 3 (§10): 'CANCELACION' (default) | 'RECORDATORIO'. Solo se usa al CREAR — ver nota en la rama de repoblar. */
    kind?: 'CANCELACION' | 'RECORDATORIO';
}): Promise<PedirRosterResult> {
    const auth = await requireAvisosAccess();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    if (auth.config.fuente !== 'ESPEJO') {
        return { success: false, error: 'La fuente espejo no está habilitada para esta clínica.' };
    }
    if (!input.doctorExternalKey || !input.fromIso || !input.toIso) {
        return { success: false, error: 'Elija un médico y un rango de fechas.' };
    }

    let batchId = input.batchId;
    if (batchId) {
        const existing = await prisma.massNoticeBatch.findFirst({
            where: { id: batchId, organizationId: auth.organizationId },
            select: { id: true, status: true, source: true },
        });
        if (!existing) return { success: false, error: 'Lote no encontrado.' };
        if (existing.status !== 'BORRADOR') {
            return {
                success: false,
                error: `Este lote está en estado ${existing.status} — no se puede repoblar (solo un lote en borrador admite traer de nuevo).`,
            };
        }
        await prisma.massNoticeBatch.update({
            where: { id: batchId },
            data: {
                doctorExternalKey: input.doctorExternalKey,
                doctorLabel: input.doctorLabel,
                serviceLabel: input.serviceLabel?.trim() || null,
                dateFrom: new Date(input.fromIso),
                dateTo: new Date(input.toIso),
            },
        });
    } else {
        const created = await prisma.massNoticeBatch.create({
            data: {
                organizationId: auth.organizationId,
                kind: input.kind === 'RECORDATORIO' ? 'RECORDATORIO' : 'CANCELACION',
                source: 'ESPEJO',
                status: 'BORRADOR',
                doctorExternalKey: input.doctorExternalKey,
                doctorLabel: input.doctorLabel,
                serviceLabel: input.serviceLabel?.trim() || null,
                dateFrom: new Date(input.fromIso),
                dateTo: new Date(input.toIso),
                createdByUserId: auth.userId,
            },
        });
        batchId = created.id;
    }

    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        const res = await fetch(`${INTERNAL_API_URL}/mass-notice/${batchId}/notice-request`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Cookie: `auth_token=${token}` } : {}),
            },
            body: JSON.stringify({
                doctorExternalKey: input.doctorExternalKey,
                fromIso: input.fromIso,
                toIso: input.toIso,
            }),
            cache: 'no-store',
        });

        if (!res.ok) {
            const errText = await res.text();
            return { success: false, error: `Backend ${res.status}: ${errText}` };
        }

        const data = await res.json();
        revalidatePath('/dashboard/espejo/avisos');
        return { success: true, batchId, requestId: data.requestId };
    } catch (e) {
        console.error('Error pidiendo el roster al agente:', e);
        return { success: false, error: getErrorMessage(e) };
    }
}

export interface NoticeRequestStatusResult {
    success: boolean;
    error?: string;
    status?: string;
    requestError?: string | null;
    /** §5: nunca se recorta en silencio — si el driver trajo más candidatos
     * que `maxDestinatariosPorLote`, la pantalla lo tiene que decir. */
    truncated?: boolean;
}

/** Polling: ¿ya resolvió el agente la petición? */
export async function getNoticeRequestStatusAction(requestId: string): Promise<NoticeRequestStatusResult> {
    const auth = await requireAvisosAccess();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        const res = await fetch(`${INTERNAL_API_URL}/mass-notice/notice-request/${requestId}`, {
            headers: { ...(token ? { Cookie: `auth_token=${token}` } : {}) },
            cache: 'no-store',
        });

        if (!res.ok) {
            const errText = await res.text();
            return { success: false, error: `Backend ${res.status}: ${errText}` };
        }

        const data = await res.json();
        return {
            success: true,
            status: data.status,
            requestError: data.error ?? null,
            truncated: Boolean(data.truncated),
        };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}
