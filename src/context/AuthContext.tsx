import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { UserProfile, AppLanguage, UserGender } from '../types';
import { authService } from '../services/authService';
import { guestSessionService } from '../services/guestSessionService';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

interface AuthContextType {
  user: UserProfile;
  hasActiveSession: boolean;
  isLoading: boolean;
  is18Verified: boolean;
  ageDeclarationAccepted: boolean;
  verify18: () => void;
  revoke18: () => void;
  setNickname: (nickname: string) => void;
  setAvatar: (avatar: string) => void;
  loginGuest: (nickname?: string, lang?: AppLanguage, gender?: string, ageDeclarationAccepted?: boolean) => Promise<{ success: boolean; error?: string }>;
  loginWithAccount: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  registerWithAccount: (
    email: string,
    password: string,
    nickname: string,
    gender?: string
  ) => Promise<{ success: boolean; error?: string; requiresEmailConfirmation?: boolean; message?: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: () => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<{ success: boolean; error?: string }>;
  updatePreferences: (prefs: Partial<UserProfile>) => Promise<void>;
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

  // Restore authenticated session on initial mount with strict race-condition guards
  useEffect(() => {
    let isMounted = true;
    const currentSeq = ++restoreSeqRef.current;

    async function restore() {
      try {
        // 1. First attempt member session restoration if Supabase is configured
        if (isSupabaseActive) {
          const restoredProfile = await authService.restoreSession();
          if (!isMounted || restoreSeqRef.current !== currentSeq) return;

          if (restoredProfile) {
            setUser(restoredProfile);
            setHasActiveSession(true);
            return;
          }
        }

        // 2. If no member session, inspect stored guest token
        const token = guestSessionService.getStoredToken();
        if (token) {
          const check = await guestSessionService.validateSession(token);
          if (!isMounted || restoreSeqRef.current !== currentSeq) return;

          if (check.valid && check.session) {
            setUser(prev => ({
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
            return;
          } else {
            // Expired or revoked guest token cleanup
            setHasActiveSession(false);
            setUser(createDefaultVisitorProfile());
            try {
              localStorage.removeItem('voxanex_user_profile');
            } catch {
              // ignore
            }
            return;
          }
        }

        // 3. Neither member nor guest session present
        if (!isMounted || restoreSeqRef.current !== currentSeq) return;
        setHasActiveSession(false);
        setUser(prev => ({
          ...prev,
          ageDeclarationAccepted: prev.isGuest ? false : prev.ageDeclarationAccepted,
        }));
      } catch (err) {
        console.warn('[AuthContext] Session restoration error:', err);
        if (isMounted && restoreSeqRef.current === currentSeq) {
          setHasActiveSession(false);
        }
      } finally {
        if (isMounted && restoreSeqRef.current === currentSeq) {
          setIsLoading(false);
        }
      }
    }

    restore();

    // Supabase auth state change listener to sync member state without affecting guest sessions
    const supabase = getSupabaseClient();
    let authListenerSub: { unsubscribe: () => void } | null = null;

    if (supabase && isSupabaseActive) {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!isMounted) return;

        if (event === 'SIGNED_IN' && session?.user) {
          setUser(curr => {
            if (!curr.isGuest && curr.id === session.user.id) {
              return curr;
            }
            authService.getProfile(session.user.id, session.user).then(profile => {
              if (isMounted && profile) {
                setUser(profile);
                setHasActiveSession(true);
              }
            });
            return curr;
          });
        } else if (event === 'SIGNED_OUT') {
          // Strictly clear only registered member sessions to preserve independent guest access
          setUser(curr => {
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
        }
      });
      authListenerSub = data?.subscription || null;
    }

    return () => {
      isMounted = false;
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
    setUser(prev => ({
      ...prev,
      ageDeclarationAccepted: true,
      is18Verified: prev.isGuest ? false : prev.is18Verified,
      verifiedAt: prev.isGuest ? undefined : prev.verifiedAt,
      verificationMethod: prev.isGuest ? ('self_declaration' as const) : prev.verificationMethod,
    }));
  };

  const revoke18 = () => {
    setUser(prev => ({
      ...prev,
      ageDeclarationAccepted: false,
      is18Verified: false,
      verifiedAt: undefined,
      verificationMethod: 'pending' as const,
    }));
  };

  const setNickname = (nickname: string) => {
    const clean = nickname.trim().slice(0, 24);
    if (!clean) return;
    setUser(prev => {
      const updated = { ...prev, nickname: clean };
      if (!prev.isGuest && isSupabaseActive) {
        authService.updateProfile(prev.id, { nickname: clean });
      }
      return updated;
    });
  };

  const setAvatar = (avatar: string) => {
    setUser(prev => {
      const updated = { ...prev, avatar };
      if (!prev.isGuest && isSupabaseActive) {
        authService.updateProfile(prev.id, { avatar });
      }
      return updated;
    });
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
    const res = await authService.login(email, password);
    if (res.success && res.user) {
      setUser(res.user);
      setHasActiveSession(true);
      return { success: true };
    }
    return { success: false, error: res.error || 'Authentication failed' };
  };

  const registerWithAccount = async (email: string, password: string, nickname: string, gender?: string) => {
    const res = await authService.register(email, password, nickname, gender, user.languagePreference);
    if (res.success) {
      if (res.user) {
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

  const deleteAccount = async (): Promise<{ success: boolean; message: string }> => {
    const res = await authService.requestAccountDeletion();
    if (!res.success) {
      return res;
    }

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
    setUser({
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

    try {
      localStorage.removeItem('voxanex_user_profile');
    } catch {
      // ignore
    }

    setHasActiveSession(false);
    setUser({
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

    return { success: true };
  };

  const updatePreferences = async (prefs: Partial<UserProfile>) => {
    setUser(prev => {
      const updated = { ...prev, ...prefs };
      if (!prev.isGuest && isSupabaseActive) {
        authService.updateProfile(prev.id, prefs);
      }
      return updated;
    });
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
