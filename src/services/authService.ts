import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { UserProfile, AppLanguage } from '../types';

export interface AuthResponse {
  success: boolean;
  user?: UserProfile;
  error?: string;
}

export const authService = {
  /**
   * Register a new user with Supabase Auth and initialize public profile record
   */
  async register(
    email: string,
    password: string,
    nickname: string,
    gender: string = 'prefer_not_to_say',
    languagePref: AppLanguage = 'en'
  ): Promise<AuthResponse> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      // Offline / Local Simulation Mode fallback
      const simulatedUser: UserProfile = {
        id: `usr_${Date.now()}`,
        email,
        nickname: nickname.trim(),
        gender: gender as any,
        isGuest: false,
        is18Verified: true,
        verifiedAt: new Date().toISOString(),
        verificationMethod: 'self_declaration',
        avatar: '🛡️',
        languagePreference: languagePref,
        safeFilterEnabled: true,
        notificationSounds: true,
        createdAt: new Date().toISOString(),
      };
      return { success: true, user: simulatedUser };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            nickname: nickname.trim(),
            avatar_url: '🛡️',
            gender,
          },
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (!data.user) {
        return { success: false, error: 'Registration failed: No user returned.' };
      }

      // Upsert profile in public.profiles table
      const profileData: UserProfile = {
        id: data.user.id,
        email: data.user.email,
        nickname: nickname.trim(),
        gender: gender as any,
        avatar: '🛡️',
        isGuest: false,
        is18Verified: false,
        languagePreference: languagePref,
        safeFilterEnabled: true,
        notificationSounds: true,
        createdAt: new Date().toISOString(),
      };

      const { error: profileError } = await supabase.from('profiles').upsert({
        id: data.user.id,
        nickname: nickname.trim(),
        avatar_url: '🛡️',
        role: 'user',
        is_18_verified: false,
        safe_filter_enabled: true,
        notification_sounds: true,
      });

      if (profileError) {
        console.error('[authService] Profile persistence failed:', profileError);
        return { success: false, error: `Registration failed: Could not create user profile (${profileError.message})` };
      }

      // If email confirmation is enabled, data.session will be null.
      // The user must confirm their email before they can access the application.
      if (!data.session) {
        return {
          success: false,
          error: 'Registration successful! Please check your email and confirm your account before logging in.'
        };
      }

      return { success: true, user: profileData };
    } catch (err: any) {
      return { success: false, error: err.message || 'An unexpected error occurred during signup.' };
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
        is18Verified: true,
        verifiedAt: new Date().toISOString(),
        verificationMethod: 'self_declaration',
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
        return { success: false, error: error.message };
      }

      if (!data.user) {
        return { success: false, error: 'Login failed: Invalid credentials.' };
      }

      // Retrieve full profile from database and merge auth metadata
      const profile = await this.getProfile(data.user.id, data.user);
      return { success: true, user: profile || undefined };
    } catch (err: any) {
      return { success: false, error: err.message || 'An unexpected error occurred during signin.' };
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
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
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
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
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
  async getProfile(userId: string, authUser?: any): Promise<UserProfile | null> {
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
      if (!authUser && userId) {
         // Optionally fetch auth user if not provided and it matches the current session
         // For now, we rely on callers passing authUser when available (login/restore)
      }

      if (error) {
        // Detailed logging for PostgREST errors (e.g. PGRST205 / 404)
        console.warn(`[VX-AUTH] Profile fetch error for ${userId.slice(0, 8)}:`, {
          code: error.code,
          message: error.message,
          status,
          hint: error.hint
        });
        
        // If the table is missing or the record is missing, we might want to return 
        // a minimal profile from the auth metadata as a last-resort fallback
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
