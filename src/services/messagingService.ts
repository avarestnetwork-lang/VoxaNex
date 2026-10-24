import { ChatMessage } from '../types';
import { guestSessionService } from './guestSessionService';
import { databaseService } from './databaseService';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

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

const API_BASE = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '');

async function getIdentityHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  if (!headers.Authorization) {
    const guestToken = guestSessionService.getStoredToken();
    if (guestToken) headers['X-Guest-Token'] = guestToken;
  }
  return headers;
}

export const messagingService = {
  /**
   * Fetch paginated message history for a public room with Supabase fallback
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
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (Array.isArray(data.messages) && data.messages.length > 0) {
            return { success: true, messages: data.messages };
          }
        }
      }

      // If server returned empty or error, fallback to Supabase directly if configured
      if (isSupabaseConfigured()) {
        const dbMsgs = await databaseService.getRoomMessages(roomId);
        if (dbMsgs.length > 0) {
          return { success: true, messages: dbMsgs };
        }
      }

      return { success: true, messages: [] };
    } catch {
      if (isSupabaseConfigured()) {
        const dbMsgs = await databaseService.getRoomMessages(roomId);
        if (dbMsgs.length > 0) {
          return { success: true, messages: dbMsgs };
        }
      }
      return { success: false, messages: [], error: 'Network error connecting to message service' };
    }
  },

  /**
   * Send a message to a public room with server-side validation and multi-transport broadcast
   */
  async sendRoomMessage(
    roomId: string,
    options: SendMessageOptions
  ): Promise<{ success: boolean; message?: ChatMessage; error?: string }> {
    try {
      let guestToken =
        options.senderType === 'guest' ? guestSessionService.getStoredToken() : undefined;
      if (options.senderType === 'guest' && !guestToken) {
        if (import.meta.env.DEV) {
          guestToken = `vx_gst_local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          try {
            localStorage.setItem('vx_guest_token', guestToken);
          } catch {
            // ignore
          }
        } else {
          return { success: false, error: 'Guest session expired or missing. Please re-enter chat.' };
        }
      }

      const clientNonce =
        options.clientNonce || `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      let confirmedMessage: ChatMessage | null = null;

      // 1. Primary dispatch: Server API route
      const res = await fetch(`${API_BASE}/api/chat/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...options,
          guestToken,
          clientNonce,
        }),
      });

      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (data.success && data.message) {
            confirmedMessage = data.message;
          } else {
            return { success: false, error: data.error || 'Message was not accepted' };
          }
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        const errorMsg = errData?.error || `Server rejected message (HTTP ${res.status})`;
        return { success: false, error: errorMsg };
      }

      if (!confirmedMessage) {
        return { success: false, error: 'Server did not return a confirmed message.' };
      }

      // 2. Cross-tab delivery in the same browser
      try {
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          const bc = new BroadcastChannel(`vx_tab_chat_${roomId}`);
          bc.postMessage(confirmedMessage);
          bc.close();
        }
      } catch {
        // ignore
      }

      return { success: true, message: confirmedMessage };
    } catch {
      return { success: false, error: 'Network unreachable. Message could not be delivered.' };
    }
  },

  /**
   * Subscribe to live room events via SSE, Supabase Realtime, and cross-tab BroadcastChannel
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
    let syncInterval: NodeJS.Timeout | null = null;
    let broadcastChannel: BroadcastChannel | null = null;

    // Deduplication registry for incoming messages to prevent duplicate callbacks
    const processedIds = new Set<string>();
    const emitUniqueMessage = (msg: ChatMessage) => {
      if (!msg || !msg.id) return;
      if (processedIds.has(msg.id)) return;
      processedIds.add(msg.id);
      if (processedIds.size > 300) {
        const oldest = processedIds.values().next().value;
        if (oldest) processedIds.delete(oldest);
      }
      callbacks.onMessage(msg);
    };

    // 1. Subscribe to Supabase Realtime (WebSocket Broadcast + Postgres Changes)
    let unsubSupabase = () => {};
    if (isSupabaseConfigured()) {
      databaseService.subscribeToRoom(roomId, (msg) => {
        emitUniqueMessage(msg);
      }).then(unsub => {
        if (isClosed) unsub();
        else unsubSupabase = unsub;
      });
    }

    // 2. Cross-tab BroadcastChannel
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        broadcastChannel = new BroadcastChannel(`vx_tab_chat_${roomId}`);
        broadcastChannel.onmessage = (event) => {
          if (event.data && event.data.roomId === roomId) {
            emitUniqueMessage(event.data);
          }
        };
      }
    } catch {
      // ignore
    }

    // 3. Server-Sent Events (SSE) stream
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
          emitUniqueMessage(msg);
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

    // 4. Background auto-sync interval (every 3.5s) to guarantee zero-refresh delivery across Cloudflare edge isolates
    syncInterval = setInterval(async () => {
      if (isClosed) return;
      try {
        const historyRes = await messagingService.fetchRoomHistory(roomId, 15);
        if (historyRes.success && historyRes.messages.length > 0) {
          for (const m of historyRes.messages) {
            if (!processedIds.has(m.id)) {
              emitUniqueMessage(m);
            }
          }
        }
      } catch {
        // quiet background sync
      }
    }, 3500);

    return () => {
      isClosed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (syncInterval) clearInterval(syncInterval);
      if (broadcastChannel) {
        try {
          broadcastChannel.close();
        } catch {
          // ignore
        }
      }
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
      if (!res.ok) {
        return [];
      }
      const data = await res.json();
      return Array.isArray(data?.members) ? data.members : [];
    } catch {
      return [];
    }
  },

  /**
   * Signal immediate departure from a room
   */
  async leaveRoom(roomId: string, memberId: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: memberId, action: 'leave' }),
        keepalive: true,
      });
    } catch {
      // non-fatal
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
      const guestToken = guestSessionService.getStoredToken();
      const headers = { 'Content-Type': 'application/json', ...(await getIdentityHeaders()) };
      const res = await fetch(`${API_BASE}/api/chat/conversations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId, partnerId, guestToken }),
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
      const guestToken = guestSessionService.getStoredToken();
      let url = `${API_BASE}/api/chat/conversations/${convId}/messages?userId=${encodeURIComponent(userId)}`;
      const headers = await getIdentityHeaders();
      if (guestToken) headers['X-Guest-Token'] = guestToken;
      const res = await fetch(url, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) return { success: false, messages: [], error: data.error || `History request failed (HTTP ${res.status}).` };
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
      clientNonce?: string;
      senderType?: 'registered' | 'guest';
    }
  ): Promise<{ success: boolean; message?: ChatMessage; error?: string }> {
    try {
      const guestToken =
        guestSessionService.getStoredToken() ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('vx_guest_token') : undefined) ||
        undefined;

      const clientNonce = options.clientNonce || `nonce_dm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      let confirmedMessage: ChatMessage | null = null;

      const res = await fetch(`${API_BASE}/api/chat/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getIdentityHeaders()) },
        body: JSON.stringify({ ...options, guestToken, clientNonce }),
      });

      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (data.success && data.message) {
            confirmedMessage = data.message;
          } else {
            return { success: false, error: data.error || 'Direct message was not accepted' };
          }
        } else {
          const text = await res.text();
          try {
            const data = JSON.parse(text);
            if (data.success && data.message) {
              confirmedMessage = data.message;
            } else {
              return { success: false, error: data.error || 'Direct message was not accepted' };
            }
          } catch {
            return { success: false, error: 'Invalid server response format' };
          }
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        const errorMsg = errData?.error || `Server rejected direct message (HTTP ${res.status})`;
        return { success: false, error: errorMsg };
      }

      if (!confirmedMessage) {
        return { success: false, error: 'Server did not return a confirmed direct message.' };
      }

      // Cross-tab broadcast
      try {
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          const bc = new BroadcastChannel(`vx_tab_dm_${convId}`);
          bc.postMessage(confirmedMessage);
          bc.close();
        }
      } catch {
        // ignore
      }

      return { success: true, message: confirmedMessage };
    } catch {
      return { success: false, error: 'Network unreachable. Direct message could not be delivered.' };
    }
  },

  async fetchUserConversations(userId: string, guestToken?: string): Promise<string[]> {
    try {
      const url = `${API_BASE}/api/chat/conversations/list?userId=${encodeURIComponent(userId)}`;
      const headers = await getIdentityHeaders();
      const effectiveToken = guestToken || guestSessionService.getStoredToken();
      if (effectiveToken) headers['X-Guest-Token'] = effectiveToken;
      const res = await fetch(url, { headers });
      const data = await res.json();
      return data.success && Array.isArray(data.conversations) ? data.conversations : [];
    } catch {
      return [];
    }
  },

  async sendConversationTyping(convId: string, memberId: string, nickname: string, isTyping: boolean) {
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${convId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, nickname, isTyping }),
      });
    } catch {
      // non-critical
    }
  },

  async sendConversationRead(convId: string, userId: string, messageId: string) {
    try {
      await fetch(`${API_BASE}/api/chat/conversations/${convId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, messageId }),
      });
    } catch {
      // non-critical
    }
  },

  async createUserEventsTicket(userId: string): Promise<string | null> {
    try {
      const guestToken = guestSessionService.getStoredToken();
      const response = await fetch(`${API_BASE}/api/chat/user/${encodeURIComponent(userId)}/events-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getIdentityHeaders()) },
        body: JSON.stringify({ guestToken }),
      });
      const data = await response.json();
      return response.ok && data.success ? data.ticket : null;
    } catch {
      return null;
    }
  },

  subscribeToConversation(
    convId: string,
    userId: string,
    callbacksOrOnMessage:
      | {
          onMessage: (msg: ChatMessage) => void;
          onTyping?: (typers: string[]) => void;
          onRead?: (receipt: { userId: string; messageId: string; readAt: string }) => void;
        }
      | ((msg: ChatMessage) => void)
  ): () => void {
    const callbacks =
      typeof callbacksOrOnMessage === 'function'
        ? { onMessage: callbacksOrOnMessage }
        : callbacksOrOnMessage;

    let eventSource: EventSource | null = null;
    let isClosed = false;
    let syncInterval: NodeJS.Timeout | null = null;
    let ticketRetryTimeout: ReturnType<typeof setTimeout> | null = null;
    let broadcastChannel: BroadcastChannel | null = null;
    const seenDmIds = new Set<string>();

    const emitUniqueDm = (msg: ChatMessage) => {
      if (!msg || !msg.id) return;
      if (seenDmIds.has(msg.id)) return;
      seenDmIds.add(msg.id);
      if (seenDmIds.size > 200) {
        const oldest = seenDmIds.values().next().value;
        if (oldest) seenDmIds.delete(oldest);
      }
      callbacks.onMessage(msg);
    };

    // 1. Cross-tab BroadcastChannel
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        broadcastChannel = new BroadcastChannel(`vx_tab_dm_${convId}`);
        broadcastChannel.onmessage = (event) => {
          if (event.data) {
            emitUniqueDm(event.data);
          }
        };
      }
    } catch {
      // ignore
    }

    // SSE uses a short-lived ticket so long-lived guest credentials never appear in URLs.
    const connectSse = async () => {
      try {
        const guestToken = guestSessionService.getStoredToken();
        const response = await fetch(`${API_BASE}/api/chat/conversations/${encodeURIComponent(convId)}/events-ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getIdentityHeaders()) },
          body: JSON.stringify({ guestToken }),
        });
        const ticketData = await response.json().catch(() => ({}));
        if (isClosed) return;
        if (!response.ok || !ticketData.ticket) throw new Error('Event ticket unavailable');
        eventSource?.close();
        eventSource = new EventSource(`${API_BASE}/api/chat/conversations/${encodeURIComponent(convId)}/events?ticket=${encodeURIComponent(ticketData.ticket)}`);

      eventSource.addEventListener('new_dm', (e) => {
        console.log('[VX-DM] Received new_dm event from SSE for conversation:', convId);
        try {
          const msg = JSON.parse(e.data);
          emitUniqueDm(msg);
        } catch {
          // ignore
        }
      });

      eventSource.addEventListener('dm_typing', (e) => {
        try {
          const data = JSON.parse(e.data);
          callbacks.onTyping?.(data.typers || []);
        } catch {
          // ignore
        }
      });

      eventSource.addEventListener('dm_read', (e) => {
        try {
          const receipt = JSON.parse(e.data);
          callbacks.onRead?.(receipt);
        } catch {
          // ignore
        }
      });
        eventSource.onerror = () => {
          eventSource?.close();
          eventSource = null;
          if (!isClosed && !ticketRetryTimeout) ticketRetryTimeout = setTimeout(() => {
            ticketRetryTimeout = null;
            void connectSse();
          }, 1500);
        };
      } catch {
        if (!isClosed && !ticketRetryTimeout) ticketRetryTimeout = setTimeout(() => {
          ticketRetryTimeout = null;
          void connectSse();
        }, 3000);
      }
    };
    void connectSse();

    // 3. Fallback auto-sync every 4s
    syncInterval = setInterval(async () => {
      if (isClosed) return;
      try {
        const res = await messagingService.fetchConversationMessages(convId, userId);
        if (res.success && res.messages.length > 0) {
          for (const m of res.messages) {
            if (!seenDmIds.has(m.id)) {
              emitUniqueDm(m);
            }
          }
        }
      } catch {
        // ignore
      }
    }, 4000);

    return () => {
      isClosed = true;
      if (syncInterval) clearInterval(syncInterval);
      if (ticketRetryTimeout) clearTimeout(ticketRetryTimeout);
      if (broadcastChannel) {
        try {
          broadcastChannel.close();
        } catch {
          // ignore
        }
      }
      eventSource?.close();
      eventSource = null;
    };
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
