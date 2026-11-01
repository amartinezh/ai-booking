import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface CorreoSaliente {
  para: string;
  asunto: string;
  texto: string;
  html: string;
  adjunto?: { nombre: string; datos: Buffer; tipo: string };
}

/**
 * ✉️ El correo del resumen de la atención (plan §3.4, Fase 3), por SMTP.
 *
 * SMTP porque los tres proveedores que propone el plan (D12: Amazon SES, Brevo
 * o Resend) lo aceptan: elegir uno es poner sus datos en el entorno, sin tocar
 * código. Sin `SMTP_HOST` y `MAIL_FROM` no se envía nada.
 *
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE («true» para el 465),
 *   SMTP_USER, SMTP_PASS, MAIL_FROM («Hospital … <documentos@dominio>»),
 *   MAIL_REPLY_TO (opcional).
 *
 * El dominio del remitente necesita SPF, DKIM y DMARC (lo da el proveedor),
 * para que Gmail y Outlook no lo manden a spam. Nunca lanza.
 */
@Injectable()
export class ResumenCorreoService {
  private readonly logger = new Logger(ResumenCorreoService.name);
  private transporte: Transporter | null = null;
  private clave = '';

  /** ¿Hay servidor de correo configurado? El remitente, para mostrarlo en el panel. */
  estado(): { configurado: boolean; remitente: string | null } {
    const host = process.env.SMTP_HOST?.trim();
    const remitente = process.env.MAIL_FROM?.trim() || null;
    return { configurado: !!host && !!remitente, remitente };
  }

  private obtenerTransporte(): Transporter | null {
    if (!this.estado().configurado) return null;
    const host = process.env.SMTP_HOST!.trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE === 'true';
    const user = process.env.SMTP_USER?.trim();
    // Se rehace si cambia la configuración (pruebas, rotación de claves).
    const clave = `${host}|${port}|${secure}|${user ?? ''}`;
    if (!this.transporte || this.clave !== clave) {
      this.transporte = nodemailer.createTransport({
        host,
        port,
        secure,
        ...(user ? { auth: { user, pass: process.env.SMTP_PASS ?? '' } } : {}),
      });
      this.clave = clave;
    }
    return this.transporte;
  }

  async enviar(
    c: CorreoSaliente,
  ): Promise<{ ok: boolean; id?: string; error?: string }> {
    const t = this.obtenerTransporte();
    if (!t)
      return {
        ok: false,
        error: 'El correo no está configurado en el servidor',
      };
    try {
      const r = (await t.sendMail({
        from: process.env.MAIL_FROM,
        ...(process.env.MAIL_REPLY_TO
          ? { replyTo: process.env.MAIL_REPLY_TO }
          : {}),
        to: c.para,
        subject: c.asunto,
        text: c.texto,
        html: c.html,
        ...(c.adjunto
          ? {
              attachments: [
                {
                  filename: c.adjunto.nombre,
                  content: c.adjunto.datos,
                  contentType: c.adjunto.tipo,
                },
              ],
            }
          : {}),
      })) as { messageId?: string };
      return { ok: true, id: r.messageId };
    } catch (error: unknown) {
      const motivo = error instanceof Error ? error.message : String(error);
      // El motivo, nunca el destinatario completo ni el contenido.
      this.logger.error(`Correo del resumen no salió: ${motivo.slice(0, 300)}`);
      return { ok: false, error: motivo.slice(0, 300) };
    }
  }
}
