/**
 * 🔁 Reintento de los envíos a Meta cuando el error es PASAJERO (2026-11-10).
 *
 * El 9 de noviembre Meta respondió tres veces con su página de error (HTML, un
 * 5xx) en vez de aceptar el mensaje: dos respuestas del asistente y la
 * confirmación de que una persona quedó en la lista de espera no le llegaron a
 * nadie, y nada las volvió a intentar. Los cortes de Meta que ve el monitor
 * duran minutos; uno de estos, segundos.
 *
 * Se reintenta solo lo que puede salir bien un momento después:
 *  · HTTP 5xx (incluida la página de error en HTML) y 429 (demasiadas peticiones);
 *  · los códigos de Meta de «servicio no disponible» o «límite de envío»
 *    (`CODIGOS_META_PASAJEROS`);
 *  · una conexión que NO llegó a abrirse (DNS, conexión rechazada, red
 *    inalcanzable): Meta no recibió nada.
 *
 * No se reintenta lo definitivo (token vencido, número inválido, ventana de
 * 24 h cerrada, plantilla sin aprobar: códigos 4xx) ni una conexión que se cortó
 * a mitad de camino o se agotó esperando: Meta pudo haber recibido el mensaje y
 * el paciente lo leería dos veces. Un 5xx deja ese riesgo, pequeño: Meta lo
 * devuelve cuando el mensaje no entró, y un mensaje repetido es mejor que uno
 * perdido.
 */

/** Cuánto se espera antes de cada reintento: dos reintentos, a 1 s y a 3 s. */
export const ESPERAS_REINTENTO_META_MS: readonly number[] = [1_000, 3_000];

/**
 * Códigos de error de la Graph API que son pasajeros: 1 (error desconocido de la
 * API), 2 (servicio no disponible por un momento), 4 y 80007 (límite de
 * peticiones de la app o de la cuenta), 130429 (límite de envío del número),
 * 131000 (algo salió mal), 131016 (servicio no disponible) y 133004 (servidor
 * no disponible por un momento).
 */
const CODIGOS_META_PASAJEROS = new Set([
  1, 2, 4, 80007, 130429, 131000, 131016, 133004,
]);

/** Errores de red en los que la conexión no llegó a abrirse. */
const RED_SIN_ENVIO = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

/** ¿Vale la pena volver a intentar este envío a Meta en unos segundos? */
export function esErrorPasajeroDeMeta(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as {
    code?: unknown;
    response?: { status?: unknown; data?: unknown };
  };
  const status = e.response?.status;
  if (typeof status !== 'number') {
    return typeof e.code === 'string' && RED_SIN_ENVIO.has(e.code);
  }
  if (status === 429 || status >= 500) return true;
  const codigo = (e.response?.data as { error?: { code?: unknown } } | null)
    ?.error?.code;
  return typeof codigo === 'number' && CODIGOS_META_PASAJEROS.has(codigo);
}

const dormirDeVerdad = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta `enviar` y, si falla con un error pasajero, lo reintenta tras cada
 * espera de `esperas`. Devuelve lo que devuelva `enviar` o lanza el último error
 * (o el primero que no sea pasajero). `alReintentar` se llama antes de cada
 * espera, para dejar constancia en el log.
 */
export async function conReintentoAMeta<T>(
  enviar: () => Promise<T>,
  opts: {
    esperas?: readonly number[];
    alReintentar?: (intento: number, error: unknown, esperaMs: number) => void;
    dormir?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const esperas = opts.esperas ?? ESPERAS_REINTENTO_META_MS;
  const dormir = opts.dormir ?? dormirDeVerdad;
  for (let intento = 0; ; intento++) {
    try {
      return await enviar();
    } catch (error: unknown) {
      if (intento >= esperas.length || !esErrorPasajeroDeMeta(error)) {
        throw error;
      }
      opts.alReintentar?.(intento + 1, error, esperas[intento]);
      await dormir(esperas[intento]);
    }
  }
}
