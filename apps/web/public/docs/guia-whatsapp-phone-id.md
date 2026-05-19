# Guía completa: Cómo conectar tu WhatsApp a **AgenIA**

> **Para quién es esta guía:** personas de tu clínica que nunca han usado el panel de Meta / Facebook for Developers y necesitan obtener el **WhatsApp Phone ID** y el **Access Token** para que AgenIA pueda chatear con tus pacientes y agendar citas automáticamente.
>
> **Tiempo estimado:** entre 25 y 45 minutos la primera vez. No necesitas saber programar. Solo necesitas seguir los pasos en orden.

---

## Antes de empezar — la idea general (lee esto primero, 2 minutos)

WhatsApp Business y la **API de WhatsApp** son dos cosas distintas:

- **WhatsApp Business** (la app del celular) es para chatear manualmente desde tu teléfono.
- **WhatsApp Business API** (lo que vamos a configurar hoy) es un "canal de programa" que permite que un sistema como **AgenIA** envíe y reciba mensajes automáticamente en nombre de tu institución de salud, 24/7, sin que nadie tenga que estar mirando el celular.

Para usar la API, **Meta** (la empresa dueña de Facebook, Instagram y WhatsApp) te pide tres cosas:

1. Una **cuenta de Facebook personal** (es solo para identificar quién es el dueño técnico — no se publica nada).
2. Una **cuenta empresarial de Meta** (Meta Business Suite) que represente a tu institución.
3. Una **App de desarrollador** dentro de Meta for Developers donde se conecta WhatsApp.

Al final del proceso vas a tener tres datos que pegarás en AgenIA:

| Dato | ¿Qué es? | ¿Para qué? |
|---|---|---|
| **Phone Number ID** | Un número largo (15–17 dígitos) que Meta asigna a tu línea de WhatsApp. | Para que AgenIA sepa **desde qué número** mandar mensajes. |
| **Access Token** | Una contraseña larga (empieza por `EAA…`). | Para que Meta le permita a AgenIA enviar mensajes en tu nombre. |
| **Verify Token** | Un texto secreto inventado por ti (o generado por AgenIA). | Para que Meta y AgenIA se reconozcan mutuamente al recibir mensajes. |

Tranquilo: te vamos a llevar de la mano para conseguir cada uno.

---

## Lo que necesitas tener a la mano antes de empezar

1. **Una cuenta de Facebook personal activa.** Si no tienes, créala en https://facebook.com (es gratis, toma 5 minutos).
   - No vas a publicar nada con esta cuenta; Meta solo la usa para saber quién es la persona o institución responsable de la integración.
   - Recomendación: úsala con el correo corporativo del administrador de la clínica.
2. **Un correo electrónico corporativo de la institución** (ej. `contacto@miclinica.com`). Evita usar Gmail/Hotmail personales para esto.
3. **Un número de celular nuevo o disponible** que **NO** esté usándose en la app móvil de WhatsApp ni en WhatsApp Business.
   - Importante: si vas a usar tu número actual de la clínica, primero debes **eliminar la cuenta de WhatsApp de ese número** desde la app del celular (Ajustes → Cuenta → Eliminar mi cuenta). Si no lo haces, Meta no te dejará registrarlo en la API.
   - Si prefieres no tocar el número actual, **compra una línea nueva** dedicada a AgenIA. Cualquier operador (Claro, Movistar, Tigo, etc.) sirve. Una SIM virtual también funciona.
4. **El nombre legal de la clínica** tal como aparece en la Cámara de Comercio.
5. **Documentos opcionales (más adelante)** para verificación empresarial: RUT, certificado de existencia, factura de servicios públicos del local. No los necesitas para empezar, pero sí para mover más volumen después.

---

## Paso 1 — Crear o entrar a tu cuenta de **Meta for Developers**

Meta for Developers es el panel desde donde se crean integraciones técnicas.

1. Abre tu navegador (Chrome, Edge, Firefox o Safari) y entra a:
   **https://developers.facebook.com**
2. En la esquina **superior derecha** verás un botón azul que dice **"Comenzar"** (o **"Get Started"** si te aparece en inglés). Haz clic.
3. Te pedirá iniciar sesión:
   - Si **ya estás logueado en Facebook** en ese navegador, se autocompleta.
   - Si **no**, te lleva a la pantalla de login normal de Facebook. Usa tu correo y contraseña.
4. La primera vez Meta te muestra una serie de pantallas de bienvenida:
   - **"Aceptar las políticas para desarrolladores"** → marca la casilla y dale en **"Aceptar"**.
   - **"Verifica tu cuenta"** → te puede pedir un código por SMS al número que tienes en Facebook, o por correo. Sigue lo que diga.
   - **"¿Cuál es tu rol?"** → escoge **"Desarrollador"** y dale en **"Completar registro"**.

   > Esto NO te convierte literalmente en programador. Es solo el "tipo de cuenta" que Meta usa internamente para mostrarte el panel correcto.

5. Al terminar, llegas al **Dashboard de Meta for Developers**. Deberías ver un texto que dice algo como **"Mis aplicaciones"** y un botón **"Crear app"**.

> **¿Te bloqueó el sistema pidiéndote teléfono?** Meta a veces pide un número celular para verificar la cuenta. Es normal y obligatorio. Usa tu celular personal aquí, no el de la clínica. Es independiente del número que vas a usar para WhatsApp.

---

## Paso 2 — Crear tu cuenta de **Meta Business Suite** (cuenta empresarial)

Esto representa a tu institución como empresa dentro del ecosistema de Meta. Es distinto al perfil personal de Facebook.

1. Abre una **pestaña nueva** y entra a:
   **https://business.facebook.com**
2. Haz clic en **"Crear cuenta"** (esquina superior derecha; si ya hay sesión abierta, el botón puede llamarse **"Crear una cuenta empresarial"**).
3. Te aparece un formulario corto:
   - **Nombre de la empresa:** escribe el nombre legal de tu clínica. **Importante:** este nombre lo verán los pacientes en WhatsApp, así que escríbelo bien (mayúsculas y minúsculas correctas).
   - **Tu nombre completo:** tal como aparece en tu cédula.
   - **Correo de la empresa:** usa el corporativo, no el personal.
4. Clic en **"Siguiente"**.
5. Meta te enviará un correo a esa dirección con un botón **"Confirmar correo"**. Ábrelo y confírmalo. Si no llega en 5 minutos, revisa la carpeta de Spam.
6. Vuelve a Business Suite. Ahora verás un panel con el nombre de tu institución arriba.

> **¿Ya tenías un Business Manager creado?** Puedes saltarte este paso y simplemente entrar al existente. Solo necesitas ser **administrador** dentro de él.

### Verificación rápida

Ve al menú lateral izquierdo → **Configuración** (ícono de engranaje, abajo). Confirma que:

- El **nombre del negocio** sea el correcto.
- Tu correo aparezca como **administrador**.

Si algo está mal, haz clic en **"Información del negocio"** para editarlo antes de continuar.

---

## Paso 3 — Crear la **App** en Meta for Developers

Una "App" en este contexto es básicamente un proyecto técnico al que se le conectan productos de Meta (WhatsApp, Instagram, Facebook Login, etc.). Vamos a crear una solo para AgenIA.

1. Vuelve a la pestaña de **Meta for Developers** (https://developers.facebook.com/apps).
2. Clic en **"Crear app"**.
3. Te muestra una pantalla **"¿Qué quieres hacer con tu app?"** con varias opciones (Autenticar, Conectar Instagram, etc.).
   - Baja hasta la opción **"Otro"** y selecciónala.
   - Clic en **"Siguiente"**.
4. Te pregunta **"Selecciona el tipo de app"**. Escoge **"Negocios"** (Business). Clic en **"Siguiente"**.
5. Pantalla **"Proporciona detalles"**:
   - **Nombre de la app:** algo identificable, por ejemplo `AgenIA - Clínica del Sol`. No es público, solo lo verás tú.
   - **Correo de contacto de la app:** usa el corporativo de la clínica.
   - **Cuenta empresarial:** abre el desplegable y selecciona la que creaste en el Paso 2.
6. Clic en **"Crear app"**.
7. Meta te pedirá tu contraseña de Facebook otra vez para confirmar (y a veces un captcha). Es por seguridad. Ingrésala.

> **¿Te dio error "Necesitas verificar tu cuenta"?** Significa que Meta exige que tu cuenta de desarrollador tenga al menos una verificación adicional (teléfono o tarjeta de crédito de prueba sin cobro). Sigue las instrucciones que muestra en pantalla.

Al terminar, llegas al **Panel de la App**. En el menú lateral izquierdo aparecen las categorías de productos que puedes agregar (Facebook Login, WhatsApp, Marketing API, etc.).

---

## Paso 4 — Agregar el producto **WhatsApp** a tu app

1. En el panel de la App, busca la sección **"Agregar productos a tu app"** (suele estar en el centro de la pantalla principal).
2. Encuentra la tarjeta **"WhatsApp"** (logo verde con globo de chat).
3. Clic en **"Configurar"** dentro de esa tarjeta.
4. Te llevará a una nueva pantalla de bienvenida de WhatsApp Business Platform. Dale clic en **"Comenzar"** o **"Start using the API"**.
5. Meta te pide asociar la app a tu cuenta empresarial:
   - **Selecciona tu cuenta de Meta Business** (la del Paso 2) en el desplegable.
   - Clic en **"Continuar"**.
6. Meta creará automáticamente para ti:
   - Una **WhatsApp Business Account (WABA)**.
   - Un **número de prueba** (test number) con saldo gratis limitado, para que puedas probar antes de conectar tu número real.

Ahora en el menú lateral izquierdo, debajo de **"WhatsApp"**, verás varios sub-elementos:

- **Quickstart** o **Empezar**
- **API Setup** (Configuración de API)
- **Configuración** (Configuration)
- **Plantillas de mensajes** (Templates)

> Si no ves estos elementos, refresca la página (F5). A veces Meta tarda 10–20 segundos en mostrar el menú actualizado.

---

## Paso 5 — Encontrar y copiar tu **Phone Number ID** (¡el dato más importante!)

Esta es la pantalla clave de toda la guía. Léela con calma.

1. En el menú izquierdo de la App, haz clic en **WhatsApp → API Setup** (también puede aparecer como **"Configuración de API"** o **"Inicio rápido"**).
2. Llegas a una pantalla titulada algo como **"Send and receive messages"** (Enviar y recibir mensajes). Verás un esquema parecido a este:

   ```
   ┌───────────────────────────────────────────────────────────┐
   │  From (desde)                                             │
   │  ┌─────────────────────────────────────────────────────┐  │
   │  │  ▼  +1 555 123 4567 — Test number                   │  │
   │  └─────────────────────────────────────────────────────┘  │
   │                                                           │
   │  Phone number ID:           123456789012345    [Copiar]   │  ← ESTE
   │  WhatsApp Business Account ID: 987654321098765 [Copiar]   │
   │                                                           │
   │  To (a)                                                   │
   │  ┌─────────────────────────────────────────────────────┐  │
   │  │  Agregar número de prueba                           │  │
   │  └─────────────────────────────────────────────────────┘  │
   └───────────────────────────────────────────────────────────┘
   ```

3. Lo que necesitas es el texto que está **al lado derecho de "Phone number ID"**. Son entre **15 y 17 dígitos**, ejemplo: `123456789012345`.
4. Clic en el ícono de **copiar** (📋) que aparece a su derecha.
5. **Pégalo en un bloc de notas** (Notas de Mac, Bloc de notas de Windows, etc.) y rotúlalo claramente: `Phone Number ID = 123456789012345`.

### ⚠️ Evita estas confusiones comunes

| Lo que NO es el Phone Number ID | Cómo se ve | Por qué no |
|---|---|---|
| El número telefónico visible | `+1 555 123 4567` | Eso es solo la representación humana del número, no su ID interno. |
| WhatsApp Business Account ID (WABA ID) | Otro número similar, justo debajo | Identifica la cuenta empresarial, no la línea. |
| App ID | Aparece en otra pantalla, arriba | Identifica tu app, no la línea. |

> **Regla mnemotécnica:** El Phone Number **ID** siempre está pegado a un **número de teléfono** en la pantalla. Si no ves un número de teléfono cerca, no es el ID correcto.

---

## Paso 6 — Decidir si usas el **número de prueba** o tu **número real**

Meta te regala un número de prueba que sirve para que pruebes AgenIA sin gastar nada, pero tiene dos limitaciones grandes:

- Solo puedes enviar mensajes a **5 destinatarios** pre-aprobados (los tienes que registrar uno por uno en la sección "To").
- **No puedes recibir mensajes entrantes** de cualquier persona — solo de los 5 destinatarios.

### Opción A — Empezar con el número de prueba (recomendado para probar)

- Está perfecto si solo quieres ver cómo funciona AgenIA antes de comprometer tu línea oficial.
- Para agregar destinatarios: en la misma pantalla **API Setup**, baja hasta **"To"** → **"Add phone number"** → ingresa el celular de quien va a recibir el mensaje de prueba (por ejemplo el tuyo).
- Meta enviará un código de verificación por WhatsApp al destinatario; tiene que ingresarlo en la página.
- Una vez verificado, ese número podrá recibir mensajes de tu cuenta de prueba.

Si eliges esta opción, **el Phone Number ID que copiaste en el Paso 5 ya te sirve**. Salta directo al Paso 8.

### Opción B — Conectar el número real de tu clínica

Es lo que vas a necesitar en producción. Sigue el Paso 7.

---

## Paso 7 — (Opcional pero recomendado en producción) Conectar **tu número real**

1. En la misma pantalla **API Setup**, encuentra la sección **"From"** y al lado del selector verás un enlace **"Add phone number"** (Agregar número de teléfono). Haz clic.
2. Se abrirá un formulario. Llena cada campo así:
   - **Nombre para mostrar / Display name:** el nombre con el que tus pacientes ven a tu clínica en WhatsApp. Ejemplo: `Clínica del Sol`. Reglas de Meta:
     - Mínimo 3 caracteres, máximo 60.
     - No puede tener mayúsculas seguidas (`CLINICA` no se acepta).
     - No puede ser solo emojis o un nombre genérico ("WhatsApp Business" tampoco).
     - Tiene que **coincidir con tu marca real** (Meta lo revisa manualmente más adelante).
   - **Categoría:** elige **"Salud"** (Healthcare).
   - **Descripción del negocio:** opcional pero recomendado. Ej.: *"Clínica especializada en medicina general y odontología. Agenda tu cita con nuestra asistente virtual AgenIA."*
   - **Sitio web:** la URL de tu clínica si tiene; si no, pon el sitio donde se ven tus servicios (Facebook o Instagram también valen).
3. Clic en **"Siguiente"** (o **"Next"**).
4. Pantalla **"Verifica tu número"**:
   - **Código de país:** desplegable, escoge Colombia (+57) u el que corresponda.
   - **Número de teléfono:** sin el código de país, solo los 10 dígitos (ej. `3001234567`).
   - **Método de verificación:** elige **"Mensaje de texto (SMS)"** si el número es móvil. Si es fijo o no recibe SMS, elige **"Llamada de voz"**.
5. Clic en **"Enviar código"**.
6. En 30 segundos o menos, recibirás un **código de 6 dígitos** por SMS o llamada automática.
7. Ingrésalo en el cuadro que muestra Meta y dale en **"Verificar"**.
8. ¡Listo! Tu número real aparece ahora en el selector **"From"** del Paso 5.
9. **Selecciónalo** en el desplegable y **vuelve a copiar el Phone Number ID** (será diferente al del número de prueba). Actualiza tu bloc de notas con este nuevo valor.

### ¿Te dio error en este paso?

| Mensaje | Significa | Solución |
|---|---|---|
| "This phone number is already registered with WhatsApp" | El número aún tiene cuenta en la app móvil. | Abre WhatsApp en el celular del número → Ajustes → Cuenta → Eliminar mi cuenta. Espera 5 minutos. Reintenta. |
| "You have reached the maximum number of phone numbers" | Tu cuenta de prueba está limitada a 2 números. | Tienes que verificar tu empresa con Meta (Business Verification) para subir el límite. |
| "Display name violates our policies" | El nombre de la clínica no cumple las reglas. | Cámbialo. Evita mayúsculas seguidas, palabras genéricas o referencias a Meta/WhatsApp. |
| No llega el SMS | Algunos operadores en Colombia bloquean SMS internacionales. | Cambia a verificación por **llamada de voz**. |

---

## Paso 8 — Generar el **Access Token permanente**

⚠️ **Muy importante:** el token que aparece arriba en la pantalla API Setup (donde dice "Temporary access token") **expira en 24 horas**. Si lo pegas en AgenIA, mañana dejará de funcionar y los pacientes no podrán chatear. Tenemos que crear uno permanente.

Esto se hace con una entidad llamada **System User** (Usuario del Sistema), que es como un "usuario robot" dentro de tu cuenta empresarial.

### 8.1 — Crear el Usuario del Sistema

1. Entra a **Configuración del negocio**:
   **https://business.facebook.com/settings**
2. En el menú lateral izquierdo, busca la sección **"Usuarios"** → clic en **"Usuarios del sistema"** (System Users).
3. Clic en **"Agregar"** (botón azul).
4. Aparece un cuadro:
   - **Nombre del usuario del sistema:** `AgenIA Integration` (o como prefieras, sin espacios raros).
   - **Rol:** **"Admin"** (Administrador).
5. Acepta los términos y clic en **"Crear usuario del sistema"**.

### 8.2 — Asignar permisos sobre tu cuenta de WhatsApp

1. Ya creado el System User, queda seleccionado en la lista. Verás un panel a la derecha con su nombre y un botón **"Agregar activos"** (Add Assets).
2. Clic en **"Agregar activos"**.
3. Aparece un selector con varias categorías: Páginas, Cuentas publicitarias, Apps, **WhatsApp Accounts**…
4. Selecciona **"Cuentas de WhatsApp"** (o **"WhatsApp Accounts"**).
5. En el listado del centro, marca la WABA (cuenta empresarial de WhatsApp) que Meta creó automáticamente en el Paso 4.
6. En las opciones de la derecha, activa **"Control total"** (Full Control).
7. Clic en **"Guardar cambios"** (Save Changes).

### 8.3 — Generar el token

1. Con el System User aún seleccionado, busca el botón **"Generar nuevo token"** (Generate New Token). Clic.
2. Cuadro de confirmación:
   - **Selecciona la app:** abre el desplegable y elige la app que creaste en el Paso 3 (`AgenIA - Clínica del Sol`).
   - **Caducidad del token:** elige **"Nunca"** (Never).
   - **Permisos:** marca obligatoriamente estos dos:
     - ✅ `whatsapp_business_messaging`
     - ✅ `whatsapp_business_management`
   - (Otros permisos como `business_management` no son obligatorios; déjalos sin marcar.)
3. Clic en **"Generar token"**.
4. Aparece una pantalla con el token en grande. **Es una cadena larguísima que empieza por `EAA…`** y mide más de 200 caracteres.

   > ⚠️ **CRÍTICO:** Meta **solo te muestra el token UNA VEZ**. Si cierras esta ventana sin copiarlo, lo pierdes y tienes que generar otro.

5. Clic en **"Copiar token"**.
6. Pégalo en tu bloc de notas, rotulado como `Access Token = EAA…………………………`.
7. Cuando estés seguro de tenerlo guardado, clic en **"Listo"** (Done) para cerrar la ventana.

---

## Paso 9 — Pegar los datos en **AgenIA**

Ya tienes los dos datos críticos. Vamos a llevarlos a AgenIA.

1. Abre AgenIA en tu navegador (la URL que te dieron al darte de alta, ej. `https://agendamiento-ia.com`).
2. Inicia sesión con tu usuario **Administrador de Clínica**.
3. En el menú lateral, ve a **Configuración**.
4. Busca la pestaña **"Integración de WhatsApp"** (puede aparecer también como **"WhatsApp Business"**).
5. Verás dos campos vacíos:
   - **WhatsApp Phone ID** → pega aquí el número de 15–17 dígitos del Paso 5 o 7.
   - **Access Token** → pega aquí la cadena `EAA…` del Paso 8.3.
6. Clic en **"Guardar"**.
7. AgenIA intentará una llamada de prueba a Meta para validar la conexión. En máximo 5 segundos verás uno de estos resultados:
   - ✅ **"Conexión exitosa"** → todo bien, continúa al Paso 10.
   - ❌ **"No pudimos conectar con tu WhatsApp"** → revisa la tabla de errores al final de esta guía.

---

## Paso 10 — Configurar el **Webhook** (para que AgenIA pueda **recibir** mensajes)

Hasta aquí AgenIA puede **enviar** mensajes. Para que también pueda **recibir** los mensajes que mandan los pacientes (y agendarles cita), Meta necesita saber a qué URL enviar las notificaciones. Esto se llama **Webhook**.

1. Dentro de AgenIA → **Configuración → Integración de WhatsApp**, busca la sección **"Webhook de WhatsApp"**.
2. Verás dos textos:
   - **Callback URL:** algo como `https://agendamiento-ia.com/api/chatbot/webhook`.
   - **Verify Token:** una cadena aleatoria larga (AgenIA la genera por ti).
3. Copia ambos valores. No los modifiques.
4. Abre una nueva pestaña y entra a **Meta for Developers** → tu app → **WhatsApp → Configuration** (Configuración).
5. Busca la sección **"Webhook"** y clic en **"Editar"** (Edit).
6. Llena el formulario:
   - **Callback URL:** pega la URL que copiaste de AgenIA.
   - **Verify Token:** pega el token que copiaste de AgenIA. Debe ser **exactamente igual**, sin espacios al inicio o al final.
7. Clic en **"Verificar y guardar"** (Verify and Save).
8. Si todo está bien, Meta muestra un check verde junto a la URL. Si no, te dice **"Webhook verification failed"** — significa que algo no coincide. Revisa la tabla de errores.
9. Una vez verificado, baja a la sección **"Webhook fields"** (Campos del webhook). Clic en **"Manage"** (Administrar).
10. Marca estas casillas:
    - ✅ **`messages`** (para recibir mensajes entrantes — **obligatorio**)
    - ✅ **`message_status`** (para saber si los mensajes que mandas son entregados/leídos — opcional pero recomendado)
    - (las demás casillas déjalas sin marcar)
11. Clic en **"Save"** (Guardar).

---

## Paso 11 — Suscribir tu WABA al webhook (no se te olvide)

Este paso es fácil de pasar por alto y rompe la integración completa si se omite.

1. Sigue dentro de **WhatsApp → Configuration**.
2. Baja hasta la sección **"WhatsApp Business Account"**.
3. Verás un botón **"Subscribe"** o **"Suscribir"**. Clic.
4. Confirma seleccionando tu cuenta y clic en **"Done"**.

Esto le dice a Meta: "Cuando lleguen mensajes a esta cuenta de WhatsApp, mándalos al webhook que ya configuré".

---

## Paso 12 — Prueba final ¡desde tu propio celular!

1. Toma tu celular personal (uno distinto al número que conectaste).
2. Abre WhatsApp.
3. Escribe un mensaje al número de tu clínica que registraste en el Paso 7 (o agrega ese número como "destinatario de prueba" si seguiste la Opción A del Paso 6).
4. Manda un saludo simple: `Hola`.

**Lo que debe pasar:**

- En unos 2–5 segundos, AgenIA te responde automáticamente con un mensaje de bienvenida personalizado al nombre de tu clínica.
- Si entras a AgenIA → **Caja Negra (Auditoría)**, verás el mensaje que enviaste registrado.
- Puedes seguir la conversación pidiendo una cita; AgenIA debería guiarte paso a paso.

**Si no responde:**

- Espera 30 segundos más (la primera vez Meta a veces tarda).
- Revisa la pestaña de Auditoría — ¿ves tu mensaje listado? Si no, el webhook no está recibiendo. Vuelve al Paso 10 y 11.
- Si ves el mensaje pero AgenIA no responde, mira la sección **"Errores comunes"** al final.

---

## Datos de resumen — chuleta final

Cuando termines, tu bloc de notas debería verse así:

```
=== Datos para AgenIA ===
Phone Number ID:  123456789012345
Access Token:     EAAB.................................................
Verify Token:     ag3n14_w3bh00k_s3cr3t_xxxxxxxxx  (este lo da AgenIA)
Callback URL:     https://agendamiento-ia.com/api/chatbot/webhook

=== Otros datos útiles (por si los pide soporte) ===
App ID:           1234567890123456
WABA ID:          987654321098765
Número conectado: +57 300 123 4567
Nombre mostrado:  Clínica del Sol
```

Guárdalo en un lugar **seguro**. El Access Token funciona como contraseña: quien lo tenga puede mandar mensajes en nombre de tu clínica.

---

## Errores comunes y cómo resolverlos

### Al verificar el número (Paso 7)

| Síntoma | Causa | Solución |
|---|---|---|
| "This phone number is already registered with WhatsApp" | El número está activo en la app móvil. | Borra la cuenta desde la app del celular (Ajustes → Cuenta → Eliminar) y reintenta a los 5 minutos. |
| No llega el SMS de verificación | Algunos operadores bloquean SMS internacionales. | Cambia a verificación por llamada de voz. |
| "Display name violates policies" | El nombre que pusiste tiene problemas. | Evita mayúsculas seguidas, símbolos raros y palabras como "WhatsApp" u "Oficial". |
| "Maximum phone numbers reached" | Tu cuenta no verificada solo permite 2 números. | Verifica tu empresa con Meta en Business Settings → Verificación de la empresa. |

### Al generar el token (Paso 8)

| Síntoma | Causa | Solución |
|---|---|---|
| No aparece el botón "Generar token" | El System User no tiene la app asignada. | Vuelve al 8.2 y asigna la app además de la WABA. |
| Cerré la ventana antes de copiar el token | Meta solo lo muestra una vez. | No se puede recuperar. Genera otro token desde el mismo System User (no se rompe nada al hacerlo). |
| Token expira aún siendo permanente | Probablemente no marcaste "Nunca" en caducidad. | Genera otro asegurándote de marcar **"Nunca"** (Never expires). |

### Al conectar con AgenIA (Paso 9)

| Síntoma | Causa | Solución |
|---|---|---|
| "Invalid access token" | Pegaste el token temporal de 24h, no el permanente. | Genera el permanente con System User (Paso 8). |
| "Phone number not found" | El Phone Number ID está mal copiado o pertenece a otra cuenta. | Vuelve al Paso 5 y cópialo otra vez. Cuidado con espacios al inicio o final. |
| "Forbidden" / "Permission denied" | El System User no tiene Control Total sobre la WABA. | Vuelve al 8.2 y marca "Control total" cuando asignes el activo. |

### Al configurar el webhook (Paso 10–11)

| Síntoma | Causa | Solución |
|---|---|---|
| "Webhook verification failed" | El Verify Token no coincide exactamente. | Vuelve a copiar el token desde AgenIA y pégalo en Meta. Verifica que no haya espacios. |
| "Could not connect to callback URL" | Tu servidor de AgenIA no está respondiendo. | Contacta a soporte de AgenIA — puede ser un problema de servidor temporal. |
| Los mensajes no llegan al sistema | Olvidaste el Paso 11 (suscribir la WABA). | Vuelve y haz clic en "Subscribe". |
| Llegan mensajes pero AgenIA no responde | Falta marcar el campo `messages` en webhook fields. | Vuelve al Paso 10.10 y marca la casilla. |

### Generales

| Síntoma | Causa | Solución |
|---|---|---|
| El mensaje sí me llega pero solo a 5 personas | Estás en el número de prueba. | Conecta tu número real (Paso 7) o agrega más destinatarios pre-aprobados. |
| Después de un mes empezó a fallar todo | El token venció igualmente (algunas cuentas heredan caducidades del SO). | Genera un nuevo token siguiendo el Paso 8. |
| Meta me pide "verificación empresarial" | Es un proceso que Meta exige para escalar volumen. | Sube a Business Settings → Centro de seguridad → Verificación de la empresa, y carga RUT + Cámara de Comercio + factura de servicios. Toma 1–5 días hábiles. |

---

## Preguntas frecuentes

**¿Esto tiene costo?**
Crear la cuenta de desarrollador y la WABA es gratis. WhatsApp Business API cobra por **conversación iniciada**, con precios que varían por país y tipo de mensaje (servicio vs. utilidad vs. marketing). Meta te da créditos gratuitos al inicio. Consulta tarifas actualizadas aquí: https://developers.facebook.com/docs/whatsapp/pricing.

**¿Puedo cambiar el número después?**
Sí. Repite el Paso 7 con el nuevo número. El Phone Number ID cambia, así que tendrás que actualizarlo en AgenIA.

**¿Si elimino la app de Meta for Developers, pierdo todo?**
Sí. La WABA queda huérfana y los tokens dejan de funcionar. No la borres a menos que estés migrando intencionalmente.

**¿Mi conversación de WhatsApp Business actual se pierde al pasar a la API?**
Sí. La API es un canal técnicamente distinto al de la app móvil. **Los chats viejos no se traspasan.** Por eso recomendamos usar un número nuevo dedicado a AgenIA.

**¿Qué pasa con la verificación azul (badge verificado)?**
Es independiente. Una vez tu integración esté activa y tengas algo de volumen, puedes solicitar la insignia verde de cuenta oficial en Meta. Eso es un proceso adicional con documentos legales.

**¿AgenIA puede ver mis chats personales de WhatsApp?**
No. AgenIA solo tiene acceso al número que conectaste vía API, no a tu WhatsApp personal del celular.

---

## ¿Te quedaste atascado?

Si después de seguir esta guía algo no funciona:

1. **Toma un screenshot** de la pantalla donde estás bloqueado.
2. Entra a AgenIA → **Soporte** → **Crear ticket**.
3. Adjunta el screenshot y explica en qué paso de esta guía estás.
4. Nuestro equipo te responde en máximo 24 horas hábiles.

¡Bienvenido a AgenIA! En unos minutos vas a tener una asistente virtual atendiendo a tus pacientes 24/7.
