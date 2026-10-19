import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AyudaClient from './AyudaClient';
import { cargarConocimiento } from '@/lib/ayuda/cargar-conocimiento';
import { parsearConocimiento } from '@/lib/ayuda/conocimiento';
import { MD_MINIMO } from '@/lib/ayuda/conocimiento.fixture';
import { getMenusForRole } from '@/lib/menus';

const CONTENIDO = cargarConocimiento();
const TODAS = getMenusForRole('ORG_ADMIN', { conEspejo: true, conAvisos: true }).map((m) => m.href);
const SIN_ESPEJO = getMenusForRole('ORG_ADMIN').map((m) => m.href);

function abrir(props: Partial<Parameters<typeof AyudaClient>[0]> = {}) {
    return render(<AyudaClient contenido={CONTENIDO} temaInicial={null} consultaInicial="" rutasDisponibles={TODAS} {...props} />);
}

type Usuario = ReturnType<typeof userEvent.setup>;

/**
 * Escribe la búsqueda de una vez (pegada): tecla por tecla, cada letra relanza
 * la búsqueda y la prueba se vuelve lenta bajo la carga de la suite completa.
 */
async function buscarTexto(user: Usuario, texto: string) {
    const entrada = screen.getByRole('combobox');
    await user.clear(entrada);
    await user.click(entrada);
    await user.paste(texto);
}

/** Centro de ayuda: inicio, guía de cada opción, glosario y buscador. */
describe('AyudaClient', () => {
    it('el inicio tiene una tarjeta por cada opción del menú', () => {
        abrir();
        for (const t of CONTENIDO.temas.filter((tema) => tema.href)) {
            expect(screen.getAllByText(t.titulo).some((el) => el.closest('button'))).toBe(true);
        }
    });

    it('marca las opciones que no están en el menú de la clínica', () => {
        abrir({ rutasDisponibles: SIN_ESPEJO });
        // Espejo, Bandeja y Avisos masivos.
        expect(screen.getAllByText('No está en el menú de tu clínica')).toHaveLength(3);
    });

    it('buscar muestra resultados y abrir uno lleva a su guía paso a paso', async () => {
        const user = userEvent.setup();
        abrir();

        await buscarTexto(user, 'abrir cupos');
        const opciones = await screen.findAllByRole('option');
        expect(opciones[0]).toHaveTextContent('Abrir cupos para un médico');

        await user.click(opciones[0]);

        expect(screen.getByRole('heading', { level: 2, name: 'Agendas (Slots)' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Abrir Agendas \(Slots\)/ })).toHaveAttribute('href', '/dashboard/agenda');
        // Las palabras buscadas quedan resaltadas en la guía.
        expect(screen.getByText('Las palabras de tu búsqueda aparecen resaltadas.')).toBeInTheDocument();
    });

    it('con el teclado: flechas para moverse y Enter para abrir', async () => {
        const user = userEvent.setup();
        abrir();

        await buscarTexto(user, 'contraseña');
        await user.keyboard('{ArrowDown}');
        const segundo = screen.getAllByRole('option')[1];
        expect(segundo).toHaveAttribute('aria-selected', 'true');
        const titulo = segundo.querySelector('p.font-semibold')?.textContent ?? '';
        expect(titulo).toMatch(/contraseña/i);

        await user.keyboard('{Enter}');

        expect(screen.queryByRole('option')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 4, name: titulo })).toBeInTheDocument();
    });

    it('una pregunta frecuente con palabras resaltadas se lee de corrido (no se reparte a lo ancho)', async () => {
        const user = userEvent.setup();
        abrir();

        await buscarTexto(user, 'cómo borro un cupo');
        expect(screen.getAllByRole('option')[0]).toHaveTextContent('¿Cómo borro un cupo?');
        await user.keyboard('{Enter}');

        // El resumen plegable es flex: el texto resaltado va en un solo hijo.
        const pregunta = screen.getByText((_, el) => el?.tagName === 'SPAN' && el.parentElement?.tagName === 'SUMMARY' && el.textContent === '¿Cómo borro un cupo?');
        expect([...pregunta.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['borro', 'cupo']);
        // Se despliega sola al llegar desde la búsqueda (en el siguiente cuadro).
        await waitFor(() => expect(pregunta.closest('details')).toHaveAttribute('open'));
    });

    it('una errata leve encuentra igual; una grave no, pero sugiere la palabra correcta', async () => {
        const user = userEvent.setup();
        abrir();

        // Un error: «padorn» ya encuentra el padrón.
        await buscarTexto(user, 'padorn');
        expect((await screen.findAllByRole('option')).length).toBeGreaterThan(0);

        // Dos errores en una palabra corta: no hay resultados, pero sí sugerencia.
        await buscarTexto(user, 'padxxn');
        expect(await screen.findByText(/No encontramos nada/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Reportar Falla/ })).toHaveAttribute('href', '/dashboard/soporte');

        await user.click(screen.getByRole('button', { name: '«padrón»' }));
        expect(screen.getByRole('combobox')).toHaveValue('padrón');
        expect((await screen.findAllByRole('option')).length).toBeGreaterThan(0);
    });

    it('abre directo el tema que viene en la dirección', () => {
        abrir({ temaInicial: 'padron' });
        expect(screen.getByRole('heading', { level: 2, name: 'Padrón EPS (Altas)' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Paso a paso' })).toBeInTheDocument();
    });

    it('un tema que no existe en la dirección cae al inicio', () => {
        abrir({ temaInicial: 'no-existe' });
        expect(screen.getByRole('heading', { name: 'Operación diaria' })).toBeInTheDocument();
    });

    it('el glosario se abre desde el inicio', async () => {
        const user = userEvent.setup();
        abrir();
        await user.click(screen.getByRole('button', { name: /Qué significa cada término/ }));
        expect(screen.getByRole('heading', { level: 2, name: /Glosario/ })).toBeInTheDocument();
        expect(screen.getByText('BSUID')).toBeInTheDocument();
    });

    it('no tiene texto propio: con otro archivo de conocimiento muestra solo lo de ese archivo', async () => {
        const user = userEvent.setup();
        render(<AyudaClient contenido={parsearConocimiento(MD_MINIMO)} temaInicial={null} consultaInicial="" rutasDisponibles={['/dashboard/agenda']} />);

        expect(screen.getByText('Ayuda de prueba para la clínica.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Ver turnos' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Agenda y catálogos' })).toBeInTheDocument();
        expect(screen.getByText('Turno y 1 término más.')).toBeInTheDocument();
        expect(screen.getByText(/Por dónde empezar a usar la clínica de prueba/)).toBeInTheDocument();
        // Nada del archivo real.
        expect(screen.queryByText('Visión General')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Abrir cupos' })).not.toBeInTheDocument();

        await buscarTexto(user, 'abrir turnos');
        const opciones = await screen.findAllByRole('option');
        expect(opciones[0]).toHaveTextContent('Abrir turnos');
        await user.click(opciones[0]);
        expect(screen.getByRole('heading', { level: 2, name: 'Agenda' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Abrir Agenda/ })).toHaveAttribute('href', '/dashboard/agenda');
    });

    it('«/» lleva al buscador', async () => {
        const user = userEvent.setup();
        abrir();
        await user.keyboard('/');
        expect(screen.getByRole('combobox')).toHaveFocus();
    });
});
