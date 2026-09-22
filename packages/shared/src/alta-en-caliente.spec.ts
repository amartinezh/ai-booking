import { normalizePhoneToE164Co } from './avisos-csv';
import {
  decidirAlta,
  decidirTelefono,
  notaDeAlta,
  type EntradaAlta,
  type PerfilCandidato,
} from './alta-en-caliente';

// ══════════════════════════════════════════════════════════════════════════
// Alta en caliente (docs/PLAN_ALTA_EN_CALIENTE.md). Las decisiones que se fijan:
//  · D3: un documento ambiguo NO se resuelve solo (mezclar dos personas no se deshace);
//  · D4: un teléfono que ya es de otro paciente no se asigna;
//  · D10: una baja registrada no se recrea;
//  · sin nombre no se crea un paciente anónimo.
// ══════════════════════════════════════════════════════════════════════════

const perfil = (over: Partial<PerfilCandidato> = {}): PerfilCandidato => ({
  id: 'pac-1',
  cedula: '1088123456',
  whatsappId: null,
  bsuid: null,
  ...over,
});

const entrada = (over: Partial<EntradaAlta> = {}): EntradaAlta => ({
  documento: '1088123456',
  nombre: 'MARIA LUCIA LOPEZ NUÑEZ',
  telefono: '3001112233',
  perfiles: [],
  normalizarTelefono: normalizePhoneToE164Co,
  ...over,
});

describe('decidirAlta', () => {
  it('paciente desconocido con nombre y teléfono: se CREA, con el documento normalizado', () => {
    expect(decidirAlta(entrada({ documento: ' 1088123456 ' }))).toEqual({
      accion: 'CREAR',
      documento: '1088123456',
      nombre: 'MARIA LUCIA LOPEZ NUÑEZ',
      telefono: { numero: '573001112233', motivo: 'ASIGNADO' },
    });
  });

  it('paciente ya conocido: se REUTILIZA su perfil, no se crea otro', () => {
    const r = decidirAlta(entrada({ perfiles: [perfil()] }));
    expect(r).toMatchObject({ accion: 'REUTILIZAR', pacienteId: 'pac-1' });
  });

  it('el mismo documento escrito con ceros a la izquierda es la MISMA persona', () => {
    const r = decidirAlta(entrada({ documento: '001088123456', perfiles: [perfil()] }));
    expect(r).toMatchObject({ accion: 'REUTILIZAR', pacienteId: 'pac-1' });
  });

  it('🚨 D3: dos perfiles que podrían ser esta persona → NO se crea ni se elige; van los candidatos', () => {
    const r = decidirAlta(
      entrada({
        perfiles: [perfil(), perfil({ id: 'pac-2', cedula: '0001088123456' })],
      }),
    );
    expect(r).toEqual({
      accion: 'NO_CREAR',
      motivo: 'DOCUMENTO_AMBIGUO',
      candidatos: ['pac-1', 'pac-2'],
    });
  });

  it('un perfil con OTRO documento no cuenta como candidato', () => {
    const r = decidirAlta(entrada({ perfiles: [perfil({ cedula: '9999999' })] }));
    expect(r.accion).toBe('CREAR');
  });

  it('D10: una baja registrada bloquea la CREACIÓN…', () => {
    expect(decidirAlta(entrada({ bajaSolicitada: true }))).toEqual({
      accion: 'NO_CREAR',
      motivo: 'BAJA_SOLICITADA',
      candidatos: [],
    });
  });

  it('…pero si el perfil ya existe, la cita se le anota igual (la baja es de recordatorios)', () => {
    const r = decidirAlta(entrada({ bajaSolicitada: true, perfiles: [perfil()] }));
    expect(r.accion).toBe('REUTILIZAR');
  });

  it('sin nombre no se crea un paciente anónimo', () => {
    for (const nombre of [null, '', '   ']) {
      expect(decidirAlta(entrada({ nombre }))).toMatchObject({
        accion: 'NO_CREAR',
        motivo: 'SIN_NOMBRE',
      });
    }
  });

  it.each(['', '   ', '0000', '12', '1'.repeat(16), 'abc', null, undefined])(
    'un documento inutilizable (%s) no crea nada',
    (documento) => {
      expect(decidirAlta(entrada({ documento }))).toMatchObject({
        accion: 'NO_CREAR',
        motivo: 'DOCUMENTO_INVALIDO',
      });
    },
  );

  it('el documento ambiguo se comprueba ANTES que la baja y que el nombre: es el caso que hay que mirar', () => {
    const r = decidirAlta(
      entrada({
        nombre: null,
        bajaSolicitada: true,
        perfiles: [perfil(), perfil({ id: 'pac-2', cedula: '01088123456' })],
      }),
    );
    expect(r).toMatchObject({ motivo: 'DOCUMENTO_AMBIGUO' });
  });

  it('el nombre se limpia de espacios repetidos', () => {
    const r = decidirAlta(entrada({ nombre: '  MARIA   LUCIA  ' }));
    expect(r).toMatchObject({ accion: 'CREAR', nombre: 'MARIA LUCIA' });
  });
});

describe('decidirTelefono', () => {
  const tel = (over: Partial<EntradaAlta> = {}) =>
    decidirTelefono(entrada(over));

  it('un celular colombiano se guarda como lo espera el envío (dígitos, con el 57)', () => {
    for (const escrito of ['3001112233', '+57 300 111 2233', '57 3001112233', ' 300-111-2233 ']) {
      expect(tel({ telefono: escrito })).toEqual({ numero: '573001112233', motivo: 'ASIGNADO' });
    }
  });

  it('sin teléfono en el HIS: no hay recordatorio, y se dice por qué', () => {
    expect(tel({ telefono: null })).toEqual({ numero: null, motivo: 'SIN_TELEFONO' });
    expect(tel({ telefono: '   ' })).toEqual({ numero: null, motivo: 'SIN_TELEFONO' });
  });

  it.each(['6013001234', '12345', 'sin dato', '300111223'])(
    'un teléfono que no es un celular (%s) no se guarda',
    (telefono) => {
      expect(tel({ telefono })).toEqual({ numero: null, motivo: 'ILEGIBLE' });
    },
  );

  it('🚨 D4: el teléfono ya es de OTRO documento → no se asigna (nadie ve la cita de otro)', () => {
    expect(
      tel({ duenosDelTelefono: [{ id: 'pac-9', cedula: '9999999' }] }),
    ).toEqual({ numero: null, motivo: 'ES_DE_OTRO_PACIENTE' });
  });

  it('si el dueño del teléfono es ESTE mismo paciente (o el mismo número con ceros), sí se asigna', () => {
    expect(tel({ duenosDelTelefono: [{ id: 'pac-1', cedula: '1088123456' }] }).motivo).toBe('ASIGNADO');
    expect(tel({ duenosDelTelefono: [{ id: 'pac-1', cedula: '0001088123456' }] }).motivo).toBe('ASIGNADO');
  });

  it('entre varios dueños, basta uno ajeno para no asignarlo', () => {
    expect(
      tel({
        duenosDelTelefono: [
          { id: 'pac-1', cedula: '1088123456' },
          { id: 'pac-9', cedula: '9999999' },
        ],
      }).motivo,
    ).toBe('ES_DE_OTRO_PACIENTE');
  });
});

describe('notaDeAlta — la constancia, sin datos personales', () => {
  const sinDatosPersonales = (nota: string) => {
    expect(nota).not.toMatch(/\d{6,}/); // ni documento ni teléfono
    expect(nota).not.toMatch(/MARIA|LOPEZ/i);
  };

  it('cada decisión tiene su frase, y ninguna lleva el documento ni el teléfono', () => {
    const casos = [
      decidirAlta(entrada()),
      decidirAlta(entrada({ perfiles: [perfil()] })),
      decidirAlta(entrada({ telefono: null })),
      decidirAlta(entrada({ telefono: '6013001234' })),
      decidirAlta(entrada({ duenosDelTelefono: [{ id: 'x', cedula: '99' }] })),
      decidirAlta(entrada({ perfiles: [perfil(), perfil({ id: 'p2', cedula: '01088123456' })] })),
      decidirAlta(entrada({ bajaSolicitada: true })),
      decidirAlta(entrada({ documento: '0' })),
      decidirAlta(entrada({ nombre: null })),
    ];
    for (const c of casos) {
      const nota = notaDeAlta(c);
      expect(nota.length).toBeGreaterThan(10);
      sinDatosPersonales(nota);
    }
    expect(notaDeAlta(casos[0])).toMatch(/creado desde el HIS, con WhatsApp/);
    expect(notaDeAlta(casos[4])).toMatch(/ya es de otro paciente/);
  });
});
