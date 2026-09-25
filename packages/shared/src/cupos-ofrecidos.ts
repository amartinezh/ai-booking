/**
 * Cuántos cupos ofrece el bot y cuáles.
 *
 * POR QUE EXISTE
 * El bot ofrecía los 10 cupos más próximos. Con una agenda llena eso es un
 * menú de la A a la J que, en la práctica, cae entero en la misma mañana: el
 * paciente que solo puede por la tarde no ve ninguna opción que le sirva, y
 * el que sí puede tiene que leer diez líneas casi iguales. Lo pidieron los
 * usuarios en la retroalimentación del 2026-09-24.
 *
 * Ahora se ofrece un número configurable por clínica
 * (`OrganizationSettings.slotsOfferedCount`, default 6), repartido mitad
 * mañana y mitad tarde. Si una franja no alcanza, la otra completa, para no
 * ofrecer menos cupos de los que hay.
 *
 * ⚠️ La franja se decide en la hora de la clínica, no en la del contenedor
 * (UTC): las 8 a. m. de Bogotá son las 13 h en UTC y caerían en la tarde.
 */

export const CUPOS_OFRECIDOS = {
  /** Lo que ofrece una clínica que nunca tocó el ajuste. */
  DEFAULT: 6,
  MIN: 2,
  /**
   * Las opciones se nombran con letras (A, B, C…) y el paciente las lee en
   * WhatsApp; más de 12 vuelve a ser el listado largo que se quería evitar.
   */
  MAX: 12,
  /**
   * Cuántos cupos próximos se consultan para poder elegir entre mañana y
   * tarde. Los primeros 10 casi nunca traían una tarde; 100 cubre varios
   * días de una agenda con cupos de 15 minutos.
   */
  POOL: 100,
} as const;

/** La tarde empieza a las 12 en punto, igual que el saludo (saludo.ts). */
const HORA_INICIO_TARDE = 12;

/**
 * Normaliza lo que venga de BD o del formulario: entero dentro de
 * [MIN, MAX]; cualquier cosa inválida (null, NaN, 0) cae al default.
 */
export function normalizarCuposOfrecidos(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n <= 0) return CUPOS_OFRECIDOS.DEFAULT;
  return Math.min(
    CUPOS_OFRECIDOS.MAX,
    Math.max(CUPOS_OFRECIDOS.MIN, Math.round(n)),
  );
}

export interface SeleccionCuposOptions {
  /** Zona de la clínica. `Organization.timezone` cuando exista. */
  timeZone?: string;
}

/**
 * Elige `total` cupos: la mitad (redondeando hacia arriba) de los más
 * próximos de la mañana y el resto de los más próximos de la tarde. Si una
 * franja no tiene suficientes, la otra completa. Devuelve en orden
 * cronológico, que es el orden en que se asignan las letras.
 *
 * `cupos` no necesita venir ordenado.
 */
export function seleccionarCuposManianaTarde<T extends { fecha: Date }>(
  cupos: T[],
  total: number,
  opts: SeleccionCuposOptions = {},
): T[] {
  const timeZone = opts.timeZone ?? 'America/Bogota';
  const ordenados = [...cupos].sort(
    (a, b) => a.fecha.getTime() - b.fecha.getTime(),
  );
  if (ordenados.length <= total) return ordenados;

  const maniana: T[] = [];
  const tarde: T[] = [];
  for (const c of ordenados) {
    (horaLocal(c.fecha, timeZone) < HORA_INICIO_TARDE ? maniana : tarde).push(
      c,
    );
  }

  const cuotaManiana = Math.ceil(total / 2);
  const cuotaTarde = total - cuotaManiana;
  // Lo que una franja no llena lo toma la otra.
  const deManiana = Math.min(
    maniana.length,
    cuotaManiana + Math.max(0, cuotaTarde - tarde.length),
  );
  const deTarde = Math.min(tarde.length, total - deManiana);

  return [...maniana.slice(0, deManiana), ...tarde.slice(0, deTarde)].sort(
    (a, b) => a.fecha.getTime() - b.fecha.getTime(),
  );
}

/** Hora (0-23) de esa fecha en esa zona. Mismo cálculo que saludo.ts. */
function horaLocal(fecha: Date, timeZone: string): number {
  const partes = new Intl.DateTimeFormat('es-CO', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(fecha);

  const hora = partes.find((p) => p.type === 'hour')?.value;
  return hora ? Number(hora) : fecha.getUTCHours();
}
