import { ConfigService } from '@nestjs/config';

/**
 * Configuración fuertemente tipada del cron de recordatorios.
 *
 * Lee del `.env` global del servidor vía @nestjs/config. Valida en boot
 * para que un valor inválido haga fallar rápido el arranque en vez de
 * silenciosamente comportarse mal en producción.
 */
export interface ReminderConfig {
  /** Horas hábiles de anticipación antes de la cita. */
  businessHoursBefore: number;
  /** Cadencia del cron en minutos. */
  cronMinutes: number;
}

const DEFAULT_BUSINESS_HOURS_BEFORE = 24;
const DEFAULT_CRON_MINUTES = 15;

export function readReminderConfig(config: ConfigService): ReminderConfig {
  const rawHours = config.get<string>('REMINDER_BUSINESS_HOURS_BEFORE');
  const rawCron = config.get<string>('REMINDER_CRON_MINUTES');

  const businessHoursBefore = toPositiveInt(rawHours, DEFAULT_BUSINESS_HOURS_BEFORE);
  const cronMinutes = toPositiveInt(rawCron, DEFAULT_CRON_MINUTES);

  if (businessHoursBefore < 1) {
    throw new Error(
      `REMINDER_BUSINESS_HOURS_BEFORE inválido (${rawHours}). Debe ser un entero ≥ 1.`,
    );
  }
  if (cronMinutes < 1 || cronMinutes > 60) {
    throw new Error(
      `REMINDER_CRON_MINUTES inválido (${rawCron}). Debe estar entre 1 y 60.`,
    );
  }

  return { businessHoursBefore, cronMinutes };
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}
