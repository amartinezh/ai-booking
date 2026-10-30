import type { ReactNode } from 'react';
import { fechaEnPalabras } from '@agenia/shared';
import { ESTANDAR_DIAS, type CanalDeEspera, type Informe as DatosDelInforme } from '@/lib/estadisticas/informe';
import { ESTADISTICAS, diaCorto, esHoraFueraDeOficina, horaCorta } from '@/lib/estadisticas/periodo';
import Barras, { type ColumnaDeBarras } from './Barras';
import BotonSalir from './BotonSalir';

/**
 * 📊 La página de estadísticas para compartir: la conclusión y seis cifras arriba,
 * luego un gráfico por pregunta. Es la página que se armó a mano en claude.ai el
 * 24-oct, ahora con los datos del día anterior completo.
 */

const COLOR = { serie1: '#2a78d6', serie2: '#eb6834', apagado: '#c6ceda' } as const;

const nf = new Intl.NumberFormat('es-CO');
const nf1 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ent = (n: number) => nf.format(n);
const dec = (n: number) => nf1.format(n);
/** «91,0 %»; «—» si no hay de dónde sacar la proporción. */
const pct = (parte: number, todo: number) => (todo > 0 ? `${nf1.format((100 * parte) / todo)} %` : '—');
const dia = (fecha: string) => fechaEnPalabras(fecha, { conAnio: false });

// Días hasta la cita: del mismo día (más oscuro) a más de 3 (naranja: pasa el estándar).
const TRAMOS = [
    { nombre: 'El mismo día', color: '#1f5fae', claro: false },
    { nombre: 'Al día siguiente', color: '#2a78d6', claro: false },
    { nombre: 'A 2 días', color: '#6fa3e3', claro: true },
    { nombre: 'A 3 días', color: '#a9c8ef', claro: true },
    { nombre: 'A más de 3 días', color: COLOR.serie2, claro: false },
] as const;
const NOMBRE_DEL_CANAL: Record<CanalDeEspera['canal'], string> = {
    chat: 'Por chat (WhatsApp y Telegram)',
    personal: 'Por el personal del hospital (ventanilla, teléfono o panel)',
};

const HORARIO = `antes de las ${horaCorta(ESTADISTICAS.OFICINA_DESDE)}, desde las ${horaCorta(ESTADISTICAS.OFICINA_HASTA)} o en sábado y domingo`;

export default function Informe({
    informe: d,
    clinica,
    organizationId,
}: {
    informe: DatosDelInforme;
    clinica: string;
    organizationId: string;
}) {
    const ultimos = `Últimos ${ESTADISTICAS.DIAS_EN_GRAFICAS} días.`;
    const recordatorios: ColumnaDeBarras[] = d.recordatorios.porDia.map((r) => {
        const trozos = [r.leidos, r.entregados - r.leidos, r.enviados - r.entregados];
        return {
            etiqueta: diaCorto(r.dia),
            titulo: dia(r.dia),
            valores: trozos,
            detalle: [
                { texto: `Enviados: ${ent(r.enviados)}` },
                { color: COLOR.serie1, texto: `Leídos: ${ent(trozos[0])}` },
                { color: COLOR.serie2, texto: `Entregados, aún sin leer: ${ent(trozos[1])}` },
                { color: COLOR.apagado, texto: `No entregados: ${ent(trozos[2])}` },
                { texto: `Personas que confirmaron: ${ent(r.confirmaron)}` },
            ],
        };
    });
    const citas: ColumnaDeBarras[] = d.citasChat.porDia.map((c) => ({
        etiqueta: diaCorto(c.dia),
        titulo: dia(c.dia),
        valores: [c.n],
        detalle: [{ texto: `Citas agendadas: ${ent(c.n)}` }],
    }));
    const horas: ColumnaDeBarras[] = d.mensajes.porHora.map((n, h) => {
        const fuera = esHoraFueraDeOficina(h);
        return {
            etiqueta: horaCorta(h),
            titulo: `De ${horaCorta(h)} a ${horaCorta((h + 1) % 24)}`,
            valores: fuera ? [n, 0] : [0, n],
            detalle: [{ color: fuera ? COLOR.serie1 : COLOR.apagado, texto: `Mensajes: ${ent(n)}` }],
        };
    });
    const gestionMax = Math.max(1, ...d.gestiones.map((g) => g.n));
    const { citasChat: cc, cancelaciones: can, espera: esp } = d;
    const porChat = esp?.canales.find((c) => c.canal === 'chat');
    const porPersonal = esp?.canales.find((c) => c.canal === 'personal');
    const medicinaGeneral = esp?.servicios.some((s) => /medicina general/i.test(s)) ?? false;

    return (
        <main className="min-h-screen bg-[#f4f6f9] text-[#101a2a] text-base leading-normal">
            <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-12 pt-8">
                <header className="grid gap-2.5">
                    <div className="flex items-start justify-between gap-4">
                        <p className="m-0 text-[13px] uppercase tracking-wider text-[#586378]">{clinica}</p>
                        <BotonSalir organizationId={organizationId} />
                    </div>
                    <h1 className="m-0 font-serif text-[clamp(2rem,5vw,3rem)] font-normal leading-tight">AgenIA en cifras</h1>
                    <p className="m-0 max-w-2xl text-[clamp(1.05rem,2.2vw,1.25rem)]">
                        En <b className="font-semibold tabular-nums">{ent(d.dias)}</b> días, pacientes y familias hicieron{' '}
                        <b className="font-semibold tabular-nums">{ent(d.totalGestiones)}</b> gestiones por chat: confirmaron,
                        consultaron, agendaron, cancelaron y cambiaron citas a cualquier hora del día, sin hacer fila ni esperar
                        al teléfono.
                    </p>
                    <p className="m-0 text-sm text-[#586378]">
                        Del {dia(d.desde)} al {fechaEnPalabras(d.ultimoDia)} · WhatsApp y Telegram · se actualiza cada día a
                        las {horaCorta(ESTADISTICAS.HORA_DE_ACTUALIZACION)}
                    </p>
                </header>

                <section aria-label="Cifras principales" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
                    <Cifra nombre="Gestiones por chat" valor={ent(d.totalGestiones)}>
                        Confirmar, consultar, agendar, cancelar y cambiar citas, y avisar que no se podrá asistir.
                    </Cifra>
                    <Cifra nombre="Recordatorios leídos" valor={ent(d.recordatorios.leidos)}>
                        De <b>{ent(d.recordatorios.enviados)}</b> enviados por WhatsApp. Se leyó el{' '}
                        <b>{pct(d.recordatorios.leidos, d.recordatorios.entregados)}</b> de los entregados.
                    </Cifra>
                    <Cifra nombre="Pacientes que confirmaron su cita" valor={ent(d.personasQueConfirmaron)}>
                        Respondieron al recordatorio por WhatsApp con un «sí, voy».
                    </Cifra>
                    <Cifra nombre="Citas agendadas por chat" valor={ent(cc.total)}>
                        {cc.desde ? (
                            <>
                                Desde el <b>{dia(cc.desde)}</b>.
                                {cc.enHospital !== null && (
                                    <>
                                        {' '}
                                        El <b>{pct(cc.enHospital, cc.total)}</b> quedó escrito en el sistema del hospital.
                                    </>
                                )}
                            </>
                        ) : (
                            'Todavía ninguna.'
                        )}
                    </Cifra>
                    {porChat && (
                        <Cifra nombre="Días hasta la cita por chat" valor={dec(porChat.promedioDias)}>
                            En promedio, desde que el paciente la pide.
                            {porPersonal && (
                                <>
                                    {' '}
                                    Por el personal del hospital, <b>{dec(porPersonal.promedioDias)}</b> días.
                                </>
                            )}
                            {medicinaGeneral && (
                                <>
                                    {' '}
                                    El estándar de medicina general es de <b>{ESTANDAR_DIAS} días</b>.
                                </>
                            )}
                        </Cifra>
                    )}
                    <Cifra nombre="Cupos devueltos por cancelación" valor={ent(can.total)}>
                        <b>{ent(can.retomados)}</b> de esos cupos ya los tomó otro paciente.
                    </Cifra>
                    <Cifra nombre="Mensajes fuera de horario" valor={pct(d.mensajes.fueraDeHorario, d.mensajes.total)}>
                        De <b>{ent(d.mensajes.total)}</b> mensajes, de <b>{ent(d.mensajes.personas)}</b> personas. {mayuscula(HORARIO)}.
                    </Cifra>
                </section>

                {d.recordatorios.enviados > 0 && (
                    <Seccion titulo="Los recordatorios llegan y se leen">
                        <Tarjeta
                            titulo="Recordatorios de cita por día"
                            nota={`Cada barra son los recordatorios enviados ese día por WhatsApp, divididos según lo que pasó con ellos. Los que no se entregan son números sin WhatsApp activo.${d.recordatorios.recortada ? ` ${ultimos}` : ''}`}
                        >
                            <Leyenda
                                items={[
                                    [COLOR.serie1, 'Leídos'],
                                    [COLOR.serie2, 'Entregados, aún sin leer'],
                                    [COLOR.apagado, 'No entregados'],
                                ]}
                            />
                            <Barras
                                columnas={recordatorios}
                                series={[
                                    { nombre: 'Leídos', color: COLOR.serie1 },
                                    { nombre: 'Entregados, aún sin leer', color: COLOR.serie2 },
                                    { nombre: 'No entregados', color: COLOR.apagado },
                                ]}
                                alto={250}
                                descripcion="Recordatorios enviados por día: leídos, entregados sin leer y no entregados"
                            />
                        </Tarjeta>
                    </Seccion>
                )}

                {d.totalGestiones > 0 && (
                    <Seccion titulo="Lo que pacientes y familias resolvieron por chat">
                        <Tarjeta
                            titulo="Gestiones por tipo"
                            nota="Cada una es una conversación que terminó en algo concreto: una cita confirmada, consultada, agendada, cancelada o cambiada de fecha, o un aviso que le llegó al personal."
                        >
                            <div className="grid gap-2.5">
                                {d.gestiones.map((g) => (
                                    <div
                                        key={g.tipo}
                                        className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_3.5rem]"
                                    >
                                        <div className="min-w-0 leading-snug">{g.tipo}</div>
                                        <div className="col-span-2 row-start-2 h-5 sm:col-span-1 sm:row-start-auto">
                                            <div
                                                className="h-full min-w-1 rounded bg-[#2a78d6]"
                                                style={{ width: `${(100 * g.n) / gestionMax}%` }}
                                            />
                                        </div>
                                        <div className="text-right font-semibold tabular-nums">{ent(g.n)}</div>
                                    </div>
                                ))}
                            </div>
                        </Tarjeta>
                    </Seccion>
                )}

                {(cc.total > 0 || can.total > 0) && (
                    <Seccion titulo="Agendar y cancelar sin hacer fila ni llamar">
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-4">
                            {cc.total > 0 && (
                                <Tarjeta
                                    titulo="Citas agendadas por chat, por día"
                                    nota={`Las que el paciente agendó él mismo por WhatsApp o Telegram.${cc.enHospital !== null ? ' Cada cita queda escrita en el sistema del hospital en cuanto el paciente dice que sí.' : ''}${cc.recortada ? ` ${ultimos}` : ''}`}
                                >
                                    <Barras
                                        columnas={citas}
                                        series={[{ nombre: 'Citas agendadas', color: COLOR.serie1 }]}
                                        alto={150}
                                        conEjeY={false}
                                        conValores
                                        anchoMaxBarra={56}
                                        descripcion="Citas agendadas por chat cada día"
                                    />
                                    <Datos
                                        items={[
                                            ['Pacientes nuevos registrados por el chat', ent(cc.pacientesNuevos)],
                                            ...(cc.segundosAlHospital !== null
                                                ? [['Segundos hasta el sistema del hospital', dec(cc.segundosAlHospital)] as [string, string]]
                                                : []),
                                            ['Agendadas fuera de horario', ent(cc.fueraDeHorario)],
                                        ]}
                                    />
                                </Tarjeta>
                            )}
                            {can.total > 0 && (
                                <Tarjeta
                                    titulo="Cupos que volvieron a la agenda"
                                    nota="Cuando un paciente cancela por chat, el cupo se libera al instante y queda disponible para otra persona."
                                >
                                    <div
                                        role="img"
                                        aria-label={`${can.retomados} de ${can.total} cupos devueltos ya los tomó otro paciente`}
                                        className="h-6 overflow-hidden rounded bg-[#c6ceda]"
                                    >
                                        <div className="h-full rounded bg-[#2a78d6]" style={{ width: `${(100 * can.retomados) / can.total}%` }} />
                                    </div>
                                    <p className="m-0 text-[15px]">
                                        <b className="tabular-nums">{ent(can.retomados)}</b> de <b className="tabular-nums">{ent(can.total)}</b>{' '}
                                        cupos devueltos ya los tomó otro paciente (<b className="tabular-nums">{pct(can.retomados, can.total)}</b>).
                                    </p>
                                    <Datos
                                        items={[
                                            ...(can.horasMediana !== null
                                                ? [['Horas de anticipación (mediana)', dec(can.horasMediana)] as [string, string]]
                                                : []),
                                            ['Avisos de inasistencia al personal', ent(d.avisosInasistencia)],
                                        ]}
                                    />
                                </Tarjeta>
                            )}
                        </div>
                    </Seccion>
                )}

                {esp && (
                    <Seccion titulo="¿Cuánto espera el paciente por su cita?">
                        {esp.canales.length > 0 && (
                            <Tarjeta
                                titulo="Días desde que pide la cita hasta el día de la cita"
                                nota={`Es el indicador de oportunidad de la cita (Resolución 256 de 2016): días calendario entre el día en que el paciente la pide y el día para el que se la asignan. ${
                                    esp.servicios.length === 1 ? `Servicio: ${esp.servicios[0]}.` : `Servicios: ${esp.servicios.join(', ')}.`
                                }${medicinaGeneral ? ` El estándar para medicina general es de ${ESTANDAR_DIAS} días.` : ''}`}
                            >
                                <Leyenda items={TRAMOS.map((t) => [t.color, t.nombre] as [string, string])} />
                                <div className="grid gap-6">
                                    {esp.canales.map((c) => (
                                        <FilaDeEspera key={c.canal} canal={c} />
                                    ))}
                                </div>
                                <p className="m-0 max-w-[75ch] text-[13px] text-[#586378]">
                                    Por chat, el asistente ofrece los cupos libres más próximos y la cita queda asignada en
                                    la misma conversación.{' '}
                                    {cc.enHospital !== null
                                        ? 'Las del personal son las que el hospital asigna en su sistema, contadas desde que AgenIA las ve allí, que es en el momento.'
                                        : 'Las del personal son las que se agendan desde el panel de AgenIA.'}{' '}
                                    Citas pedidas del {dia(d.desde)} al {dia(d.ultimoDia)}.
                                </p>
                            </Tarjeta>
                        )}
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-4">
                            {esp.conversacion.medidas > 0 && esp.conversacion.medianaMin !== null && (
                                <Tarjeta
                                    titulo="Minutos para conseguir la cita por chat"
                                    nota="Del primer mensaje del paciente a la cita asignada, en la misma conversación. Sin filas ni llamadas en espera."
                                >
                                    <p className="m-0 text-[15px]">
                                        <span className="mr-1.5 font-serif text-[3.2rem] leading-none tabular-nums text-[#2a78d6]">
                                            {dec(esp.conversacion.medianaMin)}
                                        </span>
                                        minutos (la mitad de las citas, en menos)
                                    </p>
                                    <Datos
                                        items={[
                                            ['Promedio (minutos)', esp.conversacion.promedioMin !== null ? dec(esp.conversacion.promedioMin) : '—'],
                                            ['Citas medidas', `${ent(esp.conversacion.medidas)} de ${ent(esp.conversacion.citas)}`],
                                        ]}
                                    />
                                    <p className="m-0 text-[12px] text-[#586378]">
                                        No se miden las que pidió un familiar desde su propio número.
                                    </p>
                                </Tarjeta>
                            )}
                            {esp.listaEspera.asignadas > 0 && esp.listaEspera.medianaHoras !== null && (
                                <Tarjeta
                                    titulo="De la lista de espera a la cita"
                                    nota="Cuando no hay cupo, el paciente entra a la lista de espera; apenas se libera uno, el asistente se lo ofrece y la cita queda asignada."
                                >
                                    <p className="m-0 text-[15px]">
                                        <span className="mr-1.5 font-serif text-[3.2rem] leading-none tabular-nums text-[#2a78d6]">
                                            {dec(esp.listaEspera.medianaHoras)}
                                        </span>
                                        horas (la mitad, en menos)
                                    </p>
                                    <Datos
                                        items={[
                                            ['Promedio (horas)', esp.listaEspera.promedioHoras !== null ? dec(esp.listaEspera.promedioHoras) : '—'],
                                            ['Pacientes que recibieron cupo', ent(esp.listaEspera.asignadas)],
                                        ]}
                                    />
                                </Tarjeta>
                            )}
                        </div>
                    </Seccion>
                )}

                {d.mensajes.total > 0 && (
                    <Seccion titulo="El chat atiende cuando el hospital está cerrado">
                        <Tarjeta
                            titulo="Mensajes de pacientes por hora del día"
                            nota="Hora de Colombia, todos los días juntos. Las barras azules son las horas sin atención telefónica de oficina."
                        >
                            <Leyenda
                                items={[
                                    [
                                        COLOR.serie1,
                                        `Fuera de horario (antes de las ${horaCorta(ESTADISTICAS.OFICINA_DESDE)} o desde las ${horaCorta(ESTADISTICAS.OFICINA_HASTA)})`,
                                    ],
                                    [COLOR.apagado, 'Horario de oficina'],
                                ]}
                            />
                            <Barras
                                columnas={horas}
                                series={[
                                    { nombre: 'Fuera de horario', color: COLOR.serie1 },
                                    { nombre: 'Horario de oficina', color: COLOR.apagado },
                                ]}
                                alto={230}
                                descripcion="Mensajes recibidos por hora del día"
                            />
                        </Tarjeta>
                    </Seccion>
                )}

                {d.asistencia.length > 0 && (
                    <Seccion titulo="Asistencia a las citas">
                        <Tarjeta
                            titulo="Pacientes que asistieron, según si recibieron el recordatorio"
                            nota="Citas ya pasadas desde que empezaron los recordatorios, de los médicos y servicios que atiende el asistente, según lo que el hospital registró."
                        >
                            <div className="grid gap-4">
                                {d.asistencia.map((a) => (
                                    <div
                                        key={a.grupo}
                                        className="grid grid-cols-1 items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
                                    >
                                        <div className="leading-snug">{a.grupo}</div>
                                        <div className="font-serif text-3xl tabular-nums">{pct(a.asistieron, a.citas)}</div>
                                        <div className="h-3 overflow-hidden rounded bg-[#e9edf3] sm:col-start-2">
                                            <div
                                                className="h-full rounded"
                                                style={{
                                                    width: `${(100 * a.asistieron) / a.citas}%`,
                                                    background: a.destacado ? COLOR.serie1 : COLOR.apagado,
                                                }}
                                            />
                                        </div>
                                        <div className="text-[13px] text-[#586378] sm:col-start-2">
                                            {ent(a.asistieron)} de {ent(a.citas)} citas
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Tarjeta>
                    </Seccion>
                )}

                <footer className="grid max-w-3xl gap-1.5 border-t border-[#dde3eb] pt-5 text-sm text-[#586378]">
                    <p className="m-0">
                        <b className="font-semibold text-[#101a2a]">Cómo se midió.</b> Todas las cifras salen de la base de datos
                        de AgenIA y no incluyen datos de ningún paciente. Van hasta el {fechaEnPalabras(d.ultimoDia)}, completo, y
                        se recalculan a las {horaCorta(ESTADISTICAS.HORA_DE_ACTUALIZACION)} de cada día.
                        {d.recordatorios.enviados > 0 && <> Los recordatorios empezaron el {dia(d.desde)}.</>}
                        {cc.desde && <> El agendamiento por chat, el {dia(cc.desde)}.</>}
                    </p>
                    <p className="m-0">
                        «Fuera de horario» es {HORARIO}. Un recordatorio leído es uno que WhatsApp reportó como leído. Las
                        gestiones cuentan cada cita confirmada una sola vez.
                    </p>
                </footer>
            </div>
        </main>
    );
}

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function Cifra({ nombre, valor, children }: { nombre: string; valor: string; children: ReactNode }) {
    return (
        <article className="grid min-w-0 content-start gap-1 rounded-[10px] border border-[#dde3eb] bg-white p-5">
            <p className="m-0 text-[15px] text-[#586378]">{nombre}</p>
            <p className="m-0 font-serif text-[2.6rem] leading-tight tabular-nums">{valor}</p>
            <p className="m-0 text-[13px] leading-relaxed text-[#586378] [&_b]:font-semibold [&_b]:text-[#101a2a] [&_b]:tabular-nums">
                {children}
            </p>
        </article>
    );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
    return (
        <section className="grid gap-4">
            <h2 className="m-0 text-[1.4rem] font-semibold">{titulo}</h2>
            {children}
        </section>
    );
}

function Tarjeta({ titulo, nota, children }: { titulo: string; nota: string; children: ReactNode }) {
    return (
        <div className="grid min-w-0 content-start gap-2.5 rounded-[10px] border border-[#dde3eb] bg-white p-5">
            <p className="m-0 text-[1.05rem] font-semibold">{titulo}</p>
            <p className="m-0 max-w-[62ch] text-[13px] text-[#586378]">{nota}</p>
            {children}
        </div>
    );
}

function Leyenda({ items }: { items: [string, string][] }) {
    return (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-[13px] text-[#586378]">
            {items.map(([color, texto]) => (
                <li key={texto} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: color }} />
                    {texto}
                </li>
            ))}
        </ul>
    );
}

/** Un canal: el promedio, cuántas dentro del estándar y el reparto por días en una barra. */
function FilaDeEspera({ canal: c }: { canal: CanalDeEspera }) {
    const resumen = TRAMOS.map((t, i) => `${t.nombre}: ${pct(c.reparto[i], c.citas)}`).join('; ');
    return (
        <div className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-semibold">{NOMBRE_DEL_CANAL[c.canal]}</span>
                <span className="text-[14px] text-[#586378]">
                    <b className="font-serif text-[1.7rem] font-normal tabular-nums text-[#101a2a]">{dec(c.promedioDias)}</b> días en
                    promedio · <b className="tabular-nums text-[#101a2a]">{pct(c.dentroDe3 * c.citas, c.citas)}</b> dentro de{' '}
                    {ESTANDAR_DIAS} días · {ent(c.citas)} citas
                </span>
            </div>
            <div role="img" aria-label={`${NOMBRE_DEL_CANAL[c.canal]}: ${resumen}`} className="flex h-8 overflow-hidden rounded bg-[#e9edf3]">
                {c.reparto.map((n, i) =>
                    n > 0 ? (
                        <div
                            key={i}
                            title={`${TRAMOS[i].nombre}: ${ent(n)} citas (${pct(n, c.citas)})`}
                            className={`flex items-center justify-center overflow-hidden whitespace-nowrap text-[12px] font-semibold tabular-nums ${
                                TRAMOS[i].claro ? 'text-[#101a2a]' : 'text-white'
                            }`}
                            style={{ width: `${(100 * n) / c.citas}%`, background: TRAMOS[i].color }}
                        >
                            {n / c.citas >= 0.1 ? `${Math.round((100 * n) / c.citas)} %` : ''}
                        </div>
                    ) : null,
                )}
            </div>
        </div>
    );
}

function Datos({ items }: { items: [string, string][] }) {
    return (
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-4">
            {items.map(([t, v]) => (
                <div key={t} className="grid gap-0.5">
                    <dt className="text-[13px] text-[#586378]">{t}</dt>
                    <dd className="m-0 font-serif text-[1.6rem] tabular-nums">{v}</dd>
                </div>
            ))}
        </dl>
    );
}
