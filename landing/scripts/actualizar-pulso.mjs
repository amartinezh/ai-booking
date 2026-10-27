#!/usr/bin/env node
/**
 * Actualiza `data/pulso.json`: titulares de salud de Colombia (Google News) e
 * indicadores de salud del país (Banco Mundial). Lo corre el cron del servidor a
 * las 6 a. m. (deploy/cron.ejemplo) y se puede correr a mano. Node 18+, sin
 * dependencias.
 *
 *   node scripts/actualizar-pulso.mjs                # escribe data/pulso.json
 *   node scripts/actualizar-pulso.mjs --salida x.json
 *
 * Cada fuente falla por separado; lo que no llega conserva lo último bueno. Si no
 * llega nada, el archivo queda como estaba (la página sigue mostrando el pulso
 * anterior). Escribe en un temporal y lo renombra: quien lo lee nunca ve un
 * archivo a medias.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICADORES, TEMAS, armarPulso, leerFeed, leerIndicador, urlDelIndicador, urlDelTema } from './pulso.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--salida');
const SALIDA = resolve(i > 0 ? process.argv[i + 1] : `${RAIZ}/data/pulso.json`);
const ESPERA_MS = 10_000;
const CABECERAS = { 'user-agent': 'AgenIA-Pulso/1.0 (+https://agenia.co)' };

async function traer(url, como) {
    const res = await fetch(url, { headers: CABECERAS, signal: AbortSignal.timeout(ESPERA_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return como === 'json' ? res.json() : res.text();
}

async function titularesDe({ tema, consulta }) {
    try {
        const titulares = leerFeed(await traer(urlDelTema(consulta), 'texto'), 'Google News').map((t) => ({ ...t, tema }));
        console.log(`  ✓ ${tema}: ${titulares.length} titulares`);
        return titulares;
    } catch (e) {
        console.warn(`  ✗ ${tema}: ${e.message} (se conserva lo anterior)`);
        return [];
    }
}

async function indicadorDe(def) {
    try {
        const ind = leerIndicador(await traer(urlDelIndicador(def.id), 'json'), def);
        if (!ind) throw new Error('sin valor');
        return ind;
    } catch (e) {
        console.warn(`  ✗ ${def.nombre}: ${e.message} (se conserva lo anterior)`);
        return null;
    }
}

async function main() {
    console.log(`Pulso de la salud → ${SALIDA}`);
    let anterior = null;
    try {
        anterior = JSON.parse(await readFile(SALIDA, 'utf8'));
    } catch {
        anterior = null;
    }
    const [titulares, indicadores] = await Promise.all([
        Promise.all(TEMAS.map(titularesDe)).then((l) => l.flat()),
        Promise.all(INDICADORES.map(indicadorDe)).then((l) => l.filter(Boolean)),
    ]);
    console.log(`  ✓ indicadores: ${indicadores.length} de ${INDICADORES.length}`);

    const pulso = armarPulso({ titulares, indicadores, anterior, ahora: new Date() });
    if (!pulso) {
        console.warn('No llegó nada de ninguna fuente: el pulso queda como estaba.');
        process.exitCode = 1;
        return;
    }
    const temporal = `${SALIDA}.${process.pid}.tmp`;
    await writeFile(temporal, `${JSON.stringify(pulso, null, 2)}\n`);
    await rename(temporal, SALIDA);
    console.log(`Listo: ${pulso.titulares.length} titulares y ${pulso.indicadores.length} indicadores.`);
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
