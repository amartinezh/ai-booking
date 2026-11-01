'use server';

// ─────────────────────────────────────────────────────────────
// RESUMEN DE LA ATENCIÓN — server actions de /dashboard/espejo/resumen-atencion.
// docs/PLAN_RESUMEN_ATENCION.md §3.11 (interruptores) y Fase 1 (lectura en sombra).
//
// EXCLUSIVO del driver cnt-sanvicente-anserma y SOLO ORG_ADMIN. Se comprueba en
// CADA acción, nunca solo al cargar la pantalla (mismo criterio que avisos).
//
// En esta fase el panel solo enciende la LECTURA: qué servicios se leen, la
// calma y «Leer del hospital». «Enviar» y los canales no se pueden prender
// aquí (`aplicarCambioDeLectura` lo impide): el envío todavía no existe y, si
// quedaran encendidos, saldría todo de una vez al desplegarlo.
//
// Nada del contenido clínico pasa por aquí: solo configuración y conteos.
// ─────────────────────────────────────────────────────────────

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { registrarActividad } from '@/lib/actividad/registrar';
import {
    aplicarCambioDeLectura,
    configResumenAtencionApagada,
    leerConfigResumenAtencion,
    type CambioLecturaResumen,
    type ConfigResumenAtencion,
} from '@agenia/shared';

const DRIVER = 'cnt-sanvicente-anserma';
const MS_DIA = 86_400_000;

export interface ServicioDelPanel {
    codigo: string;
    nombre: string;
    seLee: boolean;
}

export interface PanelResumenAtencion {
    config: ConfigResumenAtencion;
    servicios: ServicioDelPanel[];
    lectura: {
        cursor: string | null;
        recibidos24h: number;
        recibidos30d: number;
        ultimoRecibidoIso: string | null;
        porServicio: { servicio: string; cantidad: number }[];
    };
}

/** ORG_ADMIN de una clínica con el espejo ENCENDIDO y el driver de Anserma. Nunca dice cuál llave falló. */
async function requireAdmin(): Promise<{ organizationId: string; userId: string; role: string } | null> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) return null;
    const espejo = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: session.organizationId },
        select: { driverKey: true, enabled: true },
    });
    if (!espejo || !espejo.enabled || espejo.driverKey !== DRIVER) return null;
    return { organizationId: session.organizationId, userId: session.userId, role: session.role };
}

export async function getPanelResumenAtencionAction(): Promise<
    { success: true; panel: PanelResumenAtencion } | { success: false; error: string }
> {
    const auth = await requireAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    const ahora = Date.now();
    const desde30 = new Date(ahora - 30 * MS_DIA);
    const [fila, catalogo, recibidos24h, recibidos30d, ultimo, porServicio] = await Promise.all([
        prisma.hospitalMirrorConfig.findUnique({
            where: { organizationId: auth.organizationId },
            select: { resumenAtencion: true, resumenAtencionCursor: true },
        }),
        // Los servicios del HIS los sube el agente con el catálogo (no es exclusivo de esto).
        prisma.mirrorCatalogEntry.findMany({
            where: { organizationId: auth.organizationId, entityType: 'SERVICE' },
            select: { externalKey: true, label: true },
            orderBy: { label: 'asc' },
        }),
        prisma.attentionSummary.count({
            where: { organizationId: auth.organizationId, receivedAt: { gte: new Date(ahora - MS_DIA) } },
        }),
        prisma.attentionSummary.count({ where: { organizationId: auth.organizationId, receivedAt: { gte: desde30 } } }),
        prisma.attentionSummary.findFirst({
            where: { organizationId: auth.organizationId },
            orderBy: { receivedAt: 'desc' },
            select: { receivedAt: true },
        }),
        prisma.attentionSummary.groupBy({
            by: ['serviceCode'],
            where: { organizationId: auth.organizationId, receivedAt: { gte: desde30 } },
            _count: { _all: true },
        }),
    ]);

    const config = leerConfigResumenAtencion(fila?.resumenAtencion) ?? configResumenAtencionApagada();
    const enLaMatriz = new Set(Object.keys(config.servicios));
    const servicios: ServicioDelPanel[] = catalogo.map((c) => ({
        codigo: c.externalKey.trim(),
        nombre: c.label,
        seLee: enLaMatriz.has(c.externalKey.trim()),
    }));
    // Un servicio de la matriz que ya no está en el catálogo igual se muestra: si no, no se podría quitar.
    for (const codigo of enLaMatriz) {
        if (!servicios.some((s) => s.codigo === codigo)) servicios.push({ codigo, nombre: '(no está en el catálogo del hospital)', seLee: true });
    }

    return {
        success: true,
        panel: {
            config,
            servicios,
            lectura: {
                cursor: fila?.resumenAtencionCursor ?? null,
                recibidos24h,
                recibidos30d,
                ultimoRecibidoIso: ultimo?.receivedAt.toISOString() ?? null,
                porServicio: porServicio
                    .map((p) => ({ servicio: p.serviceCode ?? '(sin servicio)', cantidad: p._count._all }))
                    .sort((a, b) => b.cantidad - a.cantidad),
            },
        },
    };
}

export async function updateLecturaResumenAction(
    cambio: CambioLecturaResumen,
): Promise<{ success: true } | { success: false; error: string }> {
    const auth = await requireAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado.' };

    const fila = await prisma.hospitalMirrorConfig.findUnique({
        where: { organizationId: auth.organizationId },
        select: { resumenAtencion: true },
    });
    // Solo lo que el panel puede cambiar en esta fase; lo demás del objeto se ignora.
    const r = aplicarCambioDeLectura(fila?.resumenAtencion, {
        leerDelHospital: cambio?.leerDelHospital,
        serviciosALeer: cambio?.serviciosALeer,
        calmaMinutos: cambio?.calmaMinutos,
    });
    if (!r.ok) return { success: false, error: r.error };

    await prisma.hospitalMirrorConfig.update({
        where: { organizationId: auth.organizationId },
        data: { resumenAtencion: r.config as object },
    });

    if (r.cambios.length) {
        await registrarActividad({
            action: 'ATTENTION_SUMMARY_CONFIG_CHANGED',
            message: 'Configuración del resumen de la atención actualizada',
            actor: { userId: auth.userId, role: auth.role },
            organizationId: auth.organizationId,
            metadata: { detalle: r.cambios.join(' · ').slice(0, 400) },
        });
    }

    revalidatePath('/dashboard/espejo/resumen-atencion');
    return { success: true };
}
