'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { CUERPO_SUGERIDO_COMUNICADO, TEXTO_HORARIO_COMUNICADOS } from '@agenia/shared';
import { formatAppointmentCompact } from '@/lib/date';
import { verBorrador } from '@/app/actions/mensajes-masivos';
import type { BorradorDetalle, EnvioResumen, EstadoMensajesMasivos, ListaResumen, VerificacionPlantillaDto } from '@/app/actions/mensajes-masivos.types';
import AsistenteEnvio from './AsistenteEnvio';
import { HistorialEnvios, ListasContactos, PanelBajas } from './PanelesSecundarios';
import { Aviso, Punto, type Nivel } from './ui';

type Pestana = 'NUEVO' | 'ENVIOS' | 'LISTAS' | 'BAJAS';

export default function MensajesMasivosClient({
    clinica,
    listas,
    envios,
    eps,
    pacientesConWhatsapp,
    estado,
    errorEstado,
    borradorInicial,
}: {
    clinica: string;
    listas: ListaResumen[];
    envios: EnvioResumen[];
    eps: Array<{ id: string; nombre: string }>;
    pacientesConWhatsapp: number;
    estado: EstadoMensajesMasivos | null;
    errorEstado: string | null;
    borradorInicial: BorradorDetalle | null;
}) {
    const router = useRouter();
    const [pestana, setPestana] = useState<Pestana>('NUEVO');
    const [borrador, setBorrador] = useState<BorradorDetalle | null>(borradorInicial);
    const [clave, setClave] = useState(0);

    const continuar = async (id: string) => {
        const r = await verBorrador(id);
        if (!r.success) return toast.error(r.error);
        setBorrador(r.borrador);
        setClave((k) => k + 1);
        setPestana('NUEVO');
        router.replace(`/dashboard/mensajes-masivos?borrador=${id}`);
    };
    const nuevo = () => {
        setBorrador(null);
        setClave((k) => k + 1);
        setPestana('NUEVO');
        router.replace('/dashboard/mensajes-masivos');
    };

    const pestanas: Array<{ id: Pestana; titulo: string }> = [
        { id: 'NUEVO', titulo: borrador ? 'Envío en preparación' : 'Nuevo envío' },
        { id: 'ENVIOS', titulo: `Envíos (${envios.length})` },
        { id: 'LISTAS', titulo: `Listas de contactos (${listas.length})` },
        { id: 'BAJAS', titulo: 'Bajas' },
    ];

    return (
        <div className="space-y-6">
            <EstadoDelCanal estado={estado} error={errorEstado} />

            <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
                {pestanas.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => setPestana(p.id)}
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            pestana === p.id ? 'border-teal-600 text-teal-700 dark:text-teal-300' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                        }`}
                    >
                        {p.titulo}
                    </button>
                ))}
                {borrador && pestana === 'NUEVO' && (
                    <button type="button" onClick={nuevo} className="ml-auto px-3 py-2 text-sm font-semibold text-teal-700 hover:underline">
                        + Empezar otro envío
                    </button>
                )}
            </div>

            {pestana === 'NUEVO' && (
                <AsistenteEnvio
                    key={clave}
                    clinica={clinica}
                    listas={listas}
                    eps={eps}
                    pacientesConWhatsapp={pacientesConWhatsapp}
                    estado={estado}
                    borradorInicial={borrador}
                />
            )}
            {pestana === 'ENVIOS' && <HistorialEnvios envios={envios} onContinuar={continuar} />}
            {pestana === 'LISTAS' && <ListasContactos listas={listas} iaDisponible={!!estado?.ia} />}
            {pestana === 'BAJAS' && <PanelBajas />}
        </div>
    );
}

function estadoPlantilla(p: VerificacionPlantillaDto): { nivel: Nivel; texto: string } {
    if (!p.configurada) return { nivel: 'ERROR', texto: 'sin registrar' };
    if (p.problemas.length) return { nivel: 'ERROR', texto: p.problemas[0] };
    if (!p.verificadaConMeta) return { nivel: 'AVISO', texto: `«${p.nombre}» registrada (no se pudo comprobar con Meta)` };
    return { nivel: 'BIEN', texto: `«${p.nombre}» aprobada` };
}

/** Lo que hace falta para enviar, de un vistazo: plantillas, número, IA y horario. */
function EstadoDelCanal({ estado, error }: { estado: EstadoMensajesMasivos | null; error: string | null }) {
    const [verGuia, setVerGuia] = useState(false);
    if (!estado) return <Aviso nivel="AVISO" titulo="No se pudo consultar el estado de WhatsApp">{error ?? 'Intente recargar la página.'}</Aviso>;
    const texto = estadoPlantilla(estado.plantillas.texto);
    const imagen = estadoPlantilla(estado.plantillas.imagen);
    const faltaAlguna = texto.nivel === 'ERROR' || imagen.nivel === 'ERROR';
    const items: Array<{ titulo: string; nivel: Nivel; texto: string }> = [
        { titulo: 'Comunicado sin imagen', ...texto },
        { titulo: 'Comunicado con imagen', ...imagen },
        {
            titulo: 'Revisión con IA',
            nivel: estado.ia ? 'BIEN' : 'INFO',
            texto: estado.ia ? 'disponible' : 'sin IA configurada: se revisa con las reglas',
        },
        {
            titulo: 'Horario de envío',
            nivel: estado.horario.abierto ? 'BIEN' : 'INFO',
            texto: estado.horario.abierto ? 'abierto ahora' : `cerrado; abre el ${formatAppointmentCompact(estado.horario.proximaApertura)}`,
        },
    ];
    return (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {items.map((i) => (
                    <div key={i.titulo} className="flex gap-2">
                        <span className="mt-1.5"><Punto nivel={i.nivel} /></span>
                        <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase text-zinc-500">{i.titulo}</p>
                            <p className="text-sm text-zinc-800 dark:text-zinc-100">{i.texto}</p>
                        </div>
                    </div>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                <span>Se envía {TEXTO_HORARIO_COMUNICADOS}.</span>
                <button type="button" className="font-semibold text-teal-700 hover:underline" onClick={() => setVerGuia((v) => !v)}>
                    {verGuia ? 'Ocultar' : faltaAlguna ? 'Cómo crear las plantillas en Meta' : 'Ver cómo deben ser las plantillas'}
                </button>
            </div>
            {verGuia && (
                <div className="mt-3 space-y-2 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200">
                    <p>
                        Fuera de las 24 horas siguientes al último mensaje de cada persona, WhatsApp solo deja escribir con una plantilla aprobada por
                        Meta. Cree dos en el Administrador de WhatsApp (categoría Marketing, idioma español):
                    </p>
                    <ol className="list-decimal space-y-1 pl-5">
                        <li><strong>Sin imagen</strong>: sin encabezado (o con un encabezado de texto fijo).</li>
                        <li><strong>Con imagen</strong>: Encabezado → Multimedia → Imagen.</li>
                    </ol>
                    <p>El cuerpo de las dos, con 2 variables (el nombre y el comunicado), por ejemplo:</p>
                    <pre className="whitespace-pre-wrap rounded-lg bg-white p-3 font-sans text-sm dark:bg-zinc-900">{CUERPO_SUGERIDO_COMUNICADO}</pre>
                    <p>
                        Cuando Meta las apruebe, regístrelas con su nombre e idioma en{' '}
                        <Link href="/dashboard/configuracion" className="font-semibold text-teal-700 hover:underline">Configuración → WhatsApp</Link>
                        {' '}(«Comunicado (mensajes masivos, sin imagen)» y «Comunicado con imagen»).
                    </p>
                </div>
            )}
        </div>
    );
}
