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
| ➕ | **Alerta proactiva al staff** | Un funcionario llama al paciente | `escalateEmergency` → `sendOutboundForOrg(supportPhone)` |

Todo converge en `ChatbotService.escalateEmergency(...)`: deriva al paciente,
limpia la sesión, alerta al staff (best-effort) y audita.

## Qué queda registrado (auditoría)

Cada derivación crea un `InteractionLog` con
`status = 'EMERGENCY_ESCALATED'` y `metadata`:

- **`guardrail`** (`via`): qué capa detectó —
  - `EMERGENCY_REGEX` → regex sobre el texto (Capa 0).
  - `EMERGENCY_LLM` → flag `isEmergency` del LLM (Capa 1).
  - `EMERGENCY_TRANSCRIPT_REGEX` → regex sobre la transcripción del audio (Capa 2).
- **`staffAlerted`** (`true`/`false`): si Meta confirmó la entrega de la alerta
  al `supportPhone`. `false` NO significa que el paciente quedó desatendido: la
  derivación al 123 ya se envió y el caso queda visible en el panel.
- **`previousState`**: en qué punto del flujo se interrumpió.

**Panel:** `/dashboard/auditoria` ("Caja Negra"). Las emergencias aparecen como
🚑 *Posible emergencia médica* — críticas y accionables. El staff las contacta y
marca el seguimiento con "marcar como contactado".

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
- **`supportPhone` fijo o fuera de la ventana de 24h de Meta:** la alerta al
  staff puede no entregarse (`staffAlerted: false`). El respaldo es el panel de
  auditoría, siempre poblado. Mejora futura: `Organization.emergencyPhone` para
  una línea de urgencias dedicada por clínica.
- **La Capa 1 (LLM) es fail-open hacia `false`:** un proveedor que devuelva JSON
  sin el campo no marca emergencia. Por eso las capas regex (0 y 2) son la red
  que no se puede quitar.
