import { ChatMessage } from '../types';
import { guestSessionService } from './guestSessionService';
import { databaseService } from './databaseService';
import { isSupabaseConfigured } from '../lib/supabaseClient';

export interface RealtimePresenceMember {
  id: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  lastSeen: number;
  gender?: string;
}

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
}

export interface GifItem {
  id: string;
  title: string;
  url: string;
  tags: string[];
}

export interface SendMessageOptions {
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  senderType: 'registered' | 'guest';
  content: string;
  mediaUrl?: string;
  mediaType?: 'gif' | 'image';
  linkPreview?: LinkPreviewData;
  clientNonce?: string;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export const messagingService = {
  /**
   * Fetch paginated message history for a public room
   */
  async fetchRoomHistory(
    roomId: string,
    limit = 50,
    before?: string
  ): Promise<{ success: boolean; messages: ChatMessage[]; error?: string }> {
    try {
      const endpoint = `${API_BASE}/api/chat/rooms/${roomId}/messages`;
      const url = new URL(endpoint, window.location.origin);
      url.searchParams.set('limit', limit.toString());
      if (before) url.searchParams.set('before', before);

      const res = await fetch(url.toString());
      if (!res.ok) {
        return { success: false, messages: [], error: `Failed to retrieve messages (status ${res.status})` };
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return { success: false, messages: [], error: 'Unexpected non-JSON response from server.' };
      }
      const data = await res.json();
      return { success: true, messages: data.messages || [] };
    } catch {
      return { success: false, messages: [], error: 'Network error connecting to message service' };
    }
  },

  /**
   * Send a message to a public room with server-side validation and rate limiting
   */
  async sendRoomMessage(
    roomId: string,
    options: SendMessageOptions
  ): Promise<{ success: boolean; message?: ChatMessage; error?: string }> {
    try {
      // Single Authoritative Persistence Path: Supabase if configured, otherwise Worker API
      if (isSupabaseConfigured()) {
        const dbMsg = await databaseService.sendRoomMessage({
          roomId,
          senderUserId: options.senderType === 'registered' ? options.senderId : undefined,
          senderGuestId: options.senderType === 'guest' ? options.senderId : undefined,
          senderNickname: options.senderNickname,
          senderAvatar: options.senderAvatar,
          content: options.content,
        });
        if (dbMsg) {
          return { success: true, message: dbMsg };
        }
      }

      let guestToken =
        options.senderType === 'guest' ? guestSessionService.getStoredToken() : undefined;
      if (options.senderType === 'guest' && !guestToken) {
        guestToken = `vx_gst_local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        try {
          localStorage.setItem('vx_guest_token', guestToken);
        } catch {
          // ignore
        }
      }

      const res = await fetch(`${API_BASE}/api/chat/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...options,
          guestToken,
          clientNonce: options.clientNonce || `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return {
          success: false,
          error: `Server route unavailable or returned invalid response (status ${res.status}).`,
        };
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || `Failed to send message (HTTP ${res.status})` };
      }

      return { success: true, message: data.message };
    } catch {
      return { success: false, error: 'Network unreachable. Message could not be delivered.' };
    }
  },

  /**
   * Subscribe to live room events via SSE and Supabase Realtime with auto-reconnection
   */
  subscribeToRoom(
    roomId: string,
    callbacks: {
      onMessage: (msg: ChatMessage) => void;
      onPresence?: (members: RealtimePresenceMember[]) => void;
      onTyping?: (typers: string[]) => void;
      onStatusChange?: (status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void;
    }
  ): () => void {
    let eventSource: EventSource | null = null;
    let isClosed = false;
    let retryDelay = 1000;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    // Subscribe to Supabase Realtime if configured
    let unsubSupabase = () => {};
    if (isSupabaseConfigured()) {
      unsubSupabase = databaseService.subscribeToRoom(roomId, (msg) => {
        callbacks.onMessage(msg);
      });
    }

    const connect = () => {
      if (isClosed) return;
      callbacks.onStatusChange?.('connecting');

      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }

      eventSource = new EventSource(`${API_BASE}/api/chat/rooms/${roomId}/events`);

      eventSource.addEventListener('connected', () => {
        retryDelay = 1000;
        callbacks.onStatusChange?.('connected');
      });

      eventSource.addEventListener('new_message', (e) => {
        try {
          const msg = JSON.parse(e.data);
          callbacks.onMessage(msg);
        } catch (err) {
          console.warn('Failed to parse incoming room message', err);
        }
      });

      eventSource.addEventListener('presence_update', (e) => {
        try {
          const members = JSON.parse(e.data);
          callbacks.onPresence?.(members);
        } catch {
          // ignore
        }
      });

      eventSource.addEventListener('typing_update', (e) => {
        try {
          const data = JSON.parse(e.data);
          callbacks.onTyping?.(data.typers || []);
        } catch {
          // ignore
        }
      });

      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        if (!isClosed) {
          callbacks.onStatusChange?.('reconnecting');
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 1.5, 10000);
            connect();
          }, retryDelay);
        }
      };
    };

    connect();

    return () => {
      isClosed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      eventSource?.close();
      eventSource = null;
      unsubSupabase();
      callbacks.onStatusChange?.('disconnected');
    };
  },

  /**
   * Send typing status heartbeat
   */
  async sendTyping(roomId: string, memberId: string, nickname: string, isTyping: boolean) {
    try {
      await fetch(`${API_BASE}/api/chat/rooms/${roomId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, nickname, isTyping }),
      });
    } catch {
      // non-critical
    }
  },

  /**
   * Send presence heartbeat
   */
  async sendPresence(
    roomId: string,
    member: { id: string; nickname: string; avatar: string; isGuest: boolean; gender?: string }
  ): Promise<RealtimePresenceMember[]> {
    try {
      const res = await fetch(`${API_BASE}/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(member),
      });
      const data = await res.json();
      return data.members || [];
    } catch {
      return [];
    }
  },

  // ---------------------------------------------------------------------------
  // DIRECT CONVERSATIONS
  // ---------------------------------------------------------------------------

  async getOrCreateConversation(
    userId: string,
    partnerId: string
  ): Promise<{ success: boolean; conversationId?: string; error?: string }> {
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, partnerId }),
      });
      const data = await res.json();
      return data;
    } catch {
      return { success: false, error: 'Failed to initialize conversation' };
    }
  },

  async fetchConversationMessages(
    convId: string,
    userId: string
  ): Promise<{ success: boolean; messages: ChatMessage[]; error?: string }> {
    try {
      const res = await fetch(`/api/chat/conversations/${convId}/messages?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      return { success: true, messages: data.messages || [] };
    } catch {
      return { success: false, messages: [], error: 'Failed to fetch direct messages' };
    }
  },

  async sendConversationMessage(
    convId: string,
    options: {
      senderId: string;
      senderNickname: string;
      senderAvatar: string;
      recipientId: string;
      content: string;
      mediaUrl?: string;
      mediaType?: 'gif' | 'image';
      linkPreview?: LinkPreviewData;
    }
  ): Promise<{ success: boolean; message?: ChatMessage; error?: string }> {
    try {
      const res = await fetch(`/api/chat/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
      const data = await res.json();
      return data;
    } catch {
      return { success: false, error: 'Direct message delivery failed' };
    }
  },

  subscribeToConversation(
    convId: string,
    userId: string,
    onMessage: (msg: ChatMessage) => void
  ): () => void {
    const es = new EventSource(`/api/chat/conversations/${convId}/events?userId=${encodeURIComponent(userId)}`);
    es.addEventListener('new_dm', (e) => {
      try {
        const msg = JSON.parse(e.data);
        onMessage(msg);
      } catch {
        // ignore
      }
    });
    return () => es.close();
  },

  // ---------------------------------------------------------------------------
  // CONTENT & ABUSE UTILITIES
  // ---------------------------------------------------------------------------

  async searchGifs(query = ''): Promise<GifItem[]> {
    try {
      const res = await fetch(`/api/gifs/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      return data.gifs || [];
    } catch {
      return [];
    }
  },

  async fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
    try {
      const res = await fetch('/api/link-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      return data.preview || null;
    } catch {
      return null;
    }
  },

  async toggleBlock(blockerId: string, targetId: string, blocked: boolean): Promise<boolean> {
    try {
      const res = await fetch('/api/moderation/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockerId, targetId, blocked }),
      });
      const data = await res.json();
      return Boolean(data.success);
    } catch {
      return false;
    }
  },
};
