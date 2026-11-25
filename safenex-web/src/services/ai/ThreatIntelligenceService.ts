import type { LocationState, ThreatIntelligenceResult } from '../../types/index.ts';
import { getClientAuthHeaders } from './authHelper.ts';

export class ThreatIntelligenceService {
  /**
   * Evaluates threat intelligence via the secure backend AI endpoint.
   * If the backend is unreachable or times out, immediately activates local deterministic fallback.
   */
  async analyzeThreat(
    triggerSource: string,
    description?: string,
    location?: LocationState,
    recordingAuthorized = false
  ): Promise<ThreatIntelligenceResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const authHeaders = await getClientAuthHeaders();
      const response = await fetch('/api/ai/threat-intelligence', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          triggerSource,
          incidentDescription: description,
          telemetry: location ? {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            address: location.address,
          } : undefined,
          recordingAuthorized,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      clearTimeout(timeoutId);
      console.warn('[ThreatIntelligence] Backend unreachable, using client deterministic fallback:', e);
    }

    return this.fallbackAnalysis(triggerSource, location);
  }

  fallbackAnalysis(triggerSource: string, location?: LocationState): ThreatIntelligenceResult {
    const src = triggerSource.toUpperCase();
    let category: ThreatIntelligenceResult['incidentCategory'] = 'UNVERIFIED_DISTRESS';
    const indicators: string[] = [`Trigger source registered: ${triggerSource}`];
    const risks: string[] = [];
    const actions: string[] = ['Maintain guardian tracking connection', 'Seek well-lit public space if in transit'];
    let confidence = 0.75;
    let uncertainty = 'Evaluated using client-side safety heuristics.';

    if (location?.latitude && location?.longitude) {
      indicators.push(`Live GPS telemetry locked (±${location.accuracy || 5}m)`);
    } else {
      indicators.push('GPS lock pending satellite acquisition');
      uncertainty += ' Location pending lock.';
      confidence -= 0.15;
    }

    if (src.includes('BUTTON') || src.includes('PANIC')) {
      category = 'PHYSICAL_DURESS';
      indicators.push('Hardware SOS trigger depressed');
      risks.push('Active personal safety distress');
      actions.unshift('Broadcasting emergency coordinates to emergency guardians');
      confidence = 0.85;
    } else if (src.includes('SHAKE')) {
      category = 'PHYSICAL_DURESS';
      indicators.push('Sudden multi-axis violent accelerometer spike');
      risks.push('Potential device drop or physical duress');
      confidence = 0.70;
    } else if (src.includes('COMMUTE') || src.includes('OVERDUE')) {
      category = 'TRANSIT_ANOMALY';
      indicators.push('Dead-man commute timer expired with no user response');
      risks.push('User delayed or unresponsive on commute route');
      confidence = 0.88;
    }

    return {
      incidentCategory: category,
      incidentSummary: `Active ${category.replace('_', ' ')} alert triggered via ${triggerSource}.`,
      observedIndicators: indicators,
      potentialRisks: risks.length > 0 ? risks : ['Unverified situational risk in progress'],
      confidenceLevel: Math.round(confidence * 100) / 100,
      uncertaintyExplanation: uncertainty,
      recommendedActions: actions,
      timestamp: new Date().toISOString(),
    };
  }
}

export const threatIntelligenceService = new ThreatIntelligenceService();
