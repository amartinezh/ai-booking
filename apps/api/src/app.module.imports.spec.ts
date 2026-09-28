import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
// El ORDEN importa y es el del arranque real: primero AppModule (que carga
// ChatbotModule), después el módulo de Telegram. Así se reproduce el ciclo de
// `import` que en la Fase 2 dejó un módulo `undefined` y tumbaba la API con
// TELEGRAM_ENABLED=true (docs/PLAN_TELEGRAM.md, bitácora).
import { AppModule } from './app.module';
import { TelegramModule } from './telegram/telegram.module';

type AnyModule = { name?: string } & object;

/**
 * Recorre el grafo de `imports` de Nest y devuelve la ruta de cada entrada que
 * quedó `undefined` al cargar (síntoma de un ciclo entre archivos).
 */
function undefinedImports(root: AnyModule): string[] {
  const problems: string[] = [];
  const seen = new Set<unknown>();
  const visit = (mod: unknown, path: string) => {
    if (!mod || seen.has(mod)) return;
    seen.add(mod);
    const target =
      typeof mod === 'object' && mod !== null && 'module' in mod
        ? (mod as { module: AnyModule }).module // módulo dinámico (forRoot…)
        : (mod as AnyModule);
    const imports: unknown[] =
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, target) ?? [];
    imports.forEach((imp, i) => {
      const here = `${path} → imports[${i}]`;
      if (imp === undefined) {
        problems.push(here);
        return;
      }
      const resolved =
        typeof imp === 'object' && imp !== null && 'forwardRef' in imp
          ? (imp as { forwardRef: () => unknown }).forwardRef()
          : imp;
      if (resolved === undefined) {
        problems.push(`${here} (forwardRef)`);
        return;
      }
      const name =
        (resolved as AnyModule).name ??
        (resolved as { module?: AnyModule }).module?.name ??
        '?';
      visit(resolved, `${path} → ${name}`);
    });
  };
  visit(root, root.name ?? 'root');
  return problems;
}

describe('Grafo de módulos de la API', () => {
  it('ningún import de AppModule quedó undefined', () => {
    expect(undefinedImports(AppModule)).toEqual([]);
  });

  it('ningún import de TelegramModule quedó undefined (se registra con TELEGRAM_ENABLED=true)', () => {
    expect(undefinedImports(TelegramModule)).toEqual([]);
  });
});
