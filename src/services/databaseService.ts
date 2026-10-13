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
   * Send a message to a public room
   */
  async sendRoomMessage(params: {
    roomId: string;
    senderUserId?: string;
    senderGuestId?: string;
    senderNickname: string;
    senderAvatar: string;
    content: string;
  }): Promise<ChatMessage | null> {
    const supabase = getSupabaseClient();
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      roomId: params.roomId,
      senderId: params.senderUserId || params.senderGuestId || 'usr',
      senderNickname: params.senderNickname,
      senderAvatar: params.senderAvatar,
      content: params.content,
      timestamp: new Date().toISOString(),
    };

    if (!supabase) return newMsg;

    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          room_id: params.roomId,
          sender_user_id: params.senderUserId || null,
          sender_guest_id: params.senderGuestId || null,
          sender_nickname: params.senderNickname,
          sender_avatar: params.senderAvatar,
          content: params.content,
        })
        .select()
        .single();

      if (error || !data) return newMsg;

      return {
        id: data.id,
        roomId: data.room_id,
        senderId: data.sender_user_id || data.sender_guest_id || 'usr',
        senderNickname: data.sender_nickname,
        senderAvatar: data.sender_avatar,
        content: data.content,
        timestamp: data.created_at,
      };
    } catch {
      return newMsg;
    }
  },

  /**
   * Subscribe to Supabase Realtime changes for a room
   */
  subscribeToRoom(roomId: string, onMessage: (msg: ChatMessage) => void) {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};

    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload: any) => {
          const row = payload.new;
          onMessage({
            id: row.id,
            roomId: row.room_id,
            senderId: row.sender_user_id || row.sender_guest_id || 'usr',
            senderNickname: row.sender_nickname,
            senderAvatar: row.sender_avatar,
            content: row.content,
            timestamp: row.created_at,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
};
