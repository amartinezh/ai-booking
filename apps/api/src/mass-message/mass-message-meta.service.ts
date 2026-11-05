import { Injectable, Logger } from '@nestjs/common';
import {
  TEMPLATE_CONTRACTS,
  variablesDelCuerpo,
  variablesEsperadas,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { WhatsappTemplateService } from '../whatsapp-config/whatsapp-template.service';
import { metaGraphUrl } from '../whatsapp-config/meta-graph';
import { getErrorMessage } from '../common/error-message.util';

export type TipoPlantillaComunicado =
  | 'MASS_MESSAGE_TEXT'
  | 'MASS_MESSAGE_IMAGE';

/** Lo que se sabe de la plantilla del comunicado antes de enviar. */
export interface VerificacionPlantilla {
  tipo: TipoPlantillaComunicado;
  /** Registrada y activa en Configuración → WhatsApp. */
  configurada: boolean;
  nombre: string | null;
  idioma: string | null;
  /** Se pudo preguntar a Meta (hace falta el id de la cuenta de WhatsApp Business). */
  verificadaConMeta: boolean;
  /** APPROVED, PENDING, REJECTED, PAUSED, DISABLED… según Meta. */
  estadoMeta: string | null;
  categoria: string | null;
  /** IMAGE, TEXT, VIDEO, DOCUMENT o null si no tiene encabezado. */
  encabezado: string | null;
  /** El cuerpo aprobado, con sus `{{1}}`, `{{2}}`: la vista previa usa este. */
  cuerpo: string | null;
  pie: string | null;
  /** Lo que impide enviar con ella. Vacío = lista. */
  problemas: string[];
}

export interface EstadoDelNumero {
  numero: string | null;
  nombreVerificado: string | null;
  /** GREEN, YELLOW, RED o UNKNOWN según Meta. */
  calidad: string | null;
  /** Cuántas personas distintas puede contactar el número en 24 h (TIER_250, TIER_1K…). */
  nivel: string | null;
}

interface PlantillaDeMeta {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: Array<{ type?: string; format?: string; text?: string }>;
}

/**
 * 📢 Lo que Mensajes masivos le pregunta y le sube a Meta
 * (docs/PLAN_MENSAJES_MASIVOS.md §5): si la plantilla del comunicado existe,
 * está aprobada y tiene la forma correcta (encabezado de imagen o no, 2
 * variables); la calidad y el nivel del número; y la imagen del encabezado
 * (`/media`, vale unos 30 días).
 *
 * Nunca lanza: un fallo de Meta se devuelve como dato para la pantalla.
 */
@Injectable()
export class MassMessageMetaService {
  private readonly logger = new Logger(MassMessageMetaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credenciales: WhatsappCredentialsService,
    private readonly plantillas: WhatsappTemplateService,
  ) {}

  async verificarPlantilla(
    organizationId: string,
    tipo: TipoPlantillaComunicado,
  ): Promise<VerificacionPlantilla> {
    const base: VerificacionPlantilla = {
      tipo,
      configurada: false,
      nombre: null,
      idioma: null,
      verificadaConMeta: false,
      estadoMeta: null,
      categoria: null,
      encabezado: null,
      cuerpo: null,
      pie: null,
      problemas: [],
    };
    const registrada = await this.plantillas.findTemplate(organizationId, tipo);
    if (!registrada) {
      base.problemas.push(
        `Falta registrar la plantilla «${TEMPLATE_CONTRACTS[tipo].label}» en Configuración → WhatsApp.`,
      );
      return base;
    }
    base.configurada = true;
    base.nombre = registrada.name;
    base.idioma = registrada.language;

    const [creds, cuenta] = await Promise.all([
      this.credenciales.forOrg(organizationId),
      this.prisma.whatsappAccountConfig.findUnique({
        where: { organizationId },
        select: { businessAccountId: true },
      }),
    ]);
    if (!creds?.isActive) {
      base.problemas.push(
        'WhatsApp está apagado o sin configurar para la clínica.',
      );
      return base;
    }
    if (!cuenta?.businessAccountId) return base;

    try {
      const url = `${metaGraphUrl(`${cuenta.businessAccountId}/message_templates`)}?name=${encodeURIComponent(registrada.name)}&fields=name,language,status,category,components&limit=20`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      const datos = (await res.json()) as {
        data?: PlantillaDeMeta[];
        error?: unknown;
      };
      if (!res.ok) {
        this.logger.warn(
          `No se pudo verificar la plantilla ${registrada.name} (org ${organizationId}): ${JSON.stringify(datos.error ?? datos).slice(0, 300)}`,
        );
        return base;
      }
      base.verificadaConMeta = true;
      const candidatas = (datos.data ?? []).filter(
        (p) => p.name === registrada.name,
      );
      const plantilla =
        candidatas.find((p) => p.language === registrada.language) ??
        candidatas.find(
          (p) =>
            p.language?.split('_')[0] === registrada.language.split('_')[0],
        );
      if (!plantilla) {
        base.problemas.push(
          candidatas.length
            ? `En Meta, «${registrada.name}» no está en el idioma registrado (${registrada.language}); está en ${candidatas.map((p) => p.language).join(', ')}.`
            : `En Meta no existe una plantilla llamada «${registrada.name}».`,
        );
        return base;
      }
      return { ...base, ...leerPlantillaDeMeta(plantilla, tipo) };
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo verificar la plantilla ${registrada.name} (org ${organizationId}): ${getErrorMessage(error)}`,
      );
      return base;
    }
  }

  async estadoDelNumero(
    organizationId: string,
  ): Promise<EstadoDelNumero | null> {
    const creds = await this.credenciales.forOrg(organizationId);
    if (!creds?.isActive) return null;
    try {
      const res = await fetch(
        `${metaGraphUrl(creds.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
        {
          headers: { Authorization: `Bearer ${creds.accessToken}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) return null;
      const d = (await res.json()) as Record<string, unknown>;
      const texto = (v: unknown) => (typeof v === 'string' ? v : null);
      return {
        numero: texto(d.display_phone_number),
        nombreVerificado: texto(d.verified_name),
        calidad: texto(d.quality_rating),
        nivel: texto(d.messaging_limit_tier),
      };
    } catch {
      return null;
    }
  }

  /** Sube la imagen del encabezado; devuelve su id en Meta o el error. */
  async subirImagen(
    organizationId: string,
    datos: Buffer,
    mime: string,
  ): Promise<{ id: string } | { error: string }> {
    const creds = await this.credenciales.forOrg(organizationId);
    if (!creds?.isActive) return { error: 'whatsapp-inactive' };
    try {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', mime);
      form.append(
        'file',
        new Blob([new Uint8Array(datos)], { type: mime }),
        mime === 'image/png' ? 'comunicado.png' : 'comunicado.jpg',
      );
      const res = await fetch(metaGraphUrl(`${creds.phoneNumberId}/media`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const cuerpo = (await res.json()) as { id?: string; error?: unknown };
      if (!res.ok || !cuerpo.id) {
        return { error: JSON.stringify(cuerpo.error ?? cuerpo).slice(0, 500) };
      }
      return { id: cuerpo.id };
    } catch (error: unknown) {
      return { error: getErrorMessage(error) };
    }
  }
}

/**
 * Lo que dice Meta de la plantilla, y lo que no casa con un comunicado: que no
 * esté aprobada, que el encabezado no sea el del tipo, o que el cuerpo no tenga
 * las 2 variables.
 */
export function leerPlantillaDeMeta(
  p: PlantillaDeMeta,
  tipo: TipoPlantillaComunicado,
): Pick<
  VerificacionPlantilla,
  'estadoMeta' | 'categoria' | 'encabezado' | 'cuerpo' | 'pie' | 'problemas'
> {
  const componentes = p.components ?? [];
  const header = componentes.find((c) => c.type?.toUpperCase() === 'HEADER');
  const body = componentes.find((c) => c.type?.toUpperCase() === 'BODY');
  const footer = componentes.find((c) => c.type?.toUpperCase() === 'FOOTER');
  const encabezado = header ? (header.format ?? 'TEXT').toUpperCase() : null;
  const cuerpo = body?.text ?? null;
  const problemas: string[] = [];
  const estado = p.status?.toUpperCase() ?? null;
  if (estado !== 'APPROVED') {
    const estados: Record<string, string> = {
      PENDING: 'Meta todavía la está revisando',
      REJECTED: 'Meta la rechazó',
      PAUSED: 'Meta la pausó por su calidad',
      DISABLED: 'Meta la desactivó',
      IN_APPEAL: 'está en apelación',
    };
    problemas.push(
      `La plantilla no está aprobada: ${estados[estado ?? ''] ?? `estado ${estado ?? 'desconocido'}`}.`,
    );
  }
  if (tipo === 'MASS_MESSAGE_IMAGE' && encabezado !== 'IMAGE') {
    problemas.push(
      encabezado
        ? `La plantilla del comunicado con imagen tiene encabezado de tipo ${encabezado}; debe ser Imagen.`
        : 'La plantilla del comunicado con imagen no tiene encabezado: en Meta, agregue Encabezado → Multimedia → Imagen.',
    );
  }
  if (tipo === 'MASS_MESSAGE_TEXT' && encabezado && encabezado !== 'TEXT') {
    problemas.push(
      `La plantilla del comunicado sin imagen tiene encabezado de tipo ${encabezado}: no se puede enviar sin él. Use una sin encabezado multimedia.`,
    );
  }
  if (
    tipo === 'MASS_MESSAGE_TEXT' &&
    header?.text &&
    /\{\{\s*\d+\s*\}\}/.test(header.text)
  ) {
    problemas.push(
      'El encabezado de texto tiene una variable: el comunicado no la llena. Quítela en Meta.',
    );
  }
  const esperadas = variablesEsperadas(tipo);
  if (cuerpo !== null && variablesDelCuerpo(cuerpo) !== esperadas) {
    problemas.push(
      `El cuerpo aprobado tiene ${variablesDelCuerpo(cuerpo)} variable(s); el comunicado manda ${esperadas} (${TEMPLATE_CONTRACTS[tipo].variables.join(' y ')}).`,
    );
  }
  return {
    estadoMeta: estado,
    categoria: p.category?.toUpperCase() ?? null,
    encabezado,
    cuerpo,
    pie: footer?.text ?? null,
    problemas,
  };
}
