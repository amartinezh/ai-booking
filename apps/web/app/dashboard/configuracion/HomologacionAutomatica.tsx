'use client';

import { UserCheck, UserX, MessageCircle, MessageCircleOff } from 'lucide-react';
import { setMyAutoHomologacion, setMyAutoHomologacionWhatsapp } from '@/app/actions/settings';
import InstantSwitch from './InstantSwitch';

/**
 * 🩺 Médicos nuevos del hospital (2026-10-24). Un médico del hospital con citas de
 * un servicio que AgenIA maneja y sin homologar siempre abre un caso en la Bandeja,
 * con un botón para crearlo. Esto decide si AgenIA lo hace sola cuando cumple todas
 * las reglas, y con qué WhatsApp entra. Los dos guardan al instante.
 */
export default function HomologacionAutomatica({ auto, whatsappOn }: { auto: boolean; whatsappOn: boolean }) {
    return (
        <div className="space-y-8">
            <InstantSwitch
                initialEnabled={auto}
                save={setMyAutoHomologacion}
                title="Agregar solos los médicos nuevos del hospital"
                description="Cuando un médico del hospital tiene citas de un servicio que AgenIA maneja y todavía no está en AgenIA. El cambio aplica desde la próxima comparación con el hospital (cada noche)."
                iconOn={<UserCheck className="w-5 h-5" />}
                iconOff={<UserX className="w-5 h-5" />}
                iconOnClassName="bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400"
                labelOn="Encendido"
                labelOff="Apagado"
                detailOn="AgenIA lo crea y homologa sola si cumple todas las reglas: cédula única en el hospital, cargo de médico, su servicio principal es uno que AgenIA maneja y está activo en el hospital. Deja un caso en la Bandeja para que alguien lo revise."
                detailOff="Cada médico nuevo queda como caso en la Bandeja y el administrador lo crea con el botón «Crear y homologar»."
                footnote="Si no cumple alguna regla, nunca se agrega solo: queda en la Bandeja. Nada se escribe en el sistema del hospital."
            />
            <InstantSwitch
                initialEnabled={whatsappOn}
                save={setMyAutoHomologacionWhatsapp}
                title="Los médicos agregados solos entran con WhatsApp encendido"
                description="Solo aplica a los que AgenIA agrega sola (el interruptor de arriba). Con el botón de la Bandeja se elige en cada caso."
                iconOn={<MessageCircle className="w-5 h-5" />}
                iconOff={<MessageCircleOff className="w-5 h-5" />}
                iconOnClassName="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                labelOn="WhatsApp ON"
                labelOff="WhatsApp OFF"
                detailOn="Sus pacientes reciben recordatorios desde el primer día y el asistente ofrece sus cupos."
                detailOff="Sus citas entran a AgenIA, pero no le sale nada al paciente hasta que alguien lo encienda en Médicos. Recomendado: el hospital decide médico por médico."
            />
        </div>
    );
}
