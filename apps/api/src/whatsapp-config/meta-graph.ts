/**
 * Versión de la Graph API de Meta, en UN solo lugar.
 *
 * Antes convivían dos: `v19.0` incrustada en cinco puntos del chatbot y
 * `v21.0` en integrations.service.ts — contra la misma API.
 *
 * El default (`v25.0`) es la versión configurada en la app de Meta
 * (Configuración → Avanzada → Actualizar versión de la API), y es la que
 * soporta el campo `recipient` con BSUID.
 *
 * Se puede sobreescribir con `META_GRAPH_VERSION=vXX.0` en el entorno, para
 * subir de versión sin tocar código ni desplegar una imagen distinta. Al
 * cambiarla, alinéenla con el selector del panel de Meta: si el código llama a
 * una versión más nueva que la de la app, Meta responde con error de versión.
 */
export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';

/** Construye una URL de la Graph API: `metaGraphUrl('123/messages')`. */
export function metaGraphUrl(path: string): string {
  return `https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`;
}
