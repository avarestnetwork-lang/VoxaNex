import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { usePrivateChat } from '../context/PrivateChatContext';
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
import { safetyService } from '../services/safetyService';
import { Button } from '../components/ui/Button';
import { SEOHead } from '../components/common/SEOHead';
import { PrivateChatPane } from '../components/chat/PrivateChatPane';
import { AdPlacementBox } from '../components/ads/AdPlacementBox';
import { ADSTERRA_CONFIG } from '../config/adsConfig';
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
  Minimize2,
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
  const { user, hasActiveSession, is18Verified, ageDeclarationAccepted } = useAuth();
  const { openChat, openWindows, minimizeChat, closeChat } = usePrivateChat();

  const currentRoomSlug = params.roomId || 'bangla';
  const activeRoom = ROOMS_CONFIG.find((r) => r.slug === currentRoomSlug) || ROOMS_CONFIG[0];

  const [activeMainTab, setActiveMainTab] = useState<'room' | string>('room');

  const maximizedWindows = openWindows.filter(
    (win) => win.isOpen && win.displayMode === 'maximized'
  );
  const activeMaximizedWindow = maximizedWindows.find((w) => w.conversationId === activeMainTab);

  const prevMaximizedCountRef = useRef(maximizedWindows.length);
  useEffect(() => {
    if (maximizedWindows.length > prevMaximizedCountRef.current) {
      const latestMaximized = maximizedWindows[maximizedWindows.length - 1];
      if (latestMaximized) {
        setActiveMainTab(latestMaximized.conversationId);
      }
    }
    prevMaximizedCountRef.current = maximizedWindows.length;
  }, [maximizedWindows]);

  useEffect(() => {
    if (activeMainTab !== 'room' && !maximizedWindows.some((w) => w.conversationId === activeMainTab)) {
      setActiveMainTab('room');
    }
  }, [activeMainTab, maximizedWindows]);

  useEffect(() => {
    if (!hasActiveSession) {
      navigate('/user/guest-entry', { targetRoom: activeRoom.slug });
      return;
    }
    const hasAgeAccess = Boolean(is18Verified || user.is18Verified || ageDeclarationAccepted || user.ageDeclarationAccepted);
    if (activeRoom.is18Plus && !hasAgeAccess) {
      navigate('/user/guest-entry', { targetRoom: activeRoom.slug });
    }
  }, [hasActiveSession, activeRoom, is18Verified, user.is18Verified, ageDeclarationAccepted, user.ageDeclarationAccepted, navigate]);

  const [messages, setMessages] = useState<ExtendedChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const [onlineMembers, setOnlineMembers] = useState<RealtimePresenceMember[]>(() => {
    if (user?.id) {
      return [
        {
          id: user.id,
          nickname: user.nickname || 'You',
          avatar: user.avatar || '👤',
          isGuest: Boolean(user.isGuest),
          gender: user.gender,
          lastSeen: Date.now(),
        },
      ];
    }
    return [];
  });
  const [typers, setTypers] = useState<string[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);

  const [sidebarTab, setSidebarTab] = useState<'users' | 'private' | 'rooms'>('users');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

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
  >([]);

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

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTargetUser, setReportTargetUser] = useState<{ targetId: string; nickname: string; snippet?: string } | null>(null);
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  const [attachedMedia, setAttachedMedia] = useState<{ url: string; type: 'gif' | 'image'; title?: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const handleScrollMessages = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 120;
  };

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

  useEffect(() => {
    const unsubscribe = messagingService.subscribeToRoom(activeRoom.id, {
      onMessage: (newMsg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          if (newMsg.clientNonce && prev.some((m) => m.clientNonce === newMsg.clientNonce)) {
            return prev.map((m) =>
              m.clientNonce === newMsg.clientNonce
                ? { ...newMsg, status: 'delivered' }
                : m
            );
          }
          return [...prev, { ...newMsg, status: 'delivered' }];
        });
        if (isNearBottomRef.current) setTimeout(() => scrollToBottom(true), 50);
      },
      onPresence: (members) => {
        if (Array.isArray(members)) setOnlineMembers(members);
      },
      onTyping: (activeTypers) => {
        setTypers(activeTypers.filter((name) => name !== user.nickname));
      },
      onStatusChange: (status) => setConnectionStatus(status),
    });
    return () => unsubscribe();
  }, [activeRoom.id, user.nickname, scrollToBottom]);

  useEffect(() => {
    if (!user.id) return;
    let isMounted = true;
    const untrackSupabase = databaseService.trackPresence(activeRoom.id, {
      id: user.id,
      nickname: user.nickname || 'You',
      avatar: user.avatar || '👤',
      isGuest: Boolean(user.isGuest),
      gender: user.gender,
    }, (members) => {
      if (isMounted && Array.isArray(members) && members.length > 0) setOnlineMembers(members);
    });
    const sendHeartbeat = async () => {
      try {
        const members = await messagingService.sendPresence(activeRoom.id, {
          id: user.id,
          nickname: user.nickname || 'You',
          avatar: user.avatar || '👤',
          isGuest: Boolean(user.isGuest),
          gender: user.gender,
        });
        if (isMounted && Array.isArray(members)) setOnlineMembers(members);
      } catch (err) {}
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 25000);
    return () => {
      isMounted = false;
      clearInterval(interval);
      untrackSupabase();
      if (user?.id) messagingService.leaveRoom(activeRoom.id, user.id);
    };
  }, [activeRoom.id, user]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputText(val);
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

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery !== null) {
      const eligible = onlineMembers.filter(m => m.id !== user.id && m.nickname.toLowerCase().includes(mentionQuery.toLowerCase()));
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionSelectedIndex(prev => (prev + 1) % Math.max(1, eligible.length)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionSelectedIndex(prev => prev === 0 ? eligible.length - 1 : prev - 1); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && eligible.length > 0) { e.preventDefault(); handleSelectMention(eligible[mentionSelectedIndex]?.nickname || eligible[0].nickname); }
      else if (e.key === 'Escape') setMentionQuery(null);
    }
  };

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

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = inputText.trim();
    if (!clean && !attachedMedia) return;
    const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMsg: ExtendedChatMessage = {
      id: `temp_${Date.now()}`,
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
    setMessages(prev => [...prev, optimisticMsg]);
    setInputText('');
    setMentionQuery(null);
    const mediaToSend = attachedMedia;
    setAttachedMedia(null);
    setTimeout(() => scrollToBottom(true), 50);
    const result = await messagingService.sendRoomMessage(activeRoom.id, {
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      senderType: user.isGuest ? 'guest' : 'registered',
      content: clean,
      mediaUrl: mediaToSend?.url,
      mediaType: mediaToSend?.type,
      clientNonce: nonce,
    });
    if (!result.success) {
      setMessages(prev => prev.map(m => m.clientNonce === nonce ? { ...m, status: 'failed' } : m));
    }
  };

  const handleRetry = async (failedMsg: ExtendedChatMessage) => {
    setMessages(prev => prev.map(m => m.id === failedMsg.id ? { ...m, status: 'sending' } : m));
    const result = await messagingService.sendRoomMessage(activeRoom.id, {
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      senderType: user.isGuest ? 'guest' : 'registered',
      content: failedMsg.content,
      mediaUrl: failedMsg.mediaUrl,
      mediaType: failedMsg.mediaType,
    });
    if (result.success) setMessages(prev => prev.map(m => m.id === failedMsg.id ? { ...result.message!, status: 'delivered' } : m));
    else setMessages(prev => prev.map(m => m.id === failedMsg.id ? { ...m, status: 'failed' } : m));
  };

  const handleLoadOlder = async () => {
    if (messages.length === 0 || loadingHistory) return;
    const oldestTimestamp = messages[0].timestamp;
    setLoadingHistory(true);
    const res = await messagingService.fetchRoomHistory(activeRoom.id, 30, oldestTimestamp);
    if (res.success && res.messages.length > 0) {
      const fetched = res.messages.map(m => ({ ...m, status: 'delivered' as const }));
      setMessages(prev => {
        const combined = [...fetched, ...prev];
        return Array.from(new Map(combined.map(m => [m.id, m])).values())
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      });
    } else setHasMoreHistory(false);
    setLoadingHistory(false);
  };

  const handleUserClick = (e: React.MouseEvent, member: any) => {
    e.stopPropagation();
    setUserActionMenu({ member, position: { x: e.clientX, y: e.clientY } });
  };

  const handleOpenPrivateChat = (partner: any) => {
    openChat(partner);
    setShowMobileSidebar(false);
    setActiveMainTab('room');
  };

  const handleMentionFromMenu = (nickname: string) => {
    setInputText(prev => (prev ? `${prev} @${nickname} ` : `@${nickname} `));
    inputRef.current?.focus();
  };

  const renderMessageContent = (content: string) => {
    const parts = content.split(/(@[a-zA-Z0-9_]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        const mentionedName = part.slice(1);
        const isMe = user.nickname?.toLowerCase() === mentionedName.toLowerCase();
        return (
          <span key={i} className={`font-semibold px-1 py-0.5 rounded text-[11px] font-mono cursor-pointer ${isMe ? 'bg-amber-500/25 text-amber-300' : 'bg-cyan-950/70 text-cyan-300'}`}>
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const handleLeaveRoom = () => navigate('/rooms');

  const filteredMembers = onlineMembers.filter(m => m.nickname.toLowerCase().includes(userSearchQuery.toLowerCase()));

  return (
    <div className="relative w-full overflow-x-hidden min-h-[calc(100vh-5.5rem)] flex flex-col">
      <SEOHead
        title={`${activeRoom.name[language] || activeRoom.name.en} – ChatLustora`}
        description={`Real-time adult public group chat and live conversations in ${activeRoom.name[language] || activeRoom.name.en} on ChatLustora.`}
        canonicalPath="/chat"
        noindex={true}
      />

      {/* Side Advertisements */}
      <div className="hidden 3xl:block absolute left-4 top-24 bottom-24 w-[160px]">
        <AdPlacementBox slotId="public-chatroom-left-outer" adUnitId={ADSTERRA_CONFIG.nativeUnitId} isVertical={true} position="left" />
      </div>
      <div className="hidden 3xl:block absolute right-4 top-24 bottom-24 w-[160px]">
        <AdPlacementBox slotId="public-chatroom-right-outer" adUnitId={ADSTERRA_CONFIG.nativeUnitId} isVertical={true} position="right" />
      </div>

      <div className="max-w-7xl mx-auto w-full px-2 sm:px-4 lg:px-6 mt-4 mb-6 h-[calc(100vh-5.5rem)] min-h-[580px] flex flex-col">
        {/* Top Ad Slot */}
        <AdPlacementBox slotId="public-chatroom-top" adUnitId={ADSTERRA_CONFIG.banner728x90} position="top" />

        {/* Center Chatroom Container */}
        <div className="flex-1 flex flex-col overflow-hidden border border-slate-800 rounded-2xl bg-[#090d18] relative shadow-2xl min-w-0 ring-1 ring-slate-800/50">
          {/* Header Bar */}
          <div className="p-3 border-b border-slate-800 bg-[#0c1324] flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-x-auto no-scrollbar">
              <button onClick={() => navigate('/rooms')} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-xl cursor-pointer shrink-0"><Compass className="w-5 h-5 text-cyan-400" /></button>
              <button onClick={() => setActiveMainTab('room')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer shrink-0 ${activeMainTab === 'room' ? 'bg-[#080d19] border-cyan-500/80 text-white' : 'bg-[#080d19]/60 border-slate-800/90 text-slate-400'}`}><Hash className="w-3.5 h-3.5 text-cyan-400 shrink-0" /><span>{activeRoom.name[language]}</span></button>
              {maximizedWindows.map(win => (
                <div key={win.conversationId} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold shrink-0 ${activeMainTab === win.conversationId ? 'bg-violet-950/60 border-violet-500 text-white' : 'bg-[#080d19] border-slate-800/90 text-slate-400'}`}>
                  <button onClick={() => setActiveMainTab(win.conversationId)} className="flex items-center gap-1.5 min-w-0 cursor-pointer"><span className="text-sm">{win.partnerAvatar}</span><span className="truncate max-w-[100px]">{win.partnerNickname}</span></button>
                  <button onClick={() => { minimizeChat(win.conversationId); setActiveMainTab('room'); }} className="p-1 rounded hover:bg-slate-800 cursor-pointer"><Minimize2 className="w-3 h-3" /></button>
                  <button onClick={() => { closeChat(win.conversationId); setActiveMainTab('room'); }} className="p-1 rounded hover:bg-slate-800 cursor-pointer"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className={`hidden md:flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg border ${connectionStatus === 'connected' ? 'border-emerald-800/60 text-emerald-300' : 'border-rose-800/60 text-rose-300'}`}><Wifi className="w-3.5 h-3.5" /><span>{connectionStatus === 'connected' ? 'Connected' : 'Offline'}</span></div>
              <button onClick={() => setShowMobileSidebar(!showMobileSidebar)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-800 bg-[#101729] text-xs cursor-pointer"><Users className="w-3.5 h-3.5 text-cyan-400" /><span className="font-semibold">{onlineMembers.length}</span></button>
              <button onClick={() => setReportModalOpen(true)} className="p-2 text-rose-400 bg-rose-950/20 rounded-xl border border-rose-900/60 cursor-pointer"><AlertTriangle className="w-4 h-4" /></button>
              <button onClick={handleLeaveRoom} className="p-2 text-slate-400 hover:text-white bg-[#101729] rounded-xl border border-slate-800 cursor-pointer"><LogOut className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden relative">
            {activeMaximizedWindow ? (
              <div className="flex-1 flex flex-col overflow-hidden relative">
                <PrivateChatPane conversationId={activeMaximizedWindow.conversationId} partner={{ id: activeMaximizedWindow.partnerId, nickname: activeMaximizedWindow.partnerNickname, avatar: activeMaximizedWindow.partnerAvatar, gender: activeMaximizedWindow.partnerGender }} currentUser={{ id: user.id, nickname: user.nickname, avatar: user.avatar }} onClose={() => { minimizeChat(activeMaximizedWindow.conversationId); setActiveMainTab('room'); }} language={language} />
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-between overflow-hidden relative">
                <div className="px-4 py-2 bg-[#0c1324] border-b border-slate-800 text-[11px] text-slate-400 font-mono flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /><span>Live Chatroom Active · Click users to chat</span></div>
                  <span className="hidden md:inline">Asia/Dhaka</span>
                </div>
                {hasMoreHistory && (
                  <div className="p-2 text-center border-b border-slate-800/50 bg-[#090e1a]/90 shrink-0">
                    <button onClick={handleLoadOlder} disabled={loadingHistory} className="text-xs text-cyan-400 hover:underline cursor-pointer disabled:opacity-50"><span>{loadingHistory ? 'Loading...' : 'Load older messages'}</span></button>
                  </div>
                )}
                <div ref={messagesContainerRef} onScroll={handleScrollMessages} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-1.5">
                  {messages.map((msg, idx) => (
                    <div key={`${msg.id}-${idx}`} className={`group flex items-start gap-2.5 p-2 rounded-xl transition-colors ${idx % 2 === 0 ? 'bg-[#0d1424]/40' : 'bg-transparent'}`}>
                      <button onClick={(e) => handleUserClick(e, { id: msg.senderId, nickname: msg.senderNickname, avatar: msg.senderAvatar })} className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center text-sm shrink-0">{msg.senderAvatar}</button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <button onClick={(e) => handleUserClick(e, { id: msg.senderId, nickname: msg.senderNickname, avatar: msg.senderAvatar })} className={`font-bold text-xs truncate ${getGenderColor(onlineMembers.find(m => m.id === msg.senderId)?.gender)}`}>{msg.senderNickname}</button>
                            <GenderBadge gender={onlineMembers.find(m => m.id === msg.senderId)?.gender} />
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">[{formatDhakaTime(msg.timestamp, language)}]</span>
                        </div>
                        <div className="text-xs text-slate-200 leading-relaxed break-words">{renderMessageContent(msg.content)}</div>
                        {msg.mediaUrl && <div className="mt-2 rounded-xl overflow-hidden border border-slate-700/60 max-w-xs"><img src={msg.mediaUrl} className="w-full max-h-48 object-cover" /></div>}
                        {msg.linkPreview && <LinkPreviewCard preview={msg.linkPreview} />}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
                <TypingIndicator typers={typers} />
                {attachedMedia && (
                  <div className="px-4 py-2 bg-[#0c1222] border-t border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-slate-300"><img src={attachedMedia.url} className="w-10 h-10 object-cover rounded" /><span>{attachedMedia.title}</span></div>
                    <button onClick={() => setAttachedMedia(null)} className="text-xs text-rose-400">Remove</button>
                  </div>
                )}
                <div className="p-3 border-t border-slate-800 bg-[#0c1222] space-y-2 shrink-0">
                  <BanglishHelperBar onInsertText={(p) => setInputText(prev => prev ? `${prev} ${p}` : p)} />
                  <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                    <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-2 rounded-xl border border-slate-800 bg-[#101729] text-slate-400"><Smile className="w-4 h-4" /></button>
                    <button type="button" onClick={() => setShowGifPicker(!showGifPicker)} className="p-2 rounded-xl border border-slate-800 bg-[#101729] text-slate-400"><ImageIcon className="w-4 h-4" /></button>
                    <input ref={inputRef} type="text" value={inputText} onChange={handleInputChange} onKeyDown={handleInputKeyDown} placeholder="Type message..." className="flex-1 bg-[#101729] border border-slate-800 rounded-xl px-3.5 py-2 text-white focus:outline-none" />
                    <Button type="submit" variant="primary" size="md" className="rounded-xl"><Send className="w-4 h-4 mr-1.5" /><span>Send</span></Button>
                  </form>
                  {showEmojiPicker && <div className="absolute bottom-20 left-4 z-50"><EmojiPicker onSelectEmoji={(e) => { setInputText(prev => prev + e); setShowEmojiPicker(false); }} onClose={() => setShowEmojiPicker(false)} /></div>}
                  {showGifPicker && <div className="absolute bottom-20 left-12 z-50"><GifPicker onSelectGif={(g) => { setAttachedMedia({ url: g.url, type: 'gif', title: g.title }); setShowGifPicker(false); }} onClose={() => setShowGifPicker(false)} /></div>}
                </div>
                <div className="p-3 border-t border-slate-800 bg-[#090d18] text-[10px] text-slate-400 font-mono flex items-center justify-between">
                  <span>Multi-Transport Realtime</span><span>ChatLustora Edge</span>
                </div>
              </div>
            )}
          </div>

          <div className={`${showMobileSidebar ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'} fixed inset-y-0 right-0 z-40 lg:static w-72 sm:w-80 border-l border-slate-800 bg-[#0c1220] flex flex-col transition-transform duration-200`}>
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-1 bg-[#101729] p-1 rounded-xl border border-slate-800">
                <button onClick={() => setSidebarTab('users')} className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${sidebarTab === 'users' ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}>Users</button>
                <button onClick={() => setSidebarTab('private')} className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${sidebarTab === 'private' ? 'bg-violet-600 text-white' : 'text-slate-400'}`}>Private</button>
                <button onClick={() => setSidebarTab('rooms')} className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${sidebarTab === 'rooms' ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}>Rooms</button>
              </div>
              <button onClick={() => setShowMobileSidebar(false)} className="lg:hidden p-1.5 text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <AdPlacementBox slotId="participant-box-horizontal" adUnitId={ADSTERRA_CONFIG.banner320x50} position="sidebar-horizontal" />
            <div className="flex-1 overflow-y-auto p-3">
              {sidebarTab === 'users' && (
                <div className="space-y-1.5">
                  {filteredMembers.map(m => (
                    <div key={m.id} onClick={(e) => handleUserClick(e, m)} className="p-2.5 rounded-xl bg-[#101729] border border-slate-800 cursor-pointer flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0"><span className="text-lg">{m.avatar}</span><span className={`font-semibold truncate text-xs ${getGenderColor(m.gender)}`}>{m.nickname}</span></div><GenderBadge gender={m.gender} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <AdPlacementBox slotId="public-chatroom-bottom" adUnitId={ADSTERRA_CONFIG.banner728x90} position="bottom" />
      </div>

      {userActionMenu && <UserActionMenu member={userActionMenu.member} position={userActionMenu.position} onClose={() => setUserActionMenu(null)} onOpenPrivateChat={handleOpenPrivateChat} onMention={handleMentionFromMenu} onViewProfile={(m) => setProfileModalMember(m)} onBlockUser={async (targetId, targetNickname) => { await safetyService.toggleBlockUser({ blockerId: user.id, targetId, targetNickname, blocked: true }); setNotificationMsg(`Blocked ${targetNickname}`); setTimeout(() => setNotificationMsg(null), 2500); }} onReportUser={(targetId, targetNickname) => { setReportTargetUser({ targetId, nickname: targetNickname }); setReportModalOpen(true); }} isCurrentUser={userActionMenu.member.id === user.id} />}
      <UserProfileModal isOpen={Boolean(profileModalMember)} onClose={() => setProfileModalMember(null)} member={profileModalMember} onOpenPrivateChat={handleOpenPrivateChat} onMention={handleMentionFromMenu} onBlockUser={async (targetId, targetNickname) => { await safetyService.toggleBlockUser({ blockerId: user.id, targetId, targetNickname, blocked: true }); setNotificationMsg(`Blocked ${targetNickname}`); setTimeout(() => setNotificationMsg(null), 2500); }} isCurrentUser={profileModalMember?.id === user.id} />
      <ReportModal isOpen={reportModalOpen} onClose={() => { setReportModalOpen(false); setReportTargetUser(null); }} targetType={reportTargetUser ? 'user' : 'room'} targetId={reportTargetUser?.targetId || activeRoom.id} reportedTargetName={reportTargetUser?.nickname || activeRoom.name.en} evidenceSnippet={reportTargetUser?.snippet || ''} roomId={activeRoom.id} />
      {notificationMsg && <div className="fixed bottom-20 right-6 z-50 p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white shadow-2xl">{notificationMsg}</div>}
    </div>
  );
};
