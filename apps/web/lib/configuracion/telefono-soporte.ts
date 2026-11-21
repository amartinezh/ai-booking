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

const conIndicativo = (n: string) => `+57 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;

/**
 * Si con este número la alerta de emergencia PUEDE llegar por WhatsApp: un celular
 * colombiano con indicativo. Es condición necesaria, no garantía: la alerta es texto
 * libre y Meta solo la entrega si ese número le escribió al asistente en 24 horas.
 */
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
    if (celular) return { ok: true, valor: conIndicativo(celular.slice(3)), alertasPorWhatsapp: true };

    // Un fijo colombiano también lleva su indicativo: la alerta usa los dígitos tal
    // cual y «606 853 8860» sin el 57 es, para WhatsApp, un número de Malasia (+60).
    const soloDigitos = texto.replace(/\D/g, '');
    const fijo = /^(?:57)?(60\d{8})$/.exec(soloDigitos)?.[1];
    if (fijo) return { ok: true, valor: conIndicativo(fijo), alertasPorWhatsapp: false };

    // Con 10 dígitos o más, sin «+», no se sabe de qué país es y la alerta podría
    // salir a otro. Los cortos (7 dígitos) nunca se usan como destino de la alerta.
    if (soloDigitos.length >= 10 && !texto.startsWith('+')) {
        return { ok: false, error: 'Si no es un número de Colombia, escríbalo con + y su indicativo.' };
    }
    return { ok: true, valor: texto, alertasPorWhatsapp: false };
}
