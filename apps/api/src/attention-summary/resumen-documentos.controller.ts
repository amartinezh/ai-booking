import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentTenant } from '../common/current-tenant.decorator';
import {
  CurrentUser,
  type JwtUserPayload,
} from '../common/current-user.decorator';
import type { Archivo } from './documentos/generador';
import {
  ResumenDocumentosService,
  type FormatoDocumento,
} from './resumen-documentos.service';
import {
  ResumenEnlacesService,
  type OrigenDeLaVisita,
} from './resumen-enlaces.service';
import { ResumenEnvioService } from './resumen-envio.service';
import { ResumenCorreoService } from './resumen-correo.service';

const DOCUMENTO = /^[a-z0-9-]{1,60}$/;

/** El pedido de un archivo, validado: documento, formato y hoja. */
export function pedidoDeArchivo(x: {
  documento?: unknown;
  formato?: unknown;
  hoja?: unknown;
}): { documento: string; formato: FormatoDocumento; hoja: number } {
  const documento = typeof x.documento === 'string' ? x.documento : '';
  if (!DOCUMENTO.test(documento))
    throw new BadRequestException('Documento inválido.');
  const formato =
    x.formato === 'png' ? 'png' : x.formato === 'pdf' ? 'pdf' : null;
  if (!formato) throw new BadRequestException('Formato inválido.');
  const hoja = formato === 'png' ? Number(x.hoja ?? 1) : 1;
  if (!Number.isInteger(hoja) || hoja < 1 || hoja > 99)
    throw new BadRequestException('Hoja inválida.');
  return { documento, formato, hoja };
}

export function comoArchivo(a: Archivo): StreamableFile {
  // El nombre solo lleva letras, números, guiones y puntos (documentosDelResumen).
  return new StreamableFile(a.datos, {
    type: a.tipo,
    disposition: `inline; filename="${a.nombreArchivo.replace(/[^A-Za-z0-9._-]/g, '')}"`,
    length: a.datos.length,
  });
}

/**
 * 📄 Vista previa de los documentos para el personal (Fase 2): el administrador
 * los compara con el papel que imprime el HIS (E7) y genera enlaces de prueba
 * para verlos en un celular.
 *
 * Fuera de `/mirror` a propósito (el proxy deja salir `/api/mirror*` a
 * internet); solo lo llama el panel por la red interna. La clínica y quién
 * pide salen del TOKEN.
 */
@Controller('attention-summaries')
@UseGuards(RolesGuard)
export class ResumenDocumentosController {
  constructor(
    private readonly documentos: ResumenDocumentosService,
    private readonly enlaces: ResumenEnlacesService,
    private readonly envio: ResumenEnvioService,
    private readonly correo: ResumenCorreoService,
  ) {}

  /** ¿Hay servidor de correo (SMTP) configurado? Para avisarlo en el panel. */
  @Get('settings/mail')
  @Roles('ORG_ADMIN')
  estadoCorreo() {
    return this.correo.estado();
  }

  @Get(':id/documents')
  @Roles('ORG_ADMIN')
  listar(
    @CurrentTenant() organizationId: string | null | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin clínica.');
    return this.documentos.listarParaPersonal(organizationId, id);
  }

  @Get(':id/documents/:documento')
  @Roles('ORG_ADMIN')
  @Header('Cache-Control', 'no-store')
  async archivo(
    @CurrentTenant() organizationId: string | null | undefined,
    @CurrentUser() user: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('documento') documento: string,
    @Query('formato') formato: string,
    @Query('hoja') hoja: string,
  ): Promise<StreamableFile> {
    if (!organizationId) throw new ForbiddenException('Sin clínica.');
    const a = await this.documentos.archivoParaPersonal(
      organizationId,
      id,
      pedidoDeArchivo({ documento, formato, hoja }),
      { userId: user.userId, email: user.email },
    );
    return comoArchivo(a);
  }

  @Post(':id/test-links')
  @HttpCode(HttpStatus.OK)
  @Roles('ORG_ADMIN')
  crearEnlace(
    @CurrentTenant() organizationId: string | null | undefined,
    @CurrentUser() user: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin clínica.');
    return this.enlaces.crearEnlaceDePrueba(organizationId, id, {
      userId: user.userId,
      email: user.email,
    });
  }

  /**
   * «Reenviar» a pedido del paciente, tras verificar su identidad en ventanilla
   * (plan §4.6). El administrador y el agendador (D14).
   */
  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @Roles('ORG_ADMIN', 'BOOKING_AGENT')
  reenviar(
    @CurrentTenant() organizationId: string | null | undefined,
    @CurrentUser() user: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    if (!organizationId) throw new ForbiddenException('Sin clínica.');
    return this.envio.reenviar(organizationId, id, {
      userId: user.userId,
      email: user.email,
    });
  }

  /** «Enviar de prueba»: el aviso de este resumen a un número del modo prueba (Fase 4). */
  @Post(':id/test-send')
  @HttpCode(HttpStatus.OK)
  @Roles('ORG_ADMIN')
  enviarDePrueba(
    @CurrentTenant() organizationId: string | null | undefined,
    @CurrentUser() user: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { destino?: unknown },
  ) {
    if (!organizationId) throw new ForbiddenException('Sin clínica.');
    return this.envio.enviarDePrueba(organizationId, id, body?.destino, {
      userId: user.userId,
      email: user.email,
    });
  }
}

/** Lo que la web le cuenta a la API de quién visita la página (IP y navegador). */
function origen(req: { headers: Record<string, unknown> }): OrigenDeLaVisita {
  const texto = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null;
  return {
    ip: texto(req.headers['x-agenia-ip']),
    navegador: texto(req.headers['x-agenia-navegador']),
  };
}

/**
 * 🔗 La página del resumen para el paciente (`/resumen/<token>`, plan §3.5).
 * Sin sesión: la protegen el token de 128 bits, la fecha de nacimiento con 5
 * intentos y el acceso firmado de 30 minutos (`ResumenEnlacesService`). La web
 * la llama por la red interna y le pasa la IP y el navegador del visitante.
 */
@Controller('public/attention-summaries')
export class ResumenPublicoController {
  constructor(private readonly enlaces: ResumenEnlacesService) {}

  @Post('open')
  @HttpCode(HttpStatus.OK)
  abrir(
    @Body() body: { token?: unknown },
    @Req() req: { headers: Record<string, unknown> },
  ) {
    return this.enlaces.abrir(body?.token, origen(req));
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verificar(
    @Body() body: { token?: unknown; fechaNacimiento?: unknown },
    @Req() req: { headers: Record<string, unknown> },
  ) {
    return this.enlaces.verificar(
      body?.token,
      body?.fechaNacimiento,
      origen(req),
    );
  }

  @Post('content')
  @HttpCode(HttpStatus.OK)
  async contenido(
    @Body() body: { token?: unknown; acceso?: unknown },
    @Req() req: { headers: Record<string, unknown> },
  ) {
    const c = await this.enlaces.contenido(
      body?.token,
      body?.acceso,
      origen(req),
    );
    if (!c) throw new ForbiddenException('Acceso vencido o inválido.');
    return c;
  }

  @Post('document')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async archivo(
    @Body()
    body: {
      token?: unknown;
      acceso?: unknown;
      documento?: unknown;
      formato?: unknown;
      hoja?: unknown;
    },
    @Req() req: { headers: Record<string, unknown> },
  ): Promise<StreamableFile> {
    const pedido = pedidoDeArchivo(body ?? {});
    const a = await this.enlaces.archivo(
      body?.token,
      body?.acceso,
      pedido,
      origen(req),
    );
    if (a === null) throw new NotFoundException('Documento no disponible.');
    return comoArchivo(a);
  }
}
