import { armarResumen, destinoDePestanaVieja, textoLimites, type DatosDelResumen } from './resumen';

const AJUSTES: NonNullable<DatosDelResumen['ajustes']> = {
    bookingEnabled: true,
    cancelEnabled: true,
    rescheduleEnabled: false,
    bookingMaxDaysAhead: 4,
    botAgendaSharePercent: 50,
    saturdayRuralSharePercent: null,
    slotsOfferedCount: 6,
    remindersEnabled: true,
    remindersOnlySelfBooked: false,
    reminderMinLeadMinutes: 60,
    botName: 'Vicente',
    communicationStyle: 'FORMAL',
    autorizacionDatos: { encendida: false, urlPolitica: '' },
};

const TODO_BIEN: DatosDelResumen = {
    ajustes: AJUSTES,
    limites: { diaActivo: true, maxDia: 1, mesActivo: true, maxMes: 3 },
    bloqueos: 2,
    baseDeConocimiento: 'Horario de lunes a viernes de 7 a 5.',
    ia: { activeProvider: 'GEMINI', model: 'gemini-2.5-flash', hasApiKey: true },
    whatsapp: { phoneNumberId: '123', displayPhoneNumber: '+57 300 000 0000', hasAccessToken: true, isActive: true },
    telegram: { enabled: true, config: { connected: true, isActive: true, botUsername: 'clinica_bot' } },
    voz: { activeProvider: 'ELEVENLABS', gender: 'FEMENINO' },
    politicaPublicada: true,
    telefonoSoporte: '+57 300 000 0000',
};

const fila = (r: ReturnType<typeof armarResumen>, bloque: string, nombre: string) =>
    r.bloques.find((b) => b.titulo === bloque)?.filas.find((f) => f.nombre === nombre);

describe('armarResumen (docs/PLAN_NAVEGACION.md §5.1)', () => {
    it('cada bloque es una sección, en el orden de la columna, y sin espejo no hay bloque del hospital', () => {
        const r = armarResumen(TODO_BIEN);
        expect(r.bloques.map((b) => [b.titulo, b.href])).toEqual([
            ['Qué puede hacer el asistente', '/dashboard/configuracion/asistente'],
            ['Agenda que ofrece el asistente', '/dashboard/configuracion/agenda'],
            ['Recordatorios', '/dashboard/configuracion/recordatorios'],
            ['Nombre, tono y voz', '/dashboard/configuracion/identidad'],
            ['Base de conocimiento', '/dashboard/configuracion/conocimiento'],
            ['Datos de la clínica', '/dashboard/configuracion/clinica'],
            ['Privacidad (Ley 1581)', '/dashboard/configuracion/privacidad'],
            ['Canales e IA', '/dashboard/configuracion/canales'],
        ]);
        expect(r.avisos).toEqual([]);
    });

    it('cada línea lleva a su ajuste exacto, dentro de su sección', () => {
        for (const b of armarResumen({ ...TODO_BIEN, hospital: { encendido: true, auto: false, whatsappOn: false, modoAgenda: 'ON', avisos: { salen: true, personas: 2 } } }).bloques) {
            for (const f of b.filas) {
                if (f.href === '/dashboard/espejo') continue; // el espejo mismo se enciende en su pantalla
                expect(f.href.startsWith(`${b.href}#`)).toBe(true);
            }
        }
    });

    it('dice qué está encendido y qué apagado, con los textos de cada ajuste', () => {
        const r = armarResumen(TODO_BIEN);
        expect(fila(r, 'Qué puede hacer el asistente', 'Agendar citas')).toMatchObject({ valor: 'Encendido', estado: 'encendido' });
        expect(fila(r, 'Qué puede hacer el asistente', 'Cambiar la fecha')).toMatchObject({ valor: 'Apagado', estado: 'apagado', href: '/dashboard/configuracion/asistente#cambiar-fecha' });
        expect(fila(r, 'Qué puede hacer el asistente', 'Límite por paciente')?.valor).toBe('1 cita al día y 3 al mes');
        expect(fila(r, 'Agenda que ofrece el asistente', 'Plazo máximo')?.valor).toBe('4 días');
        expect(fila(r, 'Agenda que ofrece el asistente', 'Días sin citas')?.valor).toBe('2 bloqueos');
        expect(fila(r, 'Agenda que ofrece el asistente', 'Sábados')?.valor).toBe('Sin regla especial');
        expect(fila(r, 'Agenda que ofrece el asistente', 'Parte de la agenda para el asistente')?.valor).toBe('50 % para el asistente, 50 % para el hospital');
        expect(fila(r, 'Agenda que ofrece el asistente', 'Horarios que ofrece')?.valor).toBe('6 opciones');
        expect(fila(r, 'Recordatorios', 'Anticipación mínima')?.valor).toBe('1 hora');
        expect(fila(r, 'Nombre, tono y voz', 'Tono')?.valor).toBe('Formal (usted)');
        expect(fila(r, 'Nombre, tono y voz', 'Voz')?.valor).toBe('ElevenLabs, femenina');
        expect(fila(r, 'Base de conocimiento', 'Contenido')?.valor).toBe('9 palabras');
        expect(fila(r, 'Privacidad (Ley 1581)', 'Autorización antes de agendar')).toMatchObject({ valor: 'Apagada', estado: 'apagado' });
        expect(fila(r, 'Privacidad (Ley 1581)', 'Enlace de la política')?.valor).toBe('Sin enlace');
        expect(fila(r, 'Privacidad (Ley 1581)', 'Página pública de la política')).toMatchObject({ valor: 'Publicada', href: '/dashboard/configuracion/privacidad#politica' });
        expect(fila(r, 'Canales e IA', 'Inteligencia artificial')?.valor).toBe('Gemini · gemini-2.5-flash');
        expect(fila(r, 'Canales e IA', 'WhatsApp')?.valor).toBe('Conectado · +57 300 000 0000');
        expect(fila(r, 'Canales e IA', 'Telegram')?.valor).toBe('Conectado · @clinica_bot');
    });

    it('lo que falta va arriba, con el enlace para arreglarlo', () => {
        const r = armarResumen({
            ...TODO_BIEN,
            ajustes: { ...AJUSTES, bookingEnabled: false, cancelEnabled: false, rescheduleEnabled: false },
            ia: { activeProvider: 'NONE', model: null, hasApiKey: false },
            whatsapp: { phoneNumberId: null, displayPhoneNumber: null, hasAccessToken: false, isActive: false },
            baseDeConocimiento: '   ',
            telefonoSoporte: null,
        });
        expect(r.avisos.map((a) => a.href)).toEqual([
            '/dashboard/configuracion/asistente',
            '/dashboard/configuracion/canales#ia',
            '/dashboard/configuracion/canales#whatsapp',
            '/dashboard/configuracion/conocimiento#base',
            '/dashboard/configuracion/clinica#telefono',
        ]);
        expect(r.avisos[0].texto).toMatch(/solo consulta citas/);
        expect(fila(r, 'Canales e IA', 'Inteligencia artificial')).toMatchObject({ valor: 'Sin configurar', estado: 'falta' });
        expect(fila(r, 'Canales e IA', 'WhatsApp')).toMatchObject({ valor: 'Sin conectar', estado: 'falta' });
        expect(fila(r, 'Base de conocimiento', 'Contenido')).toMatchObject({ valor: 'Vacía', estado: 'falta' });
    });

    it('un teléfono fijo: se dice que las alertas de emergencia no llegan por WhatsApp', () => {
        const r = armarResumen({ ...TODO_BIEN, telefonoSoporte: '(606) 859 1010' });
        expect(fila(r, 'Datos de la clínica', 'Alertas de emergencia')).toMatchObject({ valor: 'No llegan por WhatsApp', estado: 'falta' });
        expect(r.avisos.map((a) => a.href)).toEqual(['/dashboard/configuracion/clinica#telefono']);
        expect(fila(armarResumen(TODO_BIEN), 'Datos de la clínica', 'Alertas de emergencia')?.valor).toBe('Por WhatsApp, si escribió en 24 h');
    });

    it('WhatsApp con número y token pero apagado: apagado, no «sin conectar»', () => {
        const r = armarResumen({
            ...TODO_BIEN,
            whatsapp: { phoneNumberId: '123', displayPhoneNumber: null, hasAccessToken: true, isActive: false },
        });
        expect(fila(r, 'Canales e IA', 'WhatsApp')).toMatchObject({ valor: 'Apagado', estado: 'apagado' });
    });

    it('lo que no se pudo leer lo dice en su línea, sin inventar ni avisar de más', () => {
        const r = armarResumen({
            ajustes: null,
            limites: null,
            bloqueos: null,
            baseDeConocimiento: null,
            ia: null,
            whatsapp: null,
            telegram: null,
            voz: null,
            politicaPublicada: null,
            hospital: null,
            telefonoSoporte: undefined,
        });
        const valores = r.bloques.flatMap((b) => b.filas.map((f) => f.valor));
        expect(new Set(valores)).toEqual(new Set(['No se pudo leer']));
        expect(r.avisos).toEqual([]);
        expect(r.bloques[r.bloques.length - 1].titulo).toBe('Hospital (espejo)');
    });

    it('Telegram apagado en el servidor no es un problema de la clínica', () => {
        const r = armarResumen({ ...TODO_BIEN, telegram: { enabled: false } });
        expect(fila(r, 'Canales e IA', 'Telegram')).toMatchObject({ valor: 'No disponible en este servidor', estado: 'neutro' });
    });

    it('con espejo: el bloque del hospital, con los médicos nuevos y el modo de agenda', () => {
        const r = armarResumen({
            ...TODO_BIEN,
            hospital: { encendido: true, auto: true, whatsappOn: false, modoAgenda: 'SHADOW', avisos: { salen: true, personas: 1 } },
        });
        const b = r.bloques[r.bloques.length - 1];
        expect(b).toMatchObject({ titulo: 'Hospital (espejo)', href: '/dashboard/configuracion/hospital' });
        expect(b.filas.map((f) => f.valor)).toEqual([
            'Encendido',
            'Se agregan solos, sin WhatsApp',
            'SHADOW: se compara con la del hospital',
            'Llegan a 1 persona',
        ]);
        expect(r.avisos).toEqual([]);
    });

    it('si los avisos a los agendadores no salen, es de lo que falta; si no se pudieron leer, no se alarma', () => {
        const hospital = { encendido: true, auto: false, whatsappOn: false, modoAgenda: 'ON' };
        const no = armarResumen({ ...TODO_BIEN, hospital: { ...hospital, avisos: { salen: false, personas: 0 } } });
        expect(fila(no, 'Hospital (espejo)', 'Avisos a los agendadores')).toMatchObject({ valor: 'No están saliendo', estado: 'falta' });
        expect(no.avisos.map((a) => a.href)).toEqual(['/dashboard/configuracion/hospital#avisos-agendadores']);

        const sinLeer = armarResumen({ ...TODO_BIEN, hospital: { ...hospital, avisos: null } });
        expect(fila(sinLeer, 'Hospital (espejo)', 'Avisos a los agendadores')?.valor).toBe('No se pudo leer');
        expect(sinLeer.avisos).toEqual([]);
    });
});

describe('textoLimites', () => {
    it.each([
        [{ diaActivo: true, maxDia: 1, mesActivo: true, maxMes: 3 }, '1 cita al día y 3 al mes'],
        [{ diaActivo: true, maxDia: 2, mesActivo: false, maxMes: 3 }, '2 citas al día'],
        [{ diaActivo: false, maxDia: 1, mesActivo: true, maxMes: 1 }, '1 cita al mes'],
        [{ diaActivo: false, maxDia: 1, mesActivo: false, maxMes: 3 }, 'Sin límite'],
    ])('%p → %s', (l, texto) => {
        expect(textoLimites(l)).toBe(texto);
    });
});

describe('destinoDePestanaVieja: las pestañas de antes llevan a su sección', () => {
    it.each([
        ['chatbot', '/dashboard/configuracion/asistente'],
        ['dias', '/dashboard/configuracion/agenda#dias-sin-citas'],
        ['integrations', '/dashboard/configuracion/canales'],
        ['ai', '/dashboard/configuracion/canales'],
        ['kb', '/dashboard/configuracion/conocimiento'],
        ['estadisticas', '/dashboard/analytics#compartir'],
    ])('?tab=%s → %s', (tab, destino) => {
        expect(destinoDePestanaVieja(tab)).toBe(destino);
    });

    it.each([undefined, '', 'otra'])('%p se queda en el Resumen', (tab) => {
        expect(destinoDePestanaVieja(tab)).toBeNull();
    });
});
