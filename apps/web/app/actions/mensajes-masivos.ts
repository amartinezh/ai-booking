'use server';

// ─────────────────────────────────────────────────────────────
// 📢 MENSAJES MASIVOS — acciones de /dashboard/mensajes-masivos.
// Ver docs/PLAN_MENSAJES_MASIVOS.md.
//
// Solo ORG_ADMIN (lib/mensajes-masivos/acceso.ts), comprobado en CADA acción.
// Las listas de contactos, el borrador, la imagen, las bajas y el seguimiento son
// Prisma directo (como el padrón). Lo que necesita las credenciales de WhatsApp o
// de la IA de la clínica —verificar la plantilla, revisar con IA, la prueba,
// confirmar y controlar el envío— lo hace la API (`/mass-messages`).
//
// Nunca se confía en el navegador: cada contacto se vuelve a normalizar al
// guardar (`normalizarContacto`), la imagen se revisa por sus bytes y la API
// vuelve a revisar el texto antes de enviar.
// ─────────────────────────────────────────────────────────────

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@agenia/database';
import {
    LIMITES_ENVIO,
    MAX_CONTACTOS_POR_ARCHIVO,
    REGLAS_IMAGEN,
    clasificarTelefono,
    explicarErrorDeEnvio,
    formatoPorFirma,
    normalizarContacto,
    problemaDuroDeImagen,
    type EstadoEnvioMasivo,
} from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { getErrorMessage } from '@/lib/error';
import { actorDeSesion, registrarActividad } from '@/lib/actividad/registrar';
import { puedeUsarMensajesMasivos, type SesionMasivos } from '@/lib/mensajes-masivos/acceso';
import type {
    BajaDto,
    BorradorDetalle,
    ContactoDeLista,
    ContactoParaGuardar,
    DestinatarioSeguimiento,
    EnvioResumen,
    EstadoMensajesMasivos,
    FiltroDestinatarios,
    ListaResumen,
    MapeoIaDto,
    PreviaEnvioDto,
    Resultado,
    RevisionImagenIaDto,
    RevisionTextoIaDto,
    SeguimientoEnvio,
    SinIa,
} from './mensajes-masivos.types';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const RUTA = '/dashboard/mensajes-masivos';
const MAX_TEXTO_BORRADOR = 3000;
const ACCESO_DENEGADO = { success: false as const, error: 'Acceso denegado.' };

async function sesion(): Promise<SesionMasivos | null> {
    const s = await getSession();
    return puedeUsarMensajesMasivos(s) ? s : null;
}

/** Llama a la API con la sesión de quien usa el panel. Nunca lanza. */
async function api<T>(ruta: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<{ ok: true; datos: T } | { ok: false; error: string }> {
    try {
        const token = (await cookies()).get('auth_token')?.value;
        const res = await fetch(`${INTERNAL_API_URL}/mass-messages/${ruta}`, {
            method: init.method ?? 'GET',
            headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `auth_token=${token}` } : {}) },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
            cache: 'no-store',
        });
        const cuerpo = (await res.json().catch(() => null)) as { message?: unknown } | null;
        if (!res.ok) {
            const m = cuerpo?.message;
            return { ok: false, error: Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : `La API respondió ${res.status}.` };
        }
        return { ok: true, datos: cuerpo as T };
    } catch (e) {
        return { ok: false, error: `No se pudo hablar con el servidor: ${getErrorMessage(e)}` };
    }
}

const nombreValido = (n: unknown) => (typeof n === 'string' ? n.trim().replace(/\s+/g, ' ').slice(0, 80) : '');

// ════════════════════════════════════════════════════════════════
// LISTAS DE CONTACTOS
// ════════════════════════════════════════════════════════════════

/** Une los contactos (ya normalizados) con las fichas de pacientes de la clínica por su celular. */
async function enlazarPacientes(organizationId: string, celulares: string[]): Promise<Map<string, string>> {
    const mapa = new Map<string, string>();
    for (let i = 0; i < celulares.length; i += 1000) {
        const fichas = await prisma.patientProfile.findMany({
            where: { organizationId, whatsappId: { in: celulares.slice(i, i + 1000).map((c) => c.replace(/^\+/, '')) } },
            select: { id: true, whatsappId: true },
        });
        for (const f of fichas) if (f.whatsappId) mapa.set(`+${f.whatsappId}`, f.id);
    }
    return mapa;
}

async function guardarContactos(
    s: SesionMasivos,
    entrada: {
        listaId?: string;
        nombre?: string;
        descripcion?: string | null;
        origen: 'ARCHIVO' | 'PACIENTES';
        consentimiento?: string;
        contactos: Array<Partial<ContactoParaGuardar>>;
    },
): Promise<Resultado<{ listaId: string; agregados: number; repetidos: number; descartados: number }>> {
    if (!Array.isArray(entrada.contactos) || !entrada.contactos.length) return { success: false, error: 'No hay contactos para guardar.' };
    if (entrada.contactos.length > MAX_CONTACTOS_POR_ARCHIVO) {
        return { success: false, error: `Son más de ${MAX_CONTACTOS_POR_ARCHIVO} contactos: divida la lista.` };
    }
    const unicos = new Map<string, NonNullable<ReturnType<typeof normalizarContacto>>>();
    let descartados = 0;
    for (const c of entrada.contactos) {
        const n = normalizarContacto(c ?? {});
        if (!n) descartados++;
        else if (!unicos.has(n.celular)) unicos.set(n.celular, n);
    }
    if (!unicos.size) return { success: false, error: 'Ningún contacto tiene un celular válido.' };

    let listaId = entrada.listaId;
    let nombreLista: string;
    if (listaId) {
        const lista = await prisma.massContactList.findFirst({ where: { id: listaId, organizationId: s.organizationId }, select: { id: true, name: true, source: true } });
        if (!lista) return { success: false, error: 'La lista no existe.' };
        nombreLista = lista.name;
        if (lista.source !== entrada.origen && lista.source !== 'MIXTA') {
            await prisma.massContactList.update({ where: { id: lista.id }, data: { source: 'MIXTA' } });
        }
    } else {
        const nombre = nombreValido(entrada.nombre);
        const consentimiento = (entrada.consentimiento ?? '').trim();
        if (!nombre) return { success: false, error: 'Póngale un nombre a la lista.' };
        if (consentimiento.length < 15) {
            return { success: false, error: 'Diga de dónde salen estos contactos y cómo autorizaron a la clínica a escribirles (Ley 1581).' };
        }
        try {
            const lista = await prisma.massContactList.create({
                data: {
                    organizationId: s.organizationId,
                    name: nombre,
                    description: entrada.descripcion?.trim().slice(0, 300) || null,
                    source: entrada.origen,
                    consentNote: consentimiento.slice(0, 2000),
                    consentAttestedAt: new Date(),
                    consentAttestedBy: s.email ?? s.userId,
                    createdByUserId: s.userId,
                    createdByEmail: s.email ?? null,
                },
                select: { id: true },
            });
            listaId = lista.id;
            nombreLista = nombre;
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                return { success: false, error: `Ya existe una lista llamada «${nombre}». Use otro nombre o agregue los contactos a esa lista.` };
            }
            return { success: false, error: getErrorMessage(e) };
        }
    }

    const pacientes = await enlazarPacientes(s.organizationId, [...unicos.keys()]);
    const filas = [...unicos.values()].map((c) => ({
        listId: listaId as string,
        organizationId: s.organizationId,
        fullName: c.nombreCompleto,
        firstName: c.primerNombre,
        phoneE164: c.celular,
        email: c.correo,
        document: c.documento,
        extra: Object.keys(c.extras).length ? (c.extras as Prisma.InputJsonValue) : Prisma.JsonNull,
        patientProfileId: pacientes.get(c.celular) ?? null,
    }));
    let agregados = 0;
    for (let i = 0; i < filas.length; i += 1000) {
        agregados += (await prisma.massContact.createMany({ data: filas.slice(i, i + 1000), skipDuplicates: true })).count;
    }
    const total = await prisma.massContact.count({ where: { listId: listaId } });
    await prisma.massContactList.update({ where: { id: listaId }, data: { contactsCount: total } });
    await registrarActividad({
        action: 'MASS_CONTACT_LIST_SAVED',
        message: 'Guardó contactos en una lista de Mensajes masivos',
        actor: actorDeSesion(s),
        organizationId: s.organizationId,
        metadata: { detalle: `${agregados} contacto(s) nuevos en «${nombreLista}» (${total} en total)`, listaId },
    });
    revalidatePath(RUTA);
    return { success: true, listaId: listaId as string, agregados, repetidos: unicos.size - agregados, descartados };
}

export async function guardarListaDeContactos(entrada: {
    listaId?: string;
    nombre?: string;
    descripcion?: string | null;
    consentimiento?: string;
    contactos: ContactoParaGuardar[];
}): Promise<Resultado<{ listaId: string; agregados: number; repetidos: number; descartados: number }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    return guardarContactos(s, { ...entrada, origen: 'ARCHIVO' });
}

/** Una lista con los pacientes de la clínica que tienen WhatsApp (todos, o los de una EPS). */
export async function crearListaDesdePacientes(entrada: {
    nombre: string;
    consentimiento: string;
    epsId?: string | null;
}): Promise<Resultado<{ listaId: string; agregados: number; repetidos: number; descartados: number }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const fichas = await prisma.patientProfile.findMany({
        where: { organizationId: s.organizationId, whatsappId: { not: null }, ...(entrada.epsId ? { epsId: entrada.epsId } : {}) },
        select: { fullName: true, nombres: true, whatsappId: true, cedula: true },
        take: LIMITES_ENVIO.maxDestinatarios + 1,
    });
    if (fichas.length > LIMITES_ENVIO.maxDestinatarios) {
        return { success: false, error: `Son más de ${LIMITES_ENVIO.maxDestinatarios} pacientes: filtre por EPS.` };
    }
    const contactos = fichas
        .filter((f) => f.whatsappId && /^\d{10,15}$/.test(f.whatsappId))
        .map((f) => ({
            nombreCompleto: f.fullName,
            primerNombre: f.nombres?.split(' ')[0] ?? null,
            celular: `+${f.whatsappId}`,
            correo: null,
            documento: f.cedula,
            extras: {},
        }));
    if (!contactos.length) return { success: false, error: 'No hay pacientes con un celular de WhatsApp registrado con ese filtro.' };
    return guardarContactos(s, { nombre: entrada.nombre, consentimiento: entrada.consentimiento, origen: 'PACIENTES', contactos });
}

export async function listarListas(): Promise<Resultado<{ listas: ListaResumen[] }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const listas = await prisma.massContactList.findMany({
        where: { organizationId: s.organizationId },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            name: true,
            description: true,
            source: true,
            contactsCount: true,
            createdAt: true,
            consentNote: true,
            _count: { select: { campaigns: true } },
        },
    });
    return {
        success: true,
        listas: listas.map((l) => ({
            id: l.id,
            nombre: l.name,
            descripcion: l.description,
            origen: l.source,
            contactos: l.contactsCount,
            creada: l.createdAt.toISOString(),
            envios: l._count.campaigns,
            consentimiento: l.consentNote,
        })),
    };
}

export async function verContactosDeLista(
    listaId: string,
    opciones: { pagina?: number; buscar?: string } = {},
): Promise<Resultado<{ contactos: ContactoDeLista[]; total: number; pagina: number; porPagina: number }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const porPagina = 50;
    const pagina = Math.max(1, Math.floor(opciones.pagina ?? 1));
    const q = (opciones.buscar ?? '').trim();
    const digitos = q.replace(/\D/g, '');
    const where: Prisma.MassContactWhereInput = {
        listId: listaId,
        organizationId: s.organizationId,
        ...(q
            ? {
                  OR: [
                      { fullName: { contains: q, mode: 'insensitive' } },
                      { email: { contains: q, mode: 'insensitive' } },
                      ...(digitos.length >= 3 ? [{ phoneE164: { contains: digitos } }, { document: { contains: digitos } }] : []),
                  ],
              }
            : {}),
    };
    const [contactos, total] = await Promise.all([
        prisma.massContact.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (pagina - 1) * porPagina, take: porPagina }),
        prisma.massContact.count({ where }),
    ]);
    return {
        success: true,
        total,
        pagina,
        porPagina,
        contactos: contactos.map((c) => ({
            id: c.id,
            nombre: c.fullName,
            celular: c.phoneE164,
            correo: c.email,
            documento: c.document,
            esPaciente: !!c.patientProfileId,
            extras: (c.extra as Record<string, string> | null) ?? {},
        })),
    };
}

export async function quitarContactoDeLista(listaId: string, contactoId: string): Promise<Resultado> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const { count } = await prisma.massContact.deleteMany({ where: { id: contactoId, listId: listaId, organizationId: s.organizationId } });
    if (!count) return { success: false, error: 'El contacto ya no está en la lista.' };
    const total = await prisma.massContact.count({ where: { listId: listaId } });
    await prisma.massContactList.update({ where: { id: listaId }, data: { contactsCount: total } });
    revalidatePath(RUTA);
    return { success: true };
}

export async function renombrarLista(listaId: string, nombre: string, descripcion: string | null): Promise<Resultado> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const limpio = nombreValido(nombre);
    if (!limpio) return { success: false, error: 'Póngale un nombre a la lista.' };
    try {
        const { count } = await prisma.massContactList.updateMany({
            where: { id: listaId, organizationId: s.organizationId },
            data: { name: limpio, description: descripcion?.trim().slice(0, 300) || null },
        });
        if (!count) return { success: false, error: 'La lista no existe.' };
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return { success: false, error: `Ya existe una lista llamada «${limpio}».` };
        }
        return { success: false, error: getErrorMessage(e) };
    }
    revalidatePath(RUTA);
    return { success: true };
}

/** Borra la lista y sus borradores. Si ya se usó en un envío, se conserva: es la constancia de a quién se le escribió. */
export async function eliminarLista(listaId: string): Promise<Resultado> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const lista = await prisma.massContactList.findFirst({ where: { id: listaId, organizationId: s.organizationId }, select: { id: true, name: true, contactsCount: true } });
    if (!lista) return { success: false, error: 'La lista no existe.' };
    const usados = await prisma.massCampaign.count({ where: { listId: listaId, status: { not: 'BORRADOR' } } });
    if (usados) {
        return { success: false, error: `La lista ya se usó en ${usados} envío(s): se conserva como constancia de a quién se le escribió. Puede quitarle contactos.` };
    }
    await prisma.$transaction([
        prisma.massCampaign.deleteMany({ where: { listId: listaId, status: 'BORRADOR' } }),
        prisma.massContactList.delete({ where: { id: listaId } }),
    ]);
    await registrarActividad({
        action: 'MASS_CONTACT_LIST_DELETED',
        message: 'Eliminó una lista de Mensajes masivos',
        actor: actorDeSesion(s),
        organizationId: s.organizationId,
        metadata: { detalle: `«${lista.name}» (${lista.contactsCount} contactos)` },
    });
    revalidatePath(RUTA);
    return { success: true };
}

/** Lo que pide el mapeo de columnas con IA: solo encabezados y 5 filas TAPADAS (`muestraParaIa`). */
export async function pedirMapeoIa(muestra: { encabezados: string[]; filas: string[][] }): Promise<Resultado<{ resultado: MapeoIaDto }>> {
    if (!(await sesion())) return ACCESO_DENEGADO;
    const r = await api<MapeoIaDto>('contactos/mapeo-ia', { method: 'POST', body: muestra });
    return r.ok ? { success: true, resultado: r.datos } : { success: false, error: r.error };
}

// ════════════════════════════════════════════════════════════════
// EL BORRADOR (texto, imagen, lista)
// ════════════════════════════════════════════════════════════════

async function borradorDe(s: SesionMasivos, id: string) {
    return prisma.massCampaign.findFirst({
        where: { id, organizationId: s.organizationId },
        select: { id: true, status: true, name: true, listId: true },
    });
}

export async function crearBorrador(entrada: { nombre: string; listaId: string }): Promise<Resultado<{ id: string }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const lista = await prisma.massContactList.findFirst({ where: { id: entrada.listaId, organizationId: s.organizationId }, select: { id: true } });
    if (!lista) return { success: false, error: 'Elija una lista de contactos.' };
    const envio = await prisma.massCampaign.create({
        data: {
            organizationId: s.organizationId,
            listId: lista.id,
            name: nombreValido(entrada.nombre) || 'Comunicado',
            ratePerMinute: LIMITES_ENVIO.ritmoPorDefecto,
            createdByUserId: s.userId,
            createdByEmail: s.email ?? null,
        },
        select: { id: true },
    });
    revalidatePath(RUTA);
    return { success: true, id: envio.id };
}

export async function verBorrador(id: string): Promise<Resultado<{ borrador: BorradorDetalle }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const e = await prisma.massCampaign.findFirst({
        where: { id, organizationId: s.organizationId, status: 'BORRADOR' },
        select: {
            id: true,
            name: true,
            messageText: true,
            ratePerMinute: true,
            imageMime: true,
            imageWidth: true,
            imageHeight: true,
            imageBytes: true,
            updatedAt: true,
            list: { select: { id: true, name: true, contactsCount: true } },
        },
    });
    if (!e) return { success: false, error: 'El borrador ya no existe o ya se envió.' };
    return {
        success: true,
        borrador: {
            id: e.id,
            nombre: e.name,
            listaId: e.list.id,
            listaNombre: e.list.name,
            contactos: e.list.contactsCount,
            texto: e.messageText,
            ritmo: e.ratePerMinute,
            imagen: e.imageMime
                ? { url: `${RUTA}/imagen/${e.id}?v=${e.updatedAt.getTime()}`, ancho: e.imageWidth, alto: e.imageHeight, bytes: e.imageBytes, mime: e.imageMime }
                : null,
        },
    };
}

export async function guardarBorrador(
    id: string,
    cambios: { nombre?: string; texto?: string; listaId?: string; ritmo?: number },
): Promise<Resultado> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const b = await borradorDe(s, id);
    if (!b || b.status !== 'BORRADOR') return { success: false, error: 'El borrador ya no existe o ya se envió.' };
    const data: Prisma.MassCampaignUncheckedUpdateInput = {};
    if (cambios.nombre !== undefined) data.name = nombreValido(cambios.nombre) || 'Comunicado';
    if (cambios.texto !== undefined) {
        if (typeof cambios.texto !== 'string' || cambios.texto.length > MAX_TEXTO_BORRADOR) {
            return { success: false, error: `El texto no puede pasar de ${MAX_TEXTO_BORRADOR} caracteres.` };
        }
        data.messageText = cambios.texto;
    }
    if (cambios.ritmo !== undefined) {
        data.ratePerMinute = Math.min(LIMITES_ENVIO.ritmoMaximo, Math.max(LIMITES_ENVIO.ritmoMinimo, Math.round(Number(cambios.ritmo) || LIMITES_ENVIO.ritmoPorDefecto)));
    }
    if (cambios.listaId !== undefined) {
        const lista = await prisma.massContactList.findFirst({ where: { id: cambios.listaId, organizationId: s.organizationId }, select: { id: true } });
        if (!lista) return { success: false, error: 'La lista no existe.' };
        data.listId = lista.id;
    }
    await prisma.massCampaign.update({ where: { id }, data });
    return { success: true };
}

/**
 * La imagen ya optimizada en el navegador. Se revisa otra vez aquí por sus
 * BYTES (JPEG o PNG, máximo 5 MB): la extensión y el tipo que diga el navegador
 * no cuentan.
 */
export async function subirImagen(id: string, formulario: FormData): Promise<Resultado<{ url: string }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const b = await borradorDe(s, id);
    if (!b || b.status !== 'BORRADOR') return { success: false, error: 'El borrador ya no existe o ya se envió.' };
    const archivo = formulario.get('imagen');
    if (!(archivo instanceof Blob)) return { success: false, error: 'No llegó la imagen.' };
    if (archivo.size > REGLAS_IMAGEN.maxBytesMeta) return { success: false, error: 'La imagen pesa más de 5 MB: optimícela primero.' };
    const datos = Buffer.from(await archivo.arrayBuffer());
    const formato = formatoPorFirma(new Uint8Array(datos.subarray(0, 64)));
    const problema = problemaDuroDeImagen(formato, datos.length);
    if (problema) return { success: false, error: `${problema} Use «Optimizar» para convertirla.` };
    const entero = (v: FormDataEntryValue | null) => {
        const n = Number(v);
        return Number.isInteger(n) && n > 0 && n < 20000 ? n : null;
    };
    const actualizado = await prisma.massCampaign.update({
        where: { id },
        data: {
            imageData: datos,
            imageMime: formato === 'PNG' ? 'image/png' : 'image/jpeg',
            imageWidth: entero(formulario.get('ancho')),
            imageHeight: entero(formulario.get('alto')),
            imageBytes: datos.length,
            imageMediaId: null,
            imageMediaUploadedAt: null,
            imageReview: Prisma.JsonNull,
        },
        select: { updatedAt: true },
    });
    return { success: true, url: `${RUTA}/imagen/${id}?v=${actualizado.updatedAt.getTime()}` };
}

export async function quitarImagen(id: string): Promise<Resultado> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const b = await borradorDe(s, id);
    if (!b || b.status !== 'BORRADOR') return { success: false, error: 'El borrador ya no existe o ya se envió.' };
    await prisma.massCampaign.update({
        where: { id },
        data: { imageData: null, imageMime: null, imageWidth: null, imageHeight: null, imageBytes: null, imageMediaId: null, imageMediaUploadedAt: null, imageReview: Prisma.JsonNull },
    });
    return { success: true };
}

export async function eliminarBorrador(id: string): Promise<Resultado> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const { count } = await prisma.massCampaign.deleteMany({ where: { id, organizationId: s.organizationId, status: 'BORRADOR' } });
    if (!count) return { success: false, error: 'El borrador ya no existe o ya se envió.' };
    revalidatePath(RUTA);
    return { success: true };
}

// ════════════════════════════════════════════════════════════════
// REVISIONES CON IA, PRUEBA Y ENVÍO (API)
// ════════════════════════════════════════════════════════════════

export async function estadoMensajesMasivos(): Promise<Resultado<{ estado: EstadoMensajesMasivos }>> {
    if (!(await sesion())) return ACCESO_DENEGADO;
    const r = await api<EstadoMensajesMasivos>('estado');
    return r.ok ? { success: true, estado: r.datos } : { success: false, error: r.error };
}

export async function revisarTextoConIa(texto: string): Promise<Resultado<{ revision: RevisionTextoIaDto | SinIa }>> {
    if (!(await sesion())) return ACCESO_DENEGADO;
    const r = await api<RevisionTextoIaDto | SinIa>('texto/revision-ia', { method: 'POST', body: { texto } });
    return r.ok ? { success: true, revision: r.datos } : { success: false, error: r.error };
}

export async function revisarImagenConIa(id: string): Promise<Resultado<{ revision: RevisionImagenIaDto | SinIa }>> {
    if (!(await sesion())) return ACCESO_DENEGADO;
    const r = await api<RevisionImagenIaDto | SinIa>(`envios/${encodeURIComponent(id)}/imagen/revision-ia`, { method: 'POST', body: {} });
    return r.ok ? { success: true, revision: r.datos } : { success: false, error: r.error };
}

export async function previaDelEnvio(id: string): Promise<Resultado<{ previa: PreviaEnvioDto }>> {
    if (!(await sesion())) return ACCESO_DENEGADO;
    const r = await api<PreviaEnvioDto>(`envios/${encodeURIComponent(id)}/previa`);
    return r.ok ? { success: true, previa: r.datos } : { success: false, error: r.error };
}

export async function enviarPrueba(id: string, telefono: string, nombre: string): Promise<Resultado<{ wamid: string | null }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    if (clasificarTelefono(telefono).clase !== 'CELULAR') return { success: false, error: 'Escriba un celular válido para la prueba.' };
    const r = await api<{ ok: true; wamid: string | null } | { ok: false; motivo: string }>(`envios/${encodeURIComponent(id)}/prueba`, {
        method: 'POST',
        body: { telefono, nombre },
    });
    if (!r.ok) return { success: false, error: r.error };
    await registrarActividad({
        action: 'MASS_MESSAGE_TEST_SENT',
        message: 'Envió una prueba de un mensaje masivo',
        actor: actorDeSesion(s),
        organizationId: s.organizationId,
        metadata: { detalle: `Prueba a •••${telefono.replace(/\D/g, '').slice(-4)}: ${r.datos.ok ? 'salió' : 'no salió'}`, envioId: id },
    });
    return r.datos.ok ? { success: true, wamid: r.datos.wamid } : { success: false, error: r.datos.motivo };
}

export async function confirmarEnvio(
    id: string,
    entrada: { confirmacion: number; autorizacion: boolean },
): Promise<Resultado<{ aEnviar: number; saleDesde: string }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    if (entrada.autorizacion !== true) {
        return { success: false, error: 'Confirme que estas personas autorizaron a la clínica a escribirles por WhatsApp.' };
    }
    const r = await api<{ estado: string; aEnviar: number; saleDesde: string }>(`envios/${encodeURIComponent(id)}/iniciar`, {
        method: 'POST',
        body: { confirmacion: Number(entrada.confirmacion) },
    });
    if (!r.ok) return { success: false, error: r.error };
    await registrarActividad({
        action: 'MASS_MESSAGE_SEND_CONFIRMED',
        message: 'Confirmó un envío de mensajes masivos',
        actor: actorDeSesion(s),
        organizationId: s.organizationId,
        metadata: { detalle: `A ${r.datos.aEnviar} persona(s)`, envioId: id },
    });
    revalidatePath(RUTA);
    return { success: true, aEnviar: r.datos.aEnviar, saleDesde: r.datos.saleDesde };
}

export async function controlarEnvio(
    id: string,
    accion: 'pausar' | 'reanudar' | 'cancelar' | 'reintentar',
): Promise<Resultado<{ reintentos?: number }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    if (!['pausar', 'reanudar', 'cancelar', 'reintentar'].includes(accion)) return { success: false, error: 'Acción desconocida.' };
    const r = await api<{ ok?: boolean; reintentos?: number }>(`envios/${encodeURIComponent(id)}/${accion}`, { method: 'POST', body: {} });
    if (!r.ok) return { success: false, error: r.error };
    const titulos = { pausar: 'Pausó', reanudar: 'Reanudó', cancelar: 'Canceló', reintentar: 'Reintentó los fallidos de' } as const;
    await registrarActividad({
        action: 'MASS_MESSAGE_CONTROLLED',
        message: `${titulos[accion]} un envío de mensajes masivos`,
        actor: actorDeSesion(s),
        organizationId: s.organizationId,
        metadata: { detalle: `${titulos[accion]} el envío${r.datos.reintentos !== undefined ? ` (${r.datos.reintentos} reintentos)` : ''}`, envioId: id },
    });
    revalidatePath(RUTA);
    return { success: true, reintentos: r.datos.reintentos };
}

// ════════════════════════════════════════════════════════════════
// ENVÍOS Y SEGUIMIENTO
// ════════════════════════════════════════════════════════════════

export async function listarEnvios(): Promise<Resultado<{ envios: EnvioResumen[] }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const envios = await prisma.massCampaign.findMany({
        where: { organizationId: s.organizationId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
            id: true,
            name: true,
            status: true,
            total: true,
            sent: true,
            failed: true,
            skipped: true,
            imageMime: true,
            createdAt: true,
            confirmedAt: true,
            finishedAt: true,
            confirmedByEmail: true,
            lastError: true,
            list: { select: { id: true, name: true } },
        },
    });
    return {
        success: true,
        envios: envios.map((e) => ({
            id: e.id,
            nombre: e.name,
            estado: e.status as EstadoEnvioMasivo,
            lista: e.list.name,
            listaId: e.list.id,
            total: e.total,
            enviados: e.sent,
            fallidos: e.failed,
            omitidos: e.skipped,
            conImagen: !!e.imageMime,
            creado: e.createdAt.toISOString(),
            confirmado: e.confirmedAt?.toISOString() ?? null,
            terminado: e.finishedAt?.toISOString() ?? null,
            confirmadoPor: e.confirmedByEmail,
            ultimoError: e.lastError,
        })),
    };
}

const ENTREGA: Record<string, DestinatarioSeguimiento['entrega']> = {
    ACCEPTED: 'ENVIADO',
    SENT: 'ENVIADO',
    DELIVERED: 'ENTREGADO',
    READ: 'LEIDO',
    FAILED: 'NO_ENTREGADO',
};

/** Cómo va un envío: las cifras, lo que reportó Meta de la entrega y una página de destinatarios. */
export async function seguimientoDelEnvio(
    id: string,
    opciones: { filtro?: FiltroDestinatarios; pagina?: number } = {},
): Promise<Resultado<{ seguimiento: SeguimientoEnvio }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const e = await prisma.massCampaign.findFirst({
        where: { id, organizationId: s.organizationId },
        select: {
            id: true,
            name: true,
            status: true,
            messageText: true,
            imageMime: true,
            templateName: true,
            total: true,
            sent: true,
            failed: true,
            skipped: true,
            ratePerMinute: true,
            createdAt: true,
            confirmedAt: true,
            confirmedByEmail: true,
            startedAt: true,
            finishedAt: true,
            lastError: true,
            updatedAt: true,
            list: { select: { id: true, name: true } },
        },
    });
    if (!e) return { success: false, error: 'El envío no existe.' };

    // Lo que reportó Meta de cada mensaje aceptado (el webhook actualiza el libro de mensajes).
    const enviados = await prisma.massCampaignRecipient.findMany({
        where: { campaignId: id, outcome: 'ENVIADO', wamid: { not: null } },
        select: { wamid: true },
    });
    const estados = new Map<string, { status: string; errorCode: string | null }>();
    const wamids = enviados.map((x) => x.wamid as string);
    for (let i = 0; i < wamids.length; i += 5000) {
        const libro = await prisma.whatsappMessageLog.findMany({
            where: { wamid: { in: wamids.slice(i, i + 5000) } },
            select: { wamid: true, status: true, errorCode: true },
        });
        for (const l of libro) estados.set(l.wamid, { status: l.status, errorCode: l.errorCode });
    }
    const entrega = { entregados: 0, leidos: 0, noEntregados: 0, sinConfirmar: 0 };
    for (const w of wamids) {
        const st = estados.get(w)?.status;
        if (st === 'READ') {
            entrega.leidos++;
            entrega.entregados++;
        } else if (st === 'DELIVERED') entrega.entregados++;
        else if (st === 'FAILED') entrega.noEntregados++;
        else entrega.sinConfirmar++;
    }

    // Por qué no les llegó: los fallidos al enviar y los que Meta no entregó después.
    const motivos = new Map<string, { cantidad: number; reintentables: number }>();
    const sumar = (motivo: string, reintentable: boolean) => {
        const m = motivos.get(motivo) ?? { cantidad: 0, reintentables: 0 };
        m.cantidad++;
        if (reintentable) m.reintentables++;
        motivos.set(motivo, m);
    };
    const fallidos = await prisma.massCampaignRecipient.findMany({ where: { campaignId: id, outcome: 'FALLIDO' }, select: { error: true } });
    for (const f of fallidos) {
        const x = explicarErrorDeEnvio(f.error);
        sumar(x.motivo, x.reintentable);
    }
    for (const w of wamids) {
        const st = estados.get(w);
        if (st?.status === 'FAILED') {
            const x = explicarErrorDeEnvio(st.errorCode ?? '');
            sumar(`No entregado: ${x.motivo}`, false);
        }
    }

    // La página de destinatarios.
    const porPagina = 50;
    const pagina = Math.max(1, Math.floor(opciones.pagina ?? 1));
    const filtro = opciones.filtro ?? 'TODOS';
    const conEstado = (lista: string[]) => wamids.filter((w) => lista.includes(estados.get(w)?.status ?? ''));
    const where: Prisma.MassCampaignRecipientWhereInput = { campaignId: id };
    if (filtro === 'PENDIENTE' || filtro === 'FALLIDO' || filtro === 'OMITIDO' || filtro === 'ENVIADO') where.outcome = filtro;
    if (filtro === 'LEIDO') where.wamid = { in: conEstado(['READ']) };
    if (filtro === 'NO_ENTREGADO') where.wamid = { in: conEstado(['FAILED']) };
    const [filas, totalFiltrado] = await Promise.all([
        prisma.massCampaignRecipient.findMany({ where, orderBy: { id: 'asc' }, skip: (pagina - 1) * porPagina, take: porPagina }),
        prisma.massCampaignRecipient.count({ where }),
    ]);
    const motivoDe = (f: (typeof filas)[number]): string | null => {
        if (f.outcome === 'OMITIDO') {
            const m: Record<string, string> = {
                BAJA: 'Pidió no recibir más comunicados',
                BAJA_EN_META: 'Bloqueó los mensajes de la clínica en WhatsApp',
                CANCELADO: 'El envío se canceló antes de llegarle',
                CELULAR_INVALIDO: 'El celular no es válido',
            };
            return m[f.skipReason ?? ''] ?? 'Omitido';
        }
        if (f.outcome === 'FALLIDO' || (f.outcome === 'PENDIENTE' && f.error)) return explicarErrorDeEnvio(f.error).motivo;
        const st = f.wamid ? estados.get(f.wamid) : undefined;
        if (st?.status === 'FAILED') return explicarErrorDeEnvio(st.errorCode ?? '').motivo;
        return null;
    };

    return {
        success: true,
        seguimiento: {
            envio: {
                id: e.id,
                nombre: e.name,
                estado: e.status as EstadoEnvioMasivo,
                texto: e.messageText,
                imagenUrl: e.imageMime ? `${RUTA}/imagen/${e.id}?v=${e.updatedAt.getTime()}` : null,
                plantilla: e.templateName,
                lista: { id: e.list.id, nombre: e.list.name },
                total: e.total,
                enviados: e.sent,
                fallidos: e.failed,
                omitidos: e.skipped,
                pendientes: Math.max(0, e.total - e.sent - e.failed - e.skipped),
                ritmo: e.ratePerMinute,
                creado: e.createdAt.toISOString(),
                confirmado: e.confirmedAt?.toISOString() ?? null,
                confirmadoPor: e.confirmedByEmail,
                iniciado: e.startedAt?.toISOString() ?? null,
                terminado: e.finishedAt?.toISOString() ?? null,
                ultimoError: e.lastError,
            },
            entrega,
            motivos: [...motivos].map(([motivo, m]) => ({ motivo, ...m })).sort((a, b) => b.cantidad - a.cantidad),
            destinatarios: filas.map((f) => ({
                id: f.id,
                nombre: f.name,
                celular: f.phoneE164,
                resultado: f.outcome as DestinatarioSeguimiento['resultado'],
                entrega: f.wamid ? (ENTREGA[estados.get(f.wamid)?.status ?? 'ACCEPTED'] ?? 'ENVIADO') : null,
                motivo: motivoDe(f),
                enviado: f.sentAt?.toISOString() ?? null,
            })),
            totalFiltrado,
            pagina,
            porPagina,
        },
    };
}

// ════════════════════════════════════════════════════════════════
// BAJAS
// ════════════════════════════════════════════════════════════════

const tapar = (destino: string) => (/^\+\d+$/.test(destino) ? `+${destino.slice(1, 3)} •••${destino.slice(-4)}` : `${destino.slice(0, 3)}•••${destino.slice(-4)}`);

export async function listarBajas(): Promise<Resultado<{ bajas: BajaDto[]; total: number }>> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const [bajas, total] = await Promise.all([
        prisma.massMessageOptOut.findMany({ where: { organizationId: s.organizationId }, orderBy: { createdAt: 'desc' }, take: 200 }),
        prisma.massMessageOptOut.count({ where: { organizationId: s.organizationId } }),
    ]);
    return {
        success: true,
        total,
        bajas: bajas.map((b) => ({ id: b.id, destino: tapar(b.destination), fuente: b.source, nota: b.note, fecha: b.createdAt.toISOString() })),
    };
}

/** Una baja que la persona pidió por otro medio (llamó, lo dijo en ventanilla). */
export async function registrarBaja(telefono: string, nota: string): Promise<Resultado> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const tel = clasificarTelefono(telefono);
    if (tel.clase !== 'CELULAR' || !tel.e164) return { success: false, error: 'Escriba un celular válido.' };
    await prisma.massMessageOptOut.upsert({
        where: { organizationId_destination: { organizationId: s.organizationId, destination: tel.e164 } },
        create: { organizationId: s.organizationId, destination: tel.e164, source: 'PANEL', note: nota.trim().slice(0, 300) || null },
        update: {},
    });
    await registrarActividad({
        action: 'MASS_MESSAGE_OPT_OUT_CHANGED',
        message: 'Registró una baja de Mensajes masivos',
        actor: actorDeSesion(s),
        organizationId: s.organizationId,
        metadata: { detalle: `Baja de ${tapar(tel.e164)}` },
    });
    revalidatePath(RUTA);
    return { success: true };
}

export async function quitarBaja(id: string): Promise<Resultado> {
    const s = await sesion();
    if (!s) return ACCESO_DENEGADO;
    const baja = await prisma.massMessageOptOut.findFirst({ where: { id, organizationId: s.organizationId } });
    if (!baja) return { success: false, error: 'La baja ya no existe.' };
    await prisma.massMessageOptOut.delete({ where: { id } });
    await registrarActividad({
        action: 'MASS_MESSAGE_OPT_OUT_CHANGED',
        message: 'Quitó una baja de Mensajes masivos',
        actor: actorDeSesion(s),
        organizationId: s.organizationId,
        metadata: { detalle: `Quitó la baja de ${tapar(baja.destination)} (la había pedido por ${baja.source === 'CHAT' ? 'el chat' : 'otro medio'})` },
    });
    revalidatePath(RUTA);
    return { success: true };
}
