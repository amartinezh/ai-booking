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
const updateEnvioResumenAction = jest.fn(async (...args: unknown[]): Promise<unknown> => { void args; return { success: true }; });
const updateContenidoResumenAction = jest.fn(async (...args: unknown[]): Promise<unknown> => {
    void args;
    return { success: true };
});
const enviarDePruebaAction = jest.fn(async (...args: unknown[]): Promise<unknown> => { void args; return { success: true }; });
const aprobarPilotoResumenAction = jest.fn(async (...args: unknown[]): Promise<unknown> => { void args; return { success: true }; });
const revisarResumenAction = jest.fn(async (...args: unknown[]): Promise<unknown> => { void args; return { success: true }; });
jest.mock('@/app/actions/resumen-atencion', () => ({
    updateLecturaResumenAction: (...a: unknown[]) => updateLecturaResumenAction(...a),
    abrirResumenAction: (...a: unknown[]) => abrirResumenAction(...a),
    revisarResumenAction: (...a: unknown[]) => revisarResumenAction(...a),
    listarDocumentosAction: (...a: unknown[]) => listarDocumentosAction(...a),
    crearEnlaceDePruebaAction: (...a: unknown[]) => crearEnlaceDePruebaAction(...a),
    updateDocumentosResumenAction: (...a: unknown[]) => updateDocumentosResumenAction(...a),
    updateEnvioResumenAction: (...a: unknown[]) => updateEnvioResumenAction(...a),
    updateContenidoResumenAction: (...a: unknown[]) => updateContenidoResumenAction(...a),
    enviarDePruebaAction: (...a: unknown[]) => enviarDePruebaAction(...a),
    aprobarPilotoResumenAction: (...a: unknown[]) => aprobarPilotoResumenAction(...a),
}));

/** «Cómo va el envío» en ceros, con lo que se cambie. */
const medicion = (c: Record<string, unknown> = {}) => ({
    atenciones: { leidas: 0, avisadas: 0, excluidas: 0, porBaja: 0, sinContacto: 0, sinEnviar: 0 },
    avisos: { total: 0, reenvios: 0, whatsapp: 0, telegram: 0, correo: 0 },
    avisosQueNoSalieron: 0,
    whatsapp: { entregados: 0, leidos: 0, fallidos: 0, sinConfirmar: 0 },
    pidieron: 0,
    verificados: 0,
    recibieron: 0,
    archivos: { enviados: 0, entregados: 0, leidos: 0 },
    abrieronLaPagina: 0,
    bajas: 0,
    porDia: [],
    bajasVigentes: 0,
    ...c,
});

import { EXCLUSIONES_POR_DEFECTO, configResumenAtencionApagada, leerConfigDocumentos } from '@agenia/shared';
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
    exclusiones: EXCLUSIONES_POR_DEFECTO,
    nombreClinica: 'Hospital de prueba',
    envio: { plantillaConfigurada: false, correoConfigurado: false, correosDeRelleno: ['pacienteshospital@gmail.com'], sinCorreo: 0, piloto: medicion(), entregas: [], porEstado: {} },
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
        updateEnvioResumenAction.mockClear();
        enviarDePruebaAction.mockClear();
        refresh.mockClear();
    });

    it('recién desplegado se ve apagado y no envía nada', () => {
        render(<ResumenAtencionClient panel={panel()} />);
        expect(screen.getByTestId('estado-lectura')).toHaveTextContent('Apagado');
        expect(screen.getByLabelText('Leer del hospital')).not.toBeChecked();
        expect(screen.getByTestId('estado-envio')).toHaveTextContent('Envío apagado');
        expect(screen.getByLabelText('Enviar a pacientes')).not.toBeChecked();
        expect(screen.getByText(/solo reciben los números del equipo; ningún paciente/)).toBeInTheDocument();
        expect(screen.getByTestId('falta-plantilla')).toBeInTheDocument();
    });

    it('los tres canales solo en los servicios que se leen; avisa si el servidor no tiene correo', () => {
        render(<ResumenAtencionClient panel={panel()} />);
        expect(screen.getByLabelText('Canal Correo')).toBeEnabled();
        expect(screen.getByLabelText('Canal Telegram')).toBeEnabled();
        for (const servicio of ['S39141', 'S39145']) expect(screen.getByLabelText(`Correo ${servicio}`)).toBeDisabled();
        expect(screen.getByTestId('falta-correo')).toBeInTheDocument();
        expect(screen.getByLabelText('WhatsApp S39141')).toBeDisabled();
        expect(screen.getByLabelText('Telegram S39141')).toBeDisabled();
        fireEvent.click(screen.getByLabelText('Leer S39141'));
        expect(screen.getByLabelText('WhatsApp S39141')).toBeEnabled();
        expect(screen.getByLabelText('Telegram S39141')).toBeEnabled();
        expect(screen.getByLabelText('Telegram S39145')).toBeDisabled();
        expect(screen.getByLabelText('Correo S39141')).toBeEnabled();
    });

    it('enciende el envío en modo prueba: primero la lectura, luego el envío con los números del equipo', async () => {
        render(<ResumenAtencionClient panel={panel()} />);
        fireEvent.click(screen.getByLabelText('Leer del hospital'));
        fireEvent.click(screen.getByLabelText('Leer S39141'));
        fireEvent.click(screen.getByLabelText('Enviar a pacientes'));
        fireEvent.click(screen.getByLabelText('Canal WhatsApp'));
        fireEvent.click(screen.getByLabelText('WhatsApp S39141'));
        fireEvent.click(screen.getByLabelText('Canal Telegram'));
        fireEvent.click(screen.getByLabelText('Telegram S39141'));
        fireEvent.click(screen.getByLabelText('Canal Correo'));
        fireEvent.click(screen.getByLabelText('Correo S39141'));
        fireEvent.change(screen.getByLabelText('Números del modo prueba'), { target: { value: '3001234567\ntg:555' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        await waitFor(() =>
            expect(updateEnvioResumenAction).toHaveBeenCalledWith({
                enviar: true,
                whatsapp: true,
                telegram: true,
                serviciosWhatsapp: ['S39141'],
                serviciosTelegram: ['S39141'],
                correo: true,
                serviciosCorreo: ['S39141'],
                correosDeRelleno: ['pacienteshospital@gmail.com'],
                destinosPrueba: ['3001234567', 'tg:555'],
            }),
        );
        expect(updateLecturaResumenAction.mock.invocationCallOrder[0]).toBeLessThan(updateEnvioResumenAction.mock.invocationCallOrder[0]);
    });

    it('si el envío no se puede encender (sin números del equipo), lo dice', async () => {
        updateEnvioResumenAction.mockResolvedValueOnce({ success: false, error: 'Mientras no se apruebe el piloto, «Enviar» solo funciona en modo prueba: agregue al menos un número del equipo.' });
        render(<ResumenAtencionClient panel={panel()} />);
        fireEvent.click(screen.getByLabelText('Enviar a pacientes'));
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(await screen.findByText(/agregue al menos un número del equipo/)).toBeInTheDocument();
        expect(updateLecturaResumenAction).not.toHaveBeenCalled();
    });

    it('enviando en modo prueba lo dice, y el seguimiento muestra los envíos sin números completos', () => {
        render(
            <ResumenAtencionClient
                panel={panel({
                    config: { ...configResumenAtencionApagada(), enviar: true, modoPrueba: { destinos: ['573001234567'] } },
                    envio: {
                        plantillaConfigurada: true,
                        correoConfigurado: true,
                        correosDeRelleno: [],
                        sinCorreo: 7,
                        piloto: medicion({
                            atenciones: { leidas: 50, avisadas: 37, excluidas: 3, porBaja: 1, sinContacto: 2, sinEnviar: 8 },
                            avisos: { total: 37, reenvios: 1, whatsapp: 30, telegram: 5, correo: 2 },
                            whatsapp: { entregados: 27, leidos: 20, fallidos: 2, sinConfirmar: 1 },
                            pidieron: 24,
                            verificados: 22,
                            recibieron: 21,
                            archivos: { enviados: 90, entregados: 88, leidos: 60 },
                            abrieronLaPagina: 4,
                            bajas: 1,
                            bajasVigentes: 3,
                        }),
                        porEstado: { ENVIADO: 3, EXCLUIDO: 1 },
                        entregas: [
                            { id: 'e1', historia: '2441058', canal: 'WHATSAPP', prueba: true, destino: '•••4567', estado: 'DOCUMENTOS_ENVIADOS', motivo: null, avisoIso: '2026-11-01T15:00:00.000Z', documentosIso: '2026-11-01T15:02:00.000Z', verificadoPor: 'FECHA_NACIMIENTO' },
                            { id: 'e2', historia: '2441059', canal: 'TELEGRAM', prueba: false, destino: '•••9999', estado: 'FALLO', motivo: 'La plantilla «Documentos de la consulta» no está configurada', avisoIso: null, documentosIso: null, verificadoPor: null },
                        ],
                    },
                })}
            />,
        );
        expect(screen.getByTestId('estado-envio')).toHaveTextContent('Enviando en modo prueba a •••4567');
        expect(screen.queryByTestId('falta-plantilla')).not.toBeInTheDocument();
        const seguimiento = screen.getByTestId('seguimiento-envios');
        expect(seguimiento).toHaveTextContent('Avisados 3 · Excluidos (tema sensible o baja) 1');
        expect(seguimiento).toHaveTextContent('✓ Documentos entregados');
        expect(seguimiento).toHaveTextContent('fecha de nacimiento');
        expect(seguimiento).toHaveTextContent('⚠ No salió');
        expect(seguimiento).toHaveTextContent('Telegram');
        expect(seguimiento).toHaveTextContent('7 atención(es) sin correo utilizable');
        const piloto = screen.getByTestId('medicion-piloto');
        expect(piloto).toHaveTextContent('Consultas leídas del hospital50');
        expect(piloto).toHaveTextContent('Avisos enviados37');
        expect(piloto).toHaveTextContent('Avisos de WhatsApp entregados27 de 30 (90 %)');
        expect(piloto).toHaveTextContent('Leídos 20 de 30 (67 %)');
        expect(piloto).toHaveTextContent('Pidieron sus documentos24 de 35 (69 %)');
        expect(piloto).toHaveTextContent('Recibieron sus documentos21');
        expect(piloto).toHaveTextContent('88 entregados · 60 vistos');
        expect(seguimiento).not.toHaveTextContent('573001234567');
    });

    it('el piloto: aprobarlo exige escribir la frase; aprobado y sin números del equipo, dice que envía a los pacientes', async () => {
        const { rerender } = render(<ResumenAtencionClient panel={panel()} />);
        const piloto = screen.getByTestId('piloto');
        expect(piloto).toHaveTextContent('Sin aprobar');
        const aprobar = screen.getByRole('button', { name: 'Aprobar el piloto' });
        expect(aprobar).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Frase para aprobar el piloto'), { target: { value: 'enviar a pacientes' } });
        expect(aprobar).toBeEnabled();
        fireEvent.click(aprobar);
        await waitFor(() => expect(aprobarPilotoResumenAction).toHaveBeenCalledWith(true, 'enviar a pacientes'));

        const aprobado = { aprobado: true, desdeIso: '2026-11-11T15:00:00.000Z' };
        rerender(<ResumenAtencionClient panel={panel({ config: { ...configResumenAtencionApagada(), enviar: true, piloto: aprobado } })} />);
        expect(screen.getByTestId('estado-envio')).toHaveTextContent('Enviando a los pacientes');
        expect(screen.getByTestId('piloto')).toHaveTextContent('✓ Aprobado');
        fireEvent.click(screen.getByRole('button', { name: 'Volver a solo modo prueba' }));
        await waitFor(() => expect(aprobarPilotoResumenAction).toHaveBeenCalledWith(false, undefined));

        // Aprobado pero con números del equipo: sigue en modo prueba y lo dice.
        rerender(
            <ResumenAtencionClient
                panel={panel({ config: { ...configResumenAtencionApagada(), enviar: true, piloto: aprobado, modoPrueba: { destinos: ['573001234567'] } } })}
            />,
        );
        expect(screen.getByTestId('estado-envio')).toHaveTextContent('Enviando en modo prueba a •••4567');
        expect(screen.getByTestId('piloto')).toHaveTextContent('Sigue en modo prueba');
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
                frecuenciaDelHis: false,
            }),
        );
        expect(await screen.findByText(/Guardado. Los documentos/)).toBeInTheDocument();
    });

    it('al abrir un resumen se puede enviar de prueba a un número del equipo', async () => {
        abrirResumenAction.mockResolvedValueOnce({
            success: true,
            abierto: { resumen: resumenDePrueba, hisKey: '2441058', version: 1, attendedAt: '2026-11-01T14:00:00.000Z' },
        });
        render(
            <ResumenAtencionClient
                panel={panel({
                    config: { ...configResumenAtencionApagada(), modoPrueba: { destinos: ['573001234567'] } },
                    revision: { meta: 20, correctos: 0, conError: 0, recientes: [fila()] },
                })}
            />,
        );
        fireEvent.click(screen.getByLabelText('Abrir historia 2441058'));
        const boton = await screen.findByRole('button', { name: 'Enviar de prueba' });
        expect(screen.getByLabelText('Número de prueba')).toHaveTextContent('•••4567');
        fireEvent.click(boton);
        await waitFor(() => expect(enviarDePruebaAction).toHaveBeenCalledWith(ID, '573001234567'));
        expect(await screen.findByText(/Aviso enviado a •••4567/)).toBeInTheDocument();
    });

    it('contenido y horario: muestra los campos del sistema y guarda exclusiones, horario y campos propios', async () => {
        render(<ResumenAtencionClient panel={panel()} />);
        const seccion = screen.getByTestId('contenido-resumen');
        expect(seccion).toHaveTextContent('Proximo control*');
        fireEvent.change(screen.getByLabelText('Diagnósticos excluidos'), { target: { value: 'F, B24\nZ044' } });
        fireEvent.change(screen.getByLabelText('Desde la hora'), { target: { value: '8' } });
        fireEvent.click(screen.getByLabelText('Campos personalizados'));
        fireEvent.click(screen.getByLabelText('Quitar el campo 1'));
        fireEvent.click(screen.getByRole('button', { name: 'Guardar contenido y horario' }));
        await waitFor(() => expect(updateContenidoResumenAction).toHaveBeenCalled());
        const cambio = updateContenidoResumenAction.mock.calls[0][0] as {
            exclusiones: { cie10: string[] };
            horario: { desdeHora: number };
            camposPlantilla: { campo: string }[];
        };
        expect(cambio.exclusiones.cie10).toEqual(['F', 'B24', 'Z044']);
        expect(cambio.horario.desdeHora).toBe(8);
        expect(cambio.camposPlantilla[0].campo).not.toBe('MC:');
    });
});
