/**
 * Cuánto se conservan los registros con datos personales que no tenían plazo
 * (docs/PLAN_RASTREO_PACIENTE.md §12 #4, Ley 1581 de 2012 — Habeas Data: un dato
 * personal se guarda mientras sirve para lo que se recogió, no para siempre).
 *
 *  · `InteractionLog` — la «caja negra» del bot: el TEXTO de cada conversación (lo que
 *    el paciente escribió y lo que el bot contestó), su WhatsApp y a veces síntomas.
 *    Sirve para atender un reclamo («dice que agendó») y para recontactar a quien el
 *    bot no pudo atender. 180 días cubren de sobra el plazo de una PQRS (15 días
 *    hábiles) y el de una queja que llega tarde por la Superintendencia.
 *  · `PatientLookupLog` — la bitácora de QUIÉN consultó a QUÉ paciente en el rastreo.
 *    Es un registro de acceso: se guarda más tiempo que lo consultado, porque su
 *    razón de ser es poder responder, meses después, «¿quién miró mis datos?». Un año.
 *
 * Pasado el plazo las filas se BORRAN (no se anonimizan): ninguna pantalla ni métrica
 * lee estas tablas más atrás de unos días (la auditoría muestra las últimas 200, el
 * rastreo reconstruye conversaciones recientes), así que no hay historia que salvar.
 *
 * Los plazos se pueden cambiar por entorno (`RETENCION_CONVERSACIONES_DIAS`,
 * `RETENCION_BITACORA_RASTREO_DIAS`), pero nunca por debajo de `minimoDias`: un error
 * de tipeo (`1` en vez de `180`) no puede borrar la conversación de ayer.
 */
export const RETENCION_DATOS = {
  conversacionesDias: 180,
  bitacoraRastreoDias: 365,
  minimoDias: 30,
} as const;

/**
 * Los días que valen para un plazo configurable: el del entorno si es un entero
 * válido y no baja del mínimo; si no, el de por defecto, con el motivo para el log.
 */
export function diasDeRetencion(
  crudo: string | undefined,
  porDefecto: number,
): { dias: number; aviso: string | null } {
  const texto = (crudo ?? '').trim();
  if (!texto) return { dias: porDefecto, aviso: null };
  const n = Number(texto);
  if (!Number.isInteger(n)) {
    return {
      dias: porDefecto,
      aviso: `«${texto}» no es un número entero de días: se usan ${porDefecto}.`,
    };
  }
  if (n < RETENCION_DATOS.minimoDias) {
    return {
      dias: porDefecto,
      aviso: `${n} días está por debajo del mínimo (${RETENCION_DATOS.minimoDias}): se usan ${porDefecto}.`,
    };
  }
  return { dias: n, aviso: null };
}
