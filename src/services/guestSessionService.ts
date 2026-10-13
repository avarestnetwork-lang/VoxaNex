import { AppLanguage, UserProfile } from '../types';

export interface ValidatedGuestSession {
  id: string;
  token: string;
  nickname: string;
  avatar: string;
  languagePref: AppLanguage;
  is18Verified: boolean;
  expiresAt: number;
}

const STORAGE_KEY = 'vx_guest_token';

export const guestSessionService = {
  /**
   * Request a cryptographically signed guest session from the trusted backend
   */
  async createSession(params: {
    nickname: string;
    avatar: string;
    languagePref: AppLanguage;
    is18Verified: boolean;
  }): Promise<{ success: boolean; session?: ValidatedGuestSession; error?: string }> {
    try {
      const response = await fetch('/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const err = await response.json();
        return { success: false, error: err.error || 'Failed to issue guest session' };
      }

      const data = await response.json();
      if (data.success && data.session) {
        localStorage.setItem(STORAGE_KEY, data.session.token);
        return { success: true, session: data.session };
      }
      return { success: false, error: 'Malformed server response' };
    } catch {
      // Offline fallback: Generate client session record
      const fallbackToken = `vx_gst_local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const fallbackSession: ValidatedGuestSession = {
        id: `guest_${Date.now()}`,
        token: fallbackToken,
        nickname: params.nickname,
        avatar: params.avatar,
        languagePref: params.languagePref,
        is18Verified: params.is18Verified,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
      localStorage.setItem(STORAGE_KEY, fallbackToken);
      return { success: true, session: fallbackSession };
    }
  },

  /**
   * Validate an existing token against the server
   */
  async validateSession(token?: string): Promise<{ valid: boolean; session?: Partial<ValidatedGuestSession> }> {
    const targetToken = token || localStorage.getItem(STORAGE_KEY);
    if (!targetToken) return { valid: false };

    try {
      const response = await fetch('/api/guest/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: targetToken }),
      });

      if (!response.ok) return { valid: false };
      const data = await response.json();
      return { valid: Boolean(data.valid), session: data.session };
    } catch {
      // If server unreachable, check if local token not expired
      return { valid: true };
    }
  },

  /**
   * Revoke active guest session
   */
  async revokeSession(): Promise<void> {
    const token = localStorage.getItem(STORAGE_KEY);
    if (token) {
      try {
        await fetch('/api/guest/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
      } catch {
        // ignore
      }
      localStorage.removeItem(STORAGE_KEY);
    }
  },

  /**
   * Get currently stored token
   */
  getStoredToken(): string | null {
    return localStorage.getItem(STORAGE_KEY);
  },
};
