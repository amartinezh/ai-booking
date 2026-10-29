'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { resolverActorBandeja, type ResultadoActorBandeja } from '@/lib/bandeja/acceso';
import { aplicarAccion, detalleExcepcion, guardarAvisos } from '@/lib/bandeja/servicio';
import { crearYHomologarMedico, type RespuestaAlta } from '@/lib/bandeja/medico-nuevo';
import {
    enviarMensaje,
    prepararMensaje,
    type ClienteMensajes,
    type RespuestaEnvio,
    type RespuestaRevision,
} from '@/lib/bandeja/mensaje-paciente';
import type { ExcepcionDetalle, PreparacionMensaje, Resultado } from '@/lib/bandeja/tipos';
import { actorDeSesion, registrarActividad } from '@/lib/actividad/registrar';
import { describirCita } from '@/lib/actividad/catalogo';
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

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
    respaldo?: string;
    activos: boolean;
}): Promise<Resultado<{ numero: string | null; respaldo: string | null; activos: boolean }>> {
    const a = await actor();
    if (!a.ok) return error(a.error);
    const r = await guardarAvisos(prisma, a.actor, entrada ?? { numero: '', activos: false });
    if (r.success) revalidatePath(RUTA);
    return r;
}

/**
 * 🩺 «Crear y homologar» un médico del hospital desde su caso (2026-10-24). Solo el
 * administrador. El alta la hace la API, con la sesión de quien pulsa.
 */
export async function crearYHomologarMedicoAction(entrada: {
    id: string;
    whatsappOn: boolean;
}): Promise<Resultado<{ nombre: string; accion: 'CREAR' | 'ENLAZAR' }>> {
    const a = await actor();
    if (!a.ok) return error(a.error);
    const r = await crearYHomologarMedico(prisma, a.actor, entrada ?? {}, async (cuerpo): Promise<RespuestaAlta> => {
        const token = (await cookies()).get('auth_token')?.value;
        const res = await fetch(`${INTERNAL_API_URL}/his-doctors/onboard`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Cookie: `auth_token=${token}` } : {}),
            },
            body: JSON.stringify(cuerpo),
            cache: 'no-store',
        });
        if (!res.ok) {
            return {
                success: false,
                error: res.status === 403 ? 'Sin permisos.' : `El servidor respondió ${res.status}. Intenta de nuevo.`,
            };
        }
        return (await res.json()) as RespuestaAlta;
    });
    if (r.success) {
        revalidatePath(RUTA);
        revalidatePath('/dashboard', 'layout');
    }
    return r;
}

/**
 * ✉️ El cable con la API para escribirle al paciente (2026-10-29), con la sesión de
 * quien pulsa. Por la red interna: el proxy del servidor no publica estas rutas.
 */
async function clienteMensajes(): Promise<ClienteMensajes> {
    const token = (await cookies()).get('auth_token')?.value;
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Cookie: `auth_token=${token}` } : {}),
    };
    const leer = async <T,>(res: Response): Promise<T | null> => (res.ok ? ((await res.json()) as T) : null);
    return {
        revisar: async (appointmentId) => {
            try {
                const res = await fetch(`${INTERNAL_API_URL}/chatbot/outbound/cita/${encodeURIComponent(appointmentId)}`, {
                    headers,
                    cache: 'no-store',
                });
                return await leer<RespuestaRevision>(res);
            } catch {
                return null;
            }
        },
        enviar: async (appointmentId, texto) => {
            try {
                const res = await fetch(`${INTERNAL_API_URL}/chatbot/outbound/cita`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ appointmentId, message: texto }),
                    cache: 'no-store',
                });
                return await leer<RespuestaEnvio>(res);
            } catch {
                return null;
            }
        },
    };
}

/** ¿Se le puede escribir al paciente del caso, por dónde y con qué texto sugerido? */
export async function prepararMensajeAlPacienteAction(id: string): Promise<Resultado<PreparacionMensaje>> {
    const a = await actor();
    if (!a.ok) return error(a.error);
    return prepararMensaje(prisma, a.actor, id, await clienteMensajes());
}

/** Le escribe al paciente del caso y lo deja en el historial y en la Actividad de usuarios. */
export async function enviarMensajeAlPacienteAction(entrada: {
    id: string;
    texto: string;
}): Promise<Resultado<{ canal: 'WHATSAPP' | 'TELEGRAM'; destino: string | null }>> {
    const a = await actor();
    if (!a.ok) return error(a.error);
    const r = await enviarMensaje(prisma, a.actor, entrada ?? { id: '', texto: '' }, await clienteMensajes());
    if (!r.success) return r;

    // Quién le escribió, por dónde y sobre qué cita; el texto NO (como en Agendamiento).
    const canal = r.data.canal === 'TELEGRAM' ? 'Telegram' : 'WhatsApp';
    await registrarActividad({
        action: 'PATIENT_MESSAGE_SENT',
        message: `Mensaje manual al paciente de la cita ${r.data.appointmentId} desde la Bandeja (${r.data.canal})`,
        actor: actorDeSesion(a.actor),
        organizationId: a.actor.organizationId,
        metadata: {
            detalle: [`Por ${canal}`, 'desde la Bandeja', describirCita({ inicio: r.data.inicio })]
                .filter(Boolean)
                .join(' · '),
            cita: r.data.appointmentId,
            canal: r.data.canal,
            caracteres: String(entrada.texto ?? '').trim().length,
        },
    });
    revalidatePath(RUTA);
    return { success: true, data: { canal: r.data.canal, destino: r.data.destino } };
}
