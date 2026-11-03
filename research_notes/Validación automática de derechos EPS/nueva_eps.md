# Nueva EPS: canales para que una IPS verifique derechos y si se pueden automatizar

Fecha de corte de la investigación: 3 de noviembre de 2026. Solo documentación pública; no se inició sesión, no se registró usuario, no se tocó ningún captcha ni se raspó ningún portal.

**Nota de método (importante para leer todo lo que sigue):** el sitio oficial `nuevaeps.com.co` (con y sin `www`), incluidas sus páginas informativas para IPS (`/ips`, `/ips/autorizaciones`, `/zona-transaccional`) y sus PDF en `/sites/default/files/...`, respondió **HTTP 403** a toda lectura automática (WebFetch y `curl` simple, 2–3 nov 2026). No se intentó saltar ese bloqueo. Por eso lo que se cita de páginas oficiales viene de **fragmentos indexados por el buscador** (título + extracto), no de la página completa. Donde así sea, se marca «(extracto del buscador)». Que hasta las páginas informativas públicas tengan un cortafuegos contra bots ya dice algo de qué tan automatizable es la entidad (ver inferencias).

---

## 1. ¿Qué canales ofrece hoy Nueva EPS a los prestadores para consultar derechos? (URL y qué devuelve cada uno)

### Takeaway
El único canal de Nueva EPS para que una IPS consulte el estado de afiliación es la **Zona Transaccional / Portal Transaccional** (`portal.nuevaeps.com.co`), con usuario y clave de tipo «IPS», donde se busca al paciente por tipo y número de documento. Alrededor hay canales de apoyo (páginas informativas para IPS, «App IPS y Promotores» —circular del 23-oct-2025, contenido no verificado—, video tutoriales, líneas telefónicas, directorio de red), pero **no se encontró ningún «validador de derechos» público ni un servicio para máquinas**.

### Cited Findings
- Nueva EPS tiene una página para IPS titulada «Consultas de estado de afiliación - IPS» que dice, en esencia: «Con el fin de agilizar el proceso de atención de nuestros usuarios, consulta el estado de afiliación de cualquier afiliado de NUEVA EPS», y que para hacerlo hay que entrar a la **Zona Transaccional** con el **tipo y número de documento** del afiliado (extracto del buscador; página sin fecha visible) — [Nueva EPS – Consultas de estado de afiliación - IPS](https://nuevaeps.com.co/ips/estado-afiliacion)
- El trámite de autorizaciones para IPS (urgencias, estancias hospitalarias, entre otros) también se hace por la Zona Transaccional (extracto del buscador) — [Nueva EPS – Autorizaciones, trámites y legalizaciones para IPS](https://nuevaeps.com.co/ips/autorizaciones)
- Según el resumen del buscador de las páginas de canales no presenciales de Nueva EPS, los servicios en línea para IPS incluyen: validación del estado o los datos de la afiliación, información de autorizaciones, **cambio de IPS asignada** y solicitud de pago de incapacidades (extracto del buscador; no se pudo leer la página entera) — [Nueva EPS – Canales no presenciales](https://nuevaeps.com.co/canales-servicio/no-presenciales); [Nueva EPS – Tenemos éstos servicios para ti](https://nuevaeps.com.co/canales-PBS)
- Dirección de entrada del portal: `https://portal.nuevaeps.com.co/Portal/home.jspx`; la pantalla pública de creación de usuarios (`/Portal/public/frmSelectUserType.jspx`) ofrece cuatro tipos de usuario: **AFILIADO, EMPLEADOR, ASESOR o IPS** (extracto del buscador; no se abrió el portal) — [Portal Nueva EPS – frmSelectUserType](https://portal.nuevaeps.com.co/Portal/public/frmSelectUserType.jspx); [Nueva EPS – página de inicio](https://nuevaeps.com.co/)
- La página «IPS» del sitio oficial describe una sección para «acceder de forma fácil y segura a las transacciones y solicitudes para tu Institución Prestadora de Salud» y menciona una **«App IPS y Promotores»** asociada a una **Circular externa del 23 de octubre de 2025** (extracto del buscador; no se pudo leer la circular ni saber qué hace la app) — [Nueva EPS – IPS](https://nuevaeps.com.co/ips)
- Existe una sección oficial de **video tutoriales para IPS**; el resumen indica que uno muestra que «puedes verificar el estado de afiliación del usuario indicando el número de su documento de identificación» (extracto del buscador; no se vio el video) — [Nueva EPS – Video Tutoriales](https://nuevaeps.com.co/ips/videotutoriales)
- Hay páginas oficiales «Login IPS» («Solo debes ingresar con el usuario y contraseña que te fueron asignados») y «Claves de acceso para IPS» («Si es la primera vez que vas a usar nuestra Zona Transaccional, puedes solicitar tu usuario y contraseña») (extractos del buscador) — [Nueva EPS – Login IPS](https://www.nuevaeps.com.co/ips/login); [Nueva EPS – Claves de acceso para IPS](https://www.nuevaeps.com.co/ips/recuperar-claves-acceso)
- Subdominio de servicios externos con una consulta pública «Cesión Afiliados» (lista de afiliados recibidos por cesión de otras EPS); no se abrió — [serviciosexternos.nuevaeps.com.co – Cesión Afiliados](https://serviciosexternos.nuevaeps.com.co/trasneps/CESIONlist.php)
- Directorio público de la red de prestadores — [directoriopac.nuevaeps.com.co](https://directoriopac.nuevaeps.com.co/); Nueva EPS dice publicar mensualmente información de su red — [Nueva EPS – Red de Prestadores de Servicios de Salud](https://nuevaeps.com.co/red_de_prestadores_de_servicios_de_salud)
- Líneas telefónicas nacionales (aparecen en páginas oficiales; no se confirmó cuál está vigente ni si tienen opción IVR para IPS): subsidiado **01 8000 952000**, contributivo **01 8000 954400** (extracto del buscador) — [Nueva EPS – Consultas de estado de afiliación - IPS](https://nuevaeps.com.co/ips/estado-afiliacion)
- Para el afiliado (no para la IPS) existen la app «NUEVA EPS Móvil» (consulta del estado de afiliación), el chat EVA y las líneas telefónicas — [App Store – APP NUEVA EPS](https://apps.apple.com/app/id6477896920); [Rankia, act. 23-oct-2026](https://www.rankia.co/blog/pensiones-iss-cesantias/4321126-como-descargar-certificado-nueva-eps)
- Una guía de terceros (sin fecha, imágenes de 2023) dice que el Portal Transaccional «está disponible para afiliados, empresas, independientes e instituciones prestadoras de salud (IPS)» y lista «Solicitar y consultar autorizaciones»; no menciona validación de derechos — [sedevirtual.com.co – Portal transaccional Nueva EPS](https://sedevirtual.com.co/portal-transaccional-nueva-eps/)

### Inferences
- Lo que devuelve la consulta en el portal (estado activo/suspendido/retirado, régimen, IPS primaria, nivel/categoría para copago) **no está documentado públicamente**; que la misma zona permita «cambio de IPS asignada» sugiere que el portal conoce y muestra la IPS asignada, pero eso es inferencia.
- El sufijo `.jspx` del portal indica una aplicación Java (JSF/ADF) con sesión de servidor; es un portal pensado para personas, no para integraciones (inferencia técnica, no confirmada por Nueva EPS).
- No hay un «Validador de derechos» con ese nombre en Nueva EPS; los «verificadores de derechos EPS» que aparecen en buscadores son sitios de terceros no oficiales (p. ej. [asesoriayserviciosayc.com](https://asesoriayserviciosayc.com/verificador-de-derechos/)) y no deben usarse.

### Gaps
- No se pudo leer ninguna página oficial completa (HTTP 403). No se sabe qué campos devuelve la consulta de estado de afiliación para IPS.
- Contenido de la Circular externa del 23-oct-2025 y funciones de la «App IPS y Promotores»: no verificados.
- No se encontró una opción de IVR/teléfono específica para que la IPS valide derechos.

---

## 2. ¿Cómo se autentica la IPS? (usuario por IPS o por funcionario, captcha, OTP, sesión, IP, términos de uso)

### Takeaway
Acceso con **usuario y contraseña asignados**, pedidos desde el propio portal («Solicitar nuevo usuario» → tipo IPS) y entregados al **correo registrado**; bloqueo tras varios intentos fallidos y recuperación de clave por correo. **No se encontró documentación pública** sobre captcha, OTP/2FA, límites de sesión, restricción por IP ni términos que digan si el usuario es por IPS o por funcionario.

### Cited Findings
- El registro pide elegir «Solicitar nuevo usuario», luego el tipo de usuario (IPS) y diligenciar tipo y número de documento, nombres, fecha de nacimiento, contacto, ubicación y teléfonos (guía de terceros, «2026», no oficial) — [epsenlinea.com.co – Cómo registrarse en la Nueva EPS en 2026](https://epsenlinea.com.co/nueva-eps/como-registrarse-nueva-eps/)
- Para otros tipos de usuario, Nueva EPS indica que «una vez ingreses toda la información, recibirás en el correo electrónico registrado el usuario y la contraseña»; que el flujo IPS sea igual **no está confirmado** (extracto del buscador) — [Nueva EPS – Licencias e incapacidades (Empresas)](https://nuevaeps.com.co/empresas/licencias-e-incapacidades)
- La página «Login IPS» dice «ingresar con el usuario y contraseña que te fueron asignados» y ofrece «Recuperar contraseña» (extracto del buscador) — [Nueva EPS – Login IPS](https://www.nuevaeps.com.co/ips/login)
- La política de seguridad del sitio indica que, para desbloquear la clave, se usa «Recordar su clave» en el sitio de autenticación y que hay que tener un correo válido en su base de datos para recibir la nueva contraseña (extracto del buscador) — [Nueva EPS – Políticas de Seguridad y Privacidad](https://www.nuevaeps.com.co/politicas-seguridad-privacidad)
- Guías no oficiales: la cuenta se bloquea al ingresar mal la clave varias veces; si la recuperación automática falla hay que llamar a un asesor — [epsenlinea.com.co – cuenta bloqueada (2026)](https://epsenlinea.com.co/nueva-eps/solucion-cuenta-bloqueada-nueva-eps/); [clonmax.com (2023)](https://clonmax.com/solucion-al-mensaje-cuenta-bloqueada-nueva-eps-2023/)
- Rankia (act. 23-oct-2026): el portal «exige credenciales propias», no basta el número de cédula; «sujeto a intermitencias»; no menciona captcha ni OTP — [Rankia – Certificado Nueva EPS](https://www.rankia.co/blog/pensiones-iss-cesantias/4321126-como-descargar-certificado-nueva-eps)
- Ninguna de las fuentes (oficiales o de terceros) menciona captcha, OTP, token, número de intentos permitidos ni límites de sesión del portal IPS — búsquedas del 2–3 nov 2026; ver p. ej. [sedevirtual.com.co](https://sedevirtual.com.co/portal-transaccional-nueva-eps/)

### Inferences
- Como el usuario se crea con datos de una **persona natural** (documento, nombres, fecha de nacimiento), es probable que la credencial «IPS» quede a nombre de un funcionario y no de la institución; poner esa credencial en un robot podría violar condiciones de uso aun sin captcha. No está confirmado: hay que pedir a Nueva EPS los términos de uso del portal IPS.
- Aunque el portal mismo no publique captcha, el sitio público ya bloquea clientes automáticos (403 observado el 2–3 nov 2026); lo razonable es esperar que cualquier robot sea detectado o bloqueado sin aviso.

### Gaps
- Si hay captcha (y de qué tipo), OTP o 2FA en el login IPS: **no verificable** sin entrar al portal.
- Duración de la sesión, sesiones simultáneas, restricción por IP: sin información pública.
- Términos y condiciones / política de uso del portal IPS (si el usuario es personal e intransferible): no encontrados.

---

## 3. ¿Ofrece Nueva EPS un web service / API / SFTP / archivo oficial para que la IPS o su HIS validen derechos?

### Takeaway
**No se encontró ninguna API, web service, WSDL ni anexo técnico público de Nueva EPS para validar derechos.** Lo único parecido es la afirmación comercial de un proveedor de software (Medifolios) sobre unos «manuales de interoperabilidad para prestadores» de Nueva EPS que no enlaza ni nombra, y que tratan de información clínica, no de derechos.

### Cited Findings
- Medifolios (proveedor de software clínico) afirma que Nueva EPS exige a su red capacidad de interoperabilidad y menciona «Web Services (API REST)», pero no da endpoints, documentación ni WSDL; remite a «los requerimientos técnicos que Nueva EPS establece en sus manuales de interoperabilidad para prestadores» sin enlazarlos. El intercambio descrito es **clínico** (programas de crónicos, autorización de alto costo, auditoría de pertinencia, continuidad), **no validación de derechos**. Cita la Ley 1581 de 2012 y la Resolución 1888 de 2025 (RDA); fecha de cabecera 06/10/2024 pero el texto menciona abril de 2026; es página publicitaria (descuento, «Solicitar demo») y su menú lista un módulo «Interfaz Nueva EPS» — [Medifolios – Interoperabilidad con Nueva EPS](https://medifolios.net/articulos/nueva-eps-interoperabilidad.php)
- Búsquedas de «Nueva EPS» + «web service» / «servicio web» / «API» / «integración HIS» no devolvieron ningún documento oficial de Nueva EPS (2–3 nov 2026); el único documento técnico estatal encontrado es la guía del Ministerio para consumir el API de **FEV-RIPS** (facturación, no derechos), oct-2023 — [MinSalud – Consumo API FEV-RIPS v1](https://www.minsalud.gov.co/sites/rid/Lists/BibliotecaDigital/RIDE/DE/OT/consumo-api-fev-rips-v1.pdf)
- Lo que sí publica Nueva EPS para IPS en materia de archivos es un **manual de cargue de RIPS** (archivos TXT, con campos como tipo de contrato —incluido «Contrato por capitación»—, régimen, NIT de la IPS y periodo año/mes): es un flujo de **IPS → EPS** para facturación, no de consulta de derechos (extracto del buscador; el PDF respondió 403) — [Nueva EPS – Manual de usuario Carga Usuarios RIPS V4.1 para IPS](https://nuevaeps.com.co/sites/default/files/inline-files/Manual_de_usuario_Carga_Usuarios_RIPS_V4_1_para%20IPS.PDF)
- Un proyecto académico público (EAFIT, 2026) que automatiza citas de una IPS con IA + RPA + n8n afirma: «El portal de la EPS no tiene API, y la IPS no puede cambiarlo… », por eso su robot opera «por pantalla». **No nombra a Nueva EPS** y no trata validación de derechos ni captcha — [GitHub – Hever-Alfonso/automatizacion-citas-ips](https://github.com/Hever-Alfonso/automatizacion-citas-ips)

### Inferences
- Si existiera un web service de derechos para prestadores, se negociaría caso por caso (convenio o contrato, área de TI de Nueva EPS); no hay ningún procedimiento público para pedirlo. El camino sería escribir formalmente al gestor de red o contratación de Nueva EPS en la regional (Caldas) preguntando por un «servicio web de consulta de derechos para el HIS» y, si no existe, por el archivo de usuarios asignados (sección 4).
- El módulo «Interfaz Nueva EPS» de Medifolios podría ser cargue de archivos o un robot; no hay pruebas de que use un servicio oficial.

### Gaps
- Si Nueva EPS tiene servicios web privados con algunos grandes prestadores o con su propia red (p. ej. IPS propias): no se encontró nada público.
- No se encontró área, correo ni formato para solicitar integración técnica.

---

## 4. ¿Entrega Nueva EPS a la IPS con contrato de capitación una base de datos periódica de usuarios asignados?

### Takeaway
**No se encontró documentación pública** sobre la entrega de la base de usuarios asignados a la IPS de capitación (periodicidad, formato, canal). Es práctica común del sector y suele quedar escrita en el contrato, pero para Nueva EPS no hay fuente que lo confirme; el hospital debería revisar su propio contrato de capitación.

### Cited Findings
- Nueva EPS tiene una página «Preguntas frecuentes sobre la asignación de usuarios», pero trata de afiliados **asignados a Nueva EPS** desde EPS liquidadas (p. ej. «471.483 afiliados de las EPS SaludVida fueron asignados… según la Resolución 8896»), no de la base que se entrega a la IPS (extracto del buscador) — [Nueva EPS – Preguntas frecuentes sobre la asignación de usuarios](https://www.nuevaeps.com.co/preguntas-frecuentes-sobre-la-asignacion-de-usuarios); [Nueva EPS – Asignación Salud Vida](https://www.nuevaeps.com.co/Asignacion-Salud-Vida)
- El manual de cargue de RIPS para IPS trae el campo «Contrato por capitación» y un PERIODO obligatorio año + mes, lo que muestra que la relación de capitación se maneja por mes (extracto del buscador) — [Nueva EPS – Manual Carga Usuarios RIPS V4.1](https://nuevaeps.com.co/sites/default/files/inline-files/Manual_de_usuario_Carga_Usuarios_RIPS_V4_1_para%20IPS.PDF)
- La zona transaccional para IPS permite «cambio de IPS asignada» (extracto del buscador), lo que indica que la asignación de IPS primaria se administra en el portal — [Nueva EPS – Canales no presenciales](https://nuevaeps.com.co/canales-servicio/no-presenciales)

### Inferences
- Si el hospital recibe una base mensual de asignados por capitación, esa sería la ruta más limpia para el bot: cargarla en AgenIA (como ya se hace con los padrones de otras EPS) y consultar localmente, aceptando que puede tener hasta un mes de atraso (novedades, retiros, traslados).
- La base de capitación solo cubriría a los asignados a esa IPS; no resolvería a los pacientes de Nueva EPS asignados a otra IPS ni el nivel de copago si no viene en el archivo.

### Gaps
- Periodicidad, formato (TXT/Excel), canal (correo, portal, SFTP) y campos (régimen, nivel, estado) de una base de asignados de Nueva EPS: **sin fuente pública**. Hay que verificarlo en el contrato del hospital o con el gestor de red de Nueva EPS en Caldas.

---

## 5. Cambios 2024–2026 bajo la intervención de la Supersalud (portales, plataformas, caídas, integraciones)

### Takeaway
Nueva EPS sigue intervenida (desde abril de 2024, prorrogada hasta el 10-abr-2027). En lo técnico, lo único documentado es que la zona transaccional **se pasó a un portal propio** (`portal.nuevaeps.com.co`) y que está «sujeta a intermitencias»; no se encontró un nuevo ERP/HIS ni integraciones anunciadas. El contexto (crisis financiera, cambios de red, traslados masivos frenados en los tribunales) hace más probables los cambios de afiliación y de red, que es justo lo que una validación debe atrapar.

### Cited Findings
- Intervención forzosa administrativa desde abril de 2024, prorrogada un año **hasta el 10 de abril de 2027**; «es una intervención para administrar, no para liquidar»; la zona transaccional «se movió a un portal propio», `portal.nuevaeps.com.co`, «no desde la página de inicio como antes» (sin fecha del cambio); el portal está «sujeto a intermitencias» — [Rankia, actualizado 23-oct-2026](https://www.rankia.co/blog/pensiones-iss-cesantias/4321126-como-descargar-certificado-nueva-eps)
- Oct-2025: Nueva EPS anunció ajustes en su red de IPS en todo el país; las IPS con contrato terminado debían seguir atendiendo 60 días mientras se armaba la nueva red — [ConsultorSalud – Cambios en la red de prestadores de Nueva EPS](https://consultorsalud.com/cambios-en-la-red-de-prestadores-de-nueva-eps/)
- Decreto 0182 del 25-feb-2026: traslado obligatorio de afiliados a Nueva EPS, Savia Salud y SOS con base en la BDUA; suspendido por el Tribunal Administrativo de Antioquia (25-mar-2026) y por el Consejo de Estado (~6-may-2026) — [Infobae, 3-mar-2026](https://www.infobae.com/colombia/2026/03/03/ips-alertan-riesgos-por-traslado-masivo-de-afiliados-a-nueva-eps-tras-decreto-0182/); [Infobae, 25-mar-2026](https://www.infobae.com/colombia/2026/03/25/tribunal-de-antioquia-confirmo-la-suspension-del-traslado-masivo-de-afiliados-a-nueva-eps-tras-negar-aclaracion-al-decreto/); [El Nuevo Siglo](https://www.elnuevosiglo.com.co/politica/suspenden-decreto-que-pretendia-mover-usuarios-nueva-eps)
- Agosto de 2026: nota según la cual Nueva EPS administra 11.674.529 afiliados y el Ministerio le asignó 3.198.875 personas más; otra nota habla de un plan del nuevo gobierno de **reducir** la base de afiliados de Nueva EPS (titulares y extractos del buscador; no se leyeron completas, posible contradicción entre ambas) — [Agencia PI](https://www.agenciapi.co/noticia/salud/nueva-eps-recibira-3-2-millones-de-afiliados-adicionales-pese-estar-intervenida); [Portafolio](https://www.portafolio.co/economia/gobierno/plan-del-nuevo-gobierno-para-nueva-eps-reducir-base-de-afiliados-para-garantizar-operatividad-y-mejores-servicios-499575)
- Afiliados: 11,76 millones (jun-2025) → 11,44 millones (mar-2026); cuentas embargadas (ene-2026); obligaciones con la red de ~13,2 billones (jul-2026) (resumen del buscador sobre estas notas) — [Portafolio – pérdida de 314.586 afiliados](https://www.portafolio.co/economia/gobierno/afiliados-a-nueva-eps-caen-en-314-586-golpe-del-contributivo-marca-el-deterioro-del-sistema-de-salud-491712); [Semana, ene-2026](https://www.semana.com/nacion/articulo/nueva-eps-admite-que-su-operacion-esta-en-riesgo-por-problemas-economicos-11-millones-de-afiliados-estan-en-vilo/202601/); [El Heraldo, 10-jul-2026](https://www.elheraldo.co/atlantico/2026/07/10/los-22-billones-de-deuda-de-la-nueva-eps-golpean-la-atencion-a-los-usuarios/)
- Circular externa del 23-oct-2025 ligada a la «App IPS y Promotores» (contenido no verificado) — [Nueva EPS – IPS](https://nuevaeps.com.co/ips)
- Circular conjunta 019 del 23-may-2025 (MinSalud + Supersalud): elimina la autorización previa en ciertas atenciones (urgencias, cáncer, VIH, entre otras) — [Radio Nacional](https://www.radionacional.co/actualidad/salud/eps-ya-no-podran-exigir-autorizacion-para-urgencias-y-tratamientos-como-cancer-o)

### Inferences
- La rotación de afiliados (traslados, asignaciones de EPS liquidadas, salidas por el contributivo) hace que un padrón cargado una vez se vuelva viejo rápido; una validación «en el momento» vale más con Nueva EPS que con una EPS estable, pero la fuente oficial es un portal con intermitencias.
- No hay señales de que la intervención esté invirtiendo en una API para prestadores; lo prioritario para la entidad es pagos y red.

### Gaps
- No se encontraron reportes públicos de caídas del portal IPS, cambios de captcha ni bloqueos a robots (más allá del 403 observado en el sitio informativo).
- Fecha exacta en que la zona transaccional pasó a `portal.nuevaeps.com.co`: no encontrada.
- Estado actual (nov-2026) del Decreto 0182 y de las asignaciones de agosto de 2026: no verificado más allá de las notas citadas.

---

## 6. Evidencia práctica: manuales, tutoriales, productos o robots que ya validen derechos de Nueva EPS; problemas reportados

### Takeaway
Hay manuales y tutoriales **para personas** (video tutoriales oficiales para IPS, guías de terceros), pero **no se encontró ningún producto, robot RPA ni código público que valide derechos de Nueva EPS automáticamente**. La evidencia de terceros apunta a que, sin API, cualquier automatización sería «por pantalla» (RPA).

### Cited Findings
- Video tutoriales oficiales para IPS sobre los trámites más frecuentes (incluida la verificación del estado de afiliación por número de documento) (extracto del buscador) — [Nueva EPS – Video Tutoriales](https://nuevaeps.com.co/ips/videotutoriales)
- Manual oficial para IPS hallado: solo el de cargue de RIPS (V4.1) — [Nueva EPS – Manual Carga Usuarios RIPS](https://nuevaeps.com.co/sites/default/files/inline-files/Manual_de_usuario_Carga_Usuarios_RIPS_V4_1_para%20IPS.PDF). Un «Manual del Usuario» histórico de Nueva EPS existe en el sitio de Presidencia (antiguo, para afiliados) — [historico.presidencia.gov.co](http://historico.presidencia.gov.co/especial/nuevaeps/manualdelusuario.pdf)
- Repositorio académico que automatiza citas de una IPS con RPA «por pantalla» porque «el portal de la EPS no tiene API»; no nombra la EPS ni aborda captcha — [GitHub – automatizacion-citas-ips](https://github.com/Hever-Alfonso/automatizacion-citas-ips)
- Proveedores con RPA en el sector (Rips Solutions con Hosvital/Facture; Wiit para auditoría de EPS) automatizan **facturación/RIPS**, no la validación de derechos en Nueva EPS — [Rips Solutions](https://www.ripssolutions.com/); [Wiit](https://www.wiit.com.co/blog/software-de-auditoria-masiva-para-eps-validacion-electronica-de-facturas-con-inteligencia-artificial/)
- Medifolios anuncia un módulo «Interfaz Nueva EPS» sin documentación técnica pública (ver sección 3) — [Medifolios](https://medifolios.net/articulos/nueva-eps-interoperabilidad.php)
- Problemas reportados: cuentas bloqueadas tras cambiar la clave (comentarios de 2019–2021 en blogs no oficiales) y portal «sujeto a intermitencias» (2026) — [clonmax.com](https://clonmax.com/solucion-al-mensaje-cuenta-bloqueada-nueva-eps-2023/); [Rankia, 23-oct-2026](https://www.rankia.co/blog/pensiones-iss-cesantias/4321126-como-descargar-certificado-nueva-eps)
- Bloqueo observado en esta investigación: `nuevaeps.com.co/ips`, `/ips/autorizaciones`, `/zona-transaccional` y los PDF del sitio devolvieron HTTP 403 a clientes automáticos (WebFetch y `curl`, 2–3 nov 2026) — observación propia, sin URL de respaldo.

### Inferences
- Un robot sobre el portal IPS sería frágil (portal Java con sesión, intermitencias, bloqueos de cuenta por intentos fallidos, sitio público con antibots) y quedaría atado a la credencial de una persona; la evaluación legal del RPA la cubre otro investigador.

### Gaps
- No se encontraron videos de YouTube ni hilos de foros de terceros con la pantalla de «consulta de afiliado» del portal IPS (qué campos muestra).
- No se encontró ningún caso de un HIS colombiano (Hosvital, Dinámica, Servinte, etc.) que anuncie validación de derechos en línea contra Nueva EPS.

---

## 7. ¿Usa Nueva EPS validación biométrica (huella) o validación de identidad que bloquee la automatización?

### Takeaway
**No se encontró evidencia** de que Nueva EPS exija huella u otra validación biométrica para que la IPS consulte derechos; para urgencias basta el documento de identidad.

### Cited Findings
- Los afiliados ingresan a urgencias «presentando únicamente su documento de identificación» (extracto del buscador sobre una página de Nueva EPS) — [Nueva EPS – Urgencias y citas médicas](https://nuevaeps.com.co/personas/regimen-contributivo/urgencias-citas)
- Trámites como CTC o tutela se radican en las Oficinas de Atención al Afiliado de Nueva EPS, donde validan soportes; no se menciona huella — [Foscal – Nueva EPS](http://www.foscal.com.co/nuevaeps/)
- Las búsquedas de «Nueva EPS» + «biométrica» / «huella» solo devolvieron casos de otras entidades (IPS de Chile/Paraguay) — búsqueda del 3-nov-2026; p. ej. [Repositorio U. de Chile](https://repositorio.uchile.cl/handle/2250/104019)

### Inferences
- El freno a la automatización no sería la biometría sino el acceso con credencial personal y las medidas antibots del portal.

### Gaps
- Si la entrega de medicamentos o servicios específicos usa verificación de identidad en el punto de atención: no verificado.

---

## 8. Síntesis: ¿puede el bot, sin intervención humana y al agendar, confirmar que el paciente está activo en Nueva EPS (régimen, estado, IPS primaria, nivel)?

### Takeaway
**Con los canales oficiales de Nueva EPS documentados públicamente, no.** El único canal es un portal web para personas con usuario y clave asignados; no hay API, web service ni archivo de consulta publicados. Las rutas realistas son: (a) pedir formalmente a Nueva EPS un servicio web o la base mensual de asignados por capitación y cargarla en AgenIA; (b) usar la fuente estatal (ADRES/BDUA, la cubre otro investigador); (c) RPA sobre el portal, técnicamente posible pero frágil y con riesgo contractual o legal.

### Cited Findings
- Canal de consulta para IPS = Zona Transaccional con tipo y número de documento — [Nueva EPS – estado de afiliación IPS](https://nuevaeps.com.co/ips/estado-afiliacion)
- Credenciales «asignadas», creadas con datos de una persona y enviadas al correo registrado; bloqueo por intentos — [Nueva EPS – Login IPS](https://www.nuevaeps.com.co/ips/login); [Nueva EPS – Políticas de seguridad](https://www.nuevaeps.com.co/politicas-seguridad-privacidad); [epsenlinea.com.co](https://epsenlinea.com.co/nueva-eps/como-registrarse-nueva-eps/)
- Sin API pública de derechos; lo único que se anuncia como «interoperabilidad con Nueva EPS» es material comercial de un tercero sobre intercambio clínico — [Medifolios](https://medifolios.net/articulos/nueva-eps-interoperabilidad.php)
- Portal «sujeto a intermitencias» (2026) — [Rankia, 23-oct-2026](https://www.rankia.co/blog/pensiones-iss-cesantias/4321126-como-descargar-certificado-nueva-eps)

### Inferences
- Tabla de automatizabilidad (inferida a partir de lo citado arriba):

| Canal | Autenticación | ¿Automatizable sin humano? |
|---|---|---|
| Zona/Portal Transaccional IPS (`portal.nuevaeps.com.co`) | Usuario + clave asignados (probablemente por persona); captcha/OTP desconocidos | Solo por RPA (no oficial, frágil, riesgo de incumplir términos) |
| App IPS y Promotores (circular 23-oct-2025) | Desconocida | Desconocido; app móvil, no pensada para integración |
| Video tutoriales / páginas IPS | Pública (pero el sitio bloquea bots) | No aplica (informativo) |
| Líneas 01 8000 952000 / 954400 | Asesor humano | No |
| Archivo/base de asignados por capitación | Por contrato (no documentado) | Sí, en lote (si existe): cargar y consultar en AgenIA, con atraso de hasta un mes |
| Web service / API oficial | No existe públicamente | Solo si Nueva EPS lo concede por convenio (sin procedimiento público) |

- Para AgenIA (que ya maneja padrones de otras EPS), lo más práctico a corto plazo parece ser la base de asignados por capitación de Nueva EPS para el hospital (si el contrato la contempla) más un cruce con la fuente estatal; el portal debería quedar para que la persona del hospital revise los casos dudosos.
- Antes de cualquier RPA, el hospital debería pedir por escrito a Nueva EPS (gestor de red Caldas): (1) si hay un servicio web de consulta de derechos para el HIS, (2) los términos de uso del usuario IPS (personal o institucional, si se permite automatizar), (3) la base de asignados de capitación (periodicidad, formato, campos: régimen, estado, IPS primaria, nivel/categoría).

### Gaps
- No se pudo confirmar qué datos muestra el portal (régimen, nivel o categoría de copago, IPS primaria); sin eso no se sabe si el portal sirve para todos los campos que pide AgenIA.
- Todo lo de autenticación más allá de usuario y clave queda sin verificar.
