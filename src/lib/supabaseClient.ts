import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Read Vite client / Node environment variables safely
const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
const supabaseUrl = metaEnv?.VITE_SUPABASE_URL || process.env?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = metaEnv?.VITE_SUPABASE_ANON_KEY || process.env?.VITE_SUPABASE_ANON_KEY || '';

// Detect if configured with a real non-placeholder project URL
export const isSupabaseConfigured = (): boolean => {
  if (!supabaseUrl || !supabaseAnonKey) return false;
  if (supabaseUrl.includes('your-project-ref') || supabaseAnonKey.includes('your-anon-key')) return false;
  try {
    const parsed = new URL(supabaseUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

let clientInstance: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient | null => {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!clientInstance) {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
  }

  return clientInstance;
};

/**
 * Creates a Supabase client using provided Cloudflare Worker environment bindings.
 * This is used for server-side operations where process.env is not available.
 */
export const getSupabaseClientFromEnv = (env: any): SupabaseClient | null => {
  const url = env?.SUPABASE_URL || supabaseUrl;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_ANON_KEY || supabaseAnonKey;

  if (!url || !key || url.includes('your-project-ref')) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
};

export const getSupabaseStatus = (): {
  configured: boolean;
  url: string;
  authReady: boolean;
  realtimeReady: boolean;
} => {
  const configured = isSupabaseConfigured();
  return {
    configured,
    url: configured ? supabaseUrl : 'Not Connected (Staged for Phase 2)',
    authReady: configured,
    realtimeReady: configured,
  };
};
