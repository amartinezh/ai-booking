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
export { PARTICULAR_EPS_NAME, isParticularEps } from './src/eps';
export {
  isWhatsappPhoneId,
  whatsappRecipientField,
  buildWhatsappRecipient,
} from './src/whatsapp-recipient';
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
