import { readFileSync } from 'node:fs';
import { getMenusForRole } from '../menus';
import { cargarConocimiento, rutaDelConocimiento } from './cargar-conocimiento';
import { MARCA_FIN, temaDeRuta, validarConocimiento } from './conocimiento';
import { GLOSARIO_ID, buscar, crearIndice } from './buscador';

/**
 * El contenido real del centro de ayuda: la Parte 1 de docs/conocimiento/AGENIA.md.
 * La ayuda cubre el 100% del menú del administrador. Si agregas una opción al
 * menú (lib/menus.ts), esta prueba falla hasta que escribas su tema en el .md.
 */
describe('Contenido del centro de ayuda (docs/conocimiento/AGENIA.md)', () => {
    const contenido = cargarConocimiento();
    const { temas, categorias, glosario, portada } = contenido;
    // Con todas las opciones condicionales encendidas: la ayuda las explica todas.
    const menuCompleto = getMenusForRole('ORG_ADMIN', { conEspejo: true, conAvisos: true });

    it('el archivo es coherente: enlaces que existen, categorías con temas, guías y preguntas en cada tema', () => {
        expect(validarConocimiento(contenido)).toEqual([]);
    });

    it.each(menuCompleto.map((m) => [m.label, m.href]))('«%s» (%s) tiene su tema, con el mismo título del menú', (label, href) => {
        const tema = temaDeRuta(temas, href);
        expect(tema).toBeDefined();
        expect(tema?.titulo).toBe(label);
    });

    it('no hay temas de rutas que el menú del administrador no tiene', () => {
        const rutas = new Set(menuCompleto.map((m) => m.href));
        for (const t of temas.filter((tema) => tema.href)) {
            expect(rutas.has(t.href as string)).toBe(true);
        }
    });

    it('cada ruta del menú tiene un solo tema y los ids no se repiten', () => {
        const hrefs = temas.flatMap((t) => (t.href ? [t.href] : []));
        expect(new Set(hrefs).size).toBe(hrefs.length);
        const ids = temas.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).not.toContain(GLOSARIO_ID);
    });

    it.each(temas.map((t) => [t.titulo, t]))('«%s» está completa: resumen, para qué sirve, pasos y preguntas', (_titulo, tema) => {
        expect(tema.resumen.length).toBeGreaterThan(20);
        expect(tema.paraQueSirve.length).toBeGreaterThan(60);
        expect(tema.guias.length).toBeGreaterThan(0);
        expect(tema.preguntas.length).toBeGreaterThan(0);
        for (const g of tema.guias) expect(g.pasos.length).toBeGreaterThan(0);
        expect(categorias.some((c) => c.id === tema.categoria)).toBe(true);
    });

    it('las opciones que no tienen todas las clínicas dicen cuándo aparecen', () => {
        const siempre = new Set(getMenusForRole('ORG_ADMIN').map((m) => m.href));
        for (const m of menuCompleto.filter((item) => !siempre.has(item.href))) {
            expect(temaDeRuta(temas, m.href)?.disponibilidad).toBeTruthy();
        }
    });

    it('el inicio tiene lo que destaca: la categoría «inicio», «Primeros pasos», búsquedas frecuentes y glosario', () => {
        expect(categorias.map((c) => c.id)).toContain('inicio');
        expect(temas.find((t) => t.id === 'primeros-pasos')?.categoria).toBe('inicio');
        expect(portada.presentacion.length).toBeGreaterThan(20);
        expect(portada.busquedasFrecuentes.length).toBeGreaterThan(0);
        expect(glosario.length).toBeGreaterThan(portada.glosarioDestacado.length);
    });

    it('cada búsqueda frecuente encuentra algo', () => {
        const indice = crearIndice(temas, glosario);
        for (const b of portada.busquedasFrecuentes) expect(buscar(indice, b).resultados.length).toBeGreaterThan(0);
    });

    it('el archivo conserva su Parte 2 (el conocimiento del sistema) y su bitácora después de la ayuda', () => {
        const md = readFileSync(rutaDelConocimiento(), 'utf8');
        const despues = md.slice(md.indexOf(MARCA_FIN));
        expect(despues).toMatch(/^# Parte 2 · Cómo funciona AgenIA$/m);
        expect(despues).toMatch(/^# Parte 3 · Bitácora de cambios$/m);
        expect(md).toMatch(/^\*\*Última actualización:\*\* \d{4}-\d{2}-\d{2}$/m);
    });
});
