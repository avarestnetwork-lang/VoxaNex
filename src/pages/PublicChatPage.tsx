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
import { safetyService } from '../services/safetyService';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
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
} from 'lucide-react';

interface ExtendedChatMessage extends ChatMessage {
  status?: 'sending' | 'delivered' | 'failed';
  mediaUrl?: string;
  mediaType?: 'gif' | 'image';
  linkPreview?: LinkPreviewData;
  errorReason?: string;
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

  // Pickers & Modals
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTargetUser, setReportTargetUser] = useState<{ targetId: string; nickname: string; snippet?: string } | null>(null);
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  // Attached media for current message
  const [attachedMedia, setAttachedMedia] = useState<{ url: string; type: 'gif' | 'image'; title?: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // 1. Initial message history load
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
            // Deduplicate by ID and sort chronologically
            const unique = Array.from(new Map(combined.map((m) => [m.id, m])).values());
            return unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          });
        } else if (res.messages.length === 0) {
          // Provide friendly room entrance system notice if empty
          setMessages([
            {
              id: 'sys-welcome',
              roomId: activeRoom.id,
              senderId: 'system',
              senderNickname: 'VoxaNex Guard',
              senderAvatar: '🛡️',
              content:
                language === 'bn'
                  ? `স্বাগতম "${activeRoom.name.bn}" চ্যানেলে! আলোচনায় পারস্পরিক শ্রদ্ধা রক্ষা করুন।`
                  : `Welcome to "${activeRoom.name.en}". Respect community conduct standards.`,
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

  // 2. Realtime SSE stream subscription
  useEffect(() => {
    // Supabase Broadcast presence subscription
    const unsubPresence = databaseService.subscribePresence(activeRoom.id, (presence) => {
      if (presence.payload.status === 'offline') {
        setOnlineMembers(prev => prev.filter(m => m.id !== presence.payload.id));
      }
    });

    const unsubscribe = messagingService.subscribeToRoom(activeRoom.id, {
      onMessage: (newMsg) => {
        console.log(`[Chat] Incoming message for ${activeRoom.id}:`, newMsg.id);
        setMessages((prev) => {
          // Deduplicate if already present by ID or nonce
          const exists = prev.some((m) => m.id === newMsg.id);
          if (exists) {
            console.log(`[Chat] Message ${newMsg.id} already exists, skipping.`);
            return prev;
          }
          console.log(`[Chat] Updating state with new message:`, newMsg.id);
          return [...prev, { ...newMsg, status: 'delivered' }];
        });
        setTimeout(scrollToBottom, 50);
      },
      onPresence: (members) => {
        setOnlineMembers(members);
      },
      onTyping: (activeTypers) => {
        // Exclude current user from typing display
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
    const interval = setInterval(sendHeartbeat, 25000); // Heartbeat every 25s
    return () => clearInterval(interval);
  }, [activeRoom.id, user]);

  // Handle typing input with debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    messagingService.sendTyping(activeRoom.id, user.id, user.nickname, true);

    typingTimeoutRef.current = setTimeout(() => {
      messagingService.sendTyping(activeRoom.id, user.id, user.nickname, false);
    }, 2500);
  };

  // 4. Send Message Handler
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = inputText.trim();
    if (!clean && !attachedMedia) return;

    const tempId = `temp_${Date.now()}`;
    const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Optimistic UI append
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
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setInputText('');
    const mediaToSend = attachedMedia;
    setAttachedMedia(null);
    setShowEmojiPicker(false);
    setShowGifPicker(false);
    setTimeout(scrollToBottom, 50);

    // Check for safe link preview if contains URL
    let linkPreview: LinkPreviewData | undefined;
    const urlMatch = clean.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch && !mediaToSend) {
      const previewRes = await messagingService.fetchLinkPreview(urlMatch[0]);
      if (previewRes) linkPreview = previewRes;
    }

    // Server-authoritative dispatch
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
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...result.message!, status: 'delivered', linkPreview } : m
        )
      );
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

  const handleLoadOlder = async () => {
    if (messages.length === 0 || loadingHistory) return;
    const oldestTimestamp = messages[0].timestamp;
    setLoadingHistory(true);

    const res = await messagingService.fetchRoomHistory(activeRoom.id, 30, oldestTimestamp);
    if (res.success && res.messages.length > 0) {
      const fetchedMessages = res.messages.map((m) => ({ ...m, status: 'delivered' as const }));
      setMessages((prev) => {
        const combined = [...fetchedMessages, ...prev];
        // Deduplicate by ID and sort chronologically
        const unique = Array.from(new Map(combined.map((m) => [m.id, m])).values());
        return unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      });
    } else {
      setHasMoreHistory(false);
    }
    setLoadingHistory(false);
  };

  const handleInsertBanglish = (phrase: string) => {
    setInputText((prev) => (prev ? `${prev} ${phrase}` : phrase));
  };

  const handleSelectEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleSelectGif = (gif: GifItem) => {
    setAttachedMedia({ url: gif.url, type: 'gif', title: gif.title });
    setShowGifPicker(false);
  };

  const handleLeaveRoom = () => {
    // Notify others of departure
    databaseService.broadcastPresence(activeRoom.id, {
      type: 'presence',
      payload: { id: user.id, status: 'offline' }
    });
    navigate('/rooms');
  };


  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 h-[calc(100vh-8.5rem)] min-h-[600px] flex flex-col">
      {/* Top Channel Bar */}
      <div className="p-3.5 rounded-t-xl border border-slate-800 bg-[#0c1222] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/rooms')}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-lg transition-colors cursor-pointer"
            title="Browse room directory"
          >
            <Compass className="w-5 h-5 text-cyan-400" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">
                {activeRoom.name[language]}
              </h1>
              {activeRoom.is18Plus && (
                <span className="text-[10px] font-semibold text-rose-400 border border-rose-800/60 bg-rose-950/30 px-1.5 py-0.5 rounded">
                  18+ Gated
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span>{activeRoom.categoryLabel[language]}</span>
              <span aria-hidden="true">·</span>
              <span className="uppercase font-mono">{activeRoom.language}</span>
            </div>
          </div>
        </div>

        {/* Live Network & Action Badges */}
        <div className="flex items-center gap-2">
          {/* Connection status badge */}
          <div
            className={`hidden sm:flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-md border ${
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

          <button
            onClick={() => setShowMembers(!showMembers)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
              showMembers
                ? 'bg-slate-800 border-slate-700 text-cyan-300'
                : 'border-slate-800 bg-[#101729] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {onlineMembers.length > 0 ? `${onlineMembers.length} Members` : t.chat.onlineList}
            </span>
          </button>

          <button
            onClick={() => setReportModalOpen(true)}
            className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-lg border border-rose-900/60 bg-rose-950/20 transition-colors cursor-pointer"
            title="Report channel or abuse"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleLeaveRoom}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-lg border border-slate-800 bg-[#101729] transition-colors cursor-pointer"
            title="Leave room"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main chat viewport */}
      <div className="flex-1 flex overflow-hidden border-x border-slate-800 bg-[#090d18] relative">
        <div className="flex-1 flex flex-col justify-between overflow-hidden">
          {/* Data retention & safety notice banner */}
          <div className="p-2 bg-[#0c1324] border-b border-slate-800 text-[11px] text-slate-400 font-mono flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-1.5">
              {connectionStatus === 'connected' ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Real-Time SSE Channel Active · Rolling 30-Day Retention · Zero-Harassment Rules</span>
                </>
              ) : connectionStatus === 'connecting' ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                  <span className="text-cyan-300">Connecting to Real-Time SSE Channel... · Rolling 30-Day Retention</span>
                </>
              ) : connectionStatus === 'reconnecting' ? (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                  <span className="text-amber-300">Reconnecting to Real-Time Channel... · Auto-retrying</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-rose-300">Real-Time Channel Disconnected</span>
                </>
              )}
            </div>
            <span className="text-slate-500 hidden md:inline">Asia/Dhaka</span>
          </div>

          {/* Pagination header */}
          {hasMoreHistory && (
            <div className="p-2 text-center border-b border-slate-800/50 bg-[#090e1a]/80 shrink-0">
              <button
                onClick={handleLoadOlder}
                disabled={loadingHistory}
                className="text-xs text-cyan-400 hover:underline inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <ArrowUp className="w-3 h-3" />
                <span>{loadingHistory ? 'Fetching earlier messages...' : 'Load older messages'}</span>
              </button>
            </div>
          )}

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {messages.map((msg, idx) => {
              const isMe = msg.senderId === user.id;

              if (msg.isSystem) {
                return (
                  <div
                    key={`${msg.id}-${idx}`}
                    className="p-3 rounded-lg bg-[#111728]/80 border border-slate-800 text-xs text-slate-300 flex items-start gap-2.5 max-w-xl mx-auto"
                  >
                    <span className="text-base select-none">{msg.senderAvatar}</span>
                    <div className="flex-1">
                      <div className="font-semibold text-cyan-300 text-[11px] mb-0.5">
                        {msg.senderNickname}
                      </div>
                      <p className="leading-relaxed">{msg.content}</p>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono shrink-0">
                      {formatDhakaTime(msg.timestamp, language)}
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={`${msg.id}-${idx}`}
                  className={`flex items-start gap-2.5 max-w-xl ${
                    isMe ? 'ml-auto flex-row-reverse' : ''
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-sm shrink-0 select-none">
                    {msg.senderAvatar}
                  </div>
                  <div
                    className={`rounded-xl p-3 text-xs leading-relaxed max-w-sm sm:max-w-md ${
                      isMe
                        ? 'bg-violet-600 text-white rounded-tr-none'
                        : 'bg-[#12192c] border border-slate-800 text-slate-200 rounded-tl-none'
                    }`}
                  >
                    <div
                      className={`flex items-center justify-between gap-3 text-[10px] mb-1 ${
                        isMe ? 'text-violet-200' : 'text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{msg.senderNickname}</span>
                        {!isMe && (
                          <div className="flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => {
                                setReportTargetUser({
                                  targetId: msg.senderId,
                                  nickname: msg.senderNickname,
                                  snippet: msg.content,
                                });
                                setReportModalOpen(true);
                              }}
                              className="text-[10px] text-slate-400 hover:text-rose-400 cursor-pointer"
                            >
                              Report
                            </button>
                            <span className="text-slate-600">·</span>
                            <button
                              type="button"
                              onClick={async () => {
                                await safetyService.toggleBlockUser({
                                  blockerId: user.id,
                                  targetId: msg.senderId,
                                  targetNickname: msg.senderNickname,
                                  blocked: true,
                                });
                                setNotificationMsg(`Blocked ${msg.senderNickname}`);
                                setTimeout(() => setNotificationMsg(null), 2500);
                              }}
                              className="text-[10px] text-slate-400 hover:text-amber-400 cursor-pointer"
                            >
                              Block
                            </button>
                          </div>
                        )}
                      </div>
                      <span className="font-mono">
                        {formatDhakaTime(msg.timestamp, language)}
                      </span>
                    </div>

                    {/* Text content */}
                    {msg.content && <p className="break-words whitespace-pre-wrap">{msg.content}</p>}

                    {/* Attached GIF / Media */}
                    {msg.mediaUrl && (
                      <div className="mt-2 rounded-lg overflow-hidden border border-slate-700/60 max-w-xs">
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

                    {/* Delivery & Failure state */}
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
                className="text-xs text-rose-400 hover:text-white"
              >
                Remove
              </button>
            </div>
          )}

          {/* Banglish Helper & Composer Dock */}
          <div className="p-3 border-t border-slate-800 bg-[#0c1222] space-y-2 shrink-0 relative">
            <BanglishHelperBar onInsertText={handleInsertBanglish} />

            {/* Emoji & GIF Popovers */}
            {showEmojiPicker && (
              <EmojiPicker
                onSelectEmoji={handleSelectEmoji}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
            {showGifPicker && (
              <GifPicker
                onSelectGif={handleSelectGif}
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
                  className={`p-2 rounded-lg border transition-colors cursor-pointer ${
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
                  className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                    showGifPicker
                      ? 'bg-fuchsia-600 text-white border-fuchsia-500'
                      : 'border-slate-800 bg-[#101729] text-slate-400 hover:text-white'
                  }`}
                  title="Curated GIF search"
                >
                  <ImageIcon className="w-4 h-4" />
                </button>
              </div>

              <input
                type="text"
                value={inputText}
                onChange={handleInputChange}
                maxLength={2000}
                placeholder={t.chat.inputPlaceholder}
                className="flex-1 bg-[#101729] border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              />

              <Button type="submit" variant="primary" size="md" className="shrink-0">
                <Send className="w-4 h-4 mr-1.5" />
                <span>{t.chat.sendBtn}</span>
              </Button>
            </form>
          </div>
        </div>

        {/* Online Members Sidebar */}
        {showMembers && (
          <div className="w-72 border-l border-slate-800 bg-[#0c1220] p-4 flex flex-col justify-between shrink-0">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-xs text-slate-300 font-semibold">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-orange-500" />
                  <span>{t.chat.onlineList}</span>
                </div>
                <span className="text-[11px] text-cyan-400 font-mono px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-800/40">
                  {1 + onlineMembers.filter((m) => m.id !== user.id).length} Active
                </span>
              </div>

              <div className="mt-3 space-y-2 text-xs overflow-y-auto max-h-[60vh] pr-1">
                {/* Current user */}
                <div className="p-2.5 rounded-xl bg-violet-950/30 border border-violet-900/50 shadow-sm">
                  <div className="flex items-center justify-between gap-1.5 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg select-none shrink-0">{user.avatar || '👤'}</span>
                      <span className={`font-bold truncate text-sm ${getGenderColor(user.gender)}`}>
                        {user.nickname}
                      </span>
                    </div>
                    <GenderBadge gender={user.gender} />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-violet-300 pt-1 border-t border-violet-900/30">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>You ({user.isGuest ? 'Guest' : 'Member'})</span>
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-violet-400">Online</span>
                  </div>
                </div>

                {/* Real-time active members */}
                {onlineMembers
                  .filter((m) => m.id !== user.id)
                  .map((member) => (
                    <div
                      key={member.id}
                      className="p-2.5 rounded-xl bg-[#101729] hover:bg-[#141d33] border border-slate-800/80 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lg select-none shrink-0">{member.avatar || '👤'}</span>
                          <span className={`font-semibold truncate text-xs ${getGenderColor(member.gender)}`}>
                            {member.nickname}
                          </span>
                        </div>
                        <GenderBadge gender={member.gender} />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/50">
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <span>{member.isGuest ? 'Guest Session' : 'Member'}</span>
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500">Active</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101729] border border-slate-800 text-[10px] text-slate-400 space-y-1">
              <span className="font-semibold text-slate-300 block">SSE Presence Heartbeat</span>
              <p>Active participants update automatically every 25 seconds.</p>
            </div>
          </div>
        )}
      </div>

      {/* Toast Notification Banner */}
      {notificationMsg && (
        <div className="fixed bottom-20 right-6 z-50 p-3 rounded-xl bg-slate-900/90 border border-slate-700 text-xs text-white shadow-xl flex items-center gap-2 animate-in fade-in">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>{notificationMsg}</span>
        </div>
      )}

      {/* Real Phase 6 Safety Report Modal */}
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
