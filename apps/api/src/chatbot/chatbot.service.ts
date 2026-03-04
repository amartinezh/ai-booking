import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import { ChatState, SESSION_TTL } from './chatbot.constants';
import { AppointmentsService } from 'src/appointments/appointments.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import textToSpeech from '@google-cloud/text-to-speech'; // 🛑 NUEVO: Importación oficial de Google TTS

@Injectable()
export class ChatbotService {
    private readonly logger = new Logger(ChatbotService.name);
    private readonly genAI: GoogleGenerativeAI;
    private readonly ttsClient = new textToSpeech.TextToSpeechClient(); // 🛑 NUEVO: Cliente de Google Cloud TTS

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
        private httpService: HttpService,
        private redis: RedisService,
        private appointmentsService: AppointmentsService,
    ) {
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        if (!apiKey) {
            this.logger.warn("⚠️ GEMINI_API_KEY no definida. Las funciones de audio fallarán.");
        }
        this.genAI = new GoogleGenerativeAI(apiKey || 'dummy');
    }

    // ==========================================
    // HELPER 1: COMUNICACIÓN OUTBOUND (META API)
    // ==========================================
    private async sendWhatsAppMessage(toPhone: string, text: string) {
        const token = this.configService.get<string>('META_ACCESS_TOKEN');
        const phoneId = this.configService.get<string>('META_PHONE_ID');

        if (!phoneId) {
            throw new Error("CRÍTICO: META_PHONE_ID no está definido en el archivo .env");
        }
        const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

        const data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: toPhone,
            type: 'text',
            text: {
                preview_url: false,
                body: text,
            },
        };

        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        try {
            const response = await lastValueFrom(
                this.httpService.post(url, data, { headers }),
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Error enviando mensaje a ${toPhone}`, error.response?.data || error.message);
            throw error;
        }
    }

    // ==========================================
    // HELPER 2: LECTURA/ESCRITURA DE ESTADO (REDIS)
    // ==========================================
    private async getUserState(phoneId: string): Promise<ChatState> {
        const state = await this.redis.get(`chat_state:${phoneId}`);
        return (state as ChatState) || ChatState.IDLE;
    }

    private async setUserState(phoneId: string, state: ChatState) {
        await this.redis.set(`chat_state:${phoneId}`, state, 'EX', SESSION_TTL);
    }

    // ==========================================
    // HELPER 3: IA Y MULTIMEDIA 
    // ==========================================
    private async downloadWhatsAppAudio(mediaId: string): Promise<Buffer> {
        const token = this.configService.get<string>('META_ACCESS_TOKEN');

        const urlReq = `https://graph.facebook.com/v19.0/${mediaId}`;
        const urlResponse = await lastValueFrom(
            this.httpService.get(urlReq, { headers: { Authorization: `Bearer ${token}` } })
        );
        const mediaUrl = urlResponse.data.url;

        const mediaResponse = await lastValueFrom(
            this.httpService.get(mediaUrl, {
                headers: { Authorization: `Bearer ${token}` },
                responseType: 'arraybuffer'
            })
        );

        return Buffer.from(mediaResponse.data);
    }

    private async extractDataWithGemini(audioBuffer: Buffer): Promise<{ cedula: string | null, especialidad: string | null, fecha: string | null, ininteligible: boolean }> {
        const model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
        Eres un asistente médico súper empático en el Hospital San Vicente (Colombia). 
        Escucha el audio adjunto de un paciente (puede ser población vulnerable o campesina).
        
        REGLA DE RUIDO Y SILENCIO: Si el audio está vacío, solo se escucha ruido de la calle, maquinaria, música de fondo, o no se distingue una voz humana clara haciendo una petición, DEBES poner el campo "ininteligible" en true y los demás en null.

        Extrae la siguiente información y devuélvela ÚNICAMENTE en formato JSON válido, sin texto adicional ni bloques de código (sin \`\`\`json):
        {
            "cedula": "Número sin puntos. Si dice 'diez millones...', conviértelo a número. Si no menciona, null.",
            "especialidad": "Normaliza a: 'Medicina General', 'Odontología', 'Cardiología' u 'Ortopedia'. Si no menciona, null.",
            "fecha": "Fecha en formato ISO (YYYY-MM-DD). Si no menciona, null.",
            "ininteligible": false
        }`;

        const audioPart = {
            inlineData: {
                data: audioBuffer.toString("base64"),
                mimeType: "audio/ogg"
            }
        };

        const result = await model.generateContent([prompt, audioPart]);
        const responseText = result.response.text().trim();

        const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '');

        try {
            return JSON.parse(cleanedText);
        } catch (e) {
            this.logger.error("Error parseando el JSON de Gemini", responseText);
            return { cedula: null, especialidad: null, fecha: null, ininteligible: true };
        }
    }

    // ==========================================
    // HELPER 4: TEXT-TO-SPEECH Y SMART REPLY (NUEVO)
    // ==========================================
    private async generateTTS(text: string): Promise<Buffer> {
        this.logger.log('🎙️ Generando voz con Google Cloud TTS (Acento Colombiano)...');
        const cleanText = text.replace(/[\*🎙️⏳✅❌📅👤⚕️⚠️🎉📝]/g, '').trim();

        const request = {
            input: { text: cleanText },
            voice: { languageCode: 'es-US', name: 'es-US-Neural2-A' },
            audioConfig: { audioEncoding: 'OGG_OPUS' as const },
        };

        try {
            const [response] = await this.ttsClient.synthesizeSpeech(request);
            if (!response.audioContent) {
                throw new Error("Google Cloud no devolvió contenido de audio");
            }
            return Buffer.from(response.audioContent);
        } catch (error) {
            this.logger.error('Error crítico en Google TTS:', error);
            throw error;
        }
    }

    private async uploadToWhatsApp(audioBuffer: Buffer): Promise<string> {
        const token = this.configService.get<string>('META_ACCESS_TOKEN');
        const phoneId = this.configService.get<string>('META_PHONE_ID');

        const formData = new FormData();
        formData.append('messaging_product', 'whatsapp');
        const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/ogg' });
        formData.append('file', blob, 'audio.ogg');

        const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/media`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        const data = await response.json();
        if (!response.ok) throw new Error(`Error subiendo media a WhatsApp: ${JSON.stringify(data)}`);
        return data.id;
    }

    private async sendWhatsAppAudioMessage(toPhone: string, mediaId: string) {
        const token = this.configService.get<string>('META_ACCESS_TOKEN');
        const phoneId = this.configService.get<string>('META_PHONE_ID');
        const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

        const data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: toPhone,
            type: 'audio',
            audio: { id: mediaId },
        };

        await lastValueFrom(
            this.httpService.post(url, data, {
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
            })
        );
    }

    private async smartReply(senderId: string, text: string) {
        const isAiFlow = await this.redis.get(`is_ai_flow:${senderId}`) === 'true';

        if (isAiFlow) {
            try {
                this.logger.log(`🎙️ Respondiendo con nota de voz a ${senderId}...`);
                const audioBuffer = await this.generateTTS(text);
                const mediaId = await this.uploadToWhatsApp(audioBuffer);
                await this.sendWhatsAppAudioMessage(senderId, mediaId);

                // Opcional: Enviamos el texto de respaldo por si no pueden escuchar el audio
                await this.sendWhatsAppMessage(senderId, text);
                return;
            } catch (error) {
                this.logger.error('Error enviando voz, haciendo fallback automático a texto', error);
            }
        }

        // Si la IA no está activada o falló el TTS, enviamos texto puro
        await this.sendWhatsAppMessage(senderId, text);
    }

    // ==========================================
    // CORE: MÁQUINA DE ESTADOS (INBOUND)
    // ==========================================
    async processIncomingMessage(event: any) {
        const senderId = event.from || event.sender?.id;
        const messageType = event.type;
        const text = event.text?.body?.trim() || event.message?.text?.trim();
        const audioId = event.audio?.id;

        if (messageType !== 'text' && messageType !== 'audio') {
            return;
        }

        const currentState = await this.getUserState(senderId);
        this.logger.log(`Usuario ${senderId} en estado: ${currentState}. Tipo: ${messageType}`);

        // ========================================================
        // FLUJO DE IA (AUDIO)
        // ========================================================
        if (messageType === 'audio' && audioId) {

            // Aseguramos que el flujo se marque como IA desde que envían el primer audio
            await this.redis.set(`is_ai_flow:${senderId}`, 'true', 'EX', SESSION_TTL);

            // 🛡️ PROTECCIÓN UX: Si estamos pidiendo la fecha o confirmando, obligamos a escribir
            if (currentState === ChatState.AWAITING_DATE || currentState === ChatState.AWAITING_CONFIRMATION) {
                await this.sendWhatsAppMessage(senderId, "🎙️ Para este paso tan importante, por favor escríbame su respuesta en texto (la letra o la palabra SÍ/NO) para evitar errores en su cita médica.");
                return;
            }

            await this.sendWhatsAppMessage(senderId, "⏳ Estoy escuchando su nota de voz. Denme un momentico...");

            try {
                const audioBuffer = await this.downloadWhatsAppAudio(audioId);
                const aiData = await this.extractDataWithGemini(audioBuffer);

                this.logger.log(`🧠 Gemini extrajo: ${JSON.stringify(aiData)}`);

                if (aiData.ininteligible) {
                    await this.smartReply(senderId, "🎙️ Disculpe, había mucho ruido de fondo o el audio se escuchó cortado y no alcancé a entenderle bien. ¿Podría acercarse un poquito el celular y volver a grabarme la nota de voz?");
                    return;
                }

                // 🧠 MEMORIA A CORTO PLAZO (MERGE STATE)
                const savedCedula = await this.redis.get(`temp_cedula:${senderId}`);
                const savedEspecialidad = await this.redis.get(`temp_especialidad:${senderId}`);

                const finalCedula = aiData.cedula || savedCedula;
                const finalEspecialidad = aiData.especialidad || savedEspecialidad;

                if (finalCedula && finalEspecialidad) {
                    await this.redis.set(`temp_cedula:${senderId}`, finalCedula, 'EX', SESSION_TTL);
                    await this.redis.set(`temp_especialidad:${senderId}`, finalEspecialidad, 'EX', SESSION_TTL);

                    const slots = await this.appointmentsService.getAvailableSlots(finalEspecialidad);

                    if (slots.length === 0) {
                        await this.smartReply(senderId, `Entendí que necesita cita para *${finalEspecialidad}*, pero no hay agenda abierta. Intente mañana.`);
                        await this.setUserState(senderId, ChatState.IDLE);
                        return;
                    }

                    let mensajeFechas = `Entendí perfectamente. Cédula: *${finalCedula}*, Especialidad: *${finalEspecialidad}*.\n\n📅 Fechas disponibles:\n`;
                    slots.forEach((slot, index) => {
                        const letra = String.fromCharCode(65 + index);
                        this.redis.set(`temp_slot_${letra}:${senderId}`, slot.toISOString(), 'EX', SESSION_TTL);
                        mensajeFechas += `${letra}) ${slot.toLocaleDateString('es-CO')} a las ${slot.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}\n`;
                    });
                    mensajeFechas += `\n(Responda escribiendo la letra, ej: A)`;

                    await this.smartReply(senderId, mensajeFechas);
                    await this.setUserState(senderId, ChatState.AWAITING_DATE);

                } else if (finalEspecialidad && !finalCedula) {
                    await this.redis.set(`temp_especialidad:${senderId}`, finalEspecialidad, 'EX', SESSION_TTL);
                    await this.smartReply(senderId, `Entendí que busca cita para *${finalEspecialidad}*. Por favor, ¿me puede decir o escribir su número de cédula?`);
                    await this.setUserState(senderId, ChatState.AWAITING_CEDULA);

                } else if (finalCedula && !finalEspecialidad) {
                    await this.redis.set(`temp_cedula:${senderId}`, finalCedula, 'EX', SESSION_TTL);
                    await this.smartReply(senderId, `Tengo registrada su cédula: *${finalCedula}*. ¿Para qué especialidad necesita la cita (Ej: Medicina General, Odontología)?`);
                    await this.setUserState(senderId, ChatState.AWAITING_SPECIALTY);

                } else {
                    await this.smartReply(senderId, "Disculpe, no pude entender qué trámite necesita. ¿Podría volver a grabarlo o escribirme 'Hola' para empezar de nuevo?");
                }

            } catch (error) {
                this.logger.error("Fallo general procesando IA", error);
                await this.smartReply(senderId, "❌ Hubo un fallo en mi sistema de inteligencia artificial. Por favor, escríbame 'Hola' para hacerlo de forma manual.");
            }
            return;
        }


        // ========================================================
        // FLUJO TRADICIONAL (TEXTO / ESTADOS AVANZADOS)
        // ========================================================
        switch (currentState) {

            case ChatState.IDLE:
                await this.smartReply(
                    senderId,
                    "👋 ¡Hola! Bienvenido al sistema de agendamiento del Hospital San Vicente.\n\nPuede enviarme una *nota de voz* diciendo qué cita necesita y su cédula, o puede enviarme su *número de cédula* escrito para hacerlo paso a paso."
                );
                await this.setUserState(senderId, ChatState.AWAITING_CEDULA);
                break;

            case ChatState.AWAITING_CEDULA:
                if (!/^\d{6,11}$/.test(text)) {
                    await this.smartReply(senderId, "❌ Formato inválido. Por favor, envíe solo números sin espacios (Ej: 1088234567).");
                    return;
                }
                await this.smartReply(senderId, "✅ Cédula recibida.\n\n¿Qué especialidad necesita?\n1️⃣ Medicina General\n2️⃣ Odontología\n\n(Responda con el número 1 o 2)");
                await this.redis.set(`temp_cedula:${senderId}`, text, 'EX', SESSION_TTL);
                await this.setUserState(senderId, ChatState.AWAITING_SPECIALTY);
                break;

            case ChatState.AWAITING_SPECIALTY:
                let especialidad = text;
                if (text === '1') especialidad = 'Medicina General';
                if (text === '2') especialidad = 'Odontología';

                if (especialidad !== 'Medicina General' && especialidad !== 'Odontología') {
                    await this.smartReply(senderId, "❌ Opción no válida. Responda 1 (Medicina General) o 2 (Odontología).");
                    return;
                }

                await this.redis.set(`temp_especialidad:${senderId}`, especialidad, 'EX', SESSION_TTL);
                const slots = await this.appointmentsService.getAvailableSlots(especialidad);

                if (slots.length === 0) {
                    await this.smartReply(senderId, `Lo sentimos, no hay agendas abiertas para *${especialidad}* en este momento. Intente mañana.`);
                    await this.setUserState(senderId, ChatState.IDLE);
                    return;
                }

                let mensajeFechas = `Usted ha seleccionado *${especialidad}*.\n\n📅 Fechas disponibles:\n`;
                slots.forEach((slot, index) => {
                    const letra = String.fromCharCode(65 + index);
                    this.redis.set(`temp_slot_${letra}:${senderId}`, slot.toISOString(), 'EX', SESSION_TTL);
                    mensajeFechas += `${letra}) ${slot.toLocaleDateString('es-CO')} a las ${slot.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}\n`;
                });
                mensajeFechas += `\n(Responda con la letra, ej: A)`;

                await this.smartReply(senderId, mensajeFechas);
                await this.setUserState(senderId, ChatState.AWAITING_DATE);
                break;

            case ChatState.AWAITING_DATE:
                const letraElegida = text.toUpperCase();
                const fechaISO = await this.redis.get(`temp_slot_${letraElegida}:${senderId}`);

                if (!fechaISO) {
                    await this.smartReply(senderId, "❌ Opción inválida. Por favor responda con la letra correcta (ej: A).");
                    return;
                }

                const cedula = await this.redis.get(`temp_cedula:${senderId}`);
                const spec = await this.redis.get(`temp_especialidad:${senderId}`);

                if (!cedula || !spec) {
                    await this.smartReply(senderId, "⏳ Su sesión ha expirado por inactividad. Por favor, diga 'Hola' para iniciar nuevamente.");
                    await this.setUserState(senderId, ChatState.IDLE);
                    return;
                }

                // 🛑 EN LUGAR DE GUARDAR DIRECTO, PASAMOS AL ESTADO DE CONFIRMACIÓN EXPLICITA
                await this.redis.set(`temp_selected_date:${senderId}`, fechaISO, 'EX', SESSION_TTL);

                // IMPORTANTE: Este mensaje requiere lectura, por eso mantenemos sendWhatsAppMessage explícito
                const resumenMsg = `📝 *Resumen de su cita:*\n\n👤 Cédula: ${cedula}\n⚕️ Especialidad: ${spec}\n📅 Fecha: ${new Date(fechaISO).toLocaleString('es-CO')}\n\n⚠️ *¿La información es correcta?*\n(Responda *SÍ* para agendar o *NO* para cancelar)`;
                await this.sendWhatsAppMessage(senderId, resumenMsg);

                await this.setUserState(senderId, ChatState.AWAITING_CONFIRMATION);
                break;

            case ChatState.AWAITING_CONFIRMATION:
                const respuesta = text.toUpperCase().trim();

                if (respuesta === 'SI' || respuesta === 'SÍ' || respuesta === 'SÍ.' || respuesta === 'SI.') {
                    // EL USUARIO FIRMÓ EL CONTRATO. AHORA SÍ, TOCAMOS LA BASE DE DATOS.
                    const finalCedula = await this.redis.get(`temp_cedula:${senderId}`);
                    const finalSpec = await this.redis.get(`temp_especialidad:${senderId}`);
                    const finalFechaISO = await this.redis.get(`temp_selected_date:${senderId}`);
                    // Leemos de Redis si este flujo empezó con audio
                    const isAiFlow = await this.redis.get(`is_ai_flow:${senderId}`) === 'true';

                    // 🛡️ TYPE GUARD: Le juramos a TypeScript que si algo es null, detenemos la ejecución
                    if (!finalCedula || !finalSpec || !finalFechaISO) {
                        await this.smartReply(senderId, "⏳ Lo siento, su tiempo de sesión expiró antes de confirmar. Por favor, escriba 'Hola' para comenzar de nuevo.");
                        await this.setUserState(senderId, ChatState.IDLE);
                        return;
                    }
                    const user = await this.prisma.user.findFirst({
                        where: { OR: [{ facebookId: senderId }, { whatsappId: senderId }] }
                    });

                    if (!user) {
                        await this.smartReply(senderId, "❌ Error interno: No pudimos encontrar su registro. Diga 'Hola' para registrarse de nuevo.");
                        await this.setUserState(senderId, ChatState.IDLE);
                        return;
                    }

                    const bookingResult = await this.appointmentsService.bookAppointment(user.id, finalSpec, new Date(finalFechaISO), isAiFlow);

                    if (bookingResult.success) {
                        await this.smartReply(
                            senderId,
                            `🎉 ¡Cita confirmada exitosamente!\n\nPaciente (CC): ${finalCedula}\nEspecialidad: ${finalSpec}\nFecha: ${new Date(finalFechaISO).toLocaleString('es-CO')}\n\nGracias por usar el sistema del Hospital San Vicente.`
                        );
                    } else {
                        await this.smartReply(senderId, `⚠️ ${bookingResult.message}\nPor favor inicie el proceso nuevamente diciendo "Hola".`);
                    }

                    // Limpieza final
                    await this.setUserState(senderId, ChatState.IDLE);
                    const keysToDelete = [
                        `temp_cedula:${senderId}`,
                        `temp_especialidad:${senderId}`,
                        `temp_selected_date:${senderId}`
                    ];
                    const slotKeys = await this.redis.keys(`temp_slot_*:${senderId}`);
                    await this.redis.del(...keysToDelete, ...slotKeys);

                } else if (respuesta === 'NO' || respuesta === 'CANCELAR') {
                    await this.smartReply(senderId, "❌ Entendido. He cancelado la solicitud de cita. Si desea empezar de nuevo, simplemente diga 'Hola'.");
                    await this.setUserState(senderId, ChatState.IDLE);

                    const keysToDelete = [`temp_cedula:${senderId}`, `temp_especialidad:${senderId}`, `temp_selected_date:${senderId}`];
                    const slotKeys = await this.redis.keys(`temp_slot_*:${senderId}`);
                    await this.redis.del(...keysToDelete, ...slotKeys);
                } else {
                    // Obligamos a texto para que el usuario sepa que debe escribir SÍ o NO
                    await this.sendWhatsAppMessage(senderId, "⚠️ Por favor, responda únicamente *SÍ* para confirmar su cita o *NO* para cancelar el proceso.");
                }
                break;

            default:
                await this.setUserState(senderId, ChatState.IDLE);
                break;
        }
    }
}