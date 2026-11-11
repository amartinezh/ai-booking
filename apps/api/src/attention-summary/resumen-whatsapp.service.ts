import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { buildWhatsappRecipient } from '@agenia/shared';
import type { WhatsappMessageType } from '@agenia/database';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { WhatsappMessageLogService } from '../whatsapp-config/whatsapp-message-log.service';
import { metaGraphUrl } from '../whatsapp-config/meta-graph';

export interface ResultadoWhatsapp {
  ok: boolean;
  wamid?: string | null;
  error?: string;
}

/**
 * 📨 Lo que el resumen de la atención manda por WhatsApp (plan §3.3, Fase 4):
 * los PDF y las imágenes de cada hoja (se suben a Meta y se mandan por su id),
 * el aviso con el botón «Recibir documentos» dentro de la ventana de 24 h y los
 * textos del asistente. Cada envío queda en el libro de mensajes como
 * `ATTENTION_SUMMARY` y, si se pasa, con el envío al que pertenece (`entrega`),
 * para seguir su entrega y su lectura. Nunca lanza: devuelve si salió y, si no,
 * por qué.
 *
 * Mismo camino que el audio del modo voz (`uploadToWhatsApp` del asistente),
 * aparte para no tocar el asistente.
 */
@Injectable()
export class ResumenWhatsappService {
  private readonly logger = new Logger(ResumenWhatsappService.name);

  constructor(
    private readonly http: HttpService,
    private readonly credenciales: WhatsappCredentialsService,
    private readonly libro: WhatsappMessageLogService,
  ) {}

  private async creds(organizationId: string) {
    const c = await this.credenciales.forOrg(organizationId);
    return c && c.isActive ? c : null;
  }

  /** Sube un archivo a Meta; devuelve su id para mandarlo (vale unos 30 días en Meta). */
  async subir(
    organizationId: string,
    datos: Buffer,
    tipo: 'application/pdf' | 'image/png',
    nombre: string,
  ): Promise<string | null> {
    const c = await this.creds(organizationId);
    if (!c) return null;
    try {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', tipo);
      form.append(
        'file',
        new Blob([new Uint8Array(datos)], { type: tipo }),
        nombre,
      );
      const res = await fetch(metaGraphUrl(`${c.phoneNumberId}/media`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.accessToken}` },
        body: form,
      });
      const data = (await res.json()) as { id?: string; error?: unknown };
      if (!res.ok || !data.id) {
        this.logger.error(
          `No se subió ${nombre} a Meta (org ${organizationId}): ${JSON.stringify(data.error ?? data).slice(0, 300)}`,
        );
        return null;
      }
      return data.id;
    } catch (error: unknown) {
      this.logger.error(
        `No se subió ${nombre} a Meta (org ${organizationId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async enviar(
    organizationId: string,
    destino: string,
    tipo: WhatsappMessageType,
    mensaje: Record<string, unknown>,
    entrega: string | null = null,
  ): Promise<ResultadoWhatsapp> {
    const c = await this.creds(organizationId);
    if (!c) return { ok: false, error: 'whatsapp-inactive' };
    try {
      const res = await lastValueFrom(
        this.http.post<unknown>(
          metaGraphUrl(`${c.phoneNumberId}/messages`),
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            ...buildWhatsappRecipient(destino),
            ...mensaje,
          },
          {
            headers: {
              Authorization: `Bearer ${c.accessToken}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      await this.libro.recordOutbound({
        organizationId,
        recipientId: destino,
        messageType: tipo,
        metaResponse: res.data,
        context: {
          kind: 'ATTENTION_SUMMARY',
          attentionSummaryDeliveryId: entrega,
        },
      });
      const wamid =
        (res.data as { messages?: { id?: string }[] })?.messages?.[0]?.id ??
        null;
      return { ok: true, wamid };
    } catch (error: unknown) {
      const e = error as { response?: { data?: unknown }; message?: string };
      const detalle =
        e?.response?.data !== undefined
          ? JSON.stringify(e.response.data)
          : (e?.message ?? 'error desconocido');
      this.logger.error(
        `Envío ${tipo} del resumen falló (org ${organizationId}): ${detalle.slice(0, 300)}`,
      );
      return { ok: false, error: detalle.slice(0, 500) };
    }
  }

  texto(
    organizationId: string,
    destino: string,
    cuerpo: string,
    entrega: string | null = null,
  ): Promise<ResultadoWhatsapp> {
    return this.enviar(
      organizationId,
      destino,
      'TEXT',
      { type: 'text', text: { preview_url: false, body: cuerpo } },
      entrega,
    );
  }

  documento(
    organizationId: string,
    destino: string,
    mediaId: string,
    nombreArchivo: string,
    entrega: string | null = null,
  ): Promise<ResultadoWhatsapp> {
    return this.enviar(
      organizationId,
      destino,
      'DOCUMENT',
      { type: 'document', document: { id: mediaId, filename: nombreArchivo } },
      entrega,
    );
  }

  imagen(
    organizationId: string,
    destino: string,
    mediaId: string,
    pie?: string,
    entrega: string | null = null,
  ): Promise<ResultadoWhatsapp> {
    return this.enviar(
      organizationId,
      destino,
      'IMAGE',
      {
        type: 'image',
        image: { id: mediaId, ...(pie ? { caption: pie } : {}) },
      },
      entrega,
    );
  }

  /** Mensaje con botones de respuesta (solo dentro de la ventana de 24 h; título de hasta 20 letras). */
  botones(
    organizationId: string,
    destino: string,
    cuerpo: string,
    botones: { id: string; titulo: string }[],
    entrega: string | null = null,
  ): Promise<ResultadoWhatsapp> {
    return this.enviar(
      organizationId,
      destino,
      'INTERACTIVE',
      {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: cuerpo },
          action: {
            buttons: botones.map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: b.titulo.slice(0, 20) },
            })),
          },
        },
      },
      entrega,
    );
  }
}
