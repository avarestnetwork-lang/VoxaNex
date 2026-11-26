import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../../types';
import { messagingService, LinkPreviewData, GifItem } from '../../services/messagingService';
import { formatDhakaTime } from '../../utils/date';
import { getGenderInfo } from '../../pages/PublicChatPage';
import { EmojiPicker } from './EmojiPicker';
import { GifPicker } from './GifPicker';
import { TypingIndicator } from './TypingIndicator';
import { SecureMediaRenderer } from './SecureMediaRenderer';
import { ComposerAttachmentPreview } from './ComposerAttachmentPreview';
import { useChatMediaAttachment } from '../../hooks/useChatMediaAttachment';
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  SUPPORTED_IMAGE_FORMATS_TEXT,
  SUPPORTED_ALL_FORMATS_TEXT,
} from '../../lib/mediaValidation';
import { Button } from '../ui/Button';
import { useCall } from '../../context/CallContext';
import {
  Send,
  ArrowLeft,
  Smile,
  Image as ImageIcon,
  Paperclip,
  Upload,
  Check,
  CheckCheck,
  RotateCcw,
  Shield,
  MessageSquare,
  Minimize2,
  Maximize2,
  X,
  Phone,
  Video,
  Minus,
} from 'lucide-react';

interface PrivateChatPaneProps {
  conversationId: string;
  partner: {
    id: string;
    nickname: string;
    avatar: string;
    gender?: string;
    isGuest?: boolean;
  };
  currentUser: {
    id: string;
    nickname: string;
    avatar: string;
    isGuest?: boolean;
  };
  onClose: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  language: 'en' | 'bn';
}

export const PrivateChatPane: React.FC<PrivateChatPaneProps> = ({
  conversationId,
  partner,
  currentUser,
  onClose,
  onMinimize,
  onMaximize,
  language,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showImageMenu, setShowImageMenu] = useState(false);
  const [lastReadMessageId, setLastReadMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const { initiateCall, activeCall, isCallModalOpen } = useCall();
  const [isStartingCall, setIsStartingCall] = useState<'audio' | 'video' | null>(null);

  const isGuestUser = currentUser.isGuest === true;
  const isPartnerVerifiedMember = partner.isGuest === false;
  const canInitiateCalls = !isGuestUser && isPartnerVerifiedMember;
  const callDisabledReason = isGuestUser
    ? (language === 'bn' ? 'অতিথি ব্যবহারকারীরা কল করতে পারবেন না।' : 'Guests cannot initiate calls.')
    : !isPartnerVerifiedMember
    ? (language === 'bn' ? 'অতিথি বা যাচাই না করা ব্যবহারকারীকে কল করা সম্ভব নয়।' : 'Cannot call unverified or guest partner.')
    : activeCall || isCallModalOpen
    ? (language === 'bn' ? 'একটি কল ইতিমধ্যে চলছে।' : 'A call is already active.')
    : null;

  const handleStartCall = async (mediaKind: 'audio' | 'video') => {
    if (currentUser.isGuest) {
      alert(language === 'bn' ? 'অতিথি ব্যবহারকারীরা কল করতে পারবেন না। অনুগ্রহ করে রেজিস্টার্ড অ্যাকাউন্ট ব্যবহার করুন।' : 'Guest users cannot initiate audio or video calls. Please register an account.');
      return;
    }
    if (partner.isGuest !== false) {
      alert(language === 'bn' ? 'অতিথি বা যাচাই না করা ব্যবহারকারীকে কল করা সম্ভব নয়।' : 'Cannot initiate call: Partner must be a registered verified member.');
      return;
    }
    if (activeCall || isCallModalOpen || isStartingCall) {
      alert(language === 'bn' ? 'একটি কল ইতিমধ্যে চলছে বা প্রক্রিয়াধীন আছে।' : 'A call is already active or in progress.');
      return;
    }

    setIsStartingCall(mediaKind);
    const res = await initiateCall({
      calleeId: partner.id,
      calleeNickname: partner.nickname,
      calleeAvatar: partner.avatar,
      mediaKind,
      conversationId: activeConversationId || conversationId,
    });
    setIsStartingCall(null);

    if (!res.success) {
      alert(res.error || (language === 'bn' ? 'কল শুরু করা ব্যর্থ হয়েছে' : 'Failed to start call'));
    }
  };

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
    contextType: 'conversation',
    contextId: activeConversationId,
    isGuest: currentUser.isGuest,
    userId: currentUser.id,
  });

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  };

  // 1. Load History & Subscribe
  useEffect(() => {
    let cancel = false;
    let unsubscribeFn: (() => void) | null = null;

    async function init() {
      setLoading(true);
      setInitError(null);
      setActiveConversationId(null);

      const userOpts = { isGuest: currentUser.isGuest, userId: currentUser.id };
      const initRes = await messagingService.getOrCreateConversation(currentUser.id, partner.id, userOpts);
      if (cancel) return;

      if (!initRes.success) {
        setInitError(initRes.error || 'Failed to initialize conversation');
        setLoading(false);
        return;
      }

      const verifiedConvId = initRes.conversationId || conversationId;
      setActiveConversationId(verifiedConvId);

      const res = await messagingService.fetchConversationMessages(verifiedConvId, currentUser.id, userOpts);
      if (cancel) return;

      if (res.success) {
        if (res.messages.length > 0) {
          setMessages(res.messages);
          // Mark newest incoming message as read
          const incoming = res.messages.filter((m) => m.senderId === partner.id);
          if (incoming.length > 0) {
            const latest = incoming[incoming.length - 1];
            messagingService.sendConversationRead(verifiedConvId, currentUser.id, latest.id, userOpts);
          }
        } else {
          // Welcome message placeholder
          setMessages([
            {
              id: `welcome_${Date.now()}`,
              conversationId: verifiedConvId,
              senderId: partner.id,
              senderNickname: partner.nickname,
              senderAvatar: partner.avatar,
              content:
                language === 'bn'
                  ? `হ্যালো! এখানে আমরা নিরাপদে ব্যক্তিগত বার্তা পাঠাতে পারি।`
                  : `Hello! We can now exchange private messages here securely.`,
              timestamp: new Date().toISOString(),
              isDirect: true,
              status: 'delivered',
            },
          ]);
        }
      } else {
        setInitError(res.error || 'Failed to fetch conversation history');
      }
      setLoading(false);
      setTimeout(() => scrollToBottom(false), 50);

      if (!cancel && res.success) {
        unsubscribeFn = messagingService.subscribeToConversation(verifiedConvId, currentUser.id, {
          onMessage: (newMsg) => {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              if (newMsg.clientNonce && prev.some((m) => m.clientNonce === newMsg.clientNonce)) {
                return prev.map((m) => (m.clientNonce === newMsg.clientNonce ? newMsg : m));
              }
              return [...prev, newMsg];
            });

            if (newMsg.senderId === partner.id) {
              messagingService.sendConversationRead(verifiedConvId, currentUser.id, newMsg.id, userOpts);
            }

            setTimeout(() => scrollToBottom(true), 50);
          },
          onTyping: (typers) => {
            setPartnerTyping(typers.includes(partner.nickname));
          },
          onRead: (receipt) => {
            if (receipt.userId === partner.id) {
              setLastReadMessageId(receipt.messageId);
            }
          },
        }, userOpts);
      }
    }

    init();

    return () => {
      cancel = true;
      if (unsubscribeFn) unsubscribeFn();
    };
  }, [conversationId, partner.id, partner.nickname, partner.avatar, currentUser.id, currentUser.isGuest, language]);

  const isComposerDisabled = loading || Boolean(initError) || !activeConversationId;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (isComposerDisabled || !activeConversationId) return;

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    messagingService.sendConversationTyping(activeConversationId, currentUser.id, currentUser.nickname, true, { isGuest: currentUser.isGuest, userId: currentUser.id });

    typingTimeoutRef.current = setTimeout(() => {
      if (activeConversationId) {
        messagingService.sendConversationTyping(activeConversationId, currentUser.id, currentUser.nickname, false, { isGuest: currentUser.isGuest, userId: currentUser.id });
      }
    }, 2500);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isComposerDisabled || !activeConversationId) return;
    const clean = inputText.trim();
    if (!canSendMessage(clean)) return;

    const tempId = `temp_${Date.now()}`;
    const nonce = `nonce_dm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const mediaToSend = stagedMedia;

    const optimisticMsg: ChatMessage = {
      id: tempId,
      conversationId: activeConversationId,
      senderId: currentUser.id,
      senderNickname: currentUser.nickname,
      senderAvatar: currentUser.avatar,
      recipientId: partner.id,
      content: clean,
      mediaUrl: mediaToSend?.url,
      mediaType: mediaToSend?.type,
      timestamp: new Date().toISOString(),
      status: 'sending',
      clientNonce: nonce,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setInputText('');
    markSent();
    setShowEmojiPicker(false);
    setShowGifPicker(false);
    setShowImageMenu(false);
    setTimeout(() => scrollToBottom(true), 50);

    const result = await messagingService.sendConversationMessage(activeConversationId, {
      senderId: currentUser.id,
      senderNickname: currentUser.nickname,
      senderAvatar: currentUser.avatar,
      recipientId: partner.id,
      content: clean,
      mediaUrl: mediaToSend?.url,
      mediaType: mediaToSend?.type,
      clientNonce: nonce,
      senderType: currentUser.isGuest ? 'guest' : 'registered',
      isGuest: currentUser.isGuest,
    });

    if (result.success && result.message) {
      const confirmed = result.message;
      setMessages((prev) => {
        if (prev.some((m) => m.id === confirmed.id)) {
          return prev.filter((m) => m.id !== tempId);
        }
        return prev.map((m) =>
          m.id === tempId || (nonce && m.clientNonce === nonce)
            ? { ...confirmed, status: 'delivered' }
            : m
        );
      });
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, status: 'failed' } : m
        )
      );
    }
  };

  const handleRetryMessage = async (failedMsg: ChatMessage) => {
    if (!activeConversationId) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === failedMsg.id ? { ...m, status: 'sending' } : m))
    );

    const result = await messagingService.sendConversationMessage(activeConversationId, {
      senderId: currentUser.id,
      senderNickname: currentUser.nickname,
      senderAvatar: currentUser.avatar,
      recipientId: partner.id,
      content: failedMsg.content,
      mediaUrl: failedMsg.mediaUrl,
      mediaType: failedMsg.mediaType,
      clientNonce: failedMsg.clientNonce,
      senderType: currentUser.isGuest ? 'guest' : 'registered',
      isGuest: currentUser.isGuest,
    });

    if (result.success && result.message) {
      const confirmed = result.message;
      setMessages((prev) => {
        if (prev.some((m) => m.id === confirmed.id)) {
          return prev.filter((m) => m.id !== failedMsg.id);
        }
        return prev.map((m) => (m.id === failedMsg.id ? { ...confirmed, status: 'delivered' } : m));
      });
    } else {
      setMessages((prev) =>
        prev.map((m) => (m.id === failedMsg.id ? { ...m, status: 'failed' } : m))
      );
    }
  };

  const handleClosePane = () => {
    removeAttachment();
    onClose();
  };

  const partnerGender = getGenderInfo(partner.gender);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0f1d] overflow-hidden">
      {/* Conversation Top Header */}
      <div className="p-3 bg-[#0d1424] border-b border-slate-800 flex items-center justify-between gap-3 shrink-0 h-14 sm:h-16">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {!onMinimize && (
            <button
              onClick={handleClosePane}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              title="Return to Public Chatroom"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 text-cyan-400" />
            </button>
          )}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="text-2xl select-none shrink-0">{partner.avatar || '👤'}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <h2 className={`font-bold text-sm tracking-tight truncate ${partnerGender.textColor}`}>
                  {partner.nickname}
                </h2>
                <span
                  className="text-[9px] px-1.5 py-0.2 rounded border font-mono shrink-0 hidden xs:inline-block"
                  style={{
                    color: partnerGender.colorHex,
                    borderColor: `${partnerGender.colorHex}50`,
                    backgroundColor: `${partnerGender.colorHex}15`,
                  }}
                >
                  {partnerGender.icon} {partnerGender.label}
                </span>
                <span className="text-[9px] text-slate-400 border border-slate-700/80 px-1 py-0.2 rounded bg-slate-800/40 shrink-0 hidden sm:inline-block">
                  {partner.isGuest ? 'Guest' : 'Member'}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="text-emerald-400 font-medium truncate">Direct 1-on-1 Session</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={!canInitiateCalls || Boolean(isStartingCall) || Boolean(activeCall) || isCallModalOpen}
            onClick={() => handleStartCall('audio')}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 flex items-center justify-center ${
              isStartingCall === 'audio'
                ? 'bg-cyan-600 text-white border-cyan-500 animate-pulse'
                : 'border-slate-800 bg-[#101729] text-cyan-400 hover:text-white hover:bg-slate-800 hover:border-cyan-500/50'
            }`}
            title={canInitiateCalls ? 'Start audio call' : (callDisabledReason || 'Calls unavailable')}
            aria-label="Start audio call"
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={!canInitiateCalls || Boolean(isStartingCall) || Boolean(activeCall) || isCallModalOpen}
            onClick={() => handleStartCall('video')}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 flex items-center justify-center ${
              isStartingCall === 'video'
                ? 'bg-violet-600 text-white border-violet-500 animate-pulse'
                : 'border-slate-800 bg-[#101729] text-violet-400 hover:text-white hover:bg-slate-800 hover:border-violet-500/50'
            }`}
            title={canInitiateCalls ? 'Start video call' : (callDisabledReason || 'Calls unavailable')}
            aria-label="Start video call"
          >
            <Video className="w-4 h-4" />
          </button>

          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              className="p-1.5 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white hover:bg-slate-800 hover:border-slate-700 transition-colors cursor-pointer shrink-0 flex items-center justify-center"
              title="Minimize"
              aria-label="Minimize chat"
            >
              <Minus className="w-4 h-4" />
            </button>
          )}
          {onMaximize && (
            <button
              type="button"
              onClick={onMaximize}
              className="p-1.5 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white hover:bg-slate-800 hover:border-slate-700 transition-colors cursor-pointer shrink-0 flex items-center justify-center"
              title="Maximize to large tab"
              aria-label="Maximize chat"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handleClosePane}
            className="p-1.5 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-rose-400 hover:bg-slate-800 hover:border-rose-500/50 transition-colors cursor-pointer shrink-0 flex items-center justify-center"
            title="Close"
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
        {initError ? (
          <div className="py-8 flex flex-col items-center justify-center text-center text-rose-400 p-6 bg-rose-950/20 rounded-xl border border-rose-900/50 m-4">
            <Shield className="w-8 h-8 mb-2 text-rose-500" />
            <p className="font-semibold text-sm mb-1">{language === 'bn' ? 'চ্যাট শুরু করতে সমস্যা হয়েছে' : 'Conversation Initialization Failed'}</p>
            <p className="text-xs text-rose-300 font-mono">{initError}</p>
          </div>
        ) : loading ? (
          <div className="py-12 text-center text-xs text-slate-400 animate-pulse">Loading conversation history...</div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.senderId === currentUser.id;
            const isDelivered = msg.status === 'delivered';
            const isSending = msg.status === 'sending';
            const isFailed = msg.status === 'failed';
            const isRead = isMe && isDelivered && (lastReadMessageId === msg.id || !!lastReadMessageId);

            return (
              <div
                key={`${msg.id}-${idx}`}
                className={`flex items-start gap-2.5 max-w-xl ${isMe ? 'ml-auto flex-row-reverse' : ''}`}
              >
                <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-sm shrink-0 select-none shadow-sm">
                  {msg.senderAvatar}
                </div>
                <div
                  className={`rounded-2xl px-3.5 py-2 text-xs leading-relaxed max-w-[85%] sm:max-w-md shadow-sm ${
                    isMe
                      ? 'bg-violet-600 text-white rounded-tr-none'
                      : 'bg-[#131c31] border border-slate-800 text-slate-200 rounded-tl-none'
                  }`}
                >
                  <div
                    className={`flex items-center justify-between gap-3 text-[9px] mb-0.5 ${
                      isMe ? 'text-violet-200' : 'text-slate-400'
                    }`}
                  >
                    <span className="font-semibold truncate max-w-[80px]">{msg.senderNickname}</span>
                    <span className="font-mono shrink-0">{formatDhakaTime(msg.timestamp, language)}</span>
                  </div>

                  {msg.content && <p className="break-words whitespace-pre-wrap">{msg.content}</p>}

                  {msg.mediaUrl && (
                    <div className="mt-2 rounded-lg overflow-hidden border border-slate-700/60 max-w-full">
                      <SecureMediaRenderer
                        mediaUrl={msg.mediaUrl}
                        mediaType={msg.mediaType}
                        alt="Shared attachment"
                        className="w-full max-h-48 object-contain bg-black/20"
                        isGuest={currentUser.isGuest}
                        userId={currentUser.id}
                      />
                    </div>
                  )}

                  {isMe && (
                    <div className="mt-1 flex items-center justify-end gap-1 text-[9px] font-mono">
                      {isSending && <span className="text-violet-300">Sending...</span>}
                      {isFailed && (
                        <button
                          type="button"
                          onClick={() => handleRetryMessage(msg)}
                          className="inline-flex items-center gap-0.5 text-rose-200 hover:text-white underline cursor-pointer"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          <span>Failed · Retry</span>
                        </button>
                      )}
                      {isDelivered && (
                        <span className="flex items-center gap-0.5" title={isRead ? 'Read by partner' : 'Delivered'}>
                          {isRead ? (
                            <>
                              <CheckCheck className="w-3 h-3 text-cyan-300" />
                              <span className="text-cyan-300 font-semibold uppercase">Read</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3 h-3 text-violet-200" />
                              <span className="text-violet-200 uppercase">Sent</span>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing Indicator */}
      {partnerTyping && !initError && (
        <div className="px-4 py-1 bg-[#090d18] border-t border-slate-800/60 text-[10px] text-cyan-400 flex items-center gap-2 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" />
          <span className="truncate">{partner.nickname} is typing...</span>
        </div>
      )}

      {/* Attachment Staging & Upload Progress Preview */}
      <ComposerAttachmentPreview
        attachment={attachment}
        onCancel={cancelUpload}
        onRetry={retryUpload}
        onRemove={removeAttachment}
        compact={true}
      />

      {/* Composer */}
      <div className="p-2 sm:p-3 border-t border-slate-800 bg-[#0c1222] shrink-0 relative">
        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          className="hidden"
          data-testid="private-image-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) {
              selectFile(file, 'image');
            }
          }}
        />
        <input
          ref={attachmentInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
          className="hidden"
          data-testid="private-attachment-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) {
              selectFile(file, 'attachment');
            }
          }}
        />

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
            data-testid="private-image-menu"
            className="absolute bottom-full left-2 mb-2 w-60 rounded-xl border border-slate-700/80 bg-[#0e1526] shadow-2xl p-1.5 z-40"
          >
            <button
              type="button"
              onClick={() => {
                setShowImageMenu(false);
                imageInputRef.current?.click();
              }}
              className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-800/80 text-left transition-colors cursor-pointer"
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
              className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-800/80 text-left transition-colors cursor-pointer"
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

        <form onSubmit={handleSendMessage} className="flex items-center gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1 shrink-0">
            {/* 1. Emoji */}
            <button
              type="button"
              disabled={isComposerDisabled}
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowImageMenu(false);
                setShowGifPicker(false);
              }}
              className="p-2 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              aria-label="Pick emoji"
              title="Emoji picker"
            >
              <Smile className="w-4 h-4" />
            </button>

            {/* 2. Image (Upload Image or Pick GIF) */}
            <button
              type="button"
              disabled={isComposerDisabled || isAttachmentBusy}
              onClick={() => {
                if (showGifPicker) {
                  setShowGifPicker(false);
                } else {
                  setShowImageMenu(!showImageMenu);
                }
                setShowEmojiPicker(false);
              }}
              className={`p-2 rounded-lg border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${
                showImageMenu || showGifPicker
                  ? 'bg-fuchsia-600 text-white border-fuchsia-500'
                  : 'border-slate-800 bg-[#101729] text-slate-400 hover:text-white'
              }`}
              aria-label="Image or GIF attachment"
              title={`Image (${SUPPORTED_IMAGE_FORMATS_TEXT}) or GIF`}
            >
              <ImageIcon className="w-4 h-4" />
            </button>

            {/* 3. Unified Attachment Picker (Images, Video, Audio, Documents) */}
            <button
              type="button"
              disabled={isComposerDisabled}
              onClick={() => {
                setShowEmojiPicker(false);
                setShowImageMenu(false);
                setShowGifPicker(false);
                attachmentInputRef.current?.click();
              }}
              className="p-2 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              aria-label="Attach file"
              title={`Attach file (${SUPPORTED_ALL_FORMATS_TEXT})`}
            >
              <Paperclip className="w-4 h-4" />
            </button>
          </div>

          {/* 4. Message Input */}
          <input
            type="text"
            disabled={isComposerDisabled}
            value={inputText}
            onChange={handleInputChange}
            placeholder={loading ? 'Loading...' : initError ? 'Error' : `Message...`}
            className="flex-1 min-w-0 bg-[#101729] border border-slate-800 rounded-lg px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />

          {/* 5. Send */}
          <button 
            type="submit" 
            disabled={isComposerDisabled || !canSendMessage(inputText.trim())} 
            className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white p-2 rounded-lg transition-all flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
