'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LIMITES_RESUMEN_ATENCION, type ResultadoRevisionResumen } from '@agenia/shared';
import { formatAppointmentShort } from '@/lib/date';
import {
    abrirResumenAction,
    buscarResumenesAction,
    revisarResumenAction,
    type BusquedaDeResumenes,
    type PanelResumenAtencion,
    type ResumenAbierto,
} from '@/app/actions/resumen-atencion';
import DetalleResumen from './DetalleResumen';
import DocumentosDelResumen from './DocumentosDelResumen';

/**
 * Cierre de la Fase 1 (plan §8): el hospital compara resúmenes con el HIS y
 * marca cada uno «Correcto» o «Con error». La lista solo trae datos de control;
 * el contenido se pide a la API al abrir uno, y abrirlo queda registrado.
 */
export default function RevisionResumenes({
    revision,
    destinosPrueba = [],
}: {
    revision: PanelResumenAtencion['revision'];
    /** Números del modo prueba: a ellos se puede enviar de prueba el aviso. */
    destinosPrueba?: string[];
}) {
    const router = useRouter();
    const [abriendo, startAbrir] = useTransition();
    const [guardando, startGuardar] = useTransition();
    const [abierto, setAbierto] = useState<{ id: string; datos: ResumenAbierto } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [resultado, setResultado] = useState<ResultadoRevisionResumen | null>(null);
    const [nota, setNota] = useState('');
    const [aviso, setAviso] = useState<string | null>(null);
    // 🔎 Buscar por cédula o por número de consulta (2026-11-26): la lista solo
    // trae los 40 más recientes.
    const [texto, setTexto] = useState('');
    const [busqueda, setBusqueda] = useState<BusquedaDeResumenes | null>(null);
    const [buscando, startBuscar] = useTransition();
    const filas = busqueda ? busqueda.filas : revision.recientes;
    const revisados = revision.correctos + revision.conError;

    const buscar = (numero: string) => {
        setError(null);
        setAviso(null);
        startBuscar(async () => {
            const r = await buscarResumenesAction(numero);
            if (!r.success) {
                setError(r.error);
                return;
            }
            setBusqueda(r.busqueda);
        });
    };

    const limpiar = () => {
        setBusqueda(null);
        setTexto('');
        setError(null);
    };

    const abrir = (id: string) => {
        setError(null);
        setAviso(null);
        startAbrir(async () => {
            const r = await abrirResumenAction(id);
            if (!r.success) {
                setError(r.error);
                return;
            }
            const fila = filas.find((f) => f.id === id);
            setAbierto({ id, datos: r.abierto });
            setResultado(fila?.revision?.resultado ?? null);
            setNota(fila?.revision?.nota ?? '');
        });
    };

    const guardar = () => {
        if (!abierto || !resultado) return;
        setError(null);
        startGuardar(async () => {
            const r = await revisarResumenAction(abierto.id, { resultado, nota });
            if (!r.success) {
                setError(r.error);
                return;
            }
            setAviso(`Revisión guardada: consulta ${abierto.datos.hisKey}.`);
            setAbierto(null);
            router.refresh();
            // Los resultados de una búsqueda no se refrescan solos.
            if (busqueda) {
                const r2 = await buscarResumenesAction(busqueda.numero);
                if (r2.success) setBusqueda(r2.busqueda);
            }
        });
    };

    return (
        <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="space-y-1">
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Revisar contra el HIS</h2>
                <p className="text-xs text-zinc-500">
                    Abra cada resumen, compárelo con la historia en el sistema del hospital y márquelo. Para pasar a la fase
                    siguiente se necesitan {revision.meta} revisados sin errores. Cada vez que alguien abre un resumen queda
                    registrado.
                </p>
                <p className="text-sm text-zinc-800 dark:text-zinc-200" data-testid="progreso-revision">
                    <strong>{revisados}</strong> de {revision.meta} revisados · {revision.correctos} correcto(s) ·{' '}
                    <span className={revision.conError > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : ''}>
                        {revision.conError} con error
                    </span>
                </p>
            </div>

            {aviso && <p className="text-sm text-emerald-700 dark:text-emerald-400">{aviso}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}

            {abierto ? (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            Consulta {abierto.datos.hisKey}
                            {abierto.datos.version > 1 && (
                                <span className="ml-2 text-xs font-normal text-zinc-500">versión {abierto.datos.version}</span>
                            )}
                        </h3>
                        <button
                            onClick={() => setAbierto(null)}
                            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                        >
                            ← Volver a la lista
                        </button>
                    </div>
                    <DetalleResumen resumen={abierto.datos.resumen} />
                    <DocumentosDelResumen id={abierto.id} destinosPrueba={destinosPrueba} />
                    <fieldset className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                        <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                            ¿Coincide con lo que está en el HIS?
                        </legend>
                        <div className="flex flex-wrap gap-4 text-sm">
                            <label className="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="resultado"
                                    checked={resultado === 'CORRECTO'}
                                    onChange={() => setResultado('CORRECTO')}
                                />
                                Correcto
                            </label>
                            <label className="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="resultado"
                                    checked={resultado === 'CON_ERROR'}
                                    onChange={() => setResultado('CON_ERROR')}
                                />
                                Con error
                            </label>
                        </div>
                        <label className="block text-sm text-zinc-700 dark:text-zinc-300">
                            {resultado === 'CON_ERROR' ? 'Qué está mal (obligatorio)' : 'Nota (opcional)'}
                            <textarea
                                value={nota}
                                onChange={(e) => setNota(e.target.value)}
                                maxLength={LIMITES_RESUMEN_ATENCION.maxCaracteresNotaRevision}
                                rows={3}
                                aria-label="Nota de la revisión"
                                className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                                placeholder="Ej.: falta la loratadina de la fórmula; la remisión dice otra especialidad."
                            />
                        </label>
                        <button
                            onClick={guardar}
                            disabled={!resultado || guardando}
                            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                        >
                            {guardando ? 'Guardando…' : 'Guardar revisión'}
                        </button>
                    </fieldset>
                </div>
            ) : (
                <div className="space-y-3">
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (texto.trim()) buscar(texto);
                        }}
                        className="flex flex-wrap items-end gap-2"
                        role="search"
                    >
                        <label className="text-sm text-zinc-700 dark:text-zinc-300">
                            Buscar por cédula o número de consulta
                            <input
                                value={texto}
                                onChange={(e) => setTexto(e.target.value)}
                                inputMode="numeric"
                                maxLength={40}
                                aria-label="Cédula o número de consulta"
                                placeholder="Ej.: 24392385 o 2494585"
                                className="mt-1 block w-64 max-w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                            />
                        </label>
                        <button
                            type="submit"
                            disabled={buscando || !texto.trim()}
                            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                        >
                            {buscando ? 'Buscando…' : 'Buscar'}
                        </button>
                        {busqueda && (
                            <button
                                type="button"
                                onClick={limpiar}
                                className="px-2 py-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
                            >
                                Ver las más recientes
                            </button>
                        )}
                    </form>
                    <p className="text-xs text-zinc-500">
                        Por cédula aparecen las consultas de los pacientes que AgenIA conoce («Paciente en AgenIA: Sí»); las
                        demás se encuentran por su número de consulta. Buscar por cédula queda registrado.
                    </p>
                    {busqueda ? (
                        <p className="text-sm text-zinc-800 dark:text-zinc-200" data-testid="resultado-busqueda">
                            {resultadoDeLaBusqueda(busqueda)}
                        </p>
                    ) : (
                        revision.recientes.length > 0 && (
                            <p className="text-xs text-zinc-500">Las {revision.recientes.length} consultas más recientes.</p>
                        )
                    )}
                    {filas.length === 0 ? (
                        busqueda ? null : <p className="text-sm text-zinc-500">Todavía no ha llegado ningún resumen.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                                        <th className="py-2 pr-3 font-medium">Consulta</th>
                                        <th className="py-2 pr-3 font-medium">Servicio</th>
                                        <th className="py-2 pr-3 font-medium">Guardada en el HIS</th>
                                        <th className="py-2 pr-3 font-medium">Paciente en AgenIA</th>
                                        <th className="py-2 pr-3 font-medium">Revisión</th>
                                        <th className="py-2 pr-3" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {filas.map((f) => (
                                        <tr key={f.id} className="border-b border-zinc-100 dark:border-zinc-900">
                                            <td className="py-2 pr-3 font-mono text-xs">
                                                {f.historia}
                                                {f.version > 1 && <span className="ml-1 text-zinc-500">v{f.version}</span>}
                                            </td>
                                            <td className="py-2 pr-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">{f.servicio ?? '—'}</td>
                                            <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-300">{formatAppointmentShort(f.atendidaIso)}</td>
                                            <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-300">{f.conPaciente ? 'Sí' : 'No'}</td>
                                            <td className="py-2 pr-3">
                                                {f.revision ? (
                                                    <span
                                                        title={[f.revision.quien, f.revision.nota].filter(Boolean).join(' — ')}
                                                        className={
                                                            f.revision.resultado === 'CORRECTO'
                                                                ? 'text-emerald-700 dark:text-emerald-400'
                                                                : 'text-amber-700 dark:text-amber-400'
                                                        }
                                                    >
                                                        {f.revision.resultado === 'CORRECTO' ? '✓ Correcto' : '⚠ Con error'}
                                                    </span>
                                                ) : (
                                                    <span className="text-zinc-400">Sin revisar</span>
                                                )}
                                            </td>
                                            <td className="py-2 pr-3 text-right">
                                                {f.contenidoDisponible ? (
                                                    <button
                                                        onClick={() => abrir(f.id)}
                                                        disabled={abriendo}
                                                        aria-label={`Abrir la consulta ${f.historia}`}
                                                        className="text-sm text-blue-600 hover:underline disabled:opacity-40 dark:text-blue-400"
                                                    >
                                                        Abrir
                                                    </button>
                                                ) : (
                                                    <span className="text-xs text-zinc-400">Borrado (30 días)</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

/** Lo que encontró la búsqueda, en una frase. */
function resultadoDeLaBusqueda(b: BusquedaDeResumenes): string {
    if (b.filas.length === 0) {
        return b.hayPaciente
            ? `El paciente con el documento ${b.numero} no tiene consultas leídas del hospital, y no hay una consulta con ese número.`
            : `No hay una consulta con el número ${b.numero} ni un paciente de AgenIA con ese documento.`;
    }
    const partes = [
        b.porDocumento > 0 ? `${b.porDocumento} del paciente con el documento ${b.numero}` : null,
        b.porConsulta > 0 ? `${b.porConsulta === 1 ? 'la consulta' : `${b.porConsulta} consultas`} con el número ${b.numero}` : null,
    ].filter(Boolean);
    return `${b.filas.length === 1 ? '1 consulta' : `${b.filas.length} consultas`}: ${partes.join(' y ')}.`;
}
