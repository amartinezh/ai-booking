'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LIMITES_DOCUMENTOS_RESUMEN, PIE_RESUMEN_POR_DEFECTO, type ConfigDocumentosResumen } from '@agenia/shared';
import { updateDocumentosResumenAction } from '@/app/actions/resumen-atencion';

const MAX_LOGO_BYTES = 150 * 1024;

/** El archivo como base64, sin el prefijo `data:…;base64,`. */
function leerBase64(archivo: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () => resolve(String(lector.result).replace(/^data:[^,]*,/, ''));
        lector.onerror = () => reject(lector.error);
        lector.readAsDataURL(archivo);
    });
}

/**
 * El encabezado de los documentos (plan §3.9): los datos del hospital que
 * salen en `ENTIDAD` del HIS se copian aquí una vez, con el logo. La marca de
 * agua no se cambia: quitarla es aprobar el documento para reclamar (D21).
 */
export default function EncabezadoDocumentos({
    documentos,
    nombreClinica,
}: {
    documentos: ConfigDocumentosResumen;
    nombreClinica: string;
}) {
    const router = useRouter();
    const e = documentos.encabezado;
    const [nombre, setNombre] = useState(e.nombre ?? '');
    const [nit, setNit] = useState(e.nit ?? '');
    const [direccion, setDireccion] = useState(e.direccion ?? '');
    const [telefono, setTelefono] = useState(e.telefono ?? '');
    const [pie, setPie] = useState(documentos.pie ?? '');
    const [logo, setLogo] = useState<string | null>(documentos.logo);
    const [error, setError] = useState<string | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const [guardando, startGuardar] = useTransition();
    const L = LIMITES_DOCUMENTOS_RESUMEN;

    const elegirLogo = async (archivo: File | undefined) => {
        setError(null);
        if (!archivo) return;
        if (!['image/png', 'image/jpeg'].includes(archivo.type)) {
            setError('El logo debe ser PNG o JPEG.');
            return;
        }
        if (archivo.size > MAX_LOGO_BYTES) {
            setError('El logo pesa más de 150 KB. Use una versión más pequeña.');
            return;
        }
        setLogo(await leerBase64(archivo));
    };

    const guardar = () => {
        setError(null);
        setAviso(null);
        startGuardar(async () => {
            const r = await updateDocumentosResumenAction({ nombre, nit, direccion, telefono, pie, logo: logo ?? '' });
            if (!r.success) {
                setError(r.error);
                return;
            }
            setAviso('Guardado. Los documentos que se generen desde ahora salen con este encabezado.');
            router.refresh();
        });
    };

    const campo = (etiqueta: string, valor: string, cambiar: (v: string) => void, max: number, ejemplo: string) => (
        <label className="block text-sm text-zinc-700 dark:text-zinc-300">
            {etiqueta}
            <input
                value={valor}
                onChange={(ev) => cambiar(ev.target.value)}
                maxLength={max}
                placeholder={ejemplo}
                aria-label={etiqueta}
                className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
        </label>
    );

    return (
        <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" data-testid="encabezado-documentos">
            <div>
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Encabezado de los documentos</h2>
                <p className="text-xs text-zinc-500">
                    Los datos del hospital que van arriba en el resumen, la fórmula, las órdenes, la remisión y la incapacidad.
                    Cópielos tal como salen en los documentos que imprime el HIS.
                </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                {campo('Nombre del hospital', nombre, setNombre, L.nombre, nombreClinica)}
                {campo('NIT', nit, setNit, L.nit, '890.000.000-0')}
                {campo('Dirección', direccion, setDireccion, L.direccion, 'Calle 1 # 2-3, Anserma')}
                {campo('Teléfono', telefono, setTelefono, L.telefono, '606 000 0000')}
            </div>
            <div className="flex flex-wrap items-center gap-4">
                {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- vista previa de un logo en base64
                    <img src={`data:image/${logo.startsWith('/9j/') ? 'jpeg' : 'png'};base64,${logo}`} alt="Logo del hospital" className="h-12 w-auto rounded border border-zinc-200" />
                ) : (
                    <span className="text-xs text-zinc-500">Sin logo</span>
                )}
                <label className="text-sm text-blue-600 hover:underline dark:text-blue-400">
                    {logo ? 'Cambiar logo' : 'Subir logo (PNG o JPEG, máximo 150 KB)'}
                    <input
                        type="file"
                        accept="image/png,image/jpeg"
                        className="sr-only"
                        aria-label="Logo del hospital"
                        onChange={(ev) => elegirLogo(ev.target.files?.[0])}
                    />
                </label>
                {logo && (
                    <button onClick={() => setLogo(null)} className="text-sm text-zinc-500 hover:underline">
                        Quitar logo
                    </button>
                )}
            </div>
            <label className="block text-sm text-zinc-700 dark:text-zinc-300">
                Pie del resumen
                <textarea
                    value={pie}
                    onChange={(ev) => setPie(ev.target.value)}
                    maxLength={L.pie}
                    rows={2}
                    placeholder={PIE_RESUMEN_POR_DEFECTO}
                    aria-label="Pie del resumen"
                    className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span className="mt-1 block text-xs text-zinc-500">Vacío: el texto de ejemplo. Lo valida el comité de historias clínicas.</span>
            </label>
            <p className="text-xs text-zinc-500">
                Marca de agua: «{documentos.marcaDeAgua}». Se quita cuando el hospital apruebe los documentos para reclamar
                medicamentos y exámenes (decisión D21 del plan).
            </p>
            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={guardar}
                    disabled={guardando}
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                >
                    {guardando ? 'Guardando…' : 'Guardar encabezado'}
                </button>
                {error && <span className="text-sm text-red-600">{error}</span>}
                {aviso && <span className="text-sm text-emerald-700 dark:text-emerald-400">{aviso}</span>}
            </div>
        </section>
    );
}
