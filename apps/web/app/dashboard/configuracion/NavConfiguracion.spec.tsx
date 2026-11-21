import { render, screen, within } from '@testing-library/react';
import NavConfiguracion, { type EntradaNavConfiguracion } from './NavConfiguracion';

let ruta = '/dashboard/configuracion';
jest.mock('next/navigation', () => ({ usePathname: () => ruta }));

const ENTRADAS: EntradaNavConfiguracion[] = [
    { href: '/dashboard/configuracion', titulo: 'Resumen', icono: '🏠', grupo: null },
    { href: '/dashboard/configuracion/asistente', titulo: 'Qué puede hacer el asistente', icono: '🤖', grupo: 'El asistente' },
    { href: '/dashboard/configuracion/agenda', titulo: 'Agenda que ofrece el asistente', icono: '🗓️', grupo: 'El asistente' },
    { href: '/dashboard/configuracion/privacidad', titulo: 'Privacidad (Ley 1581)', icono: '🔒', grupo: 'La clínica' },
    { href: '/dashboard/configuracion/canales', titulo: 'Canales e IA', icono: '🔌', grupo: 'Conexiones' },
];

/** La columna de Configuración (docs/PLAN_NAVEGACION.md §5.1). */
describe('NavConfiguracion', () => {
    it('en escritorio va por grupos, con el Resumen suelto arriba', () => {
        render(<NavConfiguracion entradas={ENTRADAS} />);
        const grupos = screen.getAllByRole('group');
        expect(grupos.map((g) => g.getAttribute('aria-label'))).toEqual(['El asistente', 'La clínica', 'Conexiones']);
        expect(within(screen.getByRole('group', { name: 'El asistente' })).getAllByRole('link')).toHaveLength(2);
    });

    it('resalta la sección abierta (y solo esa), en la columna y en la fila del celular', () => {
        ruta = '/dashboard/configuracion/agenda';
        render(<NavConfiguracion entradas={ENTRADAS} />);
        const activas = screen.getAllByRole('link', { current: 'page' });
        expect(activas).toHaveLength(2);
        for (const a of activas) expect(a).toHaveTextContent('Agenda que ofrece el asistente');
    });

    it('el Resumen, en su dirección (con o sin barra final)', () => {
        ruta = '/dashboard/configuracion/';
        render(<NavConfiguracion entradas={ENTRADAS} />);
        for (const a of screen.getAllByRole('link', { current: 'page' })) expect(a).toHaveTextContent('Resumen');
    });

    it('dentro de una sección, el Resumen no queda resaltado', () => {
        ruta = '/dashboard/configuracion/canales';
        render(<NavConfiguracion entradas={ENTRADAS} />);
        expect(screen.getAllByRole('link', { name: /Resumen/ }).every((a) => !a.getAttribute('aria-current'))).toBe(true);
    });
});
