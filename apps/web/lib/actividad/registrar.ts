/**
 * 👣 ACTIVIDAD DE USUARIOS — dejar constancia de lo que hace una persona.
 *
 * Va a la bitácora del sistema (`SystemLog`), como ya lo hacían el ingreso, el
 * cambio de clave y los días sin citas, con lo que la pantalla del super
 * administrador necesita para responder «quién, qué, cuándo y desde dónde»:
 * el usuario y su clínica en columnas, y en `metadata` su correo, su rol, la IP
 * y el navegador de la petición.
 *
 * Nunca lanza ni frena la acción: si la escritura falla, la acción sigue y el
 * fallo queda en la consola. Nunca se guardan claves.
 */
import { headers } from 'next/headers';
import { prisma } from '../prisma';
import { getErrorMessage } from '../error';

export interface OrigenDeLaPeticion {
    ip: string | null;
    navegador: string | null;
}

/**
 * La IP y el navegador de quien hace la petición. Detrás del proxy (Caddy), la IP
 * real es la primera de `x-forwarded-for`: Caddy descarta la que manda el cliente
 * y pone la suya. Fuera de una petición (pruebas, tareas) devuelve vacío.
 */
export async function origenDeLaPeticion(): Promise<OrigenDeLaPeticion> {
    try {
        const h = await headers();
        const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || null;
        const navegador = h.get('user-agent')?.trim() || null;
        return { ip: ip ? ip.slice(0, 64) : null, navegador: navegador ? navegador.slice(0, 300) : null };
    } catch {
        return { ip: null, navegador: null };
    }
}

export interface ActorDeLaActividad {
    userId?: string | null;
    email?: string | null;
    role?: string | null;
}

export interface Actividad {
    /** Código de la acción (USER_LOGIN, USER_CREATED…). Ver `ACCIONES_DE_LA_BITACORA`. */
    action: string;
    /** Frase corta para la bitácora técnica (`/super-admin/logs`). */
    message: string;
    level?: 'EVENT' | 'WARNING';
    /** Quién lo hizo; null si no se sabe (un correo que no tiene cuenta). */
    actor: ActorDeLaActividad | null;
    /** La clínica afectada (la del actor, o la de la cuenta tocada por un super administrador). */
    organizationId: string | null | undefined;
    /** Lo que la pantalla muestra en el detalle. Sin claves ni datos completos de pacientes. */
    metadata?: Record<string, unknown>;
    /** El origen ya leído (el ingreso lo lee una vez para el tope de intentos y lo reutiliza). */
    origen?: OrigenDeLaPeticion;
}

export async function registrarActividad(a: Actividad): Promise<void> {
    try {
        const origen = a.origen ?? (await origenDeLaPeticion());
        await prisma.systemLog.create({
            data: {
                level: a.level ?? 'EVENT',
                action: a.action,
                message: a.message.slice(0, 8000),
                userId: a.actor?.userId ?? null,
                organizationId: a.organizationId ?? null,
                metadata: {
                    ...(a.metadata ?? {}),
                    email: a.actor?.email ?? (a.metadata?.email as string | undefined) ?? null,
                    // `role` con este nombre: «Logueos por rol» de Estadísticas Globales lo filtra así.
                    role: a.actor?.role ?? null,
                    ip: origen.ip,
                    userAgent: origen.navegador,
                } as never,
            },
        });
    } catch (e: unknown) {
        console.error(`No se pudo registrar ${a.action}:`, getErrorMessage(e));
    }
}

/** Quién hace la acción, a partir de la sesión. */
export function actorDeSesion(s: { userId: string; email?: string | null; role: string }): ActorDeLaActividad {
    return { userId: s.userId, email: s.email ?? null, role: s.role };
}

/**
 * Arma la actividad (con las consultas que necesite para describirla) y la
 * registra, DESPUÉS de que la acción ya se hizo. Si algo falla al armarla, la
 * acción no se da por fallida: la cita ya se agendó, el cupo ya se abrió. Solo
 * queda el error en la consola.
 */
export async function registrarDespues(armar: () => Promise<Actividad>): Promise<void> {
    try {
        await registrarActividad(await armar());
    } catch (e: unknown) {
        console.error('No se pudo armar la actividad para la bitácora:', getErrorMessage(e));
    }
}
