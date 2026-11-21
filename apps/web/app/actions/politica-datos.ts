'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { diaLocal } from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { getErrorMessage } from '@/lib/error';
import { getSession } from '../../lib/session';
import { actorDeSesion, registrarActividad } from '@/lib/actividad/registrar';
import {
    camposCambiados,
    datosParaEditar,
    datosPublicables,
    rutaPoliticaDatos,
    validarDatosPolitica,
    type CampoPolitica,
} from '@/lib/politica-datos/datos';

/**
 * 📄 Página pública de la política de tratamiento de datos (2026-11-20,
 * lib/politica-datos). El administrador escribe la identificación del
 * responsable; con todo lo obligatorio, /politica-de-datos/<org> se publica y su
 * enlace se puede poner como el de la política en la autorización de datos.
 */

export interface PaginaPoliticaDatos {
    datos: Record<CampoPolitica, string>;
    publicada: boolean;
    ruta: string;
    /** El enlace completo, con el dominio con que se abrió el panel. */
    enlace: string;
    /** Hoy en la clínica (AAAA-MM-DD): para la fecha de vigencia. */
    hoy: string;
    ultimoCambio: { en: string; por: string } | null;
}

type Fila = {
    dataPolicyPage: unknown;
    dataPolicyPageUpdatedAt: Date | null;
    dataPolicyPageUpdatedBy: string | null;
} | null;

async function enlaceCompleto(ruta: string): Promise<string> {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    const proto = h.get('x-forwarded-proto') ?? 'https';
    return host ? `${proto}://${host}${ruta}` : ruta;
}

async function armar(organizationId: string, s: Fila, timezone: string | null | undefined): Promise<PaginaPoliticaDatos> {
    const ruta = rutaPoliticaDatos(organizationId);
    return {
        datos: datosParaEditar(s?.dataPolicyPage),
        publicada: datosPublicables(s?.dataPolicyPage) !== null,
        ruta,
        enlace: await enlaceCompleto(ruta),
        hoy: diaLocal(new Date(), timezone || undefined),
        ultimoCambio: s?.dataPolicyPageUpdatedAt
            ? { en: s.dataPolicyPageUpdatedAt.toISOString(), por: s.dataPolicyPageUpdatedBy ?? '' }
            : null,
    };
}

export async function getMyPaginaPoliticaDatos(): Promise<PaginaPoliticaDatos> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') throw new Error('Acceso denegado');
    const organizationId = session.organizationId!;
    const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
            timezone: true,
            settings: {
                select: { dataPolicyPage: true, dataPolicyPageUpdatedAt: true, dataPolicyPageUpdatedBy: true },
            },
        },
    });
    return armar(organizationId, org?.settings ?? null, org?.timezone);
}

export type ResultadoPaginaPolitica =
    | { success: true; pagina: PaginaPoliticaDatos }
    | { success: false; error: string; campo?: CampoPolitica };

/**
 * Guarda la identificación del responsable: completa o nada (la página nunca
 * queda a medias). Lo que cambió queda en la Actividad de usuarios.
 */
export async function setMyPaginaPoliticaDatos(entrada: unknown): Promise<ResultadoPaginaPolitica> {
    const session = await getSession();
    if (!session || session.role !== 'ORG_ADMIN') return { success: false, error: 'Acceso denegado' };
    const organizationId = session.organizationId!;
    try {
        const org = await prisma.organization.findUnique({
            where: { id: organizationId },
            select: { timezone: true, settings: { select: { dataPolicyPage: true } } },
        });
        const r = validarDatosPolitica(entrada, diaLocal(new Date(), org?.timezone || undefined));
        if (!r.ok) return { success: false, error: r.error, campo: r.campo };

        const antes = org?.settings?.dataPolicyPage ?? null;
        const cambios = camposCambiados(antes, r.datos);
        const actor = session.email ?? session.userId ?? 'desconocido';
        const data = {
            dataPolicyPage: { ...r.datos },
            ...(cambios.length ? { dataPolicyPageUpdatedAt: new Date(), dataPolicyPageUpdatedBy: actor } : {}),
        };
        const guardado = await prisma.organizationSettings.upsert({
            where: { organizationId },
            create: { organizationId, ...data },
            update: data,
            select: { dataPolicyPage: true, dataPolicyPageUpdatedAt: true, dataPolicyPageUpdatedBy: true },
        });
        if (cambios.length) {
            // `registrarActividad` no lanza: si la anotación falla, el cambio queda igual.
            const detalle = `Página de la política de datos: ${datosPublicables(antes) ? 'cambió' : 'publicada'} (${cambios.join(', ')})`;
            await registrarActividad({
                action: 'DATA_POLICY_PAGE_CHANGED',
                message: detalle,
                actor: actorDeSesion(session),
                organizationId,
                metadata: { detalle, campos: cambios, anterior: antes, nuevo: r.datos },
            });
        }
        revalidatePath('/dashboard/configuracion', 'layout');
        return { success: true, pagina: await armar(organizationId, guardado, org?.timezone) };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}
