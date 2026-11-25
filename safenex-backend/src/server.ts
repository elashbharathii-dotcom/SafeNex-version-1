import http, { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { threatIntelligenceService } from './services/ThreatIntelligenceService.ts';
import { incidentAssessmentService } from './services/IncidentAssessmentService.ts';
import { emergencyMessageService } from './services/EmergencyMessageService.ts';
import { incidentSummaryService } from './services/IncidentSummaryService.ts';
import { dittuAIService } from './services/DITTUAIService.ts';
import { verifySupabaseJwt } from './middleware/jwtValidator.ts';

// Load .env manually if exists without external dotenv library
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const k = trimmed.substring(0, idx).trim();
      const v = trimmed.substring(idx + 1).trim();
      if (!process.env[k]) {
        process.env[k] = v;
      }
    }
  });
}

const PORT = Number(process.env.PORT) || 5001;
const SAFENEX_BACKEND_SECRET = process.env.SAFENEX_BACKEND_SECRET || process.env.SAFENEX_AUTH_SECRET || '';

// Configured allowed CORS origins
const ALLOWED_CORS_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Dual-tier rate limiting map (key -> timestamps)
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const AUTH_RATE_LIMIT = 60; // 60 req/min for authenticated
const EMERGENCY_ANON_RATE_LIMIT = 20; // 20 req/min for unauthenticated emergency sessions

function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const times = rateLimitMap.get(key) || [];
  const recent = times.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= limit) {
    return false;
  }
  recent.push(now);
  rateLimitMap.set(key, recent);
  return true;
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) { // 10MB limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function getCorsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  const isAllowed = origin && (ALLOWED_CORS_ORIGINS.includes(origin) || ALLOWED_CORS_ORIGINS.includes('*'));
  const corsOrigin = isAllowed ? origin : ALLOWED_CORS_ORIGINS[0] || 'http://localhost:5173';

  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-safenex-backend-secret',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  };
}

function sendJson(res: ServerResponse, req: IncomingMessage, status: number, data: any) {
  const cors = getCorsHeaders(req);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...cors
  });
  res.end(JSON.stringify(data));
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = reqUrl.pathname;
    const method = req.method?.toUpperCase();
    const clientIp = req.socket.remoteAddress || '127.0.0.1';

    // CORS pre-flight
    if (method === 'OPTIONS') {
      res.writeHead(204, getCorsHeaders(req));
      res.end();
      return;
    }

    // Health Check (Public)
    if (pathname === '/health' || pathname === '/api/ai/health') {
      const hasKey = Boolean(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('your_gemini'));
      return sendJson(res, req, 200, {
        status: 'ONLINE',
        service: 'SAFENEX AI CORE V1',
        timestamp: new Date().toISOString(),
        aiEngine: hasKey ? 'Gemini 2.5 Flash' : 'Deterministic High-Reliability Fallback',
        features: [
          'ThreatIntelligenceService',
          'IncidentAssessmentService',
          'EmergencyMessageService',
          'IncidentSummaryService',
          'DITTUAIService (Tamil + English)'
        ]
      });
    }

    // Emergency Path Check
    const isEmergencyAiPath =
      pathname === '/api/ai/threat-intelligence' ||
      pathname === '/api/ai/incident-assessment' ||
      pathname === '/api/ai/emergency-message' ||
      pathname === '/api/ai/dittu' ||
      pathname === '/api/ai/incident-summary';

    // Authorization & Authentication Verification
    const authHeader = req.headers.authorization;
    const backendSecretHeader = req.headers['x-safenex-backend-secret'] || req.headers['x-safenex-auth'];
    let userContext: any = null;
    let isEmergencyUnauthenticated = false;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      const verification = verifySupabaseJwt(token);
      if (!verification.valid) {
        return sendJson(res, req, 401, {
          error: verification.error || 'Unauthorized',
          message: verification.message || 'Invalid or expired session token.'
        });
      }
      userContext = verification.user;

      // Rate limit authenticated requests (60 req/min per user)
      if (!checkRateLimit(`user:${userContext.id}`, AUTH_RATE_LIMIT)) {
        return sendJson(res, req, 429, {
          error: 'RateLimitExceeded',
          message: 'User rate limit exceeded (60 requests per minute).'
        });
      }
    } else if (
      backendSecretHeader &&
      SAFENEX_BACKEND_SECRET &&
      backendSecretHeader === SAFENEX_BACKEND_SECRET
    ) {
      // Authorized backend service-to-service call
      userContext = { id: 'backend-service', role: 'service_role' };
    } else if (isEmergencyAiPath) {
      // Unauthenticated Emergency Access:
      // SOS activations MUST NEVER be blocked by authentication requirements!
      // Enforce strict rate limit per client IP (20 req/min) to prevent abuse
      if (!checkRateLimit(`ip-emergency:${clientIp}`, EMERGENCY_ANON_RATE_LIMIT)) {
        return sendJson(res, req, 429, {
          error: 'RateLimitExceeded',
          message: 'Emergency session rate limit exceeded for this IP. Please retry in a moment.'
        });
      }
      isEmergencyUnauthenticated = true;
    } else {
      return sendJson(res, req, 401, {
        error: 'Unauthorized',
        message: 'Valid Supabase Authorization Bearer token required.'
      });
    }

    try {
      // 1. Threat Intelligence
      if (pathname === '/api/ai/threat-intelligence' && method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.triggerSource) {
          return sendJson(res, req, 400, { error: 'MissingRequiredField', message: 'triggerSource is required.' });
        }
        if (body.mediaBase64 && !body.recordingAuthorized) {
          return sendJson(res, req, 403, { error: 'PermissionDenied', message: 'Processing recordings requires recordingAuthorized: true.' });
        }
        const result = await threatIntelligenceService.analyzeThreat(body);
        return sendJson(res, req, 200, result);
      }

      // 2. Incident Assessment
      if (pathname === '/api/ai/incident-assessment' && method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.eventId || !body.triggerSource) {
          return sendJson(res, req, 400, { error: 'MissingRequiredField', message: 'eventId and triggerSource are required.' });
        }
        const result = incidentAssessmentService.assessIncident(body);
        return sendJson(res, req, 200, result);
      }

      // 3. Emergency Message Generator
      if (pathname === '/api/ai/emergency-message' && method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.userName || !body.triggerSource) {
          return sendJson(res, req, 400, { error: 'MissingRequiredField', message: 'userName and triggerSource are required.' });
        }
        const result = emergencyMessageService.generateMessages(body);
        return sendJson(res, req, 200, result);
      }

      // 4. Incident Summary
      if (pathname === '/api/ai/incident-summary' && method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.eventId || !body.user || !body.triggerSource) {
          return sendJson(res, req, 400, { error: 'MissingRequiredField', message: 'eventId, user, and triggerSource are required.' });
        }
        const result = incidentSummaryService.summarizeIncident(body);
        return sendJson(res, req, 200, result);
      }

      // 5. DITTU Conversational Voice Assistant (English + Tamil)
      if (pathname === '/api/ai/dittu' && method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.query || typeof body.query !== 'string') {
          return sendJson(res, req, 400, { error: 'MissingRequiredField', message: 'query string is required.' });
        }
        const result = await dittuAIService.processQuery(body);
        return sendJson(res, req, 200, result);
      }

      return sendJson(res, req, 404, { error: 'NotFound', message: `Route ${pathname} not found.` });
    } catch (err: any) {
      console.error('API Error:', err);
      return sendJson(res, req, 500, { error: 'InternalServerError', message: err.message || 'Internal server error.' });
    }
  });
}

const server = createServer();

if (process.argv[1] && process.argv[1].includes('server.ts')) {
  server.listen(PORT, () => {
    console.log(`[SAFENEX AI CORE] Native Microservice running on http://localhost:${PORT}`);
    console.log(`[SAFENEX AI CORE] Health check at: http://localhost:${PORT}/api/ai/health`);
  });
}

export default server;
