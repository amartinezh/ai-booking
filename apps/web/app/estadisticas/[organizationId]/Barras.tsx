'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';

/**
 * 📊 Barras (apiladas si hay más de una serie) para la página de estadísticas.
 * Mide su ancho para que los textos del eje no se encojan en el celular, y al
 * pasar el mouse (o tocar) una columna muestra su detalle.
 */

export interface SerieDeBarras {
    nombre: string;
    color: string;
}

export interface ColumnaDeBarras {
    /** Texto bajo la columna (se salta etiquetas si no caben). */
    etiqueta: string;
    /** Cabeza del detalle. */
    titulo: string;
    /** Un valor por serie, de abajo hacia arriba. */
    valores: number[];
    /** Líneas del detalle; con color, llevan su muestra. */
    detalle: { color?: string; texto: string }[];
}

const nf = new Intl.NumberFormat('es-CO');
// Ancho aproximado de un carácter a 12 px: alcanza para decidir márgenes y saltos.
const ANCHO_LETRA = 6.6;

function marcas(max: number, n: number): number[] {
    if (max <= 0) return [0, 1];
    const paso0 = max / n;
    const mag = Math.pow(10, Math.floor(Math.log10(paso0)));
    const paso = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((p) => p >= paso0) ?? mag * 10;
    const out: number[] = [];
    for (let v = 0; v <= max + 1e-9; v += paso) out.push(v);
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + paso);
    return out;
}

export default function Barras({
    columnas,
    series,
    alto,
    descripcion,
    conEjeY = true,
    conValores = false,
    anchoMaxBarra = 40,
}: {
    columnas: ColumnaDeBarras[];
    series: SerieDeBarras[];
    alto: number;
    descripcion: string;
    conEjeY?: boolean;
    conValores?: boolean;
    anchoMaxBarra?: number;
}) {
    const caja = useRef<HTMLDivElement>(null);
    const [ancho, setAncho] = useState(640);
    const [activa, setActiva] = useState<{ i: number; x: number; y: number } | null>(null);

    useEffect(() => {
        const el = caja.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([e]) => setAncho(Math.max(280, Math.round(e.contentRect.width))));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const total = (c: ColumnaDeBarras) => c.valores.reduce((a, v) => a + v, 0);
    const tk = conEjeY ? marcas(Math.max(0, ...columnas.map(total)), 4) : [];
    const maxY = conEjeY ? tk[tk.length - 1] : Math.max(1, ...columnas.map(total));
    const ml = conEjeY ? Math.max(...tk.map((v) => nf.format(v).length)) * ANCHO_LETRA + 10 : 0;
    const mt = conValores ? 22 : 8;
    const mb = 28;
    const mr = 4;
    const y = (v: number) => mt + (alto - mt - mb) * (1 - v / maxY);
    const paso = (ancho - ml - mr) / Math.max(1, columnas.length);
    const bw = Math.min(anchoMaxBarra, paso * 0.68);
    const anchoEtiqueta = Math.max(0, ...columnas.map((c) => c.etiqueta.length)) * ANCHO_LETRA + 10;
    const cada = Math.max(1, Math.ceil(anchoEtiqueta / paso));

    const mover = (i: number) => (ev: PointerEvent) => {
        const r = caja.current?.getBoundingClientRect();
        if (!r) return;
        setActiva({ i, x: ev.clientX - r.left, y: ev.clientY - r.top });
    };

    const col = activa ? columnas[activa.i] : null;

    return (
        <div ref={caja} className="relative">
            <svg
                viewBox={`0 0 ${ancho} ${alto}`}
                role="img"
                aria-label={descripcion}
                className="block w-full h-auto overflow-visible"
                onPointerLeave={() => setActiva(null)}
            >
                {tk.map((v) => (
                    <g key={v}>
                        <line x1={ml} x2={ancho - mr} y1={y(v)} y2={y(v)} stroke="#e9edf3" />
                        <text x={ml - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-[#586378] text-[12px]">
                            {nf.format(v)}
                        </text>
                    </g>
                ))}
                {columnas.map((c, i) => {
                    const cx = ml + paso * i + paso / 2;
                    let base = 0;
                    return (
                        <g key={i}>
                            {i % cada === 0 && (
                                <text x={cx} y={alto - 8} textAnchor="middle" className="fill-[#586378] text-[12px]">
                                    {c.etiqueta}
                                </text>
                            )}
                            {c.valores.map((v, k) => {
                                if (v <= 0) return null;
                                const arriba = y(base + v);
                                const abajo = y(base) - (base > 0 ? 2 : 0);
                                base += v;
                                return (
                                    <rect
                                        key={k}
                                        x={cx - bw / 2}
                                        width={bw}
                                        y={arriba}
                                        height={Math.max(1, abajo - arriba)}
                                        rx={Math.min(3, bw / 2)}
                                        fill={series[k]?.color}
                                    />
                                );
                            })}
                            {conValores && total(c) > 0 && (
                                <text x={cx} y={y(total(c)) - 6} textAnchor="middle" className="fill-[#101a2a] text-[12px] tabular-nums">
                                    {nf.format(total(c))}
                                </text>
                            )}
                            <rect
                                x={cx - paso / 2}
                                width={paso}
                                y={0}
                                height={alto - mb + 4}
                                fill="transparent"
                                onPointerMove={mover(i)}
                                onPointerDown={mover(i)}
                            />
                        </g>
                    );
                })}
                <line x1={ml} x2={ancho - mr} y1={y(0)} y2={y(0)} stroke="#dde3eb" />
            </svg>
            {activa && col && (
                <div
                    role="tooltip"
                    className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-[#dde3eb] bg-white px-2.5 py-1.5 text-[13px] leading-snug shadow-lg"
                    style={{
                        left: Math.max(8, Math.min(ancho - 220, activa.x + 12)),
                        top: Math.max(8, activa.y - 24 - col.detalle.length * 19),
                    }}
                >
                    <div className="text-[#586378]">{col.titulo}</div>
                    {col.detalle.map((d, k) => (
                        <div key={k} className="flex items-center gap-1.5 tabular-nums">
                            {d.color && <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: d.color }} />}
                            {d.texto}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
