'use client';

import { useState, useTransition } from 'react';
import { ShieldCheck } from 'lucide-react';
import { setMyAutorizacionDatos } from '@/app/actions/settings';
import { formatAppointmentCompact } from '@/lib/date';
import { avisoAutorizacionDatos, type EstiloAviso } from '@agenia/shared';
import type { PaginaPoliticaDatos as Pagina } from '@/app/actions/politica-datos';
import PaginaPoliticaDatos from './PaginaPoliticaDatos';
import { AvisoSinGuardar, useAvisoAlSalir } from './CambiosSinGuardar';

export interface AutorizacionDatosGuardada {
    encendida: boolean;
    urlPolitica: string;
    version: string;
    ultimoCambio: { en: string; por: string } | null;
}

/**
 * 🔒 Autorización de datos (Ley 1581, docs/PLAN_AUTORIZACION_DATOS.md).
 * Encendida, el asistente saluda, explica la política y pregunta SÍ o NO antes
 * de agendar. Se guarda con su botón (son tres datos que van juntos) y muestra
 * el mensaje exacto que recibe el paciente.
 */
export default function AutorizacionDatosSetting({
    inicial,
    nombreAsistente,
    nombreClinica,
    estilo,
    pagina,
}: {
    inicial: AutorizacionDatosGuardada;
    nombreAsistente: string;
    nombreClinica: string;
    estilo: EstiloAviso;
    /** La página pública de la política (lib/politica-datos); sin ella no se muestra el bloque. */
    pagina?: Pagina | null;
}) {
    const [guardada, setGuardada] = useState(inicial);
    const [encendida, setEncendida] = useState(inicial.encendida);
    const [url, setUrl] = useState(inicial.urlPolitica);
    const [version, setVersion] = useState(inicial.version);
    const [error, setError] = useState<string | null>(null);
    const [listo, setListo] = useState(false);
    const [verAviso, setVerAviso] = useState(false);
    const [isPending, startTransition] = useTransition();

    const cambiaVersion = version.trim() !== guardada.version;
    const hayCambios = encendida !== guardada.encendida || url.trim() !== guardada.urlPolitica || cambiaVersion;

    useAvisoAlSalir(hayCambios);

    const enviar = (entrada: { encendida: boolean; urlPolitica: string; version: string }) => {
        setError(null);
        setListo(false);
        startTransition(async () => {
            const res = await setMyAutorizacionDatos(entrada);
            if (res.success) {
                setGuardada(res.autorizacionDatos);
                setEncendida(res.autorizacionDatos.encendida);
                setUrl(res.autorizacionDatos.urlPolitica);
                setVersion(res.autorizacionDatos.version);
                setListo(true);
                setTimeout(() => setListo(false), 3000);
            } else {
                setError(res.error ?? 'No se pudo guardar el cambio.');
            }
        });
    };
    const guardar = () => enviar({ encendida, urlPolitica: url, version });
    // «Usar este enlace» de la página de AgenIA: cambia solo el enlace, con lo
    // demás como está guardado (lo que se esté editando arriba se descarta).
    const usarEnlaceDeLaPagina = (enlace: string) =>
        enviar({ encendida: guardada.encendida, urlPolitica: enlace, version: guardada.version });

    const aviso = avisoAutorizacionDatos({
        estilo,
        asistente: nombreAsistente || 'el asistente',
        clinica: nombreClinica || 'la clínica',
        urlPolitica: url.trim() || null,
    });

    const input =
        'w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white disabled:opacity-50';

    return (
        <section>
            <div className="mb-5 flex items-start gap-3">
                <div className="rounded-xl p-2.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Autorización de datos (Ley 1581)</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Encendida, antes de agendar el asistente saluda, explica para qué se usan los datos y pregunta si
                        la persona autoriza su tratamiento. Si responde <strong>SÍ</strong>, queda guardado y sigue; si
                        responde <strong>NO</strong>, se despide con amabilidad y le da el teléfono y la ventanilla.
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <button
                        type="button"
                        role="switch"
                        aria-checked={encendida}
                        aria-label="Pedir la autorización antes de agendar"
                        disabled={isPending}
                        onClick={() => setEncendida((v) => !v)}
                        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                            encendida ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-700'
                        }`}
                    >
                        <span
                            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                encendida ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white" role="status">
                        {guardada.encendida
                            ? 'Encendida: el asistente pide la autorización antes de agendar'
                            : 'Apagada: el asistente no la pide (el resumen de la cita sigue con el aviso de la Ley 1581)'}
                        {listo && !isPending && (
                            <span className="ml-2 text-emerald-600 dark:text-emerald-400">✓ Guardado</span>
                        )}
                    </p>
                </div>

                <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Enlace de la política de tratamiento de datos de la clínica
                    <input
                        type="url"
                        value={url}
                        disabled={isPending}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://www.hospital.gov.co/politica-de-datos"
                        maxLength={300}
                        className={input}
                    />
                    {pagina && !pagina.publicada && !url.trim() && (
                        <span className="text-xs text-zinc-400">
                            ¿La clínica no tiene una política publicada? Más abajo, en «Página de la política en AgenIA»,
                            puede publicar una.
                        </span>
                    )}
                </label>

                <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300 sm:max-w-xs">
                    Versión de la política
                    <input
                        value={version}
                        disabled={isPending}
                        onChange={(e) => setVersion(e.target.value)}
                        maxLength={20}
                        className={input}
                    />
                    <span className="text-xs text-zinc-400">
                        Cámbiela solo si la política cambió de fondo: a todos se les volverá a preguntar.
                    </span>
                </label>

                {cambiaVersion && guardada.encendida && (
                    <p
                        role="note"
                        className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200"
                    >
                        Al guardar la versión {version.trim() || '(vacía)'}, el asistente le volverá a pedir la
                        autorización a todos los que ya la habían dado, la próxima vez que quieran agendar.
                    </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                    <AvisoSinGuardar visible={hayCambios} />
                    <button
                        type="button"
                        onClick={guardar}
                        disabled={isPending || !hayCambios}
                        className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isPending ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setVerAviso((v) => !v)}
                        aria-expanded={verAviso}
                        className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        {verAviso ? 'Ocultar el mensaje' : 'Ver el mensaje que recibe el paciente'}
                    </button>
                </div>

                {verAviso && (
                    <pre
                        aria-label="Mensaje de autorización"
                        className="whitespace-pre-wrap rounded-xl bg-zinc-50 dark:bg-zinc-800/60 p-4 font-sans text-sm text-zinc-700 dark:text-zinc-200"
                    >
                        {aviso}
                    </pre>
                )}

                <ul className="text-sm text-zinc-500 dark:text-zinc-400 list-disc pl-5 space-y-1">
                    <li>Se pregunta una vez por número (y por canal) y por versión de la política.</li>
                    <li>
                        No se pregunta para cancelar, cambiar la fecha o consultar una cita, ni al responder un
                        recordatorio, una oferta de la lista de espera o los documentos de la consulta. La emergencia
                        siempre va primero.
                    </li>
                    <li>
                        Quien escribe «Retiro mi autorización» la retira; para volver a agendar por el chat se le pide de
                        nuevo.
                    </li>
                    <li>Las cifras (quién aceptó, quién no, quién no respondió) están en Canales en vivo.</li>
                </ul>
                <p className="text-xs text-zinc-400">
                    El texto lo debe aprobar la oficina jurídica o el oficial de protección de datos de la clínica, que es
                    la responsable de los datos.
                </p>
            </div>
            {error && (
                <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                    Error al guardar: {error}
                </p>
            )}
            {guardada.ultimoCambio && (
                <p className="mt-2 text-xs text-zinc-400">
                    Último cambio: {guardada.ultimoCambio.por} ·{' '}
                    {formatAppointmentCompact(new Date(guardada.ultimoCambio.en))}
                </p>
            )}
            {pagina && (
                <PaginaPoliticaDatos
                    inicial={pagina}
                    enlaceGuardado={guardada.urlPolitica}
                    onUsarEnlace={usarEnlaceDeLaPagina}
                    ocupado={isPending}
                />
            )}
        </section>
    );
}
