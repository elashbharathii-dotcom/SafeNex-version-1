import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { threatIntelligenceService } from '../src/services/ai/ThreatIntelligenceService.ts';
import { incidentAssessmentService } from '../src/services/ai/IncidentAssessmentService.ts';
import { emergencyMessageService } from '../src/services/ai/EmergencyMessageService.ts';
import { incidentSummaryService } from '../src/services/ai/IncidentSummaryService.ts';
import { dittuAIService } from '../src/services/ai/DITTUAIService.ts';

describe('SAFENEX Web Frontend AI Services - Test Suite', () => {

  test('Frontend ThreatIntelligenceService fallback returns valid structured result', () => {
    const fallback = threatIntelligenceService.fallbackAnalysis('BUTTON', {
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 3,
      permissionStatus: 'granted'
    });

    assert.strictEqual(fallback.incidentCategory, 'PHYSICAL_DURESS');
    assert.ok(fallback.confidenceLevel >= 0.7);
    assert.ok(fallback.observedIndicators.some(i => i.includes('GPS')));
    assert.ok(fallback.recommendedActions.length > 0);
  });

  test('Frontend IncidentAssessmentService handles missing coordinates gracefully', () => {
    const assess = incidentAssessmentService.fallbackAssessment('evt-101', 'SHAKE', {
      latitude: null,
      longitude: null,
      accuracy: null,
      permissionStatus: 'loading'
    });

    assert.strictEqual(assess.severityLevel, 'ELEVATED');
    assert.ok(assess.immediateRisks.some(r => r.includes('Satellite') || r.includes('risk')));
    assert.strictEqual(assess.guardianActionRequired, true);
  });

  test('Frontend EmergencyMessageService generates verified SMS <= 160 chars', () => {
    const msgs = emergencyMessageService.fallbackFormat(
      'Ananya',
      'ACTIVE',
      'PANIC_BUTTON',
      {
        latitude: 13.0827,
        longitude: 80.2707,
        accuracy: 4,
        permissionStatus: 'granted'
      },
      92,
      'Type A+'
    );

    assert.ok(msgs.smsMessage.length <= 160, `SMS must be <= 160 chars, was ${msgs.smsMessage.length}`);
    assert.ok(msgs.smsMessage.includes('Ananya'));
    assert.ok(msgs.smsMessage.includes('13.0827'));
    assert.ok(msgs.whatsAppMessage.includes('Ananya'));
    assert.ok(msgs.whatsAppMessage.includes('Type A+'));
    assert.strictEqual(msgs.verifiedDataIncluded.hasCoordinates, true);
  });

  test('Frontend EmergencyMessageService handles missing GPS without inventing data', () => {
    const msgs = emergencyMessageService.fallbackFormat(
      'John',
      'ACTIVE',
      'BUTTON',
      undefined
    );

    assert.ok(msgs.smsMessage.includes('Loc:GPS acquiring'));
    assert.ok(msgs.whatsAppMessage.includes('Acquiring GPS satellite fix'));
    assert.strictEqual(msgs.verifiedDataIncluded.hasCoordinates, false);
  });

  test('Frontend DITTUAIService executes instant keyword-based emergency trigger', async () => {
    // English Emergency Trigger
    const enRes = await dittuAIService.processVoiceCommand('HELP ME NOW');
    assert.strictEqual(enRes.intent, 'SOS_TRIGGER');
    assert.strictEqual(enRes.shouldTriggerEmergency, true);

    // Tamil Emergency Trigger (காப்பாத்துங்க)
    const taRes = await dittuAIService.processVoiceCommand('காப்பாத்துங்க!');
    assert.strictEqual(taRes.intent, 'SOS_TRIGGER');
    assert.strictEqual(taRes.shouldTriggerEmergency, true);
    assert.strictEqual(taRes.detectedLanguage, 'ta');
  });

  test('Frontend IncidentSummaryService builds chronological audit report', () => {
    const summary = incidentSummaryService.fallbackSummary({
      id: 'evt-web-summary-test',
      created_at: '2026-11-25T18:00:00Z',
      device_name: 'SafeNex Band',
      trigger_source: 'SHAKE',
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 5,
      address: 'MG Road, Bangalore',
      maps_url: 'https://maps.google.com/?q=12.9716,77.5946',
      audio_url: 'https://supabase.co/audio.m4a',
      photo_front_url: null,
      photo_back_url: null,
      video_url: 'https://supabase.co/video.mp4',
      status: 'RESOLVED',
      guardians_notified: 2,
      resolved_at: '2026-11-25T18:12:00Z'
    }, 'Deepak');

    assert.strictEqual(summary.evidenceAudit.videoRecorded, true);
    assert.strictEqual(summary.evidenceAudit.audioRecorded, true);
    assert.strictEqual(summary.evidenceAudit.guardiansNotified, 2);
    assert.ok(summary.chronologicalTimeline.length >= 3);
  });
});
