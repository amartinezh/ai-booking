/**
 * 🚨 Las alertas técnicas del envío de los documentos de la consulta
 * (docs/PLAN_RESUMEN_ATENCION.md §8.11). Reglas puras: quién las usa decide
 * cuándo avisar y cuándo resolver.
 */

/**
 * Los errores de Meta que dicen que la PLANTILLA no se puede usar, no que el
 * número de un paciente falle. Con cualquiera de ellos no sale ningún aviso
 * fuera de la ventana de 24 h.
 */
const ERRORES_DE_PLANTILLA: Record<string, string> = {
  '132000':
    'Meta dice que la cantidad de variables o de botones no coincide con la plantilla aprobada',
  '132001': 'Meta no encuentra la plantilla con ese nombre en ese idioma',
  '132005': 'con las variables, el texto de la plantilla quedó demasiado largo',
  '132007': 'la plantilla viola la política de formato de Meta',
  '132012':
    'el formato de una variable no coincide con el de la plantilla aprobada',
  '132015': 'Meta pausó la plantilla por baja calidad',
  '132016': 'Meta deshabilitó la plantilla',
};

/**
 * Qué le pasa a la plantilla, según el error del envío; `null` si el error no
 * es de la plantilla (un número sin WhatsApp, una caída de Meta…).
 */
export function fallaDePlantilla(
  error: string | null | undefined,
): string | null {
  if (!error) return null;
  if (error === 'template-not-configured')
    return 'no está registrada en Configuración › Canales e IA';
  if (error === 'body-params-mismatch')
    return 'la registrada no recibe las 2 variables (nombre y fecha de la consulta)';
  const m = /"code"\s*:\s*(\d{6})/.exec(error);
  const texto = m ? ERRORES_DE_PLANTILLA[m[1]] : undefined;
  return texto ? `${texto} (código ${m![1]})` : null;
}

/** «hace 3 h 20 min» / «hace 45 min». */
export function haceCuanto(desde: Date, ahora: Date): string {
  const min = Math.max(
    0,
    Math.floor((ahora.getTime() - desde.getTime()) / 60_000),
  );
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `hace ${h} h${resto ? ` ${resto} min` : ''}`;
}
