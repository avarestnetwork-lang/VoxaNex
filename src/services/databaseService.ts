import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { ROOMS_CONFIG } from '../config/voxanexConfig';
import { Room, ChatMessage, SafetyReport, ForumTopic, BlogArticle } from '../types';

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
  broadcastMessage(roomId: string, message: ChatMessage) {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const channel = supabase.channel(`room_hub:${roomId}`);
      channel.send({
        type: 'broadcast',
        event: 'new_message',
        payload: message,
      });
    } catch (e) {
      console.warn('[VX-RT] Failed to broadcast message:', e);
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
      this.broadcastMessage(params.roomId, savedMsg);

      return savedMsg;
    } catch {
      this.broadcastMessage(params.roomId, newMsg);
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
    
    // Clean up any existing channel with the same name
    const existingChannel = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

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

    const channel = supabase
      .channel(channelName, { config: { broadcast: { self: false } } })
      .on(
        'broadcast',
        { event: 'new_message' },
        (payload: any) => {
          const msg = payload?.payload;
          if (msg && msg.roomId === roomId) {
            console.log(`[VX-RT] Broadcast message received for room ${roomId}:`, msg.id);
            markAndEmit(msg);
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
            console.log(`[VX-RT] INSERT event received for room ${roomId}:`, row.id);
            markAndEmit({
              id: row.id,
              roomId: row.room_id,
              senderId: row.sender_user_id || row.sender_guest_id || 'usr',
              senderNickname: row.sender_nickname,
              senderAvatar: row.sender_avatar,
              content: row.content,
              timestamp: row.created_at,
              status: 'delivered',
            });
          }
        }
      )
      .subscribe((status, err) => {
        console.log(`[VX-RT] Subscription status for ${channelName}: ${status}`, err || '');
      });

    return () => {
      console.log(`[VX-RT] Unsubscribing: ${channelName}`);
      supabase.removeChannel(channel);
    };
  },

  /**
   * Track presence state via Supabase Realtime Presence
   */
  trackPresence(roomId: string, member: { id: string; nickname: string; avatar: string; isGuest: boolean; gender?: string }, onSync: (members: any[]) => void): () => void {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};

    const channelName = `public_room_presence:${roomId}`;
    
    // Clean up any existing channel with the same name to avoid "callbacks after subscribe" errors
    const existingChannel = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

    let channel: any = null;
    try {
      console.log('[VX-PRESENCE] Initializing channel:', channelName, 'for user:', member.id.slice(0, 8));
      channel = supabase.channel(channelName, {
        config: {
          presence: {
            key: member.id,
          },
        },
      });

      // Register ALL callbacks BEFORE calling subscribe()
      channel
        .on('presence', { event: 'sync' }, () => {
          try {
            const state = channel.presenceState();
            console.log('[VX-PRESENCE] Sync event received for room:', roomId, 'state keys:', Object.keys(state));
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
            console.log('[VX-PRESENCE] Aggregated online count:', members.length);
            onSync(members);
          } catch (err) {
            console.warn('[VX-PRESENCE] Error processing presence sync:', err);
          }
        })
        .subscribe(async (status: string, err?: any) => {
          console.log('[VX-PRESENCE] Subscription status:', status, 'room:', roomId, err || '');
          if (status === 'SUBSCRIBED' && channel) {
            try {
              await channel.track({
                id: member.id,
                nickname: member.nickname,
                avatar: member.avatar,
                isGuest: member.isGuest,
                gender: member.gender,
                lastSeen: Date.now(),
              });
              console.log('[VX-PRESENCE] Successfully tracked presence for:', member.id.slice(0, 8));
            } catch (trackErr) {
              console.warn('[VX-PRESENCE] Failed to track presence payload:', trackErr);
            }
          }
        });
    } catch (initErr) {
      console.warn('[VX-PRESENCE] Channel initialization error:', initErr);
    }

    return () => {
      try {
        if (channel) {
          channel.untrack();
          supabase.removeChannel(channel);
        }
      } catch {}
    };
  },

  /**
   * Broadcast presence update (compatibility shim)
   */
  broadcastPresence(roomId: string, presence: any) {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      supabase.channel(`public_room_presence:${roomId}`).send({
        type: 'broadcast',
        event: 'presence',
        payload: presence,
      });
    } catch {}
  },

  /**
   * Subscribe to presence updates (compatibility shim)
   */
  subscribePresence(roomId: string, onUpdate: (presence: any) => void) {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};

    const channel = supabase.channel(`public_room_presence:${roomId}`);
    channel
      .on('broadcast', { event: 'presence' }, (payload) => {
        onUpdate(payload.payload);
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
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
    
    // Clean up any existing channel with the same name
    const existingChannel = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

    // Use authorized private channel
    const channel = supabase.channel(channelName);
    channel
      .on('broadcast', { event: 'new_dm' }, (payload) => {
        onMessage(payload.payload);
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  },

  /**
   * Broadcast DM via secure Supabase Realtime channel
   */
  broadcastDM(convId: string, recipientId: string, message: ChatMessage, overrideClient?: any) {
    const supabase = overrideClient || getSupabaseClient();
    if (!supabase) {
      console.warn('[VX-DM] Cannot broadcastDM: Supabase client not initialized');
      return;
    }
    try {
      supabase.channel(`dm:${convId}:${recipientId}`).send({
        type: 'broadcast',
        event: 'new_dm',
        payload: message,
      }).then((res: any) => {
        if (res !== 'ok') console.warn(`[VX-DM] broadcastDM state: ${res} for conv: ${convId}`);
      });
    } catch (e) {
      console.error('[VX-DM] broadcastDM exception:', e);
    }
  },

  /**
   * Subscribe to direct message notifications for a specific user via secure Supabase broadcast
   */
  /**
   * Subscribe to direct message notifications for a specific user via secure Supabase broadcast
   */
  subscribeToUserDMs(userId: string, onMessage: (conversationId: string, message: ChatMessage) => void): () => void {
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.warn('[VX-DM] Cannot subscribeToUserDMs: Supabase client not initialized');
      return () => {};
    }

    const channelName = `user_dm:${userId}`;
    
    // Clean up any existing channel with the same name
    const existingChannel = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (existingChannel) {
      console.log(`[VX-DM] Removing existing channel for: ${channelName}`);
      supabase.removeChannel(existingChannel);
    }

    const channel = supabase.channel(channelName);
    channel
      .on('broadcast', { event: 'incoming_dm' }, (payload) => {
        onMessage(payload.payload.conversationId, payload.payload.message);
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') {
            console.warn(`[VX-DM] subscribeToUserDMs status for ${channelName}: ${status}`);
        } else {
            console.log(`[VX-DM] subscribeToUserDMs success for ${channelName}`);
        }
      });

    return () => {
      try {
        console.log(`[VX-DM] Unsubscribing from: ${channelName}`);
        supabase.removeChannel(channel);
      } catch {}
    };
  },

  /**
   * Broadcast event to a specific user via secure Supabase Realtime channel
   */
  broadcastToUser(userId: string, event: string, payload: any, overrideClient?: any) {
    const supabase = overrideClient || getSupabaseClient();
    if (!supabase) {
      console.warn(`[VX-DM] Cannot broadcastToUser (${event}): Supabase client not initialized`);
      return;
    }
    try {
      supabase.channel(`user_dm:${userId}`).send({
        type: 'broadcast',
        event: event,
        payload: payload,
      }).then((res: any) => {
        if (res !== 'ok') console.warn(`[VX-DM] broadcastToUser (${event}) state: ${res} for user: ${userId}`);
      });
    } catch (e) {
      console.error(`[VX-DM] broadcastToUser (${event}) exception:`, e);
    }
  },
};
