/**
 * Validaciones del límite de citas, sin base de datos: las usan las acciones de
 * servidor (la del formulario PÚBLICO y las del panel) y sus pruebas. Lo que
 * venga del navegador se revisa aquí aunque el formulario ya lo limite: una
 * acción de servidor se puede llamar con cualquier cosa.
 */
import {
    SOLICITUD_CITAS,
    esMotivoSolicitudCitas,
    normalizarLimiteDia,
    normalizarLimiteMes,
    type LimitesCitas,
    type MotivoSolicitudCitas,
} from '@agenia/shared';

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string };

/** Lo que guarda el panel. `=== true`: cualquier otra cosa apaga el límite. */
export function validarLimites(entrada: Partial<Record<keyof LimitesCitas, unknown>>): LimitesCitas {
    return {
        diaActivo: entrada.diaActivo === true,
        maxDia: normalizarLimiteDia(entrada.maxDia),
        mesActivo: entrada.mesActivo === true,
        maxMes: normalizarLimiteMes(entrada.maxMes),
    };
}

export interface RadicacionSolicitud {
    motivo: MotivoSolicitudCitas;
    argumento: string;
    adicionales: number;
    telefono: string | null;
}

/** El formulario público que llena el paciente. */
export function validarRadicacion(entrada: {
    motivo?: unknown;
    argumento?: unknown;
    adicionales?: unknown;
    telefono?: unknown;
}): Resultado<RadicacionSolicitud> {
    if (!esMotivoSolicitudCitas(entrada.motivo)) {
        return { ok: false, error: 'Elige el motivo por el que necesitas más citas.' };
    }
    const argumento = typeof entrada.argumento === 'string' ? entrada.argumento.trim() : '';
    if (argumento.length < SOLICITUD_CITAS.MIN_ARGUMENTO) {
        return {
            ok: false,
            error: `Cuéntanos brevemente por qué necesitas más citas (mínimo ${SOLICITUD_CITAS.MIN_ARGUMENTO} caracteres).`,
        };
    }
    if (argumento.length > SOLICITUD_CITAS.MAX_ARGUMENTO) {
        return { ok: false, error: `El texto es muy largo (máximo ${SOLICITUD_CITAS.MAX_ARGUMENTO} caracteres).` };
    }
    const adicionales = Number(entrada.adicionales);
    if (!Number.isInteger(adicionales) || adicionales < 1 || adicionales > SOLICITUD_CITAS.MAX_ADICIONALES) {
        return { ok: false, error: `Indica cuántas citas adicionales necesitas (de 1 a ${SOLICITUD_CITAS.MAX_ADICIONALES}).` };
    }
    const telefono = typeof entrada.telefono === 'string' ? entrada.telefono.trim() : '';
    if (telefono && !/^\+?[\d\s\-()]{7,20}$/.test(telefono)) {
        return { ok: false, error: 'El teléfono no parece válido.' };
    }
    return { ok: true, datos: { motivo: entrada.motivo, argumento, adicionales, telefono: telefono || null } };
}

export type DecisionSolicitud =
    | { decision: 'APPROVED'; adicionales: number; nota: string | null }
    | { decision: 'REJECTED'; nota: string };

/**
 * La decisión del revisor. Aprobar concede de 1 a `MAX_ADICIONALES` citas (la
 * nota es opcional); rechazar exige una nota: es lo que se le dirá al paciente
 * si llama a preguntar.
 */
export function validarDecision(entrada: {
    decision?: unknown;
    adicionales?: unknown;
    nota?: unknown;
}): Resultado<DecisionSolicitud> {
    const nota = typeof entrada.nota === 'string' ? entrada.nota.trim() : '';
    if (nota.length > SOLICITUD_CITAS.MAX_NOTA_REVISION) {
        return { ok: false, error: `La nota es muy larga (máximo ${SOLICITUD_CITAS.MAX_NOTA_REVISION} caracteres).` };
    }
    if (entrada.decision === 'APPROVED') {
        const adicionales = Number(entrada.adicionales);
        if (!Number.isInteger(adicionales) || adicionales < 1 || adicionales > SOLICITUD_CITAS.MAX_ADICIONALES) {
            return { ok: false, error: `Las citas adicionales van de 1 a ${SOLICITUD_CITAS.MAX_ADICIONALES}.` };
        }
        return { ok: true, datos: { decision: 'APPROVED', adicionales, nota: nota || null } };
    }
    if (entrada.decision === 'REJECTED') {
        if (nota.length < 5) {
            return { ok: false, error: 'Escribe el motivo del rechazo (se lo dirán al paciente si pregunta).' };
        }
        return { ok: true, datos: { decision: 'REJECTED', nota } };
    }
    return { ok: false, error: 'Decisión no válida.' };
}

/** Forma de un id de solicitud (UUID): el enlace público no consulta la base con basura. */
export function esIdDeSolicitud(id: unknown): id is string {
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
