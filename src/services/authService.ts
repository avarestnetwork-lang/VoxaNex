import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { UserProfile, AppLanguage } from '../types';

export interface AuthResponse {
  success: boolean;
  user?: UserProfile;
  error?: string;
  requiresEmailConfirmation?: boolean;
  message?: string;
  profileConfirmed?: boolean;
}

function sanitizeAuthError(rawError: any): string {
  if (!rawError) return 'An unexpected authentication error occurred. Please try again.';
  
  let msg = '';
  if (typeof rawError === 'string') {
    msg = rawError;
  } else if (typeof rawError === 'object' && rawError !== null) {
    if (typeof rawError.message === 'string') {
      msg = rawError.message;
    } else if (typeof rawError.error === 'string') {
      msg = rawError.error;
    } else if (typeof rawError.toString === 'function') {
      msg = rawError.toString();
    }
  }

  if (msg.includes('User already registered') || msg.includes('already exists')) {
    return 'An account with this email address already exists. Please sign in instead.';
  }
  if (msg.includes('Invalid login credentials')) {
    return 'Invalid email or password. Please try again.';
  }
  if (msg.includes('Password should be at least')) {
    return 'Password must be at least 6 characters long.';
  }
  if (msg.includes('Email not confirmed')) {
    return 'Email confirmation is required. Please check your inbox.';
  }
  if (msg.includes('Too many requests') || msg.includes('rate limit')) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  
  // All unknown provider, SQL, PostgREST internal messages, relation/column errors, stack traces, or non-string values
  return 'An unexpected authentication error occurred. Please try again.';
}

export const authService = {
  /**
   * Register a new user with Supabase Auth.
   * Profile record initialization is handled authoritatively and idempotently
   * by the PostgreSQL database trigger (handle_new_user_profile) on auth.users.
   */
  async register(
    email: string,
    password: string,
    nickname: string,
    gender: string = 'prefer_not_to_say',
    languagePref: AppLanguage = 'en'
  ): Promise<AuthResponse> {
    const supabase = getSupabaseClient();
    const sanitizedNick = nickname.trim().slice(0, 32) || email.split('@')[0] || 'User';

    if (!supabase) {
      // Offline / Local Simulation Mode fallback
      const simulatedUser: UserProfile = {
        id: `usr_${Date.now()}`,
        email,
        nickname: sanitizedNick,
        gender: gender as any,
        isGuest: false,
        is18Verified: false,
        verificationMethod: 'pending',
        avatar: '🛡️',
        languagePreference: languagePref,
        safeFilterEnabled: true,
        notificationSounds: true,
        createdAt: new Date().toISOString(),
      };
      // Simulation mode must never claim database profile confirmation
      return { success: true, user: simulatedUser, profileConfirmed: false };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            nickname: sanitizedNick,
            avatar_url: '🛡️',
            gender,
          },
        },
      });

      if (error) {
        return { success: false, error: sanitizeAuthError(error) };
      }

      if (!data.user) {
        return { success: false, error: 'Registration failed: No user returned.' };
      }

      // If email confirmation is required, data.session is null/undefined.
      // The user record and database trigger profile have been created.
      if (!data.session) {
        return {
          success: true,
          requiresEmailConfirmation: true,
          message: 'Registration successful! Please check your email to confirm your account before logging in.',
          profileConfirmed: false,
        };
      }

      // Fetch actual database record strictly without presentation fallback (requireDatabaseRecord = true)
      const profile = await this.getProfile(data.user.id, data.user, true);
      if (profile) {
        return { success: true, user: profile, profileConfirmed: true };
      }

      // If session exists but profile cannot be retrieved or confirmed from database, do not claim success.
      return {
        success: false,
        error: 'Account created, but database profile initialization could not be confirmed. Please sign in to complete account setup.',
        profileConfirmed: false,
      };
    } catch (err: any) {
      return { success: false, error: sanitizeAuthError(err) };
    }
  },

  /**
   * Sign in an existing user with email and password
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      const simulatedUser: UserProfile = {
        id: `usr_${Date.now()}`,
        email,
        nickname: email.split('@')[0],
        isGuest: false,
        is18Verified: false,
        verificationMethod: 'pending',
        avatar: '🛡️',
        languagePreference: 'en',
        safeFilterEnabled: true,
        notificationSounds: true,
        createdAt: new Date().toISOString(),
      };
      return { success: true, user: simulatedUser };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error: sanitizeAuthError(error) };
      }

      if (!data.user) {
        return { success: false, error: 'Login failed: Invalid credentials.' };
      }

      // Retrieve full profile from database and merge auth metadata
      const profile = await this.getProfile(data.user.id, data.user);
      return { success: true, user: profile || undefined };
    } catch (err: any) {
      return { success: false, error: sanitizeAuthError(err) };
    }
  },

  /**
   * Sign out current user from Supabase Auth
   */
  async logout(): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
  },

  /**
   * Request password recovery email
   */
  async requestPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return { success: true };
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/user/dashboard`,
      });
      if (error) return { success: false, error: sanitizeAuthError(error) };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: sanitizeAuthError(err) };
    }
  },

  /**
   * Update password for an active session
   */
  async updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabaseClient();
    if (!supabase) return { success: true };

    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: sanitizeAuthError(error) };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: sanitizeAuthError(err) };
    }
  },

  /**
   * Restore active session on initial page load
   */
  async restoreSession(): Promise<UserProfile | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user) {
        return await this.getProfile(data.session.user.id, data.session.user);
      }
      return null;
    } catch {
      return null;
    }
  },

  /**
   * Fetch profile record from public.profiles
   */
  async getProfile(userId: string, authUser?: any, requireDatabaseRecord: boolean = false): Promise<UserProfile | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    try {
      const { data, error, status } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // Get metadata from authUser if provided, or try to fetch current user
      let metadata = authUser?.user_metadata || {};

      if (error) {
        // Detailed logging for PostgREST errors (e.g. PGRST205 / 404)
        console.warn(`[VX-AUTH] Profile fetch error for ${userId.slice(0, 8)}:`, {
          code: error.code,
          message: error.message,
          status,
          hint: error.hint
        });
        
        // When requireDatabaseRecord is true (e.g. during registration confirmation),
        // strictly require an actual database row and never return an Auth metadata fallback.
        if (requireDatabaseRecord) {
          return null;
        }

        // For non-registration flows (e.g. presentation fallback during minor read replica lag),
        // construct presentation representation if user exists in Auth.
        if (status === 404) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && user.id === userId) {
             return {
               id: user.id,
               nickname: user.user_metadata?.nickname || user.email?.split('@')[0] || 'User',
               avatar: user.user_metadata?.avatar_url || '🛡️',
               gender: user.user_metadata?.gender,
               isGuest: false,
               is18Verified: false,
               languagePreference: 'en',
               safeFilterEnabled: true,
               notificationSounds: true,
               createdAt: user.created_at,
             };
          }
        }
        return null;
      }

      if (!data) return null;

      return {
        id: data.id,
        nickname: data.nickname,
        avatar: data.avatar_url || '🛡️',
        gender: metadata.gender,
        bio: data.bio || '',
        isGuest: false,
        is18Verified: Boolean(data.is_18_verified),
        verifiedAt: data.verified_at,
        verificationMethod: data.verification_method,
        languagePreference: 'en',
        safeFilterEnabled: Boolean(data.safe_filter_enabled),
        notificationSounds: Boolean(data.notification_sounds),
        role: data.role || 'user',
        createdAt: data.created_at,
      };
    } catch (e) {
      console.error('[VX-AUTH] Unexpected profile fetch exception:', e);
      return null;
    }
  },

  /**
   * Update user profile in public.profiles table
   */
  async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (!supabase) return false;

    try {
      // Resolve active session token for authoritative audit
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        console.warn('[authService] Generic profile update failed: No active member session found.');
        return false;
      }

      // Generic profile update path must never attempt to modify trusted verification fields.
      const { 
        is18Verified: _ignored1, 
        verifiedAt: _ignored2, 
        verificationMethod: _ignored3, 
        ...safeUpdates 
      } = updates;

      // Route via worker audit layer
      const res = await fetch('/api/auth/profile/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ updates: safeUpdates }),
      });

      if (!res.ok) {
        console.error(`[authService] Worker profile update audit failed (HTTP ${res.status}).`);
        return false;
      }

      const data = await res.json().catch(() => ({}));
      return data.success === true;
    } catch (err) {
      console.error('[authService] Unexpected error during profile update audit:', err);
      return false;
    }
  },

  /**
   * Account deletion workflow foundation
   */
  async requestAccountDeletion(): Promise<{ success: boolean; message: string }> {
    const supabase = getSupabaseClient();
    let token: string | null = null;

    if (supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token || null;
      } catch {
        token = null;
      }
    }

    if (!token) {
      return {
        success: false,
        message: 'Authentication required: No active member session found.',
      };
    }

    try {
      const res = await fetch('/api/auth/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const errMessage = data?.error || data?.message || `Server rejected account deletion (HTTP ${res.status}).`;
        return { success: false, message: errMessage };
      }

      if (data && data.success === true) {
        return { success: true, message: data.message || 'Account successfully deleted.' };
      }

      return {
        success: false,
        message: data?.error || data?.message || 'Server did not confirm account deletion.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Network error during account deletion request.',
      };
    }
  },
};
