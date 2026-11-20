import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/politica-datos', () => ({ setMyPaginaPoliticaDatos: jest.fn() }));
jest.mock('@/app/actions/settings', () => ({ setMyAutorizacionDatos: jest.fn() }));

import PaginaPoliticaDatos from './PaginaPoliticaDatos';
import AutorizacionDatosSetting from './AutorizacionDatosSetting';
import { setMyPaginaPoliticaDatos } from '@/app/actions/politica-datos';
import { setMyAutorizacionDatos } from '@/app/actions/settings';

const mockSetPagina = setMyPaginaPoliticaDatos as jest.Mock;
const mockSetAutorizacion = setMyAutorizacionDatos as jest.Mock;

const ENLACE = 'https://app.hsvpanserma.agenia.co/politica-de-datos/97f18182-d0d9-4a3b-9eb6-4fbc031b917c';
const VACIOS = {
    razonSocial: '',
    nit: '',
    municipio: '',
    direccion: '',
    telefono: '',
    correo: '',
    area: '',
    horario: '',
    vigenteDesde: '',
};
const COMPLETOS = {
    ...VACIOS,
    razonSocial: 'E.S.E. Hospital San Vicente de Paúl de Anserma',
    municipio: 'Anserma, Caldas',
    direccion: 'Carrera 5 Calle 1 Bis',
    telefono: '(606) 853 8860',
    correo: 'siau@hsvpanserma.gov.co',
    area: 'Oficina de Atención al Usuario (SIAU)',
    vigenteDesde: '2026-12-01',
};
const pagina = (o: Record<string, unknown> = {}) => ({
    datos: VACIOS,
    publicada: false,
    ruta: '/politica-de-datos/97f18182-d0d9-4a3b-9eb6-4fbc031b917c',
    enlace: ENLACE,
    hoy: '2026-11-20',
    ultimoCambio: null,
    ...o,
});

describe('PaginaPoliticaDatos', () => {
    beforeEach(() => jest.clearAllMocks());

    it('sin publicar: lo dice, abre el formulario y no deja guardar sin cambios', () => {
        render(<PaginaPoliticaDatos inicial={pagina()} enlaceGuardado="" onUsarEnlace={jest.fn()} ocupado={false} />);
        expect(screen.getByRole('status')).toHaveTextContent('Sin publicar');
        expect(screen.getByLabelText(/Nombre o razón social \*/)).toBeInTheDocument();
        expect(screen.getByLabelText(/NIT \(opcional\)/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Publicar la página' })).toBeDisabled();
    });

    it('guardar envía lo escrito y muestra el enlace publicado', async () => {
        mockSetPagina.mockResolvedValue({
            success: true,
            pagina: pagina({
                datos: COMPLETOS,
                publicada: true,
                ultimoCambio: { en: '2026-11-20T17:00:00.000Z', por: 'admin@clinica.co' },
            }),
        });
        render(<PaginaPoliticaDatos inicial={pagina()} enlaceGuardado="" onUsarEnlace={jest.fn()} ocupado={false} />);
        await userEvent.type(screen.getByLabelText(/Nombre o razón social/), 'E.S.E. Hospital');
        await userEvent.click(screen.getByRole('button', { name: 'Publicar la página' }));
        expect(mockSetPagina).toHaveBeenCalledWith(expect.objectContaining({ razonSocial: 'E.S.E. Hospital' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Publicada'));
        expect(screen.getByText(ENLACE)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Ver la página/ })).toHaveAttribute('href', pagina().ruta);
        expect(screen.getByText(/Último cambio:/)).toHaveTextContent('admin@clinica.co');
    });

    it('si falta un dato, lo dice y marca el campo', async () => {
        mockSetPagina.mockResolvedValue({ success: false, error: 'Escriba: correo.', campo: 'correo' });
        render(<PaginaPoliticaDatos inicial={pagina()} enlaceGuardado="" onUsarEnlace={jest.fn()} ocupado={false} />);
        await userEvent.type(screen.getByLabelText(/Nombre o razón social/), 'X');
        await userEvent.click(screen.getByRole('button', { name: 'Publicar la página' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Escriba: correo.');
        expect(screen.getByLabelText(/Correo para consultas/)).toHaveAttribute('aria-invalid', 'true');
    });

    it('publicada: el formulario se abre a pedido y ofrece usar el enlace', async () => {
        const usar = jest.fn();
        render(
            <PaginaPoliticaDatos
                inicial={pagina({ datos: COMPLETOS, publicada: true })}
                enlaceGuardado="https://otro.gov.co/datos"
                onUsarEnlace={usar}
                ocupado={false}
            />,
        );
        expect(screen.queryByLabelText(/Nombre o razón social/)).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Usar este enlace en la autorización' }));
        expect(usar).toHaveBeenCalledWith(ENLACE);
        await userEvent.click(screen.getByRole('button', { name: 'Editar los datos de la clínica' }));
        expect(screen.getByLabelText(/Nombre o razón social/)).toHaveValue(COMPLETOS.razonSocial);
    });

    it('si ya es el enlace del asistente, lo dice y no ofrece usarlo', () => {
        render(
            <PaginaPoliticaDatos
                inicial={pagina({ datos: COMPLETOS, publicada: true })}
                enlaceGuardado={ENLACE}
                onUsarEnlace={jest.fn()}
                ocupado={false}
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent('es el enlace que usa el asistente');
        expect(screen.queryByRole('button', { name: /Usar este enlace/ })).not.toBeInTheDocument();
    });
});

describe('AutorizacionDatosSetting con la página de AgenIA', () => {
    beforeEach(() => jest.clearAllMocks());

    it('«Usar este enlace» guarda solo el enlace, con lo demás como estaba', async () => {
        mockSetAutorizacion.mockResolvedValue({
            success: true,
            autorizacionDatos: { encendida: false, urlPolitica: ENLACE, version: '1', ultimoCambio: null },
        });
        render(
            <AutorizacionDatosSetting
                inicial={{ encendida: false, urlPolitica: '', version: '1', ultimoCambio: null }}
                nombreAsistente="Vicente"
                nombreClinica="Hospital San Vicente"
                estilo="FORMAL"
                pagina={pagina({ datos: COMPLETOS, publicada: true })}
            />,
        );
        // Lo que se esté editando arriba no viaja con este botón.
        await userEvent.click(screen.getByRole('switch'));
        await userEvent.click(screen.getByRole('button', { name: 'Usar este enlace en la autorización' }));
        expect(mockSetAutorizacion).toHaveBeenCalledWith({ encendida: false, urlPolitica: ENLACE, version: '1' });
        await waitFor(() => expect(screen.getByLabelText(/Enlace de la política/)).toHaveValue(ENLACE));
        expect(screen.getAllByRole('status')[1]).toHaveTextContent('es el enlace que usa el asistente');
    });

    it('sin enlace y sin página publicada, sugiere publicarla', () => {
        render(
            <AutorizacionDatosSetting
                inicial={{ encendida: false, urlPolitica: '', version: '1', ultimoCambio: null }}
                nombreAsistente="Vicente"
                nombreClinica="Hospital San Vicente"
                estilo="FORMAL"
                pagina={pagina()}
            />,
        );
        expect(screen.getByText(/¿La clínica no tiene una política publicada\?/)).toBeInTheDocument();
    });
});
