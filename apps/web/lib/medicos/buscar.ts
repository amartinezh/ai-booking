/**
 * 🔎 Buscar en la Plantilla Médica (Médicos), 2026-10-23.
 *
 * Un solo cuadro que encuentra al médico por lo que sea: nombre, cédula, servicio,
 * licencia, teléfono, correo de acceso o su código en el sistema del hospital
 * (p. ej. «RU69»). Sin distinguir mayúsculas ni tildes; con varias palabras, deben
 * estar todas («yulieth general»). La cédula y el teléfono también se encuentran
 * escritos sin puntos, guiones ni espacios.
 *
 * El estado (activo / inactivo) y el WhatsApp (ON / OFF) van aparte, en botones:
 * escrito en el cuadro, «activo» encontraría también a los «inactivos».
 *
 * Puro: lo usa la pantalla y se prueba sin base de datos.
 */
import type { Prisma } from '@agenia/database';

/** Lo que la pantalla necesita del médico: sin el usuario completo (lleva la clave cifrada). */
export const INCLUDE_MEDICO_VISTA = {
    user: { select: { email: true } },
    service: true,
} satisfies Prisma.DoctorProfileInclude;

export type MedicoVista = Prisma.DoctorProfileGetPayload<{ include: typeof INCLUDE_MEDICO_VISTA }>;

export type FiltroWhatsapp = 'todos' | 'on' | 'off';
export type FiltroEstado = 'todos' | 'activos' | 'inactivos';

export interface FiltrosMedicos {
    texto: string;
    whatsapp: FiltroWhatsapp;
    estado: FiltroEstado;
}

export const SIN_FILTROS: FiltrosMedicos = { texto: '', whatsapp: 'todos', estado: 'todos' };

/** Lo mínimo de un médico para buscarlo. */
export interface MedicoBuscable {
    fullName: string;
    cedula: string;
    medicalLicense: string | null;
    phone: string | null;
    isActive: boolean;
    whatsappBookingEnabled: boolean;
    service?: { name: string } | null;
    user?: { email: string } | null;
}

/** Minúsculas y sin tildes. */
export const normalizar = (texto: string): string =>
    texto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();

const soloAlfanumerico = (texto: string): string => normalizar(texto).replace(/[^a-z0-9]/g, '');

/** Todo lo que se puede buscar de un médico, en un solo texto. */
export function textoBuscable(m: MedicoBuscable, codigoHis?: string | null): string {
    const partes = [
        m.fullName,
        m.cedula,
        m.medicalLicense ?? '',
        m.phone ?? '',
        m.service?.name ?? '',
        m.user?.email ?? '',
        codigoHis ?? '',
    ];
    return [
        ...partes.map(normalizar),
        // «77123456789077» encuentra «77123456789-077»; «3001234567» encuentra «300 123 4567».
        soloAlfanumerico(m.cedula),
        soloAlfanumerico(m.phone ?? ''),
    ].join(' · ');
}

/** ¿El médico cumple los filtros? */
export function cumpleFiltros(m: MedicoBuscable, filtros: FiltrosMedicos, codigoHis?: string | null): boolean {
    if (filtros.whatsapp === 'on' && !m.whatsappBookingEnabled) return false;
    if (filtros.whatsapp === 'off' && m.whatsappBookingEnabled) return false;
    if (filtros.estado === 'activos' && !m.isActive) return false;
    if (filtros.estado === 'inactivos' && m.isActive) return false;

    const palabras = normalizar(filtros.texto).split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return true;
    const texto = textoBuscable(m, codigoHis);
    return palabras.every((p) => texto.includes(p) || texto.includes(soloAlfanumerico(p)));
}

/** Los médicos que cumplen los filtros, en el mismo orden. */
export function filtrarMedicos<T extends MedicoBuscable & { id: string }>(
    medicos: readonly T[],
    filtros: FiltrosMedicos,
    codigosHis: Readonly<Record<string, string>> = {},
): T[] {
    return medicos.filter((m) => cumpleFiltros(m, filtros, codigosHis[m.id]));
}

/** ¿Hay algún filtro puesto? */
export const hayFiltros = (f: FiltrosMedicos): boolean =>
    f.texto.trim() !== '' || f.whatsapp !== 'todos' || f.estado !== 'todos';
