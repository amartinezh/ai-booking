/**
 * Lista declarativa de servicios externos a monitorear.
 *
 * Para agregar uno nuevo: añade una entrada a `SERVICES_CONFIG` y un `case` en
 * `MonitorCheckers.checkService` (monitor.checkers.ts). Nada más en el monitor
 * necesita cambiar.
 *
 * Nota de arquitectura: la metadata vive aquí (puro, sin dependencias), pero la
 * función de check real vive en `MonitorCheckers` porque requiere inyección de
 * dependencias de NestJS (IntegrationsService, cliente TTS, etc.). Mantener la
 * config libre de DI evita acoplar este archivo al contenedor de Nest.
 */

/** Resultado normalizado de un check, compartido por MODO A y MODO B. */
export interface CheckResult {
  status: 'UP' | 'DOWN' | 'DEGRADED';
  /** Latencia round-trip en ms. null si falló antes de medir (raro). */
  latencyMs: number | null;
  httpStatus?: number | null;
  errorMessage?: string | null;
  /** Código corto para agrupar incidentes ('TIMEOUT', 'AUTH', '5XX'...). */
  errorCode?: string | null;
  /**
   * El servicio no se monitorea en este ciclo (no aplica). Ej.: Gemini/Meta
   * cuando no existe ninguna organización contra la cual validar credenciales.
   * El cron lo ignora (no abre ni cierra incidentes) y la UI lo muestra neutro.
   */
  skip?: boolean;
}

export interface ServiceConfig {
  /** Identificador único y estable (se persiste en ServiceIncident.serviceKey). */
  key: string;
  /** Nombre legible para la UI. */
  displayName: string;
  /** Agrupador visual. */
  group: 'google' | 'meta';
  /** Si el check está activo. Los deshabilitados se omiten por completo. */
  enabled: boolean;
  /** Timeout duro de la llamada, en ms. */
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.MONITOR_DEFAULT_TIMEOUT_MS) || 5000;

export const SERVICES_CONFIG: ServiceConfig[] = [
  {
    key: 'gemini',
    displayName: 'Gemini AI',
    group: 'google',
    enabled: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  {
    key: 'tts',
    displayName: 'Google Cloud TTS',
    group: 'google',
    enabled: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
  {
    key: 'meta',
    displayName: 'Meta WhatsApp Cloud API',
    group: 'meta',
    enabled: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  },
];

/** Solo los servicios activos — lo que realmente recorren los dos modos. */
export const ACTIVE_SERVICES = SERVICES_CONFIG.filter((s) => s.enabled);
