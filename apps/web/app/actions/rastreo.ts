'use server';

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { resolverActor, type ResultadoActor } from '@/lib/rastreo/acceso';
import {
    armarExpedienteA,
    buscarCandidatos,
    investigarCupoB,
    opcionesCupoHis,
    revelarIdentidad,
} from '@/lib/rastreo/servicio';
import type { DatosCaptura } from '@/lib/rastreo/evidencia';
import type {
    ExpedienteA,
    ExpedienteB,
    OpcionMedico,
    Resultado,
    ResultadoBusqueda,
    SujetoRastreo,
} from '@/lib/rastreo/tipos';

/**
 * Rastreo de paciente (docs/PLAN_RASTREO_PACIENTE.md). Estas acciones son solo el
 * cable entre Next y el servicio: resuelven QUIÉN pregunta y con qué permisos
 * (`resolverActor`) y delegan. Todo el criterio —permisos por rol, tenant en
 * cada consulta, bitácora, límite de tasa— vive en `lib/rastreo/`, donde se
 * prueba sin montar Next.
 *
 * `organizationId` de la entrada solo lo mira `resolverActor`, y solo para
 * SUPER_ADMIN: para cualquier otro rol se ignora (el tenant sale del token).
 */

async function actor(organizacionElegida?: string | null): Promise<ResultadoActor> {
    return resolverActor(prisma, await getSession(), organizacionElegida);
}

const error = (mensaje: string): { success: false; error: string } => ({ success: false, error: mensaje });

export async function buscarPacientesAction(entrada: {
    organizationId?: string | null;
    consulta: string;
    motivo: string;
    nota?: string;
}): Promise<Resultado<ResultadoBusqueda>> {
    const a = await actor(entrada?.organizationId);
    if (!a.ok) return error(a.error);
    return buscarCandidatos(prisma, a.actor, entrada);
}

export async function abrirExpedienteAction(entrada: {
    organizationId?: string | null;
    sujeto: SujetoRastreo;
    motivo: string;
    nota?: string;
    captura?: DatosCaptura;
}): Promise<Resultado<ExpedienteA>> {
    const a = await actor(entrada?.organizationId);
    if (!a.ok) return error(a.error);
    return armarExpedienteA(prisma, a.actor, entrada);
}

export async function opcionesCupoHisAction(entrada: {
    organizationId?: string | null;
}): Promise<Resultado<{ medicos: OpcionMedico[] }>> {
    const a = await actor(entrada?.organizationId);
    if (!a.ok) return error(a.error);
    return opcionesCupoHis(prisma, a.actor);
}

export async function investigarCupoHisAction(entrada: {
    organizationId?: string | null;
    documento: string;
    medicoClave: string;
    fecha: string;
    hora: string;
    motivo: string;
    nota?: string;
}): Promise<Resultado<ExpedienteB>> {
    const a = await actor(entrada?.organizationId);
    if (!a.ok) return error(a.error);
    return investigarCupoB(prisma, a.actor, entrada);
}

export async function revelarIdentidadAction(entrada: {
    organizationId?: string | null;
    pacienteId: string;
    motivo: string;
    nota?: string;
}): Promise<Resultado<{ documento: string | null; whatsapp: string | null; bsuid: string | null }>> {
    const a = await actor(entrada?.organizationId);
    if (!a.ok) return error(a.error);
    return revelarIdentidad(prisma, a.actor, entrada);
}
