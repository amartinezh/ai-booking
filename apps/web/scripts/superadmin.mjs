#!/usr/bin/env node
/**
 * 🌎 SUPER ADMINISTRADORES — alta, cambio de clave, retiro y revisión de claves.
 *
 * Se corre en el servidor, dentro del contenedor de la web (tiene la base y bcrypt):
 *
 *   agenia superadmin listar
 *   agenia superadmin crear superadmin@agenia.co
 *   agenia superadmin restablecer superadmin@agenia.co
 *   agenia superadmin quitar superadmin@sanvicente.com
 *   agenia superadmin revisar-claves
 *
 * (`agenia superadmin …` = `docker exec -it agenia_web node apps/web/scripts/superadmin.mjs …`.)
 *
 * La clave nueva la genera este script al azar y la muestra UNA vez en la
 * terminal de quien lo corre: no se guarda en ningún archivo ni viaja por correo
 * o chat. Cada alta, cambio o retiro queda en la bitácora del sistema y se ve en
 * «Actividad de usuarios» (filtro «Plataforma»).
 *
 * Nació el 2026-10-26: hasta entonces, el primer ingreso creaba solo
 * `superadmin@sanvicente.com` con la clave `admin123`, escrita en el código y en
 * la documentación, y el super administrador no tenía cómo cambiarla desde el panel.
 */
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import db from '@agenia/database';

const { PrismaClient } = db;

/**
 * Claves de fábrica o de ejemplo que han estado en el código, la documentación o
 * el historial. Incluye las de `CLAVES_DE_FABRICA` (lib/cuenta/clave.ts), que el
 * panel ya no acepta, y algunas obvias más.
 */
const CLAVES_CONOCIDAS = [
    'admin123',
    'temporal123',
    'password123',
    'superadmin123',
    'Admin123',
    'admin',
    'superadmin',
    '123456',
    '12345678',
    'sanvicente',
    'agenia123',
];

const ROLES_DEL_PERSONAL = ['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER', 'SUPER_ADMIN'];
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COSTO_BCRYPT = 12;

/** 24 caracteres en 4 grupos (sin letras que se confundan: 0/O, 1/l/I). ~119 bits de azar. */
export function generarClave() {
    const letras = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
    const digitos = '23456789';
    const todos = letras + digitos;
    for (;;) {
        const chars = Array.from({ length: 24 }, () => todos[randomInt(todos.length)]);
        const clave = [0, 6, 12, 18].map((i) => chars.slice(i, i + 6).join('')).join('-');
        // La regla del panel: letras y números.
        if (/[a-zA-Z]/.test(clave) && /\d/.test(clave)) return clave;
    }
}

function fecha(d) {
    if (!d) return 'nunca';
    return new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' });
}

async function bitacora(prisma, action, message, metadata) {
    try {
        await prisma.systemLog.create({
            data: {
                level: 'WARNING',
                action,
                message,
                metadata: { ...metadata, origen: 'consola del servidor (scripts/superadmin.mjs)' },
            },
        });
    } catch (e) {
        console.error(`(No se pudo anotar ${action} en la bitácora: ${e instanceof Error ? e.message : e})`);
    }
}

function mostrarClave(correo, clave) {
    const linea = '─'.repeat(60);
    console.log(`\n${linea}`);
    console.log(`  Usuario : ${correo}`);
    console.log(`  Clave   : ${clave}`);
    console.log(linea);
    console.log('  Guárdela ahora en un gestor de claves: no se vuelve a mostrar.');
    console.log('  Al entrar puede cambiarla en «Cambiar mi clave» (al pie del menú).\n');
}

async function claveConocida(hash) {
    for (const c of CLAVES_CONOCIDAS) {
        if (await bcrypt.compare(c, hash)) return c;
    }
    return null;
}

async function listar(prisma) {
    const admins = await prisma.user.findMany({
        where: { role: 'SUPER_ADMIN' },
        select: { id: true, email: true, password: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
    });
    console.log(`\nSuper administradores: ${admins.length}\n`);
    for (const a of admins) {
        const ultimo = await prisma.systemLog.findFirst({
            where: { action: 'USER_LOGIN', userId: a.id },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        });
        const debil = await claveConocida(a.password);
        console.log(`  • ${a.email}`);
        console.log(`      creado: ${fecha(a.createdAt)} · último ingreso registrado: ${fecha(ultimo?.createdAt)}`);
        console.log(
            debil
                ? `      ⚠️  CLAVE DE FÁBRICA: entra con «${debil}». Cámbiela o retire la cuenta YA.`
                : '      clave: no es ninguna de las claves de fábrica conocidas.',
        );
    }
    console.log('');
}

async function revisarClaves(prisma) {
    const usuarios = await prisma.user.findMany({
        where: { role: { in: ROLES_DEL_PERSONAL } },
        select: { email: true, role: true, password: true, organization: { select: { name: true } } },
        orderBy: [{ role: 'asc' }, { email: 'asc' }],
    });
    console.log(`\nRevisando ${usuarios.length} cuentas del personal contra ${CLAVES_CONOCIDAS.length} claves de fábrica…`);
    let debiles = 0;
    for (const u of usuarios) {
        const c = await claveConocida(u.password);
        if (c) {
            debiles++;
            console.log(`  ⚠️  ${u.email} (${u.role}${u.organization ? `, ${u.organization.name}` : ''}) entra con «${c}»`);
        }
    }
    console.log(
        debiles
            ? `\n${debiles} cuenta(s) con clave de fábrica. Póngales una clave nueva (Usuarios › ✏️) y pídales cambiarla.\n`
            : '\nNinguna cuenta del personal usa una clave de fábrica conocida.\n',
    );
}

async function crear(prisma, correo) {
    const existente = await prisma.user.findUnique({ where: { email: correo }, select: { role: true } });
    if (existente?.role === 'SUPER_ADMIN') {
        console.log(`\n${correo} ya es super administrador: no se cambió nada.`);
        console.log(`Para ponerle una clave nueva: agenia superadmin restablecer ${correo}\n`);
        return 0;
    }
    if (existente) {
        console.error(`\n${correo} ya existe con el rol ${existente.role}: use otro correo.\n`);
        return 1;
    }
    const clave = generarClave();
    const creado = await prisma.user.create({
        data: { email: correo, password: await bcrypt.hash(clave, COSTO_BCRYPT), role: 'SUPER_ADMIN' },
        select: { id: true },
    });
    await bitacora(prisma, 'SUPER_ADMIN_CREATED', `Super administrador creado: ${correo}`, {
        email: correo,
        detalle: `Cuenta ${correo}`,
        objetivo: { userId: creado.id, email: correo, role: 'SUPER_ADMIN' },
    });
    console.log(`\n✔ Super administrador creado.`);
    mostrarClave(correo, clave);
    return 0;
}

async function restablecer(prisma, correo) {
    const u = await prisma.user.findUnique({ where: { email: correo }, select: { id: true, role: true } });
    if (!u || u.role !== 'SUPER_ADMIN') {
        console.error(`\n${correo} no es un super administrador.\n`);
        return 1;
    }
    const clave = generarClave();
    // La clave nueva cierra las sesiones abiertas de esa cuenta (2026-10-27).
    await prisma.user.update({
        where: { id: u.id },
        data: { password: await bcrypt.hash(clave, COSTO_BCRYPT), sessionsRevokedAt: new Date() },
    });
    await bitacora(prisma, 'SUPER_ADMIN_PASSWORD_RESET', `Clave nueva para el super administrador ${correo}`, {
        email: correo,
        detalle: `Cuenta ${correo}`,
        objetivo: { userId: u.id, email: correo, role: 'SUPER_ADMIN' },
    });
    console.log(`\n✔ Clave nueva para ${correo}. Sus sesiones abiertas se cerraron.`);
    mostrarClave(correo, clave);
    return 0;
}

async function quitar(prisma, correo) {
    const u = await prisma.user.findUnique({ where: { email: correo }, select: { id: true, role: true } });
    if (!u || u.role !== 'SUPER_ADMIN') {
        console.error(`\n${correo} no es un super administrador.\n`);
        return 1;
    }
    const cuantos = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
    if (cuantos <= 1) {
        console.error('\nEs el único super administrador: cree otro antes de quitar este (agenia superadmin crear <correo>).\n');
        return 1;
    }
    try {
        await prisma.user.delete({ where: { id: u.id } });
    } catch (e) {
        console.error(`\nNo se pudo borrar (${e instanceof Error ? e.message.split('\n').pop() : e}).`);
        console.error(`Tiene registros a su nombre. Para dejarla sin acceso: agenia superadmin restablecer ${correo}`);
        console.error('y no guarde la clave que salga.\n');
        return 1;
    }
    await bitacora(prisma, 'SUPER_ADMIN_REMOVED', `Super administrador retirado: ${correo}`, {
        email: correo,
        detalle: `Cuenta ${correo}`,
        objetivo: { userId: u.id, email: correo, role: 'SUPER_ADMIN' },
    });
    console.log(`\n✔ ${correo} ya no es super administrador (cuenta borrada).\n`);
    return 0;
}

function ayuda() {
    console.log(`
Uso: agenia superadmin <orden> [correo]

  listar                cuántos super administradores hay, su último ingreso y si usan una clave de fábrica
  crear <correo>        crea uno con una clave aleatoria (la muestra una sola vez)
  restablecer <correo>  le pone una clave aleatoria nueva
  quitar <correo>       lo borra (nunca el último)
  revisar-claves        busca cuentas del personal que entren con una clave de fábrica (admin123, temporal123…)
`);
}

async function main(argv) {
    const [orden, correoCrudo] = argv;
    const correo = (correoCrudo ?? '').trim().toLowerCase();
    const conCorreo = ['crear', 'restablecer', 'quitar'];
    if (!orden || orden === 'ayuda' || orden === '--help' || orden === '-h') {
        ayuda();
        return orden ? 0 : 1;
    }
    if (conCorreo.includes(orden) && !CORREO.test(correo)) {
        console.error(`\nFalta un correo válido: agenia superadmin ${orden} <correo>\n`);
        return 1;
    }
    const prisma = new PrismaClient();
    try {
        switch (orden) {
            case 'listar':
                await listar(prisma);
                return 0;
            case 'revisar-claves':
                await revisarClaves(prisma);
                return 0;
            case 'crear':
                return await crear(prisma, correo);
            case 'restablecer':
                return await restablecer(prisma, correo);
            case 'quitar':
                return await quitar(prisma, correo);
            default:
                console.error(`\nOrden desconocida: ${orden}`);
                ayuda();
                return 1;
        }
    } finally {
        await prisma.$disconnect();
    }
}

// Se puede importar (pruebas) sin que corra.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2))
        .then((codigo) => process.exit(codigo))
        .catch((e) => {
            console.error(e instanceof Error ? e.message : e);
            process.exit(1);
        });
}
