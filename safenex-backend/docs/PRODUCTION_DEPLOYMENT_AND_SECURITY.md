# SAFENEX — Production Deployment, Security Hardening & Secret Rotation Guide
**Document Version:** 1.0.0  
**Phase:** Phase 7 Final Production Audit & Deployment Preparation  
**Author:** SafeNex Security Engineering & AI Architecture  

---

## 1. Credential Security Matrix

The following table forensically classifies every credential, secret, and API key present in the SafeNex ecosystem.

| Credential Identifier | Scope & Service | Previous State & Exposure | Classification | Rotation Action Required |
| :--- | :--- | :--- | :--- | :--- |
| **`VITE_SUPABASE_URL`** | Web Client (`.env`, `constants.ts`) | Committed in legacy commits (`index.emergency.html`, `.env.example`). | **Public by design** | None required (unless entire Supabase project is destroyed/rebuilt). |
| **`VITE_SUPABASE_ANON_KEY`** | Web & Android Clients (`.env`, `SupabaseConfig.kt`) | Hardcoded in Kotlin and committed in legacy git history. | **Public by design** (PostgREST anon key) | **Requires Rotation** (Re-generate in Supabase Dashboard after rotating `SUPABASE_JWT_SECRET` to invalidate old key). |
| **`SUPABASE_JWT_SECRET`** | Backend AI Core (`safenex-backend/.env`) | Private project secret in Supabase dashboard. | **Private but not exposed** | **Requires Configuration** in backend `.env`. Recommended to rotate if legacy project was shared. |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Supabase Management (Database Admin) | Never committed in repository; never present in frontend or mobile. | **Private & Prohibited on Clients** | Verify in Supabase Dashboard that it is kept strictly confidential and never placed in `.env` files. |
| **`SAFENEX_AUTH_SECRET`** | Pre-shared internal secret (Legacy) | Previously bundled in frontend `VITE_` variables and Kotlin `SafeNexAiCore.kt`. | **Private & Compromised** | **Requires Rotation / Deprecation**. Client dependency has been completely replaced with dynamic Supabase JWT authorization. |
| **`GEMINI_API_KEY`** | Google AI Studio (`safenex-backend/.env`) | Never hardcoded in production; provided via template. | **Private & Unconfigured** | **Requires Configuration** in `safenex-backend/.env`. Must NEVER be prefixed with `VITE_` or exposed to clients. |
| **`GOOGLE_MAPS_API_KEY`** | Android Manifest & Web Maps | Hardcoded in `AndroidManifest.xml` and `index.emergency.html`. | **Public by design** (Client-side Maps SDK) | **Requires Application Restrictions** in Google Cloud Console (Package Name + SHA-1 certificate fingerprint for Android; HTTP Referrer for Web). |
| **`USER_SECURITY_PIN`** | Client Disarm PIN (`security.ts`) | Previously used hardcoded fallback PIN `1234`. | **Private User Credential** | **Remediated**. Zero-default policy enforced. All PINs salted and hashed with SHA-256; 5 failed attempts trigger 30s lockout. |

---

## 2. Ordered Manual Credential Rotation Runbook

> [!CAUTION]
> **DO NOT ROTATE CREDENTIALS AUTOMATICALLY.** Credential rotation must be executed manually by a designated system administrator during a scheduled maintenance window. Follow the exact sequence below to prevent service outages.

### Step 1: Restrict Google Maps API Key
1. Open [Google Cloud Console](https://console.cloud.google.com/) -> **APIs & Services** -> **Credentials**.
2. Locate the Maps API Key (`AIzaSy...`).
3. Under **Application restrictions**:
   - For Android: Select **Android apps**, add package name `com.safenex.app`, and enter your release keystore SHA-1 fingerprint (`keytool -list -v -keystore release.keystore`).
   - For Web: Create a separate key, select **Websites**, and add your production domain (`https://*.safenex.app/*`).
4. Under **API restrictions**: Restrict to **Maps SDK for Android** and **Maps JavaScript API**.
5. Save changes. Existing deployments will continue functioning under restricted domain/package rules.

### Step 2: Prepare Backend Environment Variables
1. On your production backend server hosting `safenex-backend`:
   ```bash
   cp .env.example .env
   chmod 600 .env
   ```
2. Generate a fresh, high-entropy 64-character hex secret for `SAFENEX_BACKEND_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Insert your production **Google Gemini API Key** into `GEMINI_API_KEY`.
4. Leave `SUPABASE_JWT_SECRET` ready for Step 3.

### Step 3: Rotate Supabase JWT Secret & Anon Key
1. In the [Supabase Dashboard](https://supabase.com/dashboard):
   - Navigate to **Project Settings** -> **API**.
   - Under **JWT Settings**, click **Generate new secret**.
   - Confirm rotation.
   > [!WARNING]
   > Rotating the JWT Secret immediately invalidates all active user sessions and regenerates the `anon` public key.
2. Copy the newly generated **JWT Secret** into `safenex-backend/.env` under `SUPABASE_JWT_SECRET`.
3. Copy the newly generated **anon key** into:
   - `safenex-web/.env` under `VITE_SUPABASE_ANON_KEY`.
   - Android build configuration (`local.properties` or CI/CD environment variable `SUPABASE_ANON_KEY`).

### Step 4: Restart Backend Services
1. Restart the `safenex-backend` Node.js process:
   ```bash
   pm2 restart safenex-backend || systemctl restart safenex-backend
   ```
2. Verify backend health and JWT signature validation:
   ```bash
   curl -i http://localhost:5001/health
   ```
   Ensure `jwtValidator` returns `200 OK` for newly minted Supabase tokens.

### Step 5: Rebuild & Deploy Web Client
1. Rebuild the frontend bundle with the updated `VITE_SUPABASE_ANON_KEY`:
   ```bash
   cd safenex-web
   npm run build
   ```
2. Deploy the `dist/` directory to your production HTTPS host (e.g. Cloudflare Pages, Netlify, Nginx).
3. Clear browser CDN cache to force clients to receive the updated bundle.

### Step 6: Rebuild & Publish Android Release
1. Build the release APK/AAB with updated build properties:
   ```bash
   cd safenex-android
   ./gradlew assembleRelease -PSUPABASE_URL="https://your-project.supabase.co" -PSUPABASE_ANON_KEY="new-anon-key" -PMAPS_API_KEY="restricted-maps-key"
   ```
2. Sign with your production release keystore and distribute via Google Play / Internal Track.

---

## 3. Production Deployment Architecture & Checklist

```
+-----------------------------------------------------------------------------------+
|                                 USER CLIENTS                                      |
|                                                                                   |
|  +----------------------------+             +----------------------------------+  |
|  |     SafeNex Web Client     |             |    SafeNex Android Mobile App    |  |
|  |     (React, TypeScript)    |             |     (Kotlin, Jetpack Compose)    |  |
|  +--------------+-------------+             +-----------------+----------------+  |
+-----------------|---------------------------------------------|-------------------+
                  |                                             |
                  | 1. Emergency Dispatch & GPS Breadcrumbs     | 1. Direct PostgREST
                  |    (Direct PostgREST with RLS)              |    & Breadcrumbs
                  |                                             |
                  v                                             v
+-----------------------------------------------------------------------------------+
|                        SUPABASE MANAGED CLOUD INFRASTRUCTURE                      |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | PostgreSQL Database (Row Level Security Active)                             |  |
|  | - emergency_events (user_id = auth.uid(), anon emergency panic ingestion)  |  |
|  | - emergency_gps_breadcrumbs (streaming coordinate breadcrumbs)              |  |
|  | - emergency_contacts (strict user-only CRUD)                                |  |
|  | - get_emergency_tracking() (SECURITY DEFINER, search_path = public, pg_temp)|  |
|  +-----------------------------------------------------------------------------+  |
|  | Private Storage Buckets (public: false)                                     |  |
|  | - emergency-audio, emergency-photos, emergency-videos                       |  |
|  | - Write-only drop-box for active emergencies; 24h signed URLs for playback  |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                  ^
                  | 2. Verified JWT Bearer Token (Dynamic)
                  |
+-----------------|-----------------------------------------------------------------+
|                 v                                                                 |
|  +-----------------------------------------------------------------------------+  |
|  | SAFENEX AI CORE MICROSERVICE (Node.js v24, TypeScript)                      |  |
|  | - Cryptographic Supabase JWT Signature Validator (HMAC-SHA256)             |  |
|  | - Origin-Checked CORS Whitelist                                             |  |
|  | - Unauthenticated Emergency Rate Limiting (20 req/min per IP)                |  |
|  | - ThreatIntelligenceService                                                 |  |
|  | - IncidentAssessmentService                                                 |  |
|  | - EmergencyMessageService                                                   |  |
|  | - IncidentSummaryService                                                     |  |
|  | - DITTUAIService                                                            |  |
|  +---------------------------------------+-------------------------------------+  |
+------------------------------------------|----------------------------------------+
                                           |
                                           | 3. Private Backend-Only API Calls
                                           v
                         +-----------------------------------+
                         |   GOOGLE GEMINI 2.5 FLASH API     |
                         |   (API Key strictly isolated)     |
                         +-----------------------------------+
```

### Pre-Deployment Verification Checklist

- [ ] **Database Migration:** Review `safenex-backend/migrations/001_secure_rls_and_storage.sql` with the DBA. Apply via Supabase SQL Editor.
- [ ] **Table Policies:** Verify that `emergency_events`, `emergency_gps_breadcrumbs`, and `emergency_contacts` show `RLS ENABLED` in Supabase Table Editor.
- [ ] **Storage Buckets:** Confirm `emergency-audio`, `emergency-photos`, and `emergency-videos` are set to `Public: OFF`.
- [ ] **Backend Environment:** Verify `PORT`, `HOST=0.0.0.0`, `NODE_ENV=production`, `GEMINI_API_KEY`, `SUPABASE_JWT_SECRET`, and `CORS_ALLOWED_ORIGINS` are set.
- [ ] **Reverse Proxy / HTTPS:** Configure Nginx or Caddy with valid SSL/TLS certificates and TLS 1.3 for both backend and web endpoints.
- [ ] **Health Endpoint:** Verify `curl -I https://api.your-safenex-domain.com/health` returns `200 OK`.
- [ ] **Emergency SOS Latency:** Verify that calling `/api/ai/threat-assess` or triggering SOS client-side immediately yields local activation without waiting for external network or AI responses.
