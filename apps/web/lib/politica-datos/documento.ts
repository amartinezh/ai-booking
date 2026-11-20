/**
 * 📄 El texto de la política de tratamiento de datos personales (2026-11-20).
 *
 * Es el mismo para todas las clínicas: cambia solo la identificación del
 * responsable (`DatosPolitica`), la versión y el nombre del asistente. Cubre el
 * contenido mínimo del Decreto 1377 de 2013, art. 13 (responsable, tratamiento y
 * finalidades, derechos, área que atiende, procedimiento, vigencia de la política
 * y de las bases de datos) y lo que exigen la Ley 1581 de 2012 y el Decreto 1377
 * para los datos sensibles (arts. 5 y 6), los de niños (art. 7; Decreto, art. 12),
 * la autorización (arts. 9 y 10; Decreto, arts. 5 a 9), las consultas y reclamos
 * (arts. 14 a 16) y las transmisiones a proveedores (Decreto, arts. 24 y 25).
 *
 * Toma como base la de la plataforma Mi Colombia Digital (bases de datos,
 * adquisición, copias de seguridad, registro y sesiones seguras) que el hospital
 * tenía publicada, pero sin su cláusula de «no nos hacemos responsables»: la Ley
 * 1581 obliga al responsable a guardar la información con seguridad (art. 17,
 * lit. d) y a reportar los incidentes a la SIC (art. 17, lit. n).
 *
 * Lo que se afirma del sistema debe ser cierto: si cambia la retención, los
 * canales o lo que hace el asistente, se cambia aquí (y se sube la versión de la
 * política en Configuración si el cambio es de fondo). Los tiempos de
 * conservación salen de docs/conocimiento/AGENIA.md, Parte 2, §9.
 */
import { fechaEnLetras, type DatosPolitica } from './datos';

export type Bloque =
    | { tipo: 'parrafo'; texto: string }
    | { tipo: 'lista'; items: string[] }
    | { tipo: 'numerada'; items: string[] }
    | { tipo: 'definiciones'; items: { termino: string; texto: string }[] }
    | { tipo: 'tabla'; columnas: [string, string]; filas: [string, string][] }
    | { tipo: 'nota'; texto: string };

export interface Seccion {
    id: string;
    titulo: string;
    bloques: Bloque[];
}

export interface DocumentoPolitica {
    titulo: string;
    responsable: string;
    version: string;
    vigenteDesde: string;
    /** «En pocas palabras»: el aviso de privacidad, para quien no lee todo. */
    resumen: string[];
    secciones: Seccion[];
}

export interface ContextoPolitica {
    datos: DatosPolitica;
    /** La versión de la política en Configuración (la que se pregunta en el chat). */
    version: string;
    /** El nombre del asistente virtual («Vicente»). */
    asistente: string;
}

export const TITULO_POLITICA = 'Política de tratamiento de datos personales';

const p = (texto: string): Bloque => ({ tipo: 'parrafo', texto });
const lista = (...items: string[]): Bloque => ({ tipo: 'lista', items });
const numerada = (...items: string[]): Bloque => ({ tipo: 'numerada', items });
const nota = (texto: string): Bloque => ({ tipo: 'nota', texto });
const definiciones = (...items: [string, string][]): Bloque => ({
    tipo: 'definiciones',
    items: items.map(([termino, texto]) => ({ termino, texto })),
});

export function documentoPolitica({ datos: d, version, asistente }: ContextoPolitica): DocumentoPolitica {
    const vigente = fechaEnLetras(d.vigenteDesde);
    const dondeRadicar = `${d.direccion}, ${d.municipio}${d.horario ? ` (${d.horario})` : ''}`;
    const elAsistente = `el asistente virtual ${asistente}`;

    const secciones: Seccion[] = [
        {
            id: 'responsable',
            titulo: 'Quién es el responsable de sus datos',
            bloques: [
                p(
                    `${d.razonSocial} (en adelante, «la Institución») es la responsable del tratamiento de los datos personales que se describen en esta política. Decide para qué se usan y responde por ellos ante usted y ante la Superintendencia de Industria y Comercio.`,
                ),
                definiciones(
                    ['Nombre o razón social', d.razonSocial],
                    ...(d.nit ? ([['NIT', d.nit]] as [string, string][]) : []),
                    ['Domicilio', d.municipio],
                    ['Dirección', d.direccion],
                    ['Teléfonos', d.telefono],
                    ['Correo para datos personales', d.correo],
                    ['Área que atiende consultas y reclamos', d.area],
                    ...(d.horario ? ([['Horario de atención', d.horario]] as [string, string][]) : []),
                ),
                p(
                    `La plataforma AgenIA (${elAsistente}, los recordatorios, los formularios y el panel de citas) trata los datos por cuenta de la Institución, como encargada del tratamiento: solo los usa para prestarle a la Institución estos servicios y siguiendo sus instrucciones.`,
                ),
            ],
        },
        {
            id: 'alcance',
            titulo: 'A qué se aplica esta política y qué normas sigue',
            bloques: [
                p(
                    'Se aplica a los datos personales que la Institución recibe y usa por sus canales digitales de atención para las citas:',
                ),
                lista(
                    `${elAsistente} por WhatsApp y Telegram;`,
                    'los formularios web (por ejemplo, la solicitud de afiliación a la EPS o de más citas);',
                    'los recordatorios, avisos y mensajes que se le envían, y las páginas donde consulta los documentos de su atención;',
                    'el panel que usa el personal de la Institución para gestionar las citas.',
                ),
                p(
                    'Sigue la Constitución Política (artículos 15 y 20), la Ley Estatutaria 1581 de 2012, el Decreto 1377 de 2013 (incorporado en el Decreto 1074 de 2015) y las demás normas que las modifiquen o complementen. La historia clínica se rige además por sus normas especiales: la Ley 23 de 1981, la Ley 1751 de 2015, la Resolución 1995 de 1999 y la Resolución 839 de 2017 del Ministerio de Salud.',
                ),
            ],
        },
        {
            id: 'definiciones',
            titulo: 'Definiciones',
            bloques: [
                p('Para leer esta política (Ley 1581 de 2012, art. 3, y Decreto 1377 de 2013, art. 3):'),
                definiciones(
                    ['Titular', 'La persona a quien se refieren los datos: usted.'],
                    ['Dato personal', 'Cualquier información que lo identifica o que puede asociarse a usted.'],
                    [
                        'Dato público',
                        'El que no es privado ni sensible, como su estado civil o su profesión, o el que consta en documentos públicos.',
                    ],
                    [
                        'Dato sensible',
                        'El que afecta su intimidad o cuyo mal uso puede discriminarlo, como los datos de salud.',
                    ],
                    ['Tratamiento', 'Cualquier uso de los datos: recogerlos, guardarlos, consultarlos, enviarlos o borrarlos.'],
                    ['Base de datos', 'El conjunto organizado de datos personales que se tratan.'],
                    ['Responsable del tratamiento', 'Quien decide sobre la base de datos y su uso: la Institución.'],
                    [
                        'Encargado del tratamiento',
                        'Quien trata los datos por cuenta del responsable, como la plataforma AgenIA y sus proveedores tecnológicos.',
                    ],
                    ['Autorización', 'Su consentimiento previo, expreso e informado para el tratamiento de sus datos.'],
                    [
                        'Aviso de privacidad',
                        'La comunicación que le informa, al pedirle la autorización, que existe esta política, cómo consultarla y para qué se usarán sus datos.',
                    ],
                    [
                        'Transmisión',
                        'Cuando el responsable comunica los datos a un encargado, dentro o fuera de Colombia, para que los trate por su cuenta.',
                    ],
                    [
                        'Transferencia',
                        'Cuando el responsable envía los datos a otro responsable, dentro o fuera de Colombia.',
                    ],
                ),
            ],
        },
        {
            id: 'principios',
            titulo: 'Principios que seguimos',
            bloques: [
                p('Los de la Ley 1581 de 2012, art. 4:'),
                definiciones(
                    ['Legalidad', 'El tratamiento se hace conforme a la ley.'],
                    ['Finalidad', 'Los datos se usan solo para lo que se le informa en esta política.'],
                    ['Libertad', 'Se tratan con su autorización o cuando la ley lo permite sin ella.'],
                    ['Veracidad o calidad', 'Los datos deben ser veraces, completos, exactos y actualizados.'],
                    ['Transparencia', 'Usted puede saber en cualquier momento qué datos suyos se tratan.'],
                    [
                        'Acceso y circulación restringida',
                        'Solo acceden a sus datos las personas autorizadas, y no se publican en internet de forma abierta.',
                    ],
                    ['Seguridad', 'Se protegen con medidas técnicas, humanas y administrativas.'],
                    [
                        'Confidencialidad',
                        'Quienes intervienen en el tratamiento guardan reserva, incluso cuando terminan su relación con la Institución.',
                    ],
                ),
                p(
                    'Además, la Institución debe poder demostrar que cumple estas reglas (responsabilidad demostrada, Decreto 1377 de 2013, art. 26): por eso guarda la prueba de cada autorización y el registro de quién consulta o cambia la información.',
                ),
            ],
        },
        {
            id: 'datos',
            titulo: 'Qué datos tratamos',
            bloques: [
                definiciones(
                    [
                        'De identificación',
                        'Tipo y número de documento, nombres y apellidos, fecha de nacimiento y sexo.',
                    ],
                    [
                        'De contacto',
                        'Número de celular o de WhatsApp, usuario de Telegram, correo electrónico y la zona de residencia (urbana o rural) que figura en su ficha de la Institución.',
                    ],
                    [
                        'De afiliación',
                        'Su EPS y su régimen (contributivo o subsidiado), y si aparece en la lista de afiliados que la EPS le entrega a la Institución.',
                    ],
                    [
                        'De sus citas',
                        'Servicio, profesional, fecha y hora, si asistió, canceló o cambió la cita, y sus solicitudes (lista de espera, más citas o afiliación).',
                    ],
                    [
                        'De salud (sensibles)',
                        'Lo que usted cuente sobre el motivo de su cita y la información de su atención que la Institución le envía, como el resumen de la consulta, fórmulas, órdenes o incapacidades.',
                    ],
                    [
                        'De las conversaciones',
                        `Los mensajes que usted le envía a ${elAsistente} y sus respuestas. Los mensajes de voz se convierten en texto para entenderlos.`,
                    ],
                    ['De su opinión', 'Sus respuestas a las encuestas de satisfacción.'],
                    [
                        'De su autorización',
                        'El texto que se le mostró, su respuesta, el canal, la fecha y la hora, y si después la retiró.',
                    ],
                    [
                        'Técnicos',
                        'Los identificadores que asignan WhatsApp o Telegram a su cuenta, la fecha y hora de los mensajes y, al abrir los documentos de su atención en una página web, la dirección IP.',
                    ],
                    [
                        'Del personal de la Institución',
                        'De quienes usan el panel: nombre, correo, rol, sus ingresos (fecha, hora y dirección IP) y las acciones que realizan.',
                    ],
                ),
            ],
        },
        {
            id: 'finalidades',
            titulo: 'Para qué usamos sus datos',
            bloques: [
                numerada(
                    'Identificarle y verificar su afiliación (EPS y régimen) para asignarle las citas a las que tiene derecho.',
                    'Agendar, confirmar, cambiar, cancelar y consultar sus citas, y registrarlas en el sistema de información de la Institución.',
                    'Recordarle sus citas, avisarle de cambios o cancelaciones de la agenda y ofrecerle cupos de la lista de espera.',
                    'Enviarle información y documentos de su atención (por ejemplo, el resumen de la consulta, fórmulas u órdenes), protegidos con clave.',
                    'Atender sus solicitudes, peticiones, quejas y reclamos, y comunicarse con usted cuando su atención lo requiera.',
                    'Reconocer en la conversación una posible urgencia y orientarle para que acuda al servicio de urgencias.',
                    'Medir su satisfacción con el servicio mediante encuestas, para mejorarlo.',
                    'Enviarle comunicados de la Institución relacionados con sus servicios de salud (por ejemplo, cambios de horario o jornadas de salud). Puede pedir que no se los envíen.',
                    'Elaborar estadísticas e indicadores de calidad y oportunidad de la atención, que se presentan como cifras agregadas, sin identificar a nadie.',
                    'Guardar la prueba de su autorización y el registro de quién consulta o modifica la información, por seguridad y auditoría.',
                    'Dar acceso al panel al personal autorizado, con los permisos de su rol, y vigilar su uso.',
                    'Cumplir las obligaciones legales de la Institución y atender los requerimientos de las autoridades competentes.',
                ),
                nota(
                    'La Institución no vende ni alquila sus datos, ni los usa para publicidad propia o de terceros. Si quisiera usarlos para algo distinto de lo que dice esta lista, le pediría una nueva autorización.',
                ),
            ],
        },
        {
            id: 'sensibles',
            titulo: 'Datos de salud y otros datos sensibles',
            bloques: [
                p(
                    'Los datos de salud son sensibles (Ley 1581 de 2012, art. 5). Por eso, al pedirle la autorización, la Institución le informa (Decreto 1377 de 2013, art. 6):',
                ),
                lista(
                    'que usted no está obligado(a) a autorizar el tratamiento de sus datos sensibles ni a responder preguntas sobre ellos;',
                    'cuáles de los datos que se le piden son sensibles y para qué se usan (las secciones anteriores);',
                    'que ninguna atención depende de que entregue datos sensibles por estos canales: si no autoriza, puede pedir su cita por teléfono o en la ventanilla.',
                ),
                p(
                    'La historia clínica es reservada: solo la conocen usted, el equipo de salud que le atiende y quienes la ley autoriza (Ley 23 de 1981, art. 34; Resolución 1995 de 1999). Los documentos de su atención que se le envían por WhatsApp, Telegram o correo van protegidos con una clave, que es su número de documento, y el aviso que los anuncia no dice nada de su salud.',
                ),
                p(
                    'La ley permite tratar datos sensibles sin autorización solo en casos excepcionales, como una urgencia en la que usted no pueda darla, para proteger su vida, o para defender un derecho en un proceso judicial (Ley 1581 de 2012, art. 6).',
                ),
            ],
        },
        {
            id: 'menores',
            titulo: 'Niñas, niños, adolescentes y personas por quienes agenda',
            bloques: [
                p(
                    'Los datos de niñas, niños y adolescentes se tratan solo para su atención en salud, respetando su interés superior y sus derechos fundamentales (Ley 1581 de 2012, art. 7; Decreto 1377 de 2013, art. 12).',
                ),
                lista(
                    'Quien agenda o hace trámites por un menor de edad debe ser su madre, padre o representante legal, o estar autorizado por ellos. Al autorizar, lo hace también en nombre del menor.',
                    'La opinión del menor se tiene en cuenta según su edad y madurez.',
                    'Si usted agenda para otra persona adulta, debe contar con su autorización para entregar sus datos.',
                ),
            ],
        },
        {
            id: 'autorizacion',
            titulo: 'Cómo se pide y se guarda su autorización',
            bloques: [
                p(
                    'La autorización se pide antes de recoger sus datos y de manera que quede prueba (Ley 1581 de 2012, art. 9; Decreto 1377 de 2013, arts. 7 y 8):',
                ),
                definiciones(
                    [
                        'Por el chat',
                        `Antes de agendarle, ${elAsistente} le explica para qué se usan sus datos y le pregunta si autoriza su tratamiento. Usted responde SÍ o NO. Si responde NO, no se le agenda por el chat y puede pedir su cita por teléfono o en la ventanilla. Se le pregunta una vez por número y canal, y otra vez si esta política cambia de fondo.`,
                    ],
                    [
                        'Para las citas que ya tiene',
                        'Para cancelar, cambiar la fecha o consultar una cita, el asistente usa los datos de esa cita, que la Institución ya tiene para su atención; no se le vuelve a pedir la autorización.',
                    ],
                    [
                        'En los formularios web',
                        'Debe marcar la casilla de autorización antes de enviar la solicitud.',
                    ],
                    [
                        'En persona o por teléfono',
                        'Con los formatos y procedimientos de la Institución.',
                    ],
                ),
                p(
                    'De cada autorización se guarda el texto que se le mostró, su respuesta, el canal, la fecha y la hora. Usted puede pedir una copia (sección «Sus derechos»).',
                ),
                p(
                    'Puede retirar su autorización cuando quiera: en el chat, escribiendo «Retiro mi autorización», o por los canales de la sección «Cómo ejercer sus derechos». El retiro no afecta lo que se hizo antes con su autorización ni las citas que ya tiene.',
                ),
                p('No se necesita autorización (Ley 1581 de 2012, art. 10) cuando:'),
                lista(
                    'una entidad pública o administrativa pide la información en ejercicio de sus funciones legales, o lo ordena un juez;',
                    'se trata de datos públicos;',
                    'hay una urgencia médica o sanitaria;',
                    'la ley autoriza el tratamiento con fines históricos, estadísticos o científicos;',
                    'se trata de datos del Registro Civil de las personas.',
                ),
            ],
        },
        {
            id: 'inteligencia-artificial',
            titulo: 'Uso de inteligencia artificial',
            bloques: [
                lista(
                    `${elAsistente} usa herramientas de inteligencia artificial para entender lo que usted escribe o dice y para responderle; también puede responderle con una voz generada por computador.`,
                    'No hace diagnósticos, no da indicaciones médicas y no reemplaza la atención del personal de salud.',
                    'Las reglas para asignar citas (cupos, límites y prioridades) las fija la Institución, no la inteligencia artificial.',
                    'Si el asistente no le entiende o prefiere hablar con una persona, comuníquese con la Institución por los teléfonos de esta política o acérquese a la ventanilla.',
                    'Las conversaciones solo las revisan personas autorizadas de la Institución y del equipo técnico de AgenIA, para atender solicitudes, corregir fallas y mejorar el servicio.',
                ),
            ],
        },
        {
            id: 'compartir',
            titulo: 'Con quién compartimos sus datos',
            bloques: [
                p('Sus datos solo se entregan (Ley 1581 de 2012, art. 13):'),
                lista(
                    'a usted, a sus causahabientes o a sus representantes legales;',
                    'a las entidades públicas o administrativas que los pidan en ejercicio de sus funciones legales, o por orden judicial;',
                    'a su EPS y a las entidades responsables del pago de los servicios de salud, para verificar sus derechos y facturar la atención, como lo exigen las normas del sector;',
                    'a terceros que usted o la ley autoricen.',
                ),
                p(
                    'Para prestar estos servicios, la Institución se apoya en encargados: la plataforma AgenIA y sus proveedores tecnológicos de mensajería, de inteligencia artificial para entender mensajes escritos y de voz y para generar voz, de correo electrónico y de alojamiento de servidores.',
                ),
                p(
                    'Algunos de estos proveedores procesan la información en servidores ubicados fuera de Colombia. Son transmisiones a encargados que actúan por cuenta de la Institución (Decreto 1377 de 2013, arts. 24 y 25): solo pueden usar los datos para prestar el servicio y deben protegerlos y guardar reserva. Al autorizar el tratamiento por estos canales, usted sabe que sus datos pueden procesarse en esos servidores.',
                ),
                nota(
                    'Si usted nos escribe por WhatsApp o por Telegram, esas aplicaciones también tratan sus datos según sus propias políticas, de las que responden Meta Platforms (WhatsApp) y Telegram. La Institución no controla ese tratamiento.',
                ),
            ],
        },
        {
            id: 'derechos',
            titulo: 'Sus derechos',
            bloques: [
                p('Como titular de los datos, usted tiene derecho a (Ley 1581 de 2012, art. 8):'),
                numerada(
                    'Conocer, actualizar y corregir sus datos, también cuando sean parciales, inexactos, incompletos o induzcan a error, o cuando su tratamiento no haya sido autorizado.',
                    'Pedir prueba de la autorización que dio, salvo en los casos en que la ley no la exige.',
                    'Ser informado, si lo pide, del uso que se le ha dado a sus datos.',
                    'Presentar quejas ante la Superintendencia de Industria y Comercio por infracciones a la ley, después de agotar el trámite de consulta o reclamo ante la Institución.',
                    'Retirar su autorización o pedir que se supriman sus datos, salvo cuando exista un deber legal o contractual de conservarlos (sección «Cuándo no se pueden borrar sus datos»).',
                    'Acceder gratis a sus datos: al menos una vez cada mes calendario y cada vez que esta política cambie de fondo (Decreto 1377 de 2013, art. 21).',
                ),
            ],
        },
        {
            id: 'ejercer',
            titulo: 'Cómo ejercer sus derechos',
            bloques: [
                p(`Las consultas y reclamos sobre datos personales los atiende: ${d.area}.`),
                definiciones(
                    ['Por correo electrónico', d.correo],
                    ['Por escrito o en persona', dondeRadicar],
                    ['Por teléfono', d.telefono],
                    ['En el chat', 'Escriba «Retiro mi autorización» para retirar la autorización que dio por ese canal.'],
                ),
                p('Su solicitud debe incluir:'),
                lista(
                    'su nombre completo y su tipo y número de documento;',
                    'qué pide (conocer, actualizar, corregir, suprimir, retirar la autorización o una copia de ella) y, si es un reclamo, los hechos que lo motivan;',
                    'la dirección o el correo donde quiere recibir la respuesta;',
                    'los documentos que quiera hacer valer.',
                ),
                p('Pueden presentarla (Decreto 1377 de 2013, art. 20):'),
                lista(
                    'usted, mostrando su documento de identidad;',
                    'sus causahabientes, acreditando esa calidad;',
                    'su representante o apoderado, acreditando la representación o el poder;',
                    'por las niñas, niños y adolescentes, quienes estén facultados para representarlos.',
                ),
            ],
        },
        {
            id: 'procedimiento',
            titulo: 'Consultas y reclamos: plazos',
            bloques: [
                definiciones(
                    [
                        'Consultas',
                        'Para conocer qué datos suyos tiene la Institución y cómo los usa. Se responden en máximo diez (10) días hábiles desde que se reciben. Si no es posible, se le informa el motivo y la nueva fecha, que no puede pasar de cinco (5) días hábiles más (Ley 1581 de 2012, art. 14).',
                    ],
                    [
                        'Reclamos',
                        'Para corregir, actualizar o suprimir sus datos, retirar la autorización o advertir un incumplimiento de la ley (Ley 1581 de 2012, art. 15).',
                    ],
                ),
                numerada(
                    'Si el reclamo está incompleto, dentro de los cinco (5) días siguientes se le pide completarlo. Si pasan dos (2) meses sin que lo complete, se entiende que desistió.',
                    'Si lo recibe un área que no es la competente, lo traslada en máximo dos (2) días hábiles y se lo informa.',
                    'Recibido el reclamo completo, en máximo dos (2) días hábiles sus datos quedan marcados como «reclamo en trámite», con el motivo, hasta que se decida.',
                    'Se responde en máximo quince (15) días hábiles, contados desde el día siguiente a su recibo. Si no es posible, se le informa el motivo y la nueva fecha, que no puede pasar de ocho (8) días hábiles más.',
                ),
                p(
                    'Si no está de acuerdo con la respuesta, después de agotar este trámite puede presentar una queja ante la Superintendencia de Industria y Comercio (Ley 1581 de 2012, art. 16), en www.sic.gov.co.',
                ),
            ],
        },
        {
            id: 'conservacion',
            titulo: 'Cuánto tiempo guardamos sus datos',
            bloques: [
                p(
                    'Los datos se guardan solo el tiempo necesario para las finalidades de esta política y el que exijan las normas (Decreto 1377 de 2013, art. 11). Después se borran de forma segura.',
                ),
                {
                    tipo: 'tabla',
                    columnas: ['Información', 'Tiempo'],
                    filas: [
                        ['Conversaciones con el asistente (mensajes y transcripciones de voz)', '180 días'],
                        [
                            'Contenido de los documentos de su atención enviados por estos canales',
                            '30 días (la historia clínica completa queda en el sistema de la Institución)',
                        ],
                        [
                            'Registros técnicos de la actividad de los canales y del seguimiento de las citas, sin el texto de los mensajes',
                            'Hasta 400 días',
                        ],
                        [
                            'Prueba de su autorización y de su retiro',
                            'Mientras se traten sus datos y el tiempo necesario para demostrarla ante las autoridades',
                        ],
                        [
                            'Sus datos de identificación, contacto y citas',
                            'Mientras sea usuario de la Institución y durante los plazos de las normas de archivo y del sector salud',
                        ],
                        [
                            'Historia clínica',
                            'Mínimo 15 años desde la última atención (Resolución 839 de 2017), en el sistema de la Institución',
                        ],
                    ],
                },
            ],
        },
        {
            id: 'supresion',
            titulo: 'Cuándo no se pueden borrar sus datos',
            bloques: [
                p(
                    'La supresión de los datos y el retiro de la autorización no proceden cuando usted tiene un deber legal o contractual de permanecer en la base de datos (Decreto 1377 de 2013, art. 9). Por ejemplo:',
                ),
                lista(
                    'la historia clínica y los registros de su atención, que la Institución debe conservar por los plazos de la ley;',
                    'la información que la Institución debe reportar a las autoridades de salud o a las entidades que pagan los servicios;',
                    'la prueba de su autorización o de su retiro.',
                ),
                p(
                    'En esos casos se le explica por qué no procede, y sus datos dejan de usarse para lo que no sea obligatorio: por ejemplo, si retira su autorización, no se le vuelve a agendar por el chat sin pedírsela de nuevo.',
                ),
            ],
        },
        {
            id: 'seguridad',
            titulo: 'Seguridad y privacidad de la información',
            bloques: [
                definiciones(
                    [
                        'Bases de datos',
                        'La información se guarda en bases de datos con acceso restringido. Cada persona del personal entra con su propio usuario y clave y solo ve lo que su rol necesita. Los servidores están protegidos con cortafuegos y solo los servicios indispensables quedan expuestos a internet.',
                    ],
                    [
                        'Recolección de la información',
                        'Los datos se reciben solo por los canales oficiales de la Institución: el asistente en sus números y cuentas oficiales, los formularios de esta plataforma y la atención presencial o telefónica. Usted es responsable de que los datos que entrega sean veraces y estén actualizados.',
                    ],
                    [
                        'Copias de seguridad',
                        'Se hacen copias de seguridad de la información para recuperarla ante una falla, con las mismas medidas de protección.',
                    ],
                    [
                        'Comunicaciones',
                        'Las páginas y el panel viajan cifrados (HTTPS). Las claves del personal y las credenciales de los canales se guardan cifradas.',
                    ],
                    [
                        'Documentos y enlaces',
                        'Los documentos de su atención van protegidos con clave, y los enlaces y códigos que reciba son personales: no los comparta.',
                    ],
                    [
                        'Registro de accesos',
                        'Queda registro de quién consulta o modifica la información en el panel.',
                    ],
                    [
                        'Cookies',
                        'Las páginas de este servicio usan solo las cookies necesarias para mantener una sesión abierta. No usan cookies de publicidad ni de seguimiento.',
                    ],
                ),
                p('Para cuidar su información, le recomendamos:'),
                lista(
                    'escribir usted mismo la dirección de las páginas o guardarla en favoritos, y no abrir enlaces de mensajes sospechosos;',
                    'cerrar la sesión y el navegador al terminar, sobre todo en un equipo compartido o público;',
                    'comprobar que escribe al número o a la cuenta oficial de la Institución.',
                ),
                nota(
                    'La Institución nunca le pedirá por el chat claves bancarias, pagos ni códigos de verificación de WhatsApp o Telegram.',
                ),
                p(
                    'Ningún sistema está libre de riesgos. Si ocurre un incidente de seguridad que ponga en riesgo sus datos, la Institución lo informará a la Superintendencia de Industria y Comercio (Ley 1581 de 2012, art. 17, lit. n), tomará las medidas para contenerlo y, cuando corresponda, se lo comunicará a usted.',
                ),
            ],
        },
        {
            id: 'deberes',
            titulo: 'Deberes de la Institución y de sus encargados',
            bloques: [
                p('La Institución, como responsable (Ley 1581 de 2012, art. 17), debe:'),
                lista(
                    'garantizarle en todo momento el ejercicio de sus derechos;',
                    'pedir y conservar la prueba de su autorización, e informarle para qué se recogen sus datos y qué derechos tiene;',
                    'guardar la información con la seguridad necesaria para impedir su alteración, pérdida o uso no autorizado;',
                    'mantener la información veraz y actualizada, corregirla cuando sea incorrecta y avisar de esas novedades a sus encargados;',
                    'entregar a los encargados solo datos cuyo tratamiento esté autorizado y exigirles seguridad y reserva;',
                    'tramitar las consultas y reclamos en los plazos de esta política;',
                    'informar a la Superintendencia de Industria y Comercio los incidentes de seguridad que pongan en riesgo los datos, y cumplir sus instrucciones.',
                ),
                p(
                    'Los encargados (Ley 1581 de 2012, art. 18) deben tratar los datos solo por cuenta de la Institución, con las mismas reglas de seguridad y reserva, y apoyarla en la atención de sus consultas y reclamos.',
                ),
            ],
        },
        {
            id: 'vigencia',
            titulo: 'Vigencia y cambios',
            bloques: [
                p(
                    `Esta política, versión ${version}, rige desde el ${vigente}. Las bases de datos estarán vigentes mientras la Institución preste servicios por estos canales y durante los tiempos de la sección «Cuánto tiempo guardamos sus datos».`,
                ),
                p(
                    'Si la política cambia de fondo, por ejemplo en la identificación del responsable o en las finalidades, la Institución se lo informará antes de aplicar los cambios, publicará aquí la nueva versión y el asistente volverá a pedirle la autorización.',
                ),
            ],
        },
    ];

    return {
        titulo: TITULO_POLITICA,
        responsable: d.razonSocial,
        version,
        vigenteDesde: vigente,
        resumen: [
            `${d.razonSocial} es la responsable de sus datos. La plataforma AgenIA los trata por su cuenta.`,
            'Usamos sus datos, incluidos los de salud, solo para gestionar sus citas, recordárselas, enviarle información de su atención y atender sus solicitudes.',
            'Los datos de salud son sensibles: usted no está obligado(a) a autorizar su tratamiento. Si no lo autoriza, puede pedir su cita por teléfono o en la ventanilla.',
            'No vendemos sus datos ni los usamos para publicidad.',
            `Puede conocer, actualizar, corregir o suprimir sus datos, y retirar su autorización, escribiendo a ${d.correo} o, en el chat, «Retiro mi autorización».`,
        ],
        secciones,
    };
}
