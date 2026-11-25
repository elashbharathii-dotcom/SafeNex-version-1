import { supabase } from '../lib/supabaseClient';
import { 
  TABLE_EMERGENCY_EVENTS, 
  TABLE_GPS_BREADCRUMBS,
  STORAGE_BUCKET_VIDEOS,
  STORAGE_BUCKET_AUDIO 
} from '../lib/constants';
import { EmergencyEvent, SupabaseHealth, LocationState, UserProfile, Guardian } from '../types';

export const supabaseService = {
  /**
   * Pings the live Supabase PostgreSQL backend and measures real round-trip network latency.
   */
  async checkHealth(): Promise<SupabaseHealth> {
    const startTime = performance.now();
    try {
      const { error } = await supabase
        .from(TABLE_EMERGENCY_EVENTS)
        .select('id')
        .limit(1);

      const latencyMs = Math.round(performance.now() - startTime);

      if (!error) {
        return {
          status: 'online',
          latencyMs,
          lastChecked: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };
      } else {
        console.warn('Supabase ping returned error:', error.message);
        return {
          status: 'offline',
          latencyMs,
          lastChecked: new Date().toLocaleTimeString(),
        };
      }
    } catch (e) {
      console.warn('Supabase health check connection error:', e);
      return {
        status: 'offline',
        latencyMs: 0,
        lastChecked: new Date().toLocaleTimeString(),
      };
    }
  },

  /**
   * Dispatches a real emergency incident event to the PostgreSQL `emergency_events` table.
   * Securely attaches user_id if authenticated and retrieves tracking_access_token.
   */
  async createEmergencyEvent(
    source: string, 
    loc: LocationState, 
    deviceName = 'SAFENEX Web Client',
    guardiansCount = 0
  ): Promise<string> {
    const mapsUrl = (loc.latitude && loc.longitude) 
      ? `https://maps.google.com/?q=${loc.latitude},${loc.longitude}` 
      : null;

    // Detect authenticated session if available
    let userId: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      userId = session?.user?.id || null;
    } catch {
      userId = null;
    }

    const record: any = {
      device_name: deviceName,
      trigger_source: source,
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy,
      address: loc.address || (loc.latitude ? `Lat ${loc.latitude.toFixed(5)}, Lng ${loc.longitude?.toFixed(5)}` : 'Position Pending'),
      maps_url: mapsUrl,
      status: 'ACTIVE',
      guardians_notified: guardiansCount,
    };

    if (userId) {
      record.user_id = userId;
    }

    try {
      const { data, error } = await supabase
        .from(TABLE_EMERGENCY_EVENTS)
        .insert([record])
        .select('id, tracking_access_token')
        .single();

      if (!error && data?.id) {
        if (data.tracking_access_token) {
          localStorage.setItem('safenex_active_tracking_token', data.tracking_access_token);
        }
        return data.id;
      }
      if (error) {
        console.warn('Supabase event insertion error:', error.message);
      }
    } catch (e) {
      console.warn('Supabase offline or unreachable:', e);
    }

    // Fallback: Generate real client UUID and cache locally if offline
    const fallbackId = crypto.randomUUID();
    const cachedEvents = JSON.parse(localStorage.getItem('safenex_cached_events') || '[]');
    cachedEvents.unshift({
      id: fallbackId,
      created_at: new Date().toISOString(),
      ...record,
      resolved_at: null,
      audio_url: null,
      video_url: null,
      photo_front_url: null,
      photo_back_url: null,
    });
    localStorage.setItem('safenex_cached_events', JSON.stringify(cachedEvents));
    return fallbackId;
  },

  /**
   * Continuously streams high-accuracy GPS breadcrumbs into `emergency_gps_breadcrumbs`.
   */
  async streamBreadcrumb(eventId: string, loc: LocationState): Promise<void> {
    if (!loc.latitude || !loc.longitude) return;

    try {
      const { error } = await supabase
        .from(TABLE_GPS_BREADCRUMBS)
        .insert([
          {
            event_id: eventId,
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: loc.accuracy || 5,
          }
        ]);

      if (error) {
        console.warn('Breadcrumb insertion error:', error.message);
      }
    } catch (e) {
      console.warn('Failed streaming breadcrumb to cloud:', e);
    }
  },

  /**
   * Updates an emergency event status to 'RESOLVED' once the cryptographic PIN is verified.
   * Supports both authenticated update and anonymous RPC fallback.
   */
  async resolveEmergencyEvent(eventId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from(TABLE_EMERGENCY_EVENTS)
        .update({
          status: 'RESOLVED',
          resolved_at: new Date().toISOString(),
        })
        .eq('id', eventId);

      if (error) {
        console.warn('Cloud update returned error, attempting anonymous RPC resolution:', error.message);
        const { error: rpcErr } = await supabase.rpc('resolve_anonymous_emergency', {
          p_event_id: eventId,
        });
        if (rpcErr) {
          console.warn('RPC resolution fallback error:', rpcErr.message);
        }
      }
    } catch (e) {
      console.warn('Offline resolution error:', e);
    }

    // Also update local cache
    const cachedEvents = JSON.parse(localStorage.getItem('safenex_cached_events') || '[]');
    const updated = cachedEvents.map((ev: any) =>
      ev.id === eventId ? { ...ev, status: 'RESOLVED', resolved_at: new Date().toISOString() } : ev
    );
    localStorage.setItem('safenex_cached_events', JSON.stringify(updated));
    localStorage.removeItem('safenex_active_tracking_token');
  },

  /**
   * Uploads real audio or video evidence to Supabase Storage and attaches secure URL to the event.
   * Conforms to hardened RLS user-folder layout and private bucket signed URL access.
   */
  async uploadEvidence(
    eventId: string, 
    blob: Blob, 
    fileName: string, 
    type: 'video' | 'audio' = 'video'
  ): Promise<string | null> {
    const bucket = type === 'video' ? STORAGE_BUCKET_VIDEOS : STORAGE_BUCKET_AUDIO;
    const contentType = type === 'video' ? 'video/webm' : 'audio/webm';

    try {
      // Determine folder path compliant with hardened Storage RLS
      let folder = `anonymous/${eventId}`;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          folder = session.user.id;
        }
      } catch {
        folder = `anonymous/${eventId}`;
      }

      const storagePath = `${folder}/${fileName}`;

      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(storagePath, blob, {
          contentType,
          upsert: true,
        });

      if (!error && data?.path) {
        // Generate signed URL valid for 24 hours (86,400s) for private bucket access
        const { data: signedData } = await supabase.storage
          .from(bucket)
          .createSignedUrl(storagePath, 86400);

        const secureEvidenceUrl = signedData?.signedUrl || '';

        // Attach evidence URL to the emergency event record in Supabase
        const updateField = type === 'video' ? { video_url: secureEvidenceUrl } : { audio_url: secureEvidenceUrl };
        await supabase
          .from(TABLE_EMERGENCY_EVENTS)
          .update(updateField)
          .eq('id', eventId);

        return secureEvidenceUrl;
      } else if (error) {
        console.warn(`Supabase Storage upload to ${bucket} error:`, error.message);
      }
    } catch (e) {
      console.warn('Evidence upload failed:', e);
    }
    return null;
  },

  /**
   * Fetches real incident history from Supabase `emergency_events` table.
   * If database table is empty, returns an empty array. No fake demo data!
   */
  async fetchIncidents(): Promise<EmergencyEvent[]> {
    try {
      const { data, error } = await supabase
        .from(TABLE_EMERGENCY_EVENTS)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(25);

      if (!error && Array.isArray(data)) {
        return data as EmergencyEvent[];
      }
      if (error) {
        console.warn('Error fetching cloud incidents:', error.message);
      }
    } catch (e) {
      console.warn('Could not query Supabase incidents:', e);
    }

    // Fallback to locally cached incidents if cloud is offline
    const local = JSON.parse(localStorage.getItem('safenex_cached_events') || '[]');
    return local;
  },

  /**
   * Secure Guardian Tracking RPC
   * Queries real-time incident data using unguessable 128-bit tracking token
   */
  async fetchEmergencyTracking(eventId: string, token: string): Promise<any | null> {
    try {
      const { data, error } = await supabase.rpc('get_emergency_tracking', {
        p_event_id: eventId,
        p_tracking_token: token,
      });

      if (!error && data) {
        return data;
      }
      if (error) {
        console.warn('Emergency tracking RPC error:', error.message);
      }
    } catch (e) {
      console.warn('Tracking RPC network failure:', e);
    }
    return null;
  },

  /**
   * Cloud Emergency Contacts (Guardians) Management with RLS & Offline Local Storage Fallback
   */
  async fetchEmergencyContacts(): Promise<Guardian[]> {
    try {
      const { data, error } = await supabase
        .from('emergency_contacts')
        .select('*')
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        return data.map((c: any) => ({
          id: c.id,
          name: c.name,
          phone: c.phone_number,
          relation: c.relationship || 'Emergency Contact',
          isPrimary: c.is_primary || false,
        }));
      }
    } catch (e) {
      console.warn('Error fetching cloud contacts:', e);
    }
    return JSON.parse(localStorage.getItem('safenex_real_guardians_v2') || '[]');
  },

  async addEmergencyContact(guardian: Omit<Guardian, 'id'>): Promise<Guardian | null> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;

      const { data, error } = await supabase
        .from('emergency_contacts')
        .insert([{
          user_id: session.user.id,
          name: guardian.name,
          phone_number: guardian.phone,
          relationship: guardian.relation,
          is_primary: guardian.isPrimary || false,
        }])
        .select('*')
        .single();

      if (!error && data) {
        return {
          id: data.id,
          name: data.name,
          phone: data.phone_number,
          relation: data.relationship || 'Emergency Contact',
          isPrimary: data.is_primary || false,
        };
      }
    } catch (e) {
      console.warn('Cloud contact insertion error:', e);
    }
    return null;
  },

  async deleteEmergencyContact(contactId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('emergency_contacts')
        .delete()
        .eq('id', contactId);
      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Supabase Authentication Integration
   */
  async getCurrentUser(): Promise<UserProfile | null> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;

      const user = session.user;
      return {
        id: user.id,
        email: user.email || '',
        name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Authenticated User',
        phone: user.phone || user.user_metadata?.phone || '',
        bloodGroup: user.user_metadata?.blood_group || '',
        allergies: user.user_metadata?.allergies || '',
        medicalNotes: user.user_metadata?.medical_notes || '',
        emergencyInstructions: user.user_metadata?.emergency_instructions || '',
        isAnonymous: false,
      };
    } catch (e) {
      console.warn('Auth getSession error:', e);
      return null;
    }
  },

  async signUp(email: string, pass: string, fullName: string): Promise<{ error: string | null }> {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password: pass,
        options: {
          data: {
            full_name: fullName,
          }
        }
      });
      return { error: error ? error.message : null };
    } catch (e: any) {
      return { error: e.message || 'Registration failed' };
    }
  },

  async signIn(email: string, pass: string): Promise<{ error: string | null }> {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: pass,
      });
      return { error: error ? error.message : null };
    } catch (e: any) {
      return { error: e.message || 'Login failed' };
    }
  },

  async signOut(): Promise<void> {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Sign out error:', e);
    }
  },

  async updateUserMetadata(meta: Partial<UserProfile>): Promise<boolean> {
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: meta.name,
          phone: meta.phone,
          blood_group: meta.bloodGroup,
          allergies: meta.allergies,
          medical_notes: meta.medicalNotes,
          emergency_instructions: meta.emergencyInstructions,
        }
      });
      return !error;
    } catch (e) {
      console.warn('Update user metadata error:', e);
      return false;
    }
  }
};
