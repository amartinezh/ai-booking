'use client';

import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────
// Cambios sin guardar (docs/PLAN_NAVEGACION.md §5.3): lo que se escribe tiene su
// botón «Guardar». Si quedan cambios, la tarjeta lo dice, y salir de la sección
// (por un enlace del panel, recargar o cerrar la pestaña) pide confirmación.
// ─────────────────────────────────────────────────────────────

export const MENSAJE_SIN_GUARDAR = 'Hay cambios sin guardar en esta sección. ¿Salir sin guardarlos?';

function alCerrar(e: BeforeUnloadEvent) {
    e.preventDefault();
    e.returnValue = '';
}

/**
 * En captura, antes que el `Link` de Next: un enlace a otra pantalla pregunta.
 * Las anclas de la misma sección, abrir en otra pestaña y las descargas no sacan
 * de la página; un enlace externo lo cubre `beforeunload`.
 */
function alPulsarEnlace(e: MouseEvent) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const enlace = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!enlace || enlace.target === '_blank' || enlace.hasAttribute('download')) return;
    const destino = new URL(enlace.href, window.location.href);
    if (destino.origin !== window.location.origin || destino.pathname === window.location.pathname) return;
    if (!window.confirm(MENSAJE_SIN_GUARDAR)) {
        e.preventDefault();
        e.stopPropagation();
    }
}

// Una sola vigilancia por página, aunque varios formularios tengan cambios: si
// no, salir preguntaría una vez por cada uno.
let formulariosConCambios = 0;

function vigilar(): () => void {
    if (++formulariosConCambios === 1) {
        window.addEventListener('beforeunload', alCerrar);
        document.addEventListener('click', alPulsarEnlace, true);
    }
    return () => {
        if (--formulariosConCambios === 0) {
            window.removeEventListener('beforeunload', alCerrar);
            document.removeEventListener('click', alPulsarEnlace, true);
        }
    };
}

/** Mientras `sucio`, salir de la sección pide confirmación. */
export function useAvisoAlSalir(sucio: boolean) {
    useEffect(() => {
        if (!sucio) return;
        return vigilar();
    }, [sucio]);
}

/**
 * Para los formularios que no guardan su última versión: compara lo que hay con
 * lo guardado. `marcarGuardado` recibe lo que quedó (sin las claves, que se
 * limpian al guardar); sin argumento, lo que hay ahora.
 */
export function useSinGuardar<T>(actual: T) {
    const texto = JSON.stringify(actual);
    const [guardado, setGuardado] = useState(texto);
    const sucio = texto !== guardado;
    useAvisoAlSalir(sucio);
    return { sucio, marcarGuardado: (quedo?: T) => setGuardado(quedo === undefined ? texto : JSON.stringify(quedo)) };
}

/** La frase junto al botón «Guardar». */
export function AvisoSinGuardar({ visible }: { visible: boolean }) {
    if (!visible) return null;
    return (
        <span aria-live="polite" className="mr-3 self-center text-sm font-medium text-amber-700 dark:text-amber-400">
            Hay cambios sin guardar
        </span>
    );
}
