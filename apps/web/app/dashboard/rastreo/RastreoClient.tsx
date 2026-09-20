'use client';

import Link from 'next/link';
import { useEffect, useId, useState, useTransition } from 'react';
import { MOTIVOS_CONSULTA, MAX_NOTA_MOTIVO } from '@agenia/shared';
import {
    abrirExpedienteAction,
    buscarPacientesAction,
    investigarCupoHisAction,
    opcionesCupoHisAction,
} from '@/app/actions/rastreo';
import type {
    CandidatoRastreo,
    ExpedienteA,
    ExpedienteB,
    OpcionMedico,
    ResultadoBusqueda,
} from '@/lib/rastreo/tipos';
import ExpedienteVista from './components/ExpedienteVista';
import ExpedienteBVista from './components/ExpedienteBVista';

/**
 * Rastreo de paciente (docs/PLAN_RASTREO_PACIENTE.md §4).
 *
 * Dos opciones separadas, como pidió el plan: "Dice que agendó" (A) y "Lo
 * agendaron en el HIS" (B, solo con espejo). La pantalla no decide qué puede ver
 * cada rol: eso lo hace el servidor; aquí solo se muestra lo que llega.
 */

export interface OrganizacionElegible {
    id: string;
    name: string;
    conEspejo: boolean;
}

interface Props {
    /** SUPER_ADMIN elige clínica; los demás roles operan sobre la de su token. */
    esSuperAdmin: boolean;
    organizaciones?: OrganizacionElegible[];
    /** ¿La clínica del usuario tiene espejo con un HIS? (ignorado para SUPER_ADMIN: depende de la elegida). */
    conEspejo: boolean;
    /** ¿Este rol puede investigar citas del HIS (escenario B)? */
    puedeModoB: boolean;
    /** Enlace a la bitácora de consultas, si el rol la puede ver. */
    hrefConsultas: string | null;
}

const CAMPO =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white';
const ETIQUETA = 'mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300';
const BOTON =
    'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400';

type Vista = 'FORMULARIO' | 'CANDIDATOS' | 'EXPEDIENTE_A' | 'EXPEDIENTE_B';
type Modo = 'A' | 'B';

const COINCIDE_POR: Record<CandidatoRastreo['coincidePor'], string> = {
    CEDULA: 'por cédula',
    TELEFONO: 'por teléfono',
    BSUID: 'por BSUID',
    NOMBRE: 'por nombre',
};

function Pantalla({
    esSuperAdmin,
    organizaciones = [],
    conEspejo,
    puedeModoB,
    organizationId,
}: Props & { organizationId: string }) {
    const id = useId();
    const [pendiente, startTransition] = useTransition();

    const [modoElegido, setModo] = useState<Modo>('A');
    const [vista, setVista] = useState<Vista>('FORMULARIO');
    const [error, setError] = useState<string | null>(null);

    const [motivo, setMotivo] = useState('');
    const [nota, setNota] = useState('');

    // A
    const [consulta, setConsulta] = useState('');
    const [captura, setCaptura] = useState({ fecha: '', hora: '', medico: '' });
    const [busqueda, setBusqueda] = useState<ResultadoBusqueda | null>(null);
    const [expedienteA, setExpedienteA] = useState<ExpedienteA | null>(null);

    // B
    const [documento, setDocumento] = useState('');
    const [medicos, setMedicos] = useState<OpcionMedico[] | null>(null);
    const [medicoClave, setMedicoClave] = useState('');
    const [fechaB, setFechaB] = useState('');
    const [horaB, setHoraB] = useState('');
    const [expedienteB, setExpedienteB] = useState<ExpedienteB | null>(null);

    const clinica = esSuperAdmin ? organizaciones.find((o) => o.id === organizationId) : undefined;
    const clinicaConEspejo = esSuperAdmin ? !!clinica?.conEspejo : conEspejo;
    const hayModoB = puedeModoB && clinicaConEspejo;
    const orgParaServidor = esSuperAdmin ? organizationId : null;
    // Sin espejo no hay opción B: se DERIVA, no se sincroniza con un efecto.
    const modo: Modo = hayModoB ? modoElegido : 'A';

    // Las opciones de médico del HIS se cargan al abrir la pestaña B.
    useEffect(() => {
        if (modo !== 'B' || !hayModoB || medicos !== null) return;
        if (esSuperAdmin && !organizationId) return;
        let vigente = true;
        opcionesCupoHisAction({ organizationId: orgParaServidor }).then((r) => {
            if (!vigente) return;
            if (r.success) setMedicos(r.data.medicos);
            else setError(r.error);
        });
        return () => {
            vigente = false;
        };
    }, [modo, hayModoB, medicos, esSuperAdmin, organizationId, orgParaServidor]);

    const validarComun = (): string | null => {
        if (esSuperAdmin && !organizationId) return 'Elige la organización que vas a consultar.';
        if (!motivo) return 'Elige el motivo de la consulta.';
        if (motivo === 'OTRO' && nota.trim().length < 5) return 'Explica el motivo en la nota (al menos 5 caracteres).';
        return null;
    };

    const buscar = (e: React.FormEvent) => {
        e.preventDefault();
        const problema = validarComun() ?? (consulta.trim() ? null : 'Escribe una cédula, un teléfono, un BSUID o un nombre y apellido.');
        if (problema) return setError(problema);
        setError(null);
        startTransition(async () => {
            const r = await buscarPacientesAction({ organizationId: orgParaServidor, consulta, motivo, nota });
            if (!r.success) return setError(r.error);
            setBusqueda(r.data);
            setVista('CANDIDATOS');
        });
    };

    const abrir = (c: CandidatoRastreo) => {
        setError(null);
        startTransition(async () => {
            const r = await abrirExpedienteAction({
                organizationId: orgParaServidor,
                sujeto: c.tipo === 'PACIENTE' ? { tipo: 'PACIENTE', id: c.id } : { tipo: 'REMITENTE', whatsappId: c.id },
                motivo,
                nota,
                captura,
            });
            if (!r.success) return setError(r.error);
            setExpedienteA(r.data);
            setVista('EXPEDIENTE_A');
        });
    };

    const investigar = (e: React.FormEvent) => {
        e.preventDefault();
        const problema =
            validarComun() ??
            (!documento.trim() ? 'Escribe la cédula del paciente.' : null) ??
            (!medicoClave ? 'Elige el médico del HIS.' : null) ??
            (!fechaB || !horaB ? 'Indica la fecha y la hora de la cita en el HIS.' : null);
        if (problema) return setError(problema);
        setError(null);
        startTransition(async () => {
            const r = await investigarCupoHisAction({
                organizationId: orgParaServidor,
                documento,
                medicoClave,
                fecha: fechaB,
                hora: horaB,
                motivo,
                nota,
            });
            if (!r.success) return setError(r.error);
            setExpedienteB(r.data);
            setVista('EXPEDIENTE_B');
        });
    };

    const volverAlFormulario = () => {
        setVista('FORMULARIO');
        setError(null);
    };

    const cambiarModo = (m: Modo) => {
        setModo(m);
        setVista('FORMULARIO');
        setError(null);
    };

    return (
        <div className="space-y-6">
            {error && (
                <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                    {error}
                </p>
            )}

            {vista === 'FORMULARIO' || vista === 'CANDIDATOS' ? (
                <>
                    <div role="tablist" aria-label="Qué vas a investigar" className="flex flex-wrap gap-2">
                        <button
                            role="tab"
                            type="button"
                            aria-selected={modo === 'A'}
                            onClick={() => cambiarModo('A')}
                            className={`rounded-lg border px-3 py-2 text-sm font-medium ${modo === 'A' ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-200' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}
                        >
                            Dice que agendó
                        </button>
                        {hayModoB && (
                            <button
                                role="tab"
                                type="button"
                                aria-selected={modo === 'B'}
                                onClick={() => cambiarModo('B')}
                                className={`rounded-lg border px-3 py-2 text-sm font-medium ${modo === 'B' ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-200' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}
                            >
                                Lo agendaron en el HIS
                            </button>
                        )}
                    </div>

                    <form onSubmit={modo === 'A' ? buscar : investigar} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 md:p-5 dark:border-zinc-800 dark:bg-zinc-900">
                        {modo === 'A' ? (
                            <>
                                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                    El paciente dice que agendó por WhatsApp y la cita no aparece en el hospital. Busca por cédula, teléfono, BSUID o nombre y apellido.
                                </p>
                                <div>
                                    <label htmlFor={`${id}-q`} className={ETIQUETA}>
                                        Cédula, teléfono, BSUID o nombre y apellido
                                    </label>
                                    <input id={`${id}-q`} className={CAMPO} value={consulta} onChange={(e) => setConsulta(e.target.value)} autoComplete="off" />
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                    Le agendaron la cita en el HIS y no le aparece en WhatsApp. Con la cédula y el médico, la fecha y la hora que muestra el HIS, AgenIA revisa qué aviso recibió del hospital para ese cupo.
                                </p>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <label htmlFor={`${id}-doc`} className={ETIQUETA}>
                                            Cédula del paciente
                                        </label>
                                        <input id={`${id}-doc`} inputMode="numeric" className={CAMPO} value={documento} onChange={(e) => setDocumento(e.target.value)} autoComplete="off" />
                                    </div>
                                    <div>
                                        <label htmlFor={`${id}-med`} className={ETIQUETA}>
                                            Médico del HIS
                                        </label>
                                        <select id={`${id}-med`} className={CAMPO} value={medicoClave} onChange={(e) => setMedicoClave(e.target.value)} disabled={medicos === null}>
                                            <option value="">{medicos === null ? 'Cargando médicos…' : 'Elige el médico…'}</option>
                                            {(medicos ?? []).map((m) => (
                                                <option key={m.clave} value={m.clave}>
                                                    {m.etiqueta}
                                                    {m.homologado ? '' : ' (no homologado)'}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor={`${id}-fb`} className={ETIQUETA}>
                                            Fecha de la cita en el HIS
                                        </label>
                                        <input id={`${id}-fb`} type="date" className={CAMPO} value={fechaB} onChange={(e) => setFechaB(e.target.value)} />
                                    </div>
                                    <div>
                                        <label htmlFor={`${id}-hb`} className={ETIQUETA}>
                                            Hora de la cita en el HIS
                                        </label>
                                        <input id={`${id}-hb`} type="time" className={CAMPO} value={horaB} onChange={(e) => setHoraB(e.target.value)} />
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                                <label htmlFor={`${id}-motivo`} className={ETIQUETA}>
                                    Motivo de la consulta (obligatorio)
                                </label>
                                <select id={`${id}-motivo`} className={CAMPO} value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                                    <option value="">Elige el motivo…</option>
                                    {MOTIVOS_CONSULTA.map((m) => (
                                        <option key={m.codigo} value={m.codigo}>
                                            {m.etiqueta}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor={`${id}-nota`} className={ETIQUETA}>
                                    Nota {motivo === 'OTRO' ? '(obligatoria)' : '(opcional)'}
                                </label>
                                <input id={`${id}-nota`} className={CAMPO} value={nota} maxLength={MAX_NOTA_MOTIVO} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: número de PQRS" />
                            </div>
                        </div>

                        {modo === 'A' && (
                            <details className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                                <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">
                                    Datos de la captura de pantalla (opcional)
                                </summary>
                                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                                    Lo que muestra la captura. AgenIA lo compara con las citas registradas; no se guarda la imagen.
                                </p>
                                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                                    <div>
                                        <label htmlFor={`${id}-cf`} className={ETIQUETA}>
                                            Fecha
                                        </label>
                                        <input id={`${id}-cf`} type="date" className={CAMPO} value={captura.fecha} onChange={(e) => setCaptura({ ...captura, fecha: e.target.value })} />
                                    </div>
                                    <div>
                                        <label htmlFor={`${id}-ch`} className={ETIQUETA}>
                                            Hora
                                        </label>
                                        <input id={`${id}-ch`} type="time" className={CAMPO} value={captura.hora} onChange={(e) => setCaptura({ ...captura, hora: e.target.value })} />
                                    </div>
                                    <div>
                                        <label htmlFor={`${id}-cm`} className={ETIQUETA}>
                                            Médico o servicio
                                        </label>
                                        <input id={`${id}-cm`} className={CAMPO} value={captura.medico} onChange={(e) => setCaptura({ ...captura, medico: e.target.value })} />
                                    </div>
                                </div>
                            </details>
                        )}

                        <button type="submit" className={BOTON} disabled={pendiente}>
                            {pendiente ? 'Consultando…' : modo === 'A' ? 'Buscar' : 'Investigar'}
                        </button>
                    </form>

                    {vista === 'CANDIDATOS' && busqueda && (
                        <Candidatos busqueda={busqueda} pendiente={pendiente} onAbrir={abrir} />
                    )}
                </>
            ) : vista === 'EXPEDIENTE_A' && expedienteA ? (
                <ExpedienteVista
                    data={expedienteA}
                    motivo={motivo}
                    nota={nota}
                    organizationId={orgParaServidor}
                    onVolver={() => setVista('CANDIDATOS')}
                />
            ) : vista === 'EXPEDIENTE_B' && expedienteB ? (
                <ExpedienteBVista data={expedienteB} onVolver={volverAlFormulario} />
            ) : null}
        </div>
    );
}

/**
 * Contenedor: el encabezado y —solo para SUPER_ADMIN— el selector de
 * organización. La `Pantalla` lleva `key={organizationId}`: cambiar de clínica la
 * REMONTA y descarta todo lo cargado (búsquedas, expediente, médicos del HIS).
 * Así no hay forma de mezclar datos de dos clínicas en pantalla, y no hace falta
 * un efecto que "sincronice" el estado a mano.
 */
export default function RastreoClient(props: Props) {
    const id = useId();
    const { esSuperAdmin, organizaciones = [], hrefConsultas } = props;
    const [organizationId, setOrganizationId] = useState<string>('');

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Rastreo de paciente</h1>
                    <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
                        Averigua qué pasó con la cita de un paciente. El resultado nunca dice que alguien miente: dice qué consta en AgenIA, qué no se sabe y qué hacer.
                        Cada consulta queda registrada con su motivo.
                    </p>
                </div>
                {hrefConsultas && (
                    <Link href={hrefConsultas} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                        Ver las consultas registradas →
                    </Link>
                )}
            </header>

            {esSuperAdmin && (
                <div>
                    <label htmlFor={`${id}-org`} className={ETIQUETA}>
                        Organización a consultar
                    </label>
                    <select id={`${id}-org`} className={CAMPO} value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
                        <option value="">Elige una organización…</option>
                        {organizaciones.map((o) => (
                            <option key={o.id} value={o.id}>
                                {o.name}
                                {o.conEspejo ? ' · con espejo' : ''}
                            </option>
                        ))}
                    </select>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        No hay búsqueda entre organizaciones: cada clínica es un mundo aparte.
                    </p>
                </div>
            )}

            <Pantalla key={organizationId} {...props} organizationId={organizationId} />
        </div>
    );
}

function Candidatos({
    busqueda,
    pendiente,
    onAbrir,
}: {
    busqueda: ResultadoBusqueda;
    pendiente: boolean;
    onAbrir: (c: CandidatoRastreo) => void;
}) {
    const { candidatos, hayMas } = busqueda;
    return (
        <section aria-label="Resultados" className="space-y-3">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                {candidatos.length === 0
                    ? 'No se encontró a nadie'
                    : `${candidatos.length} resultado(s)${hayMas ? ' — hay más, afina la búsqueda' : ''}`}
            </h2>
            {candidatos.length === 0 && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Que no aparezca no prueba que el paciente no exista: pudo escribir con otro número u otra cédula. Prueba con otro dato.
                </p>
            )}
            <ul className="space-y-2">
                {candidatos.map((c) => (
                    <li key={`${c.tipo}-${c.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                        <div className="min-w-0">
                            <p className="font-semibold text-zinc-900 dark:text-white">
                                {c.tipo === 'REMITENTE' ? 'Número sin perfil' : c.nombre}
                            </p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {[c.documento && `Doc. ${c.documento}`, c.contacto && `WhatsApp ${c.contacto}`, c.eps, c.tipo === 'PACIENTE' ? `${c.citas} cita(s)` : 'solo aparece en las conversaciones']
                                    .filter(Boolean)
                                    .join(' · ')}
                            </p>
                            <span className="mt-1 inline-block rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                {COINCIDE_POR[c.coincidePor]}
                            </span>
                        </div>
                        <button type="button" onClick={() => onAbrir(c)} disabled={pendiente} className={BOTON}>
                            Abrir expediente
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
