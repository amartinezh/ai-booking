'use client';

import Link from 'next/link';
import { createContext, useContext, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, ExternalLink, Lightbulb, Search, X } from 'lucide-react';
import type { CategoriaAyuda, ContenidoAyuda, TemaAyuda } from '@/lib/ayuda/tipos';
import {
    GLOSARIO_ID,
    anclaDe,
    buscar,
    crearIndice,
    resaltar,
    sugerir,
    type ResultadoBusqueda,
    type Segmento,
    type TipoFragmento,
} from '@/lib/ayuda/buscador';

// ─────────────────────────────────────────────────────────────
// CENTRO DE AYUDA — inicio, guía de cada opción, glosario y buscador.
//
// El texto no vive aquí: llega en `contenido`, que la página lee de
// docs/conocimiento/AGENIA.md en el servidor. Este componente solo lo muestra.
//
// Todo corre en el navegador: el índice se arma una vez al abrir la página
// (unos milisegundos) y cada búsqueda es local, sin red ni IA. El tema abierto
// y la búsqueda quedan en la dirección (?tema=…&q=…) para poder compartirla.
// ─────────────────────────────────────────────────────────────

const ETIQUETA_TIPO: Record<TipoFragmento, string> = {
    resumen: 'Resumen',
    guia: 'Paso a paso',
    elemento: 'En pantalla',
    pregunta: 'Pregunta frecuente',
    problema: 'Si algo falla',
    glosario: 'Glosario',
};

/** La categoría y el tema que el inicio destaca arriba, en vez de en la cuadrícula. */
const CATEGORIA_DE_INICIO = 'inicio';
const TEMA_DE_BIENVENIDA = 'primeros-pasos';

const TARJETA = 'rounded-2xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800';
const DESTELLO = 'ring-2 ring-blue-400 dark:ring-blue-500';

// ── El contenido, con sus índices, para todos los componentes ──

interface Biblioteca extends ContenidoAyuda {
    temaPorId: Map<string, TemaAyuda>;
    categoriaPorId: Map<string, CategoriaAyuda>;
    /** Orden de lectura para «anterior / siguiente»: el de las categorías. */
    temasEnOrden: TemaAyuda[];
}

function armarBiblioteca(contenido: ContenidoAyuda): Biblioteca {
    return {
        ...contenido,
        temaPorId: new Map(contenido.temas.map((t) => [t.id, t])),
        categoriaPorId: new Map(contenido.categorias.map((c) => [c.id, c])),
        temasEnOrden: contenido.categorias.flatMap((c) => contenido.temas.filter((t) => t.categoria === c.id)),
    };
}

const BibliotecaContext = createContext<Biblioteca | null>(null);

function useBiblioteca(): Biblioteca {
    const biblioteca = useContext(BibliotecaContext);
    if (!biblioteca) throw new Error('useBiblioteca fuera de AyudaClient');
    return biblioteca;
}

function temaValido(id: string | null, temaPorId: Map<string, TemaAyuda>): string | null {
    return id && (id === GLOSARIO_ID || temaPorId.has(id)) ? id : null;
}

// ── Resaltado de las palabras buscadas dentro de un tema ──

const ResaltadoContext = createContext<Set<string>>(new Set());

function Marcas({ segmentos }: { segmentos: Segmento[] }) {
    return (
        <>
            {segmentos.map((s, i) =>
                s.marcado ? (
                    <mark key={i} className="rounded bg-amber-200/80 px-0.5 text-inherit dark:bg-amber-500/30">
                        {s.texto}
                    </mark>
                ) : (
                    <span key={i}>{s.texto}</span>
                ),
            )}
        </>
    );
}

/** Texto de un tema con las palabras de la última búsqueda resaltadas. */
function T({ children }: { children: string }) {
    const terminos = useContext(ResaltadoContext);
    if (terminos.size === 0) return <>{children}</>;
    return <Marcas segmentos={resaltar(children, terminos)} />;
}

// ── Componente principal ──

export default function AyudaClient({
    contenido,
    ...props
}: {
    contenido: ContenidoAyuda;
    temaInicial: string | null;
    consultaInicial: string;
    rutasDisponibles: string[];
}) {
    const biblioteca = useMemo(() => armarBiblioteca(contenido), [contenido]);
    return (
        <BibliotecaContext.Provider value={biblioteca}>
            <CentroDeAyuda {...props} />
        </BibliotecaContext.Provider>
    );
}

function CentroDeAyuda({
    temaInicial,
    consultaInicial,
    rutasDisponibles,
}: {
    temaInicial: string | null;
    consultaInicial: string;
    rutasDisponibles: string[];
}) {
    const biblioteca = useBiblioteca();
    const { portada } = biblioteca;
    const indice = useMemo(() => crearIndice(biblioteca.temas, biblioteca.glosario), [biblioteca]);
    const [consulta, setConsulta] = useState(consultaInicial);
    const [temaId, setTemaId] = useState<string | null>(temaValido(temaInicial, biblioteca.temaPorId));
    const [ancla, setAncla] = useState<string | null>(null);
    /** Cuenta cada salto: pulsar dos veces la misma sección también debe desplazar. */
    const [salto, setSalto] = useState(0);
    const [resaltado, setResaltado] = useState<string[]>([]);
    const [activo, setActivo] = useState(0);
    const entradaRef = useRef<HTMLInputElement>(null);
    const inicioRef = useRef<HTMLDivElement>(null);
    const idEntrada = useId();

    const consultaDiferida = useDeferredValue(consulta);
    const respuesta = useMemo(() => buscar(indice, consultaDiferida), [indice, consultaDiferida]);
    const buscando = consulta.trim().length > 0;
    const sugerencia = useMemo(
        () => (consultaDiferida.trim() && respuesta.resultados.length === 0 ? sugerir(indice, consultaDiferida) : null),
        [indice, consultaDiferida, respuesta],
    );
    const terminosResaltados = useMemo(() => new Set(resaltado), [resaltado]);
    const disponibles = useMemo(() => new Set(rutasDisponibles), [rutasDisponibles]);

    // La dirección refleja lo que se ve, para poder compartirlo o volver con «atrás».
    useEffect(() => {
        const params = new URLSearchParams();
        if (temaId) params.set('tema', temaId);
        if (consulta.trim()) params.set('q', consulta.trim());
        const qs = params.toString();
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }, [temaId, consulta]);

    // «/» o Ctrl/⌘+K llevan al buscador desde cualquier parte de la página.
    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => {
            const destino = e.target as HTMLElement | null;
            const escribiendo = destino?.closest('input, textarea, select, [contenteditable="true"]');
            if ((e.key === '/' && !escribiendo) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
                e.preventDefault();
                entradaRef.current?.focus();
                entradaRef.current?.select();
            }
        };
        window.addEventListener('keydown', alTeclear);
        return () => window.removeEventListener('keydown', alTeclear);
    }, []);

    // Al abrir un tema o una sección, llevarla a la vista (y abrirla si es plegable).
    useEffect(() => {
        if (buscando) return;
        const cuadro = requestAnimationFrame(() => {
            const destino = ancla ? document.getElementById(ancla) : inicioRef.current;
            if (!destino) return;
            if (destino instanceof HTMLDetailsElement) destino.open = true;
            destino.scrollIntoView?.({ behavior: ancla ? 'smooth' : 'auto', block: 'start' });
        });
        return () => cancelAnimationFrame(cuadro);
    }, [temaId, ancla, salto, buscando]);

    const irA = (seccion: string | null) => {
        setAncla(seccion);
        setSalto((n) => n + 1);
    };

    const abrirTema = (id: string | null, seccion: string | null = null) => {
        setTemaId(id);
        irA(seccion);
        setResaltado([]);
        setConsulta('');
    };

    const abrirResultado = (r: ResultadoBusqueda) => {
        setTemaId(r.fragmento.temaId);
        irA(r.fragmento.id);
        setResaltado(respuesta.terminos);
        setConsulta('');
    };

    const alTeclearEnBuscador = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const total = respuesta.resultados.length;
        if (e.key === 'ArrowDown' && total) {
            e.preventDefault();
            setActivo((a) => (a + 1) % total);
        } else if (e.key === 'ArrowUp' && total) {
            e.preventDefault();
            setActivo((a) => (a - 1 + total) % total);
        } else if (e.key === 'Enter' && total) {
            e.preventDefault();
            abrirResultado(respuesta.resultados[Math.min(activo, total - 1)]);
        } else if (e.key === 'Escape') {
            setConsulta('');
        }
    };

    const tema = temaId && temaId !== GLOSARIO_ID ? biblioteca.temaPorId.get(temaId) : undefined;
    const activoSeguro = Math.min(activo, Math.max(respuesta.resultados.length - 1, 0));

    return (
        <div ref={inicioRef} className="space-y-6 scroll-mt-6">
            <header className="flex flex-col gap-3">
                <Link
                    href="/dashboard/soporte"
                    className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-400"
                >
                    <ArrowLeft className="h-4 w-4" /> Volver a Soporte
                </Link>
                <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                        <BookOpen className="h-6 w-6" />
                    </span>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Centro de ayuda</h1>
                        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">{portada.presentacion}</p>
                    </div>
                </div>
            </header>

            {/* ── Buscador ── */}
            <div className="space-y-3">
                <div className="relative">
                    <label htmlFor={idEntrada} className="sr-only">
                        Buscar en la ayuda
                    </label>
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
                    <input
                        ref={entradaRef}
                        id={idEntrada}
                        type="search"
                        role="combobox"
                        aria-expanded={buscando}
                        aria-controls="ayuda-resultados"
                        aria-autocomplete="list"
                        aria-activedescendant={buscando && respuesta.resultados.length ? `ayuda-resultado-${activoSeguro}` : undefined}
                        autoComplete="off"
                        spellCheck={false}
                        value={consulta}
                        onChange={(e) => {
                            setConsulta(e.target.value);
                            setActivo(0);
                        }}
                        onKeyDown={alTeclearEnBuscador}
                        placeholder="¿Qué necesitas? Ej.: abrir cupos"
                        className="w-full rounded-2xl border border-zinc-200 bg-white py-4 pl-12 pr-12 sm:pr-24 text-base text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white [&::-webkit-search-cancel-button]:hidden"
                    />
                    <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                        {consulta ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setConsulta('');
                                    entradaRef.current?.focus();
                                }}
                                aria-label="Borrar la búsqueda"
                                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        ) : (
                            <kbd className="hidden rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-xs text-zinc-500 sm:block dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                                /
                            </kbd>
                        )}
                    </div>
                </div>
                {!buscando && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Búsquedas frecuentes:</span>
                        {portada.busquedasFrecuentes.map((b) => (
                            <button
                                key={b}
                                type="button"
                                onClick={() => {
                                    setConsulta(b);
                                    setActivo(0);
                                    entradaRef.current?.focus();
                                }}
                                className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-blue-300 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-blue-700 dark:hover:text-blue-300"
                            >
                                {b}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {buscando ? (
                <Resultados
                    consulta={consulta}
                    resultados={respuesta.resultados}
                    activo={activoSeguro}
                    sugerencia={sugerencia}
                    onActivar={setActivo}
                    onAbrir={abrirResultado}
                    onSugerencia={(s) => {
                        setConsulta(s);
                        setActivo(0);
                    }}
                />
            ) : (
                <ResaltadoContext.Provider value={terminosResaltados}>
                    {resaltado.length > 0 && temaId && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                            <span>Las palabras de tu búsqueda aparecen resaltadas.</span>
                            <button type="button" onClick={() => setResaltado([])} className="font-semibold underline-offset-2 hover:underline">
                                Quitar resaltado
                            </button>
                        </div>
                    )}
                    {temaId === GLOSARIO_ID ? (
                        <GlosarioVista ancla={ancla} onInicio={() => abrirTema(null)} onAbrirTema={abrirTema} />
                    ) : tema ? (
                        <TemaVista
                            tema={tema}
                            ancla={ancla}
                            disponible={!tema.href || disponibles.has(tema.href)}
                            onInicio={() => abrirTema(null)}
                            onAbrirTema={abrirTema}
                            onIrA={irA}
                        />
                    ) : (
                        <Inicio disponibles={disponibles} onAbrirTema={abrirTema} />
                    )}
                </ResaltadoContext.Provider>
            )}
        </div>
    );
}

// ── Resultados de la búsqueda ──

function Resultados({
    consulta,
    resultados,
    activo,
    sugerencia,
    onActivar,
    onAbrir,
    onSugerencia,
}: {
    consulta: string;
    resultados: ResultadoBusqueda[];
    activo: number;
    sugerencia: string | null;
    onActivar: (i: number) => void;
    onAbrir: (r: ResultadoBusqueda) => void;
    onSugerencia: (s: string) => void;
}) {
    const { temaPorId } = useBiblioteca();
    if (resultados.length === 0) {
        return (
            <section aria-label="Resultados de la búsqueda" className={`${TARJETA} p-8 text-center`}>
                <ul id="ayuda-resultados" role="listbox" aria-label="Resultados" className="hidden" />
                <div className="mb-2 text-3xl" aria-hidden>
                    🔍
                </div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white">No encontramos nada para «{consulta.trim()}»</h2>
                {sugerencia && (
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                        ¿Quisiste decir{' '}
                        <button
                            type="button"
                            onClick={() => onSugerencia(sugerencia)}
                            className="font-semibold text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                        >
                            «{sugerencia}»
                        </button>
                        ?
                    </p>
                )}
                <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                    Prueba con otras palabras o con el nombre de la opción del menú. Si no está, cuéntaselo al equipo técnico.
                </p>
                <Link
                    href="/dashboard/soporte"
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                    Reportar Falla / Nueva Solicitud <ArrowRight className="h-4 w-4" />
                </Link>
            </section>
        );
    }

    return (
        <section aria-label="Resultados de la búsqueda" className="space-y-3">
            <p className="text-sm text-zinc-500 dark:text-zinc-400" aria-live="polite">
                {resultados.length} resultado{resultados.length === 1 ? '' : 's'} para «{consulta.trim()}»
                <span className="hidden sm:inline"> · ↑ ↓ para moverte, Enter para abrir</span>
            </p>
            <ul id="ayuda-resultados" role="listbox" aria-label="Resultados" className="space-y-2">
                {resultados.map((r, i) => {
                    const tema = temaPorId.get(r.fragmento.temaId);
                    const seleccionado = i === activo;
                    return (
                        <li
                            key={r.fragmento.id}
                            id={`ayuda-resultado-${i}`}
                            role="option"
                            aria-selected={seleccionado}
                            onMouseEnter={() => onActivar(i)}
                            onClick={() => onAbrir(r)}
                            className={`${TARJETA} cursor-pointer p-4 transition ${
                                seleccionado ? 'ring-2 ring-blue-500 dark:ring-blue-500' : 'hover:ring-zinc-300 dark:hover:ring-zinc-700'
                            }`}
                        >
                            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                <span aria-hidden>{tema?.icono ?? '📖'}</span>
                                <span className="font-medium">{tema?.titulo ?? 'Glosario'}</span>
                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                    {ETIQUETA_TIPO[r.fragmento.tipo]}
                                </span>
                            </div>
                            <p className="font-semibold text-zinc-900 dark:text-white">
                                <Marcas segmentos={r.titulo} />
                            </p>
                            <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                                <Marcas segmentos={r.extracto} />
                            </p>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

// ── Inicio ──

function Inicio({ disponibles, onAbrirTema }: { disponibles: Set<string>; onAbrirTema: (id: string) => void }) {
    const { temas, categorias, glosario, portada, temaPorId } = useBiblioteca();
    const opciones = temas.filter((t) => t.href);
    const guias = temas.reduce((n, t) => n + t.guias.length, 0);
    const preguntas = temas.reduce((n, t) => n + t.preguntas.length + t.problemas.length, 0);
    const primeros = temaPorId.get(TEMA_DE_BIENVENIDA);
    const masTerminos = glosario.length - portada.glosarioDestacado.length;

    return (
        <div className="space-y-8">
            {primeros && (
                <button
                    type="button"
                    onClick={() => onAbrirTema(primeros.id)}
                    className="group flex w-full flex-col gap-3 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-6 text-left text-white shadow-sm transition hover:shadow-lg sm:flex-row sm:items-center sm:justify-between"
                >
                    <span>
                        <span className="text-xs font-semibold uppercase tracking-wider text-blue-100">¿Eres nuevo?</span>
                        <span className="mt-1 block text-lg font-bold">
                            {primeros.icono} {primeros.titulo}
                        </span>
                        <span className="mt-1 block max-w-2xl text-sm text-blue-100">{primeros.resumen}</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold group-hover:bg-white/25">
                        Ver la guía <ArrowRight className="h-4 w-4" />
                    </span>
                </button>
            )}

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                    { n: opciones.length, t: 'opciones del menú explicadas' },
                    { n: guias, t: 'guías paso a paso' },
                    { n: preguntas, t: 'preguntas y soluciones' },
                    { n: glosario.length, t: 'términos en el glosario' },
                ].map((c) => (
                    <div key={c.t} className={`${TARJETA} p-4`}>
                        <dd className="text-2xl font-bold text-zinc-900 dark:text-white">{c.n}</dd>
                        <dt className="text-xs text-zinc-500 dark:text-zinc-400">{c.t}</dt>
                    </div>
                ))}
            </dl>

            {categorias.filter((c) => c.id !== CATEGORIA_DE_INICIO).map((c) => (
                <section key={c.id} aria-labelledby={`categoria-${c.id}`} className="space-y-3">
                    <div>
                        <h2 id={`categoria-${c.id}`} className="text-lg font-semibold text-zinc-900 dark:text-white">
                            {c.titulo}
                        </h2>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">{c.descripcion}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {temas.filter((t) => t.categoria === c.id).map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => onAbrirTema(t.id)}
                                className={`${TARJETA} group flex flex-col gap-2 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md hover:ring-blue-300 dark:hover:ring-blue-700`}
                            >
                                <span className="flex items-center gap-2">
                                    <span className="text-2xl" aria-hidden>
                                        {t.icono}
                                    </span>
                                    <span className="font-semibold text-zinc-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">
                                        {t.titulo}
                                    </span>
                                </span>
                                <span className="text-sm leading-snug text-zinc-500 dark:text-zinc-400">{t.resumen}</span>
                                {t.href && !disponibles.has(t.href) && <NoEnTuMenu />}
                            </button>
                        ))}
                    </div>
                </section>
            ))}

            <section aria-labelledby="categoria-glosario" className="space-y-3">
                <h2 id="categoria-glosario" className="text-lg font-semibold text-zinc-900 dark:text-white">
                    Glosario
                </h2>
                <button
                    type="button"
                    onClick={() => onAbrirTema(GLOSARIO_ID)}
                    className={`${TARJETA} flex w-full items-center justify-between gap-3 p-4 text-left transition hover:ring-blue-300 dark:hover:ring-blue-700`}
                >
                    <span>
                        <span className="font-semibold text-zinc-900 dark:text-white">📖 Qué significa cada término</span>
                        <span className="mt-0.5 block text-sm text-zinc-500 dark:text-zinc-400">
                            {portada.glosarioDestacado.join(', ')}
                            {masTerminos > 0 ? ` y ${masTerminos} término${masTerminos === 1 ? '' : 's'} más.` : '.'}
                        </span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
                </button>
            </section>
        </div>
    );
}

function NoEnTuMenu() {
    return (
        <span className="w-fit rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            No está en el menú de tu clínica
        </span>
    );
}

// ── Guía de un tema ──

function Seccion({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
    return (
        <section id={id} aria-labelledby={`${id}-titulo`} className="scroll-mt-6 space-y-3">
            <h3 id={`${id}-titulo`} className="text-lg font-semibold text-zinc-900 dark:text-white">
                {titulo}
            </h3>
            {children}
        </section>
    );
}

function TemaVista({
    tema,
    ancla,
    disponible,
    onInicio,
    onAbrirTema,
    onIrA,
}: {
    tema: TemaAyuda;
    ancla: string | null;
    disponible: boolean;
    onInicio: () => void;
    onAbrirTema: (id: string, seccion?: string | null) => void;
    onIrA: (seccion: string) => void;
}) {
    const { categoriaPorId, temaPorId, temasEnOrden } = useBiblioteca();
    const categoria = categoriaPorId.get(tema.categoria);
    const posicion = temasEnOrden.findIndex((t) => t.id === tema.id);
    const anterior = posicion > 0 ? temasEnOrden[posicion - 1] : undefined;
    const siguiente = posicion < temasEnOrden.length - 1 ? temasEnOrden[posicion + 1] : undefined;
    // Un enlace a un tema que no existe se omite (lo señalan las pruebas del .md).
    const relacionados = tema.relacionados.filter((id) => id === GLOSARIO_ID || temaPorId.has(id));
    const destello = (id: string) => (ancla === id ? DESTELLO : '');

    const indice = [
        { id: `${tema.id}--seccion-para-que`, titulo: '¿Para qué sirve?' },
        tema.guias.length > 0 && { id: `${tema.id}--seccion-pasos`, titulo: 'Paso a paso' },
        tema.elementos.length > 0 && { id: `${tema.id}--seccion-pantalla`, titulo: 'Qué ves en la pantalla' },
        tema.preguntas.length > 0 && { id: `${tema.id}--seccion-preguntas`, titulo: 'Preguntas frecuentes' },
        tema.problemas.length > 0 && { id: `${tema.id}--seccion-problemas`, titulo: 'Si algo no sale bien' },
    ].filter(Boolean) as { id: string; titulo: string }[];

    return (
        <article aria-labelledby={`${tema.id}-titulo`} className="space-y-6">
            <nav aria-label="Ruta" className="flex flex-wrap items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                <button type="button" onClick={onInicio} className="hover:text-blue-600 dark:hover:text-blue-400">
                    Centro de ayuda
                </button>
                <ChevronRight className="h-4 w-4" />
                <span>{categoria?.titulo}</span>
                <ChevronRight className="h-4 w-4" />
                <span className="font-medium text-zinc-700 dark:text-zinc-200">{tema.titulo}</span>
            </nav>

            <header id={anclaDe(tema.id, 'resumen')} className={`${TARJETA} scroll-mt-6 p-6 ${destello(anclaDe(tema.id, 'resumen'))}`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                        <span className="text-4xl" aria-hidden>
                            {tema.icono}
                        </span>
                        <div>
                            <h2 id={`${tema.id}-titulo`} className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                                {tema.titulo}
                            </h2>
                            <p className="mt-1 text-zinc-600 dark:text-zinc-300">
                                <T>{tema.resumen}</T>
                            </p>
                        </div>
                    </div>
                    {tema.href &&
                        (disponible ? (
                            <Link
                                href={tema.href}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                            >
                                Abrir {tema.titulo} <ExternalLink className="h-4 w-4" />
                            </Link>
                        ) : (
                            <NoEnTuMenu />
                        ))}
                </div>
                {tema.disponibilidad && (
                    <p className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
                        ℹ️ <T>{tema.disponibilidad}</T>
                    </p>
                )}
            </header>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
                <div className="min-w-0 space-y-8">
                    <Seccion id={`${tema.id}--seccion-para-que`} titulo="¿Para qué sirve?">
                        <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">
                            <T>{tema.paraQueSirve}</T>
                        </p>
                    </Seccion>

                    {tema.guias.length > 0 && (
                        <Seccion id={`${tema.id}--seccion-pasos`} titulo="Paso a paso">
                            <div className="space-y-4">
                                {tema.guias.map((g, i) => {
                                    const id = anclaDe(tema.id, 'guia', i);
                                    return (
                                        <div key={id} id={id} className={`${TARJETA} scroll-mt-6 p-5 ${destello(id)}`}>
                                            <h4 className="font-semibold text-zinc-900 dark:text-white">
                                                <T>{g.titulo}</T>
                                            </h4>
                                            <ol className="mt-3 space-y-2.5">
                                                {g.pasos.map((p, j) => (
                                                    <li key={j} className="flex gap-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                                                            {j + 1}
                                                        </span>
                                                        <span className="pt-0.5">
                                                            <T>{p}</T>
                                                        </span>
                                                    </li>
                                                ))}
                                            </ol>
                                            {g.nota && (
                                                <p className="mt-4 flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                                                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
                                                    <span>
                                                        <T>{g.nota}</T>
                                                    </span>
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </Seccion>
                    )}

                    {tema.elementos.length > 0 && (
                        <Seccion id={`${tema.id}--seccion-pantalla`} titulo="Qué ves en la pantalla">
                            <dl className={`${TARJETA} divide-y divide-zinc-100 dark:divide-zinc-800`}>
                                {tema.elementos.map((e, i) => {
                                    const id = anclaDe(tema.id, 'elemento', i);
                                    return (
                                        <div key={id} id={id} className={`scroll-mt-6 grid gap-1 p-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4 ${destello(id)}`}>
                                            <dt className="text-sm font-semibold text-zinc-900 dark:text-white">
                                                <T>{e.nombre}</T>
                                            </dt>
                                            <dd className="text-sm text-zinc-600 dark:text-zinc-300">
                                                <T>{e.explicacion}</T>
                                            </dd>
                                        </div>
                                    );
                                })}
                            </dl>
                        </Seccion>
                    )}

                    {tema.preguntas.length > 0 && (
                        <Seccion id={`${tema.id}--seccion-preguntas`} titulo="Preguntas frecuentes">
                            <div className="space-y-2">
                                {tema.preguntas.map((p, i) => {
                                    const id = anclaDe(tema.id, 'pregunta', i);
                                    return (
                                        <details key={id} id={id} className={`${TARJETA} group scroll-mt-6 ${destello(id)}`}>
                                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-medium text-zinc-900 dark:text-white [&::-webkit-details-marker]:hidden">
                                                {/* Envuelto: con resaltado, el texto son varios trozos y el flex los separaría. */}
                                                <span>
                                                    <T>{p.pregunta}</T>
                                                </span>
                                                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400 transition group-open:rotate-90" />
                                            </summary>
                                            <p className="px-4 pb-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                                                <T>{p.respuesta}</T>
                                            </p>
                                        </details>
                                    );
                                })}
                            </div>
                        </Seccion>
                    )}

                    {tema.problemas.length > 0 && (
                        <Seccion id={`${tema.id}--seccion-problemas`} titulo="Si algo no sale bien">
                            <div className="space-y-2">
                                {tema.problemas.map((p, i) => {
                                    const id = anclaDe(tema.id, 'problema', i);
                                    return (
                                        <div key={id} id={id} className={`${TARJETA} scroll-mt-6 p-4 ${destello(id)}`}>
                                            <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                                                ⚠️ <T>{p.sintoma}</T>
                                            </p>
                                            <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                                                <span className="font-medium text-emerald-700 dark:text-emerald-400">Qué hacer: </span>
                                                <T>{p.solucion}</T>
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </Seccion>
                    )}

                    {relacionados.length > 0 && (
                        <section aria-label="Temas relacionados" className="space-y-2">
                            <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Temas relacionados</h3>
                            <div className="flex flex-wrap gap-2">
                                {relacionados.map((id) => {
                                    const r = temaPorId.get(id);
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => onAbrirTema(id)}
                                            className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:border-blue-300 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-blue-700 dark:hover:text-blue-300"
                                        >
                                            {r ? `${r.icono} ${r.titulo}` : '📖 Glosario'}
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    <nav aria-label="Otras guías" className="grid grid-cols-1 gap-3 border-t border-zinc-200 pt-6 sm:grid-cols-2 dark:border-zinc-800">
                        {anterior ? (
                            <button type="button" onClick={() => onAbrirTema(anterior.id)} className={`${TARJETA} p-4 text-left hover:ring-blue-300 dark:hover:ring-blue-700`}>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400">← Anterior</span>
                                <span className="block font-medium text-zinc-900 dark:text-white">
                                    {anterior.icono} {anterior.titulo}
                                </span>
                            </button>
                        ) : (
                            <span />
                        )}
                        {siguiente && (
                            <button
                                type="button"
                                onClick={() => onAbrirTema(siguiente.id)}
                                className={`${TARJETA} p-4 text-right hover:ring-blue-300 dark:hover:ring-blue-700`}
                            >
                                <span className="text-xs text-zinc-500 dark:text-zinc-400">Siguiente →</span>
                                <span className="block font-medium text-zinc-900 dark:text-white">
                                    {siguiente.icono} {siguiente.titulo}
                                </span>
                            </button>
                        )}
                    </nav>

                    <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                        ¿No resolviste tu duda?{' '}
                        <Link href="/dashboard/soporte" className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
                            Repórtala en Soporte
                        </Link>{' '}
                        y el equipo técnico te responde.
                    </p>
                </div>

                <aside className="hidden lg:block">
                    <nav aria-label="En esta guía" className="sticky top-6 space-y-1">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">En esta guía</p>
                        {indice.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => onIrA(s.id)}
                                className="block w-full rounded-lg px-2 py-1 text-left text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                            >
                                {s.titulo}
                            </button>
                        ))}
                        {tema.guias.length > 1 && (
                            <div className="ml-2 border-l border-zinc-200 pl-2 dark:border-zinc-800">
                                {tema.guias.map((g, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => onIrA(anclaDe(tema.id, 'guia', i))}
                                        className="block w-full truncate rounded px-2 py-0.5 text-left text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-white"
                                        title={g.titulo}
                                    >
                                        {g.titulo}
                                    </button>
                                ))}
                            </div>
                        )}
                    </nav>
                </aside>
            </div>
        </article>
    );
}

// ── Glosario ──

function GlosarioVista({
    ancla,
    onInicio,
    onAbrirTema,
}: {
    ancla: string | null;
    onInicio: () => void;
    onAbrirTema: (id: string, seccion?: string | null) => void;
}) {
    const { glosario, temaPorId } = useBiblioteca();
    // El ancla usa la posición original del término: se ordena solo para mostrar.
    const terminos = glosario.map((g, i) => ({ ...g, id: anclaDe(GLOSARIO_ID, 'glosario', i) })).sort((a, b) =>
        a.termino.localeCompare(b.termino, 'es'),
    );

    return (
        <article aria-labelledby="glosario-titulo" className="space-y-6">
            <nav aria-label="Ruta" className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                <button type="button" onClick={onInicio} className="hover:text-blue-600 dark:hover:text-blue-400">
                    Centro de ayuda
                </button>
                <ChevronRight className="h-4 w-4" />
                <span className="font-medium text-zinc-700 dark:text-zinc-200">Glosario</span>
            </nav>
            <header>
                <h2 id="glosario-titulo" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                    📖 Glosario
                </h2>
                <p className="mt-1 text-zinc-600 dark:text-zinc-300">Las palabras que usa AgenIA, explicadas sin tecnicismos.</p>
            </header>
            <dl className={`${TARJETA} divide-y divide-zinc-100 dark:divide-zinc-800`}>
                {terminos.map((g) => {
                    const tema = g.temaId ? temaPorId.get(g.temaId) : undefined;
                    return (
                        <div key={g.id} id={g.id} className={`scroll-mt-6 p-4 ${ancla === g.id ? DESTELLO : ''}`}>
                            <dt className="font-semibold text-zinc-900 dark:text-white">
                                <T>{g.termino}</T>
                                {g.sinonimos && g.sinonimos.length > 0 && (
                                    <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">también: {g.sinonimos.join(', ')}</span>
                                )}
                            </dt>
                            <dd className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                                <T>{g.definicion}</T>
                                {tema && (
                                    <>
                                        {' '}
                                        <button
                                            type="button"
                                            onClick={() => onAbrirTema(tema.id)}
                                            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                                        >
                                            Ver en {tema.titulo} →
                                        </button>
                                    </>
                                )}
                            </dd>
                        </div>
                    );
                })}
            </dl>
        </article>
    );
}
