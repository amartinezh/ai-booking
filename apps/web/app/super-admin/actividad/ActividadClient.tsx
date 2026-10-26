'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PaginaDeActividad, ResumenDeIngresos } from '@/app/actions/actividad';
import { cargarActividad, cerrarSesionesDeClinica, cerrarSesionesDeUsuario } from '@/app/actions/actividad';
import type { FiltrosEnTexto } from '@/lib/actividad/filtros';
import type { EventoDeActividad } from '@/lib/actividad/linea-de-tiempo';
import { CATEGORIAS, ETIQUETA_CATEGORIA, etiquetaRol, type Categoria } from '@/lib/actividad/catalogo';
import { partesLocales } from '@/lib/rastreo/zona-horaria';
import { formatDateOnly, formatDateShort, formatTimeOnly } from '@/lib/date';

type Clinica = { id: string; name: string; isActive: boolean };
type Usuario = { id: string; email: string; role: string };

interface Props {
    filtros: FiltrosEnTexto;
    clinicas: Clinica[];
    usuarios: Usuario[];
    pagina: PaginaDeActividad;
    resumen: ResumenDeIngresos | null;
}

const ZONA = 'America/Bogota';
const NUMERO = new Intl.NumberFormat('es-CO');

const campo =
    'w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:text-white disabled:opacity-50';

function fechaHora(iso: string | null): string {
    if (!iso) return '—';
    return `${formatDateShort(iso)} ${formatTimeOnly(iso)}`;
}

export default function ActividadClient({ filtros, clinicas, usuarios, pagina, resumen }: Props) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [eventos, setEventos] = useState<EventoDeActividad[]>(pagina.eventos);
    const [siguiente, setSiguiente] = useState<string | null>(pagina.siguiente);
    const [cargandoMas, setCargandoMas] = useState(false);
    const [errorMas, setErrorMas] = useState<string | null>(null);
    const [abierto, setAbierto] = useState<string | null>(null);

    // Una navegación nueva (otros filtros) trae otra primera página.
    useEffect(() => {
        setEventos(pagina.eventos);
        setSiguiente(pagina.siguiente);
        setErrorMas(null);
        setAbierto(null);
    }, [pagina]);

    const ir = (cambio: Partial<FiltrosEnTexto>) => {
        const nuevos: FiltrosEnTexto = { ...filtros, ...cambio };
        // Cambiar de clínica suelta el usuario: el de otra clínica no tiene nada aquí.
        if ('org' in cambio && cambio.org !== filtros.org && !('usuario' in cambio)) delete nuevos.usuario;
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(nuevos)) if (v) params.set(k, v);
        const qs = params.toString();
        startTransition(() => router.push(`/super-admin/actividad${qs ? `?${qs}` : ''}`));
    };

    const cargarMas = async () => {
        if (!siguiente) return;
        setCargandoMas(true);
        setErrorMas(null);
        try {
            const r = await cargarActividad(filtros, siguiente);
            if (!r.success) {
                setErrorMas(r.error ?? 'No se pudo cargar más.');
                return;
            }
            setEventos((prev) => {
                const vistos = new Set(prev.map((e) => e.clave));
                return [...prev, ...r.eventos.filter((e) => !vistos.has(e.clave))];
            });
            setSiguiente(r.siguiente);
        } catch {
            setErrorMas('No se pudo cargar más. Revise la conexión e intente de nuevo.');
        } finally {
            setCargandoMas(false);
        }
    };

    const porDia = useMemo(() => {
        const grupos: { dia: string; etiqueta: string; eventos: EventoDeActividad[] }[] = [];
        for (const e of eventos) {
            const dia = partesLocales(e.at, ZONA)?.fecha ?? e.at.slice(0, 10);
            let g = grupos[grupos.length - 1];
            if (!g || g.dia !== dia) {
                g = { dia, etiqueta: `${formatDateOnly(e.at)} · ${formatDateShort(e.at)}`, eventos: [] };
                grupos.push(g);
            }
            g.eventos.push(e);
        }
        return grupos;
    }, [eventos]);

    const clinicaElegida = filtros.org && filtros.org !== 'plataforma' ? filtros.org : null;
    const verClinica = !filtros.org; // en «Todas» cada evento dice de qué clínica es

    return (
        <div className={`space-y-6 ${isPending ? 'opacity-60 pointer-events-none' : ''}`}>
            {/* ── Filtros ─────────────────────────────────────────── */}
            <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                        <label htmlFor="f-clinica" className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                            Clínica
                        </label>
                        <select
                            id="f-clinica"
                            className={campo}
                            value={filtros.org ?? ''}
                            onChange={(e) => ir({ org: e.target.value || undefined })}
                        >
                            <option value="">Todas las clínicas</option>
                            <option value="plataforma">Plataforma (super administradores y sin clínica)</option>
                            {clinicas.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                    {c.isActive ? '' : ' (suspendida)'}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="f-usuario" className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                            Usuario
                        </label>
                        <select
                            id="f-usuario"
                            className={campo}
                            value={filtros.usuario ?? ''}
                            disabled={!filtros.org && !filtros.usuario}
                            onChange={(e) => ir({ usuario: e.target.value || undefined })}
                        >
                            <option value="">{filtros.org ? 'Todos los usuarios' : 'Elija primero una clínica'}</option>
                            {usuarios.map((u) => (
                                <option key={u.id} value={u.id}>
                                    {u.email} · {etiquetaRol(u.role)}
                                </option>
                            ))}
                            {filtros.usuario && !usuarios.some((u) => u.id === filtros.usuario) && (
                                <option value={filtros.usuario}>Usuario elegido</option>
                            )}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="f-desde" className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                            Desde
                        </label>
                        <input
                            id="f-desde"
                            type="date"
                            className={campo}
                            value={filtros.desde ?? ''}
                            onChange={(e) => ir({ desde: e.target.value || undefined })}
                        />
                    </div>
                    <div>
                        <label htmlFor="f-hasta" className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                            Hasta
                        </label>
                        <input
                            id="f-hasta"
                            type="date"
                            className={campo}
                            value={filtros.hasta ?? ''}
                            onChange={(e) => ir({ hasta: e.target.value || undefined })}
                        />
                    </div>
                </div>

                <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de actividad">
                    <Chip activo={!filtros.cat} onClick={() => ir({ cat: undefined })}>
                        Todo
                    </Chip>
                    {CATEGORIAS.map((c) => (
                        <Chip key={c} activo={filtros.cat === c} onClick={() => ir({ cat: c })}>
                            {ETIQUETA_CATEGORIA[c].icono} {ETIQUETA_CATEGORIA[c].etiqueta}
                        </Chip>
                    ))}
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        className="rounded border-zinc-300 dark:border-zinc-600"
                        checked={filtros.vistas === '1'}
                        onChange={(e) => ir({ vistas: e.target.checked ? '1' : undefined })}
                    />
                    Incluir las pantallas que abrió cada persona (una vez cada 30 minutos por pantalla)
                </label>

                {(filtros.org || filtros.usuario || filtros.cat || filtros.desde || filtros.hasta || filtros.vistas) && (
                    <button
                        type="button"
                        onClick={() => startTransition(() => router.push('/super-admin/actividad'))}
                        className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        Quitar todos los filtros
                    </button>
                )}
            </section>

            {/* ── Ingresos: cifras y quién entra ──────────────────── */}
            {resumen && (
                <section className="space-y-4">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Cifra titulo="Ingresos (30 días)" valor={resumen.ingresos30} />
                        <Cifra
                            titulo="Intentos fallidos (30 días)"
                            valor={resumen.fallidos30}
                            alerta={resumen.fallidos30 > 0}
                        />
                        <Cifra titulo="Personas que ingresaron (30 días)" valor={resumen.usuariosQueIngresaron30} />
                        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Registro de ingresos desde</p>
                            <p className="mt-1 text-sm font-bold text-zinc-900 dark:text-white">
                                {resumen.registroDesde ? formatDateShort(resumen.registroDesde) : 'Sin ingresos registrados'}
                            </p>
                            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                                Antes de esa fecha no se guardaban los ingresos.
                            </p>
                        </div>
                    </div>

                    {resumen.clinicas.length > 0 && (
                        <TablaClinicas clinicas={resumen.clinicas} onElegir={(id) => ir({ org: id })} />
                    )}
                    {resumen.usuarios.length > 0 && (
                        <TablaUsuarios
                            usuarios={resumen.usuarios}
                            titulo={clinicaElegida ? 'Personal de la clínica' : 'Super administradores'}
                            elegido={filtros.usuario ?? null}
                            onElegir={(id) => ir({ usuario: id === filtros.usuario ? undefined : id })}
                            onCerrarSesiones={async (u) => {
                                if (!confirm(`¿Cerrar todas las sesiones abiertas de ${u.email}? Tendrá que volver a ingresar con su clave.`)) return;
                                const r = await cerrarSesionesDeUsuario(u.id);
                                if (!r.success) alert(r.error ?? 'No se pudieron cerrar las sesiones.');
                                else startTransition(() => router.refresh());
                            }}
                            onCerrarTodas={
                                clinicaElegida
                                    ? async () => {
                                          if (!confirm('¿Cerrar las sesiones de TODAS las cuentas de esta clínica? Todos tendrán que volver a ingresar.')) return;
                                          const r = await cerrarSesionesDeClinica(clinicaElegida);
                                          if (!r.success) alert(r.error ?? 'No se pudieron cerrar las sesiones.');
                                          else startTransition(() => router.refresh());
                                      }
                                    : null
                            }
                        />
                    )}
                </section>
            )}

            {/* ── Línea de tiempo ─────────────────────────────────── */}
            <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
                    <h2 className="text-base font-bold text-zinc-900 dark:text-white">Qué hicieron, de lo más reciente a lo más antiguo</h2>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                        {eventos.length} evento{eventos.length === 1 ? '' : 's'}
                        {siguiente ? ' (hay más)' : ''}
                    </span>
                </div>

                {!pagina.success && (
                    <p className="px-5 py-4 text-sm text-red-600 dark:text-red-400">{pagina.error}</p>
                )}
                {pagina.fuentesConError.length > 0 && (
                    <p className="px-5 py-3 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20">
                        Una parte del historial no se pudo leer ({pagina.fuentesConError.join(', ')}); se muestra lo demás.
                    </p>
                )}

                {eventos.length === 0 && pagina.success && (
                    <p className="px-5 py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
                        No hay actividad registrada con estos filtros.
                    </p>
                )}

                <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {porDia.map((g) => (
                        <li key={g.dia}>
                            <h3 className="sticky top-0 z-10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950/80 backdrop-blur">
                                {g.etiqueta}
                            </h3>
                            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {g.eventos.map((e) => (
                                    <FilaEvento
                                        key={e.clave}
                                        evento={e}
                                        verClinica={verClinica}
                                        abierto={abierto === e.clave}
                                        onAbrir={() => setAbierto(abierto === e.clave ? null : e.clave)}
                                        onUsuario={
                                            e.actor.userId && e.organizationId
                                                ? () => ir({ org: e.organizationId as string, usuario: e.actor.userId as string })
                                                : null
                                        }
                                    />
                                ))}
                            </ul>
                        </li>
                    ))}
                </ol>

                {siguiente && (
                    <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 flex flex-col items-center gap-2">
                        <button
                            type="button"
                            onClick={cargarMas}
                            disabled={cargandoMas}
                            className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {cargandoMas ? 'Cargando…' : 'Cargar más antiguos'}
                        </button>
                        {errorMas && <p className="text-xs text-red-600 dark:text-red-400">{errorMas}</p>}
                    </div>
                )}
            </section>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Piezas
// ─────────────────────────────────────────────────────────────

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={activo}
            onClick={onClick}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                activo
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-indigo-400'
            }`}
        >
            {children}
        </button>
    );
}

function Cifra({ titulo, valor, alerta = false }: { titulo: string; valor: number; alerta?: boolean }) {
    return (
        <div
            className={`rounded-2xl border p-4 ${
                alerta
                    ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
            }`}
        >
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{titulo}</p>
            <p
                className={`mt-1 text-2xl font-extrabold tabular-nums ${
                    alerta ? 'text-amber-700 dark:text-amber-300' : 'text-zinc-900 dark:text-white'
                }`}
            >
                {NUMERO.format(valor)}
            </p>
        </div>
    );
}

function TablaClinicas({
    clinicas,
    onElegir,
}: {
    clinicas: ResumenDeIngresos['clinicas'];
    onElegir: (id: string) => void;
}) {
    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <h2 className="px-5 py-3 text-sm font-bold text-zinc-900 dark:text-white border-b border-zinc-200 dark:border-zinc-800">
                Ingresos por clínica (últimos 30 días)
            </h2>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        <tr>
                            <th className="px-5 py-2 font-semibold">Clínica</th>
                            <th className="px-3 py-2 font-semibold text-right">Personal</th>
                            <th className="px-3 py-2 font-semibold text-right">Ingresaron</th>
                            <th className="px-3 py-2 font-semibold text-right">Ingresos</th>
                            <th className="px-3 py-2 font-semibold text-right">Fallidos</th>
                            <th className="px-5 py-2 font-semibold">Último ingreso</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {clinicas.map((c) => (
                            <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                <td className="px-5 py-2.5">
                                    <button
                                        type="button"
                                        onClick={() => onElegir(c.id)}
                                        className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline text-left"
                                    >
                                        {c.nombre}
                                    </button>
                                    {!c.activa && <span className="ml-2 text-xs text-red-600 dark:text-red-400">suspendida</span>}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{c.usuarios}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{c.usuariosQueIngresaron30}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{c.ingresos30}</td>
                                <td
                                    className={`px-3 py-2.5 text-right tabular-nums ${
                                        c.fallidos30 > 0 ? 'text-amber-700 dark:text-amber-300 font-semibold' : ''
                                    }`}
                                >
                                    {c.fallidos30}
                                </td>
                                <td className="px-5 py-2.5 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                                    {fechaHora(c.ultimoIngreso)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function TablaUsuarios({
    usuarios,
    titulo,
    elegido,
    onElegir,
    onCerrarSesiones,
    onCerrarTodas,
}: {
    usuarios: ResumenDeIngresos['usuarios'];
    titulo: string;
    elegido: string | null;
    onElegir: (id: string) => void;
    onCerrarSesiones: (u: ResumenDeIngresos['usuarios'][number]) => void;
    onCerrarTodas: (() => void) | null;
}) {
    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
                    {titulo} · último ingreso y últimos 30 días
                </h2>
                {onCerrarTodas && (
                    <button
                        type="button"
                        onClick={onCerrarTodas}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 dark:text-red-300 dark:bg-red-900/20 dark:hover:bg-red-900/40"
                    >
                        Cerrar las sesiones de toda la clínica
                    </button>
                )}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        <tr>
                            <th className="px-5 py-2 font-semibold">Usuario</th>
                            <th className="px-3 py-2 font-semibold">Rol</th>
                            <th className="px-3 py-2 font-semibold">Último ingreso</th>
                            <th className="px-3 py-2 font-semibold text-right">Ingresos</th>
                            <th className="px-3 py-2 font-semibold text-right">Fallidos</th>
                            <th className="px-3 py-2 font-semibold">Cuenta creada</th>
                            <th className="px-5 py-2 font-semibold">Sesiones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {usuarios.map((u) => (
                            <tr
                                key={u.id}
                                className={
                                    elegido === u.id
                                        ? 'bg-indigo-50 dark:bg-indigo-900/20'
                                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                                }
                            >
                                <td className="px-5 py-2.5">
                                    <button
                                        type="button"
                                        onClick={() => onElegir(u.id)}
                                        className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline text-left break-all"
                                        title={elegido === u.id ? 'Ver a todos' : 'Ver solo su actividad'}
                                    >
                                        {u.email}
                                    </button>
                                </td>
                                <td className="px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">{etiquetaRol(u.role)}</td>
                                <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                                    {u.ultimoIngreso ? (
                                        <span className="text-zinc-700 dark:text-zinc-200">{fechaHora(u.ultimoIngreso)}</span>
                                    ) : (
                                        <span className="text-zinc-400">Nunca (desde que se registran)</span>
                                    )}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{u.ingresos30}</td>
                                <td
                                    className={`px-3 py-2.5 text-right tabular-nums ${
                                        u.fallidos30 > 0 ? 'text-amber-700 dark:text-amber-300 font-semibold' : ''
                                    }`}
                                >
                                    {u.fallidos30}
                                </td>
                                <td className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                                    {formatDateShort(u.creado)}
                                </td>
                                <td className="px-5 py-2.5 text-xs whitespace-nowrap">
                                    {u.sesionesCerradas && (
                                        <span className="block text-zinc-500 dark:text-zinc-400" title="La última vez que se cerraron sus sesiones">
                                            cerradas {fechaHora(u.sesionesCerradas)}
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onCerrarSesiones(u)}
                                        className="font-semibold text-red-600 dark:text-red-400 hover:underline"
                                    >
                                        Cerrar sesiones
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function FilaEvento({
    evento: e,
    verClinica,
    abierto,
    onAbrir,
    onUsuario,
}: {
    evento: EventoDeActividad;
    verClinica: boolean;
    abierto: boolean;
    onAbrir: () => void;
    onUsuario: (() => void) | null;
}) {
    const cat = ETIQUETA_CATEGORIA[e.categoria as Categoria] ?? ETIQUETA_CATEGORIA.OTROS;
    const quien = e.actor.email ?? (e.actor.userId ? 'Usuario borrado' : null);
    return (
        <li className={`px-5 py-3 ${e.aviso ? 'border-l-4 border-amber-400 bg-amber-50/40 dark:bg-amber-950/10' : ''}`}>
            <div className="flex items-start gap-3">
                <span className="w-16 shrink-0 pt-0.5 text-xs font-mono text-zinc-500 dark:text-zinc-400">
                    {formatTimeOnly(e.at)}
                </span>
                <span className="shrink-0 text-lg leading-none pt-0.5" title={cat.etiqueta} aria-hidden>
                    {cat.icono}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-900 dark:text-white">
                        {quien ? (
                            onUsuario ? (
                                <button
                                    type="button"
                                    onClick={onUsuario}
                                    className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline break-all"
                                    title="Ver solo la actividad de esta persona"
                                >
                                    {quien}
                                </button>
                            ) : (
                                <span className="font-semibold break-all">{quien}</span>
                            )
                        ) : (
                            <span className="font-semibold text-zinc-500 dark:text-zinc-400">
                                {e.categoria === 'SEGURIDAD'
                                    ? 'Alguien'
                                    : e.categoria === 'PLATAFORMA'
                                      ? 'Consola del servidor'
                                      : 'Alguien del panel'}
                            </span>
                        )}
                        {e.actor.role && (
                            <span className="ml-1.5 align-middle inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                                {etiquetaRol(e.actor.role)}
                            </span>
                        )}
                        <span className="text-zinc-600 dark:text-zinc-300"> — {e.titulo}</span>
                    </p>
                    {e.detalle && (
                        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400 break-words">{e.detalle}</p>
                    )}
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {verClinica && <span>🏥 {e.organizationName ?? (e.organizationId ? 'Clínica borrada' : 'Sin clínica')}</span>}
                        {e.ip && <span>🌐 IP {e.ip}</span>}
                        {e.navegador && <span>💻 {e.navegador}</span>}
                        {e.extra && (
                            <button type="button" onClick={onAbrir} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                                {abierto ? 'Ocultar detalle' : 'Ver detalle'}
                            </button>
                        )}
                    </p>
                    {abierto && e.extra && (
                        <pre className="mt-2 text-[11px] font-mono leading-relaxed bg-zinc-950 text-zinc-100 rounded-xl p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words">
                            {JSON.stringify({ accion: e.accion, ...e.extra }, null, 2)}
                        </pre>
                    )}
                </div>
            </div>
        </li>
    );
}
