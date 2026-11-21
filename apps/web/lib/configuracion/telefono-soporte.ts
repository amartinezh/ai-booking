import { normalizePhoneToE164Co } from '@agenia/shared';

// ─────────────────────────────────────────────────────────────
// 📞 El teléfono de soporte de la clínica (docs/PLAN_NAVEGACION.md, N9). No es
// solo un dato de contacto: el asistente se lo da a los pacientes y es el número
// al que manda por WhatsApp la alerta de posible emergencia, quitándole todo lo
// que no sea dígito (`handleEmergency` en chatbot.service.ts). Por eso un celular
// colombiano se guarda siempre con su indicativo: «300 123 4567» sin el 57 haría
// que la alerta saliera a un número que no existe.
// ─────────────────────────────────────────────────────────────

export type TelefonoValidado =
    | { ok: true; valor: string; alertasPorWhatsapp: boolean }
    | { ok: false; error: string };

const MAX_CARACTERES = 30;
const MIN_DIGITOS = 7;
const MAX_DIGITOS = 15;

/** Si con este número la alerta de emergencia puede llegar por WhatsApp: un celular colombiano con indicativo. */
export function alertasLleganPorWhatsapp(valor: string | null | undefined): boolean {
    return /^573\d{9}$/.test((valor ?? '').replace(/\D/g, ''));
}

/**
 * Valida lo que escribió el administrador y devuelve lo que se guarda. No se
 * puede dejar vacío: sin teléfono, el asistente se queda sin número que darle al
 * paciente y nadie recibe las alertas de emergencia.
 */
export function validarTelefonoSoporte(entrada: unknown): TelefonoValidado {
    const texto = typeof entrada === 'string' ? entrada.trim().replace(/\s+/g, ' ') : '';
    if (!texto) return { ok: false, error: 'Escriba el teléfono: el asistente se lo da a los pacientes.' };
    if (texto.length > MAX_CARACTERES || !/^\+?[\d\s().-]+$/.test(texto)) {
        return { ok: false, error: 'Escriba solo el número: dígitos, espacios, guiones, paréntesis y el + del indicativo.' };
    }
    const digitos = texto.replace(/\D/g, '').length;
    if (digitos < MIN_DIGITOS || digitos > MAX_DIGITOS) {
        return { ok: false, error: `El teléfono debe tener entre ${MIN_DIGITOS} y ${MAX_DIGITOS} dígitos.` };
    }
    const celular = normalizePhoneToE164Co(texto);
    if (celular) {
        const n = celular.slice(3);
        return { ok: true, valor: `+57 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`, alertasPorWhatsapp: true };
    }
    return { ok: true, valor: texto, alertasPorWhatsapp: false };
}
