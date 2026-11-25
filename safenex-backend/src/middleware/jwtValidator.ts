import crypto from 'node:crypto';

export interface VerifiedUser {
  id: string;
  email?: string;
  role?: string;
}

export interface JwtVerificationResult {
  valid: boolean;
  error?: 'MissingToken' | 'MalformedToken' | 'UnsupportedAlgorithm' | 'InvalidSignature' | 'TokenExpired' | 'InvalidAudience' | 'InvalidClaims';
  message?: string;
  user?: VerifiedUser;
}

/**
 * Base64url decode helper for standard JWT tokens.
 */
function base64UrlDecode(str: string): string {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) {
    b64 += '=';
  }
  return Buffer.from(b64, 'base64').toString('utf-8');
}

/**
 * Cryptographically validates Supabase JWT access tokens.
 * Verifies HMAC-SHA256 signature (if secret provided), token expiry, audience, and claims.
 */
export function verifySupabaseJwt(token: string, jwtSecret?: string): JwtVerificationResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'MissingToken', message: 'Authorization token is required.' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'MalformedToken', message: 'JWT must contain header, payload, and signature.' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Decode & Verify Header
  let header: any;
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
  } catch {
    return { valid: false, error: 'MalformedToken', message: 'Invalid JWT header encoding.' };
  }

  if (header.alg !== 'HS256') {
    return { valid: false, error: 'UnsupportedAlgorithm', message: `Only HS256 algorithm is supported (got ${header.alg}).` };
  }

  // 2. Decode & Verify Payload
  let payload: any;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { valid: false, error: 'MalformedToken', message: 'Invalid JWT payload encoding.' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  // Expiration check
  if (typeof payload.exp === 'number' && nowSeconds >= payload.exp) {
    return { valid: false, error: 'TokenExpired', message: 'Session token has expired.' };
  }

  // Audience check (Supabase authenticated user tokens have aud: 'authenticated')
  if (payload.aud && payload.aud !== 'authenticated') {
    return { valid: false, error: 'InvalidAudience', message: `Invalid token audience: ${payload.aud}` };
  }

  // Subject / User ID check
  if (!payload.sub || typeof payload.sub !== 'string') {
    return { valid: false, error: 'InvalidClaims', message: 'Token missing subject (sub) user ID.' };
  }

  // Issuer check: Supabase tokens must have an issuer containing 'supabase' or matching project url
  if (payload.iss && typeof payload.iss === 'string' && !payload.iss.toLowerCase().includes('supabase')) {
    return { valid: false, error: 'InvalidClaims', message: `Invalid token issuer: ${payload.iss}` };
  }

  // 3. Cryptographic Signature Verification
  const secret = jwtSecret || process.env.SUPABASE_JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!secret || secret.trim() === '' || secret.includes('your_supabase')) {
    if (isProduction) {
      return {
        valid: false,
        error: 'InvalidSignature',
        message: 'SUPABASE_JWT_SECRET must be configured in production to verify token signatures.'
      };
    }
  } else {
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSig, 'utf-8');
    const actualBuf = Buffer.from(signatureB64, 'utf-8');

    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return { valid: false, error: 'InvalidSignature', message: 'Cryptographic signature mismatch.' };
    }
  }

  return {
    valid: true,
    user: {
      id: payload.sub,
      email: payload.email,
      role: payload.role || 'authenticated'
    }
  };
}
