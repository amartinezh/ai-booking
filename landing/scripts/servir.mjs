#!/usr/bin/env node
/**
 * Sirve la landing en local para verla mientras se edita (en producción la sirve
 * Caddy). Sin dependencias: `node scripts/servir.mjs` → http://localhost:4321
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.env.PUERTO || 4321);
const TIPOS = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.md': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
    const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const archivo = normalize(join(RAIZ, ruta.endsWith('/') ? `${ruta}index.html` : ruta));
    // Nada fuera de la carpeta de la landing.
    if (!archivo.startsWith(RAIZ)) {
        res.writeHead(403).end();
        return;
    }
    try {
        if (!(await stat(archivo)).isFile()) throw new Error('no es archivo');
        res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
        res.end(await readFile(archivo));
    } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No existe');
    }
}).listen(PUERTO, () => console.log(`Landing en http://localhost:${PUERTO}`));
