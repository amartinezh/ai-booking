import { NextRequest, NextResponse } from 'next/server';
import { runValidatePadronCsv } from '@/app/dashboard/padron/padron-service';

// Route Handler, NO Server Action — a propósito. Ver el comentario de
// cabecera de padron-service.ts: un csvText de varios MB revienta el
// codificador de argumentos de las Server Actions (react-server-dom) antes
// de que el código de la función llegue a ejecutarse. Un Route Handler lee
// el body con el parser JSON estándar de Node, sin ese límite.
export async function POST(req: NextRequest): Promise<NextResponse> {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { success: false, error: 'Cuerpo de la solicitud inválido (se esperaba JSON).' },
            { status: 400 },
        );
    }

    const { csvText, epsId } = (body ?? {}) as { csvText?: unknown; epsId?: unknown };
    const result = await runValidatePadronCsv(
        typeof csvText === 'string' ? csvText : '',
        typeof epsId === 'string' ? epsId : '',
    );
    return NextResponse.json(result);
}
