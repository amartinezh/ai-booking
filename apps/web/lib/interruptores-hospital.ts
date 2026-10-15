/**
 * 🚪 Los interruptores de la clínica conectada al hospital, vistos desde el panel
 * (2026-10-15, `packages/shared/src/compuerta-his.ts`).
 *
 * Con el espejo activo, agendar, cancelar y cambiar la fecha tienen cada uno su
 * interruptor en Configuración, y apagado significa que la operación NO se hace
 * en AgenIA —ni por el asistente ni desde el panel—: se hace directamente en el
 * sistema del hospital. Así nunca queda en la cola un cambio que el hospital no
 * va a recibir.
 *
 * El panel lo comprueba ANTES de escribir (para responder con un mensaje claro y
 * no dejar nada a medias) y, por si algo se cruza entre la comprobación y la
 * escritura, la base lo frena igual (`fn_interruptores_del_hospital`):
 * `mensajeDeError` traduce ese freno al mismo mensaje.
 *
 * Sin espejo no hay hospital: el panel es el sistema de la clínica y opera libre.
 */
import type { PrismaClient } from '@agenia/database';
import {
    MENSAJE_OPERACION_APAGADA,
    operacionFrenadaDelError,
} from '@agenia/shared';
import { getErrorMessage } from './error';

export type OperacionDelPanel = 'AGENDAR' | 'CANCELAR' | 'MODIFICAR';

type Db = Pick<PrismaClient, 'hospitalMirrorConfig' | 'organizationSettings'>;

/**
 * El mensaje para la persona si la operación está apagada en esta clínica
 * conectada al hospital; `null` si se puede hacer. Falla cerrado: con espejo y
 * sin fila de configuración, está apagada.
 */
export async function operacionApagada(
    db: Db,
    organizationId: string,
    operacion: OperacionDelPanel,
): Promise<string | null> {
    const espejo = await db.hospitalMirrorConfig.findUnique({
        where: { organizationId },
        select: { enabled: true },
    });
    if (!espejo?.enabled) return null;
    const ajustes = await db.organizationSettings.findUnique({
        where: { organizationId },
        select: { bookingEnabled: true, cancelEnabled: true, rescheduleEnabled: true },
    });
    const encendida =
        operacion === 'AGENDAR'
            ? ajustes?.bookingEnabled
            : operacion === 'CANCELAR'
              ? ajustes?.cancelEnabled
              : ajustes?.rescheduleEnabled;
    return encendida === true ? null : MENSAJE_OPERACION_APAGADA[operacion];
}

/** El texto de un error para el panel: el freno de la base se dice claro. */
export function mensajeDeError(error: unknown): string {
    const frenada = operacionFrenadaDelError(error);
    return frenada ? MENSAJE_OPERACION_APAGADA[frenada] : getErrorMessage(error);
}
