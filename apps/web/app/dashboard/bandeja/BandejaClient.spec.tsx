import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BandejaClient from './BandejaClient';
import type { EstadoAvisos, ExcepcionDetalle, ExcepcionVista, ListaExcepciones, MedicoFiltro } from '@/lib/bandeja/tipos';

const refresh = jest.fn();
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }));
jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const aplicar = jest.fn();
const detalle = jest.fn();
const guardar = jest.fn();
jest.mock('@/app/actions/bandeja', () => ({
    aplicarAccionExcepcionAction: (...a: unknown[]) => aplicar(...a),
    detalleExcepcionAction: (...a: unknown[]) => detalle(...a),
    guardarAvisosAction: (...a: unknown[]) => guardar(...a),
}));

const fila = (over: Partial<ExcepcionVista> = {}): ExcepcionVista => ({
    id: 'ex-1',
    tipo: 'CITA_NO_ENTREGADA',
    titulo: 'Cita que el hospital aún no tiene',
    gravedad: 'ALTA',
    estado: 'ABIERTA',
    resumen: 'Lleva 25 min en la cola sin que el agente del hospital la tome.',
    detalleTecnico: null,
    cita: {
        inicioIso: '2026-09-22T20:00:00.000Z',
        medico: 'Dr(a). Ana Ruiz',
        servicio: 'Medicina general',
        paciente: 'María L••• N•••',
        documento: '•••3456',
        pacienteId: 'pac-1',
    },
    ocurrencias: 1,
    primeraVezIso: '2026-09-22T14:30:00.000Z',
    ultimaVezIso: '2026-09-22T14:58:00.000Z',
    avisadaIso: null,
    dueno: null,
    cierre: null,
    acciones: ['TOMAR', 'RESOLVER', 'DESCARTAR'],
    ...over,
});

const lista = (filas: ExcepcionVista[], over: Partial<ListaExcepciones> = {}): ListaExcepciones => ({
    filas,
    total: filas.length,
    pagina: 1,
    paginas: 1,
    resumen: {
        activas: filas.length,
        sinDueno: filas.length,
        mias: 0,
        criticas: 0,
        porGravedad: { BAJA: 0, MEDIA: 0, ALTA: filas.length, CRITICA: 0 },
    },
    medicos: [],
    truncada: false,
    ...over,
});

const medico = (over: Partial<MedicoFiltro> = {}): MedicoFiltro => ({ id: 'doc-1', nombre: 'Ana Ruiz', ...over });

const avisosOk = (over: Partial<EstadoAvisos> = {}): EstadoAvisos => ({
    salen: true,
    razon: null,
    alertasActivas: true,
    plantilla: true,
    tieneNumero: true,
    tieneRespaldo: false,
    numero: null,
    respaldo: null,
    ...over,
});

const pintar = (
    filas: ExcepcionVista[],
    over: Partial<React.ComponentProps<typeof BandejaClient>> = {},
) =>
    render(
        <BandejaClient
            lista={lista(filas)}
            filtros={{ estado: 'ACTIVAS' }}
            medicos={[]}
            avisos={avisosOk()}
            puedeConfigurarAvisos={false}
            {...over}
        />,
    );

beforeEach(() => {
    jest.clearAllMocks();
    aplicar.mockResolvedValue({ success: true, data: { estado: 'EN_REVISION' } });
    detalle.mockResolvedValue({ success: true, data: { ...fila(), historial: [] } satisfies ExcepcionDetalle });
    guardar.mockResolvedValue({ success: true, data: { numero: '573001234567', activos: true } });
});

describe('BandejaClient — la lista', () => {
    it('muestra la excepción: gravedad, estado, título, resumen y la cita con el paciente ENMASCARADO', () => {
        pintar([fila()]);
        // Dentro de la lista: «Alta» y el título también están en las opciones de los filtros.
        const tarjeta = within(screen.getByRole('list'));
        expect(tarjeta.getByText('Alta')).toBeInTheDocument();
        expect(tarjeta.getByText('Abierta')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Cita que el hospital aún no tiene' })).toBeInTheDocument();
        expect(screen.getByText(/Lleva 25 min en la cola/)).toBeInTheDocument();
        expect(screen.getByText('Dr(a). Ana Ruiz')).toBeInTheDocument();
        expect(screen.getByText('Medicina general')).toBeInTheDocument();
        expect(screen.getByText('María L••• N••• · •••3456')).toBeInTheDocument();
    });

    it('🕐 la hora de la cita sale en hora de Bogotá, no la del navegador (20:00Z = 3:00 p. m.)', () => {
        pintar([fila()]);
        expect(screen.getByText(/3:00\s*p\.?\s?m/i)).toBeInTheDocument();
    });

    it('sin excepciones dice que no hay, según el filtro', () => {
        const { unmount } = pintar([]);
        expect(screen.getByText(/No hay excepciones activas/)).toBeInTheDocument();
        unmount();
        pintar([], { filtros: { estado: 'MIAS' } });
        expect(screen.getByText(/No tienes excepciones en revisión/)).toBeInTheDocument();
    });

    it('muestra quién la tiene y si se avisó al agendador', () => {
        pintar([fila({ estado: 'EN_REVISION', dueno: { esMio: false, etiqueta: 'agente de reservas' }, avisadaIso: '2026-09-22T14:40:00.000Z' })]);
        expect(screen.getByText('La tiene agente de reservas')).toBeInTheDocument();
        expect(screen.getByText(/Se avisó al agendador/)).toBeInTheDocument();
    });

    it('la mía dice «La tienes tú»', () => {
        pintar([fila({ estado: 'EN_REVISION', dueno: { esMio: true, etiqueta: 'Tú' } })]);
        expect(screen.getByText('La tienes tú')).toBeInTheDocument();
    });

    it('una cerrada muestra quién la cerró y la nota', () => {
        pintar(
            [fila({ estado: 'RESUELTA', acciones: ['REABRIR'], cierre: { atIso: '2026-09-22T15:00:00.000Z', por: 'agente de reservas', nota: 'Se agendó en ventanilla' } })],
            { filtros: { estado: 'CERRADAS' } },
        );
        expect(screen.getByText(/Cerrada por agente de reservas/)).toBeInTheDocument();
        expect(screen.getByText(/Se agendó en ventanilla/)).toBeInTheDocument();
    });

    it('las cifras del resumen', () => {
        render(
            <BandejaClient
                lista={lista([fila()], { resumen: { activas: 7, sinDueno: 5, mias: 2, criticas: 1, porGravedad: { BAJA: 0, MEDIA: 3, ALTA: 3, CRITICA: 1 } } })}
                filtros={{ estado: 'ACTIVAS' }}
                medicos={[]}
                avisos={avisosOk()}
                puedeConfigurarAvisos={false}
            />,
        );
        const resumen = screen.getByRole('region', { name: 'Resumen' });
        expect(within(resumen).getByText('7')).toBeInTheDocument();
        expect(within(resumen).getByText('5')).toBeInTheDocument();
        expect(within(resumen).getByText('2')).toBeInTheDocument();
        expect(within(resumen).getByText('1')).toBeInTheDocument();
    });
});

describe('BandejaClient — filtros y páginas', () => {
    it('las pestañas de estado son enlaces con la URL de los filtros, y la activa se marca', () => {
        pintar([fila()], { filtros: { estado: 'MIAS', tipo: 'ERROR_SYNC' } });
        const nav = screen.getByRole('navigation', { name: 'Estado' });
        expect(within(nav).getByText('Mías')).toHaveAttribute('aria-current', 'page');
        expect(within(nav).getByText('Activas')).toHaveAttribute('href', '/dashboard/bandeja?tipo=ERROR_SYNC');
        expect(within(nav).getByText('Cerradas')).toHaveAttribute('href', '/dashboard/bandeja?estado=CERRADAS&tipo=ERROR_SYNC');
    });

    it('cambiar de pestaña vuelve a la página 1 (la página 3 de «activas» no existe en «cerradas»)', () => {
        pintar([fila()], { filtros: { estado: 'MIAS', pagina: 3 } });
        const nav = screen.getByRole('navigation', { name: 'Estado' });
        expect(within(nav).getByText('Cerradas')).toHaveAttribute('href', '/dashboard/bandeja?estado=CERRADAS');
    });

    it('cambiar el tipo o la gravedad navega y vuelve a la página 1', () => {
        pintar([fila()], { filtros: { estado: 'SIN_DUENO' } });
        fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'DERIVA_EN_HIS' } });
        expect(push).toHaveBeenLastCalledWith('/dashboard/bandeja?estado=SIN_DUENO&tipo=DERIVA_EN_HIS');
        fireEvent.change(screen.getByLabelText('Gravedad'), { target: { value: 'CRITICA' } });
        expect(push).toHaveBeenLastCalledWith('/dashboard/bandeja?estado=SIN_DUENO&gravedad=CRITICA');
    });

    it('cambiar el tipo o la gravedad estando en la página 3 vuelve a la 1 (la página 3 del filtro nuevo puede no existir)', () => {
        pintar([fila()], { filtros: { estado: 'ACTIVAS', pagina: 3 } });
        fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'ERROR_SYNC' } });
        expect(push).toHaveBeenLastCalledWith('/dashboard/bandeja?tipo=ERROR_SYNC');
        fireEvent.change(screen.getByLabelText('Gravedad'), { target: { value: 'ALTA' } });
        expect(push).toHaveBeenLastCalledWith('/dashboard/bandeja?gravedad=ALTA');
    });

    it('quitar el filtro («Todos») lo borra de la URL', () => {
        pintar([fila()], { filtros: { estado: 'ACTIVAS', tipo: 'ERROR_SYNC' } });
        fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: '' } });
        expect(push).toHaveBeenLastCalledWith('/dashboard/bandeja');
    });

    it('paginación: solo si hay más de una página, con anterior/siguiente según corresponda', () => {
        const { unmount } = pintar([fila()]);
        expect(screen.queryByRole('navigation', { name: 'Páginas' })).not.toBeInTheDocument();
        unmount();

        render(
            <BandejaClient
                lista={lista([fila()], { pagina: 2, paginas: 3, total: 60 })}
                filtros={{ estado: 'CERRADAS', pagina: 2 }}
                medicos={[]}
                avisos={avisosOk()}
                puedeConfigurarAvisos={false}
            />,
        );
        const pag = screen.getByRole('navigation', { name: 'Páginas' });
        expect(within(pag).getByText(/Página 2 de 3 · 60 excepciones/)).toBeInTheDocument();
        expect(within(pag).getByText('← Anterior')).toHaveAttribute('href', '/dashboard/bandeja?estado=CERRADAS');
        expect(within(pag).getByText('Siguiente →')).toHaveAttribute('href', '/dashboard/bandeja?estado=CERRADAS&pagina=3');
    });
});

describe('BandejaClient — buscar y filtrar (fecha, texto, médico, orden)', () => {
    it('🔎 el texto libre NO navega en cada tecla: solo al enviar (Enter o el botón «Buscar»)', async () => {
        pintar([fila()]);
        const campo = screen.getByPlaceholderText(/Buscar por médico, paciente, título o nota/);
        await userEvent.type(campo, 'fabio');
        expect(push).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
        expect(push).toHaveBeenLastCalledWith('/dashboard/bandeja?q=fabio');
    });

    it('el campo de texto se sincroniza si el filtro cambia por fuera (p. ej. «Limpiar filtros»)', () => {
        const { rerender } = pintar([fila()], { filtros: { estado: 'ACTIVAS', q: 'algo' } });
        expect(screen.getByPlaceholderText(/Buscar por médico/)).toHaveValue('algo');
        rerender(
            <BandejaClient lista={lista([fila()])} filtros={{ estado: 'ACTIVAS' }} medicos={[]} avisos={avisosOk()} puedeConfigurarAvisos={false} />,
        );
        expect(screen.getByPlaceholderText(/Buscar por médico/)).toHaveValue('');
    });

    it('📅 «Desde»/«Hasta» navegan al cambiar', () => {
        pintar([fila()], { filtros: { estado: 'ACTIVAS' } });
        fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-09-01' } });
        expect(push).toHaveBeenLastCalledWith('/dashboard/bandeja?desde=2026-09-01');
        fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-09-24' } });
        expect(push).toHaveBeenLastCalledWith('/dashboard/bandeja?hasta=2026-09-24');
    });

    it('🩺 el filtro «Médico» solo aparece si hay opciones, y navega al elegir', () => {
        const { unmount } = pintar([fila()], { medicos: [] });
        expect(screen.queryByLabelText('Médico')).not.toBeInTheDocument();
        unmount();

        pintar([fila()], { medicos: [medico(), medico({ id: 'doc-2', nombre: 'Luis Pérez' })] });
        fireEvent.change(screen.getByLabelText('Médico'), { target: { value: 'doc-2' } });
        expect(push).toHaveBeenLastCalledWith('/dashboard/bandeja?medicoId=doc-2');
    });

    it('«Ordenar» solo aparece fuera de Cerradas, y navega al cambiar', () => {
        const { unmount } = pintar([fila()], { filtros: { estado: 'CERRADAS' } });
        expect(screen.queryByLabelText('Ordenar')).not.toBeInTheDocument();
        unmount();

        pintar([fila()], { filtros: { estado: 'ACTIVAS' } });
        fireEvent.change(screen.getByLabelText('Ordenar'), { target: { value: 'URGENCIA' } });
        expect(push).toHaveBeenLastCalledWith('/dashboard/bandeja?orden=URGENCIA');
    });

    it('🧹 «Limpiar filtros» solo aparece con algún filtro avanzado activo, y deja estado y orden', () => {
        const { unmount } = pintar([fila()], { filtros: { estado: 'ACTIVAS' } });
        expect(screen.queryByText('Limpiar filtros')).not.toBeInTheDocument();
        unmount();

        pintar([fila()], { filtros: { estado: 'MIAS', q: 'fabio', medicoId: 'doc-1', orden: 'URGENCIA' } });
        expect(screen.getByText('Limpiar filtros')).toHaveAttribute('href', '/dashboard/bandeja?estado=MIAS&orden=URGENCIA');
    });

    it('la tarjeta muestra cuándo se detectó la excepción', () => {
        pintar([fila({ primeraVezIso: '2026-09-22T14:30:00.000Z' })]);
        expect(screen.getByText(/Detectada/)).toBeInTheDocument();
    });

    it('el encabezado dice cómo está ordenado', () => {
        const { unmount } = pintar([fila()], { filtros: { estado: 'ACTIVAS' } });
        expect(screen.getByText(/Se ordenan por fecha, las más recientes primero/)).toBeInTheDocument();
        unmount();

        pintar([fila()], { filtros: { estado: 'ACTIVAS', orden: 'URGENCIA' } });
        expect(screen.getByText(/Se ordenan por urgencia: la cita más cercana primero/)).toBeInTheDocument();
    });
});

describe('BandejaClient — los extremos de la paginación', () => {
    const enPagina = (pagina: number) =>
        render(
            <BandejaClient
                lista={lista([fila()], { pagina, paginas: 3, total: 60 })}
                filtros={{ estado: 'ACTIVAS' }}
                medicos={[]}
                avisos={avisosOk()}
                puedeConfigurarAvisos={false}
            />,
        );

    it('en la primera página no hay «Anterior»', () => {
        enPagina(1);
        expect(screen.queryByText('← Anterior')).not.toBeInTheDocument();
        expect(screen.getByText('Siguiente →')).toBeInTheDocument();
    });

    it('en la última no hay «Siguiente»', () => {
        enPagina(3);
        expect(screen.queryByText('Siguiente →')).not.toBeInTheDocument();
        expect(screen.getByText('← Anterior')).toBeInTheDocument();
    });
});

describe('BandejaClient — el tope de activas (orden URGENCIA)', () => {
    const conTope = (truncada: boolean, estado: 'ACTIVAS' | 'CERRADAS' = 'ACTIVAS') =>
        render(
            <BandejaClient
                lista={lista([fila()], { total: 500, paginas: 20, truncada })}
                filtros={{ estado, orden: 'URGENCIA' }}
                medicos={[]}
                avisos={avisosOk()}
                puedeConfigurarAvisos={false}
            />,
        );

    it('cuando el servidor dice que se truncó, avisa que solo se muestran las más próximas', () => {
        const { unmount } = conTope(true);
        expect(screen.getByText(/Se muestran las 500 más próximas/)).toBeInTheDocument();
        unmount();
        conTope(false);
        expect(screen.queryByText(/Se muestran las 500 más próximas/)).not.toBeInTheDocument();
    });

    it('las cerradas nunca se truncan: ahí no aplica el aviso', () => {
        conTope(false, 'CERRADAS');
        expect(screen.queryByText(/Se muestran las 500 más próximas/)).not.toBeInTheDocument();
    });
});

describe('BandejaClient — trabajar una excepción', () => {
    it('solo se pintan los botones que el servidor mandó', () => {
        pintar([fila({ acciones: ['SOLTAR'] })]);
        expect(screen.getByRole('button', { name: 'Soltar' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Tomar' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Resolver' })).not.toBeInTheDocument();
    });

    it('sin acciones (la tiene otro, o la cerró el sistema) no hay botones de trabajo', () => {
        pintar([fila({ acciones: [] })]);
        for (const n of ['Tomar', 'Soltar', 'Resolver', 'Descartar', 'Reabrir']) {
            expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
        }
    });

    it('Tomar llama a la acción con el id y refresca la lista', async () => {
        pintar([fila()]);
        await userEvent.click(screen.getByRole('button', { name: 'Tomar' }));
        await waitFor(() => expect(aplicar).toHaveBeenCalledWith({ id: 'ex-1', accion: 'TOMAR', nota: undefined }));
        await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('📝 Resolver pide la nota y NO se puede confirmar con menos de 5 caracteres', async () => {
        pintar([fila()]);
        await userEvent.click(screen.getByRole('button', { name: 'Resolver' }));
        expect(aplicar).not.toHaveBeenCalled();

        const confirmar = screen.getByRole('button', { name: /Confirmar: resolver/ });
        expect(confirmar).toBeDisabled();
        await userEvent.type(screen.getByRole('textbox'), 'abc');
        expect(confirmar).toBeDisabled();
        await userEvent.type(screen.getByRole('textbox'), 'de');
        expect(confirmar).toBeEnabled();
    });

    it('confirmar envía la nota; un texto de solo espacios no cuenta', async () => {
        pintar([fila()]);
        await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
        await userEvent.type(screen.getByRole('textbox'), '      ');
        expect(screen.getByRole('button', { name: /Confirmar: descartar/ })).toBeDisabled();

        await userEvent.clear(screen.getByRole('textbox'));
        await userEvent.type(screen.getByRole('textbox'), 'Era una cita de prueba');
        await userEvent.click(screen.getByRole('button', { name: /Confirmar: descartar/ }));
        await waitFor(() => expect(aplicar).toHaveBeenCalledWith({ id: 'ex-1', accion: 'DESCARTAR', nota: 'Era una cita de prueba' }));
        await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('tras una acción con nota, la nota escrita NO queda para la siguiente', async () => {
        pintar([fila()]);
        await userEvent.click(screen.getByRole('button', { name: 'Resolver' }));
        await userEvent.type(screen.getByRole('textbox'), 'Se agendó en ventanilla');
        await userEvent.click(screen.getByRole('button', { name: /Confirmar: resolver/ }));
        await waitFor(() => expect(refresh).toHaveBeenCalled());

        await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
        expect(screen.getByRole('textbox')).toHaveValue('');
    });

    it('cancelar cierra el cuadro de la nota sin llamar al servidor', async () => {
        pintar([fila()]);
        await userEvent.click(screen.getByRole('button', { name: 'Resolver' }));
        await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(aplicar).not.toHaveBeenCalled();
    });

    it('🚫 si el servidor rechaza la acción, se muestra el motivo y NO se refresca', async () => {
        aplicar.mockResolvedValue({ success: false, error: 'La excepción ya la tiene otra persona.' });
        pintar([fila()]);
        await userEvent.click(screen.getByRole('button', { name: 'Tomar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('La excepción ya la tiene otra persona.');
        expect(refresh).not.toHaveBeenCalled();
    });
});

describe('BandejaClient — historial y detalle', () => {
    it('«Ver historial» pide el detalle y lo muestra, con quién hizo cada cosa', async () => {
        detalle.mockResolvedValue({
            success: true,
            data: {
                ...fila(),
                ocurrencias: 3,
                historial: [
                    { atIso: '2026-09-22T14:30:00.000Z', accion: 'Detectada', por: 'El sistema', nota: null },
                    { atIso: '2026-09-22T14:40:00.000Z', accion: 'La tomó', por: 'agente de reservas', nota: 'Llamé al hospital' },
                ],
            },
        });
        pintar([fila()]);
        expect(detalle).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Ver historial' }));

        expect(await screen.findByText(/Detectada · El sistema/)).toBeInTheDocument();
        expect(screen.getByText(/La tomó · agente de reservas — «Llamé al hospital»/)).toBeInTheDocument();
        expect(screen.getByText(/Visto 3 veces/)).toBeInTheDocument();
        expect(detalle).toHaveBeenCalledWith('ex-1');
        expect(screen.getByRole('link', { name: /Ver el caso completo en Rastreo de paciente/ })).toHaveAttribute('href', '/dashboard/rastreo');
    });

    it('🕵️ el detalle técnico se muestra SOLO si el servidor lo mandó', async () => {
        detalle.mockResolvedValueOnce({ success: true, data: { ...fila(), detalleTecnico: 'ECONNREFUSED 10.0.0.5:1433', historial: [] } });
        const { unmount } = pintar([fila()]);
        await userEvent.click(screen.getByRole('button', { name: 'Ver historial' }));
        expect(await screen.findByText('ECONNREFUSED 10.0.0.5:1433')).toBeInTheDocument();
        unmount();

        detalle.mockResolvedValueOnce({ success: true, data: { ...fila(), detalleTecnico: null, historial: [] } });
        pintar([fila()]);
        await userEvent.click(screen.getByRole('button', { name: 'Ver historial' }));
        await waitFor(() => expect(screen.queryByText('Cargando…')).not.toBeInTheDocument());
        expect(screen.queryByText('Detalle técnico')).not.toBeInTheDocument();
    });

    it('sin paciente asociado no ofrece el enlace al rastreo', async () => {
        detalle.mockResolvedValue({ success: true, data: { ...fila({ cita: null }), historial: [] } });
        pintar([fila({ cita: null })]);
        await userEvent.click(screen.getByRole('button', { name: 'Ver historial' }));
        await waitFor(() => expect(screen.queryByText('Cargando…')).not.toBeInTheDocument());
        expect(screen.queryByRole('link', { name: /Rastreo de paciente/ })).not.toBeInTheDocument();
    });

    it('una cita sin paciente conocido (pacienteId nulo) tampoco ofrece el enlace', async () => {
        const sinPaciente = fila({ cita: { ...fila().cita!, pacienteId: null, paciente: null, documento: null } });
        detalle.mockResolvedValue({ success: true, data: { ...sinPaciente, historial: [] } });
        pintar([sinPaciente]);
        await userEvent.click(screen.getByRole('button', { name: 'Ver historial' }));
        await waitFor(() => expect(screen.queryByText('Cargando…')).not.toBeInTheDocument());
        expect(screen.queryByRole('link', { name: /Rastreo de paciente/ })).not.toBeInTheDocument();
    });

    it('si el detalle falla, dice por qué', async () => {
        detalle.mockResolvedValue({ success: false, error: 'Excepción no encontrada.' });
        pintar([fila()]);
        await userEvent.click(screen.getByRole('button', { name: 'Ver historial' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Excepción no encontrada.');
    });

    it('«Ocultar historial» lo esconde', async () => {
        pintar([fila()]);
        await userEvent.click(screen.getByRole('button', { name: 'Ver historial' }));
        await waitFor(() => expect(detalle).toHaveBeenCalled());
        await userEvent.click(screen.getByRole('button', { name: 'Ocultar historial' }));
        expect(screen.getByRole('button', { name: 'Ver historial' })).toBeInTheDocument();
    });
});

describe('BandejaClient — avisos al agendador', () => {
    it('✅ cuando salen, lo dice', () => {
        pintar([fila()]);
        expect(screen.getByText('Los avisos por WhatsApp al agendador están activos')).toBeInTheDocument();
    });

    it('🚦 el semáforo: verde cuando salen, ámbar cuando no', () => {
        const { unmount } = pintar([fila()]);
        expect(screen.getByRole('region', { name: 'Avisos al agendador' })).toHaveClass('bg-emerald-50');
        expect(screen.getByRole('region', { name: 'Avisos al agendador' })).not.toHaveClass('bg-amber-50');
        unmount();
        pintar([fila()], { avisos: avisosOk({ salen: false, razon: 'Falta el número.' }) });
        expect(screen.getByRole('region', { name: 'Avisos al agendador' })).toHaveClass('bg-amber-50');
        expect(screen.getByRole('region', { name: 'Avisos al agendador' })).not.toHaveClass('bg-emerald-50');
    });

    it('🚨 cuando NO salen, dice por qué y que las excepciones solo están en la bandeja', () => {
        pintar([fila()], { avisos: avisosOk({ salen: false, razon: 'Falta el número de WhatsApp del agendador.', tieneNumero: false }) });
        expect(screen.getByText('Los avisos por WhatsApp al agendador NO están saliendo')).toBeInTheDocument();
        expect(screen.getByText(/Falta el número de WhatsApp del agendador\. Mientras tanto las excepciones solo aparecen en esta bandeja/)).toBeInTheDocument();
    });

    it('si no se pudo leer el estado de los avisos, la bandeja igual funciona', () => {
        pintar([fila()], { avisos: null });
        expect(screen.queryByRole('region', { name: 'Avisos al agendador' })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Cita que el hospital aún no tiene' })).toBeInTheDocument();
    });

    it('🔒 quien no configura no ve el botón ni el formulario', () => {
        pintar([fila()], { puedeConfigurarAvisos: false });
        expect(screen.queryByRole('button', { name: 'Configurar avisos' })).not.toBeInTheDocument();
    });

    it('el administrador abre el formulario con el número actual y guarda', async () => {
        pintar([fila()], { puedeConfigurarAvisos: true, avisos: avisosOk({ salen: false, razon: 'Los avisos por WhatsApp están apagados.', alertasActivas: false, numero: '573001234567' }) });
        await userEvent.click(screen.getByRole('button', { name: 'Configurar avisos' }));

        const campo = screen.getByLabelText('Celular del agendador (WhatsApp)');
        expect(campo).toHaveValue('573001234567');
        await userEvent.clear(campo);
        await userEvent.type(campo, '300 111 2233');
        await userEvent.click(screen.getByRole('checkbox'));
        await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

        await waitFor(() => expect(guardar).toHaveBeenCalledWith({ numero: '300 111 2233', respaldo: '', activos: true }));
        expect(await screen.findByRole('status')).toHaveTextContent('Guardado.');
        expect(refresh).toHaveBeenCalled();
    });

    it('con los avisos ya activos, el formulario los muestra activos y guardar no los apaga', async () => {
        pintar([fila()], { puedeConfigurarAvisos: true, avisos: avisosOk({ alertasActivas: true, numero: '573001234567' }) });
        await userEvent.click(screen.getByRole('button', { name: 'Configurar avisos' }));
        expect(screen.getByRole('checkbox')).toBeChecked();
        await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        await waitFor(() => expect(guardar).toHaveBeenCalledWith({ numero: '573001234567', respaldo: '', activos: true }));
    });

    it('§12 #14: el formulario trae el respaldo actual y lo guarda junto con el número', async () => {
        pintar([fila()], { puedeConfigurarAvisos: true, avisos: avisosOk({ numero: '573001234567', respaldo: '573007654321', tieneRespaldo: true }) });
        await userEvent.click(screen.getByRole('button', { name: 'Configurar avisos' }));
        const campo = screen.getByLabelText('Celular de respaldo (opcional)');
        expect(campo).toHaveValue('573007654321');
        await userEvent.clear(campo);
        await userEvent.type(campo, '300 222 3344');
        await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        await waitFor(() => expect(guardar).toHaveBeenCalledWith({ numero: '573001234567', respaldo: '300 222 3344', activos: true }));
    });

    it('cuando salen, explica los recordatorios y menciona al respaldo solo si lo hay', () => {
        const { unmount } = pintar([fila()], { avisos: avisosOk({ tieneRespaldo: true }) });
        expect(screen.getByText(/se le recuerda \(hasta 2 veces\), también al número de respaldo/)).toBeInTheDocument();
        unmount();
        pintar([fila()], { avisos: avisosOk({ tieneRespaldo: false }) });
        expect(screen.getByText(/se le recuerda \(hasta 2 veces\)\./)).toBeInTheDocument();
    });

    it('un número inválido muestra el error del servidor y no refresca', async () => {
        guardar.mockResolvedValue({ success: false, error: 'Escribe un celular colombiano válido.' });
        pintar([fila()], { puedeConfigurarAvisos: true });
        await userEvent.click(screen.getByRole('button', { name: 'Configurar avisos' }));
        await userEvent.type(screen.getByLabelText('Celular del agendador (WhatsApp)'), '123');
        await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Escribe un celular colombiano válido.');
        expect(refresh).not.toHaveBeenCalled();
    });

    it('si falta la plantilla, el formulario manda a Configuración', async () => {
        pintar([fila()], { puedeConfigurarAvisos: true, avisos: avisosOk({ salen: false, razon: 'Falta la plantilla', plantilla: false }) });
        await userEvent.click(screen.getByRole('button', { name: 'Configurar avisos' }));
        expect(screen.getByRole('link', { name: 'Configuración' })).toHaveAttribute('href', '/dashboard/configuracion');
    });

    it('el aviso deja claro que es un teléfono personal y sin datos de pacientes', async () => {
        pintar([fila()], { puedeConfigurarAvisos: true });
        await userEvent.click(screen.getByRole('button', { name: 'Configurar avisos' }));
        expect(screen.getByText(/teléfono personal.*sin datos de ningún paciente/)).toBeInTheDocument();
    });
});
