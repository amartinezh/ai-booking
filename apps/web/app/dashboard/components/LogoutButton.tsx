'use client';

import { useTransition } from 'react';
import { logoutUser } from '@/app/actions/auth';

export default function LogoutButton({ variant = 'sidebar' }: { variant?: 'sidebar' | 'mobile' }) {
    const [pending, startTransition] = useTransition();

    const handleLogout = () => {
        startTransition(async () => {
            await logoutUser();
            window.location.href = '/login';
        });
    };

    if (variant === 'mobile') {
        return (
            <button
                onClick={handleLogout}
                disabled={pending}
                className="p-2 flex items-center justify-center text-red-600 bg-red-50 rounded-lg dark:text-red-400 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
                title="Cerrar Sesión"
            >
                🚪
            </button>
        );
    }

    return (
        <button
            onClick={handleLogout}
            disabled={pending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-xl transition-colors disabled:opacity-50"
        >
            <span>🚪</span> {pending ? 'Cerrando...' : 'Cerrar Sesión'}
        </button>
    );
}
