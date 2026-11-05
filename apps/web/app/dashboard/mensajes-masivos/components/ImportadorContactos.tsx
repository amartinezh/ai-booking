'use client';

import { useMemo, useRef, useState } from 'react';
import { FileUp, ClipboardPaste, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
    TIPOS_DE_COLUMNA,
    analizarArchivoDeContactos,
    extraerContactos,
    muestraParaIa,
    type AnalisisContactos,
    type TipoColumna,
} from '@agenia/shared';
import { leerArchivoDeContactos } from '@/lib/mensajes-masivos/leer-archivo';
import { guardarListaDeContactos, pedirMapeoIa } from '@/app/actions/mensajes-masivos';
import { Aviso, Boton, Tarjeta, campo, numero } from './ui';

const FORMATO: Record<AnalisisContactos['formato'], string> = {
    TABLA: 'una tabla',
    VCARD: 'contactos de un celular (vCard)',
    TEXTO_LIBRE: 'un listado de texto (una persona por línea)',
};
const SEPARADOR: Record<string, string> = { ',': 'coma', ';': 'punto y coma', '\t': 'tabulador', '|': 'barra' };

/**
 * Importar contactos de «lo que sea» (docs/PLAN_MENSAJES_MASIVOS.md §4): lee el
 * archivo o el texto pegado en el navegador, propone qué es cada columna con su
 * razón, deja corregirlo (o pedírselo a la IA con 5 filas tapadas) y muestra el
 * resultado antes de guardar. Con `listaExistente`, agrega a esa lista.
 */
export default function ImportadorContactos({
    listaExistente,
    iaDisponible,
    onGuardada,
}: {
    listaExistente?: { id: string; nombre: string } | null;
    iaDisponible: boolean;
    onGuardada: (lista: { id: string; nombre: string; contactos: number }) => void;
}) {
    const [modo, setModo] = useState<'archivo' | 'pegar'>('archivo');
    const [pegado, setPegado] = useState('');
    const [archivo, setArchivo] = useState<string | null>(null);
    const [analisis, setAnalisis] = useState<AnalisisContactos | null>(null);
    const [mapeo, setMapeo] = useState<TipoColumna[]>([]);
    const [leyendo, setLeyendo] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ia, setIa] = useState<{ cargando: boolean; modelo?: string; error?: string }>({ cargando: false });
    const [nombre, setNombre] = useState('');
    const [descripcion, setDescripcion] = useState('');
    const [consentimiento, setConsentimiento] = useState('');
    const [declara, setDeclara] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [verProblemas, setVerProblemas] = useState(false);
    const entrada = useRef<HTMLInputElement>(null);

    const resultado = useMemo(() => (analisis ? extraerContactos(analisis, mapeo) : null), [analisis, mapeo]);
    const sinCelular = !!analisis && !mapeo.includes('CELULAR');

    const interpretar = (texto: string, nombreArchivo: string | null) => {
        const a = analizarArchivoDeContactos(texto);
        if (!a.filas.length) {
            setError('No se encontró ninguna fila con datos.');
            setAnalisis(null);
            return;
        }
        setError(null);
        setAnalisis(a);
        setMapeo(a.columnas.map((c) => c.tipo));
        setIa({ cargando: false });
        setArchivo(nombreArchivo);
        if (!nombre && nombreArchivo) setNombre(nombreArchivo.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80));
    };

    const elegirArchivo = async (file: File | undefined) => {
        if (!file) return;
        setLeyendo(true);
        const r = await leerArchivoDeContactos(file);
        setLeyendo(false);
        if (!r.ok) {
            setError(r.error);
            setAnalisis(null);
            return;
        }
        interpretar(r.texto, file.name);
    };

    const pedirIa = async () => {
        if (!analisis) return;
        setIa({ cargando: true });
        const r = await pedirMapeoIa(muestraParaIa(analisis));
        if (!r.success) return setIa({ cargando: false, error: r.error });
        if (!r.resultado.disponible) return setIa({ cargando: false, error: r.resultado.motivo });
        setMapeo(r.resultado.mapeo);
        setIa({ cargando: false, modelo: r.resultado.modelo });
        toast.success('La IA propuso qué es cada columna. Revíselo antes de guardar.');
    };

    const guardar = async () => {
        if (!resultado?.contactos.length) return;
        setGuardando(true);
        const r = await guardarListaDeContactos({
            listaId: listaExistente?.id,
            nombre,
            descripcion,
            consentimiento,
            contactos: resultado.contactos.map((c) => ({
                nombreCompleto: c.nombreCompleto,
                primerNombre: c.primerNombre,
                celular: c.celular,
                correo: c.correo,
                documento: c.documento,
                extras: c.extras,
            })),
        });
        setGuardando(false);
        if (!r.success) return toast.error(r.error);
        toast.success(
            `${numero(r.agregados)} contacto(s) guardados${r.repetidos ? `; ${numero(r.repetidos)} ya estaban en la lista` : ''}.`,
        );
        onGuardada({ id: r.listaId, nombre: listaExistente?.nombre ?? nombre, contactos: r.agregados + r.repetidos });
    };

    const puedeGuardar =
        !!resultado?.contactos.length && !sinCelular && (listaExistente ? true : nombre.trim().length > 0 && consentimiento.trim().length >= 15 && declara);

    return (
        <div className="space-y-5">
            {/* 1. De dónde */}
            <div className="flex flex-wrap gap-2">
                <Boton variante={modo === 'archivo' ? 'primario' : 'secundario'} onClick={() => setModo('archivo')}>
                    <FileUp className="h-4 w-4" /> Subir archivo
                </Boton>
                <Boton variante={modo === 'pegar' ? 'primario' : 'secundario'} onClick={() => setModo('pegar')}>
                    <ClipboardPaste className="h-4 w-4" /> Pegar texto
                </Boton>
            </div>
            {modo === 'archivo' ? (
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => entrada.current?.click()}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && entrada.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                        e.preventDefault();
                        void elegirArchivo(e.dataTransfer.files?.[0]);
                    }}
                    className="cursor-pointer rounded-2xl border-2 border-dashed border-zinc-300 p-8 text-center hover:border-teal-500 hover:bg-teal-50/40 dark:border-zinc-700 dark:hover:bg-teal-900/10"
                >
                    <FileUp className="mx-auto h-8 w-8 text-zinc-400" />
                    <p className="mt-2 font-semibold text-zinc-800 dark:text-zinc-100">
                        {leyendo ? 'Leyendo…' : archivo ? `Archivo: ${archivo}` : 'Arrastre el archivo o haga clic para elegirlo'}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                        Excel, CSV, TXT o contactos del celular (.vcf). Con o sin encabezados, en cualquier orden: el sistema reconoce
                        los nombres, celulares, correos y documentos.
                    </p>
                    <input
                        ref={entrada}
                        type="file"
                        className="hidden"
                        accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,.vcf,text/*"
                        onChange={(e) => {
                            void elegirArchivo(e.target.files?.[0]);
                            e.target.value = '';
                        }}
                    />
                </div>
            ) : (
                <div className="space-y-2">
                    <textarea
                        className={`${campo} min-h-[140px] font-mono`}
                        placeholder={'Pegue aquí la lista, como venga. Por ejemplo:\nAna Pérez 300 123 4567 ana@correo.com\nLuis Gómez, 3109876543'}
                        value={pegado}
                        onChange={(e) => setPegado(e.target.value)}
                    />
                    <Boton variante="primario" disabled={!pegado.trim()} onClick={() => interpretar(pegado, null)}>
                        Leer la lista
                    </Boton>
                </div>
            )}
            {error && <Aviso nivel="ERROR">{error}</Aviso>}

            {analisis && resultado && (
                <>
                    {/* 2. Qué es cada columna */}
                    <Tarjeta
                        titulo="Qué encontró en el archivo"
                        subtitulo={`Leyó ${FORMATO[analisis.formato]}${analisis.separador ? ` separada por ${SEPARADOR[analisis.separador] ?? analisis.separador}` : ''}, ${numero(analisis.filas.length)} fila(s)${analisis.tieneEncabezado ? ' con encabezados' : ' sin encabezados'}. Corrija cualquier columna si no es lo que dice.`}
                        acciones={
                            iaDisponible && (
                                <Boton onClick={pedirIa} disabled={ia.cargando}>
                                    <Sparkles className="h-4 w-4" /> {ia.cargando ? 'Consultando…' : 'Pedir ayuda a la IA'}
                                </Boton>
                            )
                        }
                    >
                        {analisis.confianza !== 'ALTA' && (
                            <div className="mb-3">
                                <Aviso nivel={analisis.confianza === 'BAJA' ? 'AVISO' : 'INFO'}>
                                    {analisis.confianza === 'BAJA'
                                        ? 'No está claro qué es cada columna. Revísela abajo'
                                        : 'Algunas columnas no se reconocen con seguridad. Revíselas'}
                                    {iaDisponible ? ' o pida ayuda a la IA (solo ve los encabezados y 5 filas con los números y correos tapados).' : '.'}
                                </Aviso>
                            </div>
                        )}
                        {ia.modelo && <p className="mb-2 text-xs text-teal-700 dark:text-teal-300">✨ Columnas propuestas por la IA ({ia.modelo}).</p>}
                        {ia.error && <div className="mb-3"><Aviso nivel="AVISO">{ia.error}</Aviso></div>}
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="text-left text-xs uppercase text-zinc-500">
                                    <tr>
                                        <th className="py-2 pr-3">Columna</th>
                                        <th className="py-2 pr-3">Ejemplos</th>
                                        <th className="py-2 pr-3">Es…</th>
                                        <th className="py-2">Por qué</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {analisis.columnas.map((c, i) => (
                                        <tr key={c.indice}>
                                            <td className="py-2 pr-3 font-medium text-zinc-800 dark:text-zinc-100">{c.encabezado}</td>
                                            <td className="max-w-[220px] py-2 pr-3 text-xs text-zinc-500">{c.muestra.join(' · ') || '—'}</td>
                                            <td className="py-2 pr-3">
                                                <select
                                                    aria-label={`Tipo de la columna ${c.encabezado}`}
                                                    className={`${campo} py-1.5`}
                                                    value={mapeo[i]}
                                                    onChange={(e) => setMapeo((m) => m.map((t, k) => (k === i ? (e.target.value as TipoColumna) : t)))}
                                                >
                                                    {TIPOS_DE_COLUMNA.map((t) => (
                                                        <option key={t.tipo} value={t.tipo}>
                                                            {t.etiqueta}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="py-2 text-xs text-zinc-500">
                                                <span className="mr-1 inline-block h-1.5 w-10 overflow-hidden rounded bg-zinc-200 align-middle dark:bg-zinc-700">
                                                    <span className="block h-full bg-teal-500" style={{ width: `${Math.round(c.confianza * 100)}%` }} />
                                                </span>
                                                {c.motivo}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {sinCelular && <div className="mt-3"><Aviso nivel="ERROR">Elija cuál columna es el celular: sin celular no hay a quién escribirle.</Aviso></div>}
                    </Tarjeta>

                    {/* 3. El resultado */}
                    <Tarjeta titulo="Resultado" subtitulo="Así quedarían los contactos. Lo descartado no se guarda.">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Cifra valor={resultado.resumen.validos} titulo="Listos para recibir" resaltar />
                            <Cifra valor={resultado.resumen.duplicados} titulo="Celulares repetidos" />
                            <Cifra valor={resultado.resumen.fijos + resultado.resumen.celularInvalido} titulo="Fijos o inválidos" />
                            <Cifra valor={resultado.resumen.sinCelular} titulo="Sin celular" />
                        </div>
                        {resultado.contactos.length > 0 && (
                            <div className="mt-4 overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-left text-xs uppercase text-zinc-500">
                                        <tr>
                                            <th className="py-1.5 pr-3">Nombre</th>
                                            <th className="py-1.5 pr-3">Saludo</th>
                                            <th className="py-1.5 pr-3">Celular</th>
                                            <th className="py-1.5">Correo</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                        {resultado.contactos.slice(0, 8).map((c) => (
                                            <tr key={c.celular}>
                                                <td className="py-1.5 pr-3">{c.nombreCompleto ?? <span className="text-zinc-400">sin nombre</span>}</td>
                                                <td className="py-1.5 pr-3 text-zinc-500">Hola {c.primerNombre ?? 'paciente'}</td>
                                                <td className="py-1.5 pr-3 font-mono text-xs">{c.celular}</td>
                                                <td className="py-1.5 text-xs text-zinc-500">{c.correo ?? '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {resultado.contactos.length > 8 && <p className="mt-1 text-xs text-zinc-400">… y {numero(resultado.contactos.length - 8)} más.</p>}
                            </div>
                        )}
                        {resultado.problemas.length > 0 && (
                            <div className="mt-4">
                                <Boton variante="suave" onClick={() => setVerProblemas((v) => !v)}>
                                    {verProblemas ? 'Ocultar' : 'Ver'} las {numero(resultado.problemas.length)} fila(s) con observaciones
                                </Boton>
                                {verProblemas && (
                                    <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto text-xs">
                                        {resultado.problemas.slice(0, 200).map((p, i) => (
                                            <li key={i} className={p.descarta ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}>
                                                Fila {p.fila}: {p.mensaje} {p.descarta ? '(no se guarda)' : ''}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </Tarjeta>

                    {/* 4. Guardar */}
                    <Tarjeta titulo={listaExistente ? `Agregar a «${listaExistente.nombre}»` : 'Guardar como lista'}>
                        {!listaExistente && (
                            <div className="grid gap-3 md:grid-cols-2">
                                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                                    Nombre de la lista
                                    <input className={`${campo} mt-1`} value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Pacientes crónicos sede norte" />
                                </label>
                                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                                    Descripción (opcional)
                                    <input className={`${campo} mt-1`} value={descripcion} maxLength={300} onChange={(e) => setDescripcion(e.target.value)} />
                                </label>
                                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200 md:col-span-2">
                                    ¿De dónde salen estos contactos y cómo autorizaron a la clínica a escribirles?
                                    <textarea
                                        className={`${campo} mt-1 min-h-[70px]`}
                                        value={consentimiento}
                                        maxLength={2000}
                                        onChange={(e) => setConsentimiento(e.target.value)}
                                        placeholder="Ej.: Pacientes que firmaron el formato de tratamiento de datos de la clínica, que incluye el envío de comunicados por WhatsApp."
                                    />
                                </label>
                                <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-200 md:col-span-2">
                                    <input type="checkbox" className="mt-1" checked={declara} onChange={(e) => setDeclara(e.target.checked)} />
                                    Declaro que estas personas autorizaron a la clínica a contactarlas por WhatsApp (Ley 1581 de 2012). Esta
                                    declaración queda guardada con mi usuario.
                                </label>
                            </div>
                        )}
                        <div className="mt-4 flex items-center gap-3">
                            <Boton variante="primario" disabled={!puedeGuardar || guardando} onClick={guardar}>
                                <Users className="h-4 w-4" />
                                {guardando ? 'Guardando…' : `Guardar ${numero(resultado.contactos.length)} contacto(s)`}
                            </Boton>
                            <span className="text-xs text-zinc-500">Se guardan para volver a usarlos en otros envíos.</span>
                        </div>
                    </Tarjeta>
                </>
            )}
        </div>
    );
}

function Cifra({ valor, titulo, resaltar = false }: { valor: number; titulo: string; resaltar?: boolean }) {
    return (
        <div className={`rounded-xl border p-3 ${resaltar ? 'border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950/30' : 'border-zinc-200 dark:border-zinc-800'}`}>
            <p className="text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-white">{numero(valor)}</p>
            <p className="text-xs text-zinc-500">{titulo}</p>
        </div>
    );
}
