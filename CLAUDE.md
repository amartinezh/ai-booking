# CLAUDE.md

Convenciones del repo. Lee esto antes de tocar código.

## Fechas y zona horaria

**Regla:** nunca llamar `.toLocaleString` / `.toLocaleDateString` / `.toLocaleTimeString` directamente sobre `Date` para presentación al usuario. Usar siempre los helpers canónicos:

- **API (`apps/api`):** `import { formatAppointmentLong, formatAppointmentCompact, formatDateShort, formatTimeOnly } from '@agenia/shared'`
- **WEB (`apps/web`):** `import { ... } from '@/lib/date'` (re-exporta `@agenia/shared`)

Ambos imponen `timeZone: 'America/Bogota'` por defecto. Aceptan `opts.timeZone` para multi-tenant futuro.

**Por qué:** los contenedores Docker corren en UTC. Sin `timeZone` explícito, las fechas mostradas al paciente (mensajes de WhatsApp/TTS) y al staff (dashboards SSR) salen 5 horas adelantadas. Además, `toLocaleTimeString` y `toLocaleString` con las mismas opciones producen formatos distintos (12h vs 24h) — el paciente lo percibe como dos fechas diferentes en el mismo flujo.

**Lint rule:** ambos `eslint.config.mjs` (api y web) tienen un `no-restricted-syntax` que dispara warning sobre cualquier `.toLocale*('es-CO', ...)` que no incluya `timeZone` en sus opciones. Para casos legítimos de formato técnico (ej: `LogsClient.tsx`), pasar `timeZone: 'America/Bogota'` explícito.

**Multi-tenant:** `Organization.timezone String?` existe en el schema. Cuando entre una clínica fuera de Colombia, leer el campo y pasarlo como `opts.timeZone` en los call sites. Default (null) cae a `'America/Bogota'`.

## Workspace y paquetes

- pnpm workspaces. `packages/shared` y `packages/database` se consumen con `workspace:^` / `workspace:*`.
- Tras cambios en `packages/*`: `pnpm install --workspace-root` para refrescar symlinks; los paquetes con `build` (database, shared) necesitan `pnpm --filter @agenia/<pkg> build` después de cambios para que apps los vean.

## Tests y build

- API: `pnpm --filter api test` (jest, 120+ tests), `pnpm --filter api build` (nest build).
- WEB: `pnpm --filter web build` (next build). Para typecheck rápido: `npx tsc --noEmit`.
- Antes de subir cambios al chatbot/web tocar fechas: correr `pnpm --filter <app> lint` para confirmar que la rule de fechas no detecte regresiones.
