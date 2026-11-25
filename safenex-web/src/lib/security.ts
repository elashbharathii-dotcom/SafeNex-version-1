/**
 * Cryptographic PIN Security Manager matching SafeNex Android SecurityManager architecture.
 * Uses Web Crypto API with SHA-256 + 16-byte random salt + constant-time comparison.
 * The raw PIN is NEVER stored in plain text.
 */

const STORAGE_KEY_PIN_HASH = 'safenex_auth_pin_hash';
const STORAGE_KEY_PIN_SALT = 'safenex_auth_pin_salt';
const STORAGE_KEY_FAILED_ATTEMPTS = 'safenex_pin_failed_attempts';
const STORAGE_KEY_LOCKOUT_UNTIL = 'safenex_pin_lockout_until';
const MAX_CONSECUTIVE_FAILURES = 5;
const LOCKOUT_DURATION_MS = 30 * 1000; // 30-second lockout after 5 failed attempts

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function computeSaltedHash(pin: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const pinBytes = new TextEncoder().encode(pin);
  const combined = new Uint8Array(salt.length + pinBytes.length);
  combined.set(salt, 0);
  combined.set(pinBytes, salt.length);
  return await crypto.subtle.digest('SHA-256', combined);
}

function constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export const securityManager = {
  /**
   * Safe no-op maintained for backward-compatibility.
   * NEVER seeds universal default PINs (e.g. '1234').
   */
  async initDefaultPinIfUnset(): Promise<void> {
    // Zero-default policy: Users explicitly set their personal PIN during onboarding/settings.
  },

  /**
   * Returns remaining lockout seconds if client is currently locked out from too many failed attempts.
   */
  getLockoutRemainingSeconds(): number {
    try {
      const lockoutUntilStr = localStorage.getItem(STORAGE_KEY_LOCKOUT_UNTIL);
      if (!lockoutUntilStr) return 0;
      const lockoutUntil = parseInt(lockoutUntilStr, 10);
      const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (remaining > 0) return remaining;
      // Lockout expired: clean up
      localStorage.removeItem(STORAGE_KEY_LOCKOUT_UNTIL);
      localStorage.removeItem(STORAGE_KEY_FAILED_ATTEMPTS);
      return 0;
    } catch {
      return 0;
    }
  },

  /**
   * Returns current count of consecutive failed attempts.
   */
  getFailedAttemptsCount(): number {
    try {
      return parseInt(localStorage.getItem(STORAGE_KEY_FAILED_ATTEMPTS) || '0', 10);
    } catch {
      return 0;
    }
  },

  /**
   * Securely verifies candidate disarm PIN against stored salted hash.
   * Enforces constant-time comparison and 30-second lockout after 5 consecutive failures.
   */
  async verifyPin(candidatePin: string): Promise<boolean> {
    try {
      // 1. Enforce Lockout Check
      const remainingLockout = this.getLockoutRemainingSeconds();
      if (remainingLockout > 0) {
        console.warn(`PIN verification locked out. Retry in ${remainingLockout} seconds.`);
        return false;
      }

      // 2. Load stored salted hash
      const storedHashB64 = localStorage.getItem(STORAGE_KEY_PIN_HASH);
      const storedSaltB64 = localStorage.getItem(STORAGE_KEY_PIN_SALT);

      if (!storedHashB64 || !storedSaltB64) {
        // Zero-default: If no PIN is configured, candidate PIN cannot match.
        console.warn('Disarm PIN has not been configured by the user.');
        return false;
      }

      const salt = base64ToBuffer(storedSaltB64);
      const expectedHash = base64ToBuffer(storedHashB64);
      const candidateHashBuf = await computeSaltedHash(candidatePin, salt);
      const candidateHash = new Uint8Array(candidateHashBuf);

      const isMatch = constantTimeCompare(expectedHash, candidateHash);

      if (isMatch) {
        // Successful verification resets failed counter
        localStorage.removeItem(STORAGE_KEY_FAILED_ATTEMPTS);
        localStorage.removeItem(STORAGE_KEY_LOCKOUT_UNTIL);
        return true;
      } else {
        // Record failed attempt
        const failed = this.getFailedAttemptsCount() + 1;
        localStorage.setItem(STORAGE_KEY_FAILED_ATTEMPTS, failed.toString());

        if (failed >= MAX_CONSECUTIVE_FAILURES) {
          const lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
          localStorage.setItem(STORAGE_KEY_LOCKOUT_UNTIL, lockoutUntil.toString());
          console.warn(`Maximum PIN attempts reached. Locked out for ${LOCKOUT_DURATION_MS / 1000}s.`);
        }
        return false;
      }
    } catch (e) {
      console.warn('PIN verification cryptographic failure:', e);
      return false;
    }
  },

  async setPin(newPin: string): Promise<boolean> {
    try {
      if (!newPin || newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
        return false;
      }
      const salt = new Uint8Array(16);
      crypto.getRandomValues(salt);

      const hashBuf = await computeSaltedHash(newPin, salt);
      const hashB64 = bufferToBase64(hashBuf);
      const saltB64 = bufferToBase64(salt);

      localStorage.setItem(STORAGE_KEY_PIN_HASH, hashB64);
      localStorage.setItem(STORAGE_KEY_PIN_SALT, saltB64);
      // Reset any lockout state upon successful PIN change
      localStorage.removeItem(STORAGE_KEY_FAILED_ATTEMPTS);
      localStorage.removeItem(STORAGE_KEY_LOCKOUT_UNTIL);
      return true;
    } catch (e) {
      console.warn('Error setting cryptographic PIN:', e);
      return false;
    }
  },

  isPinConfigured(): boolean {
    return !!localStorage.getItem(STORAGE_KEY_PIN_HASH);
  }
};

