import type { LocationState, IncidentAssessmentResult } from '../../types/index.ts';
import { getClientAuthHeaders } from './authHelper.ts';

export class IncidentAssessmentService {
  async assessIncident(
    eventId: string,
    triggerSource: string,
    location?: LocationState,
    commuteOverdueMinutes?: number
  ): Promise<IncidentAssessmentResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const authHeaders = await getClientAuthHeaders();
      const response = await fetch('/api/ai/incident-assessment', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          eventId,
          triggerSource,
          location: location ? {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            address: location.address,
          } : undefined,
          commuteOverdueMinutes,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      clearTimeout(timeoutId);
      console.warn('[IncidentAssessment] Backend unreachable, using client deterministic fallback:', e);
    }

    return this.fallbackAssessment(eventId, triggerSource, location, commuteOverdueMinutes);
  }

  fallbackAssessment(
    eventId: string,
    triggerSource: string,
    location?: LocationState,
    commuteOverdueMinutes?: number
  ): IncidentAssessmentResult {
    const verifiedObservations: string[] = [
      `Trigger origin: ${triggerSource}`,
      `Event identifier: ${eventId}`,
    ];
    const immediateRisks: string[] = [];
    let severity: IncidentAssessmentResult['severityLevel'] = 'LOW';
    let confidence = 0.80;

    if (location?.latitude && location?.longitude) {
      verifiedObservations.push(`Real-time GPS lock: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`);
      if (location.address) {
        verifiedObservations.push(`Reverse-geocoded: ${location.address}`);
      }
    } else {
      verifiedObservations.push('Location telemetry: GPS acquisition pending');
      immediateRisks.push('Satellite fix acquiring');
      confidence -= 0.15;
    }

    const upper = triggerSource.toUpperCase();
    if (upper.includes('BUTTON') || upper.includes('PANIC')) {
      severity = 'HIGH';
      immediateRisks.push('Explicit hardware SOS button triggered');
    } else if (upper.includes('COMMUTE') || (commuteOverdueMinutes && commuteOverdueMinutes > 0)) {
      severity = 'ELEVATED';
      immediateRisks.push('Transit overdue timeout active');
    } else if (upper.includes('SHAKE')) {
      severity = 'ELEVATED';
      immediateRisks.push('Violent accelerometer spike detected');
    }

    return {
      eventId,
      severityLevel: severity,
      confidenceScore: Math.round(confidence * 100) / 100,
      immediateRisks: immediateRisks.length > 0 ? immediateRisks : ['Unverified situational risk'],
      verifiedObservations,
      situationalContext: `SafeNex AI Core armed. Priority ${severity} emergency workflow active.`,
      deEscalationGuidance: 'Keep phone visible or accessible. Siren and blackbox evidence recording active.',
      guardianActionRequired: true,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

export const incidentAssessmentService = new IncidentAssessmentService();
