export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL || "";

export const SUPABASE_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const STORAGE_BUCKET_AUDIO = "emergency-audio";
export const STORAGE_BUCKET_PHOTOS = "emergency-photos";
export const STORAGE_BUCKET_VIDEOS = "emergency-videos";

export const APP_PUBLIC_URL: string =
  import.meta.env.VITE_APP_PUBLIC_URL || (typeof window !== 'undefined' ? window.location.origin : "");

// Web Bluetooth ESP32 Service and Characteristics
export const BLE_SERVICE_UUID = "7b7a1000-8f2a-4c5e-9b11-123456789001";
export const BLE_SOS_CHAR_UUID = "7b7a1001-8f2a-4c5e-9b11-123456789001";
export const BLE_STATUS_CHAR_UUID = "7b7a1002-8f2a-4c5e-9b11-123456789001";

// Database Tables
export const TABLE_EMERGENCY_EVENTS = "emergency_events";
export const TABLE_GPS_BREADCRUMBS = "emergency_gps_breadcrumbs";
