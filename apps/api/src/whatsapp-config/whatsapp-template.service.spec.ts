import { of, throwError } from 'rxjs';
import { variablesEsperadas, type TemplateKind } from '@agenia/shared';
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
    configuradas?: Array<{ kind: string; name: string }>;
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
        // Las ya configuradas de la clínica: es contra ellas que `upsertForOrg`
        // comprueba que un nombre no sirva a dos tipos incompatibles.
        findMany: jest.fn(() => opts?.configuradas ?? []),
        upsert: jest.fn((args: any) => ({ id: 't1', ...args.create })),
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
    const messageLog = {
      recordOutbound: jest.fn().mockResolvedValue(undefined),
    };
    const service = new WhatsappTemplateService(
      prisma as any,
      { post } as any,
      credentials as any,
      messageLog as any,
    );
    return { service, post, prisma, credentials, messageLog };
  };

  /**
   * Las 4 variables que APPOINTMENT_REMINDER declara en su contrato. El
   * ayudante las manda por defecto porque un envío con otra cantidad ya no
   * llega a Meta: lo corta el propio servicio (ver el contrato compartido en
   * packages/shared/src/whatsapp-template-contracts.ts).
   */
  const CUATRO = ['Ana', 'Cardiología', 'Dr. Ruiz', 'martes 3pm'];

  const send = async (
    ctx: ReturnType<typeof build>,
    recipientId = PHONE,
    bodyParams: string[] = CUATRO,
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

  // 🚨 Antes esto comprobaba que un envío SIN variables omitiera
  // `components`. Ya no puede ocurrir: los seis tipos declaran variables en
  // su contrato, así que mandar cero es un error de programación, no una
  // variante válida. Y el precio de dejarlo pasar lo cobra Meta —rechazo por
  // «number of parameters does not match», con el envío ya contado contra la
  // calidad de la WABA—, así que se corta aquí.
  it.each([
    ['ninguna', []],
    ['de menos', ['Ana', 'Cardiología']],
    ['de más', ['Ana', 'Cardiología', 'Dr. Ruiz', 'martes 3pm', 'sobra']],
  ])('con %s variables no se llama a Meta', async (_caso, params) => {
    const ctx = build();
    const res = await send(ctx, PHONE, params as string[]);

    expect(res).toEqual({ success: false, error: 'body-params-mismatch' });
    expect(ctx.post).not.toHaveBeenCalled();
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
  describe('configurar una plantilla', () => {
    // 🚨 El estado REAL del servidor el 2026-09-22: los cinco tipos apuntaban
    // a `recordatorio_cita`. Cuatro de los cinco mandan una cantidad de
    // variables distinta de las 4 que esa plantilla declara, así que Meta los
    // habría rechazado uno a uno. El panel mostraba el contrato pero nadie lo
    // comprobaba; ahora no se puede guardar.
    it('rechaza reusar el nombre de otra plantilla con otra cantidad de variables', async () => {
      const ctx = build({
        configuradas: [
          { kind: 'APPOINTMENT_REMINDER', name: 'recordatorio_cita' },
        ],
      });

      await expect(
        ctx.service.upsertForOrg(ORG, {
          kind: 'SYNC_EXCEPTION_ALERT' as any,
          name: 'recordatorio_cita',
        }),
      ).rejects.toThrow(/no puede servir a las dos/);

      expect(ctx.prisma.whatsappTemplate.upsert).not.toHaveBeenCalled();
    });

    it('el mensaje dice qué crear en Meta, no solo que está mal', async () => {
      const ctx = build({
        configuradas: [
          { kind: 'APPOINTMENT_REMINDER', name: 'recordatorio_cita' },
        ],
      });

      await expect(
        ctx.service.upsertForOrg(ORG, {
          kind: 'APPOINTMENT_CANCELLED_MASS' as any,
          name: 'recordatorio_cita',
        }),
      ).rejects.toThrow(/5 variables/);
    });

    it('un nombre propio se guarda sin estorbo', async () => {
      const ctx = build({
        configuradas: [
          { kind: 'APPOINTMENT_REMINDER', name: 'recordatorio_cita' },
        ],
      });

      await ctx.service.upsertForOrg(ORG, {
        kind: 'SYNC_EXCEPTION_ALERT' as any,
        name: 'aviso_agendador_sync',
      });

      expect(ctx.prisma.whatsappTemplate.upsert).toHaveBeenCalled();
    });

    // ⚠️ Lo primero que se hace al descubrir el choque es APAGAR la plantilla
    // mal configurada. Si el guardián lo impidiera, no habría salida: habría
    // que inventarle un nombre falso para poder desactivarla.
    it('deja APAGAR una plantilla aunque su nombre choque', async () => {
      const ctx = build({
        configuradas: [
          { kind: 'APPOINTMENT_REMINDER', name: 'recordatorio_cita' },
        ],
      });

      await ctx.service.upsertForOrg(ORG, {
        kind: 'SYNC_EXCEPTION_ALERT' as any,
        name: 'recordatorio_cita',
        isActive: false,
      });

      expect(ctx.prisma.whatsappTemplate.upsert).toHaveBeenCalled();
    });

    it('una plantilla APAGADA no le estorba a nadie', async () => {
      const ctx = build({ configuradas: [] }); // findMany filtra por isActive

      await ctx.service.upsertForOrg(ORG, {
        kind: 'APPOINTMENT_CANCELLED_MASS' as any,
        name: 'recordatorio_cita',
      });

      expect(ctx.prisma.whatsappTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG, isActive: true },
        }),
      );
      expect(ctx.prisma.whatsappTemplate.upsert).toHaveBeenCalled();
    });

    it('reguardar el MISMO tipo con su mismo nombre no se bloquea a sí mismo', async () => {
      const ctx = build({
        configuradas: [
          { kind: 'APPOINTMENT_REMINDER', name: 'recordatorio_cita' },
        ],
      });

      await ctx.service.upsertForOrg(ORG, {
        kind: 'APPOINTMENT_REMINDER' as any,
        name: 'recordatorio_cita',
        language: 'es_CO',
      });

      expect(ctx.prisma.whatsappTemplate.upsert).toHaveBeenCalled();
    });
  });

  describe('libro de mensajes', () => {
    it('registra el envío con la respuesta de Meta, tipo TEMPLATE y el tipo de mensaje de la plantilla', async () => {
      const ctx = build();

      await ctx.service.sendTemplate({
        organizationId: ORG,
        recipientId: PHONE,
        kind: 'APPOINTMENT_REMINDER' as any,
        appointmentId: 'apt-7',
        bodyParams: CUATRO,
      });

      expect(ctx.messageLog.recordOutbound).toHaveBeenCalledWith({
        organizationId: ORG,
        recipientId: PHONE,
        messageType: 'TEMPLATE',
        metaResponse: { messages: [{ id: 'w1' }] },
        context: { kind: 'APPOINTMENT_REMINDER', appointmentId: 'apt-7' },
      });
    });

    it.each([
      ['APPOINTMENT_REMINDER', 'APPOINTMENT_REMINDER'],
      ['WAITLIST_SLOT_OFFER', 'WAITLIST_OFFER'],
      ['APPOINTMENT_CANCELLED_MASS', 'MASS_NOTICE'],
      ['APPOINTMENT_REMINDER_MASS', 'MASS_NOTICE'],
      // El aviso al agendador (Fase 3 del rastreo) va al PERSONAL, no a un paciente.
      ['SYNC_EXCEPTION_ALERT', 'SYSTEM_NOTICE'],
    ])(
      'la plantilla %s se registra como %s',
      async (kindPlantilla, esperado) => {
        const ctx = build({
          template: { name: 'x', language: 'es_CO', kind: kindPlantilla },
        });

        await ctx.service.sendTemplate({
          organizationId: ORG,
          recipientId: PHONE,
          kind: kindPlantilla as any,
          // Cada tipo manda una cantidad distinta (3, 4 o 5): se toma del
          // contrato para que esta prueba no se quede vieja si cambia.
          bodyParams: Array.from(
            { length: variablesEsperadas(kindPlantilla as TemplateKind) },
            (_, i) => `v${i + 1}`,
          ),
        });

        expect(ctx.messageLog.recordOutbound).toHaveBeenCalledWith(
          expect.objectContaining({
            context: { kind: esperado, appointmentId: null },
          }),
        );
      },
    );

    it('un envío que Meta rechaza NO se registra: no hay wamid que seguir', async () => {
      const postImpl = jest.fn(() => throwError(() => new Error('rechazada')));
      const ctx = build({ postImpl });

      const res = await send(ctx);

      expect(res.success).toBe(false);
      expect(ctx.messageLog.recordOutbound).not.toHaveBeenCalled();
    });
  });
});
