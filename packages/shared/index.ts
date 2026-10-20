export {
  DEFAULT_TIMEZONE,
  formatAppointmentLong,
  formatAppointmentCompact,
  formatAppointmentShort,
  formatDateOnly,
  formatTimeOnly,
  formatDateShort,
  formatSpokenDayLabel,
  formatSpokenTime,
  formatAppointmentSpoken,
} from './src/date-format';
export type { FormatOptions } from './src/date-format';
export { parseFechaPreferida } from './src/parse-fecha-preferida';
export type {
  FechaPreferida,
  ParseOptions,
} from './src/parse-fecha-preferida';
export { parseHoraPreferida, matchesHora } from './src/parse-hora-preferida';
export {
  parseFechaNacimiento,
  parseSexo,
  parseRegimen,
  formatFechaNacimiento,
} from './src/parse-fecha-nacimiento';
export type {
  FechaNacimiento,
  ParseNacimientoOptions,
} from './src/parse-fecha-nacimiento';
export type {
  HoraPreferida,
  HoraMatchOptions,
} from './src/parse-hora-preferida';
export { validatePadronCsv, PADRON_CSV_HEADERS } from './src/padron-csv';
export type {
  PadronCsvRow,
  PadronCsvError,
  PadronCsvReport,
  PadronRegime,
} from './src/padron-csv';
export { detectPadronEps } from './src/padron-eps-detect';
export type { PadronEpsCandidate, PadronEpsDetection } from './src/padron-eps-detect';
export {
  validateAvisosCsv,
  AVISOS_CSV_HEADERS,
  normalizePhoneToE164Co,
} from './src/avisos-csv';
export type { AvisosCsvRow, AvisosCsvError, AvisosCsvReport } from './src/avisos-csv';
export {
  normalizeDocumento,
  documentoSinCerosIniciales,
  esDocumentoValido,
} from './src/documento';
export { reconocerEps } from './src/eps-colombia';
export {
  PARTICULAR_EPS_NAME,
  isParticularEps,
  faltaRegimenParaElEspejo,
  MSG_FALTA_REGIMEN,
} from './src/eps';
export {
  isWhatsappPhoneId,
  whatsappRecipientField,
  buildWhatsappRecipient,
} from './src/whatsapp-recipient';
export {
  TELEGRAM_SENDER_PREFIX,
  isTelegramSender,
  toTelegramSenderId,
  chatIdFromTelegramSender,
} from './src/telegram-identity';
export {
  destinoDeContacto,
  type CanalDeContacto,
  type DestinoDeContacto,
  type IdentidadDeContacto,
} from './src/canal-contacto';
export {
  MOTIVOS_CONSULTA,
  MAX_NOTA_MOTIVO,
  MIN_PALABRAS_NOMBRE,
  esMotivoConsulta,
  clasificarBusqueda,
  variantesDeTelefono,
  enmascararDocumento,
  enmascararIdentificadorWhatsapp,
  enmascararNombre,
  escaparLike,
} from './src/patient-search';
export type { MotivoConsulta, BusquedaClasificada } from './src/patient-search';
export {
  VEREDICTO,
  TEXTO_VEREDICTO,
  VENTANA_CITAS_DIAS,
  AGENTE_SIN_SENAL_MIN,
  COLA_ATASCADA_MIN,
  MAX_INTENTOS_ENTREGA,
  NOTA_SIN_APPOINTMENT,
  clasificarRastreoA,
  clasificarRastreoB,
  construirLineaDeVida,
  presenciaEnHis,
} from './src/patient-trace';
export type {
  CodigoVeredicto,
  Severidad,
  FuenteVeredicto,
  CausaNoLlego,
  Veredicto,
  ResultadoRastreo,
  EstadoCita,
  Asistencia,
  OrigenCita,
  EstadoSync,
  EstadoMensaje,
  MensajeConfirmacion,
  CancelacionCita,
  CitaRastreo,
  SaludEspejo,
  ResumenConversacion,
  EsperaRastreo,
  EvidenciaRastreoA,
  AuditoriaCupo,
  EvidenciaRastreoB,
  EstadoPaso,
  PasoLinea,
  PresenciaHis,
} from './src/patient-trace';
export {
  CANCELADA_POR,
  armarMetaLogCancelacionPersonal,
  leerCancelacionPersonal,
} from './src/appointment-cancel';
export type { CancelacionPersonal } from './src/appointment-cancel';
export {
  LIMITES_CONSULTA_HIS,
  aCitaHisVista,
  clasificarTitular,
  mismoInstante,
  combinarEvidenciaHis,
  documentosDelPaciente,
  leerResultadoGuardado,
  ocupanteDelCupo,
  parametrosADto,
  resolverRespuestaHis,
  validarConsultaHis,
} from './src/his-lookup';
export type {
  CitaHisVista,
  EstadoCitaHis,
  EvidenciaHis,
  OcupanteCupo,
  ParamsConsultaPorCupo,
  ParamsConsultaPorDocumento,
  ResultadoConsultaHis,
  TitularHis,
} from './src/his-lookup';
export {
  estadoConexionHis,
  remitenteEsDelPaciente,
  diaLocal,
  inicioDelDiaLocal,
  LIMITES_CONSULTA_BOT,
  ventanaConsultaBot,
  citasHisNuevas,
} from './src/consulta-citas';
export type {
  EstadoConexionHis,
  MotivoConexionHis,
  ConfigConexionHis,
  ConexionHis,
  CanalesDelPaciente,
  RemitenteDelTurno,
  CitaConocida,
} from './src/consulta-citas';
export { SYNC_AUDIT_DIRECTION } from './src/sync-audit';
export type { SyncAuditDirection } from './src/sync-audit';
export type {
  CanonicalEntityType,
  CanonicalOp,
  HandshakeInput,
  HandshakeResult,
  OutboxEventDto,
  OutboxEventContext,
  AckInput,
  AckFailure,
  AckResult,
  CanonicalChangeEvent,
  ChangesInput,
  ChangesResult,
  HeartbeatInput,
  HisAppointmentSnapshot,
  HisAppointmentKey,
  ReconcileInput,
  ReconcileResult,
  HisSlotSnapshot,
  AvailabilityInput,
  AvailabilityResult,
  HisCatalogEntry,
  CatalogInput,
  CatalogResult,
  HisNoticeCandidate,
  NoticeRequestDto,
  NoticeRosterInput,
  NoticeRosterResult,
  HisLookupKind,
  HisLookupSlot,
  HisLookupRequestDto,
  HisLookupStatus,
  HisLookupAppointment,
  HisLookupResultInput,
  HisLookupResultOutput,
} from './src/mirror-protocol';

export { citaFueraDeAlcance } from './src/alcance-agente';
export type { AlcanceAgente } from './src/alcance-agente';
export { derivarSync } from './src/sync-state';
export {
  MENSAJE_OPERACION_APAGADA,
  algunaCompuertaAbierta,
  compuertaAbierta,
  compuertasHis,
  eventoPuedeSalir,
  operacionFrenadaDelError,
  operacionHisDelEvento,
} from './src/compuerta-his';
export type {
  CompuertasHis,
  EventoHaciaElHis,
  OperacionFrenada,
  OperacionHis,
} from './src/compuerta-his';
export type { FilaOutbox } from './src/sync-state';

export {
  ESTADOS_ACTIVOS,
  ESTADOS_EXCEPCION,
  NOTA_VENCIDA,
  ORDEN_SEVERIDAD_EXCEPCION,
  SEVERIDADES_EXCEPCION,
  TIPOS_CON_AVISO,
  TIPOS_EXCEPCION,
  TITULO_EXCEPCION,
  UMBRALES_VIGILANTE,
  claveExcepcion,
  debeVencer,
  evaluarRetencion,
  eventoCulpable,
  parametrosPlantillaAviso,
  requiereAviso,
  requiereRecordatorio,
  resumenRetencion,
  severidadPorCercania,
  transicionExcepcion,
} from './src/sync-watch';

export { RETENCION_DATOS, diasDeRetencion } from './src/retencion';

export type {
  AccionExcepcion,
  EstadoExcepcion,
  ItemAviso,
  MotivoRetencion,
  ResultadoTransicion,
  Retencion,
  SeveridadExcepcion,
  TipoExcepcion,
} from './src/sync-watch';

export { saludoPorHora } from './src/saludo';
export type { Saludo, SaludoOptions } from './src/saludo';

export {
  TEMPLATE_CONTRACTS,
  choqueDeNombre,
  variablesEsperadas,
} from './src/whatsapp-template-contracts';
export type {
  ChoqueDeNombre,
  ContratoPlantilla,
  TemplateKind,
} from './src/whatsapp-template-contracts';

export {
  afiliacionDelPadron,
  decidirAlta,
  decidirTelefono,
  huecosQueRellenaElPadron,
  notaDeAlta,
  regimenSeguroDelPadron,
} from './src/alta-en-caliente';
export type {
  AfiliacionPadron,
  DecisionAlta,
  DuenoDeTelefono,
  FilaPadron,
  EntradaAlta,
  MotivoSinAlta,
  PerfilCandidato,
  Regimen,
  TelefonoDecidido,
} from './src/alta-en-caliente';

export {
  CUPOS_OFRECIDOS,
  normalizarCuposOfrecidos,
  seleccionarCuposManianaTarde,
} from './src/cupos-ofrecidos';
export type { SeleccionCuposOptions } from './src/cupos-ofrecidos';
export {
  ANTICIPACION_RECORDATORIO,
  normalizarAnticipacionRecordatorio,
  citaDemasiadoCercaParaRecordar,
  textoAnticipacion,
} from './src/recordatorio-anticipacion';

export {
  resolverRangoEstadisticas,
  horaLocalAUtc,
  FORMATO_SQL_BUCKET,
} from './src/rango-estadisticas';
export type {
  RangoEstadisticas,
  Granularidad,
  RangoResuelto,
} from './src/rango-estadisticas';

export {
  LIMITE_CITAS,
  SOLICITUD_CITAS,
  MOTIVOS_SOLICITUD_CITAS,
  TEXTO_TIPO_LIMITE,
  normalizarLimiteDia,
  normalizarLimiteMes,
  limitesDeLaClinica,
  periodoDelLimite,
  etiquetaPeriodo,
  evaluarLimiteCitas,
  esMotivoSolicitudCitas,
  etiquetaMotivoSolicitudCitas,
  citasEnTexto,
} from './src/limite-citas';
export type {
  TipoLimiteCitas,
  LimitesCitas,
  PeriodoLimite,
  LimiteSuperado,
  MotivoSolicitudCitas,
} from './src/limite-citas';

export {
  ALFABETO_CODIGO_VINCULACION,
  CATALOGO_ALERTAS,
  CATEGORIAS_ALERTA,
  DATO_OCULTO,
  ESTADOS_ALERTA,
  GRAVEDADES_ALERTA,
  ICONO_GRAVEDAD_ALERTA,
  ORDEN_GRAVEDAD_ALERTA,
  TEXTO_CATEGORIA_ALERTA,
  TEXTO_GRAVEDAD_ALERTA,
  TIPOS_ALERTA,
  UMBRALES_ALERTAS,
  alertaDeIncidente,
  arranqueEnBucle,
  baseDelPanel,
  categoriaDeServicio,
  claveAlerta,
  codigoVinculacion,
  codigoVinculacionVigente,
  cupoDeEnvio,
  decidirIntermitencia,
  duracionLegible,
  enlacePanel,
  esIntermitente,
  estaSilenciado,
  eventoRepetido,
  extraerCodigoVinculacion,
  finDelSilencio,
  gravedadDeAlerta,
  gravedadDeRafaga5xx,
  incidenteDebeAvisar,
  leerCategorias,
  loteDeRecordatoriosCaido,
  motivoParaNoEnviar,
  normalizarConfigAlertas,
  normalizarRuta,
  OPCIONES_SILENCIO,
  proximaHoraLocal,
  sanitizarTextoAlerta,
  siguienteAccion,
  sinSonido,
  TEXTO_OPCION_SILENCIO,
  textoAviso,
  textoAvisoAgrupado,
  textoExcedente,
  textoIntermitente,
  textoPrueba,
  textoRecordatorio,
  textoResolucion,
  textoResumenDiario,
  textoVinculado,
  tocaResumenDiario,
  ventanaResumenDiario,
} from './src/alertas-tecnicas';
export type {
  AccionAlerta,
  AlertaNueva,
  AlertaVista,
  CategoriaAlerta,
  ConfigAntirruido,
  DatosMensajeAlerta,
  DefinicionAlerta,
  EstadoAlerta,
  GravedadAlerta,
  MotivoSinEnvio,
  OpcionSilencio,
  ResumenDiario,
  TipoAlerta,
} from './src/alertas-tecnicas';
// Base de conocimiento (docs/conocimiento/AGENIA.md): el lector y el buscador
// del Centro de ayuda, que también usa el asistente de soporte de la API.
export {
  ErrorDeConocimiento,
  MARCA_FIN,
  MARCA_INICIO,
  parsearConocimiento,
  temaDeRuta,
  validarConocimiento,
} from './src/conocimiento';
export type {
  CategoriaAyuda,
  ContenidoAyuda,
  ElementoPantalla,
  GuiaAyuda,
  PortadaAyuda,
  PreguntaAyuda,
  ProblemaAyuda,
  TemaAyuda,
  TerminoGlosario,
} from './src/conocimiento-tipos';
export {
  GLOSARIO_ID,
  anclaDe,
  buscar,
  crearIndice,
  distancia,
  extracto,
  fragmentosDe,
  normalizar,
  raiz,
  resaltar,
  sugerir,
} from './src/conocimiento-buscador';
export type {
  Fragmento,
  IndiceAyuda,
  RespuestaBusqueda,
  ResultadoBusqueda,
  Segmento,
  TipoFragmento,
} from './src/conocimiento-buscador';
// Menú del panel por rol.
export { banderasDelEspejo, getMenusForRole } from './src/menus';
export type { BanderasDelEspejo, MenuAccent, MenuItem, UserRole } from './src/menus';
// Asistente de soporte por Telegram (docs/PLAN_BOT_SOPORTE.md).
export {
  AJUSTES_SOPORTE_POR_DEFECTO,
  COMANDOS_SOPORTE,
  ETIQUETAS_BOTON,
  LIMITES_SOPORTE,
  MOTIVOS_CIERRE,
  RE_CODIGO_ENLACE,
  ROLES_DEL_ASISTENTE,
  TEXTOS_SOPORTE,
  TIPOS_RESPUESTA_IA,
  MAX_PERSONAS_PILOTO,
  accesoAlAsistente,
  correosDelPiloto,
  enElPiloto,
  conversacionVigente,
  datosDeBoton,
  enmascararCorreo,
  enmascararParaIA,
  esCodigoDeEnlace,
  esSoloSaludo,
  extraerCodigoCorto,
  FLUJO_VACIO,
  flujoAlCerrar,
  flujoAlRetomar,
  guardarFlujo,
  leerFlujo,
  haySenalDeUrgencia,
  intentosRestantes,
  interpretarRespuestaCorta,
  leerBorrador,
  leerBoton,
  leerComando,
  leerRespuestaIA,
  prioridadDelCaso,
  siguienteBorrador,
} from './src/soporte-bot';
export type {
  AccesoAlAsistente,
  PilotoDelAsistente,
  AccionBorrador,
  BorradorCaso,
  BotonSoporte,
  CasoPropuesto,
  ComandoSoporte,
  EventoBorrador,
  FlujoConversacion,
  MotivoCierre,
  RespuestaCorta,
  RespuestaIA,
  TipoRespuestaIA,
} from './src/soporte-bot';
export {
  PARTE2_PARA_EL_ASISTENTE,
  armarManualDelAsistente,
  idDeSeccionParte2,
  esCitaValida,
  parte1EnBruto,
  seccionesDeLaParte2,
  seccionesSinClasificar,
} from './src/soporte-bot-conocimiento';
export type { ManualDelAsistente, SeccionParte2 } from './src/soporte-bot-conocimiento';
export {
  CONTADORES_SOPORTE,
  TEXTO_MOTIVO_CIERRE,
  VIGILANCIA_SOPORTE,
  claveCifrasDelDia,
  diasDelPeriodo,
  filtroDeConversaciones,
  inicioDelPeriodo,
  percentil,
  periodoDeCifras,
  porcentaje,
  preguntasSinCubrir,
  promedio,
  sumarContadores,
  ventanaDe,
} from './src/soporte-bot-cifras';
export type {
  CifrasAsistente,
  ContadorSoporte,
  DetalleConversacion,
  FilaConversacion,
  FiltroConversaciones,
  MensajeDeLaConversacion,
  PeriodoCifras,
  PreguntaSinCubrir,
} from './src/soporte-bot-cifras';
export {
  AVISO_CASO_AL_GRUPO,
  CANALES_CASO,
  LIMITES_CASO,
  MAX_TITULO_EN_AVISO,
  PRIORIDADES_CASO,
  ROL_LEGIBLE,
  TEXTO_SIN_AVISO_CASO,
  TIPOS_NOTA_CASO,
  estadoDelAvisoAlGrupo,
  gravedadDelAvisoDeCaso,
  motivoEsperaAvisoCaso,
  numeroDeCaso,
  pasoDelAvisoAlGrupo,
  textoAvisoCasoNuevo,
  textoCasoReabierto,
  textoCasoSinTomar,
  tocaRecordarSinTomar,
} from './src/soporte-caso';
export type {
  CanalCaso,
  DatosAvisoCaso,
  EstadoAvisoAlGrupo,
  MotivoEsperaAvisoCaso,
  MotivoOmitirAvisoCaso,
  PasoAvisoCaso,
  PrioridadCaso,
  TipoNotaCaso,
} from './src/soporte-caso';
export {
  HORARIO_EQUIPO_POR_DEFECTO,
  enHorarioDelEquipo,
  horarioEquipoDe,
  minutosHabilesEntre,
  proximaAperturaDelEquipo,
  textoCuandoLoVeElEquipo,
} from './src/soporte-horario';
export type { HorarioEquipo } from './src/soporte-horario';
export {
  INSTRUCCIONES_DEL_ASISTENTE,
  enlaceDeAyuda,
  haceCuanto,
  promptDelAsistente,
  respuestaConIA,
  respuestaSinIA,
  textoFichaDeLaClinica,
  turnosParaLaIA,
} from './src/soporte-bot-prompt';
export type {
  FichaClinica,
  PromptDelAsistente,
  RespuestaAlEmpleado,
  ResultadoDelManual,
  TurnoParaLaIA,
} from './src/soporte-bot-prompt';
export {
  ESTADO_DEL_CASO,
  borradorSinIA,
  casoAmpliable,
  descripcionDelCaso,
  incidentesParaElPersonal,
  textoBorradorParaLaIA,
  textoCasosParaLaIA,
  textoDelBorrador,
  textoIncidentesParaLaIA,
  textoListaDeCasos,
} from './src/soporte-bot-casos';
export type {
  AlertaAbierta,
  CasoDeLaPersona,
  EstadoCaso,
  IncidenteParaElPersonal,
} from './src/soporte-bot-casos';
