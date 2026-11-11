'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FRASE_APROBAR_PILOTO, LIMITES_RESUMEN_ATENCION, enmascararDestino } from '@agenia/shared';
import { formatAppointmentCompact } from '@/lib/date';
import {
    aprobarPilotoResumenAction,
    updateEnvioResumenAction,
    updateLecturaResumenAction,
    type PanelResumenAtencion,
} from '@/app/actions/resumen-atencion';
import SeguimientoEnvios from './SeguimientoEnvios';
import MedicionPiloto from './MedicionPiloto';
import RevisionResumenes from './RevisionResumenes';
import EncabezadoDocumentos from './EncabezadoDocumentos';
import ContenidoResumen from './ContenidoResumen';

const CANALES = [
    { clave: 'WHATSAPP', nombre: 'WhatsApp' },
    { clave: 'TELEGRAM', nombre: 'Telegram' },
    { clave: 'EMAIL', nombre: 'Correo' },
] as const;

/** 850 → «850 ms»; 2400 → «2,4 s». */
function duracion(ms: number): string {
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/**
 * Los interruptores del resumen de la atención (plan §3.11): la lectura en
 * sombra (Fase 1) y el envío por WhatsApp (Fase 4). Mientras no se apruebe el
 * piloto, «Enviar a pacientes» solo enciende en modo prueba: solo reciben los
 * números, correos y chats de Telegram del equipo. Aprobado (escribiendo la
 * frase), la lista vacía deja salir el aviso a los pacientes (plan §8.10).
 */
export default function ResumenAtencionClient({ panel }: { panel: PanelResumenAtencion }) {
    const router = useRouter();
    const [guardando, startGuardando] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);

    const [leer, setLeer] = useState(panel.config.leerDelHospital);
    const [seLeen, setSeLeen] = useState<Set<string>>(
        () => new Set(panel.servicios.filter((s) => s.seLee).map((s) => s.codigo)),
    );
    const [calma, setCalma] = useState(String(panel.config.calmaMinutos));

    const waAntes = Object.entries(panel.config.servicios)
        .filter(([, c]) => c.WHATSAPP)
        .map(([codigo]) => codigo);
    const tgAntes = Object.entries(panel.config.servicios)
        .filter(([, c]) => c.TELEGRAM)
        .map(([codigo]) => codigo);
    const [enviar, setEnviar] = useState(panel.config.enviar);
    const [whatsapp, setWhatsapp] = useState(panel.config.canales.WHATSAPP);
    const [telegram, setTelegram] = useState(panel.config.canales.TELEGRAM);
    const [serviciosWa, setServiciosWa] = useState<Set<string>>(() => new Set(waAntes));
    const [serviciosTg, setServiciosTg] = useState<Set<string>>(() => new Set(tgAntes));
    const correoAntes = Object.entries(panel.config.servicios)
        .filter(([, c]) => c.EMAIL)
        .map(([codigo]) => codigo);
    const [correo, setCorreo] = useState(panel.config.canales.EMAIL);
    const [serviciosCorreo, setServiciosCorreo] = useState<Set<string>>(() => new Set(correoAntes));
    const [relleno, setRelleno] = useState(panel.envio.correosDeRelleno.join('\n'));
    const [destinos, setDestinos] = useState(panel.config.modoPrueba.destinos.join('\n'));
    const [frasePiloto, setFrasePiloto] = useState('');
    const [cambiandoPiloto, startPiloto] = useTransition();
    const [errorPiloto, setErrorPiloto] = useState<string | null>(null);
    const cambiarPiloto = (aprobar: boolean) => {
        setErrorPiloto(null);
        startPiloto(async () => {
            const r = await aprobarPilotoResumenAction(aprobar, aprobar ? frasePiloto : undefined);
            if (!r.success) {
                setErrorPiloto(r.error);
                return;
            }
            setFrasePiloto('');
            router.refresh();
        });
    };

    const cambiosLectura = useMemo(() => {
        const antes = panel.servicios.filter((s) => s.seLee).map((s) => s.codigo).sort().join(',');
        return (
            leer !== panel.config.leerDelHospital ||
            [...seLeen].sort().join(',') !== antes ||
            calma !== String(panel.config.calmaMinutos)
        );
    }, [leer, seLeen, calma, panel]);
    const listaRelleno = relleno
        .split(/[\n,;\s]+/)
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
    const listaDestinos = destinos
        .split(/[\n,;]+/)
        .map((d) => d.trim())
        .filter(Boolean);
    const cambiosEnvio =
        enviar !== panel.config.enviar ||
        whatsapp !== panel.config.canales.WHATSAPP ||
        telegram !== panel.config.canales.TELEGRAM ||
        [...serviciosWa].sort().join(',') !== [...waAntes].sort().join(',') ||
        [...serviciosTg].sort().join(',') !== [...tgAntes].sort().join(',') ||
        correo !== panel.config.canales.EMAIL ||
        [...serviciosCorreo].sort().join(',') !== [...correoAntes].sort().join(',') ||
        listaRelleno.join(',') !== panel.envio.correosDeRelleno.join(',') ||
        listaDestinos.join(',') !== panel.config.modoPrueba.destinos.join(',');
    const hayCambios = cambiosLectura || cambiosEnvio;

    const alternarWa = (codigo: string) =>
        setServiciosWa((prev) => {
            const s = new Set(prev);
            if (s.has(codigo)) s.delete(codigo);
            else s.add(codigo);
            return s;
        });
    const alternarCorreo = (codigo: string) =>
        setServiciosCorreo((prev) => {
            const s = new Set(prev);
            if (s.has(codigo)) s.delete(codigo);
            else s.add(codigo);
            return s;
        });
    const alternarTg = (codigo: string) =>
        setServiciosTg((prev) => {
            const s = new Set(prev);
            if (s.has(codigo)) s.delete(codigo);
            else s.add(codigo);
            return s;
        });

    const alternar = (codigo: string) =>
        setSeLeen((prev) => {
            const s = new Set(prev);
            if (s.has(codigo)) s.delete(codigo);
            else s.add(codigo);
            return s;
        });

    const guardar = () => {
        setError(null);
        setAviso(null);
        startGuardando(async () => {
            if (cambiosLectura) {
                const r = await updateLecturaResumenAction({
                    leerDelHospital: leer,
                    serviciosALeer: [...seLeen],
                    calmaMinutos: Number(calma),
                });
                if (!r.success) {
                    setError(r.error);
                    return;
                }
            }
            if (cambiosEnvio) {
                // Después de la lectura: un servicio recién marcado «Se lee» ya está en la matriz.
                const r = await updateEnvioResumenAction({
                    enviar,
                    whatsapp,
                    telegram,
                    serviciosWhatsapp: [...serviciosWa].filter((c) => seLeen.has(c)),
                    serviciosTelegram: [...serviciosTg].filter((c) => seLeen.has(c)),
                    correo,
                    serviciosCorreo: [...serviciosCorreo].filter((c) => seLeen.has(c)),
                    correosDeRelleno: listaRelleno,
                    destinosPrueba: listaDestinos,
                });
                if (!r.success) {
                    setError(r.error);
                    router.refresh();
                    return;
                }
            }
            setAviso('Guardado. El agente lo toma en su próxima vuelta (cada 5 minutos) y el envío, en 2 minutos.');
            router.refresh();
        });
    };

    const L = LIMITES_RESUMEN_ATENCION;
    const leyendo = panel.config.leerDelHospital && Object.keys(panel.config.servicios).length > 0;

    return (
        <div className="space-y-6">
            <header className="space-y-2">
                <Link href="/dashboard/espejo" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
                    ← Espejo con el HIS
                </Link>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Resumen de la atención</h1>
                <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
                    Cuando el médico termina la historia en el sistema del hospital, el paciente recibirá el resumen de su
                    consulta, su fórmula y sus órdenes. Por ahora existen la <strong>lectura en sombra</strong> (AgenIA lee las
                    historias terminadas y las guarda cifradas 30 días para revisarlas), los <strong>documentos</strong> en PDF
                    e imagen y el <strong>envío por WhatsApp, Telegram y correo</strong>.{' '}
                    <strong>Mientras no se apruebe el piloto, solo reciben los números del equipo; ningún paciente.</strong>
                </p>
                <p className="text-sm font-medium" data-testid="estado-lectura">
                    {leyendo ? (
                        <span className="text-emerald-700 dark:text-emerald-400">● Leyendo del hospital</span>
                    ) : (
                        <span className="text-zinc-500">○ Apagado: no se lee nada del hospital</span>
                    )}
                </p>
                <p className="text-sm font-medium" data-testid="estado-envio">
                    {!panel.config.enviar ? (
                        <span className="text-zinc-500">○ Envío apagado: no sale nada</span>
                    ) : panel.config.modoPrueba.destinos.length ? (
                        <span className="text-amber-700 dark:text-amber-400">
                            ● Enviando en modo prueba a {panel.config.modoPrueba.destinos.map(enmascararDestino).join(', ')}
                        </span>
                    ) : (
                        <span className="text-emerald-700 dark:text-emerald-400">
                            ● Enviando a los pacientes de los servicios y canales encendidos (piloto aprobado)
                        </span>
                    )}
                </p>
            </header>

            <section className="space-y-2 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800" data-testid="piloto">
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Piloto</h2>
                {panel.config.piloto.aprobado ? (
                    <>
                        <p className="text-zinc-700 dark:text-zinc-300">
                            ✓ Aprobado
                            {panel.config.piloto.desdeIso ? ` desde ${formatAppointmentCompact(new Date(panel.config.piloto.desdeIso))}` : ''}.
                            {panel.config.modoPrueba.destinos.length > 0
                                ? ` Sigue en modo prueba: solo reciben los ${panel.config.modoPrueba.destinos.length} número(s) del equipo. Para enviar a los pacientes, vacíe «Números del modo prueba» y guarde.`
                                : ' Con «Enviar a pacientes» encendido, el aviso sale a los pacientes de los servicios y canales marcados.'}
                        </p>
                        <button
                            onClick={() => cambiarPiloto(false)}
                            disabled={cambiandoPiloto}
                            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
                        >
                            Volver a solo modo prueba
                        </button>
                        <p className="text-xs text-zinc-500">
                            Sin números del equipo, volver a modo prueba apaga «Enviar a pacientes»: no sale nada más.
                        </p>
                    </>
                ) : (
                    <>
                        <p className="text-zinc-700 dark:text-zinc-300">
                            Sin aprobar: «Enviar a pacientes» solo funciona en modo prueba, con los números del equipo. Apruébelo
                            cuando el hospital lo haya autorizado. Después, con «Enviar» encendido y la lista de números del equipo
                            vacía, el aviso sale a los pacientes de los servicios y canales marcados.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                value={frasePiloto}
                                onChange={(e) => setFrasePiloto(e.target.value)}
                                placeholder={`Escriba ${FRASE_APROBAR_PILOTO}`}
                                aria-label="Frase para aprobar el piloto"
                                className="w-64 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                            />
                            <button
                                onClick={() => cambiarPiloto(true)}
                                disabled={cambiandoPiloto || frasePiloto.trim().toUpperCase() !== FRASE_APROBAR_PILOTO}
                                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                            >
                                Aprobar el piloto
                            </button>
                        </div>
                        <p className="text-xs text-zinc-500">Queda registrado quién lo aprobó y cuándo, en la Actividad de usuarios.</p>
                    </>
                )}
                {errorPiloto && <p className="text-sm text-red-600">{errorPiloto}</p>}
            </section>

            <section className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Interruptores generales</h2>
                <label className="flex items-start gap-3 text-sm text-zinc-800 dark:text-zinc-200">
                    <input
                        type="checkbox"
                        checked={leer}
                        onChange={(e) => setLeer(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                        aria-label="Leer del hospital"
                    />
                    <span>
                        <span className="font-medium">Leer del hospital</span>
                        <span className="block text-xs text-zinc-500">
                            El agente lee las historias terminadas de los servicios marcados abajo. Apagado, no consulta la
                            historia clínica del hospital.
                        </span>
                    </span>
                </label>
                <label className="flex items-start gap-3 text-sm text-zinc-800 dark:text-zinc-200">
                    <input
                        type="checkbox"
                        checked={enviar}
                        onChange={(e) => setEnviar(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                        aria-label="Enviar a pacientes"
                    />
                    <span>
                        <span className="font-medium">Enviar a pacientes</span>
                        <span className="block text-xs text-zinc-500">
                            El freno general. Mientras no se apruebe el piloto, solo funciona en modo prueba: el aviso sale solo
                            a los números del equipo de abajo. Con el piloto aprobado y sin números del equipo, sale a los
                            pacientes. Nace apagado.
                        </span>
                    </span>
                </label>
                <div className="space-y-1 text-sm">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">Canales</span>
                    <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200">
                            <input
                                type="checkbox"
                                checked={whatsapp}
                                onChange={(e) => setWhatsapp(e.target.checked)}
                                className="h-4 w-4 rounded border-zinc-300"
                                aria-label="Canal WhatsApp"
                            />
                            WhatsApp
                        </label>
                        <label className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200">
                            <input
                                type="checkbox"
                                checked={telegram}
                                onChange={(e) => setTelegram(e.target.checked)}
                                className="h-4 w-4 rounded border-zinc-300"
                                aria-label="Canal Telegram"
                            />
                            Telegram
                        </label>
                        <label className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200">
                            <input
                                type="checkbox"
                                checked={correo}
                                onChange={(e) => setCorreo(e.target.checked)}
                                className="h-4 w-4 rounded border-zinc-300"
                                aria-label="Canal Correo"
                            />
                            Correo
                        </label>
                    </div>
                    {panel.envio.correoConfigurado === false && (
                        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="falta-correo">
                            El servidor no tiene correo configurado (SMTP): los correos no saldrán hasta que el equipo técnico lo
                            configure con el proveedor elegido.
                        </p>
                    )}
                    {!panel.envio.plantillaConfigurada && (
                        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="falta-plantilla">
                            Falta la plantilla «Documentos de la consulta» en Configuración › Plantillas de WhatsApp: sin ella,
                            el aviso solo le llega a quien escribió en las últimas 24 horas.
                        </p>
                    )}
                </div>
                <label className="block text-sm text-zinc-700 dark:text-zinc-300">
                    Correos de relleno del hospital
                    <textarea
                        value={relleno}
                        onChange={(e) => setRelleno(e.target.value)}
                        rows={2}
                        aria-label="Correos de relleno"
                        className="mt-1 block w-full max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <span className="mt-1 block text-xs text-zinc-500">
                        Los que el hospital pone cuando el paciente no tiene correo (uno por línea). A esos nunca se envía.
                    </span>
                </label>
                <label className="block text-sm text-zinc-700 dark:text-zinc-300">
                    Números del equipo (modo prueba)
                    <textarea
                        value={destinos}
                        onChange={(e) => setDestinos(e.target.value)}
                        rows={2}
                        placeholder="3001234567"
                        aria-label="Números del modo prueba"
                        className="mt-1 block w-full max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <span className="mt-1 block text-xs text-zinc-500">
                        Uno por línea, hasta 10: celulares, correos o chats de Telegram («tg:» y su número). Mientras haya
                        alguno, solo estos reciben avisos, y a ellos se envía de prueba desde «Revisar contra el HIS». Vacía,
                        con el piloto aprobado, reciben los pacientes. Quien usa el asistente por Telegram lo recibe por ahí;
                        si falla, por WhatsApp.
                    </span>
                </label>
                <label className="block text-sm text-zinc-700 dark:text-zinc-300">
                    Calma antes de leer una historia (minutos)
                    <input
                        type="number"
                        min={L.calmaMinutosMin}
                        max={L.calmaMinutosMax}
                        value={calma}
                        onChange={(e) => setCalma(e.target.value)}
                        className="mt-1 block w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        aria-label="Calma en minutos"
                    />
                    <span className="mt-1 block text-xs text-zinc-500">
                        El hospital escribe las órdenes en los minutos siguientes a guardar la historia (la última vista: 116
                        minutos). Con {L.calmaMinutosPorDefecto} minutos ya están todas.
                    </span>
                </label>
            </section>

            <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div>
                    <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Servicios del hospital</h2>
                    <p className="text-xs text-zinc-500">
                        Marque los servicios que se leen y, de esos, por qué canales se envían.
                    </p>
                </div>
                {panel.servicios.length === 0 ? (
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                        El agente todavía no ha subido el catálogo de servicios del hospital.
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                                    <th className="py-2 pr-3 font-medium">Servicio</th>
                                    <th className="py-2 pr-3 font-medium">Se lee</th>
                                    {CANALES.map((c) => (
                                        <th key={c.clave} className="py-2 pr-3 font-medium">
                                            {c.nombre}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {panel.servicios.map((s) => (
                                    <tr key={s.codigo} className="border-b border-zinc-100 dark:border-zinc-900">
                                        <td className="py-2 pr-3">
                                            <span className="font-mono text-xs text-zinc-500">{s.codigo}</span>{' '}
                                            <span className="text-zinc-800 dark:text-zinc-200">{s.nombre}</span>
                                        </td>
                                        <td className="py-2 pr-3">
                                            <input
                                                type="checkbox"
                                                checked={seLeen.has(s.codigo)}
                                                onChange={() => alternar(s.codigo)}
                                                aria-label={`Leer ${s.codigo}`}
                                                className="h-4 w-4 rounded border-zinc-300"
                                            />
                                        </td>
                                        {CANALES.map((c) => (
                                            <td key={c.clave} className="py-2 pr-3">
                                                <input
                                                    type="checkbox"
                                                    checked={
                                                        seLeen.has(s.codigo) &&
                                                        (c.clave === 'WHATSAPP' ? serviciosWa : c.clave === 'TELEGRAM' ? serviciosTg : serviciosCorreo).has(
                                                            s.codigo,
                                                        )
                                                    }
                                                    disabled={!seLeen.has(s.codigo)}
                                                    onChange={() =>
                                                        (c.clave === 'WHATSAPP' ? alternarWa : c.clave === 'TELEGRAM' ? alternarTg : alternarCorreo)(s.codigo)
                                                    }
                                                    aria-label={`${c.nombre} ${s.codigo}`}
                                                    className="h-4 w-4 rounded border-zinc-300 disabled:opacity-40"
                                                />
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={guardar}
                    disabled={!hayCambios || guardando}
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                >
                    {guardando ? 'Guardando…' : 'Guardar'}
                </button>
                {error && <span className="text-sm text-red-600">{error}</span>}
                {aviso && <span className="text-sm text-emerald-700 dark:text-emerald-400">{aviso}</span>}
            </div>

            <section className="space-y-2 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Lo que se ha leído</h2>
                <p className="text-zinc-600 dark:text-zinc-400">
                    {panel.lectura.recibidos24h} resumen(es) en las últimas 24 horas · {panel.lectura.recibidos30d} en 30 días
                    {panel.lectura.ultimoRecibidoIso && <> · el último, {formatAppointmentCompact(new Date(panel.lectura.ultimoRecibidoIso))}</>}
                </p>
                {panel.lectura.porServicio.length > 0 && (
                    <p className="text-xs text-zinc-500">
                        Por servicio: {panel.lectura.porServicio.map((p) => `${p.servicio} ${p.cantidad}`).join(' · ')}
                    </p>
                )}
                <p className="text-xs text-zinc-500">
                    Leído hasta la historia {panel.lectura.cursor ?? '— (empieza por las de las últimas horas al encender)'}. El
                    contenido se guarda cifrado y se borra a los {L.retencionContenidoDias} días; solo se ve al abrir un
                    resumen para revisarlo.
                </p>
                <div className="space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-800" data-testid="medicion">
                    <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Cuánto tardan las consultas al hospital (último día)
                    </h3>
                    {panel.medicion ? (
                        <>
                            <p className="text-zinc-600 dark:text-zinc-400">
                                {panel.medicion.vueltas} vuelta(s), {panel.medicion.historias} historia(s) leída(s). Buscar las
                                terminadas: {duracion(panel.medicion.detectar.medianaMs)} de mediana, máximo{' '}
                                {duracion(panel.medicion.detectar.maxMs)}.
                                {panel.medicion.leer && (
                                    <>
                                        {' '}
                                        Leerlas: {duracion(panel.medicion.leer.medianaPorHistoriaMs)} por historia, máximo{' '}
                                        {duracion(panel.medicion.leer.maxMs)} en una vuelta.
                                    </>
                                )}
                            </p>
                            <p className="text-xs text-zinc-500">
                                Última vuelta medida: {formatAppointmentCompact(new Date(panel.medicion.ultimaIso))}.
                            </p>
                        </>
                    ) : (
                        <p className="text-xs text-zinc-500">
                            Todavía no hay mediciones: aparecen cuando el agente lee con «Leer del hospital» encendido.
                        </p>
                    )}
                </div>
            </section>

            <ContenidoResumen
                exclusiones={panel.exclusiones}
                horario={panel.config.horario}
                camposPlantilla={panel.config.camposPlantilla}
            />

            <EncabezadoDocumentos documentos={panel.documentos} nombreClinica={panel.nombreClinica} />

            <MedicionPiloto piloto={panel.envio.piloto} />

            <SeguimientoEnvios envio={panel.envio} />

            <RevisionResumenes revision={panel.revision} destinosPrueba={panel.config.modoPrueba.destinos} />
        </div>
    );
}
