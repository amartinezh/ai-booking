'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import { actorDeSesion, registrarActividad } from '@/lib/actividad/registrar';
import { guardarListaEmergencia, validarListaEmergencia } from '@/lib/configuracion/alertas-emergencia';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Resultado<T> = { success: true; data: T } | { success: false; error: string };

/**
 * 🚑 Quién recibe la alerta de posible emergencia (Configuración › Datos de la
 * clínica, docs/GUARDRAIL_EMERGENCIAS.md). Solo el administrador, y solo los de su
 * clínica: la clínica sale del TOKEN. Guarda la lista entera como quedó en la
 * pantalla. Queda en la Actividad de usuarios con los últimos cuatro dígitos.
 */
export async function guardarAlertasEmergenciaAction(entrada: unknown): Promise<Resultado<{ activas: number }>> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) {
        return { success: false, error: 'Acceso denegado' };
    }
    const v = validarListaEmergencia(entrada);
    if (!v.ok) return { success: false, error: v.error };
    try {
        const r = await guardarListaEmergencia(prisma, session.organizationId, v.filas, session.userId ?? null);
        if (r.cambios.length) {
            const detalle = `Alertas de posible emergencia: ${r.cambios.join('; ')}`;
            await registrarActividad({
                action: 'EMERGENCY_ALERT_RECIPIENTS_CHANGED',
                message: detalle,
                actor: actorDeSesion(session),
                organizationId: session.organizationId,
                metadata: { detalle, activas: r.activas },
            });
        }
        revalidatePath('/dashboard/configuracion', 'layout');
        return { success: true, data: { activas: r.activas } };
    } catch (e) {
        const msg = getErrorMessage(e);
        return {
            success: false,
            error: /Unique constraint/i.test(msg) ? 'Ese celular ya está en la lista.' : msg,
        };
    }
}

/**
 * 🚑 «Enviar prueba»: la API le manda a esa persona la plantilla de la alerta con un
 * texto de PRUEBA, con la sesión de quien pulsa; la API vuelve a comprobar que sea
 * administrador y busca a la persona dentro de SU clínica.
 */
export async function probarAlertaEmergenciaAction(id: string): Promise<Resultado<null>> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN' || !session.organizationId) {
        return { success: false, error: 'Acceso denegado' };
    }
    if (typeof id !== 'string' || !id || id.length > 64) return { success: false, error: 'Falta la persona.' };
    try {
        const token = (await cookies()).get('auth_token')?.value;
        const res = await fetch(`${INTERNAL_API_URL}/emergency-alerts/recipients/${encodeURIComponent(id)}/test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Cookie: `auth_token=${token}` } : {}),
            },
            cache: 'no-store',
        });
        if (!res.ok) {
            return {
                success: false,
                error: res.status === 403 ? 'Sin permisos.' : `El servidor respondió ${res.status}. Intente de nuevo.`,
            };
        }
        const r = (await res.json()) as { success: true } | { success: false; error: string };
        await registrarActividad({
            action: 'EMERGENCY_ALERT_TESTED',
            message: r.success ? 'Envió una prueba de la alerta de posible emergencia' : `La prueba de la alerta no salió: ${r.error}`,
            actor: actorDeSesion(session),
            organizationId: session.organizationId,
            metadata: { ok: r.success },
        });
        revalidatePath('/dashboard/configuracion', 'layout');
        return r.success ? { success: true, data: null } : r;
    } catch {
        return { success: false, error: 'No se pudo contactar al servidor. Intente de nuevo.' };
    }
}
