'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';
import {
    SEVERIDADES_EXCEPCION,
    TIPOS_EXCEPCION,
    TITULO_EXCEPCION,
    UMBRALES_VIGILANTE,
    type AccionExcepcion,
    type SeveridadExcepcion,
    type TipoExcepcion,
} from '@agenia/shared';
import {
    aplicarAccionExcepcionAction,
    detalleExcepcionAction,
    guardarAvisosAction,
} from '@/app/actions/bandeja';
import { formatAppointmentCompact } from '@/lib/date';
import { FILTROS_ESTADO, hrefBandeja } from '@/lib/bandeja/filtros';
import type {
    EstadoAvisos,
    ExcepcionDetalle,
    ExcepcionVista,
    FiltroEstado,
    ListaExcepciones,
} from '@/lib/bandeja/tipos';

/**
 * Bandeja de excepciones de sincronización (docs/PLAN_RASTREO_PACIENTE.md §10 #3).
 *
 * La pantalla no decide qué puede hacer cada rol: el servidor manda ya filtradas las
 * acciones (`acciones`) y el detalle técnico (que llega vacío a quien no lo ve). Aquí
 * solo se pinta lo que llega, y cada botón vuelve a pasar por el servidor, que
 * comprueba otra vez permisos, clínica y alcance.
 */

const NOTA_MIN = 5;

const ETIQUETA_FILTRO: Record<FiltroEstado, string> = {
    ACTIVAS: 'Activas',
    SIN_DUENO: 'Sin dueño',
    MIAS: 'Mías',
    CERRADAS: 'Cerradas',
};

const ETIQUETA_GRAVEDAD: Record<SeveridadExcepcion, string> = {
    BAJA: 'Baja',
    MEDIA: 'Media',
    ALTA: 'Alta',
    CRITICA: 'Crítica',
};

const ESTILO_GRAVEDAD: Record<SeveridadExcepcion, string> = {
    BAJA: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
    MEDIA: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
    ALTA: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-900',
    CRITICA: 'bg-red-50 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900',
};

const ETIQUETA_ESTADO: Record<string, string> = {
    ABIERTA: 'Abierta',
    EN_REVISION: 'En revisión',
    RESUELTA: 'Resuelta',
    DESCARTADA: 'Descartada',
    AUTO_RESUELTA: 'Se cerró sola',
    VENCIDA: 'Venció sin resolución',
};

const ETIQUETA_ACCION: Record<AccionExcepcion, string> = {
    TOMAR: 'Tomar',
    SOLTAR: 'Soltar',
    RESOLVER: 'Resolver',
    DESCARTAR: 'Descartar',
    REABRIR: 'Reabrir',
};

const PIDE_NOTA: Partial<Record<AccionExcepcion, string>> = {
    RESOLVER: 'Cuenta qué se hizo (por ejemplo: «se agendó a mano en el HIS»).',
    DESCARTAR: 'Cuenta por qué no hace falta actuar (por ejemplo: «era una cita de prueba»).',
};

const CAMPO =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white';
const BOTON_PRIMARIO =
    'rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400';
const BOTON_SECUNDARIO =
    'rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';

// ─────────────────────────────────────────────────────────────
// Avisos al agendador
// ─────────────────────────────────────────────────────────────

function PanelAvisos({
    avisos,
    puedeConfigurar,
}: {
    avisos: EstadoAvisos;
    puedeConfigurar: boolean;
}) {
    const router = useRouter();
    const idNumero = useId();
    const idRespaldo = useId();
    const [editando, setEditando] = useState(false);
    const [numero, setNumero] = useState(avisos.numero ?? '');
    const [respaldo, setRespaldo] = useState(avisos.respaldo ?? '');
    const [activos, setActivos] = useState(avisos.alertasActivas);
    const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
    const [guardando, iniciar] = useTransition();

    function guardar() {
        setMensaje(null);
        iniciar(async () => {
            const r = await guardarAvisosAction({ numero, respaldo, activos });
            if (!r.success) {
                setMensaje({ ok: false, texto: r.error });
                return;
            }
            setMensaje({ ok: true, texto: 'Guardado.' });
            setEditando(false);
            router.refresh();
        });
    }

    const estilos = avisos.salen
        ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-200'
        : 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200';

    return (
        <section className={`rounded-xl border p-4 ${estilos}`} aria-label="Avisos al agendador">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-sm font-semibold">
                        {avisos.salen
                            ? 'Los avisos por WhatsApp al agendador están activos'
                            : 'Los avisos por WhatsApp al agendador NO están saliendo'}
                    </h2>
                    <p className="mt-1 text-sm leading-snug opacity-90">
                        {avisos.salen
                            ? `Si una cita confirmada no llega al hospital, se le avisa al agendador antes de la hora de la cita. Si en ${UMBRALES_VIGILANTE.recordatorioMin} min nadie la toma aquí, se le recuerda (hasta ${UMBRALES_VIGILANTE.maxRecordatorios} veces)${avisos.tieneRespaldo ? ', también al número de respaldo' : ''}.`
                            : `${avisos.razon ?? ''} Mientras tanto las excepciones solo aparecen en esta bandeja: hay que abrirla para enterarse.`}
                    </p>
                </div>
                {puedeConfigurar && (
                    <button
                        type="button"
                        className={BOTON_SECUNDARIO}
                        onClick={() => setEditando((v) => !v)}
                        aria-expanded={editando}
                    >
                        {editando ? 'Cerrar' : 'Configurar avisos'}
                    </button>
                )}
            </div>

            {puedeConfigurar && editando && (
                <div className="mt-4 space-y-3 rounded-lg border border-zinc-200 bg-white p-3 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
                    <div>
                        <label htmlFor={idNumero} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                            Celular del agendador (WhatsApp)
                        </label>
                        <input
                            id={idNumero}
                            className={CAMPO}
                            inputMode="tel"
                            placeholder="300 123 4567"
                            value={numero}
                            onChange={(e) => setNumero(e.target.value)}
                        />
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Es un teléfono personal: el aviso lleva solo un resumen, sin datos de ningún paciente. Déjalo vacío para no avisar a nadie.
                        </p>
                    </div>
                    <div>
                        <label htmlFor={idRespaldo} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                            Celular de respaldo (opcional)
                        </label>
                        <input
                            id={idRespaldo}
                            className={CAMPO}
                            inputMode="tel"
                            placeholder="300 765 4321"
                            value={respaldo}
                            onChange={(e) => setRespaldo(e.target.value)}
                        />
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Otra persona (un coordinador, por ejemplo). No recibe el primer aviso: recibe los recordatorios, cuando pasan {UMBRALES_VIGILANTE.recordatorioMin} min sin que nadie tome la excepción en esta bandeja.
                        </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={activos}
                            onChange={(e) => setActivos(e.target.checked)}
                        />
                        Avisar por WhatsApp cuando una cita no llegue al hospital
                    </label>
                    {!avisos.plantilla && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                            Falta la plantilla «Aviso al agendador (excepciones de sincronización)»: se registra, con el nombre exacto que aprobó Meta, en{' '}
                            <Link href="/dashboard/configuracion" className="underline">
                                Configuración
                            </Link>
                            .
                        </p>
                    )}
                    <button type="button" className={BOTON_PRIMARIO} disabled={guardando} onClick={guardar}>
                        {guardando ? 'Guardando…' : 'Guardar'}
                    </button>
                </div>
            )}
            {mensaje && (
                <p
                    role={mensaje.ok ? 'status' : 'alert'}
                    className={`mt-2 text-sm ${mensaje.ok ? '' : 'font-medium text-red-700 dark:text-red-300'}`}
                >
                    {mensaje.texto}
                </p>
            )}
        </section>
    );
}

// ─────────────────────────────────────────────────────────────
// Acciones de una excepción
// ─────────────────────────────────────────────────────────────

function Acciones({ f }: { f: ExcepcionVista }) {
    const router = useRouter();
    const idNota = useId();
    const [pidiendo, setPidiendo] = useState<'RESOLVER' | 'DESCARTAR' | null>(null);
    const [nota, setNota] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pendiente, iniciar] = useTransition();

    if (f.acciones.length === 0) return null;

    function ejecutar(accion: AccionExcepcion, texto?: string) {
        setError(null);
        iniciar(async () => {
            const r = await aplicarAccionExcepcionAction({ id: f.id, accion, nota: texto });
            if (!r.success) {
                setError(r.error);
                return;
            }
            setPidiendo(null);
            setNota('');
            router.refresh();
        });
    }

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
                {f.acciones.map((a) => {
                    const conNota = a === 'RESOLVER' || a === 'DESCARTAR';
                    return (
                        <button
                            key={a}
                            type="button"
                            className={a === 'TOMAR' ? BOTON_PRIMARIO : BOTON_SECUNDARIO}
                            disabled={pendiente}
                            onClick={() => {
                                setError(null);
                                if (conNota) setPidiendo(a as 'RESOLVER' | 'DESCARTAR');
                                else ejecutar(a);
                            }}
                        >
                            {ETIQUETA_ACCION[a]}
                        </button>
                    );
                })}
            </div>

            {pidiendo && (
                <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <label htmlFor={idNota} className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        {PIDE_NOTA[pidiendo]}
                    </label>
                    <textarea
                        id={idNota}
                        className={CAMPO}
                        rows={2}
                        maxLength={500}
                        value={nota}
                        onChange={(e) => setNota(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={BOTON_PRIMARIO}
                            disabled={pendiente || nota.trim().length < NOTA_MIN}
                            onClick={() => ejecutar(pidiendo, nota)}
                        >
                            {pendiente ? 'Guardando…' : `Confirmar: ${ETIQUETA_ACCION[pidiendo].toLowerCase()}`}
                        </button>
                        <button type="button" className={BOTON_SECUNDARIO} onClick={() => setPidiendo(null)}>
                            Cancelar
                        </button>
                    </div>
                    {nota.trim().length < NOTA_MIN && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            La nota es la constancia del cierre: escribe al menos {NOTA_MIN} caracteres.
                        </p>
                    )}
                </div>
            )}

            {error && (
                <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">
                    {error}
                </p>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Una excepción
// ─────────────────────────────────────────────────────────────

function Tarjeta({ f }: { f: ExcepcionVista }) {
    const [abierta, setAbierta] = useState(false);
    const [detalle, setDetalle] = useState<ExcepcionDetalle | null>(null);
    const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
    const [, iniciar] = useTransition();

    // El detalle se pide al abrir, y otra vez si la excepción cambió mientras estaba abierta.
    const huella = `${f.estado}|${f.dueno?.etiqueta ?? ''}|${f.cierre?.atIso ?? ''}|${f.ultimaVezIso}`;
    useEffect(() => {
        if (!abierta) return;
        iniciar(async () => {
            const r = await detalleExcepcionAction(f.id);
            if (r.success) {
                setDetalle(r.data);
                setErrorDetalle(null);
            } else {
                setErrorDetalle(r.error);
            }
        });
    }, [abierta, f.id, huella]);

    const cita = f.cita;

    return (
        <li className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${ESTILO_GRAVEDAD[f.gravedad]}`}>
                    {ETIQUETA_GRAVEDAD[f.gravedad] ?? f.gravedad}
                </span>
                <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                    {ETIQUETA_ESTADO[f.estado] ?? f.estado}
                </span>
                {f.dueno && (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {f.dueno.esMio ? 'La tienes tú' : `La tiene ${f.dueno.etiqueta}`}
                    </span>
                )}
                {f.avisadaIso && (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        · Se avisó al agendador ({formatAppointmentCompact(f.avisadaIso)})
                    </span>
                )}
            </div>

            <h3 className="mt-2 text-sm font-semibold text-zinc-900 dark:text-white">{f.titulo}</h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{f.resumen}</p>

            {cita && (
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {cita.inicioIso && (
                        <div className="flex gap-2">
                            <dt className="text-zinc-500 dark:text-zinc-400">Cita</dt>
                            <dd className="font-medium text-zinc-900 dark:text-white">{formatAppointmentCompact(cita.inicioIso)}</dd>
                        </div>
                    )}
                    {cita.medico && (
                        <div className="flex gap-2">
                            <dt className="text-zinc-500 dark:text-zinc-400">Médico</dt>
                            <dd className="text-zinc-900 dark:text-white">{cita.medico}</dd>
                        </div>
                    )}
                    {cita.servicio && (
                        <div className="flex gap-2">
                            <dt className="text-zinc-500 dark:text-zinc-400">Servicio</dt>
                            <dd className="text-zinc-900 dark:text-white">{cita.servicio}</dd>
                        </div>
                    )}
                    {(cita.paciente || cita.documento) && (
                        <div className="flex gap-2">
                            <dt className="text-zinc-500 dark:text-zinc-400">Paciente</dt>
                            <dd className="text-zinc-900 dark:text-white">
                                {[cita.paciente, cita.documento].filter(Boolean).join(' · ')}
                            </dd>
                        </div>
                    )}
                </dl>
            )}

            {f.cierre && (
                <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                    Cerrada por {f.cierre.por} ({formatAppointmentCompact(f.cierre.atIso)}).
                    {f.cierre.nota ? ` «${f.cierre.nota}»` : ''}
                </p>
            )}

            <div className="mt-3 space-y-3">
                <Acciones f={f} />
                <button
                    type="button"
                    className="text-sm font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300"
                    aria-expanded={abierta}
                    onClick={() => setAbierta((v) => !v)}
                >
                    {abierta ? 'Ocultar historial' : 'Ver historial'}
                </button>
            </div>

            {abierta && (
                <div className="mt-3 space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                    {errorDetalle && (
                        <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">
                            {errorDetalle}
                        </p>
                    )}
                    {!detalle && !errorDetalle && <p className="text-sm text-zinc-500">Cargando…</p>}
                    {detalle && (
                        <>
                            <ol className="space-y-1 text-sm">
                                {detalle.historial.map((h, i) => (
                                    <li key={`${h.atIso}-${i}`} className="text-zinc-700 dark:text-zinc-300">
                                        <span className="text-zinc-500 dark:text-zinc-400">{formatAppointmentCompact(h.atIso)}</span>{' '}
                                        · {h.accion} · {h.por}
                                        {h.nota ? ` — «${h.nota}»` : ''}
                                    </li>
                                ))}
                            </ol>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Visto {detalle.ocurrencias} {detalle.ocurrencias === 1 ? 'vez' : 'veces'}: la primera{' '}
                                {formatAppointmentCompact(detalle.primeraVezIso)}, la última {formatAppointmentCompact(detalle.ultimaVezIso)}.
                            </p>
                            {detalle.detalleTecnico && (
                                <div>
                                    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Detalle técnico</p>
                                    <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-zinc-100 p-2 text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                                        {detalle.detalleTecnico}
                                    </pre>
                                </div>
                            )}
                            {detalle.cita?.pacienteId && (
                                <Link
                                    href="/dashboard/rastreo"
                                    className="inline-block text-sm font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300"
                                >
                                    Ver el caso completo en Rastreo de paciente →
                                </Link>
                            )}
                        </>
                    )}
                </div>
            )}
        </li>
    );
}

// ─────────────────────────────────────────────────────────────
// La pantalla
// ─────────────────────────────────────────────────────────────

function Cifra({ etiqueta, valor, destacada }: { etiqueta: string; valor: number; destacada?: boolean }) {
    return (
        <div
            className={`rounded-xl border p-3 ${
                destacada && valor > 0
                    ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
                    : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'
            }`}
        >
            <p className="text-2xl font-bold text-zinc-900 dark:text-white">{valor}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{etiqueta}</p>
        </div>
    );
}

const MENSAJE_VACIO: Record<FiltroEstado, string> = {
    ACTIVAS: 'No hay excepciones activas. El vigilante revisa cada 2 minutos.',
    SIN_DUENO: 'No hay excepciones esperando a alguien.',
    MIAS: 'No tienes excepciones en revisión.',
    CERRADAS: 'Todavía no hay excepciones cerradas.',
};

interface Props {
    lista: ListaExcepciones;
    /** Los mismos que `leerFiltros` saca de la URL; `pagina` la usan los enlaces de paginación. */
    filtros: { estado: FiltroEstado; tipo?: TipoExcepcion; gravedad?: SeveridadExcepcion; pagina?: number };
    /** `null` si no se pudo leer el estado de los avisos. */
    avisos: EstadoAvisos | null;
    puedeConfigurarAvisos: boolean;
}

export default function BandejaClient({ lista, filtros, avisos, puedeConfigurarAvisos }: Props) {
    const router = useRouter();
    const { resumen } = lista;
    const enCerradas = filtros.estado === 'CERRADAS';

    return (
        <div className="space-y-6">
            <header>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                    Bandeja de sincronización
                </h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Citas que AgenIA confirmó y el hospital todavía no tiene, y cambios que no se pudieron aplicar. Se
                    ordenan por urgencia: la cita más cercana primero.
                </p>
            </header>

            {avisos && <PanelAvisos avisos={avisos} puedeConfigurar={puedeConfigurarAvisos} />}

            <section aria-label="Resumen" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Cifra etiqueta="Activas" valor={resumen.activas} />
                <Cifra etiqueta="Sin dueño" valor={resumen.sinDueno} />
                <Cifra etiqueta="Mías" valor={resumen.mias} />
                <Cifra etiqueta="Críticas (cita en menos de 4 h)" valor={resumen.criticas} destacada />
            </section>

            <section aria-label="Filtros" className="space-y-3">
                <nav className="flex flex-wrap gap-2" aria-label="Estado">
                    {FILTROS_ESTADO.map((e) => (
                        <Link
                            key={e}
                            href={hrefBandeja({ ...filtros, estado: e, pagina: 1 })}
                            aria-current={filtros.estado === e ? 'page' : undefined}
                            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                                filtros.estado === e
                                    ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                                    : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'
                            }`}
                        >
                            {ETIQUETA_FILTRO[e]}
                        </Link>
                    ))}
                </nav>
                <div className="flex flex-wrap gap-3">
                    <label className="text-sm text-zinc-600 dark:text-zinc-300">
                        <span className="mr-2">Tipo</span>
                        <select
                            className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            value={filtros.tipo ?? ''}
                            onChange={(e) =>
                                router.push(
                                    hrefBandeja({ ...filtros, tipo: (e.target.value || undefined) as TipoExcepcion | undefined, pagina: 1 }),
                                )
                            }
                        >
                            <option value="">Todos</option>
                            {TIPOS_EXCEPCION.map((t) => (
                                <option key={t} value={t}>
                                    {TITULO_EXCEPCION[t]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="text-sm text-zinc-600 dark:text-zinc-300">
                        <span className="mr-2">Gravedad</span>
                        <select
                            className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            value={filtros.gravedad ?? ''}
                            onChange={(e) =>
                                router.push(
                                    hrefBandeja({
                                        ...filtros,
                                        gravedad: (e.target.value || undefined) as SeveridadExcepcion | undefined,
                                        pagina: 1,
                                    }),
                                )
                            }
                        >
                            <option value="">Todas</option>
                            {[...SEVERIDADES_EXCEPCION].reverse().map((g) => (
                                <option key={g} value={g}>
                                    {ETIQUETA_GRAVEDAD[g]}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </section>

            {lista.filas.length === 0 ? (
                <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                    {MENSAJE_VACIO[filtros.estado]}
                </p>
            ) : (
                <ul className="space-y-3">
                    {lista.filas.map((f) => (
                        <Tarjeta key={f.id} f={f} />
                    ))}
                </ul>
            )}

            {lista.paginas > 1 && (
                <nav className="flex items-center justify-between text-sm" aria-label="Páginas">
                    {lista.pagina > 1 ? (
                        <Link className={BOTON_SECUNDARIO} href={hrefBandeja({ ...filtros, pagina: lista.pagina - 1 })}>
                            ← Anterior
                        </Link>
                    ) : (
                        <span />
                    )}
                    <span className="text-zinc-500 dark:text-zinc-400">
                        Página {lista.pagina} de {lista.paginas} · {lista.total} {lista.total === 1 ? 'excepción' : 'excepciones'}
                    </span>
                    {lista.pagina < lista.paginas ? (
                        <Link className={BOTON_SECUNDARIO} href={hrefBandeja({ ...filtros, pagina: lista.pagina + 1 })}>
                            Siguiente →
                        </Link>
                    ) : (
                        <span />
                    )}
                </nav>
            )}

            {!enCerradas && lista.total >= 500 && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Se muestran las 500 más próximas. Resuelve o descarta las que ya no importan para ver el resto.
                </p>
            )}
        </div>
    );
}
