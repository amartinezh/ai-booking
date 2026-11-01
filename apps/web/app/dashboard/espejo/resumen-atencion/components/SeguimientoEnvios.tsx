import { formatAppointmentShort } from '@/lib/date';
import type { PanelResumenAtencion } from '@/app/actions/resumen-atencion';

const ESTADO_ENVIO: Record<string, { texto: string; clase: string }> = {
    AVISO_ENVIADO: { texto: 'Aviso enviado', clase: 'text-zinc-700 dark:text-zinc-300' },
    DOCUMENTOS_ENVIADOS: { texto: '✓ Documentos entregados', clase: 'text-emerald-700 dark:text-emerald-400' },
    FALLO: { texto: '⚠ No salió', clase: 'text-amber-700 dark:text-amber-400' },
};

const ESTADO_RESUMEN: Record<string, string> = {
    RECIBIDO: 'Sin enviar',
    ENVIADO: 'Avisados',
    EXCLUIDO: 'Excluidos (tema sensible o baja)',
    SIN_CONTACTO: 'Sin celular utilizable',
    CADUCADO: 'Borrados sin enviar',
};

const VERIFICADO: Record<string, string> = {
    NUMERO: 'número verificado',
    FECHA_NACIMIENTO: 'fecha de nacimiento',
};

/**
 * Seguimiento de los envíos del resumen (plan §4.6): por atención, si salió el
 * aviso, si se entregaron los documentos y por qué no. Nunca el contenido ni el
 * número completo.
 */
export default function SeguimientoEnvios({ envio }: { envio: PanelResumenAtencion['envio'] }) {
    const estados = Object.entries(envio.porEstado).filter(([, n]) => n > 0);
    return (
        <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" data-testid="seguimiento-envios">
            <div>
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Seguimiento de envíos</h2>
                <p className="text-xs text-zinc-500">
                    Los últimos avisos por WhatsApp y si el paciente recibió los documentos. Sin contenido ni números completos.
                </p>
            </div>
            {estados.length > 0 && (
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    Últimos 30 días: {estados.map(([e, n]) => `${ESTADO_RESUMEN[e] ?? e} ${n}`).join(' · ')}
                </p>
            )}
            {envio.entregas.length === 0 ? (
                <p className="text-sm text-zinc-500">Todavía no ha salido ningún aviso.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                                <th className="py-2 pr-3 font-medium">Historia</th>
                                <th className="py-2 pr-3 font-medium">A</th>
                                <th className="py-2 pr-3 font-medium">Aviso</th>
                                <th className="py-2 pr-3 font-medium">Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {envio.entregas.map((e) => {
                                const estado = ESTADO_ENVIO[e.estado] ?? { texto: e.estado, clase: '' };
                                return (
                                    <tr key={e.id} className="border-b border-zinc-100 dark:border-zinc-900">
                                        <td className="py-2 pr-3 font-mono text-xs">
                                            {e.historia}
                                            {e.prueba && <span className="ml-1 rounded bg-zinc-100 px-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">prueba</span>}
                                        </td>
                                        <td className="py-2 pr-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">{e.destino}</td>
                                        <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-300">
                                            {e.avisoIso ? formatAppointmentShort(e.avisoIso) : '—'}
                                        </td>
                                        <td className="py-2 pr-3">
                                            <span className={estado.clase}>{estado.texto}</span>
                                            {e.estado === 'DOCUMENTOS_ENVIADOS' && e.documentosIso && (
                                                <span className="block text-xs text-zinc-500">
                                                    {formatAppointmentShort(e.documentosIso)}
                                                    {e.verificadoPor ? ` · ${VERIFICADO[e.verificadoPor] ?? e.verificadoPor}` : ''}
                                                </span>
                                            )}
                                            {e.motivo && <span className="block text-xs text-zinc-500">{e.motivo}</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
