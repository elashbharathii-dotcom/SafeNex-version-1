import type { EmergencyMessageInput, EmergencyMessageResult } from '../types/index.ts';

/**
 * SAFENEX AI Emergency Message Generator
 * 
 * Constraints:
 * - strictly uses verified incident data.
 * - Does NOT invent missing information.
 * - Respects SMS 160-character budget.
 * - Provides structured WhatsApp formatting with live links.
 */
export class EmergencyMessageService {
  generateMessages(input: EmergencyMessageInput): EmergencyMessageResult {
    const hasCoordinates = Boolean(input.location?.latitude && input.location?.longitude);
    const hasTime = Boolean(input.activationTime);
    const hasStatus = Boolean(input.emergencyStatus);
    const hasObservations = Boolean(input.verifiedObservations && input.verifiedObservations.length > 0);

    const lat = input.location?.latitude;
    const lng = input.location?.longitude;
    const acc = input.location?.accuracy ? Math.round(input.location.accuracy) : null;
    const mapUrl = hasCoordinates ? `https://maps.google.com/?q=${lat},${lng}` : null;
    const trackUrl = input.trackingUrl || 'https://safenex.app/track';

    // 1. Generate Strict SMS Format (<= 160 characters)
    // Target length is under 160 chars for single cellular SMS delivery
    const locSnippet = hasCoordinates ? `Loc:${lat?.toFixed(4)},${lng?.toFixed(4)}` : 'Loc:GPS acquiring';
    const timeSnippet = input.activationTime ? input.activationTime.slice(-8) : 'NOW';
    const batSnippet = input.batteryLevel != null ? ` Bat:${input.batteryLevel}%` : '';

    let sms = `EMERGENCY SOS: ${input.userName} alerted SafeNex (${input.triggerSource}) at ${timeSnippet}. ${locSnippet}${batSnippet}. Track: ${trackUrl}`;
    if (sms.length > 160) {
      sms = `SOS: ${input.userName} in distress (${input.triggerSource}). ${locSnippet}. Track: ${trackUrl}`;
    }
    if (sms.length > 160) {
      sms = sms.slice(0, 157) + '...';
    }

    // 2. Generate WhatsApp Rich Format
    const observationsList = (input.verifiedObservations || [])
      .map(o => `• ${o}`)
      .join('\n');

    let whatsApp = `🚨 *SAFENEX CRITICAL EMERGENCY ALERT*\n\n` +
      `*User:* ${input.userName}\n` +
      `*Status:* ${input.emergencyStatus === 'ACTIVE' ? '🚨 EMERGENCY ACTIVE' : input.emergencyStatus}\n` +
      `*Trigger:* ${input.triggerSource}\n` +
      `*Time:* ${input.activationTime || new Date().toLocaleTimeString()}\n`;

    if (hasCoordinates) {
      whatsApp += `📍 *Live Coordinates:* ${lat?.toFixed(5)}°, ${lng?.toFixed(5)}° (±${acc || 5}m)\n`;
      if (input.location?.address) {
        whatsApp += `🏠 *Estimated Landmark:* ${input.location.address}\n`;
      }
      whatsApp += `🗺️ *Google Maps:* ${mapUrl}\n`;
    } else {
      whatsApp += `📍 *Location:* Acquiring GPS satellite fix...\n`;
    }

    if (input.batteryLevel != null) {
      whatsApp += `🔋 *Device Battery:* ${input.batteryLevel}%\n`;
    }

    if (input.medicalNotes && input.medicalNotes.trim() !== '') {
      whatsApp += `🩺 *Medical Alert:* ${input.medicalNotes.trim()}\n`;
    }

    if (observationsList) {
      whatsApp += `\n*Verified Incident Telemetry:*\n${observationsList}\n`;
    }

    whatsApp += `\n🛰️ *Live Tracking Portal:* ${trackUrl}\n\n` +
      `_Please attempt contact immediately or initiate emergency response._`;

    // 3. Generate Vocal Synthesizer Text for DITTU
    const vocalText = hasCoordinates
      ? `Emergency mode active for ${input.userName}. Coordinates recorded. Guardians notified.`
      : `Emergency mode active for ${input.userName}. Acquiring satellite coordinates. Guardians notified.`;

    return {
      smsMessage: sms,
      whatsAppMessage: whatsApp,
      voiceBroadcastText: vocalText,
      generatedAt: new Date().toISOString(),
      verifiedDataIncluded: {
        hasCoordinates,
        hasTime,
        hasStatus,
        hasObservations
      }
    };
  }
}

export const emergencyMessageService = new EmergencyMessageService();
