'use client';

import { useEffect, useState, useTransition } from 'react';
import { enmascararDestino } from '@agenia/shared';
import { formatAppointmentShort } from '@/lib/date';
import {
    crearEnlaceDePruebaAction,
    enviarDePruebaAction,
    listarDocumentosAction,
    type DocumentoDelPanel,
} from '@/app/actions/resumen-atencion';

const RUTA = '/dashboard/espejo/resumen-atencion/documento';

const enlace = (id: string, doc: string, formato: 'pdf' | 'png', hoja = 1) =>
    `${RUTA}?id=${encodeURIComponent(id)}&doc=${encodeURIComponent(doc)}&formato=${formato}&hoja=${hoja}`;

/**
 * Fase 2: los documentos de un resumen en PDF e imagen, para compararlos con el
 * papel que imprime el HIS, y un enlace de prueba a la página del paciente para
 * verla en un celular. Cada archivo que se abre queda en la Actividad de usuarios.
 */
export default function DocumentosDelResumen({ id, destinosPrueba = [] }: { id: string; destinosPrueba?: string[] }) {
    const [documentos, setDocumentos] = useState<DocumentoDelPanel[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [enlacePrueba, setEnlacePrueba] = useState<{ url: string; expiraIso: string } | null>(null);
    const [copiado, setCopiado] = useState(false);
    const [generando, startGenerar] = useTransition();
    const [destino, setDestino] = useState(destinosPrueba[0] ?? '');
    const [enviando, startEnviar] = useTransition();
    const [avisoPrueba, setAvisoPrueba] = useState<string | null>(null);

    const enviarPrueba = () => {
        setError(null);
        setAvisoPrueba(null);
        startEnviar(async () => {
            const r = await enviarDePruebaAction(id, destino);
            if (r.success) setAvisoPrueba(`Aviso enviado a ${enmascararDestino(destino)}. Toque el botón en ese celular.`);
            else setError(r.error);
        });
    };

    useEffect(() => {
        let vivo = true;
        listarDocumentosAction(id).then((r) => {
            if (!vivo) return;
            if (r.success) setDocumentos(r.documentos);
            else setError(r.error);
        });
        return () => {
            vivo = false;
        };
    }, [id]);

    const generar = () => {
        setError(null);
        setCopiado(false);
        startGenerar(async () => {
            const r = await crearEnlaceDePruebaAction(id);
            if (r.success) setEnlacePrueba({ url: r.url, expiraIso: r.expiraIso });
            else setError(r.error);
        });
    };

    const copiar = async () => {
        if (!enlacePrueba) return;
        try {
            await navigator.clipboard.writeText(enlacePrueba.url);
            setCopiado(true);
        } catch {
            setCopiado(false);
        }
    };

    return (
        <section className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="documentos-del-resumen">
            <div>
                <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Documentos para el paciente</h4>
                <p className="text-xs text-zinc-500">
                    Como los recibirá el paciente: en PDF y una imagen por hoja, con la marca de agua «Copia para el paciente».
                    Compárelos con el papel que imprime el HIS.
                </p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {documentos === null && !error && <p className="text-sm text-zinc-500">Cargando documentos…</p>}
            {documentos && (
                <ul className="space-y-2">
                    {documentos.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">{d.titulo}</span>
                            <span className="text-xs text-zinc-500">
                                {d.hojas} hoja{d.hojas === 1 ? '' : 's'}
                            </span>
                            <a
                                href={enlace(id, d.id, 'pdf')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline dark:text-blue-400"
                                aria-label={`PDF de ${d.titulo}`}
                            >
                                PDF
                            </a>
                            {Array.from({ length: d.hojas }, (_, i) => (
                                <a
                                    key={i}
                                    href={enlace(id, d.id, 'png', i + 1)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline dark:text-blue-400"
                                    aria-label={`Imagen de la hoja ${i + 1} de ${d.titulo}`}
                                >
                                    Imagen{d.hojas > 1 ? ` ${i + 1}` : ''}
                                </a>
                            ))}
                        </li>
                    ))}
                    {documentos.length > 1 && (
                        <li className="text-sm">
                            <a
                                href={enlace(id, 'todo', 'pdf')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                                Todos en un solo PDF
                            </a>
                        </li>
                    )}
                </ul>
            )}
            <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800" data-testid="enviar-de-prueba">
                {destinosPrueba.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                        Para enviar de prueba, agregue arriba los números (o chats de Telegram) del equipo (modo prueba).
                    </p>
                ) : (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-zinc-700 dark:text-zinc-300">Enviar de prueba a</span>
                        <select
                            value={destino}
                            onChange={(e) => setDestino(e.target.value)}
                            aria-label="Número de prueba"
                            className="rounded-lg border border-zinc-300 bg-white px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        >
                            {destinosPrueba.map((d) => (
                                <option key={d} value={d}>
                                    {enmascararDestino(d)}
                                </option>
                            ))}
                        </select>
                        <button
                            onClick={enviarPrueba}
                            disabled={enviando || !destino}
                            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                        >
                            {enviando ? 'Enviando…' : 'Enviar de prueba'}
                        </button>
                    </div>
                )}
                {avisoPrueba && <p className="text-sm text-emerald-700 dark:text-emerald-400">{avisoPrueba}</p>}
                <p className="text-xs text-zinc-500">
                    Llega el aviso con el botón «Recibir mis documentos». Como ese número no es el del paciente, el asistente
                    pedirá la fecha de nacimiento del paciente antes de mandar los documentos.
                </p>
            </div>
            <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <button
                    onClick={generar}
                    disabled={generando}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                    {generando ? 'Generando…' : 'Generar enlace de prueba'}
                </button>
                <p className="text-xs text-zinc-500">
                    Abre la página que verá el paciente: pide la fecha de nacimiento del paciente y muestra el resumen y los
                    documentos. Úselo solo con el equipo; queda registrado. No se le envía nada al paciente.
                </p>
                {enlacePrueba && (
                    <div className="space-y-1 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900" data-testid="enlace-prueba">
                        <p className="break-all font-mono text-xs text-zinc-800 dark:text-zinc-200">{enlacePrueba.url}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                            <button onClick={copiar} className="text-blue-600 hover:underline dark:text-blue-400">
                                {copiado ? 'Copiado' : 'Copiar'}
                            </button>
                            <span className="text-zinc-500">
                                Vale hasta el {formatAppointmentShort(enlacePrueba.expiraIso)}. Solo se muestra esta vez.
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
