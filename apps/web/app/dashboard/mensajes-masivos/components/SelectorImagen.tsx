'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Crop, ImagePlus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { evaluarImagen, pesoLegible, recorteIdeal, type MedidasImagen } from '@agenia/shared';
import { medirImagen, optimizarImagen } from '@/lib/mensajes-masivos/imagen-navegador';
import { quitarImagen, revisarImagenConIa, subirImagen } from '@/app/actions/mensajes-masivos';
import type { BorradorDetalle, RevisionImagenIaDto } from '@/app/actions/mensajes-masivos.types';
import { Aviso, Boton, EtiquetaNivel, Puntaje, Tarjeta } from './ui';

const LEGIBILIDAD = { buena: 'se lee bien', regular: 'cuesta un poco leerlo', mala: 'no se lee bien en un celular', sin_texto: 'no tiene texto' } as const;
const COHERENCIA = { alta: 'concuerda con el mensaje', media: 'concuerda en parte con el mensaje', baja: 'no concuerda con el mensaje', sin_mensaje: '' } as const;

/**
 * La imagen del encabezado (opcional, docs/PLAN_MENSAJES_MASIVOS.md §7): al
 * elegirla se mide en el navegador y se dice qué tan bien queda en WhatsApp
 * (formato, peso, tamaño, proporción, transparencias, brillo, nitidez), con la
 * zona que se ve en la conversación. «Optimizar» y «Recortar a 1,91:1» la
 * arreglan ahí mismo; la IA de la clínica revisa el contenido.
 */
export default function SelectorImagen({
    borradorId,
    imagenInicial,
    iaDisponible,
    onCambio,
}: {
    borradorId: string;
    imagenInicial: BorradorDetalle['imagen'];
    iaDisponible: boolean;
    onCambio: (url: string | null) => void;
}) {
    const [blob, setBlob] = useState<Blob | null>(null);
    const [vista, setVista] = useState<string | null>(imagenInicial?.url ?? null);
    const [medidas, setMedidas] = useState<MedidasImagen | null>(null);
    const [original, setOriginal] = useState<number | null>(null);
    const [guardada, setGuardada] = useState<string | null>(imagenInicial?.url ?? null);
    const [trabajando, setTrabajando] = useState<string | null>(null);
    const [ia, setIa] = useState<{ cargando: boolean; revision?: RevisionImagenIaDto; error?: string }>({ cargando: false });
    const entrada = useRef<HTMLInputElement>(null);

    const evaluacion = useMemo(() => (medidas ? evaluarImagen(medidas) : null), [medidas]);

    // Al retomar un borrador, se mide la imagen ya guardada.
    useEffect(() => {
        if (!imagenInicial?.url) return;
        let vivo = true;
        fetch(imagenInicial.url)
            .then((r) => r.blob())
            .then(async (b) => {
                const m = await medirImagen(b);
                if (vivo) {
                    setBlob(b);
                    setMedidas(m);
                }
            })
            .catch(() => undefined);
        return () => {
            vivo = false;
        };
    }, [imagenInicial?.url]);

    const guardar = async (b: Blob, m: MedidasImagen) => {
        if (!evaluarImagen(m).cumpleMeta) return;
        setTrabajando('Guardando…');
        const form = new FormData();
        form.append('imagen', b, 'comunicado');
        form.append('ancho', String(m.ancho));
        form.append('alto', String(m.alto));
        const r = await subirImagen(borradorId, form);
        setTrabajando(null);
        if (!r.success) return toast.error(r.error);
        setGuardada(r.url);
        setIa({ cargando: false });
        onCambio(r.url);
    };

    const cargar = async (b: Blob, esOriginal: boolean) => {
        setTrabajando('Analizando…');
        const m = await medirImagen(b);
        setTrabajando(null);
        if (vista?.startsWith('blob:')) URL.revokeObjectURL(vista);
        setBlob(b);
        setVista(URL.createObjectURL(b));
        setMedidas(m);
        if (esOriginal) setOriginal(b.size);
        if (!m.ancho) {
            setGuardada(null);
            onCambio(null);
            return;
        }
        if (evaluarImagen(m).cumpleMeta) await guardar(b, m);
        else {
            setGuardada(null);
            onCambio(null);
        }
    };

    const optimizar = async (recortar: boolean) => {
        if (!blob) return;
        setTrabajando(recortar ? 'Recortando…' : 'Optimizando…');
        try {
            const nuevo = await optimizarImagen(blob, { recortar });
            await cargar(nuevo, false);
        } catch {
            setTrabajando(null);
            toast.error('Este navegador no pudo abrir la imagen. Si es una foto de iPhone (HEIC), conviértala a JPEG o use Safari.');
        }
    };

    const quitar = async () => {
        await quitarImagen(borradorId);
        if (vista?.startsWith('blob:')) URL.revokeObjectURL(vista);
        setBlob(null);
        setVista(null);
        setMedidas(null);
        setGuardada(null);
        setOriginal(null);
        setIa({ cargando: false });
        onCambio(null);
    };

    const pedirIa = async () => {
        setIa({ cargando: true });
        const r = await revisarImagenConIa(borradorId);
        if (!r.success) return setIa({ cargando: false, error: r.error });
        if (!r.revision.disponible) return setIa({ cargando: false, error: r.revision.motivo });
        setIa({ cargando: false, revision: r.revision });
    };

    const zona = medidas?.ancho ? recorteIdeal(medidas.ancho, medidas.alto) : null;
    const puedeRecortar = evaluacion?.observaciones.some((o) => o.loArreglaRecortar);
    const puedeOptimizar = evaluacion?.observaciones.some((o) => o.loArreglaOptimizar) || (medidas?.bytes ?? 0) > 400 * 1024;

    return (
        <Tarjeta
            titulo="Imagen (opcional)"
            subtitulo="Va arriba del mensaje. Lo ideal: JPEG horizontal de 1200 × 628 px, de menos de 1 MB, con lo importante en el centro."
            acciones={
                vista && (
                    <Boton variante="suave" onClick={quitar}>
                        <Trash2 className="h-4 w-4" /> Quitar
                    </Boton>
                )
            }
        >
            {!vista ? (
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => entrada.current?.click()}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && entrada.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files?.[0];
                        if (f) void cargar(f, true);
                    }}
                    className="cursor-pointer rounded-2xl border-2 border-dashed border-zinc-300 p-8 text-center hover:border-teal-500 hover:bg-teal-50/40 dark:border-zinc-700"
                >
                    <ImagePlus className="mx-auto h-8 w-8 text-zinc-400" />
                    <p className="mt-2 font-semibold text-zinc-800 dark:text-zinc-100">{trabajando ?? 'Arrastre una imagen o haga clic'}</p>
                    <p className="mt-1 text-xs text-zinc-500">Cualquier formato: si WhatsApp no la acepta así, se convierte aquí.</p>
                </div>
            ) : (
                <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div>
                        <div className="flex justify-center rounded-xl bg-zinc-100 p-2 dark:bg-zinc-800">
                            <div className="relative inline-block overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={vista} alt="Imagen elegida" className="block max-h-72 w-auto" />
                                {zona && medidas && evaluacion && Math.abs(evaluacion.proporcion - 1.91) > 0.08 && (
                                    <div
                                        aria-hidden
                                        className="pointer-events-none absolute border-2 border-dashed border-teal-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                                        style={{
                                            left: `${(100 * zona.x) / medidas.ancho}%`,
                                            top: `${(100 * zona.y) / medidas.alto}%`,
                                            width: `${(100 * zona.ancho) / medidas.ancho}%`,
                                            height: `${(100 * zona.alto) / medidas.alto}%`,
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                        {zona && evaluacion && Math.abs(evaluacion.proporcion - 1.91) > 0.08 && (
                            <p className="mt-1 text-xs text-zinc-500">El recuadro es lo que se ve en la conversación sin tocar la imagen.</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                            {puedeOptimizar && (
                                <Boton onClick={() => optimizar(false)} disabled={!!trabajando}>
                                    <Wand2 className="h-4 w-4" /> Optimizar
                                </Boton>
                            )}
                            {puedeRecortar && (
                                <Boton onClick={() => optimizar(true)} disabled={!!trabajando}>
                                    <Crop className="h-4 w-4" /> Recortar a 1,91:1
                                </Boton>
                            )}
                            <Boton variante="suave" onClick={() => entrada.current?.click()} disabled={!!trabajando}>
                                Cambiar imagen
                            </Boton>
                        </div>
                        {trabajando && <p className="mt-2 text-xs text-zinc-500">{trabajando}</p>}
                        {original && medidas && original !== medidas.bytes && (
                            <p className="mt-2 text-xs text-emerald-700">
                                Pasó de {pesoLegible(original)} a {pesoLegible(medidas.bytes)}.
                            </p>
                        )}
                    </div>
                    <div className="space-y-3">
                        {evaluacion && (
                            <>
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                                        {evaluacion.cumpleMeta ? (guardada ? '✔ Lista para enviar' : 'Se puede enviar') : '✖ Así no se puede enviar'}
                                    </p>
                                    <Puntaje valor={evaluacion.puntaje} />
                                </div>
                                <ul className="space-y-1.5">
                                    {evaluacion.observaciones.map((o) => (
                                        <li key={o.id} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                                            <EtiquetaNivel nivel={o.nivel} />
                                            <span className="min-w-0 flex-1">{o.mensaje}</span>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                        {medidas && !medidas.ancho && (
                            <Aviso nivel="ERROR">
                                El navegador no pudo abrir esta imagen. Si es una foto de iPhone (HEIC), guárdela como JPEG o ábrala desde Safari.
                            </Aviso>
                        )}
                        {iaDisponible && guardada && (
                            <Boton variante="primario" onClick={pedirIa} disabled={ia.cargando}>
                                <Sparkles className="h-4 w-4" /> {ia.cargando ? 'Revisando…' : 'Revisar el contenido con IA'}
                            </Boton>
                        )}
                        {ia.error && <Aviso nivel="AVISO">{ia.error}</Aviso>}
                        {ia.revision && <RevisionIa r={ia.revision} />}
                    </div>
                </div>
            )}
            <input
                ref={entrada}
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void cargar(f, true);
                    e.target.value = '';
                }}
            />
        </Tarjeta>
    );
}

function RevisionIa({ r }: { r: RevisionImagenIaDto }) {
    return (
        <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3 text-sm dark:border-teal-900 dark:bg-teal-950/20">
            <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 font-semibold text-teal-900 dark:text-teal-200">
                    <Sparkles className="h-4 w-4" /> Revisión con IA
                </p>
                <Puntaje valor={r.puntaje} />
            </div>
            <p className="mt-1 text-zinc-700 dark:text-zinc-200">{r.resumen}</p>
            <ul className="mt-2 space-y-1 text-zinc-700 dark:text-zinc-200">
                <li>Texto de la imagen: {LEGIBILIDAD[r.legibilidad]}{r.textoEnImagen ? ` («${r.textoEnImagen.slice(0, 140)}»)` : ''}.</li>
                {COHERENCIA[r.coherenciaConElMensaje] && <li>La imagen {COHERENCIA[r.coherenciaConElMensaje]}.</li>}
            </ul>
            {r.datosPersonales && (
                <div className="mt-2">
                    <Aviso nivel="ERROR" titulo="Muestra datos personales">
                        {r.detalleDatosPersonales ?? 'Revise que no se vea ningún dato de un paciente.'}
                    </Aviso>
                </div>
            )}
            {r.contenidoInadecuado && (
                <div className="mt-2">
                    <Aviso nivel="ERROR" titulo="Contenido inadecuado">
                        {r.detalleInadecuado}
                    </Aviso>
                </div>
            )}
            {r.erroresEnLaImagen.length > 0 && (
                <div className="mt-2">
                    <Aviso nivel="AVISO" titulo="Errores en el texto de la imagen">
                        <ul className="list-disc pl-4">{r.erroresEnLaImagen.map((e, i) => <li key={i}>{e}</li>)}</ul>
                    </Aviso>
                </div>
            )}
            {r.recomendaciones.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-zinc-600 dark:text-zinc-300">
                    {r.recomendaciones.map((x, i) => (
                        <li key={i}>{x}</li>
                    ))}
                </ul>
            )}
            <p className="mt-2 text-[11px] text-zinc-400">Modelo: {r.modelo}.</p>
        </div>
    );
}
