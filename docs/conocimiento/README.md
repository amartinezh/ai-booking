# Conocimiento del sistema

Esta carpeta guarda **[AGENIA.md](AGENIA.md)**, la descripción completa y vigente de lo que hace AgenIA. Tiene tres usos:

1. **Es la base del Centro de ayuda** del panel (`/dashboard/soporte/ayuda`): la página no tiene texto propio; muestra la Parte 1 del archivo (lo que va entre `<!-- AYUDA:INICIO -->` y `<!-- AYUDA:FIN -->`).
2. **Es la referencia del sistema** para el equipo: roles, asistente virtual, recordatorios, espejo con el hospital, procesos automáticos, seguridad, arquitectura, configuración y limitaciones conocidas (Parte 2).
3. **Es el registro de cambios** visibles para quien usa el sistema (Parte 3).

## La regla: todo cambio actualiza este archivo

Cada ajuste o mejora del sistema —una pantalla, un texto del asistente, una regla, un proceso automático— actualiza `AGENIA.md` **en el mismo commit**:

- la sección que describe lo que cambió (en la Parte 1 si se ve en el panel; en la Parte 2 si es comportamiento del sistema);
- una línea en la **Parte 3 · Bitácora de cambios** (fecha, qué cambió, para quién);
- la fecha de **Última actualización** del encabezado.

Lo vigilan tres cosas:

| Dónde | Qué hace |
|---|---|
| Gancho `commit-msg` (`.githooks/commit-msg`) | Rechaza un commit que toca código del producto sin tocar `AGENIA.md`, y uno que deja la Parte 1 con errores de formato. |
| CI (`.github/workflows/ci.yml`) | Lo mismo para cada commit del push o del pull request, más las pruebas del centro de ayuda. Sin CI en verde no hay despliegue. |
| Pruebas (`apps/web/lib/ayuda/*.spec.ts`) | Que cada opción del menú del administrador tenga su tema con el mismo título, que los enlaces apunten a temas que existen y que la página se arme. |

**Cuando de verdad no hay nada que contar** (una refactorización interna, una prueba, un cambio de herramientas), se dice explícitamente con esta línea al final del mensaje del commit:

```
Conocimiento: no aplica — <por qué>
```

Cuentan como código del producto: `apps/*/src`, `apps/web/app`, `apps/web/lib`, `apps/web/components`, `apps/web/hooks`, `apps/web/middleware.ts`, `packages/*/src`, `packages/database/prisma` y `deploy/`. No cuentan las pruebas (`*.spec.*`, `*.test.*`, `__tests__`, `__mocks__`).

### Activar el gancho en un clon nuevo

```sh
git config core.hooksPath .githooks
```

### Comprobar a mano

```sh
node scripts/check-conocimiento.mjs                   # formato y coherencia de AGENIA.md
node scripts/check-conocimiento.mjs --staged          # además, lo que está preparado para commit
node scripts/check-conocimiento.mjs --range A..B      # cada commit de un rango (lo usa el CI)
pnpm --filter web test -- lib/ayuda app/dashboard/soporte/ayuda
```

En desarrollo (`pnpm --filter web dev`), editar `AGENIA.md` y recargar la ayuda ya muestra el cambio.

## Formato de la Parte 1

Es Markdown corriente con piezas fijas. El lector (`apps/web/lib/ayuda/conocimiento.ts`) se detiene con un error que dice la línea exacta si algo no encaja, así que una edición mal hecha no llega a producción a medias.

```markdown
## Portada

- **Presentación:** Texto bajo el título «Centro de ayuda».
- **Búsquedas frecuentes:** Abrir cupos, Cargar el padrón, Recordatorios
- **Glosario destacado:** HIS, espejo, cupo

## Categoría: Operación diaria {#operacion}

Descripción de la categoría, en un párrafo.

### 📋 Visión General {#vision-general}

- **Ruta:** `/dashboard`
- **Resumen:** Una frase: qué es y para qué.
- **Disponibilidad:** Cuándo aparece la opción, si no aparece siempre.
- **Relacionados:** [Agendas (Slots)](#agenda), [Glosario](#glosario)
- **Palabras clave:** tablero, citas del día, asistencia

#### Para qué sirve

Texto corrido.

#### Paso a paso

##### Marcar si el paciente asistió

1. Primer paso.
2. Segundo paso.

> 💡 Nota opcional que acompaña los pasos.

#### Qué ves en la pantalla

- **Nombre del elemento:** Qué es.

#### Preguntas frecuentes

##### ¿La pregunta?

La respuesta, en texto corrido.

#### Si algo no sale bien

##### Lo que la persona ve que pasa.

Qué hacer, en texto corrido.

## Glosario {#glosario}

- **Término:** Definición.
  - También se dice: sinónimo, otro sinónimo
  - Se ve en: [Visión General](#vision-general)
```

Reglas:

- **Un tema por opción del menú del administrador**, con el título **exacto** de `apps/web/lib/menus.ts` y su `Ruta`. Una opción nueva en el menú sin su tema hace fallar las pruebas. Un tema sin ruta es un tema general (como «Primeros pasos»).
- **Ids** (`{#id}`): minúsculas, números y guiones; únicos. `inicio` (la categoría) y `primeros-pasos` (el tema) son los que el inicio de la ayuda destaca arriba. `glosario` está reservado.
- **Obligatorios** en cada tema: `Resumen`, «Para qué sirve», al menos una guía en «Paso a paso» y al menos una pregunta frecuente. Las demás secciones son opcionales y van en este orden.
- **Listas** (`Búsquedas frecuentes`, `Palabras clave`, `También se dice`): separadas por comas; un elemento no puede llevar coma.
- **Texto sin formato**: la página muestra los párrafos tal cual. No uses negritas, cursivas ni enlaces dentro del texto, y escribe cada párrafo como texto corrido (puede ocupar varias líneas seguidas).
- **Comentarios** `<!-- … -->` y líneas `---` se ignoran: sirven para notas de quien mantiene el archivo.
- **Palabras clave**: palabras con las que alguien buscaría el tema y que no están en su texto. El buscador ya entiende tildes, plurales, errores de tipeo y sinónimos del oficio (turno ↔ cupo, doctor ↔ médico…).

## La Parte 2

Formato libre (Markdown normal). Describe el sistema tal como funciona **hoy**, sin historia: la historia va en la bitácora (Parte 3) y en los planes de `docs/`. Si algo está construido pero apagado, o pendiente, se dice con su estado y la fecha.
