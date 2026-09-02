/**
 * Config del proceso agente, leída de variables de entorno. En producción,
 * en Linux, se sirve vía systemd `LoadCredential` + archivo `0600` (ver
 * plan §9 Seguridad) — nunca en claro en un `.env` versionado.
 */
export interface AgentConfig {
  mirrorApiUrl: string;
  agentToken: string;
  driverVersion: string;
  pollIntervalMs: number;
  /**
   * Cada cuánto se le pregunta al HIS qué cambió.
   *
   * Es SUYO y no el de `pollIntervalMs` a propósito. El de salida es un
   * long-poll: pedir cada 5s no cuesta nada porque el servidor retiene la
   * llamada. El de entrada, en cambio, relee la ventana de vigilancia entera
   * de la base del hospital en cada vuelta — 1.084.093 filas / 855 MB de
   * tabla, ~28.000 filas devueltas (bloque 29b). Compartir los 5 segundos del
   * long-poll era heredar un ritmo pensado para algo que no cuesta.
   */
  inboundIntervalMs: number;
  heartbeatIntervalMs: number;
  /** Cada cuánto se contrasta el HIS entero contra AgenIA. */
  reconcileIntervalMs: number;
  /** Espera antes de la PRIMERA reconciliación, para no pisar el arranque. */
  reconcileDelayMs: number;
  /** Días hacia adelante que abarca la comparación. */
  reconcileDias: number;

  // ── Agenda del hospital (Fase 2) ──────────────────────────────────────
  /** Cada cuánto se repasa la agenda cercana. */
  availabilityIntervalMs: number;
  /** Espera antes del primer repaso, tras arrancar. */
  availabilityDelayMs: number;
  /** Días que se repasan en cada vuelta corta. */
  availabilityDiasCercanos: number;
  /** Días que abarca el repaso completo. */
  availabilityDias: number;
  /** Cada cuánto se hace el repaso completo. */
  availabilityCompletaMs: number;

  // ── Catálogo del HIS (homologación) ───────────────────────────────────
  /** Cada cuánto se sube el catálogo de médicos y servicios del hospital. */
  catalogIntervalMs: number;
  /** Espera antes de la primera subida, tras arrancar. */
  catalogDelayMs: number;
}

const DEFAULTS = {
  pollIntervalMs: 5_000,
  // 30s: seis veces menos carga sobre la base viva del hospital, y sigue
  // siendo mucho más rápido de lo que nadie nota. Lo que protege de la
  // sobreventa en el intervalo no es esta lectura sino la PK del HIS, que
  // rechaza la segunda cita en el mismo cupo en el momento de escribirla.
  inboundIntervalMs: 30_000,
  heartbeatIntervalMs: 60_000,
  // Una vez al día: la reconciliación lee la agenda entera del hospital, no es
  // algo que convenga hacer cada minuto.
  reconcileIntervalMs: 24 * 60 * 60_000,
  reconcileDelayMs: 120_000,
  reconcileDias: 90,
  // La agenda cercana cambia y duele ya: un turno que el hospital cancela para
  // mañana tiene que dejar de venderse hoy. La de dentro de once meses puede
  // esperar unas horas — el hospital tiene reservas hasta 12 meses adelante
  // (MAPEO_HIS.md §1, 27.877 citas en 90 días), así que el barrido completo va
  // a +13 meses pero solo una vez al día.
  availabilityIntervalMs: 15 * 60_000,
  availabilityDelayMs: 30_000,
  availabilityDiasCercanos: 14,
  availabilityDias: 400,
  availabilityCompletaMs: 24 * 60 * 60_000,
  // Una vez al día basta: un médico nuevo del hospital no aparece cada minuto.
  // Pero el conjunto SÍ se mueve —30 médicos con turnos futuros en una corrida,
  // 25 al día siguiente— así que tampoco vale hacerlo solo al arrancar.
  catalogIntervalMs: 24 * 60 * 60_000,
  catalogDelayMs: 15_000,
  driverVersion: '0.1.0-fase1',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const mirrorApiUrl = env.MIRROR_API_URL;
  const agentToken = env.MIRROR_AGENT_TOKEN;

  if (!mirrorApiUrl) {
    throw new Error('MIRROR_API_URL no está configurado.');
  }
  if (!agentToken) {
    throw new Error('MIRROR_AGENT_TOKEN no está configurado.');
  }

  return {
    mirrorApiUrl,
    agentToken,
    driverVersion: env.MIRROR_DRIVER_VERSION ?? DEFAULTS.driverVersion,
    pollIntervalMs: Number(env.MIRROR_POLL_INTERVAL_MS) || DEFAULTS.pollIntervalMs,
    inboundIntervalMs:
      Number(env.MIRROR_INBOUND_INTERVAL_MS) || DEFAULTS.inboundIntervalMs,
    heartbeatIntervalMs:
      Number(env.MIRROR_HEARTBEAT_INTERVAL_MS) || DEFAULTS.heartbeatIntervalMs,
    reconcileIntervalMs:
      Number(env.MIRROR_RECONCILE_INTERVAL_MS) || DEFAULTS.reconcileIntervalMs,
    reconcileDelayMs:
      Number(env.MIRROR_RECONCILE_DELAY_MS) || DEFAULTS.reconcileDelayMs,
    reconcileDias: Number(env.MIRROR_RECONCILE_DIAS) || DEFAULTS.reconcileDias,
    availabilityIntervalMs:
      Number(env.MIRROR_AVAILABILITY_INTERVAL_MS) || DEFAULTS.availabilityIntervalMs,
    availabilityDelayMs:
      Number(env.MIRROR_AVAILABILITY_DELAY_MS) || DEFAULTS.availabilityDelayMs,
    availabilityDiasCercanos:
      Number(env.MIRROR_AVAILABILITY_DIAS_CERCANOS) || DEFAULTS.availabilityDiasCercanos,
    availabilityDias:
      Number(env.MIRROR_AVAILABILITY_DIAS) || DEFAULTS.availabilityDias,
    availabilityCompletaMs:
      Number(env.MIRROR_AVAILABILITY_COMPLETA_MS) || DEFAULTS.availabilityCompletaMs,
    catalogIntervalMs:
      Number(env.MIRROR_CATALOG_INTERVAL_MS) || DEFAULTS.catalogIntervalMs,
    catalogDelayMs:
      Number(env.MIRROR_CATALOG_DELAY_MS) || DEFAULTS.catalogDelayMs,
  };
}
