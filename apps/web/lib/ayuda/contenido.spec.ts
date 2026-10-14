import { getMenusForRole } from '../menus';
import { CATEGORIAS, GLOSARIO, TEMAS, temaDeRuta } from './contenido';
import { GLOSARIO_ID } from './buscador';

/**
 * La ayuda cubre el 100% del menú del administrador. Si agregas una opción al
 * menú (lib/menus.ts), esta prueba falla hasta que escribas su guía.
 */
describe('Contenido del centro de ayuda', () => {
    // Con todas las opciones condicionales encendidas: la ayuda las explica todas.
    const menuCompleto = getMenusForRole('ORG_ADMIN', { conEspejo: true, conAvisos: true });

    it.each(menuCompleto.map((m) => [m.label, m.href]))('«%s» (%s) tiene su guía, con el mismo título del menú', (label, href) => {
        const tema = temaDeRuta(href);
        expect(tema).toBeDefined();
        expect(tema?.titulo).toBe(label);
    });

    it('no hay guías de rutas que el menú del administrador no tiene', () => {
        const rutas = new Set(menuCompleto.map((m) => m.href));
        for (const t of TEMAS.filter((tema) => tema.href)) {
            expect(rutas.has(t.href as string)).toBe(true);
        }
    });

    it('cada ruta del menú tiene una sola guía y los ids no se repiten', () => {
        const hrefs = TEMAS.flatMap((t) => (t.href ? [t.href] : []));
        expect(new Set(hrefs).size).toBe(hrefs.length);
        const ids = TEMAS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).not.toContain(GLOSARIO_ID);
    });

    it.each(TEMAS.map((t) => [t.titulo, t]))('«%s» está completa: resumen, para qué sirve, pasos y preguntas', (_titulo, tema) => {
        expect(tema.resumen.length).toBeGreaterThan(20);
        expect(tema.paraQueSirve.length).toBeGreaterThan(60);
        expect(tema.guias.length).toBeGreaterThan(0);
        expect(tema.preguntas.length).toBeGreaterThan(0);
        for (const g of tema.guias) expect(g.pasos.length).toBeGreaterThan(0);
        expect(CATEGORIAS.some((c) => c.id === tema.categoria)).toBe(true);
    });

    it('los temas relacionados existen', () => {
        const ids = new Set([...TEMAS.map((t) => t.id), GLOSARIO_ID]);
        for (const t of TEMAS) {
            for (const r of t.relacionados) expect(ids.has(r)).toBe(true);
            expect(t.relacionados).not.toContain(t.id);
        }
    });

    it('las opciones que no tienen todas las clínicas dicen cuándo aparecen', () => {
        const siempre = new Set(getMenusForRole('ORG_ADMIN').map((m) => m.href));
        for (const m of menuCompleto.filter((item) => !siempre.has(item.href))) {
            expect(temaDeRuta(m.href)?.disponibilidad).toBeTruthy();
        }
    });

    it('cada término del glosario apunta a un tema que existe', () => {
        const ids = new Set(TEMAS.map((t) => t.id));
        for (const g of GLOSARIO) if (g.temaId) expect(ids.has(g.temaId)).toBe(true);
    });
});
