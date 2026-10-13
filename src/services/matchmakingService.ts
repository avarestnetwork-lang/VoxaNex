import { MatchSession, MatchParticipant, QueueTicket } from '../types';

export interface JoinQueueParams {
  userId: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  languagePref: 'all' | 'bn' | 'en';
  regionPool: 'bangladesh' | 'international' | 'any';
  interests: string[];
  is18Verified: boolean;
}

export interface JoinQueueResponse {
  success: boolean;
  ticket?: QueueTicket;
  match?: MatchSession;
  error?: string;
}

export interface PollStatusResponse {
  success: boolean;
  status: 'waiting' | 'matched' | 'cancelled' | 'expired';
  match?: MatchSession;
  partner?: MatchParticipant;
  error?: string;
}

export const matchmakingService = {
  /**
   * Joins the server-owned matchmaking queue or retrieves immediate atomic match
   */
  async joinQueue(params: JoinQueueParams): Promise<JoinQueueResponse> {
    try {
      const res = await fetch('/api/matchmaking/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return {
          success: false,
          error: data.error || 'Failed to enter matchmaking queue. Please try again.',
        };
      }

      return data;
    } catch {
      return {
        success: false,
        error: 'Network connectivity error contacting matchmaking server.',
      };
    }
  },

  /**
   * Cancels an active search in the waiting queue
   */
  async cancelQueue(ticketId: string, userId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/matchmaking/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, userId }),
      });
      const data = await res.json();
      return Boolean(data.success);
    } catch {
      return false;
    }
  },

  /**
   * Polls ticket status and serves as a keepalive heartbeat
   */
  async pollStatus(ticketId: string, userId: string): Promise<PollStatusResponse> {
    try {
      const url = `/api/matchmaking/status?ticketId=${encodeURIComponent(ticketId)}&userId=${encodeURIComponent(userId)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        return { success: false, status: 'expired', error: data.error };
      }
      return data;
    } catch {
      return { success: false, status: 'expired', error: 'Network poll error' };
    }
  },

  /**
   * Subscribes to real-time events on a queue ticket via SSE
   */
  subscribeToTicket(
    ticketId: string,
    onMatchFound: (payload: { match: MatchSession; partner: MatchParticipant }) => void
  ): () => void {
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/matchmaking/queue/${ticketId}/events`);

      es.addEventListener('match_found', (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          onMatchFound(payload);
        } catch {
          // ignore parse error
        }
      });

      es.onerror = () => {
        // Fallback polling will handle state if SSE disconnects
      };
    } catch {
      // EventSource not supported or failed
    }

    return () => {
      if (es) {
        es.close();
      }
    };
  },

  /**
   * Subscribes to real-time events for an active match session (disconnect / skip notices)
   */
  subscribeToMatch(
    matchId: string,
    onMatchEnded: (payload: { matchId: string; endedBy: string; reason: string }) => void
  ): () => void {
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/matchmaking/match/${matchId}/events`);

      es.addEventListener('match_ended', (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          onMatchEnded(payload);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }

    return () => {
      if (es) {
        es.close();
      }
    };
  },

  /**
   * Disconnects or skips the current active match
   */
  async disconnect(matchId: string, userId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/matchmaking/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, userId }),
      });
      const data = await res.json();
      return Boolean(data.success);
    } catch {
      return false;
    }
  },

  /**
   * Queries currently active match for user if any
   */
  async getActiveMatch(
    userId: string
  ): Promise<{ match?: MatchSession; partner?: MatchParticipant } | null> {
    try {
      const res = await fetch(`/api/matchmaking/active?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.success && data.active) {
        return data.active;
      }
      return null;
    } catch {
      return null;
    }
  },

  /**
   * Block a partner
   */
  async blockUser(blockerId: string, targetId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/moderation/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockerId, targetId, blocked: true }),
      });
      const data = await res.json();
      return Boolean(data.success);
    } catch {
      return false;
    }
  },
};
