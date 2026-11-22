import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { usePrivateChat } from '../context/PrivateChatContext';
import { ROOMS_CONFIG } from '../config/voxanexConfig';
import { ChatMessage, Room } from '../types';
import { formatDhakaTime } from '../utils/date';
import { databaseService, isCanonicalRoomId } from '../services/databaseService';
import { guestSessionService } from '../services/guestSessionService';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { EmojiPicker } from '../components/chat/EmojiPicker';
import { GifPicker } from '../components/chat/GifPicker';
import { LinkPreviewCard } from '../components/chat/LinkPreviewCard';
import { TypingIndicator } from '../components/chat/TypingIndicator';
import { ReportModal } from '../components/chat/ReportModal';
import { UserActionMenu } from '../components/chat/UserActionMenu';
import { MentionAutocomplete } from '../components/chat/MentionAutocomplete';
import { UserProfileModal } from '../components/chat/UserProfileModal';
import { SecureMediaRenderer } from '../components/chat/SecureMediaRenderer';
import { ComposerAttachmentPreview } from '../components/chat/ComposerAttachmentPreview';
import { useChatMediaAttachment } from '../hooks/useChatMediaAttachment';
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  AUDIO_ACCEPT_ATTRIBUTE,
  SUPPORTED_IMAGE_FORMATS_TEXT,
  SUPPORTED_AUDIO_FORMATS_TEXT,
} from '../lib/mediaValidation';
import { safetyService } from '../services/safetyService';
import { Button } from '../components/ui/Button';
import { SEOHead } from '../components/common/SEOHead';
import { PrivateChatPane } from '../components/chat/PrivateChatPane';
import { AdPlacementBox } from '../components/ads/AdPlacementBox';
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
  Paperclip,
  Upload,
  AlertTriangle,
  RotateCcw,
  LogOut,
  Wifi,
  WifiOff,
  ShieldCheck,
  Lock,
  ArrowUp,
  ArrowRight,
  Clock,
  Sparkles,
  MessageSquare,
  Search,
  X,
  Menu,
  ChevronRight,
  Hash,
  Minimize2,
  Video,
  Shuffle,
  Globe2,
} from 'lucide-react';

interface ExtendedChatMessage extends ChatMessage {
  status?: 'sending' | 'delivered' | 'failed';
  mediaUrl?: string;
  mediaType?: 'gif' | 'image' | 'audio';
  linkPreview?: LinkPreviewData;
  errorReason?: string;
  clientNonce?: string;
}

export type BFCacheValidationResult =
  | { status: 'valid' }
  | { status: 'invalid'; reason?: string }
  | { status: 'denied'; reason?: string }
  | { status: 'network_error'; reason?: string };

export interface RevalidateSessionAccessParams {
  roomId: string;
  roomIs18Plus: boolean;
  expectedUserId: string;
  isGuest: boolean;
  hasLocalAgeAccess: boolean;
  isSupabaseConfiguredFn?: () => boolean;
  getSupabaseClientFn?: () => any;
  validateGuestTokenFn?: (token?: string) => Promise<{
    valid: boolean;
    session?: {
      id?: string;
      expiresAt?: number;
      is18Verified?: boolean;
      ageDeclarationAccepted?: boolean;
    };
    status?: 'valid' | 'invalid' | 'network_error';
    error?: string;
  }>;
  getStoredGuestTokenFn?: () => string | null;
  getStoredProfileFn?: () => string | null;
  isStillCurrent?: () => boolean;
}

function isAuthNetworkFailure(err: any): boolean {
  if (!err) return false;
  const name = typeof err.name === 'string' ? err.name : '';
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  const status = typeof err.status === 'number' ? err.status : undefined;
  if (status === 401 || status === 403 || status === 400 || status === 404) {
    return false;
  }
  if (typeof status === 'number' && status >= 500) {
    return true;
  }
  if (name === 'AuthRetryableFetchError') {
    return true;
  }
  return (
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('offline')
  );
}

/**
 * Revalidates the underlying guest token or Supabase member session AND room access
 * before restarting Presence after BFCache restoration.
 */
export async function revalidateRoomSessionAndAccess(
  params: RevalidateSessionAccessParams
): Promise<BFCacheValidationResult> {
  if (!isCanonicalRoomId(params.roomId)) {
    return { status: 'denied', reason: 'Non-canonical chatroom.' };
  }
  if (!params.expectedUserId) {
    return { status: 'invalid', reason: 'Missing active user session.' };
  }

  if (params.isGuest) {
    const getToken = params.getStoredGuestTokenFn ?? (() => guestSessionService.getStoredToken());
    const token = getToken();
    if (!token) {
      return { status: 'invalid', reason: 'Guest session token missing.' };
    }

    const validateFn =
      params.validateGuestTokenFn ?? ((t?: string) => guestSessionService.validateSession(t));

    let check: Awaited<ReturnType<typeof validateFn>>;
    try {
      check = await validateFn(token);
    } catch {
      return { status: 'network_error', reason: 'Network error validating guest session.' };
    }

    if (params.isStillCurrent && !params.isStillCurrent()) {
      return { status: 'invalid', reason: 'Lifecycle no longer current.' };
    }

    if (check.status === 'network_error') {
      return {
        status: 'network_error',
        reason: check.error || 'Network error validating guest session.',
      };
    }

    if (!check.valid || !check.session) {
      return {
        status: 'invalid',
        reason: check.error || 'Guest session is invalid, expired, or revoked.',
      };
    }

    if (
      typeof check.session.expiresAt === 'number' &&
      Number.isFinite(check.session.expiresAt) &&
      Date.now() >= check.session.expiresAt
    ) {
      return { status: 'invalid', reason: 'Guest session has expired.' };
    }

    if (check.session.id && check.session.id !== params.expectedUserId) {
      return { status: 'invalid', reason: 'Guest identity changed.' };
    }

    const hasVerifiedAdultAccess = Boolean(
      check.session.is18Verified || check.session.ageDeclarationAccepted || params.hasLocalAgeAccess
    );
    if (params.roomIs18Plus && !hasVerifiedAdultAccess) {
      return { status: 'denied', reason: 'Adult room access verification required.' };
    }

    return { status: 'valid' };
  }

  // Authenticated member revalidation
  const supabaseConfigured = (params.isSupabaseConfiguredFn ?? isSupabaseConfigured)();
  if (!supabaseConfigured) {
    // Offline / local simulation mode: verify stored local profile consistency without bypassing room gates
    const getProfileRaw =
      params.getStoredProfileFn ??
      (() => (typeof localStorage !== 'undefined' ? localStorage.getItem('voxanex_user_profile') : null));
    const raw = getProfileRaw();
    if (!raw) {
      return { status: 'invalid', reason: 'Member session no longer present.' };
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.id !== params.expectedUserId || parsed.isGuest === true) {
        return { status: 'invalid', reason: 'Member identity mismatch.' };
      }
    } catch {
      return { status: 'invalid', reason: 'Corrupted local session state.' };
    }
    if (params.roomIs18Plus && !params.hasLocalAgeAccess) {
      return { status: 'denied', reason: 'Adult room access verification required.' };
    }
    return { status: 'valid' };
  }

  const supabase = (params.getSupabaseClientFn ?? getSupabaseClient)();
  if (!supabase || !supabase.auth) {
    return { status: 'network_error', reason: 'Authentication client unavailable.' };
  }

  try {
    const sessionRes = await supabase.auth.getSession();
    if (params.isStillCurrent && !params.isStillCurrent()) {
      return { status: 'invalid', reason: 'Lifecycle no longer current.' };
    }
    if (sessionRes?.error) {
      return isAuthNetworkFailure(sessionRes.error)
        ? { status: 'network_error', reason: 'Network error reading member session.' }
        : { status: 'invalid', reason: 'Member session error.' };
    }
    const activeSession = sessionRes?.data?.session;
    if (!activeSession?.user?.id || activeSession.user.id !== params.expectedUserId) {
      return { status: 'invalid', reason: 'Member session is missing or mismatched.' };
    }

    if (typeof supabase.auth.getUser === 'function') {
      const userRes = await supabase.auth.getUser();
      if (params.isStillCurrent && !params.isStillCurrent()) {
        return { status: 'invalid', reason: 'Lifecycle no longer current.' };
      }
      if (userRes?.error) {
        return isAuthNetworkFailure(userRes.error)
          ? { status: 'network_error', reason: 'Network error validating member session.' }
          : { status: 'invalid', reason: 'Member session is invalid or expired.' };
      }
      if (!userRes?.data?.user?.id || userRes.data.user.id !== params.expectedUserId) {
        return { status: 'invalid', reason: 'Authenticated user mismatch.' };
      }
    }

    if (params.roomIs18Plus && !params.hasLocalAgeAccess) {
      return { status: 'denied', reason: 'Adult room access verification required.' };
    }

    return { status: 'valid' };
  } catch (err) {
    return isAuthNetworkFailure(err)
      ? { status: 'network_error', reason: 'Network error verifying member session.' }
      : { status: 'invalid', reason: 'Unable to validate member session.' };
  }
}

export interface RoomPresenceLifecycleOptions {
  isStealth: boolean;
  canTrack: () => boolean;
  startRealtimePresence: () => () => void;
  sendHeartbeat: () => Promise<void> | void;
  sendLeave: () => Promise<void> | void;
  validateSessionAndAccess?: () => Promise<BFCacheValidationResult> | BFCacheValidationResult;
  onValidationFailed?: (result: Exclude<BFCacheValidationResult, { status: 'valid' }>) => void;
  heartbeatIntervalMs?: number;
  eventTarget?: {
    addEventListener: (event: string, listener: (e: any) => void) => void;
    removeEventListener: (event: string, listener: (e: any) => void) => void;
  } | null;
}

export interface RoomPresenceLifecycleHandle {
  dispose: () => void;
  handlePageHide: () => void;
  handlePageShow: (event?: { persisted?: boolean }) => Promise<void>;
  isActive: () => boolean;
  isValidating: () => boolean;
}

/**
 * Manages room presence tracking across browser BFCache transitions (`pagehide` / `pageshow`)
 * and React mount/unmount with fresh session + room-access revalidation on BFCache restore.
 */
export function createRoomPresenceLifecycle(
  options: RoomPresenceLifecycleOptions
): RoomPresenceLifecycleHandle {
  let disposed = false;
  let active = false;
  let validating = false;
  let needsOnlineRetry = false;
  let validationSeq = 0;
  let untrackRealtime: (() => void) | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (disposed || active || !options.canTrack()) return;
    active = true;
    needsOnlineRetry = false;
    untrackRealtime = options.startRealtimePresence();

    if (!options.isStealth) {
      Promise.resolve(options.sendHeartbeat()).catch(() => {});
      heartbeatTimer = setInterval(() => {
        if (!disposed && active && options.canTrack()) {
          Promise.resolve(options.sendHeartbeat()).catch(() => {});
        }
      }, options.heartbeatIntervalMs ?? 25000);
    }
  };

  const stop = () => {
    validationSeq++;
    validating = false;
    needsOnlineRetry = false;
    if (!active) return;
    active = false;
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (untrackRealtime) {
      const cleanupFn = untrackRealtime;
      untrackRealtime = null;
      cleanupFn();
    }
    if (!options.isStealth) {
      Promise.resolve(options.sendLeave()).catch(() => {});
    }
  };

  const runRestoreValidation = async () => {
    if (disposed || active || validating || !options.canTrack()) return;

    if (!options.validateSessionAndAccess) {
      start();
      return;
    }

    const seq = ++validationSeq;
    validating = true;

    let result: BFCacheValidationResult;
    try {
      result = await options.validateSessionAndAccess();
    } catch {
      result = { status: 'network_error', reason: 'Validation failed unexpectedly.' };
    }

    if (disposed || validationSeq !== seq) {
      return;
    }

    validating = false;

    if (!options.canTrack()) {
      return;
    }

    if (result.status !== 'valid') {
      if (result.status === 'network_error') {
        needsOnlineRetry = true;
      } else {
        needsOnlineRetry = false;
      }
      options.onValidationFailed?.(result);
      return;
    }

    start();
  };

  const handlePageHide = () => {
    stop();
  };

  const handlePageShow = async (event?: { persisted?: boolean }) => {
    if (disposed || !event?.persisted) return;
    if (active || validating) return;
    if (!options.canTrack()) return;
    await runRestoreValidation();
  };

  const handleOnline = () => {
    if (disposed || active || validating || !needsOnlineRetry) return;
    if (!options.canTrack()) return;
    void runRestoreValidation();
  };

  const target =
    options.eventTarget !== undefined
      ? options.eventTarget
      : typeof window !== 'undefined' &&
          typeof window.addEventListener === 'function' &&
          typeof window.removeEventListener === 'function'
        ? window
        : null;

  if (target) {
    target.addEventListener('pagehide', handlePageHide);
    target.addEventListener('pageshow', handlePageShow);
    target.addEventListener('online', handleOnline);
  }

  start();

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      validationSeq++;
      validating = false;
      needsOnlineRetry = false;
      if (target) {
        target.removeEventListener('pagehide', handlePageHide);
        target.removeEventListener('pageshow', handlePageShow);
        target.removeEventListener('online', handleOnline);
      }
      stop();
    },
    handlePageHide,
    handlePageShow,
    isActive: () => active,
    isValidating: () => validating,
  };
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

export function getExploreRoomsForSlug(activeSlug: string): Room[] {
  return ROOMS_CONFIG.filter((r) => r.slug !== activeSlug);
}

export const PublicChatPage: React.FC = () => {
  const { params, navigate } = useRouter();
  const { language, t } = useLanguage();
  const { user, hasActiveSession, isLoading, is18Verified, ageDeclarationAccepted } = useAuth();
  const { openChat, openWindows, minimizeChat, closeChat } = usePrivateChat();

  const currentRoomSlug = params.roomId || 'bangla';
  const activeRoom = ROOMS_CONFIG.find((r) => r.slug === currentRoomSlug) || ROOMS_CONFIG[0];
  const hasAgeAccess = Boolean(
    is18Verified || user.is18Verified || ageDeclarationAccepted || user.ageDeclarationAccepted
  );
  const canAccessRoom = !isLoading && hasActiveSession && (!activeRoom.is18Plus || hasAgeAccess);

  const liveAccessRef = useRef({
    canAccessRoom,
    hasActiveSession,
    userId: user.id,
    isGuest: Boolean(user.isGuest),
    hasAgeAccess,
    roomId: activeRoom.id,
    roomSlug: activeRoom.slug,
    roomIs18Plus: activeRoom.is18Plus,
  });
  liveAccessRef.current = {
    canAccessRoom,
    hasActiveSession,
    userId: user.id,
    isGuest: Boolean(user.isGuest),
    hasAgeAccess,
    roomId: activeRoom.id,
    roomSlug: activeRoom.slug,
    roomIs18Plus: activeRoom.is18Plus,
  };

  // Authoritative main view tab: 'room' for public group chat, or conversationId for maximized private chat
  const [activeMainTab, setActiveMainTab] = useState<'room' | string>('room');
  const [exploreAdFailed, setExploreAdFailed] = useState(false);

  // Rule 6 & 7: The expanded/tab-style renderer must render ONLY conversations whose mode is 'maximized'
  const maximizedWindows = openWindows.filter(
    (win) => win.isOpen && win.displayMode === 'maximized'
  );
  const activeMaximizedWindow = maximizedWindows.find((w) => w.conversationId === activeMainTab);

  // If a window is newly maximized, switch active tab to it
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

  // If active tab was a maximized private chat that is closed/minimized, fallback cleanly to 'room'
  useEffect(() => {
    if (activeMainTab !== 'room' && !maximizedWindows.some((w) => w.conversationId === activeMainTab)) {
      setActiveMainTab('room');
    }
  }, [activeMainTab, maximizedWindows]);

  // Mandatory Sign-In Gateway & 18+ Access Gate enforcement
  useEffect(() => {
    if (isLoading) return;
    if (!hasActiveSession) {
      navigate('/user/guest-entry', { targetRoom: activeRoom.slug });
      return;
    }
    if (activeRoom.is18Plus && !hasAgeAccess) {
      navigate('/age-gate', { targetRoom: activeRoom.slug });
    }
  }, [isLoading, hasActiveSession, activeRoom.slug, activeRoom.is18Plus, hasAgeAccess, navigate]);

  const [messages, setMessages] = useState<ExtendedChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const [onlineMembers, setOnlineMembers] = useState<RealtimePresenceMember[]>(() => {
    if (user?.id && user?.onlineVisibility !== 'stealth_invisible') {
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

  // Chatroom View State & Sidebar Tabs
  const [sidebarTab, setSidebarTab] = useState<'users' | 'private' | 'rooms'>('users');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

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
  >([]);

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
  const [showImageMenu, setShowImageMenu] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTargetUser, setReportTargetUser] = useState<{ targetId: string; nickname: string; snippet?: string } | null>(null);
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);

  const {
    attachment,
    stagedMedia,
    isBusy: isAttachmentBusy,
    canSendMessage,
    selectFile,
    selectGif,
    cancelUpload,
    retryUpload,
    removeAttachment,
    markSent,
  } = useChatMediaAttachment({
    contextType: 'room',
    contextId: activeRoom.id,
    isGuest: user.isGuest,
    userId: user.id,
  });

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
    if (!canAccessRoom) return;
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
              senderNickname: 'ChatLustora Guard',
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
  }, [canAccessRoom, activeRoom.id, language, scrollToBottom]);

  // 2. Realtime SSE & Supabase Realtime stream subscription
  useEffect(() => {
    if (!canAccessRoom) return;
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
        console.log('[DIAGNOSTIC] presence_sync_received', { roomId: activeRoom.id, count: members?.length || 0 });
        if (Array.isArray(members)) {
          setOnlineMembers((prev) => {
            if (members.length === 0 && user?.id) {
              return prev;
            }
            return members;
          });
        }
        console.log('[DIAGNOSTIC] active_user_list_updated', { count: members?.length || 0 });
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
    };
  }, [canAccessRoom, activeRoom.id, user.nickname, scrollToBottom]);

  // 3. Presence Tracking via Supabase Realtime Presence & HTTP fallback (BFCache-safe)
  useEffect(() => {
    if (!canAccessRoom || !user.id) return;
    let isMounted = true;
    const isStealth = user.onlineVisibility === 'stealth_invisible';
    const capturedUserId = user.id;
    const capturedIsGuest = Boolean(user.isGuest);
    const capturedRoomId = activeRoom.id;
    const capturedRoomSlug = activeRoom.slug;
    const capturedRoomIs18Plus = activeRoom.is18Plus;

    const isStillCurrentContext = () =>
      isMounted &&
      liveAccessRef.current.canAccessRoom &&
      liveAccessRef.current.roomId === capturedRoomId &&
      liveAccessRef.current.userId === capturedUserId;

    const lifecycle = createRoomPresenceLifecycle({
      isStealth,
      canTrack: isStillCurrentContext,
      validateSessionAndAccess: () =>
        revalidateRoomSessionAndAccess({
          roomId: capturedRoomId,
          roomIs18Plus: capturedRoomIs18Plus,
          expectedUserId: capturedUserId,
          isGuest: capturedIsGuest,
          hasLocalAgeAccess: liveAccessRef.current.hasAgeAccess,
          isStillCurrent: isStillCurrentContext,
        }),
      onValidationFailed: (result) => {
        if (!isMounted || liveAccessRef.current.roomId !== capturedRoomId) return;
        if (result.status === 'invalid') {
          navigate('/user/guest-entry', { targetRoom: capturedRoomSlug });
        } else if (result.status === 'denied') {
          navigate('/age-gate', { targetRoom: capturedRoomSlug });
        }
        // On 'network_error': keep session unverified and Presence inactive without falsely reporting logout
      },
      startRealtimePresence: () =>
        databaseService.trackPresence(
          capturedRoomId,
          {
            id: capturedUserId,
            nickname: user.nickname || 'You',
            avatar: user.avatar || '👤',
            isGuest: capturedIsGuest,
            gender: user.gender,
            onlineVisibility: user.onlineVisibility,
          },
          (members) => {
            if (isMounted && Array.isArray(members) && (members.length > 0 || isStealth)) {
              setOnlineMembers(members);
            }
          }
        ),
      sendHeartbeat: async () => {
        if (isStealth) return;
        try {
          const members = await messagingService.sendPresence(capturedRoomId, {
            id: capturedUserId,
            nickname: user.nickname || 'You',
            avatar: user.avatar || '👤',
            isGuest: capturedIsGuest,
            gender: user.gender,
          });
          if (isMounted && Array.isArray(members) && members.length > 0) {
            setOnlineMembers((prev) => {
              // Merge gracefully without wiping out real-time presence
              const merged = [...members];
              prev.forEach((m) => {
                if (!merged.some((x) => x.id === m.id)) merged.push(m);
              });
              return merged;
            });
          }
        } catch (err) {
          console.warn('Presence heartbeat non-fatal error:', err);
        }
      },
      sendLeave: () => {
        if (capturedUserId && !isStealth) {
          messagingService.leaveRoom(capturedRoomId, capturedUserId);
        }
      },
    });

    return () => {
      isMounted = false;
      lifecycle.dispose();
    };
  }, [canAccessRoom, activeRoom.id, activeRoom.slug, activeRoom.is18Plus, user, navigate]);

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
    if (!canSendMessage(clean)) return;

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const mediaToSend = stagedMedia;

    const optimisticMsg: ExtendedChatMessage = {
      id: tempId,
      roomId: activeRoom.id,
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      content: clean,
      mediaUrl: mediaToSend?.url,
      mediaType: mediaToSend?.type,
      timestamp: new Date().toISOString(),
      status: 'sending',
      clientNonce: nonce,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setInputText('');
    setMentionQuery(null);
    markSent();
    setShowEmojiPicker(false);
    setShowGifPicker(false);
    setShowImageMenu(false);
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

  // Open Direct 1-on-1 Chat with Partner (Rule 1 & 8: exactly ONE compact floating window, main view stays on room tab)
  const handleOpenPrivateChat = (partner: {
    id: string;
    nickname: string;
    avatar: string;
    gender?: string;
    isGuest?: boolean;
  }) => {
    openChat(partner);
    setShowMobileSidebar(false);
    setActiveMainTab('room');

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

  if (!canAccessRoom) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-sm text-slate-400 font-medium">
          {isLoading
            ? 'Validating session...'
            : !hasActiveSession
            ? 'Redirecting to room entry...'
            : 'Redirecting to 18+ age confirmation...'}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-x-clip min-h-[calc(100dvh-4.5rem)] flex flex-col">
      <SEOHead
        title={`${activeRoom.name[language] || activeRoom.name.en} – ChatLustora`}
        description={`Real-time adult public group chat and live conversations in ${activeRoom.name[language] || activeRoom.name.en} on ChatLustora.`}
        canonicalPath="/chat"
        noindex={true}
      />

      {/* Ad 1 — Header Horizontal Ad (Immediately below header, equal vertical spacing) */}
      <div className="w-full max-w-7xl mx-auto px-0 sm:px-4 lg:px-6 my-2 shrink-0 flex justify-center">
        <AdPlacementBox
          slotId="public-chatroom-top"
          position="top"
        />
      </div>

      {/* Main Responsive Workspace containing Full-Width Central Chatroom Container (no empty side rails without verified vertical units) */}
      <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 mb-4 h-[calc(100dvh-10.25rem)] md:h-[calc(100dvh-12.5rem)] min-h-[380px] sm:min-h-[420px] max-h-[880px] flex items-stretch overflow-hidden">
        {/* Central Chatroom Container */}
        <div
          data-testid="central-chatroom-container"
          className="flex-1 flex flex-col overflow-hidden border border-slate-800 rounded-2xl bg-[#090d18] relative shadow-2xl min-w-0 min-h-0 ring-1 ring-slate-800/50"
        >
          <div className="p-3 border-b border-slate-800 bg-[#0c1324] flex items-center justify-between gap-3 shrink-0">
            {/* ... tab buttons ... */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => navigate('/rooms')}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-xl transition-colors cursor-pointer shrink-0"
            title="Browse room directory"
          >
            <Compass className="w-5 h-5 text-cyan-400" />
          </button>

          {/* Public Room Tab */}
          <button
            type="button"
            data-testid="public-room-tab"
            onClick={() => setActiveMainTab('room')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer shrink-0 ${
              activeMainTab === 'room'
                ? 'bg-[#080d19] border-cyan-500/80 text-white shadow-sm ring-1 ring-cyan-500/30'
                : 'bg-[#080d19]/60 border-slate-800/90 text-slate-400 hover:text-white hover:border-slate-700'
            }`}
          >
            <Hash className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">{activeRoom.name[language]}</span>
            {activeRoom.is18Plus && (
              <span className="text-[9px] bg-rose-950/80 text-rose-300 border border-rose-800 px-1 py-0.2 rounded shrink-0">
                18+
              </span>
            )}
          </button>

          {/* Maximized Private Conversation Tabs */}
          {maximizedWindows.map((win) => {
            const isTabActive = activeMainTab === win.conversationId;
            return (
              <div
                key={win.conversationId}
                data-testid={`maximized-private-tab-${win.conversationId}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all shrink-0 ${
                  isTabActive
                    ? 'bg-violet-950/60 border-violet-500 text-white shadow-sm ring-1 ring-violet-500/30'
                    : 'bg-[#080d19] border-slate-800/90 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveMainTab(win.conversationId)}
                  className="flex items-center gap-1.5 min-w-0 cursor-pointer"
                >
                  <span className="text-sm select-none">{win.partnerAvatar || '👤'}</span>
                  <span className="truncate max-w-[100px] sm:max-w-[140px]">{win.partnerNickname}</span>
                  {win.unreadCount > 0 && (
                    <span className="w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                      {win.unreadCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  data-testid={`minimize-private-tab-${win.conversationId}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    minimizeChat(win.conversationId);
                    setActiveMainTab('room');
                  }}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white shrink-0 cursor-pointer"
                  title="Restore to compact floating window"
                >
                  <Minimize2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  data-testid={`close-private-tab-${win.conversationId}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeChat(win.conversationId);
                    setActiveMainTab('room');
                  }}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 shrink-0 cursor-pointer"
                  title="Close tab"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
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
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {activeMaximizedWindow ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative z-0" data-testid="maximized-private-pane">
            <PrivateChatPane
              conversationId={activeMaximizedWindow.conversationId}
              partner={{
                id: activeMaximizedWindow.partnerId,
                nickname: activeMaximizedWindow.partnerNickname,
                avatar: activeMaximizedWindow.partnerAvatar,
                gender: activeMaximizedWindow.partnerGender,
              }}
              currentUser={{
                id: user.id,
                nickname: user.nickname,
                avatar: user.avatar,
                isGuest: user.isGuest,
              }}
              onClose={() => {
                minimizeChat(activeMaximizedWindow.conversationId);
                setActiveMainTab('room');
              }}
              language={language}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden relative z-0">
            {/* Placement — Status-strip above advertisement */}
            <div
              aria-label="Sponsored advertisement"
              className="px-0 sm:px-3 py-1 bg-[#0a0f1d] border-b border-slate-800/80 shrink-0 flex justify-center overflow-hidden"
            >
              <AdPlacementBox
                slotId="public-chatroom-status-above"
                position="sidebar-horizontal"
                className="px-0 shrink-0"
              />
            </div>

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
              className="flex-1 min-h-0 overflow-y-auto px-2 py-3 sm:p-4 space-y-1.5"
            >
              {(() => {
                let nonSystemSeen = 0;
                let splitIndex = messages.length;
                for (let i = 0; i < messages.length; i++) {
                  if (!messages[i].isSystem) {
                    nonSystemSeen += 1;
                    if (nonSystemSeen === 5) {
                      splitIndex = i + 1;
                      break;
                    }
                  }
                }

                const preInlineMessages = messages.slice(0, splitIndex);
                const postInlineMessages = messages.slice(splitIndex);

                const renderChatMessageRow = (msg: ExtendedChatMessage, idx: number) => {
                  const isMe = msg.senderId === user.id;
                  const isMentioned =
                    user.nickname &&
                    msg.content?.toLowerCase().includes(`@${user.nickname.toLowerCase()}`);

                  // System message notice
                  if (msg.isSystem) {
                    return (
                      <div
                        key={msg.id || `sys-${idx}`}
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
                      key={msg.id || `msg-${idx}`}
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

                        {/* Attached Media (GIF / Image / Audio) */}
                        {msg.mediaUrl && (
                          <div className="mt-2 rounded-xl overflow-hidden border border-slate-700/60 max-w-xs shadow-md">
                            <SecureMediaRenderer
                              mediaUrl={msg.mediaUrl}
                              mediaType={msg.mediaType}
                              alt="Shared media"
                              className="w-full max-h-48 object-cover"
                              isGuest={user.isGuest}
                              userId={user.id}
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
                };

                return (
                  <>
                    {preInlineMessages.map((msg, idx) => renderChatMessageRow(msg, idx))}
                    <div
                      key="public-chatroom-message-inline-container"
                      data-testid="public-chatroom-message-inline-container"
                      aria-label="Sponsored advertisement"
                      className="my-2 -mx-2 sm:mx-0 py-1.5 px-0 sm:rounded-xl border-y sm:border border-slate-800/70 bg-[#080d19]/90 flex flex-col items-center gap-1 select-none overflow-hidden"
                    >
                      <span className="text-[9px] uppercase tracking-widest text-slate-500 font-mono leading-none">
                        Sponsored
                      </span>
                      <AdPlacementBox
                        slotId="public-chatroom-message-inline"
                        position="sidebar-horizontal"
                        className="px-0 shrink-0"
                      />
                    </div>
                    {postInlineMessages.map((msg, idx) =>
                      renderChatMessageRow(msg, splitIndex + idx)
                    )}
                  </>
                );
              })()}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing indicator */}
            <TypingIndicator typers={typers} />

            {/* Attached Media Staging & Upload Progress Preview */}
            <ComposerAttachmentPreview
              attachment={attachment}
              onCancel={cancelUpload}
              onRetry={retryUpload}
              onRemove={removeAttachment}
            />

            {/* Composer Dock */}
            <div className="p-3 border-t border-slate-800 bg-[#0c1222] space-y-2 shrink-0 relative">

              <input
                ref={imageInputRef}
                type="file"
                accept={IMAGE_ACCEPT_ATTRIBUTE}
                className="hidden"
                data-testid="public-image-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) {
                    selectFile(file, 'image');
                  }
                }}
              />
              <input
                ref={audioInputRef}
                type="file"
                accept={AUDIO_ACCEPT_ATTRIBUTE}
                className="hidden"
                data-testid="public-audio-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) {
                    selectFile(file, 'audio');
                  }
                }}
              />

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

              {/* Emoji, Image & GIF Popovers */}
              {showEmojiPicker && (
                <EmojiPicker
                  onSelectEmoji={(emoji) => {
                    setInputText((prev) => prev + emoji);
                    setShowEmojiPicker(false);
                  }}
                  onClose={() => setShowEmojiPicker(false)}
                />
              )}
              {showImageMenu && (
                <div
                  data-testid="public-image-menu"
                  className="absolute bottom-full left-3 mb-2 w-64 rounded-xl border border-slate-700/80 bg-[#0e1526] shadow-2xl p-1.5 z-40"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowImageMenu(false);
                      imageInputRef.current?.click();
                    }}
                    className="w-full flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-slate-800/80 text-left transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white">Upload Image</div>
                      <div className="text-[10px] text-slate-400">{SUPPORTED_IMAGE_FORMATS_TEXT}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowImageMenu(false);
                      setShowGifPicker(true);
                    }}
                    className="w-full flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-slate-800/80 text-left transition-colors cursor-pointer"
                  >
                    <ImageIcon className="w-4 h-4 text-fuchsia-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white">Pick Animated GIF</div>
                      <div className="text-[10px] text-slate-400">Search curated GIF library</div>
                    </div>
                  </button>
                </div>
              )}
              {showGifPicker && (
                <GifPicker
                  onSelectGif={(gif) => {
                    selectGif(gif);
                    setShowGifPicker(false);
                  }}
                  onClose={() => setShowGifPicker(false)}
                />
              )}

              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <div className="flex items-center gap-1 shrink-0">
                  {/* 1. Emoji */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmojiPicker(!showEmojiPicker);
                      setShowImageMenu(false);
                      setShowGifPicker(false);
                    }}
                    className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                      showEmojiPicker
                        ? 'bg-violet-600 text-white border-violet-500'
                        : 'border-slate-800 bg-[#101729] text-slate-400 hover:text-white'
                    }`}
                    title="Emoji picker"
                    aria-label="Emoji picker"
                  >
                    <Smile className="w-4 h-4" />
                  </button>

                  {/* 2. Image (Upload Image or Pick GIF) */}
                  <button
                    type="button"
                    disabled={isAttachmentBusy}
                    onClick={() => {
                      if (showGifPicker) {
                        setShowGifPicker(false);
                      } else {
                        setShowImageMenu(!showImageMenu);
                      }
                      setShowEmojiPicker(false);
                    }}
                    className={`p-2 rounded-xl border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      showImageMenu || showGifPicker
                        ? 'bg-fuchsia-600 text-white border-fuchsia-500'
                        : 'border-slate-800 bg-[#101729] text-slate-400 hover:text-white'
                    }`}
                    title={`Image (${SUPPORTED_IMAGE_FORMATS_TEXT}) or GIF`}
                    aria-label="Image or GIF attachment"
                  >
                    <ImageIcon className="w-4 h-4" />
                  </button>

                  {/* 3. New Attachment (Audio upload) */}
                  <button
                    type="button"
                    disabled={isAttachmentBusy}
                    onClick={() => {
                      setShowEmojiPicker(false);
                      setShowImageMenu(false);
                      setShowGifPicker(false);
                      audioInputRef.current?.click();
                    }}
                    className="p-2 rounded-xl border border-slate-800 bg-[#101729] text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title={`Attach Audio (${SUPPORTED_AUDIO_FORMATS_TEXT})`}
                    aria-label="Attach audio file"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                </div>

                {/* 4. Message Input */}
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

                {/* 5. Send */}
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  disabled={!canSendMessage(inputText.trim())}
                  className="shrink-0 rounded-xl"
                >
                  <Send className="w-4 h-4 mr-1.5" />
                  <span>Send</span>
                </Button>
              </form>
            </div>
          </div>
        )}

        {/* Right Sidebar Column: Users | Private Chats | Rooms + External Ad below */}
        <div
          data-testid="public-chat-sidebar"
          className={`${
            showMobileSidebar ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
          } absolute inset-y-0 right-0 z-30 lg:static lg:inset-auto lg:z-auto max-w-full w-80 sm:w-84 lg:w-[340px] xl:w-[344px] border-l border-slate-800 bg-[#090d18] flex flex-col justify-between shrink-0 transition-transform duration-200 ease-in-out p-2 gap-2`}
        >
          {/* Complete Users/Participants Panel - 100% Ad-Free Internally with its own border */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0c1220]">
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
                type="button"
                aria-label="Close participants sidebar"
                onClick={() => setShowMobileSidebar(false)}
                className="lg:hidden p-1.5 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* TAB CONTENT 1: ONLINE USERS */}
            {sidebarTab === 'users' && (
              <div className="flex-1 min-h-0 flex flex-col p-3 overflow-hidden">
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
                <div className="flex-1 overflow-y-auto overscroll-contain space-y-1.5 pr-0.5">
                  {/* Current user card */}
                  <div
                    onClick={(e) => handleUserClick(e, user)}
                    className="p-2.5 rounded-xl bg-violet-950/30 border border-violet-900/50 shadow-sm cursor-pointer hover:border-violet-600 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-lg select-none shrink-0">{user?.avatar || '👤'}</span>
                        <span className={`font-bold truncate text-xs ${getGenderColor(user?.gender)}`}>
                          {user?.nickname || 'You'}
                        </span>
                      </div>
                      <GenderBadge gender={user?.gender} />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-violet-300 pt-1 border-t border-violet-900/30 font-mono">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            user?.onlineVisibility === 'stealth_invisible'
                              ? 'bg-slate-400'
                              : 'bg-emerald-400 animate-pulse'
                          }`}
                        />
                        <span>You ({user?.isGuest ? 'Guest' : 'Member'})</span>
                      </span>
                      <span className="text-violet-400 uppercase tracking-wider text-[9px]">
                        {user?.onlineVisibility === 'stealth_invisible' ? 'Stealth' : 'Online'}
                      </span>
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

                  {/* Empty state when no other members are in this room */}
                  {filteredMembers.filter((m) => m.id !== user.id).length === 0 && (
                    <div className="py-6 px-3 text-center text-slate-500 text-xs">
                      <Users className="w-6 h-6 mx-auto mb-1.5 opacity-40 text-slate-400" />
                      <p className="font-medium text-slate-400">
                        {userSearchQuery ? 'No matching members found' : 'No other users in this room yet'}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {userSearchQuery ? 'Try another search term' : 'Invite friends or chat as others join!'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT 2: PRIVATE CONVERSATIONS */}
            {sidebarTab === 'private' && (
              <div className="flex-1 min-h-0 flex flex-col p-3 overflow-hidden">
                <div className="flex-1 overflow-y-auto overscroll-contain space-y-1.5">
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
                        className="p-2.5 rounded-xl border transition-all cursor-pointer bg-[#101729] hover:bg-[#141d33] border-slate-800/80 hover:border-violet-500/40"
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
              <div className="flex-1 min-h-0 flex flex-col p-3 overflow-hidden">
                <div className="flex-1 overflow-y-auto overscroll-contain space-y-1.5">
                  {ROOMS_CONFIG.map((r) => {
                    const isCurrent = r.slug === activeRoom.slug;
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          navigate('/chat', { roomId: r.slug });
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
              <span>ChatLustora Edge</span>
            </div>
          </div>

          {/* Ad 4 — External Participant-Side Ad (50px) - OUTSIDE and BELOW the participant panel's border */}
          <AdPlacementBox
            slotId="participant-box-horizontal"
            position="sidebar-horizontal"
            className="px-0 shrink-0"
          />
        </div>
      </div>

      {/* Mobile/Tablet Backdrop (Scoped to Central Chatroom Container) */}
      {showMobileSidebar && (
        <div
          data-testid="public-chat-sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setShowMobileSidebar(false)}
          className="absolute inset-0 bg-black/60 backdrop-blur-xs z-20 lg:hidden"
        />
      )}
    </div>
    </div>

      {/* Ad 5 — Bottom Horizontal Ad (Below chatroom border, stable reserved space) */}
      <div className="w-full max-w-7xl mx-auto px-0 sm:px-4 lg:px-6 mb-4 shrink-0 flex justify-center">
        <AdPlacementBox
          slotId="public-chatroom-bottom"
          position="bottom"
        />
      </div>

      {/* Monetag Body-Bottom Dedicated Advertisement */}
      <div className="w-full max-w-7xl mx-auto px-0 sm:px-4 lg:px-6 mb-6 shrink-0 flex justify-center">
        <AdPlacementBox
          slotId="public-chatroom-body-bottom"
          provider="monetag"
          position="content-gap"
        />
      </div>

      {/* Explore Other Chatrooms Discovery Section */}
      {(() => {
        const exploreRooms = getExploreRoomsForSlug(activeRoom.slug);
        return (
          <section
            aria-labelledby="explore-chatrooms-heading"
            data-testid="explore-other-chatrooms-section"
            className="w-full max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 mb-8"
          >
            <div className="bg-[#0c1324] border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 mb-5 border-b border-slate-800/80">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-1">
                    {language === 'bn' ? 'অন্যান্য রুম' : 'Chat Rooms'}
                  </div>
                  <h3
                    id="explore-chatrooms-heading"
                    className="text-xl sm:text-2xl font-extrabold text-white tracking-tight text-balance"
                  >
                    {language === 'bn' ? 'অন্যান্য চ্যাটরুম ঘুরে দেখুন' : 'Explore Other Chatrooms'}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
                    {language === 'bn'
                      ? `আরও ${exploreRooms.length}টি সক্রিয় পাবলিক রুমে ভাষা, অঞ্চল বা বিষয় অনুযায়ী যোগ দিন — কোনো অতিরিক্ত নিবন্ধন ছাড়াই।`
                      : `Switch seamlessly across ${exploreRooms.length} other public rooms by region, language, or interest — no extra registration needed.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/rooms')}
                  className="self-start sm:self-auto px-4 py-2 rounded-xl border border-slate-700 bg-[#101729] hover:bg-slate-800 hover:border-cyan-500/50 text-xs font-semibold text-slate-200 hover:text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                >
                  <Compass className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{language === 'bn' ? 'সব রুম দেখুন' : 'View All Rooms'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div
                data-testid="explore-other-chatrooms-grid"
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {exploreRooms.map((r) => {
                  const RoomIcon = r.modes.includes('video')
                    ? Video
                    : r.slug === 'roulette'
                    ? Shuffle
                    : r.slug === 'bdsm' || r.slug === 'roleplay'
                    ? Lock
                    : r.category === 'international'
                    ? Globe2
                    : r.category === 'social' || r.slug === 'couples'
                    ? Users
                    : MessageSquare;

                  const modeText = r.modes.includes('video')
                    ? language === 'bn'
                      ? 'ভিডিও ও টেক্সট'
                      : 'Video & Text'
                    : language === 'bn'
                    ? 'লাইভ টেক্সট'
                    : 'Live Text';

                  return (
                    <button
                      key={r.id}
                      type="button"
                      data-testid={`explore-room-card-${r.slug.replace(/\//g, '-')}`}
                      onClick={() => navigate('/chat', { roomId: r.slug })}
                      className="p-4 sm:p-5 rounded-xl bg-[#101729] hover:bg-[#151f38] border border-slate-800 hover:border-cyan-500/50 text-left transition-all cursor-pointer group flex flex-col justify-between shadow-sm h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="w-10 h-10 rounded-xl bg-[#090d18] border border-slate-800/90 flex items-center justify-center shrink-0">
                            {r.flagUrl ? (
                              <img
                                src={r.flagUrl}
                                alt={r.name[language] || r.name.en}
                                referrerPolicy="no-referrer"
                                className="w-6 h-4 rounded-xs object-cover"
                              />
                            ) : (
                              <RoomIcon
                                className={`w-4.5 h-4.5 ${
                                  r.is18Plus ? 'text-rose-400' : 'text-cyan-400'
                                }`}
                              />
                            )}
                          </div>
                          {r.is18Plus && (
                            <span className="text-[10px] font-bold text-rose-300 bg-rose-950/70 border border-rose-800/80 px-1.5 py-0.5 rounded shrink-0 tabular-nums">
                              18+
                            </span>
                          )}
                        </div>

                        <div>
                          <div className="font-bold text-sm sm:text-base text-white group-hover:text-cyan-300 transition-colors leading-snug">
                            {r.name[language] || r.name.en}
                          </div>
                          <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mt-1.5">
                            {r.description[language] || r.description.en}
                          </p>
                        </div>
                      </div>

                      <div className="pt-3.5 mt-4 border-t border-slate-800/80 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400 truncate">
                          {r.categoryLabel[language] || r.categoryLabel.en}
                          <span aria-hidden="true"> · </span>
                          {modeText}
                        </span>
                        <span className="text-xs font-bold text-cyan-400 group-hover:text-cyan-300 inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                          <span>{language === 'bn' ? 'রুমে প্রবেশ করুন' : 'Join Room'}</span>
                          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {!exploreAdFailed && (
                <div
                  data-testid="explore-chatrooms-sponsored-wrapper"
                  aria-label="Sponsored advertisement"
                  className="mt-6 pt-5 border-t border-slate-800/80 flex flex-col items-center gap-1.5"
                >
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                    Sponsored
                  </span>
                  <AdPlacementBox
                    slotId="explore-chatrooms-inline"
                    position="content-gap"
                    className="!my-0"
                    onStatusChange={(status) => {
                      if (status === 'unfilled' || status === 'error') {
                        setExploreAdFailed(true);
                      }
                    }}
                  />
                </div>
              )}
            </div>
          </section>
        );
      })()}

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
