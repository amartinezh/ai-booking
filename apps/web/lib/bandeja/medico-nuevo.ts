/**
 * 🩺 «Crear y homologar» desde la Bandeja (2026-10-24).
 *
 * El panel solo decide QUIÉN pulsa y QUÉ caso es; el alta la hace la API
 * (`MedicosNuevosService.homologar`), la misma que usa la homologación automática,
 * para que las reglas vivan en un solo sitio. La clínica sale del actor (del token),
 * nunca del cliente.
 */
import type { PrismaClient } from '@agenia/database';
import { ESTADOS_ACTIVOS } from '@agenia/shared';
import type { ActorBandeja } from './acceso';
import type { Resultado } from './tipos';

export type RespuestaAlta =
    | { success: true; accion: 'CREAR' | 'ENLAZAR'; nombre: string }
    | { success: false; error: string };

export async function crearYHomologarMedico(
    prisma: Pick<PrismaClient, 'syncException'>,
    actor: ActorBandeja,
    entrada: { id?: unknown; whatsappOn?: unknown },
    llamarApi: (cuerpo: { externalKey: string; whatsappOn: boolean }) => Promise<RespuestaAlta>,
): Promise<Resultado<{ nombre: string; accion: 'CREAR' | 'ENLAZAR' }>> {
    if (!actor.permisos.administrar) {
        return { success: false, error: 'Solo el administrador de la clínica puede crear y homologar médicos.' };
    }
    const id = typeof entrada?.id === 'string' ? entrada.id : '';
    if (!id) return { success: false, error: 'Falta el caso.' };

    const caso = await prisma.syncException.findFirst({
        where: { id, organizationId: actor.organizationId },
        select: { kind: true, status: true, meta: true },
    });
    if (!caso || caso.kind !== 'MEDICO_SIN_HOMOLOGAR') {
        return { success: false, error: 'Ese caso no es de un médico por homologar.' };
    }
    if (!(ESTADOS_ACTIVOS as readonly string[]).includes(caso.status)) {
        return { success: false, error: 'Ese caso ya está cerrado: recarga la página.' };
    }
    const meta = (caso.meta && typeof caso.meta === 'object' ? caso.meta : {}) as Record<string, unknown>;
    const externalKey = typeof meta.externalKey === 'string' ? meta.externalKey : '';
    if (!externalKey) return { success: false, error: 'El caso no dice qué médico es.' };

    const r = await llamarApi({ externalKey, whatsappOn: entrada?.whatsappOn === true });
    return r.success ? { success: true, data: { nombre: r.nombre, accion: r.accion } } : { success: false, error: r.error };
}
