'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { MirrorAvailabilityMode } from '@agenia/database';
import { SYNC_AUDIT_DIRECTION } from '@agenia/shared';

/**
 * Panel del espejo con el HIS del hospital.
 *
 * Existe porque el plan (§6, capa 4) promete "dead-letter con alerta, nunca
 * descarte silencioso; reproceso manual desde el dashboard" — y ese dashboard
 * no existía. Un evento que se rendía tras diez intentos quedaba en una tabla
 * que solo se veía por `psql`, y la única forma de reintentarlo era un UPDATE
 * a mano. Para el hospital, "esta cita no llegó" era invisible.
 *
 * Todo va contra el tenant de la sesión, nunca contra un id que venga del
 * cliente: una clínica no puede ver ni reprocesar los eventos de otra.
 */

const MINUTO = 60_000;

/** Compartido con app/actions/sync-audit.ts: mismo aislamiento de tenant. */
export async function tenantAdmin(): Promise<string | null> {
    const session = await getSession();
    if (session?.role !== 'ORG_ADMIN' || !session.organizationId) return null;
    return session.organizationId;
}

/** ¿Esta clínica tiene espejo? Decide si el menú muestra la sección. */
export async function tieneEspejo(): Promise<boolean> {
    const organizationId = await tenantAdmin();
    if (!organizationId) return false;
    const config = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId },
        select: { id: true },
    });
    return config !== null;
}

export async function getEstadoEspejo() {
    const organizationId = await tenantAdmin();
    if (!organizationId) return { success: false as const, error: 'Sin permisos.' };

    const config = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId },
        select: {
            driverKey: true,
            enabled: true,
            availabilityMode: true,
            pushEnabled: true,
            pullEnabled: true,
            lastHeartbeatAt: true,
            lastHisReachable: true,
            lastHisDetail: true,
            // Consulta en vivo del rastreo (Fase 2): se muestran, no se cambian aquí.
            lookupEnabled: true,
            lastLookupCapable: true,
        },
    });
    if (!config) {
        return { success: false as const, error: 'Esta clínica no tiene espejo configurado.' };
    }

    const [pendientes, deadLetters, masAntiguo, ultimaReconciliacion, ultimaAgenda, conflictos, cupos] =
        await Promise.all([
            prisma.syncOutbox.count({
                where: { organizationId, deliveredAt: null, deadLettered: false },
            }),
            prisma.syncOutbox.findMany({
                where: { organizationId, deadLettered: true },
                orderBy: { seq: 'asc' },
                take: 50,
                select: {
                    seq: true, eventId: true, entityType: true, entityId: true,
                    op: true, attempts: true, createdAt: true,
                    // El motivo del último fallo que reportó el agente: antes solo
                    // estaba en el journal de la VM del hospital.
                    lastError: true,
                },
            }),
            prisma.syncOutbox.findFirst({
                where: { organizationId, deliveredAt: null, deadLettered: false },
                orderBy: { seq: 'asc' },
                select: { createdAt: true },
            }),
            prisma.syncAudit.findFirst({
                where: { organizationId, direction: SYNC_AUDIT_DIRECTION.RECONCILE },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true, outcome: true, detail: true },
            }),
            prisma.syncAudit.findFirst({
                where: { organizationId, op: 'AVAILABILITY' },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true, outcome: true, detail: true },
            }),
            prisma.syncAudit.findMany({
                where: { organizationId, outcome: 'CONFLICT' },
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: { createdAt: true, entityType: true, op: true, detail: true },
            }),
            prisma.scheduleSlot.count({
                where: { organizationId, startTime: { gte: new Date() } },
            }),
        ]);

    const edadLatidoMin = config.lastHeartbeatAt
        ? Math.round((Date.now() - config.lastHeartbeatAt.getTime()) / MINUTO)
        : null;

    return {
        success: true as const,
        data: {
            config,
            edadLatidoMin,
            pendientes,
            colaDesde: masAntiguo?.createdAt ?? null,
            deadLetters,
            ultimaReconciliacion,
            ultimaAgenda,
            conflictos,
            cuposFuturos: cupos,
        },
    };
}

/**
 * Devuelve un evento del dead-letter a la cola.
 *
 * Se limpia `attempts` además de la marca: si volviera con nueve intentos
 * encima, el primer fallo lo mandaría de vuelta al dead-letter y el reproceso
 * no habría servido de nada. `nextAttemptAt` en null lo pone a la cabeza en
 * vez de dejarlo esperando el backoff viejo.
 */
export async function reprocesarEvento(seq: string) {
    const organizationId = await tenantAdmin();
    if (!organizationId) return { success: false, error: 'Sin permisos.' };

    let valor: bigint;
    try {
        valor = BigInt(seq);
    } catch {
        return { success: false, error: 'Evento inválido.' };
    }

    // `updateMany` con el tenant en el WHERE: el `seq` es una secuencia GLOBAL
    // y sin esa condición una clínica podría reprocesar el evento de otra.
    const { count } = await prisma.syncOutbox.updateMany({
        where: { seq: valor, organizationId, deadLettered: true },
        data: { deadLettered: false, attempts: 0, nextAttemptAt: null },
    });

    if (count === 0) {
        return { success: false, error: 'Ese evento no existe, no es de esta clínica o ya se reprocesó.' };
    }

    await prisma.syncAudit.create({
        data: {
            organizationId,
            direction: SYNC_AUDIT_DIRECTION.AGENIA_TO_HIS,
            entityType: 'OUTBOX',
            op: 'REPROCESS',
            outcome: 'OK',
            detail: `Evento seq ${seq} devuelto a la cola desde el panel.`,
        },
    });

    revalidatePath('/dashboard/espejo');
    return { success: true };
}

const MODOS_AGENDA = ['OFF', 'SHADOW', 'ON'] as const;

/**
 * Cambia `availabilityMode` (§11 del manual de instalación del agente).
 *
 * Es progresivo a propósito — OFF no toca nada, SHADOW calcula y reporta sin
 * escribir, ON ya sustituye la agenda de AgenIA por la del hospital — y el
 * salto a ON es una decisión de negocio, no técnica: se toma después de una
 * semana comparando SHADOW contra la realidad. El agente lo recoge en su
 * siguiente vuelta de `bucleAgenda` (hasta 15 min) — no hace falta reiniciar
 * nada del lado del hospital.
 */
export async function cambiarModoAgenda(modo: string) {
    const organizationId = await tenantAdmin();
    if (!organizationId) return { success: false, error: 'Sin permisos.' };

    if (!MODOS_AGENDA.includes(modo as (typeof MODOS_AGENDA)[number])) {
        return { success: false, error: 'Modo inválido.' };
    }

    const config = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId },
        select: { availabilityMode: true },
    });
    if (!config) {
        return { success: false, error: 'Esta clínica no tiene espejo configurado.' };
    }
    if (config.availabilityMode === modo) {
        return { success: true };
    }

    await prisma.hospitalMirrorConfig.update({
        where: { organizationId },
        data: { availabilityMode: modo as MirrorAvailabilityMode },
    });

    await prisma.syncAudit.create({
        data: {
            organizationId,
            direction: SYNC_AUDIT_DIRECTION.CONFIG,
            entityType: 'HospitalMirrorConfig',
            op: 'AVAILABILITY_MODE_CHANGE',
            outcome: 'OK',
            detail: `availabilityMode: ${config.availabilityMode} → ${modo} (cambiado desde el panel).`,
        },
    });

    revalidatePath('/dashboard/espejo');
    return { success: true };
}

/**
 * Prende o apaga el ENVÍO de AgenIA hacia el hospital (`pushEnabled`).
 *
 * Apagado, la API no le entrega ningún evento al agente (ver
 * `MirrorDispatchService.getPendingEvents`), así que nada de lo que pase en
 * AgenIA se escribe en el HIS: ni citas nuevas, ni cancelaciones, ni cambios.
 * Lo que llega DESDE el hospital (agenda, citas de ventanilla) sigue entrando.
 * Los eventos no se pierden: esperan en la cola y salen al volver a encenderlo.
 *
 * Surte efecto en el siguiente segundo del long-poll del agente; no hace falta
 * reiniciar nada en la VM del hospital.
 */
export async function cambiarEnvioAlHospital(enabled: boolean) {
    const organizationId = await tenantAdmin();
    if (!organizationId) return { success: false, error: 'Sin permisos.' };

    // `=== true`: lo que no sea exactamente `true` apaga (falla hacia no
    // escribir en el sistema del hospital).
    const pushEnabled = enabled === true;

    const config = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId },
        select: { pushEnabled: true },
    });
    if (!config) {
        return { success: false, error: 'Esta clínica no tiene espejo configurado.' };
    }
    if (config.pushEnabled === pushEnabled) {
        return { success: true };
    }

    const session = await getSession();
    const enCola = await prisma.syncOutbox.count({
        where: { organizationId, deliveredAt: null, deadLettered: false },
    });

    await prisma.$transaction([
        prisma.hospitalMirrorConfig.update({
            where: { organizationId },
            data: { pushEnabled },
        }),
        prisma.syncAudit.create({
            data: {
                organizationId,
                direction: SYNC_AUDIT_DIRECTION.CONFIG,
                entityType: 'HospitalMirrorConfig',
                op: 'PUSH_ENABLED_CHANGE',
                outcome: 'OK',
                detail:
                    `Envío al hospital ${pushEnabled ? 'ENCENDIDO' : 'APAGADO'} desde el panel ` +
                    `por ${session?.email ?? session?.userId ?? 'desconocido'}; ` +
                    `${enCola} evento(s) en cola en ese momento.`,
            },
        }),
    ]);

    revalidatePath('/dashboard/espejo');
    return { success: true };
}
