// Tipos de /dashboard/mensajes-masivos — las acciones viven en `./mensajes-masivos.ts`.
// Ver docs/PLAN_MENSAJES_MASIVOS.md.

import type { EstadoEnvioMasivo, ProblemaTexto, TipoColumna } from '@agenia/shared';

export type Resultado<T extends object = object> = ({ success: true } & T) | { success: false; error: string };

export interface ContactoParaGuardar {
    nombreCompleto: string | null;
    primerNombre: string | null;
    celular: string;
    correo: string | null;
    documento: string | null;
    extras: Record<string, string>;
}

export interface ListaResumen {
    id: string;
    nombre: string;
    descripcion: string | null;
    origen: string;
    contactos: number;
    creada: string;
    envios: number;
    consentimiento: string;
}

export interface ContactoDeLista {
    id: string;
    nombre: string | null;
    celular: string;
    correo: string | null;
    documento: string | null;
    esPaciente: boolean;
    extras: Record<string, string>;
}

export interface EnvioResumen {
    id: string;
    nombre: string;
    estado: EstadoEnvioMasivo;
    lista: string;
    listaId: string;
    total: number;
    enviados: number;
    fallidos: number;
    omitidos: number;
    conImagen: boolean;
    creado: string;
    confirmado: string | null;
    terminado: string | null;
    confirmadoPor: string | null;
    ultimoError: string | null;
}

export interface BorradorDetalle {
    id: string;
    nombre: string;
    listaId: string;
    listaNombre: string;
    contactos: number;
    texto: string;
    ritmo: number;
    imagen: { url: string; ancho: number | null; alto: number | null; bytes: number | null; mime: string } | null;
}

export interface VerificacionPlantillaDto {
    tipo: 'MASS_MESSAGE_TEXT' | 'MASS_MESSAGE_IMAGE';
    configurada: boolean;
    nombre: string | null;
    idioma: string | null;
    verificadaConMeta: boolean;
    estadoMeta: string | null;
    categoria: string | null;
    encabezado: string | null;
    cuerpo: string | null;
    pie: string | null;
    problemas: string[];
}

export interface EstadoMensajesMasivos {
    plantillas: { texto: VerificacionPlantillaDto; imagen: VerificacionPlantillaDto };
    numero: { numero: string | null; nombreVerificado: string | null; calidad: string | null; nivel: string | null } | null;
    ia: boolean;
    horario: { abierto: boolean; proximaApertura: string };
}

export interface PreviaEnvioDto {
    estado: EstadoEnvioMasivo;
    contactos: number;
    bajas: number;
    bajasEnMeta: number;
    aEnviar: number;
    tipoPlantilla: 'MASS_MESSAGE_TEXT' | 'MASS_MESSAGE_IMAGE';
    plantilla: VerificacionPlantillaDto;
    problemasTexto: ProblemaTexto[];
    textoFinal: string;
    ritmoPorMinuto: number;
    horarioAbierto: boolean;
    saleDesde: string;
    minutosEstimados: number;
    terminaria: string;
    bloqueos: string[];
}

export type SinIa = { disponible: false; motivo: string };

export interface RevisionTextoIaDto {
    disponible: true;
    modelo: string;
    puntaje: number;
    resumen: string;
    tono: string;
    problemas: Array<{
        tipo: string;
        gravedad: 'alta' | 'media' | 'baja';
        fragmento: string;
        sugerencia: string;
        explicacion: string;
        aplicable: boolean;
    }>;
    textoSugerido: string | null;
}

export interface RevisionImagenIaDto {
    disponible: true;
    modelo: string;
    puntaje: number;
    resumen: string;
    textoEnImagen: string | null;
    legibilidad: 'buena' | 'regular' | 'mala' | 'sin_texto';
    erroresEnLaImagen: string[];
    datosPersonales: boolean;
    detalleDatosPersonales: string | null;
    contenidoInadecuado: boolean;
    detalleInadecuado: string | null;
    coherenciaConElMensaje: 'alta' | 'media' | 'baja' | 'sin_mensaje';
    recomendaciones: string[];
}

export type MapeoIaDto = { disponible: true; modelo: string; mapeo: TipoColumna[] } | SinIa;

export type FiltroDestinatarios = 'TODOS' | 'PENDIENTE' | 'ENVIADO' | 'LEIDO' | 'NO_ENTREGADO' | 'FALLIDO' | 'OMITIDO';

export interface DestinatarioSeguimiento {
    id: string;
    nombre: string | null;
    celular: string;
    resultado: 'PENDIENTE' | 'ENVIADO' | 'FALLIDO' | 'OMITIDO';
    /** Lo que reportó Meta después de aceptarlo. */
    entrega: 'ENVIADO' | 'ENTREGADO' | 'LEIDO' | 'NO_ENTREGADO' | null;
    motivo: string | null;
    enviado: string | null;
}

export interface SeguimientoEnvio {
    envio: {
        id: string;
        nombre: string;
        estado: EstadoEnvioMasivo;
        texto: string;
        imagenUrl: string | null;
        plantilla: string | null;
        lista: { id: string; nombre: string };
        total: number;
        enviados: number;
        fallidos: number;
        omitidos: number;
        pendientes: number;
        ritmo: number;
        creado: string;
        confirmado: string | null;
        confirmadoPor: string | null;
        iniciado: string | null;
        terminado: string | null;
        ultimoError: string | null;
    };
    entrega: { entregados: number; leidos: number; noEntregados: number; sinConfirmar: number };
    motivos: Array<{ motivo: string; cantidad: number; reintentables: number }>;
    destinatarios: DestinatarioSeguimiento[];
    totalFiltrado: number;
    pagina: number;
    porPagina: number;
}

export interface BajaDto {
    id: string;
    destino: string;
    fuente: 'CHAT' | 'PANEL' | string;
    nota: string | null;
    fecha: string;
}
