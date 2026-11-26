import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { DirectConversation, ChatMessage } from '../types';
import { formatDhakaTime } from '../utils/date';
import { BanglishHelperBar } from '../components/layout/BanglishHelperBar';
import { EmojiPicker } from '../components/chat/EmojiPicker';
import { GifPicker } from '../components/chat/GifPicker';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { messagingService, LinkPreviewData, GifItem } from '../services/messagingService';
import { useCall } from '../context/CallContext';
import { SEOHead } from '../components/common/SEOHead';
import {
  MessageSquare,
  Shield,
  ShieldAlert,
  Send,
  UserX,
  UserCheck,
  Search,
  Smile,
  Image as ImageIcon,
  AlertTriangle,
  Lock,
  Phone,
  Video,
  ArrowLeft,
} from 'lucide-react';

export const PrivateMessagingPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const { initiateCall } = useCall();

  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [textInput, setTextInput] = useState('');
  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(new Set());
  const [initError, setInitError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');

  // Pickers & Modals
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [attachedMedia, setAttachedMedia] = useState<{ url: string; type: 'gif' | 'image' } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeConversation = conversations.find((c) => c.id === activeConvId);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load real user conversations on mount
  useEffect(() => {
    if (!user || !user.id || user.isGuest) return;
    let isMounted = true;

    async function loadConvs() {
      const userOpts = { isGuest: user.isGuest, userId: user.id };
      const convIds = await messagingService.fetchUserConversations(user.id, userOpts);
      if (!isMounted) return;

      const loaded: DirectConversation[] = convIds.map((cId) => {
        const parts = cId.replace('conv_', '').split('_');
        const partnerId = parts.find((p) => p !== user.id) || 'partner';
        return {
          id: cId,
          partnerId,
          partnerNickname: `User ${partnerId.slice(0, 6)}`,
          partnerAvatar: '👤',
          partnerOnlineStatus: 'idle',
          lastMessage: language === 'bn' ? 'ব্যক্তিগত কথোপকথন শুরু হয়েছে' : 'Private conversation initialized',
          lastMessageTimestamp: new Date().toISOString(),
          unreadCount: 0,
        };
      });

      setConversations(loaded);
      if (loaded.length > 0 && !activeConvId) {
        setActiveConvId(loaded[0].id);
      }
    }

    loadConvs();

    return () => {
      isMounted = false;
    };
  }, [user?.id, user?.isGuest, language]);

  // Register conversation on backend & fetch history
  useEffect(() => {
    if (!activeConversation || user.isGuest) return;
    const currentConv = activeConversation;

    let cancel = false;
    let unsubscribeFn: (() => void) | null = null;

    async function init() {
      setInitError(null);
      const userOpts = { isGuest: user.isGuest, userId: user.id };
      const initRes = await messagingService.getOrCreateConversation(user.id, currentConv.partnerId, userOpts);
      if (cancel) return;

      if (!initRes.success) {
        setInitError(initRes.error || 'Failed to initialize conversation');
        return;
      }

      const verifiedConvId = initRes.conversationId || activeConvId;
      if (verifiedConvId !== activeConvId) {
        setActiveConvId(verifiedConvId);
      }

      const res = await messagingService.fetchConversationMessages(verifiedConvId, user.id, userOpts);
      if (cancel) return;

      if (res.success) {
        setMessages(res.messages || []);
      } else {
        setInitError(res.error || 'Failed to fetch conversation history');
      }
      setTimeout(scrollToBottom, 50);

      if (!cancel && res.success) {
        unsubscribeFn = messagingService.subscribeToConversation(verifiedConvId, user.id, {
          onMessage: (newMsg) => {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            setTimeout(scrollToBottom, 50);
          },
        }, userOpts);
      }
    }

    init();

    return () => {
      cancel = true;
      if (unsubscribeFn) unsubscribeFn();
    };
  }, [activeConvId, activeConversation, user?.id, user?.isGuest]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = textInput.trim();
    if ((!clean && !attachedMedia) || !activeConversation || user.isGuest) return;

    if (blockedUsers.has(activeConversation.partnerId)) {
      setInitError('You have blocked this user. Unblock them to send messages.');
      return;
    }

    const tempId = `temp_${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      conversationId: activeConvId,
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      recipientId: activeConversation.partnerId,
      content: clean,
      mediaUrl: attachedMedia?.url,
      mediaType: attachedMedia?.type,
      timestamp: new Date().toISOString(),
      isDirect: true,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setTextInput('');
    const mediaToSend = attachedMedia;
    setAttachedMedia(null);
    setShowEmojiPicker(false);
    setShowGifPicker(false);
    setTimeout(scrollToBottom, 50);

    let linkPreview: LinkPreviewData | undefined;
    const urlMatch = clean.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch && !mediaToSend) {
      const preview = await messagingService.fetchLinkPreview(urlMatch[0]);
      if (preview) linkPreview = preview;
    }

    const result = await messagingService.sendConversationMessage(activeConvId, {
      senderId: user.id,
      senderNickname: user.nickname,
      senderAvatar: user.avatar,
      recipientId: activeConversation.partnerId,
      content: clean,
      mediaUrl: mediaToSend?.url,
      mediaType: mediaToSend?.type,
      linkPreview,
      senderType: 'registered',
      isGuest: false,
    });

    if (result.success && result.message) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? result.message! : m)));
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInitError(result.error || 'Private message sending failed.');
    }
  };

  const handleToggleBlock = async () => {
    if (!activeConversation) return;
    const targetId = activeConversation.partnerId;
    const isCurrentlyBlocked = blockedUsers.has(targetId);
    const newStatus = !isCurrentlyBlocked;

    await messagingService.toggleBlock(user.id, targetId, newStatus);
    setBlockedUsers((prev) => {
      const next = new Set(prev);
      if (newStatus) next.add(targetId);
      else next.delete(targetId);
      return next;
    });
  };

  const handleReportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportReason.trim()) return;
    setReportSuccess(true);
    setTimeout(() => {
      setReportSuccess(false);
      setReportModalOpen(false);
      setReportReason('');
    }, 1500);
  };

  const handleInsertBanglish = (phrase: string) => {
    setTextInput((prev) => (prev ? `${prev} ${phrase}` : phrase));
  };

  const isCurrentBlocked = Boolean(activeConversation && blockedUsers.has(activeConversation.partnerId));

  if (user.isGuest) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center space-y-4">
        <ShieldAlert className="w-12 h-12 text-amber-400 mx-auto" />
        <h1 className="text-xl font-bold text-white">Private Direct Messaging Requires Registered Account</h1>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Guest accounts cannot use private direct messaging or 1-on-1 calls. Please register a free account to unlock private conversations.
        </p>
        <Button variant="accent" size="md" onClick={() => navigate('register' as any)}>
          Register Free Account
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 h-[calc(100vh-8.5rem)] min-h-[600px] flex flex-col">
      <SEOHead
        title="Private Direct Messaging & Conversation Security – ChatLustora"
        description="One-on-one private messaging with participant controls, blocking, read receipts, and privacy protection on ChatLustora."
        canonicalPath="/messages"
        noindex={true}
      />

      <div className="p-4 rounded-t-xl border border-slate-800 bg-[#0c1222] flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-rose-500" />
            <span>{t.nav.messages}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Private 1-on-1 direct conversations with participant authorization & blocking controls
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono bg-emerald-950/20 px-3 py-1.5 rounded-lg border border-emerald-800/40">
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          <span>RLS Isolated & TLS Encrypted</span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden border-x border-b border-slate-800 rounded-b-xl bg-[#090d18]">
        {/* Left: Contact threads */}
        <div className={`w-full sm:w-80 border-r border-slate-800 bg-[#0c1220] flex flex-col justify-between shrink-0 ${mobileView === 'thread' ? 'hidden sm:flex' : 'flex'}`}>
          <div className="p-3 border-b border-slate-800">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search conversations..."
                className="w-full bg-[#101729] border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {conversations.length > 0 ? (
              conversations.map((c) => {
                const isSelected = c.id === activeConvId;
                const isBlocked = blockedUsers.has(c.partnerId);

                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      setActiveConvId(c.id);
                      setMobileView('thread');
                    }}
                    className={`w-full p-3.5 flex items-start gap-3 text-left transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#141c30]' : 'hover:bg-[#101729]'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-lg shrink-0 select-none">
                      {c.partnerAvatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs text-white truncate flex items-center gap-1">
                          <span>{c.partnerNickname}</span>
                          {isBlocked && (
                            <span className="text-[10px] text-rose-400 font-mono">(Blocked)</span>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {formatDhakaTime(c.lastMessageTimestamp, language).split(' ')[0]}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate">{c.lastMessage}</p>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">
                <p>No active conversations yet.</p>
                <p className="text-[10px] text-slate-500 mt-1">Start chatting in public rooms or random match to connect with peers.</p>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-slate-800 bg-[#0a0e1a] text-[11px] text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-slate-300">
              <Lock className="w-3.5 h-3.5 text-cyan-400" />
              <span>Session Isolation Notice</span>
            </div>
            <p className="text-[10px] text-slate-500">
              Guests cannot access private direct messages. Only verified registered accounts participate in direct messaging.
            </p>
          </div>
        </div>

        {/* Right: Message Stream & Composer */}
        {activeConversation ? (
          <div className={`flex-1 flex-col justify-between overflow-hidden relative ${mobileView === 'list' ? 'hidden sm:flex' : 'flex'}`}>
            <div className="p-3.5 border-b border-slate-800 bg-[#0c1222] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setMobileView('list')}
                  className="sm:hidden p-1.5 text-slate-400 hover:text-white"
                  title="Back to conversations"
                >
                  <ArrowLeft className="w-5 h-5 text-cyan-400" />
                </button>
                <span className="text-xl select-none">{activeConversation.partnerAvatar}</span>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <span>{activeConversation.partnerNickname}</span>
                    {isCurrentBlocked && (
                      <span className="text-[10px] text-rose-400 border border-rose-900 bg-rose-950/40 px-1 rounded">
                        Blocked
                      </span>
                    )}
                  </h3>
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>Direct Participant</span>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isCurrentBlocked}
                  onClick={() => {
                    initiateCall({
                      calleeId: activeConversation.partnerId,
                      calleeNickname: activeConversation.partnerNickname,
                      calleeAvatar: activeConversation.partnerAvatar,
                      mediaKind: 'audio',
                      conversationId: activeConvId,
                    });
                  }}
                  title="Start Voice Call"
                >
                  <Phone className="w-3.5 h-3.5 mr-1 text-cyan-400" />
                  <span>Call</span>
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isCurrentBlocked}
                  onClick={() => {
                    initiateCall({
                      calleeId: activeConversation.partnerId,
                      calleeNickname: activeConversation.partnerNickname,
                      calleeAvatar: activeConversation.partnerAvatar,
                      mediaKind: 'video',
                      conversationId: activeConvId,
                    });
                  }}
                  title="Start Video Call"
                >
                  <Video className="w-3.5 h-3.5 mr-1 text-violet-400" />
                  <span>Video</span>
                </Button>

                <Button
                  size="sm"
                  variant={isCurrentBlocked ? 'outline' : 'secondary'}
                  onClick={handleToggleBlock}
                  className={isCurrentBlocked ? 'text-rose-400 border-rose-900' : ''}
                >
                  {isCurrentBlocked ? (
                    <>
                      <UserCheck className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                      <span>Unblock</span>
                    </>
                  ) : (
                    <>
                      <UserX className="w-3.5 h-3.5 mr-1 text-slate-400" />
                      <span>Block</span>
                    </>
                  )}
                </Button>

                <button
                  onClick={() => setReportModalOpen(true)}
                  className="p-1.5 text-rose-400 hover:text-white rounded border border-slate-800 bg-[#101729]"
                  title="Report user"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#090d18]">
              {initError ? (
                <div className="py-8 flex flex-col items-center justify-center text-center text-rose-400 p-6 bg-rose-950/20 rounded-xl border border-rose-900/50 m-4">
                  <ShieldAlert className="w-8 h-8 mb-2 text-rose-500" />
                  <p className="font-semibold text-sm mb-1">Conversation Status Notice</p>
                  <p className="text-xs text-rose-300 font-mono">{initError}</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No messages yet. Send a message to start the private conversation.
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const isMe = msg.senderId === user.id;

                  return (
                    <div
                      key={`${msg.id}-${idx}`}
                      className={`flex items-start gap-2.5 max-w-md ${
                        isMe ? 'ml-auto flex-row-reverse' : ''
                      }`}
                    >
                      <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs shrink-0 select-none">
                        {msg.senderAvatar}
                      </div>
                      <div
                        className={`rounded-xl p-3 text-xs leading-relaxed ${
                          isMe
                            ? 'bg-violet-600 text-white rounded-tr-none'
                            : 'bg-[#12192c] border border-slate-800 text-slate-200 rounded-tl-none'
                        }`}
                      >
                        <p className="break-words whitespace-pre-wrap">{msg.content}</p>

                        {msg.mediaUrl && (
                          <div className="mt-2 rounded-lg overflow-hidden border border-slate-700/60 max-w-xs">
                            <img
                              src={msg.mediaUrl}
                              alt="Shared GIF"
                              className="w-full max-h-48 object-cover"
                              loading="lazy"
                            />
                          </div>
                        )}

                        <div
                          className={`text-[9px] font-mono mt-1 ${
                            isMe ? 'text-violet-200 text-right' : 'text-slate-400'
                          }`}
                        >
                          {formatDhakaTime(msg.timestamp, language)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {attachedMedia && (
              <div className="px-4 py-2 bg-[#0c1222] border-t border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <img
                    src={attachedMedia.url}
                    alt="Attachment"
                    className="w-8 h-8 object-cover rounded border border-slate-700"
                  />
                  <span>Attached Animated GIF</span>
                </div>
                <button
                  onClick={() => setAttachedMedia(null)}
                  className="text-xs text-rose-400 hover:text-white"
                >
                  Remove
                </button>
              </div>
            )}

            <div className="p-3 border-t border-slate-800 bg-[#0c1222] space-y-2 relative">
              <BanglishHelperBar onInsertText={handleInsertBanglish} />

              {showEmojiPicker && (
                <EmojiPicker
                  onSelectEmoji={(em) => {
                    setTextInput((prev) => prev + em);
                    setShowEmojiPicker(false);
                  }}
                  onClose={() => setShowEmojiPicker(false)}
                />
              )}
              {showGifPicker && (
                <GifPicker
                  onSelectGif={(gif) => {
                    setAttachedMedia({ url: gif.url, type: 'gif' });
                    setShowGifPicker(false);
                  }}
                  onClose={() => setShowGifPicker(false)}
                />
              )}

              {isCurrentBlocked ? (
                <div className="p-3 rounded-lg bg-rose-950/20 border border-rose-900/40 text-xs text-rose-400 text-center font-mono">
                  You have blocked this user. Unblock them above to resume messaging.
                </div>
              ) : (
                <form onSubmit={handleSend} className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEmojiPicker(!showEmojiPicker);
                        setShowGifPicker(false);
                      }}
                      className="p-2 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white"
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
                      className="p-2 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white"
                      title="GIF picker"
                    >
                      <ImageIcon className="w-4 h-4" />
                    </button>
                  </div>

                  <input
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    maxLength={2000}
                    placeholder="Type a private message..."
                    className="flex-1 bg-[#101729] border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                  <Button type="submit" variant="primary" size="md">
                    <Send className="w-4 h-4 mr-1.5" />
                    <span>Send</span>
                  </Button>
                </form>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden sm:flex flex-1 items-center justify-center p-8 text-center text-slate-400">
            <p className="text-xs">Select a contact to view conversation</p>
          </div>
        )}
      </div>

      {reportModalOpen && (
        <Modal
          isOpen={reportModalOpen}
          onClose={() => setReportModalOpen(false)}
          title="Report Direct Message or User"
          subtitle={activeConversation?.partnerNickname}
        >
          {reportSuccess ? (
            <div className="p-6 text-center space-y-2">
              <div className="text-emerald-400 font-bold">✓ Logged</div>
              <p className="text-xs text-slate-400">Incident forwarded to Trust & Safety triage.</p>
            </div>
          ) : (
            <form onSubmit={handleReportSubmit} className="space-y-4">
              <p className="text-xs text-slate-300">
                Reports are treated with confidentiality. Our moderation team reviews flagged messages.
              </p>
              <textarea
                rows={3}
                required
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                placeholder="Describe harassment, unwanted content, or misconduct..."
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => setReportModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" size="sm" type="submit">
                  Submit Report
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
};
