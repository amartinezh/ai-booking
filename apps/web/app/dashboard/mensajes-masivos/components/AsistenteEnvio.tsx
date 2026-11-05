'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDebouncedCallback } from 'use-debounce';
import { revisarTexto } from '@agenia/shared';
import { crearBorrador, guardarBorrador } from '@/app/actions/mensajes-masivos';
import type { BorradorDetalle, EstadoMensajesMasivos, ListaResumen } from '@/app/actions/mensajes-masivos.types';
import { formatDateShort } from '@/lib/date';
import PasoDestinatarios from './PasoDestinatarios';
import EditorMensaje from './EditorMensaje';
import SelectorImagen from './SelectorImagen';
import PasoRevision from './PasoRevision';
import VistaPreviaWhatsapp from './VistaPreviaWhatsapp';
import { Aviso, Boton, campo, numero } from './ui';

const PASOS = ['Destinatarios', 'Mensaje e imagen', 'Revisar y enviar'] as const;

/**
 * El asistente de un envío (docs/PLAN_MENSAJES_MASIVOS.md §3): 1) a quién,
 * 2) qué (texto e imagen, con sus revisiones y la vista previa en vivo),
 * 3) revisar, probar y confirmar. El borrador se guarda solo desde el paso 2:
 * se puede salir y retomarlo desde «Envíos».
 */
export default function AsistenteEnvio({
    clinica,
    listas,
    eps,
    pacientesConWhatsapp,
    estado,
    borradorInicial,
}: {
    clinica: string;
    listas: ListaResumen[];
    eps: Array<{ id: string; nombre: string }>;
    pacientesConWhatsapp: number;
    estado: EstadoMensajesMasivos | null;
    borradorInicial: BorradorDetalle | null;
}) {
    const [paso, setPaso] = useState(borradorInicial ? 1 : 0);
    const [lista, setLista] = useState(
        borradorInicial ? { id: borradorInicial.listaId, nombre: borradorInicial.listaNombre, contactos: borradorInicial.contactos } : null,
    );
    const [borrador, setBorrador] = useState<{ id: string; nombre: string } | null>(
        borradorInicial ? { id: borradorInicial.id, nombre: borradorInicial.nombre } : null,
    );
    const [texto, setTexto] = useState(borradorInicial?.texto ?? '');
    const [imagenUrl, setImagenUrl] = useState<string | null>(borradorInicial?.imagen?.url ?? null);
    const [creando, setCreando] = useState(false);

    const plantilla = imagenUrl ? estado?.plantillas.imagen : estado?.plantillas.texto;
    const plantillaSaluda = /^\s*(hola|buen[oa]s|estimad|apreciad|querid)/i.test(plantilla?.cuerpo ?? 'Hola');
    const revision = useMemo(() => revisarTexto(texto, { plantillaSaluda }), [texto, plantillaSaluda]);

    const guardarNombre = useDebouncedCallback((id: string, nombre: string) => void guardarBorrador(id, { nombre }), 800);

    const elegirLista = async (l: { id: string; nombre: string; contactos: number }) => {
        setLista(l);
        if (borrador) {
            const r = await guardarBorrador(borrador.id, { listaId: l.id });
            if (!r.success) return toast.error(r.error);
        } else {
            setCreando(true);
            const nombre = `Comunicado del ${formatDateShort(new Date())}`;
            const r = await crearBorrador({ nombre, listaId: l.id });
            setCreando(false);
            if (!r.success) return toast.error(r.error);
            setBorrador({ id: r.id, nombre });
        }
        setPaso(1);
    };

    return (
        <div className="space-y-6">
            <ol className="flex flex-wrap items-center gap-2 text-sm">
                {PASOS.map((p, i) => (
                    <li key={p} className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={i > paso || (i > 0 && !borrador)}
                            onClick={() => setPaso(i)}
                            className={`flex items-center gap-2 rounded-full px-3 py-1.5 font-semibold ${
                                i === paso ? 'bg-teal-600 text-white' : i < paso ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200' : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800'
                            }`}
                        >
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/30 text-xs">{i + 1}</span>
                            {p}
                        </button>
                        {i < PASOS.length - 1 && <span className="text-zinc-300">→</span>}
                    </li>
                ))}
                {lista && paso > 0 && (
                    <li className="ml-auto text-xs text-zinc-500">
                        Para: <strong>{lista.nombre}</strong> ({numero(lista.contactos)})
                    </li>
                )}
            </ol>

            {paso === 0 && (
                <>
                    {creando && <p className="text-sm text-zinc-500">Creando el borrador…</p>}
                    <PasoDestinatarios
                        listas={listas}
                        eps={eps}
                        pacientesConWhatsapp={pacientesConWhatsapp}
                        iaDisponible={!!estado?.ia}
                        listaActual={lista?.id ?? null}
                        onElegida={elegirLista}
                    />
                </>
            )}

            {paso === 1 && borrador && (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="space-y-5">
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200">
                            Nombre del envío (solo lo ve el personal)
                            <input
                                className={`${campo} mt-1`}
                                value={borrador.nombre}
                                maxLength={80}
                                onChange={(e) => {
                                    setBorrador({ ...borrador, nombre: e.target.value });
                                    guardarNombre(borrador.id, e.target.value);
                                }}
                            />
                        </label>
                        <EditorMensaje
                            borradorId={borrador.id}
                            textoInicial={texto}
                            plantillaSaluda={plantillaSaluda}
                            iaDisponible={!!estado?.ia}
                            onCambio={setTexto}
                        />
                        <SelectorImagen borradorId={borrador.id} imagenInicial={borradorInicial?.imagen ?? null} iaDisponible={!!estado?.ia} onCambio={setImagenUrl} />
                        {!revision.puedeEnviarse && texto.trim() && <Aviso nivel="ERROR">Corrija lo marcado como «Impide enviar» para seguir.</Aviso>}
                        <div className="flex gap-3">
                            <Boton onClick={() => setPaso(0)}>← Destinatarios</Boton>
                            <Boton variante="primario" disabled={!revision.puedeEnviarse} onClick={() => setPaso(2)}>
                                Revisar y enviar →
                            </Boton>
                        </div>
                    </div>
                    <div className="lg:sticky lg:top-6 lg:self-start">
                        <p className="mb-2 text-center text-xs font-semibold uppercase text-zinc-500">Vista previa</p>
                        <VistaPreviaWhatsapp
                            clinica={clinica}
                            cuerpo={plantilla?.cuerpo ?? null}
                            pie={plantilla?.pie ?? null}
                            nombre="Ana"
                            texto={texto}
                            imagenUrl={imagenUrl}
                            aproximada={!plantilla?.cuerpo}
                        />
                    </div>
                </div>
            )}

            {paso === 2 && borrador && lista && (
                <PasoRevision borradorId={borrador.id} listaId={lista.id} clinica={clinica} imagenUrl={imagenUrl} estado={estado} onVolver={() => setPaso(1)} />
            )}
        </div>
    );
}
