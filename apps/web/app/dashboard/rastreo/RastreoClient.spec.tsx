import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    clasificarRastreoA,
    clasificarRastreoB,
    construirLineaDeVida,
    type CitaRastreo,
    type EvidenciaRastreoA,
    type SaludEspejo,
} from '@agenia/shared';
import type { CitaExpediente, ExpedienteA, ExpedienteB, HisEnVivoVista } from '@/lib/rastreo/tipos';

jest.mock('@/app/actions/rastreo', () => ({
    buscarPacientesAction: jest.fn(),
    abrirExpedienteAction: jest.fn(),
    opcionesCupoHisAction: jest.fn(),
    investigarCupoHisAction: jest.fn(),
    revelarIdentidadAction: jest.fn(),
    iniciarConsultaHisAction: jest.fn(),
    progresoConsultaHisAction: jest.fn(),
}));
jest.mock('@/app/actions/espejo', () => ({ reprocesarEvento: jest.fn() }));

import {
    abrirExpedienteAction,
    buscarPacientesAction,
    iniciarConsultaHisAction,
    investigarCupoHisAction,
    opcionesCupoHisAction,
    progresoConsultaHisAction,
    revelarIdentidadAction,
} from '@/app/actions/rastreo';
import { reprocesarEvento } from '@/app/actions/espejo';
import RastreoClient from './RastreoClient';

const mBuscar = buscarPacientesAction as jest.Mock;
const mAbrir = abrirExpedienteAction as jest.Mock;
const mOpciones = opcionesCupoHisAction as jest.Mock;
const mInvestigar = investigarCupoHisAction as jest.Mock;
const mRevelar = revelarIdentidadAction as jest.Mock;
const mReprocesar = reprocesarEvento as jest.Mock;
const mIniciarHis = iniciarConsultaHisAction as jest.Mock;
const mProgresoHis = progresoConsultaHisAction as jest.Mock;

// ── Fixtures armados con el clasificador REAL, no a mano ─────────────────────

const AHORA = '2026-09-21T15:00:00.000Z';
const MIN = 60_000;
const hace = (ms: number) => new Date(Date.parse(AHORA) - ms).toISOString();
const dentroDe = (ms: number) => new Date(Date.parse(AHORA) + ms).toISOString();

const espejoSano: SaludEspejo = {
    enabled: true,
    pushEnabled: true,
    pullEnabled: true,
    lastHeartbeatIso: hace(1 * MIN),
    hisReachable: true,
    hisDetail: null,
};

/** Lo que ve un rol con la consulta en vivo disponible y todavía sin consultar. */
const hisEnVivoListo: HisEnVivoVista = {
    visible: true,
    disponibilidad: { puede: true, razon: null },
    consulta: null,
    aviso: null,
};

const citaDeadLetter: CitaRastreo = {
    id: 'apt-1',
    status: 'SCHEDULED',
    attendance: 'PENDING',
    origin: 'WHATSAPP',
    createdAtIso: hace(30 * MIN),
    startIso: dentroDe(2 * 86_400_000),
    doctor: 'Dr(a). Ana Ruiz',
    service: 'Medicina General',
    eps: 'Sura',
    cancelacion: null,
    sync: {
        estado: 'DEAD_LETTER',
        attempts: 10,
        lastError: 'violación de PK: cupo ya vendido',
        creadoIso: hace(30 * MIN),
        oldestPendingIso: hace(30 * MIN),
        nextAttemptIso: null,
        deliveredAtIso: null,
        seq: '42',
    },
    confirmacion: { status: 'DELIVERED', enviadoIso: hace(29 * MIN), estadoIso: hace(28 * MIN), errorDetalle: null },
    confirmadaEnConversacion: true,
    coincideConCaptura: null,
};

function expediente(
    over: Partial<ExpedienteA> = {},
    opciones: { internos?: boolean; cita?: Partial<CitaRastreo> } = {},
): ExpedienteA {
    const evidencia: EvidenciaRastreoA = {
        ahoraIso: AHORA,
        zonaHoraria: 'America/Bogota',
        pacienteEncontrado: true,
        citas: [{ ...citaDeadLetter, ...opciones.cita }],
        citasOcultas: 0,
        espera: [],
        conversacion: { mensajes: 3, primerMensajeIso: hace(60 * MIN), ultimoMensajeIso: hace(30 * MIN), fallos: [], ultimoResultado: 'CONFIRMADA' },
        espejo: espejoSano,
        capturaIndicada: false,
    };
    const internos = opciones.internos ?? true;
    const citas: CitaExpediente[] = evidencia.citas.map((c) => ({
        ...c,
        lineaDeVida: construirLineaDeVida(c, { espejo: evidencia.espejo }),
        eventosSync: internos
            ? [{ seq: '42', op: 'INSERT', creadoIso: hace(30 * MIN), entregadoIso: null, intentos: 10, rendido: true, ultimoError: 'violación de PK: cupo ya vendido' }]
            : null,
        recordatorioIso: null,
    }));
    return {
        modo: 'A',
        generadoIso: AHORA,
        zonaHoraria: 'America/Bogota',
        conEspejo: true,
        sujeto: { tipo: 'PACIENTE', id: 'pac-1' },
        identidad: {
            pacienteId: 'pac-1',
            nombre: 'María López Núñez',
            documento: '•••3456',
            whatsapp: '•••2233',
            bsuid: null,
            eps: 'Sura',
            regimen: 'CONTRIBUTIVO',
            creadoIso: hace(30 * 86_400_000),
        },
        remitente: null,
        resultado: clasificarRastreoA(evidencia),
        citas,
        espera: [],
        historial: { encuestas: [], avisosMasivos: [] },
        conversacion: {
            nivel: 'TEXTO',
            resumen: evidencia.conversacion,
            mensajes: [{ atIso: hace(30 * MIN), estado: 'SUCCESS', motivoFallo: null, paciente: 'quiero una cita', bot: 'con gusto' }],
        },
        espejo: espejoSano,
        verInternos: internos,
        capturaIndicada: false,
        hisEnVivo: hisEnVivoListo,
        ...over,
    };
}

const candidato = {
    tipo: 'PACIENTE' as const,
    id: 'pac-1',
    nombre: 'María L••• N•••',
    documento: '•••3456',
    contacto: '•••2233',
    eps: 'Sura',
    citas: 2,
    coincidePor: 'CEDULA' as const,
};

const propsBase = {
    esSuperAdmin: false,
    conEspejo: true,
    puedeModoB: true,
    hrefConsultas: null,
};

beforeEach(() => {
    jest.clearAllMocks();
    mBuscar.mockResolvedValue({ success: true, data: { candidatos: [candidato], hayMas: false, interpretadoComo: 'DOCUMENTO_O_TELEFONO' } });
    mAbrir.mockResolvedValue({ success: true, data: expediente() });
    mOpciones.mockResolvedValue({ success: true, data: { medicos: [{ clave: '76', etiqueta: 'MEDICO HTA', homologado: true }, { clave: '999', etiqueta: 'MEDICO AJENO', homologado: false }] } });
    mRevelar.mockResolvedValue({ success: true, data: { documento: '1088123456', whatsapp: '573001112233', bsuid: null } });
    mReprocesar.mockResolvedValue({ success: true });
});

/** Llena el formulario de búsqueda y lo envía. */
async function buscar(user: ReturnType<typeof userEvent.setup>, consulta = '1088123456', motivo: string | null = 'PACIENTE_EN_VENTANILLA') {
    await user.type(screen.getByLabelText(/Cédula, teléfono, BSUID o nombre/), consulta);
    if (motivo) await user.selectOptions(screen.getByLabelText(/Motivo de la consulta/), motivo);
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
}

// ═══════════════════════════════════════════════════════════════════════════

describe('RastreoClient — el formulario', () => {
    it('sin espejo solo existe la opción A: una pestaña que no hace nada enseña a ignorar el menú', () => {
        render(<RastreoClient {...propsBase} conEspejo={false} />);
        expect(screen.getByRole('tab', { name: 'Dice que agendó' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Lo agendaron en el HIS' })).not.toBeInTheDocument();
    });

    it('con espejo aparecen las dos opciones, separadas', () => {
        render(<RastreoClient {...propsBase} />);
        expect(screen.getByRole('tab', { name: 'Dice que agendó' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Lo agendaron en el HIS' })).toHaveAttribute('aria-selected', 'false');
    });

    it('un rol sin escenario B (DOCTOR) no ve la pestaña aunque haya espejo', () => {
        render(<RastreoClient {...propsBase} puedeModoB={false} />);
        expect(screen.queryByRole('tab', { name: 'Lo agendaron en el HIS' })).not.toBeInTheDocument();
    });

    it('el enlace a la bitácora solo aparece si el rol la puede ver', () => {
        const { rerender } = render(<RastreoClient {...propsBase} />);
        expect(screen.queryByRole('link', { name: /consultas registradas/ })).not.toBeInTheDocument();
        rerender(<RastreoClient {...propsBase} hrefConsultas="/dashboard/rastreo/consultas" />);
        expect(screen.getByRole('link', { name: /consultas registradas/ })).toHaveAttribute('href', '/dashboard/rastreo/consultas');
    });

    it('🔒 sin motivo NO se busca: el motivo es obligatorio', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);

        await buscar(user, '1088123456', null);

        expect(screen.getByRole('alert')).toHaveTextContent('Elige el motivo de la consulta.');
        expect(mBuscar).not.toHaveBeenCalled();
    });

    it('"Otro" exige explicar el motivo en la nota', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);

        await buscar(user, '1088123456', 'OTRO');
        expect(screen.getByRole('alert')).toHaveTextContent('Explica el motivo');
        expect(mBuscar).not.toHaveBeenCalled();

        await user.type(screen.getByLabelText(/Nota/), 'Llamada de la EPS');
        await user.click(screen.getByRole('button', { name: 'Buscar' }));
        expect(mBuscar).toHaveBeenCalledTimes(1);
    });

    it('sin nada escrito no se busca', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await user.selectOptions(screen.getByLabelText(/Motivo de la consulta/), 'RECLAMO_PQRS');
        await user.click(screen.getByRole('button', { name: 'Buscar' }));
        expect(screen.getByRole('alert')).toHaveTextContent(/Escribe una cédula/);
        expect(mBuscar).not.toHaveBeenCalled();
    });

    it('un usuario de clínica manda organizationId=null: el tenant sale del token, no de la pantalla', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await buscar(user);
        expect(mBuscar).toHaveBeenCalledWith({ organizationId: null, consulta: '1088123456', motivo: 'PACIENTE_EN_VENTANILLA', nota: '' });
    });
});

describe('RastreoClient — resultados de la búsqueda', () => {
    it('muestra candidatos ENMASCARADOS y nunca datos completos', async () => {
        const user = userEvent.setup();
        const { container } = render(<RastreoClient {...propsBase} />);
        await buscar(user);

        expect(await screen.findByText('María L••• N•••')).toBeInTheDocument();
        expect(screen.getByText(/Doc\. •••3456/)).toBeInTheDocument();
        expect(screen.getByText('por cédula')).toBeInTheDocument();
        expect(container.textContent).not.toContain('1088123456');
    });

    it('sin resultados: no afirma que el paciente no existe', async () => {
        mBuscar.mockResolvedValue({ success: true, data: { candidatos: [], hayMas: false, interpretadoComo: 'NOMBRE' } });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await buscar(user, 'zoraida quintero');

        expect(await screen.findByText('No se encontró a nadie')).toBeInTheDocument();
        expect(screen.getByText(/no prueba que el paciente no exista/)).toBeInTheDocument();
    });

    it('avisa cuando hay más resultados de los que caben', async () => {
        mBuscar.mockResolvedValue({ success: true, data: { candidatos: [candidato], hayMas: true, interpretadoComo: 'NOMBRE' } });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await buscar(user);
        expect(await screen.findByText(/hay más, afina la búsqueda/)).toBeInTheDocument();
    });

    it('un remitente sin perfil se presenta como "Número sin perfil"', async () => {
        mBuscar.mockResolvedValue({ success: true, data: { candidatos: [{ ...candidato, tipo: 'REMITENTE', id: '573155550000', nombre: '', documento: null, eps: null, citas: 0, coincidePor: 'TELEFONO' }], hayMas: false, interpretadoComo: 'DOCUMENTO_O_TELEFONO' } });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await buscar(user, '3155550000');
        expect(await screen.findByText('Número sin perfil')).toBeInTheDocument();
        expect(screen.getByText(/solo aparece en las conversaciones/)).toBeInTheDocument();
    });

    it('un error del servidor se muestra y no rompe la pantalla', async () => {
        mBuscar.mockResolvedValue({ success: false, error: 'Hiciste demasiadas búsquedas seguidas.' });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await buscar(user);
        expect(await screen.findByRole('alert')).toHaveTextContent('demasiadas búsquedas');
        expect(screen.getByRole('button', { name: 'Buscar' })).toBeEnabled();
    });
});

describe('RastreoClient — el expediente', () => {
    async function abrirExpediente(user: ReturnType<typeof userEvent.setup>) {
        await buscar(user);
        await user.click(await screen.findByRole('button', { name: 'Abrir expediente' }));
        await screen.findByText(/Consulta registrada/);
    }

    it('abre con el mismo motivo y la captura que se escribió', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await user.click(screen.getByText(/Datos de la captura/));
        await user.type(screen.getByLabelText('Médico o servicio'), 'ruiz');
        await abrirExpediente(user);

        expect(mAbrir).toHaveBeenCalledWith({
            organizationId: null,
            sujeto: { tipo: 'PACIENTE', id: 'pac-1' },
            motivo: 'PACIENTE_EN_VENTANILLA',
            nota: '',
            captura: { fecha: '', hora: '', medico: 'ruiz' },
        });
    });

    it('muestra el veredicto, lo que consta y qué hacer', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);

        const veredicto = screen.getAllByRole('region', { name: /Veredicto: Confirmada en AgenIA/ })[0];
        expect(veredicto).toHaveAttribute('data-codigo', 'CONFIRMADA_NO_LLEGO');
        expect(veredicto).toHaveAttribute('data-severidad', 'bad');
        expect(within(veredicto).getByText(/violación de PK: cupo ya vendido/)).toBeInTheDocument();
        expect(within(veredicto).getByText(/Qué hacer:/)).toBeInTheDocument();
        expect(within(veredicto).getByText('Lo que consta')).toBeInTheDocument();
    });

    it('🔎 y LO QUE NO SE PUEDE AFIRMAR: nunca se omite cuando hay algo que no se sabe', async () => {
        // Sin registro de la confirmación en el libro de mensajes: es una carencia real.
        mAbrir.mockResolvedValue({ success: true, data: expediente({}, { cita: { confirmacion: null } }) });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);

        const veredicto = screen.getAllByRole('region', { name: /Veredicto: Confirmada en AgenIA/ })[0];
        expect(within(veredicto).getByText('Lo que este resultado no puede afirmar')).toBeInTheDocument();
        expect(within(veredicto).getByText(/No hay registro de la confirmación por WhatsApp/)).toBeInTheDocument();
    });

    it('cuando no hay nada que declarar, no muestra una sección vacía', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);
        const veredicto = screen.getAllByRole('region', { name: /Veredicto: Confirmada en AgenIA/ })[0];
        expect(within(veredicto).queryByText('Lo que este resultado no puede afirmar')).not.toBeInTheDocument();
    });

    it('la línea de vida muestra el paso que falló y que el HIS queda sin verificar', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);

        const lista = screen.getByRole('list', { name: 'Línea de vida de la cita' });
        expect(lista.querySelector('[data-paso="entregado_al_agente"]')).toHaveAttribute('data-estado', 'fail');
        expect(lista.querySelector('[data-paso="presente_en_el_his"]')).toHaveAttribute('data-estado', 'unknown');
        expect(within(lista).getByText(/Sin verificar: requiere la consulta en vivo/)).toBeInTheDocument();
    });

    it('identidad enmascarada; "Mostrar datos completos" pide los datos con el mismo motivo y los muestra', async () => {
        const user = userEvent.setup();
        const { container } = render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);
        expect(container.textContent).not.toContain('1088123456');

        await user.click(screen.getByRole('button', { name: 'Mostrar datos completos' }));

        expect(mRevelar).toHaveBeenCalledWith({ organizationId: null, pacienteId: 'pac-1', motivo: 'PACIENTE_EN_VENTANILLA', nota: '' });
        expect(await screen.findByText('1088123456')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Mostrar datos completos' })).not.toBeInTheDocument();
    });

    it('si revelar falla (p. ej. no se pudo registrar), NO se muestra nada y se avisa', async () => {
        mRevelar.mockResolvedValue({ success: false, error: 'No se pudo registrar la consulta y, por seguridad, no se muestran datos.' });
        const user = userEvent.setup();
        const { container } = render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);

        await user.click(screen.getByRole('button', { name: 'Mostrar datos completos' }));

        expect(await screen.findByRole('status')).toHaveTextContent('por seguridad, no se muestran datos');
        expect(container.textContent).not.toContain('1088123456');
    });

    it('ORG_ADMIN ve los eventos con su seq y puede reprocesar el que se rindió', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);

        const tabla = screen.getByRole('table', { name: /Eventos de envío al HIS/ });
        expect(within(tabla).getByText('42')).toBeInTheDocument();
        expect(within(tabla).getByText('Se rindió')).toBeInTheDocument();

        await user.click(within(tabla).getByRole('button', { name: 'Reintentar' }));

        expect(mReprocesar).toHaveBeenCalledWith('42');
        expect(await screen.findByRole('status')).toHaveTextContent('Evento 42 devuelto a la cola');
    });

    it('quien no ve los internos (BOOKING_AGENT) no tiene tabla de eventos ni botón de reprocesar', async () => {
        mAbrir.mockResolvedValue({ success: true, data: expediente({}, { internos: false }) });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);

        expect(screen.queryByRole('table', { name: /Eventos de envío al HIS/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    });

    it('el texto de la conversación se ve solo con nivel TEXTO', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);
        expect(screen.getByText('quiero una cita')).toBeInTheDocument();
        unmount();

        // SUPER_ADMIN: solo los hechos.
        mAbrir.mockResolvedValue({ success: true, data: expediente({ conversacion: { nivel: 'RESUMEN', resumen: expediente().conversacion.resumen, mensajes: null } }) });
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(userEvent.setup());
        expect(screen.getByText(/tu perfil no muestra el texto/)).toBeInTheDocument();
        expect(screen.queryByText('quiero una cita')).not.toBeInTheDocument();
    });

    it('un DOCTOR (sin conversación) no tiene sección de conversación ni aviso del espejo', async () => {
        mAbrir.mockResolvedValue({ success: true, data: expediente({ conversacion: { nivel: 'NINGUNA', resumen: null, mensajes: null }, espejo: null }, { internos: false }) });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} puedeModoB={false} />);
        await abrirExpediente(user);

        expect(screen.queryByText('Conversación con el bot')).not.toBeInTheDocument();
        expect(screen.queryByText(/Estado del espejo/)).not.toBeInTheDocument();
    });

    it('las notas del resultado (citas fuera de alcance, captura) se muestran arriba', async () => {
        const base = expediente();
        mAbrir.mockResolvedValue({ success: true, data: { ...base, resultado: { ...base.resultado, notas: ['Hay 1 cita(s) de este paciente fuera de tu alcance (EPS o médico asignados) que no se muestran.'] } } });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);
        expect(screen.getByText(/fuera de tu alcance/)).toBeInTheDocument();
    });

    it('el aviso del espejo dice cuando el agente lleva rato sin latir', async () => {
        const base = expediente();
        mAbrir.mockResolvedValue({ success: true, data: { ...base, espejo: { ...espejoSano, lastHeartbeatIso: hace(90 * MIN) } } });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);
        expect(screen.getByText(/no da señales desde hace 90 min/)).toBeInTheDocument();
    });

    it('"Volver a los resultados" regresa a la lista sin buscar de nuevo', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);
        await user.click(screen.getByRole('button', { name: /Volver a los resultados/ }));

        expect(await screen.findByRole('button', { name: 'Abrir expediente' })).toBeInTheDocument();
        expect(mBuscar).toHaveBeenCalledTimes(1);
    });

    it('el historial lista todas las citas con su asistencia y origen', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);
        const tabla = screen.getByRole('table', { name: 'Citas del paciente' });
        expect(within(tabla).getByText('Programada')).toBeInTheDocument();
        expect(within(tabla).getByText('Sin desenlace')).toBeInTheDocument();
        expect(within(tabla).getByText('WhatsApp')).toBeInTheDocument();
    });
});

describe('RastreoClient — escenario B', () => {
    async function irAB(user: ReturnType<typeof userEvent.setup>) {
        await user.click(screen.getByRole('tab', { name: 'Lo agendaron en el HIS' }));
    }

    it('al abrir la pestaña carga los médicos del HIS (y marca los no homologados)', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await irAB(user);

        await waitFor(() => expect(mOpciones).toHaveBeenCalledWith({ organizationId: null }));
        expect(await screen.findByRole('option', { name: 'MEDICO HTA' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'MEDICO AJENO (no homologado)' })).toBeInTheDocument();
    });

    it('valida antes de llamar al servidor: cédula, médico, fecha y hora', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await irAB(user);
        await screen.findByRole('option', { name: 'MEDICO HTA' });
        await user.selectOptions(screen.getByLabelText(/Motivo de la consulta/), 'SOPORTE_TECNICO');

        await user.click(screen.getByRole('button', { name: 'Investigar' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Escribe la cédula');

        await user.type(screen.getByLabelText('Cédula del paciente'), '1088123456');
        await user.click(screen.getByRole('button', { name: 'Investigar' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Elige el médico del HIS');

        await user.selectOptions(screen.getByLabelText('Médico del HIS'), '76');
        await user.click(screen.getByRole('button', { name: 'Investigar' }));
        expect(screen.getByRole('alert')).toHaveTextContent('fecha y la hora');
        expect(mInvestigar).not.toHaveBeenCalled();
    });

    it('investiga con todos los datos y muestra el resultado rotulado como PARCIAL', async () => {
        const b: ExpedienteB = {
            modo: 'B',
            generadoIso: AHORA,
            zonaHoraria: 'America/Bogota',
            resultado: clasificarRastreoB({
                ahoraIso: AHORA,
                cupoDescripcion: 'Cupo del HIS: MEDICO HTA, lun 5 oct, 10:00 a m',
                paciente: { perfilEncontrado: true, coincidencia: 'EXACTA', perfilesConVariante: 0, conWhatsapp: true },
                cupoEnAgenIA: {
                    medicoHomologado: true,
                    cupoExiste: true,
                    citaDelPacienteEnAgenIA: false,
                    auditorias: [{ resultado: 'OK', op: 'INSERT', nota: 'cita del HIS con paciente sin homologar: solo se ocupó el cupo, no se creó Appointment', atIso: hace(3 * 60 * MIN) }],
                },
                espejo: espejoSano,
            }),
            cupo: { medico: 'MEDICO HTA', inicioIso: '2026-10-05T15:00:00.000Z', homologado: true },
            identidad: { encontrada: true, pacienteId: 'pac-1', nombre: 'María L•••', documento: '•••3456', coincidencia: 'EXACTA', perfilesConVariante: 0, conWhatsapp: true },
            auditorias: [{ resultado: 'OK', op: 'INSERT', nota: 'cita del HIS con paciente sin homologar: solo se ocupó el cupo, no se creó Appointment', atIso: hace(3 * 60 * MIN) }],
            espejo: espejoSano,
            hisEnVivo: hisEnVivoListo,
        };
        mInvestigar.mockResolvedValue({ success: true, data: b });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await irAB(user);
        await screen.findByRole('option', { name: 'MEDICO HTA' });

        await user.type(screen.getByLabelText('Cédula del paciente'), '1088123456');
        await user.selectOptions(screen.getByLabelText('Médico del HIS'), '76');
        await user.type(screen.getByLabelText('Fecha de la cita en el HIS'), '2026-10-05');
        await user.type(screen.getByLabelText('Hora de la cita en el HIS'), '10:00');
        await user.selectOptions(screen.getByLabelText(/Motivo de la consulta/), 'RECLAMO_PQRS');
        await user.click(screen.getByRole('button', { name: 'Investigar' }));

        expect(mInvestigar).toHaveBeenCalledWith({
            organizationId: null,
            documento: '1088123456',
            medicoClave: '76',
            fecha: '2026-10-05',
            hora: '10:00',
            motivo: 'RECLAMO_PQRS',
            nota: '',
        });
        expect(await screen.findByText(/Parcial: sin consulta en vivo al HIS/)).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /Veredicto: El hospital agendó ese cupo/ })).toHaveAttribute('data-codigo', 'CITA_DEL_HIS_NO_ESPEJADA');
        expect(screen.getByText(/A nombre de quién está la cita en el HIS/)).toBeInTheDocument();
        expect(screen.getByText('Eventos del HIS para ese cupo')).toBeInTheDocument();
    });
});

describe('RastreoClient — SUPER_ADMIN', () => {
    const organizaciones = [
        { id: 'org-a', name: 'Clínica A', conEspejo: true },
        { id: 'org-b', name: 'Clínica B', conEspejo: false },
    ];
    const propsSuper = { ...propsBase, esSuperAdmin: true, conEspejo: false, organizaciones };

    it('🏢 no se puede buscar sin elegir una organización (no hay búsqueda global)', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsSuper} />);

        await buscar(user);

        expect(screen.getByRole('alert')).toHaveTextContent('Elige la organización');
        expect(mBuscar).not.toHaveBeenCalled();
    });

    it('la organización elegida viaja al servidor (que la valida contra la base)', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsSuper} />);
        await user.selectOptions(screen.getByLabelText('Organización a consultar'), 'org-a');

        await buscar(user);

        expect(mBuscar).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-a' }));
    });

    it('el escenario B depende de si la organización ELEGIDA tiene espejo', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsSuper} />);
        expect(screen.queryByRole('tab', { name: 'Lo agendaron en el HIS' })).not.toBeInTheDocument();

        await user.selectOptions(screen.getByLabelText('Organización a consultar'), 'org-a');
        expect(screen.getByRole('tab', { name: 'Lo agendaron en el HIS' })).toBeInTheDocument();

        await user.selectOptions(screen.getByLabelText('Organización a consultar'), 'org-b');
        expect(screen.queryByRole('tab', { name: 'Lo agendaron en el HIS' })).not.toBeInTheDocument();
    });

    it('cambiar de organización descarta lo que se había cargado (nada de mezclar clínicas)', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsSuper} />);
        await user.selectOptions(screen.getByLabelText('Organización a consultar'), 'org-a');
        await buscar(user);
        await screen.findByRole('button', { name: 'Abrir expediente' });

        await user.selectOptions(screen.getByLabelText('Organización a consultar'), 'org-b');

        expect(screen.queryByRole('button', { name: 'Abrir expediente' })).not.toBeInTheDocument();
    });

    it('las opciones de médico se piden para la organización elegida', async () => {
        const user = userEvent.setup();
        render(<RastreoClient {...propsSuper} />);
        await user.selectOptions(screen.getByLabelText('Organización a consultar'), 'org-a');
        await user.click(screen.getByRole('tab', { name: 'Lo agendaron en el HIS' }));
        await waitFor(() => expect(mOpciones).toHaveBeenCalledWith({ organizationId: 'org-a' }));
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Consulta en vivo al HIS (Fase 2): la pantalla pide con el motivo que ya tiene,
// sondea y REABRE el expediente con los ids, para que los veredictos los calcule
// el servidor con lo que respondió el hospital.
// ═══════════════════════════════════════════════════════════════════════════

describe('RastreoClient — consulta en vivo al HIS', () => {
    const consultaHecha: HisEnVivoVista = {
        ...hisEnVivoListo,
        consulta: {
            consultadoIso: AHORA,
            porDocumento: {
                desdeIso: hace(7 * 86_400_000),
                hastaIso: dentroDe(60 * 86_400_000),
                citas: [{ startIso: dentroDe(3 * 86_400_000), medico: 'Dr(a). Ana Ruiz', estado: 'SCHEDULED' }],
                truncado: false,
            },
            cuposConsultados: 1,
        },
    };
    const TIEMPO_PRUEBA = 15_000;
    const ESPERA_SONDEO = { timeout: 6_000 };

    beforeEach(() => {
        mIniciarHis.mockResolvedValue({ success: true, data: { ids: ['r1', 'r2'], esperaMs: 30_000 } });
        mProgresoHis.mockResolvedValue({ success: true, data: { estado: 'LISTA', detalle: null } });
    });

    async function abrirExpediente(user: ReturnType<typeof userEvent.setup>) {
        await buscar(user);
        await user.click(await screen.findByRole('button', { name: 'Abrir expediente' }));
        await screen.findByText(/Consulta registrada/);
    }

    it('escenario A: pide con el motivo escrito, sondea y reabre el expediente con los ids', async () => {
        mAbrir.mockResolvedValueOnce({ success: true, data: expediente() }).mockResolvedValueOnce({
            success: true,
            data: expediente({ hisEnVivo: consultaHecha }),
        });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        expect(await screen.findByRole('heading', { name: 'Citas de este paciente en el HIS' }, ESPERA_SONDEO)).toBeInTheDocument();
        // La consulta lleva el motivo y el paciente; la clínica sale del token (null), no de la pantalla.
        expect(mIniciarHis).toHaveBeenCalledWith({
            organizationId: null,
            modo: 'A',
            pacienteId: 'pac-1',
            motivo: 'PACIENTE_EN_VENTANILLA',
            nota: '',
        });
        expect(mProgresoHis).toHaveBeenCalledWith({ organizationId: null, ids: ['r1', 'r2'] });
        // El expediente se REABRE con los ids (los veredictos los calcula el servidor).
        expect(mAbrir).toHaveBeenCalledTimes(2);
        expect(mAbrir).toHaveBeenLastCalledWith({
            organizationId: null,
            sujeto: { tipo: 'PACIENTE', id: 'pac-1' },
            motivo: 'PACIENTE_EN_VENTANILLA',
            nota: '',
            captura: { fecha: '', hora: '', medico: '' },
            consultaHisIds: ['r1', 'r2'],
        });
        expect(screen.getByRole('button', { name: 'Volver a consultar al HIS' })).toBeEnabled();
    }, TIEMPO_PRUEBA);

    it('escenario A: si el servidor la rechaza (agente caído, límite…) se ve el motivo y NO se reabre nada', async () => {
        mIniciarHis.mockResolvedValue({ success: false, error: 'El agente del hospital no da señales desde hace 9 min.' });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        expect(await screen.findByText(/no da señales desde hace 9 min/)).toBeInTheDocument();
        expect(mProgresoHis).not.toHaveBeenCalled();
        expect(mAbrir).toHaveBeenCalledTimes(1);
    });

    it('escenario A: el botón queda apagado con la razón cuando el servidor dice que no se puede', async () => {
        mAbrir.mockResolvedValue({
            success: true,
            data: expediente({
                hisEnVivo: { ...hisEnVivoListo, disponibilidad: { puede: false, razon: 'La consulta en vivo al HIS no está habilitada para esta clínica.' } },
            }),
        });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);

        expect(screen.getByRole('button', { name: 'Consultar el HIS ahora' })).toBeDisabled();
        expect(screen.getByText(/no está habilitada para esta clínica/)).toBeInTheDocument();
    });

    it('🔒 un rol sin la consulta (DOCTOR) o una clínica sin espejo NO ven el panel', async () => {
        mAbrir.mockResolvedValue({
            success: true,
            data: expediente({ hisEnVivo: { visible: false, disponibilidad: { puede: false, razon: null }, consulta: null, aviso: null } }),
        });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await abrirExpediente(user);

        expect(screen.queryByText('Consulta en vivo al HIS')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Consultar el HIS/ })).not.toBeInTheDocument();
    });

    it('un remitente sin perfil (sin documento con el cual preguntar) no ve el panel aunque el rol lo tenga', async () => {
        mBuscar.mockResolvedValue({
            success: true,
            data: {
                candidatos: [{ ...candidato, tipo: 'REMITENTE', id: '573009998877', nombre: '', documento: null, eps: null, citas: 0 }],
                hayMas: false,
                interpretadoComo: 'DOCUMENTO_O_TELEFONO',
            },
        });
        mAbrir.mockResolvedValue({ success: true, data: expediente({ identidad: null, remitente: '•••8877', sujeto: { tipo: 'REMITENTE', whatsappId: '573009998877' } }) });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await buscar(user);
        await user.click(await screen.findByRole('button', { name: 'Abrir expediente' }));
        await screen.findByText(/Consulta registrada/);

        expect(screen.queryByRole('button', { name: /Consultar el HIS/ })).not.toBeInTheDocument();
    });

    it('escenario B: pide con lo escrito en el formulario, y el rótulo "Parcial" pasa a "con consulta en vivo"', async () => {
        const b = (hisEnVivo: HisEnVivoVista): ExpedienteB => ({
            modo: 'B',
            generadoIso: AHORA,
            zonaHoraria: 'America/Bogota',
            resultado: clasificarRastreoB({
                ahoraIso: AHORA,
                cupoDescripcion: 'Cupo del HIS: MEDICO HTA, lun 5 oct, 10:00 a m',
                paciente: { perfilEncontrado: true, coincidencia: 'EXACTA', perfilesConVariante: 0, conWhatsapp: true },
                cupoEnAgenIA: { medicoHomologado: true, cupoExiste: true, citaDelPacienteEnAgenIA: false, auditorias: [] },
                espejo: espejoSano,
            }),
            cupo: { medico: 'MEDICO HTA', inicioIso: '2026-10-05T15:00:00.000Z', homologado: true },
            identidad: { encontrada: true, pacienteId: 'pac-1', nombre: 'María L•••', documento: '•••3456', coincidencia: 'EXACTA', perfilesConVariante: 0, conWhatsapp: true },
            auditorias: [],
            espejo: espejoSano,
            hisEnVivo,
        });
        mInvestigar.mockResolvedValueOnce({ success: true, data: b(hisEnVivoListo) }).mockResolvedValueOnce({
            success: true,
            data: b({ ...hisEnVivoListo, consulta: { ...consultaHecha.consulta!, porDocumento: null } }),
        });
        const user = userEvent.setup();
        render(<RastreoClient {...propsBase} />);
        await user.click(screen.getByRole('tab', { name: 'Lo agendaron en el HIS' }));
        await screen.findByRole('option', { name: 'MEDICO HTA' });
        await user.type(screen.getByLabelText('Cédula del paciente'), '1088123456');
        await user.selectOptions(screen.getByLabelText('Médico del HIS'), '76');
        await user.type(screen.getByLabelText('Fecha de la cita en el HIS'), '2026-10-05');
        await user.type(screen.getByLabelText('Hora de la cita en el HIS'), '10:00');
        await user.selectOptions(screen.getByLabelText(/Motivo de la consulta/), 'RECLAMO_PQRS');
        await user.click(screen.getByRole('button', { name: 'Investigar' }));
        expect(await screen.findByText(/Parcial: sin consulta en vivo al HIS/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        expect(await screen.findByText(/Con consulta en vivo al HIS, hecha a las/, undefined, ESPERA_SONDEO)).toBeInTheDocument();
        expect(screen.queryByText(/Parcial: sin consulta en vivo/)).not.toBeInTheDocument();
        expect(mIniciarHis).toHaveBeenCalledWith({
            organizationId: null,
            modo: 'B',
            documento: '1088123456',
            medicoClave: '76',
            fecha: '2026-10-05',
            hora: '10:00',
            motivo: 'RECLAMO_PQRS',
            nota: '',
        });
        expect(mInvestigar).toHaveBeenLastCalledWith(expect.objectContaining({ documento: '1088123456', medicoClave: '76', consultaHisIds: ['r1', 'r2'] }));
    }, TIEMPO_PRUEBA);
});
