import {
    textoAnticipacion,
    textoParteDelChat,
    textoPlazoAgendar,
    textoSabadoRural,
    type LimitesCitas,
} from '@agenia/shared';
import { alertasLleganPorWhatsapp } from './telefono-soporte';

// ─────────────────────────────────────────────────────────────
// El Resumen de Configuración (docs/PLAN_NAVEGACION.md §5.1): una línea por
// ajuste importante, con su estado y el enlace al lugar exacto, y arriba lo que
// falta. Lógica pura: la página lee los datos (cada uno aislado: si uno falla
// llega null y su línea dice «No se pudo leer») y esto arma lo que se muestra.
// ─────────────────────────────────────────────────────────────

export const RUTA = '/dashboard/configuracion';

export type EstadoFila = 'encendido' | 'apagado' | 'neutro' | 'falta';

export interface FilaResumen {
    nombre: string;
    valor: string;
    estado: EstadoFila;
    /** El ajuste exacto: la sección y su ancla. */
    href: string;
}

export interface BloqueResumen {
    titulo: string;
    icono: string;
    href: string;
    filas: FilaResumen[];
}

export interface AvisoResumen {
    texto: string;
    href: string;
    enlace: string;
}

export interface Resumen {
    avisos: AvisoResumen[];
    bloques: BloqueResumen[];
}

export interface DatosDelResumen {
    ajustes: {
        bookingEnabled: boolean;
        cancelEnabled: boolean;
        rescheduleEnabled: boolean;
        bookingMaxDaysAhead: number | null;
        botAgendaSharePercent: number | null;
        saturdayRuralSharePercent: number | null;
        slotsOfferedCount: number;
        remindersEnabled: boolean;
        remindersOnlySelfBooked: boolean;
        reminderMinLeadMinutes: number;
        botName: string;
        communicationStyle: 'FORMAL' | 'INFORMAL';
        autorizacionDatos: { encendida: boolean; urlPolitica: string };
    } | null;
    limites: LimitesCitas | null;
    /** Cuántas reglas tiene «Días sin citas». */
    bloqueos: number | null;
    baseDeConocimiento: string | null;
    ia: { activeProvider: string; model: string | null; hasApiKey: boolean } | null;
    whatsapp: {
        phoneNumberId: string | null;
        displayPhoneNumber: string | null;
        hasAccessToken: boolean;
        isActive: boolean;
    } | null;
    /** `{ enabled: false }`: el servidor no tiene Telegram. */
    telegram: { enabled: false } | { enabled: true; config: { connected: boolean; isActive: boolean; botUsername: string | null } } | null;
    voz: { activeProvider: string; gender: string } | null;
    politicaPublicada: boolean | null;
    /**
     * Solo con espejo (`undefined` = la clínica no tiene espejo: no hay bloque).
     * null = no se pudo leer.
     */
    hospital?: {
        encendido: boolean;
        auto: boolean;
        whatsappOn: boolean;
        modoAgenda: string;
        /** Los avisos por WhatsApp a los agendadores; null = no se pudo leer. */
        avisos: { salen: boolean; personas: number } | null;
    } | null;
    /** null = la clínica no lo tiene; undefined = no se pudo leer. */
    telefonoSoporte: string | null | undefined;
}

const NO_SE_PUDO = 'No se pudo leer';
const sinLeer = (nombre: string, href: string): FilaResumen => ({ nombre, valor: NO_SE_PUDO, estado: 'neutro', href });
const interruptor = (nombre: string, encendido: boolean, href: string, si = 'Encendido', no = 'Apagado'): FilaResumen => ({
    nombre,
    valor: encendido ? si : no,
    estado: encendido ? 'encendido' : 'apagado',
    href,
});

const PROVEEDOR_IA: Record<string, string> = { GEMINI: 'Gemini', CHATGPT: 'ChatGPT', CLAUDE: 'Claude' };
const PROVEEDOR_VOZ: Record<string, string> = { ELEVENLABS: 'ElevenLabs', GOOGLE: 'Google Cloud TTS' };
const MODO_AGENDA: Record<string, string> = {
    OFF: 'OFF: la agenda es la de AgenIA',
    SHADOW: 'SHADOW: se compara con la del hospital',
    ON: 'ON: la agenda es la del hospital',
};

/** «1 cita al día y 3 al mes», «3 citas al mes», «Sin límite». */
export function textoLimites(l: LimitesCitas): string {
    const citas = (n: number) => (n === 1 ? '1 cita' : `${n} citas`);
    if (l.diaActivo && l.mesActivo) return `${citas(l.maxDia)} al día y ${l.maxMes} al mes`;
    if (l.diaActivo) return `${citas(l.maxDia)} al día`;
    if (l.mesActivo) return `${citas(l.maxMes)} al mes`;
    return 'Sin límite';
}

export function iaConfigurada(ia: NonNullable<DatosDelResumen['ia']>): boolean {
    return ia.activeProvider !== 'NONE' && ia.hasApiKey;
}

export function whatsappConectado(w: NonNullable<DatosDelResumen['whatsapp']>): boolean {
    return !!w.phoneNumberId && w.hasAccessToken && w.isActive;
}

export function armarResumen(d: DatosDelResumen): Resumen {
    const a = d.ajustes;
    const asistente = `${RUTA}/asistente`;
    const agenda = `${RUTA}/agenda`;
    const recordatorios = `${RUTA}/recordatorios`;
    const identidad = `${RUTA}/identidad`;
    const conocimiento = `${RUTA}/conocimiento`;
    const clinica = `${RUTA}/clinica`;
    const privacidad = `${RUTA}/privacidad`;
    const canales = `${RUTA}/canales`;
    const hospital = `${RUTA}/hospital`;

    const bloques: BloqueResumen[] = [
        {
            titulo: 'Qué puede hacer el asistente',
            icono: '🤖',
            href: asistente,
            filas: [
                a ? interruptor('Agendar citas', a.bookingEnabled, `${asistente}#agendar`) : sinLeer('Agendar citas', `${asistente}#agendar`),
                a ? interruptor('Cancelar citas', a.cancelEnabled, `${asistente}#cancelar`) : sinLeer('Cancelar citas', `${asistente}#cancelar`),
                a
                    ? interruptor('Cambiar la fecha', a.rescheduleEnabled, `${asistente}#cambiar-fecha`)
                    : sinLeer('Cambiar la fecha', `${asistente}#cambiar-fecha`),
                d.limites
                    ? {
                          nombre: 'Límite por paciente',
                          valor: textoLimites(d.limites),
                          estado: d.limites.diaActivo || d.limites.mesActivo ? 'encendido' : 'apagado',
                          href: `${asistente}#limite`,
                      }
                    : sinLeer('Límite por paciente', `${asistente}#limite`),
            ],
        },
        {
            titulo: 'Agenda que ofrece el asistente',
            icono: '🗓️',
            href: agenda,
            filas: [
                a
                    ? { nombre: 'Plazo máximo', valor: textoPlazoAgendar(a.bookingMaxDaysAhead), estado: 'neutro', href: `${agenda}#plazo` }
                    : sinLeer('Plazo máximo', `${agenda}#plazo`),
                d.bloqueos === null
                    ? sinLeer('Días sin citas', `${agenda}#dias-sin-citas`)
                    : {
                          nombre: 'Días sin citas',
                          valor: d.bloqueos === 0 ? 'Ninguno' : d.bloqueos === 1 ? '1 bloqueo' : `${d.bloqueos} bloqueos`,
                          estado: 'neutro',
                          href: `${agenda}#dias-sin-citas`,
                      },
                a
                    ? { nombre: 'Sábados', valor: textoSabadoRural(a.saturdayRuralSharePercent), estado: 'neutro', href: `${agenda}#sabados` }
                    : sinLeer('Sábados', `${agenda}#sabados`),
                a
                    ? {
                          nombre: 'Parte de la agenda para el asistente',
                          valor: textoParteDelChat(a.botAgendaSharePercent),
                          estado: 'neutro',
                          href: `${agenda}#parte-asistente`,
                      }
                    : sinLeer('Parte de la agenda para el asistente', `${agenda}#parte-asistente`),
                a
                    ? { nombre: 'Horarios que ofrece', valor: `${a.slotsOfferedCount} opciones`, estado: 'neutro', href: `${agenda}#horarios` }
                    : sinLeer('Horarios que ofrece', `${agenda}#horarios`),
            ],
        },
        {
            titulo: 'Recordatorios',
            icono: '🔔',
            href: recordatorios,
            filas: a
                ? [
                      interruptor('Recordatorios automáticos', a.remindersEnabled, `${recordatorios}#recordatorios`, 'Encendidos', 'Apagados'),
                      interruptor('Solo a quien agendó por el chat', a.remindersOnlySelfBooked, `${recordatorios}#solo-chat`),
                      {
                          nombre: 'Anticipación mínima',
                          valor: a.reminderMinLeadMinutes === 0 ? 'Sin mínimo' : textoAnticipacion(a.reminderMinLeadMinutes),
                          estado: 'neutro',
                          href: `${recordatorios}#anticipacion`,
                      },
                  ]
                : [sinLeer('Recordatorios automáticos', `${recordatorios}#recordatorios`)],
        },
        {
            titulo: 'Nombre, tono y voz',
            icono: '🗣️',
            href: identidad,
            filas: [
                a ? { nombre: 'Nombre', valor: a.botName, estado: 'neutro', href: `${identidad}#nombre-tono` } : sinLeer('Nombre', `${identidad}#nombre-tono`),
                a
                    ? {
                          nombre: 'Tono',
                          valor: a.communicationStyle === 'INFORMAL' ? 'Informal (tú)' : 'Formal (usted)',
                          estado: 'neutro',
                          href: `${identidad}#nombre-tono`,
                      }
                    : sinLeer('Tono', `${identidad}#nombre-tono`),
                d.voz
                    ? {
                          nombre: 'Voz',
                          valor: `${PROVEEDOR_VOZ[d.voz.activeProvider] ?? d.voz.activeProvider}, ${d.voz.gender === 'MASCULINO' ? 'masculina' : 'femenina'}`,
                          estado: 'neutro',
                          href: `${identidad}#voz`,
                      }
                    : sinLeer('Voz', `${identidad}#voz`),
            ],
        },
        {
            titulo: 'Base de conocimiento',
            icono: '📚',
            href: conocimiento,
            filas: [
                d.baseDeConocimiento === null
                    ? sinLeer('Contenido', `${conocimiento}#base`)
                    : d.baseDeConocimiento.trim() === ''
                      ? { nombre: 'Contenido', valor: 'Vacía', estado: 'falta', href: `${conocimiento}#base` }
                      : {
                            nombre: 'Contenido',
                            valor: `${d.baseDeConocimiento.trim().split(/\s+/).length} palabras`,
                            estado: 'neutro',
                            href: `${conocimiento}#base`,
                        },
            ],
        },
        {
            titulo: 'Datos de la clínica',
            icono: '🏢',
            href: clinica,
            filas:
                d.telefonoSoporte === undefined
                    ? [sinLeer('Teléfono de soporte', `${clinica}#telefono`)]
                    : d.telefonoSoporte === null
                      ? [{ nombre: 'Teléfono de soporte', valor: 'Sin teléfono', estado: 'falta', href: `${clinica}#telefono` }]
                      : [
                            { nombre: 'Teléfono de soporte', valor: d.telefonoSoporte, estado: 'neutro', href: `${clinica}#telefono` },
                            alertasLleganPorWhatsapp(d.telefonoSoporte)
                                ? { nombre: 'Alertas de emergencia', valor: 'Por WhatsApp, si escribió en 24 h', estado: 'neutro', href: `${clinica}#telefono` }
                                : { nombre: 'Alertas de emergencia', valor: 'No llegan por WhatsApp', estado: 'falta', href: `${clinica}#telefono` },
                        ],
        },
        {
            titulo: 'Privacidad (Ley 1581)',
            icono: '🔒',
            href: privacidad,
            filas: [
                a
                    ? interruptor('Autorización antes de agendar', a.autorizacionDatos.encendida, `${privacidad}#autorizacion`, 'Encendida', 'Apagada')
                    : sinLeer('Autorización antes de agendar', `${privacidad}#autorizacion`),
                a
                    ? {
                          nombre: 'Enlace de la política',
                          valor: a.autorizacionDatos.urlPolitica.trim() ? 'Configurado' : 'Sin enlace',
                          estado: 'neutro',
                          href: `${privacidad}#autorizacion`,
                      }
                    : sinLeer('Enlace de la política', `${privacidad}#autorizacion`),
                d.politicaPublicada === null
                    ? sinLeer('Página pública de la política', `${privacidad}#politica`)
                    : interruptor('Página pública de la política', d.politicaPublicada, `${privacidad}#politica`, 'Publicada', 'Sin publicar'),
            ],
        },
        {
            titulo: 'Canales e IA',
            icono: '🔌',
            href: canales,
            filas: [
                !d.ia
                    ? sinLeer('Inteligencia artificial', `${canales}#ia`)
                    : iaConfigurada(d.ia)
                      ? {
                            nombre: 'Inteligencia artificial',
                            valor: [PROVEEDOR_IA[d.ia.activeProvider] ?? d.ia.activeProvider, d.ia.model].filter(Boolean).join(' · '),
                            estado: 'encendido',
                            href: `${canales}#ia`,
                        }
                      : { nombre: 'Inteligencia artificial', valor: 'Sin configurar', estado: 'falta', href: `${canales}#ia` },
                !d.whatsapp
                    ? sinLeer('WhatsApp', `${canales}#whatsapp`)
                    : whatsappConectado(d.whatsapp)
                      ? {
                            nombre: 'WhatsApp',
                            valor: `Conectado${d.whatsapp.displayPhoneNumber ? ` · ${d.whatsapp.displayPhoneNumber}` : ''}`,
                            estado: 'encendido',
                            href: `${canales}#whatsapp`,
                        }
                      : d.whatsapp.phoneNumberId && d.whatsapp.hasAccessToken
                        ? { nombre: 'WhatsApp', valor: 'Apagado', estado: 'apagado', href: `${canales}#whatsapp` }
                        : { nombre: 'WhatsApp', valor: 'Sin conectar', estado: 'falta', href: `${canales}#whatsapp` },
                !d.telegram
                    ? sinLeer('Telegram', `${canales}#telegram`)
                    : !d.telegram.enabled
                      ? { nombre: 'Telegram', valor: 'No disponible en este servidor', estado: 'neutro', href: `${canales}#telegram` }
                      : d.telegram.config.connected && d.telegram.config.isActive
                        ? {
                              nombre: 'Telegram',
                              valor: `Conectado${d.telegram.config.botUsername ? ` · @${d.telegram.config.botUsername}` : ''}`,
                              estado: 'encendido',
                              href: `${canales}#telegram`,
                          }
                        : { nombre: 'Telegram', valor: 'Sin conectar', estado: 'apagado', href: `${canales}#telegram` },
            ],
        },
    ];

    if (d.hospital !== undefined) {
        const h = d.hospital;
        bloques.push({
            titulo: 'Hospital (espejo)',
            icono: '🏥',
            href: hospital,
            filas: !h
                ? [sinLeer('Espejo con el hospital', `${hospital}#medicos-nuevos`)]
                : [
                      interruptor('Espejo con el hospital', h.encendido, '/dashboard/espejo'),
                      interruptor(
                          'Médicos nuevos del hospital',
                          h.auto,
                          `${hospital}#medicos-nuevos`,
                          h.whatsappOn ? 'Se agregan solos, con WhatsApp' : 'Se agregan solos, sin WhatsApp',
                          'Se crean desde la Bandeja',
                      ),
                      {
                          nombre: 'Modo de agenda',
                          valor: MODO_AGENDA[h.modoAgenda] ?? h.modoAgenda,
                          estado: 'neutro',
                          href: `${hospital}#modo-agenda`,
                      },
                      !h.avisos
                          ? sinLeer('Avisos a los agendadores', `${hospital}#avisos-agendadores`)
                          : h.avisos.salen
                            ? {
                                  nombre: 'Avisos a los agendadores',
                                  valor: h.avisos.personas === 1 ? 'Llegan a 1 persona' : `Llegan a ${h.avisos.personas} personas`,
                                  estado: 'encendido',
                                  href: `${hospital}#avisos-agendadores`,
                              }
                            : {
                                  nombre: 'Avisos a los agendadores',
                                  valor: 'No están saliendo',
                                  estado: 'falta',
                                  href: `${hospital}#avisos-agendadores`,
                              },
                  ],
        });
    }

    const avisos: AvisoResumen[] = [];
    if (a && !a.bookingEnabled && !a.cancelEnabled && !a.rescheduleEnabled) {
        avisos.push({
            texto: 'Agendar, cancelar y cambiar la fecha están apagados: el asistente solo consulta citas.',
            href: asistente,
            enlace: 'Ver qué puede hacer',
        });
    }
    if (d.ia && !iaConfigurada(d.ia)) {
        avisos.push({
            texto: 'No hay un proveedor de inteligencia artificial configurado.',
            href: `${canales}#ia`,
            enlace: 'Configurarlo',
        });
    }
    if (d.whatsapp && !whatsappConectado(d.whatsapp)) {
        avisos.push({
            texto: 'WhatsApp no está conectado: el asistente no recibe ni envía mensajes por WhatsApp.',
            href: `${canales}#whatsapp`,
            enlace: 'Conectarlo',
        });
    }
    if (d.baseDeConocimiento !== null && d.baseDeConocimiento.trim() === '') {
        avisos.push({
            texto: 'La base de conocimiento está vacía: el asistente no sabe responder sobre horarios, dirección o tarifas de la clínica.',
            href: `${conocimiento}#base`,
            enlace: 'Escribirla',
        });
    }
    if (d.hospital?.avisos && !d.hospital.avisos.salen) {
        avisos.push({
            texto: 'Los avisos por WhatsApp a los agendadores no están saliendo: lo que no llegue al hospital solo se ve abriendo la Bandeja.',
            href: `${hospital}#avisos-agendadores`,
            enlace: 'Revisarlos',
        });
    }
    if (d.telefonoSoporte === null) {
        avisos.push({
            texto: 'La clínica no tiene teléfono de soporte: es el número que el asistente les da a los pacientes y al que llegan las alertas de posible emergencia.',
            href: `${clinica}#telefono`,
            enlace: 'Escribirlo',
        });
    } else if (d.telefonoSoporte && !alertasLleganPorWhatsapp(d.telefonoSoporte)) {
        avisos.push({
            texto: 'El teléfono de soporte no es un celular con indicativo: las alertas de posible emergencia no llegan por WhatsApp y solo quedan en la Caja Negra.',
            href: `${clinica}#telefono`,
            enlace: 'Revisarlo',
        });
    }
    return { avisos, bloques };
}

/**
 * Las pestañas de antes (`?tab=…`), a su sección. Así no se rompe ningún
 * marcador ni enlace viejo. Estadísticas para compartir pasó a Analíticas.
 */
export function destinoDePestanaVieja(tab: string | undefined): string | null {
    switch (tab) {
        case 'chatbot':
            return `${RUTA}/asistente`;
        case 'dias':
            return `${RUTA}/agenda#dias-sin-citas`;
        case 'integrations':
        case 'ai':
            return `${RUTA}/canales`;
        case 'kb':
            return `${RUTA}/conocimiento`;
        case 'estadisticas':
            return '/dashboard/analytics#compartir';
        default:
            return null;
    }
}

/** Hasta qué día (de la clínica) el Resumen explica dónde quedó lo de las pestañas de antes. */
export const AVISO_DE_LAS_PESTANAS_HASTA = '2026-12-21';
