import {
    cifrasDeAutorizaciones,
    diaLocal,
    horaLocalAUtc,
    normalizarVersionPolitica,
    sumarDiasAFecha,
    type CifrasDeAutorizaciones,
} from '@agenia/shared';
import { prisma } from '@/lib/prisma';

/**
 * 🔒 Las cifras de la autorización de datos (docs/PLAN_AUTORIZACION_DATOS.md)
 * para Canales en vivo: a cuántas personas se les preguntó, cuántas aceptaron,
 * cuántas no, cuántas no respondieron y cuántas la retiraron, por canal y por
 * día. Solo conteos: ningún número ni nombre sale de aquí.
 */

export const PERIODOS_AUTORIZACION = [7, 30, 90] as const;
export type PeriodoAutorizacion = (typeof PERIODOS_AUTORIZACION)[number];

/** El período pedido en la URL (`?autorizacion=7`), o 30 días. */
export function periodoAutorizacion(valor: unknown): PeriodoAutorizacion {
    const n = Number(Array.isArray(valor) ? valor[0] : valor);
    return (PERIODOS_AUTORIZACION as readonly number[]).includes(n) ? (n as PeriodoAutorizacion) : 30;
}

export interface ResumenDeAutorizaciones {
    encendida: boolean;
    version: string;
    dias: PeriodoAutorizacion;
    /** El primer día del período, 'YYYY-MM-DD' en la zona de la clínica. */
    desde: string;
    cifras: CifrasDeAutorizaciones;
}

/** Tope de filas: de sobra para 90 días de una clínica (una por conversación que empieza). */
const MAX_FILAS = 50_000;

export async function cargarAutorizaciones(
    organizationId: string,
    dias: PeriodoAutorizacion,
    ahora: Date = new Date(),
): Promise<ResumenDeAutorizaciones> {
    const ajustes = await prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: {
            dataConsentEnabled: true,
            dataPolicyVersion: true,
            organization: { select: { timezone: true } },
        },
    });
    const timeZone = ajustes?.organization?.timezone || undefined;
    const desde = sumarDiasAFecha(diaLocal(ahora, timeZone), -(dias - 1));
    const [y, m, d] = desde.split('-').map(Number);
    const desdeUtc = horaLocalAUtc(y, m, d, 0, timeZone);

    const filas = await prisma.dataConsent.findMany({
        where: {
            organizationId,
            OR: [{ askedAt: { gte: desdeUtc } }, { answeredAt: { gte: desdeUtc } }],
        },
        select: { status: true, senderKey: true, channel: true, askedAt: true, answeredAt: true },
        orderBy: { askedAt: 'desc' },
        take: MAX_FILAS,
    });

    return {
        encendida: ajustes?.dataConsentEnabled ?? false,
        version: normalizarVersionPolitica(ajustes?.dataPolicyVersion),
        dias,
        desde,
        cifras: cifrasDeAutorizaciones(
            filas.map((f) => ({
                estado: f.status,
                remitente: f.senderKey,
                canal: f.channel,
                preguntadaEn: f.askedAt,
                respondidaEn: f.answeredAt,
            })),
            ahora,
            timeZone,
        ),
    };
}
