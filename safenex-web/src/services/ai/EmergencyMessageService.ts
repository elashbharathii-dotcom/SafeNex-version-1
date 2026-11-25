import type { LocationState, EmergencyMessageResult } from '../../types/index.ts';
import { getClientAuthHeaders } from './authHelper.ts';

export class EmergencyMessageService {
  async generateMessages(
    userName: string,
    emergencyStatus: 'ACTIVE' | 'VERIFYING' | 'RESOLVED',
    triggerSource: string,
    location?: LocationState,
    batteryLevel?: number | null,
    medicalNotes?: string,
    trackingUrl?: string
  ): Promise<EmergencyMessageResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const authHeaders = await getClientAuthHeaders();
      const response = await fetch('/api/ai/emergency-message', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          userName,
          emergencyStatus,
          triggerSource,
          activationTime: new Date().toISOString(),
          location: location ? {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            address: location.address,
          } : undefined,
          batteryLevel,
          medicalNotes,
          trackingUrl,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      clearTimeout(timeoutId);
      console.warn('[EmergencyMessage] Backend unreachable, using client deterministic formatting:', e);
    }

    return this.fallbackFormat(userName, emergencyStatus, triggerSource, location, batteryLevel, medicalNotes, trackingUrl);
  }

  fallbackFormat(
    userName: string,
    emergencyStatus: string,
    triggerSource: string,
    location?: LocationState,
    batteryLevel?: number | null,
    medicalNotes?: string,
    trackingUrl = 'https://safenex.app/track'
  ): EmergencyMessageResult {
    const hasCoordinates = Boolean(location?.latitude && location?.longitude);
    const lat = location?.latitude;
    const lng = location?.longitude;
    const mapUrl = hasCoordinates ? `https://maps.google.com/?q=${lat},${lng}` : null;

    const locSnippet = hasCoordinates ? `Loc:${lat?.toFixed(4)},${lng?.toFixed(4)}` : 'Loc:GPS acquiring';
    const batSnippet = batteryLevel != null ? ` Bat:${batteryLevel}%` : '';

    let sms = `EMERGENCY SOS: ${userName} alerted SafeNex (${triggerSource}). ${locSnippet}${batSnippet}. Track: ${trackingUrl}`;
    if (sms.length > 160) {
      sms = `SOS: ${userName} in distress (${triggerSource}). ${locSnippet}. Track: ${trackingUrl}`;
    }
    if (sms.length > 160) {
      sms = sms.slice(0, 157) + '...';
    }

    let whatsApp = `🚨 *SAFENEX CRITICAL EMERGENCY ALERT*\n\n` +
      `*User:* ${userName}\n` +
      `*Status:* ${emergencyStatus === 'ACTIVE' ? '🚨 EMERGENCY ACTIVE' : emergencyStatus}\n` +
      `*Trigger:* ${triggerSource}\n` +
      `*Time:* ${new Date().toLocaleTimeString()}\n`;

    if (hasCoordinates) {
      whatsApp += `📍 *Live Coordinates:* ${lat?.toFixed(5)}°, ${lng?.toFixed(5)}° (±${location?.accuracy || 5}m)\n`;
      if (location?.address) {
        whatsApp += `🏠 *Landmark:* ${location.address}\n`;
      }
      whatsApp += `🗺️ *Google Maps:* ${mapUrl}\n`;
    } else {
      whatsApp += `📍 *Location:* Acquiring GPS satellite fix...\n`;
    }

    if (batteryLevel != null) {
      whatsApp += `🔋 *Battery:* ${batteryLevel}%\n`;
    }

    if (medicalNotes) {
      whatsApp += `🩺 *Medical Alert:* ${medicalNotes}\n`;
    }

    whatsApp += `\n🛰️ *Live Tracking:* ${trackingUrl}\n\n_Please check on me immediately!_`;

    return {
      smsMessage: sms,
      whatsAppMessage: whatsApp,
      voiceBroadcastText: `Emergency alert active for ${userName}. Coordinates dispatched to guardians.`,
      generatedAt: new Date().toISOString(),
      verifiedDataIncluded: {
        hasCoordinates,
        hasTime: true,
        hasStatus: true,
        hasObservations: true,
      },
    };
  }
}

export const emergencyMessageService = new EmergencyMessageService();
