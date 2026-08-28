import { loadConfig } from './config';
import { HttpMirrorApiClient } from './core/mirror-api-client';
import { InMemoryAgentStateStore } from './core/agent-state-store';
import { MirrorEngine } from './core/engine';
import { CntSanVicenteAnsermaDriver } from './drivers/cnt-sanvicente-anserma';
import type { HisDriver } from './core/driver.interface';

/**
 * Punto de entrada del agente. Selecciona el driver por `driverKey` —
 * hoy solo existe uno; un segundo hospital agrega una entrada aquí sin
 * tocar nada más de este archivo ni de core/.
 */
function selectDriver(driverKey: string): HisDriver {
  switch (driverKey) {
    case 'cnt-sanvicente-anserma':
      return new CntSanVicenteAnsermaDriver();
    default:
      throw new Error(`driverKey desconocido: ${driverKey}`);
  }
}

async function main() {
  const config = loadConfig();
  const apiClient = new HttpMirrorApiClient(config.mirrorApiUrl, config.agentToken);

  // El driverKey real viaja embebido en el propio agentToken del lado del
  // servidor (ver mirror-token.util.ts) — el agente igual necesita saberlo
  // localmente para elegir qué clase instanciar. Se configura junto al
  // token al instalar el agente (mismo valor que HospitalMirrorConfig.driverKey).
  const driverKey = process.env.MIRROR_DRIVER_KEY;
  if (!driverKey) {
    throw new Error('MIRROR_DRIVER_KEY no está configurado.');
  }

  const driver = selectDriver(driverKey);
  const state = new InMemoryAgentStateStore();
  const engine = new MirrorEngine(apiClient, driver, state, config.driverVersion);

  console.log(`[mirror-agent] arrancando con driver "${driverKey}"...`);
  await engine.handshake();
  console.log('[mirror-agent] handshake OK, entrando al loop de sync.');

  let recentErrors = 0;
  let lastHeartbeat = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await engine.pullAndApplyOutboxEvents();
      await engine.detectAndPushChanges();
      recentErrors = 0;
    } catch (error) {
      recentErrors++;
      console.error('[mirror-agent] error en el ciclo de sync:', error);
    }

    if (Date.now() - lastHeartbeat >= config.heartbeatIntervalMs) {
      await engine.sendHeartbeat(recentErrors).catch((err) => {
        console.error('[mirror-agent] heartbeat falló:', err);
      });
      lastHeartbeat = Date.now();
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

main().catch((error) => {
  console.error('[mirror-agent] error fatal en el arranque:', error);
  process.exitCode = 1;
});
