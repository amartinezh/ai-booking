import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MenuLateral, { MenuMovil } from './MenuDelPanel';
import { getMenusForRole, seccionesDelMenu } from '@/lib/menus';

let ruta = '/dashboard';
jest.mock('next/navigation', () => ({ usePathname: () => ruta }));

const ANSERMA = { conEspejo: true, conAvisosDriver: true, conResumen: true };

/** El menú del panel (docs/PLAN_NAVEGACION.md §4): grupos, opción activa y el panel del celular. */
describe('MenuLateral', () => {
    beforeEach(() => {
        ruta = '/dashboard';
    });

    it('el administrador ve los cinco grupos con su encabezado, cada uno con sus opciones', () => {
        render(<MenuLateral secciones={seccionesDelMenu(getMenusForRole('ORG_ADMIN', ANSERMA))} />);
        const grupos = screen.getAllByRole('group');
        expect(grupos.map((g) => within(g).getAllByRole('link').length)).toEqual([5, 3, 5, 3, 4]);
        const operacion = screen.getByRole('group', { name: 'Operación diaria' });
        expect(within(operacion).getAllByRole('link').map((a) => a.textContent)).toEqual([
            '🚨Bandeja de sincronización',
            '📝Solicitudes de más citas',
            '📨Solicitudes de alta',
            '🕵️Caja Negra (Auditoría)',
            '🔎Rastreo de paciente',
        ]);
        expect(screen.getByRole('group', { name: 'Administración' })).toBeInTheDocument();
    });

    it('resalta la opción de la página y no otra: Avisos masivos dentro del Espejo', () => {
        ruta = '/dashboard/espejo/avisos';
        render(<MenuLateral secciones={seccionesDelMenu(getMenusForRole('ORG_ADMIN', ANSERMA))} />);
        const activa = screen.getByRole('link', { current: 'page' });
        expect(activa).toHaveTextContent('Avisos masivos');
        expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current'))).toHaveLength(1);
        expect(screen.getByRole('link', { name: /Espejo con el HIS/ })).not.toHaveAttribute('aria-current');
    });

    it('una subpágina resalta su opción (el historial del padrón es Padrón EPS)', () => {
        ruta = '/dashboard/padron/historial/abc';
        render(<MenuLateral secciones={seccionesDelMenu(getMenusForRole('ORG_ADMIN'))} />);
        expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('Padrón EPS');
    });

    it('una pantalla fuera del menú no resalta nada (tampoco la Visión General)', () => {
        ruta = '/dashboard/cuenta';
        render(<MenuLateral secciones={seccionesDelMenu(getMenusForRole('ORG_ADMIN'))} />);
        expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
    });

    it('la cifra roja sigue junto a su opción', () => {
        render(
            <MenuLateral
                secciones={seccionesDelMenu(getMenusForRole('ORG_ADMIN', { ...ANSERMA, pendientesBandeja: 7 }))}
            />,
        );
        expect(screen.getByRole('link', { name: /Bandeja de sincronización/ })).toContainElement(
            screen.getByLabelText('7 pendientes'),
        );
    });

    it('el médico, con un menú corto, va sin encabezados', () => {
        render(<MenuLateral secciones={seccionesDelMenu(getMenusForRole('DOCTOR'))} />);
        expect(screen.queryByRole('group')).not.toBeInTheDocument();
        expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([
            '🩺Mi Agenda',
            '🔎Rastreo de paciente',
            '🛟Soporte y ayuda',
        ]);
    });
});

describe('MenuMovil', () => {
    beforeEach(() => {
        ruta = '/dashboard';
    });

    const secciones = seccionesDelMenu(
        getMenusForRole('BOOKING_AGENT', { ...ANSERMA, pendientesBandeja: 2, pendientesSolicitudesCitas: 1 }),
    );

    it('cerrado, solo el botón «☰ Menú» con la suma de lo pendiente', () => {
        render(<MenuMovil secciones={secciones} correo="ana@clinica.co" rol="Agente de Reservas" />);
        const boton = screen.getByRole('button', { name: /Menú/ });
        expect(boton).toHaveAttribute('aria-expanded', 'false');
        expect(within(boton).getByLabelText('3 pendientes')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('abre el mismo menú en un panel, con quién está y su rol, y se cierra al elegir', async () => {
        const user = userEvent.setup();
        render(<MenuMovil secciones={secciones} correo="ana@clinica.co" rol="Agente de Reservas" />);
        await user.click(screen.getByRole('button', { name: /Menú/ }));

        const panel = screen.getByRole('dialog', { name: 'Menú principal' });
        expect(within(panel).getByText('ana@clinica.co')).toBeInTheDocument();
        expect(within(panel).getByText('Agente de Reservas')).toBeInTheDocument();
        expect(within(panel).getByRole('group', { name: 'Operación diaria' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Menú/ })).toHaveAttribute('aria-expanded', 'true');

        await user.click(within(panel).getByRole('link', { name: /Rastreo de paciente/ }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('se cierra con Escape y con el fondo', async () => {
        const user = userEvent.setup();
        render(<MenuMovil secciones={secciones} correo="ana@clinica.co" rol="Agente de Reservas" />);

        await user.click(screen.getByRole('button', { name: /Menú/ }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /Menú/ }));
        await user.click(screen.getAllByRole('button', { name: 'Cerrar el menú' })[0]);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('al cambiar de página (atrás o adelante) queda cerrado', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<MenuMovil secciones={secciones} correo="ana@clinica.co" rol="Agente de Reservas" />);
        await user.click(screen.getByRole('button', { name: /Menú/ }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        ruta = '/dashboard/bandeja';
        act(() => {
            rerender(<MenuMovil secciones={secciones} correo="ana@clinica.co" rol="Agente de Reservas" />);
        });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
