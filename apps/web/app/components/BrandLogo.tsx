/**
 * 🩺 BrandLogo
 *
 * Logo oficial del producto (SaaS) servido desde `public/logo.svg`.
 * Sustituye al emoji genérico 🏥 en todas las superficies de marca:
 * landing, login, sidebars del dashboard y fallback cuando una clínica
 * no ha subido su propio logo.
 *
 * Diseñado para ser drop-in compatible: acepta `className`, `size`
 * y opcionalmente un `title`/`alt` para accesibilidad.
 */
type Props = {
    /** Tamaño cuadrado en px. Si se omite, se usa `className` para dimensionar. */
    size?: number;
    /** Clases extra (ej: `rounded-lg shadow-sm`). */
    className?: string;
    /** Texto alternativo (a11y). Por defecto: "Logo". */
    alt?: string;
    /** Si se quiere envolver con padding/fondo blanco (útil sobre fondos oscuros). */
    framed?: boolean;
};

export default function BrandLogo({ size, className = '', alt = 'Logo', framed = false }: Props) {
    const dim = size ? { width: size, height: size } : undefined;
    const wrapperClass = framed
        ? 'bg-white shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-800 rounded-lg p-0.5'
        : '';

    // Tag `<img>` simple: el SVG vive en /public/logo.svg, Next.js lo sirve estático.
    // No usamos next/image: para iconos pequeños y SVG es overhead innecesario.
    return (
        <span className={`inline-flex items-center justify-center shrink-0 ${wrapperClass} ${className}`} style={dim}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src="/logo.svg"
                alt={alt}
                width={size}
                height={size}
                className="block w-full h-full object-contain select-none"
                draggable={false}
            />
        </span>
    );
}
