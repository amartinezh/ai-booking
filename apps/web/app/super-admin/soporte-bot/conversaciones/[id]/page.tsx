import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import {
    ROL_LEGIBLE,
    TEXTO_MOTIVO_CIERRE,
    type MotivoCierre,
    type UserRole,
} from '@agenia/shared';
import { formatAppointmentCompact, formatTimeOnly } from '@/lib/date';
import { getConversacionAsistente } from '@/app/actions/support-bot';
import ResultadoDeLaConversacion from '../ResultadoDeLaConversacion';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FUENTE: Record<string, string> = { IA: 'Con IA', SIN_IA: 'Sin IA (buscador)', FIJO: 'Texto fijo' };
const ESTADO: Record<string, string> = { OPEN: 'Abierto', IN_PROGRESS: 'En atención', RESOLVED: 'Solucionado' };
const numero = new Intl.NumberFormat('es-CO');

/**
 * Una conversación del asistente, completa y solo para leer (docs/PLAN_BOT_SOPORTE.md
 * §3.7, Fase 5). Lo que escribió la persona va tal cual (puede tener datos de
 * pacientes): por eso solo la ve el SUPER_ADMIN y abrirla queda en la bitácora.
 */
export default async function ConversacionPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const res = await getConversacionAsistente((await params).id);
    const volver = (
        <Link href="/super-admin/soporte-bot/conversaciones" className="text-sm text-indigo-600 hover:underline">
            ← Conversaciones
        </Link>
    );
    if (!res.ok) {
        return (
            <div className="max-w-4xl mx-auto space-y-4">
                {volver}
                <p role="alert" className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
                    {res.error}
                </p>
            </div>
        );
    }
    const c = res.data;

    return (
        <div className="max-w-4xl mx-auto animate-fade-in pb-10 space-y-6">
            <header className="space-y-2">
                {volver}
                <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
                    {c.clinica} · {c.correo}
                </h1>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {ROL_LEGIBLE[c.rol as UserRole] ?? c.rol}
                    {c.telegramName && ` · en Telegram, ${c.telegramName}`} · desde el {formatAppointmentCompact(c.inicio)}
                    {c.cierre
                        ? ` · cerrada el ${formatAppointmentCompact(c.cierre)}${
                              c.motivoCierre
                                  ? ` (${TEXTO_MOTIVO_CIERRE[c.motivoCierre as MotivoCierre] ?? c.motivoCierre})`
                                  : ''
                          }`
                        : ' · abierta'}
                </p>
                <ResultadoDeLaConversacion c={c} />
                <p className="text-xs text-amber-700">
                    Lo que escribió la persona va tal cual y puede tener datos de pacientes. Abrir esta conversación
                    quedó en la bitácora del sistema.
                </p>
            </header>

            {c.casosDetalle.length > 0 && (
                <section aria-labelledby="casos" className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
                    <h2 id="casos" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                        Casos que abrió
                    </h2>
                    <ul className="text-sm space-y-1">
                        {c.casosDetalle.map((k) => (
                            <li key={k.numero}>
                                <span className="font-mono font-semibold">#{k.numero}</span> {k.titulo} ·{' '}
                                {ESTADO[k.estado] ?? k.estado}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <ol className="space-y-3" aria-label="Mensajes">
                {c.mensajesDetalle.map((m) => {
                    const deLaPersona = m.direccion === 'ENTRADA';
                    return (
                        <li key={m.id} className={`flex ${deLaPersona ? 'justify-start' : 'justify-end'}`}>
                            <div
                                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                                    deLaPersona
                                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white'
                                        : 'bg-indigo-50 dark:bg-indigo-950/40 text-zinc-900 dark:text-white'
                                }`}
                            >
                                <p className="whitespace-pre-line break-words">{m.texto}</p>
                                <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                    {deLaPersona ? 'Persona' : 'Asistente'} · {formatTimeOnly(m.fecha)}
                                    {m.fuente && ` · ${FUENTE[m.fuente] ?? m.fuente}`}
                                    {m.tipo && ` · ${m.tipo}`}
                                    {m.sinCubrir && ' · el manual no lo cubre'}
                                    {m.temas.length > 0 && ` · temas: ${m.temas.join(', ')}`}
                                    {m.proveedor && ` · ${m.proveedor}`}
                                    {m.latenciaMs !== null && ` · ${(m.latenciaMs / 1000).toFixed(1).replace('.', ',')} s`}
                                    {m.tokensEntrada !== null &&
                                        ` · ${numero.format(m.tokensEntrada)} / ${numero.format(m.tokensSalida ?? 0)} tokens`}
                                </p>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
