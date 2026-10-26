/**
 * El menú del super administrador. Lo pintan el layout de /super-admin y lo lee la
 * Actividad de usuarios para nombrar las pantallas que abre cada persona.
 */
export const SUPER_ADMIN_MENUS = [
    { label: 'Organizaciones', href: '/super-admin/organizations', icon: '🏢' },
    { label: 'Estadísticas Globales', href: '/super-admin/stats', icon: '📊' },
    { label: 'Canales en vivo', href: '/super-admin/canales', icon: '📈' },
    { label: 'Encuestas (CSAT)', href: '/super-admin/surveys', icon: '⭐' },
    { label: 'Facturación Global', href: '/super-admin/billing', icon: '💳' },
    { label: 'Mesa de Ayuda', href: '/super-admin/support', icon: '🛟' },
    { label: 'Asistente de soporte', href: '/super-admin/soporte-bot', icon: '🤖' },
    { label: 'Monitor de Servicios', href: '/super-admin/monitor', icon: '📡' },
    { label: 'Alertas técnicas', href: '/super-admin/alertas', icon: '🚨' },
    { label: 'Actividad de usuarios', href: '/super-admin/actividad', icon: '👣' },
    { label: 'Auditoría y Logs', href: '/super-admin/logs', icon: '🩻' },
    { label: 'Rastreo de paciente', href: '/super-admin/rastreo', icon: '🔎' },
] as const;
