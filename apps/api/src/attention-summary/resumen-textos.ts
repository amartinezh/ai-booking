/**
 * Los mensajes del resumen de la atención al paciente por WhatsApp (plan §3.3).
 * El aviso no lleva datos clínicos: solo que hay documentos y de qué fecha.
 */
export const BOTON_RECIBIR = 'Recibir documentos';
/** En Telegram el botón manda este texto como un mensaje: lo entiende `pideSusDocumentos`. */
export const BOTON_RECIBIR_TELEGRAM = 'Recibir mis documentos';

export const TEXTOS_RESUMEN = {
  avisoEnVentana: (nombre: string, fecha: string) =>
    `Hola ${nombre}, el hospital tiene listos los documentos de su consulta del ${fecha}: resumen, fórmula y órdenes. Toque el botón para recibirlos aquí.`,
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
  enviando: (fecha: string) =>
    `Con gusto. Estos son los documentos de su consulta del ${fecha}:`,
  listo: (enlace: string | null) =>
    `Listo. Puede imprimirlos o mostrarlos en la farmacia o el laboratorio. Son una copia para usted: el hospital conserva el original.${
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
      'Van en el PDF adjunto, protegido con una clave: su número de documento, sin puntos ni espacios.',
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
    `<p>Van en el PDF adjunto, protegido con una clave: <strong>su número de documento, sin puntos ni espacios</strong>.</p>` +
    (d.enlace
      ? `<p>También puede verlos y descargarlos durante 30 días en este enlace (le pedirá su fecha de nacimiento):<br><a href="${html(d.enlace)}">${html(d.enlace)}</a></p>`
      : '') +
    `<p style="color:#6b7280;font-size:13px">Si usted no fue atendido en el hospital, ignore este correo. Este correo es automático: por favor no lo responda.</p>` +
    `</div>`,
};
