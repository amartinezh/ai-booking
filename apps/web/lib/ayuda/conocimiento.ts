// El lector de docs/conocimiento/AGENIA.md vive en @agenia/shared
// (packages/shared/src/conocimiento.ts): lo usan el Centro de ayuda y el asistente
// de soporte de la API. Aquí solo se reexporta para la web.
export {
    ErrorDeConocimiento,
    MARCA_FIN,
    MARCA_INICIO,
    parsearConocimiento,
    temaDeRuta,
    validarConocimiento,
} from '@agenia/shared';
