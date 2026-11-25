# SAFENEX Android & API Security Guidelines

## 1. Google Maps SDK API Key Restrictions

Google Maps API keys should never be deployed with unrestricted access. To protect your Google Cloud quota and prevent billing abuse:

### Step 1: Restrict Key by Android Application Fingerprint
1. Navigate to **Google Cloud Console** → **APIs & Services** → **Credentials**.
2. Select your Google Maps Android API Key.
3. Under **Set an application restriction**, choose **Android apps**.
4. Click **+ Add package name and fingerprint**:
   - **Package name:** `com.safenex.app`
   - **SHA-1 certificate fingerprint:** Extract using the command below.

### Step 2: Extracting Your SHA-1 Signing Fingerprint
#### Debug Keystore:
```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```
*(On Windows: `%USERPROFILE%\.android\debug.keystore`)*

#### Production Keystore:
```bash
keytool -list -v -keystore /path/to/your/release.keystore -alias your_key_alias
```

### Step 3: Restrict API Permissions
Under **API restrictions**:
- Select **Restrict key**.
- Check only: **Maps SDK for Android** and **Geocoding API**.
- Save changes.

### Step 4: Injecting Key via Local Properties (Zero-Committed-Secrets)
In `local.properties` (which is excluded from Git):
```properties
MAPS_API_KEY=AIzaSyYourRestrictedApiKeyHere
```
Or set the environment variable:
```bash
export MAPS_API_KEY="AIzaSyYourRestrictedApiKeyHere"
```
The SafeNex Gradle build (`app/build.gradle.kts`) automatically injects this value into `AndroidManifest.xml` via `manifestPlaceholders["MAPS_API_KEY"]`.

---

## 2. Comprehensive Secret Rotation Checklist

If any secret or key was previously committed to version control or shared over unencrypted channels:

1. **Google Gemini API Key:**
   - Go to Google AI Studio (`aistudio.google.com`) → **Get API key**.
   - Create a new API key.
   - Update `safenex-backend/.env` with `GEMINI_API_KEY=new_key`.
   - Delete the old API key in Google AI Studio.

2. **Supabase JWT Secret & Service Role Key:**
   - Go to Supabase Dashboard → **Project Settings** → **API**.
   - In **JWT Settings**, click **Generate new secret**.
   - Update `SUPABASE_JWT_SECRET` in `safenex-backend/.env`.
   - Note: Users will be asked to sign in again after JWT secret rotation.

3. **Supabase Anon Key:**
   - If rotating the JWT secret, a new anon public key will be generated.
   - Update `VITE_SUPABASE_ANON_KEY` in `safenex-web/.env`.

4. **Internal Backend Auth Secret (`SAFENEX_BACKEND_SECRET`):**
   - Generate a cryptographically random 64-character hex secret:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - Update `SAFENEX_BACKEND_SECRET` in `safenex-backend/.env`.
   - Ensure clients do NOT have this secret; clients must authenticate via Supabase user JWT.
