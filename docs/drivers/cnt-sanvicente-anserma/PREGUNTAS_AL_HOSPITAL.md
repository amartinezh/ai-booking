# Preguntas al hospital — lo que falta para poder arrancar

> **Para:** la agendadora, la coordinación de facturación y TI del E.S.E.
> Hospital San Vicente de Paúl (Anserma).
> **De:** el equipo de AgenIA.
> **Duración estimada:** una reunión de 45 minutos con la agendadora, más un
> correo a TI.
>
> Este documento no pide revisar código ni entender el sistema. Pide decidir
> **seis cosas** que solo el hospital sabe. Cada una está planteada con lo que
> ya medimos sobre sus propios datos, para que responder sea confirmar o
> corregir, no reconstruir de memoria.

---

## Contexto en tres frases

AgenIA agenda citas por WhatsApp y las escribe **directamente en su sistema**,
en `CITAS_MEDICAS`, igual que si las hubiera creado una agendadora. Ya funciona
de punta a punta: crea el paciente si no existe, agenda, y cancela dejando la
constancia en `CITAS_ANULADAS`.

Antes de abrirlo a pacientes reales necesitamos cerrar seis decisiones. Cinco
son de la agendadora y una es de TI.

---

## 🔴 PREGUNTA 1 — ¿Qué servicio le ponemos a una cita de WhatsApp?

Es la única que bloquea el arranque. Las demás pueden esperar.

### Lo que encontramos

Miramos 90 días de su agenda. **Un mismo turno de un médico atiende varios
servicios distintos** — en 3 de cada 4 turnos —, y `TURNOS_MEDICOS` no guarda
cuál: la columna de especialidad está vacía en los 1.223 turnos futuros.

Cuando un paciente agenda por WhatsApp tenemos que escribir un código de
servicio. Hoy escribimos **uno fijo por médico**, y eso puede no ser el que
corresponde.

### Lo bueno: casi nunca afecta la factura

Revisamos médico por médico. El convenio de facturación solo cambia si el
servicio cruza la frontera de **PyP** (promoción y detección temprana). Y eso
pasa en **6 médicos de 30**:

| | Médicos | Situación |
|---|---|---|
| 🟢 | **4** | Un servicio concentra ≥ 95 % de sus citas. Prácticamente no hay duda. |
| 🟡 | **20** | Varios servicios, pero **todos de la misma familia** y del mismo lado de PyP. **La factura sale bien**; solo el código puede ser impreciso. |
| 🔴 | **6** | Mezclan PyP y no-PyP de verdad. **Aquí la factura puede salir mal.** |

### Lo que sí necesitamos decidir

Marque una opción por bloque. Están ordenados por urgencia.

---

#### 🟢 Bloque 1 — Los cuatro casi inequívocos

| Médico | Servicio dominante | % |
|---|---|---|
| **76** MEDICO ATENCIÓN HTA | `S39141-1` Consulta ambulatoria control hipertensos | 98,4 % |
| **077** MEDICO ATENCIÓN HTA 2 | `S39141-1` Consulta ambulatoria control hipertensos | 95,2 % |
| **91-1** ENFERMERA CyD HSVP | `890201-CI` Citas de PyDT | 99,8 % |
| **91-2** ENFERMERA SALUD REPRODUCTIVA | `I890305PL` Control enfermería planificación familiar | 99,8 % |

- [ ] **Confirmo: por WhatsApp, con estos médicos, es siempre ese servicio.**
- [ ] Corrijo: ______________________________________________

> Con esto activamos los cuatro de inmediato. Son 9.400 citas cada 90 días, el
> grueso de su volumen.

---

#### 🟡 Bloque 2 — Los veinte donde la factura está a salvo

Aquí la duda es solo el código, no el dinero. En casi todos, el patrón es el
mismo: **primera vez / control / algo intermedio.**

| Familia | Médicos | Los servicios que usan | Reparto real |
|---|---|---|---|
| **Medicina general** | AP04, AP08, MD08, MD09, MDD1, MDD2, R001, RU64, RU66, RU67, RU69 | `S39141` general · `S39141-1` control hipertensos · `S39141-2` lectura de exámenes | general 62-93 % |
| **Higiene oral** | ACO2, HO02, HO03, HO04 | `997301-1` salud oral doble · `SSAO` salud oral · `990203` educación | doble 49-60 % |
| **Psicología** | PS06, PS08 | `S35102` valoración · `S35102-1` control · `S35104` psicoterapia | psicoterapia ~50 % |
| **Internista** | ES01 | `890266` primera vez · `890366` control | 1ª vez 45 % / control 55 % |
| **Ginecología** | ES03 | `890250` primera vez · `890350` control | 1ª vez 68 % / control 32 % |
| **Pediatría** | ES05 | `890283` primera vez · `890383` control | 1ª vez 38 % / control 63 % |
| **Nutrición** | NU02 | `890206` primera vez · `890306` control | 1ª vez 87 % / control 13 % |

**Nuestra propuesta:** que el chatbot le pregunte al paciente
**«¿es su primera vez con este profesional o es un control?»**. Es una pregunta
natural, el paciente la sabe responder, y resuelve sola la mayoría de estos
casos.

- [ ] **Sí, que el chatbot pregunte primera vez / control.** ← *lo que recomendamos*
- [ ] No, use siempre el servicio más frecuente de cada médico.
- [ ] Otra cosa: ______________________________________________

> ⚠️ Un caso que nos gustaría confirmar aparte: los médicos **76** y **077** son
> del programa de hipertensión y su código dominante es *control hipertensos*.
> Si un paciente que **no** está en el programa agenda con ellos por WhatsApp,
> ¿le corresponde igual ese código, o debería quedar como `S39141` general?

---

#### 🔴 Bloque 3 — Los seis que pueden facturar mal

| Médico | Qué mezcla | Parte en PyP |
|---|---|---|
| **77** MEDICO ATENCIÓN GESTANTE HTA | 12 servicios: gestante, planificación, infancia, hipertensos, general | 36 % |
| **80-1** MEDICO ATENCIÓN RIAS | Adulto, vejez, joven, adolescente (curso de vida) | 26 % |
| **OD07** Juan Felipe Mapura Mafla | 9 servicios de odontología + educación individual | 25 % |
| **OD05** Xiomara Castrillón Vargas | 8 servicios de odontología + educación individual | 25 % |
| **OD02** Andrés Cardona Franco | 9 servicios de odontología + educación individual | 20 % |
| **PS06** María Verónica Galeano | Psicología + valoración de gestante | 8 % |

En los tres odontólogos el problema es el mismo: `990203` **EDUCACIÓN
INDIVIDUAL POR ODONTOLOGÍA** es PyP y pesa un cuarto de sus citas, mezclado con
citas odontológicas normales.

- [ ] **Estos seis no entran al piloto por ahora.** ← *lo más seguro*
- [ ] Sí entran, y el chatbot debe ofrecer sus servicios como opciones al paciente.
- [ ] Caso por caso: ______________________________________________

---

### Y una que quizá no haya que preguntar

Dos especialistas usan pares de códigos con la **misma descripción** y distinto
sufijo:

- **ES01** (internista): `890266ESP` / `890266SUR`, `890366ESP` / `890366SUR`
- **ES03** (ginecología): `890250ESP` / `890250SUR`, `890350ESP` / `890350SUR`

Sospechamos que `SUR` = **Sura**, es decir que el código depende de la EPS del
paciente. Si es así, AgenIA lo resuelve sola: ya sabe la EPS al agendar.

- [ ] **Sí, `SUR` es para pacientes de Sura.**
- [ ] No, la diferencia es: ______________________________________________

> Tenemos una consulta (la G) que lo comprueba contra sus datos. Si sale
> concluyente, esta pregunta se cae sola.

## 🟠 PREGUNTA 2 — El consecutivo de sesión

### Lo que encontramos

Todas las citas que crea su sistema llevan un número en `NU_NUME_CONE_CIT`
(entre 1.256.579 y 1.288.377 en el último mes). **Ninguna lo tiene vacío.**

Vimos que ese número **agrupa varias citas**: hay consecutivos con 1 cita y
otros con hasta 110. Entendemos que identifica una *sesión de trabajo* de quien
está agendando.

### El problema

AgenIA no tiene sesiones: cada paciente escribe por WhatsApp cuando quiere. No
hay una "tanda de trabajo" a la que pertenezca su cita. Hoy dejamos ese campo
vacío, y **nuestras citas serían las únicas del sistema con ese campo en
blanco**.

### La pregunta

- [ ] **¿Alguno de sus informes agrupa o filtra por ese consecutivo?**
  Si la respuesta es sí, nuestras citas desaparecerían de esos informes y hay
  que buscar otra solución.
  - [ ] No, ninguno → dejamos el campo vacío. Es incluso útil: identifica las
        citas de WhatsApp.
  - [ ] Sí, el informe de ______________ → necesitamos que TI nos diga de dónde
        sacar un consecutivo válido (vimos las tablas `CONSECUTIVOS`,
        `SESION_APLICACION` y `CONEXION*`).

> ℹ️ Como referencia: las citas de AgenIA ya se distinguen porque llevan
> `"ASIGNADA POR WHATSAPP"` en el campo de descripción.

---

## 🟠 PREGUNTA 3 — Confirmar la tabla de convenios

### Lo que hicimos

Dedujimos de sus propios datos a qué convenio va cada cita, cruzando EPS +
régimen + si el servicio es de PyP. **No queremos que lo reconstruyan de
memoria: solo que confirmen que la tabla dice lo que debe decir.**

| EPS | Régimen | Servicio | Convenio que usaríamos | Coincide con sus datos en |
|---|---|---|---|---|
| Nueva EPS | Subsidiado | normal | **283** NUEVASUBSID | 89,6 % |
| Nueva EPS | Subsidiado | **PyP** | **489** PYPSUBS | 94,4 % |
| Nueva EPS | Contributivo | normal y PyP | **473** CONTRIBUTIVO | 73,4 % / 65,6 % |
| Sura | Subsidiado | normal y PyP | **467** SUBS | 84,5 % / 94,3 % |
| Sura | Contributivo | normal y PyP | **473** CONTRIBUTIVO | 84,8 % / 88,0 % |
| *(sin EPS)* | — | — | **26** PARTICULARES | — |

- [ ] **¿Es correcta?** Si algo no cuadra, señale la fila.

**Dos puntos que nos gustaría confirmar en voz alta:**

1. **Nueva EPS contributivo va al 473 `CONTRIBUTIVO`**, que en su catálogo
   figura a nombre de Suramericana. Sus datos dicen que ustedes lo usan como
   convenio genérico de contributivo para las dos EPS. El convenio 290
   `NUEVAEPSCONT` existe pero solo tiene **2 citas en 90 días**. ¿Confirmado
   que el 290 está en desuso?

2. **El PyP de Sura NO tiene convenio propio**: va al mismo de su régimen (467
   en el 94,3 % de 2.566 citas). Solo Nueva EPS subsidiado tiene un convenio de
   PyP aparte (489). ¿Es así?

> 📌 Encontramos y corregimos de paso un error nuestro: teníamos los NIT de
> Nueva EPS y Sura intercambiados. Ya está arreglado y verificado contra su
> tabla `EPS`.

---

## 🟡 PREGUNTA 4 — ¿Qué médicos entran al piloto?

Independiente de lo técnico, es una decisión de ustedes.

- [ ] **¿Con qué médicos quieren arrancar?** (nombres)
- [ ] **¿Cuántas citas por WhatsApp al día les parece razonable al principio?**
- [ ] **¿Hay algún servicio que prefieran que NO se agende por WhatsApp?**
      (por ejemplo, primeras veces que requieren triage, o programas que exigen
      remisión)

---

## 🟡 PREGUNTA 5 — Datos sucios en la agenda

### Lo que encontramos

**419 de 7.403 citas creadas en los últimos 30 días (5,7 %) tienen la hora en
un formato que no se puede leer**: valores como `'2026/08/29 1'` (cortado) o
`'31'`.

Ya adaptamos AgenIA para que las ignore sin fallar — antes una sola de esas
filas detenía la sincronización completa. Pero:

- [ ] **¿Saben de dónde salen esas filas?** ¿Es una importación antigua, un
      módulo que escribe distinto, un error conocido?
- [ ] **¿Les sirve que les pasemos la lista** para que las corrijan?

> ⚠️ Mientras existan, esas citas son invisibles para AgenIA: no las vemos al
> sincronizar ni aparecen en la comparación diaria. Si alguna es de un paciente
> real con cita futura, su cupo podría ofrecerse dos veces.

---

## 🔵 PREGUNTA 6 — Para TI, no para la agendadora

- [ ] **Ventana de mantenimiento del arranque.** Nos dijeron que los despliegues
      van en domingo. ¿Confirmamos un domingo concreto?
- [ ] **La VM del agente:** ¿ya está disponible? Solo necesita salida HTTPS, no
      recibe conexiones entrantes.
- [ ] **El usuario `agenia_sync`:** ¿se corrió ya `AGENIA_SYNC_SETUP.sql` contra
      la base de producción?
- [ ] **Rendimiento:** medimos que AgenIA lee su agenda cada pocos segundos.
      Confirmamos que usa el índice correcto de `CITAS_MEDICAS`
      (`FE_FECH_CIT`), pero nos falta el número exacto. ¿Nos pueden pasar la
      salida de `SET STATISTICS IO` de la consulta que les enviamos? Si les
      preocupa la carga, podemos bajar la frecuencia.

---

## Qué desbloquea cada respuesta

| Pregunta | Si la responden | Si no |
|---|---|---|
| **1** | Arrancamos con los 4 del bloque 1 (9.400 citas/90 días) y, si aprueban la pregunta al paciente, con los 20 del bloque 2 | No podemos activar a nadie con garantía de que el servicio quede bien |
| **2** | Cerramos el último campo del registro de cita | Nuestras citas podrían faltar en alguno de sus informes |
| **3** | La facturación queda confirmada por ustedes, no deducida por nosotros | Seguimos con una tabla deducida (que ya cuadra 18/18 con su catálogo de régimen) |
| **4** | Sabemos el alcance del arranque | — |
| **5** | Entendemos el origen y evaluamos si hay riesgo de sobreventa | Seguimos ignorando esas filas |
| **6** | Fecha de arranque | — |

---

## Lo que ya está resuelto (para su tranquilidad)

- ✅ Crear, cancelar y reagendar citas funciona de punta a punta contra un
  SQL Server con el esquema de ustedes.
- ✅ Los pacientes nuevos se dan de alta con nombre y apellidos en sus cuatro
  columnas, fecha de nacimiento y sexo.
- ✅ La cancelación borra de `CITAS_MEDICAS` y deja la constancia en
  `CITAS_ANULADAS` con motivo y observaciones.
- ✅ El consultorio se toma del turno del médico ese día — confirmado en el
  95,5 % de 2.965 citas.
- ✅ La especialidad (`CD_CODI_ESP_CIT`) se deduce del servicio y coincide con
  sus datos en 21.362 citas, sin una sola contradicción.
- ✅ Si el agente pierde la conexión con ustedes o con internet, se recupera
  solo y no pierde ninguna cita. Probado apagando y encendiendo cada pieza.
