import type { TemaAyuda, TerminoGlosario } from './contenido';

// ─────────────────────────────────────────────────────────────
// BUSCADOR DEL CENTRO DE AYUDA — sin IA, todo en el navegador.
//
// 1. Cada tema se parte en fragmentos (resumen, cada guía, cada pregunta,
//    cada problema, cada elemento de pantalla, cada término del glosario):
//    un resultado lleva a la sección exacta, no al tema entero.
// 2. El texto se normaliza (sin tildes ni mayúsculas) y cada palabra se
//    reduce a su raíz: «agendar», «agendada» y «agenda» se encuentran entre sí.
// 3. Cada palabra buscada se amplía con sinónimos del oficio (turno → cupo),
//    con lo que empieza igual (mientras se escribe) y con lo que se parece
//    (errores de tipeo, distancia de edición).
// 4. Se puntúa con BM25 por campo (el título pesa más que el cuerpo), se
//    castiga cubrir solo parte de la búsqueda y se premia la frase exacta.
// ─────────────────────────────────────────────────────────────

export type TipoFragmento = 'resumen' | 'guia' | 'elemento' | 'pregunta' | 'problema' | 'glosario';

export interface Fragmento {
    /** Ancla en la página de ayuda (id del elemento HTML). */
    id: string;
    /** Tema al que pertenece; 'glosario' para los términos del glosario. */
    temaId: string;
    tipo: TipoFragmento;
    titulo: string;
    texto: string;
    /** Solo para buscar: no se muestra. */
    claves: string;
}

export interface Segmento {
    texto: string;
    marcado: boolean;
}

export interface ResultadoBusqueda {
    fragmento: Fragmento;
    puntaje: number;
    titulo: Segmento[];
    extracto: Segmento[];
}

export interface RespuestaBusqueda {
    resultados: ResultadoBusqueda[];
    /** Raíces que coincidieron: sirven para resaltar el tema al abrirlo. */
    terminos: string[];
}

export const GLOSARIO_ID = 'glosario';

export function anclaDe(temaId: string, tipo: TipoFragmento, indice = 0): string {
    return tipo === 'resumen' ? `${temaId}--resumen` : `${temaId}--${tipo}-${indice}`;
}

// ── Normalización y raíces ─────────────────────────────────

export function normalizar(texto: string): string {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

const STOPWORDS = new Set(
    (
        'a al algo algun alguna ante con como cual cuales cuando de del desde donde e el ella ellos en entre era es esa ese eso esta estan este esto ' +
        'hay la las le les lo los me mi mis muy ni no nos o otra otro para pero por porque pues que se ser si sin sobre son su sus tal tambien ' +
        'te ti tu tus un una uno unos unas y ya yo quiero necesito puedo puede debo hago hacer tengo tiene hay favor cosa forma manera'
    ).split(' '),
);

/** [sufijo, largo mínimo de lo que queda]. Del más largo al más corto. */
const SUFIJOS: [string, number][] = [
    ['amiento', 3], ['imiento', 3], ['atorio', 3], ['atoria', 3], ['ieron', 3], ['acion', 3], ['icion', 3],
    ['adora', 3], ['mente', 3], ['iendo', 3], ['aron', 3], ['aban', 3], ['ador', 3], ['ando', 3], ['aba', 3],
    ['ado', 3], ['ada', 3], ['ido', 3], ['ida', 3], ['an', 4], ['en', 4], ['ar', 3], ['er', 3], ['ir', 3],
    ['o', 3], ['a', 3], ['e', 3],
];

/**
 * Raíz de una palabra ya normalizada. Es deliberadamente simple: lo único que
 * importa es que la búsqueda y el texto se reduzcan igual («cupos» y «cupo»,
 * «cancelar» y «cancelación», «doctores» y «doctor»).
 */
export function raiz(palabra: string): string {
    if (palabra.length <= 3 || /\d/.test(palabra)) return palabra;
    let p = palabra;
    // Plurales.
    if (p.endsWith('ces') && p.length > 4) p = `${p.slice(0, -3)}z`;
    else if (p.endsWith('es') && p.length > 4 && 'rlndjz'.includes(p[p.length - 3])) p = p.slice(0, -2);
    else if (p.endsWith('s') && p.length > 3) p = p.slice(0, -1);
    // Derivados y formas verbales.
    for (const [sufijo, minimo] of SUFIJOS) {
        if (p.endsWith(sufijo) && p.length - sufijo.length >= minimo) return p.slice(0, -sufijo.length);
    }
    return p;
}

/** Palabras con significado (sin stopwords), normalizadas. */
function palabras(texto: string): string[] {
    return normalizar(texto)
        .split(' ')
        .filter((w) => w && !STOPWORDS.has(w));
}

// ── Sinónimos del oficio ───────────────────────────────────

const GRUPOS_SINONIMOS: string[][] = [
    ['cupo', 'slot', 'turno', 'horario', 'hueco', 'disponibilidad', 'espacio'],
    ['cita', 'turno', 'reserva'],
    ['agendar', 'reservar', 'programar', 'apartar'],
    ['cancelar', 'anular'],
    ['eliminar', 'borrar', 'quitar', 'suprimir', 'vaciar'],
    ['reprogramar', 'cambiar', 'mover', 'trasladar', 'reagendar', 'aplazar'],
    ['medico', 'doctor', 'especialista', 'profesional'],
    ['paciente', 'afiliado', 'ciudadano'],
    ['eps', 'aseguradora', 'convenio', 'entidad'],
    ['his', 'hospital'],
    ['espejo', 'sincronizacion', 'sincronizar', 'integracion'],
    ['bot', 'asistente', 'chatbot', 'robot'],
    ['whatsapp', 'wasap', 'guasap', 'wpp', 'whats'],
    ['ia', 'inteligencia', 'gemini', 'openai', 'chatgpt', 'claude', 'llm', 'modelo'],
    ['contrasena', 'clave', 'password', 'credencial'],
    ['correo', 'email', 'mail'],
    ['recordatorio', 'recordar', 'notificacion', 'notificar', 'alerta', 'aviso'],
    ['error', 'falla', 'fallo', 'problema', 'bug', 'incidente', 'funciona'],
    ['encuesta', 'csat', 'calificacion', 'opinion', 'satisfaccion', 'estrella'],
    ['padron', 'listado', 'censo'],
    ['archivo', 'csv', 'excel', 'xlsx', 'hoja'],
    ['reporte', 'informe', 'estadistica', 'metrica', 'indicador', 'grafica', 'analitica', 'kpi', 'cifra'],
    ['voz', 'audio', 'tts', 'sonido'],
    ['plantilla', 'template'],
    ['cedula', 'documento', 'identificacion', 'dni'],
    ['telefono', 'celular', 'numero', 'movil'],
    ['soporte', 'ayuda', 'ticket', 'solicitud'],
    ['auditoria', 'trazabilidad', 'registro', 'log', 'bitacora'],
    ['espera', 'cola', 'waitlist'],
    ['emergencia', 'urgencia'],
    ['buscar', 'encontrar', 'rastrear', 'localizar', 'investigar'],
    ['usuario', 'cuenta', 'acceso', 'login'],
    ['clonar', 'copiar', 'duplicar', 'replicar'],
    ['activar', 'encender', 'habilitar', 'prender'],
    ['desactivar', 'apagar', 'deshabilitar', 'inactivar', 'suspender', 'pausar'],
    ['crear', 'agregar', 'anadir', 'nuevo', 'registrar', 'alta'],
    ['editar', 'modificar', 'actualizar', 'corregir'],
    ['cargar', 'subir', 'importar'],
    ['servicio', 'especialidad'],
];

// ── Índice ─────────────────────────────────────────────────

type Campo = 'titulo' | 'tema' | 'claves' | 'texto';
const CAMPOS: Campo[] = ['titulo', 'tema', 'claves', 'texto'];
const PESOS: Record<Campo, number> = { titulo: 3, tema: 1.2, claves: 2, texto: 1 };
const K1 = 1.2;
const B = 0.75;

interface Documento {
    fragmento: Fragmento;
    tf: Record<Campo, Map<string, number>>;
    largo: Record<Campo, number>;
    /** Raíces de título, texto y claves en orden, para premiar palabras seguidas. */
    secuencia: string;
    tituloPlano: string;
    tituloRaices: Set<string>;
}

export interface IndiceAyuda {
    documentos: Documento[];
    df: Map<string, number>;
    /** Raíces del índice, para buscar por prefijo. */
    vocabulario: string[];
    /** Palabra normalizada → su raíz. Los errores de tipeo se miden contra la palabra entera. */
    palabrasPlanas: Map<string, string>;
    /** Palabra normalizada → como aparece escrita en la ayuda, con tildes (para «¿Quisiste decir…?»). */
    formaLegible: Map<string, string>;
    largoMedio: Record<Campo, number>;
    sinonimos: Map<string, Set<string>>;
}

export function fragmentosDe(temas: TemaAyuda[], glosario: TerminoGlosario[]): Fragmento[] {
    const fragmentos: Fragmento[] = [];
    for (const t of temas) {
        fragmentos.push({
            id: anclaDe(t.id, 'resumen'),
            temaId: t.id,
            tipo: 'resumen',
            titulo: t.titulo,
            texto: [t.resumen, t.paraQueSirve, t.disponibilidad].filter(Boolean).join(' '),
            claves: t.palabrasClave.join(' '),
        });
        t.guias.forEach((g, i) =>
            fragmentos.push({
                id: anclaDe(t.id, 'guia', i),
                temaId: t.id,
                tipo: 'guia',
                titulo: g.titulo,
                texto: [...g.pasos, g.nota].filter(Boolean).join(' '),
                claves: '',
            }),
        );
        t.elementos.forEach((e, i) =>
            fragmentos.push({ id: anclaDe(t.id, 'elemento', i), temaId: t.id, tipo: 'elemento', titulo: e.nombre, texto: e.explicacion, claves: '' }),
        );
        t.preguntas.forEach((p, i) =>
            fragmentos.push({ id: anclaDe(t.id, 'pregunta', i), temaId: t.id, tipo: 'pregunta', titulo: p.pregunta, texto: p.respuesta, claves: '' }),
        );
        t.problemas.forEach((p, i) =>
            fragmentos.push({ id: anclaDe(t.id, 'problema', i), temaId: t.id, tipo: 'problema', titulo: p.sintoma, texto: p.solucion, claves: '' }),
        );
    }
    glosario.forEach((g, i) =>
        fragmentos.push({
            id: anclaDe(GLOSARIO_ID, 'glosario', i),
            temaId: GLOSARIO_ID,
            tipo: 'glosario',
            titulo: g.termino,
            texto: g.definicion,
            claves: ['glosario', 'qué significa', ...(g.sinonimos ?? [])].join(' '),
        }),
    );
    return fragmentos;
}

export function crearIndice(temas: TemaAyuda[], glosario: TerminoGlosario[]): IndiceAyuda {
    const tituloDeTema = new Map(temas.map((t) => [t.id, t.titulo]));
    tituloDeTema.set(GLOSARIO_ID, 'Glosario');

    const df = new Map<string, number>();
    const palabrasPlanas = new Map<string, string>();
    const conteoForma = new Map<string, Map<string, number>>();
    const sumaLargos: Record<Campo, number> = { titulo: 0, tema: 0, claves: 0, texto: 0 };

    const registrarFormas = (texto: string) => {
        for (const original of texto.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
            const plano = normalizar(original);
            if (!plano || plano.includes(' ') || STOPWORDS.has(plano)) continue;
            palabrasPlanas.set(plano, raiz(plano));
            const formas = conteoForma.get(plano) ?? new Map<string, number>();
            formas.set(original, (formas.get(original) ?? 0) + 1);
            conteoForma.set(plano, formas);
        }
    };

    const documentos: Documento[] = fragmentosDe(temas, glosario).map((fragmento) => {
        const fuentes: Record<Campo, string> = {
            titulo: fragmento.titulo,
            tema: tituloDeTema.get(fragmento.temaId) ?? '',
            claves: fragmento.claves,
            texto: fragmento.texto,
        };
        const tf = {} as Record<Campo, Map<string, number>>;
        const largo = {} as Record<Campo, number>;
        const vistas = new Set<string>();
        const porCampo = {} as Record<Campo, string[]>;
        for (const campo of CAMPOS) {
            const raices = palabras(fuentes[campo]).map(raiz);
            porCampo[campo] = raices;
            const mapa = new Map<string, number>();
            for (const r of raices) {
                mapa.set(r, (mapa.get(r) ?? 0) + 1);
                vistas.add(r);
            }
            tf[campo] = mapa;
            largo[campo] = raices.length;
            sumaLargos[campo] += raices.length;
        }
        for (const r of vistas) df.set(r, (df.get(r) ?? 0) + 1);
        registrarFormas(`${fragmento.titulo} ${fragmento.texto} ${fragmento.claves}`);
        return {
            fragmento,
            tf,
            largo,
            // `|` separa los campos: dos palabras seguidas tienen que estar en el mismo.
            secuencia: ` ${porCampo.titulo.join(' ')} | ${porCampo.texto.join(' ')} | ${porCampo.claves.join(' ')} `,
            tituloPlano: normalizar(fragmento.titulo),
            tituloRaices: new Set(porCampo.titulo),
        };
    });

    const n = Math.max(documentos.length, 1);
    const largoMedio = Object.fromEntries(CAMPOS.map((c) => [c, Math.max(sumaLargos[c] / n, 1)])) as Record<Campo, number>;

    const formaLegible = new Map<string, string>();
    for (const [plano, formas] of conteoForma) {
        formaLegible.set(plano, [...formas.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    }

    const sinonimos = new Map<string, Set<string>>();
    for (const grupo of GRUPOS_SINONIMOS) {
        const raices = grupo.map((w) => raiz(normalizar(w)));
        for (const r of raices) {
            const set = sinonimos.get(r) ?? new Set<string>();
            for (const otra of raices) if (otra !== r) set.add(otra);
            sinonimos.set(r, set);
        }
    }

    return { documentos, df, vocabulario: [...df.keys()], palabrasPlanas, formaLegible, largoMedio, sinonimos };
}

// ── Distancia de edición (con transposición: «padorn» → «padron») ──

export function distancia(a: string, b: string, tope: number): number {
    if (Math.abs(a.length - b.length) > tope) return tope + 1;
    const filas = a.length + 1;
    const cols = b.length + 1;
    const d: number[][] = Array.from({ length: filas }, (_, i) => {
        const fila = new Array<number>(cols).fill(0);
        fila[0] = i;
        return fila;
    });
    for (let j = 0; j < cols; j++) d[0][j] = j;
    for (let i = 1; i < filas; i++) {
        let minFila = Infinity;
        for (let j = 1; j < cols; j++) {
            const costo = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
            minFila = Math.min(minFila, d[i][j]);
        }
        if (minFila > tope) return tope + 1;
    }
    return d[a.length][b.length];
}

/** Errores tolerados según el largo: las palabras cortas tienen que estar bien escritas. */
function topeDeErrores(largo: number): number {
    if (largo <= 3) return 0;
    if (largo <= 6) return 1;
    return 2;
}

// ── Búsqueda ───────────────────────────────────────────────

interface Variante {
    raiz: string;
    peso: number;
}

/** Lo que se considera que coincide con una palabra buscada, y cuánto vale. */
function variantes(indice: IndiceAyuda, palabra: string): Variante[] {
    const r = raiz(palabra);
    const mapa = new Map<string, number>();
    const poner = (v: string, peso: number) => {
        if ((mapa.get(v) ?? 0) < peso) mapa.set(v, peso);
    };

    const exacta = indice.df.has(r);
    if (exacta) poner(r, 1);
    for (const s of indice.sinonimos.get(r) ?? []) if (indice.df.has(s)) poner(s, 0.6);

    // Mientras se escribe: «homolo» ya debe encontrar «homologar».
    if (palabra.length >= 3) {
        let prefijos = 0;
        for (const v of indice.vocabulario) {
            if (v !== r && (v.startsWith(palabra) || v.startsWith(r)) && prefijos < 40) {
                poner(v, 0.7);
                prefijos++;
            }
        }
    }

    // Errores de tipeo: solo si la palabra, tal cual, no está en la ayuda. Se
    // mide contra la palabra entera, no contra la raíz: «recordatrio» está a un
    // error de «recordatorio», pero a cuatro de su raíz «record».
    if (!exacta) {
        const tope = topeDeErrores(palabra.length);
        if (tope > 0) {
            for (const [plana, raizPlana] of indice.palabrasPlanas) {
                const d = distancia(palabra, plana, tope);
                if (d <= tope) {
                    poner(raizPlana, d === 1 ? 0.6 : 0.4);
                    for (const s of indice.sinonimos.get(raizPlana) ?? []) if (indice.df.has(s)) poner(s, 0.35);
                }
            }
        }
    }
    return [...mapa.entries()].map(([raizVariante, peso]) => ({ raiz: raizVariante, peso }));
}

function bm25(tf: number, largo: number, medio: number): number {
    return (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * largo) / medio));
}

export function buscar(indice: IndiceAyuda, consulta: string, limite = 30): RespuestaBusqueda {
    const buscadas = palabras(consulta);
    if (buscadas.length === 0) return { resultados: [], terminos: [] };

    const grupos = buscadas.map((p) => variantes(indice, p));
    const n = indice.documentos.length;
    const idf = (r: string) => {
        const f = indice.df.get(r) ?? 0;
        return Math.log(1 + (n - f + 0.5) / (f + 0.5));
    };
    const raicesBuscadas = buscadas.map(raiz);
    const pares = raicesBuscadas.slice(1).map((r, i) => ` ${raicesBuscadas[i]} ${r} `);
    const consultaPlana = normalizar(consulta);

    const puntuados: { doc: Documento; puntaje: number; coincidencias: Set<string> }[] = [];
    for (const doc of indice.documentos) {
        let total = 0;
        let cubiertas = 0;
        const coincidencias = new Set<string>();
        for (const grupo of grupos) {
            let mejor = 0;
            for (const v of grupo) {
                let suma = 0;
                for (const campo of CAMPOS) {
                    const tf = doc.tf[campo].get(v.raiz);
                    if (tf) suma += PESOS[campo] * bm25(tf, doc.largo[campo], indice.largoMedio[campo]);
                }
                if (suma > 0) {
                    coincidencias.add(v.raiz);
                    mejor = Math.max(mejor, v.peso * idf(v.raiz) * suma);
                }
            }
            if (mejor > 0) {
                cubiertas++;
                total += mejor;
            }
        }
        if (cubiertas === 0) continue;

        let puntaje = total * (cubiertas / grupos.length) ** 2;
        // Palabras seguidas, como se buscaron: «cambiar contraseña», «no llegó al hospital».
        for (const par of pares) if (doc.secuencia.includes(par)) puntaje *= 1.4;
        // El resumen es la mejor puerta a un tema; y buscar el nombre de una
        // opción del menú lleva a él.
        if (doc.fragmento.tipo === 'resumen') {
            puntaje *= 1.2;
            if (doc.tituloPlano === consultaPlana || doc.tituloPlano.startsWith(`${consultaPlana} `)) puntaje *= 3;
            else if (raicesBuscadas.every((r) => doc.tituloRaices.has(r))) puntaje *= 2;
        }
        if (doc.fragmento.tipo === 'glosario' && doc.tituloPlano === consultaPlana) puntaje *= 2;
        puntuados.push({ doc, puntaje, coincidencias });
    }

    puntuados.sort((a, b) => b.puntaje - a.puntaje);
    const corte = (puntuados[0]?.puntaje ?? 0) * 0.15;
    const elegidos = puntuados.filter((p) => p.puntaje >= corte).slice(0, limite);

    const terminos = new Set<string>();
    for (const e of elegidos) for (const t of e.coincidencias) terminos.add(t);

    return {
        resultados: elegidos.map(({ doc, puntaje, coincidencias }) => ({
            fragmento: doc.fragmento,
            puntaje,
            titulo: resaltar(doc.fragmento.titulo, coincidencias),
            extracto: extracto(doc.fragmento.texto, coincidencias),
        })),
        terminos: [...terminos],
    };
}

/**
 * «¿Quisiste decir…?»: cambia cada palabra que no está en la ayuda por la más
 * parecida que sí está. null si no hay nada que corregir.
 */
export function sugerir(indice: IndiceAyuda, consulta: string): string | null {
    const buscadas = palabras(consulta);
    let cambio = false;
    const corregidas = buscadas.map((p) => {
        if (indice.df.has(raiz(p))) return indice.formaLegible.get(p) ?? p;
        const tope = p.length >= 4 ? 2 : topeDeErrores(p.length);
        let mejor: { palabra: string; d: number; df: number } | null = null;
        for (const [plana, raizPlana] of indice.palabrasPlanas) {
            const d = distancia(p, plana, tope);
            if (d > tope) continue;
            const f = indice.df.get(raizPlana) ?? 0;
            if (!mejor || d < mejor.d || (d === mejor.d && f > mejor.df)) mejor = { palabra: plana, d, df: f };
        }
        if (!mejor) return p;
        cambio = true;
        return indice.formaLegible.get(mejor.palabra) ?? mejor.palabra;
    });
    return cambio ? corregidas.join(' ') : null;
}

// ── Resaltado ──────────────────────────────────────────────

/** Parte el texto en trozos y marca las palabras cuya raíz está en `terminos`. */
export function resaltar(texto: string, terminos: Iterable<string>): Segmento[] {
    const set = terminos instanceof Set ? (terminos as Set<string>) : new Set(terminos);
    if (set.size === 0) return [{ texto, marcado: false }];
    const segmentos: Segmento[] = [];
    let ultimo = 0;
    for (const m of texto.matchAll(/[\p{L}\p{N}]+/gu)) {
        const plano = normalizar(m[0]);
        if (!plano || STOPWORDS.has(plano) || !set.has(raiz(plano))) continue;
        const inicio = m.index ?? 0;
        if (inicio > ultimo) segmentos.push({ texto: texto.slice(ultimo, inicio), marcado: false });
        segmentos.push({ texto: m[0], marcado: true });
        ultimo = inicio + m[0].length;
    }
    if (ultimo < texto.length) segmentos.push({ texto: texto.slice(ultimo), marcado: false });
    return segmentos;
}

/** Un pedazo del texto (unas 28 palabras) centrado donde más coincidencias hay. */
export function extracto(texto: string, terminos: Set<string>, palabrasMax = 28): Segmento[] {
    const tokens = [...texto.matchAll(/\S+/g)];
    if (tokens.length <= palabrasMax) return resaltar(texto, terminos);

    const marca = tokens.map((t) => {
        const plano = normalizar(t[0]);
        return plano.split(' ').some((w) => w && terminos.has(raiz(w))) ? 1 : 0;
    });
    let mejorInicio = 0;
    let mejorSuma = -1;
    let suma = 0;
    for (let i = 0; i < tokens.length; i++) {
        suma += marca[i];
        if (i >= palabrasMax) suma -= marca[i - palabrasMax];
        const inicio = Math.max(0, i - palabrasMax + 1);
        if (i >= palabrasMax - 1 && suma > mejorSuma) {
            mejorSuma = suma;
            mejorInicio = inicio;
        }
    }
    // Un poco de contexto antes de la primera coincidencia.
    const primera = marca.indexOf(1, mejorInicio);
    if (primera > mejorInicio + 4) mejorInicio = Math.max(0, primera - 4);
    const fin = Math.min(tokens.length, mejorInicio + palabrasMax);
    const desde = tokens[mejorInicio].index ?? 0;
    const hasta = fin >= tokens.length ? texto.length : (tokens[fin - 1].index ?? 0) + tokens[fin - 1][0].length;

    const segmentos = resaltar(texto.slice(desde, hasta), terminos);
    if (mejorInicio > 0) segmentos.unshift({ texto: '… ', marcado: false });
    if (fin < tokens.length) segmentos.push({ texto: ' …', marcado: false });
    return segmentos;
}
