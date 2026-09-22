import {
  TEMPLATE_CONTRACTS,
  choqueDeNombre,
  variablesEsperadas,
  type TemplateKind,
} from './whatsapp-template-contracts';

describe('variablesEsperadas', () => {
  // Estas cifras NO son decorativas: son las que manda cada `sendTemplate` en
  // la API. Si alguien cambia un `bodyParams` sin tocar esto, o al revés, el
  // envío lo rechaza Meta en producción. Ver los call sites:
  //   4 → appointment-reminder.cron.ts (recordatorio)
  //   4 → his-confirmation.service.ts (cita agendada en el hospital)
  //   5 → mass-notice.service.ts (los dos masivos)
  //   3 → mirror-alert.service.ts (aviso al agendador)
  it.each<[TemplateKind, number]>([
    ['APPOINTMENT_REMINDER', 4],
    ['HIS_APPOINTMENT_CONFIRMATION', 4],
    ['APPOINTMENT_CANCELLED_MASS', 5],
    ['APPOINTMENT_REMINDER_MASS', 5],
    ['SYNC_EXCEPTION_ALERT', 3],
    ['WAITLIST_SLOT_OFFER', 3],
  ])('%s manda %i variables', (kind, cuantas) => {
    expect(variablesEsperadas(kind)).toBe(cuantas);
  });

  it('todo tipo declara al menos una variable y un para qué', () => {
    for (const [kind, c] of Object.entries(TEMPLATE_CONTRACTS)) {
      expect(c.variables.length).toBeGreaterThan(0);
      expect(c.label).not.toBe('');
      expect(c.description.length).toBeGreaterThan(20);
      expect(kind).toBeTruthy();
    }
  });
});

describe('choqueDeNombre', () => {
  // 🚨 EL CASO REAL, medido el 2026-09-22 en el servidor de producción: los
  // cinco tipos configurados apuntaban a `recordatorio_cita`. Como el
  // recordatorio manda 4 variables y el aviso al agendador 3, Meta habría
  // rechazado el aviso con «number of parameters does not match» — y el
  // agendador nunca se habría enterado de una cita perdida.
  it('detecta los cinco tipos apuntando a la misma plantilla', () => {
    const configuradas = [
      { kind: 'APPOINTMENT_REMINDER' as const, name: 'recordatorio_cita' },
    ];

    const choque = choqueDeNombre(
      'SYNC_EXCEPTION_ALERT',
      'recordatorio_cita',
      configuradas,
    );

    expect(choque).toEqual({ kind: 'APPOINTMENT_REMINDER', variables: 4 });
  });

  it.each<[TemplateKind, number]>([
    ['WAITLIST_SLOT_OFFER', 3],
    ['APPOINTMENT_CANCELLED_MASS', 5],
    ['APPOINTMENT_REMINDER_MASS', 5],
    ['SYNC_EXCEPTION_ALERT', 3],
  ])('%s choca con el recordatorio (manda %i, no 4)', (kind) => {
    const choque = choqueDeNombre(kind, 'recordatorio_cita', [
      { kind: 'APPOINTMENT_REMINDER', name: 'recordatorio_cita' },
    ]);
    expect(choque?.kind).toBe('APPOINTMENT_REMINDER');
  });

  it('no se delata a sí mismo al reguardar el mismo tipo', () => {
    expect(
      choqueDeNombre('APPOINTMENT_REMINDER', 'recordatorio_cita', [
        { kind: 'APPOINTMENT_REMINDER', name: 'recordatorio_cita' },
      ]),
    ).toBeNull();
  });

  it('deja pasar dos tipos que mandan la MISMA cantidad', () => {
    // Los dos masivos mandan 5 y 5: compartir nombre es dudoso, pero Meta lo
    // acepta. Bloquear aquí sería adivinar la intención de la clínica.
    expect(
      choqueDeNombre('APPOINTMENT_REMINDER_MASS', 'aviso_masivo', [
        { kind: 'APPOINTMENT_CANCELLED_MASS', name: 'aviso_masivo' },
      ]),
    ).toBeNull();
  });

  it('nombres distintos nunca chocan', () => {
    expect(
      choqueDeNombre('SYNC_EXCEPTION_ALERT', 'aviso_agendador_sync', [
        { kind: 'APPOINTMENT_REMINDER', name: 'recordatorio_cita' },
      ]),
    ).toBeNull();
  });

  it('compara sin distinguir mayúsculas ni espacios de sobra', () => {
    expect(
      choqueDeNombre('SYNC_EXCEPTION_ALERT', '  Recordatorio_Cita ', [
        { kind: 'APPOINTMENT_REMINDER', name: 'recordatorio_cita' },
      ]),
    ).not.toBeNull();
  });

  it('sin nada configurado no hay choque', () => {
    expect(choqueDeNombre('APPOINTMENT_REMINDER', 'lo_que_sea', [])).toBeNull();
  });
});
