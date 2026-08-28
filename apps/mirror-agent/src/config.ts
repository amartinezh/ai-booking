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
  heartbeatIntervalMs: number;
}

const DEFAULTS = {
  pollIntervalMs: 5_000,
  heartbeatIntervalMs: 60_000,
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
    heartbeatIntervalMs:
      Number(env.MIRROR_HEARTBEAT_INTERVAL_MS) || DEFAULTS.heartbeatIntervalMs,
  };
}
