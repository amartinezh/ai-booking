/**
 * Los filtros de la bandeja viajan en la URL (`?estado=MIAS&tipo=…&pagina=2`): la
 * lista se arma en el servidor, se puede compartir el enlace y el botón «atrás»
 * funciona. Aquí solo se lee y se escribe esa dirección, sin base de datos.
 *
 * Lo que llega en la URL lo escribe cualquiera: todo se valida contra las listas
 * conocidas y lo demás se ignora (el servicio lo vuelve a validar).
 */
import {
  SEVERIDADES_EXCEPCION,
  TIPOS_EXCEPCION,
  type SeveridadExcepcion,
  type TipoExcepcion,
} from '@agenia/shared';
import type { FiltroEstado, FiltrosBandeja } from './tipos';

export const RUTA_BANDEJA = '/dashboard/bandeja';

export const FILTROS_ESTADO: readonly FiltroEstado[] = [
  'ACTIVAS',
  'SIN_DUENO',
  'MIAS',
  'CERRADAS',
];

type Param = string | string[] | undefined;

const primero = (p: Param): string | undefined => (Array.isArray(p) ? p[0] : p);

export function leerFiltros(
  sp: Record<string, Param>,
): Required<Pick<FiltrosBandeja, 'estado' | 'pagina'>> &
  Pick<FiltrosBandeja, 'tipo' | 'gravedad'> {
  const estado = primero(sp.estado);
  const tipo = primero(sp.tipo);
  const gravedad = primero(sp.gravedad);
  const pagina = Number(primero(sp.pagina));
  return {
    estado: FILTROS_ESTADO.find((e) => e === estado) ?? 'ACTIVAS',
    tipo: TIPOS_EXCEPCION.find((t) => t === tipo) as TipoExcepcion | undefined,
    gravedad: SEVERIDADES_EXCEPCION.find((g) => g === gravedad) as
      | SeveridadExcepcion
      | undefined,
    pagina: Number.isInteger(pagina) && pagina > 1 ? pagina : 1,
  };
}

/** La dirección de la bandeja con estos filtros; lo que es el valor por defecto no se escribe. */
export function hrefBandeja(f: FiltrosBandeja = {}): string {
  const qs = new URLSearchParams();
  if (f.estado && f.estado !== 'ACTIVAS') qs.set('estado', f.estado);
  if (f.tipo) qs.set('tipo', f.tipo);
  if (f.gravedad) qs.set('gravedad', f.gravedad);
  if (f.pagina && f.pagina > 1) qs.set('pagina', String(f.pagina));
  const texto = qs.toString();
  return texto ? `${RUTA_BANDEJA}?${texto}` : RUTA_BANDEJA;
}
