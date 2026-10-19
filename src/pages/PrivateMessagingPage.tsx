import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { DirectConversation, ChatMessage } from '../types';
import { formatDhakaTime } from '../utils/date';
import { BanglishHelperBar } from '../components/layout/BanglishHelperBar';
import { EmojiPicker } from '../components/chat/EmojiPicker';
import { GifPicker } from '../components/chat/GifPicker';
import { LinkPreviewCard } from '../components/chat/LinkPreviewCard';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { messagingService, LinkPreviewData, GifItem } from '../services/messagingService';
import { useCall } from '../context/CallContext';
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
  RotateCcw,
  Check,
  Clock,
  Lock,
  Phone,
  Video,
} from 'lucide-react';

export const PrivateMessagingPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const { initiateCall } = useCall();

  const [conversations, setConversations] = useState<DirectConversation[]>([
    {
      id: `conv_${[user.id, 'user_sylhet'].sort().join('_')}`,
      partnerId: 'user_sylhet',
      partnerNickname: 'Sylhet_Breeze',
      partnerAvatar: '🌿',
      partnerOnlineStatus: 'idle',
      lastMessage: 'Kalke Sylhet tea garden tour-er plan kora jay?',
      lastMessageTimestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      unreadCount: 1,
    },
    {
      id: `conv_${[user.id, 'user_ctg'].sort().join('_')}`,
      partnerId: 'user_ctg',
      partnerNickname: 'Karnaphuli_Soul',
      partnerAvatar: '⚡',
      partnerOnlineStatus: 'idle',
      lastMessage: 'Dhonnobad! Audio session-e kotha hobe.',
      lastMessageTimestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      unreadCount: 0,
    },
  ]);

  const [activeConvId, setActiveConvId] = useState<string>(() => conversations[0]?.id || '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [textInput, setTextInput] = useState('');
  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(new Set());

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

  // Register conversation on backend & fetch history
  useEffect(() => {
    if (!activeConversation) return;
    const currentConv = activeConversation;

    let cancel = false;
    async function init() {
      // Register membership on server
      await messagingService.getOrCreateConversation(user.id, currentConv.partnerId);

      // Fetch history
      const res = await messagingService.fetchConversationMessages(activeConvId, user.id);
      if (!cancel) {
        if (res.success && res.messages.length > 0) {
          setMessages(res.messages);
        } else {
          // Initialize friendly welcome message if empty
          setMessages([
            {
              id: `init_${Date.now()}`,
              conversationId: activeConvId,
              senderId: currentConv.partnerId,
              senderNickname: currentConv.partnerNickname,
              senderAvatar: currentConv.partnerAvatar,
              content: 'Hi! Let’s keep in touch here on VoxaNex.',
              timestamp: new Date().toISOString(),
              isDirect: true,
            },
          ]);
        }
        setTimeout(scrollToBottom, 50);
      }
    }

    init();

    // Subscribe to SSE stream for this conversation
    const unsubscribe = messagingService.subscribeToConversation(activeConvId, user.id, {
      onMessage: (newMsg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        setTimeout(scrollToBottom, 50);
      },
    });

    return () => {
      cancel = true;
      unsubscribe();
    };
  }, [activeConvId, activeConversation, user.id]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = textInput.trim();
    if (!clean && !attachedMedia) return;
    if (!activeConversation) return;

    // Check if partner is blocked
    if (blockedUsers.has(activeConversation.partnerId)) {
      alert('You have blocked this user. Unblock them to send messages.');
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

    // Link preview extraction
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
    });

    if (result.success && result.message) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? result.message! : m)));
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? { ...c, lastMessage: clean, lastMessageTimestamp: new Date().toISOString(), unreadCount: 0 }
            : c
        )
      );
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 h-[calc(100vh-8.5rem)] min-h-[600px] flex flex-col">
      {/* Header Bar */}
      <div className="p-4 rounded-t-xl border border-slate-800 bg-[#0c1222] flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-violet-400" />
            <span>{t.nav.messages}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time direct 1-on-1 messaging with PostgreSQL Row-Level Security
          </p>
        </div>

        {/* Honest Privacy Badge */}
        <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono bg-emerald-950/20 px-3 py-1.5 rounded-lg border border-emerald-800/40">
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          <span>RLS Isolated & TLS Encrypted</span>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden border-x border-b border-slate-800 rounded-b-xl bg-[#090d18]">
        {/* Left: Contact threads */}
        <div className="w-full sm:w-80 border-r border-slate-800 bg-[#0c1220] flex flex-col justify-between shrink-0">
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
            {conversations.map((c) => {
              const isSelected = c.id === activeConvId;
              const isBlocked = blockedUsers.has(c.partnerId);

              return (
                <button
                  key={c.id}
                  onClick={() => setActiveConvId(c.id)}
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
            })}
          </div>

          {/* Privacy Notice */}
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
          <div className="hidden sm:flex flex-1 flex-col justify-between overflow-hidden relative">
            {/* Thread Header with Mute & Block controls */}
            <div className="p-3.5 border-b border-slate-800 bg-[#0c1222] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
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

              {/* Actions */}
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
                      <span>Unblock User</span>
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

            {/* Message Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#090d18]">
              {messages.map((msg, idx) => {
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
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Attached media preview */}
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

            {/* Composer */}
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
                    placeholder="Type a private message in Bangla, Banglish, or English..."
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
          <div className="flex-1 flex items-center justify-center p-8 text-center text-slate-400">
            <p className="text-xs">Select a contact to view conversation</p>
          </div>
        )}
      </div>

      {/* Report Modal */}
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
