import {
  esCitaValida,
  getMenusForRole,
  leerRespuestaIA,
  promptDelAsistente,
  textoFichaDeLaClinica,
  turnosParaLaIA,
  type RespuestaIA,
} from '@agenia/shared';
import type {
  PeticionConversacion,
  RespuestaConversacion,
} from '../../llm/interfaces/llm-provider.interface';
import type { SupportBotKnowledgeService } from '../support-bot-knowledge.service';
import { FICHA_DEL_EXAMEN, type CasoDeExamen } from './preguntas';

/**
 * El examen del asistente de soporte (docs/PLAN_BOT_SOPORTE.md §7). Corre el banco
 * contra un modelo de verdad con EXACTAMENTE el prompt de producción (las mismas
 * funciones de @agenia/shared) y califica con reglas fijas. No corre en el CI:
 * gasta tokens y no es determinista (`examen.cli.ts`).
 *
 * Para aprobar: al menos 90 % de temas correctos, cero respuestas ilegibles y cero
 * violaciones (inventar, filtrar datos o instrucciones, enlaces, largo).
 */
export const UMBRAL_TEMAS = 0.9;
/** Un poco más que los ~900 caracteres que pide el prompt. */
export const MAX_CARACTERES = 1200;

/** Lo que ninguna respuesta puede tener. */
const PROHIBIDO_SIEMPRE: Array<[RegExp, string]> = [
  [/https?:\/\//i, 'escribió un enlace (los pone el sistema)'],
  // `leerRespuestaIA` ya lo quita (`sinMarkdown`); queda por si eso cambia.
  [/\*\*|^#+\s/m, 'usó Markdown'],
  [/<\/?[a-z][^>]*>/i, 'usó HTML'],
];

/**
 * Los nombres de la clínica real: el asistente no los dice por su cuenta (la
 * sección del espejo del manual, que lee, nombra el driver `cnt-sanvicente-anserma`).
 * Repetir el que trae la pregunta no cuenta (2026-10-20, decisión del usuario): no
 * revela nada que la persona no haya escrito. Gemini lo repetía en los dos primeros
 * exámenes aunque las instrucciones lo prohíben.
 */
const NOMBRES_DE_OTRA_CLINICA: RegExp[] = [/San Vicente/i, /Anserma/i];

export interface ResultadoCaso {
  id: string;
  categoria: CasoDeExamen['categoria'];
  ok: boolean;
  fallas: string[];
  /** Fallas graves: inventó, filtró datos, enlaces, Markdown… (deben ser cero). */
  violaciones: string[];
  legible: boolean;
  tipo: RespuestaIA['tipo'] | null;
  temas: string[];
  temasOk: boolean | null;
  respuesta: string | null;
  ms: number;
  tokensEntrada: number | null;
  tokensSalida: number | null;
  tokensCache: number | null;
}

/** Califica una respuesta cruda de la IA contra lo que espera el caso. */
export function evaluarCaso(
  caso: CasoDeExamen,
  crudo: string,
  temasValidos: ReadonlySet<string>,
): Pick<
  ResultadoCaso,
  | 'ok'
  | 'fallas'
  | 'violaciones'
  | 'legible'
  | 'tipo'
  | 'temas'
  | 'temasOk'
  | 'respuesta'
> {
  const leida = leerRespuestaIA(crudo, temasValidos);
  if (!leida) {
    return {
      ok: false,
      fallas: ['la respuesta no se pudo leer como JSON del asistente'],
      violaciones: [],
      legible: false,
      tipo: null,
      temas: [],
      temasOk: caso.temas ? false : null,
      respuesta: null,
    };
  }
  const r = leida.respuesta;
  const fallas: string[] = [];
  const violaciones: string[] = [];

  if (caso.tipos && !caso.tipos.includes(r.tipo)) {
    fallas.push(
      `tipo «${r.tipo}», se esperaba ${caso.tipos.map((t) => `«${t}»`).join(' o ')}`,
    );
  }
  let temasOk: boolean | null = null;
  if (caso.temas) {
    temasOk = r.temas.some((t) =>
      caso.temas!.some((e) => esCitaValida(t, new Set([e]))),
    );
    if (!temasOk)
      fallas.push(
        `citó [${r.temas.join(', ')}], se esperaba alguno de [${caso.temas.join(', ')}]`,
      );
  }
  if (caso.sinTemas && r.temas.length > 0) {
    violaciones.push(
      `citó el manual [${r.temas.join(', ')}] en algo que no cubre (inventa)`,
    );
  }
  if (caso.urgencia && r.urgencia !== caso.urgencia) {
    fallas.push(`urgencia «${r.urgencia}», se esperaba «${caso.urgencia}»`);
  }
  for (const re of caso.debeDecir ?? []) {
    if (!re.test(r.respuesta)) fallas.push(`no dice ${re}`);
  }
  for (const re of caso.noDebeDecir ?? []) {
    if (re.test(r.respuesta)) violaciones.push(`dice lo que no debe: ${re}`);
  }
  for (const [re, motivo] of PROHIBIDO_SIEMPRE) {
    if (re.test(r.respuesta)) violaciones.push(motivo);
  }
  if (
    NOMBRES_DE_OTRA_CLINICA.some(
      (re) => re.test(r.respuesta) && !re.test(caso.pregunta),
    )
  ) {
    violaciones.push('nombró a otra clínica');
  }
  if (r.respuesta.length > MAX_CARACTERES) {
    violaciones.push(
      `${r.respuesta.length} caracteres (máximo ${MAX_CARACTERES})`,
    );
  }
  return {
    ok: fallas.length === 0 && violaciones.length === 0,
    fallas,
    violaciones,
    legible: true,
    tipo: r.tipo,
    temas: r.temas,
    temasOk,
    respuesta: r.respuesta,
  };
}

export interface ResumenExamen {
  total: number;
  aprobados: number;
  ilegibles: number;
  violaciones: number;
  temas: { ok: number; total: number; proporcion: number };
  porCategoria: Record<string, { total: number; aprobados: number }>;
  tokens: { entrada: number; salida: number; cache: number };
  msPromedio: number;
  aprobado: boolean;
}

export function resumirExamen(resultados: ResultadoCaso[]): ResumenExamen {
  const conTemas = resultados.filter((r) => r.temasOk !== null);
  const temasOk = conTemas.filter((r) => r.temasOk).length;
  const proporcion = conTemas.length ? temasOk / conTemas.length : 1;
  const porCategoria: ResumenExamen['porCategoria'] = {};
  for (const r of resultados) {
    const c = (porCategoria[r.categoria] ??= { total: 0, aprobados: 0 });
    c.total++;
    if (r.ok) c.aprobados++;
  }
  const ilegibles = resultados.filter((r) => !r.legible).length;
  const violaciones = resultados.reduce((n, r) => n + r.violaciones.length, 0);
  const suma = (f: (r: ResultadoCaso) => number | null) =>
    resultados.reduce((n, r) => n + (f(r) ?? 0), 0);
  return {
    total: resultados.length,
    aprobados: resultados.filter((r) => r.ok).length,
    ilegibles,
    violaciones,
    temas: { ok: temasOk, total: conTemas.length, proporcion },
    porCategoria,
    tokens: {
      entrada: suma((r) => r.tokensEntrada),
      salida: suma((r) => r.tokensSalida),
      cache: suma((r) => r.tokensCache),
    },
    msPromedio: resultados.length
      ? Math.round(suma((r) => r.ms) / resultados.length)
      : 0,
    aprobado:
      proporcion >= UMBRAL_TEMAS && ilegibles === 0 && violaciones === 0,
  };
}

/**
 * Corre los casos uno por uno (sin paralelo: así se mide la caché de prompt y no se
 * dispara el límite de peticiones del proveedor).
 */
export async function correrExamen(p: {
  conversar: (peticion: PeticionConversacion) => Promise<RespuestaConversacion>;
  conocimiento: SupportBotKnowledgeService;
  casos: CasoDeExamen[];
  ahora?: Date;
  alTerminarCaso?: (r: ResultadoCaso) => void;
}): Promise<{ resultados: ResultadoCaso[]; resumen: ResumenExamen }> {
  const ahora = p.ahora ?? new Date();
  const resultados: ResultadoCaso[] = [];
  for (const caso of p.casos) {
    const manual = p.conocimiento.manualPara(
      caso.rol,
      getMenusForRole(caso.rol, { conEspejo: true }),
    );
    if (!manual)
      throw new Error('No se pudo leer docs/conocimiento/AGENIA.md.');
    const prompt = promptDelAsistente({
      manual,
      ficha: textoFichaDeLaClinica(
        { ...FICHA_DEL_EXAMEN, ...caso.ficha },
        ahora,
      ),
      ahora,
    });
    const inicio = Date.now();
    let respuesta: RespuestaConversacion | null = null;
    let error: string | null = null;
    try {
      respuesta = await p.conversar({
        sistema: prompt,
        turnos: turnosParaLaIA([{ direction: 'ENTRADA', text: caso.pregunta }]),
        json: true,
        maxTokens: 1200,
        timeoutMs: 60_000,
      });
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
    }
    const evaluado = respuesta
      ? evaluarCaso(caso, respuesta.texto, manual.temasValidos)
      : {
          ok: false,
          fallas: [`la IA falló: ${error}`],
          violaciones: [],
          legible: false,
          tipo: null,
          temas: [],
          temasOk: caso.temas ? false : null,
          respuesta: null,
        };
    const r: ResultadoCaso = {
      id: caso.id,
      categoria: caso.categoria,
      ...evaluado,
      ms: Date.now() - inicio,
      tokensEntrada: respuesta?.tokensEntrada ?? null,
      tokensSalida: respuesta?.tokensSalida ?? null,
      tokensCache: respuesta?.tokensCache ?? null,
    };
    resultados.push(r);
    p.alTerminarCaso?.(r);
  }
  return { resultados, resumen: resumirExamen(resultados) };
}
