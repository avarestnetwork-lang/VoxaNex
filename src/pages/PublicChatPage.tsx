import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { ROOMS_CONFIG } from '../config/voxanexConfig';
import { ChatMessage, Room } from '../types';
import { formatDhakaTime } from '../utils/date';
import { databaseService } from '../services/databaseService';
import { BanglishHelperBar } from '../components/layout/BanglishHelperBar';
import { EmojiPicker } from '../components/chat/EmojiPicker';
import { GifPicker } from '../components/chat/GifPicker';
import { LinkPreviewCard } from '../components/chat/LinkPreviewCard';
import { TypingIndicator } from '../components/chat/TypingIndicator';
import { ReportModal } from '../components/chat/ReportModal';
import { UserActionMenu } from '../components/chat/UserActionMenu';
import { MentionAutocomplete } from '../components/chat/MentionAutocomplete';
import { UserProfileModal } from '../components/chat/UserProfileModal';
import { PrivateChatPane } from '../components/chat/PrivateChatPane';
import { safetyService } from '../services/safetyService';
import { Button } from '../components/ui/Button';
import { SEOHead } from '../components/common/SEOHead';
import {
  messagingService,
  RealtimePresenceMember,
  LinkPreviewData,
  GifItem,
} from '../../src/services/messagingService';
import {
  Send,
  Users,
  Compass,
  Smile,
  Image as ImageIcon,
  AlertTriangle,
  RotateCcw,
  LogOut,
  Wifi,
  WifiOff,
  ShieldCheck,
  Lock,
  ArrowUp,
  Clock,
  Sparkles,
  MessageSquare,
  Search,
  X,
  Menu,
  ChevronRight,
  Hash,
} from 'lucide-react';

interface ExtendedChatMessage extends ChatMessage {
  status?: 'sending' | 'delivered' | 'failed';
  mediaUrl?: string;
  mediaType?: 'gif' | 'image';
  linkPreview?: LinkPreviewData;
  errorReason?: string;
  clientNonce?: string;
}

export const getGenderInfo = (gender?: string) => {
  const norm = (gender || 'male').toLowerCase();
  switch (norm) {
    case 'female':
      return {
        label: 'Female',
        icon: '♀',
        textColor: 'text-[#FF69B4]',
        colorHex: '#FF69B4',
        badgeBg: 'bg-[#FF69B4]/15 border-[#FF69B4]/30',
      };
    case 'couple':
      return {
        label: 'Couple',
        icon: '♡',
        textColor: 'text-[#9B59B6]',
        colorHex: '#9B59B6',
        badgeBg: 'bg-[#9B59B6]/15 border-[#9B59B6]/30',
      };
    case 'other':
    case 'non_binary':
      return {
        label: 'Other',
        icon: '⚧',
        textColor: 'text-[#20B2AA]',
        colorHex: '#20B2AA',
        badgeBg: 'bg-[#20B2AA]/15 border-[#20B2AA]/30',
      };
    case 'male':
    default:
      return {
        label: norm === 'prefer_not_to_say' ? 'Member' : 'Male',
        icon: '♂',
        textColor: 'text-[#3498DB]',
        colorHex: '#3498DB',
        badgeBg: 'bg-[#3498DB]/15 border-[#3498DB]/30',
      };
  }
};

export const getGenderColor = (gender?: string): string => {
  return getGenderInfo(gender).textColor;
};

export const GenderBadge = ({ gender }: { gender?: string }) => {
  const g = getGenderInfo(gender);
  return (
    <span
      className={`text-xs font-bold ${g.textColor} ${g.badgeBg} border px-1.5 py-0.5 rounded ml-1.5 inline-flex items-center gap-1 select-none`}
      title={`Gender: ${g.label}`}
    >
      <span className="text-sm font-extrabold leading-none">{g.icon}</span>
      <span className="text-[10px] tracking-wider uppercase font-semibold">{g.label}</span>
    </span>
  );
};

export const PublicChatPage: React.FC = () => {
  const { params, navigate } = useRouter();
  const { language, t } = useLanguage();
  const { user, hasActiveSession, is18Verified } = useAuth();

  const currentRoomSlug = params.roomId || 'bangla';
  const activeRoom = ROOMS_CONFIG.find((r) => r.slug === currentRoomSlug) || ROOMS_CONFIG[0];

  // Mandatory Sign-In Gateway & 18+ Access Gate enforcement
  useEffect(() => {
    if (!hasActiveSession) {
      navigate('/guest-entry', { targetRoom: activeRoom.slug });
      return;
    }
    if (activeRoom.is18Plus && (!is18Verified || !user.is18Verified)) {
      navigate('/guest-entry', { targetRoom: activeRoom.slug });
    }
  }, [hasActiveSession, activeRoom, is18Verified, user.is18Verified, navigate]);

  const DEFAULT_ROOM_MEMBERS: RealtimePresenceMember[] = [
    { id: 'usr-1', nickname: 'Dhaka_Rider', avatar: '🏍️', isGuest: false, gender: 'male', lastSeen: Date.now() },
    { id: 'usr-2', nickname: 'Sylhet_Angel', avatar: '🌸', isGuest: false, gender: 'female', lastSeen: Date.now() },
    { id: 'usr-3', nickname: 'Bangla_Queen', avatar: '👑', isGuest: true, gender: 'female', lastSeen: Date.now() },
    { id: 'usr-4', nickname: 'Deshi_Couples', avatar: '💑', isGuest: false, gender: 'couple', lastSeen: Date.now() },
    { id: 'usr-5', nickname: 'Ctg_Navigator', avatar: '⛵', isGuest: true, gender: 'male', lastSeen: Date.now() },
  ];

  const [messages, setMessages] = useState<ExtendedChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const [onlineMembers, setOnlineMembers] = useState<RealtimePresenceMember[]>(DEFAULT_ROOM_MEMBERS);
  const [typers, setTypers] = useState<string[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);

  // Chatroom View State & Sidebar Tabs
  const [sidebarTab, setSidebarTab] = useState<'users' | 'private' | 'rooms'>('users');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  // Active Direct Conversation Tab
  const [activePrivatePartner, setActivePrivatePartner] = useState<{
    id: string;
    nickname: string;
    avatar: string;
    gender?: string;
    isGuest?: boolean;
  } | null>(null);
  const [activeChatView, setActiveChatView] = useState<'room' | 'private'>('room');

  // Direct conversations list for the Private tab
  const [directConversations, setDirectConversations] = useState<
    Array<{
      id: string;
      partnerId: string;
      partnerNickname: string;
      partnerAvatar: string;
      partnerGender?: string;
      lastMessage: string;
      timestamp: string;
      unreadCount: number;
    }>
  >([
    {
      id: `conv_${[user.id, 'usr-2'].sort().join('_')}`,
      partnerId: 'usr-2',
      partnerNickname: 'Sylhet_Angel',
      partnerAvatar: '🌸',
      partnerGender: 'female',
      lastMessage: 'Kalke chat-e asben?',
      timestamp: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
      unreadCount: 1,
    },
    {
      id: `conv_${[user.id, 'usr-1'].sort().join('_')}`,
      partnerId: 'usr-1',
      partnerNickname: 'Dhaka_Rider',
      partnerAvatar: '🏍️',
      partnerGender: 'male',
      lastMessage: 'Shob theek ache, bhai!',
      timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
      unreadCount: 0,
    },
  ]);

  // Contextual Menus & Modals
  const [userActionMenu, setUserActionMenu] = useState<{
    member: { id: string; nickname: string; avatar: string; gender?: string; isGuest?: boolean };
    position: { x: number; y: number };
  } | null>(null);
  const [profileModalMember, setProfileModalMember] = useState<{
    id: string;
    nickname: string;
    avatar: string;
    gender?: string;
    isGuest?: boolean;
  } | null>(null);

  // Mention Autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  // Pickers & Modals
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTargetUser, setReportTargetUser] = useState<{ targetId: string; nickname: string; snippet?: string } | null>(null);
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  // Attached media for current message
  const [attachedMedia, setAttachedMedia] = useState<{ url: string; type: 'gif' | 'image'; title?: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Monitor user scroll position to avoid forcing auto-scroll when user is reviewing history
  const handleScrollMessages = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 120;
  };

  // 1. Initial message history load with deduplication
  useEffect(() => {
    let cancel = false;
    async function loadHistory() {
      setLoadingHistory(true);
      const res = await messagingService.fetchRoomHistory(activeRoom.id, 50);
      if (!cancel) {
        if (res.success && res.messages.length > 0) {
          const fetchedMessages = res.messages.map((m) => ({ ...m, status: 'delivered' as const }));
          setMessages((prev) => {
            const combined = [...fetchedMessages, ...prev];
            const unique = Array.from(new Map(combined.map((m) => [m.id, m])).values());
            return unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          });
        } else if (res.messages.length === 0) {
          setMessages([
            {
              id: 'sys-welcome',
              roomId: activeRoom.id,
              senderId: 'system',
              senderNickname: 'VoxaNex Guard',
              senderAvatar: '🛡️',
              content:
                language === 'bn'
                  ? `স্বাগতম "${activeRoom.name.bn}" চ্যাটরুমে! সবাইকে পারস্পরিক শ্রদ্ধা প্রদর্শন করুন। ক্লিক করে যেকোনো ইউজারের সাথে প্রাইভেট চ্যাট শুরু করুন।`
                  : `Welcome to "${activeRoom.name.en}". Follow community guidelines. Click any user to open a private 1-on-1 chat.`,
              timestamp: new Date().toISOString(),
              isSystem: true,
              status: 'delivered',
            },
          ]);
        }
        setLoadingHistory(false);
        setTimeout(() => scrollToBottom(false), 50);
      }
    }
    loadHistory();
    return () => {
      cancel = true;
    };
  }, [activeRoom.id, language, scrollToBottom]);

  // 2. Realtime SSE & Supabase Realtime stream subscription
  useEffect(() => {
    const unsubPresence = databaseService.subscribePresence(activeRoom.id, (presence) => {
      if (presence.payload.status === 'offline') {
        setOnlineMembers((prev) => prev.filter((m) => m.id !== presence.payload.id));
      }
    });

    const unsubscribe = messagingService.subscribeToRoom(activeRoom.id, {
      onMessage: (newMsg) => {
        setMessages((prev) => {
          // 1. Deduplicate by exact confirmed message ID
          if (prev.some((m) => m.id === newMsg.id)) {
            return prev;
          }

          // 2. Reconcile optimistic message by clientNonce
          if (newMsg.clientNonce && prev.some((m) => m.clientNonce === newMsg.clientNonce)) {
            return prev.map((m) =>
              m.clientNonce === newMsg.clientNonce
                ? {
                    ...newMsg,
                    status: 'delivered',
                    linkPreview: m.linkPreview || newMsg.linkPreview,
                    mediaUrl: m.mediaUrl || newMsg.mediaUrl,
                    mediaType: m.mediaType || newMsg.mediaType,
                  }
                : m
            );
          }

          // 3. Reconcile optimistic message by matching sender and content in 'sending' status
          const pendingMatch = prev.find(
            (m) =>
              m.status === 'sending' &&
              m.senderId === newMsg.senderId &&
              m.content === newMsg.content
          );
          if (pendingMatch) {
            return prev.map((m) =>
              m.id === pendingMatch.id
                ? {
                    ...newMsg,
                    status: 'delivered',
                    linkPreview: m.linkPreview || newMsg.linkPreview,
                    mediaUrl: m.mediaUrl || newMsg.mediaUrl,
                    mediaType: m.mediaType || newMsg.mediaType,
                  }
                : m
            );
          }

          // 4. Genuine incoming message
          return [...prev, { ...newMsg, status: 'delivered' }];
        });

        // Only auto-scroll if near bottom
        if (isNearBottomRef.current) {
          setTimeout(() => scrollToBottom(true), 50);
        }
      },
      onPresence: (members) => {
        setOnlineMembers(members);
      },
      onTyping: (activeTypers) => {
        setTypers(activeTypers.filter((name) => name !== user.nickname));
      },
      onStatusChange: (status) => {
        setConnectionStatus(status);
      },
    });

    return () => {
      unsubscribe();
      unsubPresence();
    };
  }, [activeRoom.id, user.nickname, scrollToBottom]);

  // 3. Presence Heartbeat
  useEffect(() => {
    const sendHeartbeat = () => {
      messagingService.sendPresence(activeRoom.id, {
        id: user.id,
        nickname: user.nickname,
        avatar: user.avatar,
        isGuest: user.isGuest,
        gender: user.gender,
      });
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 25000);
    return () => clearInterval(interval);
  }, [activeRoom.id, user]);

  // Handle typing input with mention autocomplete detection
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputText(val);

    // Detect mention trigger (@word)
    const cursorPos = e.target.selectionStart || val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@([a-zA-Z0-9_]*)$/);

    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
      setMentionSelectedIndex(0);
    } else {
      setMentionQuery(null);
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    messagingService.sendTyping(activeRoom.id, user.id, user.nickname, true);

    typingTimeoutRef.current = setTimeout(() => {
      messagingService.sendTyping(activeRoom.id, user.id, user.nickname, false);
    }, 2500);
  };

  // Keyboard navigation for mention autocomplete
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery !== null) {
      const eligible = onlineMembers.filter(
        (m) =>
          m.id !== user.id &&
          m.nickname.toLowerCase().includes(mentionQuery.toLowerCase())
      );

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionSelectedIndex((prev) => (prev + 1) % Math.max(1, eligible.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSelectedIndex((prev) =>
          prev === 0 ? eligible.length - 1 : prev - 1
        );
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && eligible.length > 0) {
        e.preventDefault();
        handleSelectMention(eligible[mentionSelectedIndex]?.nickname || eligible[0].nickname);
        return;
      }
      if (e.key === 'Escape') {
        setMentionQuery(null);
        return;
      }
    }
  };

  // Insert selected mention
  const handleSelectMention = (nickname: string) => {
    if (!inputRef.current) return;
    const val = inputText;
    const cursorPos = inputRef.current.selectionStart || val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const textAfterCursor = val.slice(cursorPos);

    const updatedBefore = textBeforeCursor.replace(/@([a-zA-Z0-9_]*)$/, `@${nickname} `);
    setInputText(updatedBefore + textAfterCursor);
    setMentionQuery(null);
    inputRef.current.focus();
  };

  // 4. Send Message Handler
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = inputText.trim();
    if (!clean && !attachedMedia) return;

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const optimisticMsg: ExtendedChatMessage = {
      id: tempId,
      roomId: activeRoom.id,
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      content: clean,
      mediaUrl: attachedMedia?.url,
      mediaType: attachedMedia?.type,
      timestamp: new Date().toISOString(),
      status: 'sending',
      clientNonce: nonce,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setInputText('');
    setMentionQuery(null);
    const mediaToSend = attachedMedia;
    setAttachedMedia(null);
    setShowEmojiPicker(false);
    setShowGifPicker(false);
    setTimeout(() => scrollToBottom(true), 50);

    let linkPreview: LinkPreviewData | undefined;
    const urlMatch = clean.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch && !mediaToSend) {
      const previewRes = await messagingService.fetchLinkPreview(urlMatch[0]);
      if (previewRes) linkPreview = previewRes;
    }

    const result = await messagingService.sendRoomMessage(activeRoom.id, {
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      senderType: user.isGuest ? 'guest' : 'registered',
      content: clean,
      mediaUrl: mediaToSend?.url,
      mediaType: mediaToSend?.type,
      linkPreview,
      clientNonce: nonce,
    });

    if (result.success && result.message) {
      const confirmed = result.message;
      setMessages((prev) => {
        const alreadyDelivered = prev.some((m) => m.id === confirmed.id);
        if (alreadyDelivered) {
          return prev.filter((m) => m.id !== tempId);
        }
        return prev.map((m) =>
          m.id === tempId || (nonce && m.clientNonce === nonce)
            ? { ...confirmed, status: 'delivered', linkPreview }
            : m
        );
      });
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? { ...m, status: 'failed', errorReason: result.error || 'Delivery failed' }
            : m
        )
      );
    }
  };

  const handleRetry = async (failedMsg: ExtendedChatMessage) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === failedMsg.id ? { ...m, status: 'sending', errorReason: undefined } : m))
    );

    const result = await messagingService.sendRoomMessage(activeRoom.id, {
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      senderType: user.isGuest ? 'guest' : 'registered',
      content: failedMsg.content,
      mediaUrl: failedMsg.mediaUrl,
      mediaType: failedMsg.mediaType,
    });

    if (result.success && result.message) {
      setMessages((prev) =>
        prev.map((m) => (m.id === failedMsg.id ? { ...result.message!, status: 'delivered' } : m))
      );
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === failedMsg.id
            ? { ...m, status: 'failed', errorReason: result.error || 'Retry failed' }
            : m
        )
      );
    }
  };

  // 5. Scroll-Preserving History Pagination
  const handleLoadOlder = async () => {
    if (messages.length === 0 || loadingHistory) return;
    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;
    const prevScrollTop = container?.scrollTop || 0;

    const oldestTimestamp = messages[0].timestamp;
    setLoadingHistory(true);

    const res = await messagingService.fetchRoomHistory(activeRoom.id, 30, oldestTimestamp);
    if (res.success && res.messages.length > 0) {
      const fetchedMessages = res.messages.map((m) => ({ ...m, status: 'delivered' as const }));
      setMessages((prev) => {
        const combined = [...fetchedMessages, ...prev];
        const unique = Array.from(new Map(combined.map((m) => [m.id, m])).values());
        return unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      });

      // Restore exact scroll offset
      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      });
    } else {
      setHasMoreHistory(false);
    }
    setLoadingHistory(false);
  };

  // Click on any participant to open UserActionMenu
  const handleUserClick = (
    e: React.MouseEvent,
    member: { id: string; nickname: string; avatar: string; gender?: string; isGuest?: boolean }
  ) => {
    e.stopPropagation();
    setUserActionMenu({
      member,
      position: { x: e.clientX, y: e.clientY },
    });
  };

  // Open Direct 1-on-1 Chat with Partner
  const handleOpenPrivateChat = (partner: {
    id: string;
    nickname: string;
    avatar: string;
    gender?: string;
    isGuest?: boolean;
  }) => {
    setActivePrivatePartner(partner);
    setActiveChatView('private');
    setShowMobileSidebar(false);

    // Ensure conversation exists in direct list
    setDirectConversations((prev) => {
      const exists = prev.some((c) => c.partnerId === partner.id);
      if (exists) return prev;
      return [
        {
          id: `conv_${[user.id, partner.id].sort().join('_')}`,
          partnerId: partner.id,
          partnerNickname: partner.nickname,
          partnerAvatar: partner.avatar,
          partnerGender: partner.gender,
          lastMessage: 'Started new direct chat',
          timestamp: new Date().toISOString(),
          unreadCount: 0,
        },
        ...prev,
      ];
    });
  };

  // Insert mention from UserActionMenu
  const handleMentionFromMenu = (nickname: string) => {
    setInputText((prev) => (prev ? `${prev} @${nickname} ` : `@${nickname} `));
    inputRef.current?.focus();
    setActiveChatView('room');
  };

  // Render mentions highlighted in chat messages
  const renderMessageContent = (content: string) => {
    const parts = content.split(/(@[a-zA-Z0-9_]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        const mentionedName = part.slice(1);
        const isMentioningMe =
          user.nickname && mentionedName.toLowerCase() === user.nickname.toLowerCase();
        return (
          <span
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              const matchedMember = onlineMembers.find(
                (m) => m.nickname.toLowerCase() === mentionedName.toLowerCase()
              );
              if (matchedMember) {
                handleUserClick(e, matchedMember);
              }
            }}
            className={`font-semibold px-1 py-0.5 rounded text-[11px] font-mono inline-block cursor-pointer transition-colors ${
              isMentioningMe
                ? 'bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-sm'
                : 'bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 hover:bg-cyan-900/60'
            }`}
            title="Click to view user profile"
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const handleLeaveRoom = () => {
    databaseService.broadcastPresence(activeRoom.id, {
      type: 'presence',
      payload: { id: user.id, status: 'offline' },
    });
    navigate('/rooms');
  };

  // Filtered members for sidebar search
  const filteredMembers = onlineMembers.filter((m) =>
    m.nickname.toLowerCase().includes(userSearchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-4 h-[calc(100vh-5.5rem)] min-h-[580px] flex flex-col">
      <SEOHead
        title={`${activeRoom.name[language] || activeRoom.name.en} – ChatLustora`}
        description={`Real-time adult public group chat and live conversations in ${activeRoom.name[language] || activeRoom.name.en} on ChatLustora.`}
        canonicalPath="/chat"
        noindex={true}
      />
      {/* Top Navigation & Channel Header Bar */}
      <div className="p-3 rounded-t-2xl border border-slate-800 bg-[#0c1222] flex items-center justify-between gap-3 shrink-0 shadow-lg">
        {/* Left: Brand/Room info & Switcher tabs */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => navigate('/rooms')}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-xl transition-colors cursor-pointer shrink-0"
            title="Browse room directory"
          >
            <Compass className="w-5 h-5 text-cyan-400" />
          </button>

          {/* Active View Tabs (Public Room vs Active Private Chat) */}
          <div className="flex items-center gap-1.5 min-w-0 bg-[#080d19] p-1 rounded-xl border border-slate-800/90">
            <button
              onClick={() => setActiveChatView('room')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer truncate ${
                activeChatView === 'room'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Hash className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{activeRoom.name[language]}</span>
              {activeRoom.is18Plus && (
                <span className="text-[9px] bg-rose-950/80 text-rose-300 border border-rose-800 px-1 py-0.2 rounded shrink-0">
                  18+
                </span>
              )}
            </button>

            {activePrivatePartner && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  activeChatView === 'private'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <button
                  onClick={() => setActiveChatView('private')}
                  className="flex items-center gap-1.5 truncate cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{activePrivatePartner.nickname}</span>
                </button>
                <button
                  onClick={() => {
                    setActivePrivatePartner(null);
                    setActiveChatView('room');
                  }}
                  className="hover:text-rose-300 rounded p-0.5"
                  title="Close private chat"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Network indicator & Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Connection status badge */}
          <div
            className={`hidden md:flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg border ${
              connectionStatus === 'connected'
                ? 'border-emerald-800/60 bg-emerald-950/20 text-emerald-300'
                : connectionStatus === 'connecting'
                ? 'border-cyan-800/60 bg-cyan-950/20 text-cyan-300'
                : connectionStatus === 'reconnecting'
                ? 'border-amber-800/60 bg-amber-950/20 text-amber-300'
                : 'border-rose-800/60 bg-rose-950/20 text-rose-300'
            }`}
          >
            {connectionStatus === 'connected' ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span>Connected</span>
              </>
            ) : connectionStatus === 'connecting' ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                <span>Connecting...</span>
              </>
            ) : connectionStatus === 'reconnecting' ? (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span>Reconnecting...</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                <span>Disconnected</span>
              </>
            )}
          </div>

          {/* Toggle Sidebar Button */}
          <button
            onClick={() => setShowMobileSidebar(!showMobileSidebar)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-800 bg-[#101729] hover:bg-slate-800 text-slate-300 hover:text-white text-xs transition-colors cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold">
              {onlineMembers.length} <span className="hidden sm:inline">Online</span>
            </span>
          </button>

          <button
            onClick={() => setReportModalOpen(true)}
            className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-xl border border-rose-900/60 bg-rose-950/20 transition-colors cursor-pointer"
            title="Report channel or abuse"
          >
            <AlertTriangle className="w-4 h-4" />
          </button>

          <button
            onClick={handleLeaveRoom}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-xl border border-slate-800 bg-[#101729] transition-colors cursor-pointer"
            title="Leave room"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden border-x border-b border-slate-800 rounded-b-2xl bg-[#090d18] relative shadow-2xl">
        {/* ACTIVE VIEW: Public Room Chat OR Direct 1-on-1 Chat */}
        {activeChatView === 'private' && activePrivatePartner ? (
          <PrivateChatPane
            conversationId={`conv_${[user.id, activePrivatePartner.id].sort().join('_')}`}
            partner={activePrivatePartner}
            currentUser={{ id: user.id, nickname: user.nickname, avatar: user.avatar }}
            onClose={() => setActiveChatView('room')}
            language={language}
          />
        ) : (
          <div className="flex-1 flex flex-col justify-between overflow-hidden relative">
            {/* Safety & Retention Notification Strip */}
            <div className="px-4 py-2 bg-[#0c1324] border-b border-slate-800 text-[11px] text-slate-400 font-mono flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="truncate">
                  Live Chatroom Active · Click any user to start Private Chat · Zero-Harassment Rules
                </span>
              </div>
              <span className="text-slate-500 hidden md:inline shrink-0">Asia/Dhaka</span>
            </div>

            {/* Load Older Messages Banner */}
            {hasMoreHistory && (
              <div className="p-2 text-center border-b border-slate-800/50 bg-[#090e1a]/90 shrink-0">
                <button
                  onClick={handleLoadOlder}
                  disabled={loadingHistory}
                  className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 font-medium"
                >
                  <ArrowUp className="w-3 h-3" />
                  <span>{loadingHistory ? 'Fetching earlier messages...' : 'Load older messages'}</span>
                </button>
              </div>
            )}

            {/* Main Chatroom Messages Stream with Alternating Subtle Row Backgrounds */}
            <div
              ref={messagesContainerRef}
              onScroll={handleScrollMessages}
              className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-1.5"
            >
              {messages.map((msg, idx) => {
                const isMe = msg.senderId === user.id;
                const isMentioned =
                  user.nickname &&
                  msg.content?.toLowerCase().includes(`@${user.nickname.toLowerCase()}`);

                // System message notice
                if (msg.isSystem) {
                  return (
                    <div
                      key={`${msg.id}-${idx}`}
                      className="p-3 my-2 rounded-xl bg-[#111728]/90 border border-slate-800 text-xs text-slate-300 flex items-start gap-2.5 max-w-xl mx-auto shadow-sm"
                    >
                      <span className="text-lg select-none shrink-0">{msg.senderAvatar}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-cyan-300 text-[11px] mb-0.5">
                          {msg.senderNickname}
                        </div>
                        <p className="leading-relaxed break-words">{msg.content}</p>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono shrink-0">
                        {formatDhakaTime(msg.timestamp, language)}
                      </span>
                    </div>
                  );
                }

                // Normal message row with alternating subtle background
                return (
                  <div
                    key={`${msg.id}-${idx}`}
                    className={`group flex items-start gap-2.5 p-2 sm:px-3 sm:py-2.5 rounded-xl transition-colors ${
                      idx % 2 === 0 ? 'bg-[#0d1424]/40' : 'bg-transparent'
                    } hover:bg-slate-800/30 ${
                      isMentioned ? 'bg-amber-950/25 border border-amber-800/40 shadow-sm' : ''
                    }`}
                  >
                    {/* Clickable Participant Avatar */}
                    <button
                      type="button"
                      onClick={(e) =>
                        handleUserClick(e, {
                          id: msg.senderId,
                          nickname: msg.senderNickname,
                          avatar: msg.senderAvatar,
                        })
                      }
                      className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center text-sm shrink-0 select-none hover:scale-105 hover:border-cyan-500 transition-all cursor-pointer shadow-sm"
                      title="Click user options"
                    >
                      {msg.senderAvatar}
                    </button>

                    {/* Message Details */}
                    <div className="flex-1 min-w-0">
                      {/* Name, Gender, Timestamp Bar */}
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          {/* Clickable Nickname */}
                          <button
                            type="button"
                            onClick={(e) =>
                              handleUserClick(e, {
                                id: msg.senderId,
                                nickname: msg.senderNickname,
                                avatar: msg.senderAvatar,
                              })
                            }
                            className={`font-bold text-xs truncate hover:underline cursor-pointer text-left ${getGenderColor(
                              onlineMembers.find((m) => m.id === msg.senderId)?.gender
                            )}`}
                          >
                            {msg.senderNickname}
                          </button>

                          {/* Gender sign */}
                          <GenderBadge
                            gender={onlineMembers.find((m) => m.id === msg.senderId)?.gender}
                          />

                          {isMe && (
                            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-violet-950 text-violet-300 border border-violet-800">
                              You
                            </span>
                          )}
                        </div>

                        {/* Light gray formatted timestamp */}
                        <span className="text-[10px] text-slate-500 font-mono shrink-0 select-none">
                          [{formatDhakaTime(msg.timestamp, language)}]
                        </span>
                      </div>

                      {/* Content with mention parsing */}
                      {msg.content && (
                        <div className="text-xs text-slate-200 leading-relaxed break-words whitespace-pre-wrap">
                          {renderMessageContent(msg.content)}
                        </div>
                      )}

                      {/* Attached GIF / Media */}
                      {msg.mediaUrl && (
                        <div className="mt-2 rounded-xl overflow-hidden border border-slate-700/60 max-w-xs shadow-md">
                          <img
                            src={msg.mediaUrl}
                            alt="Shared media"
                            className="w-full max-h-48 object-cover"
                            loading="lazy"
                          />
                        </div>
                      )}

                      {/* Safe link preview card */}
                      {msg.linkPreview && <LinkPreviewCard preview={msg.linkPreview} />}

                      {/* Delivery status or failure retry */}
                      {isMe && (
                        <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px]">
                          {msg.status === 'sending' && (
                            <span className="text-violet-300 font-mono">Sending...</span>
                          )}
                          {msg.status === 'failed' && (
                            <div className="flex items-center gap-1 text-rose-300">
                              <span>{msg.errorReason || 'Failed'}</span>
                              <button
                                onClick={() => handleRetry(msg)}
                                className="underline hover:text-white flex items-center gap-0.5 ml-1 cursor-pointer"
                              >
                                <RotateCcw className="w-2.5 h-2.5" />
                                <span>Retry</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing indicator */}
            <TypingIndicator typers={typers} />

            {/* Attached Media Staging Preview */}
            {attachedMedia && (
              <div className="px-4 py-2 bg-[#0c1222] border-t border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <img
                    src={attachedMedia.url}
                    alt="Attachment preview"
                    className="w-10 h-10 object-cover rounded border border-slate-700"
                  />
                  <div>
                    <span className="font-semibold block text-cyan-300">Attached Animated GIF</span>
                    <span className="text-[10px] text-slate-400">{attachedMedia.title}</span>
                  </div>
                </div>
                <button
                  onClick={() => setAttachedMedia(null)}
                  className="text-xs text-rose-400 hover:text-white cursor-pointer"
                >
                  Remove
                </button>
              </div>
            )}

            {/* Composer Dock */}
            <div className="p-3 border-t border-slate-800 bg-[#0c1222] space-y-2 shrink-0 relative">
              <BanglishHelperBar onInsertText={(phrase) => setInputText((prev) => (prev ? `${prev} ${phrase}` : phrase))} />

              {/* Mention Autocomplete Dropdown */}
              {mentionQuery !== null && (
                <MentionAutocomplete
                  query={mentionQuery}
                  members={onlineMembers.filter((m) => m.id !== user.id)}
                  onSelect={handleSelectMention}
                  onClose={() => setMentionQuery(null)}
                  selectedIndex={mentionSelectedIndex}
                />
              )}

              {/* Emoji & GIF Popovers */}
              {showEmojiPicker && (
                <EmojiPicker
                  onSelectEmoji={(emoji) => {
                    setInputText((prev) => prev + emoji);
                    setShowEmojiPicker(false);
                  }}
                  onClose={() => setShowEmojiPicker(false)}
                />
              )}
              {showGifPicker && (
                <GifPicker
                  onSelectGif={(gif) => {
                    setAttachedMedia({ url: gif.url, type: 'gif', title: gif.title });
                    setShowGifPicker(false);
                  }}
                  onClose={() => setShowGifPicker(false)}
                />
              )}

              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmojiPicker(!showEmojiPicker);
                      setShowGifPicker(false);
                    }}
                    className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                      showEmojiPicker
                        ? 'bg-violet-600 text-white border-violet-500'
                        : 'border-slate-800 bg-[#101729] text-slate-400 hover:text-white'
                    }`}
                    title="Emoji picker"
                  >
                    <Smile className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowGifPicker(!showGifPicker);
                      setShowEmojiPicker(false);
                    }}
                    className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                      showGifPicker
                        ? 'bg-fuchsia-600 text-white border-fuchsia-500'
                        : 'border-slate-800 bg-[#101729] text-slate-400 hover:text-white'
                    }`}
                    title="Curated GIF search"
                  >
                    <ImageIcon className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputText}
                    onChange={handleInputChange}
                    onKeyDown={handleInputKeyDown}
                    maxLength={2000}
                    placeholder={`Type message or @ to mention participant...`}
                    className="w-full bg-[#101729] border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  />
                  {inputText.length > 50 && (
                    <span className="absolute right-3 top-2.5 text-[10px] text-slate-500 font-mono">
                      {inputText.length}/2000
                    </span>
                  )}
                </div>

                <Button type="submit" variant="primary" size="md" className="shrink-0 rounded-xl">
                  <Send className="w-4 h-4 mr-1.5" />
                  <span>Send</span>
                </Button>
              </form>
            </div>
          </div>
        )}

        {/* Right Sidebar: Tabs for Users | Private Chats | Rooms */}
        <div
          className={`${
            showMobileSidebar ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
          } fixed inset-y-0 right-0 z-40 lg:static w-72 sm:w-80 border-l border-slate-800 bg-[#0c1220] flex flex-col justify-between shrink-0 transition-transform duration-200 ease-in-out`}
        >
          {/* Sidebar Top: Tabs */}
          <div className="flex flex-col h-full overflow-hidden">
            <div className="p-3 border-b border-slate-800 bg-[#090d18] flex items-center justify-between">
              <div className="flex items-center gap-1 bg-[#101729] p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setSidebarTab('users')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    sidebarTab === 'users'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Users ({onlineMembers.length})
                </button>
                <button
                  onClick={() => setSidebarTab('private')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer relative ${
                    sidebarTab === 'private'
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>Private</span>
                  {directConversations.some((c) => c.unreadCount > 0) && (
                    <span className="w-2 h-2 rounded-full bg-rose-500 inline-block ml-1" />
                  )}
                </button>
                <button
                  onClick={() => setSidebarTab('rooms')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    sidebarTab === 'rooms'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Rooms
                </button>
              </div>

              {/* Close sidebar on mobile */}
              <button
                onClick={() => setShowMobileSidebar(false)}
                className="lg:hidden p-1.5 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* TAB CONTENT 1: ONLINE USERS */}
            {sidebarTab === 'users' && (
              <div className="flex-1 flex flex-col p-3 overflow-hidden">
                {/* Search user filter */}
                <div className="relative mb-2 shrink-0">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    placeholder="Search online users..."
                    className="w-full bg-[#101729] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                  {userSearchQuery && (
                    <button
                      onClick={() => setUserSearchQuery('')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Users List */}
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
                  {/* Current user card */}
                  <div
                    onClick={(e) => handleUserClick(e, user)}
                    className="p-2.5 rounded-xl bg-violet-950/30 border border-violet-900/50 shadow-sm cursor-pointer hover:border-violet-600 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-lg select-none shrink-0">{user.avatar || '👤'}</span>
                        <span className={`font-bold truncate text-xs ${getGenderColor(user.gender)}`}>
                          {user.nickname}
                        </span>
                      </div>
                      <GenderBadge gender={user.gender} />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-violet-300 pt-1 border-t border-violet-900/30 font-mono">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>You ({user.isGuest ? 'Guest' : 'Member'})</span>
                      </span>
                      <span className="text-violet-400 uppercase tracking-wider text-[9px]">Online</span>
                    </div>
                  </div>

                  {/* Active room members */}
                  {filteredMembers
                    .filter((m) => m.id !== user.id)
                    .map((member) => (
                      <div
                        key={member.id}
                        onClick={(e) => handleUserClick(e, member)}
                        className="p-2.5 rounded-xl bg-[#101729] hover:bg-[#151f38] border border-slate-800/80 hover:border-cyan-500/50 transition-all cursor-pointer group shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-1.5 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-lg select-none shrink-0 group-hover:scale-110 transition-transform">
                              {member.avatar || '👤'}
                            </span>
                            <span
                              className={`font-semibold truncate text-xs group-hover:underline ${getGenderColor(
                                member.gender
                              )}`}
                            >
                              {member.nickname}
                            </span>
                          </div>
                          <GenderBadge gender={member.gender} />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/60 font-mono">
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            <span>{member.isGuest ? 'Guest Session' : 'Member'}</span>
                          </span>
                          <span className="text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity">
                            Options →
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* TAB CONTENT 2: PRIVATE CONVERSATIONS */}
            {sidebarTab === 'private' && (
              <div className="flex-1 flex flex-col p-3 overflow-hidden">
                <div className="flex-1 overflow-y-auto space-y-1.5">
                  {directConversations.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">
                      <MessageSquare className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                      <p>No active private chats.</p>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Click on any online user to start a conversation.
                      </p>
                    </div>
                  ) : (
                    directConversations.map((conv) => (
                      <div
                        key={conv.id}
                        onClick={() =>
                          handleOpenPrivateChat({
                            id: conv.partnerId,
                            nickname: conv.partnerNickname,
                            avatar: conv.partnerAvatar,
                            gender: conv.partnerGender,
                          })
                        }
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                          activePrivatePartner?.id === conv.partnerId
                            ? 'bg-violet-950/40 border-violet-600 shadow-md'
                            : 'bg-[#101729] hover:bg-[#141d33] border-slate-800/80 hover:border-violet-500/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-lg select-none shrink-0">{conv.partnerAvatar}</span>
                            <span className="font-semibold text-xs text-white truncate">
                              {conv.partnerNickname}
                            </span>
                          </div>
                          {conv.unreadCount > 0 && (
                            <span className="bg-rose-500 text-white font-bold text-[9px] px-1.5 py-0.2 rounded-full">
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate mb-1">
                          {conv.lastMessage}
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono text-right">
                          {formatDhakaTime(conv.timestamp, language)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT 3: ROOMS DIRECTORY */}
            {sidebarTab === 'rooms' && (
              <div className="flex-1 flex flex-col p-3 overflow-hidden">
                <div className="flex-1 overflow-y-auto space-y-1.5">
                  {ROOMS_CONFIG.map((r) => {
                    const isCurrent = r.slug === activeRoom.slug;
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          navigate('/chat', { roomId: r.slug });
                          setActiveChatView('room');
                          setShowMobileSidebar(false);
                        }}
                        className={`w-full p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          isCurrent
                            ? 'bg-cyan-950/40 border-cyan-500 text-white shadow-sm'
                            : 'bg-[#101729] hover:bg-[#141d33] border-slate-800 text-slate-300 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-bold text-xs truncate">{r.name[language]}</span>
                          {r.is18Plus && (
                            <span className="text-[9px] font-semibold text-rose-400 border border-rose-800/80 bg-rose-950/40 px-1 py-0.2 rounded shrink-0">
                              18+
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                          {r.description[language]}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Bottom info strip */}
            <div className="p-3 border-t border-slate-800 bg-[#090d18] text-[10px] text-slate-400 font-mono flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Multi-Transport Realtime</span>
              </span>
              <span>VoxaNex Edge</span>
            </div>
          </div>
        </div>

        {/* Mobile Backdrop */}
        {showMobileSidebar && (
          <div
            onClick={() => setShowMobileSidebar(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-30 lg:hidden"
          />
        )}
      </div>

      {/* Contextual User Action Menu */}
      {userActionMenu && (
        <UserActionMenu
          member={userActionMenu.member}
          position={userActionMenu.position}
          onClose={() => setUserActionMenu(null)}
          onOpenPrivateChat={handleOpenPrivateChat}
          onMention={handleMentionFromMenu}
          onViewProfile={(m) => setProfileModalMember(m)}
          onBlockUser={async (targetId, targetNickname) => {
            await safetyService.toggleBlockUser({
              blockerId: user.id,
              targetId,
              targetNickname,
              blocked: true,
            });
            setNotificationMsg(`Blocked ${targetNickname}`);
            setTimeout(() => setNotificationMsg(null), 2500);
          }}
          onReportUser={(targetId, targetNickname) => {
            setReportTargetUser({ targetId, nickname: targetNickname });
            setReportModalOpen(true);
          }}
          isCurrentUser={userActionMenu.member.id === user.id}
        />
      )}

      {/* User Profile Inspection Modal */}
      <UserProfileModal
        isOpen={Boolean(profileModalMember)}
        onClose={() => setProfileModalMember(null)}
        member={profileModalMember}
        onOpenPrivateChat={handleOpenPrivateChat}
        onMention={handleMentionFromMenu}
        onBlockUser={async (targetId, targetNickname) => {
          await safetyService.toggleBlockUser({
            blockerId: user.id,
            targetId,
            targetNickname,
            blocked: true,
          });
          setNotificationMsg(`Blocked ${targetNickname}`);
          setTimeout(() => setNotificationMsg(null), 2500);
        }}
        isCurrentUser={profileModalMember?.id === user.id}
      />

      {/* Toast Notification Banner */}
      {notificationMsg && (
        <div className="fixed bottom-20 right-6 z-50 p-3 rounded-xl bg-slate-900/95 border border-slate-700 text-xs text-white shadow-2xl flex items-center gap-2 animate-in fade-in">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{notificationMsg}</span>
        </div>
      )}

      {/* Report Modal */}
      <ReportModal
        isOpen={reportModalOpen}
        onClose={() => {
          setReportModalOpen(false);
          setReportTargetUser(null);
        }}
        targetType={reportTargetUser ? 'user' : 'room'}
        targetId={reportTargetUser?.targetId || activeRoom.id}
        reportedTargetName={reportTargetUser?.nickname || activeRoom.name.en}
        evidenceSnippet={reportTargetUser?.snippet || ''}
        roomId={activeRoom.id}
      />
    </div>
  );
};
