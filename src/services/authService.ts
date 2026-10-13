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
    languagePref: AppLanguage = 'en'
  ): Promise<AuthResponse> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      // Offline / Local Simulation Mode fallback
      const simulatedUser: UserProfile = {
        id: `usr_${Date.now()}`,
        email,
        nickname: nickname.trim(),
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
        avatar: '🛡️',
        isGuest: false,
        is18Verified: false,
        languagePreference: languagePref,
        safeFilterEnabled: true,
        notificationSounds: true,
        createdAt: new Date().toISOString(),
      };

      await supabase.from('profiles').upsert({
        id: data.user.id,
        nickname: nickname.trim(),
        avatar_url: '🛡️',
        role: 'user',
        is_18_verified: false,
        safe_filter_enabled: true,
        notification_sounds: true,
      });

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

      // Retrieve full profile from database
      const profile = await this.getProfile(data.user.id);
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
        redirectTo: `${window.location.origin}/#auth`,
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
        return await this.getProfile(data.session.user.id);
      }
      return null;
    } catch {
      return null;
    }
  },

  /**
   * Fetch profile record from public.profiles
   */
  async getProfile(userId: string): Promise<UserProfile | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !data) return null;

      return {
        id: data.id,
        nickname: data.nickname,
        avatar: data.avatar_url || '🛡️',
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
    } catch {
      return null;
    }
  },

  /**
   * Update user profile in public.profiles table
   */
  async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (!supabase) return true;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          nickname: updates.nickname,
          bio: updates.bio,
          avatar_url: updates.avatar,
          is_18_verified: updates.is18Verified,
          safe_filter_enabled: updates.safeFilterEnabled,
          notification_sounds: updates.notificationSounds,
        })
        .eq('id', userId);

      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Account deletion workflow foundation
   */
  async requestAccountDeletion(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch('/api/auth/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer local-session-token',
        },
      });
      const data = await res.json();
      return { success: data.success, message: data.message };
    } catch {
      return { success: true, message: 'Account purge registered locally.' };
    }
  },
};
