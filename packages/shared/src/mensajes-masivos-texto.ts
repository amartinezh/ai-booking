/**
 * ══════════════════════════════════════════════════════════════════════════
 * 📢 MENSAJES MASIVOS — revisión del texto antes de enviarlo (docs/PLAN_MENSAJES_MASIVOS.md §6)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Un error en un mensaje masivo se repite cientos de veces y no se puede borrar.
 * Esta revisión es la primera barrera, sin IA y al instante mientras se escribe:
 *
 *  - FORMATO de Meta: el texto viaja como una variable de la plantilla, y Meta
 *    rechaza una variable con saltos de línea, tabulaciones o más de 4 espacios
 *    seguidos («Param text cannot have new-line/tab characters or more than 4
 *    consecutive spaces»). Es un ERROR: el envío fallaría con todos.
 *  - LENGUAJE: groserías (ERROR), palabras informales y abreviaturas de chat (AVISO).
 *  - REDACCIÓN: mayúsculas sostenidas, signos repetidos o sin abrir, palabras
 *    repetidas, espacios antes de un signo, falta el punto final.
 *  - ORTOGRAFÍA: las tildes y las palabras pegadas más comunes, con su corrección.
 *  - PRIVACIDAD: el mismo texto le llega a todos; no puede llevar resultados ni
 *    diagnósticos.
 *  - ESPACIOS POR LLENAR: «{nombre}», «[fecha]», «XXX».
 *
 * La segunda barrera es la revisión con IA (API, `MassMessageAiService`), que lee
 * redacción y tono. El servidor vuelve a correr ESTA revisión antes de enviar: con
 * un ERROR, no sale nada.
 *
 * Puro: sin base de datos ni APIs del navegador.
 */

export type NivelProblema = 'ERROR' | 'AVISO' | 'SUGERENCIA';
export type CategoriaProblema = 'FORMATO' | 'ORTOGRAFIA' | 'REDACCION' | 'LENGUAJE' | 'PRIVACIDAD' | 'ENLACES';

export interface ProblemaTexto {
  /** Código estable de la regla (ej. «SALTOS_DE_LINEA»). */
  id: string;
  nivel: NivelProblema;
  categoria: CategoriaProblema;
  mensaje: string;
  /** El pedazo del texto que lo causa, para resaltarlo. */
  fragmento?: string;
  /** El texto COMPLETO con este problema arreglado, si se puede arreglar solo. */
  arreglado?: string;
}

export interface RevisionTexto {
  problemas: ProblemaTexto[];
  /** Sin ningún ERROR. */
  puedeEnviarse: boolean;
  caracteres: number;
  palabras: number;
  /** 0 a 100, para la pantalla. */
  puntaje: number;
}

export const LIMITES_TEXTO = {
  /**
   * El cuerpo de una plantilla admite 1024 caracteres con las variables puestas;
   * el texto fijo de la plantilla y el nombre ocupan unos 200. 800 deja margen.
   */
  maximo: 800,
  /** Más de esto se lee menos en el celular. */
  recomendado: 500,
  minimo: 20,
  maxEmojis: 6,
} as const;

// ─── Listas ─────────────────────────────────────────────────────────────────

/** Groserías e insultos (sin tildes, en minúscula). Bloquean el envío. */
const GROSERIAS = new Set([
  'gonorrea', 'gonorreas', 'hijueputa', 'hijueputas', 'jueputa', 'hpta', 'hp', 'malparido', 'malparida', 'malparidos',
  'malparidas', 'marica', 'maricas', 'maricon', 'maricones', 'pirobo', 'piroba', 'pirobos', 'estupido', 'estupida',
  'estupidos', 'estupidas', 'idiota', 'idiotas', 'imbecil', 'imbeciles', 'mierda', 'mierdas', 'chupame', 'chupamela',
  'puta', 'putas', 'puto', 'putos', 'verga', 'vergas', 'pendejo', 'pendeja', 'pendejos', 'huevon', 'huevona', 'guevon',
  'webon', 'maldito', 'maldita', 'malditos', 'cabron', 'cabrona', 'coño', 'joder', 'carechimba', 'careverga',
  'malnacido', 'malnacida', 'mamaguevo', 'culicagado', 'triplehijueputa', 'perra', 'zorra',
]);

/** Informales: no ofenden, pero no van en un comunicado de la clínica. */
const INFORMALES = new Set([
  'chimba', 'parce', 'parcero', 'parcera', 'berraco', 'berraca', 'verraco', 'verraca', 'bacano', 'bacana', 'mk', 'ome',
  'jaja', 'jajaja', 'jajajaja', 'jeje', 'lol', 'culo', 'guevonada', 'huevonada', 'vaina', 'chimbo',
]);

/** Abreviaturas de chat → la palabra completa. */
const ABREVIATURAS = new Map<string, string>(Object.entries({
  q: 'que', xq: 'porque', pq: 'porque', porq: 'porque', tb: 'también', tmb: 'también', tbn: 'también', xfa: 'por favor',
  xfavor: 'por favor', porfa: 'por favor', pls: 'por favor', bn: 'bien', dnd: 'donde', d: 'de', k: 'que', ke: 'que',
  msj: 'mensaje', info: 'información', cel: 'celular', tel: 'teléfono', dr: 'doctor', dra: 'doctora', hrs: 'horas',
  hr: 'hora', min: 'minutos', aprox: 'aproximadamente', x: 'por', grax: 'gracias', grs: 'gracias',
}));
/** Las que pueden ir en un comunicado formal sin problema (con su punto). */
const ABREVIATURAS_ACEPTADAS = new Set(['dr', 'dra', 'tel', 'cel', 'min', 'aprox', 'info', 'hrs', 'hr', 'd', 'x']);

/**
 * Tildes que faltan y palabras pegadas. Solo palabras sin ambigüedad en un
 * comunicado de salud: «esta/está», «mas/más», «si/sí» o «publico/público» no
 * están porque las dos formas existen.
 */
const ORTOGRAFIA = new Map<string, string>(Object.entries({
  porfavor: 'por favor', aveces: 'a veces', atravez: 'a través', atraves: 'a través', osea: 'o sea', talvez: 'tal vez',
  enserio: 'en serio', almenos: 'al menos', apartir: 'a partir', derrepente: 'de repente', sinembargo: 'sin embargo',
  encambio: 'en cambio', haci: 'así', asi: 'así', aver: 'a ver', nesecita: 'necesita', nesesita: 'necesita',
  nececita: 'necesita', nesecitan: 'necesitan', informacion: 'información', atencion: 'atención', telefono: 'teléfono',
  telefonos: 'teléfonos', vacunacion: 'vacunación', medico: 'médico', medicos: 'médicos', medica: 'médica',
  dias: 'días', tambien: 'también', numero: 'número', pagina: 'página', clinica: 'clínica', clinicas: 'clínicas',
  examenes: 'exámenes', ultimo: 'último', ultima: 'última', proximo: 'próximo', proxima: 'próxima', sabado: 'sábado',
  sabados: 'sábados', miercoles: 'miércoles', direccion: 'dirección', odontologia: 'odontología',
  pediatria: 'pediatría', ginecologia: 'ginecología', cardiologia: 'cardiología', psicologia: 'psicología',
  nutricion: 'nutrición', prevencion: 'prevención', promocion: 'promoción', facil: 'fácil', dificil: 'difícil',
  rapido: 'rápido', electronico: 'electrónico', estan: 'están', ademas: 'además', despues: 'después', aqui: 'aquí',
  alli: 'allí', ahi: 'ahí', segun: 'según', unica: 'única', unico: 'único', ubicacion: 'ubicación',
  inscripcion: 'inscripción', afiliacion: 'afiliación', autorizacion: 'autorización', cancer: 'cáncer',
  hipertension: 'hipertensión', citologia: 'citología', mamografia: 'mamografía', planificacion: 'planificación',
  enfermeria: 'enfermería', tramite: 'trámite', tramites: 'trámites', codigo: 'código', jovenes: 'jóvenes',
  ninos: 'niños', ninas: 'niñas', nino: 'niño', nina: 'niña', anos: 'años', senor: 'señor', senora: 'señora',
  senores: 'señores', manana: 'mañana', ano: 'año', campana: 'campaña', campanas: 'campañas', diagnostico: 'diagnóstico',
  habil: 'hábil', habiles: 'hábiles', telefonica: 'telefónica', telefonico: 'telefónico', comunicacion: 'comunicación',
  invitacion: 'invitación', actualizacion: 'actualización', poblacion: 'población',
}));
/** Las que no son solo una tilde: cambian el sentido (y una es vulgar). */
const ORTOGRAFIA_DELICADA = new Set(['anos', 'ano']);

/** Siglas que van en mayúscula y no son «gritar». */
const SIGLAS = new Set([
  'EPS', 'IPS', 'ESE', 'VIH', 'COVID', 'SURA', 'SOAT', 'PAI', 'RIPS', 'ADRES', 'SISBEN', 'NIT', 'CC', 'TI', 'RC', 'AM',
  'PM', 'WHATSAPP', 'OK', 'HPV', 'VPH', 'SAS', 'IPS.', 'UCI', 'EKG', 'ECG', 'TAC', 'RX', 'PYP', 'SST', 'ARL', 'EAPB',
]);

const ACORTADORES = /\b(bit\.ly|tinyurl\.com|cutt\.ly|goo\.gl|t\.co|ow\.ly|is\.gd|rb\.gy|shorturl\.at|acortar\.link)\b/i;
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s]+)/gi;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const TERMINA_EN_EMOJI = /\p{Extended_Pictographic}\uFE0F?$/u;

// ─── Utilidades ─────────────────────────────────────────────────────────────

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function comoElOriginal(original: string, reemplazo: string): string {
  if (original.length > 1 && original === original.toUpperCase()) return reemplazo.toUpperCase();
  if (original.charAt(0) === original.charAt(0).toUpperCase()) return reemplazo.charAt(0).toUpperCase() + reemplazo.slice(1);
  return reemplazo;
}

/** Las palabras con su posición, sin tocar las direcciones web ni los correos. */
function palabras(texto: string): Array<{ palabra: string; inicio: number }> {
  const ocupado = zonasProtegidas(texto);
  const salida: Array<{ palabra: string; inicio: number }> = [];
  for (const m of texto.matchAll(/\p{L}+/gu)) {
    const i = m.index ?? 0;
    if (!ocupado.some(([a, b]) => i >= a && i < b)) salida.push({ palabra: m[0], inicio: i });
  }
  return salida;
}

/** Enlaces y correos: ahí no se corrige nada. */
function zonasProtegidas(texto: string): Array<[number, number]> {
  const zonas: Array<[number, number]> = [];
  for (const m of texto.matchAll(URL_RE)) zonas.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  for (const m of texto.matchAll(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi)) zonas.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return zonas;
}

function reemplazarPalabra(texto: string, inicio: number, largo: number, por: string): string {
  return texto.slice(0, inicio) + por + texto.slice(inicio + largo);
}

/** Une las líneas en un párrafo: con punto si la línea no terminaba en un signo. */
export function unirEnUnParrafo(texto: string): string {
  const lineas = texto.split(/\r\n|\n|\r/).map((l) => l.replace(/\t/g, ' ').trim()).filter(Boolean);
  return lineas
    .map((l, i) => {
      const ultima = i === lineas.length - 1;
      if (ultima || /[.!?:;,…]$/.test(l) || TERMINA_EN_EMOJI.test(l)) return l;
      const siguiente = lineas[i + 1] ?? '';
      return /^\p{Lu}/u.test(siguiente) ? `${l}.` : l;
    })
    .join(' ')
    .replace(/ {2,}/g, ' ');
}

/** Lo que de verdad sale hacia Meta: un párrafo, sin espacios de más. */
export function textoParaEnviar(texto: string): string {
  return unirEnUnParrafo(texto ?? '').replace(/\s+/g, ' ').trim();
}

const SALUDO_RE = /^\s*(hola|buen[oa]s?\s+(d[ií]as|tardes|noches)|estimad[oa]s?(\s+(paciente|pacientes|usuari[oa]s?|afiliad[oa]s?))?|apreciad[oa]s?(\s+(paciente|pacientes|usuari[oa]s?))?|querid[oa]s?(\s+(paciente|pacientes))?)\b[\s,!.:¡]*/i;

// ─── La revisión ────────────────────────────────────────────────────────────

export interface OpcionesRevision {
  /** La plantilla ya saluda con el nombre («Hola {{1}}»): un «Hola» al empezar lo repite. */
  plantillaSaluda?: boolean;
}

export function revisarTexto(texto: string, opciones: OpcionesRevision = {}): RevisionTexto {
  const t = texto ?? '';
  const problemas: ProblemaTexto[] = [];
  const agregar = (p: ProblemaTexto) => problemas.push(p);
  const limpio = t.trim();
  const plano = textoParaEnviar(t);

  if (!limpio) {
    agregar({ id: 'VACIO', nivel: 'ERROR', categoria: 'FORMATO', mensaje: 'Escriba el mensaje.' });
    return resultado(problemas, plano);
  }

  // ── Formato de Meta ──
  if (/[\r\n\t]/.test(t)) {
    agregar({
      id: 'SALTOS_DE_LINEA',
      nivel: 'ERROR',
      categoria: 'FORMATO',
      mensaje:
        'WhatsApp no deja saltos de línea ni tabulaciones dentro del mensaje de una plantilla: el envío fallaría con todos. Escríbalo en un solo párrafo.',
      arreglado: unirEnUnParrafo(t),
    });
  }
  const espacios = t.replace(/[\r\n\t]/g, ' ').match(/ {2,}/g);
  if (espacios) {
    const mas = Math.max(...espacios.map((e) => e.length));
    agregar({
      id: 'ESPACIOS_SEGUIDOS',
      nivel: mas > 4 ? 'ERROR' : 'SUGERENCIA',
      categoria: 'FORMATO',
      mensaje:
        mas > 4
          ? `Hay ${mas} espacios seguidos: WhatsApp rechaza más de 4 dentro de una plantilla.`
          : 'Hay espacios dobles.',
      arreglado: t.replace(/ {2,}/g, ' '),
    });
  }
  if (plano.length > LIMITES_TEXTO.maximo) {
    agregar({
      id: 'MUY_LARGO',
      nivel: 'ERROR',
      categoria: 'FORMATO',
      mensaje: `Tiene ${plano.length} caracteres; el máximo es ${LIMITES_TEXTO.maximo} (la plantilla de WhatsApp no admite más con el saludo y el nombre).`,
    });
  } else if (plano.length > LIMITES_TEXTO.recomendado) {
    agregar({
      id: 'LARGO',
      nivel: 'AVISO',
      categoria: 'REDACCION',
      mensaje: `Tiene ${plano.length} caracteres. En el celular se lee mejor por debajo de ${LIMITES_TEXTO.recomendado}: diga lo esencial y deje un teléfono o un enlace para el resto.`,
    });
  } else if (plano.length < LIMITES_TEXTO.minimo) {
    agregar({
      id: 'MUY_CORTO',
      nivel: 'AVISO',
      categoria: 'REDACCION',
      mensaje: 'Es muy corto: quien lo recibe puede no entender de qué se trata ni quién le escribe.',
    });
  }

  // ── Espacios por llenar ──
  const marcador = t.match(/\{\{?\s*[\p{L}\d_ ]+\s*\}?\}|\[\s*(nombre|fecha|hora|lugar|direcci[oó]n|tel[eé]fono|m[eé]dico|x+)\s*\]|<\s*(nombre|fecha|hora)\s*>|\bX{3,}\b|\b_{3,}/iu);
  if (marcador) {
    agregar({
      id: 'MARCADOR_SIN_LLENAR',
      nivel: 'ERROR',
      categoria: 'REDACCION',
      fragmento: marcador[0],
      mensaje: `Quedó un espacio por llenar: «${marcador[0]}». El nombre de cada persona lo pone la plantilla; escriba el dato o quítelo.`,
    });
  }

  // ── Lenguaje ──
  const norm = sinTildes(t.toLowerCase());
  const lista = palabras(t);
  const yaDichas = new Set<string>();
  for (const { palabra, inicio } of lista) {
    const p = sinTildes(palabra.toLowerCase());
    const original = palabra.toLowerCase();
    if (yaDichas.has(p)) continue;
    if (GROSERIAS.has(p) || GROSERIAS.has(original)) {
      yaDichas.add(p);
      agregar({ id: 'GROSERIA', nivel: 'ERROR', categoria: 'LENGUAJE', fragmento: palabra, mensaje: `«${palabra}» es una grosería o un insulto: no puede ir en un mensaje de la clínica.` });
    } else if (INFORMALES.has(p)) {
      yaDichas.add(p);
      agregar({ id: 'INFORMAL', nivel: 'AVISO', categoria: 'LENGUAJE', fragmento: palabra, mensaje: `«${palabra}» es muy informal para un comunicado de la clínica.` });
    } else if (ABREVIATURAS.has(p) && !ABREVIATURAS_ACEPTADAS.has(p)) {
      yaDichas.add(p);
      const completa = ABREVIATURAS.get(p) as string;
      agregar({
        id: 'ABREVIATURA',
        nivel: 'AVISO',
        categoria: 'REDACCION',
        fragmento: palabra,
        mensaje: `«${palabra}» es una abreviatura de chat: escriba «${completa}».`,
        arreglado: reemplazarPalabra(t, inicio, palabra.length, comoElOriginal(palabra, completa)),
      });
    } else if (ORTOGRAFIA.has(original)) {
      yaDichas.add(p);
      const bien = ORTOGRAFIA.get(original) as string;
      agregar({
        id: 'ORTOGRAFIA',
        nivel: 'AVISO',
        categoria: 'ORTOGRAFIA',
        fragmento: palabra,
        mensaje: ORTOGRAFIA_DELICADA.has(original)
          ? `«${palabra}» sin la ñ cambia de sentido: escriba «${bien}».`
          : `«${palabra}» se escribe «${bien}».`,
        arreglado: reemplazarPalabra(t, inicio, palabra.length, comoElOriginal(palabra, bien)),
      });
    }
  }

  // ── Redacción ──
  const letras = (t.match(/\p{L}/gu) ?? []).length;
  const mayus = palabras(t).filter((w) => w.palabra.length >= 4 && w.palabra === w.palabra.toUpperCase() && !SIGLAS.has(w.palabra));
  const totalMayus = (t.match(/\p{Lu}/gu) ?? []).length;
  if (letras >= 20 && (totalMayus / letras > 0.4 || mayus.length >= 3)) {
    agregar({
      id: 'MAYUSCULAS',
      nivel: 'AVISO',
      categoria: 'REDACCION',
      fragmento: mayus[0]?.palabra,
      mensaje: 'Mucho texto en mayúscula se lee como si gritara y cuesta leerlo. Use mayúscula solo al empezar y en los nombres; para destacar una frase, póngala entre asteriscos: *así*.',
      arreglado: aMinusculaSostenida(t),
    });
  }
  const repetidos = t.match(/([!?¡¿,;:])\1+|\.{4,}|(?<!\.)\.\.(?!\.)/);
  if (repetidos) {
    agregar({
      id: 'SIGNOS_REPETIDOS',
      nivel: 'AVISO',
      categoria: 'REDACCION',
      fragmento: repetidos[0],
      mensaje: `«${repetidos[0]}»: un solo signo basta (los puntos suspensivos son tres).`,
      arreglado: t.replace(/([!?¡¿,;:])\1+/g, '$1').replace(/\.{4,}/g, '...').replace(/(?<!\.)\.\.(?!\.)/g, '.'),
    });
  }
  if (/\S\s+[,.;:!?](?!\S*\/)/.test(t.replace(URL_RE, ''))) {
    agregar({
      id: 'ESPACIO_ANTES_DE_SIGNO',
      nivel: 'SUGERENCIA',
      categoria: 'REDACCION',
      mensaje: 'Sobra un espacio antes de una coma o un punto.',
      arreglado: protegerEnlaces(t, (s) => s.replace(/(\S)\s+([,.;:!?])/g, '$1$2')),
    });
  }
  const pegado = t.match(/\p{Ll}[,;](?=\p{L})|\p{Ll}{2}[.!?](?=\p{Lu}\p{Ll})/u);
  if (pegado && !textoEnZona(t, pegado.index ?? 0)) {
    agregar({
      id: 'FALTA_ESPACIO',
      nivel: 'SUGERENCIA',
      categoria: 'REDACCION',
      fragmento: t.slice(pegado.index ?? 0, (pegado.index ?? 0) + pegado[0].length + 3),
      mensaje: 'Falta un espacio después de un signo.',
      arreglado: protegerEnlaces(t, (s) => s.replace(/(\p{Ll})([,;])(?=\p{L})/gu, '$1$2 ').replace(/(\p{Ll}{2})([.!?])(?=\p{Lu}\p{Ll})/gu, '$1$2 ')),
    });
  }
  const repetida = t.match(/\b(\p{L}{2,})\s+\1\b/iu);
  if (repetida && !/^(ja|je|ji|no|si|sí|muy)$/i.test(repetida[1])) {
    agregar({
      id: 'PALABRA_REPETIDA',
      nivel: 'AVISO',
      categoria: 'REDACCION',
      fragmento: repetida[0],
      mensaje: `«${repetida[0]}»: la palabra quedó repetida.`,
      arreglado: t.replace(repetida[0], repetida[1]),
    });
  }
  const pregunta = (t.match(/\?/g) ?? []).length;
  const abrePregunta = (t.match(/¿/g) ?? []).length;
  const exclama = (t.match(/!/g) ?? []).length;
  const abreExclama = (t.match(/¡/g) ?? []).length;
  if (pregunta > abrePregunta || exclama > abreExclama) {
    agregar({
      id: 'SIGNO_SIN_ABRIR',
      nivel: 'SUGERENCIA',
      categoria: 'ORTOGRAFIA',
      mensaje: 'En español la pregunta se abre con «¿» y la exclamación con «¡».',
    });
  } else if (abrePregunta > pregunta || abreExclama > exclama) {
    agregar({ id: 'SIGNO_SIN_CERRAR', nivel: 'AVISO', categoria: 'ORTOGRAFIA', mensaje: 'Hay un «¿» o un «¡» sin cerrar.' });
  }
  if (/^[¡¿"«(]?\p{Ll}/u.test(limpio) && !/^(https?:|www\.)/i.test(limpio)) {
    agregar({
      id: 'INICIO_MINUSCULA',
      nivel: 'SUGERENCIA',
      categoria: 'REDACCION',
      mensaje: 'Empiece con mayúscula.',
      arreglado: t.replace(/\p{Ll}/u, (c) => c.toUpperCase()),
    });
  }
  const final = limpio.slice(-1);
  if (!/[.!?…)»"'*_~]/.test(final) && !TERMINA_EN_EMOJI.test(limpio) && !/(https?:\/\/|www\.)\S+$/i.test(limpio)) {
    agregar({ id: 'SIN_PUNTO_FINAL', nivel: 'SUGERENCIA', categoria: 'REDACCION', mensaje: 'Termine con un punto.', arreglado: `${t.trimEnd()}.` });
  }
  if (opciones.plantillaSaluda && SALUDO_RE.test(limpio)) {
    const sinSaludo = limpio.replace(SALUDO_RE, '');
    agregar({
      id: 'SALUDO_REPETIDO',
      nivel: 'SUGERENCIA',
      categoria: 'REDACCION',
      fragmento: limpio.match(SALUDO_RE)?.[0].trim(),
      mensaje: 'La plantilla ya saluda a cada persona por su nombre: empezar con otro saludo lo repite.',
      arreglado: sinSaludo ? sinSaludo.charAt(0).toUpperCase() + sinSaludo.slice(1) : undefined,
    });
  }

  // ── Formato de WhatsApp (*negrita*, _cursiva_, ~tachado~) ──
  const sinEnlaces = t.replace(URL_RE, '').replace(/[^\s@]+@[^\s@]+/g, '');
  for (const [signo, nombre] of [['*', 'negrita'], ['_', 'cursiva'], ['~', 'tachado']] as const) {
    if (((sinEnlaces.match(new RegExp(`\\${signo}`, 'g')) ?? []).length) % 2 === 1) {
      agregar({
        id: 'FORMATO_SIN_CERRAR',
        nivel: 'AVISO',
        categoria: 'FORMATO',
        fragmento: signo,
        mensaje: `Hay un «${signo}» sin pareja: en WhatsApp la ${nombre} va entre dos (${signo}así${signo}); suelto, se ve el signo.`,
      });
    }
  }
  const emojis = (t.match(EMOJI_RE) ?? []).length;
  if (emojis > LIMITES_TEXTO.maxEmojis) {
    agregar({
      id: 'EMOJIS',
      nivel: 'AVISO',
      categoria: 'REDACCION',
      mensaje: `Tiene ${emojis} emojis. Uno o dos ayudan; muchos le quitan seriedad y algunos teléfonos no los muestran.`,
    });
  }

  // ── Enlaces ──
  for (const m of t.matchAll(URL_RE)) {
    const url = m[0];
    if (ACORTADORES.test(url)) {
      agregar({
        id: 'ENLACE_ACORTADO',
        nivel: 'AVISO',
        categoria: 'ENLACES',
        fragmento: url,
        mensaje: 'Un enlace acortado no deja ver a dónde lleva: los pacientes desconfían y WhatsApp puede marcarlo como sospechoso. Use la dirección completa de la clínica.',
      });
    } else if (/^http:\/\//i.test(url)) {
      agregar({
        id: 'ENLACE_INSEGURO',
        nivel: 'AVISO',
        categoria: 'ENLACES',
        fragmento: url,
        mensaje: 'El enlace empieza por «http://»: si la página lo permite, use «https://».',
        arreglado: t.replace(url, url.replace(/^http:/i, 'https:')),
      });
    } else {
      agregar({ id: 'ENLACE', nivel: 'SUGERENCIA', categoria: 'ENLACES', fragmento: url, mensaje: 'Abra el enlace antes de enviar y compruebe que lleva a la página correcta.' });
    }
  }

  // ── Privacidad ──
  const sensible = norm.match(/\b(sus? (resultados?|diagnosticos?|examen(es)?|laboratorios?)|salio positiv[oa]|resultado positivo|(es|son) positiv[oa]s?|portador(es|a)?|vih|sida)\b/);
  if (sensible) {
    agregar({
      id: 'DATOS_DE_SALUD',
      nivel: 'AVISO',
      categoria: 'PRIVACIDAD',
      fragmento: sensible[0],
      mensaje: 'El mismo mensaje le llega a todos: no debe llevar resultados, diagnósticos ni datos de salud de nadie. Si es una campaña general (por ejemplo, de prevención), ignore este aviso.',
    });
  }

  return resultado(problemas, plano);
}

function textoEnZona(texto: string, i: number): boolean {
  return zonasProtegidas(texto).some(([a, b]) => i >= a && i < b);
}

/** Aplica `fn` fuera de los enlaces y los correos. */
function protegerEnlaces(texto: string, fn: (s: string) => string): string {
  const zonas = zonasProtegidas(texto).sort((a, b) => a[0] - b[0]);
  if (!zonas.length) return fn(texto);
  let salida = '';
  let desde = 0;
  for (const [a, b] of zonas) {
    if (a < desde) continue;
    salida += fn(texto.slice(desde, a)) + texto.slice(a, b);
    desde = b;
  }
  return salida + fn(texto.slice(desde));
}

/** Pasa a minúscula las palabras gritadas (no las siglas) y deja la mayúscula al empezar cada oración. */
function aMinusculaSostenida(texto: string): string {
  const bajado = protegerEnlaces(texto, (s) =>
    s.replace(/\p{L}{2,}/gu, (w) => (w === w.toUpperCase() && !SIGLAS.has(w) && w.length >= 3 ? w.toLowerCase() : w)),
  );
  return bajado.replace(/(^|[.!?¡¿]\s*)(\p{Ll})/gu, (_, a: string, c: string) => a + c.toUpperCase());
}

function resultado(problemas: ProblemaTexto[], plano: string): RevisionTexto {
  const orden: Record<NivelProblema, number> = { ERROR: 0, AVISO: 1, SUGERENCIA: 2 };
  problemas.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
  const errores = problemas.filter((p) => p.nivel === 'ERROR').length;
  const avisos = problemas.filter((p) => p.nivel === 'AVISO').length;
  const sugerencias = problemas.length - errores - avisos;
  return {
    problemas,
    puedeEnviarse: errores === 0,
    caracteres: plano.length,
    palabras: plano ? plano.split(/\s+/).length : 0,
    puntaje: Math.max(0, 100 - errores * 30 - avisos * 8 - sugerencias * 2),
  };
}

/**
 * Aplica, una tras otra, todas las correcciones seguras (las que traen
 * `arreglado`), hasta que no quede ninguna o en 20 vueltas. No toca lo que pide
 * criterio (groserías, mayúsculas sostenidas, datos de salud).
 */
export function arreglarAutomaticamente(texto: string, opciones: OpcionesRevision = {}): string {
  const automaticas = new Set([
    'SALTOS_DE_LINEA', 'ESPACIOS_SEGUIDOS', 'ABREVIATURA', 'ORTOGRAFIA', 'SIGNOS_REPETIDOS', 'ESPACIO_ANTES_DE_SIGNO',
    'FALTA_ESPACIO', 'PALABRA_REPETIDA', 'INICIO_MINUSCULA', 'SIN_PUNTO_FINAL', 'ENLACE_INSEGURO',
  ]);
  let actual = texto;
  for (let i = 0; i < 20; i++) {
    const p = revisarTexto(actual, opciones).problemas.find((x) => automaticas.has(x.id) && x.arreglado !== undefined && x.arreglado !== actual);
    if (!p?.arreglado) break;
    actual = p.arreglado;
  }
  return actual;
}

// ─── Vista previa ───────────────────────────────────────────────────────────

export interface TrozoConFormato {
  texto: string;
  negrita?: boolean;
  cursiva?: boolean;
  tachado?: boolean;
  monoespaciado?: boolean;
}

/**
 * El texto partido en trozos con el formato de WhatsApp (*negrita*, _cursiva_,
 * ~tachado~, ```monoespaciado```), para la vista previa sin HTML crudo.
 */
export function trozosConFormato(texto: string): TrozoConFormato[] {
  const re = /```([^`]+)```|\*([^*\s](?:[^*]*[^*\s])?)\*|_([^_\s](?:[^_]*[^_\s])?)_|~([^~\s](?:[^~]*[^~\s])?)~/g;
  const salida: TrozoConFormato[] = [];
  let desde = 0;
  for (const m of texto.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > desde) salida.push({ texto: texto.slice(desde, i) });
    if (m[1] !== undefined) salida.push({ texto: m[1], monoespaciado: true });
    else if (m[2] !== undefined) salida.push({ texto: m[2], negrita: true });
    else if (m[3] !== undefined) salida.push({ texto: m[3], cursiva: true });
    else salida.push({ texto: m[4], tachado: true });
    desde = i + m[0].length;
  }
  if (desde < texto.length) salida.push({ texto: texto.slice(desde) });
  return salida;
}

/** Reemplaza `{{1}}`, `{{2}}`… del cuerpo de una plantilla por sus valores. */
export function cuerpoConVariables(cuerpo: string, valores: string[]): string {
  return cuerpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => valores[Number(n) - 1] ?? m);
}

/** Lo que reemplaza el nombre cuando el contacto no tiene uno. */
export const NOMBRE_POR_DEFECTO = 'paciente';

/** El primer nombre para el saludo: «MARÍA JOSÉ» → «María»; sin nombre, el de por defecto. */
export function nombreParaSaludo(nombre: string | null | undefined, porDefecto: string = NOMBRE_POR_DEFECTO): string {
  const primero = (nombre ?? '').trim().split(/\s+/)[0] ?? '';
  const limpio = primero.replace(/[^\p{L}'-]/gu, '');
  if (!limpio) return porDefecto;
  return limpio.charAt(0).toUpperCase() + limpio.slice(1).toLowerCase();
}
