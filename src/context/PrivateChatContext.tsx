import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { DirectConversation, ChatMessage } from '../types';
import { useAuth } from './AuthContext';
import { messagingService } from '../services/messagingService';
import { guestSessionService } from '../services/guestSessionService';
import { databaseService } from '../services/databaseService';

export interface FloatingChatWindow {
  conversationId: string;
  partnerId: string;
  partnerNickname: string;
  partnerAvatar: string;
  isMinimized: boolean;
  isMaximized: boolean;
  messages: ChatMessage[];
  unreadCount: number;
  draft: string;
  isOpen: boolean;
}

interface PrivateChatContextType {
  conversations: DirectConversation[];
  openWindows: FloatingChatWindow[];
  autoOpenPrivateChats: boolean;
  setAutoOpenPrivateChats: (val: boolean) => void;
  openChat: (partner: { id: string; nickname: string; avatar: string }) => Promise<void>;
  closeChat: (conversationId: string) => void;
  minimizeChat: (conversationId: string) => void;
  maximizeChat: (conversationId: string) => void;
  sendMessage: (conversationId: string, content: string, media?: { url: string; type: 'gif' | 'image' }) => Promise<boolean>;
  markAsRead: (conversationId: string) => void;
  totalUnreadCount: number;
  latestToast: { id: string; title: string; message: string; avatar: string; conversationId: string } | null;
  clearToast: () => void;
}

const PrivateChatContext = createContext<PrivateChatContextType | undefined>(undefined);

export const PrivateChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [openWindows, setOpenWindows] = useState<FloatingChatWindow[]>([]);
  const [autoOpenPrivateChats, setAutoOpenPrivateChats] = useState<boolean>(true);
  const [latestToast, setLatestToast] = useState<{ id: string; title: string; message: string; avatar: string; conversationId: string } | null>(null);

  const activeSubscriptionsRef = useRef<Map<string, () => void>>(new Map());
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const knownConversationIdsRef = useRef<Set<string>>(new Set());

  // Play subtle notification sound
  const playBeep = () => {
    try {
      if (!user.notificationSounds) return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      // ignore audio restrictions
    }
  };

  // Add conversation ID to known set
  const trackConversation = (convId: string) => {
    knownConversationIdsRef.current.add(convId);
    try {
      const stored = Array.from(knownConversationIdsRef.current);
      localStorage.setItem(`vx_known_convs_${user.id}`, JSON.stringify(stored));
    } catch {
      // ignore
    }
  };

  // Restore known conversations from localStorage and server-backed list on mount / user change
  useEffect(() => {
    if (!user.id) return;
    async function initConvs() {
      try {
        const saved = localStorage.getItem(`vx_known_convs_${user.id}`);
        if (saved) {
          const parsed: string[] = JSON.parse(saved);
          parsed.forEach((id) => knownConversationIdsRef.current.add(id));
        }
      } catch {
        // ignore
      }

      // Fetch server-backed conversations for this user (robust for cleared localStorage / fresh browser session)
      try {
        const token = guestSessionService.getStoredToken();
        const serverConvs = await messagingService.fetchUserConversations(user.id, token || undefined);
        serverConvs.forEach((id) => knownConversationIdsRef.current.add(id));
      } catch {
        // ignore
      }
    }
    initConvs();
  }, [user.id]);

  // Open or focus a chat window with a partner
  const openChat = useCallback(async (partner: { id: string; nickname: string; avatar: string }) => {
    if (!user.id || partner.id === user.id) return;

    const sortedIds = [user.id, partner.id].sort();
    const conversationId = `conv_${sortedIds[0]}_${sortedIds[1]}`;
    trackConversation(conversationId);

    console.log('[DIAGNOSTIC] private_popup_opened', { conversationId, partnerId: partner.id });
    await messagingService.getOrCreateConversation(user.id, partner.id);

    setOpenWindows((prev) => {
      const existing = prev.find((w) => w.conversationId === conversationId);
      if (existing) {
        return prev.map((w) =>
          w.conversationId === conversationId
            ? { ...w, isOpen: true, isMinimized: false, unreadCount: 0 }
            : w
        );
      } else {
        return [
          ...prev,
          {
            conversationId,
            partnerId: partner.id,
            partnerNickname: partner.nickname,
            partnerAvatar: partner.avatar,
            isMinimized: false,
            isMaximized: false,
            messages: [],
            unreadCount: 0,
            draft: '',
            isOpen: true,
          },
        ];
      }
    });

    const res = await messagingService.fetchConversationMessages(conversationId, user.id);
    if (res.success) {
      setOpenWindows((prev) =>
        prev.map((w) =>
          w.conversationId === conversationId
            ? { ...w, messages: res.messages.length > 0 ? res.messages : w.messages }
            : w
        )
      );
    }
  }, [user.id]);

  const closeChat = useCallback((conversationId: string) => {
    setOpenWindows((prev) => prev.filter((w) => w.conversationId !== conversationId));
  }, []);

  const minimizeChat = useCallback((conversationId: string) => {
    setOpenWindows((prev) =>
      prev.map((w) => (w.conversationId === conversationId ? { ...w, isMinimized: !w.isMinimized } : w))
    );
  }, []);

  const maximizeChat = useCallback((conversationId: string) => {
    setOpenWindows((prev) =>
      prev.map((w) => (w.conversationId === conversationId ? { ...w, isMaximized: !w.isMaximized, isMinimized: false } : w))
    );
  }, []);

  const markAsRead = useCallback((conversationId: string) => {
    setOpenWindows((prev) =>
      prev.map((w) => (w.conversationId === conversationId ? { ...w, unreadCount: 0 } : w))
    );
  }, []);

  const sendMessage = useCallback(async (conversationId: string, content: string, media?: { url: string; type: 'gif' | 'image' }) => {
    const clean = content.trim();
    if ((!clean && !media) || !user.id) return false;
    trackConversation(conversationId);

    const targetWindow = openWindows.find((w) => w.conversationId === conversationId);
    if (!targetWindow) return false;

    const tempId = `temp_${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      conversationId,
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      recipientId: targetWindow.partnerId,
      content: clean,
      mediaUrl: media?.url,
      mediaType: media?.type,
      timestamp: new Date().toISOString(),
      isDirect: true,
      status: 'sending',
    };

    setOpenWindows((prev) =>
      prev.map((w) =>
        w.conversationId === conversationId ? { ...w, messages: [...w.messages, optimisticMsg], draft: '' } : w
      )
    );

    const res = await messagingService.sendConversationMessage(conversationId, {
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      recipientId: targetWindow.partnerId,
      content: clean,
      mediaUrl: media?.url,
      mediaType: media?.type,
    });

    if (res.success && res.message) {
      const confirmed = res.message;
      seenMessageIdsRef.current.add(confirmed.id);
      console.log('[DIAGNOSTIC] private_message_persisted', { messageId: confirmed.id, conversationId });
      setOpenWindows((prev) =>
        prev.map((w) =>
          w.conversationId === conversationId
            ? {
                ...w,
                messages: w.messages.map((m) => (m.id === tempId ? confirmed : m)),
              }
            : w
        )
      );
      return true;
    } else {
      setOpenWindows((prev) =>
        prev.map((w) =>
          w.conversationId === conversationId
            ? {
                ...w,
                messages: w.messages.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)),
              }
            : w
        )
      );
      return false;
    }
  }, [user, openWindows]);

  // Handle incoming message processing
  const handleIncomingMessage = useCallback((msg: ChatMessage, conversationId: string, partnerInfo?: { id: string; nickname: string; avatar: string }) => {
    if (!msg || !msg.id) return;
    if (msg.senderId === user.id) return; // Don't notify for own messages
    if (seenMessageIdsRef.current.has(msg.id)) return; // Deduplicate

    seenMessageIdsRef.current.add(msg.id);
    trackConversation(conversationId);
    console.log('[DIAGNOSTIC] private_message_event_received', { messageId: msg.id, conversationId, senderId: msg.senderId });

    const partnerId = partnerInfo?.id || msg.senderId;
    const partnerNickname = partnerInfo?.nickname || msg.senderNickname || 'User';
    const partnerAvatar = partnerInfo?.avatar || msg.senderAvatar || '👤';

    setOpenWindows((prev) => {
      const existing = prev.find((w) => w.conversationId === conversationId);
      const isFocused = existing && existing.isOpen && !existing.isMinimized;

      if (existing) {
        return prev.map((w) =>
          w.conversationId === conversationId
            ? {
                ...w,
                messages: w.messages.some((m) => m.id === msg.id) ? w.messages : [...w.messages, msg],
                unreadCount: isFocused ? 0 : w.unreadCount + 1,
                isOpen: autoOpenPrivateChats ? true : w.isOpen,
                isMinimized: autoOpenPrivateChats ? false : w.isMinimized,
              }
            : w
        );
      } else {
        return [
          ...prev,
          {
            conversationId,
            partnerId,
            partnerNickname,
            partnerAvatar,
            isMinimized: false,
            isMaximized: false,
            messages: [msg],
            unreadCount: 1,
            draft: '',
            isOpen: autoOpenPrivateChats,
          },
        ];
      }
    });

    playBeep();
    console.log('[DIAGNOSTIC] private_notification_displayed', { messageId: msg.id, sender: partnerNickname });
    setLatestToast({
      id: msg.id,
      title: partnerNickname,
      message: msg.content || '[Media Attachment]',
      avatar: partnerAvatar,
      conversationId,
    });
  }, [user.id, autoOpenPrivateChats]);

  // Fix 1: Global Notifications (SSE + Supabase)
  useEffect(() => {
    if (!user.id) return;

    const API_BASE = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '');
    const userEventSource = new EventSource(`${API_BASE}/api/chat/user/${user.id}/events`);
    userEventSource.addEventListener('incoming_dm', (e) => {
      try {
        const data = JSON.parse(e.data);
        handleIncomingMessage(data.message, data.conversationId);
      } catch (err) {
        console.error('Failed to parse incoming DM from SSE stream', err);
      }
    });

    const unsubSupabase = databaseService.subscribeToUserDMs(user.id, (conversationId: string, message: ChatMessage) => {
      handleIncomingMessage(message, conversationId);
    });

    return () => {
      userEventSource.close();
      unsubSupabase();
    };
  }, [user.id, handleIncomingMessage]);

  // Fix 2: Per-window Subscriptions
  useEffect(() => {
    if (!user.id) return;

    openWindows.forEach((win) => {
      if (activeSubscriptionsRef.current.has(win.conversationId)) return;
      
      const unsub = messagingService.subscribeToConversation(win.conversationId, user.id, {
        onMessage: (msg) => {
          handleIncomingMessage(msg, win.conversationId, {
            id: win.partnerId,
            nickname: win.partnerNickname,
            avatar: win.partnerAvatar,
          });
        },
      });

      activeSubscriptionsRef.current.set(win.conversationId, unsub);
    });

    // Cleanup unsubscribed windows
    const openConvIds = new Set(openWindows.map(w => w.conversationId));
    activeSubscriptionsRef.current.forEach((unsub, convId) => {
        if (!openConvIds.has(convId)) {
            unsub();
            activeSubscriptionsRef.current.delete(convId);
        }
    });

    return () => {
      activeSubscriptionsRef.current.forEach((unsub) => unsub());
      activeSubscriptionsRef.current.clear();
    };
  }, [user.id, openWindows, handleIncomingMessage]);

  // Fix 3: Polling Sync
  useEffect(() => {
    if (!user.id) return;
    const syncInterval = setInterval(async () => {
      const allConvs = new Set<string>(knownConversationIdsRef.current);
      openWindows.forEach((w) => allConvs.add(w.conversationId));

      for (const convId of allConvs) {
        try {
          const res = await messagingService.fetchConversationMessages(convId, user.id);
          if (res.success && res.messages.length > 0) {
            for (const m of res.messages) {
              if (!seenMessageIdsRef.current.has(m.id) && m.senderId !== user.id) {
                const parts = convId.replace('conv_', '').split('_');
                const partnerId = parts[0] === user.id ? parts[1] : parts[0];
                handleIncomingMessage(m, convId, {
                  id: partnerId,
                  nickname: m.senderNickname || 'User',
                  avatar: m.senderAvatar || '👤',
                });
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }, 3000);

    return () => clearInterval(syncInterval);
  }, [user.id, openWindows, handleIncomingMessage]);

  const totalUnreadCount = openWindows.reduce((acc, w) => acc + w.unreadCount, 0);

  const clearToast = () => setLatestToast(null);

  return (
    <PrivateChatContext.Provider
      value={{
        conversations,
        openWindows,
        autoOpenPrivateChats,
        setAutoOpenPrivateChats,
        openChat,
        closeChat,
        minimizeChat,
        maximizeChat,
        sendMessage,
        markAsRead,
        totalUnreadCount,
        latestToast,
        clearToast,
      }}
    >
      {children}
    </PrivateChatContext.Provider>
  );
};

export const usePrivateChat = () => {
  const context = useContext(PrivateChatContext);
  if (!context) {
    throw new Error('usePrivateChat must be used within a PrivateChatProvider');
  }
  return context;
};
