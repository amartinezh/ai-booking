/** @jest-environment node */
jest.mock("../../lib/prisma", () => {
  // Dentro de la fábrica: jest.mock se sube por encima de cualquier const del archivo.
  const vacio = () => ({ findMany: jest.fn().mockResolvedValue([]) });
  return {
    prisma: {
      systemLog: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        groupBy: jest.fn(),
      },
      user: { findMany: jest.fn(), findUnique: jest.fn(), groupBy: jest.fn() },
      organization: { findMany: jest.fn() },
      patientLookupLog: vacio(),
      syncExceptionLog: vacio(),
      syncAudit: vacio(),
      padronImport: vacio(),
      massNoticeBatch: vacio(),
      appointmentLimitRequest: vacio(),
      interactionLog: vacio(),
      supportTicket: vacio(),
      supportTicketNote: vacio(),
      mirrorPatientOptOut: vacio(),
      globalAuditLog: vacio(),
      $queryRaw: jest.fn().mockResolvedValue([]),
    },
  };
});
jest.mock("../../lib/session", () => ({ getSession: jest.fn() }));

import { prisma } from "../../lib/prisma";
import { getSession } from "../../lib/session";
import { cargarActividad, resumenDeIngresos } from "./actividad";

const mockSession = getSession as jest.Mock;
const ORG = "3f1c2b9a-1111-4a2b-9c3d-123456789abc";

describe("cargarActividad", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.systemLog.findMany as jest.Mock).mockResolvedValue([
      {
        id: "l1",
        level: "EVENT",
        action: "USER_LOGIN",
        message: "Ingreso de usuario (ORG_ADMIN)",
        userId: "u1",
        organizationId: ORG,
        createdAt: new Date("2026-10-26T15:00:00.000Z"),
        metadata: { role: "ORG_ADMIN" }, // un ingreso viejo: sin correo ni IP
      },
    ]);
    (prisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: "u1", email: "admin@clinica.co", role: "ORG_ADMIN" },
    ]);
    (prisma.organization.findMany as jest.Mock).mockResolvedValue([
      { id: ORG, name: "Hospital San Vicente" },
    ]);
  });

  it.each([null, { role: "ORG_ADMIN" }, { role: "BOOKING_AGENT" }])(
    "solo el super administrador (%p no)",
    async (s) => {
      mockSession.mockResolvedValue(s);
      const r = await cargarActividad({});
      expect(r.success).toBe(false);
      expect(prisma.systemLog.findMany).not.toHaveBeenCalled();
    },
  );

  it("trae la línea de tiempo con el correo del actor y el nombre de la clínica", async () => {
    mockSession.mockResolvedValue({ role: "SUPER_ADMIN", userId: "sa" });
    const r = await cargarActividad({});
    expect(r.success).toBe(true);
    expect(r.fuentesConError).toEqual([]);
    expect(r.eventos).toHaveLength(1);
    expect(r.eventos[0]).toMatchObject({
      titulo: "Ingresó al panel",
      organizationName: "Hospital San Vicente",
      actor: { userId: "u1", email: "admin@clinica.co", role: "ORG_ADMIN" },
    });
    expect(r.siguiente).toBeNull();
    // Todas las fuentes se consultaron.
    expect(prisma.patientLookupLog.findMany).toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("si una fuente falla, sale lo demás y se dice cuál falló", async () => {
    mockSession.mockResolvedValue({ role: "SUPER_ADMIN", userId: "sa" });
    (prisma.$queryRaw as jest.Mock).mockRejectedValueOnce(
      new Error("sql roto"),
    );
    jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await cargarActividad({});
    expect(r.success).toBe(true);
    expect(r.eventos).toHaveLength(1);
    expect(r.fuentesConError).toEqual(["anulacion"]);
  });
});

describe("resumenDeIngresos", () => {
  beforeEach(() => jest.clearAllMocks());

  it("solo el super administrador", async () => {
    mockSession.mockResolvedValue({ role: "ORG_ADMIN" });
    expect(await resumenDeIngresos({})).toBeNull();
  });

  it("por clínica: cada persona con su último ingreso y sus fallidos", async () => {
    mockSession.mockResolvedValue({ role: "SUPER_ADMIN" });
    (prisma.systemLog.findFirst as jest.Mock).mockResolvedValue({
      createdAt: new Date("2026-09-01T00:00:00Z"),
    });
    (prisma.systemLog.count as jest.Mock)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(3);
    (prisma.systemLog.groupBy as jest.Mock)
      .mockResolvedValueOnce([{ userId: "u1" }]) // quiénes ingresaron
      .mockResolvedValueOnce([
        { userId: "u1", _max: { createdAt: new Date("2026-10-26T15:00:00Z") } },
      ])
      .mockResolvedValueOnce([
        { userId: "u1", action: "USER_LOGIN", _count: { _all: 12 } },
        { userId: "u2", action: "LOGIN_FAILED", _count: { _all: 2 } },
        { userId: "u2", action: "LOGIN_BLOCKED", _count: { _all: 1 } },
      ]);
    (prisma.user.findMany as jest.Mock).mockResolvedValue([
      {
        id: "u1",
        email: "a@c.co",
        role: "ORG_ADMIN",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
      {
        id: "u2",
        email: "b@c.co",
        role: "DOCTOR",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
    ]);

    const r = await resumenDeIngresos({ org: ORG });
    expect(r).toMatchObject({
      ingresos30: 12,
      fallidos30: 3,
      usuariosQueIngresaron30: 1,
      clinicas: [],
    });
    expect(r?.usuarios).toEqual([
      expect.objectContaining({
        id: "u1",
        ultimoIngreso: "2026-10-26T15:00:00.000Z",
        ingresos30: 12,
        fallidos30: 0,
      }),
      expect.objectContaining({
        id: "u2",
        ultimoIngreso: null,
        ingresos30: 0,
        fallidos30: 3,
      }),
    ]);
    // Solo el personal de esa clínica, nunca los pacientes.
    expect((prisma.user.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      role: {
        in: ["ORG_ADMIN", "BOOKING_AGENT", "DOCTOR", "GENERAL_OBSERVER"],
      },
    });
  });
});
