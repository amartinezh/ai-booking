// El menú por rol vive en @agenia/shared (packages/shared/src/menus.ts): lo leen la
// web y el asistente de soporte de la API. Aquí solo se reexporta para la web.
export {
    GRUPOS_DEL_MENU,
    GRUPOS_DE_CONFIGURACION,
    accesosRapidos,
    getMenusForRole,
    seccionesDeConfiguracion,
    seccionesDelMenu,
    type GrupoDeConfiguracion,
    type MenuAccent,
    type MenuGrupo,
    type MenuItem,
    type OpcionesDelMenu,
    type SeccionDeConfiguracion,
    type SeccionDelMenu,
    type UserRole,
} from '@agenia/shared';
