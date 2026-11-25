import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { verifySupabaseJwt } from '../src/middleware/jwtValidator.ts';
import { createServer } from '../src/server.ts';

// Helper to craft valid/expired/tampered HS256 JWTs for testing
function craftTestJwt(
  payload: Record<string, any>,
  secret: string,
  header = { alg: 'HS256', typ: 'JWT' }
): string {
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

describe('SAFENEX Backend - Cryptographic Security & Authentication Test Suite', () => {
  const TEST_JWT_SECRET = 'safenex_test_jwt_secret_32_bytes_super_secure';

  test('1. Valid Supabase JWT with correct HMAC-SHA256 signature is accepted', () => {
    const validToken = craftTestJwt(
      {
        sub: 'usr_7b19-4a21-9988',
        email: 'victim@safenex.org',
        aud: 'authenticated',
        role: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600 // expires in 1 hour
      },
      TEST_JWT_SECRET
    );

    const result = verifySupabaseJwt(validToken, TEST_JWT_SECRET);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.user?.id, 'usr_7b19-4a21-9988');
    assert.strictEqual(result.user?.email, 'victim@safenex.org');
    assert.strictEqual(result.user?.role, 'authenticated');
  });

  test('2. Expired JWT is strictly rejected with TokenExpired error', () => {
    const expiredToken = craftTestJwt(
      {
        sub: 'usr_expired_001',
        email: 'expired@safenex.org',
        aud: 'authenticated',
        exp: Math.floor(Date.now() / 1000) - 120 // expired 2 minutes ago
      },
      TEST_JWT_SECRET
    );

    const result = verifySupabaseJwt(expiredToken, TEST_JWT_SECRET);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'TokenExpired');
  });

  test('3. Tampered payload with invalid signature is strictly rejected', () => {
    const legitimateToken = craftTestJwt(
      {
        sub: 'usr_attacker_fake',
        aud: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600
      },
      'attacker_secret_different_from_server'
    );

    const result = verifySupabaseJwt(legitimateToken, TEST_JWT_SECRET);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'InvalidSignature');
  });

  test('4. Arbitrary strings and long non-JWT headers (>25 chars) are rejected (no length-based bypass)', () => {
    const arbitraryLongString = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 48 chars
    assert.ok(arbitraryLongString.length > 25);

    const result = verifySupabaseJwt(arbitraryLongString, TEST_JWT_SECRET);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'MalformedToken');
  });

  test('5. Non-authenticated audience tokens are rejected', () => {
    const wrongAudToken = craftTestJwt(
      {
        sub: 'usr_anon_probe',
        aud: 'anon_public',
        exp: Math.floor(Date.now() / 1000) + 3600
      },
      TEST_JWT_SECRET
    );

    const result = verifySupabaseJwt(wrongAudToken, TEST_JWT_SECRET);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'InvalidAudience');
  });

  test('6. Server allows unauthenticated emergency AI request but rejects arbitrary route', async () => {
    const server = createServer();
    
    // In-process mock request/response helper (Runs cleanly without OS TCP socket binding)
    const dispatchMockRequest = (
      pathname: string,
      method: string,
      headers: Record<string, string>,
      payload?: any
    ): Promise<{ status: number; body: any; headers: Record<string, string> }> => {
      return new Promise((resolve) => {
        const req: any = new EventEmitter();
        req.url = pathname;
        req.method = method;
        req.headers = { host: 'localhost:5001', ...headers };
        req.socket = { remoteAddress: '127.0.0.1' };

        const res: any = new EventEmitter();
        res.statusCode = 200;
        res.headers = {};
        res.body = '';
        res.writeHead = (status: number, h: Record<string, string>) => {
          res.statusCode = status;
          res.headers = h;
          return res;
        };
        res.end = (chunk?: string) => {
          if (chunk) res.body += chunk;
          let parsedBody = res.body;
          try {
            parsedBody = JSON.parse(res.body);
          } catch {}
          resolve({ status: res.statusCode, body: parsedBody, headers: res.headers });
          return res;
        };

        // Dispatch request to server handler
        server.emit('request', req, res);

        // Feed request body if POST
        if (payload) {
          req.emit('data', Buffer.from(JSON.stringify(payload)));
        }
        req.emit('end');
      });
    };

    // 1. Emergency endpoint without Bearer token must succeed (Unauthenticated Emergency Access)
    const emergencyRes = await dispatchMockRequest(
      '/api/ai/threat-intelligence',
      'POST',
      { 'content-type': 'application/json' },
      { triggerSource: 'BUTTON' }
    );
    assert.strictEqual(emergencyRes.status, 200);
    assert.strictEqual(emergencyRes.body.incidentCategory, 'PHYSICAL_DURESS');

    // 2. Invalid Bearer token must return 401 Unauthorized
    const invalidTokenRes = await dispatchMockRequest(
      '/api/ai/threat-intelligence',
      'POST',
      {
        'content-type': 'application/json',
        'authorization': 'Bearer arbitrary_invalid_token'
      },
      { triggerSource: 'BUTTON' }
    );
    assert.strictEqual(invalidTokenRes.status, 401);
    assert.strictEqual(invalidTokenRes.body.error, 'MalformedToken');

    // 3. Non-emergency path without auth must return 401 Unauthorized
    const nonEmergencyRes = await dispatchMockRequest(
      '/api/ai/admin-settings',
      'POST',
      { 'content-type': 'application/json' }
    );
    assert.strictEqual(nonEmergencyRes.status, 401);
  });
});
