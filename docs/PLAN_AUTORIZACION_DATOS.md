# Autorización de tratamiento de datos por chat (Ley 1581)

Estado: **construido el 2026-11-20, sin desplegar**. Nace apagado: ninguna clínica cambia hasta que su administrador lo encienda.

## 1. Qué se pide

Pedido del 2026-11-20: al inicio de las comunicaciones con los pacientes donde sea necesario y relevante, el asistente debe saludar con amabilidad, explicar la política de tratamiento de datos y preguntar si la persona está de acuerdo (SÍ/NO).

- **NO**: cerrar la comunicación con amabilidad.
- **SÍ**: iniciar el proceso y preguntarle qué necesita.
- **Cancelar o cambiar la fecha**: no hace falta preguntar, porque en algún momento ya respondió.
- **La respuesta**: guardarla para tenerla presente y llevarla a las estadísticas.

## 2. Cómo estaba

1. **El aviso llegaba tarde.** El párrafo de la Ley 1581 (`CONSENT_1581_*` en `apps/api/src/chatbot/chatbot.constants.ts`) iba en el resumen de la cita. El mismo SÍ confirmaba la cita y autorizaba los datos, y para entonces el asistente ya había pedido documento, nombre, nacimiento, sexo, régimen y EPS. La ley pide que la autorización sea previa (Ley 1581, art. 9). Para los datos de salud, además, debe ser explícita e informar que no es obligatorio darla (art. 6; Decreto 1377 de 2013, art. 6).
2. **No quedaba prueba.** `InformedConsent` existía en el esquema, pero nada lo escribía. El único rastro del SÍ era el texto de la conversación (`InteractionLog`), que se purga a los 180 días. El Decreto 1377, art. 8, exige conservar la prueba.
3. **La lista de espera no tenía aviso.** Al anotarse en la lista de espera se guardaba la ficha sin ningún aviso.
4. **Los formularios públicos no tenían aviso.** Las solicitudes de alta y de más citas pedían nombre, documento, teléfono y a veces datos de salud.
5. **El enlace era uno solo.** El enlace de la política estaba en el `.env` (`PRIVACY_POLICY_URL`), igual para todas las clínicas.

## 3. Decisiones (aprobadas el 2026-11-20, todas con la recomendación)

| # | Decisión |
|---|---|
| TD1 | Preguntar solo al ir a agendar. No al cancelar, cambiar la fecha o consultar, ni al responder mensajes del hospital (recordatorio, lista de espera, documentos, Bandeja). La emergencia siempre va primero. |
| TD2 | Una vez por número, por canal y por versión de la política. Si cambia la versión, se vuelve a preguntar. |
| TD3 | A quien ya agendó por el chat también se le pregunta una vez: su SÍ anterior fue después de dar los datos y su prueba se borra a los 180 días. |
| TD4 | El NO cierra con amabilidad, con el teléfono y la ventanilla. En la siguiente conversación se vuelve a preguntar. |
| TD5 | Retirar la autorización por chat con frases fijas, sin IA. |
| TD6 | A quien ya autorizó, el resumen de la cita va sin el párrafo legal. |
| TD7 | El texto lo redacta el equipo y lo aprueba la jurídica del hospital. El enlace y la versión de la política pasan a Configuración, por clínica. El interruptor nace apagado y se prueba antes por Telegram. |
| TD8 | Estadísticas en el panel (Canales en vivo) y una cifra en la página pública de estadísticas. |
| TD9 | Casilla de autorización obligatoria en los dos formularios web. |
| TD10 | El texto cubre a «las personas por quienes agenda (por ejemplo, sus hijos menores)». La jurídica del hospital lo confirma. |

## 4. Lo construido

### 4.1 El asistente (`apps/api`)

- **Estado nuevo** `ChatState.AWAITING_DATA_CONSENT`.
- **Dónde se pregunta** (`pedirAutorizacionSiFalta`):
  1. El saludo que abre el menú (`handleEscape`, también a mitad de un agendamiento).
  2. Lo que en reposo va a la cascada de agendar, justo después del aviso «sin agendar» y antes de guardar ningún dato.
  3. «Agendar otra» tras cancelar.
  4. «Agendar otra» desde «¿qué citas tengo?».
- **Qué se pregunta**: la primera vez, el aviso completo. Después, un recordatorio corto. Tras el aviso y 3 recordatorios en la misma conversación, se cierra con el teléfono y la ventanilla (`AUTORIZACION_DATOS.RECORDATORIOS`; Redis `autorizacion_datos:<org>:<remitente>`, 1 hora).
- **Cómo se lee la respuesta** (`respuestaAutorizacion`, en shared): es más estricta que el SÍ/NO del resto del chat. «Quiero una cita» no autoriza nada, «no entiendo» no es un NO y 👍 es SÍ.
  - Por escrito, se lee al comienzo del turno. Lo que no es SÍ ni NO se atiende como un mensaje nuevo en reposo; así, cancelar o consultar funcionan sin autorización.
  - Por voz, se lee después de transcribir.
- **SÍ**: «¡Gracias! ✅ Quedó registrada su autorización.» y el menú de servicios.
  - Si el mensaje que disparó la pregunta traía datos para agendar, por escrito el mismo turno sigue con ese mensaje (`text = r.texto`). No es un turno sintético: no vuelve a resolver la clínica ni duplica la actividad del canal.
  - Si el SÍ llega por voz, sigue con el menú.
- **NO**: el mensaje de despedida, cierre de la sesión, y la próxima vez se le vuelve a preguntar.
- **Retiro** (`pideRetirarAutorizacion`, solo con el interruptor encendido): queda una fila REVOKED, se corta lo que estuviera haciendo y se le dice cómo pedirle al hospital que corrija o borre sus datos.
- **Resumen de la cita**: los tres lugares donde se arma (`avisoLegalDelResumen`) omiten el párrafo legal, en texto y en audio, solo si ya autorizó con el interruptor encendido. Usan el enlace de la clínica o, sin él, el del servidor.
- **Servicio** `AutorizacionDatosService` (`apps/api/src/chatbot/autorizacion-datos.service.ts`). Es opcional en el asistente: sin él, o con el interruptor apagado, todo sigue igual.
  - Si la base falla al leer, cuenta como apagado.
  - Enlaza al paciente que se registra desde ese chat (`patientIds`) desde `ensurePatientPersisted`, sin frenar nunca la cita.

### 4.2 Base de datos (`20261120180000_autorizacion_datos`)

- **`OrganizationSettings`**:
  - `dataConsentEnabled`: false por defecto.
  - `dataPolicyUrl`.
  - `dataPolicyVersion`: «1» por defecto.
  - `dataConsentUpdatedAt` y `dataConsentUpdatedBy`.
- **`DataConsent`** (enum `DataConsentStatus`: PENDING, ACCEPTED, REJECTED, REVOKED). Una fila por pregunta, con:
  - canal, clave, teléfono y BSUID;
  - versión, enlace y texto exacto del aviso, y cuántas veces se preguntó;
  - respuesta: texto, vía y hora;
  - pacientes enlazados.
  - No entra en la purga de 180 días.
- **`EpsEnrollmentRequest` y `AppointmentLimitRequest`**: `dataConsentAt` y `dataConsentPolicyVersion`.

`InformedConsent` (historia clínica) no se tocó: rehacerlo para esto cambiaba una tabla ajena. Una tabla nueva es más segura.

### 4.3 Panel (`apps/web`)

- **Configuración › Asistente Virtual › «Autorización de datos (Ley 1581)»**:
  - el interruptor, el enlace y la versión, que se guardan con un botón;
  - la vista previa del mensaje exacto y el aviso al cambiar la versión;
  - el último cambio, también en la Actividad de usuarios (`DATA_CONSENT_CHANGED`).
  - No se enciende sin enlace.
- **Canales en vivo › «Autorización de datos»**: una sección aparte, del servidor, con período de 7, 30 o 90 días. No toca las cifras en vivo.
  - Cifras: se les preguntó, aceptaron, no aceptaron, no respondieron, esperando, % de aceptación, volvieron y aceptaron, retiraron.
  - Tablas por canal y por día.
- **Estadísticas para compartir**: la sección «Autorización de datos por chat», con quiénes autorizaron, quiénes no y quiénes la retiraron. Solo conteos.
- **Pacientes**: una columna «Autorización de datos» (autorizó, o la retiró, con la fecha).
- **Solicitud de alta y solicitud de más citas**: la casilla obligatoria con el enlace de la política. La acción la vuelve a exigir y guarda cuándo se marcó y con qué versión.

### 4.4 Shared (`packages/shared/src/autorizacion-datos.ts`)

- los textos, en tono formal e informal;
- la lectura del SÍ/NO y del retiro;
- las validaciones del enlace y la versión;
- las cifras por persona, por canal y por día.

## 5. Para encenderlo

1. Desplegar: la migración solo agrega columnas vacías y una tabla.
2. Llevar a la jurídica del hospital el texto del aviso. Está en Configuración, en «Ver el mensaje que recibe el paciente», y en `avisoAutorizacionDatos`. Si piden cambios, se cambian en `packages/shared/src/autorizacion-datos.ts`.
3. En Configuración › Asistente Virtual, escribir el enlace de la política del hospital. El del servidor hoy es `https://www.hospitalsanvicenteanserma.gov.co/transparencia/proteccion-datos-personales`. Comprobar que abra en un celular.
4. Probar por Telegram, o con un número de prueba:
   - saludar, decir SÍ y agendar;
   - decir NO;
   - «cancelar cita» sin autorizar;
   - «Retiro mi autorización».
5. Encender y revisar Canales en vivo a los 3 y a los 14 días: aceptación, «No respondieron» y si bajó la conversión de quienes escriben a quienes agendan.

## 6. Pendiente

- **Rastreo de paciente**: todavía no muestra la autorización. Pacientes sí la muestra.
- **Excel de autorizaciones**: para una auditoría de la Superintendencia de Industria y Comercio. Mientras tanto, la tabla `DataConsent` tiene todo.
- **Retiros**: no llegan solos al hospital. El asistente le dice a la persona que se comunique con el hospital para corregir o borrar sus datos. Si el hospital quiere un aviso, se puede dejar un caso en la Bandeja.
- **Documentos de la consulta**: el resumen de la atención no pide esta autorización. Sale de una plantilla del hospital y tiene su propia baja. La jurídica debe confirmar que la finalidad «enviarle información de su atención» del aviso lo cubre.
