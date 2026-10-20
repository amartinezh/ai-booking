// El buscador del Centro de ayuda (sin IA) vive en @agenia/shared
// (packages/shared/src/conocimiento-buscador.ts): lo usan la página de ayuda y el
// asistente de soporte de la API cuando responde sin IA. Aquí solo se reexporta.
export {
    GLOSARIO_ID,
    anclaDe,
    buscar,
    crearIndice,
    distancia,
    extracto,
    fragmentosDe,
    normalizar,
    raiz,
    resaltar,
    sugerir,
    type Fragmento,
    type IndiceAyuda,
    type RespuestaBusqueda,
    type ResultadoBusqueda,
    type Segmento,
    type TipoFragmento,
} from '@agenia/shared';
