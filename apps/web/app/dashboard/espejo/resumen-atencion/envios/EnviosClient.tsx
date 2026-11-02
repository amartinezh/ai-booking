'use client';

import { useState, useTransition } from 'react';
import { formatAppointmentShort } from '@/lib/date';
import { listarEnviosAction, reenviarResumenAction, type AtencionConEnvios } from '@/app/actions/resumen-envios';

const CANAL: Record<string, string> = { WHATSAPP: 'WhatsApp', TELEGRAM: 'Telegram', EMAIL: 'Correo' };
const ESTADO_ENVIO: Record<string, string> = {
    AVISO_ENVIADO: 'Aviso enviado (no ha pedido los documentos)',
    DOCUMENTOS_ENVIADOS: '✓ Documentos entregados',
    FALLO: '⚠ No salió',
    NO_ENVIADO: 'Sin correo utilizable',
};
const ESTADO_ATENCION: Record<string, string> = {
    RECIBIDO: 'Sin enviar todavía',
    ENVIADO: 'Avisado',
    EXCLUIDO: 'No se envía',
    SIN_CONTACTO: 'Sin celular utilizable',
    CADUCADO: 'Ya se borró (30 días)',
};
const PROPOSITO: Record<string, string> = { PRUEBA: 'prueba', REENVIO: 'reenvío' };

/** El seguimiento sin contenido y «Reenviar» con la verificación de identidad. */
export default function EnviosClient({ iniciales }: { iniciales: AtencionConEnvios[] }) {
    const [atenciones, setAtenciones] = useState(iniciales);
    const [consulta, setConsulta] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [buscando, startBuscar] = useTransition();
    const [abierta, setAbierta] = useState<string | null>(null);
    const [verificada, setVerificada] = useState(false);
    const [reenviando, startReenviar] = useTransition();
    const [resultado, setResultado] = useState<{ id: string; ok: boolean; texto: string } | null>(null);

    const buscar = (e?: React.FormEvent) => {
        e?.preventDefault();
        setError(null);
        startBuscar(async () => {
            const r = await listarEnviosAction(consulta);
            if (r.success) setAtenciones(r.atenciones);
            else setError(r.error);
        });
    };

    const reenviar = (id: string) => {
        setResultado(null);
        startReenviar(async () => {
            const r = await reenviarResumenAction(id, verificada);
            setResultado(
                r.success
                    ? { id, ok: true, texto: `Reenviado por ${r.enviados.map((c) => CANAL[c] ?? c).join(' y ')}.` }
                    : { id, ok: false, texto: r.error },
            );
            if (r.success) {
                setAbierta(null);
                setVerificada(false);
                const lista = await listarEnviosAction(consulta);
                if (lista.success) setAtenciones(lista.atenciones);
            }
        });
    };

    return (
        <div className="space-y-5">
            <header className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Envíos de documentos</h1>
                <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
                    Si al paciente le llegaron los documentos de su consulta (resumen, fórmula y órdenes) y por qué canal. Si los
                    pide en ventanilla, verifique su identidad y reenvíelos. Aquí no se ve el contenido clínico.
                </p>
            </header>

            <form onSubmit={buscar} className="flex flex-wrap items-center gap-2">
                <input
                    value={consulta}
                    onChange={(e) => setConsulta(e.target.value)}
                    inputMode="numeric"
                    placeholder="Número de historia o cédula"
                    aria-label="Buscar por historia o cédula"
                    className="w-64 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                    type="submit"
                    disabled={buscando}
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                >
                    {buscando ? 'Buscando…' : 'Buscar'}
                </button>
                <span className="text-xs text-zinc-500">Sin buscar: las atenciones de los últimos 30 días.</span>
            </form>
            {error && <p className="text-sm text-red-600">{error}</p>}

            {atenciones.length === 0 ? (
                <p className="text-sm text-zinc-500" data-testid="sin-atenciones">
                    No hay atenciones que mostrar.
                </p>
            ) : (
                <ul className="space-y-3">
                    {atenciones.map((a) => (
                        <li key={a.id} className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" data-testid="atencion">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <p className="text-sm text-zinc-900 dark:text-zinc-100">
                                    <span className="font-mono">Historia {a.historia}</span>
                                    <span className="text-zinc-500"> · {formatAppointmentShort(a.atendidaIso)}</span>
                                    {a.servicio && <span className="font-mono text-xs text-zinc-500"> · {a.servicio}</span>}
                                </p>
                                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                                    {ESTADO_ATENCION[a.estado] ?? a.estado}
                                    {a.motivo ? ` — ${a.motivo}` : ''}
                                </span>
                            </div>
                            {a.paciente && (
                                <p className="text-xs text-zinc-500">
                                    Paciente: {a.paciente.nombre}
                                    {a.paciente.documento ? ` · documento ${a.paciente.documento}` : ''}
                                </p>
                            )}
                            {a.envios.length > 0 && (
                                <ul className="space-y-1 text-sm">
                                    {a.envios.map((e, i) => (
                                        <li key={i} className="text-zinc-700 dark:text-zinc-300">
                                            <span className="font-medium">{CANAL[e.canal] ?? e.canal}</span>
                                            <span className="font-mono text-xs text-zinc-500"> {e.destino}</span>
                                            {PROPOSITO[e.proposito] && (
                                                <span className="ml-1 rounded bg-zinc-100 px-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                                    {PROPOSITO[e.proposito]}
                                                </span>
                                            )}
                                            <span> · {ESTADO_ENVIO[e.estado] ?? e.estado}</span>
                                            {(e.documentosIso ?? e.avisoIso) && (
                                                <span className="text-xs text-zinc-500"> · {formatAppointmentShort((e.documentosIso ?? e.avisoIso)!)}</span>
                                            )}
                                            {e.motivo && e.estado !== 'NO_ENVIADO' && <span className="block text-xs text-zinc-500">{e.motivo}</span>}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {resultado?.id === a.id && (
                                <p className={`text-sm ${resultado.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                                    {resultado.texto}
                                </p>
                            )}

                            {a.contenidoDisponible &&
                                (abierta === a.id ? (
                                    <div className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                                        <label className="flex items-start gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                                            <input
                                                type="checkbox"
                                                checked={verificada}
                                                onChange={(ev) => setVerificada(ev.target.checked)}
                                                className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                                                aria-label="Identidad verificada"
                                            />
                                            Verifiqué en ventanilla la identidad del paciente (o de su acompañante) con su documento.
                                        </label>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => reenviar(a.id)}
                                                disabled={!verificada || reenviando}
                                                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                                            >
                                                {reenviando ? 'Reenviando…' : 'Reenviar ahora'}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setAbierta(null);
                                                    setVerificada(false);
                                                }}
                                                className="text-sm text-zinc-500 hover:underline"
                                            >
                                                Cancelar
                                            </button>
                                        </div>
                                        <p className="text-xs text-zinc-500">
                                            Sale al mismo número, chat o correo de siempre, con el botón «Recibir mis documentos». Queda
                                            registrado quién lo reenvió.
                                        </p>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => {
                                            setAbierta(a.id);
                                            setVerificada(false);
                                            setResultado(null);
                                        }}
                                        aria-label={`Reenviar historia ${a.historia}`}
                                        className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                                    >
                                        Reenviar
                                    </button>
                                ))}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
