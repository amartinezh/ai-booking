import type { Bloque, DocumentoPolitica } from '@/lib/politica-datos/documento';
import BotonImprimir from './BotonImprimir';

/**
 * La política, para leer en el celular y para imprimir. Página clara siempre
 * (igual que las estadísticas públicas): es un documento, no el panel.
 */
export default function Politica({ documento }: { documento: DocumentoPolitica }) {
    return (
        <main lang="es" className="min-h-screen bg-[#f4f6f9] text-[#16202e] print:bg-white">
            <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12 print:max-w-none print:py-0">
                <header id="inicio" className="border-b border-[#d9dfe8] pb-6">
                    <p className="text-sm font-semibold uppercase tracking-wide text-[#3d5a80]">{documento.responsable}</p>
                    <h1 className="mt-2 text-3xl font-bold leading-tight text-[#0f1b2d] sm:text-4xl">{documento.titulo}</h1>
                    <p className="mt-3 text-[15px] text-[#4a5568]">
                        Versión {documento.version} · Vigente desde el {documento.vigenteDesde} · Ley 1581 de 2012 y Decreto
                        1377 de 2013
                    </p>
                    <div className="mt-4">
                        <BotonImprimir />
                    </div>
                </header>

                <section
                    aria-labelledby="resumen"
                    className="mt-8 rounded-xl border border-[#cfe3d8] border-l-4 border-l-[#2f855a] bg-white p-5 print:break-inside-avoid"
                >
                    <h2 id="resumen" className="text-lg font-bold text-[#0f1b2d]">
                        En pocas palabras
                    </h2>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed">
                        {documento.resumen.map((linea) => (
                            <li key={linea}>{linea}</li>
                        ))}
                    </ul>
                </section>

                <nav aria-labelledby="contenido" className="mt-8 rounded-xl border border-[#d9dfe8] bg-white p-5 print:hidden">
                    <h2 id="contenido" className="text-lg font-bold text-[#0f1b2d]">
                        Contenido
                    </h2>
                    <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-[15px] sm:grid-cols-2">
                        {documento.secciones.map((s, i) => (
                            <li key={s.id}>
                                <a href={`#${s.id}`} className="text-[#1d4ed8] underline-offset-2 hover:underline">
                                    {i + 1}. {s.titulo}
                                </a>
                            </li>
                        ))}
                    </ol>
                </nav>

                {documento.secciones.map((s, i) => (
                    <section key={s.id} id={s.id} aria-labelledby={`${s.id}-titulo`} className="mt-10 scroll-mt-6">
                        <h2 id={`${s.id}-titulo`} className="text-xl font-bold text-[#0f1b2d] sm:text-2xl">
                            {i + 1}. {s.titulo}
                        </h2>
                        <div className="mt-3 space-y-4 text-[15px] leading-relaxed sm:text-base">
                            {s.bloques.map((b, j) => (
                                <BloqueDeTexto key={j} bloque={b} />
                            ))}
                        </div>
                    </section>
                ))}

                <footer className="mt-12 border-t border-[#d9dfe8] pt-6 text-sm text-[#4a5568]">
                    <p>
                        {documento.titulo} de {documento.responsable}. Versión {documento.version}, vigente desde el{' '}
                        {documento.vigenteDesde}.
                    </p>
                    <p className="mt-1">Publicada en la plataforma AgenIA.</p>
                    <a href="#inicio" className="mt-3 inline-block text-[#1d4ed8] hover:underline print:hidden">
                        Volver arriba ↑
                    </a>
                </footer>
            </div>
        </main>
    );
}

function BloqueDeTexto({ bloque }: { bloque: Bloque }) {
    switch (bloque.tipo) {
        case 'parrafo':
            return <p>{bloque.texto}</p>;
        case 'lista':
            return (
                <ul className="list-disc space-y-1.5 pl-5">
                    {bloque.items.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </ul>
            );
        case 'numerada':
            return (
                <ol className="list-decimal space-y-1.5 pl-6">
                    {bloque.items.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </ol>
            );
        case 'definiciones':
            return (
                <dl className="divide-y divide-[#e3e8ef] rounded-xl border border-[#d9dfe8] bg-white">
                    {bloque.items.map(({ termino, texto }) => (
                        <div key={termino} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-4">
                            <dt className="font-semibold text-[#0f1b2d]">{termino}</dt>
                            <dd className="wrap-break-word text-[#2d3748]">{texto}</dd>
                        </div>
                    ))}
                </dl>
            );
        case 'tabla':
            // En el celular, cada fila apilada (una tabla de dos columnas no cabe);
            // desde pantallas medianas, y al imprimir, la tabla.
            return (
                <>
                    <dl className="divide-y divide-[#e3e8ef] rounded-xl border border-[#d9dfe8] bg-white sm:hidden print:hidden">
                        {bloque.filas.map(([a, b]) => (
                            <div key={a} className="px-4 py-3">
                                <dt className="font-semibold text-[#0f1b2d]">{a}</dt>
                                <dd className="mt-1 text-[#2d3748]">
                                    <span className="sr-only">{bloque.columnas[1]}: </span>
                                    {b}
                                </dd>
                            </div>
                        ))}
                    </dl>
                    <div className="hidden rounded-xl border border-[#d9dfe8] bg-white sm:block print:block">
                        <table className="w-full border-collapse text-left">
                            <thead className="bg-[#eef2f8] text-[#0f1b2d]">
                                <tr>
                                    {bloque.columnas.map((c) => (
                                        <th key={c} scope="col" className="px-4 py-2.5 font-semibold">
                                            {c}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e3e8ef]">
                                {bloque.filas.map(([a, b]) => (
                                    <tr key={a}>
                                        <th scope="row" className="px-4 py-2.5 align-top font-normal">
                                            {a}
                                        </th>
                                        <td className="px-4 py-2.5 align-top">{b}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            );
        case 'nota':
            return (
                <p className="rounded-xl border border-[#c9d8f0] bg-[#eef4fd] px-4 py-3 text-[#1e3a5f] print:break-inside-avoid">
                    {bloque.texto}
                </p>
            );
    }
}
