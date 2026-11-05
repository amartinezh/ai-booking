'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bold, Italic, Sparkles, Wand2 } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { LIMITES_TEXTO, arreglarAutomaticamente, revisarTexto, type ProblemaTexto } from '@agenia/shared';
import { guardarBorrador, revisarTextoConIa } from '@/app/actions/mensajes-masivos';
import type { RevisionTextoIaDto } from '@/app/actions/mensajes-masivos.types';
import { Aviso, Boton, EtiquetaNivel, Puntaje, Tarjeta, campo } from './ui';

const GRUPOS: Array<{ nivel: ProblemaTexto['nivel']; titulo: string }> = [
    { nivel: 'ERROR', titulo: 'Hay que corregirlo para poder enviar' },
    { nivel: 'AVISO', titulo: 'Revíselo' },
    { nivel: 'SUGERENCIA', titulo: 'Sugerencias' },
];

/**
 * El texto del comunicado (docs/PLAN_MENSAJES_MASIVOS.md §6): se revisa con las
 * reglas mientras se escribe (formato de WhatsApp, ortografía frecuente,
 * groserías, mayúsculas, espacios por llenar…), y con la IA de la clínica cuando
 * se pide. Se guarda solo en el borrador.
 */
export default function EditorMensaje({
    borradorId,
    textoInicial,
    plantillaSaluda,
    iaDisponible,
    onCambio,
}: {
    borradorId: string;
    textoInicial: string;
    plantillaSaluda: boolean;
    iaDisponible: boolean;
    onCambio: (texto: string) => void;
}) {
    const [texto, setTexto] = useState(textoInicial);
    const [guardado, setGuardado] = useState<'guardado' | 'guardando' | 'error' | null>(null);
    const [ia, setIa] = useState<{ cargando: boolean; revision?: RevisionTextoIaDto; texto?: string; error?: string }>({ cargando: false });
    const area = useRef<HTMLTextAreaElement>(null);

    const revision = useMemo(() => revisarTexto(texto, { plantillaSaluda }), [texto, plantillaSaluda]);
    const automatico = useMemo(() => arreglarAutomaticamente(texto, { plantillaSaluda }), [texto, plantillaSaluda]);

    const guardar = useDebouncedCallback(async (t: string) => {
        setGuardado('guardando');
        const r = await guardarBorrador(borradorId, { texto: t });
        setGuardado(r.success ? 'guardado' : 'error');
    }, 800);
    // Al salir del paso, lo que faltaba por guardar se guarda.
    useEffect(
        () => () => {
            void guardar.flush();
        },
        [guardar],
    );

    const cambiar = (t: string) => {
        setTexto(t);
        onCambio(t);
        guardar(t);
    };

    /** Pone el texto seleccionado entre dos signos (*negrita*, _cursiva_). */
    const envolver = (signo: string) => {
        const el = area.current;
        if (!el) return;
        const [a, b] = [el.selectionStart, el.selectionEnd];
        if (a === b) return;
        cambiar(`${texto.slice(0, a)}${signo}${texto.slice(a, b).trim()}${signo}${texto.slice(b)}`);
    };

    const pedirIa = async () => {
        setIa({ cargando: true });
        const r = await revisarTextoConIa(texto);
        if (!r.success) return setIa({ cargando: false, error: r.error });
        if (!r.revision.disponible) return setIa({ cargando: false, error: r.revision.motivo });
        setIa({ cargando: false, revision: r.revision, texto });
    };

    const largo = revision.caracteres;
    const colorLargo = largo > LIMITES_TEXTO.maximo ? 'text-rose-600' : largo > LIMITES_TEXTO.recomendado ? 'text-amber-600' : 'text-zinc-400';
    const desactualizada = ia.revision && ia.texto !== texto;

    return (
        <Tarjeta
            titulo="El mensaje"
            subtitulo="Un solo párrafo: WhatsApp no deja saltos de línea dentro de una plantilla. Para resaltar, *negrita* o _cursiva_."
            acciones={
                <span className="text-xs text-zinc-400">
                    {guardado === 'guardando' ? 'Guardando…' : guardado === 'guardado' ? 'Guardado' : guardado === 'error' ? 'No se pudo guardar' : ''}
                </span>
            }
        >
            <div className="mb-2 flex flex-wrap gap-2">
                <Boton onClick={() => envolver('*')} title="Negrita (seleccione el texto)">
                    <Bold className="h-4 w-4" />
                </Boton>
                <Boton onClick={() => envolver('_')} title="Cursiva (seleccione el texto)">
                    <Italic className="h-4 w-4" />
                </Boton>
                <Boton onClick={() => cambiar(automatico)} disabled={automatico === texto} title="Une los párrafos, corrige tildes, espacios y signos">
                    <Wand2 className="h-4 w-4" /> Arreglar lo automático
                </Boton>
                {iaDisponible && (
                    <Boton variante="primario" onClick={pedirIa} disabled={ia.cargando || !texto.trim()}>
                        <Sparkles className="h-4 w-4" /> {ia.cargando ? 'Revisando…' : 'Revisar con IA'}
                    </Boton>
                )}
            </div>
            <textarea
                ref={area}
                aria-label="Texto del comunicado"
                className={`${campo} min-h-[150px] text-[15px] leading-relaxed`}
                value={texto}
                maxLength={3000}
                onChange={(e) => cambiar(e.target.value)}
                placeholder="Ej.: Este sábado 8 de noviembre tendremos jornada de vacunación de 8:00 a. m. a 12:00 m. en la sede principal (Cra. 5 # 10-20). Traiga su documento y el carné de vacunas."
            />
            <div className="mt-1 flex justify-between text-xs">
                <span className="text-zinc-400">{revision.palabras} palabra(s)</span>
                <span className={colorLargo}>
                    {largo} / {LIMITES_TEXTO.maximo} caracteres {largo <= LIMITES_TEXTO.recomendado ? '' : `(mejor menos de ${LIMITES_TEXTO.recomendado})`}
                </span>
            </div>

            {/* Revisión con reglas, al instante */}
            <div className="mt-4 space-y-3">
                {revision.problemas.length === 0 && texto.trim() && <Aviso nivel="BIEN">Sin observaciones de forma, ortografía ni lenguaje.</Aviso>}
                {GRUPOS.map((g) => {
                    const lista = revision.problemas.filter((p) => p.nivel === g.nivel);
                    if (!lista.length) return null;
                    return (
                        <div key={g.nivel}>
                            <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">{g.titulo}</p>
                            <ul className="space-y-1.5">
                                {lista.map((p, i) => (
                                    <li key={`${p.id}-${i}`} className="flex flex-wrap items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                                        <EtiquetaNivel nivel={p.nivel} />
                                        <span className="min-w-0 flex-1">{p.mensaje}</span>
                                        {p.arreglado !== undefined && (
                                            <Boton variante="suave" className="px-2 py-1 text-xs" onClick={() => cambiar(p.arreglado as string)}>
                                                Aplicar
                                            </Boton>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    );
                })}
            </div>

            {/* Revisión con IA, a pedido */}
            {ia.error && <div className="mt-4"><Aviso nivel="AVISO">{ia.error}</Aviso></div>}
            {ia.revision && (
                <div className="mt-5 rounded-xl border border-teal-200 bg-teal-50/50 p-4 dark:border-teal-900 dark:bg-teal-950/20">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-2 font-semibold text-teal-900 dark:text-teal-200">
                            <Sparkles className="h-4 w-4" /> Revisión con IA
                        </p>
                        <Puntaje valor={ia.revision.puntaje} />
                    </div>
                    {desactualizada && <p className="mt-1 text-xs text-amber-700">El texto cambió desde esta revisión: vuelva a revisarlo antes de enviar.</p>}
                    <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
                        {ia.revision.resumen} <span className="text-zinc-500">Tono: {ia.revision.tono}.</span>
                    </p>
                    {ia.revision.problemas.length > 0 && (
                        <ul className="mt-3 space-y-2">
                            {ia.revision.problemas.map((p, i) => (
                                <li key={i} className="rounded-lg bg-white p-2.5 text-sm shadow-sm dark:bg-zinc-900">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <EtiquetaNivel nivel={p.gravedad === 'alta' ? 'ERROR' : p.gravedad === 'media' ? 'AVISO' : 'SUGERENCIA'} />
                                        <span className="text-xs uppercase text-zinc-400">{p.tipo.replace('_', ' ')}</span>
                                    </div>
                                    {p.fragmento && (
                                        <p className="mt-1">
                                            <span className="rounded bg-rose-100 px-1 line-through decoration-rose-400 dark:bg-rose-950">{p.fragmento}</span>
                                            {p.sugerencia && (
                                                <>
                                                    {' → '}
                                                    <span className="rounded bg-emerald-100 px-1 dark:bg-emerald-950">{p.sugerencia}</span>
                                                </>
                                            )}
                                        </p>
                                    )}
                                    <p className="mt-1 text-zinc-600 dark:text-zinc-300">{p.explicacion}</p>
                                    {p.aplicable && texto.includes(p.fragmento) && (
                                        <Boton variante="suave" className="mt-1 px-2 py-1 text-xs" onClick={() => cambiar(texto.replace(p.fragmento, p.sugerencia))}>
                                            Aplicar este cambio
                                        </Boton>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    {ia.revision.textoSugerido && (
                        <div className="mt-3 rounded-lg border border-dashed border-teal-300 p-3 text-sm dark:border-teal-800">
                            <p className="mb-1 text-xs font-semibold uppercase text-teal-700">Texto sugerido</p>
                            <p className="text-zinc-700 dark:text-zinc-200">{ia.revision.textoSugerido}</p>
                            <Boton variante="primario" className="mt-2" onClick={() => cambiar(ia.revision?.textoSugerido as string)}>
                                Usar el texto sugerido
                            </Boton>
                        </div>
                    )}
                    <p className="mt-2 text-[11px] text-zinc-400">Modelo: {ia.revision.modelo}. La IA sugiere; usted decide.</p>
                </div>
            )}
        </Tarjeta>
    );
}
