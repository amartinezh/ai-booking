'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@agenia/database';
import { getErrorMessage } from '@/lib/error';
import { tenantAdmin } from './espejo';

/**
 * Homologación manual de médicos: emparejar un código del HIS
 * (`MirrorCatalogEntry`) con un `DoctorProfile` de AgenIA, o deshacer ese
 * emparejamiento.
 *
 * Existe porque `MirrorCatalogEntry` (lo que sube el agente cada día) nunca
 * escribe `MirrorEntityMap` a propósito — ver mirror-catalog.service.ts:
 * "decidir a quién corresponde es de una persona". Antes de este panel, esa
 * persona necesitaba un `INSERT` a mano; ahora es un botón.
 */

type HisRow = {
    externalKey: string;
    label: string;
    cargo: string | null;
    lastSeenAt: Date;
    mapId: string | null;
    doctorId: string | null;
    doctorNombre: string | null;
};

type AgenIARow = {
    id: string;
    fullName: string;
    cedula: string;
    servicio: string | null;
    isActive: boolean;
    whatsappBookingEnabled: boolean;
    externalKey: string | null;
};

export async function getHomologacionData(): Promise<
    | { success: true; data: { his: HisRow[]; agenia: AgenIARow[] } }
    | { success: false; error: string }
> {
    const organizationId = await tenantAdmin();
    if (!organizationId) return { success: false, error: 'Sin permisos.' };

    const [catalogo, mapas, doctores] = await Promise.all([
        prisma.mirrorCatalogEntry.findMany({
            where: { organizationId, entityType: 'DOCTOR' },
            orderBy: { label: 'asc' },
        }),
        prisma.mirrorEntityMap.findMany({
            where: { organizationId, entityType: 'DOCTOR' },
        }),
        prisma.doctorProfile.findMany({
            where: { organizationId },
            include: { service: { select: { name: true } } },
            orderBy: { fullName: 'asc' },
        }),
    ]);

    const mapaPorExternalKey = new Map(mapas.map((m) => [m.externalKey, m]));
    const mapaPorAgenIAId = new Map(mapas.map((m) => [m.agenIAId, m]));
    const doctoresPorId = new Map(doctores.map((d) => [d.id, d]));

    const his: HisRow[] = catalogo.map((c) => {
        const map = mapaPorExternalKey.get(c.externalKey);
        const doctor = map ? doctoresPorId.get(map.agenIAId) : undefined;
        const extra = c.extra as Record<string, unknown> | null;
        return {
            externalKey: c.externalKey,
            label: c.label,
            cargo: typeof extra?.cargo === 'string' ? extra.cargo : null,
            lastSeenAt: c.lastSeenAt,
            mapId: map?.id ?? null,
            doctorId: doctor?.id ?? null,
            doctorNombre: doctor?.fullName ?? null,
        };
    });

    const agenia: AgenIARow[] = doctores.map((d) => ({
        id: d.id,
        fullName: d.fullName,
        cedula: d.cedula,
        servicio: d.service?.name ?? null,
        isActive: d.isActive,
        whatsappBookingEnabled: d.whatsappBookingEnabled,
        externalKey: mapaPorAgenIAId.get(d.id)?.externalKey ?? null,
    }));

    return { success: true, data: { his, agenia } };
}

export async function homologarMedico(externalKey: string, doctorId: string) {
    const organizationId = await tenantAdmin();
    if (!organizationId) return { success: false, error: 'Sin permisos.' };
    if (!externalKey || !doctorId) return { success: false, error: 'Elige un médico de AgenIA para vincular.' };

    const [entrada, doctor] = await Promise.all([
        prisma.mirrorCatalogEntry.findFirst({
            where: { organizationId, entityType: 'DOCTOR', externalKey },
        }),
        prisma.doctorProfile.findFirst({ where: { organizationId, id: doctorId } }),
    ]);
    if (!entrada) return { success: false, error: 'Ese médico ya no aparece en el catálogo del HIS.' };
    if (!doctor) return { success: false, error: 'Ese médico de AgenIA no existe en esta clínica.' };

    try {
        await prisma.mirrorEntityMap.create({
            data: {
                organizationId,
                entityType: 'DOCTOR',
                externalKey,
                agenIAId: doctorId,
                externalLabel: entrada.label,
            },
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return {
                success: false,
                error: 'Alguno de los dos ya quedó vinculado por otra persona mientras tanto — recarga la página.',
            };
        }
        return { success: false, error: getErrorMessage(e) || 'No se pudo homologar.' };
    }

    revalidatePath('/dashboard/espejo/homologacion');
    return { success: true };
}

/**
 * Deshace un emparejamiento. NO borra ni desactiva nada más: si el médico ya
 * tenía cupos generados en AgenIA, esos cupos se quedan como están hasta que
 * alguien los apague a mano en /dashboard/medicos — desvincular solo corta
 * la homologación, no reversa lo que ya se sincronizó.
 */
export async function deshomologarMedico(mapId: string) {
    const organizationId = await tenantAdmin();
    if (!organizationId) return { success: false, error: 'Sin permisos.' };
    if (!mapId) return { success: false, error: 'Falta el emparejamiento a deshacer.' };

    const { count } = await prisma.mirrorEntityMap.deleteMany({
        where: { id: mapId, organizationId, entityType: 'DOCTOR' },
    });
    if (count === 0) {
        return { success: false, error: 'Ese emparejamiento ya no existe.' };
    }

    revalidatePath('/dashboard/espejo/homologacion');
    return { success: true };
}
