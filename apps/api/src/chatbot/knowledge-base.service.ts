import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Carga y mantiene en memoria el archivo knowledge-base.md.
 * El archivo es leído una sola vez al arrancar el módulo y almacenado en caché.
 * Llame a reload() para refrescarlo en caliente sin reiniciar el servidor.
 *
 * Estructura esperada del archivo: Markdown libre.
 * El LLM recibe el contenido completo como contexto de sistema.
 */
@Injectable()
export class KnowledgeBaseService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  private content = '';
  private loadedFrom = '';

  onModuleInit(): void {
    this.load();
  }

  load(): void {
    const candidates = [
      path.resolve(__dirname, 'knowledge-base.md'),
      path.resolve(process.cwd(), 'src', 'chatbot', 'knowledge-base.md'),
    ];

    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        try {
          this.content = fs.readFileSync(filePath, 'utf-8').trim();
          this.loadedFrom = filePath;
          this.logger.log(
            `Base de conocimiento cargada: ${filePath} (${this.content.length} chars)`,
          );
          return;
        } catch (err) {
          this.logger.error(`Error leyendo ${filePath}: ${err.message}`);
        }
      }
    }

    this.content = '';
    this.loadedFrom = '';
    this.logger.warn(
      'knowledge-base.md no encontrado. El asistente no podrá responder FAQs. ' +
        `Rutas buscadas: ${candidates.join(', ')}`,
    );
  }

  reload(): void {
    this.logger.log('Recargando base de conocimiento...');
    this.load();
  }

  getContent(): string {
    return this.content;
  }

  hasContent(): boolean {
    return this.content.length > 0;
  }

  getLoadedFrom(): string {
    return this.loadedFrom;
  }
}
