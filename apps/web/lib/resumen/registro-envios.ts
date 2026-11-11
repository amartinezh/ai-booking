import { formatAppointmentCompact, formatTimeOnly } from '@/lib/date';
import type { AtencionConEnvios, EnvioDeLaAtencion } from '@/app/actions/resumen-envios';

/**
 * 🧾 Cómo se cuenta, en palabras, el recorrido de un envío del resumen de la
 * atención (docs/PLAN_RESUMEN_ATENCION.md §8.10): en la pantalla «Envíos de
 * documentos» y en el registro que se descarga en Excel. Sin contenido clínico.
 */

export const CANAL_DEL_ENVIO: Record<string, string> = { WHATSAPP: 'WhatsApp', TELEGRAM: 'Telegram', EMAIL: 'Correo' };

export const ESTADO_DE_LA_ATENCION: Record<string, string> = {
    RECIBIDO: 'Sin enviar todavía',
    ENVIADO: 'Avisado',
    EXCLUIDO: 'No se envía',
    SIN_CONTACTO: 'Sin celular utilizable',
    CADUCADO: 'Ya se borró (30 días)',
};

export const ESTADO_DEL_ENVIO: Record<string, string> = {
    AVISO_ENVIADO: 'Aviso enviado (no ha recibido los documentos)',
    DOCUMENTOS_ENVIADOS: '✓ Documentos entregados',
    FALLO: '⚠ No salió completo',
    NO_ENVIADO: 'Sin correo utilizable',
};

const PROPOSITO: Record<string, string> = { PACIENTE: 'Automático', REENVIO: 'Reenvío', PRUEBA: 'Prueba' };

const fechaHora = (iso: string) => formatAppointmentCompact(iso);
const hora = (iso: string) => formatTimeOnly(iso);

/** «enviado lun, 10 nov, 10:02 a m · entregado 10:02 a m · leído 10:15 a m». */
function lineaDelAviso(e: EnvioDeLaAtencion): string {
    const a = e.traza.aviso;
    if (e.canal === 'EMAIL') {
        return a.enviadoIso
            ? `Correo enviado ${fechaHora(a.enviadoIso)} con el enlace y el PDF (el correo no informa si se leyó)`
            : 'El correo no salió';
    }
    if (!a.enviadoIso) return 'El aviso no salió';
    const como = a.tipo === 'TELEGRAM' ? 'por Telegram' : a.tipo === 'PLANTILLA' ? 'con plantilla' : 'con botón';
    const partes = [`Aviso ${como}: enviado ${fechaHora(a.enviadoIso)}`];
    if (a.tipo === 'TELEGRAM') {
        partes.push(a.estado === 'FAILED' ? `⚠ Telegram no lo aceptó${a.error ? ` (${a.error})` : ''}` : 'Telegram no informa si se leyó');
        return partes.join(' · ');
    }
    if (a.estado === 'FAILED') {
        partes.push(`⚠ Meta no lo entregó${a.error ? `: ${a.error}` : ''}`);
        return partes.join(' · ');
    }
    if (a.entregadoIso) partes.push(`entregado ${hora(a.entregadoIso)}`);
    if (a.leidoIso) partes.push(`leído ${hora(a.leidoIso)}`);
    else if (a.entregadoIso) partes.push('sin leer');
    else if (a.estado === 'DELIVERED' || a.estado === 'READ') partes.push(a.estado === 'READ' ? 'leído' : 'entregado');
    else partes.push('sin confirmación de entrega todavía');
    return partes.join(' · ');
}

/** Las líneas del recorrido de un envío, en orden. */
export function lineasDelEnvio(e: EnvioDeLaAtencion): string[] {
    const t = e.traza;
    const lineas = [lineaDelAviso(e)];
    if (e.canal !== 'EMAIL') {
        if (t.pidioIso) {
            const verificado = t.verificadoIso
                ? ` · verificado ${hora(t.verificadoIso)}${e.verificadoPor === 'FECHA_NACIMIENTO' ? ' con su fecha de nacimiento' : e.verificadoPor === 'NUMERO' ? ' por su número' : ''}`
                : ' · todavía sin verificar';
            lineas.push(`Pidió los documentos ${fechaHora(t.pidioIso)}${verificado}`);
        } else if (t.aviso.enviadoIso) {
            lineas.push('No ha pedido los documentos');
        }
        if (t.documentosIso) {
            const archivos = t.archivos;
            const detalle =
                e.canal === 'WHATSAPP'
                    ? `${archivos.enviados} archivo(s) enviados · ${archivos.entregados} entregados · ${archivos.leidos} vistos`
                    : `${archivos.enviados} archivo(s) enviados`;
            lineas.push(
                `Documentos ${fechaHora(t.documentosIso)}: ${detalle}${archivos.fallidos ? ` · ⚠ ${archivos.fallidos} no salieron` : ''}`,
            );
        }
    }
    return lineas;
}

/** «Abrió la página 2 veces (la última, …) · 3 documentos descargados». null si nunca la abrió. */
export function lineaDeLaPagina(a: AtencionConEnvios): string | null {
    if (!a.pagina.veces) return null;
    return `Abrió la página ${a.pagina.veces} ${a.pagina.veces === 1 ? 'vez' : 'veces'} (la última, ${fechaHora(a.pagina.ultimaIso!)})${
        a.pagina.descargas ? ` · ${a.pagina.descargas} documento(s) descargados` : ''
    }`;
}

const COLUMNAS = [
    'Historia',
    'Atendida',
    'Servicio',
    'Paciente',
    'Documento',
    'Estado de la atención',
    'Motivo',
    'Canal',
    'Tipo de envío',
    'Destino',
    'Estado del envío',
    'Aviso enviado',
    'Cómo salió el aviso',
    'Aviso entregado',
    'Aviso leído',
    'Error del aviso',
    'Pidió los documentos',
    'Verificado',
    'Cómo se verificó',
    'Documentos enviados',
    'Archivos enviados',
    'Archivos entregados',
    'Archivos vistos',
    'Archivos que no salieron',
    'Veces que abrió la página',
] as const;

const COMO_SALIO: Record<string, string> = {
    PLANTILLA: 'Plantilla de WhatsApp',
    MENSAJE: 'Mensaje con botón (WhatsApp)',
    TELEGRAM: 'Telegram',
    CORREO: 'Correo',
};
const COMO_VERIFICO: Record<string, string> = { NUMERO: 'Su número', FECHA_NACIMIENTO: 'Fecha de nacimiento' };

const enCelda = (iso: string | null) => (iso ? fechaHora(iso) : '');

/**
 * Las filas del registro: una por envío; la atención sin envíos (excluida, sin
 * contacto, sin enviar todavía) va en una fila con las columnas del envío vacías.
 */
export function filasDelRegistro(atenciones: AtencionConEnvios[]): (string | number)[][] {
    const filas: (string | number)[][] = [[...COLUMNAS]];
    for (const a of atenciones) {
        const base = [
            a.historia,
            fechaHora(a.atendidaIso),
            a.servicio ?? '',
            a.paciente?.nombre ?? '',
            a.paciente?.documento ?? '',
            ESTADO_DE_LA_ATENCION[a.estado] ?? a.estado,
            a.motivo ?? '',
        ];
        if (!a.envios.length) {
            filas.push([...base, ...Array(COLUMNAS.length - base.length - 1).fill(''), a.pagina.veces]);
            continue;
        }
        for (const e of a.envios) {
            const t = e.traza;
            const mensajeria = e.canal !== 'EMAIL';
            filas.push([
                ...base,
                CANAL_DEL_ENVIO[e.canal] ?? e.canal,
                PROPOSITO[e.proposito] ?? e.proposito,
                e.destino,
                ESTADO_DEL_ENVIO[e.estado] ?? e.estado,
                enCelda(t.aviso.enviadoIso),
                t.aviso.tipo ? COMO_SALIO[t.aviso.tipo] : '',
                enCelda(t.aviso.entregadoIso),
                enCelda(t.aviso.leidoIso),
                t.aviso.error ?? (e.estado === 'FALLO' && !t.aviso.enviadoIso ? (e.motivo ?? '') : ''),
                mensajeria ? enCelda(t.pidioIso) : '',
                mensajeria ? enCelda(t.verificadoIso) : '',
                mensajeria && e.verificadoPor ? (COMO_VERIFICO[e.verificadoPor] ?? e.verificadoPor) : '',
                enCelda(t.documentosIso),
                t.archivos.enviados,
                e.canal === 'WHATSAPP' ? t.archivos.entregados : '',
                e.canal === 'WHATSAPP' ? t.archivos.leidos : '',
                t.archivos.fallidos,
                a.pagina.veces,
            ]);
        }
    }
    return filas;
}

export function nombreDelRegistro(desdeDia: string, hastaDia: string): string {
    return `Envios_documentos_${desdeDia}_a_${hastaDia}.xlsx`;
}
