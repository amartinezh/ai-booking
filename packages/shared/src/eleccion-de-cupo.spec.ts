import {
  cuposDelMedicoNombrado,
  cuposMasCercanosALaHora,
  letraEnLaFrase,
} from "./eleccion-de-cupo";

// Cupos del jueves 29 de octubre de 2026 (Bogotá = UTC-5).
const cupo = (hhmm: string, medico = "Dr(a). ISABELLA GOMEZ VILLEGAS") => {
  const [h, m] = hhmm.split(":").map(Number);
  return { fecha: new Date(Date.UTC(2026, 9, 29, h + 5, m)), medico };
};
const horas = (cs: Array<{ fecha: Date }>) =>
  cs.map((c) => {
    const d = new Date(c.fecha.getTime() - 5 * 3_600_000);
    return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  });

describe("cuposMasCercanosALaHora", () => {
  const tarde = [
    "12:50",
    "13:30",
    "14:30",
    "15:10",
    "15:30",
    "16:40",
    "17:50",
  ].map((h) => cupo(h));

  it("«para las 3:30» (sin franja) → los tres más cercanos a las 15:30, en orden", () => {
    expect(
      horas(
        cuposMasCercanosALaHora(
          tarde,
          { hour24: 3, minute: 30, meridiemKnown: false },
          3,
        ),
      ),
    ).toEqual(["14:30", "15:10", "15:30"]);
  });

  it("«a las 4 de la tarde» → alrededor de las 16:00", () => {
    expect(
      horas(
        cuposMasCercanosALaHora(
          tarde,
          { hour24: 16, minute: null, meridiemKnown: true },
          3,
        ),
      ),
    ).toEqual(["15:10", "15:30", "16:40"]);
  });

  it("a igual distancia, el día más próximo", () => {
    const jueves = cupo("16:00");
    const viernes = {
      ...cupo("16:00"),
      fecha: new Date(jueves.fecha.getTime() + 86_400_000),
    };
    expect(
      cuposMasCercanosALaHora(
        [viernes, jueves],
        { hour24: 16, minute: 0, meridiemKnown: true },
        1,
      ),
    ).toEqual([jueves]);
  });
});

describe("letraEnLaFrase — la letra dentro de una frase", () => {
  it.each([
    ["Perdón es B", "B"],
    ["Laletra B", "B"],
    ["la letra c", "C"],
    ["opción A", "A"],
    ["mejor la C", "C"],
    ["ok, la b", "B"],
    ["elijo la D", "D"],
    ["me quedo con la a", "A"],
  ])("«%s» → %s", (frase, letra) => {
    expect(letraEnLaFrase(frase)).toBe(letra);
  });

  it.each([
    "A las 3",
    "no la B",
    "Muchas gracias",
    "la de las 10",
    "B salud total",
    "",
    null,
  ])("«%s» no elige letra", (frase) => {
    expect(letraEnLaFrase(frase)).toBe("");
  });
});

describe("cuposDelMedicoNombrado", () => {
  const cupos = [
    cupo("09:00", "Dr(a). SANTIAGO CARDENAS GUEVARA"),
    cupo("09:00", "Dr(a). LADY JOHANA VELASQUEZ MARIN"),
    cupo("09:00", "MEDICO DISPONIBLE HSVP 02"),
  ];

  it.each([
    "Miercoles 28 alas 9am con el doctor Santiago",
    "A las dos y cuarenta con el doctor Cárdenas",
    "con el dr cardenas",
  ])("«%s» → solo los de Santiago Cárdenas", (frase) => {
    expect(cuposDelMedicoNombrado(frase, cupos)).toEqual([cupos[0]]);
  });

  it("sin nombrar a nadie → vacío", () => {
    expect(cuposDelMedicoNombrado("a las 9 por favor", cupos)).toEqual([]);
  });

  it("«médico» o «disponible» no distinguen a nadie", () => {
    expect(cuposDelMedicoNombrado("con el médico disponible", cupos)).toEqual(
      [],
    );
  });
});
