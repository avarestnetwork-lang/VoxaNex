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
  };
  onClose: () => void;
  language: 'en' | 'bn';
}

export const PrivateChatPane: React.FC<PrivateChatPaneProps> = ({
  conversationId,
  partner,
  currentUser,
  onClose,
  language,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
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

    async function init() {
      setLoading(true);
      await messagingService.getOrCreateConversation(currentUser.id, partner.id);
      const res = await messagingService.fetchConversationMessages(conversationId, currentUser.id);
      if (!cancel) {
        if (res.success && res.messages.length > 0) {
          setMessages(res.messages);
          // Mark newest incoming message as read
          const incoming = res.messages.filter((m) => m.senderId === partner.id);
          if (incoming.length > 0) {
            const latest = incoming[incoming.length - 1];
            messagingService.sendConversationRead(conversationId, currentUser.id, latest.id);
          }
        } else {
          // Welcome message placeholder
          setMessages([
            {
              id: `welcome_${Date.now()}`,
              conversationId,
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
        setLoading(false);
        setTimeout(() => scrollToBottom(false), 50);
      }
    }

    init();

    const unsubscribe = messagingService.subscribeToConversation(conversationId, currentUser.id, {
      onMessage: (newMsg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          // Reconcile optimistic message by clientNonce or temp ID
          if (newMsg.clientNonce && prev.some((m) => m.clientNonce === newMsg.clientNonce)) {
            return prev.map((m) => (m.clientNonce === newMsg.clientNonce ? newMsg : m));
          }
          return [...prev, newMsg];
        });

        // Mark incoming message as read
        if (newMsg.senderId === partner.id) {
          messagingService.sendConversationRead(conversationId, currentUser.id, newMsg.id);
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
    });

    return () => {
      cancel = true;
      unsubscribe();
    };
  }, [conversationId, partner.id, partner.nickname, partner.avatar, currentUser.id, language]);

  // Handle typing input with debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    messagingService.sendConversationTyping(conversationId, currentUser.id, currentUser.nickname, true);

    typingTimeoutRef.current = setTimeout(() => {
      messagingService.sendConversationTyping(conversationId, currentUser.id, currentUser.nickname, false);
    }, 2500);
  };

  // Send DM
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = inputText.trim();
    if (!clean && !attachedMedia) return;

    const tempId = `temp_${Date.now()}`;
    const nonce = `nonce_dm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const optimisticMsg: ChatMessage = {
      id: tempId,
      conversationId,
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

    const result = await messagingService.sendConversationMessage(conversationId, {
      senderId: currentUser.id,
      senderNickname: currentUser.nickname,
      senderAvatar: currentUser.avatar,
      recipientId: partner.id,
      content: clean,
      mediaUrl: mediaToSend?.url,
      mediaType: mediaToSend?.type,
      clientNonce: nonce,
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
      <div className="p-3 bg-[#0d1424] border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Return to Public Chatroom"
          >
            <ArrowLeft className="w-5 h-5 text-cyan-400" />
          </button>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl select-none">{partner.avatar || '👤'}</span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className={`font-bold text-sm tracking-tight ${partnerGender.textColor}`}>
                  {partner.nickname}
                </h2>
                <span
                  className="text-[10px] px-1.5 py-0.2 rounded border font-mono"
                  style={{
                    color: partnerGender.colorHex,
                    borderColor: `${partnerGender.colorHex}50`,
                    backgroundColor: `${partnerGender.colorHex}15`,
                  }}
                >
                  {partnerGender.icon} {partnerGender.label}
                </span>
                <span className="text-[10px] text-slate-400 border border-slate-700/80 px-1.5 py-0.2 rounded bg-slate-800/40">
                  {partner.isGuest ? 'Guest' : 'Member'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400 font-medium">Direct 1-on-1 End-to-End Session</span>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors cursor-pointer flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Return to Group</span>
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading conversation history...</div>
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
                <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-sm shrink-0 select-none">
                  {msg.senderAvatar}
                </div>
                <div
                  className={`rounded-2xl px-4 py-2.5 text-xs leading-relaxed max-w-sm sm:max-w-md ${
                    isMe
                      ? 'bg-violet-600 text-white rounded-tr-none'
                      : 'bg-[#131c31] border border-slate-800 text-slate-200 rounded-tl-none'
                  }`}
                >
                  <div
                    className={`flex items-center justify-between gap-3 text-[10px] mb-1 ${
                      isMe ? 'text-violet-200' : 'text-slate-400'
                    }`}
                  >
                    <span className="font-semibold">{msg.senderNickname}</span>
                    <span className="font-mono">{formatDhakaTime(msg.timestamp, language)}</span>
                  </div>

                  {msg.content && <p className="break-words whitespace-pre-wrap">{msg.content}</p>}

                  {msg.mediaUrl && (
                    <div className="mt-2 rounded-lg overflow-hidden border border-slate-700/60 max-w-xs">
                      <img src={msg.mediaUrl} alt="Shared attachment" className="w-full max-h-48 object-cover" />
                    </div>
                  )}

                  {/* Read Receipts for Outgoing Messages */}
                  {isMe && (
                    <div className="mt-1 flex items-center justify-end gap-1 text-[10px] font-mono">
                      {isSending && <span className="text-violet-300">Sending...</span>}
                      {isFailed && <span className="text-rose-300">Failed</span>}
                      {isDelivered && (
                        <span className="flex items-center gap-0.5" title={isRead ? 'Read by partner' : 'Delivered'}>
                          {isRead ? (
                            <>
                              <CheckCheck className="w-3.5 h-3.5 text-cyan-300" />
                              <span className="text-cyan-300 font-semibold">Read</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5 text-violet-200" />
                              <span className="text-violet-200">Sent</span>
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
      {partnerTyping && (
        <div className="px-4 py-1.5 bg-[#090d18] border-t border-slate-800/60 text-xs text-cyan-400 flex items-center gap-2 animate-pulse">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          <span>{partner.nickname} is typing...</span>
        </div>
      )}

      {/* Composer */}
      <div className="p-3 border-t border-slate-800 bg-[#0c1222] shrink-0 relative">
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

        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowGifPicker(false);
              }}
              className="p-2 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <Smile className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowGifPicker(!showGifPicker);
                setShowEmojiPicker(false);
              }}
              className="p-2 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
          </div>

          <input
            type="text"
            value={inputText}
            onChange={handleInputChange}
            placeholder={`Message ${partner.nickname}...`}
            className="flex-1 bg-[#101729] border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
          />

          <Button type="submit" variant="primary" size="md" className="shrink-0">
            <Send className="w-4 h-4 mr-1.5" />
            <span>Send</span>
          </Button>
        </form>
      </div>
    </div>
  );
};
