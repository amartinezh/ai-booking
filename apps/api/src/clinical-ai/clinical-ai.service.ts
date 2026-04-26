import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class ClinicalAiService {
  private readonly logger = new Logger(ClinicalAiService.name);
  private genAI: GoogleGenerativeAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.error('GEMINI_API_KEY no detectado. El servicio Clinical AI fallará.');
    }
    this.genAI = new GoogleGenerativeAI(apiKey || '');
  }

  async transcribeDictation(audioBase64: string, mimeType: string = 'audio/webm'): Promise<any> {
    try {
      // Configuramos el modelo específico y activamos el JSON out natively
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
        },
      });

      const prompt = `
        Actúa como un escriba médico experto. 
        Analiza el audio dictado por el médico y extrae la información para llenar la Historia Clínica Electrónica.
        Mejorarás sutilmente la redacción clínica (ortografía, términos médicos), pero mantendrás absolutamente la intención original del médico.

        Debes retornar ESTRICTAMENTE un JSON con la siguiente estructura.
        Si el médico NO menciona información para algún campo, DEBES establecer ese campo como \`null\`.
        No inventes datos. 

        Estructura JSON Requerida:
        {
          "chiefComplaint": "El motivo de consulta del paciente. O null.",
          "currentIllness": "La enfermedad actual y desarrollo de síntomas. O null.",
          "physicalExam": "Los hallazgos del examen físico. O null.",
          "evolutionNotes": "Notas o análisis de evolución y plan médico. O null.",
          "diagnoses": [
            { "description": "Nombre de la enfermedad o condición", "isMain": boolean (true si es el principal) }
          ], // Retorna array vacío [] si no menciona diagnósticos
          "prescriptions": [
            {
              "medication": "Nombre del medicamento",
              "dose": "Dosis (ej. 500mg, 1 tableta)",
              "frequency": "Frecuencia (ej. cada 8 horas)",
              "duration": "Duración (ej. por 5 días)",
              "notes": "Instrucciones extra. (opcional, o string vacío)"
            }
          ] // Retorna array vacío [] si no se dictan recetas
        }
      `;

      const audioPart = {
        inlineData: {
          data: audioBase64,
          mimeType: mimeType,
        },
      };

      const result = await model.generateContent([prompt, audioPart]);
      const responseText = result.response.text();
      
      this.logger.log('Gemini Transcription Generated Structure Succesfully');
      
      const jsonResponse = JSON.parse(responseText);
      return jsonResponse;

    } catch (error: any) {
      this.logger.error('Error procesando dictado de IA:', error);
      
      if (error?.status === 503) {
          throw new Error('Google Gemini AI está experimentando alta demanda global (503). Por favor, intenta dictar de nuevo en unos segundos.');
      }
      
      throw new Error('Fallo al procesar dictado de voz: ' + (error?.message || 'Error desconocido'));
    }
  }
}
