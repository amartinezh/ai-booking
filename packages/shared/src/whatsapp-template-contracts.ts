/**
 * ══════════════════════════════════════════════════════════════════════════
 * CONTRATO DE VARIABLES DE LAS PLANTILLAS DE WHATSAPP
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Cada tipo de plantilla manda un número FIJO de variables posicionales
 * (`{{1}}`, `{{2}}`…), decidido por el código que la envía. La plantilla que
 * la clínica apruebe en Meta tiene que declarar exactamente esas, en ese
 * orden.
 *
 * POR QUE VIVE AQUI Y NO EN EL PANEL
 * Estaba solo en `apps/web`, de adorno para quien configuraba, y la API no lo
 * miraba. Resultado medido en la campaña E2E del 2026-09-22: los cinco tipos
 * configurados apuntaban al MISMO nombre de plantilla (`recordatorio_cita`,
 * de 4 variables) mientras mandaban 3, 4 y 5. Cuatro de los cinco envíos
 * habrían sido rechazados por Meta con «number of parameters does not match»
 * — y nadie se habría enterado hasta que un aviso no llegara.
 *
 * Un nombre de plantilla no puede servir a dos tipos que mandan distinta
 * cantidad de variables: es una contradicción comprobable sin preguntarle
 * nada a Meta, y `choqueDeNombre` es quien la detecta.
 */

/**
 * Espejo del enum `WhatsappTemplateKind` de Prisma. Se declara aquí como
 * unión de literales porque `@agenia/shared` no depende de `@agenia/database`
 * — y los miembros son los mismos, así que la API puede indexar este mapa con
 * el enum sin conversiones.
 */
export type TemplateKind =
  | 'APPOINTMENT_REMINDER'
  | 'WAITLIST_SLOT_OFFER'
  | 'APPOINTMENT_CANCELLED_MASS'
  | 'APPOINTMENT_REMINDER_MASS'
  | 'SYNC_EXCEPTION_ALERT'
  | 'HIS_APPOINTMENT_CONFIRMATION';

export interface ContratoPlantilla {
  label: string;
  description: string;
  /** Los `{{n}}` del cuerpo, EN ORDEN. La longitud es el contrato duro. */
  variables: string[];
}

export const TEMPLATE_CONTRACTS: Record<TemplateKind, ContratoPlantilla> = {
  APPOINTMENT_REMINDER: {
    label: 'Recordatorio de cita',
    description:
      'Se envía antes de la cita. Casi siempre cae fuera de la ventana de 24 h, así que sin esta plantilla el recordatorio no sale.',
    variables: ['Nombre del paciente', 'Servicio', 'Médico', 'Fecha y hora'],
  },
  WAITLIST_SLOT_OFFER: {
    label: 'Oferta de cupo (lista de espera)',
    description:
      'Avisa a un paciente en lista de espera que se liberó un cupo. ⚠️ Hoy NINGÚN código la envía todavía: configurarla no hace daño, pero tampoco hace nada.',
    variables: ['Nombre del paciente', 'Servicio', 'Fecha y hora'],
  },
  APPOINTMENT_CANCELLED_MASS: {
    label: 'Aviso de cancelación (avisos masivos)',
    description:
      'EXCLUSIVA del driver cnt-sanvicente-anserma — ver PLAN_AVISOS_MASIVOS.md §7.1. Se usa desde Avisos de cancelación (/dashboard/espejo/avisos) cuando un especialista no puede asistir. El 100% de estos envíos cae fuera de la ventana de 24 h, así que sin esta plantilla el aviso no sale nunca.',
    variables: [
      'Nombre del paciente',
      'Servicio',
      'Médico',
      'Fecha y hora',
      'Nota adicional (o la frase por defecto si el operador la deja vacía)',
    ],
  },
  APPOINTMENT_REMINDER_MASS: {
    label: 'Recordatorio masivo (avisos masivos)',
    description:
      'EXCLUSIVA del driver cnt-sanvicente-anserma — mismo motor que el aviso de cancelación (PLAN_AVISOS_MASIVOS.md §10, Fase 3), otro tipo de lote. Se usa desde Avisos de cancelación cuando el hospital quiere recordar por adelantado un día de agenda del especialista, no cancelarlo.',
    variables: [
      'Nombre del paciente',
      'Servicio',
      'Médico',
      'Fecha y hora',
      'Nota adicional (o la frase por defecto si el operador la deja vacía)',
    ],
  },
  SYNC_EXCEPTION_ALERT: {
    label: 'Aviso al agendador (excepciones de sincronización)',
    description:
      'Va a un teléfono del PERSONAL —el número del agendador que se configura en la Bandeja de sincronización—, no a un paciente. Avisa que hay citas confirmadas por WhatsApp que no llegaron al hospital. Lleva solo el resumen, SIN datos del paciente: el detalle se ve en la bandeja, tras iniciar sesión. Sin esta plantilla el aviso no sale (fuera de la ventana de 24 h un mensaje libre no llega) y la excepción queda solo en la bandeja.',
    variables: [
      'Cantidad de citas (por ejemplo «3 citas»)',
      'La más próxima (médico y hora)',
      'Causa probable (en un recordatorio empieza por «RECORDATORIO 1 de 2: nadie la ha tomado en la bandeja»)',
    ],
  },
  HIS_APPOINTMENT_CONFIRMATION: {
    label: 'Confirmación de una cita del hospital',
    description:
      'Se envía desde el Rastreo de paciente («Lo agendaron en el HIS») con el botón «Enviar confirmación por WhatsApp», cuando el hospital agendó una cita que el bot no le muestra al paciente. Solo se usa si el paciente no le ha escrito a la clínica en las últimas 24 h: dentro de ese plazo sale como texto normal. El cuerpo debe decir que la cita la asignó el hospital y que para cancelarla o cambiarla hay que comunicarse con el hospital (el bot no la conoce).',
    variables: ['Nombre del paciente', 'Servicio', 'Médico', 'Fecha y hora'],
  },
};

/** Cuántos `{{n}}` manda este tipo. Es lo que Meta compara al recibir. */
export function variablesEsperadas(kind: TemplateKind): number {
  return TEMPLATE_CONTRACTS[kind].variables.length;
}

export interface ChoqueDeNombre {
  /** El otro tipo que ya usa ese mismo nombre de plantilla. */
  kind: TemplateKind;
  /** Variables que manda ESE otro tipo. */
  variables: number;
}

/**
 * ¿Otro tipo ya usa este nombre de plantilla con distinta cantidad de
 * variables?
 *
 * Reutilizar un nombre entre dos tipos que mandan la MISMA cantidad es
 * dudoso (el cuerpo aprobado dirá una cosa y se usará para otra), pero puede
 * salir bien. Reutilizarlo entre dos que mandan cantidades DISTINTAS no puede
 * salir bien nunca: uno de los dos envíos lo rechaza Meta siempre. Solo eso
 * se bloquea aquí.
 *
 * `otras` son las plantillas ya configuradas de la misma organización,
 * incluida —si existe— la del propio `kind`, que se ignora.
 */
export function choqueDeNombre(
  kind: TemplateKind,
  name: string,
  otras: ReadonlyArray<{ kind: TemplateKind; name: string }>,
): ChoqueDeNombre | null {
  const propias = variablesEsperadas(kind);
  const objetivo = name.trim().toLowerCase();

  for (const otra of otras) {
    if (otra.kind === kind) continue;
    if (otra.name.trim().toLowerCase() !== objetivo) continue;
    const ajenas = variablesEsperadas(otra.kind);
    if (ajenas !== propias) return { kind: otra.kind, variables: ajenas };
  }
  return null;
}
