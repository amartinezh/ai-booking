import {
  clasificarRastreoA,
  construirLineaDeVida,
  type CitaRastreo,
  type EstadoSync,
  type EvidenciaRastreoA,
  type ResultadoRastreo,
  type SaludEspejo,
} from './patient-trace';

// Lunes 21-sep-2026 10:00 en Bogotá.
const AHORA = '2026-09-21T15:00:00.000Z';
const MIN = 60_000;
const DIA = 86_400_000;
const hace = (ms: number) => new Date(Date.parse(AHORA) - ms).toISOString();
const dentroDe = (ms: number) => new Date(Date.parse(AHORA) + ms).toISOString();

// ── Fábricas ────────────────────────────────────────────────────────────────

const sync = (over: Partial<EstadoSync> = {}): EstadoSync => ({
  estado: 'DELIVERED',
  attempts: 0,
  lastError: null,
  creadoIso: hace(30 * MIN),
  oldestPendingIso: null,
  nextAttemptIso: null,
  deliveredAtIso: hace(29 * MIN),
  seq: null,
  ...over,
});

const espejoSano = (over: Partial<SaludEspejo> = {}): SaludEspejo => ({
  enabled: true,
  pushEnabled: true,
  pullEnabled: true,
  lastHeartbeatIso: hace(1 * MIN),
  hisReachable: true,
  hisDetail: null,
  ...over,
});

const cita = (over: Partial<CitaRastreo> = {}): CitaRastreo => ({
  id: 'apt-1',
  status: 'SCHEDULED',
  attendance: 'PENDING',
  origin: 'WHATSAPP',
  createdAtIso: hace(30 * MIN),
  startIso: dentroDe(2 * DIA),
  doctor: 'Dr(a). Ana Ruiz',
  service: 'Medicina General',
  eps: 'Sura',
  cancelacion: null,
  sync: sync(),
  confirmacion: {
    status: 'DELIVERED',
    enviadoIso: hace(30 * MIN),
    estadoIso: hace(29 * MIN),
    errorDetalle: null,
  },
  confirmadaEnConversacion: true,
  coincideConCaptura: null,
  ...over,
});

const evA = (over: Partial<EvidenciaRastreoA> = {}): EvidenciaRastreoA => ({
  ahoraIso: AHORA,
  pacienteEncontrado: true,
  citas: [],
  citasOcultas: 0,
  espera: [],
  conversacion: null,
  espejo: espejoSano(),
  capturaIndicada: false,
  ...over,
});

const texto = (r: ResultadoRastreo) =>
  JSON.stringify(r.veredictos.map((v) => [v.titulo, v.resumen, v.evidencia, v.noSabemos, v.accion]));

// ═══════════════════════════════════════════════════════════════════════════
// CITAS AGENDADAS POR TELEGRAM (docs/PLAN_TELEGRAM.md, Fase 3)
//
// Telegram solo informa si aceptó el mensaje (o si falló, p. ej. porque el
// paciente bloqueó al bot): no hay «entregado» ni «leído». El rastreo no puede
// inventarlos ni hablar de Meta.
// ═══════════════════════════════════════════════════════════════════════════

describe('rastreo de una cita de Telegram', () => {
  const tg = (over: Partial<CitaRastreo> = {}) =>
    cita({
      origin: 'TELEGRAM',
      confirmacion: {
        status: 'ACCEPTED',
        canal: 'TELEGRAM',
        enviadoIso: hace(30 * MIN),
        estadoIso: hace(30 * MIN),
        errorDetalle: null,
      },
      ...over,
    });

  it('la confirmación aceptada se cuenta como enviada por Telegram, sin inventar lectura', () => {
    const r = clasificarRastreoA(evA({ citas: [tg()] }));
    const t = texto(r);
    expect(t).toContain('Creada por Telegram');
    expect(t).toContain('La confirmación por Telegram se envió');
    expect(t).toContain('no informa si el paciente la leyó');
    expect(t).not.toMatch(/Meta|WhatsApp|LEÍDA|ENTREGADA/);
  });

  it('una confirmación fallida lo dice, con el motivo', () => {
    const r = clasificarRastreoA(
      evA({
        citas: [
          tg({
            confirmacion: {
              status: 'FAILED',
              canal: 'TELEGRAM',
              enviadoIso: hace(30 * MIN),
              estadoIso: hace(30 * MIN),
              errorDetalle: 'Forbidden: bot was blocked by the user',
            },
          }),
        ],
      }),
    );
    expect(texto(r)).toContain(
      'La confirmación por Telegram NO se entregó (Forbidden: bot was blocked by the user)',
    );
  });

  it('sin registro, lo dice por Telegram (no por WhatsApp)', () => {
    const r = clasificarRastreoA(evA({ citas: [tg({ confirmacion: null })] }));
    const t = texto(r);
    expect(t).toContain('No hay registro de la confirmación por Telegram');
    expect(t).not.toContain('confirmación por WhatsApp');
  });

  it('una conversación sin registro de confirmación también se advierte', () => {
    const r = clasificarRastreoA(
      evA({ citas: [tg({ confirmadaEnConversacion: false })] }),
    );
    expect(texto(r)).toContain('La conversación con el bot no tiene el registro');
  });

  describe('línea de vida', () => {
    const pasos = (c: CitaRastreo) =>
      Object.fromEntries(
        construirLineaDeVida(c, { espejo: espejoSano() }).map((p) => [p.clave, p]),
      );

    it('la conversación cuenta (el bot la agendó) y la aceptación es la entrega', () => {
      const p = pasos(tg());
      expect(p.conversacion.estado).toBe('ok');
      expect(p.confirmacion_enviada.estado).toBe('ok');
      expect(p.confirmacion_entregada.estado).toBe('ok');
      expect(p.confirmacion_entregada.detalle).toBe('Telegram la aceptó (no informa lectura).');
    });

    it('fallida → fail, sin hablar de Meta', () => {
      const p = pasos(
        tg({
          confirmacion: {
            status: 'FAILED',
            canal: 'TELEGRAM',
            enviadoIso: hace(30 * MIN),
            estadoIso: hace(30 * MIN),
            errorDetalle: null,
          },
        }),
      );
      expect(p.confirmacion_entregada.estado).toBe('fail');
      expect(p.confirmacion_entregada.detalle).toBe('Telegram no la aceptó.');
    });
  });

  it('una cita de WhatsApp sigue diciendo lo de siempre', () => {
    const t = texto(clasificarRastreoA(evA({ citas: [cita()] })));
    expect(t).toContain('WhatsApp');
    expect(t).not.toContain('Telegram');
  });
});
