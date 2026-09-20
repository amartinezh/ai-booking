import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HisEnVivoVista } from '@/lib/rastreo/tipos';

jest.mock('@/app/actions/rastreo', () => ({ progresoConsultaHisAction: jest.fn() }));
import { progresoConsultaHisAction } from '@/app/actions/rastreo';
import ConsultaHis from './ConsultaHis';

// ══════════════════════════════════════════════════════════════════════════
// El panel de la consulta en vivo al HIS. La pantalla no decide si se puede:
// lo dice el servidor. Aquí se prueba lo que sí es de la pantalla: que no se
// pueda pedir lo que el servidor dijo que no, que la espera se vea y termine,
// que un error se explique, y que cerrar la pantalla detenga el sondeo.
// ══════════════════════════════════════════════════════════════════════════

const mProgreso = progresoConsultaHisAction as jest.Mock;

const LISTO: HisEnVivoVista = {
    visible: true,
    disponibilidad: { puede: true, razon: null },
    consulta: null,
    aviso: null,
};

const CONSULTADO: HisEnVivoVista = {
    ...LISTO,
    consulta: {
        consultadoIso: '2026-09-21T15:05:00.000Z',
        porDocumento: {
            desdeIso: '2026-09-14T05:00:00.000Z',
            hastaIso: '2026-11-20T05:00:00.000Z',
            citas: [
                { startIso: '2026-09-23T15:00:00.000Z', medico: 'Dr(a). Ana Ruiz', estado: 'SCHEDULED' },
                { startIso: '2026-10-05T15:00:00.000Z', medico: 'Dr(a). Luis Peña', estado: 'NO_SHOW' },
            ],
            truncado: false,
        },
        cuposConsultados: 1,
    },
};

const props = (over: Partial<Parameters<typeof ConsultaHis>[0]> = {}) => ({
    vista: LISTO,
    organizationId: null,
    zonaHoraria: 'America/Bogota',
    iniciar: jest.fn(async () => ({ success: true as const, data: { ids: ['a', 'b'], esperaMs: 5_000 } })),
    aplicar: jest.fn(async () => null),
    intervaloMs: 5,
    ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    mProgreso.mockResolvedValue({ success: true, data: { estado: 'LISTA', detalle: null } });
});

describe('ConsultaHis — qué se ofrece', () => {
    it('si el servidor no la ofrece (rol o clínica), no dibuja nada', () => {
        const { container } = render(<ConsultaHis {...props({ vista: { ...LISTO, visible: false } })} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('sin consultar todavía: explica que AgenIA solo sabe lo suyo y ofrece consultar', () => {
        render(<ConsultaHis {...props()} />);

        expect(screen.getByRole('heading', { name: 'Consulta en vivo al HIS' })).toBeInTheDocument();
        expect(screen.getByText(/solo sabe lo que ella misma registró/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Consultar el HIS ahora' })).toBeEnabled();
    });

    it('⚡ si el servidor dice que no se puede, el botón queda apagado y dice POR QUÉ', async () => {
        const iniciar = jest.fn();
        const vista: HisEnVivoVista = {
            ...LISTO,
            disponibilidad: { puede: false, razon: 'El agente del hospital no da señales desde hace 12 min.' },
        };
        const user = userEvent.setup();
        render(<ConsultaHis {...props({ vista, iniciar })} />);

        const boton = screen.getByRole('button', { name: 'Consultar el HIS ahora' });
        expect(boton).toBeDisabled();
        expect(screen.getByText(/No se puede consultar ahora: El agente del hospital no da señales desde hace 12 min\./)).toBeInTheDocument();
        // El motivo está enlazado al botón (lectores de pantalla).
        expect(boton).toHaveAttribute('aria-describedby', 'consulta-his-razon');
        await user.click(boton);
        expect(iniciar).not.toHaveBeenCalled();
    });
});

describe('ConsultaHis — pedir y esperar', () => {
    it('pide la consulta, sondea con los ids y, cuando está lista, la APLICA', async () => {
        const p = props();
        mProgreso
            .mockResolvedValueOnce({ success: true, data: { estado: 'EN_CURSO', detalle: null } })
            .mockResolvedValueOnce({ success: true, data: { estado: 'LISTA', detalle: null } });
        const user = userEvent.setup();
        render(<ConsultaHis {...p} organizationId="org-9" />);

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        await waitFor(() => expect(p.aplicar).toHaveBeenCalledWith(['a', 'b']));
        expect(p.iniciar).toHaveBeenCalledTimes(1);
        // El sondeo lleva la clínica elegida (SUPER_ADMIN) y los ids que devolvió el servidor.
        expect(mProgreso).toHaveBeenCalledWith({ organizationId: 'org-9', ids: ['a', 'b'] });
        expect(mProgreso).toHaveBeenCalledTimes(2);
    });

    it('mientras espera lo dice, y el botón queda apagado: no se lanzan dos consultas', async () => {
        mProgreso.mockImplementation(() => new Promise(() => undefined)); // nunca contesta
        const p = props();
        const user = userEvent.setup();
        render(<ConsultaHis {...p} />);

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        expect(await screen.findByText(/Consultando al hospital/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Consultar el HIS ahora' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));
        expect(p.iniciar).toHaveBeenCalledTimes(1);
    });

    it('al terminar, el botón vuelve a estar disponible', async () => {
        const user = userEvent.setup();
        render(<ConsultaHis {...props()} />);

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Consultar el HIS ahora' })).toBeEnabled());
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('ConsultaHis — cuando algo sale mal se explica', () => {
    it('si no se pudo iniciar (límite, agente caído…), muestra el motivo del servidor y no sondea', async () => {
        const p = props({ iniciar: jest.fn(async () => ({ success: false as const, error: 'Hiciste demasiadas consultas al hospital seguidas.' })) });
        const user = userEvent.setup();
        render(<ConsultaHis {...p} />);

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Hiciste demasiadas consultas al hospital seguidas.');
        expect(mProgreso).not.toHaveBeenCalled();
        expect(p.aplicar).not.toHaveBeenCalled();
    });

    it('si el hospital falla, muestra el detalle y permite reintentar', async () => {
        mProgreso.mockResolvedValue({ success: true, data: { estado: 'FALLIDA', detalle: 'El hospital no respondió a la consulta.' } });
        const p = props();
        const user = userEvent.setup();
        render(<ConsultaHis {...p} />);

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('El hospital no respondió a la consulta.');
        expect(p.aplicar).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Consultar el HIS ahora' })).toBeEnabled();
    });

    it('⏱ si pasa el tiempo sin respuesta, se rinde con un mensaje (no queda esperando para siempre)', async () => {
        mProgreso.mockResolvedValue({ success: true, data: { estado: 'EN_CURSO', detalle: null } });
        const p = props({ iniciar: jest.fn(async () => ({ success: true as const, data: { ids: ['a'], esperaMs: 40 } })) });
        const user = userEvent.setup();
        render(<ConsultaHis {...p} />);

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/no respondió a tiempo/);
        expect(p.aplicar).not.toHaveBeenCalled();
    });

    it('si falla el sondeo mismo (sesión vencida, sin permiso), muestra ese error', async () => {
        mProgreso.mockResolvedValue({ success: false, error: 'Sin permisos.' });
        const user = userEvent.setup();
        render(<ConsultaHis {...props()} />);

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Sin permisos.');
    });

    it('si la respuesta llegó pero no se pudo aplicar al expediente, lo dice', async () => {
        const p = props({ aplicar: jest.fn(async () => 'No se pudo registrar la consulta y, por seguridad, no se muestran datos.') });
        const user = userEvent.setup();
        render(<ConsultaHis {...p} />);

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/no se muestran datos/);
    });

    it('un error anterior se limpia al reintentar', async () => {
        mProgreso.mockResolvedValueOnce({ success: true, data: { estado: 'FALLIDA', detalle: 'falló' } });
        const user = userEvent.setup();
        render(<ConsultaHis {...props()} />);
        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));
        await screen.findByRole('alert');

        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));

        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
});

describe('ConsultaHis — al cerrar la pantalla se detiene', () => {
    it('🧹 si se desmonta a media espera, no sigue sondeando ni aplica nada', async () => {
        // Un sondeo lento: da tiempo a desmontar mientras se espera la respuesta.
        let resolver: (v: unknown) => void = () => undefined;
        mProgreso.mockImplementation(() => new Promise((r) => (resolver = r)));
        const p = props();
        const user = userEvent.setup();
        const { unmount } = render(<ConsultaHis {...p} />);
        await user.click(screen.getByRole('button', { name: 'Consultar el HIS ahora' }));
        await waitFor(() => expect(mProgreso).toHaveBeenCalledTimes(1));

        unmount();
        resolver({ success: true, data: { estado: 'LISTA', detalle: null } });
        await new Promise((r) => setTimeout(r, 30));

        expect(p.aplicar).not.toHaveBeenCalled();
        expect(mProgreso).toHaveBeenCalledTimes(1);
    });
});

describe('ConsultaHis — lo que respondió el HIS', () => {
    it('dice a qué hora respondió el hospital y ofrece volver a consultar', () => {
        render(<ConsultaHis {...props({ vista: CONSULTADO })} />);

        expect(screen.getByText(/Lo que el hospital respondió a las/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Volver a consultar al HIS' })).toBeEnabled();
    });

    it('lista las citas del paciente en el HIS con médico y estado', () => {
        render(<ConsultaHis {...props({ vista: CONSULTADO })} />);

        expect(screen.getByRole('heading', { name: 'Citas de este paciente en el HIS' })).toBeInTheDocument();
        expect(screen.getByText(/Dr\(a\)\. Ana Ruiz/)).toBeInTheDocument();
        expect(screen.getByText('vigente')).toBeInTheDocument();
        expect(screen.getByText(/Dr\(a\)\. Luis Peña/)).toBeInTheDocument();
        expect(screen.getByText('inasistencia registrada')).toBeInTheDocument();
    });

    it('dice cuántos cupos se revisaron', () => {
        render(<ConsultaHis {...props({ vista: CONSULTADO })} />);
        expect(screen.getByText('Se revisó el cupo de la cita en el HIS.')).toBeInTheDocument();
    });

    it('sin citas en el HIS: lo dice (es una respuesta, no un error)', () => {
        const vista: HisEnVivoVista = {
            ...CONSULTADO,
            consulta: { ...CONSULTADO.consulta!, porDocumento: { ...CONSULTADO.consulta!.porDocumento!, citas: [] } },
        };
        render(<ConsultaHis {...props({ vista })} />);

        expect(screen.getByText('El HIS no tiene citas de este paciente en ese período.')).toBeInTheDocument();
    });

    it('⚠️ si el resultado es parcial o recortado, lo advierte (nunca se presenta como completo)', () => {
        const vista: HisEnVivoVista = {
            ...CONSULTADO,
            aviso: 'No se completó la búsqueda de las citas del paciente: El hospital no respondió a la consulta. El resultado es parcial.',
            consulta: { ...CONSULTADO.consulta!, porDocumento: { ...CONSULTADO.consulta!.porDocumento!, truncado: true } },
        };
        render(<ConsultaHis {...props({ vista })} />);

        expect(screen.getByRole('status')).toHaveTextContent(/El resultado es parcial/);
        expect(screen.getByText('Puede haber más citas de las que se muestran.')).toBeInTheDocument();
    });

    it('sin búsqueda por documento (rol acotado): no muestra esa sección', () => {
        const vista: HisEnVivoVista = {
            ...CONSULTADO,
            consulta: { ...CONSULTADO.consulta!, porDocumento: null },
        };
        render(<ConsultaHis {...props({ vista })} />);

        expect(screen.queryByRole('heading', { name: 'Citas de este paciente en el HIS' })).not.toBeInTheDocument();
    });

    it('avisa que lo del HIS no se guarda y que la consulta queda en la bitácora', () => {
        render(<ConsultaHis {...props({ vista: CONSULTADO })} />);
        expect(screen.getByText(/no se guarda.*bitácora/)).toBeInTheDocument();
    });
});
