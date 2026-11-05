'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { TEXTO_HORARIO_COMUNICADOS } from '@agenia/shared';
import { formatAppointmentCompact } from '@/lib/date';
import { confirmarEnvio, enviarPrueba, guardarBorrador, previaDelEnvio, verContactosDeLista } from '@/app/actions/mensajes-masivos';
import type { EstadoMensajesMasivos, PreviaEnvioDto } from '@/app/actions/mensajes-masivos.types';
import VistaPreviaWhatsapp from './VistaPreviaWhatsapp';
import { Aviso, Boton, Punto, Tarjeta, campo, numero, type Nivel } from './ui';

const CALIDAD: Record<string, { nivel: Nivel; texto: string }> = {
    GREEN: { nivel: 'BIEN', texto: 'alta' },
    YELLOW: { nivel: 'AVISO', texto: 'media: hay bloqueos o reportes recientes' },
    RED: { nivel: 'ERROR', texto: 'baja: Meta puede limitar los envíos' },
};
const NIVEL_META: Record<string, number> = { TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10000, TIER_100K: 100000 };

/**
 * Paso 3: revisar y enviar (docs/PLAN_MENSAJES_MASIVOS.md §8). La API dice qué
 * se va a enviar y qué lo impide; aquí se ve la vista previa con el nombre de
 * varias personas de la lista, se manda una prueba al propio celular y se
 * confirma escribiendo la cantidad de personas.
 */
export default function PasoRevision({
    borradorId,
    listaId,
    clinica,
    imagenUrl,
    estado,
    onVolver,
}: {
    borradorId: string;
    listaId: string;
    clinica: string;
    imagenUrl: string | null;
    estado: EstadoMensajesMasivos | null;
    onVolver: () => void;
}) {
    const router = useRouter();
    const [previa, setPrevia] = useState<PreviaEnvioDto | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [nombres, setNombres] = useState<Array<string | null>>([]);
    const [cual, setCual] = useState(0);
    const [prueba, setPrueba] = useState({ telefono: '', nombre: '', enviando: false });
    const [confirmar, setConfirmar] = useState(false);

    const cargar = useCallback(
        () =>
            previaDelEnvio(borradorId).then((r) => {
                if (r.success) {
                    setPrevia(r.previa);
                    setError(null);
                } else setError(r.error);
            }),
        [borradorId],
    );

    useEffect(() => {
        void cargar();
        void verContactosDeLista(listaId, { pagina: 1 }).then((r) => r.success && setNombres(r.contactos.slice(0, 5).map((c) => c.nombre)));
    }, [cargar, listaId]);

    const cambiarRitmo = async (ritmo: number) => {
        await guardarBorrador(borradorId, { ritmo });
        await cargar();
    };

    const probar = async () => {
        setPrueba((p) => ({ ...p, enviando: true }));
        const r = await enviarPrueba(borradorId, prueba.telefono, prueba.nombre);
        setPrueba((p) => ({ ...p, enviando: false }));
        if (r.success) toast.success('Prueba enviada. Revísela en el celular antes de confirmar.');
        else toast.error(r.error);
    };

    if (error) {
        return (
            <div className="space-y-3">
                <Aviso nivel="ERROR" titulo="No se pudo preparar el envío">{error}</Aviso>
                <Boton onClick={onVolver}>Volver al mensaje</Boton>
            </div>
        );
    }
    if (!previa) return <p className="text-sm text-zinc-500">Preparando el envío…</p>;

    const numeroMeta = estado?.numero;
    const limiteDiario = numeroMeta?.nivel ? NIVEL_META[numeroMeta.nivel] : undefined;
    const calidad = numeroMeta?.calidad ? CALIDAD[numeroMeta.calidad] : undefined;
    const errores = previa.problemasTexto.filter((p) => p.nivel === 'ERROR').length;
    const avisos = previa.problemasTexto.filter((p) => p.nivel === 'AVISO').length;
    const plantillaLista = previa.plantilla.configurada && !previa.plantilla.problemas.length;

    const filas: Array<{ nivel: Nivel; titulo: string; detalle: string }> = [
        {
            nivel: previa.aEnviar > 0 ? 'BIEN' : 'ERROR',
            titulo: `${numero(previa.aEnviar)} persona(s) recibirán el mensaje`,
            detalle:
                previa.bajas + previa.bajasEnMeta
                    ? `De ${numero(previa.contactos)} en la lista: ${numero(previa.bajas)} pidieron no recibir comunicados y ${numero(previa.bajasEnMeta)} bloquearon a la clínica en WhatsApp. A ellas no se les envía.`
                    : `Todos los contactos de la lista.`,
        },
        {
            nivel: errores ? 'ERROR' : avisos ? 'AVISO' : 'BIEN',
            titulo: errores ? 'El texto tiene errores' : avisos ? `El texto tiene ${avisos} aviso(s) sin resolver` : 'Texto revisado',
            detalle: errores ? 'Vuelva al mensaje y corríjalos.' : avisos ? 'Puede enviarse, pero revíselos antes.' : 'Sin observaciones de las reglas.',
        },
        {
            nivel: plantillaLista ? (previa.plantilla.verificadaConMeta ? 'BIEN' : 'AVISO') : 'ERROR',
            titulo: `Plantilla ${previa.tipoPlantilla === 'MASS_MESSAGE_IMAGE' ? 'con imagen' : 'sin imagen'}: ${previa.plantilla.nombre ?? 'sin registrar'}`,
            detalle: previa.plantilla.problemas.length
                ? previa.plantilla.problemas.join(' ')
                : previa.plantilla.verificadaConMeta
                  ? `Aprobada en Meta (categoría ${previa.plantilla.categoria?.toLowerCase() ?? '—'}).`
                  : 'No se pudo comprobar con Meta (falta el id de la cuenta de WhatsApp Business en Configuración → WhatsApp). Haga una prueba.',
        },
        {
            nivel: calidad?.nivel ?? 'INFO',
            titulo: `Número de WhatsApp${numeroMeta?.numero ? ` ${numeroMeta.numero}` : ''}`,
            detalle: [
                calidad ? `Calidad ${calidad.texto}.` : 'Meta no informó la calidad.',
                limiteDiario
                    ? `Puede escribirle a ${numero(limiteDiario)} personas distintas en 24 horas${previa.aEnviar > limiteDiario ? `: con ${numero(previa.aEnviar)}, Meta frenará el resto hasta el día siguiente` : ''}.`
                    : '',
            ].join(' '),
        },
        {
            nivel: previa.horarioAbierto ? 'BIEN' : 'INFO',
            titulo: previa.horarioAbierto ? 'Sale enseguida' : `Saldrá desde el ${formatAppointmentCompact(previa.saleDesde)}`,
            detalle: `Solo se envía ${TEXTO_HORARIO_COMUNICADOS}. A ${previa.ritmoPorMinuto} por minuto tarda unos ${numero(previa.minutosEstimados)} minuto(s): terminaría el ${formatAppointmentCompact(previa.terminaria)}.`,
        },
    ];

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
                <Tarjeta titulo="Antes de enviar">
                    <ul className="space-y-3">
                        {filas.map((f) => (
                            <li key={f.titulo} className="flex gap-3">
                                <span className="mt-1.5">
                                    <Punto nivel={f.nivel} />
                                </span>
                                <div>
                                    <p className="font-semibold text-zinc-900 dark:text-white">{f.titulo}</p>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{f.detalle}</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <label className="mt-4 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                        Ritmo
                        <select className={`${campo} w-auto py-1.5`} value={previa.ritmoPorMinuto} onChange={(e) => void cambiarRitmo(Number(e.target.value))}>
                            {[30, 60, 120].map((r) => (
                                <option key={r} value={r}>
                                    {r} por minuto{r === 60 ? ' (recomendado)' : ''}
                                </option>
                            ))}
                        </select>
                    </label>
                    <p className="mt-1 text-xs text-zinc-500">
                        Meta cobra cada mensaje de marketing entregado, según su tarifa para Colombia. Más lento cuida la calidad del número.
                    </p>
                    {previa.bloqueos.length > 0 && (
                        <div className="mt-4">
                            <Aviso nivel="ERROR" titulo="No se puede enviar todavía">
                                <ul className="list-disc pl-4">{previa.bloqueos.map((b, i) => <li key={i}>{b}</li>)}</ul>
                            </Aviso>
                        </div>
                    )}
                </Tarjeta>

                <Tarjeta titulo="Enviarme una prueba" subtitulo="Llega igual que a los pacientes. No cuenta en el envío.">
                    <div className="flex flex-wrap gap-2">
                        <input className={`${campo} w-48`} placeholder="Su celular" inputMode="tel" value={prueba.telefono} onChange={(e) => setPrueba((p) => ({ ...p, telefono: e.target.value }))} />
                        <input className={`${campo} w-40`} placeholder="Nombre para el saludo" value={prueba.nombre} onChange={(e) => setPrueba((p) => ({ ...p, nombre: e.target.value }))} />
                        <Boton onClick={probar} disabled={prueba.enviando || !prueba.telefono.trim() || errores > 0}>
                            <Smartphone className="h-4 w-4" /> {prueba.enviando ? 'Enviando…' : 'Enviar prueba'}
                        </Boton>
                    </div>
                </Tarjeta>

                <div className="flex flex-wrap items-center gap-3">
                    <Boton onClick={onVolver}>← Volver al mensaje</Boton>
                    <Boton variante="primario" className="px-5 py-2.5 text-base" disabled={previa.bloqueos.length > 0} onClick={() => setConfirmar(true)}>
                        <Send className="h-4 w-4" /> Enviar a {numero(previa.aEnviar)} persona(s)
                    </Boton>
                </div>
            </div>

            <div className="space-y-2">
                <VistaPreviaWhatsapp
                    clinica={clinica}
                    cuerpo={previa.plantilla.cuerpo}
                    pie={previa.plantilla.pie}
                    nombre={nombres[cual] ?? null}
                    texto={previa.textoFinal}
                    imagenUrl={imagenUrl}
                    aproximada={!previa.plantilla.cuerpo}
                />
                {nombres.length > 1 && (
                    <div className="flex flex-wrap justify-center gap-1">
                        {nombres.map((n, i) => (
                            <Boton key={i} variante={i === cual ? 'primario' : 'secundario'} className="px-2 py-1 text-xs" onClick={() => setCual(i)}>
                                {n?.split(' ')[0] ?? 'Sin nombre'}
                            </Boton>
                        ))}
                    </div>
                )}
            </div>

            {confirmar && (
                <ConfirmarEnvio
                    previa={previa}
                    onCerrar={() => setConfirmar(false)}
                    onEnviado={() => {
                        toast.success('Envío confirmado.');
                        router.push(`/dashboard/mensajes-masivos/${borradorId}`);
                    }}
                    borradorId={borradorId}
                />
            )}
        </div>
    );
}

/** La confirmación: no se puede deshacer. Hay que escribir la cantidad de personas. */
function ConfirmarEnvio({
    previa,
    borradorId,
    onCerrar,
    onEnviado,
}: {
    previa: PreviaEnvioDto;
    borradorId: string;
    onCerrar: () => void;
    onEnviado: () => void;
}) {
    const [escrito, setEscrito] = useState('');
    const [autoriza, setAutoriza] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const coincide = escrito.replace(/\D/g, '') === String(previa.aEnviar);

    const enviar = async () => {
        setEnviando(true);
        setError(null);
        const r = await confirmarEnvio(borradorId, { confirmacion: Number(escrito.replace(/\D/g, '')), autorizacion: autoriza });
        setEnviando(false);
        if (r.success) onEnviado();
        else setError(r.error);
    };

    return (
        <div role="dialog" aria-modal="true" aria-labelledby="confirmar-titulo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
                <h3 id="confirmar-titulo" className="text-lg font-bold text-zinc-900 dark:text-white">
                    ¿Enviar el comunicado a {numero(previa.aEnviar)} persona(s)?
                </h3>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                    Un mensaje de WhatsApp no se puede borrar del celular de nadie. Se puede pausar o cancelar lo que falte, pero lo enviado,
                    enviado está.
                </p>
                <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                    <p className="line-clamp-4">«{previa.textoFinal}»</p>
                    <p className="mt-1 text-xs text-zinc-500">
                        {previa.tipoPlantilla === 'MASS_MESSAGE_IMAGE' ? 'Con imagen. ' : ''}
                        {previa.horarioAbierto ? 'Empieza enseguida.' : `Empieza el ${formatAppointmentCompact(previa.saleDesde)}.`}
                    </p>
                </div>
                <label className="mt-4 flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                    <input type="checkbox" className="mt-1" checked={autoriza} onChange={(e) => setAutoriza(e.target.checked)} />
                    Confirmo que estas personas autorizaron a la clínica a escribirles por WhatsApp y que el contenido fue revisado.
                </label>
                <label className="mt-3 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    Para confirmar, escriba <strong>{previa.aEnviar}</strong>
                    <input autoFocus inputMode="numeric" className={`${campo} mt-1`} value={escrito} onChange={(e) => setEscrito(e.target.value)} />
                </label>
                {error && <div className="mt-3"><Aviso nivel="ERROR">{error}</Aviso></div>}
                <div className="mt-5 flex justify-end gap-2">
                    <Boton onClick={onCerrar} disabled={enviando}>
                        Cancelar
                    </Boton>
                    <Boton variante="primario" disabled={!coincide || !autoriza || enviando} onClick={enviar}>
                        <Send className="h-4 w-4" /> {enviando ? 'Confirmando…' : 'Sí, enviar'}
                    </Boton>
                </div>
            </div>
        </div>
    );
}
