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
import type { FiltroEstado, FiltrosBandeja, OrdenBandeja } from './tipos';

export const RUTA_BANDEJA = '/dashboard/bandeja';

export const FILTROS_ESTADO: readonly FiltroEstado[] = [
  'ACTIVAS',
  'SIN_DUENO',
  'MIAS',
  'CERRADAS',
];

export const ORDENES_BANDEJA: readonly OrdenBandeja[] = ['RECIENTES', 'URGENCIA'];

/** El orden por defecto cuando la URL no dice nada: recientes primero. */
const ORDEN_POR_DEFECTO: OrdenBandeja = 'RECIENTES';

const MAX_TEXTO_BUSQUEDA = 100;

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

type Param = string | string[] | undefined;

const primero = (p: Param): string | undefined => (Array.isArray(p) ? p[0] : p);

const fechaValida = (v: string | undefined): string | undefined =>
  v && RE_FECHA.test(v) ? v : undefined;

export function leerFiltros(sp: Record<string, Param>): Required<
  Pick<FiltrosBandeja, 'estado' | 'pagina' | 'orden'>
> &
  Pick<FiltrosBandeja, 'tipo' | 'gravedad' | 'medicoId' | 'desde' | 'hasta' | 'q'> {
  const estado = primero(sp.estado);
  const tipo = primero(sp.tipo);
  const gravedad = primero(sp.gravedad);
  const orden = primero(sp.orden);
  const pagina = Number(primero(sp.pagina));
  const medicoId = primero(sp.medicoId);
  const q = primero(sp.q)?.trim().slice(0, MAX_TEXTO_BUSQUEDA);
  return {
    estado: FILTROS_ESTADO.find((e) => e === estado) ?? 'ACTIVAS',
    tipo: TIPOS_EXCEPCION.find((t) => t === tipo) as TipoExcepcion | undefined,
    gravedad: SEVERIDADES_EXCEPCION.find((g) => g === gravedad) as
      | SeveridadExcepcion
      | undefined,
    medicoId: medicoId || undefined,
    desde: fechaValida(primero(sp.desde)),
    hasta: fechaValida(primero(sp.hasta)),
    q: q || undefined,
    orden: ORDENES_BANDEJA.find((o) => o === orden) ?? ORDEN_POR_DEFECTO,
    pagina: Number.isInteger(pagina) && pagina > 1 ? pagina : 1,
  };
}

/** La dirección de la bandeja con estos filtros; lo que es el valor por defecto no se escribe. */
export function hrefBandeja(f: FiltrosBandeja = {}): string {
  const qs = new URLSearchParams();
  if (f.estado && f.estado !== 'ACTIVAS') qs.set('estado', f.estado);
  if (f.tipo) qs.set('tipo', f.tipo);
  if (f.gravedad) qs.set('gravedad', f.gravedad);
  if (f.medicoId) qs.set('medicoId', f.medicoId);
  if (f.desde) qs.set('desde', f.desde);
  if (f.hasta) qs.set('hasta', f.hasta);
  if (f.q) qs.set('q', f.q);
  if (f.orden && f.orden !== ORDEN_POR_DEFECTO) qs.set('orden', f.orden);
  if (f.pagina && f.pagina > 1) qs.set('pagina', String(f.pagina));
  const texto = qs.toString();
  return texto ? `${RUTA_BANDEJA}?${texto}` : RUTA_BANDEJA;
}
