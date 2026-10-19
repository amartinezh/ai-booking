import type { TechAlertConfig } from '@agenia/database';
import { leerCategorias, normalizarConfigAlertas } from '@agenia/shared';
import { BOT_TOKEN_RE } from '../telegram/telegram-config.service';

/**
 * El archivo que lee el vigía del servidor (`deploy/vigia.sh`,
 * docs/PLAN_ALERTAS_TECNICAS.md §3.6 y A8): la MISMA configuración del panel, para
 * que el vigía avise por el mismo bot y al mismo grupo cuando la API no puede
 * (contenedores caídos, disco, respaldo).
 *
 * Una línea `CLAVE=valor` por ajuste. El vigía lo LEE con `sed`, no lo ejecuta
 * (`source`): aun así, cada valor se valida aquí para que nunca lleve nada más que
 * lo que debe.
 *
 * 🔒 Lleva el token en claro. La API lo escribe con permisos 600 (root, como el
 * `.env.production`) en `/var/lib/agenia/alertas`, fuera de `/opt/agenia` (que el
 * despliegue reemplaza con `rsync --delete`).
 */
export function contenidoArchivoVigia(
  row: TechAlertConfig | null,
  token: string | null,
  panelBase: string | null,
): string {
  const tokenSeguro = token && BOT_TOKEN_RE.test(token) ? token : '';
  const chatSeguro =
    row?.chatId && /^-?\d{1,20}$/.test(row.chatId) ? row.chatId : '';
  const panelSeguro =
    panelBase && /^https?:\/\/[A-Za-z0-9.:\-/_~%]+$/.test(panelBase)
      ? panelBase
      : '';
  const n = normalizarConfigAlertas(row ?? {});
  const encendido = Boolean(row?.enabled && tokenSeguro && chatSeguro);
  const silencioHasta = row?.mutedUntil
    ? Math.floor(row.mutedUntil.getTime() / 1000)
    : 0;

  return [
    '# Escrito por la API de AgenIA (alertas técnicas). NO EDITAR: se reescribe',
    '# cada vez que se guarda algo en /super-admin/alertas. Lo lee deploy/vigia.sh.',
    `ENABLED=${encendido}`,
    `TOKEN=${tokenSeguro}`,
    `CHAT_ID=${chatSeguro}`,
    `SERVIDOR=${leerCategorias(row?.categories).SERVIDOR}`,
    `MUTED_UNTIL=${silencioHasta}`,
    `QUIET_ENABLED=${n.quietHoursEnabled}`,
    `QUIET_FROM=${n.quietFromHour}`,
    `QUIET_TO=${n.quietToHour}`,
    `REMINDER_MINUTES=${n.reminderMinutes}`,
    `MAX_REMINDERS=${n.maxReminders}`,
    `PANEL_URL=${panelSeguro}`,
    '',
  ].join('\n');
}
