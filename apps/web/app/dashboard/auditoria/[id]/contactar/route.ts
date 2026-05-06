import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '../../../../../lib/session';

export async function POST(
    req: NextRequest,
    // 1. Tipar params como una Promesa
    { params }: { params: Promise<{ id: string }> }
) {
    // Obtenemos la sesión para sacar el organizationId y el email del agente
    const session = await getSession();
    if (!session || !session.organizationId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Resolver los params con await
    const { id } = await params;

    const body = await req.json();

    // 3. Inyectamos la información de la sesión en el body para el backend de NestJS
    const payload = {
        ...body,
        organizationId: session.organizationId,
        contactedBy: session.email,
    };

    // 4. Asegurarnos que la URL del API no tenga doble slash
    const baseUrl = (process.env.API_URL || 'https://api:3000').replace(/\/$/, '');

    const res = await fetch(
        `${baseUrl}/auditoria/${id}/contactar`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }
    );

    if (!res.ok) {
        return NextResponse.json({ error: 'Failed' }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
}