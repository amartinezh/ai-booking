import { servicioQueNoSeAgenda } from './servicio-no-agendable';

const MENU_HOSPITAL = ['Consulta ambulatoria de medicina general'];

describe('servicioQueNoSeAgenda — servicios que no se agendan por el asistente', () => {
  it.each([
    // 2026-10-23, tal cual.
    ['Odontología', 'odontología'],
    ['O dontologia', null], // no se adivina
    ['Ecografía obtetrica trasvaginal Y ecografía de mama', 'ecografías'],
    [
      'Ecografía Doppler de vasos arteriales de miembros inferiores',
      'ecografías',
    ],
    ['Ecografía', 'ecografías'],
    ['Doppler', 'ecografías'],
    ['me duelen las muelas', 'odontología'],
    ['cita con el dentista', 'odontología'],
    ['rayos x de tórax', 'rayos X'],
    ['exámenes de laboratorio', 'laboratorio'],
    ['citología', 'citología'],
    ['psicólogo', 'psicología'],
    ['ginecología', 'ginecología'],
    ['pediatra para mi hijo', 'pediatría'],
    ['un especialista', 'especialistas'],
    // Lo que no es un servicio conocido sigue el camino de siempre.
    ['Henry Antonio Ospina', null],
    ['Para el Marte', null],
    ['A', null],
    ['', null],
  ])('«%s» → %p', (texto, esperado) => {
    expect(servicioQueNoSeAgenda(texto, MENU_HOSPITAL)).toBe(esperado);
  });

  it('si la clínica sí lo ofrece por el asistente, no es este caso', () => {
    expect(
      servicioQueNoSeAgenda('Odontología', ['Medicina General', 'Odontología']),
    ).toBeNull();
    expect(
      servicioQueNoSeAgenda('ecografía', ['Ecografías obstétricas']),
    ).toBeNull();
  });

  it('«ecografía obstétrica» es una ecografía, no ginecología', () => {
    expect(servicioQueNoSeAgenda('ecografía obstétrica', MENU_HOSPITAL)).toBe(
      'ecografías',
    );
  });

  it('null y undefined: nada', () => {
    expect(servicioQueNoSeAgenda(null, MENU_HOSPITAL)).toBeNull();
    expect(servicioQueNoSeAgenda(undefined, MENU_HOSPITAL)).toBeNull();
  });
});
