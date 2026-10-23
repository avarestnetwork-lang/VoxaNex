import React, { useState, useRef, useEffect } from 'react';
import { usePrivateChat, FloatingChatWindow } from '../../context/PrivateChatContext';
import { useAuth } from '../../context/AuthContext';
import { formatDhakaTime } from '../../utils/date';
import { Button } from '../ui/Button';
import { EmojiPicker } from './EmojiPicker';
import { GifPicker } from './GifPicker';
import {
  X,
  Minimize2,
  Maximize2,
  Square,
  Send,
  Smile,
  Image as ImageIcon,
  Check,
  Clock,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react';

export const FloatingChatWindowView: React.FC<{ window: FloatingChatWindow }> = ({ window: win }) => {
  const { user } = useAuth();
  const { closeChat, minimizeChat, maximizeChat, sendMessage, markAsRead } = usePrivateChat();
  const [inputText, setInputText] = useState(win.draft);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
    if (win.isOpen && !win.isMinimized) {
      markAsRead(win.conversationId);
    }
  }, [win.messages, win.isOpen, win.isMinimized, win.conversationId, markAsRead]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const content = inputText;
    setInputText('');
    await sendMessage(win.conversationId, content);
  };

  const handleSelectEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    setShowEmoji(false);
  };

  const handleSelectGif = async (gif: { url: string }) => {
    setShowGifs(false);
    await sendMessage(win.conversationId, '', { url: gif.url, type: 'gif' });
  };

  // Rule 5 & 7: Only render when isOpen AND displayMode === 'floating'
  if (!win.isOpen || win.displayMode !== 'floating') return null;

  // Minimized view: small tab at bottom-right
  if (win.isMinimized) {
    return (
      <div className="bg-[#0d1424] border border-slate-700 rounded-t-xl shadow-2xl flex items-center justify-between px-4 py-2.5 w-72 text-white cursor-pointer hover:bg-[#121b30] transition-colors">
        <div
          className="flex items-center gap-2.5 min-w-0 flex-1"
          onClick={() => minimizeChat(win.conversationId)}
        >
          <span className="text-lg select-none shrink-0">{win.partnerAvatar || '👤'}</span>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-xs truncate flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate">{win.partnerNickname}</span>
            </div>
            {win.unreadCount > 0 && (
              <span className="text-[10px] text-rose-400 font-semibold">
                {win.unreadCount} new message{win.unreadCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {win.unreadCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
              {win.unreadCount}
            </span>
          )}
          <button
            onClick={() => minimizeChat(win.conversationId)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            title="Restore"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => closeChat(win.conversationId)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const containerClasses =
    'w-full sm:w-[360px] h-[480px] bg-[#0d1424] border border-slate-700/80 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden z-50';

  return (
    <div className={containerClasses}>
      {/* Header */}
      <div className="bg-gradient-to-r from-[#10182c] to-[#14203a] px-3.5 py-3 border-b border-slate-700/70 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative shrink-0">
            <span className="text-2xl select-none">{win.partnerAvatar || '👤'}</span>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#0d1424]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-white truncate">{win.partnerNickname}</h3>
            <p className="text-[10px] text-emerald-400 font-medium">Online · Direct Message</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => minimizeChat(win.conversationId)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Minimize"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => maximizeChat(win.conversationId)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Maximize to large tab"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => closeChat(win.conversationId)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Message History */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[#0a0f1c]/90">
        {win.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-500 text-xs">
            <MessageSquare className="w-8 h-8 text-violet-500/30 mb-2" />
            <p className="text-slate-400 font-medium">Start your secure private conversation with {win.partnerNickname}.</p>
            <p className="text-[10px] text-slate-500 mt-1">Messages are end-to-end encrypted in your secure session.</p>
          </div>
        ) : (
          win.messages.map((msg, idx) => {
            const isMe = msg.senderId === user.id;
            return (
              <div key={msg.id || idx} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-xs shadow-sm ${
                    isMe
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-br-none'
                      : 'bg-[#151f38] text-slate-100 border border-slate-700/60 rounded-bl-none'
                  }`}
                >
                  {!isMe && (
                    <div className="text-[10px] font-bold text-violet-300 mb-0.5">{msg.senderNickname}</div>
                  )}

                  {msg.content && <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>}

                  {msg.mediaUrl && (
                    <div className="mt-2 rounded-lg overflow-hidden border border-slate-700/40">
                      <img src={msg.mediaUrl} alt="Shared media" className="max-h-48 w-full object-cover" />
                    </div>
                  )}

                  <div className={`flex items-center gap-1.5 mt-1 text-[9px] ${isMe ? 'text-violet-200 justify-end' : 'text-slate-400 justify-start'}`}>
                    <span>{formatDhakaTime(msg.timestamp)}</span>
                    {isMe && (
                      <span>
                        {msg.status === 'sending' ? (
                          <Clock className="w-2.5 h-2.5 animate-pulse text-amber-300" />
                        ) : msg.status === 'failed' ? (
                          <span title="Failed to send">
                            <AlertTriangle className="w-2.5 h-2.5 text-rose-400" />
                          </span>
                        ) : (
                          <Check className="w-2.5 h-2.5 text-violet-200" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input & Pickers Area */}
      <div className="p-3 bg-[#0d1424] border-t border-slate-700/70 relative shrink-0">
        {showEmoji && (
          <div className="absolute bottom-full left-2 mb-2 z-30">
            <EmojiPicker onSelectEmoji={handleSelectEmoji} onClose={() => setShowEmoji(false)} />
          </div>
        )}
        {showGifs && (
          <div className="absolute bottom-full left-2 mb-2 z-30">
            <GifPicker onSelectGif={handleSelectGif} onClose={() => setShowGifs(false)} />
          </div>
        )}

        <form onSubmit={handleSend} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowEmoji(!showEmoji);
              setShowGifs(false);
            }}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Insert Emoji"
          >
            <Smile className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowGifs(!showGifs);
              setShowEmoji(false);
            }}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Insert GIF"
          >
            <ImageIcon className="w-4 h-4" />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a private message..."
            className="flex-1 bg-[#121b30] border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
          />

          <Button type="submit" variant="primary" size="sm" className="shrink-0 rounded-xl px-3">
            <Send className="w-3.5 h-3.5" />
          </Button>
        </form>
      </div>
    </div>
  );
};

export const FloatingChatManager: React.FC = () => {
  const { openWindows, latestToast, clearToast, openChat } = usePrivateChat();

  // Rule 5 & 7: The floating manager must render ONLY conversations whose mode is 'floating'
  const floatingWindows = openWindows.filter(
    (win) => win.isOpen && win.displayMode === 'floating'
  );

  return (
    <>
      {/* Floating Toast Notification */}
      {latestToast && (
        <div className="fixed bottom-20 right-4 z-50 max-w-sm rounded-2xl bg-[#0d1424] border border-violet-500/50 shadow-2xl p-4 text-white animate-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-start gap-3">
            <span className="text-2xl select-none shrink-0">{latestToast.avatar}</span>
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
              openChat({ id: latestToast.conversationId, nickname: latestToast.title, avatar: latestToast.avatar });
              clearToast();
            }}>
              <div className="text-xs font-bold text-violet-300 truncate">{latestToast.title} sent a message</div>
              <p className="text-xs text-slate-300 truncate mt-0.5">{latestToast.message}</p>
            </div>
            <button
              onClick={clearToast}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Chat Windows Stack at Bottom-Right */}
      <div className="fixed bottom-0 right-4 z-50 flex items-end gap-3 flex-wrap justify-end pointer-events-none">
        {floatingWindows.map((win) => (
          <div key={win.conversationId} className="pointer-events-auto">
            <FloatingChatWindowView window={win} />
          </div>
        ))}
      </div>
    </>
  );
};
