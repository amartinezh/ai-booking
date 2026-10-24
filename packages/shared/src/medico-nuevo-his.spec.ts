import {
  esCargoDeMedico,
  evaluarMedicoNuevo,
  puedeHomologarseConBoton,
  puedeHomologarseSolo,
  type ContextoMedicoNuevo,
} from './medico-nuevo-his';

const MEDICINA = { id: 'srv-mg', nombre: 'Consulta ambulatoria de medicina general', activo: true };
const HIPERTENSOS = { id: 'srv-hta', nombre: 'Control de hipertensos', activo: false };

const ctx = (over: Partial<ContextoMedicoNuevo> = {}): ContextoMedicoNuevo => ({
  vecesCedulaEnCatalogo: new Map([['1002954638', 1], ['77123456789', 3]]),
  medicosConLaCedula: [],
  servicioDeClaveHis: new Map([['S39141', MEDICINA], ['S39141-1', HIPERTENSOS]]),
  ...over,
});

// La médica del 24-oct, tal como la sube el agente.
const RU68 = {
  externalKey: 'RU68',
  label: 'MICHILLE TATIANA ZAPATA PARRADO',
  extra: { cargo: 'MEDICO RURAL', cedula: '1002954638', estado: '1', servicioDominante: 'S39141' },
};

describe('evaluarMedicoNuevo — ¿se puede crear y homologar?', () => {
  it('RU68: cumple todo, la crearía AgenIA sola', () => {
    const e = evaluarMedicoNuevo(RU68, ctx());
    expect(e).toMatchObject({ accion: 'CREAR', cedula: '1002954638', servicio: MEDICINA, bloqueos: [], advertencias: [] });
    expect(puedeHomologarseSolo(e)).toBe(true);
  });

  it('si ya hay un médico de AgenIA con su cédula y sin homologar, lo ENLAZA en vez de crear otro', () => {
    const e = evaluarMedicoNuevo(RU68, ctx({ medicosConLaCedula: [{ id: 'doc-1', fullName: 'MICHILLE ZAPATA', homologadoComo: null }] }));
    expect(e).toMatchObject({ accion: 'ENLAZAR', doctorIdExistente: 'doc-1' });
    expect(puedeHomologarseSolo(e)).toBe(true);
  });

  it.each([
    ['sin cédula', { ...RU68, extra: { ...RU68.extra, cedula: '' } }, {}, 'no tiene su cédula'],
    ['cédula de relleno repetida', { ...RU68, extra: { ...RU68.extra, cedula: '77123456789' } }, {}, 'la tienen 3 médicos'],
    ['dos médicos de AgenIA con su cédula', RU68, { medicosConLaCedula: [{ id: 'a', fullName: 'A', homologadoComo: null }, { id: 'b', fullName: 'B', homologadoComo: null }] }, 'Hay 2 médicos'],
    ['su cédula ya es de otro homologado', RU68, { medicosConLaCedula: [{ id: 'a', fullName: 'ANA RUIZ', homologadoComo: 'MD09' }] }, 'homologado con el código MD09'],
  ])('%s → bloqueado: ni el botón', (_c, medico, over, motivo) => {
    const e = evaluarMedicoNuevo(medico as never, ctx(over as Partial<ContextoMedicoNuevo>));
    expect(e.accion).toBeNull();
    expect(e.bloqueos.join(' ')).toContain(motivo);
    expect(puedeHomologarseConBoton(e)).toBe(false);
    expect(puedeHomologarseSolo(e)).toBe(false);
  });

  it.each([
    ['cargo de auxiliar', { cargo: 'AUX. DE ENFERMERIA' }, '«AUX. DE ENFERMERIA», no de médico'],
    ['servicio principal que AgenIA no maneja', { servicioDominante: 'S39141-1' }, '«Control de hipertensos», que AgenIA no maneja'],
    ['servicio principal que AgenIA no tiene', { servicioDominante: 'ES01' }, 'quedaría sin servicio'],
    ['inactivo en el hospital', { estado: '0' }, 'inactivo'],
  ])('%s → el botón puede (con aviso), AgenIA sola no', (_c, cambio, aviso) => {
    const e = evaluarMedicoNuevo({ ...RU68, extra: { ...RU68.extra, ...cambio } }, ctx());
    expect(e.advertencias.join(' ')).toContain(aviso);
    expect(puedeHomologarseConBoton(e)).toBe(true);
    expect(puedeHomologarseSolo(e)).toBe(false);
  });

  it('la cédula se compara sin puntos ni ceros a la izquierda', () => {
    const e = evaluarMedicoNuevo({ ...RU68, extra: { ...RU68.extra, cedula: '001.002.954.638' } }, ctx());
    expect(e.cedula).toBe('1002954638');
    expect(e.bloqueos).toEqual([]);
  });
});

describe('esCargoDeMedico', () => {
  it.each(['MEDICO RURAL', 'MEDICO GENERAL', 'Médica general', 'MEDICO RIAS'])('«%s» sí', (c) => expect(esCargoDeMedico(c)).toBe(true));
  it.each(['AUX. DE ENFERMERIA', 'ENFERMERA CRECIM Y DESARROLLO', 'ODONTOLOGA', 'FISIOTERAPEUTA', 'RADIOLOGO', '', null,
    // Dicen «médico» pero no lo son.
    'AUXILIAR MEDICO', 'MEDICO ODONTOLOGO', 'ENFERMERA DE APOYO MEDICO'])('«%s» no', (c) =>
    expect(esCargoDeMedico(c)).toBe(false));
});
