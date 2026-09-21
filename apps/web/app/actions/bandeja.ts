'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { resolverActorBandeja, type ResultadoActorBandeja } from '@/lib/bandeja/acceso';
import { aplicarAccion, detalleExcepcion, guardarAvisos } from '@/lib/bandeja/servicio';
import type { ExcepcionDetalle, Resultado } from '@/lib/bandeja/tipos';
import type { EstadoExcepcion } from '@agenia/shared';

/**
 * Bandeja de excepciones de sincronización (docs/PLAN_RASTREO_PACIENTE.md §10 #3).
 * Estas acciones son solo el cable entre Next y el servicio: resuelven QUIÉN pregunta
 * y con qué permisos (`resolverActorBandeja`) y delegan. Todo el criterio —permisos
 * por rol, tenant en cada consulta, alcance del agente, compare-and-set— vive en
 * `lib/bandeja/`, donde se prueba sin montar Next.
 *
 * La clínica SALE DEL TOKEN: ninguna acción recibe una organización del cliente.
 *
 * Solo hay acciones para lo que la pantalla hace DESPUÉS de cargar (abrir el historial,
 * trabajar una excepción, guardar los avisos): la lista y el estado de los avisos los lee
 * la página en el servidor. Cada `export` de un archivo `'use server'` es un endpoint
 * público: no se dejan los que nadie llama.
 */

async function actor(): Promise<ResultadoActorBandeja> {
    return resolverActorBandeja(prisma, await getSession());
}

const error = (mensaje: string): { success: false; error: string } => ({ success: false, error: mensaje });

const RUTA = '/dashboard/bandeja';

export async function detalleExcepcionAction(id: string): Promise<Resultado<ExcepcionDetalle>> {
    const a = await actor();
    if (!a.ok) return error(a.error);
    return detalleExcepcion(prisma, a.actor, id);
}

export async function aplicarAccionExcepcionAction(entrada: {
    id: string;
    accion: string;
    nota?: string;
}): Promise<Resultado<{ estado: EstadoExcepcion }>> {
    const a = await actor();
    if (!a.ok) return error(a.error);
    const r = await aplicarAccion(prisma, a.actor, entrada ?? { id: '', accion: '' });
    if (r.success) {
        // La lista, y la cifra de pendientes que lleva el menú de todo el dashboard.
        revalidatePath(RUTA);
        revalidatePath('/dashboard', 'layout');
    }
    return r;
}

export async function guardarAvisosAction(entrada: {
    numero: string;
    activos: boolean;
}): Promise<Resultado<{ numero: string | null; activos: boolean }>> {
    const a = await actor();
    if (!a.ok) return error(a.error);
    const r = await guardarAvisos(prisma, a.actor, entrada ?? { numero: '', activos: false });
    if (r.success) revalidatePath(RUTA);
    return r;
}
