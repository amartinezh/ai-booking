import { loadConfig } from './config';
import { HttpMirrorApiClient } from './core/mirror-api-client';
import { InMemoryAgentStateStore } from './core/agent-state-store';
import { MirrorEngine } from './core/engine';
import { FailureReporter } from './core/failure-reporter';
import { runOutbound, runInbound } from './core/sync-cycle';
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

  // Contadores por dirección: el heartbeat los suma para reportar la salud.
  let erroresSalida = 0;
  let erroresEntrada = 0;
  // Amortigua los fallos repetidos: el driver falla igual en cada vuelta
  // mientras la causa siga ahi, y sin esto el log se vuelve inservible.
  const reporter = new FailureReporter((line) => console.error(line));

  // Las dos direcciones corren en BUCLES INDEPENDIENTES, no en un ciclo
  // compartido.
  //
  // El pull usa long-poll: cada vuelta puede tardar 25 s esperando eventos.
  // Con un ciclo único, aunque las dos llamadas salieran en paralelo, la
  // vuelta terminaba cuando acababa la más lenta — así que la lectura DESDE
  // el HIS solo ocurría cada ~25 s y una cita agendada en el hospital seguía
  // ofreciéndose por WhatsApp mientras tanto. Se detectó probándolo contra el
  // mock: el agente no reportaba el cambio porque no llegaba a mirarlo.
  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const bucleSalida = async () => {
    for (;;) {
      const r = await runOutbound(engine, reporter);
      if (r.applied > 0) {
        console.log(`[mirror-agent] AgenIA->HIS: ${r.applied} evento(s) aplicados.`);
      }
      erroresSalida = r.hadErrors ? erroresSalida + 1 : 0;
      await dormir(config.pollIntervalMs);
    }
  };

  const bucleEntrada = async () => {
    for (;;) {
      const r = await runInbound(engine, reporter);
      if (r.pushed > 0) {
        console.log(`[mirror-agent] HIS->AgenIA: ${r.pushed} cambio(s) subidos.`);
      }
      erroresEntrada = r.hadErrors ? erroresEntrada + 1 : 0;
      await dormir(config.pollIntervalMs);
    }
  };

  const bucleHeartbeat = async () => {
    for (;;) {
      await engine
        .sendHeartbeat(erroresSalida + erroresEntrada)
        .catch((err) => console.error('[mirror-agent] heartbeat falló:', err));
      await dormir(config.heartbeatIntervalMs);
    }
  };

  // Ninguno termina nunca; si alguno reventara, `Promise.all` propaga y el
  // proceso muere con un código distinto de cero para que systemd lo reinicie.
  await Promise.all([bucleSalida(), bucleEntrada(), bucleHeartbeat()]);
}

main().catch((error) => {
  console.error('[mirror-agent] error fatal en el arranque:', error);
  process.exitCode = 1;
});
