'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
    MAX_DESTINATARIOS_AVISO,
    UMBRALES_VIGILANTE,
    coberturaAvisos,
    problemaDeCobertura,
    type ModoDestinatario,
} from '@agenia/shared';
import { guardarAvisosAction, probarAvisoAction } from '@/app/actions/bandeja';
import type {
    DestinatarioVista,
    EntradaDestinatario,
    EstadoAvisos,
    EstadoEnvioDestinatario,
    RecibeAvisos,
} from '@/lib/bandeja/tipos';
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO } from './estilos';

/**
 * 📣 Los avisos por WhatsApp de la Bandeja (docs/PLAN_AVISOS_AGENDADORES.md).
 *
 * Arriba, si salen y a cuántas personas llegan; quien no configura ve además si él
 * los recibe (§3.5). El administrador abre «Configurar avisos»: la lista de
 * agendadores y administradores de la clínica, cada uno con su celular, qué recibe y
 * cómo le fue con el último aviso, y abajo los números sin cuenta.
 *
 * La pantalla no decide nada: el servidor vuelve a validar todo al guardar (y la API,
 * al probar). Lo que se calcula aquí (la cobertura, la advertencia) usa las mismas
 * reglas de `@agenia/shared` para avisar ANTES de guardar.
 */

const ETIQUETA_RECIBE: Record<RecibeAvisos, string> = {
    NO: 'No recibe',
    AVISOS: 'Avisos y recordatorios',
    SOLO_RECORDATORIOS: 'Solo recordatorios',
};

const ETIQUETA_ROL = { ORG_ADMIN: 'Administrador', BOOKING_AGENT: 'Agendador' } as const;

const ESTILO_ESTADO: Record<EstadoEnvioDestinatario['tono'], string> = {
    ok: 'text-emerald-700 dark:text-emerald-300',
    pendiente: 'text-zinc-600 dark:text-zinc-300',
    error: 'font-medium text-red-700 dark:text-red-300',
    nunca: 'text-zinc-500 dark:text-zinc-400',
};

/** Una fila mientras se edita. */
interface FilaEditable {
    /** Para React y para las etiquetas: estable mientras la pantalla está abierta. */
    clave: string;
    id: string | null;
    userId: string | null;
    nombre: string;
    rol: DestinatarioVista['rol'];
    alcance: string | null;
    label: string;
    phone: string;
    /** El número guardado: «Probar» solo con ese (lo que se prueba es lo que ya está en la lista). */
    phoneGuardado: string | null;
    recibe: RecibeAvisos;
    syncAlerts: boolean;
    patientRequestAlerts: boolean;
    isActive: boolean;
    estado: EstadoEnvioDestinatario;
}

/** 573105550101 → «310 555 0101» (lo que se escribe a mano). */
function celularParaMostrar(phone: string | null): string {
    const m = /^57(3\d{2})(\d{3})(\d{4})$/.exec(phone ?? '');
    return m ? `${m[1]} ${m[2]} ${m[3]}` : (phone ?? '');
}

const soloDigitos = (s: string) => s.replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, '');

function filasIniciales(lista: DestinatarioVista[]): FilaEditable[] {
    return lista.map((d, i) => ({
        clave: d.id ?? d.userId ?? `f-${i}`,
        id: d.id,
        userId: d.userId,
        nombre: d.nombre,
        rol: d.rol,
        alcance: d.alcance,
        label: d.label ?? '',
        phone: celularParaMostrar(d.phone),
        phoneGuardado: d.id ? d.phone : null,
        recibe: d.recibe,
        syncAlerts: d.syncAlerts,
        patientRequestAlerts: d.patientRequestAlerts,
        isActive: d.isActive,
        estado: d.estado,
    }));
}

/** Las que reciben, como las entienden las reglas compartidas (para la cobertura en vivo). */
function comoReglas(filas: FilaEditable[]) {
    return filas
        .filter((f): f is FilaEditable & { recibe: ModoDestinatario } => f.recibe !== 'NO')
        .map((f) => ({
            mode: f.recibe,
            syncAlerts: f.syncAlerts,
            patientRequestAlerts: f.patientRequestAlerts,
            isActive: f.isActive,
            alcance: f.alcance && f.alcance !== 'Todo' ? {} : null,
        }));
}

function textoCobertura(c: EstadoAvisos['cobertura']): string {
    const p = c.personas;
    return `Llegan a ${p} ${p === 1 ? 'persona' : 'personas'} · citas que no llegan al hospital: ${c.porGrupo.SINCRONIZACION.recordatorios} · pedidos de pacientes: ${c.porGrupo.PEDIDOS_PACIENTES.recordatorios}`;
}

export default function PanelAvisos({ avisos, puedeConfigurar }: { avisos: EstadoAvisos; puedeConfigurar: boolean }) {
    const [editando, setEditando] = useState(false);
    const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

    const estilos = avisos.salen
        ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-200'
        : 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200';
    const sync = avisos.cobertura.porGrupo.SINCRONIZACION;
    const conEscalamiento = sync.recordatorios > sync.avisos;

    return (
        <section className={`rounded-xl border p-4 ${estilos}`} aria-label="Avisos al agendador">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-sm font-semibold">
                        {avisos.salen
                            ? 'Los avisos por WhatsApp a los agendadores están activos'
                            : 'Los avisos por WhatsApp a los agendadores NO están saliendo'}
                    </h2>
                    <p className="mt-1 text-sm leading-snug opacity-90">
                        {avisos.salen
                            ? `Llegan a ${avisos.cobertura.personas} ${avisos.cobertura.personas === 1 ? 'persona' : 'personas'}. Si una cita confirmada no llega al hospital, se les avisa antes de la hora de la cita. Si en ${UMBRALES_VIGILANTE.recordatorioMin} min nadie la toma aquí, se les recuerda (hasta ${UMBRALES_VIGILANTE.maxRecordatorios} veces)${conEscalamiento ? ', también a quienes están en «Solo recordatorios»' : ''}.`
                            : `${avisos.razon ?? ''} Mientras tanto las excepciones solo aparecen en esta bandeja: hay que abrirla para enterarse.`}
                    </p>
                    <p className="mt-1 text-sm leading-snug opacity-90">
                        {avisos.razonPacientes === null
                            ? `🙋 Si un paciente pidió cancelar y no confirmó, o avisó que no irá, se avisa cuando a la cita le faltan ${UMBRALES_VIGILANTE.urgenciaAltaHoras} horas o menos, y otra vez a ${UMBRALES_VIGILANTE.urgenciaCriticaHoras} horas.`
                            : `🙋 Pedidos de pacientes (pidió cancelar y no confirmó, avisó que no irá): no se avisan por WhatsApp. ${avisos.razonPacientes}`}
                    </p>
                    <MiEstado yo={avisos.yo} puedeConfigurar={puedeConfigurar} />
                </div>
                {puedeConfigurar && (
                    <button
                        type="button"
                        className={BOTON_SECUNDARIO}
                        onClick={() => {
                            setMensaje(null);
                            setEditando((v) => !v);
                        }}
                        aria-expanded={editando}
                    >
                        {editando ? 'Cerrar' : 'Configurar avisos'}
                    </button>
                )}
            </div>

            {puedeConfigurar && editando && avisos.destinatarios && (
                <Editor
                    avisos={avisos}
                    destinatarios={avisos.destinatarios}
                    alGuardar={(texto) => {
                        setMensaje({ ok: true, texto });
                        setEditando(false);
                    }}
                />
            )}
            {mensaje && (
                <p
                    role={mensaje.ok ? 'status' : 'alert'}
                    className={`mt-2 text-sm ${mensaje.ok ? '' : 'font-medium text-red-700 dark:text-red-300'}`}
                >
                    {mensaje.texto}
                </p>
            )}
        </section>
    );
}

/** §3.5: lo que cada quien sabe de sí mismo. El administrador que no recibe ya ve la lista. */
function MiEstado({ yo, puedeConfigurar }: { yo: EstadoAvisos['yo']; puedeConfigurar: boolean }) {
    if (yo.recibe) {
        const que = [yo.syncAlerts && 'citas que no llegan al hospital', yo.patientRequestAlerts && 'pedidos de pacientes']
            .filter(Boolean)
            .join(' y ');
        return (
            <p className="mt-1 text-sm leading-snug opacity-90">
                📱 {yo.enPausa ? 'Estás en pausa: no recibes' : 'Recibes'} estos avisos en tu WhatsApp ({yo.numero}): {que}
                {yo.modo === 'SOLO_RECORDATORIOS' ? ', solo los recordatorios' : ''}.
            </p>
        );
    }
    if (puedeConfigurar) return null;
    return (
        <p className="mt-1 text-sm leading-snug opacity-90">
            📱 No recibes estos avisos por WhatsApp. Si los necesitas, pídeselo al administrador.
        </p>
    );
}

function Editor({
    avisos,
    destinatarios,
    alGuardar,
}: {
    avisos: EstadoAvisos;
    destinatarios: DestinatarioVista[];
    alGuardar: (texto: string) => void;
}) {
    const router = useRouter();
    const [filas, setFilas] = useState<FilaEditable[]>(() => filasIniciales(destinatarios));
    const [activos, setActivos] = useState(avisos.alertasActivas);
    const [error, setError] = useState<string | null>(null);
    const [nuevas, setNuevas] = useState(0);
    const [guardando, iniciar] = useTransition();

    const cambiar = (clave: string, cambio: Partial<FilaEditable>) =>
        setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));

    const reglas = comoReglas(filas);
    const cobertura = coberturaAvisos(reglas);
    const problema = problemaDeCobertura(reglas);
    const activas = reglas.filter((r) => r.isActive).length;
    const personas = filas.filter((f) => f.userId);
    const sueltos = filas.filter((f) => !f.userId);

    function guardar() {
        setError(null);
        const lista: EntradaDestinatario[] = filas
            .filter((f): f is FilaEditable & { recibe: ModoDestinatario } => f.recibe !== 'NO')
            .map((f) => ({
                id: f.id,
                userId: f.userId,
                label: f.userId ? null : f.label,
                phone: f.phone,
                mode: f.recibe,
                syncAlerts: f.syncAlerts,
                patientRequestAlerts: f.patientRequestAlerts,
                isActive: f.isActive,
            }));
        iniciar(async () => {
            const r = await guardarAvisosAction({ activos, destinatarios: lista });
            if (!r.success) {
                setError(r.error);
                return;
            }
            alGuardar('Guardado.');
            router.refresh();
        });
    }

    return (
        <div className="mt-4 space-y-4 rounded-lg border border-zinc-200 bg-white p-3 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
            <p className="text-xs text-zinc-600 dark:text-zinc-300" aria-live="polite">
                {textoCobertura(cobertura)}
            </p>

            <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Agendadores y administradores
                </h3>
                {personas.length === 0 ? (
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">No hay agendadores ni administradores en esta clínica.</p>
                ) : (
                    <ul className="mt-2 space-y-2">
                        {personas.map((f) => (
                            <FilaDestinatario key={f.clave} f={f} cambiar={cambiar} />
                        ))}
                    </ul>
                )}
            </div>

            <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Otros números (sin cuenta en AgenIA)
                </h3>
                {sueltos.length > 0 && (
                    <ul className="mt-2 space-y-2">
                        {sueltos.map((f, i) => (
                            <FilaDestinatario
                                key={f.clave}
                                f={f}
                                numero={i + 1}
                                cambiar={cambiar}
                                quitar={() => setFilas((fs) => fs.filter((x) => x.clave !== f.clave))}
                            />
                        ))}
                    </ul>
                )}
                <button
                    type="button"
                    className={`${BOTON_SECUNDARIO} mt-2`}
                    onClick={() => {
                        setNuevas((n) => n + 1);
                        setFilas((fs) => [
                            ...fs,
                            {
                                clave: `nueva-${nuevas + 1}`,
                                id: null,
                                userId: null,
                                nombre: '',
                                rol: null,
                                alcance: null,
                                label: '',
                                phone: '',
                                phoneGuardado: null,
                                recibe: 'AVISOS',
                                syncAlerts: true,
                                patientRequestAlerts: true,
                                isActive: true,
                                estado: { tono: 'nunca', texto: '' },
                            },
                        ]);
                    }}
                >
                    + Agregar un número
                </button>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Cada celular es un teléfono personal: el aviso lleva solo un resumen, sin datos de ningún paciente. Avísale a cada
                persona antes de agregarla y usa «Probar» para confirmar que le llega. «Solo recordatorios» no recibe el primer
                aviso: se entera cuando pasan {UMBRALES_VIGILANTE.recordatorioMin} min sin que nadie tome la excepción en esta
                bandeja. Como mucho {MAX_DESTINATARIOS_AVISO} personas.
            </p>

            {(cobertura.porGrupo.SINCRONIZACION.todosAcotados || cobertura.porGrupo.PEDIDOS_PACIENTES.todosAcotados) && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                    Todos los que reciben el aviso están limitados a una EPS o a un médico: los casos de otras EPS, o sin EPS, les
                    llegarán a todos ellos.
                </p>
            )}
            {problema && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{problema}</p>}
            {activas > MAX_DESTINATARIOS_AVISO && (
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    Hay {activas} personas recibiendo: el máximo es {MAX_DESTINATARIOS_AVISO}.
                </p>
            )}

            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={activos} onChange={(e) => setActivos(e.target.checked)} />
                Avisar por WhatsApp cuando una cita no llegue al hospital o un paciente pida algo con la cita cerca
            </label>
            {(!avisos.plantilla || !avisos.plantillaPacientes) && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                    {!avisos.plantilla
                        ? 'Falta la plantilla «Aviso al agendador (excepciones de sincronización)»'
                        : 'Falta la plantilla «Aviso al agendador (pedidos de pacientes)»'}
                    : se registra, con el nombre exacto que aprobó Meta, en{' '}
                    <Link href="/dashboard/configuracion" className="underline">
                        Configuración
                    </Link>
                    .
                </p>
            )}
            {error && (
                <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">
                    {error}
                </p>
            )}
            <button type="button" className={BOTON_PRIMARIO} disabled={guardando} onClick={guardar}>
                {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
        </div>
    );
}

function FilaDestinatario({
    f,
    numero,
    cambiar,
    quitar,
}: {
    f: FilaEditable;
    /** Solo los números sin cuenta: su posición, para nombrar sus campos. */
    numero?: number;
    cambiar: (clave: string, cambio: Partial<FilaEditable>) => void;
    quitar?: () => void;
}) {
    const [probando, iniciar] = useTransition();
    const [prueba, setPrueba] = useState<{ ok: boolean; texto: string } | null>(null);
    const quien = f.userId ? f.nombre : `el número ${numero}`;
    const recibe = f.recibe !== 'NO';
    const sinCambios = !!f.phoneGuardado && soloDigitos(f.phone) === soloDigitos(f.phoneGuardado);
    const puedeProbar = !!f.id && recibe && sinCambios;

    function probar() {
        if (!f.id) return;
        setPrueba(null);
        iniciar(async () => {
            const r = await probarAvisoAction(f.id as string);
            setPrueba(
                r.success
                    ? { ok: true, texto: 'Prueba enviada. Pídele que confirme que le llegó.' }
                    : { ok: false, texto: r.error },
            );
        });
    }

    return (
        <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-[10rem] flex-1">
                    {f.userId ? (
                        <>
                            <p className="text-sm font-medium">{f.nombre}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {f.rol ? ETIQUETA_ROL[f.rol] : ''}
                                {f.alcance ? ` · ${f.alcance === 'Todo' ? 've todo' : f.alcance}` : ''}
                            </p>
                        </>
                    ) : (
                        <input
                            className={CAMPO}
                            aria-label={`Nombre de ${quien}`}
                            placeholder="Nombre (ej. Coordinación de citas)"
                            maxLength={60}
                            value={f.label}
                            onChange={(e) => cambiar(f.clave, { label: e.target.value })}
                        />
                    )}
                </div>
                <div className="w-full sm:w-40">
                    <input
                        className={CAMPO}
                        inputMode="tel"
                        aria-label={`Celular de ${quien}`}
                        placeholder="300 123 4567"
                        value={f.phone}
                        onChange={(e) => cambiar(f.clave, { phone: e.target.value })}
                    />
                </div>
                <div className="w-full sm:w-52">
                    <select
                        className={CAMPO}
                        aria-label={`Qué recibe ${quien}`}
                        value={f.recibe}
                        onChange={(e) => cambiar(f.clave, { recibe: e.target.value as RecibeAvisos })}
                    >
                        {(f.userId ? (['NO', 'AVISOS', 'SOLO_RECORDATORIOS'] as const) : (['AVISOS', 'SOLO_RECORDATORIOS'] as const)).map(
                            (r) => (
                                <option key={r} value={r}>
                                    {ETIQUETA_RECIBE[r]}
                                </option>
                            ),
                        )}
                    </select>
                </div>
            </div>

            {recibe && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <label className="flex items-center gap-1.5">
                        <input
                            type="checkbox"
                            checked={f.syncAlerts}
                            onChange={(e) => cambiar(f.clave, { syncAlerts: e.target.checked })}
                            aria-label={`Citas que no llegan al hospital (${quien})`}
                        />
                        Citas que no llegan al hospital
                    </label>
                    <label className="flex items-center gap-1.5">
                        <input
                            type="checkbox"
                            checked={f.patientRequestAlerts}
                            onChange={(e) => cambiar(f.clave, { patientRequestAlerts: e.target.checked })}
                            aria-label={`Pedidos de pacientes (${quien})`}
                        />
                        Pedidos de pacientes
                    </label>
                    <label className="flex items-center gap-1.5">
                        <input
                            type="checkbox"
                            checked={!f.isActive}
                            onChange={(e) => cambiar(f.clave, { isActive: !e.target.checked })}
                            aria-label={`En pausa (${quien})`}
                        />
                        En pausa
                    </label>
                </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-3">
                {f.id && f.estado.texto && (
                    <p className={`text-xs ${ESTILO_ESTADO[f.estado.tono]}`}>Último aviso: {f.estado.texto}</p>
                )}
                {f.id && recibe && (
                    <button
                        type="button"
                        className={`${BOTON_SECUNDARIO} text-xs`}
                        disabled={!puedeProbar || probando}
                        title={puedeProbar ? undefined : 'Guarda los cambios antes de probar este número.'}
                        aria-label={`Probar ${quien}`}
                        onClick={probar}
                    >
                        {probando ? 'Enviando…' : 'Probar'}
                    </button>
                )}
                {quitar && (
                    <button type="button" className={`${BOTON_SECUNDARIO} text-xs`} aria-label={`Quitar ${quien}`} onClick={quitar}>
                        Quitar
                    </button>
                )}
            </div>
            {prueba && (
                <p
                    role={prueba.ok ? 'status' : 'alert'}
                    className={`mt-1 text-xs ${prueba.ok ? 'text-emerald-700 dark:text-emerald-300' : 'font-medium text-red-700 dark:text-red-300'}`}
                >
                    {prueba.texto}
                </p>
            )}
        </li>
    );
}
