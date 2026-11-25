import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock browser localStorage for Node.js test environment
const mockStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mockStorage.get(k) || null,
  setItem: (k: string, v: string) => mockStorage.set(k, v),
  removeItem: (k: string) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

import { securityManager } from '../src/lib/security.ts';
import { getClientAuthHeaders } from '../src/services/ai/authHelper.ts';

describe('SAFENEX Web - Disarm PIN & Client Security Test Suite', () => {

  beforeEach(() => {
    mockStorage.clear();
  });

  test('1. Default PIN 1234 is rejected when unconfigured (Zero-Default Policy)', async () => {
    // Before any user setup, no PIN is configured
    assert.strictEqual(securityManager.isPinConfigured(), false);
    
    // Verifying '1234' must fail
    const isValid = await securityManager.verifyPin('1234');
    assert.strictEqual(isValid, false, 'Default 1234 PIN must NOT be accepted');
  });

  test('2. User can configure personal 4-digit PIN with salted SHA-256 hash', async () => {
    const setSuccess = await securityManager.setPin('8492');
    assert.strictEqual(setSuccess, true);
    assert.strictEqual(securityManager.isPinConfigured(), true);

    // Raw PIN is NOT stored in localStorage
    assert.strictEqual(mockStorage.get('safenex_auth_pin_hash') !== '8492', true);
    assert.ok(mockStorage.get('safenex_auth_pin_salt'), 'Salt must be stored');

    // Correct PIN verifies
    const match = await securityManager.verifyPin('8492');
    assert.strictEqual(match, true);

    // Incorrect PIN fails
    const mismatch = await securityManager.verifyPin('0000');
    assert.strictEqual(mismatch, false);
  });

  test('3. Five consecutive failed PIN attempts trigger automatic 30s lockout', async () => {
    await securityManager.setPin('7139');

    // Perform 4 wrong attempts
    for (let i = 1; i <= 4; i++) {
      const res = await securityManager.verifyPin('0000');
      assert.strictEqual(res, false);
      assert.strictEqual(securityManager.getLockoutRemainingSeconds(), 0);
    }

    // 5th wrong attempt triggers lockout
    const fifthFail = await securityManager.verifyPin('0000');
    assert.strictEqual(fifthFail, false);
    
    const remainingLockout = securityManager.getLockoutRemainingSeconds();
    assert.ok(remainingLockout > 0 && remainingLockout <= 30, `Must be locked out, got ${remainingLockout}s`);

    // While locked out, even the correct PIN is rejected
    const blockedAttempt = await securityManager.verifyPin('7139');
    assert.strictEqual(blockedAttempt, false, 'Must reject attempts during lockout window');
  });

  test('4. Client auth headers contain NO hardcoded secrets', async () => {
    const headers = await getClientAuthHeaders();
    assert.strictEqual(headers['Content-Type'], 'application/json');
    assert.strictEqual(headers['x-safenex-auth'], undefined, 'Must NOT contain x-safenex-auth');
    assert.strictEqual(headers['x-safenex-backend-secret'], undefined, 'Must NOT contain backend secrets');
  });
});
