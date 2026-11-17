import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { UserProfile, AppLanguage, UserGender } from '../types';
import { authService, inspectRecoveryUrl } from '../services/authService';
import { guestSessionService } from '../services/guestSessionService';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

export type PasswordRecoveryStatus = 'idle' | 'processing' | 'ready' | 'invalid' | 'completed';

interface AuthContextType {
  user: UserProfile;
  hasActiveSession: boolean;
  isLoading: boolean;
  is18Verified: boolean;
  ageDeclarationAccepted: boolean;
  verify18: () => void;
  revoke18: () => void;
  setNickname: (nickname: string) => Promise<{ success: boolean; error?: string }>;
  setAvatar: (avatar: string) => Promise<{ success: boolean; error?: string }>;
  loginGuest: (nickname?: string, lang?: AppLanguage, gender?: string, ageDeclarationAccepted?: boolean) => Promise<{ success: boolean; error?: string }>;
  loginWithAccount: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  registerWithAccount: (
    email: string,
    password: string,
    nickname: string,
    gender?: string
  ) => Promise<{ success: boolean; error?: string; requiresEmailConfirmation?: boolean; message?: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  passwordRecoveryStatus: PasswordRecoveryStatus;
  passwordRecoveryError: string | null;
  completePasswordReset: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: () => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<{ success: boolean; error?: string }>;
  updatePreferences: (prefs: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
  isSupabaseActive: boolean;
  hasPermission: (featureId: 'PROFILE_EDIT' | 'ACCOUNT_SETTINGS' | 'PRIVATE_DM' | 'PUBLIC_CHAT' | 'VOICE_VIDEO') => boolean;
}

const GUEST_AVATARS = [
  '⚡', '🌊', '🌙', '🔥', '🦅', '🦁', '🌿', '✨', '🪐', '💫', '🎯', '🛡️'
];

const DEFAULT_GUEST_NAMES = [
  'Padma_Rider',
  'Dhaka_Echo',
  'Meghna_Wave',
  'Jamuna_Star',
  'Sylhet_Breeze',
  'Bengal_Nomad',
  'Sundarbans_Roar',
  'Karnaphuli_Soul',
];

function getRandomGuestNickname(): string {
  const base = DEFAULT_GUEST_NAMES[Math.floor(Math.random() * DEFAULT_GUEST_NAMES.length)];
  const randNum = Math.floor(100 + Math.random() * 900);
  return `${base}_${randNum}`;
}

const createDefaultVisitorProfile = (): UserProfile => ({
  id: '',
  nickname: 'Visitor',
  isGuest: true,
  is18Verified: false,
  ageDeclarationAccepted: false,
  avatar: '',
  languagePreference: 'en',
  safeFilterEnabled: true,
  notificationSounds: true,
  createdAt: new Date().toISOString(),
});

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasActiveSession, setHasActiveSession] = useState<boolean>(() => {
    return Boolean(guestSessionService.getStoredToken() || localStorage.getItem('voxanex_user_profile'));
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [passwordRecoveryStatus, setPasswordRecoveryStatus] = useState<PasswordRecoveryStatus>('idle');
  const [passwordRecoveryError, setPasswordRecoveryError] = useState<string | null>(null);

  const [user, setUser] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem('voxanex_user_profile');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }

    return createDefaultVisitorProfile();
  });

  const isSupabaseActive = isSupabaseConfigured();
  const restoreSeqRef = useRef<number>(0);
  const isRecoveryModeRef = useRef<boolean>(false);

  // Restore authenticated session & inspect recovery callback on initial mount
  useEffect(() => {
    let isMounted = true;
    const currentSeq = ++restoreSeqRef.current;

    // Synchronously inspect the URL BEFORE getSupabaseClient() initializes GoTrueClient
    // so we preserve original callback params (code / hash / token_hash / error) before detectSessionInUrl clears them.
    const initialHref = typeof window !== 'undefined' ? window.location.href : '';
    const initialPathname = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') || '/' : '/';
    const initialUrlInspection = inspectRecoveryUrl(initialHref);
    const isResetRoute = initialPathname === '/user/reset-password';
    const isRecoveryFlow =
      isResetRoute || (initialUrlInspection.hasCallbackParams && initialUrlInspection.hasRecoveryType);

    isRecoveryModeRef.current = isRecoveryFlow;

    let recoveryEventFired = false;

    // Bounded bootstrap timeout guard to prevent infinite loading screen on network stalls
    const initTimeout = setTimeout(() => {
      if (isMounted) {
        setIsLoading(false);
        if (isRecoveryFlow) {
          setPasswordRecoveryStatus((prev) => (prev === 'idle' || prev === 'processing' ? 'invalid' : prev));
          setPasswordRecoveryError((prev) =>
            prev || 'Password reset link verification timed out. Please request a new reset link.'
          );
        }
      }
    }, 6000);

    // Instantiate Supabase client & register listener immediately to catch PASSWORD_RECOVERY from _initialize()
    const supabase = isSupabaseActive ? getSupabaseClient() : null;
    let authListenerSub: { unsubscribe: () => void } | null = null;

    if (supabase && isSupabaseActive) {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!isMounted) return;

        if (event === 'PASSWORD_RECOVERY') {
          recoveryEventFired = true;
          isRecoveryModeRef.current = true;
          setPasswordRecoveryStatus((prev) => (prev === 'completed' ? prev : 'ready'));
          setPasswordRecoveryError(null);
          setIsLoading(false);
          return;
        }

        // CRITICAL FIX: Do NOT bump restoreSeqRef or invalidate in-flight restore() for INITIAL_SESSION or unhandled events
        if (event === 'INITIAL_SESSION') {
          return;
        }

        if (event === 'SIGNED_IN' && session?.user) {
          const currentPath =
            typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') || '/' : '/';
          // Never treat a recovery callback session as a standard member login
          if (isRecoveryModeRef.current || currentPath === '/user/reset-password') {
            return;
          }

          const eventSeq = ++restoreSeqRef.current;
          const profile = await authService.getProfile(session.user.id, session.user);
          if (!isMounted || restoreSeqRef.current !== eventSeq) return;
          if (profile) {
            setUser(profile);
            setHasActiveSession(true);
            setIsLoading(false);
          }
        } else if (event === 'SIGNED_OUT') {
          const eventSeq = ++restoreSeqRef.current;
          // Strictly clear only registered member sessions to preserve independent guest access
          setUser((curr) => {
            if (!curr.isGuest) {
              setHasActiveSession(false);
              try {
                localStorage.removeItem('voxanex_user_profile');
              } catch {
                // ignore
              }
              return createDefaultVisitorProfile();
            }
            return curr;
          });
          if (isMounted && restoreSeqRef.current === eventSeq) {
            setIsLoading(false);
          }
        }
      });
      authListenerSub = data?.subscription || null;
    }

    async function restoreGuestSessionIfPresent(): Promise<boolean> {
      const token = guestSessionService.getStoredToken();
      if (!token) return false;

      const check = await guestSessionService.validateSession(token);
      if (!isMounted || restoreSeqRef.current !== currentSeq) return true;

      if (check.valid && check.session) {
        setUser((prev) => ({
          ...prev,
          id: check.session?.id || prev.id,
          nickname: check.session?.nickname || prev.nickname,
          avatar: check.session?.avatar || prev.avatar,
          isGuest: true,
          is18Verified: Boolean(check.session?.is18Verified),
          ageDeclarationAccepted: Boolean(check.session?.ageDeclarationAccepted),
          gender: check.session?.gender as UserGender,
        }));
        setHasActiveSession(true);
        return true;
      } else if (check.valid === false) {
        setHasActiveSession(false);
        setUser(createDefaultVisitorProfile());
        try {
          localStorage.removeItem('voxanex_user_profile');
        } catch {
          // ignore
        }
        return true;
      }

      return false;
    }

    async function restore() {
      try {
        if (isRecoveryFlow) {
          setPasswordRecoveryStatus('processing');
          setPasswordRecoveryError(null);

          const recoveryRes = await authService.processRecoveryCallback(
            initialUrlInspection,
            () => recoveryEventFired
          );
          if (!isMounted || restoreSeqRef.current !== currentSeq) return;

          if (recoveryRes.success || recoveryEventFired) {
            setPasswordRecoveryStatus('ready');
            setPasswordRecoveryError(null);
          } else {
            setPasswordRecoveryStatus('invalid');
            setPasswordRecoveryError(
              recoveryRes.error || 'This password reset link is invalid or has expired. Please request a new reset link.'
            );
          }

          // Preserve independent guest session state if one exists without converting recovery into member login
          const handledGuest = await restoreGuestSessionIfPresent();
          if (!handledGuest && isMounted && restoreSeqRef.current === currentSeq) {
            setHasActiveSession(false);
          }
          return;
        }

        // 1. Standard mount: attempt member session restoration if Supabase is configured
        if (isSupabaseActive) {
          const restoredProfile = await authService.restoreSession();
          if (!isMounted || restoreSeqRef.current !== currentSeq) return;

          if (restoredProfile) {
            setUser(restoredProfile);
            setHasActiveSession(true);
            setIsLoading(false);
            return;
          }
        }

        // 2. If no member session, inspect stored guest token
        const handledGuest = await restoreGuestSessionIfPresent();
        if (handledGuest || !isMounted || restoreSeqRef.current !== currentSeq) {
          return;
        }

        // 3. Neither member nor guest session present
        setHasActiveSession(false);
        setUser((prev) => ({
          ...prev,
          ageDeclarationAccepted: prev.isGuest ? false : prev.ageDeclarationAccepted,
        }));
      } catch (err) {
        console.warn('[AuthContext] Session restoration error:', err);
        if (isMounted && restoreSeqRef.current === currentSeq) {
          if (isRecoveryFlow) {
            setPasswordRecoveryStatus('invalid');
            setPasswordRecoveryError('Unable to verify password reset link. Please request a new reset link.');
          } else {
            setHasActiveSession(false);
          }
        }
      } finally {
        if (isMounted && restoreSeqRef.current === currentSeq) {
          setIsLoading(false);
        }
      }
    }

    restore();

    return () => {
      isMounted = false;
      clearTimeout(initTimeout);
      if (authListenerSub) {
        authListenerSub.unsubscribe();
      }
    };
  }, [isSupabaseActive]);

  useEffect(() => {
    if (hasActiveSession) {
      try {
        localStorage.setItem('voxanex_user_profile', JSON.stringify(user));
      } catch {
        // ignore
      }
    }
  }, [user, hasActiveSession]);

  const verify18 = () => {
    setUser((prev) => ({
      ...prev,
      ageDeclarationAccepted: true,
      is18Verified: prev.isGuest ? false : prev.is18Verified,
      verifiedAt: prev.isGuest ? undefined : prev.verifiedAt,
      verificationMethod: prev.isGuest ? ('self_declaration' as const) : prev.verificationMethod,
    }));
  };

  const revoke18 = () => {
    setUser((prev) => ({
      ...prev,
      ageDeclarationAccepted: false,
      is18Verified: false,
      verifiedAt: undefined,
      verificationMethod: 'pending' as const,
    }));
  };

  const setNickname = async (nickname: string): Promise<{ success: boolean; error?: string }> => {
    const clean = nickname.trim().slice(0, 24);
    if (!clean) return { success: false, error: 'Nickname cannot be empty.' };

    // Registered member updates must always fail closed if persistence fails or Supabase is unavailable
    if (!user.isGuest) {
      const res = await authService.updateProfile(user.id, { nickname: clean });
      if (!res.success) {
        return { success: false, error: res.error || 'Failed to update nickname.' };
      }
    }

    setUser((prev) => ({ ...prev, nickname: clean }));
    return { success: true };
  };

  const setAvatar = async (avatar: string): Promise<{ success: boolean; error?: string }> => {
    // Registered member updates must always fail closed if persistence fails or Supabase is unavailable
    if (!user.isGuest) {
      const res = await authService.updateProfile(user.id, { avatar });
      if (!res.success) {
        return { success: false, error: res.error || 'Failed to update avatar.' };
      }
    }

    setUser((prev) => ({ ...prev, avatar }));
    return { success: true };
  };

  const loginGuest = async (
    nickname?: string,
    lang: AppLanguage = 'en',
    gender?: string,
    ageDeclarationAccepted?: boolean
  ): Promise<{ success: boolean; error?: string }> => {
    const chosenNick = nickname?.trim() || getRandomGuestNickname();
    const chosenAvatar = GUEST_AVATARS[Math.floor(Math.random() * GUEST_AVATARS.length)];

    const res = await guestSessionService.createSession({
      nickname: chosenNick,
      avatar: chosenAvatar,
      languagePref: lang,
      gender,
      is18Verified: false,
      ageDeclarationAccepted: Boolean(ageDeclarationAccepted),
    });

    if (res.success && res.session) {
      ++restoreSeqRef.current;
      setUser({
        id: res.session.id,
        nickname: res.session.nickname,
        isGuest: true,
        is18Verified: false,
        ageDeclarationAccepted: Boolean(res.session.ageDeclarationAccepted),
        avatar: res.session.avatar,
        gender: gender as UserGender,
        languagePreference: res.session.languagePref,
        safeFilterEnabled: true,
        notificationSounds: true,
        createdAt: new Date().toISOString(),
      });
      setHasActiveSession(true);
      return { success: true };
    } else {
      if (import.meta.env.DEV) {
        ++restoreSeqRef.current;
        setUser({
          id: `guest_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          nickname: chosenNick,
          isGuest: true,
          is18Verified: false,
          ageDeclarationAccepted: Boolean(ageDeclarationAccepted),
          avatar: chosenAvatar,
          gender: gender as UserGender,
          languagePreference: lang,
          safeFilterEnabled: true,
          notificationSounds: true,
          createdAt: new Date().toISOString(),
        });
        setHasActiveSession(true);
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to initialize guest session on server.' };
    }
  };

  const loginWithAccount = async (email: string, password: string) => {
    isRecoveryModeRef.current = false;
    const res = await authService.login(email, password);
    if (res.success && res.user) {
      ++restoreSeqRef.current;
      setUser(res.user);
      setHasActiveSession(true);
      return { success: true };
    }
    return { success: false, error: res.error || 'Authentication failed' };
  };

  const registerWithAccount = async (email: string, password: string, nickname: string, gender?: string) => {
    isRecoveryModeRef.current = false;
    const res = await authService.register(email, password, nickname, gender, user.languagePreference);
    if (res.success) {
      if (res.user) {
        ++restoreSeqRef.current;
        setUser(res.user);
        setHasActiveSession(true);
      }
      return {
        success: true,
        requiresEmailConfirmation: res.requiresEmailConfirmation,
        message: res.message,
      };
    }
    return { success: false, error: res.error || 'Registration failed' };
  };

  const requestPasswordReset = async (email: string) => {
    return authService.requestPasswordReset(email);
  };

  const completePasswordReset = async (newPassword: string): Promise<{ success: boolean; error?: string }> => {
    const res = await authService.updatePassword(newPassword);
    if (!res.success) {
      return res;
    }

    isRecoveryModeRef.current = false;
    await authService.clearRecoverySession();
    try {
      localStorage.removeItem('voxanex_user_profile');
    } catch {
      // ignore
    }

    setUser((curr) => {
      if (!curr.isGuest) {
        setHasActiveSession(false);
        return createDefaultVisitorProfile();
      }
      return curr;
    });

    setPasswordRecoveryStatus('completed');
    setPasswordRecoveryError(null);
    return { success: true };
  };

  const deleteAccount = async (): Promise<{ success: boolean; message: string }> => {
    const res = await authService.requestAccountDeletion();
    if (!res.success) {
      return res;
    }

    ++restoreSeqRef.current;
    // Server has confirmed permanent account deletion.
    // Perform best-effort client sign-out cleanup without failing the overall operation if Supabase signOut throws on deleted credentials.
    if (!user.isGuest) {
      try {
        await authService.logout();
      } catch (err) {
        console.warn('[AuthContext] Post-deletion signout warning:', err);
      }
    }

    try {
      localStorage.removeItem('voxanex_user_profile');
    } catch {
      // ignore
    }

    setHasActiveSession(false);
    setUser(createDefaultVisitorProfile());

    return res;
  };

  const logout = async (): Promise<{ success: boolean; error?: string }> => {
    if (!user.isGuest) {
      try {
        await authService.logout();
      } catch (err: any) {
        return { success: false, error: err?.message || 'Failed to sign out from server.' };
      }
    } else {
      const revokeRes = await guestSessionService.revokeSession();
      if (!revokeRes.success) {
        return {
          success: false,
          error: revokeRes.error || 'Failed to revoke guest session on server.',
        };
      }
    }

    ++restoreSeqRef.current;
    try {
      localStorage.removeItem('voxanex_user_profile');
    } catch {
      // ignore
    }

    setHasActiveSession(false);
    setUser(createDefaultVisitorProfile());

    return { success: true };
  };

  const updatePreferences = async (prefs: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> => {
    const normalizedPrefs: Partial<UserProfile> = { ...prefs };
    if (typeof normalizedPrefs.nickname === 'string') {
      const cleanNick = normalizedPrefs.nickname.trim().slice(0, 24);
      if (!cleanNick) {
        return { success: false, error: 'Nickname cannot be empty.' };
      }
      normalizedPrefs.nickname = cleanNick;
    }

    // Registered member updates must always fail closed if persistence fails or Supabase is unavailable
    if (!user.isGuest) {
      const res = await authService.updateProfile(user.id, normalizedPrefs);
      if (!res.success) {
        return { success: false, error: res.error || 'Failed to save profile changes.' };
      }
    }

    setUser((prev) => ({
      ...prev,
      ...normalizedPrefs,
    }));
    return { success: true };
  };

  const hasPermission = (featureId: string): boolean => {
    // Registered Member = Default Full Access
    if (!user.isGuest && hasActiveSession) {
      return true;
    }

    // Guest = Explicitly Allowed Limited
    const GUEST_ALLOWED_FEATURES = ['PUBLIC_CHAT', 'PRIVATE_DM'];
    if (user.isGuest && hasActiveSession) {
      return GUEST_ALLOWED_FEATURES.includes(featureId);
    }

    return false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        hasActiveSession,
        isLoading,
        is18Verified: user.is18Verified,
        ageDeclarationAccepted: Boolean(user.ageDeclarationAccepted),
        verify18,
        revoke18,
        setNickname,
        setAvatar,
        loginGuest,
        loginWithAccount,
        registerWithAccount,
        requestPasswordReset,
        passwordRecoveryStatus,
        passwordRecoveryError,
        completePasswordReset,
        deleteAccount,
        logout,
        updatePreferences,
        isSupabaseActive,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export { GUEST_AVATARS, DEFAULT_GUEST_NAMES, getRandomGuestNickname };
