/**
 * Los mensajes del resumen de la atención al paciente por WhatsApp (plan §3.3).
 * El aviso no lleva datos clínicos: solo que hay documentos y de qué fecha.
 */
export const BOTON_RECIBIR = 'Recibir documentos';

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
