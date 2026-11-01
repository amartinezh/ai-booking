import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const refresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const updateLecturaResumenAction = jest.fn(async (...args: unknown[]) => { void args; return { success: true }; });
const abrirResumenAction = jest.fn(async (...args: unknown[]): Promise<unknown> => { void args; return { success: false, error: 'sin preparar' }; });
const listarDocumentosAction = jest.fn(async (...args: unknown[]): Promise<unknown> => {
    void args;
    return {
        success: true,
        documentos: [
            { id: 'resumen', titulo: 'Resumen de la atención', hojas: 1, nombreArchivo: 'Resumen_01-11-2026' },
            { id: 'formula-77', titulo: 'Fórmula médica N.º 77', hojas: 2, nombreArchivo: 'Formula_01-11-2026_N77' },
        ],
    };
});
const crearEnlaceDePruebaAction = jest.fn(async (...args: unknown[]): Promise<unknown> => {
    void args;
    return { success: true, url: 'http://localhost/resumen/AAAAAAAAAAAAAAAAAAAAAA', expiraIso: '2026-12-01T14:00:00.000Z' };
});
const updateDocumentosResumenAction = jest.fn(async (...args: unknown[]): Promise<unknown> => { void args; return { success: true }; });
const revisarResumenAction = jest.fn(async (...args: unknown[]): Promise<unknown> => { void args; return { success: true }; });
jest.mock('@/app/actions/resumen-atencion', () => ({
    updateLecturaResumenAction: (...a: unknown[]) => updateLecturaResumenAction(...a),
    abrirResumenAction: (...a: unknown[]) => abrirResumenAction(...a),
    revisarResumenAction: (...a: unknown[]) => revisarResumenAction(...a),
    listarDocumentosAction: (...a: unknown[]) => listarDocumentosAction(...a),
    crearEnlaceDePruebaAction: (...a: unknown[]) => crearEnlaceDePruebaAction(...a),
    updateDocumentosResumenAction: (...a: unknown[]) => updateDocumentosResumenAction(...a),
}));

import { configResumenAtencionApagada, leerConfigDocumentos } from '@agenia/shared';
import ResumenAtencionClient from './ResumenAtencionClient';
import type { FilaResumenParaRevisar, PanelResumenAtencion } from '@/app/actions/resumen-atencion';

// La pantalla de los interruptores (plan §3.11). Lo que se fija: nace apagada,
// solo se puede encender la LECTURA, y «Enviar» y los canales no se pueden tocar
// mientras el envío no exista.

const panel = (cambios: Partial<PanelResumenAtencion> = {}): PanelResumenAtencion => ({
    config: configResumenAtencionApagada(),
    servicios: [
        { codigo: 'S39141', nombre: 'CONSULTA MEDICINA GENERAL', seLee: false },
        { codigo: 'S39145', nombre: 'CONSULTA URGENCIAS', seLee: false },
    ],
    lectura: { cursor: null, recibidos24h: 0, recibidos30d: 0, ultimoRecibidoIso: null, porServicio: [] },
    medicion: null,
    revision: { meta: 20, correctos: 0, conError: 0, recientes: [] },
    documentos: leerConfigDocumentos(null),
    nombreClinica: 'Hospital de prueba',
    ...cambios,
});

const ID = '6f9619ff-8b86-d011-b42d-00cf4fc964ff';
const fila = (cambios: Partial<FilaResumenParaRevisar> = {}): FilaResumenParaRevisar => ({
    id: ID,
    historia: '2441058',
    servicio: 'S39141',
    atendidaIso: '2026-11-01T14:00:00.000Z',
    version: 1,
    conPaciente: true,
    contenidoDisponible: true,
    revision: null,
    ...cambios,
});

const resumenDePrueba = {
    version: 1,
    historia: {
        numero: '2441058',
        guardadaIso: '2026-11-01T14:00:00.000Z',
        servicio: 'S39141',
        nombreServicio: 'CONSULTA MEDICINA GENERAL',
        plantilla: 870,
        codigoPlantilla: null,
        nombrePlantilla: 'CONSULTA EXTERNA',
        especialidad: null,
        edad: 46,
    },
    paciente: {
        documento: '900000001',
        tipoDocumento: 'CC',
        nombre: 'ADULTO PRUEBA',
        fechaNacimientoIso: '1980-05-17',
        celular: null,
        correo: null,
        celularAcompanante: null,
        correoAcompanante: null,
    },
    medico: { codigo: null, nombre: 'MEDICO DE PRUEBA', documento: null, registro: null },
    afiliacion: { convenio: null, administradora: null, tipoUsuario: null },
    diagnosticos: [{ cie10: 'I10X', descripcion: 'HIPERTENSION ESENCIAL', tipo: null, principal: true }],
    ordenes: [
        {
            numero: '77',
            tipo: 'MEDICAMENTOS',
            farmacia: 'AI',
            escritaIso: null,
            desdeIso: null,
            serie: null,
            vigencia: 'Vigente por 72 Horas',
            medicamentos: [
                {
                    codigo: 'M1',
                    nombre: 'LOSARTAN 50 MG TABLETA',
                    cum: null,
                    invima: null,
                    medida: null,
                    concentracion: '50 MG',
                    forma: 'TABLETA',
                    via: 'ORAL',
                    cantidad: 30,
                    duracionDias: 30,
                    indicacion: 'UNA TABLETA CADA DIA',
                    frecuencia: null,
                    entregado: false,
                },
            ],
            examenes: [],
        },
    ],
    remisiones: [],
    incapacidades: [],
    interconsultas: [],
    indicaciones: [],
    campos: [{ seccion: 'Plan', grupo: null, campo: 'PLAN:', valor: 'CONTROL EN 3 MESES' }],
};

describe('ResumenAtencionClient', () => {
    beforeEach(() => {
        updateLecturaResumenAction.mockClear();
        abrirResumenAction.mockClear();
        revisarResumenAction.mockClear();
        refresh.mockClear();
    });

    it('recién desplegado se ve apagado y no envía nada', () => {
        render(<ResumenAtencionClient panel={panel()} />);
        expect(screen.getByTestId('estado-lectura')).toHaveTextContent('Apagado');
        expect(screen.getByLabelText('Leer del hospital')).not.toBeChecked();
        expect(screen.getByText(/No se le envía nada a ningún paciente/)).toBeInTheDocument();
    });

    it('«Enviar a pacientes» y todos los canales están apagados y no se pueden tocar', () => {
        render(<ResumenAtencionClient panel={panel()} />);
        const enviar = screen.getByLabelText('Enviar a pacientes');
        expect(enviar).toBeDisabled();
        expect(enviar).not.toBeChecked();
        for (const canal of ['WhatsApp', 'Telegram', 'Correo']) {
            for (const servicio of ['S39141', 'S39145']) {
                const c = screen.getByLabelText(`${canal} ${servicio}`);
                expect(c).toBeDisabled();
                expect(c).not.toBeChecked();
            }
        }
    });

    it('guarda la lectura con los servicios marcados y la calma', async () => {
        render(<ResumenAtencionClient panel={panel()} />);
        const guardar = screen.getByRole('button', { name: 'Guardar' });
        expect(guardar).toBeDisabled();

        fireEvent.click(screen.getByLabelText('Leer del hospital'));
        fireEvent.click(screen.getByLabelText('Leer S39141'));
        fireEvent.change(screen.getByLabelText('Calma en minutos'), { target: { value: '150' } });
        fireEvent.click(guardar);

        await waitFor(() =>
            expect(updateLecturaResumenAction).toHaveBeenCalledWith({
                leerDelHospital: true,
                serviciosALeer: ['S39141'],
                calmaMinutos: 150,
            }),
        );
        expect(await screen.findByText(/Guardado/)).toBeInTheDocument();
    });

    it('si la acción rechaza el cambio, lo dice', async () => {
        updateLecturaResumenAction.mockResolvedValueOnce({ success: false, error: 'La calma va de 30 a 1440 minutos.' } as never);
        render(<ResumenAtencionClient panel={panel()} />);
        fireEvent.change(screen.getByLabelText('Calma en minutos'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(await screen.findByText('La calma va de 30 a 1440 minutos.')).toBeInTheDocument();
    });

    it('leyendo, lo dice y muestra cuánto ha llegado (sin contenido)', () => {
        render(
            <ResumenAtencionClient
                panel={panel({
                    config: { ...configResumenAtencionApagada(), leerDelHospital: true, servicios: { S39141: { WHATSAPP: false, TELEGRAM: false, EMAIL: false } } },
                    servicios: [{ codigo: 'S39141', nombre: 'CONSULTA MEDICINA GENERAL', seLee: true }],
                    lectura: { cursor: '2441058', recibidos24h: 96, recibidos30d: 2800, ultimoRecibidoIso: '2026-11-01T14:00:00.000Z', porServicio: [{ servicio: 'S39141', cantidad: 2800 }] },
                })}
            />,
        );
        expect(screen.getByTestId('estado-lectura')).toHaveTextContent('Leyendo del hospital');
        expect(screen.getByText(/96 resumen\(es\) en las últimas 24 horas/)).toBeInTheDocument();
        expect(screen.getByText(/Leído hasta la historia 2441058/)).toBeInTheDocument();
    });

    it('muestra cuánto tardan las consultas al hospital, o que todavía no hay mediciones', () => {
        const { rerender } = render(<ResumenAtencionClient panel={panel()} />);
        expect(screen.getByTestId('medicion')).toHaveTextContent('Todavía no hay mediciones');
        rerender(
            <ResumenAtencionClient
                panel={panel({
                    medicion: {
                        vueltas: 12,
                        historias: 30,
                        detectar: { medianaMs: 180, maxMs: 2400 },
                        leer: { medianaMs: 900, maxMs: 4100, medianaPorHistoriaMs: 310 },
                        ultimaIso: '2026-11-01T14:00:00.000Z',
                    },
                })}
            />,
        );
        const m = screen.getByTestId('medicion');
        expect(m).toHaveTextContent('12 vuelta(s), 30 historia(s) leída(s)');
        expect(m).toHaveTextContent('180 ms de mediana, máximo 2,4 s');
        expect(m).toHaveTextContent('310 ms por historia, máximo 4,1 s en una vuelta');
    });

    it('revisión: muestra el avance y la lista sin contenido; lo borrado no se puede abrir', () => {
        render(
            <ResumenAtencionClient
                panel={panel({
                    revision: {
                        meta: 20,
                        correctos: 3,
                        conError: 1,
                        recientes: [fila(), fila({ id: 'otro', historia: '2441001', contenidoDisponible: false })],
                    },
                })}
            />,
        );
        expect(screen.getByTestId('progreso-revision')).toHaveTextContent('4 de 20 revisados · 3 correcto(s) · 1 con error');
        expect(screen.getByLabelText('Abrir historia 2441058')).toBeInTheDocument();
        expect(screen.queryByLabelText('Abrir historia 2441001')).not.toBeInTheDocument();
        expect(screen.getByText('Borrado (30 días)')).toBeInTheDocument();
        expect(screen.queryByTestId('detalle-resumen')).not.toBeInTheDocument();
    });

    it('abre un resumen, lo muestra y guarda la revisión', async () => {
        abrirResumenAction.mockResolvedValueOnce({
            success: true,
            abierto: { resumen: resumenDePrueba, hisKey: '2441058', version: 1, attendedAt: '2026-11-01T14:00:00.000Z' },
        });
        render(<ResumenAtencionClient panel={panel({ revision: { meta: 20, correctos: 0, conError: 0, recientes: [fila()] } })} />);

        fireEvent.click(screen.getByLabelText('Abrir historia 2441058'));
        const detalle = await screen.findByTestId('detalle-resumen');
        expect(abrirResumenAction).toHaveBeenCalledWith(ID);
        expect(detalle).toHaveTextContent('LOSARTAN 50 MG TABLETA');
        expect(detalle).toHaveTextContent('UNA TABLETA CADA DIA');
        expect(detalle).toHaveTextContent('CONTROL EN 3 MESES');
        // La fecha de nacimiento sin hora no se corre un día.
        expect(detalle).toHaveTextContent('17/05/1980');

        const guardar = screen.getByRole('button', { name: 'Guardar revisión' });
        expect(guardar).toBeDisabled();
        fireEvent.click(screen.getByLabelText('Con error'));
        fireEvent.change(screen.getByLabelText('Nota de la revisión'), { target: { value: 'Falta la loratadina' } });
        fireEvent.click(guardar);

        await waitFor(() =>
            expect(revisarResumenAction).toHaveBeenCalledWith(ID, { resultado: 'CON_ERROR', nota: 'Falta la loratadina' }),
        );
        expect(await screen.findByText('Revisión guardada: historia 2441058.')).toBeInTheDocument();
        expect(refresh).toHaveBeenCalled();
    });

    it('si no se puede abrir (por ejemplo, ya se borró), lo dice', async () => {
        abrirResumenAction.mockResolvedValueOnce({ success: false, error: 'El contenido de este resumen ya se borró (se guarda 30 días).' });
        render(<ResumenAtencionClient panel={panel({ revision: { meta: 20, correctos: 0, conError: 0, recientes: [fila()] } })} />);
        fireEvent.click(screen.getByLabelText('Abrir historia 2441058'));
        expect(await screen.findByText('El contenido de este resumen ya se borró (se guarda 30 días).')).toBeInTheDocument();
    });

    it('al abrir un resumen muestra sus documentos en PDF e imagen y genera el enlace de prueba', async () => {
        abrirResumenAction.mockResolvedValueOnce({
            success: true,
            abierto: { resumen: resumenDePrueba, hisKey: '2441058', version: 1, attendedAt: '2026-11-01T14:00:00.000Z' },
        });
        render(<ResumenAtencionClient panel={panel({ revision: { meta: 20, correctos: 0, conError: 0, recientes: [fila()] } })} />);
        fireEvent.click(screen.getByLabelText('Abrir historia 2441058'));

        const pdf = await screen.findByLabelText('PDF de Fórmula médica N.º 77');
        expect(listarDocumentosAction).toHaveBeenCalledWith(ID);
        expect(pdf).toHaveAttribute('href', `/dashboard/espejo/resumen-atencion/documento?id=${ID}&doc=formula-77&formato=pdf&hoja=1`);
        expect(screen.getByLabelText('Imagen de la hoja 2 de Fórmula médica N.º 77')).toHaveAttribute(
            'href',
            `/dashboard/espejo/resumen-atencion/documento?id=${ID}&doc=formula-77&formato=png&hoja=2`,
        );
        expect(screen.getByText('Todos en un solo PDF')).toHaveAttribute('href', expect.stringContaining('doc=todo'));

        fireEvent.click(screen.getByRole('button', { name: 'Generar enlace de prueba' }));
        expect(await screen.findByTestId('enlace-prueba')).toHaveTextContent('http://localhost/resumen/AAAAAAAAAAAAAAAAAAAAAA');
        expect(crearEnlaceDePruebaAction).toHaveBeenCalledWith(ID);
    });

    it('guarda el encabezado de los documentos; la marca de agua no se puede quitar', async () => {
        render(<ResumenAtencionClient panel={panel()} />);
        expect(screen.getByTestId('encabezado-documentos')).toHaveTextContent('Marca de agua: «Copia para el paciente»');
        fireEvent.change(screen.getByLabelText('Nombre del hospital'), { target: { value: 'E.S.E. HOSPITAL' } });
        fireEvent.change(screen.getByLabelText('NIT'), { target: { value: '890.000.000-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar encabezado' }));
        await waitFor(() =>
            expect(updateDocumentosResumenAction).toHaveBeenCalledWith({
                nombre: 'E.S.E. HOSPITAL',
                nit: '890.000.000-1',
                direccion: '',
                telefono: '',
                pie: '',
                logo: '',
            }),
        );
        expect(await screen.findByText(/Guardado. Los documentos/)).toBeInTheDocument();
    });
});
