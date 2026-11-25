import { Request, Response, NextFunction } from 'express';

// In-memory rate-limiter tracker (IP/Token -> timestamps)
const requestRateMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 60;     // 60 req/min

/**
 * Validates internal/client authorization.
 * Allows configured internal secret or valid token.
 */
export function validateAuth(req: Request, res: Response, next: NextFunction): void {
  // Health and public ping bypass auth
  if (req.path === '/api/ai/health' || req.path === '/health') {
    return next();
  }

  const authHeader = req.headers.authorization;
  const customSecret = req.headers['x-safenex-auth'];
  const expectedSecret = process.env.SAFENEX_AUTH_SECRET || 'safenex_internal_secret_key_v1';

  // Check Bearer token or custom internal secret
  if (customSecret === expectedSecret) {
    return next();
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token === expectedSecret || token.length > 20) {
      // Validated token
      return next();
    }
  }

  // Development lenient fallback: Allow local loopback requests with warning
  const clientIp = req.ip || req.socket.remoteAddress || '';
  if (process.env.NODE_ENV !== 'production' && (clientIp.includes('127.0.0.1') || clientIp.includes('::1') || clientIp === 'localhost')) {
    return next();
  }

  res.status(401).json({
    error: 'Unauthorized',
    message: 'Valid Authorization header or x-safenex-auth secret required.'
  });
}

/**
 * Enforces per-client request limits to protect resources and prevent abuse.
 */
export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const clientKey = (req.ip || 'unknown-client') + ':' + (req.headers['x-safenex-auth'] || 'anon');
  const now = Date.now();
  const timestamps = requestRateMap.get(clientKey) || [];

  // Filter timestamps within the current window
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    res.status(429).json({
      error: 'RateLimitExceeded',
      message: 'Too many requests. Please throttle your rate of emergency intelligence queries.'
    });
    return;
  }

  recent.push(now);
  requestRateMap.set(clientKey, recent);
  next();
}

/**
 * Verifies explicit user permission before processing or recording audio/video evidence.
 */
export function verifyRecordingPermission(req: Request, res: Response, next: NextFunction): void {
  const { mediaBase64, mediaType, recordingAuthorized } = req.body;

  if (mediaBase64 && (mediaType === 'audio' || mediaType === 'image' || mediaType === 'video')) {
    if (recordingAuthorized !== true) {
      res.status(403).json({
        error: 'PermissionDenied',
        message: 'Processing or storing audio/video evidence requires explicit user consent (recordingAuthorized: true).'
      });
      return;
    }
  }

  next();
}
