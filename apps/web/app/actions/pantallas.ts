'use server';

/**
 * 👁️📥 Pantallas abiertas y descargas, en la Actividad de usuarios (2026-10-27).
 *
 * Las llama el panel: `RegistroDePantallas` (en los layouts) al cambiar de pantalla,
 * y los botones de descarga al bajar un archivo con datos de pacientes. Solo se
 * anota la ruta (nunca la consulta, que puede llevar una cédula) y, de una misma
 * pantalla, una vez cada 30 minutos por persona.
 */
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { actorDeSesion, registrarActividad } from '@/lib/actividad/registrar';
import {
    DESCARGAS,
    VENTANA_PANTALLA_MIN,
    esTipoDescarga,
    nombreDePantalla,
    rutaLimpia,
} from '@/lib/actividad/pantallas';

export async function registrarPantalla(ruta: string): Promise<void> {
    try {
        const session = await getSession();
        if (!session) return;
        const r = rutaLimpia(typeof ruta === 'string' ? ruta.slice(0, 200) : '');
        const nombre = nombreDePantalla(r, session.role);
        if (!nombre) return;
        const reciente = await prisma.systemLog.count({
            where: {
                userId: session.userId,
                action: 'SCREEN_VIEWED',
                createdAt: { gte: new Date(Date.now() - VENTANA_PANTALLA_MIN * 60_000) },
                metadata: { path: ['ruta'], equals: r },
            },
        });
        if (reciente > 0) return;
        await registrarActividad({
            action: 'SCREEN_VIEWED',
            message: `Pantalla abierta: ${nombre}`,
            actor: actorDeSesion(session),
            organizationId: session.organizationId ?? null,
            metadata: { detalle: nombre, ruta: r },
        });
    } catch (e) {
        // Anotar una pantalla nunca rompe la navegación.
        console.error('[actividad] no se pudo anotar la pantalla:', e instanceof Error ? e.message : e);
    }
}

export async function registrarDescarga(tipo: string, info: { filas?: number; lote?: string } = {}): Promise<void> {
    try {
        const session = await getSession();
        if (!session || !esTipoDescarga(tipo)) return;
        const filas = Number.isFinite(info.filas) ? Number(info.filas) : null;
        await registrarActividad({
            action: 'DATA_EXPORTED',
            level: 'WARNING',
            message: `Descarga: ${DESCARGAS[tipo]}`,
            actor: actorDeSesion(session),
            organizationId: session.organizationId ?? null,
            metadata: {
                detalle: `${DESCARGAS[tipo]}${filas !== null ? ` · ${filas} fila(s)` : ''}`,
                tipo,
                filas,
                lote: typeof info.lote === 'string' ? info.lote.slice(0, 64) : null,
            },
        });
    } catch (e) {
        console.error('[actividad] no se pudo anotar la descarga:', e instanceof Error ? e.message : e);
    }
}
