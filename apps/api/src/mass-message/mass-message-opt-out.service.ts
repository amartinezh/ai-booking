import { Injectable } from '@nestjs/common';
import {
  TEXTOS_BAJA_COMUNICADOS,
  claveDeBaja,
  intencionDeComunicados,
  isTelegramSender,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 📢 «No más comunicados» (docs/PLAN_MENSAJES_MASIVOS.md §9): la baja (o el alta)
 * de los mensajes masivos escrita por el paciente. La llama el asistente con cada
 * mensaje de texto, después de la emergencia; si no es una baja ni un alta,
 * devuelve `null` y el turno sigue igual.
 *
 * Vale para el número que escribe, tenga ficha o no. Si escribe con un BSUID (el
 * número oculto), se guarda el BSUID y también el teléfono de sus fichas en la
 * clínica, que es lo que traen las listas. No toca los recordatorios: quien pide
 * no recibir comunicados no está pidiendo perder el aviso de su cita.
 *
 * Telegram no: los comunicados solo salen por WhatsApp.
 */
@Injectable()
export class MassMessageOptOutService {
  constructor(private readonly prisma: PrismaService) {}

  async manejarTexto(
    organizationId: string,
    remitente: string,
    texto: string | null | undefined,
  ): Promise<{ intencion: 'BAJA' | 'ALTA'; respuesta: string } | null> {
    if (!texto || !remitente || isTelegramSender(remitente)) return null;
    const intencion = intencionDeComunicados(texto);
    if (!intencion) return null;

    const destinos = new Set([claveDeBaja(remitente)]);
    if (!/^\+?\d+$/.test(remitente)) {
      const fichas = await this.prisma.patientProfile.findMany({
        where: { organizationId, bsuid: remitente },
        select: { whatsappId: true },
      });
      for (const f of fichas)
        if (f.whatsappId && /^\d{8,15}$/.test(f.whatsappId))
          destinos.add(`+${f.whatsappId}`);
    }

    if (intencion === 'BAJA') {
      for (const destination of destinos) {
        await this.prisma.massMessageOptOut.upsert({
          where: {
            organizationId_destination: { organizationId, destination },
          },
          create: { organizationId, destination, source: 'CHAT' },
          update: {},
        });
      }
    } else {
      await this.prisma.massMessageOptOut.deleteMany({
        where: { organizationId, destination: { in: [...destinos] } },
      });
    }
    return {
      intencion,
      respuesta:
        intencion === 'BAJA'
          ? TEXTOS_BAJA_COMUNICADOS.baja
          : TEXTOS_BAJA_COMUNICADOS.alta,
    };
  }
}
