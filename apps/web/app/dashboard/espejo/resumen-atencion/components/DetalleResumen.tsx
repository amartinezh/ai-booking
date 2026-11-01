import type { ReactNode } from 'react';
import type { OrdenResumen, ResumenAtencionHis } from '@agenia/shared';
import { formatAppointmentShort, formatDateShort } from '@/lib/date';

/**
 * Un resumen de la atención tal como lo leyó el agente del HIS, para
 * compararlo campo por campo con lo que el médico escribió. No es el documento
 * que recibirá el paciente (eso es la Fase 2): es el dato crudo, ordenado.
 */

const TIPO_ORDEN: Record<OrdenResumen['tipo'], string> = {
    MEDICAMENTOS: 'Fórmula',
    LABORATORIO: 'Orden de laboratorio',
    PROCEDIMIENTO: 'Orden de procedimientos',
    CONSULTA: 'Orden de consulta',
    CIRUGIA: 'Orden de cirugía',
};

/** «1980-05-17» → «17/05/1980», sin pasar por Date (sería medianoche UTC: el día anterior en Bogotá). */
function fechaSinHora(iso: string | null): string | null {
    const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const fecha = (iso: string | null) => (iso ? formatDateShort(iso) : null);

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | number | null | undefined }) {
    if (valor === null || valor === undefined || valor === '') return null;
    return (
        <div className="flex gap-2 text-sm">
            <dt className="shrink-0 text-zinc-500">{etiqueta}:</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">{valor}</dd>
        </div>
    );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
    return (
        <section className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{titulo}</h4>
            {children}
        </section>
    );
}

function Orden({ o }: { o: OrdenResumen }) {
    return (
        <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {TIPO_ORDEN[o.tipo]} N.º {o.numero}
                {o.farmacia && <span className="ml-2 text-xs font-normal text-zinc-500">Farmacia {o.farmacia}</span>}
            </p>
            <dl className="grid gap-1 sm:grid-cols-2">
                <Dato etiqueta="Escrita" valor={fecha(o.escritaIso)} />
                <Dato etiqueta="Vale desde" valor={fecha(o.desdeIso)} />
                <Dato etiqueta="Serie" valor={o.serie} />
                <Dato etiqueta="Vigencia" valor={o.vigencia} />
            </dl>
            {o.medicamentos.length > 0 && (
                <ul className="space-y-2">
                    {o.medicamentos.map((m, i) => (
                        <li key={`${m.codigo}-${i}`} className="text-sm">
                            <p className="font-medium text-zinc-900 dark:text-zinc-100">
                                {m.nombre}
                                {m.entregado && (
                                    <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                        entregado
                                    </span>
                                )}
                            </p>
                            <p className="text-zinc-600 dark:text-zinc-400">
                                {[m.concentracion, m.forma, m.via && `vía ${m.via}`, m.cantidad !== null && `cantidad ${m.cantidad}`]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </p>
                            {m.indicacion && <p className="text-zinc-800 dark:text-zinc-200">{m.indicacion}</p>}
                            <p className="text-xs text-zinc-500">
                                {[
                                    m.frecuencia && `cada ${m.frecuencia}`,
                                    m.duracionDias !== null && `${m.duracionDias} día(s)`,
                                    `código ${m.codigo}`,
                                    m.cum && `CUM ${m.cum}`,
                                    m.invima && `Invima ${m.invima}`,
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
            {o.examenes.length > 0 && (
                <ul className="space-y-1">
                    {o.examenes.map((e, i) => (
                        <li key={`${e.codigo}-${i}`} className="text-sm">
                            <span className="font-mono text-xs text-zinc-500">{e.codigo}</span>{' '}
                            <span className="text-zinc-900 dark:text-zinc-100">{e.nombre}</span>
                            {e.cantidad !== null && e.cantidad !== 1 && <span className="text-zinc-500"> × {e.cantidad}</span>}
                            {e.indicacion && <span className="block text-zinc-600 dark:text-zinc-400">{e.indicacion}</span>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default function DetalleResumen({ resumen: r }: { resumen: ResumenAtencionHis }) {
    const h = r.historia;
    const p = r.paciente;
    // Los campos de la plantilla, agrupados por la sección del resumen («Motivo», «Plan»…).
    const secciones = new Map<string, { campo: string; valor: string }[]>();
    for (const c of r.campos) secciones.set(c.seccion, [...(secciones.get(c.seccion) ?? []), c]);

    return (
        <div className="space-y-4" data-testid="detalle-resumen">
            <dl className="grid gap-1 sm:grid-cols-2">
                <Dato etiqueta="Historia" valor={h.numero} />
                <Dato etiqueta="Guardada en el HIS" valor={formatAppointmentShort(h.guardadaIso)} />
                <Dato etiqueta="Servicio" valor={[h.servicio, h.nombreServicio].filter(Boolean).join(' · ')} />
                <Dato etiqueta="Plantilla" valor={[h.plantilla, h.nombrePlantilla].filter(Boolean).join(' · ')} />
                <Dato etiqueta="Especialidad" valor={h.especialidad} />
            </dl>

            <Seccion titulo="Paciente">
                <dl className="grid gap-1 sm:grid-cols-2">
                    <Dato etiqueta="Nombre" valor={p.nombre} />
                    <Dato etiqueta="Documento" valor={[p.tipoDocumento, p.documento].filter(Boolean).join(' ')} />
                    <Dato etiqueta="Nacimiento" valor={fechaSinHora(p.fechaNacimientoIso)} />
                    <Dato etiqueta="Edad" valor={h.edad} />
                    <Dato etiqueta="Celular" valor={p.celular} />
                    <Dato etiqueta="Correo" valor={p.correo} />
                    <Dato etiqueta="Celular del acompañante" valor={p.celularAcompanante} />
                    <Dato etiqueta="Correo del acompañante" valor={p.correoAcompanante} />
                </dl>
            </Seccion>

            <Seccion titulo="Médico y afiliación">
                <dl className="grid gap-1 sm:grid-cols-2">
                    <Dato etiqueta="Médico" valor={r.medico.nombre} />
                    <Dato etiqueta="Registro" valor={r.medico.registro} />
                    <Dato etiqueta="Administradora" valor={r.afiliacion.administradora} />
                    <Dato etiqueta="Convenio" valor={r.afiliacion.convenio} />
                    <Dato etiqueta="Tipo de usuario" valor={r.afiliacion.tipoUsuario} />
                </dl>
            </Seccion>

            <Seccion titulo="Diagnósticos">
                {r.diagnosticos.length === 0 ? (
                    <p className="text-sm text-zinc-500">Ninguno.</p>
                ) : (
                    <ul className="space-y-1 text-sm">
                        {r.diagnosticos.map((d, i) => (
                            <li key={`${d.cie10}-${i}`}>
                                <span className="font-mono text-xs text-zinc-500">{d.cie10}</span>{' '}
                                <span className="text-zinc-900 dark:text-zinc-100">{d.descripcion}</span>
                                <span className="text-xs text-zinc-500">
                                    {d.principal ? ' · principal' : ''}
                                    {d.tipo ? ` · ${d.tipo}` : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Seccion>

            {[...secciones].map(([seccion, campos]) => (
                <Seccion key={seccion} titulo={seccion}>
                    {campos.map((c, i) => (
                        <p key={`${c.campo}-${i}`} className="whitespace-pre-line text-sm text-zinc-900 dark:text-zinc-100">
                            {campos.length > 1 && <span className="text-zinc-500">{c.campo} </span>}
                            {c.valor}
                        </p>
                    ))}
                </Seccion>
            ))}

            {r.indicaciones.length > 0 && (
                <Seccion titulo="Indicaciones del médico">
                    {r.indicaciones.map((t, i) => (
                        <p key={i} className="whitespace-pre-line text-sm text-zinc-900 dark:text-zinc-100">
                            {t}
                        </p>
                    ))}
                </Seccion>
            )}

            {r.ordenes.length > 0 && (
                <Seccion titulo="Fórmula y órdenes">
                    <div className="space-y-3">
                        {r.ordenes.map((o) => (
                            <Orden key={`${o.tipo}-${o.numero}`} o={o} />
                        ))}
                    </div>
                </Seccion>
            )}

            {r.remisiones.length > 0 && (
                <Seccion titulo="Remisiones">
                    {r.remisiones.map((m) => (
                        <dl key={m.numero} className="grid gap-1 rounded-lg border border-zinc-200 p-3 sm:grid-cols-2 dark:border-zinc-800">
                            <Dato etiqueta="Remisión" valor={`N.º ${m.numero}`} />
                            <Dato etiqueta="Fecha" valor={fecha(m.fechaIso)} />
                            <Dato etiqueta="Remite a" valor={m.remiteA} />
                            <Dato etiqueta="Servicio pedido" valor={m.servicioPedido} />
                            <Dato etiqueta="CUPS" valor={m.cups} />
                            <Dato etiqueta="Prioridad" valor={m.prioridad} />
                            <Dato etiqueta="Motivo" valor={m.motivo} />
                            <Dato etiqueta="Observaciones" valor={m.observaciones} />
                            {m.casoClinicoCaracteres > 0 && (
                                <p className="text-xs text-zinc-500 sm:col-span-2">
                                    Tiene caso clínico ({m.casoClinicoCaracteres} caracteres): AgenIA no lo lee (D24).
                                </p>
                            )}
                        </dl>
                    ))}
                </Seccion>
            )}

            {r.incapacidades.length > 0 && (
                <Seccion titulo="Incapacidades">
                    {r.incapacidades.map((i) => (
                        <dl key={i.numero} className="grid gap-1 rounded-lg border border-zinc-200 p-3 sm:grid-cols-2 dark:border-zinc-800">
                            <Dato etiqueta="Incapacidad" valor={`N.º ${i.numero}`} />
                            <Dato etiqueta="Desde" valor={fecha(i.desdeIso)} />
                            <Dato etiqueta="Días" valor={i.dias} />
                            <Dato etiqueta="Prórroga" valor={i.prorroga ? 'Sí' : 'No'} />
                            <Dato etiqueta="Tipo" valor={i.tipo} />
                            <Dato etiqueta="Origen" valor={i.origen} />
                            <Dato etiqueta="Observación" valor={i.observacion} />
                        </dl>
                    ))}
                </Seccion>
            )}

            {r.interconsultas.length > 0 && (
                <Seccion titulo="Interconsultas">
                    {r.interconsultas.map((c, i) => (
                        <p key={i} className="text-sm text-zinc-900 dark:text-zinc-100">
                            {c.especialidad}
                            {c.observacion && <span className="text-zinc-600 dark:text-zinc-400"> — {c.observacion}</span>}
                        </p>
                    ))}
                </Seccion>
            )}
        </div>
    );
}
