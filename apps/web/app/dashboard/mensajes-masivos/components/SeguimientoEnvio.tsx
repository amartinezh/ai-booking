'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Pause, Play, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { trozosConFormato } from '@agenia/shared';
import { formatAppointmentCompact } from '@/lib/date';
import { controlarEnvio, seguimientoDelEnvio } from '@/app/actions/mensajes-masivos';
import type { FiltroDestinatarios, SeguimientoEnvio as Seguimiento } from '@/app/actions/mensajes-masivos.types';
import { EstadoEnvio } from './PanelesSecundarios';
import { Aviso, Boton, Tarjeta, numero } from './ui';

const FILTROS: Array<{ id: FiltroDestinatarios; titulo: string }> = [
    { id: 'TODOS', titulo: 'Todos' },
    { id: 'PENDIENTE', titulo: 'En cola' },
    { id: 'ENVIADO', titulo: 'Enviados' },
    { id: 'LEIDO', titulo: 'Leídos' },
    { id: 'NO_ENTREGADO', titulo: 'No entregados' },
    { id: 'FALLIDO', titulo: 'Fallidos' },
    { id: 'OMITIDO', titulo: 'Omitidos' },
];
const ENTREGA = { ENVIADO: 'Enviado', ENTREGADO: 'Entregado', LEIDO: 'Leído', NO_ENTREGADO: 'No entregado' } as const;
const RESULTADO = { PENDIENTE: 'En cola', ENVIADO: 'Enviado', FALLIDO: 'Falló', OMITIDO: 'Omitido' } as const;

/**
 * Cómo va un envío (docs/PLAN_MENSAJES_MASIVOS.md §8.4): cifras, lo que reportó
 * Meta de la entrega y la lectura, por qué no les llegó a algunos, la lista de
 * personas y los controles (pausar, reanudar, cancelar lo que falta, reintentar
 * los fallos pasajeros). Se actualiza sola mientras el envío está activo.
 */
export default function SeguimientoEnvio({ id, inicial }: { id: string; inicial: Seguimiento }) {
    const [s, setS] = useState(inicial);
    const [filtro, setFiltro] = useState<FiltroDestinatarios>('TODOS');
    const [pagina, setPagina] = useState(1);
    const [ocupado, setOcupado] = useState(false);
    const activo = s.envio.estado === 'EN_COLA' || s.envio.estado === 'ENVIANDO';

    const cargar = useCallback(
        () => seguimientoDelEnvio(id, { filtro, pagina }).then((r) => r.success && setS(r.seguimiento)),
        [id, filtro, pagina],
    );

    useEffect(() => {
        void cargar();
    }, [cargar]);
    useEffect(() => {
        if (!activo) return;
        const t = setInterval(() => void cargar(), 5000);
        return () => clearInterval(t);
    }, [activo, cargar]);

    const accion = async (a: 'pausar' | 'reanudar' | 'cancelar' | 'reintentar') => {
        if (a === 'cancelar' && !confirm('¿Cancelar lo que falta? A quienes ya les llegó no se les puede borrar el mensaje; a los demás ya no se les enviará.')) return;
        setOcupado(true);
        const r = await controlarEnvio(id, a);
        setOcupado(false);
        if (!r.success) return toast.error(r.error);
        if (a === 'reintentar') toast.success(r.reintentos ? `${r.reintentos} vuelven a la cola.` : 'No hay fallos que valga la pena reintentar.');
        void cargar();
    };

    const e = s.envio;
    const hechos = e.enviados + e.fallidos + e.omitidos;
    const avance = e.total ? Math.round((100 * hechos) / e.total) : 0;
    const reintentables = s.motivos.reduce((n, m) => n + m.reintentables, 0);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
                <Link href="/dashboard/mensajes-masivos" className="text-sm font-semibold text-teal-700 hover:underline">← Mensajes masivos</Link>
                <EstadoEnvio estado={e.estado} />
                <div className="ml-auto flex flex-wrap gap-2">
                    {activo && <Boton onClick={() => accion('pausar')} disabled={ocupado}><Pause className="h-4 w-4" /> Pausar</Boton>}
                    {e.estado === 'PAUSADO' && <Boton variante="primario" onClick={() => accion('reanudar')} disabled={ocupado}><Play className="h-4 w-4" /> Reanudar</Boton>}
                    {(activo || e.estado === 'PAUSADO') && <Boton variante="peligro" onClick={() => accion('cancelar')} disabled={ocupado}><XCircle className="h-4 w-4" /> Cancelar lo que falta</Boton>}
                    {reintentables > 0 && e.estado !== 'CANCELADO' && <Boton onClick={() => accion('reintentar')} disabled={ocupado}><RotateCcw className="h-4 w-4" /> Reintentar {numero(reintentables)}</Boton>}
                </div>
            </div>

            {e.estado === 'PAUSADO' && e.ultimoError && (
                <Aviso nivel="ERROR" titulo="El envío se detuvo solo">
                    {e.ultimoError} Corrija la causa (en Configuración → WhatsApp o en Meta) y apriete «Reanudar»: nadie recibió el mensaje dos veces.
                </Aviso>
            )}
            {e.estado === 'EN_COLA' && <Aviso nivel="INFO">En cola: sale en la próxima vuelta del horario permitido (cada 20 segundos se envía una tanda).</Aviso>}

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Cifra valor={e.total} titulo="Personas" />
                <Cifra valor={e.pendientes} titulo="En cola" />
                <Cifra valor={e.enviados} titulo="Enviados" />
                <Cifra valor={s.entrega.entregados} titulo="Entregados" detalle={e.enviados ? `${Math.round((100 * s.entrega.entregados) / e.enviados)} %` : undefined} />
                <Cifra valor={s.entrega.leidos} titulo="Leídos" detalle={e.enviados ? `${Math.round((100 * s.entrega.leidos) / e.enviados)} %` : undefined} />
                <Cifra valor={e.fallidos + s.entrega.noEntregados} titulo="No les llegó" alerta={e.fallidos + s.entrega.noEntregados > 0} />
            </div>
            <div>
                <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full bg-teal-500 transition-all" style={{ width: `${avance}%` }} />
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                    {avance} % procesado · {numero(e.omitidos)} omitidos · a {e.ritmo} por minuto
                    {e.confirmado ? ` · confirmado el ${formatAppointmentCompact(e.confirmado)}${e.confirmadoPor ? ` por ${e.confirmadoPor}` : ''}` : ''}
                    {e.terminado ? ` · terminó el ${formatAppointmentCompact(e.terminado)}` : ''}
                </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <Tarjeta titulo="Personas" acciones={<span className="text-xs text-zinc-500">{numero(s.totalFiltrado)}</span>}>
                    <div className="mb-3 flex flex-wrap gap-1">
                        {FILTROS.map((f) => (
                            <Boton key={f.id} variante={filtro === f.id ? 'primario' : 'secundario'} className="px-2.5 py-1 text-xs" onClick={() => { setFiltro(f.id); setPagina(1); }}>
                                {f.titulo}
                            </Boton>
                        ))}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-xs uppercase text-zinc-500">
                                <tr>
                                    <th className="py-1.5 pr-3">Nombre</th>
                                    <th className="py-1.5 pr-3">Celular</th>
                                    <th className="py-1.5 pr-3">Estado</th>
                                    <th className="py-1.5">Detalle</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {s.destinatarios.map((d) => (
                                    <tr key={d.id}>
                                        <td className="py-1.5 pr-3">{d.nombre ?? <span className="text-zinc-400">sin nombre</span>}</td>
                                        <td className="py-1.5 pr-3 font-mono text-xs">{d.celular}</td>
                                        <td className="py-1.5 pr-3">{d.entrega ? ENTREGA[d.entrega] : RESULTADO[d.resultado]}</td>
                                        <td className="py-1.5 text-xs text-zinc-500">{d.motivo ?? (d.enviado ? formatAppointmentCompact(d.enviado) : '')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-3 flex justify-end gap-1">
                        <Boton className="px-2 py-1 text-xs" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Boton>
                        <Boton className="px-2 py-1 text-xs" disabled={pagina * s.porPagina >= s.totalFiltrado} onClick={() => setPagina((p) => p + 1)}>Siguiente</Boton>
                    </div>
                </Tarjeta>
                <div className="space-y-5">
                    {s.motivos.length > 0 && (
                        <Tarjeta titulo="Por qué no les llegó">
                            <ul className="space-y-2 text-sm">
                                {s.motivos.map((m) => (
                                    <li key={m.motivo} className="flex gap-2">
                                        <span className="font-bold tabular-nums">{numero(m.cantidad)}</span>
                                        <span className="text-zinc-600 dark:text-zinc-300">{m.motivo}{m.reintentables ? ' (se puede reintentar)' : ''}</span>
                                    </li>
                                ))}
                            </ul>
                        </Tarjeta>
                    )}
                    <Tarjeta titulo="Lo que se envió" subtitulo={`Lista «${e.lista.nombre}»${e.plantilla ? ` · plantilla ${e.plantilla}` : ''}`}>
                        {e.imagenUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={e.imagenUrl} alt="Imagen del comunicado" className="mb-3 aspect-[1.91/1] w-full rounded-lg object-cover" />
                        )}
                        <p className="text-sm text-zinc-700 dark:text-zinc-200">
                            {trozosConFormato(e.texto).map((t, i) => (
                                <span key={i} className={`${t.negrita ? 'font-bold' : ''} ${t.cursiva ? 'italic' : ''} ${t.tachado ? 'line-through' : ''}`}>{t.texto}</span>
                            ))}
                        </p>
                    </Tarjeta>
                </div>
            </div>
        </div>
    );
}

function Cifra({ valor, titulo, detalle, alerta = false }: { valor: number; titulo: string; detalle?: string; alerta?: boolean }) {
    return (
        <div className={`rounded-2xl border p-4 ${alerta ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'}`}>
            <p className="text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-white">{numero(valor)}</p>
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{titulo}</p>
            {detalle && <p className="text-xs text-zinc-400">{detalle}</p>}
        </div>
    );
}
