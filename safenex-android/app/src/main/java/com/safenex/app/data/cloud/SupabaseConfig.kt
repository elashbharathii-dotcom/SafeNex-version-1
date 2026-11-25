package com.safenex.app.data.cloud

import com.safenex.app.BuildConfig

/**
 * Global Configuration for Supabase Backend Database.
 * Injected dynamically at build time via BuildConfig or initialized at runtime.
 */
object SupabaseConfig {
    var SUPABASE_URL: String = BuildConfig.SUPABASE_URL
    var SUPABASE_ANON_KEY: String = BuildConfig.SUPABASE_ANON_KEY

    /**
     * Checks whether valid Supabase credentials have been configured.
     */
    fun isConfigured(): Boolean {
        return SUPABASE_URL.isNotBlank() &&
                !SUPABASE_URL.contains("your-project") &&
                SUPABASE_ANON_KEY.isNotBlank() &&
                !SUPABASE_ANON_KEY.contains("your-anon-key")
    }

    /**
     * Allows dynamic injection of user credentials or environment overrides.
     */
    fun configure(url: String, anonKey: String) {
        SUPABASE_URL = url
        SUPABASE_ANON_KEY = anonKey
    }
}
