import { permisosBandeja, SIN_PERMISOS, type ActorBandeja, type RolBandeja } from './acceso';
import {
  enviarMensaje,
  MAX_MENSAJE,
  MOTIVO_SIN_MENSAJE,
  MSG_SIN_CITA,
  MSG_SIN_RESPUESTA,
  prepararMensaje,
  sugeridaPara,
  type ClienteMensajes,
  type RespuestaRevision,
} from './mensaje-paciente';
import { MSG_NO_ENCONTRADA } from './servicio';

/**
 * ✉️ Escribirle al paciente desde un caso de la Bandeja (2026-10-29). Lo que se
 * fija aquí: la cita sale del caso (nunca del cliente), el caso tiene que ser de la
 * clínica y del alcance del agente, y cada envío deja su constancia sin el texto.
 */

const ORG = 'org-1';

const actor = (role: RolBandeja, over: Partial<ActorBandeja> = {}): ActorBandeja => ({
  userId: 'u-yo',
  role,
  organizationId: ORG,
  permisos: permisosBandeja(role),
  scopeEpsId: null,
  scopeDoctorId: null,
  ...over,
});

const caso = (over: Record<string, unknown> = {}) => ({
  id: 'ex-1',
  organizationId: ORG,
  kind: 'CITA_NO_ENTREGADA',
  status: 'ABIERTA',
  appointmentId: 'cita-1',
  patientId: 'pac-1',
  epsId: 'eps-1',
  doctorId: 'doc-1',
  appointmentStartAt: new Date('2026-10-30T11:30:00.000Z'),
  ...over,
});

function montar(filas: ReturnType<typeof caso>[] = [caso()]) {
  const logs: Record<string, unknown>[] = [];
  const db = {
    syncException: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        filas.find((f) =>
          Object.entries(where).every(([k, v]) => (f as Record<string, unknown>)[k] === v),
        ) ?? null,
      ),
    },
    syncExceptionLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        logs.push(data);
        return data;
      }),
    },
  };
  return { db, logs };
}

const revision = (over: Partial<Extract<RespuestaRevision, { ok: true }>> = {}): RespuestaRevision => ({
  ok: true,
  canal: 'WHATSAPP',
  puedeEscribir: true,
  hastaIso: '2026-10-30T13:37:00.000Z',
  destino: '•••9051',
  otroNumero: true,
  citaVigente: true,
  sugerencias: { cancelada: 'C', confirmada: 'R', saludo: 'S' },
  ...over,
});

function cliente(over: Partial<ClienteMensajes> = {}) {
  return {
    revisar: jest.fn(async () => revision()),
    enviar: jest.fn(async () => ({ ok: true as const, canal: 'WHATSAPP' as const, destino: '•••9051' })),
    ...over,
  };
}

describe('prepararMensaje', () => {
  it('pregunta a la API por la cita DEL CASO y abre con «cancelada» en una cita que no llegó', async () => {
    const { db } = montar();
    const c = cliente();
    const r = await prepararMensaje(db as never, actor('ORG_ADMIN'), 'ex-1', c);
    expect(c.revisar).toHaveBeenCalledWith('cita-1');
    expect(r).toEqual({
      success: true,
      data: expect.objectContaining({ destino: '•••9051', puedeEscribir: true, sugerida: 'cancelada' }),
    });
  });

  it('un caso de otra clínica responde como inexistente y no llama a la API', async () => {
    const { db } = montar([caso({ organizationId: 'otra' })]);
    const c = cliente();
    await expect(prepararMensaje(db as never, actor('ORG_ADMIN'), 'ex-1', c)).resolves.toEqual({
      success: false,
      error: MSG_NO_ENCONTRADA,
    });
    expect(c.revisar).not.toHaveBeenCalled();
  });

  it('un agente acotado a otra EPS no lo alcanza', async () => {
    const { db } = montar();
    const c = cliente();
    const r = await prepararMensaje(db as never, actor('BOOKING_AGENT', { scopeEpsId: 'eps-2' }), 'ex-1', c);
    expect(r).toEqual({ success: false, error: MSG_NO_ENCONTRADA });
    expect(c.revisar).not.toHaveBeenCalled();
  });

  it('un rol sin Bandeja no puede', async () => {
    const { db } = montar();
    await expect(prepararMensaje(db as never, actor('DOCTOR'), 'ex-1', cliente())).resolves.toEqual({
      success: false,
      error: SIN_PERMISOS,
    });
  });

  it('un caso sin cita o sin paciente no tiene a quién escribirle', async () => {
    const { db } = montar([caso({ appointmentId: null })]);
    await expect(prepararMensaje(db as never, actor('ORG_ADMIN'), 'ex-1', cliente())).resolves.toEqual({
      success: false,
      error: MSG_SIN_CITA,
    });
  });

  it('traduce lo que dice la API y la API caída', async () => {
    const { db } = montar();
    await expect(
      prepararMensaje(db as never, actor('ORG_ADMIN'), 'ex-1', cliente({ revisar: async () => ({ ok: false, motivo: 'TELEFONO_EQUIVOCADO' }) })),
    ).resolves.toEqual({ success: false, error: MOTIVO_SIN_MENSAJE.TELEFONO_EQUIVOCADO });
    await expect(
      prepararMensaje(db as never, actor('ORG_ADMIN'), 'ex-1', cliente({ revisar: async () => null })),
    ).resolves.toEqual({ success: false, error: MSG_SIN_RESPUESTA });
  });
});

describe('enviarMensaje', () => {
  it('envía a la cita del caso y deja la constancia en el historial, SIN el texto', async () => {
    const { db, logs } = montar();
    const c = cliente();
    const r = await enviarMensaje(db as never, actor('BOOKING_AGENT'), { id: 'ex-1', texto: '  Hola, Maria.  ' }, c);
    expect(c.enviar).toHaveBeenCalledWith('cita-1', 'Hola, Maria.');
    expect(r).toEqual({
      success: true,
      data: { canal: 'WHATSAPP', destino: '•••9051', appointmentId: 'cita-1', inicio: caso().appointmentStartAt },
    });
    expect(logs).toEqual([
      {
        exceptionId: 'ex-1',
        action: 'MENSAJE_AL_PACIENTE',
        actorUserId: 'u-yo',
        actorRole: 'BOOKING_AGENT',
        note: 'Por WhatsApp al •••9051',
      },
    ]);
  });

  it('un texto vacío o demasiado largo no llega a la API', async () => {
    const { db } = montar();
    const c = cliente();
    for (const texto of ['', '   ', 'x'.repeat(MAX_MENSAJE + 1), 42]) {
      await expect(enviarMensaje(db as never, actor('ORG_ADMIN'), { id: 'ex-1', texto }, c)).resolves.toEqual({
        success: false,
        error: MOTIVO_SIN_MENSAJE.MENSAJE_INVALIDO,
      });
    }
    expect(c.enviar).not.toHaveBeenCalled();
  });

  it('si la API no lo envió, no queda constancia', async () => {
    const { db, logs } = montar();
    const r = await enviarMensaje(
      db as never,
      actor('ORG_ADMIN'),
      { id: 'ex-1', texto: 'Hola' },
      cliente({ enviar: async () => ({ ok: false, motivo: 'FUERA_DE_VENTANA' }) }),
    );
    expect(r).toEqual({ success: false, error: MOTIVO_SIN_MENSAJE.FUERA_DE_VENTANA });
    expect(logs).toEqual([]);
  });

  it('si la constancia falla, el envío igual cuenta como hecho (no se reenvía)', async () => {
    const { db } = montar();
    db.syncExceptionLog.create.mockRejectedValueOnce(new Error('caída'));
    const espia = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await enviarMensaje(db as never, actor('ORG_ADMIN'), { id: 'ex-1', texto: 'Hola' }, cliente());
    expect(r.success).toBe(true);
    espia.mockRestore();
  });

  it('por Telegram la constancia lo dice sin número', async () => {
    const { db, logs } = montar();
    await enviarMensaje(
      db as never,
      actor('ORG_ADMIN'),
      { id: 'ex-1', texto: 'Hola' },
      cliente({ enviar: async () => ({ ok: true, canal: 'TELEGRAM', destino: null }) }),
    );
    expect(logs[0]).toMatchObject({ note: 'Por Telegram' });
  });
});

describe('sugeridaPara', () => {
  it('cancelada donde la cita no quedó o el hospital la canceló; saludo en los demás', () => {
    for (const t of ['CITA_NO_ENTREGADA', 'EVENTO_RENDIDO', 'DERIVA_EN_HIS', 'CONFLICTO_SYNC', 'CITA_CANCELADA_POR_HOSPITAL']) {
      expect(sugeridaPara(t)).toBe('cancelada');
    }
    for (const t of ['AVISO_INASISTENCIA', 'CANCELACION_SIN_CONFIRMAR', 'REVISAR_CITA_ASISTENTE', 'CITA_MOVIDA_POR_HOSPITAL']) {
      expect(sugeridaPara(t)).toBe('saludo');
    }
  });
});
