import { sabadoNoCuentaParaElPlazo } from '@agenia/shared';
import {
    getMyOrgSettings,
    getMyPlazoAgendarResumen,
    getMyReservaPresencialResumen,
    getMySabadoRuralEstado,
} from '@/app/actions/settings';
import { obtenerBloqueosAgenda } from '@/app/actions/bloqueos-agenda';
import PlazoAgendarSetting from '../../PlazoAgendarSetting';
import BloqueosAgenda from '../../BloqueosAgenda';
import SabadoRuralSetting from '../../SabadoRuralSetting';
import ReservaPresencialSetting from '../../ReservaPresencialSetting';
import HorariosOfrecidosSetting from '../../HorariosOfrecidosSetting';
import { Ajuste, Seccion, SectionLoadError, Separador, exigirAdministrador, motivoDelFallo } from '../../comunes';

export const dynamic = 'force-dynamic';

/**
 * 🗓️ Agenda que ofrece el asistente: hasta qué día, qué días no, los sábados,
 * qué parte de la agenda de cada médico y cuántas opciones muestra. Cada lectura
 * va aislada: si una falla, el resto se muestra igual.
 */
export default async function AgendaQueOfrecePage() {
    await exigirAdministrador();
    const [ajustes, plazo, bloqueos, sabado, reserva] = await Promise.allSettled([
        getMyOrgSettings(),
        getMyPlazoAgendarResumen(),
        obtenerBloqueosAgenda(),
        getMySabadoRuralEstado(),
        getMyReservaPresencialResumen(),
    ]);
    const s = ajustes.status === 'fulfilled' ? ajustes.value : null;
    const resumenPlazo = plazo.status === 'fulfilled' && plazo.value.success ? plazo.value.resumen : null;
    const estadoSabado = sabado.status === 'fulfilled' && sabado.value.success ? sabado.value.estado : null;
    const resumenReserva = reserva.status === 'fulfilled' && reserva.value.success ? reserva.value.resumen : null;

    return (
        <Seccion
            titulo="Agenda que ofrece el asistente"
            icono="🗓️"
            descripcion="Qué cupos le ofrece el asistente al paciente: hasta qué día, qué días no, los sábados, qué parte de la agenda de cada médico y cuántas opciones a la vez. El personal y el hospital agendan sin estas reglas."
        >
            {s ? (
                <Ajuste id="plazo">
                    <PlazoAgendarSetting
                        initialDias={s.bookingMaxDaysAhead}
                        hoy={s.hoyEnLaClinica}
                        resumenInicial={resumenPlazo}
                        sabadoNoCuenta={sabadoNoCuentaParaElPlazo(s.saturdayRuralSharePercent)}
                    />
                </Ajuste>
            ) : (
                <SectionLoadError
                    title="No pudimos cargar la agenda que ofrece el asistente"
                    detail={ajustes.status === 'rejected' ? motivoDelFallo(ajustes.reason, 'Error desconocido.') : null}
                />
            )}
            <Separador />
            <Ajuste id="dias-sin-citas">
                {bloqueos.status === 'fulfilled' && bloqueos.value.success ? (
                    <BloqueosAgenda inicial={{ hoy: bloqueos.value.hoy, bloqueos: bloqueos.value.bloqueos }} />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar los días sin citas"
                        detail={
                            bloqueos.status === 'fulfilled' && !bloqueos.value.success
                                ? bloqueos.value.error
                                : bloqueos.status === 'rejected'
                                  ? motivoDelFallo(bloqueos.reason, 'Error desconocido.')
                                  : null
                        }
                    />
                )}
            </Ajuste>
            {s && (
                <>
                    <Separador />
                    <Ajuste id="sabados">
                        <SabadoRuralSetting initialPorcentaje={s.saturdayRuralSharePercent} estadoInicial={estadoSabado} />
                    </Ajuste>
                    <Separador />
                    <Ajuste id="parte-asistente">
                        <ReservaPresencialSetting initialPorcentaje={s.botAgendaSharePercent} resumenInicial={resumenReserva} />
                    </Ajuste>
                    <Separador />
                    <Ajuste id="horarios">
                        <HorariosOfrecidosSetting initialCantidad={s.slotsOfferedCount} />
                    </Ajuste>
                </>
            )}
        </Seccion>
    );
}
