'use client';

import { useState, useTransition } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { setMyPaginaPoliticaDatos, type PaginaPoliticaDatos as Pagina } from '@/app/actions/politica-datos';
import { CAMPOS_POLITICA, type CampoPolitica } from '@/lib/politica-datos/datos';
import { formatAppointmentCompact } from '@/lib/date';

/**
 * 📄 La página pública de la política de datos (lib/politica-datos). El texto es
 * el de AgenIA; aquí el administrador escribe la identificación del responsable.
 * Con lo obligatorio completo se publica, y «Usar este enlace» lo pone como el de
 * la política en la autorización de datos.
 */
export default function PaginaPoliticaDatos({
    inicial,
    enlaceGuardado,
    onUsarEnlace,
    ocupado,
}: {
    inicial: Pagina;
    /** El enlace de la política que hoy usa el asistente. */
    enlaceGuardado: string;
    onUsarEnlace: (enlace: string) => void;
    ocupado: boolean;
}) {
    const [pagina, setPagina] = useState(inicial);
    const [valores, setValores] = useState(inicial.datos);
    const [error, setError] = useState<{ texto: string; campo?: CampoPolitica } | null>(null);
    const [listo, setListo] = useState(false);
    const [copiado, setCopiado] = useState(false);
    const [abierta, setAbierta] = useState(!inicial.publicada);
    const [isPending, startTransition] = useTransition();

    const hayCambios = CAMPOS_POLITICA.some((d) => valores[d.campo].trim() !== pagina.datos[d.campo]);
    const enUso = pagina.publicada && enlaceGuardado === pagina.enlace;

    const guardar = () => {
        setError(null);
        setListo(false);
        startTransition(async () => {
            const res = await setMyPaginaPoliticaDatos(valores);
            if (res.success) {
                setPagina(res.pagina);
                setValores(res.pagina.datos);
                setListo(true);
                setTimeout(() => setListo(false), 3000);
            } else {
                setError({ texto: res.error ?? 'No se pudo guardar.', campo: res.campo });
            }
        });
    };

    const copiar = async () => {
        try {
            await navigator.clipboard.writeText(pagina.enlace);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
        } catch {
            // Sin permiso del navegador: el enlace sigue a la vista para copiarlo a mano.
        }
    };

    const input =
        'w-full rounded-xl border bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white disabled:opacity-50';
    const tope = `${Number(pagina.hoy.slice(0, 4)) + 1}${pagina.hoy.slice(4)}`;

    return (
        <div id="politica" className="mt-6 scroll-mt-24 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="flex items-start gap-3">
                <div className="rounded-xl p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
                    <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                    <h3 className="font-bold text-zinc-900 dark:text-white">Página de la política en AgenIA</h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Si la clínica no tiene publicada una política de tratamiento de datos al día, AgenIA la publica:
                        responsable, datos que se tratan y para qué, derechos, cómo reclamar y en qué plazos, tiempos de
                        conservación y seguridad, según la Ley 1581 de 2012 y el Decreto 1377 de 2013. El texto describe
                        lo que hace el sistema; usted escribe los datos de la clínica. Antes de usarla, la debe aprobar
                        la oficina jurídica.
                    </p>
                </div>
            </div>

            <div className="mt-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 p-3 text-sm" role="status">
                {pagina.publicada ? (
                    <div className="flex flex-col gap-2">
                        <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                            Publicada{enUso ? ' · es el enlace que usa el asistente' : ''}
                            {listo && !isPending && <span className="ml-2">✓ Guardado</span>}
                        </p>
                        <p className="break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">{pagina.enlace}</p>
                        <div className="flex flex-wrap items-center gap-3">
                            <a
                                href={pagina.ruta}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                                Ver la página <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                            </a>
                            <button
                                type="button"
                                onClick={copiar}
                                className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                                {copiado ? '✓ Copiado' : 'Copiar el enlace'}
                            </button>
                            {!enUso && (
                                <button
                                    type="button"
                                    disabled={ocupado || isPending}
                                    onClick={() => onUsarEnlace(pagina.enlace)}
                                    className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    Usar este enlace en la autorización
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <p className="text-zinc-600 dark:text-zinc-300">
                        Sin publicar: complete los datos marcados con * y guarde. Mientras tanto, la página no existe.
                    </p>
                )}
            </div>

            {pagina.publicada && (
                <button
                    type="button"
                    onClick={() => setAbierta((v) => !v)}
                    aria-expanded={abierta}
                    className="mt-3 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                    {abierta ? 'Ocultar los datos de la clínica' : 'Editar los datos de la clínica'}
                </button>
            )}

            {abierta && (
                <div className="mt-4 flex flex-col gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        {CAMPOS_POLITICA.map((d) => (
                            <label
                                key={d.campo}
                                className={`flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300 ${
                                    d.campo === 'razonSocial' || d.campo === 'telefono' || d.campo === 'area' || d.campo === 'horario'
                                        ? 'sm:col-span-2'
                                        : ''
                                }`}
                            >
                                <span>
                                    {d.etiqueta}
                                    {d.obligatorio ? ' *' : ' (opcional)'}
                                </span>
                                <input
                                    type={d.campo === 'correo' ? 'email' : d.campo === 'vigenteDesde' ? 'date' : 'text'}
                                    value={valores[d.campo]}
                                    disabled={isPending}
                                    onChange={(e) => setValores((v) => ({ ...v, [d.campo]: e.target.value }))}
                                    placeholder={d.campo === 'vigenteDesde' ? undefined : d.ejemplo}
                                    maxLength={d.max}
                                    min={d.campo === 'vigenteDesde' ? '2012-10-17' : undefined}
                                    max={d.campo === 'vigenteDesde' ? tope : undefined}
                                    aria-invalid={error?.campo === d.campo || undefined}
                                    className={`${input} ${
                                        error?.campo === d.campo
                                            ? 'border-red-400 dark:border-red-500'
                                            : 'border-zinc-200 dark:border-zinc-700'
                                    }`}
                                />
                                {d.ayuda && <span className="text-xs text-zinc-400">{d.ayuda}</span>}
                            </label>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={guardar}
                            disabled={isPending || !hayCambios}
                            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isPending ? 'Guardando…' : pagina.publicada ? 'Guardar los cambios' : 'Publicar la página'}
                        </button>
                        <span className="text-xs text-zinc-400">
                            La versión y el nombre del asistente salen de esta misma pantalla.
                        </span>
                    </div>
                </div>
            )}

            {error && (
                <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                    No se pudo guardar: {error.texto}
                </p>
            )}
            {pagina.ultimoCambio && (
                <p className="mt-2 text-xs text-zinc-400">
                    Último cambio: {pagina.ultimoCambio.por} · {formatAppointmentCompact(new Date(pagina.ultimoCambio.en))}
                </p>
            )}
        </div>
    );
}
