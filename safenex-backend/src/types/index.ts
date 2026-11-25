/**
 * SAFENEX AI CORE V1 - Common Type Definitions
 */

export interface LocationTelemetry {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  address?: string | null;
  timestamp?: number | null;
  speed?: number | null;
  heading?: number | null;
}

export interface ThreatIntelligenceInput {
  incidentDescription?: string;
  triggerSource: string;
  telemetry?: LocationTelemetry;
  mediaType?: 'text' | 'audio' | 'image';
  mediaBase64?: string;
  recordingAuthorized?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ThreatIntelligenceResult {
  incidentCategory: 'PHYSICAL_DURESS' | 'TRANSIT_ANOMALY' | 'MEDICAL_CONCERN' | 'PRECAUTIONARY' | 'UNVERIFIED_DISTRESS';
  incidentSummary: string;
  observedIndicators: string[];
  potentialRisks: string[];
  confidenceLevel: number; // 0.0 to 1.0
  uncertaintyExplanation: string;
  recommendedActions: string[];
  timestamp: string;
}

export interface IncidentAssessmentInput {
  eventId: string;
  triggerSource: string;
  location?: LocationTelemetry;
  motionMetrics?: {
    shakeDetected?: boolean;
    accelerationMagnitude?: number;
    speedMps?: number;
  };
  audioMetrics?: {
    decibelLevel?: number;
    speechDetected?: boolean;
    screamingDetected?: boolean;
  };
  commuteOverdueMinutes?: number;
}

export interface IncidentAssessmentResult {
  eventId: string;
  severityLevel: 'INFO' | 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL';
  confidenceScore: number; // 0.0 to 1.0
  immediateRisks: string[];
  verifiedObservations: string[];
  situationalContext: string;
  deEscalationGuidance: string;
  guardianActionRequired: boolean;
  evaluatedAt: string;
}

export interface EmergencyMessageInput {
  userName: string;
  emergencyStatus: 'ACTIVE' | 'RESOLVED' | 'VERIFYING';
  triggerSource: string;
  activationTime: string;
  location?: LocationTelemetry | null;
  incidentDescription?: string;
  verifiedObservations?: string[];
  batteryLevel?: number | null;
  medicalNotes?: string;
  trackingUrl?: string;
}

export interface EmergencyMessageResult {
  smsMessage: string;        // Strict <= 160 character format
  whatsAppMessage: string;   // Formatted with emoji & markdown
  voiceBroadcastText: string;// Clean text for vocal synthesizer
  generatedAt: string;
  verifiedDataIncluded: {
    hasCoordinates: boolean;
    hasTime: boolean;
    hasStatus: boolean;
    hasObservations: boolean;
  };
}

export interface IncidentSummaryInput {
  eventId: string;
  user: {
    name: string;
    phone?: string;
  };
  triggerSource: string;
  activatedAt: string;
  resolvedAt?: string | null;
  initialLocation?: LocationTelemetry | null;
  finalLocation?: LocationTelemetry | null;
  breadcrumbsCount: number;
  guardiansAlerted: number;
  threatAssessment?: Partial<ThreatIntelligenceResult>;
  incidentAssessment?: Partial<IncidentAssessmentResult>;
  evidenceFiles?: {
    audioUrl?: string | null;
    videoUrl?: string | null;
    photoUrls?: string[];
  };
}

export interface IncidentSummaryResult {
  eventId: string;
  title: string;
  executiveSummary: string;
  chronologicalTimeline: Array<{
    time: string;
    event: string;
    type: 'trigger' | 'location' | 'notification' | 'telemetry' | 'resolution';
  }>;
  factualObservations: string[];
  sensorInferences: string[];
  evidenceAudit: {
    videoRecorded: boolean;
    audioRecorded: boolean;
    totalGpsFixes: number;
    guardiansNotified: number;
  };
  formattedReportMarkdown: string;
  generatedAt: string;
}

export interface DittuInput {
  query: string;
  language?: 'en' | 'ta' | 'auto';
  userLocation?: LocationTelemetry;
  isEmergencyActive?: boolean;
  batteryLevel?: number | null;
  primaryGuardianName?: string;
}

export interface DittuResult {
  spokenReply: string;
  detectedLanguage: 'en' | 'ta';
  intent: 'SOS_TRIGGER' | 'CALL_GUARDIAN' | 'QUERY_LOCATION' | 'QUERY_STATUS' | 'CONVERSATIONAL' | 'SAFETY_CONFIRMATION';
  shouldTriggerEmergency: boolean;
  confidence: number;
  fallbackUsed: boolean;
}
