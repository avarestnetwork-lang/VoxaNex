import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { ROOMS_CONFIG } from '../config/voxanexConfig';
import { Room, ChatMessage, SafetyReport, ForumTopic, BlogArticle } from '../types';

export interface RoomPresenceMember {
  id: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  gender?: string;
  onlineVisibility?: 'online' | 'away' | 'stealth_invisible';
  lastSeen: number;
}

export type RoomPresenceSyncStatus = 'connecting' | 'synced' | 'unavailable' | 'error';

export interface TrackedPresencePayload {
  id: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  gender?: string;
  onlineVisibility?: 'online' | 'away' | 'stealth_invisible';
}

interface PresenceChannelEntry {
  channel: any;
  refs: number;
  trackerRefs: number;
  trackedMember: TrackedPresencePayload | null;
  listeners: Set<(members: RoomPresenceMember[]) => void>;
  statusListeners: Set<(status: RoomPresenceSyncStatus) => void>;
  syncStatus: RoomPresenceSyncStatus;
}

const presenceChannelRegistries = new WeakMap<object, Map<string, PresenceChannelEntry>>();

function getPresenceRegistry(supabase: any): Map<string, PresenceChannelEntry> {
  let reg = presenceChannelRegistries.get(supabase);
  if (!reg) {
    reg = new Map();
    presenceChannelRegistries.set(supabase, reg);
  }
  return reg;
}

/**
 * Extract unique, non-stealth active members from Supabase Realtime presenceState().
 * Preserves the platform's unique user/guest identity model (keyed by member.id).
 * Transient duplicate presence_refs for the same member.id (e.g., reconnects or multiple tabs)
 * are deduplicated so unique active counts do not double-count.
 */
export function extractActivePresenceMembers(
  state: Record<string, any> | null | undefined
): RoomPresenceMember[] {
  if (!state || typeof state !== 'object') {
    return [];
  }

  const deduped = new Map<string, RoomPresenceMember>();

  Object.entries(state).forEach(([presenceKey, presences]) => {
    if (!Array.isArray(presences)) return;
    presences.forEach((p: any) => {
      if (!p || typeof p !== 'object') return;
      if (
        p.onlineVisibility === 'stealth_invisible' ||
        p.stealth === true ||
        p.invisible === true
      ) {
        return;
      }

      const rawId =
        typeof p.id === 'string' && p.id.trim()
          ? p.id.trim()
          : typeof p.user_id === 'string' && p.user_id.trim()
            ? p.user_id.trim()
            : typeof presenceKey === 'string' && presenceKey.trim()
              ? presenceKey.trim()
              : '';

      if (!rawId) return;

      const lastSeen =
        typeof p.lastSeen === 'number' && Number.isFinite(p.lastSeen)
          ? p.lastSeen
          : Date.now();

      const existing = deduped.get(rawId);
      if (!existing || lastSeen >= existing.lastSeen) {
        deduped.set(rawId, {
          id: rawId,
          nickname: typeof p.nickname === 'string' && p.nickname.trim() ? p.nickname : 'User',
          avatar: typeof p.avatar === 'string' && p.avatar ? p.avatar : '👤',
          isGuest: Boolean(p.isGuest),
          gender: p.gender,
          onlineVisibility: p.onlineVisibility,
          lastSeen,
        });
      }
    });
  });

  return Array.from(deduped.values());
}

// Internal state for managing shared realtime channels to prevent "callbacks after subscribe" and accidental disconnects
const sharedChannels = new Map<string, {
  channel: any;
  refs: number;
  listeners: Set<(...args: any[]) => void>;
  status?: string;
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
   * Resolve a roomId (which could be a slug or a UUID) to the authoritative UUID
   */
  async resolveRoomId(roomId: string, overrideClient?: any): Promise<string> {
    if (!roomId) return roomId;
    // If it's already a UUID, return as is
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId)) {
      return roomId;
    }

    const supabase = overrideClient || getSupabaseClient();
    if (!supabase) return roomId;

    try {
      const slug = roomId.replace(/^room-/, '');
      const { data } = await supabase
        .from('chat_rooms')
        .select('id')
        .eq('slug', slug)
        .single();
      
      return data?.id || roomId;
    } catch {
      return roomId;
    }
  },

  /**
   * Generate a deterministic UUID for a 1-on-1 conversation based on participant IDs
   */
  async getDeterministicConvId(userId1: string, userId2: string): Promise<string> {
    const sorted = [userId1, userId2].sort();
    const input = `conv:${sorted[0]}:${sorted[1]}`;
    
    // Simple deterministic UUID-like string from hash if full UUID v5 isn't available
    // In production, we'll try to use a real UUID format that the DB accepts.
    try {
      const msgUint8 = new TextEncoder().encode(input);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      // Format as UUID: 8-4-4-4-12
      return [
        hashHex.substring(0, 8),
        hashHex.substring(8, 12),
        hashHex.substring(12, 16),
        hashHex.substring(16, 20),
        hashHex.substring(20, 32)
      ].join('-');
    } catch {
      // Fallback to the legacy string if crypto fails (unlikely)
      return `conv_${sorted[0]}_${sorted[1]}`;
    }
  },

  /**
   * Fetch messages for a specific room
   */
  async getRoomMessages(roomId: string): Promise<ChatMessage[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    try {
      // Ensure we use the real UUID for the query
      const realId = await this.resolveRoomId(roomId);

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', realId)
        .order('created_at', { ascending: true })
        .limit(50);

      if (error || !data) return [];

      return data.map((m: any) => ({
        id: m.id,
        roomId: m.room_id,
        senderId: m.sender_user_id || m.sender_guest_id || 'anonymous',
        senderNickname: m.sender_nickname,
        senderAvatar: m.sender_avatar,
        content: m.content || '',
        mediaUrl: m.media_url || undefined,
        mediaType: m.media_type || undefined,
        linkPreview: m.link_preview || undefined,
        clientNonce: m.client_nonce || undefined,
        timestamp: m.created_at,
        isSystem: m.is_system,
        status: 'delivered' as const,
      }));
    } catch {
      return [];
    }
  },

  /**
   * Fetch messages for a specific conversation
   */
  async getConversationMessages(convId: string, userId?: string, overrideClient?: any): Promise<ChatMessage[]> {
    const supabase = overrideClient || getSupabaseClient();
    if (!supabase) return [];

    try {
      // Resolve deterministic identity if legacy string provided
      let dbConvId = convId;
      if (userId && convId.startsWith('conv_') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)) {
          const parts = convId.replace('conv_', '').split('_');
          const partnerId = parts.find(p => p !== userId);
          if (partnerId) {
              dbConvId = await this.getDeterministicConvId(userId, partnerId);
          }
      }

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', dbConvId)
        .order('created_at', { ascending: true });

      if (error || !data) return [];

      return data.map((m: any) => ({
        id: m.id,
        conversationId: m.conversation_id,
        senderId: m.sender_user_id || m.sender_guest_id || 'anonymous',
        senderNickname: m.sender_nickname,
        senderAvatar: m.sender_avatar,
        content: m.content || '',
        mediaUrl: m.media_url || undefined,
        mediaType: m.media_type || undefined,
        linkPreview: m.link_preview || undefined,
        clientNonce: m.client_nonce || undefined,
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
      // Resolve ID to authoritative UUID for channel consistency
      const realId = await this.resolveRoomId(roomId, overrideClient);
      const channelName = `room_hub:${realId}`;
      
      const entry = sharedChannels.get(channelName);
      
      // 1. If an existing channel is already SUBSCRIBED, send immediately
      if (entry?.channel && entry.status === 'SUBSCRIBED') {
        const status = await entry.channel.send({
          type: 'broadcast',
          event: 'new_message',
          payload: { ...message, roomId: realId },
        });
        return status;
      }

      // 2. If channel exists but is still establishing subscription, wait for SUBSCRIBED
      if (entry?.channel) {
        const ready = await new Promise<boolean>((resolve) => {
          if (entry.status === 'SUBSCRIBED') return resolve(true);
          const t = setTimeout(() => resolve(false), 2000);
          const interval = setInterval(() => {
            if (entry.status === 'SUBSCRIBED') {
              clearInterval(interval);
              clearTimeout(t);
              resolve(true);
            }
          }, 80);
        });
        if (ready && entry.channel) {
          return await entry.channel.send({
            type: 'broadcast',
            event: 'new_message',
            payload: { ...message, roomId: realId },
          });
        }
      }

      // 3. Otherwise, establish a dedicated broadcast channel and wait for SUBSCRIBED status
      const tempChannel = supabase.channel(channelName, { config: { broadcast: { self: false } } });
      return await new Promise<string>((resolve) => {
        let finished = false;
        const timeout = setTimeout(() => {
          if (!finished) {
            finished = true;
            try { supabase.removeChannel(tempChannel); } catch {}
            resolve('timed_out');
          }
        }, 3500);

        tempChannel.subscribe(async (status: string) => {
          if (finished) return;
          if (status === 'SUBSCRIBED') {
            finished = true;
            clearTimeout(timeout);
            try {
              const resStatus = await tempChannel.send({
                type: 'broadcast',
                event: 'new_message',
                payload: { ...message, roomId: realId },
              });
              resolve(resStatus);
            } catch (err) {
              resolve('error');
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            finished = true;
            clearTimeout(timeout);
            resolve(status);
          }
        });
      });
    } catch (e) {
      console.warn('[VX-RT] Failed to broadcast message:', e);
      return 'error';
    }
  },

  /**
   * Atomic message persistence using privileged database function.
   * Prevents duplicates at the database level using ON CONFLICT.
   */
  async atomicMessage(params: {
    id: string;
    roomId?: string;
    conversationId?: string;
    senderUserId?: string;
    senderGuestId?: string;
    senderNickname: string;
    senderAvatar: string;
    content: string;
    clientNonce?: string;
    mediaUrl?: string;
    mediaType?: 'gif' | 'image' | 'audio';
    linkPreview?: any;
  }, overrideClient?: any): Promise<{ success: boolean; inserted: boolean; message?: ChatMessage; error?: string }> {
    const supabase = overrideClient || getSupabaseClient();
    if (!supabase) return { success: false, inserted: false, error: 'Supabase client not configured' };

    try {
      let realRoomId = null;
      if (params.roomId) {
        realRoomId = await this.resolveRoomId(params.roomId, overrideClient);
      }

      // Call the privileged RPC function
      const { data, error } = await supabase.rpc('upsert_message', {
        p_id: params.id,
        p_room_id: realRoomId,
        p_conversation_id: params.conversationId || null,
        p_sender_user_id: params.senderUserId || null,
        p_sender_guest_id: params.senderGuestId || null,
        p_sender_nickname: params.senderNickname,
        p_sender_avatar: params.senderAvatar,
        p_content: params.content,
        p_client_nonce: params.clientNonce || null,
        p_media_url: params.mediaUrl || null,
        p_media_type: params.mediaType || null,
        p_link_preview: params.linkPreview || null
      });

      if (error) {
        console.error('[DatabaseService] upsert_message error:', error);
        return { success: false, inserted: false, error: error.message };
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { success: false, inserted: false, error: 'Database did not return the persisted message.' };

      const wasInserted = row.inserted === true || row.inserted === 'true';

      const message: ChatMessage = {
        id: row.id,
        roomId: row.room_id,
        conversationId: row.conversation_id,
        senderId: row.sender_user_id || row.sender_guest_id || 'usr',
        senderNickname: row.sender_nickname,
        senderAvatar: row.sender_avatar,
        content: row.content,
        mediaUrl: row.media_url || params.mediaUrl,
        mediaType: row.media_type || params.mediaType,
        linkPreview: row.link_preview || params.linkPreview,
        timestamp: row.created_at,
        clientNonce: row.client_nonce,
        isSystem: row.is_system,
        status: 'delivered'
      };

      return { success: true, inserted: wasInserted, message };
    } catch (err: any) {
      console.error('[DatabaseService] atomicMessage exception:', err);
      return { success: false, inserted: false, error: err.message || 'Internal database error' };
    }
  },

  /**
   * Send a message to a public room, persisting to Supabase and broadcasting.
   * Fails closed: if persistence fails or client is unavailable, never creates an
   * unpersisted in-memory message and never broadcasts.
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
    mediaType?: 'gif' | 'image' | 'audio';
    clientNonce?: string;
  }): Promise<ChatMessage | null> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.error('[DatabaseService] sendRoomMessage failed: Supabase client unavailable.');
      return null;
    }

    const msgId = params.id || crypto.randomUUID();
    const result = await this.atomicMessage({
      id: msgId,
      roomId: params.roomId,
      senderUserId: params.senderUserId,
      senderGuestId: params.senderGuestId,
      senderNickname: params.senderNickname,
      senderAvatar: params.senderAvatar,
      content: params.content,
      clientNonce: params.clientNonce,
      mediaUrl: params.mediaUrl,
      mediaType: params.mediaType
    }, supabase);

    if (result.success && result.message) {
      // Only broadcast on genuine fresh insertions, suppressing duplicate broadcasts
      if (result.inserted) {
        await this.broadcastMessage(params.roomId, result.message);
      }
      return result.message;
    }

    console.error('[DatabaseService] sendRoomMessage persistence failed:', result.error);
    return null;
  },

  /**
   * Subscribe to Supabase Realtime changes and WebSocket broadcasts for a room
   */
  async subscribeToRoom(roomId: string, onMessage: (msg: ChatMessage) => void): Promise<() => void> {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};

    // Ensure we use the real UUID for the Supabase subscription
    const realId = await this.resolveRoomId(roomId);

    const channelName = `room_hub:${realId}`;
    
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
            if (msg) {
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
            filter: `room_id=eq.${realId}`,
          },
          (payload: any) => {
            const row = payload?.new;
            if (row) {
              console.log(`[VX-RT] [${channelName}] Received INSERT:`, row.id);
              const msg: ChatMessage = {
                id: row.id,
                roomId: row.room_id,
                senderId: row.sender_user_id || row.sender_guest_id || 'usr',
                senderNickname: row.sender_nickname,
                senderAvatar: row.sender_avatar,
                content: row.content || '',
                mediaUrl: row.media_url || undefined,
                mediaType: row.media_type || undefined,
                linkPreview: row.link_preview || undefined,
                clientNonce: row.client_nonce || undefined,
                timestamp: row.created_at,
                status: 'delivered' as const,
              };
              entry!.listeners.forEach(l => l(msg));
            }
          }
        )
        .subscribe((status, err) => {
          if (entry) {
            entry.status = status;
          }
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
   * Passively observe a single room's Supabase Realtime Presence without tracking the viewer as an active participant.
   */
  observeRoomPresence(
    roomId: string,
    onSync: (members: RoomPresenceMember[]) => void,
    onStatus?: (status: RoomPresenceSyncStatus) => void,
    overrideClient?: any
  ): () => void {
    const supabase = overrideClient || getSupabaseClient();
    if (!supabase || !roomId) {
      onStatus?.('unavailable');
      return () => {};
    }

    const channelName = `public_room_presence:${roomId}`;
    const registry = getPresenceRegistry(supabase);
    let entry = registry.get(channelName);

    const emitCurrentState = (targetEntry: PresenceChannelEntry) => {
      try {
        const state =
          typeof targetEntry.channel.presenceState === 'function'
            ? targetEntry.channel.presenceState()
            : {};
        const members = extractActivePresenceMembers(state);
        targetEntry.listeners.forEach((l) => l(members));
      } catch (err) {
        console.warn('[VX-PRESENCE] Sync error:', err);
      }
    };

    if (!entry) {
      const channel = supabase.channel(channelName, {
        config: {
          presence: {
            enabled: true,
          },
        },
      });

      const newEntry: PresenceChannelEntry = {
        channel,
        refs: 0,
        trackerRefs: 0,
        trackedMember: null,
        listeners: new Set(),
        statusListeners: new Set(),
        syncStatus: 'connecting',
      };
      entry = newEntry;
      registry.set(channelName, newEntry);

      const handlePresenceEvent = () => emitCurrentState(newEntry);

      channel
        .on('presence', { event: 'sync' }, handlePresenceEvent)
        .on('presence', { event: 'join' }, handlePresenceEvent)
        .on('presence', { event: 'leave' }, handlePresenceEvent)
        .subscribe(async (status: string, err?: any) => {
          if (status === 'SUBSCRIBED') {
            newEntry.syncStatus = 'synced';
            newEntry.statusListeners.forEach((sl) => sl('synced'));
            if (newEntry.trackedMember && typeof channel.track === 'function') {
              try {
                await channel.track({
                  ...newEntry.trackedMember,
                  lastSeen: Date.now(),
                });
              } catch (trackErr) {
                console.error(`[VX-PRESENCE] [${channelName}] Track failed:`, trackErr);
              }
            }
            emitCurrentState(newEntry);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.warn(`[VX-PRESENCE] [${channelName}] Status: ${status}`, err || '');
            newEntry.syncStatus = 'error';
            newEntry.statusListeners.forEach((sl) => sl('error'));
          }
        });
    }

    entry.refs++;
    const listener = (members: RoomPresenceMember[]) => onSync(members);
    entry.listeners.add(listener);

    const statusListener = onStatus ? (s: RoomPresenceSyncStatus) => onStatus(s) : null;
    if (statusListener) {
      entry.statusListeners.add(statusListener);
      statusListener(entry.syncStatus);
    }

    if (entry.syncStatus === 'synced') {
      try {
        const state =
          typeof entry.channel.presenceState === 'function'
            ? entry.channel.presenceState()
            : {};
        onSync(extractActivePresenceMembers(state));
      } catch {
        // non-fatal
      }
    }

    return () => {
      const currentEntry = registry.get(channelName);
      if (!currentEntry) return;
      currentEntry.listeners.delete(listener);
      if (statusListener) {
        currentEntry.statusListeners.delete(statusListener);
      }
      currentEntry.refs = Math.max(0, currentEntry.refs - 1);
      if (currentEntry.refs <= 0) {
        if (currentEntry.trackedMember && typeof currentEntry.channel.untrack === 'function') {
          currentEntry.trackedMember = null;
          Promise.resolve(currentEntry.channel.untrack()).catch(() => {});
        }
        if (typeof supabase.removeChannel === 'function') {
          supabase.removeChannel(currentEntry.channel);
        }
        registry.delete(channelName);
      }
    };
  },

  /**
   * Passively observe live participant counts across multiple rooms for directory views.
   * Never calls channel.track(), so directory visitors are never counted as active participants.
   */
  observeRoomsPresence(
    roomIds: string[],
    onUpdate: (snapshot: {
      counts: Record<string, number>;
      statuses: Record<string, RoomPresenceSyncStatus>;
    }) => void,
    overrideClient?: any
  ): () => void {
    const uniqueRoomIds = Array.from(new Set(roomIds.filter((id) => typeof id === 'string' && id.trim())));
    if (uniqueRoomIds.length === 0) {
      onUpdate({ counts: {}, statuses: {} });
      return () => {};
    }

    const supabase = overrideClient || getSupabaseClient();
    const counts: Record<string, number> = {};
    const statuses: Record<string, RoomPresenceSyncStatus> = {};

    if (!supabase) {
      uniqueRoomIds.forEach((id) => {
        statuses[id] = 'unavailable';
      });
      onUpdate({ counts: { ...counts }, statuses: { ...statuses } });
      return () => {};
    }

    let isDisposed = false;
    const emitSnapshot = () => {
      if (isDisposed) return;
      onUpdate({
        counts: { ...counts },
        statuses: { ...statuses },
      });
    };

    const unsubscribers = uniqueRoomIds.map((roomId) => {
      statuses[roomId] = 'connecting';
      return this.observeRoomPresence(
        roomId,
        (members) => {
          counts[roomId] = Math.max(0, members.length);
          emitSnapshot();
        },
        (status) => {
          statuses[roomId] = status;
          emitSnapshot();
        },
        supabase
      );
    });

    emitSnapshot();

    return () => {
      isDisposed = true;
      unsubscribers.forEach((unsub) => unsub());
    };
  },

  /**
   * Track presence state and listen for updates via Supabase Realtime Presence.
   * When member.onlineVisibility === 'stealth_invisible', observes room presence passively without tracking self.
   */
  trackPresence(
    roomId: string,
    member: TrackedPresencePayload,
    onSync: (members: RoomPresenceMember[]) => void,
    overrideClient?: any
  ): () => void {
    if (member.onlineVisibility === 'stealth_invisible') {
      return this.observeRoomPresence(roomId, onSync, undefined, overrideClient);
    }

    const supabase = overrideClient || getSupabaseClient();
    if (!supabase || !roomId || !member?.id) return () => {};

    const channelName = `public_room_presence:${roomId}`;
    const registry = getPresenceRegistry(supabase);
    let entry = registry.get(channelName);

    const emitCurrentState = (targetEntry: PresenceChannelEntry) => {
      try {
        const state =
          typeof targetEntry.channel.presenceState === 'function'
            ? targetEntry.channel.presenceState()
            : {};
        const members = extractActivePresenceMembers(state);
        targetEntry.listeners.forEach((l) => l(members));
      } catch (err) {
        console.warn('[VX-PRESENCE] Sync error:', err);
      }
    };

    if (!entry) {
      console.log('[VX-PRESENCE] Initializing shared presence channel:', channelName);
      const channel = supabase.channel(channelName, {
        config: {
          presence: {
            key: member.id,
          },
        },
      });

      const newEntry: PresenceChannelEntry = {
        channel,
        refs: 0,
        trackerRefs: 0,
        trackedMember: member,
        listeners: new Set(),
        statusListeners: new Set(),
        syncStatus: 'connecting',
      };
      entry = newEntry;
      registry.set(channelName, newEntry);

      const handlePresenceEvent = () => emitCurrentState(newEntry);

      // Register ALL event types before subscribing
      channel
        .on('presence', { event: 'sync' }, handlePresenceEvent)
        .on('presence', { event: 'join' }, handlePresenceEvent)
        .on('presence', { event: 'leave' }, handlePresenceEvent)
        .on('broadcast', { event: 'presence' }, () => {
          // Compatibility shim for legacy broadcast-based presence
        })
        .subscribe(async (status: string, err?: any) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[VX-PRESENCE] [${channelName}] Subscribed successfully`);
            newEntry.syncStatus = 'synced';
            newEntry.statusListeners.forEach((sl) => sl('synced'));
            if (newEntry.trackedMember && typeof channel.track === 'function') {
              try {
                await channel.track({
                  id: newEntry.trackedMember.id,
                  nickname: newEntry.trackedMember.nickname,
                  avatar: newEntry.trackedMember.avatar,
                  isGuest: newEntry.trackedMember.isGuest,
                  gender: newEntry.trackedMember.gender,
                  onlineVisibility: newEntry.trackedMember.onlineVisibility,
                  lastSeen: Date.now(),
                });
              } catch (trackErr) {
                console.error(`[VX-PRESENCE] [${channelName}] Track failed:`, trackErr);
              }
            }
            emitCurrentState(newEntry);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.warn(`[VX-PRESENCE] [${channelName}] Status: ${status}`, err || '');
            newEntry.syncStatus = 'error';
            newEntry.statusListeners.forEach((sl) => sl('error'));
          }
        });
    } else {
      entry.trackedMember = member;
      if (entry.syncStatus === 'synced' && typeof entry.channel.track === 'function') {
        Promise.resolve(
          entry.channel.track({
            id: member.id,
            nickname: member.nickname,
            avatar: member.avatar,
            isGuest: member.isGuest,
            gender: member.gender,
            onlineVisibility: member.onlineVisibility,
            lastSeen: Date.now(),
          })
        ).catch((trackErr) => {
          console.error(`[VX-PRESENCE] [${channelName}] Track failed:`, trackErr);
        });
      }
    }

    entry.refs++;
    entry.trackerRefs++;
    const listener = (members: RoomPresenceMember[]) => onSync(members);
    entry.listeners.add(listener);

    if (entry.syncStatus === 'synced') {
      try {
        const state =
          typeof entry.channel.presenceState === 'function'
            ? entry.channel.presenceState()
            : {};
        onSync(extractActivePresenceMembers(state));
      } catch {
        // non-fatal
      }
    }

    return () => {
      const currentEntry = registry.get(channelName);
      if (currentEntry) {
        currentEntry.listeners.delete(listener);
        currentEntry.refs = Math.max(0, currentEntry.refs - 1);
        currentEntry.trackerRefs = Math.max(0, currentEntry.trackerRefs - 1);
        if (currentEntry.trackerRefs <= 0 && currentEntry.trackedMember) {
          currentEntry.trackedMember = null;
          if (typeof currentEntry.channel.untrack === 'function') {
            Promise.resolve(currentEntry.channel.untrack()).catch(() => {});
          }
        }
        if (currentEntry.refs <= 0) {
          console.log('[VX-PRESENCE] Cleaning up shared presence channel:', channelName);
          if (typeof supabase.removeChannel === 'function') {
            supabase.removeChannel(currentEntry.channel);
          }
          registry.delete(channelName);
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
      const entry = getPresenceRegistry(supabase).get(channelName);
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
  async subscribeToDM(convId: string, userId: string, onMessage: (msg: ChatMessage) => void): Promise<() => void> {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};

    // Resolve deterministic identity
    let dbConvId = convId;
    if (convId.startsWith('conv_') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)) {
        const parts = convId.replace('conv_', '').split('_');
        const partnerId = parts.find(p => p !== userId);
        if (partnerId) {
            dbConvId = await this.getDeterministicConvId(userId, partnerId);
        }
    }

    const channelName = `dm:${dbConvId}:${userId}`;
    
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
      // Resolve deterministic identity
      let dbConvId = convId;
      if (convId.startsWith('conv_') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)) {
          dbConvId = await this.getDeterministicConvId(message.senderId, recipientId);
      }

      const channel = supabase.channel(`dm:${dbConvId}:${recipientId}`);
      const status = await channel.send({
        type: 'broadcast',
        event: 'new_dm',
        payload: { ...message, conversationId: dbConvId },
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
      // For incoming DMs, ensure conversationId is resolved to UUID if it's a legacy string
      if (event === 'incoming_dm' && payload?.conversationId && payload?.message?.senderId) {
          const convId = payload.conversationId;
          if (convId.startsWith('conv_') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)) {
              payload.conversationId = await this.getDeterministicConvId(payload.message.senderId, userId);
              if (payload.message) payload.message.conversationId = payload.conversationId;
          }
      }

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

