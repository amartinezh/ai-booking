'use client';

import { textoCasillaAutorizacion } from '@agenia/shared';

/**
 * 🔒 La casilla obligatoria de autorización de datos de los formularios públicos
 * (solicitud de alta y de más citas; docs/PLAN_AUTORIZACION_DATOS.md). El
 * servidor la vuelve a exigir: sin marcarla no se guarda la solicitud.
 */
export default function CasillaAutorizacionDatos({
    clinica,
    urlPolitica,
    marcada,
    onChange,
    disabled = false,
}: {
    clinica: string;
    urlPolitica: string | null;
    marcada: boolean;
    onChange: (marcada: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <label className="flex items-start gap-3 text-left text-sm text-zinc-600">
            <input
                type="checkbox"
                required
                checked={marcada}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300"
            />
            <span>
                {textoCasillaAutorizacion(clinica)}{' '}
                {urlPolitica && (
                    <a href={urlPolitica} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                        Ver la política de tratamiento de datos
                    </a>
                )}
            </span>
        </label>
    );
}
