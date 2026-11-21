import { fireEvent, render, screen } from '@testing-library/react';
import { AvisoSinGuardar, MENSAJE_SIN_GUARDAR, useAvisoAlSalir, useSinGuardar } from './CambiosSinGuardar';
import { useState } from 'react';

function Formulario({ sucio }: { sucio: boolean }) {
    useAvisoAlSalir(sucio);
    return (
        <>
            <AvisoSinGuardar visible={sucio} />
            <a href="/dashboard/usuarios">Otra pantalla</a>
            <a href={`${window.location.pathname}#plazo`}>Ancla</a>
            <a href="/dashboard/usuarios" target="_blank" rel="noreferrer">
                Otra pestaña
            </a>
        </>
    );
}

function ConClave() {
    const [nombre, setNombre] = useState('Ana');
    const [clave, setClave] = useState('');
    const { sucio, marcarGuardado } = useSinGuardar({ nombre, clave });
    return (
        <>
            <input aria-label="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <input aria-label="clave" value={clave} onChange={(e) => setClave(e.target.value)} />
            <button
                onClick={() => {
                    setClave('');
                    marcarGuardado({ nombre, clave: '' });
                }}
            >
                Guardar
            </button>
            <AvisoSinGuardar visible={sucio} />
        </>
    );
}

/** Pulsa un enlace y dice si el clic siguió su camino (como lo recibiría el `Link` de Next). */
const pulsar = (nombre: string) => {
    let llego = false;
    const alLlegar = (e: Event) => {
        llego = true;
        e.preventDefault(); // jsdom no navega
    };
    window.addEventListener('click', alLlegar);
    screen.getByRole('link', { name: nombre }).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    window.removeEventListener('click', alLlegar);
    return { frenado: !llego };
};

describe('Cambios sin guardar (docs/PLAN_NAVEGACION.md §5.3)', () => {
    let confirmar: jest.SpyInstance;
    beforeEach(() => {
        confirmar = jest.spyOn(window, 'confirm').mockReturnValue(false);
    });
    afterEach(() => confirmar.mockRestore());

    it('sin cambios, no dice nada ni pregunta al salir', () => {
        render(<Formulario sucio={false} />);
        expect(screen.queryByText('Hay cambios sin guardar')).not.toBeInTheDocument();
        pulsar('Otra pantalla');
        expect(confirmar).not.toHaveBeenCalled();
    });

    it('con cambios lo dice, y salir a otra pantalla pregunta; si no confirma, se queda', () => {
        render(<Formulario sucio />);
        expect(screen.getByText('Hay cambios sin guardar')).toBeInTheDocument();
        expect(pulsar('Otra pantalla').frenado).toBe(true);
        expect(confirmar).toHaveBeenCalledWith(MENSAJE_SIN_GUARDAR);
    });

    it('si confirma, sale', () => {
        confirmar.mockReturnValue(true);
        render(<Formulario sucio />);
        expect(pulsar('Otra pantalla').frenado).toBe(false);
    });

    it('un ancla de la misma sección u otra pestaña no pregunta', () => {
        render(<Formulario sucio />);
        pulsar('Ancla');
        pulsar('Otra pestaña');
        expect(confirmar).not.toHaveBeenCalled();
    });

    it('con dos formularios con cambios pregunta una sola vez', () => {
        render(
            <>
                <Formulario sucio />
                <AvisoSinGuardar visible={false} />
            </>,
        );
        render(<Formulario sucio />);
        fireEvent.click(screen.getAllByRole('link', { name: 'Otra pantalla' })[0]);
        expect(confirmar).toHaveBeenCalledTimes(1);
    });

    it('recargar o cerrar con cambios lo frena; al quitar el formulario ya no', () => {
        const { unmount } = render(<Formulario sucio />);
        const con = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(con);
        expect(con.defaultPrevented).toBe(true);
        unmount();
        const sin = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(sin);
        expect(sin.defaultPrevented).toBe(false);
    });

    it('useSinGuardar: al escribir queda con cambios; al guardar, ya no (y la clave limpia no cuenta)', () => {
        render(<ConClave />);
        expect(screen.queryByText('Hay cambios sin guardar')).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('clave'), { target: { value: 'secreta' } });
        expect(screen.getByText('Hay cambios sin guardar')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(screen.queryByText('Hay cambios sin guardar')).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('nombre'), { target: { value: 'Luz' } });
        expect(screen.getByText('Hay cambios sin guardar')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('nombre'), { target: { value: 'Ana' } });
        expect(screen.queryByText('Hay cambios sin guardar')).not.toBeInTheDocument();
    });
});
