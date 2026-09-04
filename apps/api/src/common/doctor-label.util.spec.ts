import { readFileSync } from 'fs';
import { join } from 'path';
import { doctorLabel } from './doctor-label.util';

describe('doctorLabel', () => {
  it('a una persona le antepone el honorífico', () => {
    expect(doctorLabel({ fullName: 'Juan Pérez' })).toBe('Dr(a). Juan Pérez');
  });

  it('🚨 a una agenda funcional NO — es lo que ve el piloto de Anserma', () => {
    // Los cuatro perfiles del arranque son agendas, no personas. Sin esto el
    // paciente lee «Dr(a). MEDICO ATENCIÓN HTA 2».
    expect(
      doctorLabel({
        fullName: 'Programa de Hipertensión',
        isFunctionalAgenda: true,
      }),
    ).toBe('Programa de Hipertensión');
  });

  it('usa Dr(a). y no Dr.: es lo que el normalizador de voz sabe expandir', () => {
    expect(doctorLabel({ fullName: 'Ana Ruiz' })).toMatch(/^Dr\(a\)\. /);
  });

  it('un nombre vacío no deja un honorífico suelto', () => {
    // `👨‍⚕️ Dr(a).` sin nombre detrás se lee como un fallo del sistema.
    expect(doctorLabel({ fullName: '' })).toBe('');
    expect(doctorLabel({ fullName: '   ' })).toBe('');
    expect(doctorLabel(null)).toBe('');
    expect(doctorLabel(undefined)).toBe('');
  });

  it('recorta los espacios del nombre', () => {
    expect(doctorLabel({ fullName: '  Juan Pérez  ' })).toBe(
      'Dr(a). Juan Pérez',
    );
  });

  it('false y null en el flag se comportan igual que una persona', () => {
    expect(doctorLabel({ fullName: 'Ana', isFunctionalAgenda: false })).toBe(
      'Dr(a). Ana',
    );
    expect(doctorLabel({ fullName: 'Ana', isFunctionalAgenda: null })).toBe(
      'Dr(a). Ana',
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GUARDA CONTRA LA REGRESIÓN QUE ESTO VINO A ARREGLAR.
//
// El honorífico estaba quemado en ocho plantillas (`👨‍⚕️ Dr(a). ${doctor}`) y
// en cuatro listados. Ahora lo pone `doctorLabel` y las plantillas reciben el
// nombre ya formateado. Si alguien vuelve a escribirlo en una plantilla, el
// paciente lee «Dr(a). Dr(a). Juan Pérez» — o, peor, «Dr(a). Programa de
// Hipertensión», que es justo el defecto original.
//
// Un test sobre el texto de UNA plantilla no lo detecta: hay dos pools
// (FORMAL e INFORMAL) y el bug entra por la que nadie mire. Esto mira el
// archivo entero.
// ══════════════════════════════════════════════════════════════════════════
describe('las plantillas no vuelven a poner el honorífico a mano', () => {
  const fuente = readFileSync(
    join(__dirname, '../chatbot/chatbot.constants.ts'),
    'utf8',
  );

  it('ninguna plantilla antepone Dr./Dr(a). a una interpolación', () => {
    const infractoras = fuente
      .split('\n')
      .map((linea, i) => ({ linea, n: i + 1 }))
      .filter(({ linea }) => /Dr\(a\)\.\s*\$\{|Dr\.\s*\$\{/.test(linea));

    expect(infractoras.map(({ n, linea }) => `${n}: ${linea.trim()}`)).toEqual(
      [],
    );
  });
});
