# Cómo verifica un prestador colombiano la cobertura de medicina prepagada y planes complementarios, y si se puede automatizar

Notas de investigación. Fecha de corte: 3-nov-2026. Solo documentación pública (no se inició sesión, no se registró nada, no se resolvieron captchas ni se hizo scraping). «Consultado» = fecha en que se abrió o buscó la fuente en esta sesión (2–3 nov 2026). Las fechas de publicación se dan cuando la fuente las trae; si no, se marca «sin fecha».

Aviso general: la documentación pública de las prepagadas sobre su operación con prestadores es **muy escasa**. Lo único primario y detallado que se encontró es de **Colsanitas/Medisanitas (Keralty)**. De Colmédica, Coomeva MP, Axa Colpatria MP, Allianz y Sura casi todo lo que hay son fuentes secundarias (fichas de app, cartillas de empleadores, avisos de empleo, fallos de tutela). Esto ya es un hallazgo: **ninguna publica un portal de desarrolladores ni un servicio de validación abierto para prestadores**.

---

## 1. ¿Qué empresas de medicina prepagada y planes complementarios operan hoy en Colombia (y en Caldas/Eje Cafetero), y cuáles importan para un hospital público pequeño de Anserma?

### Takeaway
El mercado de prepagada está muy concentrado: **Colsanitas (con Medisanitas), Coomeva MP y Colmédica** suman alrededor del 90–95 % de los afiliados (unos 1,4 millones en 2025). Según la Supersalud (dato de 2024) solo hay 8 marcas o entidades de prepagada. Los «planes complementarios» van atados a una EPS y solo los contrata quien está en el régimen contributivo. Para una ESE pública de primer nivel en Anserma, lo probable es que **casi ningún paciente llegue con una prepagada que le pague al hospital**, porque las prepagadas trabajan con una red propia de prestadores adscritos.

### Cited Findings
- Entidades de medicina prepagada según la Supersalud, citada por La República el 1-jun-2024: **Axa Colpatria, Colmédica, Colsanitas, Coomeva, Medisanitas, MedPlus, Merci y Servicio de Salud Inmediato Medicina Prepagada**. El artículo no nombra empresas de planes complementarios. — [La República, 1-jun-2024](https://www.larepublica.co/empresas/cual-es-la-cifra-de-personas-que-pagan-servicios-adicionales-de-salud-en-colombia-3872782) (consultado 3-nov-2026). **Puede estar desactualizado:** es una lista de 2024 y no se pudo cotejar con un listado vigente de la Supersalud.
- Mismo artículo, con corte a dic-2023 según Fasecolda, Acemi y Proesa: de los ~51 millones de afiliados al sistema, **4,7 millones** pagan servicios adicionales. De esos planes voluntarios, el 57 % es medicina prepagada, el 27 % pólizas de salud y el 16 % planes complementarios. Grupo Keralty (Colsanitas, Medisanitas, Plan Esencial, Colsanitas Dental) tenía «poco más de 698.000» usuarios de prepagada. — [La República, 1-jun-2024](https://www.larepublica.co/empresas/cual-es-la-cifra-de-personas-que-pagan-servicios-adicionales-de-salud-en-colombia-3872782)
- Afiliados a prepagada: **1,4 millones a junio de 2025**, +37 % desde 2022. **Colsanitas, Coomeva y Colmédica concentran más del 95 %.** — [Pulzo (sin fecha visible)](https://www.pulzo.com/economia/crisis-eps-colombia-disparo-negocio-medicina-prepagada-PP4759076) (consultado 2-nov-2026; fuente secundaria).
- Cifras por compañía que el buscador atribuye a Portafolio (no se abrió el artículo, así que hay que verificarlas): Colsanitas ~811.000, Coomeva ~339.000, Colmédica ~322.000 usuarios (~90 % del segmento). Por ingresos, tres compañías tienen el 83,5 % y Colsanitas el 42,3 %. — [Portafolio: afiliados +35 % en tres años](https://www.portafolio.co/economia/crece-la-medicina-prepagada-en-colombia-afiliados-aumentan-35-en-tres-anos-491148); [Portafolio: planes voluntarios](https://www.portafolio.co/economia/finanzas/planes-voluntarios-de-salud-aumentan-ingresos-y-afiliaciones-y-alcanzan-14-5-billones-proyectados-para-485172). Otro artículo de Portafolio, sin fecha, da a Colsanitas un 52 % del mercado; parece medir otra cosa y **contradice** el 42,3 %. — [Portafolio: alianza Colsubsidio–Colsanitas](https://www.portafolio.co/negocios/empresas/colsubsidio-y-colsanitas-anuncian-una-alianza-para-ampliar-el-acceso-a-planes-de-salud-en-colombia-483292)
- Coomeva Medicina Prepagada: **más de 356.000 usuarios, más de 5.000 prestadores adscritos y 13 centros médicos propios** (La República, ~13-oct-2026). — [La República](https://www.larepublica.co/empresas/coomeva-medicina-prepagada-llega-a-mas-356-000-usuarios-tras-transformacion-del-sector-4500240). Un cuadro de coberturas de Comedal (oct-2025) habla de más de 6.000 prestadores; **las cifras no coinciden**. — [Comedal PDF](https://www.comedal.com.co/wp-content/uploads/2025/10/Cuadro-Coberturas-COOMEVA-COMEDAL.pdf)
- La red de prestadores de Coomeva MP es **independiente de la red de Coomeva EPS** (en liquidación): «los convenios… son independientes y no es la misma red de la EPS». — [ConsultorSalud](https://consultorsalud.com/coomeva-eps-afectacion-medicina-prepagada/) (sin fecha visible; consultado 2-nov-2026)
- Sura: según la nota, su medicina prepagada, su plan complementario y sus seguros de salud siguen operando aunque EPS Sura pidió salir del sistema. — [Valora Analitik (sin fecha visible)](https://www.valoraanalitik.com/?p=382774). **Conflicto:** Sura **no aparece** en la lista de 8 prepagadas de la Supersalud de 2024 citada arriba. Puede que el «plan de salud» de Sura sea una póliza (seguro) y no una prepagada vigilada por la Supersalud. No se verificó.
- Planes complementarios: solo pueden contratarlos o renovarlos personas afiliadas al régimen contributivo, y la entidad debe tener un mecanismo permanente para verificar que la afiliación al SGSSS está activa (Circular Externa Supersalud 039 de 2006, num. 4.1, y Decreto 806 de 1998, compilado en el Decreto 780 de 2016). — [Normograma Supersalud, Circular 039/2006](https://normograma.supersalud.gov.co/compilacion/docs/circular_supersalud_0039_2006.htm) (consultado 3-nov-2026; la circular parece reemplazada por la Circular 047 de 2007 y sus modificaciones, **vigencia no confirmada**).
- Presencia en el Eje Cafetero (indicios, no listas oficiales): Coomeva MP publica vacantes de «Auditor Médico Medicina Prepagada» en **Pereira**. — [Computrabajo](https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-auditor-medico-a-medicina-prepagada-pereira-en-pereira-353D8315FA1EDE6361373E686DCF3405). La guía de servicio de Sura para su red de prestación (29-may-2024) trae una línea de **Manizales (606 885 9515)**, pero es de EPS Sura y no de prepagada. — [Sura, Guía de servicio para red de prestación (PDF)](https://comunicaciones.segurossura.com.co/MercadeoPersonas/recursos/Guia_de_servicio_para_red_de_prestacion.pdf)
- Allianz, según una cartilla de póliza colectiva de un empleador (Drummond): los servicios se autorizan **solo dentro de la «Red de Allianz»**, por dos canales, «Call Center y Panel Web de autorizaciones». — [Cartilla Drummond, ene-2021](https://www.drummondltd.com/wp-content/uploads/Cartilla-Drummond-correcion-enero-2021.pdf) (consultado 2-nov-2026; **puede estar desactualizada**, es de 2021 y de un solo empleador).

### Inferences
- **Para Anserma importan, por orden: (1) planes complementarios de EPS (PAC), si las EPS que atiende el hospital los venden; (2) Coomeva MP y Colsanitas/Medisanitas, que tienen presencia en el Eje Cafetero; (3) muy poco más.** Colmédica, Axa Colpatria MP, MedPlus, Merci y SSI se concentran en las ciudades grandes (inferencia: no se encontró su red en Caldas).
- La pregunta de fondo para el hospital no es «cómo verifico la prepagada», sino **«¿soy prestador adscrito de alguna prepagada?»**. Las prepagadas solo pagan a prestadores adscritos (ver §4, Decreto 1570, arts. 1 y 6). Si la ESE no tiene contrato con ninguna, un paciente con prepagada se atiende por su EPS (PBS) o como particular, y no hay derechos de prepagada que verificar. En urgencias, cada contrato puede prever reembolso, pero eso lo tramita el usuario con su prepagada (inferencia; no se verificó el contrato tipo).
- Allianz, Mapfre, Sura (póliza), Axa Colpatria Seguros y similares venden **pólizas de salud** (seguros). Estas aseguradoras suelen estar vigiladas por la Superintendencia Financiera y no por la Supersalud. Se dice por conocimiento general; **no se verificó en esta sesión** con fuente primaria.

### Gaps
- No se encontró un **listado vigente (2026) de la Supersalud** de entidades de prepagada, planes complementarios y ambulancia prepagada. La lista de 8 es de 2024.
- No se confirmó el estado de **Cafesalud MP**, de **Emermédica** (ambulancia prepagada) ni de **Sura como prepagada vigilada por la Supersalud**.
- No se encontró qué prepagadas tienen prestadores adscritos **en Anserma ni en Caldas**. Hay que preguntarle al hospital si tiene algún contrato con ellas y mirar los directorios médicos de cada una.
- No se pudo abrir el artículo de Portafolio con las cifras por compañía (811k/339k/322k). Vienen del resumen del buscador.

---

## 2. Por compañía: ¿cómo verifica el prestador los derechos (portal, autenticación, bonos/vales/órdenes, autorizador, datáfono, IVR, app) y qué devuelve?

### Takeaway
El único modelo documentado públicamente es el de **Colsanitas/Medisanitas**. Antes de la atención, el usuario compra un **vale electrónico** por la app, el WhatsApp «María Paula», la oficina virtual, kioscos o cajas, y en la admisión presenta el **número de vale**. El prestador adscrito valida en las **«herramientas de validación de derechos»** del portal de prestadores el **estado del contrato (Activo / No Activo)** y registra la atención contra el vale. Soporte: la Mesa de Ayuda Prestadores (MAP), por teléfono y correo. De Colmédica, Coomeva MP, Axa Colpatria, Allianz y Sura **no hay manuales públicos**. Solo hay indicios de portales web o «paneles de autorizaciones», apps y call centers. **No se encontró ningún datáfono de salud ni red transaccional tipo Redeban/Credibanco** para validar elegibilidad.

### Cited Findings

**Colsanitas / Medisanitas (Keralty)**
- Documento «Proceso contingente de Vales Electrónicos» (archivo «modal-ago2024», es decir, ~agosto de 2024). Aplica a «la red de prestadores adscritos en el ámbito nacional de las compañías Colsanitas y Medisanitas». Dice: «Todos nuestros planes de Colsanitas, Medisanitas, Plan Dental y Planes Domiciliarios hacen uso de vales electrónicos» y las urgencias son «las únicas habilitadas de manera permanente para el recaudo del valor del vale en efectivo». — [Colsanitas Prestadores, PDF](https://prestadores.colsanitas.com/documents/d/guest/modal-ago2024-proceso-contingente-vales-electronicos) (consultado 2–3 nov 2026; texto extraído del PDF)
- Mismo documento: si los canales de compra de vales fallan, «se activará la opción de recaudo en efectivo en las **herramientas de validación de derechos**». Los pasos son: «Validar el estado del contrato del usuario y proceder según lo establecido actualmente. (Activo / No Activo)», recibir el efectivo, registrar con «pago efectivo» y facturar descontando los vales recibidos en efectivo. — [mismo PDF](https://prestadores.colsanitas.com/documents/d/guest/modal-ago2024-proceso-contingente-vales-electronicos)
- Canales por los que el **usuario** compra el vale antes de la atención: «APP Móvil de Colsanitas… opción Vales»; «María Paula (WhatsApp 310 310 76 76)»; «Oficina virtual… www.colsanitas.com, en donde el usuario obtiene el número de vale para presentarlo en el momento de la admisión»; «más de 60 kioscos»; y cajas de centros médicos y de la Clínica Colsanitas. — [mismo PDF](https://prestadores.colsanitas.com/documents/d/guest/modal-ago2024-proceso-contingente-vales-electronicos)
- Canales para el **prestador**: «MAP – Mesa de Ayuda Prestadores… Bogotá 486 70 00 o línea nacional 01 8000 964 848», el correo contactoprestador@colsanitas.com y el portal https://prestadores.colsanitas.com. En la página del portal la MAP figura como +601 486 7000, de lunes a viernes 7:00–19:00 y sábados 7:00–13:00. — [mismo PDF](https://prestadores.colsanitas.com/documents/d/guest/modal-ago2024-proceso-contingente-vales-electronicos); [prestadores.colsanitas.com](https://prestadores.colsanitas.com) (consultado 3-nov-2026)
- La página pública del portal muestra la Oficina Virtual (educación médica), la radicación digital de facturas, contenidos de facturación, el directorio médico y **«MAPIA» (herramienta de chat para gestión administrativa)**. El texto público **no menciona APIs, web services, integración con el HIS, captcha ni OTP**. — [prestadores.colsanitas.com](https://prestadores.colsanitas.com) (consultado 3-nov-2026)
- Un instructivo de Colsanitas para prestadores («instructivo-cmv-colsanitas-c») indica, según el fragmento del buscador, entrar al **módulo «Gestión» → «Validar derechos»** y luego seleccionar el prestador para crear el **registro de atención**. — [Colsanitas, instructivo (PDF de más de 10 MB, no se pudo abrir completo)](https://prestadores.colsanitas.com/documents/d/guest/instructivo-cmv-colsanitas-c). **No verificado** más allá del fragmento; no se sabe qué significa «CMV» ni la fecha.

**Colmédica (Colmédica Medicina Prepagada)**
- Según una ficha de terceros de la app «Colmédica», la app trae funciones para **profesionales de la salud**: consultar información y pagos, solicitar trámites y **gestionar autorizaciones médicas**. — [mwm.ai, ficha de la app](https://mwm.ai/apps/colm-dica/570286287) (consultado 2-nov-2026; **fuente secundaria de baja calidad**)
- Colmédica tiene una **«Central de autorizaciones MP»** (aviso de empleo «Enfermero Central de Autorizaciones MP»). — [Elempleo](https://www.elempleo.com/co/ofertas-trabajo/enfermero-central-de-autorizaciones-mp-1886738970) (consultado 2-nov-2026)
- No se encontró un portal de prestadores, un manual ni un mecanismo de bono/vale de Colmédica en fuentes públicas.

**Coomeva Medicina Prepagada**
- La app «Coomeva MP» (para afiliados) permite **registrar y consultar autorizaciones** sin ir a los puntos de atención y trae un directorio médico. — [mwm.ai, ficha de la app](https://mwm.ai/apps/coomeva-mp/981179771) (consultado 2-nov-2026; fuente secundaria)
- Un aviso de empleo de auditor médico de MP describe la revisión interna de ingresos, reactivaciones, traslados y coberturas por plan. Es flujo interno, no un canal para prestadores. — [Magneto365](https://www.magneto365.com/co/empleos/auditor-a-medico-reg-de-calidad-mp-16957-991308) (consultado 2-nov-2026)
- No se encontró un portal de prestadores ni un manual de validación de derechos de Coomeva MP.

**Allianz (pólizas de salud)**
- Dos canales de autorización: «Call Center y Panel Web de autorizaciones». Solo se autoriza dentro de la Red de Allianz. — [Cartilla Drummond, ene-2021](https://www.drummondltd.com/wp-content/uploads/Cartilla-Drummond-correcion-enero-2021.pdf) (**puede estar desactualizada**)
- Un aviso de empleo de 2026 para «Profesional proveedores médicos» de Allianz incluye capacitar a los prestadores «en el uso de las plataformas de autorizaciones e indemnizaciones». — [Elempleo](https://www.elempleo.com/co/ofertas-trabajo/profesional-proveedores-medicos-1886766694) (consultado 2-nov-2026)

**Axa Colpatria (Medicina Prepagada y seguros)**
- No se encontró documentación pública para prestadores. Un directorio de terceros solo trae la línea de servicio al cliente (01-8000-512620; Bogotá 423 57 57) y el sitio axacolpatria.co. — [numeroservicioalcliente.com](https://www.numeroservicioalcliente.com/?p=9975) (fuente de terceros, **no verificada**)

**Sura (Plan Complementario / medicina prepagada o póliza)**
- El folleto del Plan Complementario de EPS Sura dice que las autorizaciones de ayudas diagnósticas y laboratorio **indican la institución** donde debe hacerse el servicio, y que hay un **copago fijo** por servicios adicionales. — [EPS Sura, brochure PAC](https://www.epssura.com/files/brochure_pac.pdf) (sin fecha; consultado 2-nov-2026 vía buscador)
- La «Guía de servicio para red de prestación» (29-may-2024) es para la red de **EPS** Sura, Plan Complementario y «Salud para Todos». Habla de la continuidad de trámites y de las líneas de atención y **no describe ninguna herramienta de validación**. — [Sura PDF](https://comunicaciones.segurossura.com.co/MercadeoPersonas/recursos/Guia_de_servicio_para_red_de_prestacion.pdf)

**Datáfono / redes transaccionales**
- Ninguna búsqueda encontró un «datáfono de salud» ni una validación de elegibilidad por redes de pago (Redeban/Credibanco) para prepagadas. Lo más parecido es el **vale electrónico de Colsanitas**: el usuario lo paga antes por canales digitales o kioscos y el prestador solo recibe el número de vale. — [Colsanitas PDF](https://prestadores.colsanitas.com/documents/d/guest/modal-ago2024-proceso-contingente-vales-electronicos)

### Inferences
- **Modelo Colsanitas:** el «derecho» que se verifica son dos cosas: (a) que el **contrato esté activo** y (b) que exista un **vale pagado**. Las dos se consultan en una herramienta web con **cuenta del prestador adscrito**, no con datos del paciente. Lo que devuelve, según el documento, es por lo menos Activo/No Activo y la posibilidad de asociar el vale al registro de atención. No se sabe si devuelve el plan, las coberturas o los copagos.
- **Lo que el bot sí puede hacer sin credenciales:** preguntar «¿tiene medicina prepagada o plan complementario? ¿cuál?» y, en el caso de Colsanitas, pedir el **número de vale electrónico** que el usuario ya obtiene por sus propios canales (app, WhatsApp, oficina virtual). Ese dato se lleva a la admisión. Quien valida sigue siendo el personal del hospital en el portal. Esto vale **solo si el hospital es prestador adscrito**.
- La autenticación es **por prestador** (usuario del portal para la institución adscrita), no por persona del paciente. Se infiere de que el documento habla de «herramientas de validación de derechos» para la red adscrita; **no se pudo verificar** si hay captcha, OTP o usuarios nominales.

### Gaps
- No se pudo comprobar (sin iniciar sesión, y no se debía) si los portales de Colsanitas, Colmédica, Coomeva MP, Axa Colpatria y Allianz usan **captcha, OTP o usuarios nominales**, ni sus **términos de uso**, que suelen prohibir el acceso automatizado. El riesgo de RPA lo cubre otro investigador.
- No se encontró la **URL del portal de prestadores** de Colmédica, Coomeva MP, Axa Colpatria MP ni Allianz salud en fuentes públicas indexadas.
- No se sabe **qué campos devuelve** la validación de Colsanitas más allá de Activo/No Activo, ni si existe un IVR (respuesta automática por teléfono) de validación. La MAP es una mesa de ayuda humana.
- No se encontró si Colmédica y Coomeva usan **bonos/órdenes prepagadas** al estilo del vale de Colsanitas. En el mercado es común, pero **no está documentado públicamente**.

---

## 3. ¿Ofrecen APIs, web services o integraciones con el HIS? ¿Hay intermediarios (clearinghouses) que agrupen la elegibilidad de varias aseguradoras?

### Takeaway
**No se encontró ninguna API pública, portal de desarrolladores ni web service documentado de elegibilidad** de ninguna prepagada colombiana. Tampoco se encontró en Colombia un **intermediario de elegibilidad multiaseguradora** como los de EE. UU., que usan el estándar de mensajes 270/271. Los esquemas que aparecen son de otros países (España, Chile, Argentina) o son la interoperabilidad estatal de historia clínica (IHCE), que no sirve para elegibilidad de prepagada. Con lo público, **hoy no se puede verificar la prepagada de forma automática y legítima desde un bot**. La única vía sería un acuerdo de integración que el hospital negocie con cada prepagada en su contrato.

### Cited Findings
- El portal público de prestadores de Colsanitas no menciona APIs, web services ni integración con sistemas del prestador. Solo trae herramientas web, radicación digital y el chat «MAPIA». — [prestadores.colsanitas.com](https://prestadores.colsanitas.com) (consultado 3-nov-2026)
- La interoperabilidad estatal que existe es la **IHCE (Interoperabilidad de Historia Clínica Electrónica)** del MinSalud. Es una API HL7 FHIR para que prestadores y sistemas HIS envíen y consulten registros clínicos, con autenticación y credenciales. **No es un servicio de elegibilidad de prepagada.** — [MinSalud, Manual de operaciones IHCE v1.5](https://www.minsalud.gov.co/ihce/Manuales/Manual_Operaciones_interoperabilidad_IHCEV1.5.pdf); [Manual HCE interoperable v1](https://www.minsalud.gov.co/ihce/Manuales/Manual_de_operaciones_Historia_Clinica_Interoperable_IHCE_V1.pdf) (consultados vía buscador 2-nov-2026; versiones de 2026 con fechas que no coinciden entre sí)
- Un trabajo académico sobre la autorización EPS–IPS con HL7-FHIR señala que la falta de interoperabilidad en las autorizaciones causa «retrasos importantes». Es una propuesta, no algo en operación. — [UTP Panamá, repositorio](https://ridda2.utp.ac.pa/handle/123456789/5768)
- Ejemplo **extranjero** de validación en tiempo real: «Conpay» de SaludOnNet (España) manda la transacción por web service al validador de la aseguradora, que la acepta o la rechaza en línea. **No opera en Colombia.** — [SaludOnNet blog](https://www.saludonnet.com/blog/definir-coberturas-autorizar-prestaciones-y-autofacturar-en-tiempo-real-ya-es-posible-se-denomina-conpay/)
- Ejemplos de **Chile** (bonos web): en el portal de pago a prestadores de Banmédica, el administrador del prestador entra con usuario y contraseña, y los bonos digitados se validan en línea. En la Isapre Colmena, validar el bono web es responsabilidad del prestador. — [Banmédica PDF](https://prestadores.banmedica.cl/wp-content/uploads/2018/06/PORTAL-PAGO-PRESTADORES-WEB-FINAL-MARZO15-BANMÉDICA.pdf); [Colmena, anexo convenio jul-2023](https://www.colmena.cl/source/wp-content/uploads/2023/08/ANEXO-AL-CONVENIO-DE-ATENCION-DE-BENEFICIARIOS-CON-ISAPRE-COLMENA-GOLDEN-CROSS-JULIO2023-002.pdf). No aplica a Colombia; solo sirve para comparar.
- **Conexia:** el buscador solo devolvió un perfil empresarial genérico (fundada en 1996, sede declarada en Cedar Hill, Texas, soluciones de TI en salud). **No se pudo confirmar** que dé servicios de validación de derechos en Colombia. — [Craft.co, Conexia](https://craft.co/conexia)
- Para el sistema obligatorio (no prepagada), el Estado prevé que los prestadores consulten afiliados en el **Sistema de Afiliación Transaccional (SAT)**. Este sistema no cubre los planes voluntarios. — [Encolombia, SAT (Decreto 780)](https://encolombia.com/derecho/decretos/minsalud/sistema-afiliacion-transaccional/) (detalle fuera de este alcance; lo cubre otro investigador)

### Inferences
- **¿Se puede automatizar?**
  - (a) **Por API oficial: no**, porque no existe ninguna pública.
  - (b) **Por RPA sobre el portal del prestador:** técnicamente posible en algunos portales, pero con cuenta del prestador, posible captcha u OTP y términos de uso que probablemente lo prohíben. Lo cubre el investigador de riesgo legal.
  - (c) **Por un acuerdo bilateral:** la vía realista es que el hospital pida a cada prepagada con la que tenga contrato un web service o un archivo plano periódico de usuarios activos. No se encontró evidencia de que lo ofrezcan a prestadores pequeños.
  - (d) **Sin integración:** el bot captura el dato («tengo Colsanitas, vale n.º …») y lo deja para que la admisión lo valide a mano.
- Para el caso de uso de AgenIA (agendar en una ESE pública), la verificación automática de prepagada **aporta poco valor**. Ver §1: probablemente el hospital no es adscrito y los pacientes con prepagada usan la red privada. **El esfuerzo debe ir a EPS y ADRES**, no a prepagada.
- No existe en Colombia un intermediario de elegibilidad como los de EE. UU. Es coherente con un mercado de solo 3 actores grandes que controlan su propia red adscrita y cobran con vales o bonos propios (inferencia).

### Gaps
- No se encontró información pública sobre **intermediarios colombianos** (Carvajal, Olimpia u otros) que ofrezcan elegibilidad de prepagada. Olimpia se conoce por validación de identidad y Carvajal por facturación electrónica, pero **no se encontró evidencia** de un servicio de elegibilidad de prepagada. Tampoco se encontró nada sobre modelo de costos.
- No se sabe si los grandes HIS colombianos tienen **conectores con Colsanitas o Colmédica**. Se buscó sin resultados públicos.
- No se pudo verificar si Conexia u otro operador tiene contratos de validación con prepagadas colombianas.

---

## 4. Marco regulatorio: supervisión de la Supersalud, Decreto 1570 de 1993 y normas posteriores. ¿Alguna norma obliga a las prepagadas a dar mecanismos de verificación a los prestadores?

### Takeaway
Las prepagadas están **vigiladas por la Supersalud** y sus planes y contratos los aprueba previamente esa entidad (Decreto 1570 de 1993, compilado en el Decreto 780 de 2016). Pero **no se encontró ninguna norma que les obligue a dar a los prestadores un mecanismo de verificación de derechos**, y menos uno electrónico o una API. Las reglas de «verificación de derechos» y autorizaciones del Decreto 4747 de 2007 (compilado en el 780) son para las «entidades responsables del pago», y su definición **no incluye la medicina prepagada**. La relación prepagada–prestador es **contractual**.

### Cited Findings
- Decreto 1570 de 1993:
  - Art. 2: las entidades «estarán sujetas al control y vigilancia de la Superintendencia Nacional de Salud» (texto original, modificado por el Decreto 1486 de 1994).
  - Art. 15: los planes y contratos «deberán ser aprobados previamente por la Superintendencia Nacional de Salud» (compilado en el 2.2.4.1.16 del Decreto 780).
  - Art. 20: deben enviar informes a la Supersalud.
  - Art. 33: régimen de sanciones.
  — [Normograma Supersalud, Decreto 1570/1993](https://normograma.supersalud.gov.co/compilacion/docs/decreto_1570_1993.htm) (consultado 3-nov-2026)
- Decreto 1570, sobre la red de prestadores:
  - Art. 1: define «entidad adscrita» y «profesional adscrito».
  - Art. 6, num. 2: la prestación es «a través de profesionales de la salud o instituciones de salud adscritas».
  - Art. 16, num. 1 (compilado en el 2.2.4.1.20): la entidad debe «examinar y corroborar… la información profesional del personal adscrito» y exigir licencia sanitaria.
  - Art. 16, num. 2: el prestador debe atender «en igual forma a todas las Empresas de Medicina prepagada» con contrato vigente.
  - Art. 18, num. 2 (compilado en el 2.2.4.1.22): la entidad debe tener una **línea abierta 24 horas** para información, prestación del servicio y quejas.
  - El decreto **no regula carné, bonos, vales ni verificación de usuarios por el prestador**.
  — [Normograma Supersalud, Decreto 1570/1993](https://normograma.supersalud.gov.co/compilacion/docs/decreto_1570_1993.htm)
- Decreto 780 de 2016, art. 2.5.3.1.1 (verificación de derechos):
  - Definición: «procedimiento por medio del cual se identifica la entidad responsable del pago de los servicios de salud».
  - Medio: puede hacerse «a través del documento de identidad o cualquier otro mecanismo tecnológico».
  - «No podrán exigirse al usuario copias, fotocopias o autenticaciones».
  - No puede retrasar la atención inicial de urgencias.
  — [Encolombia, Decreto 780: prestadores de servicios de salud](https://encolombia.com/derecho/decretos/minsalud/prestadores-servicios-salud) (consultado 3-nov-2026; reproducción no oficial del texto)
- Decreto 4747 de 2007:
  - Art. 2: se aplica «a los prestadores de servicios de salud y a toda entidad responsable del pago».
  - Art. 3, lit. b: las entidades responsables del pago son «las direcciones departamentales, distritales y municipales de salud, las entidades promotoras de salud de los regímenes contributivo y subsidiado, las entidades adaptadas y las administradoras de riesgos profesionales».
  - **No menciona prepagada ni planes voluntarios.**
  - Compilado en los arts. 2.5.3.4.2 y 2.5.3.4.3 del Decreto 780.
  — [Normograma Supersalud, Decreto 4747/2007](https://normograma.supersalud.gov.co/compilacion/docs/decreto_4747_2007.htm) (consultado 3-nov-2026)
- Planes complementarios: la Circular Externa 039 de 2006, num. 4.1, exige a la **entidad que ofrece el plan** un mecanismo permanente para verificar que la afiliación al SGSSS esté activa. Es una obligación de la entidad frente a sus usuarios, **no un servicio para los prestadores**. — [Normograma Supersalud, Circular 039/2006](https://normograma.supersalud.gov.co/compilacion/docs/circular_supersalud_0039_2006.htm) (vigencia posiblemente reemplazada por la Circular 047/2007; **no confirmada**)
- Circular conjunta MinSalud–Supersalud de 2025 sobre la **prohibición de que el usuario haga de intermediario en el trámite de autorización**. Según el buscador, obliga a pagadores y prestadores a ajustar sus procesos. — [Normograma Supersalud, Circular 019/2025](https://normograma.supersalud.gov.co/compilacion/docs/circular_supersalud_0019_2025.htm). **No se revisó su texto completo** y no se sabe si alcanza a la prepagada.

### Inferences
- Como no hay obligación legal, **el hospital solo tendría una herramienta de verificación de una prepagada si firma un contrato de adscripción con ella**. El mecanismo (portal, vale, línea) lo pone la prepagada en ese contrato.
- La parte de la norma que más le sirve al bot es el art. 2.5.3.1.1: la verificación se hace con el **documento de identidad**, sin exigir copias. Esto respalda que el bot pida solo tipo y número de documento. Aplica de lleno a EPS; a prepagada solo por analogía.

### Gaps
- No se revisó si el **Decreto 441 de 2022**, que modificó el capítulo de acuerdos de voluntades del Decreto 780, amplió la definición de «entidades responsables de pago» para incluir planes voluntarios.
- No se encontró la circular vigente de la Supersalud sobre **planes voluntarios de salud** (la que reemplazó a las circulares 039/2006 y 047/2007) ni qué exige sobre la información a los prestadores.
- No se revisó el texto completo de la Circular 019 de 2025.

---

## 5. Evidencia práctica: manuales para prestadores, casos de proveedores y problemas reportados

### Takeaway
La evidencia práctica es escasa. Hay **un manual de Colsanitas** sobre vales en contingencia (2024), un fragmento de un instructivo de «Validar derechos», cartillas de pólizas de empleadores y **fallos de tutela por autorizaciones negadas** (Colmédica, Coomeva MP). Los problemas que se ven en público son de **caídas del sistema de vales** (por eso existe el proceso contingente), **ciberataques a Keralty/Sanitas** y **negaciones de autorización por exclusiones o preexistencias**. No se encontró ningún caso de proveedor de software que haya automatizado la verificación de prepagada.

### Cited Findings
- Colsanitas tiene un **proceso formal para cuando fallan los canales de vales electrónicos**: la red recibe el valor del vale en efectivo y se habilita el registro «pago efectivo» en la herramienta de validación de derechos. Esto muestra que la caída de sus sistemas es un riesgo operativo previsto. — [Colsanitas PDF, ~ago-2024](https://prestadores.colsanitas.com/documents/d/guest/modal-ago2024-proceso-contingente-vales-electronicos)
- EPS Sanitas (grupo Keralty, el mismo de Colsanitas) restableció servicios de su página web tras un **ataque cibernético**. — [La FM](https://www.lafm.com.co/sociedad/eps-sanitas-reactivo-servicios-en-pagina-web-tras-ataque-cibernetico-299257) (fecha no extraída; según conocimiento general fue en 2022–2023, **no verificado**)
- Corte Constitucional, sentencia T-775 de 2015: tutela contra **Colmédica MP** por negar autorizaciones alegando preexistencias. La Corte ordenó no poner obstáculos a servicios no excluidos expresamente. — [Corte Constitucional, T-775/15](https://www.corteconstitucional.gov.co/relatoria/2015/T-775-15.htm)
- Coomeva MP negó en un caso una cirugía por considerarla excluida o «continuación» de una anterior (fallo de tutela; el resumen del buscador menciona una «validación hecha» de cobertura). — [Rama Judicial, fallo](https://portalhistorico.ramajudicial.gov.co/documents/2865277/151568001/90-Sentencia.pdf/8ad47cf7-f5f1-409b-bf24-a421ffca7b96) (fecha no extraída)
- Cambios de red: la Fundación Santa Fe de Bogotá dejó la red de Coomeva MP desde el 1-abr-2025. Las redes adscritas cambian y un dato de «red» guardado puede quedar viejo. — [ConsultorSalud](https://consultorsalud.com/coomeva-retira-fundacion-santa-fe/)

### Inferences
- **Que el contrato esté activo no basta.** Para el servicio concreto también pueden hacer falta una autorización (la cobertura por plan la revisa la auditoría médica), un vale o bono pagado y que el prestador esté en la red. Aunque hubiera una API de «contrato activo», el bot no podría prometer cobertura.
- Recomendación para la síntesis: tratar la prepagada en AgenIA como **un dato que declara el paciente, que se registra y que valida una persona en la admisión**, y solo para las prepagadas con las que el hospital tenga contrato. Si el hospital no tiene ninguno, basta un mensaje del tipo: «este hospital atiende por su EPS o como particular».

### Gaps
- No se encontraron manuales públicos para prestadores de Colmédica, Coomeva MP, Axa Colpatria MP, MedPlus, Allianz ni Sura sobre validación de derechos.
- No se encontraron casos de proveedores de software (HIS, RPA, chatbots) que automaticen la verificación de prepagada en Colombia.
- No se encontraron reportes públicos de captcha u OTP en portales de prestadores de prepagadas. Tampoco se buscaron activamente, por la restricción de no iniciar sesión.
