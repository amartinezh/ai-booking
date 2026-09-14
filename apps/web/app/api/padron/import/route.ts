import { NextRequest, NextResponse } from 'next/server';
import { runImportPadronCsv } from '@/app/dashboard/padron/padron-service';

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

    const { csvText, epsId, fileName, confirmDeactivation } = (body ?? {}) as {
        csvText?: unknown;
        epsId?: unknown;
        fileName?: unknown;
        confirmDeactivation?: unknown;
    };
    const result = await runImportPadronCsv(
        typeof csvText === 'string' ? csvText : '',
        typeof epsId === 'string' ? epsId : '',
        typeof fileName === 'string' ? fileName : 'padron.csv',
        confirmDeactivation === true,
    );
    return NextResponse.json(result);
}
