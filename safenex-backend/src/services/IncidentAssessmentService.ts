import type { IncidentAssessmentInput, IncidentAssessmentResult } from '../types/index.ts';

/**
 * SAFENEX AI Incident Assessment Engine
 * 
 * Performs multi-modal situational triage across trigger origin, motion dynamics,
 * ambient acoustics, and dead-man commute timers.
 * 
 * Invariants:
 * - Never blocks or delays SOS dispatch.
 * - Calibrates confidence with explicit telemetry indicators.
 */
export class IncidentAssessmentService {
  assessIncident(input: IncidentAssessmentInput): IncidentAssessmentResult {
    const verifiedObservations: string[] = [
      `Trigger origin: ${input.triggerSource}`,
      `Evaluation event ID: ${input.eventId}`
    ];
    const immediateRisks: string[] = [];
    let severity: IncidentAssessmentResult['severityLevel'] = 'LOW';
    let confidence = 0.80;
    let guardianActionRequired = true;
    let deEscalationGuidance = 'Stay in well-lit areas, do not confront potential threats, keep phone visible or accessible.';

    // 1. Analyze Motion Metrics
    if (input.motionMetrics?.shakeDetected) {
      verifiedObservations.push('Violent physical device motion / shake spike recorded');
      immediateRisks.push('Physical altercation, sprint, or sudden fall');
      severity = 'HIGH';
      confidence += 0.05;
    }

    // 2. Analyze Location Telemetry
    if (input.location?.latitude && input.location?.longitude) {
      const acc = input.location.accuracy || 10;
      verifiedObservations.push(`Real-time GPS lock: ${input.location.latitude.toFixed(5)}, ${input.location.longitude.toFixed(5)} (±${acc}m)`);
      if (input.location.address) {
        verifiedObservations.push(`Reverse-geocoded location: ${input.location.address}`);
      }
    } else {
      verifiedObservations.push('Location telemetry: GPS acquisition pending');
      immediateRisks.push('Responders lack exact coordinate fix');
      confidence -= 0.15;
    }

    // 3. Analyze Audio Metrics if available
    if (input.audioMetrics) {
      if (input.audioMetrics.screamingDetected) {
        verifiedObservations.push('Acoustic spike: Human vocal distress scream detected');
        immediateRisks.push('Active verbal duress or immediate bodily danger');
        severity = 'CRITICAL';
        confidence += 0.10;
      } else if (input.audioMetrics.decibelLevel && input.audioMetrics.decibelLevel > 85) {
        verifiedObservations.push(`Elevated ambient acoustic level: ${input.audioMetrics.decibelLevel} dB`);
      }
    }

    // 4. Analyze Commute Overdue
    if (input.commuteOverdueMinutes && input.commuteOverdueMinutes > 0) {
      verifiedObservations.push(`Scheduled arrival exceeded by ${input.commuteOverdueMinutes} minutes with no check-in`);
      immediateRisks.push('User unresponsive on scheduled transit route');
      if (severity !== 'CRITICAL') severity = 'ELEVATED';
    }

    // 5. Trigger-specific severity weighting
    const upperSource = input.triggerSource.toUpperCase();
    if (upperSource.includes('BUTTON') || upperSource.includes('PANIC')) {
      if (severity !== 'CRITICAL') severity = 'HIGH';
      immediateRisks.push('Deliberate physical button activation by user');
      deEscalationGuidance = 'Emergency protocol active. Deterrent siren armed. Audio/video blackbox recording engaged.';
    } else if (upperSource.includes('SHAKE')) {
      if (severity === 'LOW') severity = 'ELEVATED';
    }

    return {
      eventId: input.eventId,
      severityLevel: severity,
      confidenceScore: Math.min(1.0, Math.max(0.2, Math.round(confidence * 100) / 100)),
      immediateRisks: immediateRisks.length > 0 ? immediateRisks : ['Unverified situational risk in progress'],
      verifiedObservations,
      situationalContext: `SafeNex Core has initiated Priority ${severity} emergency response. System telemetry is actively synchronizing with cloud and guardians.`,
      deEscalationGuidance,
      guardianActionRequired,
      evaluatedAt: new Date().toISOString()
    };
  }
}

export const incidentAssessmentService = new IncidentAssessmentService();
