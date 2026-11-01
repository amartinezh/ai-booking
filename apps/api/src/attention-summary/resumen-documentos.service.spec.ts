import { GoneException, NotFoundException } from '@nestjs/common';
import { ResumenDocumentosService } from './resumen-documentos.service';

// Vista previa del personal: descifra solo lo de SU clínica, deja constancia de
// qué documento abrió quién (sin contenido) y no revive lo que ya se borró.

jest.setTimeout(30_000);

const resumen = {
  version: 1,
  historia: {
    numero: '2441058',
    guardadaIso: '2026-11-01T14:07:31.000Z',
    servicio: 'S39141',
    nombreServicio: null,
    plantilla: null,
    codigoPlantilla: null,
    nombrePlantilla: null,
    especialidad: null,
    edad: 63,
  },
  paciente: {
    documento: '900000001',
    tipoDocumento: 'CC',
    nombre: 'ADULTO PRUEBA',
    fechaNacimientoIso: '1963-05-17',
    celular: null,
    correo: null,
    celularAcompanante: null,
    correoAcompanante: null,
  },
  medico: { codigo: null, nombre: null, documento: null, registro: null },
  afiliacion: { convenio: null, administradora: null, tipoUsuario: null },
  diagnosticos: [],
  ordenes: [],
  remisiones: [],
  incapacidades: [],
  interconsultas: [],
  indicaciones: ['CONTROL'],
  campos: [],
};

function armar(content: string | null = JSON.stringify(resumen)) {
  const prisma: any = {
    attentionSummary: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 's-1' && where.organizationId === 'org-1'
          ? { hisKey: '2441058', version: 1, content }
          : null,
      ),
    },
    organization: {
      findUnique: jest.fn(async () => ({
        name: 'Hospital AgenIA',
        timezone: null,
      })),
    },
    hospitalMirrorConfig: { findUnique: jest.fn(async () => null) },
  };
  const bitacora: any = { event: jest.fn(async () => undefined) };
  return {
    s: new ResumenDocumentosService(
      prisma,
      { decrypt: (x: string) => x } as any,
      bitacora,
    ),
    bitacora,
  };
}

const QUIEN = { userId: 'u-1', email: 'admin@hospital.co' };

describe('ResumenDocumentosService', () => {
  it('lista los documentos y entrega el archivo, con constancia sin contenido', async () => {
    const { s, bitacora } = armar();
    await expect(s.listarParaPersonal('org-1', 's-1')).resolves.toEqual({
      documentos: [
        {
          id: 'resumen',
          titulo: 'Resumen de la atención',
          hojas: 1,
          nombreArchivo: 'Resumen_01-11-2026',
        },
      ],
    });
    const a = await s.archivoParaPersonal(
      'org-1',
      's-1',
      { documento: 'resumen', formato: 'png', hoja: 1 },
      QUIEN,
    );
    expect(a.tipo).toBe('image/png');
    expect(bitacora.event).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ATTENTION_SUMMARY_DOCUMENT_VIEWED',
        userId: 'u-1',
        organizationId: 'org-1',
        metadata: {
          summaryId: 's-1',
          hisKey: '2441058',
          documento: 'resumen',
          formato: 'png',
        },
      }),
    );
    expect(JSON.stringify(bitacora.event.mock.calls)).not.toMatch(
      /ADULTO|1963/,
    );
  });

  it('un documento que no existe: 404 y sin constancia', async () => {
    const { s, bitacora } = armar();
    await expect(
      s.archivoParaPersonal(
        'org-1',
        's-1',
        { documento: 'formula-1', formato: 'pdf', hoja: 1 },
        QUIEN,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(bitacora.event).not.toHaveBeenCalled();
  });

  it('otra clínica: no existe; contenido borrado: se borró', async () => {
    await expect(
      armar().s.listarParaPersonal('otra', 's-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      armar(null).s.listarParaPersonal('org-1', 's-1'),
    ).rejects.toBeInstanceOf(GoneException);
  });
});
