import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import {
    PERIODOS_AUTORIZACION,
    cargarAutorizaciones,
    type PeriodoAutorizacion,
    type ResumenDeAutorizaciones,
} from '@/lib/autorizacion-datos/cifras';

const fmt = (n: number) => new Intl.NumberFormat('es-CO').format(n);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const diaCorto = (dia: string) => {
    const [, m, d] = dia.split('-').map(Number);
    return `${d} ${MESES[m - 1]}`;
};

/**
 * 🔒 Autorización de datos en cifras (docs/PLAN_AUTORIZACION_DATOS.md). Sección
 * aparte de Canales en vivo: se arma en el servidor con su propio período y no
 * toca las cifras en vivo de arriba. Si falla, solo esta sección lo dice.
 */
export default async function AutorizacionDatosCifras({
    organizationId,
    dias,
}: {
    organizationId: string;
    dias: PeriodoAutorizacion;
}) {
    let r: ResumenDeAutorizaciones;
    try {
        r = await cargarAutorizaciones(organizationId, dias);
    } catch (e) {
        console.error('[canales] no se pudieron cargar las cifras de autorización de datos', e);
        return (
            <Marco dias={dias}>
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    No se pudieron cargar las cifras de la autorización de datos. Intente de nuevo en un momento.
                </p>
            </Marco>
        );
    }
    const c = r.cifras;
    const sinNada = c.preguntadas === 0 && c.retiraron === 0;

    return (
        <Marco dias={dias}>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {r.encendida
                    ? `Encendida (versión ${r.version} de la política): el asistente pide la autorización antes de agendar.`
                    : 'Apagada: el asistente no pide la autorización. Se enciende en Configuración › Privacidad (Ley 1581).'}{' '}
                Cada persona cuenta una vez, por lo último que respondió.
            </p>

            {sinNada ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Sin preguntas en este período.</p>
            ) : (
                <>
                    <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Cifra titulo="Se les preguntó" valor={fmt(c.preguntadas)} />
                        <Cifra titulo="Aceptaron" valor={fmt(c.aceptaron)} />
                        <Cifra titulo="No aceptaron" valor={fmt(c.noAceptaron)} ayuda="Se les dio el teléfono y la ventanilla" />
                        <Cifra titulo="No respondieron" valor={fmt(c.sinRespuesta)} ayuda="Cerraron sin decir SÍ ni NO" />
                        <Cifra
                            titulo="Aceptación"
                            valor={c.porcentajeAceptacion === null ? '—' : `${c.porcentajeAceptacion}%`}
                            ayuda="De quienes respondieron"
                        />
                        <Cifra titulo="Esperando respuesta" valor={fmt(c.esperando)} ayuda="Conversación abierta" />
                        <Cifra titulo="Volvieron y aceptaron" valor={fmt(c.volvieronYAceptaron)} ayuda="Dijeron NO y después SÍ" />
                        <Cifra titulo="Retiraron la autorización" valor={fmt(c.retiraron)} />
                    </dl>

                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm" aria-label="Autorización por canal">
                            <thead>
                                <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
                                    <th className="py-2 pr-4">Canal</th>
                                    <th className="py-2 pr-4 text-right">Preguntas</th>
                                    <th className="py-2 pr-4 text-right">Aceptaron</th>
                                    <th className="py-2 pr-4 text-right">No aceptaron</th>
                                    <th className="py-2 pr-4 text-right">No respondieron</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {(['WHATSAPP', 'TELEGRAM'] as const).map((canal) => (
                                    <tr key={canal}>
                                        <td className="py-2 pr-4">{canal === 'WHATSAPP' ? '💬 WhatsApp' : '✈️ Telegram'}</td>
                                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(c.porCanal[canal].preguntadas)}</td>
                                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(c.porCanal[canal].aceptaron)}</td>
                                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(c.porCanal[canal].noAceptaron)}</td>
                                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(c.porCanal[canal].sinRespuesta)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {c.porDia.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm" aria-label="Autorización por día">
                                <thead>
                                    <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
                                        <th className="py-2 pr-4">Día</th>
                                        <th className="py-2 pr-4 text-right">Preguntas</th>
                                        <th className="py-2 pr-4 text-right">Aceptaron</th>
                                        <th className="py-2 pr-4 text-right">No aceptaron</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {[...c.porDia].reverse().map((d) => (
                                        <tr key={d.dia}>
                                            <td className="py-2 pr-4">{diaCorto(d.dia)}</td>
                                            <td className="py-2 pr-4 text-right tabular-nums">{fmt(d.preguntas)}</td>
                                            <td className="py-2 pr-4 text-right tabular-nums">{fmt(d.aceptaron)}</td>
                                            <td className="py-2 pr-4 text-right tabular-nums">{fmt(d.noAceptaron)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </Marco>
    );
}

function Marco({ dias, children }: { dias: PeriodoAutorizacion; children: React.ReactNode }) {
    return (
        <section
            aria-labelledby="autorizacion-datos-titulo"
            className="mt-10 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col gap-5"
        >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="rounded-xl p-2.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                        <ShieldCheck className="w-5 h-5" />
                    </div>
                    <h2 id="autorizacion-datos-titulo" className="text-xl font-bold text-zinc-900 dark:text-white">
                        Autorización de datos
                    </h2>
                </div>
                <nav aria-label="Período de la autorización de datos" className="flex gap-2">
                    {PERIODOS_AUTORIZACION.map((p) => (
                        <Link
                            key={p}
                            href={`/dashboard/canales?autorizacion=${p}`}
                            aria-current={p === dias ? 'page' : undefined}
                            className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${
                                p === dias
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                            }`}
                        >
                            {p} días
                        </Link>
                    ))}
                </nav>
            </div>
            {children}
        </section>
    );
}

function Cifra({ titulo, valor, ayuda }: { titulo: string; valor: string; ayuda?: string }) {
    return (
        <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{titulo}</dt>
            <dd className="mt-1 text-2xl font-extrabold text-zinc-900 dark:text-white tabular-nums">{valor}</dd>
            {ayuda && <dd className="mt-1 text-xs text-zinc-400">{ayuda}</dd>}
        </div>
    );
}
