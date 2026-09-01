/**
 * Punto de entrada del agente — SOLO CABLEADO.
 *
 * Este archivo está fuera de la medición de cobertura (`collectCoverageFrom`
 * en package.json), y eso es una regla, no una excepción: lee la config, elige
 * el driver, arma el motor y lanza cuatro bucles infinitos. Un `for(;;)` no se
 * puede cubrir de forma honesta, y forzarlo produciría pruebas que solo suben
 * un número.
 *
 * La regla que lo hace aceptable: CUALQUIER COSA CON LÓGICA SALE DE AQUÍ. Cada
 * vez que aparece una decisión, se extrae a `core/` y se prueba allí. Ya pasó
 * tres veces:
 *
 *   · `runOutbound`/`runInbound` (core/sync-cycle.ts) — que un fallo en una
 *     dirección no impida que la otra corra.
 *   · `runOutboundConFreno` (core/sync-cycle.ts) — que con el circuito abierto
 *     no se toque el HIS, y que estar frenado no cuente como fallo.
 *   · `recorrerAgenda` (core/agenda-sweep.ts) — que cada día se suba como una
 *     foto completa y que un `OFF` corte el barrido en seco.
 *
 * Si vuelve a crecer con un `if` que merezca una prueba, ese `if` no va aquí.
 */
import * as path from 'path';
import { loadConfig } from './config';
import { HttpMirrorApiClient } from './core/mirror-api-client';
import { FileAgentStateStore } from './core/file-agent-state-store';
import { MirrorEngine } from './core/engine';
import { FailureReporter } from './core/failure-reporter';
import { runOutboundConFreno, runInbound } from './core/sync-cycle';
import { recorrerAgenda } from './core/agenda-sweep';
import { CircuitBreaker } from './core/circuit-breaker';
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

  // El estado va a DISCO, no a memoria.
  //
  // El cursor de detección es una foto del HIS. Perderla en un reinicio no
  // provoca reprocesos: provoca CEGUERA. El agente toma una foto nueva que ya
  // incluye lo ocurrido mientras estaba caído y no lo reporta jamás — un
  // reinicio para parches y una cita agendada en ventanilla desaparecen del
  // lado de AgenIA, que sigue ofreciendo ese cupo por WhatsApp.
  //
  // Por defecto cae en `data/` bajo el WorkingDirectory del servicio, que es
  // exactamente el único directorio que la unidad systemd deja escribir
  // (ReadWritePaths=/opt/agenia-mirror-agent/data).
  const state = new FileAgentStateStore(
    process.env.MIRROR_STATE_FILE ?? path.join(process.cwd(), 'data', 'state.json'),
    (m) => console.warn(m),
  );
  await state.cargar();

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
  const mensajeDeError = (e: unknown) =>
    e instanceof Error ? e.message : String(e);

  // Modo seguro: si el HIS lleva rato rechazando todo, se deja de intentar en
  // vez de quemar los diez intentos que separan cada evento del dead-letter.
  // Un reinicio de veinte minutos del SQL Server no debería mandar media cola
  // a dead-letter por un problema que ya se resolvió solo.
  const breaker = new CircuitBreaker();

  const bucleSalida = async () => {
    for (;;) {
      const r = await runOutboundConFreno(engine, reporter, breaker);
      if (r.frenado) {
        await dormir(config.pollIntervalMs);
        continue;
      }
      if (r.applied > 0) {
        console.log(`[mirror-agent] AgenIA->HIS: ${r.applied} evento(s) aplicados.`);
      }
      if (r.skipped > 0) {
        // No es un error: son entidades que este driver no espeja (SLOT, por
        // ejemplo). Se dice igual, para que "no llegó al HIS" nunca sea una
        // sorpresa sin rastro en el log.
        console.log(
          `[mirror-agent] AgenIA->HIS: ${r.skipped} evento(s) omitidos (tipo no espejado por este driver).`,
        );
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

  const bucleAgenda = async () => {
    await dormir(config.availabilityDelayMs);
    let ultimaCompleta = 0;
    for (;;) {
      try {
        const completa =
          Date.now() - ultimaCompleta >= config.availabilityCompletaMs;
        const dias = completa
          ? config.availabilityDias
          : config.availabilityDiasCercanos;
        const r = await recorrerAgenda(engine, { dias });
        if (completa) ultimaCompleta = Date.now();

        if (r.modo === 'OFF') {
          // No es un fallo: el hospital todavía no cedió su agenda. Se dice
          // una vez por vuelta y el amortiguador evita que inunde el log.
          reporter.report(
            'agenda',
            'availabilityMode=OFF: la agenda de AgenIA sigue siendo la suya, no la del hospital.',
          );
        } else if (r.creados || r.borrados || r.conflictos) {
          const sombra = r.modo === 'SHADOW' ? ' (modo sombra, sin escribir)' : '';
          console.log(
            `[mirror-agent] agenda${sombra}: +${r.creados} cupo(s), -${r.borrados}, ` +
              `${r.conflictos} conflicto(s), ${r.dias} día(s) repasados.`,
          );
        }
      } catch (error) {
        reporter.report('agenda', mensajeDeError(error));
      }
      await dormir(config.availabilityIntervalMs);
    }
  };

  // Capa 5 del plan §6: la única defensa que detecta deriva silenciosa.
  //
  // Estaba a medias: el endpoint del servidor existía y NADIE lo llamaba. Es
  // decir, la defensa contra "todo pareció ir bien y aun así los dos sistemas
  // no coinciden" no corría nunca. Se comprobó en la VM: una cita que el
  // hospital agendó mientras el agente estaba caído quedó fuera de AgenIA para
  // siempre y ningún mecanismo la iba a encontrar.
  const bucleReconciliacion = async () => {
    await dormir(config.reconcileDelayMs);
    for (;;) {
      try {
        const from = new Date();
        const to = new Date(from.getTime() + config.reconcileDias * 86_400_000);
        const r = await engine.reconcile({ from, to });
        if (r.inSync) {
          console.log(
            `[mirror-agent] reconciliación OK: ${r.inHis} cita(s), sin diferencias.`,
          );
        } else {
          // El detalle y la alerta los produce el servidor (queda en SyncAudit);
          // aquí se deja constancia en el journal de la VM, que es lo que mira
          // quien esté delante de la máquina.
          console.error(
            `[mirror-agent] 🚨 DERIVA: ${r.missingInHis.length} cita(s) que el ` +
              `hospital NO tiene y ${r.missingInAgenIA.length} que AgenIA desconoce.`,
          );
        }
      } catch (error) {
        reporter.report('reconciliación', mensajeDeError(error));
      }
      await dormir(config.reconcileIntervalMs);
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
  // Carga inicial (plan §11, Fase 2): un barrido completo y salir. Se corre a
  // mano el día del arranque, con el servicio parado, para no esperar a que el
  // bucle recorra 400 días a su ritmo.
  if (process.argv.includes('--seed-inicial')) {
    console.log(
      `[mirror-agent] carga inicial: repasando ${config.availabilityDias} días de agenda...`,
    );
    const r = await recorrerAgenda(engine, { dias: config.availabilityDias });
    if (r.modo === 'OFF') {
      console.error(
        '[mirror-agent] availabilityMode=OFF — no se escribió nada. ' +
          'Ponlo en SHADOW (para comparar) o ON (para importar) antes de la carga inicial.',
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `[mirror-agent] carga inicial terminada (${r.modo}): +${r.creados} cupo(s), ` +
        `-${r.borrados}, ${r.conflictos} conflicto(s).`,
    );
    return;
  }

  await Promise.all([
    bucleSalida(),
    bucleEntrada(),
    bucleHeartbeat(),
    bucleReconciliacion(),
    bucleAgenda(),
  ]);
}

main().catch((error) => {
  console.error('[mirror-agent] error fatal en el arranque:', error);
  process.exitCode = 1;
});
