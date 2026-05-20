# Guía completa: Cómo obtener tu **API Key de Google AI Studio (Gemini)** y conectarla a **AgenIA**

> **Para quién es esta guía:** personas de tu clínica que nunca han entrado a Google AI Studio y necesitan obtener la **API Key de Gemini** para que AgenIA pueda atender a tus pacientes por WhatsApp, entender lo que escriben y transcribir los dictados clínicos de tus médicos.
>
> **Tiempo estimado:** entre 10 y 20 minutos la primera vez. No necesitas saber programar. Solo necesitas una cuenta de Google y seguir los pasos en orden.

---

## Antes de empezar — la idea general (lee esto primero, 2 minutos)

**Google AI Studio** es la página oficial y gratuita de Google para crear las **llaves de acceso (API Keys)** a su inteligencia artificial **Gemini**.

- **Gemini** es el "cerebro" de IA de Google. Es **multimodal**: entiende texto y audio de forma nativa, por eso es el proveedor recomendado para el dictado clínico de tus médicos.
- Una **API Key** es una **contraseña larga** que le da permiso a un programa (en este caso **AgenIA**) para usar Gemini **en tu nombre**, contra tu cuenta de Google.

La idea es sencilla:

1. Entras a Google AI Studio con tu cuenta de Google.
2. Generas una API Key con un par de clics.
3. La copias y la pegas en AgenIA.
4. A partir de ahí, AgenIA usa Gemini para responder a tus pacientes 24/7.

Al final del proceso vas a tener **un solo dato** que pegarás en AgenIA:

| Dato | ¿Qué es? | ¿Para qué? |
|---|---|---|
| **API Key (Gemini)** | Una clave larga que normalmente empieza por `AIza…` y mide unos 39 caracteres. | Para que AgenIA pueda usar la IA de Google en tu nombre. |

> **Tranquilo:** es mucho más rápido que conectar WhatsApp. Te llevamos de la mano.

---

## Lo que necesitas tener a la mano antes de empezar

1. **Una cuenta de Google activa** (la del correo Gmail de la clínica, ej. `contacto@miclinica.com`, o una cuenta de Google Workspace corporativa).
   - Si no tienes, créala gratis en https://accounts.google.com/signup.
   - **Recomendación:** usa una cuenta **corporativa de la clínica**, no la personal del administrador. Así la llave no se pierde si esa persona se va.
2. **Un navegador** (Chrome, Edge, Firefox o Safari).
3. **Tu usuario Administrador de AgenIA**, para poder pegar la llave al final.

> **¿Tiene costo?** Google AI Studio ofrece un **nivel gratuito** (free tier) con un límite generoso de mensajes por minuto y por día, suficiente para empezar y para clínicas pequeñas. Si necesitas más volumen, puedes activar facturación (lo vemos en el Paso 6). Consulta los límites y precios actualizados en https://ai.google.dev/pricing.

---

## Paso 1 — Entrar a **Google AI Studio**

1. Abre tu navegador y entra a:
   **https://aistudio.google.com**
2. Si te pide iniciar sesión, hazlo con la **cuenta de Google de la clínica**.
   - Si ya estás logueado en Google en ese navegador, entrará directo.
   - Si tienes varias cuentas de Google abiertas, **fíjate bien arriba a la derecha** de cuál estás usando. La llave quedará ligada a esa cuenta.
3. La primera vez verás una pantalla de bienvenida de **Google AI Studio** y posiblemente un aviso de **términos de servicio**.

> **Ojo con la cuenta correcta:** si arriba a la derecha aparece tu foto/cuenta personal en lugar de la corporativa, haz clic en la foto → **"Agregar otra cuenta"** o **"Cambiar de cuenta"** y entra con la de la clínica antes de continuar.

---

## Paso 2 — Aceptar los términos de servicio

1. Google te mostrará una ventana con los **Términos de servicio de la API de Gemini**.
2. Marca la casilla de **"Acepto los términos de servicio"**.
   - Hay una segunda casilla opcional sobre recibir correos/novedades. Puedes dejarla sin marcar.
3. Clic en **"Continuar"** (o **"Continue"** si te aparece en inglés).

> Esto solo aparece la primera vez. Si ya habías entrado antes, AI Studio te lleva directo al panel.

---

## Paso 3 — Abrir la sección **"API Keys" (Claves de API)**

1. Ya dentro de AI Studio, mira el **menú lateral izquierdo**.
2. Busca y haz clic en la opción **"Get API key"** (Obtener clave de API) o **"API Keys"**.
   - También puedes ir directo a la URL: **https://aistudio.google.com/app/apikey**
3. Llegas a una pantalla titulada **"API keys"** con un botón azul/morado grande que dice **"Create API key"** (Crear clave de API).

> Si es tu primera vez, la lista de llaves estará vacía. Es normal.

---

## Paso 4 — Crear tu **API Key**

1. Haz clic en **"Create API key"** (Crear clave de API).
2. Google te puede preguntar sobre el **proyecto** al que asociar la llave. Tienes dos caminos:

### Opción A — Dejar que Google cree el proyecto por ti (recomendado para no-técnicos)

- Si te aparece un botón **"Create API key in new project"** (Crear clave de API en un proyecto nuevo), haz clic ahí.
- Google crea automáticamente un proyecto de Google Cloud por detrás. **No tienes que configurar nada más.**

### Opción B — Usar un proyecto existente

- Si tu clínica ya usa Google Cloud y tienes un proyecto, ábrelo en el desplegable y selecciónalo.
- Si no sabes qué es esto, usa la **Opción A**. Es lo más simple.

3. En 2–3 segundos, Google genera la llave y te muestra una ventana con la **API Key en grande**. Es una cadena larga que normalmente **empieza por `AIza…`**.

---

## Paso 5 — Copiar y guardar la llave (¡el dato más importante!)

1. En la ventana donde aparece la llave, haz clic en el ícono de **copiar** (📋) que está a su derecha.
2. **Pégala en un bloc de notas** (Notas de Mac, Bloc de notas de Windows) y rotúlala claramente:
   ```
   API Key de Gemini = AIza........................................
   ```
3. Guarda ese bloc de notas en un lugar **seguro**.

### ⚠️ Trátala como una contraseña

| Sí debes | No debes |
|---|---|
| Guardarla en un gestor de contraseñas o lugar privado. | Pegarla en chats, correos públicos o documentos compartidos. |
| Pegarla únicamente en AgenIA. | Subirla a redes sociales ni publicarla en tu sitio web. |
| Rotarla (regenerarla) si crees que se filtró. | Compartirla con personas ajenas a la clínica. |

> **¿Por qué tanto cuidado?** Quien tenga tu API Key puede consumir IA de Google **a tu nombre** y, si tienes facturación activada, podría generarte costos. Por suerte, **AgenIA la cifra con AES-256-GCM** antes de guardarla y nunca la muestra completa de nuevo.

> **Buena noticia:** a diferencia del token de WhatsApp, en Google **puedes volver a ver tus llaves** entrando de nuevo a https://aistudio.google.com/app/apikey. Si la pierdes, simplemente borras la vieja y creas una nueva.

---

## Paso 6 — (Opcional) Decidir entre **nivel gratuito** o **facturación**

Google te da dos modos de uso:

### Nivel gratuito (free tier) — recomendado para empezar

- No tienes que poner tarjeta de crédito.
- Tiene límites de **mensajes por minuto** y **por día**. Para una clínica pequeña suele ser más que suficiente.
- Si AgenIA recibe muchísimos mensajes en poco tiempo, podrías ver el error **"Quota exceeded"** (cuota excedida). Si eso pasa seguido, considera activar facturación.

### Nivel pagado (con facturación)

- Sube los límites de uso de forma drástica.
- Requiere asociar el proyecto a una **cuenta de facturación de Google Cloud** (tarjeta de crédito).
- Para activarlo: entra a https://console.cloud.google.com/billing, crea o vincula una cuenta de facturación al proyecto que usaste en el Paso 4.

> **Sugerencia:** empieza con el nivel gratuito. Solo activa facturación si ves errores de cuota de forma frecuente o si tu volumen de pacientes crece mucho.

---

## Paso 7 — Pegar la llave en **AgenIA**

Ya tienes el único dato que necesitas. Vamos a llevarlo a AgenIA.

1. Abre AgenIA en tu navegador (la URL que te dieron al darte de alta).
2. Inicia sesión con tu usuario **Administrador de Clínica**.
3. En el menú lateral, ve a **Configuración**.
4. Busca la sección **"Integración de IA"**.
5. En el selector de **"Proveedor activo"**, haz clic en la tarjeta de **"Google Gemini"** (ícono de destellos ✨, recomendado para dictado clínico).
6. Aparecerá el formulario de **Credenciales de Google Gemini**:
   - **API Key** → pega aquí la cadena `AIza…` que copiaste en el Paso 5.
   - **Modelo** → elige el modelo de Gemini que quieres usar (ver Paso 8).
7. Clic en **"Guardar integración"**.
8. Cuando veas el mensaje **"✅ Configuración guardada"**, la llave quedó cifrada y almacenada. Por seguridad, el campo se vacía y AgenIA solo te mostrará los últimos dígitos de la llave (`•••XXXX`).

---

## Paso 8 — Elegir el **modelo** de Gemini

AgenIA te deja elegir entre varios modelos de Gemini. Esta es la recomendación según tu caso:

| Modelo | Cuándo usarlo |
|---|---|
| **`gemini-2.5-flash`** | **Recomendado por defecto.** Rápido y económico. Ideal para chatear con pacientes por WhatsApp y agendar citas. |
| **`gemini-2.5-pro`** | Para razonamiento más complejo o respuestas más elaboradas. Un poco más lento y costoso. |
| **`gemini-1.5-flash`** | Alternativa más antigua y muy económica. Útil si quieres minimizar costos. |

> Si no estás seguro, deja **`gemini-2.5-flash`**. Es el equilibrio ideal entre velocidad, costo y calidad para una clínica.

---

## Paso 9 — Prueba final

1. Pídele a alguien (o usa tu propio celular) que le escriba un mensaje al WhatsApp de tu clínica, por ejemplo: `Hola, quiero agendar una cita`.
2. **Lo que debe pasar:** en unos segundos, AgenIA responde de forma natural y empieza a guiar al paciente. Esa respuesta la está generando **Gemini con tu API Key**.
3. Si entras a AgenIA → **Caja Negra (Auditoría)**, verás registrado el mensaje y la respuesta de la IA.

**Si la IA no responde o ves errores:**

- Revisa la sección **"Errores comunes"** más abajo.
- Lo más frecuente: la llave quedó mal pegada (con un espacio al inicio o al final) o el proveedor activo no es "Google Gemini".

---

## Datos de resumen — chuleta final

Cuando termines, tu bloc de notas debería verse así:

```
=== Datos para AgenIA (IA) ===
Proveedor:   Google Gemini
API Key:     AIza........................................
Modelo:      gemini-2.5-flash

=== Dónde regenerarla si la pierdes ===
https://aistudio.google.com/app/apikey
```

Guárdalo en un lugar **seguro**. La API Key funciona como contraseña: quien la tenga puede usar la IA de Google a nombre de tu clínica.

---

## Errores comunes y cómo resolverlos

### Al crear la llave (Paso 3–4)

| Síntoma | Causa | Solución |
|---|---|---|
| No veo el botón "Create API key" | Aún no aceptaste los términos. | Vuelve al Paso 2 y acepta los términos de servicio. |
| "You must accept the terms" | Falta aceptar términos en esa cuenta. | Marca la casilla de términos y reintenta. |
| Estoy en la cuenta de Google equivocada | Tenías varias sesiones abiertas. | Arriba a la derecha → cambia a la cuenta corporativa y crea la llave de nuevo. |

### Al pegar la llave en AgenIA (Paso 7)

| Síntoma | Causa | Solución |
|---|---|---|
| "API key not valid" / "Invalid API key" | La llave quedó mal copiada o tiene espacios. | Vuelve a copiarla desde AI Studio. Cuidado con espacios al inicio o final. |
| La IA no responde después de guardar | El proveedor activo no es "Google Gemini". | En Configuración → Integración de IA, asegúrate de que la tarjeta de Google Gemini esté marcada como "● Activo". |
| Guardé pero el campo aparece vacío | Es normal: por seguridad AgenIA vacía el campo tras guardar. | Si quieres confirmar, mira el "Estado actual": debe decir que la API key termina en •••XXXX. |

### Durante el uso (después de conectar)

| Síntoma | Causa | Solución |
|---|---|---|
| "Quota exceeded" / "Resource exhausted" | Superaste el límite gratuito de mensajes. | Espera unos minutos, o activa facturación (Paso 6) para subir el límite. |
| "Permission denied" / "API not enabled" | El proyecto no tiene habilitada la API de Gemini. | Crea la llave de nuevo con la Opción A del Paso 4 (proyecto nuevo), que la habilita automáticamente. |
| La IA responde lento | Estás usando `gemini-2.5-pro` con mucho texto. | Cambia el modelo a `gemini-2.5-flash` en AgenIA. |
| Empezó a fallar de un día para otro | Alguien borró o regeneró la llave en AI Studio. | Crea una llave nueva y vuelve a pegarla en AgenIA (Paso 7). |

---

## Preguntas frecuentes

**¿Esto tiene costo?**
El nivel gratuito de Google AI Studio no cuesta nada y suele alcanzar para clínicas pequeñas. Si activas facturación, pagas por uso (tokens) según las tarifas de Google. Consulta precios actualizados en https://ai.google.dev/pricing.

**¿Cuál es la diferencia entre Google AI Studio y Google Cloud / Vertex AI?**
Google AI Studio es la vía **más simple y directa** para obtener una llave de Gemini, pensada para empezar rápido. Vertex AI (en Google Cloud) es la versión empresarial avanzada. **Para AgenIA usa Google AI Studio.**

**¿Puedo usar mi cuenta personal de Gmail?**
Sí, funciona, pero **recomendamos una cuenta corporativa de la clínica**. Así la llave no se pierde si la persona deja la organización.

**¿Qué pasa si pierdo o borro la llave?**
No pasa nada grave. Entra a https://aistudio.google.com/app/apikey, crea una llave nueva y pégala en AgenIA. La vieja deja de funcionar al borrarla.

**¿Puedo cambiar de Gemini a ChatGPT o Claude después?**
Sí. AgenIA soporta varios proveedores. Solo entra a Configuración → Integración de IA, selecciona otro proveedor y pega su llave correspondiente.

**¿Google puede ver los datos de mis pacientes?**
AgenIA envía a Gemini solo el texto necesario para generar la respuesta. Revisa las políticas de privacidad de Google para la API de Gemini y asegúrate de cumplir la normativa de datos de salud de tu país. Para casos sensibles, consúltalo con tu equipo legal.

**¿La misma llave sirve para WhatsApp?**
No. Son cosas distintas: la **API Key de Gemini** es para la **inteligencia artificial**; el **Phone ID y Access Token** son para el **canal de WhatsApp** (esa es otra guía). Necesitas ambas para que AgenIA funcione completo.

---

## ¿Te quedaste atascado?

Si después de seguir esta guía algo no funciona:

1. **Toma un screenshot** de la pantalla donde estás bloqueado.
2. Entra a AgenIA → **Soporte** → **Crear ticket**.
3. Adjunta el screenshot y explica en qué paso de esta guía estás.
4. Nuestro equipo te responde en máximo 24 horas hábiles.

¡Bienvenido a AgenIA! Con tu API Key de Gemini conectada, tu asistente virtual ya puede entender y responder a tus pacientes con la inteligencia de Google.
