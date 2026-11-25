/**
 * 🏥 Rechazos del HIS que se reconocen por el MOTIVO, sin la marca
 * `rechazoDelHis` del agente (2026-10-29).
 *
 * «El médico RU70 no tiene turno el 2026-10-30»: el hospital ajustó su agenda
 * después de que AgenIA ofreció el cupo. Reintentarlo no crea el turno. El
 * agente lo marca como rechazo definitivo desde esta fecha, pero el que corre
 * en el hospital se actualiza aparte (por AnyDesk): hasta entonces, la API lo
 * reconoce por su texto. Antes se reintentaba diez veces, quedaba en
 * dead-letter y la paciente esperaba una confirmación que nunca llegaba.
 *
 * El texto lo escribe el driver de Anserma
 * (`apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/index.ts`), también
 * dentro de un cambio de fecha («no se reagendó, la cita anterior sigue en pie: …»).
 */
const SIN_TURNO = /no tiene turno el \d{4}-\d{2}-\d{2}/i;
/** 2026-10-29: el turno del día sigue, pero esa hora ya no está en él. */
const FUERA_DEL_TURNO = /no atiende a las \d{1,2}:\d{2} el \d{4}-\d{2}-\d{2}/i;

/** ¿El hospital no tiene a ese médico ese día, o a esa hora? (rechazo definitivo) */
export function esRechazoPorAgendaDelHis(motivo: unknown): boolean {
  return (
    typeof motivo === 'string' &&
    (SIN_TURNO.test(motivo) || FUERA_DEL_TURNO.test(motivo))
  );
}

/**
 * 🪪 2026-11-25: «El paciente 123 no existe en el HIS y faltan datos para darlo
 * de alta (nacimiento y/o sexo)». Lo escribe `ensurePaciente` del mismo driver.
 *
 * Quien se anota en la lista de espera da solo su documento y su nombre. Si el
 * hospital no lo tiene, al aceptar un cupo no hay con qué crearlo: reintentar no
 * trae esos datos. Antes se reintentaba diez veces (unos 14 minutos), la cita se
 * rendía y al paciente se le decía que no quedó registrada (dos personas el
 * 24-nov). Ahora es un rechazo definitivo y el chat le pide los datos.
 */
const FALTAN_DATOS_DEL_PACIENTE =
  /no existe en el HIS y faltan datos para darlo de alta/i;

/** ¿El hospital no tiene al paciente y faltan su nacimiento o su sexo para crearlo? */
export function esRechazoPorFaltarDatosDelPaciente(motivo: unknown): boolean {
  return typeof motivo === 'string' && FALTAN_DATOS_DEL_PACIENTE.test(motivo);
}
