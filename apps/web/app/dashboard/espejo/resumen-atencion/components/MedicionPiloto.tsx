import type { MedicionPiloto as Medicion } from '@/app/actions/resumen-atencion';

/** «12 de 40 (30 %)». */
function deTotal(n: number, total: number): string {
    return total > 0 ? `${n} de ${total} (${Math.round((n * 100) / total)} %)` : `${n}`;
}

/**
 * Cómo va el envío (plan §8.10): el recorrido completo de los últimos 30 días,
 * sin los envíos de prueba. Son las mismas cifras de las estadísticas para
 * compartir, y cada una se puede revisar envío por envío en «Envíos de
 * documentos» o en su registro descargable.
 */
export default function MedicionPiloto({ piloto: m }: { piloto: Medicion }) {
    const a = m.atenciones;
    const mensajeria = m.avisos.whatsapp + m.avisos.telegram;
    const datos: { titulo: string; valor: string; detalle: string }[] = [
        {
            titulo: 'Consultas leídas del hospital',
            valor: String(a.leidas),
            detalle: `Avisadas ${a.avisadas} · no se envían ${a.excluidas} (por baja ${a.porBaja}) · sin celular ${a.sinContacto} · sin enviar todavía ${a.sinEnviar}`,
        },
        {
            titulo: 'Avisos enviados',
            valor: String(m.avisos.total),
            detalle: `WhatsApp ${m.avisos.whatsapp} · Telegram ${m.avisos.telegram} · Correo ${m.avisos.correo} · reenvíos ${m.avisos.reenvios}${
                m.avisosQueNoSalieron ? ` · ${m.avisosQueNoSalieron} no salieron` : ''
            }`,
        },
        {
            titulo: 'Avisos de WhatsApp entregados',
            valor: deTotal(m.whatsapp.entregados, m.avisos.whatsapp),
            detalle: `Según Meta. Leídos ${deTotal(m.whatsapp.leidos, m.avisos.whatsapp)} · no entregados ${m.whatsapp.fallidos} · sin confirmar ${m.whatsapp.sinConfirmar}`,
        },
        {
            titulo: 'Pidieron sus documentos',
            valor: deTotal(m.pidieron, mensajeria),
            detalle: `Tocaron «Recibir mis documentos» o escribieron «mis documentos». Verificados ${m.verificados}`,
        },
        {
            titulo: 'Recibieron sus documentos',
            valor: String(m.recibieron),
            detalle: `Por WhatsApp, Telegram o correo. Archivos por WhatsApp: ${m.archivos.enviados} enviados · ${m.archivos.entregados} entregados · ${m.archivos.leidos} vistos`,
        },
        {
            titulo: 'Abrieron la página · bajas',
            valor: `${m.abrieronLaPagina} · ${m.bajas}`,
            detalle: `Página con su fecha de nacimiento · «no quiero resúmenes» en el período (vigentes: ${m.bajasVigentes})`,
        },
    ];
    return (
        <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" data-testid="medicion-piloto">
            <div>
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Cómo va el envío (últimos 30 días)</h2>
                <p className="text-xs text-zinc-500">
                    Sin los envíos de prueba. Cada cifra sale del registro de cada mensaje: el detalle, envío por envío, está en
                    «Envíos de documentos». Telegram y el correo no informan si se leyó.
                </p>
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
