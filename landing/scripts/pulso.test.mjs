// node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarPulso, balancear, esApto, leerFeed, leerIndicador, sinMedioAlFinal, urlDelTema } from './pulso.mjs';

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Barreras de acceso: citas médicas en Colombia - Infobae</title>
<link>https://news.google.com/rss/articles/abc</link>
<pubDate>Thu, 22 Oct 2026 08:46:00 GMT</pubDate>
<source url="https://www.infobae.com">Infobae</source></item>
<item><title><![CDATA[Hospital &amp; clínica: jornada de salud]]></title>
<link>https://news.google.com/rss/articles/def</link><pubDate>fecha rota</pubDate></item>
<item><title></title><link>https://sin-titulo</link></item>
<item><title>Sin enlace</title></item>
</channel></rss>`;

test('lee RSS: título sin el medio al final, medio, enlace y fecha ISO', () => {
    const t = leerFeed(RSS, 'Google News');
    assert.equal(t.length, 2);
    assert.deepEqual(t[0], {
        titulo: 'Barreras de acceso: citas médicas en Colombia',
        enlace: 'https://news.google.com/rss/articles/abc',
        medio: 'Infobae',
        sitio: 'https://www.infobae.com',
        publicado: '2026-10-22T08:46:00.000Z',
    });
    // CDATA y entidades; sin <source> toma el medio por defecto; una fecha rota es null.
    assert.deepEqual(t[1], {
        titulo: 'Hospital & clínica: jornada de salud',
        enlace: 'https://news.google.com/rss/articles/def',
        medio: 'Google News',
        sitio: null,
        publicado: null,
    });
});

test('lee Atom y no lanza con XML malformado', () => {
    const atom = '<feed><entry><title>Telemedicina</title><link rel="alternate" href="https://x.co/a"/><updated>2026-10-25T10:00:00Z</updated></entry></feed>';
    assert.equal(leerFeed(atom, 'X')[0].enlace, 'https://x.co/a');
    assert.deepEqual(leerFeed('<rss><item><title>roto', 'X'), []);
    assert.deepEqual(leerFeed('', 'X'), []);
});

test('el medio solo se quita si de verdad está al final', () => {
    assert.equal(sinMedioAlFinal('EPS en crisis - El Tiempo', 'El Tiempo'), 'EPS en crisis');
    assert.equal(sinMedioAlFinal('El Tiempo informa - otra cosa', 'El Tiempo'), 'El Tiempo informa - otra cosa');
});

test('balancea: tope por tema, sin repetidos, lo más nuevo primero', () => {
    const t = (tema, n, horas, enlace = `${tema}-${n}`) => ({
        tema,
        titulo: `Salud ${tema} ${n}`,
        enlace,
        medio: 'M',
        publicado: new Date(Date.UTC(2026, 9, 26, horas)).toISOString(),
    });
    const muchos = Array.from({ length: 12 }, (_, n) => t('A', n, n));
    const r = balancear([...muchos, t('B', 1, 1), t('B', 2, 2, 'A-11')], { maxPorTema: 3, maxTotal: 10 });
    assert.deepEqual(r.map((x) => x.titulo), ['Salud A 11', 'Salud A 10', 'Salud A 9', 'Salud B 1']);
});

test('crímenes y columnas políticas no salen en la landing, aunque vengan con tildes o mayúsculas', () => {
    const t = (titulo) => ({ tema: 'Hospitales', titulo, enlace: titulo, medio: 'M', publicado: null });
    assert.equal(esApto(t('Hombres armados ASESINAN a paciente dentro de un hospital')), false);
    assert.equal(esApto(t('Salud Hernández-Mora habló sobre el gobierno')), false);
    assert.equal(esApto(t('Ataque armado en hospital de Cauca')), false);
    assert.equal(esApto(t('Sinuano Día: resultados del último sorteo')), false);
    assert.equal(esApto(t('Nuevo hospital abre 40 camas en Caldas')), true);
    // El título tiene que hablar de salud.
    assert.equal(esApto(t('La DIAN cambia para siempre: medidas con los impuestos')), false);
    assert.equal(esApto(t('¿Cómo agendar cita en la Ventanilla Única de trámites de tránsito?')), false);
    assert.equal(esApto(t('Medicamentos, autorizaciones y citas médicas: barreras de acceso')), true);
    assert.equal(esApto(t('Dengue en Colombia deja 88.469 casos')), true);
    // Medios de otros países, por el dominio o por el nombre que trae Google News.
    assert.equal(esApto({ ...t('Reprogramarán 9.200 citas'), sitio: 'https://www.elheraldo.hn' }), false);
    assert.equal(esApto({ ...t('Reprogramarán 9.200 citas'), medio: 'elheraldo.hn' }), false);
    assert.equal(esApto({ ...t('EPS deberán pagar'), sitio: 'https://www.eltiempo.com' }), true);
    assert.equal(esApto({ ...t('EPS deberán pagar'), sitio: 'https://www.minsalud.gov.co' }), true);
    assert.deepEqual(balancear([t('Masacre en zona rural'), t('Jornada de vacunación')]).map((x) => x.titulo), ['Jornada de vacunación']);
});

test('un indicador del Banco Mundial: último valor y año; null si no vino', () => {
    const def = { id: 'SP.DYN.LE00.IN', nombre: 'Esperanza de vida al nacer', unidad: 'años', decimales: 1 };
    const json = [{ page: 1 }, [{ date: '2024', value: 77.913 }]];
    assert.deepEqual(leerIndicador(json, def), { ...def, valor: 77.913, anio: '2024' });
    assert.equal(leerIndicador([{ message: 'error' }], def), null);
    assert.equal(leerIndicador([{}, [{ date: '2024', value: null }]], def), null);
});

test('una fuente caída conserva lo anterior; si no llega nada, no hay pulso nuevo', () => {
    const ahora = new Date('2026-10-27T11:00:00Z');
    const anterior = {
        titulares: [{ tema: 'Hospitales', titulo: 'Viejo hospital', enlace: 'v', medio: 'M', publicado: null }],
        indicadores: [{ id: 'SH.IMM.MEAS', nombre: 'Vacunación', unidad: '%', decimales: 0, valor: 93, anio: '2024' }],
    };
    const nuevos = [{ tema: 'Salud en Colombia', titulo: 'Nuevo hospital', enlace: 'n', medio: 'M', publicado: ahora.toISOString() }];
    const p = armarPulso({ titulares: nuevos, indicadores: [], anterior, ahora });
    assert.deepEqual(p.titulares.map((x) => x.titulo), ['Nuevo hospital', 'Viejo hospital']);
    assert.equal(p.indicadores[0].valor, 93);
    assert.equal(p.actualizado, '2026-10-27T11:00:00.000Z');
    assert.equal(armarPulso({ titulares: [], indicadores: [], anterior, ahora }), null);
});

test('la búsqueda de cada tema es de Colombia, en español y de la última semana', () => {
    const u = new URL(urlDelTema('salud colombia'));
    assert.equal(u.searchParams.get('q'), 'salud colombia when:7d');
    assert.equal(u.searchParams.get('gl'), 'CO');
    assert.equal(u.searchParams.get('hl'), 'es-419');
});
