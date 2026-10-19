import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { DirectConversation, ChatMessage } from '../types';
import { useAuth } from './AuthContext';
import { messagingService } from '../services/messagingService';

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

  // Open or focus a chat window with a partner
  const openChat = useCallback(async (partner: { id: string; nickname: string; avatar: string }) => {
    if (!user.id || partner.id === user.id) return;

    // Generate deterministic ID
    const sortedIds = [user.id, partner.id].sort();
    const conversationId = `conv_${sortedIds[0]}_${sortedIds[1]}`;

    // Ensure conversation is registered on backend
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
        // Add new window
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

    // Fetch initial messages for this window if empty
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
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
    );
  }, []);

  const sendMessage = useCallback(async (conversationId: string, content: string, media?: { url: string; type: 'gif' | 'image' }) => {
    const clean = content.trim();
    if ((!clean && !media) || !user.id) return false;

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

    // Append optimistic message
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
      // Mark as failed
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

  // Global incoming DM subscriptions for user
  useEffect(() => {
    if (!user.id) return;

    openWindows.forEach((win) => {
      if (activeSubscriptionsRef.current.has(win.conversationId)) return;

      const unsub = messagingService.subscribeToConversation(win.conversationId, user.id, {
        onMessage: (msg) => {
          if (!msg || !msg.id) return;
          if (msg.senderId === user.id) return;

          const isFocused = !win.isMinimized && win.isOpen;

          setOpenWindows((prev) =>
            prev.map((w) => {
              if (w.conversationId === win.conversationId) {
                const alreadyExists = w.messages.some((m) => m.id === msg.id);
                if (alreadyExists) return w;
                const newUnread = isFocused ? 0 : w.unreadCount + 1;
                return {
                  ...w,
                  messages: [...w.messages, msg],
                  unreadCount: newUnread,
                };
              }
              return w;
            })
          );

          if (!isFocused) {
            playBeep();
            setLatestToast({
              id: msg.id,
              title: msg.senderNickname,
              message: msg.content || '[Media Attachment]',
              avatar: msg.senderAvatar || '💬',
              conversationId: win.conversationId,
            });

            if (autoOpenPrivateChats) {
              setOpenWindows((prev) =>
                prev.map((w) =>
                  w.conversationId === win.conversationId ? { ...w, isOpen: true, isMinimized: false } : w
                )
              );
            }
          }
        },
      });

      activeSubscriptionsRef.current.set(win.conversationId, unsub);
    });
  }, [user.id, openWindows, autoOpenPrivateChats]);

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
