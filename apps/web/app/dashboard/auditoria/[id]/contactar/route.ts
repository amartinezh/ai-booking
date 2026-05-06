import { NextRequest, NextResponse } from 'next/server';

export async function POST(
    req: NextRequest,
    // 1. Tipar params como una Promesa
    { params }: { params: Promise<{ id: string }> }
) {
    // 2. Resolver los params con await
    const { id } = await params;

    const body = await req.json();

    // 3. Utilizar el id resuelto en la URL
    const res = await fetch(
        `${process.env.API_URL}/auditoria/${id}/contactar`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }
    );

    if (!res.ok) {
        return NextResponse.json({ error: 'Failed' }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
}