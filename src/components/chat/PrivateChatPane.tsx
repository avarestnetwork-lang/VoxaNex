import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../../types';
import { messagingService, LinkPreviewData, GifItem } from '../../services/messagingService';
import { formatDhakaTime } from '../../utils/date';
import { getGenderInfo } from '../../pages/PublicChatPage';
import { EmojiPicker } from './EmojiPicker';
import { GifPicker } from './GifPicker';
import { TypingIndicator } from './TypingIndicator';
import { Button } from '../ui/Button';
import {
  Send,
  ArrowLeft,
  Smile,
  Image as ImageIcon,
  Check,
  CheckCheck,
  RotateCcw,
  Shield,
  MessageSquare,
  Minimize2,
  Maximize2,
  X,
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
  const [attachedMedia, setAttachedMedia] = useState<{ url: string; type: 'gif' | 'image' } | null>(null);
  const [lastReadMessageId, setLastReadMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    if (!clean && !attachedMedia) return;

    const tempId = `temp_${Date.now()}`;
    const nonce = `nonce_dm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const optimisticMsg: ChatMessage = {
      id: tempId,
      conversationId: activeConversationId,
      senderId: currentUser.id,
      senderNickname: currentUser.nickname,
      senderAvatar: currentUser.avatar,
      recipientId: partner.id,
      content: clean,
      mediaUrl: attachedMedia?.url,
      mediaType: attachedMedia?.type,
      timestamp: new Date().toISOString(),
      status: 'sending',
      clientNonce: nonce,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setInputText('');
    const mediaToSend = attachedMedia;
    setAttachedMedia(null);
    setShowEmojiPicker(false);
    setShowGifPicker(false);
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
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...result.message!, status: 'delivered' } : m))
      );
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, status: 'failed' } : m
        )
      );
    }
  };

  const partnerGender = getGenderInfo(partner.gender);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0f1d] overflow-hidden">
      {/* Conversation Top Header */}
      <div className="p-3 bg-[#0d1424] border-b border-slate-800 flex items-center justify-between gap-3 shrink-0 h-14 sm:h-16">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {onClose && !onMinimize && (
            <button
              onClick={onClose}
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
          {onMinimize && (
            <button
              onClick={onMinimize}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Minimize"
              aria-label="Minimize chat"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          )}
          {onMaximize && (
            <button
              onClick={onMaximize}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Maximize to large tab"
              aria-label="Maximize chat"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close"
            aria-label="Close chat"
          >
            <X className="w-5 h-5" />
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
                      <img src={msg.mediaUrl} alt="Shared attachment" className="w-full max-h-48 object-contain bg-black/20" />
                    </div>
                  )}

                  {isMe && (
                    <div className="mt-1 flex items-center justify-end gap-1 text-[9px] font-mono">
                      {isSending && <span className="text-violet-300">Sending...</span>}
                      {isFailed && <span className="text-rose-300">Failed</span>}
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

      {/* Composer */}
      <div className="p-2 sm:p-3 border-t border-slate-800 bg-[#0c1222] shrink-0 relative">
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
              setAttachedMedia({ url: gif.url, type: 'gif' });
              setShowGifPicker(false);
            }}
            onClose={() => setShowGifPicker(false)}
          />
        )}

        <form onSubmit={handleSendMessage} className="flex items-center gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={isComposerDisabled}
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowGifPicker(false);
              }}
              className="p-2 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              aria-label="Pick emoji"
            >
              <Smile className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={isComposerDisabled}
              onClick={() => {
                setShowGifPicker(!showGifPicker);
                setShowEmojiPicker(false);
              }}
              className="p-2 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              aria-label="Pick GIF"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
          </div>

          <input
            type="text"
            disabled={isComposerDisabled}
            value={inputText}
            onChange={handleInputChange}
            placeholder={loading ? 'Loading...' : initError ? 'Error' : `Message...`}
            className="flex-1 min-w-0 bg-[#101729] border border-slate-800 rounded-lg px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />

          <button 
            type="submit" 
            disabled={isComposerDisabled} 
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
