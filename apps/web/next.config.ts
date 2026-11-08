import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad que el proxy (Caddy) no pone y que son del sitio, no del
 * servidor (auditoría 2026-11-07, docs/SEGURIDAD.md). HSTS, `nosniff` y
 * `Referrer-Policy` ya los pone Caddy. Ninguna página del panel se incrusta en
 * otro sitio ni usa cámara, micrófono o ubicación.
 */
const SECURITY_HEADERS = [
  // Nadie puede meter el panel (ni la página de estadísticas) en un iframe ajeno.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // No anunciar el framework ni su versión («x-powered-by: Next.js»).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  experimental: {
    serverActions: {
      // El CSV del padrón EPS viaja como texto en el body de la server action
      // (default 1 MB). 8 MB cubre padrones grandes con margen.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
