import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '../../../../../lib/session';
import { prisma } from '../../../../../lib/prisma';

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

    try {
        // 3. Verificamos que el log exista y pertenezca a la organización
        const log = await prisma.interactionLog.findUnique({
            where: { id },
        });

        if (!log) {
            return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
        }

        if (log.organizationId !== session.organizationId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // 4. Actualizamos DIRECTAMENTE en la base de datos
        const updated = await prisma.interactionLog.update({
            where: { id },
            data: {
                contactedAt: new Date(),
                contactedBy: session.email,
                contactNotes: body.notes || null,
            },
        });

        return NextResponse.json(updated);
    } catch (error) {
        console.error('Error al contactar paciente:', error);
        return NextResponse.json({ error: 'Error de base de datos' }, { status: 500 });
    }
}