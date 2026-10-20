// El menú por rol vive en @agenia/shared (packages/shared/src/menus.ts): lo leen la
// web y el asistente de soporte de la API. Aquí solo se reexporta para la web.
export { getMenusForRole, type MenuAccent, type MenuItem, type UserRole } from '@agenia/shared';
