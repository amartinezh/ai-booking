import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import type { SeccionDelResumen } from '@agenia/shared';
import { formatTimeOnly } from '@/lib/date';
import { COOKIE_ACCESO_RESUMEN, TOKEN_RESUMEN, llamarApiPublica } from '@/lib/resumen/api';
import FormularioFecha from './FormularioFecha';
import BotonSalir from './BotonSalir';

// Página PÚBLICA del resumen de la atención (plan §3.5, Fase 2). El enlace es
// un token de 128 bits; para ver algo hay que escribir la fecha de nacimiento
// (5 intentos, bloqueo de 1 hora). Todo lo decide y lo anota la API; esta
// página no guarda nada. En esta fase solo existen enlaces de prueba.
export const dynamic = 'force-dynamic';

export const metadata = {
    title: 'Resumen de su atención',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
};

type Estado =
    | { estado: 'PIDE_FECHA'; hospital: string }
    | { estado: 'BLOQUEADO'; hospital: string; hastaIso: string }
    | { estado: 'SIN_FECHA'; hospital: string }
    | { estado: 'NO_DISPONIBLE' };

interface Contenido {
    hospital: string;
    paciente: string;
    fechaConsulta: string;
    medico: string | null;
    actualizado: boolean;
    secciones: SeccionDelResumen[];
    pie: string;
    documentos: { id: string; titulo: string; hojas: number }[];
}

function Marco({ children }: { children: ReactNode }) {
    return (
        <main className="min-h-screen bg-[#f4f6f9] px-4 py-8 text-[#101a2a]">
            <div className="mx-auto w-full max-w-xl space-y-5">{children}</div>
        </main>
    );
}

function Aviso({ hospital, titulo, texto }: { hospital?: string; titulo: string; texto: string }) {
    return (
        <Marco>
            <div className="space-y-3 rounded-2xl border border-[#dde3eb] bg-white p-6 shadow-sm">
                {hospital && <p className="text-sm uppercase tracking-wider text-[#586378]">{hospital}</p>}
                <h1 className="text-2xl font-semibold">{titulo}</h1>
                <p className="text-lg leading-relaxed text-[#38445a]">{texto}</p>
            </div>
        </Marco>
    );
}

async function contenido(token: string): Promise<Contenido | null> {
    const acceso = (await cookies()).get(COOKIE_ACCESO_RESUMEN)?.value;
    if (!acceso) return null;
    try {
        const res = await llamarApiPublica('content', { token, acceso });
        return res.ok ? ((await res.json()) as Contenido) : null;
    } catch {
        return null;
    }
}

export default async function ResumenPage(props: { params: Promise<{ token: string }> }) {
    const { token } = await props.params;
    const noDisponible = (
        <Aviso
            titulo="Este enlace no está disponible"
            texto="Puede que haya vencido: los documentos se pueden ver durante 30 días. Pídalos en el hospital."
        />
    );
    if (!TOKEN_RESUMEN.test(token)) return noDisponible;

    const c = await contenido(token);
    if (c) {
        const base = `/resumen/${token}/documento`;
        return (
            <Marco>
                <header className="space-y-1">
                    <p className="text-sm uppercase tracking-wider text-[#586378]">{c.hospital}</p>
                    <h1 className="text-3xl font-semibold">Resumen de su atención</h1>
                    <p className="text-lg text-[#38445a]">
                        {c.paciente} · consulta del {c.fechaConsulta}
                        {c.medico ? ` · ${c.medico}` : ''}
                    </p>
                    {c.actualizado && (
                        <p className="text-base text-[#8a5a00]">El médico actualizó esta historia después de la consulta.</p>
                    )}
                </header>

                <section className="space-y-3 rounded-2xl border border-[#dde3eb] bg-white p-5 shadow-sm">
                    <h2 className="text-xl font-semibold">Sus documentos</h2>
                    <p className="text-base text-[#586378]">
                        Puede descargarlos e imprimirlos. Son una copia informativa: para reclamar medicamentos o hacerse los
                        exámenes, siga las indicaciones del hospital y de su EPS.
                    </p>
                    <ul className="divide-y divide-[#eef1f5]">
                        {c.documentos.map((d) => (
                            <li key={d.id} className="space-y-2 py-3">
                                <p className="text-lg font-medium">{d.titulo}</p>
                                <div className="flex flex-wrap gap-2">
                                    <a
                                        href={`${base}?doc=${d.id}&formato=pdf&descargar=1`}
                                        className="rounded-xl bg-[#2a78d6] px-4 py-2.5 text-base font-medium text-white"
                                    >
                                        Descargar PDF
                                    </a>
                                    {Array.from({ length: d.hojas }, (_, i) => (
                                        <a
                                            key={i}
                                            href={`${base}?doc=${d.id}&formato=png&hoja=${i + 1}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="rounded-xl border border-[#2a78d6] px-4 py-2.5 text-base font-medium text-[#2a78d6]"
                                        >
                                            Ver imagen{d.hojas > 1 ? ` (hoja ${i + 1})` : ''}
                                        </a>
                                    ))}
                                </div>
                            </li>
                        ))}
                    </ul>
                    {c.documentos.length > 1 && (
                        <a href={`${base}?doc=todo&formato=pdf&descargar=1`} className="inline-block text-base font-medium text-[#2a78d6] underline">
                            Descargar todos en un solo PDF
                        </a>
                    )}
                </section>

                <section className="space-y-4 rounded-2xl border border-[#dde3eb] bg-white p-5 shadow-sm">
                    {c.secciones.map((s) => (
                        <div key={s.titulo} className="space-y-1">
                            <h2 className="text-xl font-semibold">{s.titulo}</h2>
                            <ul className="list-disc space-y-1 pl-5 text-lg leading-relaxed text-[#26324a]">
                                {s.renglones.map((r, i) => (
                                    <li key={i} className="whitespace-pre-line">
                                        {r}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                    <p className="border-t border-[#eef1f5] pt-3 text-base text-[#586378]">{c.pie}</p>
                </section>

                <BotonSalir token={token} />
            </Marco>
        );
    }

    let estado: Estado = { estado: 'NO_DISPONIBLE' };
    try {
        const res = await llamarApiPublica('open', { token });
        if (res.ok) estado = (await res.json()) as Estado;
    } catch {
        return (
            <Aviso titulo="No pudimos abrir la página" texto="Hubo un problema de conexión. Intente de nuevo en unos minutos." />
        );
    }

    switch (estado.estado) {
        case 'PIDE_FECHA':
            return (
                <Marco>
                    <FormularioFecha token={token} hospital={estado.hospital} />
                </Marco>
            );
        case 'BLOQUEADO':
            return (
                <Aviso
                    hospital={estado.hospital}
                    titulo="Intente más tarde"
                    texto={`Por seguridad, después de varios intentos el enlace queda bloqueado una hora. Puede volver a intentar después de las ${formatTimeOnly(new Date(estado.hastaIso))}.`}
                />
            );
        case 'SIN_FECHA':
            return (
                <Aviso
                    hospital={estado.hospital}
                    titulo="Pida sus documentos en el hospital"
                    texto="No podemos confirmar su identidad en línea porque el hospital no tiene registrada su fecha de nacimiento."
                />
            );
        default:
            return noDisponible;
    }
}
