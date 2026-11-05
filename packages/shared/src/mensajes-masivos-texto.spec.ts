import {
  arreglarAutomaticamente,
  cuerpoConVariables,
  nombreParaSaludo,
  revisarTexto,
  textoParaEnviar,
  trozosConFormato,
  unirEnUnParrafo,
} from './mensajes-masivos-texto';

const ids = (texto: string, opciones = {}) => revisarTexto(texto, opciones).problemas.map((p) => p.id);
const BIEN = 'La jornada de vacunación será el sábado 8 de noviembre de 8:00 a. m. a 12:00 m. en la sede principal. Traiga su documento.';

describe('revisarTexto', () => {
  it('un comunicado bien escrito no tiene problemas', () => {
    const r = revisarTexto(BIEN);
    expect(r.problemas).toEqual([]);
    expect(r.puedeEnviarse).toBe(true);
    expect(r.puntaje).toBe(100);
  });

  it('vacío no se puede enviar', () => {
    expect(revisarTexto('   ').puedeEnviarse).toBe(false);
  });

  it('los saltos de línea son ERROR (Meta rechaza la variable) y se arreglan en un párrafo', () => {
    const r = revisarTexto('Jornada de vacunación\nSábado 8 de noviembre.\n\nTraiga su carné.');
    const p = r.problemas.find((x) => x.id === 'SALTOS_DE_LINEA');
    expect(p?.nivel).toBe('ERROR');
    expect(r.puedeEnviarse).toBe(false);
    expect(p?.arreglado).toBe('Jornada de vacunación. Sábado 8 de noviembre. Traiga su carné.');
  });

  it('más de 4 espacios seguidos es ERROR; dos son solo sugerencia', () => {
    expect(revisarTexto(`${BIEN}     Fin.`).problemas.find((p) => p.id === 'ESPACIOS_SEGUIDOS')?.nivel).toBe('ERROR');
    expect(revisarTexto(BIEN.replace('jornada de', 'jornada  de')).problemas.find((p) => p.id === 'ESPACIOS_SEGUIDOS')?.nivel).toBe('SUGERENCIA');
  });

  it('más de 800 caracteres no sale; más de 500 avisa', () => {
    expect(revisarTexto(`${'Texto de prueba largo. '.repeat(40)}`).problemas[0].id).toBe('MUY_LARGO');
    expect(ids(`${'Texto de prueba largo. '.repeat(25)}`)).toContain('LARGO');
  });

  it('un espacio sin llenar bloquea el envío', () => {
    for (const t of ['Hola {nombre}, le esperamos.', 'Su cita es el [fecha] en la sede.', 'Llame al XXX para más datos.']) {
      expect(revisarTexto(t).problemas.find((p) => p.id === 'MARCADOR_SIN_LLENAR')?.nivel).toBe('ERROR');
    }
  });

  it('las groserías bloquean; lo informal y las abreviaturas avisan', () => {
    const r = revisarTexto('Qué chimba, parce: no sea pendejo y venga q lo esperamos.');
    expect(r.problemas.filter((p) => p.id === 'GROSERIA').map((p) => p.fragmento)).toEqual(['pendejo']);
    expect(r.problemas.filter((p) => p.id === 'INFORMAL').map((p) => p.fragmento)).toEqual(['chimba', 'parce']);
    expect(r.problemas.find((p) => p.id === 'ABREVIATURA')?.arreglado).toContain('venga que lo esperamos');
    expect(r.puedeEnviarse).toBe(false);
  });

  it('«coño» es grosería, pero «cono» y «año» no', () => {
    expect(ids('Le esperamos este coño de sábado.')).toContain('GROSERIA');
    expect(ids('El cono de vacunación estará en la entrada este año.')).not.toContain('GROSERIA');
  });

  it('corrige tildes y palabras pegadas conservando la mayúscula', () => {
    const r = revisarTexto('Informacion importante: porfavor traiga sus examenes.');
    const orto = r.problemas.filter((p) => p.id === 'ORTOGRAFIA').map((p) => p.fragmento);
    expect(orto).toEqual(['Informacion', 'porfavor', 'examenes']);
    expect(arreglarAutomaticamente('Informacion importante: porfavor traiga sus examenes.')).toBe(
      'Información importante: por favor traiga sus exámenes.',
    );
  });

  it('«anos» sin ñ se señala con su propio mensaje', () => {
    const p = revisarTexto('Vacunación para niños de 5 anos este sábado.').problemas.find((x) => x.fragmento === 'anos');
    expect(p?.mensaje).toContain('cambia de sentido');
  });

  it('no corrige dentro de un enlace ni un correo', () => {
    expect(ids('Más datos en https://clinica.com/informacion o en info@clinica.com sobre la jornada.')).not.toContain('ORTOGRAFIA');
  });

  it('las mayúsculas sostenidas avisan (las siglas no cuentan)', () => {
    expect(ids('ATENCIÓN PACIENTES: MAÑANA NO HAY SERVICIO DE CONSULTA EXTERNA.')).toContain('MAYUSCULAS');
    expect(ids('Los afiliados de la EPS SURA y de la IPS deben traer el carné del SISBEN.')).not.toContain('MAYUSCULAS');
  });

  it('signos repetidos, sin abrir, espacio antes de la coma y palabra repetida', () => {
    const r = revisarTexto('Le esperamos!!! ¿Tiene dudas? Llame , por favor, al al teléfono de la clínica?');
    const encontrados = r.problemas.map((p) => p.id);
    expect(encontrados).toEqual(expect.arrayContaining(['SIGNOS_REPETIDOS', 'SIGNO_SIN_ABRIR', 'ESPACIO_ANTES_DE_SIGNO', 'PALABRA_REPETIDA']));
    expect(arreglarAutomaticamente('Le esperamos!!! Llame , por favor, al al teléfono.')).toBe('Le esperamos! Llame, por favor, al teléfono.');
  });

  it('falta de espacio después de un signo, sin tocar las horas ni los enlaces', () => {
    expect(ids('Le esperamos el lunes,martes y miércoles.')).toContain('FALTA_ESPACIO');
    expect(ids('Le esperamos a las 7.30 en www.clinica.com.co hoy.')).not.toContain('FALTA_ESPACIO');
  });

  it('el saludo repetido solo cuenta si la plantilla ya saluda', () => {
    const t = 'Hola, le recordamos que la jornada es el sábado.';
    expect(ids(t)).not.toContain('SALUDO_REPETIDO');
    const p = revisarTexto(t, { plantillaSaluda: true }).problemas.find((x) => x.id === 'SALUDO_REPETIDO');
    expect(p?.arreglado).toBe('Le recordamos que la jornada es el sábado.');
  });

  it('un asterisco sin pareja avisa; *negrita* bien cerrada no', () => {
    expect(ids('La jornada es *este sábado en la sede.')).toContain('FORMATO_SIN_CERRAR');
    expect(ids('La jornada es *este sábado* en la sede.')).not.toContain('FORMATO_SIN_CERRAR');
  });

  it('enlaces: acortados avisan, http se pasa a https', () => {
    expect(ids('Inscríbase en https://bit.ly/abc123 antes del viernes.')).toContain('ENLACE_ACORTADO');
    const r = revisarTexto('Inscríbase en http://clinica.com antes del viernes.');
    expect(r.problemas.find((p) => p.id === 'ENLACE_INSEGURO')?.arreglado).toBe('Inscríbase en https://clinica.com antes del viernes.');
  });

  it('datos de salud de una persona avisan', () => {
    expect(ids('Sus resultados ya están listos en la clínica.')).toContain('DATOS_DE_SALUD');
  });

  it('demasiados emojis avisan', () => {
    expect(ids('Jornada de salud 🎉🎉🎉🎉🎉🎉🎉 este sábado en la sede.')).toContain('EMOJIS');
  });

  it('el puntaje baja con cada problema y nunca es negativo', () => {
    expect(revisarTexto('pendejo hp marica gonorrea\nXXX').puntaje).toBe(0);
  });
});

describe('arreglarAutomaticamente', () => {
  it('deja listo para enviar un texto pegado de Word', () => {
    const pegado = 'jornada de vacunacion\n\nel sabado 8 de noviembre  en la sede principal\nporfavor traiga su carné';
    const listo = arreglarAutomaticamente(pegado);
    // Las líneas que siguen en minúscula se unen sin inventar un punto: es la misma oración.
    expect(listo).toBe('Jornada de vacunación el sábado 8 de noviembre en la sede principal por favor traiga su carné.');
    expect(revisarTexto(listo).puedeEnviarse).toBe(true);
  });

  it('no toca lo que pide criterio', () => {
    expect(arreglarAutomaticamente('No sea pendejo.')).toBe('No sea pendejo.');
  });
});

describe('textoParaEnviar y unirEnUnParrafo', () => {
  it('lo que sale hacia Meta es un solo párrafo sin espacios de más', () => {
    expect(textoParaEnviar('  Uno\n\tDos   tres  ')).toBe('Uno. Dos tres');
    expect(unirEnUnParrafo('Hola,\nmundo')).toBe('Hola, mundo');
  });
});

describe('trozosConFormato', () => {
  it('reconoce negrita, cursiva, tachado y monoespaciado', () => {
    expect(trozosConFormato('Es *gratis* y _sin cita_, ~no~ ```hoy```.')).toEqual([
      { texto: 'Es ' },
      { texto: 'gratis', negrita: true },
      { texto: ' y ' },
      { texto: 'sin cita', cursiva: true },
      { texto: ', ' },
      { texto: 'no', tachado: true },
      { texto: ' ' },
      { texto: 'hoy', monoespaciado: true },
      { texto: '.' },
    ]);
  });
  it('un asterisco suelto se queda como texto', () => {
    expect(trozosConFormato('2 * 3 = 6')).toEqual([{ texto: '2 * 3 = 6' }]);
  });
});

describe('cuerpoConVariables y nombreParaSaludo', () => {
  it('pone las variables en el cuerpo de la plantilla', () => {
    expect(cuerpoConVariables('Hola {{1}}, {{2}} ({{3}})', ['Ana', 'mensaje'])).toBe('Hola Ana, mensaje ({{3}})');
  });
  it('saluda con el primer nombre, o con «paciente»', () => {
    expect(nombreParaSaludo('MARÍA JOSÉ PÉREZ')).toBe('María');
    expect(nombreParaSaludo(null)).toBe('paciente');
    expect(nombreParaSaludo('  ', 'amigo')).toBe('amigo');
  });
});
