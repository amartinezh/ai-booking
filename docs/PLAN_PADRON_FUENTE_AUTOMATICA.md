# Padrón automático desde el servidor de la EPS (Nueva EPS)

**Estado: EVALUACIÓN (2026-11-09), nada construido.** Idea del hospital. Antes de construir hay que confirmar con Nueva EPS / Procesos y Servicios que el padrón esté en ese servidor (§3 y §9) y que el usuario apruebe P1 … P12 (§8).

## 1. Qué se pide

Una pantalla que complemente la carga del padrón: el hospital, previa autorización de la EPS, escribe en AgenIA las credenciales de conexión al servidor de archivos de Nueva EPS; AgenIA descarga el padrón de allí, lo procesa con el mismo analizador de hoy y deja a Nueva EPS cargada en el sistema, sin que nadie suba el archivo a mano.

**Por qué importa:** Nueva EPS es ≈ 20 % de medicina general en el hospital y está registrada **inactiva** desde el 21-oct porque no hay padrón ([PLAN_RESERVA_PRESENCIAL.md §1 y §2.3](PLAN_RESERVA_PRESENCIAL.md)); el hospital le guarda cupos a mano con «citas temporales». Con el padrón, el asistente podría agendarles.

## 2. Qué dice el papel que mandó el hospital (lectura de las dos fotos)

La hoja es una comunicación de **Procesos y Servicios** (operador de cuentas médicas de Nueva EPS; correo `virtualneps@procesosyservicios.net`), con dos notas a mano: «NUEVA EPS» y el correo del contacto en la EPS (`pedro.ortiz@nuevaeps.com.co`).

| Dato del papel | Valor | Lectura |
|---|---|---|
| Título | «relaciono credenciales de acceso al Servidor FTP FileZilla» | Servidor de archivos del operador, no un portal web |
| Protocolo | «SFTP - SSH File Transfer Protocol» | Contradice el puerto (abajo) |
| Servidor | `ripsneps.procesosyservicios.net.co` | «rips» + «neps»: **RIPS de Nueva EPS**, es decir, facturación |
| Usuario | `N` + NIT del hospital | Cuenta **institucional**, no de una persona |
| Contraseña | (en la foto) | Ya circuló por WhatsApp: hay que rotarla (§7) |
| Puerto | 990 | Es el puerto de **FTPS implícito** (FTP sobre TLS); SFTP usa el 22 |
| Asunto del texto | «DESMATERIALIZACIÓN DE CUENTAS MÉDICAS», capacitación de Cápita, PGP, PAF y Libro Abierto, «cargue de las facturas», reportar por correo «cantidad total de facturas cargadas», asuntos «CARGUE FTP <NIT> Evento/Capita - AAAAMMDD» | Es el canal por el que **el hospital SUBE facturas y RIPS** a Nueva EPS |
| Fechas de ejemplo | `20220526` | La carta y, probablemente, la clave son de **2022** |

**Conclusión de la lectura:** nada en el papel dice que Nueva EPS deje allí la base de afiliados. El servidor está entregado para que el hospital cargue cuentas médicas. Puede que el operador también publique la población asignada por capitación en la misma cuenta (pasa con algunos operadores), pero **hay que verificarlo antes de diseñar sobre esa suposición**. Si no está allí, la pantalla no tendría de dónde descargar (§9).

## 3. Lo que comprobé el 2026-11-09 (sin usar las credenciales)

- El nombre resuelve a una IP de la nube de Microsoft (Azure).
- Desde una conexión normal a Internet (con `github.com:443` respondiendo), los puertos **21, 22 y 990 no responden** (ni saludo FTP, ni banner SSH, ni TLS). Lo más probable es que el operador **filtre por IP de origen** (lista blanca con la IP del hospital), práctica común en los servidores de las EPS; también puede ser que el servicio de 2022 ya no esté en esa dirección. Esto decide **desde dónde** puede correr la descarga (P3): si solo responde desde la red del hospital, el ejecutor sería el agente del espejo; si el operador autoriza la IP del VPS (`89.117.61.28`), la API.
- «Servidor FTP FileZilla» + puerto 990: FileZilla Server sirve FTP/FTPS, no SFTP. La conexión real casi seguro es **FTPS implícito**. La pantalla debe soportar **FTPS (implícito y explícito) y SFTP** y que «Probar conexión» detecte cuál responde (P4).

Verificaciones que faltan y que solo puede hacer el hospital o el usuario: abrir FileZilla **desde un equipo del hospital** con esas credenciales y mirar qué carpetas y archivos hay (si aparece algo tipo «AFILIADOS», «BASE», «POBLACION», «CAPITA»), y probar la misma conexión desde el VPS.

## 4. Cómo está hoy AgenIA (lo que se reutiliza)

| Pieza | Dónde | Qué aporta |
|---|---|---|
| Pantalla Padrón EPS (Altas) | [`apps/web/app/dashboard/padron/`](../apps/web/app/dashboard/padron/) (solo `ORG_ADMIN`) | Validar → importar; CSV o XLSX ≤ 6 MB; corte que **reemplaza** el padrón activo de la EPS; guarda del 10 % de bajas; aceptar filas con error; historial (`PadronImport` / `PadronImportRow`); huella `PADRON_IMPORT` en Actividad |
| Analizador | [`packages/shared/src/padron-csv.ts`](../packages/shared/src/padron-csv.ts) (puro) | Encuentra cédula, régimen y celular por palabras y contenido, reacomoda filas corridas, ignora el resto de columnas (nunca custodia datos sensibles) |
| Detección de EPS | [`packages/shared/src/padron-eps-detect.ts`](../packages/shared/src/padron-eps-detect.ts) | Preselecciona la EPS por columna o nombre del archivo |
| Excel → CSV | [`apps/web/lib/spreadsheet-upload.ts`](../apps/web/lib/spreadsheet-upload.ts) | Solo en el navegador (`xlsx`). En el servidor no existe todavía |
| Núcleo de importación | [`padron-service.ts`](../apps/web/app/dashboard/padron/padron-service.ts) `runImportPadronCsv` | Atado a la sesión web (`requireOrgAdmin`) y a `createdByUserId` obligatorio: un proceso automático no puede llamarlo tal cual (P11) |
| Secretos | Web → API (`/telegram-config`) → `CryptoService` AES-256-GCM; se muestran solo los últimos 4 | Mismo camino para la contraseña del servidor |
| Procesos automáticos | `@nestjs/schedule` en la API (18 crons; §7 de la base de conocimiento) | La descarga nocturna es un cron más |
| Monitor de servicios externos | [`apps/api/src/monitor/services.config.ts`](../apps/api/src/monitor/services.config.ts) | Lista declarativa + `case` en `monitor.checkers.ts` |
| Alertas técnicas | [`apps/api/src/tech-alerts/`](../apps/api/src/tech-alerts/) (Telegram del equipo) | Avisar fallos de conexión o de importación |
| Agente del hospital | [`apps/mirror-agent/`](../apps/mirror-agent/) (systemd, credenciales por `LoadCredential`) | Ejecutor alternativo si el operador solo admite la IP del hospital |
| Librerías | — | **No hay** cliente FTP/SFTP en el workspace. Habría que añadir `basic-ftp` (FTPS) y `ssh2-sftp-client` (SFTP); Excel en servidor con una librería mantenida (P12) |

## 5. Viabilidad

### 5.1 Técnica: sí, con tres condiciones previas

1. **Que el padrón exista en ese servidor** (carpeta, nombre, formato, cada cuánto). Hoy no hay evidencia (§2).
2. **Que el servidor acepte la conexión desde donde corra AgenIA** (§3): IP del VPS autorizada, o descarga desde el hospital por el agente.
3. **Un archivo de muestra** para probarlo contra el analizador (como se hizo con Sura y Salud Total).

Si se cumplen, la construcción es pequeña: descargar un archivo por FTPS/SFTP, pasarlo por `validatePadronCsv` y aplicar el mismo corte que hoy aplica la pantalla. Lo nuevo de verdad es (a) guardar credenciales de un tercero por clínica y EPS, (b) sacar el núcleo de importación de la web para que la API lo use, (c) las guardas de un proceso sin persona delante (§6.3).

### 5.2 Legal y contractual: viable, con permiso escrito

Es un caso **mucho más liviano** que el robot sobre los portales que se descartó el 3-nov ([reports/Validación automática de derechos EPS.md](../reports/Validación%20automática%20de%20derechos%20EPS.md)): la cuenta es **institucional** (N + NIT, no «códigos personales» de un funcionario), el protocolo es estándar (sin captcha ni scraping), el archivo lo deja la propia EPS para el hospital, y AgenIA actúa como encargado del tratamiento por cuenta del hospital. Pero sigue aplicando el art. 269A («por fuera de lo acordado»): la cuenta se entregó **para subir facturas**. Por eso la condición: **autorización escrita** de Nueva EPS / Procesos y Servicios para la descarga automática (ideal: un usuario aparte, de solo lectura, para AgenIA). Es exactamente el «canal pactado» que recomienda ese informe y que el Decreto 441 de 2022 permite exigir en el contrato.

Datos personales (Ley 1581): AgenIA ya se queda solo con cédula, régimen y celular; el archivo descargado **no se guarda** (P5), solo su hash, nombre, fecha y conteos, como hoy.

### 5.3 Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Bloquear la cuenta de facturación del hospital por intentos fallidos | Un intento por noche; un fallo de autenticación **apaga la fuente** y avisa; nunca reintenta en bucle (P8) |
| Un archivo parcial desactiva a casi todo el padrón | La guarda del 10 % no se salta: el corte queda **pendiente de confirmación** en la pantalla, con aviso (P6) |
| Formato desconocido (`.xls` viejo, `.zip`, ancho fijo, columnas sensibles) | CSV y XLSX; otro formato se pide a la EPS; el analizador ya ignora lo que no necesita (P12) |
| La clave de la foto ya circuló | Rotarla tras la prueba; en AgenIA cifrada y nunca visible (P2) |
| Suplantación del servidor | Huella del certificado (FTPS) o de la llave SSH (SFTP) fijada en la primera conexión; si cambia, se frena y avisa (P4) |
| «¿Quién cargó este corte?» | `PadronImport` con origen `AUTOMATICO` y sin persona; la configuración de la fuente queda en Actividad con quién la cambió, nunca la clave |

## 6. Diseño propuesto

### 6.1 Pantalla: «Fuente automática», dentro de Padrón EPS (Altas)

Sub-página `/dashboard/padron/fuentes` (solo `ORG_ADMIN`), una fila por EPS:

- **Conexión:** EPS, protocolo (FTPS implícito / FTPS explícito / SFTP, con «Detectar»), servidor, puerto, usuario, contraseña (solo escritura; se ven los últimos 4), carpeta remota, patrón del nombre del archivo (p. ej. `*AFILIADOS*`).
- **Probar conexión:** entra, lista la carpeta (nombre, tamaño, fecha de cada archivo) y sale. No descarga nada. Fija la huella del servidor.
- **Descargar y validar ahora:** baja el archivo más reciente que cumpla el patrón y muestra **el mismo reporte** de la pantalla manual (afiliados listos, columnas usadas, errores, cuántos quedarían desactivados). No importa nada.
- **Importar automáticamente cada noche:** interruptor, nace **apagado**. Para encenderlo se exige la fecha y referencia de la **autorización escrita** de la EPS (P1).
- **Tarjeta de estado:** última revisión, último archivo (nombre, fecha, hash), resultado (creados / actualizados / reactivados / desactivados / rechazados), próxima corrida, último error, y enlace al Historial de cargas.
- Si el corte quedó **pendiente de confirmación** (más del 10 % de bajas), la tarjeta lo dice y ofrece «Confirmar e importar» o «Descartar».

Cambios de la configuración → huella `PADRON_FUENTE_CONFIG` en Actividad (qué cambió; de la clave solo «se puso una clave nueva»).

### 6.2 Proceso automático (API)

Cron diario (p. ej. 04:00 Bogotá) + «Ejecutar ahora» desde la pantalla, por cada fuente encendida:

1. Conectar (un solo intento; fallo de autenticación → fuente apagada + alerta).
2. Listar y elegir el archivo más reciente del patrón. Si su hash es el del último corte importado, no hacer nada (igual que recargar el mismo archivo hoy).
3. Descargar en memoria (tope de tamaño; el archivo se descarta al terminar), convertir si es XLSX.
4. `validatePadronCsv`. Error del archivo entero → no importa, alerta. Errores de fila → se aceptan (quedan como RECHAZADO, P7).
5. Medir bajas: > 10 % → corte pendiente de confirmación + aviso; si no, importar con el mismo núcleo de la pantalla.
6. Registrar `PadronImport` (origen `AUTOMATICO`), actualizar la tarjeta, avisar el resultado (P10).

Dónde corre: API por defecto; agente del hospital si el operador exige IP del hospital (P3). En el agente sería una tarea más del ciclo (descargar y subir el archivo a la API por el canal del espejo), no un driver nuevo.

### 6.3 Lo que cambia en la base y en el código

- Modelo nuevo `PadronFuente` (por clínica y EPS): protocolo, servidor, puerto, usuario, contraseña cifrada, carpeta, patrón, huella del servidor, encendida, autorización (fecha, referencia), última revisión, último archivo (nombre, fecha, hash), último error, corte pendiente.
- `PadronImport`: `createdByUserId` pasa a opcional y se agrega `origen` (`MANUAL` | `AUTOMATICO`) y `fuenteId`.
- Núcleo de importación compartido (P11): sacar de `padron-service.ts` la parte que no depende de la sesión (medir bajas, upsert por lotes, desactivar ausentes, escribir filas) a un sitio que web y API llamen igual.
- API: módulo `padron-fuente` (conexión FTPS/SFTP, prueba, descarga, cron, alertas); web: la sub-página y sus acciones (secretos por la API, como Telegram).
- Monitor de servicios: **no** se agrega (conectarse cada 5 minutos a un servidor de un tercero es ruido y riesgo); el reporte nocturno basta.
- Base de conocimiento: tema del padrón en la Parte 1 (pasos nuevos), §7 (fila del proceso), §9 (credenciales) y §11 (ajuste) en la Parte 2, bitácora.

### 6.4 Tamaño (orden de magnitud)

| Fase | Qué | Esfuerzo |
|---|---|---|
| 0 | Sin código: respuestas de la EPS/operador (§9), prueba con FileZilla desde el hospital y desde el VPS, archivo de muestra, autorización escrita, rotar la clave | Del hospital |
| 1 | Modelo, conexión FTPS/SFTP, «Probar conexión», «Descargar y validar ahora», núcleo compartido | 3–4 días |
| 2 | Importación nocturna, guardas, corte pendiente, alertas, historial con origen, base de conocimiento | 2–3 días |
| 3 | Opcional: ejecutor en el agente del hospital, aviso por WhatsApp al administrador | 1–2 días |

Nada de las fases 1–3 vale la pena empezar sin la fase 0.

## 7. Sobre las credenciales de la foto

- Están en una foto que viajó por WhatsApp: el hospital debería pedir al operador **rotarla** cuando termine la prueba, y no volver a mandarla por chat.
- No se transcriben en este repositorio, en la base de conocimiento ni en ningún chat. En AgenIA irían cifradas (AES-256-GCM, como el token de Meta y el de Telegram) y nunca se volverían a mostrar.
- Lo ideal es que AgenIA tenga **su propio usuario de solo lectura**, distinto del que usa facturación: así un fallo de AgenIA nunca toca el canal de las cuentas médicas.

## 8. Decisiones por aprobar

- **P1.** Antes de construir, el hospital pregunta a Nueva EPS / Procesos y Servicios lo de §9 y consigue la **autorización escrita** (o un usuario aparte de solo lectura). Sin eso, la fuente no se enciende.
- **P2.** La clave de la foto se rota después de la prueba y no se transcribe en ningún sitio.
- **P3.** La descarga corre en la **API** (VPS). Solo si el operador exige IP del hospital, corre en el agente.
- **P4.** Se soportan **FTPS implícito, FTPS explícito y SFTP**, con detección en «Probar conexión»; la huella del servidor se fija en la primera conexión y, si cambia, se frena.
- **P5.** El archivo descargado **no se guarda**; quedan hash, nombre, fecha y conteos.
- **P6.** Un corte que desactivaría más del 10 % **nunca** se aplica solo: queda pendiente de confirmación y se avisa.
- **P7.** Las filas con error se **aceptan** automáticamente (quedan como RECHAZADO), como cuando la persona marca la casilla hoy. Alternativa: frenar y esperar a la persona.
- **P8.** Un intento por noche; un fallo de autenticación **apaga la fuente** hasta que el administrador la revise.
- **P9.** La pantalla vive dentro de **Padrón EPS (Altas)** como sub-página («Fuente automática»), no como opción nueva del menú.
- **P10.** El resultado se avisa en el panel (tarjeta + Historial) y por alerta técnica al grupo; un aviso por WhatsApp al administrador queda para la fase 3.
- **P11.** El núcleo de importación se **comparte** entre web y API (hoy está atado a la sesión de la web).
- **P12.** Formatos: CSV y XLSX (Excel en el servidor con una librería mantenida, no `xlsx`, que tiene dos avisos sin arreglo según `docs/SEGURIDAD.md`); `.xls` viejo o `.zip` se devuelven a la EPS pidiendo CSV.

## 9. Preguntas para Nueva EPS / Procesos y Servicios (las hace el hospital)

1. ¿En ese servidor se publica la **base de afiliados** (población capitada o asignada) del hospital? ¿En qué carpeta, con qué nombre, en qué formato y cada cuánto se actualiza?
2. ¿El protocolo es **FTPS (puerto 990)** o **SFTP (puerto 22)**? ¿El servidor **filtra por IP**? Si sí, ¿pueden autorizar la IP del servidor de AgenIA?
3. ¿Autorizan por escrito la **descarga automática** con la cuenta institucional, o crean un **usuario de solo lectura** para AgenIA?
4. ¿Qué **columnas** trae la base? (Documento, régimen y celular bastan; mejor sin datos clínicos.)
5. Si la base **no** está allí: ¿por qué canal se la entregan hoy al hospital (correo, portal)? Con la respuesta se decide si la «fuente automática» puede ser un buzón de correo en vez de un servidor de archivos, o si Nueva EPS sigue por la pantalla manual de hoy.

## 10. Si el padrón no está en ese servidor

La pantalla manual de hoy ya resuelve Nueva EPS en cuanto el hospital tenga el archivo (por correo o por el portal), igual que Sura y Salud Total. Y la misma «fuente automática» de §6 puede tener un segundo tipo, **buzón de correo** (una cuenta donde la EPS envíe el corte), si ese resulta ser el canal real. La vía de fondo sigue siendo el contrato: el Decreto 441 de 2022 permite pactar con Nueva EPS la entrega de la base y su periodicidad.
