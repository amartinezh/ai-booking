'use server';

// ─────────────────────────────────────────────────────────────
// PADRÓN EPS — la ÚNICA operación de esta pantalla que sigue siendo una
// Server Action de verdad: poblar el selector de EPS. Su payload es minúsculo
// (una lista de {id, name}), muy lejos del límite de 1.000.000 de "slots" del
// codificador de Flight que sí golpean las otras tres operaciones.
//
// Validar, importar y el reporte completo de errores viven en
// `padron-service.ts` (lógica pura, sin 'use server') y se exponen como
// Route Handlers en app/api/padron/{validate,import,error-report}/route.ts —
// ver el comentario de cabecera de `padron-service.ts` para el porqué
// completo (un csvText de varios MB revienta el decodificador de argumentos
// de las Server Actions antes de que el código de la función llegue a
// ejecutarse — pasó en producción con el archivo real de Sura, 2026-09-14).
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma';
import { requireOrgAdmin, type EpsOption } from './padron-service';

export type { EpsOption, PadronValidationSummary, PadronImportResult } from './padron-service';

/** Para poblar el selector de EPS de la pantalla de carga. */
export async function getActiveEpsOptionsAction(): Promise<
    { success: true; eps: EpsOption[] } | { success: false; error: string }
> {
    const auth = await requireOrgAdmin();
    if (!auth) return { success: false, error: 'Acceso denegado' };

    const eps = await prisma.eps.findMany({
        where: { organizationId: auth.organizationId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });
    return { success: true, eps };
}
