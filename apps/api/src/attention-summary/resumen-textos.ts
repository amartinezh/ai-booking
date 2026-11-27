/**
 * Los mensajes del resumen de la atención al paciente por WhatsApp (plan §3.3).
 * El aviso no lleva datos clínicos: solo que hay documentos y de qué fecha.
 */
export const BOTON_RECIBIR = 'Recibir documentos';
/** En Telegram el botón manda este texto como un mensaje: lo entiende `pideSusDocumentos`. */
export const BOTON_RECIBIR_TELEGRAM = 'Recibir mis documentos';
/** El pie de la plantilla aprobada en Meta, igual en el aviso dentro de la ventana (60 letras máximo). */
export const PIE_BAJA_RESUMEN =
  'Para no recibirlos más, escriba «no quiero resúmenes»';

/** «Hospital San Vicente de Paúl» → «el Hospital San Vicente de Paúl», como en la plantilla. */
export function conArticulo(nombre: string): string {
  const n = nombre.trim();
  if (!n) return 'el hospital';
  if (/^(hospital|centro|instituto|consultorio)\b/i.test(n)) return `el ${n}`;
  if (
    /^(cl[ií]nica|e\.?\s?s\.?\s?e\b|ips\b|unidad|fundaci[oó]n|empresa)/i.test(n)
  )
    return `la ${n}`;
  return n;
}

/**
 * Cómo es la clave de los PDF, sin escribirla (chat, página y correo). Desde el
 * 2026-11-27 dice que va sin la sigla y en qué termina: en una prueba se
 * escribió otro número y el PDF no abrió.
 */
export function comoEsLaClave(fin: string | null): string {
  return `el número de documento del paciente, sin la sigla (CC, TI…), sin puntos y sin espacios${
    fin ? `; termina en ${fin}` : ''
  }`;
}

export const TEXTOS_RESUMEN = {
  /**
   * El aviso dentro de la ventana de 24 h, con el mismo texto de la plantilla
   * «Documentos de la consulta» aprobada en Meta (`documentos_consulta`, 2026-11-11).
   * Cambia solo el nombre del botón: en un mensaje con botones de WhatsApp caben
   * 20 letras («Recibir documentos»); en la plantilla y en Telegram, «Recibir mis
   * documentos».
   */
  avisoEnVentana: (
    nombre: string,
    fecha: string,
    hospital: string,
    boton: string,
  ) =>
    `Hola ${nombre}. Los documentos de su consulta del ${fecha} en ${conArticulo(hospital)} ya están listos: el resumen de la atención y, si se los ordenaron, la fórmula, las órdenes de exámenes, la remisión o la incapacidad. Toque «${boton}» para recibirlos en este chat.`,
  /** Se dice cuando una relectura dejó la atención en «No se envía» (D7 sobre la versión nueva). */
  yaNoSeEnvia:
    'Los documentos de esa consulta no se pueden enviar por este medio. Por favor pídalos en el hospital.',
  pedirFecha:
    'Para proteger su información, escriba la fecha de nacimiento del paciente (por ejemplo: 17/05/1963).',
  fechaIncorrecta: (restantes: number) =>
    `La fecha no coincide. Le quedan ${restantes} intento${restantes === 1 ? '' : 's'}.`,
  bloqueado: (hora: string) =>
    `Por seguridad, después de varios intentos hay que esperar una hora. Puede volver a pedirlos escribiendo «mis documentos» después de las ${hora}.`,
  sinFecha:
    'No podemos confirmar su identidad por este medio. Por favor pida sus documentos en el hospital.',
  noDisponible:
    'Los documentos de esa consulta ya no están disponibles por aquí (se guardan 30 días). Por favor pídalos en el hospital.',
  sinDocumentos:
    'No encontramos documentos recientes para este número. Si tuvo una consulta hace poco, pídalos en el hospital.',
  otroNumero:
    'Este botón no corresponde a este número. Si usted es el paciente, pida sus documentos en el hospital.',
  enviando: (fecha: string, conClave = false, fin: string | null = null) =>
    `Con gusto. Estos son los documentos de su consulta del ${fecha}.${
      conClave ? ` Los PDF se abren con una clave: ${comoEsLaClave(fin)}.` : ''
    }`,
  listo: (enlace: string | null) =>
    `Listo. Son una copia para usted: el hospital conserva el original. Para reclamar medicamentos o hacerse los exámenes, siga las indicaciones del hospital y de su EPS.${
      enlace ? `\n\nPara volver a descargarlos durante 30 días: ${enlace}` : ''
    }`,
  baja: 'Listo, no le enviaremos más los documentos de sus consultas por este medio. Su atención en el hospital no cambia. Si cambia de opinión, escriba «activar resúmenes».',
  alta: 'Listo, volverá a recibir por este medio los documentos de sus próximas consultas.',
  incompleto: (enlace: string | null) =>
    `No pudimos enviarle todos los documentos por aquí.${
      enlace
        ? ` Puede descargarlos en este enlace durante 30 días: ${enlace}`
        : ' Por favor pídalos en el hospital.'
    }`,
};

/** «ADULTO MAYOR PRUEBA» → «Adulto»: solo el primer nombre, como en el recordatorio. */
export function primerNombre(nombre: string): string {
  const p = nombre.trim().split(/\s+/)[0] ?? '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : 'paciente';
}

const html = (t: string) =>
  t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface DatosCorreo {
  nombre: string;
  hospital: string;
  fecha: string;
  enlace: string | null;
  /** Los últimos caracteres de la clave del PDF (`finDeLaClave`). */
  finClave?: string | null;
}

/**
 * El correo (plan §3.4): sin datos clínicos en el asunto ni en el cuerpo. Dice
 * cuál es la clave del PDF sin escribirla.
 */
export const CORREO_RESUMEN = {
  asunto: (fecha: string) => `Documentos de su consulta del ${fecha}`,
  texto: (d: DatosCorreo) =>
    [
      `Hola ${d.nombre}:`,
      '',
      `${d.hospital} le envía los documentos de su consulta del ${d.fecha}: resumen, fórmula y órdenes.`,
      '',
      `Van en el PDF adjunto, protegido con una clave: ${comoEsLaClave(d.finClave ?? null)}.`,
      ...(d.enlace
        ? [
            '',
            'También puede verlos y descargarlos durante 30 días en este enlace (le pedirá su fecha de nacimiento):',
            d.enlace,
          ]
        : []),
      '',
      'Si usted no fue atendido en el hospital, ignore este correo.',
      'Este correo es automático: por favor no lo responda.',
    ].join('\n'),
  html: (d: DatosCorreo) =>
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.5;max-width:560px">` +
    `<p>Hola ${html(d.nombre)}:</p>` +
    `<p>${html(d.hospital)} le envía los documentos de su consulta del ${html(d.fecha)}: resumen, fórmula y órdenes.</p>` +
    `<p>Van en el PDF adjunto, protegido con una clave: <strong>${html(comoEsLaClave(d.finClave ?? null))}</strong>.</p>` +
    (d.enlace
      ? `<p>También puede verlos y descargarlos durante 30 días en este enlace (le pedirá su fecha de nacimiento):<br><a href="${html(d.enlace)}">${html(d.enlace)}</a></p>`
      : '') +
    `<p style="color:#6b7280;font-size:13px">Si usted no fue atendido en el hospital, ignore este correo. Este correo es automático: por favor no lo responda.</p>` +
    `</div>`,
};
