/**
 * 📢 MENSAJES MASIVOS — quién los usa (docs/PLAN_MENSAJES_MASIVOS.md §3).
 *
 * Solo el administrador de la clínica: un comunicado masivo habla en nombre de la
 * clínica, se cobra por mensaje y afecta la calidad del número en Meta. La página,
 * cada acción de servidor y la API (`@Roles('ORG_ADMIN')`) lo vuelven a comprobar;
 * el menú solo decide si aparece el enlace.
 */
import type { SessionPayload } from '../session';

export type SesionMasivos = SessionPayload & { organizationId: string };

export function puedeUsarMensajesMasivos(
    sesion: SessionPayload | null | undefined,
): sesion is SesionMasivos {
    return !!sesion?.organizationId && sesion.role === 'ORG_ADMIN';
}
