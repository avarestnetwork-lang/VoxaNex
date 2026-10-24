import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile, AppLanguage, UserGender } from '../types';
import { authService } from '../services/authService';
import { guestSessionService } from '../services/guestSessionService';
import { isSupabaseConfigured } from '../lib/supabaseClient';

interface AuthContextType {
  user: UserProfile;
  hasActiveSession: boolean;
  isLoading: boolean;
  is18Verified: boolean;
  verify18: () => void;
  revoke18: () => void;
  setNickname: (nickname: string) => void;
  setAvatar: (avatar: string) => void;
  loginGuest: (nickname?: string, lang?: AppLanguage, gender?: string) => Promise<{ success: boolean; error?: string }>;
  loginWithAccount: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  registerWithAccount: (email: string, password: string, nickname: string) => Promise<{ success: boolean; error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: () => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
  updatePreferences: (prefs: Partial<UserProfile>) => Promise<void>;
  isSupabaseActive: boolean;
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

    // Initial state: No user logged in
    return {
      id: '',
      nickname: 'Visitor',
      isGuest: true,
      is18Verified: false,
      avatar: '',
      languagePreference: 'en',
      safeFilterEnabled: true,
      notificationSounds: true,
      createdAt: new Date().toISOString(),
    };
  });

  const isSupabaseActive = isSupabaseConfigured();


  // Restore authenticated session on initial mount
  useEffect(() => {
    async function restore() {
      if (isSupabaseActive) {
        const restoredProfile = await authService.restoreSession();
        if (restoredProfile) {
          setUser(restoredProfile);
          setHasActiveSession(true);
          return;
        }
      }

      // If guest token exists, validate against server
      const token = guestSessionService.getStoredToken();
      if (token) {
        const check = await guestSessionService.validateSession(token);
        if (check.valid && check.session) {
          setUser(prev => ({
            ...prev,
            id: check.session?.id || prev.id,
            nickname: check.session?.nickname || prev.nickname,
            avatar: check.session?.avatar || prev.avatar,
            is18Verified: Boolean(check.session?.is18Verified),
          }));
          setHasActiveSession(true);
        } else {
          setHasActiveSession(false);
        }
      } else {
        setHasActiveSession(false);
      }
    }
    restore();
    setIsLoading(false);
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
    setUser(prev => {
      const updated = {
        ...prev,
        is18Verified: true,
        verifiedAt: new Date().toISOString(),
        verificationMethod: 'self_declaration' as const,
      };
      if (!prev.isGuest && isSupabaseActive) {
        authService.updateProfile(prev.id, { is18Verified: true });
      }
      return updated;
    });
  };

  const revoke18 = () => {
    setUser(prev => {
      const updated = {
        ...prev,
        is18Verified: false,
        verifiedAt: undefined,
        verificationMethod: 'pending' as const,
      };
      if (!prev.isGuest && isSupabaseActive) {
        authService.updateProfile(prev.id, { is18Verified: false });
      }
      return updated;
    });
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

  const loginGuest = async (nickname?: string, lang: AppLanguage = 'en', gender?: string): Promise<{ success: boolean; error?: string }> => {
    const chosenNick = nickname?.trim() || getRandomGuestNickname();
    const chosenAvatar = GUEST_AVATARS[Math.floor(Math.random() * GUEST_AVATARS.length)];

    const res = await guestSessionService.createSession({
      nickname: chosenNick,
      avatar: chosenAvatar,
      languagePref: lang,
      is18Verified: user.is18Verified,
      gender,
    });
    
    if (res.success && res.session) {
      setUser({
        id: res.session.id,
        nickname: res.session.nickname,
        isGuest: true,
        is18Verified: res.session.is18Verified,
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
          is18Verified: user.is18Verified,
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

  const registerWithAccount = async (email: string, password: string, nickname: string) => {
    const res = await authService.register(email, password, nickname, user.languagePreference);
    if (res.success && res.user) {
      setUser(res.user);
      setHasActiveSession(true);
      return { success: true };
    }
    return { success: false, error: res.error || 'Registration failed' };
  };

  const requestPasswordReset = async (email: string) => {
    return authService.requestPasswordReset(email);
  };

  const deleteAccount = async () => {
    const res = await authService.requestAccountDeletion();
    await logout();
    return res;
  };

  const logout = async () => {
    if (!user.isGuest) {
      await authService.logout();
    } else {
      await guestSessionService.revokeSession();
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
      avatar: '',
      languagePreference: 'en',
      safeFilterEnabled: true,
      notificationSounds: true,
      createdAt: new Date().toISOString(),
    });
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

  return (
    <AuthContext.Provider
      value={{
        user,
        hasActiveSession,
        isLoading,
        is18Verified: user.is18Verified,
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
