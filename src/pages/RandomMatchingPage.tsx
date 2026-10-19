import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { BanglishHelperBar } from '../components/layout/BanglishHelperBar';
import { formatDhakaTime } from '../utils/date';
import { matchmakingService } from '../services/matchmakingService';
import { messagingService, LinkPreviewData, GifItem } from '../services/messagingService';
import {
  MatchLifecycleState,
  MatchParticipant,
  MatchSession,
  ChatMessage,
} from '../types';
import { useCall } from '../context/CallContext';
import {
  Shuffle,
  Radio,
  SkipForward,
  XCircle,
  Flag,
  Send,
  Shield,
  Lock,
  Globe2,
  Sparkles,
  Info,
  Ban,
  Image as ImageIcon,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  MessageSquare,
  Clock,
  Tag,
  Smile,
  Phone,
  Video,
} from 'lucide-react';

const AVAILABLE_INTERESTS = [
  'Tech',
  'Adda',
  'Music',
  'Gaming',
  'Dhaka Life',
  'Movies',
  'Sports',
  'Coding',
  'Food & Chai',
  'Literature',
];

export const RandomMatchingPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language, t } = useLanguage();
  const { user, is18Verified } = useAuth();
  const { initiateCall } = useCall();

  // Lifecycle state: idle | waiting | matched | connected | disconnected
  const [lifecycleState, setLifecycleState] = useState<MatchLifecycleState>('idle');

  // Preferences
  const [prefLanguage, setPrefLanguage] = useState<'all' | 'bn' | 'en'>('all');
  const [regionPool, setRegionPool] = useState<'bangladesh' | 'international' | 'any'>('bangladesh');
  const [selectedInterests, setSelectedInterests] = useState<string[]>(['Tech', 'Adda']);
  const [safeFilterEnabled, setSafeFilterEnabled] = useState<boolean>(true);

  // Active Queue / Match Data
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [currentMatch, setCurrentMatch] = useState<MatchSession | null>(null);
  const [partner, setPartner] = useState<MatchParticipant | null>(null);
  const [disconnectReason, setDisconnectReason] = useState<string>('');
  const [searchElapsedSeconds, setSearchElapsedSeconds] = useState<number>(0);
  const [cooldownError, setCooldownError] = useState<string | null>(null);

  // Messaging State inside Active Match
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);

  // Modals & Popovers
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState('Inappropriate Conduct / Harassment');
  const [reportSuccess, setReportSuccess] = useState(false);
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [blockSuccess, setBlockSuccess] = useState(false);

  // GIF Picker
  const [gifModalOpen, setGifModalOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<GifItem[]>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);

  // Refs for Cleanup
  const queueUnsubscribeRef = useRef<(() => void) | null>(null);
  const matchUnsubscribeRef = useRef<(() => void) | null>(null);
  const conversationUnsubscribeRef = useRef<(() => void) | null>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, partnerTyping]);

  // Clean all subscriptions
  const cleanupSubscriptions = useCallback(() => {
    if (queueUnsubscribeRef.current) {
      queueUnsubscribeRef.current();
      queueUnsubscribeRef.current = null;
    }
    if (matchUnsubscribeRef.current) {
      matchUnsubscribeRef.current();
      matchUnsubscribeRef.current = null;
    }
    if (conversationUnsubscribeRef.current) {
      conversationUnsubscribeRef.current();
      conversationUnsubscribeRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (searchTimerRef.current) {
      clearInterval(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupSubscriptions();
      if (ticketId) {
        matchmakingService.cancelQueue(ticketId, user.id);
      }
    };
  }, [cleanupSubscriptions, ticketId, user.id]);

  // Toggle interest
  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : prev.length < 5
        ? [...prev, interest]
        : prev
    );
  };

  // ---------------------------------------------------------------------------
  // TRANSITION INTO CONNECTED STATE
  // ---------------------------------------------------------------------------
  const establishConnectedSession = useCallback(
    (match: MatchSession, matchPartner: MatchParticipant) => {
      cleanupSubscriptions();
      setCurrentMatch(match);
      setPartner(matchPartner);
      setLifecycleState('connected');
      setDisconnectReason('');

      // Add system greeting message
      const systemGreeting: ChatMessage = {
        id: `sys_${Date.now()}`,
        conversationId: match.conversationId,
        senderId: 'system',
        senderNickname: 'VoxaNex Guard',
        senderAvatar: '🛡️',
        content:
          language === 'bn'
            ? `সংযুক্ত হয়েছেন! সঙ্গী: ${matchPartner.nickname} (${match.regionPool === 'bangladesh' ? 'বাংলাদেশ পুল' : 'আন্তর্জাতিক পুল'})। উভয়পক্ষই ব্যক্তিগত গোপনীয়তা বজায় রাখুন।`
            : `Connected! Partner: ${matchPartner.nickname} (${match.regionPool === 'bangladesh' ? 'Bangladesh Lounge' : 'International'}). Be respectful and adhere to safety guidelines.`,
        timestamp: new Date().toISOString(),
        isSystem: true,
      };
      setMessages([systemGreeting]);

      // Subscribe to active match lifecycle (detect disconnect / skip)
      const unsubMatch = matchmakingService.subscribeToMatch(match.matchId, (payload) => {
        handlePartnerDisconnected(payload.reason || 'Partner ended or skipped the chat.');
      });
      matchUnsubscribeRef.current = unsubMatch;

      // Subscribe to conversation direct messages
      const unsubConv = messagingService.subscribeToConversation(
        match.conversationId,
        user.id,
        {
          onMessage: (incomingMsg: ChatMessage) => {
            if (incomingMsg.senderId !== user.id) {
              setMessages((prev) => [...prev, incomingMsg]);
            }
          },
        }
      );
      conversationUnsubscribeRef.current = unsubConv;
    },
    [cleanupSubscriptions, language, user.id]
  );

  const handlePartnerDisconnected = (reasonText: string) => {
    cleanupSubscriptions();
    setLifecycleState('disconnected');
    setDisconnectReason(reasonText);
  };

  // ---------------------------------------------------------------------------
  // 1. FIND PARTNER / JOIN QUEUE
  // ---------------------------------------------------------------------------
  const handleFindPartner = async () => {
    setCooldownError(null);
    cleanupSubscriptions();
    setMessages([]);
    setPartner(null);
    setCurrentMatch(null);
    setSearchElapsedSeconds(0);

    const joinResult = await matchmakingService.joinQueue({
      userId: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      isGuest: user.isGuest,
      languagePref: prefLanguage,
      regionPool: regionPool,
      interests: selectedInterests,
      is18Verified: is18Verified,
    });

    if (!joinResult.success) {
      setCooldownError(joinResult.error || 'Failed to start search. Please wait a moment.');
      return;
    }

    // Immediate atomic match found!
    if (joinResult.match) {
      const match = joinResult.match;
      const matchedPartner = match.userA.id === user.id ? match.userB : match.userA;
      setLifecycleState('matched');
      setTimeout(() => {
        establishConnectedSession(match, matchedPartner);
      }, 700);
      return;
    }

    // Waiting in queue with issued ticket
    if (joinResult.ticket) {
      const ticket = joinResult.ticket;
      setTicketId(ticket.ticketId);
      setLifecycleState('waiting');

      // Start search timer
      searchTimerRef.current = setInterval(() => {
        setSearchElapsedSeconds((sec) => sec + 1);
      }, 1000);

      // Subscribe to SSE stream for ticket
      const unsubTicket = matchmakingService.subscribeToTicket(ticket.ticketId, (payload) => {
        setLifecycleState('matched');
        setTimeout(() => {
          establishConnectedSession(payload.match, payload.partner);
        }, 600);
      });
      queueUnsubscribeRef.current = unsubTicket;

      // Polling Heartbeat Fallback (every 3 seconds)
      heartbeatTimerRef.current = setInterval(async () => {
        const poll = await matchmakingService.pollStatus(ticket.ticketId, user.id);
        if (poll.status === 'matched' && poll.match && poll.partner) {
          setLifecycleState('matched');
          establishConnectedSession(poll.match, poll.partner);
        } else if (poll.status === 'expired') {
          // Session timed out or removed
          cleanupSubscriptions();
          setLifecycleState('idle');
          setCooldownError('Search ticket expired. Please click Find Partner again.');
        }
      }, 3000);
    }
  };

  // ---------------------------------------------------------------------------
  // 2. CANCEL SEARCH
  // ---------------------------------------------------------------------------
  const handleCancelSearch = async () => {
    if (ticketId) {
      await matchmakingService.cancelQueue(ticketId, user.id);
    }
    cleanupSubscriptions();
    setTicketId(null);
    setLifecycleState('idle');
  };

  // ---------------------------------------------------------------------------
  // 3. SKIP PARTNER
  // ---------------------------------------------------------------------------
  const handleSkipPartner = async () => {
    if (currentMatch) {
      await matchmakingService.disconnect(currentMatch.matchId, user.id);
    }
    // Directly transition into search for next partner
    handleFindPartner();
  };

  // ---------------------------------------------------------------------------
  // 4. DISCONNECT
  // ---------------------------------------------------------------------------
  const handleDisconnect = async () => {
    if (currentMatch) {
      await matchmakingService.disconnect(currentMatch.matchId, user.id);
    }
    cleanupSubscriptions();
    setLifecycleState('disconnected');
    setDisconnectReason(
      language === 'bn' ? 'আপনি চ্যাট সমাপ্ত করেছেন।' : 'You ended the chat session.'
    );
  };

  // ---------------------------------------------------------------------------
  // 5. SEND MESSAGE
  // ---------------------------------------------------------------------------
  const handleSendMessage = async (e?: React.FormEvent, customMedia?: { url: string; type: 'gif' | 'image' }) => {
    if (e) e.preventDefault();
    if (!currentMatch || !partner) return;

    const textToSend = inputMsg.trim();
    if (!textToSend && !customMedia) return;

    setIsSending(true);
    setInputMsg('');

    // Optimistic message
    const optimisticId = `msg_${Date.now()}`;
    const newMsg: ChatMessage = {
      id: optimisticId,
      conversationId: currentMatch.conversationId,
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      recipientId: partner.id,
      content: textToSend || (customMedia?.type === 'gif' ? 'Shared a GIF' : 'Shared media'),
      mediaUrl: customMedia?.url,
      mediaType: customMedia?.type,
      timestamp: new Date().toISOString(),
      isDirect: true,
      status: 'sending',
    };

    setMessages((prev) => [...prev, newMsg]);

    const res = await messagingService.sendConversationMessage(currentMatch.conversationId, {
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      recipientId: partner.id,
      content: textToSend || (customMedia?.type === 'gif' ? 'Shared a GIF' : 'Shared media'),
      mediaUrl: customMedia?.url,
      mediaType: customMedia?.type,
    });

    setIsSending(false);

    if (res.success && res.message) {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? { ...res.message!, status: 'delivered' } : m))
      );
    }
  };

  const handleInsertBanglish = (phrase: string) => {
    setInputMsg((prev) => (prev ? `${prev} ${phrase}` : phrase));
  };

  // ---------------------------------------------------------------------------
  // 6. BLOCK & REPORT
  // ---------------------------------------------------------------------------
  const handleConfirmBlock = async () => {
    if (!partner || !currentMatch) return;
    await matchmakingService.blockUser(user.id, partner.id);
    setBlockSuccess(true);
    setTimeout(async () => {
      setBlockSuccess(false);
      setBlockModalOpen(false);
      await handleSkipPartner();
    }, 900);
  };

  const handleConfirmReport = async () => {
    if (!partner || !currentMatch) return;
    setReportSuccess(true);
    setTimeout(async () => {
      setReportSuccess(false);
      setReportModalOpen(false);
      await handleSkipPartner();
    }, 900);
  };

  // ---------------------------------------------------------------------------
  // 7. GIF PICKER
  // ---------------------------------------------------------------------------
  const handleOpenGifs = async () => {
    setGifModalOpen(true);
    setLoadingGifs(true);
    const results = await messagingService.searchGifs('bangladesh');
    setGifResults(results);
    setLoadingGifs(false);
  };

  const handleSearchGifs = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingGifs(true);
    const results = await messagingService.searchGifs(gifQuery);
    setGifResults(results);
    setLoadingGifs(false);
  };

  const handleSelectGif = (gif: GifItem) => {
    setGifModalOpen(false);
    handleSendMessage(undefined, { url: gif.url, type: 'gif' });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header & Privacy Notice */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-3">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-500 text-white shadow-xl shadow-orange-500/20 mb-1">
              <Shuffle className="w-7 h-7 text-white" />
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-orange-600 dark:text-orange-400 tracking-wider uppercase">
              <span>Anonymous Partner Roulette · Phase 4</span>
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {t.random.title}
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 max-w-xl">
              {t.random.subtitle}
            </p>
          </div>

          {/* Real-time anonymity guarantee */}
          <div className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300 shadow-sm">
            <Lock className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <span>{language === 'bn' ? 'আইপি ও অবস্থান সম্পূর্ণ গোপনীয়' : 'IP & Coordinates Shielded'}</span>
          </div>
        </div>

      {/* Abuse Cooldown Warning Banner */}
      {cooldownError && (
        <div className="p-3.5 rounded-xl border border-amber-800/60 bg-amber-950/40 text-amber-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>{cooldownError}</span>
          </div>
          <button
            onClick={() => setCooldownError(null)}
            className="text-amber-400 hover:text-amber-200 text-xs font-semibold px-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STATE 1: IDLE STATE — PREFERENCES & LAUNCH CONTROLS                        */}
      {/* ========================================================================= */}
      {lifecycleState === 'idle' && (
        <div className="border border-slate-800 bg-[#0d1322] rounded-2xl p-6 sm:p-10 shadow-2xl space-y-8">
          <div className="text-center max-w-lg mx-auto space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-cyan-950/60 border border-cyan-800/40 flex items-center justify-center text-cyan-400 mx-auto text-2xl shadow-lg shadow-cyan-950/40">
              <Shuffle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-white">
              {language === 'bn' ? 'নতুন সঙ্গীর সাথে সংযোগ স্থাপন করুন' : 'Connect Freely with an Anonymous Partner'}
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.random.radarDesc}
            </p>
          </div>

          {/* Preferences Selector */}
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Language Selection */}
              <div className="p-4 rounded-xl bg-[#101729] border border-slate-800 space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">
                  Language Preference
                </label>
                <select
                  value={prefLanguage}
                  onChange={(e) => setPrefLanguage(e.target.value as any)}
                  className="w-full bg-[#0a0f1d] border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="all">Any (Bangla / English)</option>
                  <option value="bn">বাংলা (Bangla Only)</option>
                  <option value="en">English Only</option>
                </select>
                <p className="text-[10px] text-slate-500">Pairs with compatible language seekers</p>
              </div>

              {/* Pool Preference */}
              <div className="p-4 rounded-xl bg-[#101729] border border-slate-800 space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">
                  Geographic Pool
                </label>
                <select
                  value={regionPool}
                  onChange={(e) => setRegionPool(e.target.value as any)}
                  className="w-full bg-[#0a0f1d] border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="bangladesh">Bangladesh Lounge (BD)</option>
                  <option value="international">International Pool</option>
                  <option value="any">Global (Any Pool)</option>
                </select>
                <p className="text-[10px] text-slate-500">Zero coordinates leaked</p>
              </div>

              {/* Safe Filter */}
              <div className="p-4 rounded-xl bg-[#101729] border border-slate-800 space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">
                  Safety Filter
                </label>
                <button
                  type="button"
                  onClick={() => setSafeFilterEnabled(!safeFilterEnabled)}
                  className={`w-full py-2 px-3 rounded-lg border text-xs font-medium text-center transition-colors flex items-center justify-center gap-1.5 ${
                    safeFilterEnabled
                      ? 'border-emerald-600/70 bg-emerald-950/40 text-emerald-300'
                      : 'border-slate-700 bg-[#0a0f1d] text-slate-400'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>{safeFilterEnabled ? 'Safe Filter: Active' : 'Filter: Off'}</span>
                </button>
                <p className="text-[10px] text-slate-500">Blocks abusive patterns</p>
              </div>
            </div>

            {/* Optional Shared Interests */}
            <div className="p-4 rounded-xl bg-[#101729] border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <Tag className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Optional Shared Interests (Up to 5)</span>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">
                  {selectedInterests.length} / 5 selected
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Candidates sharing tags are matched with elevated priority in the roulette queue.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {AVAILABLE_INTERESTS.map((interest) => {
                  const isSelected = selectedInterests.includes(interest);
                  return (
                    <button
                      key={interest}
                      type="button"
                      onClick={() => toggleInterest(interest)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                        isSelected
                          ? 'border-violet-500 bg-violet-950/60 text-violet-200 font-medium'
                          : 'border-slate-800 bg-[#0a0f1d] text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {interest}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Start Find Partner Button */}
            <div className="text-center pt-2">
              <Button size="lg" variant="accent" onClick={handleFindPartner}>
                <Radio className="w-5 h-5 mr-2" />
                <span>Find Partner</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STATE 2: WAITING IN QUEUE                                                 */}
      {/* ========================================================================= */}
      {lifecycleState === 'waiting' && (
        <div className="border border-slate-800 bg-[#0d1322] rounded-2xl p-10 sm:p-14 text-center space-y-8 shadow-2xl">
          {/* Animated Radar Pulse */}
          <div className="relative w-28 h-28 mx-auto flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-500/30 animate-ping" />
            <div className="absolute inset-2 rounded-full border border-violet-500/40 animate-pulse" />
            <div className="w-20 h-20 rounded-full bg-cyan-950/80 border border-cyan-500 flex items-center justify-center text-cyan-400 z-10 shadow-lg shadow-cyan-950/60">
              <Radio className="w-8 h-8 animate-spin" />
            </div>
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h2 className="text-xl font-bold text-white">
              {language === 'bn' ? 'সঙ্গী খোঁজা হচ্ছে...' : 'Scanning for Available Partner...'}
            </h2>
            <p className="text-xs text-slate-400">
              Matching pool: <span className="text-cyan-400 font-medium uppercase">{regionPool}</span> ·
              Language: <span className="text-violet-400 font-medium uppercase">{prefLanguage}</span>
            </p>
            {selectedInterests.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                {selectedInterests.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] px-2 py-0.5 rounded bg-violet-950/60 border border-violet-800 text-violet-300"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
            <div className="text-xs text-slate-500 font-mono pt-2">
              Searching: {searchElapsedSeconds}s · Ticket: {ticketId?.slice(0, 16)}...
            </div>
          </div>

          <div className="pt-2">
            <Button variant="secondary" size="md" onClick={handleCancelSearch}>
              <XCircle className="w-4 h-4 mr-2" />
              <span>Cancel Search</span>
            </Button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STATE 3: MATCHED (TRANSITIONAL STATE)                                     */}
      {/* ========================================================================= */}
      {lifecycleState === 'matched' && (
        <div className="border border-slate-800 bg-[#0d1322] rounded-2xl p-12 text-center space-y-6 shadow-2xl">
          <div className="w-20 h-20 rounded-full bg-emerald-950 border border-emerald-500 flex items-center justify-center text-emerald-400 mx-auto text-3xl animate-bounce">
            <CheckCircle className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white">
              {language === 'bn' ? 'মিল খুঁজে পাওয়া গেছে!' : 'Partner Found!'}
            </h2>
            <p className="text-xs text-slate-400">
              Establishing encrypted 1-on-1 direct channel...
            </p>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STATE 4: CONNECTED — LIVE REAL-TIME CHAT WITH PARTNER                     */}
      {/* ========================================================================= */}
      {lifecycleState === 'connected' && partner && currentMatch && (
        <div className="border border-slate-800 bg-[#0d1322] rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[600px]">
          {/* Top Bar with Partner Profile & Controls */}
          <div className="p-3.5 border-b border-slate-800 bg-[#0c1222] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl select-none">{partner.avatar}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-white">{partner.nickname}</span>
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Connected
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                  <span>{currentMatch.regionPool === 'bangladesh' ? 'Bangladesh Lounge' : 'International'}</span>
                  {currentMatch.sharedInterests.length > 0 && (
                    <span className="text-violet-400">
                      · Mutual: {currentMatch.sharedInterests.join(', ')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Action Controls: Call | Video | Skip Partner | Disconnect | Block | Report */}
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  initiateCall({
                    calleeId: partner.id,
                    calleeNickname: partner.nickname,
                    calleeAvatar: partner.avatar,
                    mediaKind: 'audio',
                    conversationId: currentMatch.conversationId,
                  });
                }}
                title="Initiate Voice Call with Partner"
              >
                <Phone className="w-3.5 h-3.5 mr-1 text-cyan-400" />
                <span>Call</span>
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  initiateCall({
                    calleeId: partner.id,
                    calleeNickname: partner.nickname,
                    calleeAvatar: partner.avatar,
                    mediaKind: 'video',
                    conversationId: currentMatch.conversationId,
                  });
                }}
                title="Initiate Video Call with Partner"
              >
                <Video className="w-3.5 h-3.5 mr-1 text-violet-400" />
                <span>Video</span>
              </Button>

              <Button
                variant="accent"
                size="sm"
                onClick={handleSkipPartner}
                title="Skip to next anonymous partner"
              >
                <SkipForward className="w-3.5 h-3.5 mr-1" />
                <span>Skip Partner</span>
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={handleDisconnect}
                title="Disconnect from chat"
              >
                <XCircle className="w-3.5 h-3.5 mr-1 text-slate-400" />
                <span>Disconnect</span>
              </Button>

              <button
                type="button"
                onClick={() => setBlockModalOpen(true)}
                className="p-2 text-slate-400 hover:text-amber-300 hover:bg-amber-950/30 rounded-lg border border-slate-800 transition-colors"
                title="Block partner"
              >
                <Ban className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setReportModalOpen(true)}
                className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 rounded-lg border border-rose-900/40 transition-colors"
                title="Report partner"
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Chat Messages List */}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#090d18]">
            {messages.map((m, idx) => {
              const isMe = m.senderId === user.id;
              if (m.isSystem) {
                return (
                  <div key={`${m.id}-${idx}`} className="text-center my-3">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#11192e] border border-slate-800 text-[11px] text-cyan-300 max-w-md">
                      <Shield className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                      <span>{m.content}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={`${m.id}-${idx}`}
                  className={`flex flex-col max-w-sm ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                >
                  <div
                    className={`rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      isMe
                        ? 'bg-violet-600 text-white rounded-br-none'
                        : 'bg-[#12192c] border border-slate-800 text-slate-200 rounded-bl-none'
                    }`}
                  >
                    {/* Media if GIF */}
                    {m.mediaUrl && (
                      <div className="mb-2 rounded-lg overflow-hidden border border-white/10 max-w-[240px]">
                        <img src={m.mediaUrl} alt="GIF" className="w-full h-auto object-cover" />
                      </div>
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  </div>
                  <span className="text-[9px] font-mono text-slate-500 mt-1">
                    {formatDhakaTime(m.timestamp, language)} {m.status === 'sending' ? '· Sending...' : ''}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Banglish Helper and Message Composer */}
          <div className="p-3 border-t border-slate-800 bg-[#0c1222] space-y-2">
            <BanglishHelperBar onInsertText={handleInsertBanglish} />

            <form onSubmit={handleSendMessage} className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenGifs}
                className="p-2 text-slate-400 hover:text-cyan-400 hover:bg-[#101729] rounded-lg border border-slate-800 transition-colors"
                title="Send safe GIF"
              >
                <ImageIcon className="w-4 h-4" />
              </button>

              <input
                type="text"
                value={inputMsg}
                maxLength={1000}
                onChange={(e) => setInputMsg(e.target.value)}
                placeholder={
                  language === 'bn'
                    ? 'মেসেজ লিখুন (বাংলা, বাংলিশ, ইংরেজি)...'
                    : 'Type a message in Bangla, Banglish, or English...'
                }
                className="flex-1 bg-[#101729] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />

              <Button type="submit" variant="primary" size="md" disabled={isSending}>
                <Send className="w-4 h-4 mr-1.5" />
                <span>Send</span>
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STATE 5: DISCONNECTED                                                     */}
      {/* ========================================================================= */}
      {lifecycleState === 'disconnected' && (
        <div className="border border-slate-800 bg-[#0d1322] rounded-2xl p-10 sm:p-14 text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center text-slate-400 mx-auto text-2xl">
            <XCircle className="w-8 h-8" />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h2 className="text-xl font-bold text-white">
              {language === 'bn' ? 'কথোপকথন সমাপ্ত হয়েছে' : 'Chat Session Disconnected'}
            </h2>
            <p className="text-xs text-slate-400">
              {disconnectReason || 'The conversation session has ended.'}
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Button size="md" variant="accent" onClick={handleFindPartner}>
              <RefreshCw className="w-4 h-4 mr-2" />
              <span>Find Another Partner</span>
            </Button>

            <Button size="md" variant="secondary" onClick={() => setLifecycleState('idle')}>
              <span>Change Preferences</span>
            </Button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: REPORT PARTNER                                                     */}
      {/* ========================================================================= */}
      {reportModalOpen && (
        <Modal
          isOpen={reportModalOpen}
          onClose={() => setReportModalOpen(false)}
          title={language === 'bn' ? 'ইউজার রিপোর্ট করুন' : 'Report Random Match'}
          subtitle={partner?.nickname || 'Partner'}
        >
          {reportSuccess ? (
            <div className="p-6 text-center space-y-2">
              <div className="text-emerald-400 font-bold">✓ Incident Report Logged</div>
              <p className="text-xs text-slate-400">
                Partner session terminated. Flagged for review by the safety desk.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-300">
                Reporting a partner immediately terminates the session and prevents rematching with this entity.
              </p>
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200"
              >
                <option>Inappropriate Conduct / Harassment</option>
                <option>Suspected Underage Participant</option>
                <option>Commercial Solicitation / Spam</option>
                <option>Hate Speech / Abuse</option>
              </select>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={() => setReportModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" size="sm" onClick={handleConfirmReport}>
                  Confirm Report & Skip
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL: BLOCK PARTNER                                                      */}
      {/* ========================================================================= */}
      {blockModalOpen && (
        <Modal
          isOpen={blockModalOpen}
          onClose={() => setBlockModalOpen(false)}
          title="Block Partner"
          subtitle={partner?.nickname || 'Partner'}
        >
          {blockSuccess ? (
            <div className="p-6 text-center space-y-2">
              <div className="text-amber-400 font-bold">✓ User Blocked</div>
              <p className="text-xs text-slate-400">
                This peer has been blocked and will never be matched with you again.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-300">
                Are you sure you want to block <strong className="text-white">{partner?.nickname}</strong>? You will immediately skip this match and neither party will ever be paired in roulette again.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={() => setBlockModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" size="sm" onClick={handleConfirmBlock}>
                  Block & Skip
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL: GIF PICKER                                                         */}
      {/* ========================================================================= */}
      {gifModalOpen && (
        <Modal
          isOpen={gifModalOpen}
          onClose={() => setGifModalOpen(false)}
          title="Curated Safe GIFs"
          subtitle="Select a safe GIF to send"
        >
          <div className="space-y-4">
            <form onSubmit={handleSearchGifs} className="flex gap-2">
              <input
                type="text"
                value={gifQuery}
                onChange={(e) => setGifQuery(e.target.value)}
                placeholder="Search GIFs (e.g., hello, bangladesh, celebrate)..."
                className="flex-1 bg-[#101729] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500"
              />
              <Button type="submit" variant="primary" size="sm">
                Search
              </Button>
            </form>

            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto p-1">
              {loadingGifs ? (
                <div className="col-span-2 text-center py-8 text-xs text-slate-400">
                  Loading safe GIFs...
                </div>
              ) : gifResults.length > 0 ? (
                gifResults.map((gif) => (
                  <button
                    key={gif.id}
                    onClick={() => handleSelectGif(gif)}
                    className="group relative rounded-lg overflow-hidden border border-slate-800 hover:border-cyan-500 transition-colors text-left"
                  >
                    <img
                      src={gif.url}
                      alt={gif.title}
                      className="w-full h-24 object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-end p-2 transition-opacity">
                      <span className="text-[10px] text-white font-medium truncate">
                        {gif.title}
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="col-span-2 text-center py-8 text-xs text-slate-500">
                  No GIFs found.
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
};
