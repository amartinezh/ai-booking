# Certificación de trazabilidad AgenIA → HIS — campaña del 2026-09-18

> Ejecución del plan `docs/drivers/cnt-sanvicente-anserma/PLAN_CERTIFICACION_PRUEBAS.md`.
> Objetivo: demostrar que una cita nacida en WhatsApp llega al HIS, que su
> cancelación lo libera y que ninguna de las dos cosas se queda a medias.
>
> **Base de datos objetivo: `PRUEBAS`.** Verificado en cada sesión con
> `SELECT DB_NAME()` antes de cualquier consulta. La base viva `ESEHSVP` no se
> tocó en ningún momento: el agente espejo apunta a `PRUEBAS` por configuración
> (`HospitalMirrorConfig.driverConfig` → `{"catalog":"PRUEBAS"}`).

## Dictamen

**El canal AgenIA → HIS queda certificado para "Consulta ambulatoria de
medicina general" (`S39141`) —el único servicio contratado para esta fase— en
creación, cancelación y reprogramación.**

No se encontró ni un solo fallo de sincronización: 277 eventos, 0 reintentos,
0 dead-letters, 0 sin entregar, 0 sobreventas. El alcance certificado coincide
exactamente con el alcance contratado.

**APTO PARA PRODUCCIÓN** con el alcance acordado: servicio `S39141` (consulta
ambulatoria de medicina general), convenios **Sura** y **Salud Total**, sobre el
código **`MDD2`** y con el **30%** de su agenda destinado al canal.

Las dos dudas abiertas quedaron cerradas por el hospital el 2026-09-18:

- **Los códigos de la agenda son virtuales y el médico real nunca toca la
  cita.** Se registra en la historia clínica (`CD_MED_REAL_HICL`), no en
  `CITAS_MEDICAS`. El espejo funciona sin cambios (hallazgo 1-ter).
- **`MDD1` queda fuera del canal**: sus cupos son capacidad reservada para
  triage IV/V que llega por urgencias (hallazgo 1-quater).

Los **dos cambios de código que este informe pedía antes de abrir ya están
implementados** (2026-09-18), con tests y sin tocar datos:

| # | Cambio | Estado |
|---|---|---|
| 10 | Avisar a la lista de espera cuando la cancelación nace en el HIS | ✅ implementado |
| 9 | `SKIPPED` en vez de `ERROR` para médicos que no espejamos | ✅ implementado |

Suite completa de la API en verde: **1.684 tests, 52 suites**.

### Sobre arrancar con el 30%

Es una decisión de producto razonable y este informe no la discute: con ~31
cupos semanales frente a un padrón de 19.358 afiliados, la mayoría de pacientes
verá "no hay cupos" y entrará a lista de espera. Lo que hay que tener listo no
es más agenda, sino **que esa experiencia secundaria funcione bien** — de ahí
que el hallazgo 10 sea bloqueante y no cosmético.

La campaña generó 318 inscripciones a lista de espera sin un solo fallo, así que
el camino de entrada está probado. Lo que no está probado es el de salida
cuando la cancelación nace en el hospital.

## Alcance ejecutado

Simulación conversacional automatizada contra el webhook real de WhatsApp
(firmada con HMAC-SHA256 y el App Secret de Meta de la organización), sin
atajos por API interna: cada cita se agendó hablando con el bot como lo haría
un paciente.

| Concepto | Cifra |
|---|---|
| Citas creadas | 104 |
| Citas vigentes al cierre | 95 |
| Cancelaciones | 9 |
| Reprogramaciones | 7 |
| Pacientes distintos | 79 |
| Inscripciones a lista de espera | 318 |
| Rango de fechas agendadas | 2026-10-08 a 2026-12-05 |
| Colisiones por cupo ya tomado | 516 |
| **Sobreventas (doble cita en un cupo)** | **0** |
| Eventos de sincronización | 277 |
| Eventos sin entregar / en dead-letter | 0 / 0 |
| Latencia real de entrega al agente | ~1,1 s |

Padrones reales usados (importados el 2026-09-15): **Sura 10.205** afiliados
válidos, **Salud Total 9.153**. Ver `padron/INFORME_PADRONES_CERTIFICACION.md`.

## Bloque A/B — Creación

Reconciliación automática de las 06:09 (compara la agenda completa de AgenIA
contra la del HIS en una ventana de 90 días):

```
inAgenIA: 104   inHis: 4729   missingInHis: []
```

`missingInHis: []` significa que **las 104 citas de AgenIA estaban las 104 en
el HIS**. Ninguna cita prometida al paciente se quedó sin escribir.

Las 516 colisiones son el resultado deseado de una prueba de saturación: el
índice parcial `uq_appointment_cupo_vigente` (UNIQUE sobre `scheduleSlotId`
donde `status <> 'CANCELLED'`) rechazó cada intento de vender dos veces el
mismo cupo, y el bot ofreció otro. Cero sobreventas bajo 516 intentos
concurrentes.

## Bloque C/D — Cancelación y reprogramación

Verificado por el hospital en SSMS contra `PRUEBAS`. **16 de 16 filas
correctas**: 9 cancelaciones + los 7 cupos viejos de las reprogramaciones,
todos archivados en `CITAS_ANULADAS` con motivo `WB` y todos liberados de
`CITAS_MEDICAS`.

```
tipo          cedula       medico hora              en_CITAS_ANULADAS  motivo  en_CITAS_MEDICAS
CANCELADA     1054927633   MDD2   2026/10/08 06:30  archivada OK       WB      liberada OK
CANCELADA     1054927633   MDD2   2026/10/08 07:10  archivada OK       WB      liberada OK
CANCELADA     4346295      MDD1   2026/11/11 14:00  archivada OK       WB      liberada OK
CANCELADA     900010014    MDD2   2026/10/08 15:10  archivada OK       WB      liberada OK
CANCELADA     900010095    MDD2   2026/10/10 14:00  archivada OK       WB      liberada OK
CANCELADA     900010110    MDD2   2026/10/08 18:10  archivada OK       WB      liberada OK
CANCELADA     900010162    MDD1   2026/11/11 09:20  archivada OK       WB      liberada OK
CANCELADA     900010244    MDD2   2026/10/09 17:10  archivada OK       WB      liberada OK
CANCELADA     900010275    MDD2   2026/10/09 18:10  archivada OK       WB      liberada OK
REPROGRAMADA  1054920114   MDD1   2026/11/11 14:20  archivada OK       WB      liberada OK
REPROGRAMADA  900010070    MDD2   2026/10/10 12:40  archivada OK       WB      liberada OK
REPROGRAMADA  900010136    MDD2   2026/10/09 07:10  archivada OK       WB      liberada OK
REPROGRAMADA  900010152    MDD1   2026/11/11 09:00  archivada OK       WB      liberada OK
REPROGRAMADA  900010177    MDD1   2026/11/11 11:00  archivada OK       WB      liberada OK
REPROGRAMADA  900010193    MDD2   2026/10/09 15:10  archivada OK       WB      liberada OK
REPROGRAMADA  900010219    MDD2   2026/10/09 16:10  archivada OK       WB      liberada OK
```

Dos detalles que conviene dejar por escrito:

- **La observación distingue el motivo real.** Las canceladas dicen "Cancelada
  por el paciente vía WhatsApp" y las reprogramadas "Reagendada por el paciente
  vía WhatsApp". El hospital no verá su tasa de cancelación inflada por
  reagendamientos, que es exactamente lo que pidió.
- **El cupo liberado se revende.** Las 7 reprogramaciones aterrizaron todas en
  cupos que acababa de liberar una cancelación u otra reprogramación, incluso
  encadenadas (`900010193` liberó las 15:10 y `900010177` las tomó). Esto prueba
  el caso C.5 del plan y, de paso, es la demostración más fuerte de que el
  DELETE llegó al HIS: la PK de `CITAS_MEDICAS` es (médico, hora, estado), así
  que **si el borrado no hubiera ocurrido, esos INSERT habrían fallado con error
  2627**. Ocurrieron los siete, sin un solo reintento.

### Incidente de verificación (resuelto, sin impacto)

La primera consulta de este bloque devolvió **0 filas** y se sospechó una
pérdida de cancelaciones. Era un error de la consulta, no del sistema: filtraba
`FE_ELAB_CIAN >= -3 horas` dando por hecho que esa columna es "cuándo se
anuló". No lo es — `copiarAAnuladas` la copia desde `FE_ELAB_CIT`, que se
escribe con `GETDATE()` en el **alta** de la cita. `CITAS_ANULADAS` no guarda en
ninguna columna el instante de la anulación. La consulta preguntaba "¿qué citas
*creadas* en las últimas 3 horas fueron anuladas?" y las de la campaña se habían
creado la noche anterior.

Corregido en `sql/CERTIFICACION_VALIDACION_HIS.sql`: la correlación correcta es
por `(cédula, médico, hora)`, nunca por ventana temporal.

## Hallazgos

### 1. 🔴 El servicio contratado tiene 2,6 días de inventario

Medido contra `ESEHSVP` (catálogo vivo) el 2026-09-18 con
`sql/DIAGNOSTICO_PRODUCCION_SOLO_LECTURA.sql`.

**Oferta.** Solo tres médicos homologados tienen a `S39141` como servicio
dominante, y entre los tres suman **157 cupos libres**:

| Médico HIS | Nombre | Cupos libres | Agenda publicada hasta |
|---|---|---:|---|
| `MDD2` | MEDICO DISPONIBLE HSVP 02 | 98 | 2026-12-05 |
| `MDD1` | MEDICO DISPONIBLE HSVP 01 | 38 | 2026-11-11 |
| `MD08` | SEBASTIAN ALVEAR IMBACHI | 21 | 2026-09-22 |
| `R001` | VICTOR ALFONSO QUINTERO | 0 | **sin agenda futura** |

**Demanda.** 5.401 consultas de medicina general en los últimos 90 días,
**~60 por día**, repartidas entre 23 médicos.

**Corrección de una lectura anterior.** Este informe llegó a decir "157 cupos ÷
60 al día = 2,6 días de inventario". **Esa comparación es inválida** y la medida
del horizonte de reserva explica por qué: el pozo `MDD` nunca agenda a más de 7
días vista (consulta E de `VERIFICAR_MEDICOS_COMODIN.sql`). No es un almacén que
se llena una vez: es una agenda rodante que se publica y se consume cada semana.
La comparación correcta es contra el rendimiento del propio pozo:

| | |
|---|---:|
| Rendimiento histórico del pozo `MDD1`+`MDD2` | **~155 citas/semana** (1.908 en 90 días, ~21/día) |
| Cupos libres hoy | 136 |
| Equivalencia | **0,88 semanas** — exactamente el estado estacionario |

O sea: la agenda **no está escasa; está en su régimen normal.** El riesgo real es
otro y hay que nombrarlo bien: **WhatsApp añade demanda que hoy no existe.** El
pozo está dimensionado para la demanda que llega por ventanilla y teléfono; al
abrirlo a 19.358 afiliados del padrón, la misma agenda se consumirá bastante más
rápido que al ritmo actual. La pregunta para el hospital no es "¿por qué hay tan
pocos cupos?" sino **"¿cuántos cupos más van a publicar por semana ahora que se
suma un canal nuevo?"**.

**`MDD1` y `MDD2` no son intercambiables.** El horizonte de reserva los separa:

| Antelación con que se agenda | `MDD1` | `MDD2` |
|---|---:|---:|
| Mismo día | **575 (99,7%)** | 318 (24%) |
| 1–2 días | 1 | 434 (33%) |
| 3–7 días | 0 | **579 (43%)** |
| Más de 7 días | 1 | 0 |

`MDD1` es en la práctica un pozo de **demanda del día** (paciente que llega y se
le busca hueco hoy). `MDD2` es el que se reserva con antelación. **Para WhatsApp
el pozo útil es `MDD2`**; ofrecer cupos de `MDD1` significa ofrecer horas de hoy
mismo, que sirven para poco en un canal asíncrono.

**El 64% de la demanda real la atienden médicos sin homologar.** De las 5.401
consultas, 3.443 las prestan los 18 médicos de las series `RU**`, `AP**`,
`MD05`, `MD09`, `149`, `109`, `80-1` y `77`, que AgenIA no sabe traducir al HIS
y por tanto no puede vender ni ver.

Esto NO es un defecto del software y no requiere cambios de código.

### 1-ter. ✅ Tratar `MDD1`/`MDD2` como médicos normales es SEGURO — verificado

Se planteó la duda de si el hospital, al reasignar internamente esos "médicos
disponibles" a un médico real, **reescribe `CD_CODI_MED_CIT` en la cita**. Sería
grave: el detector de cambios del agente identifica cada cita por la clave
`médico|hora` ([index.ts:501](../../../../apps/mirror-agent/src/drivers/cnt-sanvicente-anserma/index.ts)),
así que un cambio de médico en sitio haría desaparecer la clave vieja y el
agente lo reportaría como **cancelación** de una cita que en realidad sigue
viva. AgenIA la marcaría `CANCELLED` y **volvería a vender esa hora**.

**Los datos dicen que eso no ocurre.** Ciclo de vida de las citas de esos
códigos en los últimos 90 días:

| Código | Resueltas (atendidas o incumplidas) | Huérfanas en estado 0 |
|---|---:|---:|
| `MDD2` | 1.297 de 1.331 — **97,4%** | 34 (2,6%) |
| `MD08` | 802 de 812 — **98,8%** | 10 (1,2%) |
| `MDD1` | 551 de 577 — **95,5%** | 26 (4,5%) |

Las citas **viven y se atienden bajo el mismo código con el que nacieron**. Si
el hospital reescribiera el médico, esas 2.650 citas no habrían llegado a
estado 1 o 2 bajo `MDD*`.

La búsqueda del rastro directo de una reasignación (misma cédula, misma hora,
otro médico) devolvió **3 casos en 90 días**, y los tres con motivo de anulación
ordinario (`05` paciente llama a cancelar, `06` doble consulta) — coincidencias,
no un proceso sistemático.

**Confirmado por el hospital el 2026-09-18, y por diseño, no por costumbre.**
Los códigos de agenda (`MDD1`, `MDD2`, `76`, `077`, `77`, `91`) son **virtuales**
porque *"la agenda se programa hasta con meses de anticipación y el médico que
realmente va a atender se define generalmente máximo por semana"*. El médico
real se registra **en la historia clínica**, en `CD_MED_REAL_HICL`, junto al
asignado en `CD_MED_ASIG_HICL`. `CITAS_MEDICAS` no se toca.

**Conclusión: el escenario funciona tal cual. Se homologan como médicos
corrientes, las citas llegan a esos códigos y ahí termina la responsabilidad de
AgenIA.** Detalle completo en `MAPEO_HIS.md` §4.8.

### 1-quater. 🔴 `MDD1` NO debe exponerse al canal WhatsApp

El hospital lo aclaró: a `MDD2` *"es el que siempre agendan"*; a `MDD1` *"le
crean turno si no sale a remisión, al comienzo del día, y es quien atiende las
citas prioritarias surgidas de urgencias"* — triage IV y V.

**Sus cupos son capacidad reservada para pacientes prioritarios que ya están en
el hospital.** Venderlos por WhatsApp se la quitaría a quien llegó por
urgencias. No es una cuestión de eficiencia del canal: es de prioridad clínica.

El dato lo respalda: el **99,7%** de las citas de `MDD1` se crean el mismo día
en que se prestan. La propuesta inicial de este informe —excluir `MDD1` por ser
cupos del mismo día, poco útiles en un canal asíncrono— llegaba a la conclusión
correcta por la razón equivocada.

**Matiz honesto:** 39 anulaciones de `MDD*` (≈20% de las 200 del trimestre)
terminan con el paciente atendido **el mismo día por otro médico y casi siempre
a otra hora**. Eso no es un cambio de médico en sitio: es una cancelación real
seguida de una reserva nueva, y AgenIA la procesa correctamente (cancela, libera
el cupo y lo vuelve a ofrecer). El único efecto es el del hallazgo 9.

### 1-bis. ⚠️ Corrección a una versión anterior de este informe

Una primera versión reportó como bloqueante que "solo 1 de 52 servicios está
activo", con 8.779 cupos supuestamente inalcanzables repartidos en 7 servicios.
**Ese hallazgo era incorrecto en sus dos mitades:**

1. **El hospital solo contrató "Consulta ambulatoria de medicina general" para
   esta fase.** Que los otros 51 servicios estén inactivos es el cumplimiento
   del contrato, no un descuido. La recomendación de "activar servicios" que
   aparecía en esa versión estaba fuera de alcance y queda retirada.
2. **Las cifras venían de `PRUEBAS` y no son representativas** (ver hallazgo
   2-bis). Los 4.422 cupos libres de PyDT que se reportaron son 701 en
   producción; los 3.069 de planificación son 864.

### 2-bis. 🟡 `PRUEBAS` está materialmente desfasada de producción

El espejo de AgenIA se alimenta de `PRUEBAS`, que es una copia periódica. Al
comparar ambas el 2026-09-18:

| Servicio | Cupos libres en `PRUEBAS` | En `ESEHSVP` (real) |
|---|---:|---:|
| Citas de PyDT (`91-1`) | 4.422 | 701 |
| Planificación familiar (`91-2`) | 3.069 | 864 |
| Medicina general (`MDD1`+`MDD2`+`MD08`) | 109 cupos totales | 237 cupos totales |

La copia sobreestima ~6x el inventario de los programas e infravalora el de
medicina general. **Ninguna cifra de capacidad tomada de `PRUEBAS` sirve para
planear producción** — de ahí el error de la versión anterior. Para
trazabilidad y pruebas funcionales `PRUEBAS` sigue siendo el entorno correcto;
para dimensionar, hay que medir contra `ESEHSVP` en solo lectura.

### 2. 🟡 Desfase de 5 horas dentro de `SyncOutbox`

`createdAt` la escribe Postgres con `DEFAULT CURRENT_TIMESTAMP` → hora de
**Bogotá**. `deliveredAt` y `nextAttemptAt` los escribe Prisma con `new Date()`
→ **UTC**. En la misma fila.

La latencia de entrega sale como **300,02 minutos** cuando la real es **1,1
segundos**:

```
seq    createdAt                 deliveredAt               latencia_min
13006  2026-09-18 06:19:43.705   2026-09-18 11:19:44.837   300.0188
```

No afecta la entrega —el backoff compara UTC contra UTC y el orden va por
`seq`— pero falsea cualquier métrica de latencia y cualquier consulta que cruce
`SyncOutbox` con `SyncAudit` o `Appointment` por ventana de tiempo. Es la misma
clase de defecto que documenta el `CLAUDE.md` para las fechas de presentación.

### 3. 🟡 La reconciliación queda siempre en `CONFLICT`

Compara las citas de AgenIA contra **todas** las del HIS, así que reporta los
4.600+ registros propios del hospital como `missingInAgenIA` y registra
`outcome = CONFLICT` con un log de error 🚨 en cada vuelta. Una alarma
permanentemente en rojo deja de ser una alarma — el mismo razonamiento que ya
motivó el manejo de `skippedSeqs` para los eventos `SLOT`.

### 4. 🟡 `SyncAudit.detail` se trunca a 4.000 caracteres

El detalle de la reconciliación se guarda como JSON pero se corta a 4.000
caracteres, lo que lo deja sintácticamente inválido y no consultable con los
operadores JSON de Postgres. Hay que extraer las cifras con expresiones
regulares.

### 5. 🔵 14 ecos de cancelación frente a 16 liberaciones

El detector por instantánea del agente reportó 14 desapariciones de
`CITAS_MEDICAS` para 16 liberaciones reales. Artefacto del ciclo de fotos (dos
borrados cayeron entre dos instantáneas). **Sin impacto**: la verificación en
el HIS confirmó las 16 archivadas.

### 6. ✅ El mapeo de convenios queda validado contra datos vivos

Los ocho convenios homologados son exactamente los ocho de mayor volumen real
en los últimos 90 días, en el orden esperado:

| Convenio | Citas 90d | Homologado |
|---|---:|---|
| 475 Salud Total subsidiado | 5.742 | ✅ |
| 467 Sura subsidiado | 5.662 | ✅ |
| 283 Nueva EPS subsidiado | 2.642 | ✅ |
| 473 Sura contributivo | 2.363 | ✅ |
| 489 Nueva EPS PyP | 1.439 | ✅ |
| 476 Salud Total contributivo | 979 | ✅ |
| 535 Sura evento | 681 | ✅ |
| 538 Salud Total evento | 623 | ✅ |
| 97 Sura evento contributivo | 393 | ✅ |
| **518** | **338** | ❌ **sin homologar** |
| 96 Salud Total evento contributivo | 154 | ✅ |
| **529** | **43** | ❌ sin homologar |
| 26 Particular | 41 | ✅ |

Confirma la respuesta del hospital del 2026-09-04.

**Dentro del pozo `MDD1`+`MDD2`** —que es lo que de verdad se venderá por
WhatsApp— el reparto de las 1.908 citas del trimestre es:

| Convenio | Citas en el pozo | % |
|---|---:|---:|
| 467 Sura subsidiado | 575 | 30% |
| 475 Salud Total subsidiado | 533 | 28% |
| 283 Nueva EPS subsidiado | 352 | 18% |
| 473 Sura contributivo | 283 | 15% |
| 476 Salud Total contributivo | 111 | 6% |
| **518 (sin homologar)** | **50** | **2,6%** |
| 26 Particular y otros | 4 | 0,2% |

**Los dos convenios del piloto (Sura y Salud Total) cubren el 79% del pozo.**
Hay masa crítica de sobra para arrancar.

**Pendiente:** identificar el convenio **518** — 338 citas en el hospital y 50
en el pozo. Para un paciente de esa EPS, `resolveConvenio` lanza a propósito y
la cita no se puede agendar. Con el alcance de dos convenios no es bloqueante,
pero conviene dejarlo documentado.

### 7. ✅ La carga de cancelaciones justifica el canal

En 90 días: **21.144 citas y 2.409 anulaciones (11,4%)**. De esas, **2.134
(88,6%) son motivo `05` — "PACIENTE LLAMA A CANCELAR"**: unas **24 llamadas
diarias** que hoy atiende una persona al teléfono y que el bot puede absorber
sin intervención.

El motivo `WB` ("CANCELADO WEB"), que es el que escribe nuestro driver, ya
existe y registra 4 usos en producción en los últimos 90 días. Como no es
exclusivo nuestro, para distinguir las cancelaciones de AgenIA hay que
filtrar además por `DE_DESC_CIAN LIKE '%ASIGNADA POR WHATSAPP%'`.

### 10. 🔴 Las cancelaciones del hospital liberan el cupo pero NO avisan a la lista de espera

**Este es el hallazgo que más pesa para arrancar con un 30% de la agenda.**

Con ~31 cupos semanales, la lista de espera deja de ser un caso de borde y pasa
a ser **la experiencia principal** de la mayoría de pacientes. Lo que la hace
funcionar es que se drene: que cuando un cupo se libere, alguien de la lista se
entere.

Hoy se drena solo a medias. `notifyWaitlist` se invoca desde
`chatbot.service.ts` cuando **el paciente cancela por WhatsApp**, pero
**`mirror-apply.service.ts` no la llama nunca**. Su `applyAppointmentCancel`
marca la cita `CANCELLED` y pone el cupo en `isAvailable: true`… y ahí termina.
El cupo queda libre en silencio, para quien pase a conversar por casualidad.

Y es justo la fuente más grande: las cancelaciones nacen mayoritariamente en el
hospital, no en WhatsApp. Dentro del pozo `MDD1`+`MDD2` hubo **99 anulaciones en
90 días (~1,1 al día)**, frente a los ~4,4 cupos nuevos diarios que daría el 30%.

**Se está desaprovechando ~25% de la capacidad efectiva del canal**, y
precisamente la que llega en el último momento, que es la más valiosa para quien
lleva días esperando.

**✅ RESUELTO (2026-09-18).** `applyAppointmentCancel` llama ahora a
`avisarListaDeEspera` en las dos ramas que liberan el cupo, reutilizando el
mismo `notifyWaitlist` que ya usaba el chatbot. Tres decisiones de diseño que
conviene dejar escritas:

- **El aviso va fuera de la transacción y con su propio `try/catch`.** Es un
  efecto secundario: que WhatsApp esté caído no puede deshacer una cancelación
  ya aplicada ni dejarla a medias. Si el aviso falla se registra y el evento
  sigue contando como aplicado.
- **El cupo se relee antes de avisar.** Si entre la cancelación y el aviso
  alguien ya tomó la hora, avisar sería ofrecer un cupo que ya no está.
- **La cita que se busca en el cupo tiene que ser la VIGENTE.** Al hacer este
  cambio apareció un defecto latente: `findFirst` buscaba cualquier cita del
  cupo, sin filtrar por estado. Un cupo puede arrastrar citas canceladas como
  historia y tener encima una viva de otro paciente —la campaña dejó tres así—,
  de modo que la consulta podía devolver cualquiera de las dos y **cancelarle
  la cita a quien no era**. Ahora filtra por `status: { not: 'CANCELLED' }`.

Cubierto por cinco tests nuevos en `mirror-apply.service.spec.ts`.

### 9. 🟠 En producción, las citas de médicos NO homologados generarán ~200 errores diarios

**`PRUEBAS` no puede revelar esto** y por eso no apareció en la campaña: nadie
trabaja en la copia, así que allí no nacen citas nuevas.

La consulta de instantánea del driver **no filtra por médico**: trae todas las
filas de `CITAS_MEDICAS` de la ventana de 90 días. En producción el hospital
crea **~235 citas diarias**, la gran mayoría con médicos que AgenIA no tiene
homologados (las series `RU**`, `149`, `109`, `AP**`…). Cada una llega como
evento `INSERT`, y `applyAppointmentCreate` no encuentra cupo equivalente —
`resolverCupo` devuelve `null` porque no hay `MirrorEntityMap`— y **lanza**.

Lo mismo ocurre con sus cancelaciones (~24 diarias) en
`applyAppointmentCancel`.

No hay pérdida de datos ni reintentos infinitos: `applyBatch` atrapa el error,
deja una fila `ERROR` en `SyncAudit`, devuelve 200 y el agente avanza el cursor.
El problema es de **observabilidad**: unas 200 filas `ERROR` diarias por algo
que no está roto —no vendemos esos médicos, es correcto ignorarlos— sepultarían
un error de verdad. Es la tercera aparición del mismo antipatrón en este
informe: una alarma siempre en rojo deja de ser una alarma.

**El precedente para arreglarlo ya existe en el propio código.** Dos de los
tres caminos ya lo hacen bien:

| Camino | Médico sin homologar | Resultado |
|---|---|---|
| `ATTENDANCE` | resuelve a nada | `SKIPPED` + log ✅ |
| Salida `SLOT` | el driver no lo espeja | `SKIPPED` vía `skippedSeqs` ✅ |
| **`INSERT` entrante** | resuelve a nada | **lanza → `ERROR`** ❌ |
| **`CANCEL` entrante** | resuelve a nada | **lanza → `ERROR`** ❌ |

**✅ RESUELTO (2026-09-18).** `resolverCupo` ya no devuelve `ScheduleSlot | null`
—que confundía tres sucesos distintos en un mismo `null`— sino un resultado
etiquetado:

| Resultado | Significado | Desenlace |
|---|---|---|
| `MEDICO_NO_ESPEJADO` | el hospital agendó con un médico que no vendemos | **`SKIPPED`** — no está roto nada |
| `SIN_CUPO` | el médico SÍ está homologado pero falta el cupo | `ERROR` — laguna real del espejo |
| `EVENTO_INCOMPLETO` | llegó sin médico o sin hora | `ERROR` — evento mal formado |

La distinción importa: bajar los tres a `SKIPPED` habría tapado también el caso
que sí duele. El test que exigía `ERROR` para un médico sin homologar se cambió
a propósito, con la razón escrita al lado.

**Además, el desenlace ahora se audita de verdad.** Un evento omitido se
registraba en `SyncAudit` como `OK`, que es mentira por omisión: quien pregunte
"¿por qué esta cita del hospital no está en AgenIA?" necesita leer `SKIPPED`.
`APPLIED` se sigue escribiendo como `OK` a propósito, para no partir en dos la
serie histórica que consultan los tableros.

**Queda un caso hermano sin tocar:** los eventos entrantes de tipo `SLOT`,
`DOCTOR`, `PATIENT`, `SERVICE` y `EPS` devuelven `SKIPPED` pero se auditan como
`ERROR` (`applyOne`, rama "pendiente de Fase 2+"). Es el mismo antipatrón, pero
no hay evidencia de que esos eventos lleguen hoy —la disponibilidad viaja por
`/mirror/availability`, no por `/mirror/changes`— así que se deja anotado en vez
de cambiar una señal que nadie ha visto dispararse.

### 8. 🔵 `CD_CODI_ESP_TUME` está vacía en toda la agenda

Los 27 médicos con turnos futuros tienen `NULL` en la columna de especialidad
de `TURNOS_MEDICOS`. No se puede derivar la especialidad del turno; hay que
deducirla de las citas ya prestadas, que es lo que ya hace el driver. Sin
impacto, pero cierra esa vía para futuros diagnósticos.

## Fuera de alcance (no certificado)

- **Voz (bloque V).** No automatizable: requiere un `media.id` real de Meta.
  Queda pendiente de prueba manual.
- **Desenlace de atención** (`NU_ESTA_CIT` 0 → 1/2). `updateAttendance` está
  marcado como TODO de Fase 3 en el driver.
- **Servicios distintos de medicina general.** Fuera del contrato de esta fase
  por decisión del hospital. No se certifican y no deben activarse.
- **Convenios de evento / especialistas.** `resolveConvenio` lanza a propósito
  mientras no estén medidos; ningún especialista debe encenderse hasta
  entonces.

## Cierre operativo pendiente

1. Revertir `META_REQUIRE_SIGNATURE=false` en `/opt/agenia/.env.production` y
   recrear el contenedor `api`.
2. **Dejar habilitados solo los médicos de medicina general.** La campaña
   habilitó 14 médicos temporalmente; con el alcance contratado, el estado
   correcto para producción es exactamente tres:

   | AgenIA id | Médico | Clave HIS | Estado objetivo |
   |---|---|---|---|
   | `86020d43` | MEDICO DISPONIBLE HSVP 02 | `MDD2` | ✅ habilitado |
   | `28b8b94b` | MEDICO DISPONIBLE HSVP 01 | `MDD1` | ✅ habilitado |
   | `7ba5d033` | SEBASTIAN ALVEAR IMBACHI | `MD08` | ✅ habilitado (ya lo estaba) |
   | los otros 11 de la campaña | — | — | ❌ a `false` |
   | `4516503f` VICTOR QUINTERO | `R001` | — | ❌ `false` (sin agenda futura) |
   | `72620328` KAREN CUELLAR | `NU02` | — | ❌ `false` (nutrición, fuera de contrato) |

   No es el "revertir los 14" que decía la versión anterior: revertir `MDD1` y
   `MDD2` dejaría el servicio contratado sin un solo médico que lo venda.
3. Decidir la limpieza de los datos de prueba en `PRUEBAS`: 104 citas, 318
   inscripciones a lista de espera y ~300 perfiles sintéticos "Paciente
   DePrueba".
