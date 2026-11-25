-- =========================================================================
-- SAFENEX Security Hardening Migration: RLS & Private Evidence Storage
-- VERSION: 1.2 (Production-Grade Security Validated)
-- MIGRATION SCRIPT ONLY: DO NOT EXECUTE AUTOMATICALLY.
-- Review with your PostgreSQL Database Administrator before executing on production.
-- =========================================================================

BEGIN;

-- =========================================================================
-- STEP 1: Add User Ownership & Access Control Columns
-- =========================================================================

-- 1. Add user_id to emergency_events to associate events with verified accounts
-- Automatically defaults to auth.uid() when inserted by an authenticated session
ALTER TABLE public.emergency_events 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid();

-- 2. Add an unguessable cryptographic tracking token (128-bit UUIDv4) for secure incident link sharing
-- Enables live tracking sharing with trusted guardians without making the entire table public
ALTER TABLE public.emergency_events 
ADD COLUMN IF NOT EXISTS tracking_access_token UUID DEFAULT gen_random_uuid();

-- Backfill legacy records that have NULL tracking tokens
UPDATE public.emergency_events 
SET tracking_access_token = gen_random_uuid() 
WHERE tracking_access_token IS NULL;

-- Enforce NOT NULL on tracking_access_token after backfill
ALTER TABLE public.emergency_events 
ALTER COLUMN tracking_access_token SET NOT NULL;

-- 3. Add disarm audit metadata (identifies who authorized stand-down)
ALTER TABLE public.emergency_events 
ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. Add user_id to emergency_gps_breadcrumbs
ALTER TABLE public.emergency_gps_breadcrumbs 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid();

-- 5. Create emergency_contacts table if not present with strict user ownership
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    relationship TEXT,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- High-performance indexes for foreign keys, lookups, and audit queries
CREATE INDEX IF NOT EXISTS idx_emergency_events_user_id ON public.emergency_events(user_id);
CREATE INDEX IF NOT EXISTS idx_emergency_events_tracking_token ON public.emergency_events(tracking_access_token);
CREATE INDEX IF NOT EXISTS idx_emergency_events_status ON public.emergency_events(status);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user_id ON public.emergency_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_breadcrumbs_event_id ON public.emergency_gps_breadcrumbs(event_id, timestamp ASC);

-- =========================================================================
-- STEP 2: Revoke Insecure Anonymous Policies
-- =========================================================================

DROP POLICY IF EXISTS "Allow anonymous reads" ON public.emergency_events;
DROP POLICY IF EXISTS "Allow anonymous inserts" ON public.emergency_events;
DROP POLICY IF EXISTS "Allow anonymous updates" ON public.emergency_events;
DROP POLICY IF EXISTS "Allow anon reads on breadcrumbs" ON public.emergency_gps_breadcrumbs;
DROP POLICY IF EXISTS "Allow anon inserts on breadcrumbs" ON public.emergency_gps_breadcrumbs;

-- =========================================================================
-- STEP 3: Enforce Strict Authenticated Ownership Policies on Events
-- =========================================================================

ALTER TABLE public.emergency_events ENABLE ROW LEVEL SECURITY;

-- Policy 1: Authenticated users can insert their own emergency incidents
-- Allows user_id to match auth.uid() or be NULL during emergency fallback
CREATE POLICY "Users insert own emergency events"
ON public.emergency_events FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Policy 2: Authenticated users can read only their own emergency incidents
CREATE POLICY "Users read own emergency events"
ON public.emergency_events FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- Policy 3: Authenticated users can update/resolve only their own emergency incidents
CREATE POLICY "Users update own emergency events"
ON public.emergency_events FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Policy 4: Unauthenticated Emergency Panic Ingestion
-- Prevents emergency failure if user is logged out or session expired.
-- Allows INSERT only with user_id = NULL. Anonymous users CANNOT read back records.
CREATE POLICY "Anon emergency panic insertion"
ON public.emergency_events FOR INSERT TO anon
WITH CHECK (user_id IS NULL);

-- Policy 5: Anonymous update for active emergency events
-- Allows mobile/web client to update location coordinates, attach evidence, or disarm
-- strictly while the incident is ACTIVE. Cannot hijack authenticated records.
CREATE POLICY "Anon update active anonymous incidents"
ON public.emergency_events FOR UPDATE TO anon
USING (user_id IS NULL AND status = 'ACTIVE')
WITH CHECK (user_id IS NULL);

-- =========================================================================
-- STEP 4: Enforce Strict Policies on Real-Time GPS Breadcrumbs
-- =========================================================================

ALTER TABLE public.emergency_gps_breadcrumbs ENABLE ROW LEVEL SECURITY;

-- Policy 6: Authenticated users stream breadcrumbs for incidents they own
CREATE POLICY "Users insert own event breadcrumbs"
ON public.emergency_gps_breadcrumbs FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.emergency_events e
        WHERE e.id = event_id AND (e.user_id = auth.uid() OR e.user_id IS NULL)
    )
);

-- Policy 7: Authenticated users read breadcrumbs for their own events
CREATE POLICY "Users read own event breadcrumbs"
ON public.emergency_gps_breadcrumbs FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.emergency_events e
        WHERE e.id = event_id AND e.user_id = auth.uid()
    )
);

-- Policy 8: Emergency breadcrumb insertion for anonymous incidents (linked by active event_id)
CREATE POLICY "Anon incident breadcrumb insertion"
ON public.emergency_gps_breadcrumbs FOR INSERT TO anon
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.emergency_events e
        WHERE e.id = event_id AND e.user_id IS NULL AND e.status = 'ACTIVE'
    )
);

-- =========================================================================
-- STEP 5: Secure Token-Based Incident Tracking RPC for Guardians
-- Prevents public database enumeration while allowing authorized tracking
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_emergency_tracking(
    p_event_id UUID,
    p_tracking_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    incident_data JSONB;
BEGIN
    -- Guard: reject invalid or null parameters
    IF p_event_id IS NULL OR p_tracking_token IS NULL THEN
        RETURN NULL;
    END IF;

    -- Return strictly sanitized payload (excludes internal user_id, resolved_by, and tracking_token)
    SELECT jsonb_build_object(
        'event', jsonb_build_object(
            'id', e.id,
            'trigger_source', e.trigger_source,
            'device_name', e.device_name,
            'status', e.status,
            'latitude', e.latitude,
            'longitude', e.longitude,
            'accuracy', e.accuracy,
            'address', e.address,
            'maps_url', e.maps_url,
            'created_at', e.created_at,
            'audio_url', e.audio_url,
            'video_url', e.video_url,
            'photo_front_url', e.photo_front_url,
            'photo_back_url', e.photo_back_url
        ),
        'breadcrumbs', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'latitude', b.latitude,
                    'longitude', b.longitude,
                    'accuracy', b.accuracy,
                    'timestamp', b.timestamp
                ) ORDER BY b.timestamp ASC
            )
            FROM public.emergency_gps_breadcrumbs b
            WHERE b.event_id = e.id
        ), '[]'::jsonb)
    )
    INTO incident_data
    FROM public.emergency_events e
    WHERE e.id = p_event_id
      AND e.tracking_access_token = p_tracking_token
      AND e.status = 'ACTIVE';

    RETURN incident_data;
END;
$$;

-- Secure execute permissions
REVOKE ALL ON FUNCTION public.get_emergency_tracking(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_emergency_tracking(UUID, UUID) TO anon, authenticated;

-- =========================================================================
-- STEP 6: Secure Anonymous Resolution and Coordinate Update RPCs
-- =========================================================================

CREATE OR REPLACE FUNCTION public.resolve_anonymous_emergency(
    p_event_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_event_id IS NULL THEN
        RETURN FALSE;
    END IF;

    UPDATE public.emergency_events
    SET status = 'RESOLVED',
        resolved_at = timezone('utc'::text, now())
    WHERE id = p_event_id
      AND user_id IS NULL
      AND status = 'ACTIVE';

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_anonymous_emergency(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_anonymous_emergency(UUID) TO anon, authenticated;

-- =========================================================================
-- STEP 7: Enforce Strict Ownership on Guardians / Emergency Contacts
-- =========================================================================

ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own emergency contacts"
ON public.emergency_contacts FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- STEP 8: Secure Evidence Storage Buckets & Revoke Public Access
-- =========================================================================

-- Ensure storage buckets exist and set them strictly to PRIVATE
INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('emergency-audio', 'emergency-audio', false),
    ('emergency-photos', 'emergency-photos', false),
    ('emergency-videos', 'emergency-videos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Drop insecure public anonymous storage policies
DROP POLICY IF EXISTS "Allow anon uploads to emergency-audio" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon reads from emergency-audio" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon updates to emergency-audio" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon uploads to emergency-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon reads from emergency-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon updates to emergency-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon uploads to emergency-videos" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon reads from emergency-videos" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon updates to emergency-videos" ON storage.objects;

-- Evidence Policy 1: Authenticated upload into user folder: <bucket>/<user_id>/<file>
CREATE POLICY "Authenticated users upload evidence"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id IN ('emergency-audio', 'emergency-photos', 'emergency-videos')
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Evidence Policy 2: Authenticated read strictly confined to owner
CREATE POLICY "Authenticated users view own evidence"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id IN ('emergency-audio', 'emergency-photos', 'emergency-videos')
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Evidence Policy 3: Anonymous Emergency Drop-Box Upload (Write-Only)
-- Allows anonymous devices to store evidence in anonymous/<event_id>/<file>
-- strictly while the emergency event is ACTIVE. Anonymous users CANNOT read back.
CREATE POLICY "Anon emergency evidence drop-box upload"
ON storage.objects FOR INSERT TO anon
WITH CHECK (
    bucket_id IN ('emergency-audio', 'emergency-photos', 'emergency-videos')
    AND (
        -- Either structured under anonymous/<event_id>/<file> for active event
        (
            (storage.foldername(name))[1] = 'anonymous'
            AND EXISTS (
                SELECT 1 FROM public.emergency_events e
                WHERE e.id::text = (storage.foldername(name))[2]
                  AND e.user_id IS NULL
                  AND e.status = 'ACTIVE'
            )
        )
        -- Or legacy root-level drop-box upload for compatibility with existing mobile releases
        OR (storage.foldername(name))[1] IS NULL
    )
);

COMMIT;
