import { DATO_OCULTO } from "./alertas-tecnicas";
import type { BorradorCaso } from "./soporte-bot";
import {
  ESTADO_DEL_CASO,
  borradorSinIA,
  casoAmpliable,
  descripcionDelCaso,
  incidentesParaElPersonal,
  textoBorradorParaLaIA,
  textoCasosParaLaIA,
  textoDelBorrador,
  textoIncidentesParaLaIA,
  textoListaDeCasos,
  type AlertaAbierta,
  type CasoDeLaPersona,
} from "./soporte-bot-casos";

const AHORA = new Date("2026-10-19T15:32:00Z"); // lunes 10:32 en Colombia
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000);

const CASOS: CasoDeLaPersona[] = [
  {
    numero: 58,
    titulo: "No salen los recordatorios de hoy",
    estado: "IN_PROGRESS",
    creadoEn: hace(60),
    tomadoEn: hace(30),
    resueltoEn: null,
    respuesta: null,
  },
  {
    numero: 57,
    titulo: "La agenda del Dr. Ruiz no carga",
    estado: "OPEN",
    creadoEn: hace(120),
    tomadoEn: null,
    resueltoEn: null,
    respuesta: null,
  },
  {
    numero: 51,
    titulo: "No puedo cambiar mi contraseña",
    estado: "RESOLVED",
    creadoEn: hace(3000),
    tomadoEn: hace(2900),
    resueltoEn: hace(2800),
    respuesta: "Se restableció; la paciente 1053789456 ya puede entrar.",
  },
];

describe("sus casos", () => {
  it("los estados en palabras", () => {
    expect(ESTADO_DEL_CASO.OPEN).toMatch(/sin tomar/);
    expect(ESTADO_DEL_CASO.IN_PROGRESS).toBe("En atención");
  });

  it("para la IA: número, título, estado con fecha y la respuesta del equipo enmascarada", () => {
    const t = textoCasosParaLaIA(CASOS);
    expect(t).toContain("## Casos de soporte de esta persona");
    expect(t).toContain(
      "- #58 «No salen los recordatorios de hoy»: en atención desde el lun, 19 de oct, 10:02 a m",
    );
    expect(t).toContain(
      "- #57 «La agenda del Dr. Ruiz no carga»: abierto el lun, 19 de oct, 08:32 a m, sin tomar todavía",
    );
    expect(t).toMatch(
      /- #51 «No puedo cambiar mi contraseña»: solucionado el .*\. Respuesta del equipo: Se restableció; la paciente \[dato oculto\] ya puede entrar\./,
    );
    expect(t).not.toContain("1053789456");
  });

  it("para la IA, sin casos", () => {
    expect(textoCasosParaLaIA([])).toContain("- No tiene casos.");
  });

  it("/casos: la lista con la respuesta de los solucionados", () => {
    const t = textoListaDeCasos(CASOS);
    expect(t?.split("\n")[0]).toBe("Tus casos más recientes:");
    expect(t).toContain(
      "• #58 «No salen los recordatorios de hoy»: en atención desde",
    );
    expect(t).toContain("  Respuesta del equipo: Se restableció");
    expect(t?.endsWith("Para reportar algo nuevo, escribe /nuevo.")).toBe(true);
    expect(textoListaDeCasos([])).toBeNull();
  });

  it("recorta títulos y respuestas largas", () => {
    const t = textoListaDeCasos([
      { ...CASOS[2], titulo: "x".repeat(200), respuesta: "y".repeat(400) },
    ]);
    expect(t).toContain(`«${"x".repeat(89)}…»`);
    expect(t).toContain(`${"y".repeat(159)}…`);
  });

  it("solo se amplía un caso suyo que no esté solucionado", () => {
    expect(casoAmpliable(CASOS, 58)).toBe(true);
    expect(casoAmpliable(CASOS, 57)).toBe(true);
    expect(casoAmpliable(CASOS, 51)).toBe(false);
    expect(casoAmpliable(CASOS, 99)).toBe(false);
    expect(casoAmpliable(CASOS, null)).toBe(false);
  });
});

describe("lo que el equipo técnico ya sabe que falla", () => {
  const alerta = (cambios: Partial<AlertaAbierta>): AlertaAbierta => ({
    kind: "SERVICIO_CAIDO",
    dedupeKey: "servicio:meta",
    organizationId: null,
    firstSeenAt: hace(20),
    ...cambios,
  });
  const clinica = { organizationId: "org-1", ia: "Gemini" };

  it("traduce cada alerta en una frase fija, sin el detalle técnico", () => {
    const r = incidentesParaElPersonal(
      [
        alerta({}),
        alerta({ kind: "SERVICIO_DEGRADADO", dedupeKey: "servicio:telegram" }),
        alerta({ dedupeKey: "servicio:tts" }),
        alerta({ dedupeKey: "servicio:mirror:org-1", organizationId: "org-1" }),
        alerta({ kind: "REDIS_ERROR", dedupeKey: "servicio:redis" }),
        alerta({
          kind: "RECORDATORIOS_FALLIDOS",
          dedupeKey: "cron:recordatorios:lote",
        }),
        alerta({
          kind: "AVISO_AGENDADOR_NO_SALE",
          dedupeKey: "espejo:aviso-agendador:org-1",
          organizationId: "org-1",
        }),
        alerta({ dedupeKey: "servicio:gemini" }),
      ],
      clinica,
    );
    expect(r.map((i) => i.frase)).toEqual([
      expect.stringMatching(/^WhatsApp \(Meta\) tiene fallas/),
      expect.stringMatching(/^Telegram tiene fallas/),
      expect.stringMatching(/^La voz del asistente/),
      expect.stringMatching(/^La conexión con el hospital/),
      expect.stringMatching(/^El servidor de sesiones/),
      "Los recordatorios automáticos no están saliendo",
      expect.stringMatching(/^El aviso por WhatsApp al agendador/),
      expect.stringMatching(/^La inteligencia artificial de Gemini/),
    ]);
  });

  it("🔒 nada de otra clínica, nada interno, sin repetir, y Gemini solo si la clínica lo usa", () => {
    const r = incidentesParaElPersonal(
      [
        alerta({ dedupeKey: "servicio:mirror:org-2", organizationId: "org-2" }),
        alerta({ kind: "ERROR_5XX", dedupeKey: "5xx:500:GET:/x:Error" }),
        alerta({ kind: "CRON_FALLO", dedupeKey: "cron:retencion" }),
        alerta({ kind: "API_ARRANCO", dedupeKey: "api:arranque" }),
        alerta({ dedupeKey: "servicio:desconocido" }),
        alerta({ dedupeKey: "servicio:gemini" }),
        alerta({}),
        alerta({ kind: "SERVICIO_DEGRADADO" }),
      ],
      { organizationId: "org-1", ia: "Claude (Anthropic)" },
    );
    expect(r).toHaveLength(1);
    expect(r[0].frase).toMatch(/^WhatsApp/);
  });

  it("para la IA, con desde cuándo", () => {
    const t = textoIncidentesParaLaIA(
      incidentesParaElPersonal([alerta({})], clinica),
      AHORA,
    );
    expect(t).toContain("## Problemas técnicos que el equipo ya conoce");
    expect(t).toMatch(
      /- WhatsApp \(Meta\) tiene fallas.*\. Desde el lun, 19 de oct, 10:12 a m \(hace 20 min\)\./,
    );
    expect(textoIncidentesParaLaIA([], AHORA)).toContain(
      "- Ninguno abierto ahora.",
    );
  });
});

describe("el borrador", () => {
  const b: BorradorCaso = {
    fase: "CONFIRMANDO",
    titulo: "No salen los recordatorios de hoy",
    descripcion:
      "Desde las 7 no sale ningún recordatorio; la paciente 1053789456 llamó a preguntar.",
    pantalla: "/dashboard/configuracion",
    falta: [],
    prioridad: "HIGH",
    creadoEn: AHORA.toISOString(),
    venceEn: null,
  };

  it("para la IA, enmascarado y con lo que falta", () => {
    const t = textoBorradorParaLaIA({ ...b, falta: ["a cuántos afecta"] });
    expect(t).toContain("- Título: No salen los recordatorios de hoy");
    expect(t).toContain(DATO_OCULTO);
    expect(t).toContain("- Falta: a cuántos afecta");
    expect(textoBorradorParaLaIA(null)).toBeUndefined();
    expect(
      textoBorradorParaLaIA({
        ...b,
        titulo: null,
        descripcion: null,
        pantalla: null,
      }),
    ).toMatch(
      /sin título todavía[\s\S]*sin descripción todavía[\s\S]*no se sabe[\s\S]*Falta: nada/,
    );
  });

  it("lo que ve el empleado antes del «Sí»", () => {
    expect(textoDelBorrador(b)).toBe(
      [
        "Este es el caso que abriría:",
        "",
        "«No salen los recordatorios de hoy»",
        "Prioridad: alta (frena la atención de pacientes)",
        "Pantalla: /dashboard/configuracion",
        "Detalle: Desde las 7 no sale ningún recordatorio; la paciente 1053789456 llamó a preguntar.",
        "",
        "¿Lo abro?",
      ].join("\n"),
    );
    expect(
      textoDelBorrador({
        ...b,
        prioridad: "NORMAL",
        pantalla: null,
        titulo: null,
        descripcion: null,
      }),
    ).toContain("Prioridad: normal");
  });

  it("lo que queda en el caso: el resumen y lo que escribió tal cual (sin los comandos)", () => {
    expect(
      descripcionDelCaso({
        borrador: b,
        textos: [
          "/nuevo",
          "no salen los recordatorios",
          "  ",
          "la de la cédula 1053789456 llamó",
        ],
      }),
    ).toBe(
      [
        b.descripcion,
        "Pantalla: /dashboard/configuracion",
        "Lo que escribió por Telegram:\n«no salen los recordatorios»\n«la de la cédula 1053789456 llamó»",
      ].join("\n\n"),
    );
    expect(
      descripcionDelCaso({
        borrador: { ...b, pantalla: null, descripcion: null },
        textos: [],
      }),
    ).toBe("");
  });

  it("sin IA: el título es la primera frase y la descripción, todo lo que contó", () => {
    expect(
      borradorSinIA([
        "/nuevo",
        "No carga la agenda. Sale en blanco.",
        "desde las 8 de la mañana",
      ]),
    ).toEqual({
      titulo: "No carga la agenda.",
      descripcion:
        "No carga la agenda. Sale en blanco. desde las 8 de la mañana",
      pantalla: null,
      falta: [],
    });
    expect(
      borradorSinIA([
        "La agenda del Dr. Ruiz y de la Dra. Gómez no carga. Sale en blanco.",
      ]).titulo,
    ).toBe("La agenda del Dr. Ruiz y de la Dra. Gómez no carga.");
    const largo = borradorSinIA(["x".repeat(200)]);
    expect(largo.titulo).toHaveLength(80);
  });

  it("sin IA y muy poco: pide más", () => {
    expect(borradorSinIA(["falla"])).toEqual({
      titulo: "falla",
      descripcion: null,
      pantalla: null,
      falta: ["qué está pasando, con un poco más de detalle"],
    });
    expect(borradorSinIA(["/nuevo"]).titulo).toBeNull();
  });
});
