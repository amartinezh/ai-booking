'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CAMPOS_PLANTILLA_POR_DEFECTO, type CampoPlantillaResumen, type ExclusionesResumen } from '@agenia/shared';
import { updateContenidoResumenAction } from '@/app/actions/resumen-atencion';

const lista = (t: string) =>
    t
        .split(/[\n,;]+/)
        .map((x) => x.trim())
        .filter(Boolean);

/**
 * Lo que valida el comité de historias clínicas: lo que nunca se envía (D7), el
 * horario de envío (§3.8) y los campos de la historia que van al resumen (D2).
 */
export default function ContenidoResumen({
    exclusiones,
    horario,
    camposPlantilla,
}: {
    exclusiones: ExclusionesResumen;
    horario: { desdeHora: number; hastaHora: number };
    camposPlantilla: CampoPlantillaResumen[] | null;
}) {
    const router = useRouter();
    const [cie10, setCie10] = useState(exclusiones.cie10.join(', '));
    const [cups, setCups] = useState(exclusiones.cups.join(', '));
    const [especialidades, setEspecialidades] = useState(exclusiones.especialidades.join(', '));
    const [desde, setDesde] = useState(String(horario.desdeHora));
    const [hasta, setHasta] = useState(String(horario.hastaHora));
    const [propios, setPropios] = useState(camposPlantilla !== null);
    const [campos, setCampos] = useState<CampoPlantillaResumen[]>(camposPlantilla ?? CAMPOS_PLANTILLA_POR_DEFECTO);
    const [error, setError] = useState<string | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const [guardando, startGuardar] = useTransition();

    const cambiarCampo = (i: number, cambio: Partial<CampoPlantillaResumen>) =>
        setCampos((prev) => prev.map((c, j) => (j === i ? { ...c, ...cambio } : c)));

    const guardar = () => {
        setError(null);
        setAviso(null);
        startGuardar(async () => {
            const r = await updateContenidoResumenAction({
                exclusiones: { cie10: lista(cie10), cups: lista(cups), especialidades: lista(especialidades) },
                horario: { desdeHora: Number(desde), hastaHora: Number(hasta) },
                camposPlantilla: propios ? campos : null,
            });
            if (!r.success) {
                setError(r.error);
                return;
            }
            setAviso('Guardado. Rige desde el próximo resumen que se lea o se envíe.');
            router.refresh();
        });
    };

    const caja =
        'mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';

    return (
        <section className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" data-testid="contenido-resumen">
            <div>
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Contenido y horario</h2>
                <p className="text-xs text-zinc-500">
                    Lo valida el comité de historias clínicas del hospital: qué nunca se envía, a qué horas y qué campos de la
                    historia van al resumen.
                </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm text-zinc-700 dark:text-zinc-300">
                    Diagnósticos que no se envían (CIE-10)
                    <textarea value={cie10} onChange={(e) => setCie10(e.target.value)} rows={3} aria-label="Diagnósticos excluidos" className={caja} />
                    <span className="mt-1 block text-xs text-zinc-500">Prefijos: «F» excluye todo F00-F99.</span>
                </label>
                <label className="block text-sm text-zinc-700 dark:text-zinc-300">
                    Remisiones que no se envían (CUPS)
                    <textarea value={cups} onChange={(e) => setCups(e.target.value)} rows={3} aria-label="Remisiones excluidas" className={caja} />
                </label>
                <label className="block text-sm text-zinc-700 dark:text-zinc-300">
                    Servicios o especialidades que no se envían
                    <textarea
                        value={especialidades}
                        onChange={(e) => setEspecialidades(e.target.value)}
                        rows={3}
                        aria-label="Especialidades excluidas"
                        className={caja}
                    />
                    <span className="mt-1 block text-xs text-zinc-500">Basta una parte del nombre: «PSIQUIATR».</span>
                </label>
            </div>

            <div className="flex flex-wrap items-end gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <label>
                    Enviar desde las
                    <input type="number" min={0} max={23} value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde la hora" className={`${caja} w-24`} />
                </label>
                <label>
                    hasta las
                    <input type="number" min={1} max={24} value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta la hora" className={`${caja} w-24`} />
                </label>
                <span className="pb-2 text-xs text-zinc-500">Hora de la clínica. Lo que se cierre de noche sale al abrir el horario.</span>
            </div>

            <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-sm text-zinc-800 dark:text-zinc-200">
                    <label className="flex items-center gap-2">
                        <input type="radio" name="campos" checked={!propios} onChange={() => setPropios(false)} />
                        Campos de la historia: los del sistema
                    </label>
                    <label className="flex items-center gap-2">
                        <input
                            type="radio"
                            name="campos"
                            checked={propios}
                            onChange={() => setPropios(true)}
                            aria-label="Campos personalizados"
                        />
                        Personalizados
                    </label>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                                <th className="py-1 pr-2 font-medium">Plantilla</th>
                                <th className="py-1 pr-2 font-medium">Grupo</th>
                                <th className="py-1 pr-2 font-medium">Campo (nombre exacto en el HIS)</th>
                                <th className="py-1 pr-2 font-medium">Sección del resumen</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {(propios ? campos : CAMPOS_PLANTILLA_POR_DEFECTO).map((c, i) => (
                                <tr key={i} className="border-b border-zinc-100 dark:border-zinc-900">
                                    {propios ? (
                                        <>
                                            <td className="py-1 pr-2">
                                                <input
                                                    value={String(c.plantilla)}
                                                    onChange={(e) => cambiarCampo(i, { plantilla: Number(e.target.value.replace(/\D/g, '')) })}
                                                    aria-label={`Plantilla del campo ${i + 1}`}
                                                    className="w-20 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                                                />
                                            </td>
                                            <td className="py-1 pr-2">
                                                <input
                                                    value={c.grupo ?? ''}
                                                    onChange={(e) => cambiarCampo(i, { grupo: e.target.value || null })}
                                                    aria-label={`Grupo del campo ${i + 1}`}
                                                    className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                                                />
                                            </td>
                                            <td className="py-1 pr-2">
                                                <input
                                                    value={c.campo}
                                                    onChange={(e) => cambiarCampo(i, { campo: e.target.value })}
                                                    aria-label={`Nombre del campo ${i + 1}`}
                                                    className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                                                />
                                            </td>
                                            <td className="py-1 pr-2">
                                                <input
                                                    value={c.seccion}
                                                    onChange={(e) => cambiarCampo(i, { seccion: e.target.value })}
                                                    aria-label={`Sección del campo ${i + 1}`}
                                                    className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                                                />
                                            </td>
                                            <td className="py-1">
                                                <button
                                                    onClick={() => setCampos((prev) => prev.filter((_x, j) => j !== i))}
                                                    aria-label={`Quitar el campo ${i + 1}`}
                                                    className="text-xs text-zinc-500 hover:underline"
                                                >
                                                    Quitar
                                                </button>
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="py-1 pr-2 font-mono text-xs">{c.plantilla}</td>
                                            <td className="py-1 pr-2 text-xs text-zinc-600 dark:text-zinc-400">{c.grupo ?? '—'}</td>
                                            <td className="py-1 pr-2 text-xs">{c.campo}</td>
                                            <td className="py-1 pr-2 text-xs">{c.seccion}</td>
                                            <td />
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {propios && (
                    <button
                        onClick={() => setCampos((prev) => [...prev, { plantilla: 870, grupo: null, campo: '', seccion: '' }])}
                        className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                        Agregar campo
                    </button>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={guardar}
                    disabled={guardando}
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                >
                    {guardando ? 'Guardando…' : 'Guardar contenido y horario'}
                </button>
                {error && <span className="text-sm text-red-600">{error}</span>}
                {aviso && <span className="text-sm text-emerald-700 dark:text-emerald-400">{aviso}</span>}
            </div>
        </section>
    );
}
