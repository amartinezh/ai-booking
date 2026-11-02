import type { MedicionPiloto as Medicion } from '@/app/actions/resumen-atencion';

/** «12 de 40 (30 %)». */
function deTotal(n: number, total: number): string {
    return total > 0 ? `${n} de ${total} (${Math.round((n * 100) / total)} %)` : `${n}`;
}

/**
 * Cómo va el envío (plan §8, Fase 5: «entregados, abiertos, bajas, quejas y
 * errores medidos»): cifras de los últimos 30 días, sin los envíos de prueba.
 */
export default function MedicionPiloto({ piloto }: { piloto: Medicion }) {
    const avisos = piloto.avisos.WHATSAPP + piloto.avisos.TELEGRAM + piloto.avisos.EMAIL;
    const porMensajeria = piloto.avisos.WHATSAPP + piloto.avisos.TELEGRAM;
    const datos: { titulo: string; valor: string; detalle: string }[] = [
        {
            titulo: 'Avisos enviados',
            valor: String(avisos),
            detalle: `WhatsApp ${piloto.avisos.WHATSAPP} · Telegram ${piloto.avisos.TELEGRAM} · Correo ${piloto.avisos.EMAIL}`,
        },
        {
            titulo: 'Entregados por WhatsApp',
            valor: deTotal(piloto.meta.entregados, piloto.meta.total),
            detalle: `Según Meta. Leídos ${piloto.meta.leidos} · fallidos ${piloto.meta.fallidos}`,
        },
        {
            titulo: 'Recibieron los documentos',
            valor: String(piloto.documentos),
            detalle: porMensajeria
                ? 'Tocaron «Recibir mis documentos» (y verificaron), o les llegaron por correo'
                : 'Todavía no hay avisos',
        },
        { titulo: 'Abrieron la página', valor: String(piloto.abiertosEnLaPagina), detalle: 'Con su fecha de nacimiento' },
        { titulo: 'Bajas', valor: String(piloto.bajas), detalle: '«no quiero resúmenes»' },
        { titulo: 'Errores', valor: String(piloto.errores), detalle: 'Envíos que no salieron (se reintentan hasta 3 veces)' },
    ];
    return (
        <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" data-testid="medicion-piloto">
            <div>
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Cómo va el envío (últimos 30 días)</h2>
                <p className="text-xs text-zinc-500">Sin los envíos de prueba. Para decidir si se amplía el piloto.</p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-3">
                {datos.map((d) => (
                    <div key={d.titulo} className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                        <dt className="text-xs text-zinc-500">{d.titulo}</dt>
                        <dd className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{d.valor}</dd>
                        <dd className="text-xs text-zinc-500">{d.detalle}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
