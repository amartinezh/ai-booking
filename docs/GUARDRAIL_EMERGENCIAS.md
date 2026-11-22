# 🚑 Guardrail de emergencias médicas

Capa de seguridad del chatbot que detecta **posibles emergencias médicas** en el
mensaje del paciente y lo **deriva de inmediato** a la línea 123 / Urgencias /
equipo humano, en vez de meterlo al funnel de agendamiento.

## Postura ética (el "por qué")

El pipeline optimiza *completar el agendamiento*. Ese objetivo es el equivocado
cuando el mensaje trae una bandera roja clínica: una cita a días vista no es
respuesta para un posible infarto. El guardrail introduce **prudencia antes que
eficiencia**. Su contrato es mínimo y estricto:

- **Detectar y derivar.** El bot NO es dispositivo médico ni hace triage.
- **Nunca diagnosticar** ("es un infarto") **ni tranquilizar** ("no parece
  grave"). Ambas cosas están prohibidas por igual — el lenguaje es siempre
  condicional ("lo que me describe *podría* requerir atención inmediata").
- **Nunca demorar.** La derivación corta el agendamiento y no ofrece cupos.
- **Cerrar sin castigo.** La sesión se limpia; el paciente puede volver con
  *"Hola"*. No se le envía encuesta CSAT.

## Arquitectura — 4 capas + humano en el loop

Cada capa es una red de seguridad de la anterior. Ninguna depende de que la
siguiente funcione.

| # | Capa | Cubre | Dónde |
|---|------|-------|-------|
| 0 | **Regex determinista pre-LLM** | Texto con bandera roja en CUALQUIER estado (menús, pasos estrictos) | `emergencyRegex` ← sección `[emergency]` de `chatbot-patterns.txt` |
| 1 | **Flag `isEmergency` del LLM (Tarea D)** | Paráfrasis que el diccionario no enumera | `SCHEDULING_EXTRACTION_PROMPT` → los 3 providers |
| 2 | **Regex sobre la transcripción del audio** | Notas de voz con bandera roja aunque el LLM no marque el flag | chequeo post-LLM en `processIncomingMessageUnsafe` |
| 3 | **Regla 0 del prompt del RAG** | Preguntas tipo FAQ que describen síntomas | system prompt de `answerFAQ` |
| ➕ | **Alerta proactiva al personal** | Un funcionario llama al paciente | `escalateEmergency` → `AlertaEmergenciaService.avisar` (lista de Datos de la clínica, plantilla `EMERGENCY_ALERT`) |

Todo converge en `ChatbotService.escalateEmergency(...)`: deriva al paciente,
limpia la sesión, alerta al staff (best-effort) y audita.

## Qué queda registrado (auditoría)

Cada derivación crea un `InteractionLog` con
`status = 'EMERGENCY_ESCALATED'` y `metadata`:

- **`guardrail`** (`via`): qué capa detectó —
  - `EMERGENCY_REGEX` → regex sobre el texto (Capa 0).
  - `EMERGENCY_LLM` → flag `isEmergency` del LLM (Capa 1).
  - `EMERGENCY_TRANSCRIPT_REGEX` → regex sobre la transcripción del audio (Capa 2).
- **`staffAlerted`** (`true`/`false`): si Meta ACEPTÓ el envío de la alerta a al
  menos una persona. No es la entrega: Meta puede rechazarla después (pasó con las
  11 de Anserma, 131026). La entrega se lee en `WhatsappMessageLog` por
  `alertWamids`. `false` NO significa que el paciente quedó desatendido: la
  derivación al 123 ya se envió y el caso queda visible en el panel.
- **`alertChannel`** (`PLANTILLA`, `TEXTO` o `NINGUNO`), **`alertRecipients`**,
  **`alertAccepted`**, **`alertWamids`** y, si no salió a nadie, **`alertFailure`**.
- **`previousState`**: en qué punto del flujo se interrumpió.

**Panel:** `/dashboard/auditoria` ("Caja Negra"). Las emergencias aparecen como
🚑 *Posible emergencia médica* — críticas y accionables. El staff las contacta y
marca el seguimiento con "marcar como contactado".

## A quién le llega la alerta (2026-11-22)

`AlertaEmergenciaService` (`apps/api/src/chatbot/alerta-emergencia.service.ts`):

- **A quién:** la lista de Configuración › Datos de la clínica › Alertas de posible
  emergencia (`EmergencyAlertRecipient`, hasta 5 activas, solo celulares de
  Colombia). Sin nadie en la lista, al `supportPhone` solo si es un celular.
- **Cuándo:** siempre, a cualquier hora. Una emergencia no espera al horario laboral.
- **Con qué:** la plantilla `EMERGENCY_ALERT`, que sale aunque la persona nunca le
  haya escrito al asistente. Sin la plantilla registrada, texto libre (WhatsApp solo
  lo entrega dentro de las 24 h desde el último mensaje de esa persona).
- **Si no sale a nadie:** alerta técnica `ALERTA_EMERGENCIA_NO_SALE` (sin datos del
  paciente) al grupo del equipo técnico.
- **Probar:** «Enviar prueba» en la misma pantalla, con un texto de PRUEBA.

**La plantilla de Meta** (categoría Utilidad, español de Colombia, nombre sugerido
`alerta_posible_emergencia`, sin encabezado ni botones, pie «Aviso automático del
asistente virtual»). El cuerpo vive en `CUERPO_PLANTILLA_EMERGENCIA`
(`packages/shared/src/alertas-emergencia.ts`) y la pantalla lo muestra con un botón
para copiarlo:

```
🚨 *Alerta de posible emergencia médica*

Un paciente le escribió al asistente virtual algo que podría ser una emergencia, y el asistente le indicó llamar al 123 o ir a Urgencias.

Cuándo: {{1}}
Teléfono del paciente: {{2}}
Lo que escribió: {{3}}

Por favor llámelo cuanto antes para hacer el seguimiento y anote el resultado en la Caja Negra del panel de AgenIA.
```

Ejemplos para Meta: `{{1}}` «sábado, 21 de noviembre a las 11:22 p. m.», `{{2}}`
«+57 312 345 6789», `{{3}}` «Tengo un dolor muy fuerte en el pecho y me falta el
aire». Las variables se limpian de saltos de línea y espacios seguidos (Meta los
rechaza dentro de una variable).

**Datos del paciente en la alerta.** A diferencia de los avisos a los agendadores
(sin datos del paciente), esta lleva su teléfono y lo que escribió: sin eso nadie
puede llamarlo ni juzgar la urgencia. Es tratamiento de un dato sensible para
proteger el interés vital del titular (Ley 1581, art. 6), y va solo a las personas
que la clínica eligió.

## Qué cuenta como emergencia para la IA (2026-11-22)

Revisión de las 11 derivaciones de Anserma del 22-oct al 21-nov (todas por la
Capa 1, ninguna por el diccionario): **una** era una emergencia en curso («me estoy
ahogando mucho»); **cuatro** eran de pacientes que ya estaban en Urgencias o en
ambulancia y solo querían cancelar la cita (el 123 les cortó la cancelación; el
hospital la hizo a mano al día siguiente); **cinco** eran enfermedades conocidas por
las que pedían cita, autorización o visita domiciliaria (presión alta de una adulta
mayor, trombos, un brazo inmovilizado, una mano dormida tras pasar por Urgencias,
exámenes que «salieron mal»); **una**, dengue con vómito de quien no podía ir a su
cita. Se agregaron al prompt de agendamiento:

- a la regla 2: una enfermedad ya conocida por la que pide cita, autorización,
  resultados o visita domiciliaria, sin un síntoma agudo nuevo, no es emergencia;
- la regla 4: quien cuenta que YA lo están atendiendo o ya lo atendieron y pide
  cancelar, cambiar o sacar una cita no es emergencia, salvo que describa un síntoma
  agudo que tiene AHORA sin atención («ayer fui a urgencias y hoy no puedo respirar»).

La regla 3 («ante duda razonable con un síntoma AGUDO, prefiere true») no cambia.

**Casos delicados que NO son emergencia** (falso negativo visto el 31-oct: una
gestante escribió «por un sangrado y una negligencia médica perdí a mi bebé» y el
asistente le mostró el menú de servicios). Hoy ninguna capa los detecta ni avisa a
nadie. Pendiente: una marca aparte de la IA («caso sensible») que no mande al 123 ni
corte la conversación, y avise a la persona de atención al usuario.

## Runbook — afinamiento periódico (la evaluación continua)

El objetivo es subir la sensibilidad sin disparar los falsos positivos. Revisar
los logs `EMERGENCY_ESCALATED` con periodicidad (semanal sugerido):

1. **Cazar falsos negativos (lo crítico).** Filtrar por `via = EMERGENCY_LLM`:
   son casos que SOLO el LLM atrapó. Si una redacción se repite (ej. un modismo
   local para "me falta el aire"), **agregarla a `[emergency]`** para que la
   capa determinista la cubra sin depender del LLM. Revisar además reclamos o
   incidentes reportados por las clínicas: ¿hubo un mensaje de bandera roja que
   NINGUNA capa atrapó? Esa frase entra al diccionario y al dataset.
2. **Vigilar falsos positivos.** Buscar derivaciones sobre síntomas claramente
   crónicos/leves ("me duele el pecho al correr hace meses, quiero cardiología").
   Si un patrón genera fricción recurrente, afinar la frase del diccionario
   (más específica) — **nunca** a costa de perder un caso agudo.
3. **Cerrar el loop con el dataset.** Toda frase nueva (positiva o negativa) se
   agrega al golden dataset (ver abajo) ANTES de tocar el diccionario, para que
   quede fijada como regresión.

## Cómo editar el diccionario con seguridad

Archivo: `apps/api/src/chatbot/chatbot-patterns.txt`, sección `[emergency]`.

- Las frases se comparan **normalizadas**: minúsculas, sin tildes, puntuación
  colapsada a espacios. Escribir la variante **sin tilde** (`convulsion`, no
  `convulsión`); cubre ambas.
- El match es por frase contenida, delimitada por espacios/inicio/fin. Preferir
  frases de 2-4 palabras específicas del síntoma.
- ⛔ **No agregar** `urgente` / `urgencia` / `cita urgente`: los pacientes las
  usan para pedir prontitud, no para reportar síntomas.
- ⛔ **Cuidado con las colisiones**: `no puedo mover` chocaría con "no puedo mover
  la cita" (reprogramación). Verificar contra los negativos del dataset.
- Tras editar, el servicio recarga en frío al reiniciar, o en caliente vía
  `reloadPatterns()`.

## Dataset de evaluación (golden dataset)

`apps/api/src/chatbot/chatbot.service.spec.ts` →
`describe('FASE 5 — dataset de evaluación ...')`.

Ejercita `isEmergencyText` contra el diccionario **real** (`reloadPatterns()`)
con una batería de positivos (una bandera roja por categoría clínica) y
negativos (las exclusiones deliberadas). Corre en cada `pnpm --filter api test`.
Editar `[emergency]` sin actualizar este dataset es lo que la suite está para
impedir: si una edición tumba una categoría, un test falla.

```bash
pnpm --filter api test -- chatbot.service
```

## Gaps conocidos

- **Audio en pasos estrictos** que no son SÍ/NO ni selección por letra: se
  rechaza sin transcribir ("por favor escríbame"). Si el paciente escribe la
  bandera roja, la Capa 0 la atrapa; por voz en ese punto, no.
- **Sin lista ni plantilla:** la alerta al personal no llega (con un fijo de
  soporte, a nadie; con texto libre, solo a quien escribió en 24 h). El respaldo es
  la Caja Negra, siempre poblada, y la alerta técnica si no salió a nadie.
- **Rechazo posterior de Meta** (Meta acepta y luego dice FAILED): no abre alerta
  técnica; se ve en el estado de cada persona en Datos de la clínica.
- **La Capa 1 (LLM) es fail-open hacia `false`:** un proveedor que devuelva JSON
  sin el campo no marca emergencia. Por eso las capas regex (0 y 2) son la red
  que no se puede quitar.
