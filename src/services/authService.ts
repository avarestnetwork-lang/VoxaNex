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

export interface RecoveryUrlInspection {
  hasError: boolean;
  hasImplicitTokens: boolean;
  hasRecoveryType: boolean;
  pkceCode: string | null;
  tokenHash: string | null;
  hasCallbackParams: boolean;
}

export function inspectRecoveryUrl(href: string): RecoveryUrlInspection {
  try {
    const url = new URL(href);
    const queryParams = url.searchParams;
    const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const hashParams = new URLSearchParams(rawHash);

    const hasError = Boolean(
      queryParams.get('error') ||
        queryParams.get('error_code') ||
        queryParams.get('error_description') ||
        hashParams.get('error') ||
        hashParams.get('error_code') ||
        hashParams.get('error_description')
    );

    const type = queryParams.get('type') || hashParams.get('type');
    const hasRecoveryType = type === 'recovery';
    const hasImplicitTokens = Boolean(hashParams.get('access_token') && hashParams.get('refresh_token'));
    const pkceCode = queryParams.get('code');
    const tokenHash = queryParams.get('token_hash');

    const hasCallbackParams = Boolean(
      hasError ||
        hasImplicitTokens ||
        pkceCode ||
        (tokenHash && hasRecoveryType)
    );

    return {
      hasError,
      hasImplicitTokens,
      hasRecoveryType,
      pkceCode,
      tokenHash,
      hasCallbackParams,
    };
  } catch {
    return {
      hasError: false,
      hasImplicitTokens: false,
      hasRecoveryType: false,
      pkceCode: null,
      tokenHash: null,
      hasCallbackParams: false,
    };
  }
}

export function stripRecoveryUrlParams(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    let modified = false;

    const sensitiveQueryKeys = [
      'code',
      'token_hash',
      'type',
      'flow_id',
      'error',
      'error_code',
      'error_description',
    ];
    for (const key of sensitiveQueryKeys) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        modified = true;
      }
    }

    if (url.hash) {
      const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
      const hashParams = new URLSearchParams(rawHash);
      const sensitiveHashKeys = [
        'access_token',
        'refresh_token',
        'provider_token',
        'provider_refresh_token',
        'expires_in',
        'expires_at',
        'token_type',
        'type',
        'error',
        'error_code',
        'error_description',
      ];
      let hashModified = false;
      for (const key of sensitiveHashKeys) {
        if (hashParams.has(key)) {
          hashParams.delete(key);
          hashModified = true;
        }
      }
      if (hashModified) {
        const remainingHash = hashParams.toString();
        url.hash = remainingHash ? `#${remainingHash}` : '';
        modified = true;
      }
    }

    if (modified) {
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  } catch {
    // Ignore URL parsing issues safely without logging callback URLs
  }
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
  if (msg.includes('New password should be different')) {
    return 'Your new password must be different from your previous password.';
  }
  if (msg.includes('weak_password') || msg.includes('Password is known to be weak')) {
    return 'Please choose a stronger password (at least 6 characters).';
  }
  if (msg.includes('Auth session missing') || msg.includes('session_not_found')) {
    return 'Your recovery session is invalid or has expired. Please request a new password reset link.';
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
    languagePref: AppLanguage = 'en',
    ageDeclarationAccepted: boolean = false
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
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: {
            nickname: sanitizedNick,
            avatar_url: '🛡️',
            gender,
            age_declaration_accepted: Boolean(ageDeclarationAccepted),
            age_declaration_at: ageDeclarationAccepted ? new Date().toISOString() : null,
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
   * Persist the member's explicit 18+ self-declaration in Supabase Auth metadata.
   * This is a declaration only and never sets trusted identity verification fields.
   */
  async declareAge18(): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return { success: false, error: 'Authentication service is unavailable.' };
    }
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: {
          age_declaration_accepted: true,
          age_declaration_at: new Date().toISOString(),
        },
      });
      if (error || !data.user?.id) {
        return { success: false, error: sanitizeAuthError(error || new Error('Age declaration could not be saved.')) };
      }
      return { success: true };
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
   * Clear temporary local Supabase session after password recovery completion
   * without affecting independent guest sessions or other devices.
   */
  async clearRecoverySession(): Promise<void> {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Best-effort cleanup after confirmed password update
      }
    }
  },

  /**
   * Request password recovery email via Supabase Auth.
   * Fails closed if Supabase client is unavailable or origin cannot be determined.
   */
  async requestPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return {
        success: false,
        error: 'Authentication service is unavailable. Unable to send password recovery email.',
      };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return {
        success: false,
        error: 'Please enter a valid email address.',
      };
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (!origin) {
      return {
        success: false,
        error: 'Unable to determine application origin for password reset redirect.',
      };
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${origin}/user/reset-password`,
      });
      if (error) return { success: false, error: sanitizeAuthError(error) };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: sanitizeAuthError(err) };
    }
  },

  /**
   * Establish and validate a Supabase password recovery session from callback URL or SDK state.
   * Supports PKCE (?code=), implicit hash (#access_token=...&type=recovery), and token_hash (?token_hash=...&type=recovery).
   * Never trusts URL parameters alone and never treats an unrelated normal session as recovery proof.
   */
  async processRecoveryCallback(
    initialInspection: RecoveryUrlInspection,
    hasRecoveryEventFired: () => boolean
  ): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return {
        success: false,
        error: 'Authentication service is unavailable. Unable to verify password reset link.',
      };
    }

    if (initialInspection.hasError) {
      return {
        success: false,
        error: 'This password reset link is invalid or has expired. Please request a new reset link.',
      };
    }

    try {
      // Wait for GoTrueClient initialization (and any automatic detectSessionInUrl handling)
      const { data: initialSessionData, error: initialSessionError } = await supabase.auth.getSession();

      // Allow queued PASSWORD_RECOVERY subscriber notification from _initialize() to run
      await new Promise((resolve) => setTimeout(resolve, 0));

      if (hasRecoveryEventFired()) {
        stripRecoveryUrlParams();
        return { success: true };
      }

      if (initialSessionError) {
        return {
          success: false,
          error: 'This password reset link is invalid or has expired. Please request a new reset link.',
        };
      }

      const currentInspection =
        typeof window !== 'undefined' ? inspectRecoveryUrl(window.location.href) : initialInspection;

      // Token-hash recovery callback (?token_hash=...&type=recovery)
      if (initialInspection.tokenHash && initialInspection.hasRecoveryType) {
        const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
          token_hash: initialInspection.tokenHash,
          type: 'recovery',
        });
        if (otpError || !otpData?.session?.access_token) {
          return {
            success: false,
            error: 'This password reset link is invalid or has expired. Please request a new reset link.',
          };
        }
        stripRecoveryUrlParams();
        return { success: true };
      }

      // PKCE recovery callback: exchange ONLY if ?code= was not already consumed by _initialize()
      if (initialInspection.pkceCode && currentInspection.pkceCode) {
        const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(
          initialInspection.pkceCode
        );
        if (exchangeError || !exchangeData?.session?.access_token) {
          return {
            success: false,
            error:
              'This password reset link is invalid, expired, or was opened in a different browser. Please request a new reset link.',
          };
        }
        stripRecoveryUrlParams();
        return { success: true };
      }

      // Implicit hash recovery where SDK cleared hash and established session
      if (
        initialInspection.hasImplicitTokens &&
        initialInspection.hasRecoveryType &&
        !currentInspection.hasImplicitTokens &&
        initialSessionData?.session?.access_token
      ) {
        stripRecoveryUrlParams();
        return { success: true };
      }

      return {
        success: false,
        error: 'No valid password recovery session was found. Please request a new password reset link.',
      };
    } catch {
      return {
        success: false,
        error: 'Unable to verify password recovery link. Please request a new reset link.',
      };
    }
  },

  /**
   * Update password for an active recovery or authenticated session.
   * Fails closed if Supabase client or active session is unavailable.
   * Does not silently trim or modify the provided password.
   */
  async updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    if (!newPassword || newPassword.length < 6) {
      return {
        success: false,
        error: 'Password must be at least 6 characters long.',
      };
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return {
        success: false,
        error: 'Authentication service is unavailable. Unable to update password.',
      };
    }

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) {
        return {
          success: false,
          error: 'Your recovery session is invalid or has expired. Please request a new password reset link.',
        };
      }

      const { data, error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        return { success: false, error: sanitizeAuthError(error) };
      }
      if (!data?.user) {
        return {
          success: false,
          error: 'Password update could not be confirmed. Please try again.',
        };
      }

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
               ageDeclarationAccepted: Boolean(user.user_metadata?.age_declaration_accepted),
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
        ageDeclarationAccepted: Boolean(metadata.age_declaration_accepted),
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
   * Update user profile in public.profiles table via authenticated Worker audit layer.
   * Fails closed if Supabase client or authenticated member session is unavailable.
   */
  async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return {
        success: false,
        error: 'Database service is unavailable. Profile changes could not be saved.',
      };
    }

    try {
      // Resolve active session token for authoritative server-side verification
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const sessionUserId = sessionData?.session?.user?.id;

      if (sessionError || !token) {
        console.warn('[authService] Profile update aborted: No active member session found.');
        return {
          success: false,
          error: 'Authentication required: No active member session found. Please sign in again.',
        };
      }

      if (sessionUserId && userId && sessionUserId !== userId) {
        console.warn('[authService] Profile update aborted: Session user mismatch.');
        return {
          success: false,
          error: 'Authentication mismatch. Please sign in again.',
        };
      }

      // Build payload using only supported, non-privileged profile fields.
      // Trusted verification fields and role fields must never be sent on generic profile updates.
      const supportedUpdates: Record<string, unknown> = {};
      if (updates.nickname !== undefined) supportedUpdates.nickname = updates.nickname;
      if (updates.bio !== undefined) supportedUpdates.bio = updates.bio;
      if (updates.avatar !== undefined) supportedUpdates.avatar = updates.avatar;
      if (updates.safeFilterEnabled !== undefined) supportedUpdates.safeFilterEnabled = updates.safeFilterEnabled;
      if (updates.notificationSounds !== undefined) supportedUpdates.notificationSounds = updates.notificationSounds;

      // Route via authoritative Worker audit layer
      const res = await fetch('/api/auth/profile/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ updates: supportedUpdates }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        console.error(`[authService] Worker profile update failed (HTTP ${res.status}).`);
        if (res.status === 401) {
          return {
            success: false,
            error: 'Your session is invalid or has expired. Please sign in again.',
          };
        }
        if (res.status === 403) {
          return {
            success: false,
            error: 'Profile updates are restricted to registered members.',
          };
        }
        if (res.status === 404) {
          return {
            success: false,
            error: 'Profile record could not be found. Please sign in again.',
          };
        }
        if (res.status === 400) {
          return {
            success: false,
            error: 'Invalid profile update request. Please review your input and try again.',
          };
        }
        if (res.status === 503) {
          return {
            success: false,
            error: 'Profile persistence service is unavailable. Please try again later.',
          };
        }
        return {
          success: false,
          error: 'Unable to save profile changes right now. Please try again.',
        };
      }

      if (!data || typeof data !== 'object' || data.success !== true) {
        console.error('[authService] Worker returned non-confirming or malformed profile update response.');
        return {
          success: false,
          error: 'Server did not confirm that profile changes were saved.',
        };
      }

      return { success: true };
    } catch (err) {
      console.error('[authService] Unexpected error during profile update audit:', err);
      return {
        success: false,
        error: 'Network error while saving profile changes. Please check your connection and try again.',
      };
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
