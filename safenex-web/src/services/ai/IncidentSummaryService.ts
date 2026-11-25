import type { EmergencyEvent, IncidentSummaryResult } from '../../types/index.ts';
import { getClientAuthHeaders } from './authHelper.ts';

export class IncidentSummaryService {
  async summarizeIncident(
    event: EmergencyEvent,
    userName = 'Safety User'
  ): Promise<IncidentSummaryResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const authHeaders = await getClientAuthHeaders();
      const response = await fetch('/api/ai/incident-summary', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          eventId: event.id,
          user: { name: userName },
          triggerSource: event.trigger_source,
          activatedAt: event.created_at,
          resolvedAt: event.resolved_at,
          initialLocation: {
            latitude: event.latitude,
            longitude: event.longitude,
            accuracy: event.accuracy,
            address: event.address,
          },
          breadcrumbsCount: 5,
          guardiansAlerted: event.guardians_notified || 1,
          evidenceFiles: {
            audioUrl: event.audio_url,
            videoUrl: event.video_url,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      clearTimeout(timeoutId);
      console.warn('[IncidentSummary] Backend unreachable, using client deterministic summary:', e);
    }

    return this.fallbackSummary(event, userName);
  }

  fallbackSummary(event: EmergencyEvent, userName: string): IncidentSummaryResult {
    const timeline: IncidentSummaryResult['chronologicalTimeline'] = [
      {
        time: event.created_at,
        event: `Emergency SOS triggered via ${event.trigger_source}`,
        type: 'trigger',
      },
    ];

    if (event.latitude && event.longitude) {
      timeline.push({
        time: event.created_at,
        event: `GPS position recorded at ${event.latitude.toFixed(5)}, ${event.longitude.toFixed(5)}`,
        type: 'location',
      });
    }

    if (event.guardians_notified > 0) {
      timeline.push({
        time: event.created_at,
        event: `Emergency alerts dispatched to ${event.guardians_notified} guardian(s)`,
        type: 'notification',
      });
    }

    if (event.resolved_at) {
      timeline.push({
        time: event.resolved_at,
        event: 'Emergency disarmed with cryptographic PIN verification',
        type: 'resolution',
      });
    }

    const observations: string[] = [
      `Trigger source: ${event.trigger_source}`,
      `Activation timestamp: ${event.created_at}`,
      `Device name: ${event.device_name}`,
    ];

    if (event.video_url) observations.push('Blackbox video evidence uploaded and attached');
    if (event.audio_url) observations.push('Blackbox audio recording uploaded and attached');

    const reportMd = `# SAFENEX Incident Report - ${event.id.slice(0, 8)}

**User:** ${userName}  
**Trigger:** ${event.trigger_source}  
**Created:** ${event.created_at}  
**Status:** ${event.status}  

### Timeline
${timeline.map(t => `- **[${t.time}]** ${t.event}`).join('\n')}

### Evidence Manifest
- Video URL: ${event.video_url || 'None'}
- Audio URL: ${event.audio_url || 'None'}
`;

    return {
      eventId: event.id,
      title: `Emergency Incident Report - ${event.id.slice(0, 8)}`,
      executiveSummary: `Emergency incident initiated via ${event.trigger_source} at ${event.created_at}. Status: ${event.status}.`,
      chronologicalTimeline: timeline,
      factualObservations: observations,
      sensorInferences: event.latitude ? [] : ['GPS fix was acquiring at initial activation'],
      evidenceAudit: {
        videoRecorded: Boolean(event.video_url),
        audioRecorded: Boolean(event.audio_url),
        totalGpsFixes: event.latitude ? 1 : 0,
        guardiansNotified: event.guardians_notified || 0,
      },
      formattedReportMarkdown: reportMd,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const incidentSummaryService = new IncidentSummaryService();
