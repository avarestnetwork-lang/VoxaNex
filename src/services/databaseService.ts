import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { ROOMS_CONFIG } from '../config/voxanexConfig';
import { Room, ChatMessage, SafetyReport, ForumTopic, BlogArticle } from '../types';

// Internal state for managing shared realtime channels to prevent "callbacks after subscribe" and accidental disconnects
const sharedChannels = new Map<string, { 
  channel: any; 
  refs: number; 
  listeners: Set<(...args: any[]) => void>;
}>();

export const databaseService = {
  /**
   * Fetch active chat rooms from database or fallback configuration
   */
  async getRooms(): Promise<Room[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return ROOMS_CONFIG;

    try {
      const { data, error } = await supabase
        .from('chat_rooms')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (error || !data || data.length === 0) return ROOMS_CONFIG;

      return data.map((r: any) => ({
        id: r.id,
        slug: r.slug,
        name: { en: r.name_en, bn: r.name_bn },
        description: { en: r.description_en, bn: r.description_bn },
        category: r.category,
        categoryLabel: { en: r.category_label_en, bn: r.category_label_bn },
        language: r.language,
        modes: r.modes || ['text'],
        is18Plus: r.is_18_plus,
        requiresAccount: r.requires_account,
        rules: {
          en: ['Follow community conduct rules.', 'No non-consensual sharing or harassment.'],
          bn: ['কমিউনিটি আচরণবিধি মেনে চলুন।', 'অসম্মতিমূলক কনটেন্ট বা হয়রানি নিষিদ্ধ।'],
        },
        backendStatus: 'ready_local_demo',
      }));
    } catch {
      return ROOMS_CONFIG;
    }
  },

  /**
   * Fetch messages for a specific room
   */
  async getRoomMessages(roomId: string): Promise<ChatMessage[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(50);

      if (error || !data) return [];

      return data.map((m: any) => ({
        id: m.id,
        roomId: m.room_id,
        senderId: m.sender_user_id || m.sender_guest_id || 'anonymous',
        senderNickname: m.sender_nickname,
        senderAvatar: m.sender_avatar,
        content: m.content,
        timestamp: m.created_at,
        isSystem: m.is_system,
      }));
    } catch {
      return [];
    }
  },

  /**
   * Fetch messages for a specific conversation
   */
  async getConversationMessages(convId: string, overrideClient?: any): Promise<ChatMessage[]> {
    const supabase = overrideClient || getSupabaseClient();
    if (!supabase) return [];

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });

      if (error || !data) return [];

      return data.map((m: any) => ({
        id: m.id,
        conversationId: m.conversation_id,
        senderId: m.sender_user_id || m.sender_guest_id || 'anonymous',
        senderNickname: m.sender_nickname,
        senderAvatar: m.sender_avatar,
        content: m.content,
        timestamp: m.created_at,
        isDirect: true,
        status: 'delivered',
      }));
    } catch {
      return [];
    }
  },

  /**
   * Broadcast a chat message directly via Supabase Realtime WebSocket broadcast
   */
  async broadcastMessage(roomId: string, message: ChatMessage, overrideClient?: any): Promise<string> {
    const supabase = overrideClient || getSupabaseClient();
    if (!supabase) return 'no_client';
    try {
      const channel = supabase.channel(`room_hub:${roomId}`);
      const status = await channel.send({
        type: 'broadcast',
        event: 'new_message',
        payload: message,
      });
      return status;
    } catch (e) {
      console.warn('[VX-RT] Failed to broadcast message:', e);
      return 'error';
    }
  },

  /**
   * Send a message to a public room, persisting to Supabase and broadcasting
   */
  async sendRoomMessage(params: {
    roomId: string;
    id?: string;
    senderUserId?: string;
    senderGuestId?: string;
    senderNickname: string;
    senderAvatar: string;
    content: string;
    mediaUrl?: string;
    mediaType?: 'gif' | 'image';
    clientNonce?: string;
  }): Promise<ChatMessage | null> {
    const supabase = getSupabaseClient();
    const msgId = params.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newMsg: ChatMessage = {
      id: msgId,
      roomId: params.roomId,
      senderId: params.senderUserId || params.senderGuestId || 'usr',
      senderNickname: params.senderNickname,
      senderAvatar: params.senderAvatar,
      content: params.content,
      mediaUrl: params.mediaUrl,
      mediaType: params.mediaType,
      clientNonce: params.clientNonce,
      timestamp: new Date().toISOString(),
      status: 'delivered',
    };

    if (!supabase) return newMsg;

    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          id: msgId,
          room_id: params.roomId,
          sender_user_id: params.senderUserId || null,
          sender_guest_id: params.senderGuestId || null,
          sender_nickname: params.senderNickname,
          sender_avatar: params.senderAvatar,
          content: params.content,
        })
        .select()
        .single();

      const savedMsg: ChatMessage = (error || !data)
        ? newMsg
        : {
            id: data.id,
            roomId: data.room_id,
            senderId: data.sender_user_id || data.sender_guest_id || 'usr',
            senderNickname: data.sender_nickname,
            senderAvatar: data.sender_avatar,
            content: data.content,
            mediaUrl: params.mediaUrl,
            mediaType: params.mediaType,
            clientNonce: params.clientNonce,
            timestamp: data.created_at,
            status: 'delivered',
          };

      // Broadcast immediately across all browser clients in this room
      await this.broadcastMessage(params.roomId, savedMsg);

      return savedMsg;
    } catch {
      await this.broadcastMessage(params.roomId, newMsg);
      return newMsg;
    }
  },

  /**
   * Subscribe to Supabase Realtime changes and WebSocket broadcasts for a room
   */
  subscribeToRoom(roomId: string, onMessage: (msg: ChatMessage) => void) {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};

    const channelName = `room_hub:${roomId}`;
    
    console.log(`[VX-RT] Subscribing to Supabase channel: ${channelName}`);

    const seenIds = new Set<string>();
    const markAndEmit = (msg: ChatMessage) => {
      if (!msg || !msg.id) return;
      if (seenIds.has(msg.id)) return;
      seenIds.add(msg.id);
      if (seenIds.size > 200) {
        const oldest = seenIds.values().next().value;
        if (oldest) seenIds.delete(oldest);
      }
      onMessage(msg);
    };

    // Shared channel logic to prevent duplicate subscriptions
    let entry = sharedChannels.get(channelName);
    if (!entry) {
      const channel = supabase.channel(channelName, { config: { broadcast: { self: false } } });
      entry = { channel, refs: 0, listeners: new Set() };
      sharedChannels.set(channelName, entry);

      channel
        .on(
          'broadcast',
          { event: 'new_message' },
          (payload: any) => {
            const msg = payload?.payload;
            if (msg && msg.roomId === roomId) {
              console.log(`[VX-RT] [${channelName}] Received broadcast:`, msg.id, msg.content?.slice(0, 20));
              entry!.listeners.forEach(l => l(msg));
            }
          }

        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `room_id=eq.${roomId}`,
          },
          (payload: any) => {
            const row = payload?.new;
            if (row && row.room_id === roomId) {
              console.log(`[VX-RT] [${channelName}] Received INSERT:`, row.id);
              const msg = {
                id: row.id,
                roomId: row.room_id,
                senderId: row.sender_user_id || row.sender_guest_id || 'usr',
                senderNickname: row.sender_nickname,
                senderAvatar: row.sender_avatar,
                content: row.content,
                timestamp: row.created_at,
                status: 'delivered' as const,
              };
              entry!.listeners.forEach(l => l(msg));
            }

          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[VX-RT] [${channelName}] Subscription success`);
          } else {
            console.warn(`[VX-RT] [${channelName}] Subscription status: ${status}`, err || '');
          }
        });

    }

    entry.refs++;
    const listener = (msg: ChatMessage) => markAndEmit(msg);
    entry.listeners.add(listener);

    return () => {
      const currentEntry = sharedChannels.get(channelName);
      if (currentEntry) {
        currentEntry.listeners.delete(listener);
        currentEntry.refs--;
        if (currentEntry.refs <= 0) {
          console.log(`[VX-RT] Final unsubscribe: ${channelName}`);
          supabase.removeChannel(currentEntry.channel);
          sharedChannels.delete(channelName);
        }
      }
    };
  },

  /**
   * Track presence state and listen for updates via Supabase Realtime Presence
   */
  trackPresence(roomId: string, member: { id: string; nickname: string; avatar: string; isGuest: boolean; gender?: string }, onSync: (members: any[]) => void): () => void {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};

    const channelName = `public_room_presence:${roomId}`;
    
    let entry = sharedChannels.get(channelName);
    if (!entry) {
      console.log('[VX-PRESENCE] Initializing shared presence channel:', channelName);
      const channel = supabase.channel(channelName, {
        config: {
          presence: {
            key: member.id,
          },
        },
      });

      entry = { channel, refs: 0, listeners: new Set() };
      sharedChannels.set(channelName, entry);

      // Register ALL event types before subscribing
      channel
        .on('presence', { event: 'sync' }, () => {
          try {
            const state = channel.presenceState();
            const members: any[] = [];
            Object.values(state).forEach((presences: any) => {
              if (Array.isArray(presences)) {
                presences.forEach((p) => {
                  members.push({
                    id: p.id || p.user_id,
                    nickname: p.nickname || 'User',
                    avatar: p.avatar || '👤',
                    isGuest: Boolean(p.isGuest),
                    gender: p.gender,
                    lastSeen: p.lastSeen || Date.now(),
                  });
                });
              }
            });
            entry!.listeners.forEach(l => l(members));
          } catch (err) {
            console.warn('[VX-PRESENCE] Sync error:', err);
          }
        })
        .on('broadcast', { event: 'presence' }, (payload) => {
          // Compatibility shim for legacy broadcast-based presence
          if (payload.payload?.status === 'offline' && payload.payload.id) {
             // We can't easily trigger a sync here, but the untrack() on leave handles this mostly.
          }
        })
        .subscribe(async (status: string, err?: any) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[VX-PRESENCE] [${channelName}] Subscribed successfully`);
            try {
              await channel.track({
                id: member.id,
                nickname: member.nickname,
                avatar: member.avatar,
                isGuest: member.isGuest,
                gender: member.gender,
                lastSeen: Date.now(),
              });
            } catch (trackErr) {
              console.error(`[VX-PRESENCE] [${channelName}] Track failed:`, trackErr);
            }
          } else {
            console.warn(`[VX-PRESENCE] [${channelName}] Status: ${status}`, err || '');
          }
        });
    }

    entry.refs++;
    const listener = (members: any[]) => onSync(members);
    entry.listeners.add(listener);

    return () => {
      const currentEntry = sharedChannels.get(channelName);
      if (currentEntry) {
        currentEntry.listeners.delete(listener);
        currentEntry.refs--;
        if (currentEntry.refs <= 0) {
          console.log('[VX-PRESENCE] Cleaning up shared presence channel:', channelName);
          currentEntry.channel.untrack().catch(() => {});
          supabase.removeChannel(currentEntry.channel);
          sharedChannels.delete(channelName);
        }
      }
    };
  },

  /**
   * Broadcast presence update (compatibility shim)
   */
  async broadcastPresence(roomId: string, presence: any) {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const channelName = `public_room_presence:${roomId}`;
      let entry = sharedChannels.get(channelName);
      const channel = entry ? entry.channel : supabase.channel(channelName);
      
      await channel.send({
        type: 'broadcast',
        event: 'presence',
        payload: presence,
      });
    } catch {}
  },

  /**
   * Subscribe to presence updates (compatibility shim)
   * Note: This now hooks into the same shared channel used by trackPresence
   */
  subscribePresence(roomId: string, onUpdate: (presence: any) => void) {
    // This is now effectively a no-op or a shim because trackPresence handles the sync.
    // For legacy support, we just return a no-op unsetter.
    return () => {};
  },

  /**
   * Submit an incident report to the database
   */
  async submitReport(report: {
    reportedTargetText: string;
    category: string;
    details: string;
    reporterUserId?: string;
    reporterGuestId?: string;
  }): Promise<boolean> {
    const supabase = getSupabaseClient();
    if (!supabase) return true;

    try {
      const { error } = await supabase.from('reports').insert({
        reported_target_text: report.reportedTargetText,
        category: report.category,
        details: report.details,
        reporter_user_id: report.reporterUserId || null,
        reporter_guest_id: report.reporterGuestId || null,
        status: 'received',
      });
      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Subscribe to direct messages via secure Supabase Realtime channel
   */
  subscribeToDM(convId: string, userId: string, onMessage: (msg: ChatMessage) => void): () => void {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};

    const channelName = `dm:${convId}:${userId}`;
    
    // Direct conversation channels are usually unique per instance but we still share to be safe
    let entry = sharedChannels.get(channelName);
    if (!entry) {
      const channel = supabase.channel(channelName);
      entry = { channel, refs: 0, listeners: new Set() };
      sharedChannels.set(channelName, entry);

      channel
        .on('broadcast', { event: 'new_dm' }, (payload) => {
          entry!.listeners.forEach(l => l(payload.payload));
        })
        .subscribe();
    }

    entry.refs++;
    const listener = (msg: ChatMessage) => onMessage(msg);
    entry.listeners.add(listener);

    return () => {
      const currentEntry = sharedChannels.get(channelName);
      if (currentEntry) {
        currentEntry.listeners.delete(listener);
        currentEntry.refs--;
        if (currentEntry.refs <= 0) {
          supabase.removeChannel(currentEntry.channel);
          sharedChannels.delete(channelName);
        }
      }
    };
  },

  /**
   * Broadcast DM via secure Supabase Realtime channel
   */
  async broadcastDM(convId: string, recipientId: string, message: ChatMessage, overrideClient?: any): Promise<string> {
    const supabase = overrideClient || getSupabaseClient();
    if (!supabase) return 'no_client';
    try {
      const channel = supabase.channel(`dm:${convId}:${recipientId}`);
      const status = await channel.send({
        type: 'broadcast',
        event: 'new_dm',
        payload: message,
      });
      return status;
    } catch (e) {
      console.error('[VX-DM] broadcastDM error:', e);
      return 'error';
    }
  },

  /**
   * Subscribe to direct message notifications for a specific user via secure Supabase broadcast
   */
  subscribeToUserDMs(userId: string, onMessage: (conversationId: string, message: ChatMessage) => void): () => void {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};

    const channelName = `user_dm:${userId}`;
    
    let entry = sharedChannels.get(channelName);
    if (!entry) {
      console.log(`[VX-DM] Creating shared user_dm channel: ${channelName}`);
      const channel = supabase.channel(channelName);
      entry = { channel, refs: 0, listeners: new Set() };
      sharedChannels.set(channelName, entry);

      channel
        .on('broadcast', { event: 'incoming_dm' }, (payload) => {
          console.log(`[VX-DM] [${channelName}] Received incoming_dm:`, payload.payload?.message?.id);
          entry!.listeners.forEach(l => l(payload.payload.conversationId, payload.payload.message));
        })
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[VX-DM] [${channelName}] Subscription success`);
          } else {
            console.warn(`[VX-DM] [${channelName}] Subscription status: ${status}`, err || '');
          }
        });


    }

    entry.refs++;
    const listener = (conversationId: string, message: ChatMessage) => onMessage(conversationId, message);
    entry.listeners.add(listener);

    return () => {
      const currentEntry = sharedChannels.get(channelName);
      if (currentEntry) {
        currentEntry.listeners.delete(listener);
        currentEntry.refs--;
        if (currentEntry.refs <= 0) {
          console.log(`[VX-DM] Final cleanup for shared channel: ${channelName}`);
          supabase.removeChannel(currentEntry.channel);
          sharedChannels.delete(channelName);
        }
      }
    };
  },

  /**
   * Broadcast event to a specific user via secure Supabase Realtime channel
   */
  async broadcastToUser(userId: string, event: string, payload: any, overrideClient?: any): Promise<string> {
    const supabase = overrideClient || getSupabaseClient();
    if (!supabase) return 'no_client';
    try {
      const channel = supabase.channel(`user_dm:${userId}`);
      const status = await channel.send({
        type: 'broadcast',
        event: event,
        payload: payload,
      });
      return status;
    } catch (e) {
      console.error(`[VX-DM] broadcastToUser (${event}) error:`, e);
      return 'error';
    }
  },
};

