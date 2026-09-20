/**
 * Hora local de una clínica ↔ instante UTC.
 *
 * El rastreo compara lo que el funcionario ve en una captura ("lunes 22, 10:00")
 * o en el HIS con instantes UTC guardados en la base. Bogotá no tiene horario de
 * verano, pero el helper no lo da por hecho: `Organization.timezone` puede ser
 * otra zona el día que entre una clínica fuera de Colombia (CLAUDE.md, "Fechas y
 * zona horaria"), y con horario de verano un desfase de un offset fijo daría
 * horas equivocadas dos veces al año.
 */

const FORMATO: Record<string, Intl.DateTimeFormat> = {};

function formateador(tz: string): Intl.DateTimeFormat {
  return (FORMATO[tz] ??= new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }));
}

function partes(instante: number, tz: string) {
  const mapa: Record<string, string> = {};
  for (const p of formateador(tz).formatToParts(new Date(instante))) {
    mapa[p.type] = p.value;
  }
  return {
    y: Number(mapa.year),
    m: Number(mapa.month),
    d: Number(mapa.day),
    hh: Number(mapa.hour),
    mm: Number(mapa.minute),
  };
}

const dos = (n: number) => String(n).padStart(2, '0');

/** Fecha (`YYYY-MM-DD`) y hora (`HH:mm`, 24 h) locales de un instante, o null si no es una fecha válida. */
export function partesLocales(
  instante: string | Date,
  tz: string,
): { fecha: string; hora: string } | null {
  const ms = new Date(instante).getTime();
  if (Number.isNaN(ms)) return null;
  const p = partes(ms, tz);
  return {
    fecha: `${p.y}-${dos(p.m)}-${dos(p.d)}`,
    hora: `${dos(p.hh)}:${dos(p.mm)}`,
  };
}

const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * `2026-09-22` + `10:00` en `America/Bogota` → el instante UTC correspondiente.
 * Devuelve null si el formato es inválido, si la fecha no existe (31 de febrero)
 * o si esa hora local no existe (el salto de horario de verano).
 */
export function aUtc(fecha: string, hora: string, tz: string): Date | null {
  const f = FECHA_RE.exec(fecha ?? '');
  const h = HORA_RE.exec(hora ?? '');
  if (!f || !h) return null;
  const [y, m, d] = [Number(f[1]), Number(f[2]), Number(f[3])];
  const [hh, mm] = [Number(h[1]), Number(h[2])];

  const comoUtc = Date.UTC(y, m - 1, d, hh, mm);
  // El offset de la zona depende del instante; dos pasadas cubren un cambio de
  // horario de verano dentro del propio desfase.
  let instante = comoUtc;
  for (let i = 0; i < 2; i++) {
    const p = partes(instante, tz);
    const offset = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - instante;
    instante = comoUtc - offset;
  }

  // Verificación de ida y vuelta: rechaza "31 de febrero" (JS lo rueda a marzo)
  // y horas que no existen en la zona.
  const vuelta = partesLocales(new Date(instante), tz);
  if (!vuelta || vuelta.fecha !== fecha || vuelta.hora !== hora) return null;
  return new Date(instante);
}
