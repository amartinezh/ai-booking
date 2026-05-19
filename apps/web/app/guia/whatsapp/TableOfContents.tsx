'use client';

import { useEffect, useState } from 'react';

type Section = {
    id: string;
    label: string;
    /** Indentación visual (sub-secciones). */
    sub?: boolean;
};

type Props = {
    sections: Section[];
};

/**
 * TOC sticky con tracking de la sección visible.
 * Usa IntersectionObserver — degrada elegante si no está soportado.
 */
export default function TableOfContents({ sections }: Props) {
    const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');

    useEffect(() => {
        if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
            return;
        }

        const ids = sections.map(s => s.id);
        const elements = ids
            .map(id => document.getElementById(id))
            .filter((el): el is HTMLElement => el !== null);

        const observer = new IntersectionObserver(
            entries => {
                // Tomamos la primera sección "visible" más cercana al top.
                const visible = entries
                    .filter(e => e.isIntersecting)
                    .sort(
                        (a, b) =>
                            a.boundingClientRect.top - b.boundingClientRect.top,
                    );
                if (visible[0]) {
                    setActiveId(visible[0].target.id);
                }
            },
            {
                rootMargin: '-25% 0px -65% 0px',
                threshold: 0,
            },
        );

        elements.forEach(el => observer.observe(el));
        return () => observer.disconnect();
    }, [sections]);

    return (
        <nav aria-label="Tabla de contenidos" className="space-y-1 text-sm">
            <p className="px-3 mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">
                Contenido
            </p>
            {sections.map(s => {
                const active = s.id === activeId;
                return (
                    <a
                        key={s.id}
                        href={`#${s.id}`}
                        className={`block rounded-lg px-3 py-1.5 transition-colors leading-snug ${
                            s.sub ? 'pl-7 text-xs' : ''
                        } ${
                            active
                                ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold'
                                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100'
                        }`}
                    >
                        {s.label}
                    </a>
                );
            })}
        </nav>
    );
}
