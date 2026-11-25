import type { LocationState, DittuResult } from '../../types/index.ts';
import { getClientAuthHeaders } from './authHelper.ts';

export class DITTUAIService {
  async processVoiceCommand(
    query: string,
    location?: LocationState,
    isEmergencyActive = false,
    batteryLevel?: number | null,
    primaryGuardianName?: string
  ): Promise<DittuResult> {
    const rawText = query.trim();
    const isTamil = /[\u0B80-\u0BFF]/.test(rawText);

    // FAST 0ms PATH: Immediate keyword detection for emergency trigger
    const fastCheck = this.fastEmergencyCheck(rawText, isTamil);
    if (fastCheck.isEmergency) {
      return {
        spokenReply: fastCheck.reply,
        detectedLanguage: isTamil ? 'ta' : 'en',
        intent: 'SOS_TRIGGER',
        shouldTriggerEmergency: true,
        confidence: 0.99,
        fallbackUsed: true,
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    try {
      const authHeaders = await getClientAuthHeaders();
      const response = await fetch('/api/ai/dittu', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          query: rawText,
          language: isTamil ? 'ta' : 'en',
          userLocation: location ? {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            address: location.address,
          } : undefined,
          isEmergencyActive,
          batteryLevel,
          primaryGuardianName,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      clearTimeout(timeoutId);
      console.warn('[DittuAI] Backend unreachable, using client deterministic NLU:', e);
    }

    return this.fallbackNlu(rawText, isTamil, location);
  }

  private fastEmergencyCheck(text: string, isTamil = false): { isEmergency: boolean; reply: string } {
    const lower = text.toLowerCase();
    const enKeywords = ['help', 'emergency', 'save me', 'danger', 'sos', 'protect me', 'attack'];
    const taKeywords = ['காப்பாத்து', 'உதவி', 'ஆபத்து', 'அவசரம்', 'பயமா இருக்கு'];

    if (enKeywords.some(kw => lower.includes(kw))) {
      return {
        isEmergency: true,
        reply: 'Emergency alert detected! Activating SafeNex protocol and alerting your guardians.',
      };
    }

    if (isTamil || taKeywords.some(kw => text.includes(kw))) {
      return {
        isEmergency: true,
        reply: 'அவசர எச்சரிக்கை கண்டறியப்பட்டது! SafeNex நெறிமுறை செயல்படுத்தப்பட்டு உங்கள் கார்டியனுக்கு தகவல் அனுப்பப்படுகிறது.',
      };
    }

    return { isEmergency: false, reply: '' };
  }

  private fallbackNlu(text: string, isTamil: boolean, location?: LocationState): DittuResult {
    const lower = text.toLowerCase().trim();

    if (isTamil) {
      if (lower.includes('எங்க') || lower.includes('இடம்') || lower.includes('லொகேஷன்')) {
        return {
          spokenReply: location?.latitude
            ? 'உங்கள் GPS இருப்பிடம் பதிவு செய்யப்பட்டு பாதுகாக்கப்பட்டுள்ளது.'
            : 'GPS சிக்னல் தேடப்படுகிறது.',
          detectedLanguage: 'ta',
          intent: 'QUERY_LOCATION',
          shouldTriggerEmergency: false,
          confidence: 0.85,
          fallbackUsed: true,
        };
      }
      if (lower.includes('கார்டியன்') || lower.includes('கூப்பிடு') || lower.includes('அழை')) {
        return {
          spokenReply: 'உங்கள் முதன்மை கார்டியனை அழைக்கிறேன்.',
          detectedLanguage: 'ta',
          intent: 'CALL_GUARDIAN',
          shouldTriggerEmergency: false,
          confidence: 0.9,
          fallbackUsed: true,
        };
      }
      return {
        spokenReply: 'வணக்கம், நான் DITTU. உதவி தேவைப்பட்டால் "உதவி" அல்லது "காப்பாத்துங்க" என்று சொல்லுங்கள்.',
        detectedLanguage: 'ta',
        intent: 'CONVERSATIONAL',
        shouldTriggerEmergency: false,
        confidence: 0.8,
        fallbackUsed: true,
      };
    } else {
      if (lower.includes('where') || lower.includes('location') || lower.includes('gps')) {
        return {
          spokenReply: location?.latitude
            ? 'Your GPS location is locked and securely streaming.'
            : 'Acquiring satellite GPS lock.',
          detectedLanguage: 'en',
          intent: 'QUERY_LOCATION',
          shouldTriggerEmergency: false,
          confidence: 0.85,
          fallbackUsed: true,
        };
      }
      if (lower.includes('call') || lower.includes('guardian') || lower.includes('contact')) {
        return {
          spokenReply: 'Connecting to your primary guardian now.',
          detectedLanguage: 'en',
          intent: 'CALL_GUARDIAN',
          shouldTriggerEmergency: false,
          confidence: 0.9,
          fallbackUsed: true,
        };
      }
      if (lower.includes('status')) {
        return {
          spokenReply: 'SafeNex AI Core is armed. BLE Band, GPS, and guardian networks are monitored.',
          detectedLanguage: 'en',
          intent: 'QUERY_STATUS',
          shouldTriggerEmergency: false,
          confidence: 0.85,
          fallbackUsed: true,
        };
      }
      return {
        spokenReply: 'DITTU voice assistant standby. Say "HELP!" in an emergency or "Call Guardian".',
        detectedLanguage: 'en',
        intent: 'CONVERSATIONAL',
        shouldTriggerEmergency: false,
        confidence: 0.8,
        fallbackUsed: true,
      };
    }
  }
}

export const dittuAIService = new DITTUAIService();
