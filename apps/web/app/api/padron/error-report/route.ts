import { NextRequest, NextResponse } from 'next/server';
import { runGetPadronFullErrorReport } from '@/app/dashboard/padron/padron-service';

// Route Handler, NO Server Action — mismo motivo que validate/route.ts.
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

    const { csvText } = (body ?? {}) as { csvText?: unknown };
    const result = await runGetPadronFullErrorReport(typeof csvText === 'string' ? csvText : '');
    return NextResponse.json(result);
}
