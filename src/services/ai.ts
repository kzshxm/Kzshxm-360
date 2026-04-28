import { GoogleGenAI, Type, Modality } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEYII || process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

export interface SceneAnalysis {
  title: string;
  description: string;
  pointsOfInterest: {
    label: string;
    description: string;
    coordinates: { x: number; y: number }; // x: 0-1 (left-right), y: 0-1 (top-bottom)
  }[];
}

async function getBase64FromUrl(url: string, file?: File): Promise<{mimeType: string, data: string}> {
  if (file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve({
          mimeType: file.type,
          data: result.split(',')[1]
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  } else {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          mimeType: blob.type || 'image/jpeg',
          data: (reader.result as string).split(',')[1]
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export async function analyzeSceneWithAI(imageUrl: string, file?: File): Promise<SceneAnalysis | { error: string } | null> {
  try {
    const { mimeType, data } = await getBase64FromUrl(imageUrl, file);
    
    const activeKey = process.env.GEMINI_API_KEYII || process.env.GEMINI_API_KEY;
    // Safety check - avoid calling if we know it's a dummy or missing key
    if (!activeKey || activeKey === 'MY_GEMINI_API_KEY' || activeKey === 'MY_GEMINI_API_KEYII') {
      return { error: "API Key not configured. Please add your Gemini API Key in the Settings/Secrets panel to use the AI features." };
    }

    const prompt = `Analyze this 360-degree equirectangular image. Return a JSON object with:
1. 'title': A catchy, concise title for the scene.
2. 'description': A short, thematic description of the environment.
3. 'pointsOfInterest': An array of up to 5 interesting distinct objects/areas. For each, provide a 'label' (short name), 'description' (1 sentence), and 'coordinates' (x and y, where x is 0-1 from left to right, and y is 0-1 from top to bottom of the 2D image). Note that in an equirectangular image, x represents longitude and y represents latitude.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { inlineData: { mimeType, data } },
        prompt
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            pointsOfInterest: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  description: { type: Type.STRING },
                  coordinates: { 
                    type: Type.OBJECT,
                    properties: {
                      x: { type: Type.NUMBER },
                      y: { type: Type.NUMBER }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as SceneAnalysis;
    }
    return null;
  } catch (error: any) {
    console.error("AI Scene Analysis Failed:", error);
    if (error.message?.includes('API key not valid') || error.message?.includes('API Key not configured')) {
      return { error: "Please configure your Gemini API Key in the Settings/Secrets panel to enable the AI Tour Guide feature." };
    }
    return { error: "AI analysis failed. " + (error.message || "") };
  }
}

export async function generateTourSpeech(text: string): Promise<string | { error: string } | null> {
  try {
    const activeKey = process.env.GEMINI_API_KEYII || process.env.GEMINI_API_KEY;
    if (!activeKey || activeKey === 'MY_GEMINI_API_KEY' || activeKey === 'MY_GEMINI_API_KEYII') {
      return { error: "API Key not configured." };
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Zephyr' },
            },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) return base64Audio;
    
    return null;
  } catch (error: any) {
    console.warn("AI TTS Failed (falling back to local synthesis):", error?.message || error);
    return { error: "TTS failed. " + (error.message || "") };
  }
}
