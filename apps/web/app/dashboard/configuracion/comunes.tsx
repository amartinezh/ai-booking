import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession, type SessionPayload } from '@/lib/session';
import type { getMyTelegramConfig } from '@/app/actions/telegram-config';

// ─────────────────────────────────────────────────────────────
// Piezas comunes de las secciones de Configuración (docs/PLAN_NAVEGACION.md §5).
// ─────────────────────────────────────────────────────────────

/**
 * Configuración es solo del administrador. Cada sección lo comprueba (además del
 * layout): en Next el layout y la página se arman a la vez, y la página no debe
 * leer nada si quien entra no es administrador.
 */
export async function exigirAdministrador(): Promise<SessionPayload> {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN') redirect('/dashboard');
    return session;
}

/**
 * Un ajuste con su ancla (`…/agenda#plazo`): la ayuda, el Resumen y las demás
 * pantallas llevan directo a él, y al llegar queda enmarcado.
 */
export function Ajuste({ id, children }: { id: string; children: ReactNode }) {
    return (
        <div
            id={id}
            className="scroll-mt-24 rounded-2xl [&:target]:ring-2 [&:target]:ring-blue-400 [&:target]:ring-offset-8 dark:[&:target]:ring-offset-zinc-900"
        >
            {children}
        </div>
    );
}

/**
 * «Esto se movió aquí»: para quien llega desde una dirección vieja que redirige
 * con `?desde=…` (docs/PLAN_NAVEGACION.md §6). Solo se ve si vino de allá.
 */
export function AvisoMovido({ visible, children }: { visible: boolean; children: ReactNode }) {
    if (!visible) return null;
    return (
        <p
            role="status"
            className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-200"
        >
            ℹ️ {children}
        </p>
    );
}

/** La línea entre un ajuste y el siguiente. */
export function Separador() {
    return <div className="border-t border-zinc-200 dark:border-zinc-800" />;
}

/** El cuerpo de una sección: título, explicación y los ajustes. */
export function Seccion({
    titulo,
    icono,
    descripcion,
    children,
}: {
    titulo: string;
    icono: string;
    descripcion: string;
    children: ReactNode;
}) {
    return (
        <div className="space-y-6">
            <header>
                <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                    <span aria-hidden="true">{icono}</span> {titulo}
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{descripcion}</p>
            </header>
            <div className="space-y-12 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 md:p-8">
                {children}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Mensaje en línea cuando un ajuste no carga. En producción Next.js esconde el
// mensaje real al cliente; aquí mostramos lo poco que tenemos y dejamos el
// detalle completo en los logs del servidor (ver console.error del callBackend).
// ─────────────────────────────────────────────────────────────
export function SectionLoadError({ title, detail }: { title: string; detail: string | null }) {
    return (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-900/20">
            <h3 className="mb-1 text-sm font-bold text-rose-800 dark:text-rose-200">⚠️ {title}</h3>
            <p className="text-xs leading-relaxed text-rose-700 dark:text-rose-300">
                {detail ?? 'El backend respondió con un error. Revisa los logs del API o contacta al super-admin.'}
            </p>
            <p className="mt-2 text-[11px] text-rose-600/80 dark:text-rose-400/80">
                Tip: el equipo de plataforma puede buscar este incidente en{' '}
                <code className="font-mono">/super-admin/logs</code> filtrando por nivel ERROR.
            </p>
        </div>
    );
}

/** El motivo de un `Promise.allSettled` rechazado, para el mensaje en línea. */
export function motivoDelFallo(razon: unknown, porDefecto: string): string {
    return (razon as { message?: string } | null)?.message ?? porDefecto;
}

/** Las fechas de la API llegan como texto; se normalizan para el componente cliente. */
export function serializeTelegramCard(
    card: Awaited<ReturnType<typeof getMyTelegramConfig>>,
): Awaited<ReturnType<typeof getMyTelegramConfig>> {
    if (!card.enabled) return card;
    const c = card.config;
    return {
        enabled: true,
        config: {
            ...c,
            lastWebhookSetAt: c.lastWebhookSetAt ? String(c.lastWebhookSetAt) : null,
            updatedAt: c.updatedAt ? String(c.updatedAt) : null,
        },
    };
}
