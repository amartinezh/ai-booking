'use client';

import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        // Transformar a Base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64String = reader.result as string;
          setAudioBase64(base64String);
        };

        // Apagar micrófono estrictamente tras detener
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(250); // Chunks cada 250ms
      setIsRecording(true);
      setAudioBase64(null); // Limpiar previo
    } catch (err) {
      console.error('Mic permission denied or error:', err);
      toast.error('Permiso de micrófono denegado o error de hardware.');
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  return {
    isRecording,
    audioBase64,
    startRecording,
    stopRecording,
    setAudioBase64 // por si hace falta mutarlo/limpiarlo programáticamente a nulo post-process
  };
}
