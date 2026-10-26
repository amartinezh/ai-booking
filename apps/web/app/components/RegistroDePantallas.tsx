'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { registrarPantalla } from '@/app/actions/pantallas';

/**
 * 👁️ Anota en la Actividad de usuarios cada pantalla que abre la persona (el
 * servidor decide si es una pantalla que se anota y no repite la misma en 30
 * minutos). No pinta nada y nunca interrumpe la navegación.
 */
export default function RegistroDePantallas() {
    const ruta = usePathname();
    useEffect(() => {
        if (ruta) registrarPantalla(ruta).catch(() => undefined);
    }, [ruta]);
    return null;
}
