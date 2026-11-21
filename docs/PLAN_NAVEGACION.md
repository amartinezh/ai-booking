# Navegación del panel y Configuración

**Estado: FASES 1 Y 2 HECHAS (2026-11-21); la 1 en el commit 2e0f37a, la 2 sin commit.** El usuario aprobó N1 … N12 (§7) tal como estaban recomendadas. Sigue la Fase 3 (traer lo suelto: Límite de citas, avisos a agendadores, modo de agenda) y la 4.

- **Fase 1**: grupos en [`menus.ts`](../packages/shared/src/menus.ts) (`grupo`, `GRUPOS_DEL_MENU`, `seccionesDelMenu`, `accesosRapidos`, `nombresEnElMenu`; la lista de cada rol ya va en el orden de §4 y las opciones del espejo se filtran en su lugar, sin `insertBeforeSoporte`); el menú lateral y el panel «☰ Menú» del celular en [`MenuDelPanel.tsx`](../apps/web/app/dashboard/components/MenuDelPanel.tsx), con la opción activa de [`menu-activo.ts`](../apps/web/lib/menu-activo.ts) (aparte para no meter `@agenia/shared` en el JavaScript de cada página: el trozo del menú pesa 14 KB); la Visión General con solo Operación diaria; los nombres de N7 (también en los textos del asistente de Telegram, «panel › Soporte y ayuda»); las categorías del Centro de ayuda = los grupos (N11), comprobado por `contenido.spec.ts` y `check-conocimiento.mjs`; la portada de la ayuda muestra los temas de «Para empezar» además de «Primeros pasos». «Límite de citas» sigue en el menú (en Administración) hasta la Fase 3.
- **Fase 2**: Configuración en el grupo de rutas `app/dashboard/configuracion/(secciones)` (así Encuestas, que cuelga de `…/integraciones/surveys`, no hereda la columna): layout con la columna (`NavConfiguracion.tsx`, de cliente y sin `@agenia/shared`), el Resumen (`page.tsx` + la lógica pura en `apps/web/lib/configuracion/resumen.ts`) y una página por sección con los mismos componentes y un ancla por ajuste (`comunes.tsx`: `Ajuste`, `Seccion`, `exigirAdministrador`). La lista de secciones es `seccionesDeConfiguracion` en `menus.ts`, derivada del menú (Hospital solo si el menú tiene el Espejo); la usan la columna, el Centro de ayuda (un tema por sección, en Administración tras «Configuración») y el asistente de soporte. «Horarios que ofrece» salió del formulario del nombre a Agenda que ofrece el asistente y guarda al instante (`setMySlotsOfferedCount`; `updateMyOrgSettings` ya no lo pisa si no viene). Las acciones refrescan todas las secciones (`revalidatePath(…, 'layout')`). `?tab=…` y `/dashboard/conocimiento` redirigen; los enlaces de Espejo, Bandeja, Mensajes masivos y el error de la API sin IA apuntan a la sección exacta. Diferencias con §5: Estadísticas para compartir ya pasó a Analíticas (`#compartir`, N6) porque las pestañas desaparecían; la página de Analíticas se llama así (antes «Business Intelligence»); Datos de la clínica (N9), las filas compactas (N12) y el aviso de cambios sin guardar (§5.3) quedan para la Fase 4; la sección del hospital enlaza al modo de agenda y a los avisos a agendadores hasta que la Fase 3 los traiga.

## 1. Qué se pide

1. Evaluar a fondo el menú del panel y la pantalla de Configuración.
2. Proponer una navegación **agrupada por tema** y **fácil de operar**.
3. Que cada configuración esté **donde uno la busca** y **más a la mano**.

**Lo que NO hace este plan:** no cambia permisos (cada rol sigue viendo lo mismo), no cambia lo que hace ningún ajuste, no toca el asistente ni la API. Solo cambia **dónde están las cosas y cómo se llega a ellas**.

## 2. Cómo está hoy

### 2.1 El menú lateral

El menú del administrador es **una lista plana sin encabezados** ([`menus.ts:156`](../packages/shared/src/menus.ts#L156)): 18 opciones fijas, y 22 en Anserma, que además tiene las 4 del espejo.

| # | Hallazgo | Consecuencia |
|---|---|---|
| M1 | **Sin grupos.** 22 opciones seguidas, del mismo tamaño y en el mismo color. | Para encontrar algo hay que leer la lista entera. |
| M2 | **El orden no sigue el uso.** Lo del espejo se agrega al final, justo antes de Soporte ([`menus.ts:351`](../packages/shared/src/menus.ts#L351)). La **Bandeja de sincronización**, que es el trabajo del día y la única con cifra roja junto a Solicitudes de más citas, queda en el **puesto 19 de 22**, después de Configuración. Rastreo queda en el 11 y Caja Negra en el 10, entre catálogos que se tocan una vez al mes (EPS, Padrón, Usuarios). | Lo urgente queda abajo y lo que casi no se usa, arriba. |
| M3 | **No marca dónde está uno.** Ninguna opción queda resaltada ([`layout.tsx:80`](../apps/web/app/dashboard/layout.tsx#L80)). | En una lista de 22, uno se pierde. |
| M4 | **En el celular**, las 22 opciones salen como botones encima del contenido de **cada página** ([`layout.tsx:147`](../apps/web/app/dashboard/layout.tsx#L147)). | Hay que bajar media pantalla para ver la página. |
| M5 | **La Visión General repite el menú entero** como 21 tarjetas (`QuickAccessGrid`). | No resalta lo que espera al usuario hoy. Es el mismo menú una segunda vez. |
| M6 | **Nombres disparejos**: «Agendas (Slots)» en inglés, «Encuestas (CSAT)», «Padrón EPS (Altas)», «Caja Negra (Auditoría)»; unos con Mayúscula En Cada Palabra y otros no; 📨 repetido en «Solicitudes de Alta» y «Envíos de documentos». | Se ve descuidado y cuesta distinguir las opciones. |
| M7 | **El Centro de ayuda ya agrupa el menú** en 6 categorías (Operación diaria, Agenda y catálogos, Indicadores, Administración, Conexión con el hospital…), **pero el menú no usa esos grupos**. | El usuario tiene dos mapas distintos del mismo sistema. |

El menú del agendador (9 opciones con espejo) tiene el mismo problema en pequeño: la Bandeja queda de penúltima, debajo de Solicitudes de más citas. Los del médico, el paciente y el observador tienen 2 o 3 opciones y están bien.

### 2.2 La pantalla de Configuración

Tiene 5 pestañas ([`configuracion/page.tsx:45`](../apps/web/app/dashboard/configuracion/page.tsx#L45)): Asistente Virtual, Días sin citas, Integraciones (IA y Canales), Base de Conocimiento y Estadísticas.

| # | Hallazgo | Consecuencia |
|---|---|---|
| C1 | **«Asistente Virtual» apila hasta 17 bloques con título en una sola columna** ([`page.tsx:212`](../apps/web/app/dashboard/configuracion/page.tsx#L212)), cada uno con su explicación larga siempre abierta. | Es una página de varios metros. Lo que uno busca casi nunca está a la vista. |
| C2 | **Mezcla 6 temas en un orden sin lógica**: qué puede hacer el paciente (3 interruptores) → privacidad (autorización de datos y la página de la política) → qué agenda ofrece (plazo, parte para el asistente, sábados) → médicos nuevos del hospital (2 interruptores) → recordatorios (3) → nombre, tono y **«Horarios que ofrece»** (una regla de agenda metida en el formulario del nombre) → voz. | Lo más básico, el nombre del asistente, queda casi al final. Las reglas de agenda quedan repartidas en tres sitios de la misma página. |
| C3 | **Dos formas de guardar en la misma página.** Los interruptores y las listas guardan al instante; el nombre, el tono, los horarios ofrecidos, la autorización y la voz esperan su botón «Guardar». No hay nada que los distinga a la vista. | Es fácil creer que algo quedó guardado cuando no. |
| C4 | **No hay un resumen.** Para saber qué está encendido (agendar, cancelar, cambiar, recordatorios, autorización…) hay que bajar por toda la pestaña. | La pregunta más común del administrador («¿qué está prendido?») no tiene respuesta de un vistazo. |
| C5 | **Sin enlaces directos a un ajuste.** El Centro de ayuda tiene que decir «En Asistente Virtual, busca "Autorización de datos"». El Espejo enlaza a `/dashboard/configuracion` en general ([`EspejoClient.tsx:280`](../apps/web/app/dashboard/espejo/components/EspejoClient.tsx#L280)). | Ni la ayuda ni las otras pantallas pueden llevar al usuario al ajuste exacto. |
| C6 | **«Estadísticas» no es una configuración**: es una página para compartir indicadores. | Está lejos de los indicadores. |

### 2.3 Configuraciones que viven fuera de Configuración

| Ajuste | Dónde está hoy | Por qué no se encuentra |
|---|---|---|
| Límite de citas por paciente (día y mes) | Opción propia del menú, «Límite de citas» | Es una regla del asistente, como agendar o el plazo, pero está a 15 opciones de Configuración. |
| Días sin citas por el asistente | Pestaña de Configuración | Está lejos del plazo y de los sábados, que son la misma decisión: qué días ofrece el asistente. |
| Médicos nuevos del hospital (agregar solos, con WhatsApp ON) | Configuración › Asistente Virtual | Es del espejo y de Médicos, no de cómo habla el asistente. |
| Avisos a agendadores (lista de personas, horario) | Bandeja › «Configurar avisos» | Una configuración escondida dentro de una bandeja de trabajo. |
| Modo de agenda (OFF / SHADOW / ON) | Espejo con el HIS ([`EspejoClient.tsx:309`](../apps/web/app/dashboard/espejo/components/EspejoClient.tsx#L309)) | Es una decisión importante mezclada con el monitor del agente. |
| Resumen de la atención (Leer, Enviar, piloto) | Solo desde un botón en el encabezado del Espejo | No aparece en el menú ni en Configuración. |
| Cómo se arma la lista de los avisos masivos | Dentro de Avisos masivos | Puede quedarse ahí (lo usan agendador y administrador), pero desde Configuración no se sabe que existe. |
| Encuestas (CSAT) | La ruta es `/dashboard/configuracion/integraciones/surveys` | Es una pantalla de resultados con dirección de configuración. |
| Teléfono de soporte (al que el asistente manda al paciente) | Sin pantalla: lo registra el equipo de AgenIA | Límite de citas avisa que falta ([`limites-citas/page.tsx:91`](../apps/web/app/dashboard/limites-citas/page.tsx#L91)), pero el administrador no puede verlo ni cambiarlo. |
| Base de conocimiento | Pestaña de Configuración, y `/dashboard/conocimiento` redirige allá | Está bien ubicada; solo sobra la segunda dirección. |

## 3. Principios

1. **El menú se agrupa por lo que uno va a hacer**, en el orden en que lo hace: primero el trabajo del día, al final la administración.
2. **Toda configuración vive en Configuración.** Las pantallas de trabajo (Bandeja, Espejo, Agendas…) **muestran el estado** del ajuste y un enlace **«Cambiar →»** que lleva al lugar exacto. Ninguna configuración queda escondida dentro de una pantalla de trabajo.
3. **Configuración se divide por tema, y cada tema tiene su propia dirección** (`/dashboard/configuracion/agenda#plazo`), para que la ayuda, el asistente de soporte y las demás pantallas puedan enlazar directo al ajuste.
4. **Un resumen antes que el detalle:** la portada de Configuración dice qué está encendido y qué falta.
5. **Un solo mapa:** los grupos del menú son las categorías del Centro de ayuda.

## 4. El menú propuesto

### 4.1 Administrador (Anserma, con espejo)

```
📋 Visión General

OPERACIÓN DIARIA
   🚨 Bandeja de sincronización     12
   📝 Solicitudes de más citas       3
   📨 Solicitudes de alta
   🕵️ Caja Negra
   🔎 Rastreo de paciente

COMUNICACIÓN CON PACIENTES
   📢 Mensajes masivos
   📣 Avisos masivos               (driver de Anserma)
   📄 Envíos de documentos         (con resumen de la atención)

AGENDA Y CATÁLOGOS
   📅 Agendas y cupos
   ⚕️ Médicos
   💉 Servicios de salud
   🏦 Aseguradoras (EPS)
   🪪 Padrón EPS

INDICADORES
   📊 Analíticas
   📈 Canales en vivo
   ⭐ Encuestas

ADMINISTRACIÓN
   ⚙️ Configuración
   👥 Usuarios
   🪞 Espejo con el HIS            (con espejo)
──────────────────────────
🛟 Soporte y ayuda
🔑 Cambiar mi clave · Salir
```

- Pasa de 22 opciones seguidas a 5 grupos de 3 a 5 opciones. Sale «Límite de citas», que se va a Configuración (N5).
- Las dos opciones con cifra roja quedan **arriba**.
- La opción en la que uno está queda resaltada, y su grupo también.
- Una clínica sin espejo ve lo mismo sin Bandeja, Avisos, Envíos ni Espejo (17 opciones en 5 grupos). Un grupo que se queda vacío no se muestra.

### 4.2 Agendador

```
📋 Visión General
📅 Agendamiento

OPERACIÓN DIARIA
   🚨 Bandeja de sincronización     12
   📝 Solicitudes de más citas       3
   🕵️ Caja Negra
   🔎 Rastreo de paciente

COMUNICACIÓN CON PACIENTES
   📣 Avisos masivos
   📄 Envíos de documentos
──────────────────────────
🛟 Soporte y ayuda
```

### 4.3 Médico, paciente y observador

Siguen igual: con 2 o 3 opciones no hacen falta grupos.

### 4.4 En el celular

Las 22 opciones de arriba de cada página se cambian por un botón **«☰ Menú»** en el encabezado. Abre un panel con los mismos grupos y la misma cifra roja.

### 4.5 La Visión General

Hoy repite el menú entero en tarjetas. Pasa a mostrar solo **lo que espera al usuario**: las tarjetas de «Operación diaria» con su cifra (por ejemplo, «🚨 12 casos en la Bandeja», «📝 3 solicitudes por revisar»). El resto ya está en el menú (N10).

## 5. Configuración propuesta

### 5.1 Cómo se ve

Una columna de secciones a la izquierda y la sección abierta a la derecha. En el celular, la columna se vuelve una lista. Cada sección tiene su dirección.

```
⚙️ Configuración
┌────────────────────────────┬──────────────────────────────────────────────┐
│ 🏠 Resumen                  │  Resumen  (valores de ejemplo)               │
│                             │                                              │
│ EL ASISTENTE                │  Qué puede hacer el asistente                │
│   Qué puede hacer           │    Agendar ............ ● Encendido  Cambiar→│
│   Agenda que ofrece         │    Cancelar ........... ● Encendido          │
│   Recordatorios             │    Cambiar la fecha ... ○ Apagado            │
│   Cómo habla y voz          │    Límite por paciente  1 al día · 3 al mes  │
│   Base de conocimiento      │  Agenda que ofrece                           │
│                             │    Plazo .............. 4 días (hasta el 26) │
│ LA CLÍNICA                  │    Parte para el asistente 50 % · Sábados 50%│
│   Datos de la clínica       │    Días sin citas ..... 2 bloqueos activos   │
│   Privacidad (Ley 1581)     │  Recordatorios ........ ● 1 hora antes       │
│                             │  Privacidad ........... ○ Autorización apagada│
│ CONEXIONES                  │  Canales .............. WhatsApp ● · IA ●    │
│   Canales e IA              │  Hospital ............. Agente ● · Modo ON   │
│   Hospital (espejo)         │                                              │
│                             │  ⚠️ Falta el teléfono de soporte              │
└────────────────────────────┴──────────────────────────────────────────────┘
```

### 5.2 Qué va en cada sección

| Sección | Dirección | Qué tiene | De dónde viene |
|---|---|---|---|
| **Resumen** | `/dashboard/configuracion` | Una línea por ajuste importante, con su estado y «Cambiar →». Arriba, lo que falta o está mal: sin teléfono de soporte, autorización apagada, plantilla sin aprobar, conexión caída. | Nuevo. Solo lee datos que ya existen. |
| **Qué puede hacer** | `…/asistente` | Agendar, cancelar y cambiar la fecha (**una tarjeta con tres filas**, no tres bloques grandes) · Límite de citas por día y por mes, con enlace a Solicitudes de más citas. | Asistente Virtual · opción «Límite de citas» del menú |
| **Agenda que ofrece** | `…/agenda` | Plazo máximo para agendar · Días sin citas (el calendario) · Sábados por el asistente · Parte de la agenda para el asistente · Horarios que ofrece. | Asistente Virtual · pestaña Días sin citas · el formulario del nombre |
| **Recordatorios** | `…/recordatorios` | Recordatorios automáticos · Solo a quien agendó por el chat (desactivado a la vista si los recordatorios están apagados) · Anticipación mínima. | Asistente Virtual |
| **Cómo habla y voz** | `…/identidad` | Nombre del asistente, tono (con la vista previa) · Voz. | Asistente Virtual |
| **Base de conocimiento** | `…/conocimiento` | El editor actual. | Pestaña Base de Conocimiento |
| **Datos de la clínica** | `…/clinica` | Nombre y logo (de lectura), **teléfono de soporte** (N9) y los datos del responsable que usa la página de la política. | Nuevo: hoy no hay pantalla |
| **Privacidad (Ley 1581)** | `…/privacidad` | Autorización de datos antes de agendar · Página pública de la política de datos (hoy va metida dentro de la autorización). | Asistente Virtual |
| **Canales e IA** | `…/canales` | Estado de las conexiones arriba · WhatsApp y sus plantillas · Telegram · Proveedor de IA. | Pestaña Integraciones |
| **Hospital (espejo)** | `…/hospital` (solo con espejo) | Modo de agenda · Médicos nuevos del hospital (2 interruptores) · Avisos a agendadores (lista de personas y horario) · Enlaces a «Resumen de la atención» y a la lista de Avisos masivos. | Espejo · Asistente Virtual · Bandeja |

**Estadísticas para compartir** sale de Configuración y se va a **Analíticas**, como un botón «Compartir» que solo ve el administrador (N6).

Cada ajuste lleva un ancla (`…/agenda#plazo`, `…/asistente#limite`), para que la ayuda, el asistente de soporte, el Espejo y la Bandeja lleven al lugar exacto.

### 5.3 Cómo se guarda

- Los interruptores y las listas siguen guardando al instante y lo dicen («Guardado ✓» junto al ajuste).
- Lo que se escribe (el nombre, el enlace de la política, las claves de WhatsApp o de la IA) queda en una tarjeta con su propio «Guardar». Si quedan cambios sin guardar, la tarjeta lo dice, y salir de la sección pide confirmación.
- Como cada sección es corta, nunca queda un «Guardar» fuera de la pantalla.

### 5.4 Lo que queda en las pantallas de trabajo

| Pantalla | Queda | Se va a Configuración |
|---|---|---|
| Bandeja | «Los avisos salen a N personas» y, para quien no configura, si él los recibe (PLAN_AVISOS_AGENDADORES §3.5) · enlace «Configurar avisos →» | La lista de personas y el horario |
| Espejo | Los semáforos, la versión del agente, la cola y los eventos · el estado de agendar/cancelar/cambiar y del modo de agenda, con «Cambiar →» directo | El cambio del modo de agenda |
| Límite de citas | La dirección vieja redirige a `…/asistente#limite` | Todo |
| Médicos | Igual. Puede mostrar «Los médicos nuevos del hospital se agregan solos: encendido · Cambiar →» | — |

## 6. Cómo se protege lo que ya funciona

- **Direcciones viejas**: `?tab=chatbot|dias|integrations|kb|estadisticas`, `/dashboard/limites-citas`, `/dashboard/conocimiento` y `/dashboard/configuracion/integraciones/surveys` redirigen a su lugar nuevo. Así no se rompe ningún marcador, enlace de la ayuda ni respuesta vieja del asistente de soporte.
- **Durante 30 días**, el lugar viejo muestra un aviso: «Esto se movió a Configuración › Agenda que ofrece».
- **Permisos**: no cambian. Configuración ya es solo del administrador, igual que Límite de citas y la configuración de los avisos a agendadores. El servidor sigue validando cada acción como hoy.
- **Componentes**: se reacomodan los mismos (`PlazoAgendarSetting`, `BloqueosAgenda`, `LimitesCitasForm`, `PanelAvisos`…). No se reescribe la lógica de ningún ajuste.

## 7. Decisiones por aprobar

| # | Decisión | Opciones | Recomendada |
|---|---|---|---|
| **N1** | Grupos del menú | (a) los 5 de §4.1 · (b) mantener la lista plana y solo reordenar | **(a)** |
| **N2** | ¿Grupos plegables? | (a) encabezados fijos, todo abierto · (b) plegables, recordando la elección de cada usuario | **(a)** para empezar, con opciones un poco más bajas. Ni hoy ni con grupos caben 22 opciones a lo alto de un portátil; el menú ya se desplaza por dentro, y con los encabezados se sabe en qué parte se está. Plegables, si alguien lo pide: esconder grupos hace más difícil encontrar las opciones. |
| **N3** | Configuración por secciones con dirección propia y Resumen (§5) | (a) sí · (b) dejar las pestañas y solo reordenar «Asistente Virtual» | **(a)** |
| **N4** | Principio de §3.2: toda configuración en Configuración; las pantallas de trabajo muestran el estado y enlazan | (a) sí · (b) caso por caso | **(a)** |
| **N5** | «Límite de citas» sale del menú y pasa a Configuración › Qué puede hacer | (a) sí · (b) se queda en el menú | **(a)**. Solicitudes de más citas se queda en el menú: es trabajo del día. |
| **N6** | Estadísticas para compartir | (a) a Analíticas, botón «Compartir», solo administrador · (b) se queda en Configuración | **(a)** |
| **N7** | Nombres | (a) cambiar solo los disparejos: «Agendas (Slots)» → «Agendas y cupos», «Encuestas (CSAT)» → «Encuestas», «Padrón EPS (Altas)» → «Padrón EPS», «Analíticas de Negocio» → «Analíticas», «Servicios de Salud» → «Servicios de salud», «Solicitudes de Alta» → «Solicitudes de alta», «Soporte» → «Soporte y ayuda»; y 📄 para «Envíos de documentos» · (b) no cambiar nombres | **(a)**. «Caja Negra (Auditoría)» se queda así: el personal ya la conoce por ese nombre. |
| **N8** | Interruptores del resumen de la atención y lista de los avisos masivos | (a) se quedan en su pantalla, con enlace desde Configuración › Hospital · (b) se mudan a Configuración | **(a)**. Van con el piloto y con la operación de esas pantallas. |
| **N9** | Teléfono de soporte | (a) el administrador lo ve y lo cambia en Datos de la clínica · (b) lo ve, pero lo sigue registrando AgenIA · (c) como hoy | **(a)**. El asistente se lo dice a los pacientes, y quien sabe si cambió es la clínica. |
| **N10** | Visión General | (a) solo las tarjetas de Operación diaria, con su cifra · (b) como hoy | **(a)** |
| **N11** | Centro de ayuda | (a) sus categorías pasan a ser los grupos del menú, y el tema «Configuración» (hoy de ~350 líneas) se parte en un tema por sección · (b) la ayuda sigue como está | **(a)**. Un solo mapa, y temas más cortos. |
| **N12** | Ajustes compactos | (a) cada ajuste en una fila (título, una línea y estado), con «¿Qué pasa si lo apago?» desplegable · (b) como hoy, con la explicación siempre abierta | **(a)**, en la Fase 4. Las explicaciones no se pierden: quedan a un clic. |

## 8. Fases

Cada fase se despliega por separado y deja el panel funcionando.

- **Fase 1 · Menú.** Solo cambia la presentación: no se mueve ninguna ruta.
  - Campo `grupo` en `MenuItem` y el orden de §4 en [`menus.ts`](../packages/shared/src/menus.ts). `insertBeforeSoporte` se reemplaza por «insertar en su grupo».
  - Un componente de cliente para el menú lateral (necesita `usePathname` para resaltar la página activa) y el panel «☰ Menú» del celular, en [`layout.tsx`](../apps/web/app/dashboard/layout.tsx).
  - `QuickAccessGrid` con solo Operación diaria (N10).
  - Nombres de N7.
  - El asistente de soporte responde con el grupo («Administración › Configuración»).
- **Fase 2 · Configuración por secciones.** Las secciones de §5.2 con los mismos componentes, el Resumen, las anclas y las redirecciones de las pestañas viejas.
- **Fase 3 · Traer lo suelto.** Límite de citas, médicos nuevos del hospital, avisos a agendadores, modo de agenda, Estadísticas a Analíticas y la ruta de Encuestas. Cada pantalla de origen se queda con el estado y «Cambiar →» (§5.4), y muestra el aviso de 30 días.
- **Fase 4 · Pulido.** Datos de la clínica con el teléfono de soporte (N9) y ajustes compactos (N12).

## 9. Qué hay que tocar además del código

- **`docs/conocimiento/AGENIA.md`**, en cada fase: Parte 1 (categorías = grupos, títulos de N7, temas por sección de Configuración, «Dónde» de cada guía), la tabla de la Parte 2 §11 «Configuración por clínica» (columna «Dónde»), la bitácora y la fecha.
- **Prueba de la ayuda** [`contenido.spec.ts`](../apps/web/lib/ayuda/contenido.spec.ts): hoy exige que cada tema con ruta sea una opción del menú del administrador. Con N5 y N11, la regla pasa a aceptar las rutas que cuelgan de una opción del menú (`/dashboard/configuracion/...`). Así se sigue cuidando que la ayuda no quede con temas huérfanos.
- **Pruebas del menú** [`menus.spec.ts`](../packages/shared/src/menus.spec.ts): hoy varias comprueban «antes de Soporte»; pasan a comprobar el grupo y el orden dentro de él.
- **Asistente de soporte** (`soporte-bot-conocimiento.ts`): lee el menú. Hay que revisar que nombre bien las opciones con su grupo.
- En `apps/web` no se corre prettier sobre archivos enteros: la convención del repo es tocar solo las líneas que cambian.

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| El personal de Anserma ya sabe dónde está cada cosa | Redirecciones, el aviso de 30 días en el lugar viejo, una línea en la bitácora y, si se quiere, un mensaje del asistente de soporte la primera vez. La Fase 1 no mueve ninguna pantalla, solo el menú. |
| Un enlace viejo deja de funcionar (la ayuda, respuestas del asistente de soporte, marcadores) | Todas las direcciones viejas redirigen (§6). Se quitan después de 90 días, si se quitan. |
| Un ajuste mudado pierde un permiso o una validación | Se muda el componente con su acción de servidor tal cual. La acción sigue validando el rol. |
| Mudar los avisos a agendadores le quita al agendador ver si los recibe | Esa línea se queda en la Bandeja (§5.4). |
