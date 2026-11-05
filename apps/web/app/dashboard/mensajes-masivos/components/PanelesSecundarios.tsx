'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { ETIQUETA_ESTADO_ENVIO, type EstadoEnvioMasivo } from '@agenia/shared';
import { formatAppointmentCompact, formatDateShort } from '@/lib/date';
import {
    eliminarBorrador,
    eliminarLista,
    listarBajas,
    quitarBaja,
    quitarContactoDeLista,
    registrarBaja,
    renombrarLista,
    verContactosDeLista,
} from '@/app/actions/mensajes-masivos';
import type { BajaDto, ContactoDeLista, EnvioResumen, ListaResumen } from '@/app/actions/mensajes-masivos.types';
import ImportadorContactos from './ImportadorContactos';
import { Aviso, Boton, Tarjeta, campo, numero } from './ui';

const COLOR_ESTADO: Record<EstadoEnvioMasivo, string> = {
    BORRADOR: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    EN_COLA: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
    ENVIANDO: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
    PAUSADO: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    TERMINADO: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    CANCELADO: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
};

export function EstadoEnvio({ estado }: { estado: EstadoEnvioMasivo }) {
    return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COLOR_ESTADO[estado]}`}>{ETIQUETA_ESTADO_ENVIO[estado]}</span>;
}

// ─── Envíos ─────────────────────────────────────────────────────────────────

export function HistorialEnvios({ envios, onContinuar }: { envios: EnvioResumen[]; onContinuar: (id: string) => void }) {
    const router = useRouter();
    const borradores = envios.filter((e) => e.estado === 'BORRADOR');
    const otros = envios.filter((e) => e.estado !== 'BORRADOR');
    const borrar = async (id: string) => {
        if (!confirm('¿Eliminar este borrador? No se envió a nadie.')) return;
        const r = await eliminarBorrador(id);
        if (r.success) router.refresh();
        else toast.error(r.error);
    };
    return (
        <div className="space-y-5">
            {borradores.length > 0 && (
                <Tarjeta titulo="Borradores" subtitulo="Envíos sin confirmar: no le han llegado a nadie.">
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {borradores.map((e) => (
                            <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-zinc-900 dark:text-white">{e.nombre}</p>
                                    <p className="text-xs text-zinc-500">
                                        Para «{e.lista}» · creado el {formatDateShort(e.creado)}
                                        {e.conImagen ? ' · con imagen' : ''}
                                    </p>
                                </div>
                                <Boton variante="primario" onClick={() => onContinuar(e.id)}>
                                    Continuar
                                </Boton>
                                <Boton variante="suave" onClick={() => borrar(e.id)} aria-label="Eliminar borrador">
                                    <Trash2 className="h-4 w-4" />
                                </Boton>
                            </li>
                        ))}
                    </ul>
                </Tarjeta>
            )}
            <Tarjeta titulo="Envíos" subtitulo="Los confirmados, del más reciente al más antiguo.">
                {!otros.length ? (
                    <p className="text-sm text-zinc-500">Todavía no se ha confirmado ningún envío.</p>
                ) : (
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {otros.map((e) => {
                            const hechos = e.enviados + e.fallidos + e.omitidos;
                            const avance = e.total ? Math.round((100 * hechos) / e.total) : 0;
                            return (
                                <li key={e.id}>
                                    <Link href={`/dashboard/mensajes-masivos/${e.id}`} className="flex flex-wrap items-center gap-3 rounded-xl px-2 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                        <div className="min-w-0 flex-1">
                                            <p className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-white">
                                                {e.nombre} <EstadoEnvio estado={e.estado} />
                                            </p>
                                            <p className="text-xs text-zinc-500">
                                                «{e.lista}» · confirmado {e.confirmado ? formatAppointmentCompact(e.confirmado) : '—'}
                                                {e.confirmadoPor ? ` por ${e.confirmadoPor}` : ''}
                                            </p>
                                            {e.estado === 'PAUSADO' && e.ultimoError && <p className="mt-1 text-xs text-amber-700">Se detuvo: {e.ultimoError}</p>}
                                        </div>
                                        <div className="w-48">
                                            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                                <div className="h-full bg-teal-500" style={{ width: `${avance}%` }} />
                                            </div>
                                            <p className="mt-1 text-xs text-zinc-500">
                                                {numero(e.enviados)} enviados · {numero(e.fallidos)} fallidos · de {numero(e.total)}
                                            </p>
                                        </div>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Tarjeta>
        </div>
    );
}

// ─── Listas ─────────────────────────────────────────────────────────────────

export function ListasContactos({ listas, iaDisponible }: { listas: ListaResumen[]; iaDisponible: boolean }) {
    const router = useRouter();
    const [abierta, setAbierta] = useState<string | null>(null);
    const [agregando, setAgregando] = useState<ListaResumen | null>(null);
    if (!listas.length) {
        return <Tarjeta titulo="Listas de contactos"><p className="text-sm text-zinc-500">Todavía no hay listas. Se crean en «Nuevo envío», al importar contactos.</p></Tarjeta>;
    }
    if (agregando) {
        return (
            <div className="space-y-3">
                <Boton onClick={() => setAgregando(null)}>← Volver a las listas</Boton>
                <ImportadorContactos
                    listaExistente={{ id: agregando.id, nombre: agregando.nombre }}
                    iaDisponible={iaDisponible}
                    onGuardada={() => {
                        setAgregando(null);
                        router.refresh();
                    }}
                />
            </div>
        );
    }
    return (
        <div className="space-y-3">
            {listas.map((l) => (
                <ListaFila key={l.id} lista={l} abierta={abierta === l.id} onAbrir={() => setAbierta(abierta === l.id ? null : l.id)} onAgregar={() => setAgregando(l)} />
            ))}
        </div>
    );
}

function ListaFila({ lista, abierta, onAbrir, onAgregar }: { lista: ListaResumen; abierta: boolean; onAbrir: () => void; onAgregar: () => void }) {
    const router = useRouter();
    const [contactos, setContactos] = useState<ContactoDeLista[]>([]);
    const [total, setTotal] = useState(0);
    const [pagina, setPagina] = useState(1);
    const [buscar, setBuscar] = useState('');
    const [editando, setEditando] = useState(false);
    const [nombre, setNombre] = useState(lista.nombre);
    const [descripcion, setDescripcion] = useState(lista.descripcion ?? '');

    useEffect(() => {
        if (!abierta) return;
        const t = setTimeout(() => {
            void verContactosDeLista(lista.id, { pagina, buscar }).then((r) => {
                if (r.success) {
                    setContactos(r.contactos);
                    setTotal(r.total);
                }
            });
        }, 250);
        return () => clearTimeout(t);
    }, [abierta, lista.id, pagina, buscar]);

    const quitar = async (c: ContactoDeLista) => {
        const r = await quitarContactoDeLista(lista.id, c.id);
        if (!r.success) return toast.error(r.error);
        setContactos((xs) => xs.filter((x) => x.id !== c.id));
        setTotal((t) => t - 1);
        router.refresh();
    };
    const renombrar = async () => {
        const r = await renombrarLista(lista.id, nombre, descripcion);
        if (!r.success) return toast.error(r.error);
        setEditando(false);
        router.refresh();
    };
    const borrar = async () => {
        if (!confirm(`¿Eliminar la lista «${lista.nombre}» con sus ${lista.contactos} contactos?`)) return;
        const r = await eliminarLista(lista.id);
        if (r.success) router.refresh();
        else toast.error(r.error);
    };

    return (
        <Tarjeta
            titulo={
                editando ? (
                    <input className={campo} value={nombre} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre de la lista" />
                ) : (
                    <button type="button" onClick={onAbrir} className="text-left hover:text-teal-700">
                        {lista.nombre}
                    </button>
                )
            }
            subtitulo={
                editando ? (
                    <input className={`${campo} mt-2`} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Descripción" aria-label="Descripción" />
                ) : (
                    `${numero(lista.contactos)} contacto(s) · ${lista.origen === 'PACIENTES' ? 'pacientes de la clínica' : lista.origen === 'MIXTA' ? 'archivo y pacientes' : 'importada'} · creada el ${formatDateShort(lista.creada)} · usada en ${lista.envios} envío(s)`
                )
            }
            acciones={
                <div className="flex flex-wrap gap-1">
                    {editando ? (
                        <Boton variante="primario" onClick={renombrar}>Guardar</Boton>
                    ) : (
                        <>
                            <Boton variante="suave" onClick={onAgregar}><UserPlus className="h-4 w-4" /> Agregar</Boton>
                            <Boton variante="suave" onClick={() => setEditando(true)} aria-label="Renombrar"><Pencil className="h-4 w-4" /></Boton>
                            <Boton variante="suave" onClick={borrar} aria-label="Eliminar lista"><Trash2 className="h-4 w-4" /></Boton>
                        </>
                    )}
                </div>
            }
        >
            {abierta ? (
                <div className="space-y-3">
                    <p className="text-xs text-zinc-500">Autorización declarada: «{lista.consentimiento}»</p>
                    <input className={campo} placeholder="Buscar por nombre, celular, correo o documento" value={buscar} onChange={(e) => { setBuscar(e.target.value); setPagina(1); }} />
                    <table className="w-full text-sm">
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {contactos.map((c) => (
                                <tr key={c.id}>
                                    <td className="py-1.5 pr-2">{c.nombre ?? <span className="text-zinc-400">sin nombre</span>}{c.esPaciente && <span className="ml-1 rounded bg-teal-50 px-1 text-[10px] text-teal-700">paciente</span>}</td>
                                    <td className="py-1.5 pr-2 font-mono text-xs">{c.celular}</td>
                                    <td className="py-1.5 pr-2 text-xs text-zinc-500">{c.correo ?? ''}</td>
                                    <td className="py-1.5 text-right">
                                        <Boton variante="suave" className="px-2 py-1" onClick={() => quitar(c)} aria-label="Quitar de la lista"><UserMinus className="h-4 w-4" /></Boton>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span>{numero(total)} contacto(s)</span>
                        <span className="flex gap-1">
                            <Boton className="px-2 py-1 text-xs" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Boton>
                            <Boton className="px-2 py-1 text-xs" disabled={pagina * 50 >= total} onClick={() => setPagina((p) => p + 1)}>Siguiente</Boton>
                        </span>
                    </div>
                </div>
            ) : (
                <Boton variante="suave" onClick={onAbrir}>Ver contactos</Boton>
            )}
        </Tarjeta>
    );
}

// ─── Bajas ──────────────────────────────────────────────────────────────────

export function PanelBajas() {
    const [bajas, setBajas] = useState<BajaDto[] | null>(null);
    const [total, setTotal] = useState(0);
    const [telefono, setTelefono] = useState('');
    const [nota, setNota] = useState('');
    const cargar = () =>
        listarBajas().then((r) => {
            if (r.success) {
                setBajas(r.bajas);
                setTotal(r.total);
            }
        });
    useEffect(() => {
        void cargar();
    }, []);
    const agregar = async () => {
        const r = await registrarBaja(telefono, nota);
        if (!r.success) return toast.error(r.error);
        setTelefono('');
        setNota('');
        void cargar();
    };
    const quitar = async (b: BajaDto) => {
        if (!confirm(`¿Quitar la baja de ${b.destino}? Volverá a recibir comunicados. Hágalo solo si la persona lo pidió.`)) return;
        const r = await quitarBaja(b.id);
        if (r.success) void cargar();
        else toast.error(r.error);
    };
    return (
        <div className="space-y-5">
            <Aviso nivel="INFO">
                Quien responde «NO MÁS COMUNICADOS» (o «stop») por WhatsApp queda aquí solo y no vuelve a recibir mensajes masivos de la clínica.
                Sus recordatorios de citas no cambian. Para volver, la persona escribe «activar comunicados».
            </Aviso>
            <Tarjeta titulo="Registrar una baja" subtitulo="Cuando la persona lo pide por otro medio (llamó, lo dijo en ventanilla).">
                <div className="flex flex-wrap gap-2">
                    <input className={`${campo} w-48`} placeholder="Celular" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
                    <input className={`${campo} min-w-[200px] flex-1`} placeholder="Nota (opcional): cómo lo pidió" value={nota} onChange={(e) => setNota(e.target.value)} />
                    <Boton variante="primario" disabled={!telefono.trim()} onClick={agregar}>Registrar baja</Boton>
                </div>
            </Tarjeta>
            <Tarjeta titulo={`Bajas (${numero(total)})`}>
                {!bajas ? (
                    <p className="text-sm text-zinc-500">Cargando…</p>
                ) : !bajas.length ? (
                    <p className="text-sm text-zinc-500">Nadie ha pedido la baja.</p>
                ) : (
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {bajas.map((b) => (
                            <li key={b.id} className="flex items-center gap-3 py-2 text-sm">
                                <span className="font-mono">{b.destino}</span>
                                <span className="text-xs text-zinc-500">
                                    {b.fuente === 'CHAT' ? 'la pidió por WhatsApp' : 'registrada en el panel'} · {formatDateShort(b.fecha)}
                                    {b.nota ? ` · ${b.nota}` : ''}
                                </span>
                                <Boton variante="suave" className="ml-auto px-2 py-1 text-xs" onClick={() => quitar(b)}>Quitar</Boton>
                            </li>
                        ))}
                    </ul>
                )}
            </Tarjeta>
        </div>
    );
}
