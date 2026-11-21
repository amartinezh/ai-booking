// El menú por rol vive en @agenia/shared (packages/shared/src/menus.ts): lo leen la
// web y el asistente de soporte de la API. Aquí solo se reexporta para la web.
export {
    GRUPOS_DEL_MENU,
    accesosRapidos,
    getMenusForRole,
    seccionesDelMenu,
    type MenuAccent,
    type MenuGrupo,
    type MenuItem,
    type OpcionesDelMenu,
    type SeccionDelMenu,
    type UserRole,
} from '@agenia/shared';
