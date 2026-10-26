'use server';

import bcrypt from 'bcryptjs';
import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { SYNC_AUDIT_DIRECTION } from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import { firmarAcceso } from '@/lib/estadisticas/acceso';
import {
    ACCESO_ESTADISTICAS,
    INTENTOS_ESTADISTICAS,
    esIdDeClinica,
    rutaDeEstadisticas,
    validarClaveEstadisticas,
} from '@/lib/estadisticas/clave';

/**
 * 📊 Estadísticas para compartir (2026-10-26). Una página pública por clínica,
 * /estadisticas/<organizationId>, protegida con una clave sencilla que pone el
 * administrador en Configuración. Aquí: entrar y salir (públicas, sin sesión del
 * panel) y poner o quitar la clave (solo ORG_ADMIN).
 */

export type ResultadoEstadisticas = { success: true } | { success: false; error: string };
export type ResultadoClave = { success: true; cambiadaEn: string; cambiadaPor: string } | { success: false; error: string };

const NO_DISPONIBLE = 'Esta página no está disponible.';

/** Quien escribe la clave en la página pública. Si es la correcta, deja la cookie por 30 días. */
export async function entrarAEstadisticas(organizationId: string, clave: string): Promise<ResultadoEstadisticas> {
    if (!esIdDeClinica(organizationId)) return { success: false, error: NO_DISPONIBLE };
    if (typeof clave !== 'string' || clave.length === 0) return { success: false, error: 'Escriba la clave.' };

    const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida';
    try {
        // Igual que «Cambiar mi clave»: los intentos fallidos van a la bitácora
        // del sistema y valen aunque la web se reinicie. Por IP, para frenar al
        // que adivina; y por clínica, para el que cambia de IP.
        const ventana = new Date(Date.now() - INTENTOS_ESTADISTICAS.VENTANA_MIN * 60_000);
        const fallidos = { action: 'PUBLIC_STATS_LOGIN_FAILED', organizationId, createdAt: { gte: ventana } };
        const [deEstaIp, deLaClinica] = await Promise.all([
            prisma.systemLog.count({ where: { ...fallidos, metadata: { path: ['ip'], equals: ip } } }),
            prisma.systemLog.count({ where: fallidos }),
        ]);
        if (deEstaIp >= INTENTOS_ESTADISTICAS.POR_IP || deLaClinica >= INTENTOS_ESTADISTICAS.POR_CLINICA) {
            return {
                success: false,
                error: `Demasiados intentos con una clave equivocada. Espere ${INTENTOS_ESTADISTICAS.VENTANA_MIN} minutos e intente de nuevo.`,
            };
        }

        const s = await prisma.organizationSettings.findUnique({
            where: { organizationId },
            select: { publicStatsKeyHash: true, organization: { select: { isActive: true } } },
        });
        if (!s?.publicStatsKeyHash || !s.organization.isActive) return { success: false, error: NO_DISPONIBLE };

        if (!(await bcrypt.compare(clave, s.publicStatsKeyHash))) {
            await prisma.systemLog
                .create({
                    data: {
                        level: 'WARNING',
                        action: 'PUBLIC_STATS_LOGIN_FAILED',
                        message: 'Clave equivocada en la página de estadísticas para compartir',
                        organizationId,
                        metadata: { ip },
                    },
                })
                .catch((e: unknown) => console.error('No se pudo registrar PUBLIC_STATS_LOGIN_FAILED:', getErrorMessage(e)));
            return { success: false, error: 'La clave no es correcta.' };
        }

        (await cookies()).set(ACCESO_ESTADISTICAS.COOKIE, firmarAcceso(organizationId, s.publicStatsKeyHash), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: rutaDeEstadisticas(organizationId),
            maxAge: ACCESO_ESTADISTICAS.DIAS * 24 * 3600,
        });
        return { success: true };
    } catch (e) {
        console.error('Error al entrar a las estadísticas:', getErrorMessage(e));
        return { success: false, error: 'No se pudo comprobar la clave. Intente de nuevo.' };
    }
}

/** «Salir» en la página pública: borra la cookie de este navegador. */
export async function salirDeEstadisticas(organizationId: string): Promise<ResultadoEstadisticas> {
    if (!esIdDeClinica(organizationId)) return { success: false, error: NO_DISPONIBLE };
    (await cookies()).delete({ name: ACCESO_ESTADISTICAS.COOKIE, path: rutaDeEstadisticas(organizationId) });
    return { success: true };
}

/**
 * Configuración › Estadísticas: si la página está abierta, su enlace completo (con
 * el dominio con que se abrió el panel) y quién cambió la clave por última vez.
 */
export async function getMyEstadisticasParaCompartir() {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') throw new Error('Acceso denegado');
    const s = await prisma.organizationSettings.findUnique({
        where: { organizationId: session.organizationId! },
        select: { publicStatsKeyHash: true, publicStatsKeyUpdatedAt: true, publicStatsKeyUpdatedBy: true },
    });
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const ruta = rutaDeEstadisticas(session.organizationId!);
    return {
        abierta: !!s?.publicStatsKeyHash,
        ruta,
        enlace: host ? `${proto}://${host}${ruta}` : ruta,
        cambiadaEn: s?.publicStatsKeyUpdatedAt?.toISOString() ?? null,
        cambiadaPor: s?.publicStatsKeyUpdatedBy ?? null,
    };
}

/** Pone o cambia la clave: abre la página y cierra las sesiones abiertas con la anterior. */
export async function setMyClaveEstadisticas(clave: string): Promise<ResultadoClave> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };
    const problema = validarClaveEstadisticas(clave);
    if (problema) return { success: false, error: problema };
    const hash = await bcrypt.hash(clave, 10);
    return guardarClave(session, hash);
}

/** Quita la clave: la página se cierra para todos, incluso para quien ya había entrado. */
export async function quitarMyClaveEstadisticas(): Promise<ResultadoClave> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };
    return guardarClave(session, null);
}

async function guardarClave(
    session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
    hash: string | null,
): Promise<ResultadoClave> {
    const organizationId = session.organizationId!;
    const actor = session.email ?? session.userId ?? 'desconocido';
    try {
        const antes = await prisma.organizationSettings.findUnique({
            where: { organizationId },
            select: { publicStatsKeyHash: true },
        });
        const cambiadaEn = new Date();
        const datos = { publicStatsKeyHash: hash, publicStatsKeyUpdatedAt: cambiadaEn, publicStatsKeyUpdatedBy: actor };
        await prisma.organizationSettings.upsert({
            where: { organizationId },
            create: { organizationId, ...datos },
            update: datos,
        });
        const que = hash === null ? 'cerrada (sin clave)' : antes?.publicStatsKeyHash ? 'con clave nueva' : 'abierta con clave';
        // Sin ningún dato de la clave.
        await prisma.syncAudit
            .create({
                data: {
                    organizationId,
                    direction: SYNC_AUDIT_DIRECTION.CONFIG,
                    entityType: 'OrganizationSettings',
                    op: 'PUBLIC_STATS_KEY_CHANGE',
                    outcome: 'OK',
                    detail: `«Estadísticas para compartir»: página ${que} desde Configuración por ${actor}.`,
                },
            })
            .catch((e: unknown) =>
                console.error('[configuración] no se pudo anotar el cambio en la auditoría', { error: getErrorMessage(e) }),
            );
        revalidatePath('/dashboard/configuracion');
        return { success: true, cambiadaEn: cambiadaEn.toISOString(), cambiadaPor: actor };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}
