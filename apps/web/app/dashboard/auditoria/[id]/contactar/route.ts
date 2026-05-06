import { NextRequest, NextResponse } from 'next/server';

export async function POST(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    const body = await req.json();
    const res = await fetch(
        `${process.env.API_URL}/auditoria/${params.id}/contactar`,
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