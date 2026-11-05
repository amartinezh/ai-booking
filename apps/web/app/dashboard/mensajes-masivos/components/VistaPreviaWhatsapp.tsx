'use client';

import { CUERPO_SUGERIDO_COMUNICADO, cuerpoConVariables, nombreParaSaludo, textoParaEnviar, trozosConFormato } from '@agenia/shared';

/**
 * Cómo le llega el comunicado a una persona: el encabezado de imagen (con el
 * recorte horizontal que hace WhatsApp en la conversación), el cuerpo de la
 * plantilla con su nombre y el texto, y el pie. Con `aproximada`, el cuerpo es
 * el sugerido y no el aprobado en Meta (no se pudo leer de Meta).
 */
export default function VistaPreviaWhatsapp({
    clinica,
    cuerpo,
    pie,
    nombre,
    texto,
    imagenUrl,
    aproximada,
}: {
    clinica: string;
    cuerpo: string | null;
    pie: string | null;
    nombre: string | null;
    texto: string;
    imagenUrl: string | null;
    aproximada: boolean;
}) {
    const mensaje = textoParaEnviar(texto) || '…';
    const completo = cuerpoConVariables(cuerpo ?? CUERPO_SUGERIDO_COMUNICADO, [nombreParaSaludo(nombre), mensaje]);
    return (
        <div className="mx-auto w-full max-w-[340px]">
            <div className="overflow-hidden rounded-[2rem] border-8 border-zinc-900 bg-zinc-900 shadow-2xl">
                <div className="flex items-center gap-2 bg-[#075e54] px-3 py-2.5 text-white">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm font-bold">{clinica.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{clinica}</p>
                        <p className="text-[11px] text-white/70">Cuenta de empresa</p>
                    </div>
                </div>
                <div className="min-h-[420px] bg-[#efeae2] p-3 dark:bg-[#0b141a]">
                    <div className="max-w-[92%] overflow-hidden rounded-lg rounded-tl-none bg-white text-[13.5px] leading-snug text-zinc-900 shadow dark:bg-[#202c33] dark:text-zinc-100">
                        {imagenUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={imagenUrl} alt="Encabezado del comunicado" className="aspect-[1.91/1] w-full object-cover" />
                        )}
                        <div className="space-y-2 px-2.5 pb-1 pt-2">
                            {completo.split(/\n+/).map((parrafo, i) => (
                                <p key={i} className="whitespace-pre-wrap break-words">
                                    {trozosConFormato(parrafo).map((t, j) => (
                                        <span
                                            key={j}
                                            className={[
                                                t.negrita ? 'font-bold' : '',
                                                t.cursiva ? 'italic' : '',
                                                t.tachado ? 'line-through' : '',
                                                t.monoespaciado ? 'font-mono' : '',
                                            ].join(' ')}
                                        >
                                            {t.texto}
                                        </span>
                                    ))}
                                </p>
                            ))}
                            {pie && <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{pie}</p>}
                            <p className="text-right text-[10px] text-zinc-400">10:30 a. m.</p>
                        </div>
                    </div>
                </div>
            </div>
            <p className="mt-2 text-center text-xs text-zinc-500">
                {aproximada
                    ? 'Vista aproximada: el texto fijo es el sugerido; el real es el que se aprobó en Meta.'
                    : 'Con el texto de la plantilla aprobada en Meta.'}
                {imagenUrl ? ' En el chat la imagen se ve recortada así; al tocarla se ve completa.' : ''}
            </p>
        </div>
    );
}
