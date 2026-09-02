import { of, throwError } from 'rxjs';
import { WhatsappTemplateService } from './whatsapp-template.service';

/** Forma del cuerpo que se le manda a la Graph API para una plantilla. */
type TemplatePayload = {
  messaging_product: string;
  recipient_type: string;
  to?: string;
  recipient?: string;
  type: string;
  template: {
    name: string;
    language: { code: string };
    components?: Array<{
      type: string;
      parameters: Array<{ type: string; text: string }>;
    }>;
  };
};

/** Cuerpo del primer POST hecho contra Meta. */
const bodyOf = (post: jest.Mock): TemplatePayload =>
  (post.mock.calls[0] as [string, TemplatePayload])[1];

describe('WhatsappTemplateService', () => {
  const ORG = 'org-1';
  const PHONE = '573001112233';
  const BSUID = 'CO.13491208655302741918';

  const build = (opts?: {
    template?: Record<string, unknown> | null;
    creds?: Record<string, unknown> | null;
    postImpl?: jest.Mock;
  }) => {
    const post =
      opts?.postImpl ??
      jest.fn(() => of({ data: { messages: [{ id: 'w1' }] } }));
    const prisma = {
      whatsappTemplate: {
        findFirst: jest.fn(() =>
          opts?.template === undefined
            ? {
                name: 'recordatorio_cita',
                language: 'es_CO',
                kind: 'APPOINTMENT_REMINDER',
              }
            : opts.template,
        ),
      },
    };
    const credentials = {
      forOrg: jest.fn(() =>
        opts?.creds === undefined
          ? {
              organizationId: ORG,
              phoneNumberId: 'pnid',
              accessToken: 'tok',
              isActive: true,
            }
          : opts.creds,
      ),
    };
    const service = new WhatsappTemplateService(
      prisma as any,
      { post } as any,
      credentials as any,
    );
    return { service, post, prisma, credentials };
  };

  const send = async (
    ctx: ReturnType<typeof build>,
    recipientId = PHONE,
    bodyParams?: string[],
  ) =>
    ctx.service.sendTemplate({
      organizationId: ORG,
      recipientId,
      kind: 'APPOINTMENT_REMINDER' as any,
      bodyParams,
    });

  it('envía type=template con el nombre e idioma aprobados de la clínica', async () => {
    const ctx = build();
    const res = await send(ctx);

    expect(res).toEqual({ success: true, templateName: 'recordatorio_cita' });
    const body = bodyOf(ctx.post);
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'template',
      template: {
        name: 'recordatorio_cita',
        language: { code: 'es_CO' },
      },
    });
  });

  it('teléfono → `to`; BSUID → `recipient`', async () => {
    const conTelefono = build();
    await send(conTelefono);
    const bodyTel = bodyOf(conTelefono.post);
    expect(bodyTel).toMatchObject({ to: PHONE });
    expect(bodyTel).not.toHaveProperty('recipient');

    const conBsuid = build();
    await send(conBsuid, BSUID);
    const bodyBsuid = bodyOf(conBsuid.post);
    expect(bodyBsuid).toMatchObject({ recipient: BSUID });
    expect(bodyBsuid).not.toHaveProperty('to');
  });

  it('los parámetros del cuerpo viajan posicionalmente y en orden', async () => {
    const ctx = build();
    await send(ctx, PHONE, ['Ana', 'Cardiología', 'Dr. Ruiz', 'martes 3pm']);

    const body = bodyOf(ctx.post);
    expect(body.template.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Ana' },
          { type: 'text', text: 'Cardiología' },
          { type: 'text', text: 'Dr. Ruiz' },
          { type: 'text', text: 'martes 3pm' },
        ],
      },
    ]);
  });

  it('sin variables NO manda `components` (Meta rechaza lo que no case con la aprobación)', async () => {
    const ctx = build();
    await send(ctx, PHONE, []);

    const body = bodyOf(ctx.post);
    expect(body.template).not.toHaveProperty('components');
  });

  it('clínica sin plantilla configurada → error explícito, sin llamar a Meta', async () => {
    const ctx = build({ template: null });
    const res = await send(ctx);

    expect(res).toEqual({ success: false, error: 'template-not-configured' });
    expect(ctx.post).not.toHaveBeenCalled();
  });

  it('sólo busca plantillas ACTIVAS y de la organización pedida', async () => {
    const ctx = build();
    await send(ctx);

    expect(ctx.prisma.whatsappTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        kind: 'APPOINTMENT_REMINDER',
        isActive: true,
      },
    });
  });

  it('integración de WhatsApp inactiva → no se intenta el envío', async () => {
    const ctx = build({ creds: { isActive: false } });
    const res = await send(ctx);

    expect(res).toEqual({ success: false, error: 'whatsapp-inactive' });
    expect(ctx.post).not.toHaveBeenCalled();
  });

  it('el error de Meta se propaga tal cual, sin reinterpretarlo', async () => {
    const postImpl = jest.fn(() =>
      throwError(() => ({
        response: { data: { error: { message: 'template not found' } } },
      })),
    );
    const ctx = build({ postImpl });
    const res = await send(ctx);

    expect(res.success).toBe(false);
    expect(res.error).toContain('template not found');
  });

  it('sin organización o sin destinatario → no consulta nada', async () => {
    const ctx = build();
    const res = await ctx.service.sendTemplate({
      organizationId: '',
      recipientId: PHONE,
      kind: 'APPOINTMENT_REMINDER' as any,
    });

    expect(res).toEqual({ success: false, error: 'missing-params' });
    expect(ctx.prisma.whatsappTemplate.findFirst).not.toHaveBeenCalled();
  });
});
