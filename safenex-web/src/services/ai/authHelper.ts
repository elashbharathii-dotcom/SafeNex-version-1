/**
 * Client Authorization Header Helper for SafeNex AI Services
 * 
 * Cryptographic & Architectural Guarantees:
 * - NEVER contains or hardcodes any shared backend secret.
 * - Dynamically retrieves the authenticated user's Supabase JWT access token.
 * - Degrades gracefully when unauthenticated or offline so SOS activations are NEVER blocked.
 */

export async function getClientAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    if (typeof window !== 'undefined') {
      const { supabase } = await import('../../lib/supabaseClient');
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) {
        headers['Authorization'] = `Bearer ${data.session.access_token}`;
      }
    }
  } catch {
    // If Supabase session lookup is unavailable or offline, proceed without Bearer token.
    // The backend emergency endpoint will allow unauthenticated emergency activation via
    // restricted emergency sessions.
  }

  return headers;
}
