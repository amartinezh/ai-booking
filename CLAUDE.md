# CLAUDE.md

Convenciones del repo. Lee esto antes de tocar código.

## Conocimiento del sistema (obligatorio)

**Regla:** todo ajuste o mejora actualiza `docs/conocimiento/AGENIA.md` **en el mismo commit**: la sección que describe lo que cambió (Parte 1 = lo que muestra el Centro de ayuda, opción por opción del menú; Parte 2 = cómo funciona el sistema por dentro), una línea en la bitácora (Parte 3) y la fecha de «Última actualización». Si de verdad no cambia nada para quien usa o mantiene el sistema (refactor interno, pruebas, herramientas), el mensaje del commit lleva la línea `Conocimiento: no aplica — <por qué>`.

**Por qué:** es la base de conocimiento de todo el sistema y la fuente única del Centro de ayuda: `/dashboard/soporte/ayuda` no tiene texto propio, lee la Parte 1 del archivo (`apps/web/lib/ayuda/cargar-conocimiento.ts`). Antes de cambiar algo, léelo para saber qué hace hoy el sistema.

**Cómo se vigila:** el gancho `.githooks/commit-msg` (se activa con `git config core.hooksPath .githooks`) y el paso «Conocimiento del sistema» del CI, los dos con `node scripts/check-conocimiento.mjs`; más las pruebas `pnpm --filter web test -- lib/ayuda app/dashboard/soporte/ayuda` y `pnpm --filter @agenia/shared test -- conocimiento menus soporte-bot-conocimiento`. Una opción nueva en el menú (`packages/shared/src/menus.ts`, que la web reexporta en `apps/web/lib/menus.ts`) exige su tema en la Parte 1 con el mismo título. Una sección nueva en la Parte 2 exige decidir si la lee el asistente de soporte (`PARTE2_PARA_EL_ASISTENTE` en `packages/shared/src/soporte-bot-conocimiento.ts`). Formato de la Parte 1 y reglas: `docs/conocimiento/README.md`.

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
