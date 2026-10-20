import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import {
  armarManualDelAsistente,
  buscar,
  crearIndice,
  parsearConocimiento,
  type ContenidoAyuda,
  type IndiceAyuda,
  type ManualDelAsistente,
  type MenuItem,
  type ResultadoDelManual,
  type UserRole,
} from '@agenia/shared';
import { getErrorMessage } from '../common/error-message.util';

const RUTA = join('docs', 'conocimiento', 'AGENIA.md');

interface Cargado {
  ruta: string;
  modificado: number;
  markdown: string;
  contenido: ContenidoAyuda;
  indice: IndiceAyuda;
  manuales: Map<string, ManualDelAsistente>;
}

/**
 * El manual del asistente de soporte: docs/conocimiento/AGENIA.md, el MISMO archivo
 * del Centro de ayuda (docs/PLAN_BOT_SOPORTE.md §3.2).
 *
 * Se busca subiendo desde el directorio de trabajo (en la imagen de Docker,
 * /app/docs/conocimiento: ver .dockerignore); `AGENIA_CONOCIMIENTO_PATH` fuerza
 * otra ruta. Se vuelve a leer solo si cambió (fecha de modificación), y el manual
 * de cada rol se arma una vez por versión del archivo.
 *
 * Si el archivo falta o está roto, `cargar()` devuelve null y el asistente sigue
 * atendiendo con lo que tenga (nunca se cae por el manual).
 */
@Injectable()
export class SupportBotKnowledgeService {
  private readonly logger = new Logger(SupportBotKnowledgeService.name);
  private cargado: Cargado | null = null;
  private avisado = false;

  cargar(): Cargado | null {
    try {
      const ruta = this.ruta();
      const modificado = statSync(ruta).mtimeMs;
      if (
        this.cargado?.ruta === ruta &&
        this.cargado.modificado === modificado
      ) {
        return this.cargado;
      }
      const markdown = readFileSync(ruta, 'utf8');
      const contenido = parsearConocimiento(markdown);
      this.cargado = {
        ruta,
        modificado,
        markdown,
        contenido,
        indice: crearIndice(contenido.temas, contenido.glosario),
        manuales: new Map(),
      };
      this.avisado = false;
      return this.cargado;
    } catch (e: unknown) {
      if (!this.avisado) {
        this.avisado = true;
        this.logger.error(
          `El asistente de soporte no pudo leer ${RUTA}: ${getErrorMessage(e)}`,
        );
      }
      // Mejor el último manual bueno que ninguno.
      return this.cargado;
    }
  }

  /** El manual de quien pregunta (con su rol y su menú), o null sin archivo. */
  manualPara(rol: UserRole, menus: MenuItem[]): ManualDelAsistente | null {
    const c = this.cargar();
    if (!c) return null;
    const clave = `${rol}|${menus.map((m) => `${m.href}:${m.label}`).join(',')}`;
    let manual = c.manuales.get(clave);
    if (!manual) {
      manual = armarManualDelAsistente({
        markdown: c.markdown,
        contenido: c.contenido,
        rol,
        menus,
      });
      c.manuales.set(clave, manual);
    }
    return manual;
  }

  /** Lo más cercano del manual con el buscador del Centro de ayuda (modo sin IA). */
  buscar(consulta: string, max = 3): ResultadoDelManual[] {
    const c = this.cargar();
    if (!c) return [];
    const temas = new Map(c.contenido.temas.map((t) => [t.id, t.titulo]));
    return buscar(c.indice, consulta, max).resultados.map((r) => ({
      temaId: r.fragmento.temaId,
      tema: temas.get(r.fragmento.temaId) ?? 'Glosario',
      titulo: r.fragmento.titulo,
      extracto: r.extracto
        .map((s) => s.texto)
        .join('')
        .trim(),
    }));
  }

  private ruta(): string {
    const forzada = process.env.AGENIA_CONOCIMIENTO_PATH?.trim();
    if (forzada) return forzada;
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
      const candidata = join(dir, RUTA);
      if (existsSync(candidata)) return candidata;
      const padre = dirname(dir);
      if (padre === dir) break;
      dir = padre;
    }
    throw new Error(`No se encontró ${RUTA} subiendo desde ${process.cwd()}.`);
  }
}
