'use client';

import { useState } from 'react';
import { FileUp, ListChecks, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';
import { crearListaDesdePacientes } from '@/app/actions/mensajes-masivos';
import type { ListaResumen } from '@/app/actions/mensajes-masivos.types';
import ImportadorContactos from './ImportadorContactos';
import { Boton, Tarjeta, campo, numero } from './ui';

type Origen = 'GUARDADA' | 'IMPORTAR' | 'PACIENTES';

/** Paso 1: a quién. Una lista guardada, contactos nuevos de un archivo, o los pacientes de la clínica. */
export default function PasoDestinatarios({
    listas,
    eps,
    pacientesConWhatsapp,
    iaDisponible,
    listaActual,
    onElegida,
}: {
    listas: ListaResumen[];
    eps: Array<{ id: string; nombre: string }>;
    pacientesConWhatsapp: number;
    iaDisponible: boolean;
    listaActual: string | null;
    onElegida: (lista: { id: string; nombre: string; contactos: number }) => void;
}) {
    const [origen, setOrigen] = useState<Origen>(listas.length ? 'GUARDADA' : 'IMPORTAR');
    const [elegida, setElegida] = useState(listaActual ?? listas[0]?.id ?? '');
    const [nombre, setNombre] = useState('Pacientes con WhatsApp');
    const [epsId, setEpsId] = useState('');
    const [consentimiento, setConsentimiento] = useState('');
    const [declara, setDeclara] = useState(false);
    const [creando, setCreando] = useState(false);

    const opciones: Array<{ id: Origen; titulo: string; detalle: string; icono: React.ReactNode; deshabilitada?: boolean }> = [
        { id: 'GUARDADA', titulo: 'Una lista guardada', detalle: listas.length ? `${listas.length} lista(s)` : 'Todavía no hay', icono: <ListChecks className="h-5 w-5" />, deshabilitada: !listas.length },
        { id: 'IMPORTAR', titulo: 'Importar contactos', detalle: 'Excel, CSV, vCard o texto pegado', icono: <FileUp className="h-5 w-5" /> },
        { id: 'PACIENTES', titulo: 'Pacientes de la clínica', detalle: `${numero(pacientesConWhatsapp)} con WhatsApp registrado`, icono: <Stethoscope className="h-5 w-5" />, deshabilitada: !pacientesConWhatsapp },
    ];
    const lista = listas.find((l) => l.id === elegida);

    const crearDesdePacientes = async () => {
        setCreando(true);
        const r = await crearListaDesdePacientes({ nombre, consentimiento, epsId: epsId || null });
        setCreando(false);
        if (!r.success) return toast.error(r.error);
        toast.success(`Lista creada con ${numero(r.agregados + r.repetidos)} paciente(s).`);
        onElegida({ id: r.listaId, nombre, contactos: r.agregados + r.repetidos });
    };

    return (
        <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
                {opciones.map((o) => (
                    <button
                        key={o.id}
                        type="button"
                        disabled={o.deshabilitada}
                        onClick={() => setOrigen(o.id)}
                        className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            origen === o.id
                                ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/30 dark:bg-teal-950/30'
                                : 'border-zinc-200 bg-white hover:border-teal-300 dark:border-zinc-800 dark:bg-zinc-900'
                        }`}
                    >
                        <span className="mt-0.5 text-teal-600">{o.icono}</span>
                        <span>
                            <span className="block font-semibold text-zinc-900 dark:text-white">{o.titulo}</span>
                            <span className="block text-xs text-zinc-500">{o.detalle}</span>
                        </span>
                    </button>
                ))}
            </div>

            {origen === 'GUARDADA' && (
                <Tarjeta titulo="Elija la lista">
                    <select aria-label="Lista de contactos" className={campo} value={elegida} onChange={(e) => setElegida(e.target.value)}>
                        {listas.map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.nombre} — {numero(l.contactos)} contacto(s)
                            </option>
                        ))}
                    </select>
                    {lista && (
                        <p className="mt-2 text-xs text-zinc-500">
                            {lista.descripcion ? `${lista.descripcion}. ` : ''}Autorización declarada: «{lista.consentimiento}»
                        </p>
                    )}
                    <Boton variante="primario" className="mt-4" disabled={!lista || !lista.contactos} onClick={() => lista && onElegida({ id: lista.id, nombre: lista.nombre, contactos: lista.contactos })}>
                        Usar esta lista
                    </Boton>
                </Tarjeta>
            )}

            {origen === 'IMPORTAR' && <ImportadorContactos iaDisponible={iaDisponible} onGuardada={onElegida} />}

            {origen === 'PACIENTES' && (
                <Tarjeta
                    titulo="Pacientes de la clínica"
                    subtitulo="Se arma una lista con los pacientes que tienen un celular de WhatsApp registrado en AgenIA (los que solo usan Telegram o tienen el número oculto quedan fuera). La lista queda guardada."
                >
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                            Nombre de la lista
                            <input className={`${campo} mt-1`} value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />
                        </label>
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                            Solo de una EPS (opcional)
                            <select className={`${campo} mt-1`} value={epsId} onChange={(e) => setEpsId(e.target.value)}>
                                <option value="">Todas las EPS</option>
                                {eps.map((e) => (
                                    <option key={e.id} value={e.id}>
                                        {e.nombre}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200 md:col-span-2">
                            ¿Cómo autorizaron estos pacientes que la clínica les escriba comunicados?
                            <textarea
                                className={`${campo} mt-1 min-h-[70px]`}
                                value={consentimiento}
                                onChange={(e) => setConsentimiento(e.target.value)}
                                placeholder="Ej.: Firmaron la autorización de tratamiento de datos, que incluye comunicados por WhatsApp."
                            />
                        </label>
                        <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-200 md:col-span-2">
                            <input type="checkbox" className="mt-1" checked={declara} onChange={(e) => setDeclara(e.target.checked)} />
                            Declaro que estos pacientes autorizaron a la clínica a enviarles comunicados por WhatsApp (Ley 1581 de 2012).
                        </label>
                    </div>
                    <Boton variante="primario" className="mt-4" disabled={creando || !nombre.trim() || consentimiento.trim().length < 15 || !declara} onClick={crearDesdePacientes}>
                        {creando ? 'Creando…' : 'Crear la lista'}
                    </Boton>
                </Tarjeta>
            )}
        </div>
    );
}
