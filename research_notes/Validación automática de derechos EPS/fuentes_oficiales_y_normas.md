# Fuentes oficiales y marco normativo para verificar derechos (afiliación) en Colombia — capa estatal (ADRES, MinSalud/SISPRO, interoperabilidad, normas EPS↔IPS)

Notas de investigación. Fecha de corte: 3 de noviembre de 2026. Todas las páginas web se consultaron el 2 y 3 de noviembre de 2026 («consultada 2026-11-03»). Cuando un documento oficial era un PDF escaneado (Res. 2284 de 2023, Res. 948 de 2026), se leyó el PDF oficial descargado y se le pasó OCR localmente (Vision de macOS). Las citas textuales de esos dos documentos vienen de ese OCR y pueden tener errores menores de reconocimiento (se marcan). No se entró a ningún sistema, no se resolvió ni evadió ningún captcha y no se automatizó ninguna consulta.

---

## 1. ADRES — consulta pública «Consulte su EPS» (BDUA): qué devuelve, qué protecciones y qué condiciones de uso tiene

### Takeaway
La consulta pública de la BDUA de ADRES es gratuita, sin usuario ni autenticación, por tipo y número de documento, y está pensada expresamente también para hospitales, clínicas e IPS. Devuelve EPS, régimen, estado (vigente / no vigente) y fecha de inicio. Pero es una consulta manual en la web y no un servicio para máquinas. ADRES dice que su resultado es solo «reflejo de lo reportado» por las EPS, que no certifica afiliación y que no debe ser «nunca» el único criterio para negar un servicio. Sus términos prohíben los usos que «sobrecarguen» los portales y el uso de la información para «beneficio propio».

### Cited Findings
- **Para quién es:** la ficha del trámite para clínicas y hospitales dice que la consulta «puede ser usada por hospitales, clínicas e IPS para verificar en línea la afiliación registrada en la BDUA», en admisión, atención, facturación y auditoría. Y que «La consulta pública 'Consulte tu EPS' no requiere usuario institucional ni autenticación previa». Es virtual, «sin costo» y de tiempo «inmediato». La página no muestra fecha. — [ADRES, «Consulte su EPS» (clínicas y hospitales), consultada 2026-11-03](https://www.adres.gov.co/tramites/clinicas-hospitales/consulta-afiliacion-eps)
- **Qué devuelve (según ADRES):** la ficha «uso institucional» la describe como «servicio informativo digital que permite a las EPS, Entidades Territoriales, IPS y demás entidades del sector salud» verificar la afiliación. Devuelve: EPS o entidad responsable; régimen (contributivo, subsidiado, especial o de excepción); estado de afiliación (vigente o no vigente) y fecha de inicio. El resultado se puede imprimir como «comprobante informativo». Solo pide tipo y número de documento. — [ADRES, «Consulta de Afiliación en la BDUA (Consulta tu EPS) – uso institucional», consultada 2026-11-03](https://www.adres.gov.co/tramites/otras-instituciones/consulta-de-afiliacion-en-la-bdua-consulta-tu-eps-uso-inst)
- **Valores de estado:** las fichas oficiales hablan solo de «vigente / no vigente». **No se pudo confirmar en fuente oficial** la lista exacta de estados que muestra hoy el resultado (ACTIVO, SUSPENDIDO, RETIRADO, AFILIADO FALLECIDO, etc.): el formulario se carga por JavaScript y no se leyó. Hay impresiones antiguas del resultado (2021) en expedientes judiciales con la ruta `aplicaciones.adres.gov.co/bdua_internet/Pages/RespuestaConsulta.aspx`. — [Rama Judicial, anexo «2021-269 Bdua2.pdf» (2021)](https://www.ramajudicial.gov.co/documents/36167782/0/2021-269+Bdua2.pdf/44f180a8-d482-4db3-b65f-e6ccc6df96e6)
- **Dónde vive la consulta hoy:** la página `adres.gov.co/consulte-su-eps` carga el formulario de forma dinámica («Cargando contenido…»). Una guía de terceros (no oficial) dice que la consulta está ahora en `servicios.adres.gov.co/BDUA/Consulta-Afiliados-BDUA` y que pide resolver un captcha. — [ADRES, /consulte-su-eps, consultada 2026-11-03](https://www.adres.gov.co/consulte-su-eps); [Colombiatramita (tercero, sin fecha)](https://colombiatramita.co/salud/consultar-bdua-adres/). El intento de leer `servicios.adres.gov.co/BDUA/Consulta-Afiliados-BDUA` falló por un error de certificado TLS («unable to verify the first certificate») el 2026-11-03.
- **Advertencias de ADRES en la propia página:** «estas actualizaciones dependen netamente de las EPS y no de la ADRES»; «La información registrada en esta página es reflejo de lo reportado por las entidades»; no se «expiden certificaciones en razón a que las EPS son las responsables por los soportes de afiliación»; la información debe usarse «nunca como único criterio para denegar la prestación de los servicios de salud a las personas» y «solo debe ser utilizada para fines relacionados con la verificación del estado de afiliación». La página cita como base las resoluciones 1133 de 2021, 2153 de 2021 y 762 de 2023. — [ADRES, /consulte-su-eps, consultada 2026-11-03](https://www.adres.gov.co/consulte-su-eps)
- **Frecuencia de actualización:** según las fichas de ADRES, los datos «se actualizan mensualmente, conforme al proceso de carga de la BDUA administrada por la ADRES». Esta frase la resumió el buscador a partir de las fichas oficiales y **no se citó textualmente desde la página**. — [ADRES, fichas de trámite (resumen del buscador), consultadas 2026-11-03](https://www.adres.gov.co/tramites/otras-instituciones/consulta-individual-de-afiliados-bdex-bdua)
- **Términos y condiciones de uso de los portales de ADRES** (PDF fechado «02/06/2021», Bogotá, junio de 2021):
  - «Queda expresamente prohibido el uso de los portales web de la Entidad que de cualquier forma sobrecarguen, dañen o inutilicen las redes, servidores y demás equipos informáticos…»
  - «El Usuario no puede emplear los contenidos y, en particular, la información de cualquier otra clase obtenida a través de la ADRES o de los servicios, para emitir publicidad o beneficio propio.»
  - Sección «CONSULTA BDUA»: «La información generada como resultado de la consulta a la BDUA es el reflejo de lo reportado por las entidades del Régimen contributivo y el Régimen Subsidiado en cumplimiento de la Resolución 4622 de 2016… esta información se debe utilizar como complemento al marco legal y técnico definido y nunca como único criterio para la prestación de servicios de salud.»
  - ADRES «de ninguna manera asegura la exactitud y/o veracidad» de la información ni su actualización.
  - El texto **no tiene una cláusula expresa** sobre robots, *scraping* o consultas automáticas ni sobre límites de frecuencia.
  
  — [ADRES, «Términos y Condiciones de Uso de los Portales» (PDF, 02/06/2021)](https://www.adres.gov.co/api/media/file/Terminos-y-Condiciones-de-Uso-Portales.pdf), enlazado desde [/terminos-condiciones](https://www.adres.gov.co/terminos-condiciones).
- **Captcha y límites:** ni las fichas oficiales ni la página de consulta, tal como se pudo leer, describen el captcha (tipo) ni límites de consultas. — [ADRES, /consulte-su-eps](https://www.adres.gov.co/consulte-su-eps); [ADRES, ficha clínicas y hospitales](https://www.adres.gov.co/tramites/clinicas-hospitales/consulta-afiliacion-eps)

### Inferences
- Para un bot que agenda sin humano, la consulta pública de ADRES sirve como señal de apoyo, no como fuente decisoria. ADRES dice dos veces (página y términos) que no debe ser el único criterio para negar un servicio, y la norma de facturación pone como medio de verificación la base de datos que entrega la EPS (ver §5).
- Consultarla de forma masiva o automática desde un software comercial choca, como mínimo, con la prohibición de «sobrecargar» los portales y con la de usar la información para «beneficio propio». Además exigiría evadir un captcha (según el tercero). Ese riesgo lo profundiza otro investigador.
- Los datos tienen corte mensual (cargue BDUA), así que un cambio reciente de EPS o de estado puede no verse a tiempo. Para el «estado en el momento de la cita», la fuente de la EPS puede ser más fresca.

### Gaps
- No se pudo ver el formulario actual (se carga por JavaScript; `servicios.adres.gov.co` dio error TLS). No se confirmó el tipo de captcha (imagen, reCAPTCHA, etc.), ni la lista exacta de estados (ACTIVO / SUSPENDIDO / RETIRADO / AFILIADO FALLECIDO / PROTECCIÓN LABORAL…), ni los campos del resultado (tipo de afiliado, municipio, fecha de afiliación efectiva).
- No se encontró documento oficial sobre límites de frecuencia o bloqueo por IP.
- No se leyeron las resoluciones ADRES 762 de 2023 (lineamientos LMA y BDUA), 1133 de 2021 y 2153 de 2021, que las fichas citan como base del servicio.

---

## 2. ¿Ofrece ADRES un servicio web / API / SFTP / consulta masiva para IPS, EPS, entes territoriales o proveedores de software? ¿Con qué convenio?

### Takeaway
No se encontró ningún servicio web, API, SFTP ni «consulta masiva» de afiliación BDUA publicado por ADRES para IPS ni para proveedores de software. Lo único distinto de la consulta pública es el **Portal Transaccional (BDEX/BDUA) con usuario institucional**, pensado para EPS, entidades territoriales, regímenes especiales y de excepción y la propia ADRES, no para IPS. Ahí la consulta también es individual y manual. Hay un antecedente territorial (Bogotá) de «comprobador de derechos» con usuario y clave para prestadores, alimentado con la BDUA al cierre del mes anterior.

### Cited Findings
- **Consulta Individual de Afiliados (BDEX/BDUA):** según ADRES, permite a «EPS, Entidades Territoriales, regímenes especiales y de excepción, y la ADRES» consultar uno por uno el estado de afiliación. La FAQ dice que «solo las entidades habilitadas (EPS, Entidades Territoriales, regímenes especiales)» pueden usarlo.
  - **Requisitos:** «Usuario institucional ADRES con credenciales activas», «Rol de consulta habilitado en el módulo BDEX/BDUA». Usuario y clave se piden por la Mesa de Servicio Ivanti «según procedimientos internos de la DGTIC».
  - **Pasos:** autenticarse, elegir el módulo Consulta BDEX y digitar tipo y número de documento.
  - **Qué devuelve:** régimen, EPS, estado vigente o no vigente, historial de traslados y novedades, y un reporte descargable.
  - **Portal:** `https://servicios.adres.gov.co/BDUA/`. La ficha no menciona servicio web, API, consulta masiva, SFTP ni convenio. Normas citadas: Res. ADRES 762 de 2023, Res. 1133 de 2021, Decreto 780 de 2016, Ley 1712 de 2014.
  
  — [ADRES, «Consulta Individual de Afiliados (BDEX/BDUA)», consultada 2026-11-03](https://www.adres.gov.co/tramites/otras-instituciones/consulta-individual-de-afiliados-bdex-bdua)
- **Búsquedas sin resultado:** no se encontró documentación técnica oficial de un servicio web de afiliación para IPS. Las búsquedas («ADRES servicio web consulta afiliados BDUA IPS», «interoperabilidad convenio intercambio información IPS») solo devolvieron las fichas de trámite y sitios de terceros no oficiales (adres-consulta.se, consulta-adres.co, adresconsulta.com.co). — búsquedas del 2026-11-02/03; ver [ADRES, ficha uso institucional](https://www.adres.gov.co/tramites/otras-instituciones/consulta-de-afiliacion-en-la-bdua-consulta-tu-eps-uso-inst)
- **Estadísticas públicas:** ADRES publica agregados («Afiliados por departamento y estado de afiliación») en el mismo portal de servicios. Son datos agregados, no consultas por persona. — [servicios.adres.gov.co, estadística BDUA (resultado de búsqueda, 2026-11-03)](https://servicios.adres.gov.co/BDUA/Estad%C3%ADstica/Afiliados-por-departamento-y-estado-de-afiliaci%C3%B3n)
- **Antecedente territorial: «Comprobador de Derechos» de la Secretaría Distrital de Salud de Bogotá** (manual SDS-ASS-MN-003 V.2, actualizado 15/11/2017 «sustituyendo FOSYGA por ADRES»):
  - Es una «herramienta Web… que permite a cualquier ciudadano o entidad del sector salud, consultar el estado de una persona en las bases de datos de Aseguramiento del Distrito Capital».
  - Muestra a la vez bases externas, entre ellas «los Regímenes Subsidiado y Contributivo de Bogotá de la Base de Datos Única de Afiliados (BDUA) del Adres al cierre del mes inmediatamente anterior».
  - El detalle (estado, EPS-S e IPS primaria, novedades) exige «usuario y contraseña los cuales serán entregados por la Secretaria Distrital de Salud a los entes de control y los prestadores de los servicios de salud del Distrito».
  - Base legal citada: Decreto 780 de 2016.
  
  — [SDS Bogotá, «Manual de usuario Comprobador de Derechos» (PDF, v2 15/11/2017)](https://www.saludcapital.gov.co/Biblioteca%20Manuales%202016/ASEGURAR_SALUD/MANUAL_DE_USUARIO_COMPROBADOR_DE_DERECHOS.pdf)

### Inferences
- A noviembre de 2026, la vía estatal «legítima» para que un software de IPS consulte afiliación de forma automática no existe en público. Una integración sistema a sistema con ADRES exigiría pedirla a ADRES (DGTIC) como acuerdo de intercambio de información. No se halló precedente de que se conceda a IPS o a proveedores.
- El portal BDEX/BDUA con usuario institucional no está pensado para IPS. Aunque la ESE fuera habilitada, la consulta sería individual y manual, y usar esas credenciales desde un bot sería un uso automatizado de credenciales institucionales que la ficha no contempla.
- El modelo de Bogotá (ente territorial que cruza la BDUA mensual con sus bases y da usuario y clave a prestadores) muestra que lo usual es que la DTS sea el intermediario de la BDUA para la red pública, sobre todo en régimen subsidiado.

### Gaps
- No se pudo verificar si ADRES firma convenios de intercambio de información (por ejemplo, por X-Road / Servicios Ciudadanos Digitales) con terceros para consultar la BDUA. Las búsquedas no devolvieron nada (dos se cortaron por fallas de la herramienta).
- No se halló ningún cambio de 2024-2026 que anuncie una «BDUA en línea» o un servicio web nuevo. Solo se ve que la consulta migró del antiguo `aplicaciones.adres.gov.co/bdua_internet` al nuevo `servicios.adres.gov.co/BDUA`, y la fecha de esa migración no está documentada.
- No se encontró evidencia pública (GitHub, foros, documentación de proveedores) de software que consulte la BDUA de forma automática, ni de advertencias o bloqueos de ADRES por ese motivo. Las búsquedas en GitHub solo dieron material genérico para evadir captchas, que no se usó.

---

## 3. MinSalud / SISPRO: SAT («Mi Seguridad Social»), RUAF, PISIS, Mecanismo Único de Validación (MUV) de los RIPS — ¿alguno valida afiliación o derechos y lo puede llamar un prestador?

### Takeaway
Ningún servicio público de MinSalud/SISPRO revisado funciona como «comprobador de derechos» al que una IPS pueda llamar en tiempo real.
- **SAT / Mi Seguridad Social:** es un portal para que el afiliado se afilie, reporte novedades y vea su propio estado. La página de MinSalud no menciona a IPS ni servicios web.
- **MUV de los RIPS:** hoy lo regula la **Res. 948 de 14 de mayo de 2026**, que derogó las resoluciones 2275 de 2023, 558 de 2024 y 1884 de 2024. Valida la estructura, el contenido y la relación entre RIPS y factura después de la atención. Su definición legal no incluye verificar la afiliación del usuario, y a las EPS les prohíbe montar validaciones paralelas para radicar.

### Cited Findings
- **SAT:** la página de MinSalud lo describe como «portal creado con el propósito de facilitar a los ciudadanos la afiliación». El afiliado tiene «consulta del estado actual de su afiliación». La página no menciona EPS ni IPS ni servicios de consulta para prestadores, y no muestra fecha. — [MinSalud, «Sistema de Afiliación Transaccional – SAT», consultada 2026-11-03](https://minsalud.gov.co/Proteccion-Social/Paginas/afiliacion-transaccional-sat.aspx). Un tutorial de una EPS (2019) confirma que el afiliado ve su estado y el historial de inscripciones. — [Coosalud, «Tutorial SAT» (PDF, 2019)](https://www.coosalud.com/wp-content/uploads/2019/04/Tutorial-sat-4.pdf)
- **Res. 948 de 2026 (RIPS/FEV):**
  - «RESOLUCIÓN NÚMERO 000948 DE 14 MAY 2026 – Por la cual se reglamenta el Registro Individual de Prestación de Servicios de Salud (RIPS) como soporte de la Factura Electrónica de Venta (FEV) en salud, se derogan las Resoluciones 2275 de 2023, 558 y 1884 de 2024». Art. 23: «rige a partir de la fecha de su expedición».
  - Define el **mecanismo único de validación** como el «mecanismo dispuesto por este Ministerio, el cual desarrolla las reglas de estructura, contenido y relación de los datos del Registro Individual de Prestación de Servicios de Salud (RIPS), como soporte de la Factura Electrónica de Venta (FEV)…».
  - Define las **reglas de validación** como condiciones «aplicables a la estructura, contenido y relación de los campos de datos… para garantizar la consistencia y razonabilidad de la información», con resultado de CUV, rechazo o notificación. Dice que «las reglas de notificación se convertirán gradualmente en reglas de rechazo». Las reglas concretas están en un «Documento Técnico Campos y Reglas de Validación» publicado en SISPRO.
  - Fija que los pagadores no podrán usar ni adicionar reglas ni montar «mecanismos alternos de validación, como condición para radicar las facturas» (frase reconstruida de un OCR parcial).
  
  — [Res. 948 de 2026, PDF en el repositorio legal de PwC (escaneado; leído con OCR el 2026-11-03)](https://legalytributarioenlinea.co.pwc.com/Repositorio%20PwC/PDF/Normas%20Nacionales/Resoluciones/Ministerio%20de%20Salud%20y%20Protecci%c3%b3n%20Social/2026/RES-000948-26.pdf); también en [SIDN Rama Judicial](https://sidn.ramajudicial.gov.co/SIDN//NORMATIVA/TEXTOS_COMPLETOS/8_RESOLUCIONES/RESOLUCIONES%202026/MSPS%20Resolucion%20000948%20de%202026.pdf) y [presentación MinSalud](https://www.minsalud.gov.co/sites/rid/Lists/BibliotecaDigital/RIDE/DE/OT/pres-resolucion-0948-de-2026.pdf)
- **Base de conocimiento de la mesa de ayuda FEV-RIPS** (CVSF12, archivo de sept. 2024): no tiene ninguna mención a BDUA, afiliación ni validación de derechos. Se buscó en el texto extraído. — [MinSalud, «Base de conocimiento… FEV-RIPS» (PDF, 2024-09-10)](https://www.minsalud.gov.co/sites/rid/Lists/BibliotecaDigital/RIDE/DE/OT/base-conocimiento-sistema-informacion-facturacion-electronica-fev-rips.pdf)
- **Validación cercana a «tipo de usuario»:** un análisis secundario dice que el MUV contrasta el campo de cobertura o plan de beneficios de la factura XML con el `tipoUsuario` del JSON de RIPS. Es coherencia interna, no consulta a la BDUA. — [ConsultorSalud (secundario), resultado de búsqueda 2026-11-03](https://consultorsalud.com/implementacion-mecanismo-unico-de-validacion/)
- **MIPRES / SISPRO:** las IPS se registran en SISPRO y en Mi Seguridad Social para delegar usuarios de MIPRES. Los servicios web documentados de MIPRES sirven para reportar prescripción y dispensación, no para consultar afiliación. — [MinSalud, registro de delegados EPS/IPS MIPRES (2023-07-24)](https://www.minsalud.gov.co/sites/rid/Lists/BibliotecaDigital/RIDE/DE/OT/registro-usuarios-delegados-administrativos-eps-ips-prov-mipres-20230724.pdf); [MinSalud, anexo técnico módulo dispensador v3.1](https://www.minsalud.gov.co/sites/rid/Lists/BibliotecaDigital/RIDE/DE/OT/anexo-tecnico-modulo-dispensador-proveedores-v3.1.pdf) (solo títulos y resumen del buscador; no se leyeron completos).

### Inferences
- El MUV funciona después de la atención (facturación) y su definición no incluye mirar la BDUA. No sirve para confirmar elegibilidad al momento de agendar.
- Como la Res. 948 prohíbe a las EPS montar «mecanismos alternos de validación» para radicar, la verificación de derechos queda, en lo normativo, en la etapa previa a la atención (base de datos o mecanismo pactado con la EPS; ver §5) y no en el validador de facturas.

### Gaps
- No se leyó el «Documento Técnico Campos y Reglas de Validación del RIPS» vigente (SISPRO). Puede tener alguna regla de notificación que cruce el documento del usuario con maestros de MinSalud. No se confirmó.
- RUAF y PISIS: no se encontró documentación de que expongan consulta de afiliación a prestadores. PISIS es para cargar archivos de reporte. Queda sin confirmar por falta de fuentes en esta pasada.
- No se encontró ninguna API de MinSalud tipo «comprobador de derechos».

---

## 4. Interoperabilidad (Ley 2015 de 2020, Res. 866 de 2021, Res. 1888 de 2025 – RDA): ¿obliga a las EPS a exponer servicios a las IPS? ¿Incluye elegibilidad o afiliación?

### Takeaway
El marco de Interoperabilidad de la Historia Clínica Electrónica (IHCE) trata datos clínicos: el Resumen Digital de Atención (RDA) de paciente, hospitalización, consulta externa y urgencias. No crea un servicio de elegibilidad ni obliga a las EPS a exponer consulta de afiliación a las IPS. La Res. 1888 de 2025 menciona a los prestadores como obligados a disponer datos clínicos y no nombra datos de afiliación, EAPB ni régimen.

### Cited Findings
- **Res. 1888 de 2025** (15 sep. 2025, Diario Oficial 53.244):
  - Adopta el RDA dentro de la IHCE. El RDA se compone de los «datos clínicos relevantes» de la Res. 866 de 2021.
  - Tipos iniciales: paciente, hospitalización, consulta externa y urgencias.
  - El mecanismo IHCE ofrece generación, envío y búsqueda/consulta del RDA (art. 3).
  - Plazo máximo de seis meses desde el 15 de octubre de 2025 para integrar e interoperar (art. 6).
  - Remite a los actores del art. 2 de la Res. 866 de 2021.
  - No menciona datos de afiliación, EAPB, régimen ni servicios de elegibilidad, y tampoco nombra FHIR en el texto.
  
  — [Normograma Supersalud, Res. 1888 de 2025, consultada 2026-11-03](https://normograma.supersalud.gov.co/compilacion/docs/resolucion_minsaludps_1888_2025.htm); [MinSalud PDF](https://www.minsalud.gov.co/sites/rid/Lists/BibliotecaDigital/RIDE/DE/DIJ/resolucion-1888-de-2025.pdf)
- **Modificación de 2026:** un proyecto de julio de 2026 proponía añadir el RDA de dispensación de medicamentos. Hay un archivo «Resolución 1799 de 2026» (agosto de 2026) que la modifica en ese sentido. No se confirmó su texto. — [ConsultorSalud, PDF Res. 1799 de 2026 (ago. 2026)](https://consultorsalud.com/wp-content/uploads/2026/08/Resolucion-1799-de-2026.pdf); [MinSalud, memoria justificativa historia clínica (22 jul. 2026)](https://www.minsalud.gov.co/Normativa/anexosproyectos/ANEXO2MEMJUSTIFICATIVAHISTORIA%20CLINICA%2022%20JUL%2026_20260722151201.pdf)
- **Micrositio IHCE con la normativa:** [MinSalud IHCE – Normatividad](https://www.minsalud.gov.co/ihce/Paginas/Normatividad.aspx) (solo resultado de búsqueda, no leído).

### Inferences
- La interoperabilidad obligatoria de 2025-2026 no le da al hospital un canal para saber si un paciente está activo en una EPS. Es un canal de datos clínicos entre prestadores.

### Gaps
- No se leyeron el Anexo Técnico 1 de la Res. 1888, el art. 2 de la Res. 866 de 2021 (lista de actores obligados) ni el estándar técnico (FHIR / HL7). No se puede afirmar ni negar con fuente primaria si el RDA de paciente lleva un campo de aseguradora o régimen.
- No se encontró ninguna resolución de 2024-2026 que obligue a las EPS a exponer servicios web de elegibilidad a las IPS.

---

## 5. Obligaciones: deber de la EPS de dar a la IPS un mecanismo para verificar derechos, deber de la IPS de verificar y consecuencias (devoluciones y glosas)

### Takeaway
El marco vigente pone la verificación de derechos en la **base de datos o mecanismo que entrega la entidad responsable de pago (ERP / EPS)**, no en ADRES.
- **Decreto 441 de 2022** (que reemplazó las reglas de acuerdos de voluntades en el Decreto 780 de 2016) obliga a las ERP a garantizar «el acceso oportuno a la información de la población a ser atendida», depurada, con novedades al día y coherente con la BDUA, «a través de bases de datos georreferenciadas» o de «los mecanismos de verificación de derechos al momento de la atención». Lo concreto se pacta en el contrato.
- **Res. 2284 de 2023** (manual único de devoluciones y glosas): la devolución DE16 «Persona corresponde a otro responsable de pago» se mide contra «la base de datos proporcionada previamente por la entidad responsable de pago o según el mecanismo de disposición de información pactado». En urgencias, si no se conoce la ERP, se puede consultar la BDUA y validar después con la ERP.
- **Decreto 441:** si el usuario figura en la base entregada por la ERP, no se puede devolver ni glosar con el argumento de que no estaba en la BDUA al momento de la atención.
- **Decreto 4747 de 2007, art. 11** (compilado como art. 2.5.3.1.1 del Decreto 780): define la verificación de derechos, obliga al prestador a verificar en la base que dan los responsables del pago y prohíbe usarla para posponer la atención inicial de urgencias.

### Cited Findings
- **Decreto 4747 de 2007, art. 11 «Verificación de derechos de los usuarios»:**
  - «La verificación de derechos de los usuarios es el procedimiento por medio del cual se identifica la entidad» responsable del pago y el derecho del usuario a ser cubierto.
  - El prestador «deberá verificar la identificación del usuario en la base de datos provista por los responsables del pago».
  - «No podrán exigirse al usuario copias, fotocopias o autenticaciones de ningún documento.»
  - Parágrafo 1: la verificación «no podrá ser causa bajo ninguna circunstancia para posponer la atención inicial de urgencias».
  - Según la nota del normograma, el art. 11 quedó compilado en el **art. 2.5.3.1.1 del Decreto 780 de 2016**.
  
  — [Normograma Supersalud, Decreto 4747 de 2007, consultado 2026-11-03](https://normograma.supersalud.gov.co/compilacion/docs/decreto_4747_2007.htm)
- **Decreto 4747 de 2007, art. 6, parágrafo 1** (texto histórico, compilado en 2.5.3.4.6 y luego **sustituido** por el Decreto 441 de 2022, que reemplazó todo el Capítulo 4):
  - Las ERP «garantizarán la administración en línea de las bases de datos de los afiliados… asegurando su depuración, y el correcto y oportuno registro de las novedades».
  - Si no la hay, «se entenderá que continúa vigente la última información disponible».
  - Los servicios prestados «no podrán ser objeto de glosa con el argumento de que el usuario no está incluido».
  - El **art. 7** (capitación) exigía «Base de datos con la identificación de los usuarios cubiertos con el acuerdo de voluntades».
  
  — [Normograma Supersalud, Decreto 4747 de 2007](https://normograma.supersalud.gov.co/compilacion/docs/decreto_4747_2007.htm)
- **Decreto 441 de 2022** (28 mar. 2022, Diario Oficial 51.990), que sustituye el Capítulo 4, Título 3, Parte 5, Libro 2 del Decreto 780 de 2016:
  - **Art. 2.5.3.4.2.2 (contenido mínimo de los acuerdos de voluntades), num. 4:** «Base de datos georreferenciada de la población objeto de atención para las intervenciones individuales», con «su mecanismo de actualización, que incluya la periodicidad, según la modalidad de pago».
  - **Parágrafo del mismo artículo:** «Las entidades responsables de pago garantizarán el acceso oportuno a la información de la población a ser atendida… asegurando su calidad, depuración y la actualización oportuna de las novedades», «a través de bases de datos georreferenciadas» o de «los mecanismos de verificación de derechos al momento de la atención», información que «deberá corresponder con lo registrado en la Base de Datos Única de Afiliados (BDUA)».
  - **Art. 2.5.3.4.5.4, parágrafo** (en las reglas de devoluciones y descuentos de pagos prospectivos): lo facturado «acorde con la base de datos suministrada por la entidad responsable de pago» no puede ser objeto de devolución o glosa con el argumento de que «el usuario al momento de la atención no está incluido en la BDUA».
  - **Art. 2.5.3.4.7.2:** «Corresponde a las entidades responsables de pago mantener actualizados los datos de contacto de los usuarios». Prestadores y proveedores «informarán periódicamente a las entidades responsables de pago las novedades que identifiquen», y el contrato debe tener «una cláusula en la que se determine la periodicidad en la que se actualizarán los datos».
  - **Art. 2.5.3.4.8.3:** «Los mecanismos y plazos para la entrega y actualización de la información deberán constar en el acuerdo de voluntades».
  
  — [Normograma Supersalud, Decreto 441 de 2022, consultado 2026-11-03](https://normograma.supersalud.gov.co/compilacion/docs/decreto_0441_2022.htm) (el Gestor Normativo de Función Pública dio error de certificado TLS el 2026-11-02: [enlace](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=184728))
- **Res. 2284 de 2023** (28 dic. 2023; Diario Oficial 29 dic. 2023), Anexo Técnico 3, Manual Único de Devoluciones, Glosas y Respuestas. Citas del OCR del PDF oficial:
  - **Las causales son taxativas:** «Las causas de devolución son taxativas y corresponden a la labor que tiene la entidad responsable de pago frente a definir su responsabilidad en el pago».
  - **DE16:** «Persona corresponde a otro responsable de pago». Nota: «El medio para la verificación de derechos es la base de datos proporcionada previamente por la entidad responsable de pago o según el mecanismo de disposición de información pactado por las partes en el acuerdo de voluntades». No aplica cuando la factura incluye varios pacientes o servicios y solo una parte cae en la causal; en ese caso se va a glosa.
  - **DE1601:** «La factura corresponde a una persona que pertenecía a otro responsable de pago…» (el OCR se cortó). Nota: «Si no se conoce la entidad responsable de pago en la atención de urgencias, la consulta de la información se podrá realizar a través de la Base de Datos Unica de Afiliados BDUA y posteriormente se realizará la validación de derechos con la entidad responsable de pago». Del paciente inconsciente e indocumentado se informa a la entidad territorial y, aclarada la ERP, se le informa «sin que pueda aplicar la causal de Glosa».
  - **Glosas de facturación** (el código exacto no se pudo alinear por el OCR; parece de la familia FA16, FA1605 / FA1606): «En la factura se relacionan una o varias personas que en el momento de la prestación de servicio corresponden a otro responsable de pago» y «…uno o varios servicios o tecnologías en salud que corresponden a otro responsable de pago», cuando la factura se puede tramitar en parte.
  - **Glosa por menos personas en una modalidad prospectiva:** «Aplica con la información proporcionada previamente por la entidad responsable de pago según el mecanismo de disposición pactado… el número de personas incluidas en la modalidad de pago prospectiva es disminuido por novedades en la base de datos proporcionada por la entidad responsable de pago» (código alrededor de FA58/FA59, sin confirmar).
  
  — [MinSalud, Res. 2284 de 2023 (PDF escaneado, OCR local 2026-11-03)](https://www.minsalud.gov.co/Normatividad_Nuevo/Resolución%20No%202284%20de%202023.pdf)
- **Entrada en vigor de la Res. 2284** (art. 12, modificado por la Res. 1885 de 2024): grupo 1 (alta complejidad y ERP) el 1 de feb. de 2025; grupo 2 (mediana complejidad) el 1 de abr. de 2025; grupo 3 (baja complejidad, independientes y proveedores) el 1 de jun. de 2025. Lo prestado antes podía regirse por las normas anteriores hasta el 31 de dic. de 2025. — [Normograma Supersalud, Res. 2284 de 2023](https://normograma.supersalud.gov.co/compilacion/docs/resolucion_minsaludps_2284_2023.htm)
- **Reglamentación del Decreto 441:** MinSalud señala como resoluciones reglamentarias la 2284 y la 2335 de 2023, y la Circular Externa 21 de 2024 trata su transición. — [MinSalud, relaciones entre prestadores y pagadores](https://minsalud.gov.co/salud/prestacion-servicios/Paginas/relaciones-entidades-prestadoras-pagadoras-servicios-salud.aspx); [Circular Externa 21 de 2024](https://www.minsalud.gov.co/Normatividad_Nuevo/Circular%20Externa%20No.%2021%20de%202024.pdf) (resultados de búsqueda; no leídos completos)

### Inferences
- **Quién debe dar el canal:** el deber de dar a la IPS un medio para verificar derechos es de la ERP (EPS), y su forma (archivo o base georreferenciada, portal, servicio web, etc.) **se pacta en el acuerdo de voluntades**. La norma no impone una tecnología: admite tanto «bases de datos» como «mecanismos de verificación de derechos al momento de la atención». Una ESE puede pedir en su contrato con cada EPS un canal en línea (servicio web o portal con consulta automatizable) apoyándose en el parágrafo del art. 2.5.3.4.2.2 y en el art. 2.5.3.4.8.3.
- **Contra qué se mide la verificación:** el medio que vale para defenderse de una devolución DE16 es la base o el mecanismo de la EPS, no ADRES. La BDUA de ADRES solo aparece como medio previsto en urgencias, cuando no se conoce la ERP. Para AgenIA, el padrón de la EPS (o un servicio de la EPS) es la fuente que protege la facturación; la consulta de ADRES sería, como mucho, una ayuda.
- **El padrón como escudo:** si el paciente estaba en la base entregada por la EPS, la ley (Decreto 441, art. 2.5.3.4.5.4, parágrafo) impide glosarlo o devolverlo por no estar en la BDUA. Por eso conviene que AgenIA guarde qué versión del padrón usó al confirmar cada cita.
- **No negar por la verificación:** por el art. 11 del Decreto 4747 (2.5.3.1.1 del Decreto 780) y por la advertencia de ADRES, un «no aparece activo» automático no debería traducirse en negar atención de urgencias. En citas programadas, lo prudente sería derivar a un humano o pedir verificación, no rechazar sin más. Esto es inferencia, no norma expresa para citas electivas.

### Gaps
- No se confirmó el texto vigente del art. 2.5.3.1.1 del Decreto 780 (Función Pública dio error TLS). Que siga vigente es una inferencia: el Decreto 441 sustituyó solo el Capítulo 4 y el 2.5.3.1.1 está en el Capítulo 1, según la nota de compilación del normograma de Supersalud.
- Res. 3047 de 2008 (formatos y anexos entre prestadores y ERP, incluido un informe de posibles inconsistencias en la base de datos): no se consultó en esta pasada. Su vigencia frente a la Res. 2284 de 2023 no se verificó.
- No se verificó si la Res. 2284 ha tenido cambios en el Anexo 3 en 2025-2026 aparte de la transición de la Res. 1885 de 2024. ConsultorSalud publicó en 2024 un proyecto de modificación ([PDF](https://consultorsalud.com/wp-content/uploads/2024/03/Modificacion-Res-2284-de-2023.pdf)).
- Códigos exactos de las glosas FA (el OCR desalineó la columna de códigos). Hay que confirmarlos en el texto del Anexo 3.

---

## 6. ¿El «padrón» o base de afiliados mensual que la EPS entrega a la IPS tiene base normativa? ¿Con qué frecuencia?

### Takeaway
Sí. Hoy la base es el **Decreto 441 de 2022, art. 2.5.3.4.2.2, num. 4 y parágrafo**: todo acuerdo de voluntades debe traer la base de datos (georreferenciada) de la población a atender y un mecanismo de actualización con periodicidad «según la modalidad de pago», coherente con la BDUA. **La norma no fija «mensual»**: la frecuencia, el formato y el canal se pactan en el contrato (art. 2.5.3.4.8.3). Lo mensual coincide con el ritmo de cargue de la BDUA en ADRES, pero no es una obligación expresa encontrada.

### Cited Findings
- Contenido mínimo del acuerdo: «Base de datos georreferenciada de la población objeto de atención…» y «su mecanismo de actualización, que incluya la periodicidad, según la modalidad de pago». La ERP debe asegurar «la actualización oportuna de las novedades» y que la información corresponda con la BDUA. — [Decreto 441 de 2022, art. 2.5.3.4.2.2](https://normograma.supersalud.gov.co/compilacion/docs/decreto_0441_2022.htm)
- Capitación y pago global prospectivo (art. 2.5.3.4.2.3): la capitación se define sobre una población «asignada y previamente identificada». La exigencia de base de datos sale del art. 2.5.3.4.2.2, que aplica a todos los acuerdos. — [Decreto 441 de 2022](https://normograma.supersalud.gov.co/compilacion/docs/decreto_0441_2022.htm)
- Antes de 2022, el art. 7 del Decreto 4747 exigía para capitación la «Base de datos con la identificación de los usuarios cubiertos con el acuerdo de voluntades». — [Decreto 4747 de 2007](https://normograma.supersalud.gov.co/compilacion/docs/decreto_4747_2007.htm)
- Mecanismos y plazos de entrega de la información: deben constar en el acuerdo de voluntades. — [Decreto 441 de 2022, art. 2.5.3.4.8.3](https://normograma.supersalud.gov.co/compilacion/docs/decreto_0441_2022.htm)
- La base de la EPS es el medio de verificación que vale ante devoluciones (DE16) y ante glosas por menos personas en pagos prospectivos. — [Res. 2284 de 2023, Anexo 3 (OCR)](https://www.minsalud.gov.co/Normatividad_Nuevo/Resolución%20No%202284%20de%202023.pdf)

### Inferences
- El hospital puede negociar con cada EPS, en el contrato, una actualización más frecuente que la mensual o un canal en línea («mecanismos de verificación de derechos al momento de la atención»). La norma lo admite expresamente y no hay que pedir permiso a ADRES.
- Para la ESE de Anserma (capitación o PGP con EPS del subsidiado), la entrega mensual de padrones es la práctica que cumple el num. 4. Su frecuencia real depende de lo pactado.

### Gaps
- No se revisó si la Supersalud ha emitido circulares (2023-2026) que exijan a las EPS una frecuencia mínima o un canal en línea para la verificación de derechos.

---

## 7. Regional: Dirección Territorial de Salud de Caldas (DTSC)

### Takeaway
No se encontró en fuentes públicas ningún servicio de consulta de afiliación de la DTSC para prestadores de Caldas (tipo «comprobador de derechos»).

### Cited Findings
- La DTSC es un establecimiento público departamental (Ordenanza 446 de 2002). Sede en Calle 49 No. 26-46, Manizales; teléfonos +57 (6) 878 3096 / 878 3097; web saluddecaldas.gov.co (datos de 2019). — [DTSC, Resolución 0147 de 2019 (PDF en MinSalud)](https://www.minsalud.gov.co/sites/rid/Lists/BibliotecaDigital/RIDE/INEC/IGUB/caldas-res-0147-de-2019.pdf)
- Su informe de rendición de cuentas trae cifras agregadas de afiliados al subsidiado por EPS, sin herramienta de consulta individual. — [Gobernación de Caldas, informe DTSC (PDF)](https://caldas.gov.co/4-planeacion-presupuesto-e-informes/4-7-informes-de-gestion-evaluacion-y-auditoria/4-7-2-informe-de-rendicion-de-cuentas-ante-la-contraloria-general-de-la-republica-o-a-los-organismos-de-contraloria-o-control-territoriales/1411-direccion-territorial-de-salud-pdf-2/download)
- Como referencia, Bogotá sí tiene un «Comprobador de Derechos» territorial con usuario y clave para prestadores (ver §2). — [SDS Bogotá, manual (2017)](https://www.saludcapital.gov.co/Biblioteca%20Manuales%202016/ASEGURAR_SALUD/MANUAL_DE_USUARIO_COMPROBADOR_DE_DERECHOS.pdf)

### Inferences
- Vale preguntarle a la DTSC si tiene una herramienta propia o un acceso de ente territorial al portal BDEX/BDUA que pueda servir a la red pública. Es el actor que, en la norma, recibe el reporte de pacientes no identificados (nota de DE1601).

### Gaps
- No se navegó saluddecaldas.gov.co. Queda sin confirmar si hay una herramienta no indexada.

---

## 8. Evidencia pública de software que consulte la BDUA de ADRES de forma automática y problemas encontrados

### Takeaway
No se encontró evidencia confiable (repositorios, documentación de proveedores, foros técnicos) de software que consulte la BDUA de forma automática, ni comunicados de ADRES sobre bloqueos. Lo que aparece son sitios de terceros no oficiales que copian la consulta para el ciudadano.

### Cited Findings
- Las búsquedas de «ADRES BDUA captcha / scraping / GitHub» solo devolvieron material genérico para evadir captchas, que no se usó, y nada sobre ADRES. — búsqueda del 2026-11-03 (sin fuente específica)
- Sitios no oficiales que imitan «ADRES Consulta EPS»: adres-consulta.se, consulta-adres.co, adresconsulta.com.co (uno se declara «informativo no oficial»). — resultados de búsqueda 2026-11-02, p. ej. [consulta-adres.co](https://consulta-adres.co/)
- La ruta antigua `aplicaciones.adres.gov.co/bdua_internet/...` aparece en impresiones de 2021-2022 aportadas a expedientes judiciales. Una respuesta de ADRES de 2022 remite a «Consulte su EPS» en adres.gov.co como la vía oficial. — [Rama Judicial, respuesta ADRES (2022)](https://ramajudicial.gov.co/documents/36938357/122461404/13+Respuesta+N.20221431511721.pdf/d374f5a6-e837-4b69-89a2-51c6fb3312d4)
- Los términos de uso de ADRES prohíben sobrecargar los portales y usar la información para «beneficio propio» (ver §1). — [ADRES, Términos y Condiciones (2021)](https://www.adres.gov.co/api/media/file/Terminos-y-Condiciones-de-Uso-Portales.pdf)

### Inferences
- Que no haya integraciones públicas, más el captcha que reportan terceros y los términos de uso, indica que el mercado de software para IPS no se apoya en ADRES para verificar en tiempo real. Lo usual sería el padrón o el portal de la EPS. Esta es una inferencia por ausencia de evidencia, no un hecho confirmado.

### Gaps
- Faltan pruebas directas: documentación de proveedores de HIS colombianos que ofrezcan «validación de derechos con ADRES», o un pronunciamiento de ADRES, Supersalud o la SIC sobre la consulta automatizada de la BDUA. No se encontró ninguna de las dos en esta pasada.
