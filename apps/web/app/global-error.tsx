'use client';

import { useEffect, useState } from 'react';

const SESSION_HINTS = [
    'unexpected response was received from the server',
    'Failed to fetch',
    'NEXT_REDIRECT',
    'Response closed without headers',
];

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const [redirecting, setRedirecting] = useState(false);

    useEffect(() => {
        console.error('[GlobalError]', error);

        const message = `${error?.message ?? ''} ${error?.digest ?? ''}`.toLowerCase();
        const looksLikeSessionIssue = SESSION_HINTS.some(h => message.includes(h.toLowerCase()));

        if (looksLikeSessionIssue) {
            setRedirecting(true);
            const t = setTimeout(() => {
                window.location.assign('/login');
            }, 1500);
            return () => clearTimeout(t);
        }
    }, [error]);

    return (
        <html lang="es">
            <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', background: '#fafafa', color: '#18181b' }}>
                <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
                    <div style={{ maxWidth: 480, width: '100%', background: '#fff', borderRadius: 24, padding: 32, boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 10px 30px rgba(0,0,0,0.06)', border: '1px solid #e4e4e7' }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>{redirecting ? '🔐' : '⚠️'}</div>
                        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px 0' }}>
                            {redirecting ? 'Tu sesión expiró' : 'Ocurrió un problema'}
                        </h1>
                        <p style={{ fontSize: 14, color: '#52525b', margin: '0 0 24px 0', lineHeight: 1.5 }}>
                            {redirecting
                                ? 'Por seguridad necesitamos que vuelvas a iniciar sesión. Te estamos redirigiendo…'
                                : 'No pudimos completar la operación. Puedes reintentar o volver al inicio de sesión.'}
                        </p>

                        {!redirecting && (
                            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                                <button
                                    onClick={() => reset()}
                                    style={{ padding: '10px 20px', borderRadius: 12, border: '1px solid #e4e4e7', background: '#fff', color: '#18181b', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    Reintentar
                                </button>
                                <button
                                    onClick={() => window.location.assign('/login')}
                                    style={{ padding: '10px 20px', borderRadius: 12, border: 'none', background: '#18181b', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    Ir al inicio de sesión
                                </button>
                            </div>
                        )}

                        {error?.digest && (
                            <p style={{ marginTop: 24, fontSize: 11, color: '#a1a1aa', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                                ref: {error.digest}
                            </p>
                        )}
                    </div>
                </div>
            </body>
        </html>
    );
}
