/**
 * Pulso de la salud: lo PURO del agregador (sin red ni disco), para probarlo con
 * `node --test`. El script `actualizar-pulso.mjs` hace la red y el disco.
 *
 * Portado del «pulso del sector» de Preztia (apps/api/src/news/rss-parser.ts y
 * news.service.ts): mismo parser RSS/Atom tolerante a fallos y la misma selección
 * balanceada por tema, con temas de salud de Colombia.
 */

/**
 * Temas del pulso: una búsqueda de Google News (español, última semana) por tema.
 * Todas exigen «colombia»: `gl=CO` no basta, trae medios de toda la región. En
 * Google, `colombia A OR B` es colombia Y (A o B).
 */
export const TEMAS = [
    { tema: 'Salud en Colombia', consulta: 'colombia "sistema de salud" OR "Ministerio de Salud" OR MinSalud OR "reforma a la salud"' },
    { tema: 'EPS y aseguramiento', consulta: 'colombia EPS OR Supersalud OR ADRES' },
    { tema: 'Citas y acceso', consulta: 'colombia "citas médicas" OR "agendamiento de citas" OR "asignación de citas" OR "cita médica"' },
    { tema: 'Salud digital', consulta: 'colombia telemedicina OR "salud digital" OR "inteligencia artificial en salud" OR telesalud' },
    { tema: 'Hospitales', consulta: 'colombia "nuevo hospital" OR "hospital universitario" OR "red hospitalaria" OR "ESE hospital" OR "hospital departamental"' },
];

/** Indicadores de salud de Colombia del Banco Mundial (último valor publicado de cada uno). */
export const INDICADORES = [
    { id: 'SP.DYN.LE00.IN', nombre: 'Esperanza de vida al nacer', unidad: 'años', decimales: 1 },
    { id: 'SH.MED.PHYS.ZS', nombre: 'Médicos por cada 1.000 habitantes', unidad: '', decimales: 1 },
    { id: 'SH.MED.NUMW.P3', nombre: 'Enfermeras y parteras por cada 1.000 habitantes', unidad: '', decimales: 1 },
    { id: 'SH.MED.BEDS.ZS', nombre: 'Camas de hospital por cada 1.000 habitantes', unidad: '', decimales: 1 },
    { id: 'SH.XPD.CHEX.GD.ZS', nombre: 'Gasto en salud', unidad: '% del PIB', decimales: 1 },
    { id: 'SP.DYN.IMRT.IN', nombre: 'Mortalidad infantil por cada 1.000 nacidos vivos', unidad: '', decimales: 1 },
    { id: 'SH.IMM.MEAS', nombre: 'Niños vacunados contra el sarampión', unidad: '%', decimales: 0 },
];

/**
 * Lo que no va en la portada de una landing aunque sea noticia: crímenes y
 * violencia, y la columnista que se llama Salud (sus columnas políticas entraban
 * por la búsqueda «salud»). Se compara sin tildes ni mayúsculas.
 */
export const EXCLUIR = [
    'asesin', 'homicid', 'feminicid', 'sicari', 'balacera', 'balea', 'armad', 'ataque', 'masacre', 'secuestr',
    'disparo', 'apunal',
    'sorteo', 'loteria', 'sinuano', 'baloto', 'chance',
    'hernandez-mora', 'cutral',
];

/**
 * El TÍTULO tiene que hablar de salud: Google News es laxo con los OR y la
 * búsqueda «IPS» traía la agencia de noticias IPS; «hospital», el fútbol.
 * Sin tildes y en minúsculas.
 */
const DE_SALUD =
    /\b(salud|eps|hospital|clinica|medic|citas? medicas?|paciente|medicament|vacun|dengue|enfermer|urgencias|telemedicina|telesalud|minsalud|supersalud|adres|cancer|epidemi|cirug|odontolog|farmac|drogueri|historia clinica)/;

/** Dominios de otros países (los medios de Colombia usan .co o un .com/.net/.org genérico). */
const DOMINIO_EXTRANJERO = /\.(ar|bo|br|cl|cr|cu|do|ec|es|gt|hn|mx|ni|pa|pe|pr|py|sv|uy|ve)(\/|$)/i;

const sinTildes = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** ¿El titular puede salir en la landing? */
export const esApto = (t) =>
    DE_SALUD.test(sinTildes(t.titulo)) &&
    !EXCLUIR.some((p) => sinTildes(`${t.titulo} ${t.medio}`).includes(p)) &&
    !DOMINIO_EXTRANJERO.test(t.sitio ?? '') &&
    !DOMINIO_EXTRANJERO.test(t.medio);

export const MAX_TITULARES = 40;
export const MAX_POR_TEMA = 8;

export function urlDelTema(consulta) {
    const q = encodeURIComponent(`${consulta} when:7d`);
    return `https://news.google.com/rss/search?q=${q}&hl=es-419&gl=CO&ceid=CO:es-419`;
}

export function urlDelIndicador(id) {
    return `https://api.worldbank.org/v2/country/COL/indicator/${id}?format=json&mrnev=1`;
}

// Un titular es un bloque <item>…</item> (RSS) o <entry>…</entry> (Atom).
const BLOQUE = /<(item|entry)\b[\s\S]*?<\/\1>/gi;

/**
 * Titulares de un feed RSS 2.0 o Atom. Nunca lanza: ante XML malformado devuelve
 * lo que pudo leer (posiblemente nada).
 */
export function leerFeed(xml, medioPorDefecto) {
    if (!xml) return [];
    const titulares = [];
    for (const m of xml.matchAll(BLOQUE)) {
        const bloque = m[0];
        const medio = limpiar(contenido(bloque, 'source')) || medioPorDefecto;
        const sitio = /<source\b[^>]*\burl\s*=\s*"([^"]+)"/i.exec(bloque)?.[1] ?? null;
        const titulo = sinMedioAlFinal(limpiar(contenido(bloque, 'title')), medio);
        const enlace = enlaceDe(bloque);
        if (!titulo || !enlace) continue;
        titulares.push({
            titulo,
            enlace,
            medio,
            sitio,
            publicado: fecha(
                contenido(bloque, 'pubDate') ?? contenido(bloque, 'published') ?? contenido(bloque, 'updated'),
            ),
        });
    }
    return titulares;
}

/** Google News termina cada título con « - <medio>»: sobra, el medio va aparte. */
export function sinMedioAlFinal(titulo, medio) {
    const sufijo = ` - ${medio}`;
    return medio && titulo.endsWith(sufijo) ? titulo.slice(0, -sufijo.length).trim() : titulo;
}

function contenido(bloque, etiqueta) {
    const re = new RegExp(`<${etiqueta}\\b[^>]*>([\\s\\S]*?)</${etiqueta}>`, 'i');
    return re.exec(bloque)?.[1] ?? null;
}

function enlaceDe(bloque) {
    for (const m of bloque.matchAll(/<link\b([^>]*?)\/?>/gi)) {
        const href = /\bhref\s*=\s*"([^"]+)"/i.exec(m[1])?.[1];
        if (!href) continue;
        const rel = /\brel\s*=\s*"([^"]+)"/i.exec(m[1])?.[1];
        if (!rel || rel === 'alternate') return limpiar(href);
    }
    const texto = contenido(bloque, 'link');
    return texto ? limpiar(texto) : null;
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Quita CDATA y HTML incrustado y decodifica entidades. */
export function limpiar(crudo) {
    if (!crudo) return '';
    return crudo
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&#(\d+);/g, (_, d) => desdeCodigo(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => desdeCodigo(parseInt(h, 16)))
        .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, n) => ENTIDADES[n] ?? m)
        .replace(/\s+/g, ' ')
        .trim();
}

const desdeCodigo = (c) => (Number.isFinite(c) && c > 0 ? String.fromCodePoint(c) : '');

function fecha(crudo) {
    if (!crudo) return null;
    const ms = Date.parse(limpiar(crudo));
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const masNuevo = (a, b) => (b.publicado ? Date.parse(b.publicado) : 0) - (a.publicado ? Date.parse(a.publicado) : 0);

/**
 * Lo más nuevo de CADA tema (tope por tema) y luego todo por fecha, con tope total:
 * ningún tema llena la portada solo porque publica más rápido. Sin repetidos (por
 * enlace o por el mismo título en dos temas).
 */
export function balancear(titulares, { maxPorTema = MAX_POR_TEMA, maxTotal = MAX_TITULARES } = {}) {
    const vistos = new Set();
    const porTema = new Map();
    for (const t of [...titulares].filter(esApto).sort(masNuevo)) {
        const clave = t.titulo.toLowerCase();
        if (vistos.has(t.enlace) || vistos.has(clave)) continue;
        const cubeta = porTema.get(t.tema) ?? [];
        if (cubeta.length >= maxPorTema) continue;
        vistos.add(t.enlace);
        vistos.add(clave);
        cubeta.push(t);
        porTema.set(t.tema, cubeta);
    }
    return [...porTema.values()].flat().sort(masNuevo).slice(0, maxTotal);
}

/** El último valor de un indicador del Banco Mundial, o null si no vino. */
export function leerIndicador(json, def) {
    const fila = Array.isArray(json) && Array.isArray(json[1]) ? json[1].find((f) => f && f.value !== null) : null;
    if (!fila) return null;
    return { id: def.id, nombre: def.nombre, unidad: def.unidad, decimales: def.decimales, valor: Number(fila.value), anio: String(fila.date) };
}

/**
 * El pulso nuevo a partir de lo que llegó y del anterior: un tema o un indicador
 * que no llegó conserva lo último bueno, para que la página nunca quede a medias
 * porque una fuente se cayó. null si no llegó nada de nada (se deja el archivo
 * como estaba).
 */
export function armarPulso({ titulares, indicadores, anterior, ahora }) {
    if (titulares.length === 0 && indicadores.length === 0) return null;
    const temasNuevos = new Set(titulares.map((t) => t.tema));
    const conservados = (anterior?.titulares ?? []).filter((t) => !temasNuevos.has(t.tema));
    const idsNuevos = new Set(indicadores.map((i) => i.id));
    const orden = INDICADORES.map((i) => i.id);
    return {
        actualizado: ahora.toISOString(),
        temas: TEMAS.map((t) => t.tema),
        titulares: balancear([...titulares, ...conservados]),
        indicadores: [...indicadores, ...(anterior?.indicadores ?? []).filter((i) => !idsNuevos.has(i.id))].sort(
            (a, b) => orden.indexOf(a.id) - orden.indexOf(b.id),
        ),
        fuentes: { titulares: 'Google News', indicadores: 'Banco Mundial' },
    };
}
