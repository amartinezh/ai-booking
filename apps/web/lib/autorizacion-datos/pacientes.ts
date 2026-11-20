/**
 * 🔒 La autorización de datos de cada paciente (docs/PLAN_AUTORIZACION_DATOS.md),
 * para el directorio de Pacientes. Un paciente queda enlazado a la autorización
 * con que se registró por el chat (`DataConsent.patientIds`); si después el mismo
 * chat la retiró, se muestra el retiro. Puro: sin base de datos.
 */

export interface AutorizacionAceptada {
    patientIds: string[];
    senderKey: string;
    channel: 'WHATSAPP' | 'TELEGRAM';
    policyVersion: string;
    answeredAt: Date | null;
}

export interface RetiroDeAutorizacion {
    senderKey: string;
    answeredAt: Date | null;
}

export interface AutorizacionDelPaciente {
    estado: 'AUTORIZO' | 'RETIRO';
    /** ISO: cuándo autorizó, o cuándo la retiró. */
    fecha: string;
    canal: 'WHATSAPP' | 'TELEGRAM';
    version: string;
}

/** Por paciente, su autorización más reciente y si el chat la retiró después. */
export function autorizacionesDePacientes(
    aceptadas: AutorizacionAceptada[],
    retiros: RetiroDeAutorizacion[],
): Record<string, AutorizacionDelPaciente> {
    const ultimoRetiro = new Map<string, number>();
    for (const r of retiros) {
        const t = r.answeredAt?.getTime();
        if (t !== undefined && t > (ultimoRetiro.get(r.senderKey) ?? -Infinity)) ultimoRetiro.set(r.senderKey, t);
    }
    const porPaciente: Record<string, { valor: AutorizacionDelPaciente; t: number }> = {};
    for (const a of aceptadas) {
        const t = a.answeredAt?.getTime();
        if (t === undefined) continue;
        const retiro = ultimoRetiro.get(a.senderKey);
        const retirada = retiro !== undefined && retiro >= t;
        const valor: AutorizacionDelPaciente = {
            estado: retirada ? 'RETIRO' : 'AUTORIZO',
            fecha: new Date(retirada ? retiro : t).toISOString(),
            canal: a.channel,
            version: a.policyVersion,
        };
        for (const id of a.patientIds) {
            if (!porPaciente[id] || porPaciente[id].t < t) porPaciente[id] = { valor, t };
        }
    }
    return Object.fromEntries(Object.entries(porPaciente).map(([id, { valor }]) => [id, valor]));
}
