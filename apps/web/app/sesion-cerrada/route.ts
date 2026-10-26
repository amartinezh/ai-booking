import { NextResponse } from 'next/server';

/**
 * 🔐 A dónde se manda a alguien cuya sesión dejó de valer (sesiones cerradas, cuenta
 * borrada, rol cambiado, clínica suspendida). Una página no puede borrar la cookie;
 * esta ruta sí: la borra y lleva al ingreso con el aviso. Sin esto, un super
 * administrador con la sesión cerrada quedaba rebotando entre /super-admin y
 * /dashboard (el filtro de rutas solo mira la firma del token).
 *
 * La redirección es RELATIVA a propósito: en un route handler `request.url` lleva el
 * nombre interno del servidor (localhost:3000), no el dominio que ve el navegador
 * detrás del proxy.
 */
export function GET() {
    const res = new NextResponse(null, { status: 307, headers: { Location: '/login?sesion=cerrada' } });
    res.cookies.delete('auth_token');
    return res;
}
