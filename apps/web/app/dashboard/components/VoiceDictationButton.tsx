'use client';

import { Mic, Square, Loader2 } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useEffect } from 'react';

export default function VoiceDictationButton({
    onAudioReady,
    isProcessingAI,
    disabled
}: {
    onAudioReady: (base64: string) => void;
    isProcessingAI: boolean;
    disabled?: boolean;
}) {
    const { isRecording, startRecording, stopRecording, audioBase64, setAudioBase64 } = useAudioRecorder();

    useEffect(() => {
        if (audioBase64 && !isRecording) {
            onAudioReady(audioBase64);
            setAudioBase64(null); // Clean up immediately so it doesn't trigger repeatedly
        }
    }, [audioBase64, isRecording, onAudioReady, setAudioBase64]);

    if (disabled) return null;

    if (isProcessingAI) {
        return (
            <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-4 py-2 rounded-full border border-indigo-200 dark:border-indigo-800 shadow-sm animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm font-semibold">Gemini procesando audio...</span>
            </div>
        );
    }

    if (isRecording) {
        return (
            <button
                type="button" // Important for forms
                onClick={stopRecording}
                className="group relative flex items-center gap-2 bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/40 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-400 px-5 py-2 rounded-full transition-all border border-rose-300 dark:border-rose-700 shadow-sm"
            >
                {/* Ping animation behind the icon */}
                <span className="absolute left-4 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                </span>
                <Square className="w-4 h-4 ml-4" fill="currentColor" />
                <span className="text-sm font-bold">Detener Dictado</span>
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={startRecording}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white px-5 py-2 rounded-full shadow-md hover:shadow-lg transition-all border border-transparent shadow-indigo-500/30"
        >
            <Mic className="w-4 h-4" />
            <span className="text-sm font-bold">Dictar Inteligente (IA)</span>
        </button>
    );
}
