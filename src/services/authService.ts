import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { UserProfile, AppLanguage } from '../types';

export interface AuthResponse {
  success: boolean;
  user?: UserProfile;
  error?: string;
  requiresEmailConfirmation?: boolean;
  sessionCleanupFailed?: boolean;
}

export type ProfileFetchResult =
  | { status: 'found'; profile: UserProfile }
  | { status: 'missing'; error: string }
  | { status: 'error'; error: string };

export type SessionRestoreResult =
  | { status: 'no-session' }
  | { status: 'restored'; user: UserProfile }
  | { status: 'profile-missing'; error: string; sessionCleanupFailed?: boolean }
  | { status: 'profile-error'; error: string; sessionCleanupFailed?: boolean }
  | { status: 'session-error'; error: string; sessionCleanupFailed?: boolean };

const PROFILE_SELECT_COLUMNS = [
  'id', 'nickname', 'avatar_url', 'bio', 'is_18_verified', 'verified_at',
  'verification_method', 'safe_filter_enabled', 'notification_sounds', 'created_at',
].join(',');

export async function fetchProfileResultWithClient(supabase: any, userId: string, authUser?: any): Promise<ProfileFetchResult> {
  try {
    const { data, error, status } = await supabase
      .from('profiles')
      .select(PROFILE_SELECT_COLUMNS)
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[VX-AUTH] Profile fetch failed:', { code: error?.code, status });
      return { status: 'error', error: error.message || 'Profile query failed.' };
    }
    if (!data) return { status: 'missing', error: 'The authenticated account has no application profile.' };

    const metadata = authUser?.id === userId ? authUser.user_metadata || {} : {};
    return {
      status: 'found',
      profile: {
        id: data.id,
        nickname: data.nickname,
        email: authUser?.id === userId ? authUser.email : undefined,
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
      },
    };
  } catch (error: any) {
    console.warn('[VX-AUTH] Profile fetch failed unexpectedly.');
    return { status: 'error', error: error?.message || 'Profile query failed unexpectedly.' };
  }
}

export async function getProfileWithClient(supabase: any, userId: string, authUser?: any): Promise<UserProfile | null> {
  const result = await fetchProfileResultWithClient(supabase, userId, authUser);
  return result.status === 'found' ? result.profile : null;
}

async function cleanUpFailedProfileSession(supabase: any): Promise<{ error?: string; failed: boolean }> {
  let cleanupError: string | undefined;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) cleanupError = error.message || 'Local session cleanup failed.';
  } catch (error: any) {
    cleanupError = error?.message || 'Local session cleanup failed.';
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      cleanupError = [cleanupError, error.message || 'Could not verify local session cleanup.'].filter(Boolean).join(' ');
      return { error: cleanupError, failed: true };
    }
    if (data?.session) {
      cleanupError = [cleanupError, 'A local authenticated session remains active.'].filter(Boolean).join(' ');
      return { error: cleanupError, failed: true };
    }
  } catch (error: any) {
    cleanupError = [cleanupError, error?.message || 'Could not verify local session cleanup.'].filter(Boolean).join(' ');
    return { error: cleanupError, failed: true };
  }
  return cleanupError
    ? { error: `Sign-out reported an error, but the local session was cleared: ${cleanupError}`, failed: false }
    : { failed: false };
}

async function authenticatedProfileResponse(supabase: any, user: any, context: string): Promise<AuthResponse> {
  const result = await fetchProfileResultWithClient(supabase, user.id, user);
  if (result.status === 'found') return { success: true, user: result.profile };

  const reason = `${context}: ${result.error}`;
  const cleanup = await cleanUpFailedProfileSession(supabase);
  if (cleanup.error) {
    return {
      success: false,
      error: `${reason} Session cleanup: ${cleanup.error}`,
      ...(cleanup.failed ? { sessionCleanupFailed: true } : {}),
    };
  }
  return { success: false, error: reason };
}

export async function registerWithSupabaseClient(
  supabase: any,
  email: string,
  password: string,
  nickname: string,
  gender: string,
  _languagePref: AppLanguage,
): Promise<AuthResponse> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { nickname: nickname.trim(), avatar_url: '🛡️', gender } },
    });

    if (error) return { success: false, error: error.message };
    if (!data.user) return { success: false, error: 'Registration failed: No user returned.' };
    if (!data.session) return { success: true, requiresEmailConfirmation: true };

    const response = await authenticatedProfileResponse(supabase, data.user, 'Registration succeeded but the application profile could not be loaded');
    if (response.user) response.user.languagePreference = _languagePref;
    return response;
  } catch (error: any) {
    return { success: false, error: error?.message || 'An unexpected error occurred during signup.' };
  }
}

export async function loginWithSupabaseClient(supabase: any, email: string, password: string): Promise<AuthResponse> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error: error.message };
    if (!data.user) return { success: false, error: 'Login failed: Invalid credentials.' };
    return authenticatedProfileResponse(supabase, data.user, 'Login succeeded but the application profile could not be loaded');
  } catch (error: any) {
    return { success: false, error: error?.message || 'An unexpected error occurred during signin.' };
  }
}

export async function restoreSessionWithSupabaseClient(supabase: any): Promise<SessionRestoreResult> {
  let sessionData: any;
  try {
    const result = await supabase.auth.getSession();
    if (result.error) {
      const reason = result.error.message || 'Could not read the authentication session.';
      const cleanup = await cleanUpFailedProfileSession(supabase);
      return {
        status: 'session-error',
        error: cleanup.error ? `${reason} Session cleanup: ${cleanup.error}` : reason,
        ...(cleanup.failed ? { sessionCleanupFailed: true } : {}),
      };
    }
    sessionData = result.data;
  } catch (error: any) {
    const reason = error?.message || 'Could not read the authentication session.';
    const cleanup = await cleanUpFailedProfileSession(supabase);
    return {
      status: 'session-error',
      error: cleanup.error ? `${reason} Session cleanup: ${cleanup.error}` : reason,
      ...(cleanup.failed ? { sessionCleanupFailed: true } : {}),
    };
  }

  const authUser = sessionData?.session?.user;
  if (!authUser) return { status: 'no-session' };

  const profile = await fetchProfileResultWithClient(supabase, authUser.id, authUser);
  if (profile.status === 'found') return { status: 'restored', user: profile.profile };

  const cleanup = await cleanUpFailedProfileSession(supabase);
  return {
    status: profile.status === 'missing' ? 'profile-missing' : 'profile-error',
    error: profile.error,
    ...(cleanup.error ? {
      ...(cleanup.failed ? { sessionCleanupFailed: true } : {}),
      error: `${profile.error} Session cleanup: ${cleanup.error}`,
    } : {}),
  };
}

export const authService = {
  /** Register a user; a database trigger creates the profile transactionally. */
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
        is18Verified: false,
        avatar: '🛡️',
        languagePreference: languagePref,
        safeFilterEnabled: true,
        notificationSounds: true,
        createdAt: new Date().toISOString(),
      };
      return { success: true, user: simulatedUser };
    }

    return registerWithSupabaseClient(supabase, email, password, nickname, gender, languagePref);
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
        avatar: '🛡️',
        languagePreference: 'en',
        safeFilterEnabled: true,
        notificationSounds: true,
        createdAt: new Date().toISOString(),
      };
      return { success: true, user: simulatedUser };
    }

    return loginWithSupabaseClient(supabase, email, password);
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
  async restoreSession(): Promise<SessionRestoreResult> {
    const supabase = getSupabaseClient();
    if (!supabase) return { status: 'no-session' };
    return restoreSessionWithSupabaseClient(supabase);
  },

  /**
   * Fetch profile record from public.profiles
   */
  async getProfile(userId: string, authUser?: any): Promise<UserProfile | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    return getProfileWithClient(supabase, userId, authUser);
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
