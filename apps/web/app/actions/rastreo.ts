'use server';

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { enviarConfirmacionHis, type RespuestaApiConfirmacion } from '@/lib/rastreo/confirmacion';
import { resolverActor, type ResultadoActor } from '@/lib/rastreo/acceso';
import {
    armarExpedienteA,
    buscarCandidatos,
    investigarCupoB,
    opcionesCupoHis,
    revelarIdentidad,
} from '@/lib/rastreo/servicio';
import {
    iniciarConsultaHis,
    progresoDeConsultaHis,
    type EntradaIniciarConsultaHis,
} from '@/lib/rastreo/servicio-his';
import type { DatosCaptura } from '@/lib/rastreo/evidencia';
import type {
    ConsultaHisIniciada,
    ExpedienteA,
    ExpedienteB,
    OpcionMedico,
    ProgresoConsultaHis,
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

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
    /** Ids devueltos por `iniciarConsultaHisAction`: aplica lo que respondió el HIS. */
    consultaHisIds?: string[];
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
    /** Ids devueltos por `iniciarConsultaHisAction`: aplica lo que respondió el HIS. */
    consultaHisIds?: string[];
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

/**
 * Pide una consulta en vivo al HIS del hospital (Fase 2). Devuelve los ids que la
 * pantalla sondea con `progresoConsultaHisAction`; los datos del HIS no viajan
 * aquí: llegan al reabrir el expediente con esos ids.
 */
export async function iniciarConsultaHisAction(
    entrada: { organizationId?: string | null } & EntradaIniciarConsultaHis,
): Promise<Resultado<ConsultaHisIniciada>> {
    const a = await actor(entrada?.organizationId);
    if (!a.ok) return error(a.error);
    return iniciarConsultaHis(prisma, a.actor, entrada);
}

/** Cómo va una consulta en vivo: en curso, lista o fallida. */
export async function progresoConsultaHisAction(entrada: {
    organizationId?: string | null;
    ids: string[];
}): Promise<Resultado<ProgresoConsultaHis>> {
    const a = await actor(entrada?.organizationId);
    if (!a.ok) return error(a.error);
    return progresoDeConsultaHis(prisma, a.actor, entrada);
}

/**
 * Le envía al paciente, por WhatsApp, la confirmación de una cita que agendó el
 * hospital y que el bot no le muestra (escenario B, §12 #7). La web deja constancia
 * y la API envía, con el token de ESTA sesión: la clínica y el actor salen de ahí.
 */
export async function enviarConfirmacionHisAction(entrada: {
    organizationId?: string | null;
    pacienteId: string;
    slotId: string;
    verificacion: 'HIS_EN_VIVO' | 'FUNCIONARIO';
    motivo: string;
    nota?: string;
}): Promise<Resultado<{ via: 'TEXTO' | 'PLANTILLA' }>> {
    const a = await actor(entrada?.organizationId);
    if (!a.ok) return error(a.error);
    return enviarConfirmacionHis(prisma, a.actor, entrada, async (cuerpo) => {
        const token = (await cookies()).get('auth_token')?.value;
        const res = await fetch(`${INTERNAL_API_URL}/appointments/his-confirmation`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Cookie: `auth_token=${token}` } : {}),
            },
            body: JSON.stringify(cuerpo),
            cache: 'no-store',
        });
        if (!res.ok) {
            // 403 = el token no alcanza (rol o clínica); el resto, un fallo del servidor.
            return {
                success: false,
                error: res.status === 403 ? 'Sin permisos.' : `El servidor de envíos respondió ${res.status}.`,
            };
        }
        return (await res.json()) as RespuestaApiConfirmacion;
    });
}
