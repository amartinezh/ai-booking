// La opción del menú que se resalta (docs/PLAN_NAVEGACION.md §4). Vive aparte, sin
// importar nada, porque la usa el menú del panel, que es un componente de cliente
// en el layout de todas las páginas: importar `@agenia/shared` ahí metería todo el
// paquete (CommonJS, sin recorte) en el JavaScript de cada página.

/**
 * La opción del menú en la que está quien navega: la de dirección más larga que
 * contiene la ruta (`/dashboard/espejo/avisos` es Avisos masivos, no el Espejo).
 * La Visión General solo en `/dashboard` exacto: si no, toda pantalla fuera del
 * menú la marcaría. Devuelve el `href`, o null si la ruta no es de ninguna opción.
 */
export function opcionActiva(menus: readonly { href: string }[], ruta: string): string | null {
    const sinConsulta = (ruta ?? '').split(/[?#]/)[0];
    const r = sinConsulta.length > 1 ? sinConsulta.replace(/\/+$/, '') : sinConsulta;
    let mejor: string | null = null;
    for (const { href } of menus) {
        const contiene = r === href || (href !== '/dashboard' && r.startsWith(`${href}/`));
        if (contiene && (mejor === null || href.length > mejor.length)) mejor = href;
    }
    return mejor;
}
