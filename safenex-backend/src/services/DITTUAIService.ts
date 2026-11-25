import type { DittuInput, DittuResult } from '../types/index.ts';

/**
 * SAFENEX DITTU Conversational AI Assistant
 * 
 * Features:
 * - Bilingual: Natural language in English & Tamil (தமிழ்).
 * - Fast zero-latency keyword fallback for mission-critical SOS triggers.
 * - Contextual understanding for locations, guardians, and status queries.
 */
export class DITTUAIService {
  private apiKey: string | null = null;
  private modelName: string;

  constructor() {
    const key = process.env.GEMINI_API_KEY;
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (key && key.trim() !== '' && !key.includes('your_gemini')) {
      this.apiKey = key.trim();
    }
  }

  async processQuery(input: DittuInput): Promise<DittuResult> {
    const rawText = input.query.trim();
    const isTamil = this.detectTamil(rawText) || input.language === 'ta';

    // 1. FAST PATH: Check immediate critical keywords first (0ms latency guarantee)
    const fastKeywordCheck = this.checkEmergencyKeywords(rawText, isTamil);
    if (fastKeywordCheck.isEmergency) {
      return {
        spokenReply: fastKeywordCheck.reply,
        detectedLanguage: isTamil ? 'ta' : 'en',
        intent: 'SOS_TRIGGER',
        shouldTriggerEmergency: true,
        confidence: 0.99,
        fallbackUsed: true
      };
    }

    // 2. LLM PATH: If Gemini API is available, call Gemini for contextual reasoning with 4s timeout
    if (this.apiKey) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DITTU AI query timed out (4000ms)')), 4000)
        );
        const aiPromise = this.callGeminiDittu(input, isTamil);
        return await Promise.race([aiPromise, timeoutPromise]);
      } catch (err) {
        console.warn('[DittuAI] LLM processing error or timeout, falling back to local NLU:', err);
      }
    }

    // 3. DETERMINISTIC LOCAL NLU FALLBACK
    return this.deterministicDittu(input, isTamil);
  }

  private detectTamil(text: string): boolean {
    return /[\u0B80-\u0BFF]/.test(text);
  }

  private checkEmergencyKeywords(text: string, isTamil: boolean): { isEmergency: boolean; reply: string } {
    const lower = text.toLowerCase();

    // English SOS keywords
    const enEmergencyKeywords = ['help', 'emergency', 'save me', 'danger', 'sos', 'protect me', 'attack'];
    // Tamil SOS keywords: காப்பாத்து (kaappathu), உதவி (uthavi), ஆபத்து (aabathu), அவசரம் (avasaram)
    const taEmergencyKeywords = ['காப்பாத்து', 'உதவி', 'ஆபத்து', 'அவசரம்', 'என்னை காப்பாற்று', 'பயமா இருக்கு'];

    if (enEmergencyKeywords.some(kw => lower.includes(kw))) {
      return {
        isEmergency: true,
        reply: 'Emergency alert detected! Activating SafeNex protocol and alerting your guardians now.'
      };
    }

    if (taEmergencyKeywords.some(kw => text.includes(kw))) {
      return {
        isEmergency: true,
        reply: 'அவசர எச்சரிக்கை கண்டறியப்பட்டது! SafeNex நெறிமுறை செயல்படுத்தப்பட்டு உங்கள் கார்டியனுக்கு தகவல் அனுப்பப்படுகிறது.'
      };
    }

    return { isEmergency: false, reply: '' };
  }

  private async callGeminiDittu(input: DittuInput, isTamil: boolean): Promise<DittuResult> {
    if (!this.apiKey) throw new Error('API key not set');

    const languageStr = isTamil ? 'Tamil (தமிழ்)' : 'English';
    const systemInstruction = `You are DITTU, the personal safety conversational voice assistant for the SAFENEX system.
Respond concisely in ${languageStr}.
Rules:
1. If the user mentions danger, violence, assault, fear, needing immediate help, or SOS, classify intent as "SOS_TRIGGER" and set shouldTriggerEmergency=true.
2. If the user asks where they are, provide a calm location confirmation using coordinates if available.
3. If the user asks to call guardian, acknowledge calling the guardian.
4. Keep spoken responses brief, reassuring, calm, and suited for Text-To-Speech (1-2 sentences maximum).
5. Output strict JSON:
{
  "spokenReply": "text to speak in ${languageStr}",
  "intent": "SOS_TRIGGER" | "CALL_GUARDIAN" | "QUERY_LOCATION" | "QUERY_STATUS" | "CONVERSATIONAL" | "SAFETY_CONFIRMATION",
  "shouldTriggerEmergency": boolean,
  "confidence": 0.95
}`;

    const contextText = `User Query: "${input.query}"
Context:
- Emergency Active: ${input.isEmergencyActive ? 'YES' : 'NO'}
- Location: ${input.userLocation?.latitude ? `${input.userLocation.latitude}, ${input.userLocation.longitude}` : 'Pending'}
- Battery: ${input.batteryLevel ?? 'Unknown'}%
- Primary Guardian: ${input.primaryGuardianName || 'Configured Guardian'}`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
    const payload = {
      contents: [{ role: 'user', parts: [{ text: contextText }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Gemini API error: ${res.status}`);
    }

    const data: any = await res.json();
    const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(rawJson);

    return {
      spokenReply: String(parsed.spokenReply || (isTamil ? 'நான் உங்கள் பாதுகாப்பிற்கு தயார்.' : 'DITTU safety shield is standing by.')),
      detectedLanguage: isTamil ? 'ta' : 'en',
      intent: (['SOS_TRIGGER', 'CALL_GUARDIAN', 'QUERY_LOCATION', 'QUERY_STATUS', 'CONVERSATIONAL', 'SAFETY_CONFIRMATION'].includes(parsed.intent)
        ? parsed.intent : 'CONVERSATIONAL') as DittuResult['intent'],
      shouldTriggerEmergency: Boolean(parsed.shouldTriggerEmergency),
      confidence: Math.min(1.0, Math.max(0.1, Number(parsed.confidence) || 0.9)),
      fallbackUsed: false
    };
  }

  private deterministicDittu(input: DittuInput, isTamil: boolean): DittuResult {
    const text = input.query.toLowerCase().trim();

    if (isTamil) {
      if (text.includes('எங்க') || text.includes('இடம்') || text.includes('லொகேஷன்')) {
        const locText = input.userLocation?.latitude
          ? `உங்கள் GPS இருப்பிடம் பதிவு செய்யப்பட்டு பாதுகாக்கப்பட்டுள்ளது.`
          : `GPS சிக்னல் தேடப்படுகிறது.`;
        return {
          spokenReply: locText,
          detectedLanguage: 'ta',
          intent: 'QUERY_LOCATION',
          shouldTriggerEmergency: false,
          confidence: 0.85,
          fallbackUsed: true
        };
      }
      if (text.includes('கார்டியன்') || text.includes('கூப்பிடு') || text.includes('அழை')) {
        return {
          spokenReply: `உங்கள் முதன்மை கார்டியனை அழைக்கிறேன்.`,
          detectedLanguage: 'ta',
          intent: 'CALL_GUARDIAN',
          shouldTriggerEmergency: false,
          confidence: 0.9,
          fallbackUsed: true
        };
      }
      return {
        spokenReply: `வணக்கம், நான் DITTU. உதவி தேவைப்பட்டால் "உதவி" அல்லது "காப்பாத்துங்க" என்று சொல்லுங்கள்.`,
        detectedLanguage: 'ta',
        intent: 'CONVERSATIONAL',
        shouldTriggerEmergency: false,
        confidence: 0.8,
        fallbackUsed: true
      };
    } else {
      if (text.includes('where') || text.includes('location') || text.includes('gps')) {
        const locText = input.userLocation?.latitude
          ? `Your GPS location is locked and securely streaming.`
          : `Acquiring satellite GPS lock.`;
        return {
          spokenReply: locText,
          detectedLanguage: 'en',
          intent: 'QUERY_LOCATION',
          shouldTriggerEmergency: false,
          confidence: 0.85,
          fallbackUsed: true
        };
      }
      if (text.includes('call') || text.includes('guardian') || text.includes('contact')) {
        return {
          spokenReply: `Connecting to your primary guardian now.`,
          detectedLanguage: 'en',
          intent: 'CALL_GUARDIAN',
          shouldTriggerEmergency: false,
          confidence: 0.9,
          fallbackUsed: true
        };
      }
      if (text.includes('status')) {
        return {
          spokenReply: `SafeNex AI Core is armed. BLE Band, GPS, and guardian networks are monitored.`,
          detectedLanguage: 'en',
          intent: 'QUERY_STATUS',
          shouldTriggerEmergency: false,
          confidence: 0.85,
          fallbackUsed: true
        };
      }
      return {
        spokenReply: `DITTU voice assistant standby. Say "HELP!" in an emergency or "Call Guardian".`,
        detectedLanguage: 'en',
        intent: 'CONVERSATIONAL',
        shouldTriggerEmergency: false,
        confidence: 0.8,
        fallbackUsed: true
      };
    }
  }
}

export const dittuAIService = new DITTUAIService();
