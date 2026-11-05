import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LIMITES_TEXTO,
  TIPOS_DE_COLUMNA,
  leerMapeoDeIa,
  textoParaEnviar,
  type TipoColumna,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LlmFactoryService } from '../llm/llm-factory.service';
import type { LLMProvider } from '../llm/interfaces/llm-provider.interface';
import { getErrorMessage } from '../common/error-message.util';

// ─── Lo que devuelve cada revisión ──────────────────────────────────────────

export interface ProblemaTextoIa {
  tipo: string;
  gravedad: 'alta' | 'media' | 'baja';
  fragmento: string;
  sugerencia: string;
  explicacion: string;
  /** El fragmento está tal cual en el texto: la pantalla puede reemplazarlo. */
  aplicable: boolean;
}

export interface RevisionTextoIa {
  disponible: true;
  modelo: string;
  puntaje: number;
  resumen: string;
  tono: string;
  problemas: ProblemaTextoIa[];
  /** El texto completo corregido, ya en un párrafo y dentro del largo; `null` si es igual o no sirve. */
  textoSugerido: string | null;
}

export interface RevisionImagenIa {
  disponible: true;
  modelo: string;
  puntaje: number;
  resumen: string;
  textoEnImagen: string | null;
  legibilidad: 'buena' | 'regular' | 'mala' | 'sin_texto';
  erroresEnLaImagen: string[];
  datosPersonales: boolean;
  detalleDatosPersonales: string | null;
  contenidoInadecuado: boolean;
  detalleInadecuado: string | null;
  coherenciaConElMensaje: 'alta' | 'media' | 'baja' | 'sin_mensaje';
  recomendaciones: string[];
}

export type SinIa = { disponible: false; motivo: string };

// ─── Instrucciones ──────────────────────────────────────────────────────────

const PROMPT_TEXTO = `Eres corrector de estilo de una clínica de salud en Colombia. Revisas un comunicado que se enviará por WhatsApp a muchos pacientes a la vez: un error se repite en cientos de teléfonos y no se puede borrar.

Revisa:
- ortografía (tildes, mayúsculas, puntuación) y gramática (concordancia, tiempos verbales);
- claridad: que se entienda qué pasa, cuándo, dónde y qué tiene que hacer la persona;
- tono: respetuoso, cálido y de usted; sin presión, sin alarmismo, sin regaños;
- palabras inadecuadas, ofensivas, discriminatorias o demasiado informales;
- privacidad: que no traiga datos de salud ni datos personales de nadie;
- afirmaciones médicas dudosas o promesas que la clínica no pueda cumplir;
- datos que falten (una fecha sin hora, un lugar sin dirección, un trámite sin decir qué llevar).

Reglas del texto: va en UN solo párrafo (WhatsApp no deja saltos de línea dentro de la plantilla), máximo ${LIMITES_TEXTO.maximo} caracteres, y la plantilla ya saluda a cada persona por su nombre antes del texto.
No cambies los datos (fechas, horas, lugares, teléfonos, enlaces, nombres propios, cifras) y no inventes información.

Responde SOLO un JSON, sin texto alrededor, con esta forma:
{"puntaje": 0-100, "resumen": "una frase sobre el texto", "tono": "adecuado|informal|frio|agresivo|alarmista|confuso", "problemas": [{"tipo": "ortografia|gramatica|claridad|tono|inadecuado|privacidad|dato_faltante|otro", "gravedad": "alta|media|baja", "fragmento": "el pedazo EXACTO, copiado letra por letra del mensaje", "sugerencia": "cómo debe quedar ese pedazo", "explicacion": "por qué, en una frase"}], "textoSugerido": "el mensaje completo ya corregido, en un solo párrafo"}
Si el mensaje está bien, "problemas" va vacío y "textoSugerido" es igual al original.`;

const PROMPT_IMAGEN = `Revisas la imagen que una clínica de salud en Colombia enviará por WhatsApp, como encabezado de un comunicado, a muchos pacientes a la vez.

Evalúa:
- si el texto que hay dentro de la imagen se puede leer en la pantalla de un celular (tamaño de letra y contraste);
- errores de ortografía o de datos en ese texto;
- si muestra datos personales: nombres o documentos de pacientes, rostros de pacientes que se puedan reconocer, historias clínicas, fórmulas, resultados;
- contenido inadecuado: violento, sexual, discriminatorio, alarmista o que pueda asustar;
- si concuerda con el mensaje que la acompaña;
- si lo importante está en el centro (en la conversación WhatsApp puede recortar los bordes de arriba y abajo);
- la calidad: borrosa, pixelada, con marcas de agua de otros, una captura de pantalla.

Responde SOLO un JSON, sin texto alrededor, con esta forma:
{"puntaje": 0-100, "resumen": "una frase", "textoEnImagen": "el texto que se lee en la imagen, o null", "legibilidad": "buena|regular|mala|sin_texto", "erroresEnLaImagen": ["..."], "datosPersonales": true, "detalleDatosPersonales": "qué datos, o null", "contenidoInadecuado": false, "detalleInadecuado": "qué, o null", "coherenciaConElMensaje": "alta|media|baja|sin_mensaje", "recomendaciones": ["consejos concretos, máximo 5"]}`;

const PROMPT_COLUMNAS = `Recibes los encabezados y unas filas de ejemplo de un archivo de contactos de pacientes de una clínica en Colombia. Los dígitos y los correos vienen tapados con «•»: reconoce cada columna por su forma.

Di qué es cada columna. Tipos posibles:
${TIPOS_DE_COLUMNA.map((t) => `- ${t.tipo}: ${t.etiqueta}`).join('\n')}

Reglas: una sola columna CELULAR (la que más probablemente sea el celular con WhatsApp: 10 dígitos que empiezan por 3, o con +indicativo); los demás teléfonos son TELEFONO. DOCUMENTO es la cédula o la tarjeta de identidad. Usa NOMBRES y APELLIDOS si vienen en columnas separadas, y NOMBRE_COMPLETO si van juntos. Lo que sirva pero no sea de contacto (EPS, ciudad, sede) es OTRO; lo vacío o sin valor, IGNORAR.

Responde SOLO un JSON, sin texto alrededor: {"columnas": [{"indice": 0, "tipo": "CELULAR", "razon": "por qué, en pocas palabras"}]}`;

// ─── Lectura de las respuestas ──────────────────────────────────────────────

/** El primer objeto JSON de la respuesta (los modelos a veces lo envuelven en ```json). */
export function primerJson(texto: string): unknown {
  const limpio = (texto ?? '').replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(limpio);
  } catch {
    const ini = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (ini === -1 || fin <= ini) return null;
    try {
      return JSON.parse(limpio.slice(ini, fin + 1));
    } catch {
      return null;
    }
  }
}

const texto = (v: unknown, max = 600): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const lista = (v: unknown, max = 6): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => texto(x, 300))
        .filter((x): x is string => !!x)
        .slice(0, max)
    : [];
const puntaje = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
};
const unoDe = <T extends string>(
  v: unknown,
  opciones: readonly T[],
  porDefecto: T,
): T => {
  const t = typeof v === 'string' ? v.toLowerCase() : '';
  return opciones.includes(t as T) ? (t as T) : porDefecto;
};

/** Valida la revisión del texto: lo que no casa con el mensaje se marca como no aplicable. */
export function leerRevisionTexto(
  json: unknown,
  original: string,
  modelo: string,
): RevisionTextoIa {
  const o = (json ?? {}) as Record<string, unknown>;
  const problemas: ProblemaTextoIa[] = (
    Array.isArray(o.problemas) ? o.problemas : []
  )
    .slice(0, 15)
    .map((p) => {
      const x = (p ?? {}) as Record<string, unknown>;
      const fragmento = texto(x.fragmento, 300) ?? '';
      const sugerencia = texto(x.sugerencia, 300) ?? '';
      return {
        tipo: texto(x.tipo, 40) ?? 'otro',
        gravedad: unoDe(
          x.gravedad,
          ['alta', 'media', 'baja'] as const,
          'media',
        ),
        fragmento,
        sugerencia,
        explicacion: texto(x.explicacion, 300) ?? '',
        aplicable:
          !!fragmento &&
          !!sugerencia &&
          fragmento !== sugerencia &&
          original.includes(fragmento),
      };
    })
    .filter((p) => p.fragmento || p.explicacion);
  const crudo = texto(o.textoSugerido, 2000);
  const sugerido = crudo ? textoParaEnviar(crudo) : null;
  return {
    disponible: true,
    modelo,
    puntaje: puntaje(o.puntaje),
    resumen: texto(o.resumen, 300) ?? '',
    tono: texto(o.tono, 30) ?? 'adecuado',
    problemas,
    textoSugerido:
      sugerido &&
      sugerido !== textoParaEnviar(original) &&
      sugerido.length <= LIMITES_TEXTO.maximo
        ? sugerido
        : null,
  };
}

export function leerRevisionImagen(
  json: unknown,
  modelo: string,
): RevisionImagenIa {
  const o = (json ?? {}) as Record<string, unknown>;
  return {
    disponible: true,
    modelo,
    puntaje: puntaje(o.puntaje),
    resumen: texto(o.resumen, 300) ?? '',
    textoEnImagen: texto(o.textoEnImagen, 600),
    legibilidad: unoDe(
      o.legibilidad,
      ['buena', 'regular', 'mala', 'sin_texto'] as const,
      'regular',
    ),
    erroresEnLaImagen: lista(o.erroresEnLaImagen),
    datosPersonales: o.datosPersonales === true,
    detalleDatosPersonales: texto(o.detalleDatosPersonales, 300),
    contenidoInadecuado: o.contenidoInadecuado === true,
    detalleInadecuado: texto(o.detalleInadecuado, 300),
    coherenciaConElMensaje: unoDe(
      o.coherenciaConElMensaje,
      ['alta', 'media', 'baja', 'sin_mensaje'] as const,
      'sin_mensaje',
    ),
    recomendaciones: lista(o.recomendaciones, 5),
  };
}

/** Lo más pesado que se le manda a la IA (Claude acepta hasta 5 MB en base64). */
const MAX_BYTES_IMAGEN_IA = 3.5 * 1024 * 1024;

/**
 * 📢 La revisión con IA de Mensajes masivos (docs/PLAN_MENSAJES_MASIVOS.md §6 y
 * §7), con el proveedor de IA de la clínica: el mapeo de columnas de un archivo
 * de contactos (solo encabezados y 5 filas tapadas), la redacción del texto y la
 * imagen. Sin proveedor configurado devuelve `{ disponible: false }`: la pantalla
 * sigue con las reglas sin IA.
 */
@Injectable()
export class MassMessageAiService {
  private readonly logger = new Logger(MassMessageAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmFactoryService,
  ) {}

  async disponible(organizationId: string): Promise<boolean> {
    return !!(await this.proveedor(organizationId));
  }

  private async proveedor(organizationId: string): Promise<LLMProvider | null> {
    try {
      return await this.llm.forOrgOrNull(organizationId);
    } catch {
      return null;
    }
  }

  private async preguntar(
    organizationId: string,
    sistema: string,
    pregunta: string,
    imagen?: { base64: string; mimeType: string },
  ): Promise<{ json: unknown; modelo: string } | SinIa> {
    const ia = await this.proveedor(organizationId);
    if (!ia) {
      return {
        disponible: false,
        motivo:
          'La clínica no tiene la IA configurada (Configuración → Integración de IA): se revisa solo con las reglas.',
      };
    }
    try {
      const r = await ia.conversar({
        sistema: { fijo: sistema, variable: '' },
        turnos: [
          { rol: 'usuario', texto: pregunta, ...(imagen ? { imagen } : {}) },
        ],
        json: true,
        maxTokens: 2000,
        timeoutMs: 60_000,
      });
      const json = primerJson(r.texto);
      if (!json)
        throw new Error(`respuesta sin JSON: ${r.texto.slice(0, 200)}`);
      return { json, modelo: r.modelo };
    } catch (error: unknown) {
      this.logger.warn(
        `Revisión con IA (org ${organizationId}, ${ia.name}): ${getErrorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        'La IA no respondió. Inténtelo de nuevo en un momento; mientras tanto, las reglas sin IA siguen revisando.',
      );
    }
  }

  async mapearColumnas(
    organizationId: string,
    muestra: { encabezados: string[]; filas: string[][] },
  ): Promise<
    { disponible: true; modelo: string; mapeo: TipoColumna[] } | SinIa
  > {
    const columnas = Math.min(40, muestra.encabezados?.length ?? 0);
    if (!columnas)
      throw new BadRequestException('No hay columnas que revisar.');
    const datos = {
      encabezados: muestra.encabezados
        .slice(0, columnas)
        .map((e) => String(e ?? '').slice(0, 60)),
      filas: (muestra.filas ?? [])
        .slice(0, 5)
        .map((f) =>
          (Array.isArray(f) ? f : [])
            .slice(0, columnas)
            .map((c) => String(c ?? '').slice(0, 60)),
        ),
    };
    const r = await this.preguntar(
      organizationId,
      PROMPT_COLUMNAS,
      JSON.stringify(datos),
    );
    if ('disponible' in r) return r;
    const mapeo = leerMapeoDeIa(r.json, columnas);
    if (!mapeo)
      throw new ServiceUnavailableException(
        'La IA no propuso un mapeo que sirva. Ajuste las columnas a mano.',
      );
    return { disponible: true, modelo: r.modelo, mapeo };
  }

  async revisarTexto(
    organizationId: string,
    mensaje: string,
  ): Promise<RevisionTextoIa | SinIa> {
    const t = (mensaje ?? '').trim();
    if (!t)
      throw new BadRequestException('Escriba el mensaje antes de revisarlo.');
    if (t.length > 3000)
      throw new BadRequestException(
        'El texto es demasiado largo para revisarlo.',
      );
    const r = await this.preguntar(
      organizationId,
      PROMPT_TEXTO,
      `Mensaje a revisar:\n${t}`,
    );
    if ('disponible' in r) return r;
    return leerRevisionTexto(r.json, t, r.modelo);
  }

  async revisarImagen(
    organizationId: string,
    campaignId: string,
  ): Promise<RevisionImagenIa | SinIa> {
    const envio = await this.prisma.massCampaign.findFirst({
      where: { id: campaignId, organizationId },
      select: {
        imageData: true,
        imageMime: true,
        imageBytes: true,
        messageText: true,
      },
    });
    if (!envio) throw new NotFoundException('Envío no encontrado.');
    if (!envio.imageData || !envio.imageMime)
      throw new BadRequestException('Este envío no tiene imagen.');
    if ((envio.imageBytes ?? envio.imageData.length) > MAX_BYTES_IMAGEN_IA) {
      throw new BadRequestException(
        'La imagen pesa demasiado para revisarla con IA: use «Optimizar» primero.',
      );
    }
    const mensaje = textoParaEnviar(envio.messageText);
    const pregunta = mensaje
      ? `El mensaje que acompaña la imagen es: «${mensaje}»`
      : 'Todavía no hay mensaje escrito: evalúa la imagen sola y usa "sin_mensaje" en la coherencia.';
    const r = await this.preguntar(organizationId, PROMPT_IMAGEN, pregunta, {
      base64: Buffer.from(envio.imageData).toString('base64'),
      mimeType: envio.imageMime,
    });
    if ('disponible' in r) return r;
    const revision = leerRevisionImagen(r.json, r.modelo);
    await this.prisma.massCampaign.update({
      where: { id: campaignId },
      data: {
        imageReview: {
          ia: revision,
          revisadaEn: new Date().toISOString(),
        } as object,
      },
    });
    return revision;
  }
}
