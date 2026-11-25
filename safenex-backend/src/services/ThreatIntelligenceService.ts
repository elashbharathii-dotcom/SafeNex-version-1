import type { ThreatIntelligenceInput, ThreatIntelligenceResult } from '../types/index.ts';

/**
 * SAFENEX AI Threat Intelligence Engine
 * 
 * Safety & Ethical Invariants:
 * - Never identifies someone as a criminal based on appearance, race, or clothing.
 * - Never claims to predict crimes.
 * - Clearly distinguishes verified observations from inferred potential risks.
 * - Explicitly communicates confidence and epistemic uncertainty.
 */
export class ThreatIntelligenceService {
  private apiKey: string | null = null;
  private modelName: string;

  constructor() {
    const key = process.env.GEMINI_API_KEY;
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (key && key.trim() !== '' && !key.includes('your_gemini')) {
      this.apiKey = key.trim();
    }
  }

  async analyzeThreat(input: ThreatIntelligenceInput): Promise<ThreatIntelligenceResult> {
    // If Gemini API key is configured, query LLM with strict safety constraints and 5s timeout
    if (this.apiKey) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AI Threat Intelligence request timed out (5000ms)')), 5000)
        );

        const aiPromise = this.callGeminiThreatAnalysis(input);
        return await Promise.race([aiPromise, timeoutPromise]);
      } catch (err) {
        console.warn('[ThreatIntelligence] LLM query failed or timed out, executing deterministic fallback:', err);
      }
    }

    // High-reliability deterministic fallback ensuring safety system NEVER halts
    return this.deterministicThreatAnalysis(input);
  }

  private async callGeminiThreatAnalysis(input: ThreatIntelligenceInput): Promise<ThreatIntelligenceResult> {
    if (!this.apiKey) throw new Error('API key not set');

    const systemInstruction = `You are the SAFENEX Emergency Threat Intelligence Engine.
Analyze the provided authorized incident description and telemetry.
CRITICAL SAFETY & ETHICAL INVARIANTS:
1. NEVER identify or label anyone as a criminal, attacker, or suspect based on appearance, ethnicity, clothing, or physical traits.
2. NEVER claim to predict crimes or rate general neighborhood crime rates.
3. Distinguish factual observed indicators (what sensors or users directly reported) from potential risks (hypothetical hazards).
4. Explicitly state the confidence level (0.0 to 1.0) and explain the uncertainty factors.
5. Return ONLY a valid JSON object matching this schema:
{
  "incidentCategory": "PHYSICAL_DURESS" | "TRANSIT_ANOMALY" | "MEDICAL_CONCERN" | "PRECAUTIONARY" | "UNVERIFIED_DISTRESS",
  "incidentSummary": "Concise factual summary",
  "observedIndicators": ["list of factual observations directly present in input"],
  "potentialRisks": ["list of potential safety risks without crime predictions"],
  "confidenceLevel": 0.85,
  "uncertaintyExplanation": "Explanation of missing signals or sensor ambiguity",
  "recommendedActions": ["Immediate actionable safety steps"]
}`;

    const promptText = `Incident Telemetry:
- Trigger Source: ${input.triggerSource}
- Description: ${input.incidentDescription || 'None provided'}
- Location: Lat ${input.telemetry?.latitude ?? 'Unknown'}, Lng ${input.telemetry?.longitude ?? 'Unknown'} (Accuracy: ${input.telemetry?.accuracy ?? 'Unknown'}m)
- Media Provided: ${input.mediaType || 'None'}`;

    const parts: any[] = [{ text: promptText }];

    if (input.mediaBase64 && input.recordingAuthorized && (input.mediaType === 'image' || input.mediaType === 'audio')) {
      const mime = input.mediaType === 'image' ? 'image/jpeg' : 'audio/webm';
      parts.push({
        inlineData: {
          mimeType: mime,
          data: input.mediaBase64
        }
      });
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
    const payload = {
      contents: [{ role: 'user', parts }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(rawJson);

    return {
      incidentCategory: this.validateCategory(parsed.incidentCategory),
      incidentSummary: String(parsed.incidentSummary || 'Emergency event registered.'),
      observedIndicators: Array.isArray(parsed.observedIndicators) ? parsed.observedIndicators.map(String) : ['Emergency trigger active'],
      potentialRisks: Array.isArray(parsed.potentialRisks) ? parsed.potentialRisks.map(String) : ['Potential personal safety risk'],
      confidenceLevel: Math.min(1, Math.max(0, Number(parsed.confidenceLevel) || 0.7)),
      uncertaintyExplanation: String(parsed.uncertaintyExplanation || 'Evaluated from available device telemetry.'),
      recommendedActions: Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions.map(String) : ['Seek safe public space', 'Maintain guardian connection'],
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Verified deterministic heuristic analysis used when AI is offline, keys are unset, or network fails.
   */
  deterministicThreatAnalysis(input: ThreatIntelligenceInput): ThreatIntelligenceResult {
    const src = input.triggerSource.toUpperCase();
    const desc = (input.incidentDescription || '').toLowerCase();

    let category: ThreatIntelligenceResult['incidentCategory'] = 'UNVERIFIED_DISTRESS';
    const indicators: string[] = [`Trigger source registered: ${input.triggerSource}`];
    const risks: string[] = [];
    const actions: string[] = ['Activate acoustic and visual deterrents if in peril', 'Keep phone powered and connected to guardians'];
    let confidence = 0.75;
    let uncertainty = 'Evaluated using verified local rule heuristics without cloud LLM.';

    if (input.telemetry?.latitude && input.telemetry?.longitude) {
      indicators.push(`GPS coordinate lock verified (accuracy: ±${input.telemetry.accuracy || 5}m)`);
    } else {
      uncertainty += ' GPS coordinates are currently pending lock.';
      confidence -= 0.15;
    }

    if (src.includes('BUTTON') || src.includes('PANIC')) {
      category = 'PHYSICAL_DURESS';
      indicators.push('Hardware SOS panic button manually depressed');
      risks.push('Immediate user distress or active confrontation');
      actions.unshift('Dispatch immediate location coordinates to primary guardian');
      confidence = Math.max(confidence, 0.85);
    } else if (src.includes('SHAKE') || src.includes('MOTION')) {
      category = 'PHYSICAL_DURESS';
      indicators.push('Sudden multi-axis violent accelerometer spike');
      risks.push('Potential device drop, stumble, or physical struggle');
      actions.unshift('Verify user safety via tactile or voice check');
      confidence = Math.max(confidence, 0.70);
      uncertainty += ' High-acceleration shake may indicate accidental device drop.';
    } else if (src.includes('COMMUTE') || src.includes('OVERDUE')) {
      category = 'TRANSIT_ANOMALY';
      indicators.push('Dead-man commute timer expired with no user safe-checkin response');
      risks.push('User delayed in transit, lost communication, or incapacitated');
      actions.unshift('Notify emergency guardians of overdue scheduled arrival');
      confidence = 0.88;
    } else if (src.includes('VOICE')) {
      indicators.push('Voice trigger detected');
      if (desc.includes('help') || desc.includes('save') || desc.includes('danger') || desc.includes('காப்பாத்து') || desc.includes('உதவி')) {
        category = 'PHYSICAL_DURESS';
        risks.push('Verbal distress utterance detected');
      } else {
        category = 'PRECAUTIONARY';
      }
    }

    return {
      incidentCategory: category,
      incidentSummary: `Active ${category.replace('_', ' ')} alert triggered via ${input.triggerSource}.`,
      observedIndicators: indicators,
      potentialRisks: risks.length > 0 ? risks : ['Unverified situational risk in progress'],
      confidenceLevel: Math.round(confidence * 100) / 100,
      uncertaintyExplanation: uncertainty,
      recommendedActions: actions,
      timestamp: new Date().toISOString()
    };
  }

  private validateCategory(cat: string): ThreatIntelligenceResult['incidentCategory'] {
    const valid = ['PHYSICAL_DURESS', 'TRANSIT_ANOMALY', 'MEDICAL_CONCERN', 'PRECAUTIONARY', 'UNVERIFIED_DISTRESS'];
    return (valid.includes(cat) ? cat : 'UNVERIFIED_DISTRESS') as ThreatIntelligenceResult['incidentCategory'];
  }
}

export const threatIntelligenceService = new ThreatIntelligenceService();
